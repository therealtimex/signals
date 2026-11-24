package cli

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"
)

// Rows with junk handles (#569): the bad identity is dropped before dedupe, reported on the row,
// and the rest of the row is imported. Nothing aborts.

func runImportJSON(t *testing.T, f *fakeSignals, rows []map[string]any, extra ...string) importContactsSummary {
	t.Helper()
	pointCLIAt(t, fakeSignalsServer(t, f))
	cmd := newImportContactsCmd(&rootFlags{})
	cmd.SetArgs(append([]string{"--file", writeRowsFile(t, rows), "--dedupe"}, extra...))
	out, err := runCommandCapturingStdout(t, cmd.Execute)
	if err != nil {
		t.Fatalf("import error = %v (%s)", err, out)
	}
	var summary importContactsSummary
	if err := json.Unmarshal([]byte(strings.TrimSpace(out)), &summary); err != nil {
		t.Fatalf("decode %q: %v", out, err)
	}
	return summary
}

func upsertKeys(f *fakeSignals) []string {
	keys := []string{}
	for _, upsert := range f.upserts {
		keys = append(keys, fmt.Sprintf("%v/%v", upsert["platform"], upsert["platformUserId"]))
	}
	return keys
}

func TestImportDropsAJunkSecondaryAndImportsTheRest(t *testing.T) {
	for _, mode := range []string{"real", "dry-run"} {
		t.Run(mode, func(t *testing.T) {
			f := newFakeSignals(t)
			rows := []map[string]any{
				{"key": "g1", "name": "Guest One", "identities": []map[string]any{
					{"platform": "linkedin", "platformUserId": "guest-one"},
					{"platform": "x", "handle": "in"},
				}},
				{"key": "g2", "name": "Guest Two", "identities": []map[string]any{
					{"platform": "linkedin", "platformUserId": "guest-two"},
					{"platform": "x", "handle": "linkedin.com/in/guest-two"},
					{"platform": "bluesky", "handle": "guest-two.bsky.social"},
				}},
				{"key": "g3", "name": "Guest Three", "platform": "x", "platform_user_id": "guest_three"},
			}
			var extra []string
			if mode == "dry-run" {
				extra = []string{"--dry-run"}
			}
			summary := runImportJSON(t, f, rows, extra...)

			if summary.Created != 3 || summary.Failed != 0 || summary.IdentitiesRejected != 2 {
				t.Fatalf("summary = %+v", summary)
			}
			if got := summary.Rows[0].RejectedIdentities; len(got) != 1 || got[0].Rule != "too_short" || got[0].Field != "platformHandle" || got[0].Value != "in" {
				t.Fatalf("row 1 rejected = %+v", got)
			}
			if got := summary.Rows[1].RejectedIdentities; len(got) != 1 || got[0].Rule != "foreign_url" {
				t.Fatalf("row 2 rejected = %+v", got)
			}
			if len(summary.Rows[2].RejectedIdentities) != 0 {
				t.Fatalf("row 3 rejected = %+v", summary.Rows[2].RejectedIdentities)
			}
			wantNotes := []string{
				`Guest One: dropped x identity "in" (rule: too_short); the row continues without it`,
				`Guest Two: dropped x identity "linkedin.com/in/guest-two" (rule: foreign_url); the row continues without it`,
			}
			if !reflect.DeepEqual(summary.Notes, wantNotes) {
				t.Fatalf("notes = %#v", summary.Notes)
			}
			for _, key := range []string{"g1", "g2", "g3"} {
				if entry := summary.Mapping[key]; entry.ContactID == nil || entry.Action != rowActionCreate {
					t.Fatalf("mapping[%s] = %+v", key, entry)
				}
			}
			for _, call := range f.calls {
				if call == "resolve_platform_claim" {
					continue
				}
				if mode == "dry-run" && call != "query_contacts" {
					t.Fatalf("dry run wrote %s", call)
				}
			}
			if mode == "real" {
				// The junk never reaches Signals; the rest of the row does.
				if got, want := upsertKeys(f), []string{"bluesky/guest-two.bsky.social"}; !reflect.DeepEqual(got, want) {
					t.Fatalf("upserts = %v, want %v", got, want)
				}
				for _, create := range f.creates {
					if create["platform"] == "x" && create["platformUserId"] != "guest_three" {
						t.Fatalf("create sent junk: %v", create)
					}
				}
			}
		})
	}
}

func TestImportDropsAJunkPrimaryWithItsProvenanceAndPromotesTheNextIdentity(t *testing.T) {
	f := newFakeSignals(t)
	summary := runImportJSON(t, f, []map[string]any{{
		"key": "g1", "name": "Guest One",
		"platform": "x", "platform_user_id": "notwitter", "provenance_kind": "self_declared",
		"identities": []map[string]any{
			{"platform": "linkedin", "platformUserId": "guest-one", "provenance": map[string]any{"kind": "inferred"}},
		},
	}})
	if summary.Created != 1 || summary.IdentitiesRejected != 1 || summary.Rows[0].RejectedIdentities[0].Rule != "placeholder" {
		t.Fatalf("summary = %+v", summary)
	}
	if len(f.creates) != 1 {
		t.Fatalf("creates = %v", f.creates)
	}
	create := f.creates[0]
	if create["platform"] != "linkedin" || create["platformUserId"] != "guest-one" {
		t.Fatalf("create = %v, want the promoted LinkedIn identity", create)
	}
	if provenance, _ := create["provenance"].(map[string]any); provenance["kind"] != "inferred" {
		t.Fatalf("create provenance = %v, want the promoted identity's own", create["provenance"])
	}
}

// The first guest's junk claim stays in Signals until someone removes it. Later rows carrying the
// same junk must not match or conflict with that guest.
func TestImportJunkDoesNotDedupeAgainstAnExistingJunkClaim(t *testing.T) {
	f := newFakeSignals(t)
	f.contactClaim("x", "in", "first-guest", false)
	summary := runImportJSON(t, f, []map[string]any{{
		"key": "g2", "name": "Second Guest", "email": "second@example.com",
		"identities": []map[string]any{
			{"platform": "linkedin", "platformUserId": "second-guest"},
			{"platform": "x", "handle": "@in"},
		},
	}})
	row := summary.Rows[0]
	if row.Outcome != rowOutcomeNew || row.Action != rowActionCreate || summary.Conflicts != 0 {
		t.Fatalf("row = %+v", row)
	}
	for _, claim := range row.MatchedBy {
		if claim.ContactID == "first-guest" {
			t.Fatalf("matched the junk claim: %+v", row)
		}
	}
}

func TestImportAllowUnusualHandlesKeepsShortHandlesAndForwardsTheOptOut(t *testing.T) {
	f := newFakeSignals(t)
	f.contactClaim("linkedin", "guest-one", "existing", false)
	summary := runImportJSON(t, f, []map[string]any{
		{"key": "g1", "name": "Guest One", "identities": []map[string]any{
			{"platform": "linkedin", "platformUserId": "guest-one"},
			{"platform": "x", "handle": "hi"},
			{"platform": "x", "handle": "linkedin.com/in/guest-one"},
		}},
		{"key": "g2", "name": "Mr V", "platform": "x", "platform_handle": "v"},
	}, "--allow-unusual-handles")
	if summary.Failed != 0 || summary.IdentitiesRejected != 1 || summary.Rows[0].RejectedIdentities[0].Rule != "foreign_url" {
		t.Fatalf("summary = %+v", summary)
	}
	if got, want := upsertKeys(f), []string{"linkedin/guest-one", "x/hi"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("upserts = %v, want %v", got, want)
	}
	for _, upsert := range f.upserts {
		if upsert["allowUnusualHandle"] != true {
			t.Fatalf("upsert without the opt-out: %v", upsert)
		}
	}
	if len(f.creates) != 1 || f.creates[0]["platformHandle"] != "v" || f.creates[0]["allowUnusualHandle"] != true {
		t.Fatalf("creates = %v", f.creates)
	}
}

func TestReconcileDropsJunkIdentitiesLikeImport(t *testing.T) {
	f := newFakeSignals(t)
	f.contactClaim("x", "in", "first-guest", false)
	pointCLIAt(t, fakeSignalsServer(t, f))
	cmd := newReconcileCmd(&rootFlags{})
	cmd.SetArgs([]string{"--file", writeRowsFile(t, []map[string]any{{
		"name": "Second Guest",
		"identities": []map[string]any{
			{"platform": "linkedin", "platformUserId": "second-guest"},
			{"platform": "x", "handle": "in"},
		},
	}})})
	out, err := runCommandCapturingStdout(t, cmd.Execute)
	if err != nil {
		t.Fatalf("reconcile error = %v (%s)", err, out)
	}
	var summary reconcileSummary
	if err := json.Unmarshal([]byte(strings.TrimSpace(out)), &summary); err != nil {
		t.Fatal(err)
	}
	if summary.WouldCreate != 1 || summary.Conflicts != 0 || summary.IdentitiesRejected != 1 ||
		len(summary.Rows[0].RejectedIdentities) != 1 {
		t.Fatalf("summary = %+v", summary)
	}
}

func TestDropInvalidRowIdentitiesKeepsSnowballEvidenceRows(t *testing.T) {
	rows := []contactRow{{
		Name: "Snowball", Platform: "linkedin", PlatformUserID: "in", IdentityEvidenceToken: "tok",
		SecondaryIdentities: []rowIdentity{{Platform: "x", PlatformHandle: "x"}},
	}}
	dropInvalidRowIdentities(rows, false)
	row := rows[0]
	if row.Platform != "linkedin" || row.PlatformUserID != "in" || len(row.SecondaryIdentities) != 0 || len(row.RejectedIdentities) != 1 {
		t.Fatalf("row = %+v", row)
	}
}

// Verifier WP6 r1 finding 1: a valid platformUserId with a junk platformHandle. The server checks
// the handle too, so the CLI must drop the identity instead of letting the write fail midway.
func TestDropInvalidRowIdentitiesChecksTheHandleBesideAValidKey(t *testing.T) {
	identity := rowIdentity{Platform: "x", PlatformUserID: "uid_ok_c1", PlatformHandle: "hi"}
	v := checkRowIdentity(identity, false)
	if v == nil || v.Field != "platformHandle" || v.Value != "hi" || v.Rule != "too_short" {
		t.Fatalf("violation = %+v", v)
	}
	if v := checkRowIdentity(identity, true); v != nil {
		t.Fatalf("with --allow-unusual-handles: %+v", v)
	}

	rows := []contactRow{{
		Name: "Key Ok", Platform: "linkedin", PlatformUserID: "key-ok",
		SecondaryIdentities: []rowIdentity{identity},
	}, {
		Name: "Primary Key Ok", Platform: "x", PlatformUserID: "uid_ok_c2", PlatformHandle: "notwitter",
	}}
	dropInvalidRowIdentities(rows, false)
	if len(rows[0].SecondaryIdentities) != 0 || len(rows[0].RejectedIdentities) != 1 || rows[0].RejectedIdentities[0].Field != "platformHandle" {
		t.Fatalf("row 1 = %+v", rows[0])
	}
	if rows[1].Platform != "" || len(rows[1].RejectedIdentities) != 1 || rows[1].RejectedIdentities[0].Rule != "placeholder" {
		t.Fatalf("row 2 = %+v", rows[1])
	}
}

// PR #574 C14: the server skips the value checks for an avatar-like platformUrl, including an
// image URL with a query string, so the CLI must not drop that identity.
func TestCheckRowIdentitySkipsAnAvatarURLWithAQueryString(t *testing.T) {
	for _, avatar := range []string{
		"https://www.instagram.com/static/avatar.png?w=200",
		"https://www.instagram.com/static/avatar.JPG?w=200&h=200",
		"https://www.instagram.com/static/avatar.webp",
	} {
		identity := rowIdentity{Platform: "x", PlatformUserID: "trung_rta", ProfileURL: avatar}
		if v := checkRowIdentity(identity, false); v != nil {
			t.Errorf("%s: violation = %+v, want none (avatar URLs aren't checked)", avatar, v)
		}
	}
	// A page URL on another platform's host is still foreign.
	page := rowIdentity{Platform: "x", PlatformUserID: "trung_rta", ProfileURL: "https://www.instagram.com/trung.le/?hl=en"}
	if v := checkRowIdentity(page, false); v == nil || v.Rule != "foreign_url" {
		t.Errorf("page URL violation = %+v, want foreign_url", v)
	}
}
