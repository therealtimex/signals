package cli

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestMapContactRowReadsIdentitiesProfileFieldsAndTags(t *testing.T) {
	row, err := mapContactRow(map[string]any{
		"key":              float64(123),
		"name":             "Trung Le",
		"platform":         "linkedin",
		"platform_user_id": "trung-le-rta",
		"provenance_kind":  "self_declared",
		"bio":              " Builder ",
		"headline":         "Founder at RTA",
		"website":          "https://rta.vn",
		"location":         "Hanoi",
		"tags":             []any{"hackwithbay-4", " hackwithbay-4 ", "builder", ""},
		"identities": []any{
			map[string]any{
				"platform": "X", "handle": "@trung_rta", "url": "https://x.com/trung_rta",
				"provenance": map[string]any{"kind": "self_declared", "sourceUrl": "https://lu.ma/user/trung"},
			},
			map[string]any{"platform": "Bluesky", "platformUserId": "trungle.bsky.social"},
		},
	})
	if err != nil {
		t.Fatalf("mapContactRow() error = %v", err)
	}
	if row.Key != "123" || row.Bio != "Builder" || row.Headline != "Founder at RTA" ||
		row.Website != "https://rta.vn" || row.Location != "Hanoi" {
		t.Fatalf("row fields = %+v", row)
	}
	if !reflect.DeepEqual(row.Tags, []string{"hackwithbay-4", "builder"}) {
		t.Fatalf("tags = %#v", row.Tags)
	}
	// The legacy columns stay the primary identity; identities[] adds to it.
	if row.Platform != "linkedin" || row.PlatformUserID != "trung-le-rta" || row.Provenance.Kind != "self_declared" {
		t.Fatalf("primary = %s/%s %+v", row.Platform, row.PlatformUserID, row.Provenance)
	}
	want := []rowIdentity{
		{
			Platform: "x", PlatformHandle: "@trung_rta", ProfileURL: "https://x.com/trung_rta",
			Provenance: &identityProvenance{Kind: "self_declared", SourceURL: "https://lu.ma/user/trung"},
		},
		{Platform: "bluesky", PlatformUserID: "trungle.bsky.social"},
	}
	if !reflect.DeepEqual(row.SecondaryIdentities, want) {
		t.Fatalf("secondary identities = %+v", row.SecondaryIdentities)
	}
}

func TestMapContactRowPromotesFirstIdentityWithoutLegacyColumns(t *testing.T) {
	row, err := mapContactRow(map[string]any{
		"name": "Only Identities",
		"identities": []any{
			map[string]any{
				"platform": "linkedin", "platformUserId": "only-ids", "url": "https://www.linkedin.com/in/only-ids",
				"provenance": map[string]any{"kind": "agent_verified"},
			},
			map[string]any{"platform": "x", "handle": "only_ids"},
		},
	})
	if err != nil {
		t.Fatalf("mapContactRow() error = %v", err)
	}
	if row.Platform != "linkedin" || row.PlatformUserID != "only-ids" ||
		row.ProfileURL != "https://www.linkedin.com/in/only-ids" || row.Provenance == nil || row.Provenance.Kind != "agent_verified" {
		t.Fatalf("promoted primary = %+v", row)
	}
	if len(row.SecondaryIdentities) != 1 || row.SecondaryIdentities[0].PlatformHandle != "only_ids" {
		t.Fatalf("secondary identities = %+v", row.SecondaryIdentities)
	}
}

func TestMapContactRowRejectsInvalidMultiIdentityInput(t *testing.T) {
	tooMany := make([]any, maxRowIdentities+1)
	for i := range tooMany {
		tooMany[i] = map[string]any{"platform": "x", "handle": fmt.Sprintf("h%d", i)}
	}
	tests := []struct {
		name string
		item map[string]any
		want string
	}{
		{"identity without platform", map[string]any{"identities": []any{map[string]any{"handle": "a"}}}, "requires platform"},
		{"identity without user id or handle", map[string]any{"identities": []any{map[string]any{"platform": "x"}}}, "requires platformUserId or handle"},
		{"identity provenance kind", map[string]any{"identities": []any{map[string]any{
			"platform": "x", "handle": "a", "provenance": map[string]any{"kind": "guessed"}}}}, "invalid provenance_kind"},
		{"identity provenance without kind", map[string]any{"identities": []any{map[string]any{
			"platform": "x", "handle": "a", "provenance": map[string]any{"sourceUrl": "https://lu.ma/u"}}}}, "without provenance_kind"},
		{"identities not an array", map[string]any{"identities": float64(3)}, "array of objects"},
		{"identities entry not an object", map[string]any{"identities": []any{"x:a"}}, "must be an object"},
		{"identities cell not JSON", map[string]any{"identities": "x:a"}, "not a JSON array"},
		{"too many identities", map[string]any{"identities": tooMany}, "at most 20 identities"},
		{"tag not a string", map[string]any{"tags": []any{float64(1)}}, "array of strings"},
		{"tag too long", map[string]any{"tags": []any{strings.Repeat("t", maxRowTagLength+1)}}, "longer than 100"},
		{"fractional key", map[string]any{"key": 1.5}, "whole number"},
		{"numeric key above 2^53", map[string]any{"key": float64(9007199254740993)}, "quote it as a string"},
		{"identity on an unsupported platform", map[string]any{"identities": []any{
			map[string]any{"platform": "x", "handle": "a"},
			map[string]any{"platform": "github", "platformUserId": "a"}}},
			`row "Row": identities[1].platform "github" is not a Signals platform (use one of x, linkedin,`},
		{"primary on an unsupported platform", map[string]any{"platform": "GitHub", "platform_user_id": "a"},
			`row "Row": platform "github" is not a Signals platform`},
		{"provenance twice on the promoted primary", map[string]any{
			"provenance_kind": "inferred",
			"identities": []any{map[string]any{
				"platform": "x", "handle": "a", "provenance": map[string]any{"kind": "self_declared"}}},
		}, "provenance twice"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.item["name"] = "Row"
			_, err := mapContactRow(tt.item)
			if err == nil || ExitCode(err) != 2 || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("error = %v, want usage error containing %q", err, tt.want)
			}
		})
	}
}

func TestAssignRowKeysUsesKeyElseRowNumberAndRejectsDuplicates(t *testing.T) {
	rows := []contactRow{{Name: "a", Key: "luma-1"}, {Name: "b"}, {Name: "c", Key: "luma-3"}}
	if err := assignRowKeys(rows); err != nil {
		t.Fatalf("assignRowKeys() error = %v", err)
	}
	if got := []string{rows[0].RowKey, rows[1].RowKey, rows[2].RowKey}; !reflect.DeepEqual(got, []string{"luma-1", "2", "luma-3"}) {
		t.Fatalf("row keys = %v", got)
	}
	clash := []contactRow{{Name: "a", Key: "2"}, {Name: "b"}}
	if err := assignRowKeys(clash); err == nil || !strings.Contains(err.Error(), `share row key "2"`) {
		t.Fatalf("error = %v, want duplicate key error", err)
	}
}

func TestReadContactCSVWithJSONInCellArrays(t *testing.T) {
	path := filepath.Join(t.TempDir(), "contacts.csv")
	content := strings.Join([]string{
		"key,name,platform,platform_user_id,bio,tags,identities",
		`luma-1,Trung Le,linkedin,trung-le-rta,Builder,"[""hackwithbay-4"",""builder""]","[{""platform"":""x"",""handle"":""@trung_rta"",""provenance"":{""kind"":""self_declared""}}]"`,
		`,Jane Doe,x,jane_x,,hackwithbay-4; judge ;,`,
	}, "\n")
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	rows, err := readContactRows(path, maxImportRows)
	if err != nil {
		t.Fatalf("readContactRows() error = %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("rows = %d", len(rows))
	}
	first := rows[0]
	if first.RowKey != "luma-1" || first.Bio != "Builder" || !reflect.DeepEqual(first.Tags, []string{"hackwithbay-4", "builder"}) {
		t.Fatalf("first row = %+v", first)
	}
	if len(first.SecondaryIdentities) != 1 || first.SecondaryIdentities[0].claimKey() != "trung_rta" ||
		first.SecondaryIdentities[0].Provenance.Kind != "self_declared" {
		t.Fatalf("first row identities = %+v", first.SecondaryIdentities)
	}
	second := rows[1]
	if second.RowKey != "2" || !reflect.DeepEqual(second.Tags, []string{"hackwithbay-4", "judge"}) || len(second.SecondaryIdentities) != 0 {
		t.Fatalf("second row = %+v", second)
	}
}

// The #568 case end to end, from a JSON file through the real command. The existing contact
// UlrgYWF3 holds LinkedIn trungdangle and X trung_rta; the earlier duplicate wtW73xjM holds
// LinkedIn trung-le-rta. The Luma row carries LinkedIn trung-le-rta plus X trung_rta.
func TestImport568TwoIdentityRowIsAConflictNamingBothContacts(t *testing.T) {
	for _, mode := range []string{"dry-run", "real"} {
		t.Run(mode, func(t *testing.T) {
			f := issue568Store(t)
			f.contactClaim("linkedin", "trung-le-rta", "wtW73xjM", false)
			pointCLIAt(t, fakeSignalsServer(t, f))
			file := writeRowsFile(t, []map[string]any{{
				"key": "luma-trung", "name": "Trung Le",
				"identities": []map[string]any{
					{"platform": "linkedin", "platformUserId": "trung-le-rta"},
					{"platform": "x", "handle": "@trung_rta", "provenance": map[string]any{"kind": "self_declared"}},
				},
			}})
			args := []string{"--file", file, "--dedupe"}
			if mode == "dry-run" {
				args = append(args, "--dry-run")
			}
			cmd := newImportContactsCmd(&rootFlags{})
			cmd.SetArgs(args)
			out, err := runCommandCapturingStdout(t, cmd.Execute)
			if err != nil {
				t.Fatalf("import error = %v (%s)", err, out)
			}
			if len(f.writes) != 0 || len(f.creates) != 0 {
				t.Fatalf("conflict wrote %v", f.writes)
			}
			var summary importContactsSummary
			if err := json.Unmarshal([]byte(strings.TrimSpace(out)), &summary); err != nil {
				t.Fatalf("decode %q: %v", out, err)
			}
			if summary.Created != 0 || summary.Conflicts != 1 || summary.Skipped != 1 {
				t.Fatalf("summary = %+v", summary)
			}
			row := summary.Rows[0]
			if row.Outcome != rowOutcomeConflict || row.Key != "luma-trung" ||
				!strings.Contains(row.Reason, "linkedin/trung-le-rta → contact wtW73xjM") ||
				!strings.Contains(row.Reason, "x/trung_rta → contact UlrgYWF3") {
				t.Fatalf("row = %+v", row)
			}
			entry, ok := summary.Mapping["luma-trung"]
			if !ok || entry.ContactID != nil || entry.Outcome != rowOutcomeConflict {
				t.Fatalf("mapping = %+v", summary.Mapping)
			}
		})
	}
}

// Without the earlier duplicate, the same row matches UlrgYWF3 through its secondary identity:
// never created, the primary LinkedIn is attached, and the X identity it already holds is
// re-upserted only to forward the row's provenance.
func TestImport568TwoIdentityRowMatchesAndWritesIdentities(t *testing.T) {
	f := issue568Store(t)
	pointCLIAt(t, fakeSignalsServer(t, f))
	file := writeRowsFile(t, []map[string]any{{
		"key": "luma-trung", "name": "Trung Le",
		"identities": []map[string]any{
			{"platform": "linkedin", "platformUserId": "trung-le-rta", "provenance": map[string]any{"kind": "self_declared"}},
			{"platform": "x", "handle": "@trung_rta", "provenance": map[string]any{"kind": "self_declared", "sourceUrl": "https://lu.ma/user/trung"}},
			{"platform": "bluesky", "platformUserId": "trungle.bsky.social"},
		},
	}})
	cmd := newImportContactsCmd(&rootFlags{})
	cmd.SetArgs([]string{"--file", file, "--dedupe"})
	out, err := runCommandCapturingStdout(t, cmd.Execute)
	if err != nil {
		t.Fatalf("import error = %v (%s)", err, out)
	}
	if len(f.creates) != 0 {
		t.Fatalf("created %v", f.creates)
	}
	got := []string{}
	for _, upsert := range f.upserts {
		got = append(got, fmt.Sprintf("%v %v/%v %v", upsert["contactId"], upsert["platform"], upsert["platformUserId"], upsert["provenance"]))
	}
	want := []string{
		"UlrgYWF3 linkedin/trung-le-rta map[kind:self_declared]",
		"UlrgYWF3 x/trung_rta map[kind:self_declared sourceUrl:https://lu.ma/user/trung]",
		"UlrgYWF3 bluesky/trungle.bsky.social <nil>",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("upserts =\n%s\nwant\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
	var summary importContactsSummary
	if err := json.Unmarshal([]byte(strings.TrimSpace(out)), &summary); err != nil {
		t.Fatal(err)
	}
	if entry := summary.Mapping["luma-trung"]; entry.ContactID == nil || *entry.ContactID != "UlrgYWF3" || entry.Outcome != rowOutcomeMatch {
		t.Fatalf("mapping = %+v", summary.Mapping)
	}
}

// Verifier finding 1 (WP5 r1): a handle-only primary on a matched row sent upsert_contact_identity
// no platformUserId, which the server rejects ("Invalid tool input"), so the row failed. The
// fake now enforces that rule; the handle becomes the claim key, as create_contact and dedupe
// already use it.
func TestImportHandleOnlyPrimaryOnAMatchAttachesTheHandleAsTheClaimKey(t *testing.T) {
	for _, tt := range []struct {
		name string
		row  map[string]any
	}{
		{"identities[0] handle", map[string]any{
			"key": "luma-trung", "name": "Trung Le",
			"identities": []map[string]any{
				{"platform": "x", "handle": " @trung_new "},
				{"platform": "linkedin", "platformUserId": "trungdangle"},
			},
		}},
		{"legacy platform_handle column", map[string]any{
			"key": "luma-trung", "name": "Trung Le", "platform": "x", "platform_handle": "@trung_new",
			"identities": []map[string]any{{"platform": "linkedin", "platformUserId": "trungdangle"}},
		}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			f := issue568Store(t)
			pointCLIAt(t, fakeSignalsServer(t, f))
			file := writeRowsFile(t, []map[string]any{tt.row})
			cmd := newImportContactsCmd(&rootFlags{})
			cmd.SetArgs([]string{"--file", file, "--dedupe"})
			out, err := runCommandCapturingStdout(t, cmd.Execute)
			if err != nil {
				t.Fatalf("import error = %v (%s)", err, out)
			}
			var summary importContactsSummary
			if err := json.Unmarshal([]byte(strings.TrimSpace(out)), &summary); err != nil {
				t.Fatal(err)
			}
			if summary.Failed != 0 || summary.Created != 0 || len(f.creates) != 0 {
				t.Fatalf("summary = %+v", summary)
			}
			if len(f.upserts) != 1 {
				t.Fatalf("upserts = %v", f.upserts)
			}
			upsert := f.upserts[0]
			if upsert["contactId"] != "UlrgYWF3" || upsert["platform"] != "x" || upsert["platformUserId"] != "trung_new" ||
				!strings.Contains(fmt.Sprint(upsert["platformHandle"]), "@trung_new") {
				t.Fatalf("upsert = %v", upsert)
			}
			if entry := summary.Mapping["luma-trung"]; entry.ContactID == nil || *entry.ContactID != "UlrgYWF3" || entry.Action != rowActionUpdate {
				t.Fatalf("mapping = %+v", summary.Mapping)
			}
		})
	}
}

func TestImportRejectsUnsupportedPlatformBeforeAnyCall(t *testing.T) {
	f := issue568Store(t)
	pointCLIAt(t, fakeSignalsServer(t, f))
	file := writeRowsFile(t, []map[string]any{
		{"name": "Fine", "platform": "x", "platform_user_id": "fine"},
		{"name": "Dev", "identities": []map[string]any{
			{"platform": "linkedin", "platformUserId": "dev"},
			{"platform": "github", "platformUserId": "dev"},
		}},
	})
	cmd := newImportContactsCmd(&rootFlags{})
	cmd.SetArgs([]string{"--file", file, "--dedupe"})
	out, err := runCommandCapturingStdout(t, cmd.Execute)
	if err == nil || ExitCode(err) != 2 || !strings.Contains(err.Error(), `row "Dev": identities[1].platform "github"`) {
		t.Fatalf("error = %v (%s), want a usage error naming the row", err, out)
	}
	if len(f.calls) != 0 {
		t.Fatalf("calls = %v, want none", f.calls)
	}
}

func TestImportSkipsSecondaryIdentityTheContactAlreadyHoldsWithoutProvenance(t *testing.T) {
	f := issue568Store(t)
	row := contactRow{
		Name: "Trung Le", Platform: "linkedin", PlatformUserID: "trungdangle",
		SecondaryIdentities: []rowIdentity{{Platform: "x", PlatformHandle: "trung_rta"}},
	}
	summary := newSummary()
	if err := importContactChunkWithInvoker([]contactRow{row}, true, false, &summary, f.invoke); err != nil {
		t.Fatal(err)
	}
	// Only the primary identity's existing upsert; the held X identity makes no call.
	if len(f.upserts) != 1 || f.upserts[0]["platform"] != "linkedin" {
		t.Fatalf("upserts = %#v", f.upserts)
	}
}

func TestImportCreatesContactWithProfileTagsAndSecondaryIdentities(t *testing.T) {
	f := newFakeSignals(t)
	row := contactRow{
		Name: "New Builder", Email: "builder@example.com", Platform: "linkedin", PlatformUserID: "new-builder",
		Bio: "Builds agents", Headline: "Founder", Website: "https://builder.dev", Location: "SF",
		Tags: []string{"hackwithbay-4", "builder"},
		SecondaryIdentities: []rowIdentity{{
			Platform: "x", PlatformHandle: "@new_builder", ProfileURL: "https://x.com/new_builder",
			Provenance: &identityProvenance{Kind: "agent_verified", SourceURL: "https://x.com/new_builder"},
		}},
	}
	summary := newSummary()
	if err := importContactChunkWithInvoker([]contactRow{row}, true, false, &summary, f.invoke); err != nil {
		t.Fatal(err)
	}
	if len(f.creates) != 1 {
		t.Fatalf("creates = %d", len(f.creates))
	}
	create := f.creates[0]
	for field, want := range map[string]string{"bio": "Builds agents", "headline": "Founder", "website": "https://builder.dev", "location": "SF"} {
		if create[field] != want {
			t.Fatalf("create %s = %#v", field, create[field])
		}
	}
	if len(f.upserts) != 1 {
		t.Fatalf("upserts = %#v", f.upserts)
	}
	upsert := f.upserts[0]
	if upsert["contactId"] != "contact-new-1" || upsert["platform"] != "x" || upsert["platformUserId"] != "new_builder" ||
		upsert["platformHandle"] != "@new_builder" || upsert["platformUrl"] != "https://x.com/new_builder" ||
		!reflect.DeepEqual(upsert["provenance"], map[string]any{"kind": "agent_verified", "sourceUrl": "https://x.com/new_builder"}) {
		t.Fatalf("secondary upsert = %#v", upsert)
	}
	if len(f.enriches) != 1 || !reflect.DeepEqual(f.enriches[0]["tags"], []string{"hackwithbay-4", "builder"}) {
		t.Fatalf("enrich = %#v", f.enriches)
	}
	// Write order: the contact, then its identities, then the other fields.
	wantCalls := []string{"query_contacts", "resolve_platform_claim", "resolve_platform_claim", "create_contact", "upsert_contact_identity", "enrich_contact"}
	if !reflect.DeepEqual(f.calls, wantCalls) {
		t.Fatalf("calls = %v", f.calls)
	}
}

func TestImportNicheAttachesIdempotentlyAndFailsFastWhenMissing(t *testing.T) {
	rows := []contactRow{
		{Name: "Brand New", Platform: "x", PlatformUserID: "brand_new", RowKey: "1"},
		{Name: "Known", Platform: "linkedin", PlatformUserID: "known", RowKey: "2"},
		{Name: "Conflict", Platform: "linkedin", PlatformUserID: "jane-doe", RowKey: "3",
			SecondaryIdentities: []rowIdentity{{Platform: "x", PlatformUserID: "jane_x"}}},
	}
	f := newFakeSignals(t)
	f.niches["niche-hwb4"] = true
	f.contactClaim("linkedin", "known", "contact-known", false)
	f.contactClaim("linkedin", "jane-doe", "contact-a", false)
	f.contactClaim("x", "jane_x", "contact-b", false)

	for pass := 1; pass <= 2; pass++ {
		summary := newSummary()
		summary.nicheID = "niche-hwb4"
		preflightFailed, err := runContactImportWithInvoker(rows, 50, true, false, "", "", &summary, f.invoke)
		if preflightFailed || err != nil {
			t.Fatalf("pass %d: preflightFailed = %v, err = %v", pass, preflightFailed, err)
		}
		if summary.NicheMembers != 2 {
			t.Fatalf("pass %d: nicheMembers = %d", pass, summary.NicheMembers)
		}
	}
	// Two distinct memberships (the created and the matched contact), each upserted once per
	// pass; the conflict row gets none. Pass 2 matched the contact pass 1 created.
	wantEdges := map[string]int{"contact-new-1->niche-hwb4": 2, "contact-known->niche-hwb4": 2}
	if !reflect.DeepEqual(f.edges, wantEdges) || len(f.creates) != 1 {
		t.Fatalf("edges = %v, creates = %d", f.edges, len(f.creates))
	}

	missing := newFakeSignals(t)
	summary := newSummary()
	summary.nicheID = "niche-typo"
	preflightFailed, err := runContactImportWithInvoker(rows, 50, true, false, "run-1", "", &summary, missing.invoke)
	if !preflightFailed || err == nil || ExitCode(err) != 3 || !strings.Contains(err.Error(), "niche niche-typo not found") {
		t.Fatalf("preflightFailed = %v, err = %v (exit %d)", preflightFailed, err, ExitCode(err))
	}
	if !reflect.DeepEqual(missing.calls, []string{"query_niches"}) {
		t.Fatalf("calls after missing niche = %v, want the lookup only", missing.calls)
	}
}

func TestImportMappingInRealAndDryRuns(t *testing.T) {
	rows := func() []contactRow {
		r := []contactRow{
			{Name: "New", Key: "luma-1", Platform: "x", PlatformUserID: "new_one"},
			{Name: "Known", Platform: "linkedin", PlatformUserID: "known"},
			{Name: "Again", Key: "luma-3", Platform: "x", PlatformUserID: "new_one"},
			{Name: "Gone", Key: "luma-4", Platform: "x", PlatformUserID: "gone"},
		}
		if err := assignRowKeys(r); err != nil {
			t.Fatal(err)
		}
		return r
	}
	store := func() *fakeSignals {
		f := newFakeSignals(t)
		f.niches["niche-1"] = true
		f.contactClaim("linkedin", "known", "contact-known", false)
		f.contactClaim("x", "gone", "contact-gone", true)
		return f
	}
	id := func(s string) *string { return &s }

	realStore := store()
	real := newSummary()
	real.nicheID = "niche-1"
	if _, err := runContactImportWithInvoker(rows(), 2, true, false, "", "", &real, realStore.invoke); err != nil {
		t.Fatal(err)
	}
	wantReal := map[string]rowMapping{
		"luma-1": {ContactID: id("contact-new-1"), Outcome: rowOutcomeNew, Action: rowActionCreate},
		"2":      {ContactID: id("contact-known"), Outcome: rowOutcomeMatch, Action: rowActionUpdate},
		"luma-3": {ContactID: id("contact-new-1"), Outcome: rowOutcomeMatch, Action: rowActionUpdate},
		"luma-4": {ContactID: nil, Outcome: rowOutcomeMatch, Action: rowActionSkip},
	}
	if !reflect.DeepEqual(real.Mapping, wantReal) {
		t.Fatalf("real mapping = %s", mustJSON(t, real.Mapping))
	}

	dryStore := store()
	var shortCircuited []string
	dry := newSummary()
	dry.nicheID = "niche-1"
	if _, err := runContactImportWithInvoker(rows(), 2, true, true, "", "", &dry, dryRunInvoker(dryStore.invoke, &shortCircuited)); err != nil {
		t.Fatal(err)
	}
	if len(dryStore.writes) != 0 {
		t.Fatalf("dry run wrote %v", dryStore.writes)
	}
	wantDry := map[string]rowMapping{
		"luma-1": {ContactID: id("row:1"), Outcome: rowOutcomeNew, Action: rowActionCreate},
		"2":      {ContactID: id("contact-known"), Outcome: rowOutcomeMatch, Action: rowActionUpdate},
		"luma-3": {ContactID: id("row:1"), Outcome: rowOutcomeMatch, Action: rowActionUpdate},
		"luma-4": {ContactID: nil, Outcome: rowOutcomeMatch, Action: rowActionSkip},
	}
	if !reflect.DeepEqual(dry.Mapping, wantDry) {
		t.Fatalf("dry mapping = %s", mustJSON(t, dry.Mapping))
	}
	if real.NicheMembers != 3 || dry.NicheMembers != 3 {
		t.Fatalf("nicheMembers real %d, dry %d", real.NicheMembers, dry.NicheMembers)
	}
	// null, not an omitted key, for skipped rows.
	if out := mustJSON(t, real.Mapping["luma-4"]); out != `{"contactId":null,"outcome":"match","action":"skip"}` {
		t.Fatalf("skip entry JSON = %s", out)
	}
}

func TestImportWithoutDedupeStillMapsEveryRow(t *testing.T) {
	f := newFakeSignals(t)
	rows := []contactRow{{Name: "A", RowKey: "1"}, {Name: "B", RowKey: "b"}}
	summary := newSummary()
	if err := importContactChunkWithInvoker(rows, false, false, &summary, f.invoke); err != nil {
		t.Fatal(err)
	}
	if len(summary.Mapping) != 2 || *summary.Mapping["b"].ContactID != "contact-new-2" ||
		summary.Mapping["1"].Outcome != rowOutcomeUnchecked {
		t.Fatalf("mapping = %s", mustJSON(t, summary.Mapping))
	}
}

// One invocation takes a full event cohort: 603 rows, past the old 500-row cap.
func TestImportCohortOf603RowsInOneInvocation(t *testing.T) {
	f := newFakeSignals(t)
	f.niches["niche-hwb4"] = true
	f.contactClaim("x", "guest_17", "contact-existing-17", false)
	pointCLIAt(t, fakeSignalsServer(t, f))
	rows := make([]map[string]any, 0, 603)
	for i := 1; i <= 603; i++ {
		rows = append(rows, map[string]any{
			"key":  fmt.Sprintf("luma-%d", i),
			"name": fmt.Sprintf("Guest %d", i),
			"tags": []string{"hackwithbay-4"},
			"identities": []map[string]any{
				{"platform": "linkedin", "platformUserId": fmt.Sprintf("guest-%d", i)},
				{"platform": "x", "handle": fmt.Sprintf("guest_%d", i)},
			},
		})
	}
	file := writeRowsFile(t, rows)

	cmd := newImportContactsCmd(&rootFlags{})
	cmd.SetArgs([]string{"--file", file, "--dedupe", "--niche", "niche-hwb4"})
	out, err := runCommandCapturingStdout(t, cmd.Execute)
	if err != nil {
		t.Fatalf("import error = %v", err)
	}
	var summary importContactsSummary
	if err := json.Unmarshal([]byte(strings.TrimSpace(out)), &summary); err != nil {
		t.Fatal(err)
	}
	if summary.Created != 602 || summary.Failed != 0 || len(summary.Mapping) != 603 || summary.NicheMembers != 603 {
		t.Fatalf("created %d, failed %d, mapping %d, nicheMembers %d", summary.Created, summary.Failed, len(summary.Mapping), summary.NicheMembers)
	}
	if entry := summary.Mapping["luma-17"]; entry.ContactID == nil || *entry.ContactID != "contact-existing-17" || entry.Outcome != rowOutcomeMatch {
		t.Fatalf("luma-17 = %+v", entry)
	}
	if len(f.edges) != 603 {
		t.Fatalf("niche edges = %d", len(f.edges))
	}
}

func TestImportRejectsFilesOverTheRowCap(t *testing.T) {
	rows := make([]map[string]any, maxImportRows+1)
	for i := range rows {
		rows[i] = map[string]any{"name": fmt.Sprintf("Row %d", i)}
	}
	_, err := readContactRows(writeRowsFile(t, rows), maxImportRows)
	if err == nil || !strings.Contains(err.Error(), "max 5000 per invocation") {
		t.Fatalf("error = %v", err)
	}
}

func mustJSON(t *testing.T, value any) string {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

// PR #574 C16: a numeric key past 2^53 would come back rounded in the mapping, so it is rejected
// while the file is read; the largest exact one and a quoted big key round-trip unchanged.
func TestReadContactJSONRowKeysRoundTripExactly(t *testing.T) {
	write := func(body string) string {
		path := filepath.Join(t.TempDir(), "contacts.json")
		if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
		return path
	}
	if _, err := readContactRows(write(`[{"key": 9007199254740993, "name": "Big"}]`), maxImportRows); err == nil ||
		!strings.Contains(err.Error(), "quote it as a string") {
		t.Fatalf("unsafe numeric key error = %v", err)
	}
	rows, err := readContactRows(write(`[{"key": 9007199254740991, "name": "Max"}, {"key": "9007199254740993", "name": "Quoted"}]`), maxImportRows)
	if err != nil {
		t.Fatalf("readContactRows() error = %v", err)
	}
	if rows[0].RowKey != "9007199254740991" || rows[1].RowKey != "9007199254740993" {
		t.Fatalf("keys = %q, %q", rows[0].RowKey, rows[1].RowKey)
	}
}
