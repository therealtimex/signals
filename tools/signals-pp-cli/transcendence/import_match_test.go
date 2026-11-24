package cli

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
)

// fakeSignals is an in-memory Signals for dedupe tests: contacts by email, and platform
// claims keyed exactly as resolve_platform_claim resolves them.
type fakeSignals struct {
	t       *testing.T
	emails  map[string][]string
	claims  map[string]map[string]any
	calls   []string
	writes  []string
	upserts []map[string]any
	creates []map[string]any
	nextID  int
}

func newFakeSignals(t *testing.T) *fakeSignals {
	return &fakeSignals{t: t, emails: map[string][]string{}, claims: map[string]map[string]any{}}
}

func claimKey(platform, platformUserID string) string {
	return platform + "\x00" + platformUserID
}

func (f *fakeSignals) contactClaim(platform, platformUserID, contactID string, archived bool) {
	f.claims[claimKey(platform, platformUserID)] = map[string]any{
		"kind": "contact", "contactId": contactID, "identityId": "identity-" + platformUserID, "archived": archived,
	}
}

func (f *fakeSignals) orgClaim(platform, platformUserID, orgID string) {
	f.claims[claimKey(platform, platformUserID)] = map[string]any{
		"kind": "org", "orgId": orgID, "identityId": "org-identity-" + platformUserID,
	}
}

func (f *fakeSignals) invoke(tool string, input map[string]any) (map[string]any, error) {
	f.calls = append(f.calls, tool)
	if _, readOnly := readOnlyImportTools[tool]; !readOnly {
		f.writes = append(f.writes, tool)
	}
	switch tool {
	case "query_contacts":
		email, _ := input["email"].(string)
		contacts := []any{}
		for _, id := range f.emails[email] {
			contacts = append(contacts, map[string]any{"id": id})
		}
		return map[string]any{"contacts": contacts}, nil
	case "resolve_platform_claim":
		platform, _ := input["platform"].(string)
		key, _ := input["platformUserId"].(string)
		if claimant, ok := f.claims[claimKey(platform, key)]; ok {
			return map[string]any{"claimed": true, "claimant": claimant}, nil
		}
		return map[string]any{"claimed": false}, nil
	case "create_contact":
		f.creates = append(f.creates, input)
		f.nextID++
		id := fmt.Sprintf("contact-new-%d", f.nextID)
		if platform, ok := input["platform"].(string); ok {
			key, _ := input["platformUserId"].(string)
			f.contactClaim(platform, key, id, false)
		}
		if channels, ok := input["channels"].([]map[string]any); ok {
			for _, channel := range channels {
				if channel["channelType"] == "email" {
					email, _ := channel["value"].(string)
					f.emails[email] = append(f.emails[email], id)
				}
			}
		}
		return map[string]any{"id": id}, nil
	case "upsert_contact_identity":
		f.upserts = append(f.upserts, input)
		platform, _ := input["platform"].(string)
		key, _ := input["platformUserId"].(string)
		contactID, _ := input["contactId"].(string)
		if claimant, ok := f.claims[claimKey(platform, key)]; ok && claimant["contactId"] != contactID {
			return nil, apiErr(fmt.Errorf("upsert_contact_identity (CONFLICT): already claimed"))
		}
		f.contactClaim(platform, key, contactID, false)
		return map[string]any{}, nil
	case "enrich_contact", "record_workflow_run_contacts":
		return map[string]any{"runId": "run-1", "cohortSize": float64(0)}, nil
	default:
		f.t.Fatalf("unexpected tool call %q", tool)
		return nil, nil
	}
}

// dryRunInvoker mirrors newImportInvoker under --dry-run: lookups reach Signals, every other
// call is short-circuited by the client exactly as invokeAgentTool does with c.DryRun.
func dryRunInvoker(read agentToolInvoker, shortCircuited *[]string) agentToolInvoker {
	return func(tool string, input map[string]any) (map[string]any, error) {
		if _, readOnly := readOnlyImportTools[tool]; readOnly {
			return read(tool, input)
		}
		*shortCircuited = append(*shortCircuited, tool)
		return map[string]any{"dryRun": true, "tool": tool}, nil
	}
}

func newSummary() importContactsSummary {
	return importContactsSummary{Success: true, Errors: []string{}, Notes: []string{}}
}

// The issue's data (#568): the existing contact holds LinkedIn trungdangle and, as a secondary
// identity, X trung_rta. The Luma row carries LinkedIn trung-le-rta (unknown) plus X trung_rta.
func issue568Store(t *testing.T) *fakeSignals {
	f := newFakeSignals(t)
	f.contactClaim("linkedin", "trungdangle", "UlrgYWF3", false)
	f.contactClaim("x", "trung_rta", "UlrgYWF3", false)
	return f
}

func issue568Row() contactRow {
	return contactRow{
		Name:           "Trung Le",
		Platform:       "linkedin",
		PlatformUserID: "trung-le-rta",
		ProfileURL:     "https://www.linkedin.com/in/trung-le-rta",
		Provenance:     &identityProvenance{Kind: "self_declared", SourceURL: "https://lu.ma/user/trung"},
		SecondaryIdentities: []rowIdentity{
			{Platform: "x", PlatformHandle: "@trung_rta"},
		},
	}
}

func TestImportMatchesRowBySecondaryIdentityInsteadOfCreating(t *testing.T) {
	f := issue568Store(t)
	summary := newSummary()
	if err := importContactChunkWithInvoker([]contactRow{issue568Row()}, true, false, &summary, f.invoke); err != nil {
		t.Fatalf("import error = %v", err)
	}

	if len(f.creates) != 0 || summary.Created != 0 {
		t.Fatalf("created a duplicate: creates = %#v, summary = %+v", f.creates, summary)
	}
	if summary.Failed != 0 || summary.Conflicts != 0 || summary.Enriched != 1 {
		t.Fatalf("summary = %+v", summary)
	}
	wantCalls := []string{"resolve_platform_claim", "resolve_platform_claim", "upsert_contact_identity"}
	if !reflect.DeepEqual(f.calls, wantCalls) {
		t.Fatalf("calls = %#v, want %#v", f.calls, wantCalls)
	}

	// The row's primary identity is attached to the matched contact, provenance unchanged.
	upsert := f.upserts[0]
	if upsert["contactId"] != "UlrgYWF3" || upsert["platform"] != "linkedin" || upsert["platformUserId"] != "trung-le-rta" {
		t.Fatalf("upsert = %#v", upsert)
	}
	wantProvenance := map[string]any{"kind": "self_declared", "sourceUrl": "https://lu.ma/user/trung"}
	if !reflect.DeepEqual(upsert["provenance"], wantProvenance) {
		t.Fatalf("provenance = %#v, want %#v", upsert["provenance"], wantProvenance)
	}

	want := []rowReport{{
		Row:       1,
		Name:      "Trung Le",
		Outcome:   rowOutcomeMatch,
		Action:    rowActionUpdate,
		ContactID: "UlrgYWF3",
		MatchedBy: []identityClaim{{
			Platform: "x", PlatformUserID: "trung_rta", Primary: false,
			ClaimantKind: "contact", ContactID: "UlrgYWF3",
		}},
	}}
	if !reflect.DeepEqual(summary.Rows, want) {
		t.Fatalf("rows = %+v, want %+v", summary.Rows, want)
	}
}

func TestImportNeverCreatesConflictingRows(t *testing.T) {
	tests := []struct {
		name      string
		setup     func(f *fakeSignals)
		row       contactRow
		wantNote  string
		wantMatch []identityClaim
		wantEmail []string
	}{
		{
			name: "identities claimed by two different contacts",
			setup: func(f *fakeSignals) {
				f.contactClaim("linkedin", "jane-doe", "contact-a", false)
				f.contactClaim("x", "jane_x", "contact-b", false)
			},
			row: contactRow{
				Name: "Jane Doe", Platform: "linkedin", PlatformUserID: "jane-doe",
				SecondaryIdentities: []rowIdentity{{Platform: "x", PlatformUserID: "jane_x"}},
			},
			wantNote: "Jane Doe: matches disagree: linkedin/jane-doe → contact contact-a; x/jane_x → contact contact-b; merge or disambiguate these records before importing this row",
			wantMatch: []identityClaim{
				{Platform: "linkedin", PlatformUserID: "jane-doe", Primary: true, ClaimantKind: "contact", ContactID: "contact-a"},
				{Platform: "x", PlatformUserID: "jane_x", ClaimantKind: "contact", ContactID: "contact-b"},
			},
		},
		{
			name: "email matches one contact, a secondary identity another",
			setup: func(f *fakeSignals) {
				f.emails["jane@example.com"] = []string{"contact-a"}
				f.contactClaim("x", "jane_x", "contact-b", false)
			},
			row: contactRow{
				Name: "Jane Doe", Email: "jane@example.com", Platform: "linkedin", PlatformUserID: "jane-new",
				SecondaryIdentities: []rowIdentity{{Platform: "x", PlatformUserID: "jane_x"}},
			},
			wantNote:  "Jane Doe: matches disagree: x/jane_x → contact contact-b; email jane@example.com → contact contact-a; merge or disambiguate these records before importing this row",
			wantMatch: []identityClaim{{Platform: "x", PlatformUserID: "jane_x", ClaimantKind: "contact", ContactID: "contact-b"}},
			wantEmail: []string{"contact-a"},
		},
		{
			name: "email matches one contact, the primary identity another (single-identity row)",
			setup: func(f *fakeSignals) {
				f.emails["jane@example.com"] = []string{"contact-a"}
				f.contactClaim("linkedin", "jane-doe", "contact-b", false)
			},
			row: contactRow{
				Name: "Jane Doe", Email: "jane@example.com", Platform: "linkedin", PlatformUserID: "jane-doe",
			},
			wantNote:  "Jane Doe: matches disagree: linkedin/jane-doe → contact contact-b; email jane@example.com → contact contact-a; merge or disambiguate these records before importing this row",
			wantMatch: []identityClaim{{Platform: "linkedin", PlatformUserID: "jane-doe", Primary: true, ClaimantKind: "contact", ContactID: "contact-b"}},
			wantEmail: []string{"contact-a"},
		},
		{
			name: "an org holds one identity and a contact another",
			setup: func(f *fakeSignals) {
				f.contactClaim("linkedin", "jane-doe", "contact-a", false)
				f.orgClaim("x", "acme", "org-1")
			},
			row: contactRow{
				Name: "Jane Doe", Platform: "linkedin", PlatformUserID: "jane-doe",
				SecondaryIdentities: []rowIdentity{{Platform: "x", PlatformUserID: "acme"}},
			},
			wantNote: "Jane Doe: matches disagree: linkedin/jane-doe → contact contact-a; x/acme → org org-1; merge or disambiguate these records before importing this row",
			wantMatch: []identityClaim{
				{Platform: "linkedin", PlatformUserID: "jane-doe", Primary: true, ClaimantKind: "contact", ContactID: "contact-a"},
				{Platform: "x", PlatformUserID: "acme", ClaimantKind: "org", OrgID: "org-1"},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := newFakeSignals(t)
			tt.setup(f)
			summary := newSummary()
			if err := importContactChunkWithInvoker([]contactRow{tt.row}, true, false, &summary, f.invoke); err != nil {
				t.Fatalf("import error = %v", err)
			}
			if len(f.writes) != 0 {
				t.Fatalf("conflict wrote %v", f.writes)
			}
			if summary.Created != 0 || summary.Skipped != 1 || summary.Conflicts != 1 || summary.Failed != 0 || !summary.Success {
				t.Fatalf("summary = %+v", summary)
			}
			if !reflect.DeepEqual(summary.Notes, []string{tt.wantNote}) {
				t.Fatalf("notes = %#v, want %q", summary.Notes, tt.wantNote)
			}
			row := summary.Rows[0]
			if row.Outcome != rowOutcomeConflict || row.Action != rowActionSkip || row.ContactID != "" {
				t.Fatalf("row = %+v", row)
			}
			if !reflect.DeepEqual(row.MatchedBy, tt.wantMatch) || !reflect.DeepEqual(row.EmailMatches, tt.wantEmail) {
				t.Fatalf("matchedBy = %+v, emailMatches = %v", row.MatchedBy, row.EmailMatches)
			}
		})
	}
}

func TestImportSkipsArchivedOwnerFoundBySecondaryIdentity(t *testing.T) {
	f := newFakeSignals(t)
	f.contactClaim("x", "trung_rta", "contact-archived", true)
	row := issue568Row()
	summary := newSummary()
	if err := importContactChunkWithInvoker([]contactRow{row}, true, false, &summary, f.invoke); err != nil {
		t.Fatalf("import error = %v", err)
	}
	if len(f.writes) != 0 || summary.Skipped != 1 || summary.Conflicts != 0 {
		t.Fatalf("writes = %v, summary = %+v", f.writes, summary)
	}
	want := "Trung Le: x/trung_rta is already claimed by archived contact contact-archived; restore it to import this row"
	if !reflect.DeepEqual(summary.Notes, []string{want}) {
		t.Fatalf("notes = %#v", summary.Notes)
	}
	if got := summary.Rows[0]; got.Outcome != rowOutcomeMatch || got.Action != rowActionSkip || got.ContactID != "contact-archived" {
		t.Fatalf("row = %+v", got)
	}
}

// parityRows covers every classification: new, a match by primary identity, the #568 match by
// secondary identity, a match by email, a conflict, an archived owner and an org-held account,
// then rows whose outcome depends on an earlier row in the same file: a repeated identity and a
// repeated email (matching the contact row 1 creates), and an identity a match attached.
func parityStore(t *testing.T) *fakeSignals {
	f := issue568Store(t)
	f.contactClaim("linkedin", "known", "contact-known", false)
	f.emails["mail@example.com"] = []string{"contact-mail"}
	f.contactClaim("linkedin", "jane-doe", "contact-a", false)
	f.contactClaim("x", "jane_x", "contact-b", false)
	f.contactClaim("x", "gone", "contact-gone", true)
	f.orgClaim("x", "acme", "org-1")
	return f
}

func parityRows() []contactRow {
	return []contactRow{
		{Name: "Brand New", Email: "new@example.com", Platform: "x", PlatformUserID: "brand_new", Title: "CEO"},
		{Name: "Known", Platform: "linkedin", PlatformUserID: "known", Title: "CTO"},
		issue568Row(),
		{Name: "Mail Match", Email: "mail@example.com", Title: "VP"},
		{Name: "Jane Doe", Platform: "linkedin", PlatformUserID: "jane-doe",
			SecondaryIdentities: []rowIdentity{{Platform: "x", PlatformUserID: "jane_x"}}},
		{Name: "Gone", Platform: "x", PlatformUserID: "gone"},
		{Name: "Acme", Platform: "x", PlatformUserID: "acme"},
		{Name: "Brand New Again", Platform: "x", PlatformUserID: "brand_new"},
		{Name: "Brand New Mail", Email: "new@example.com"},
		{Name: "Mail Attach", Email: "mail@example.com", Platform: "linkedin", PlatformUserID: "attach-me"},
		{Name: "Attached Later", Platform: "linkedin", PlatformUserID: "attach-me"},
	}
}

func TestImportDryRunReportsTheSameClassificationAsARealRun(t *testing.T) {
	dryStore := parityStore(t)
	var shortCircuited []string
	drySummary := newSummary()
	if err := importContactChunkWithInvoker(
		parityRows(), true, true, &drySummary, dryRunInvoker(dryStore.invoke, &shortCircuited),
	); err != nil {
		t.Fatalf("dry run error = %v", err)
	}
	if len(dryStore.writes) != 0 {
		t.Fatalf("dry run reached Signals with writes %v", dryStore.writes)
	}
	if len(shortCircuited) == 0 {
		t.Fatal("dry run planned no writes at all")
	}

	realStore := parityStore(t)
	realSummary := newSummary()
	if err := importContactChunkWithInvoker(parityRows(), true, false, &realSummary, realStore.invoke); err != nil {
		t.Fatalf("real run error = %v", err)
	}

	type counts struct{ Created, Skipped, Enriched, Failed, Conflicts int }
	dryCounts := counts{drySummary.Created, drySummary.Skipped, drySummary.Enriched, drySummary.Failed, drySummary.Conflicts}
	realCounts := counts{realSummary.Created, realSummary.Skipped, realSummary.Enriched, realSummary.Failed, realSummary.Conflicts}
	if dryCounts != realCounts {
		t.Fatalf("dry run counts %+v, real run counts %+v", dryCounts, realCounts)
	}
	if want := (counts{Created: 1, Skipped: 4, Enriched: 7, Conflicts: 2}); realCounts != want {
		t.Fatalf("real run counts %+v, want %+v", realCounts, want)
	}
	if !reflect.DeepEqual(drySummary.Notes, realSummary.Notes) {
		t.Fatalf("dry notes %#v, real notes %#v", drySummary.Notes, realSummary.Notes)
	}

	if len(drySummary.Rows) != len(realSummary.Rows) {
		t.Fatalf("row counts differ: %d vs %d", len(drySummary.Rows), len(realSummary.Rows))
	}
	wantOutcomes := []string{
		rowOutcomeNew, rowOutcomeMatch, rowOutcomeMatch, rowOutcomeMatch,
		rowOutcomeConflict, rowOutcomeMatch, rowOutcomeConflict,
		rowOutcomeMatch, rowOutcomeMatch, rowOutcomeMatch, rowOutcomeMatch,
	}
	wantContacts := []string{
		"contact-new-1", "contact-known", "UlrgYWF3", "contact-mail",
		"", "contact-gone", "",
		"contact-new-1", "contact-new-1", "contact-mail", "contact-mail",
	}
	// A dry run names a contact the file will create after the row creating it ("row:1"); the
	// real run has its ID. Map one onto the other, and nothing else may differ.
	plannedIDs := map[string]string{}
	for i, row := range realSummary.Rows {
		if row.Action == rowActionCreate {
			plannedIDs[plannedRowOwner(i+1)] = row.ContactID
		}
	}
	for i := range realSummary.Rows {
		dry, real := drySummary.Rows[i], realSummary.Rows[i]
		if real.Outcome != wantOutcomes[i] || real.ContactID != wantContacts[i] {
			t.Fatalf("row %d = %s/%q, want %s/%q", i+1, real.Outcome, real.ContactID, wantOutcomes[i], wantContacts[i])
		}
		if real.Action == rowActionCreate {
			// Only a real run knows the new contact's ID.
			if dry.ContactID != "" {
				t.Fatalf("dry create row %d has contactId %q", i+1, dry.ContactID)
			}
			real.ContactID = ""
		}
		if id, planned := plannedIDs[dry.ContactID]; planned {
			dry.ContactID = id
		}
		if len(dry.MatchedBy) > 0 {
			dry.MatchedBy = append([]identityClaim(nil), dry.MatchedBy...)
		}
		for j := range dry.MatchedBy {
			if id, planned := plannedIDs[dry.MatchedBy[j].ContactID]; planned {
				dry.MatchedBy[j].ContactID = id
			}
		}
		if len(dry.EmailMatches) > 0 {
			dry.EmailMatches = append([]string(nil), dry.EmailMatches...)
		}
		for j := range dry.EmailMatches {
			if id, planned := plannedIDs[dry.EmailMatches[j]]; planned {
				dry.EmailMatches[j] = id
			}
		}
		if !reflect.DeepEqual(dry, real) {
			t.Fatalf("row %d differs:\n dry  %+v\n real %+v", i+1, dry, real)
		}
	}
	if got := drySummary.Rows[7].ContactID; got != "row:1" {
		t.Fatalf("dry run names the repeated row's match %q, want row:1", got)
	}
}

func TestClassifyContactRowOnlyUsesReadOnlyTools(t *testing.T) {
	f := parityStore(t)
	for _, row := range parityRows() {
		if _, err := classifyContactRow(row, f.invoke); err != nil {
			t.Fatalf("classify %s: %v", row.Name, err)
		}
	}
	if len(f.writes) != 0 {
		t.Fatalf("classification called non-read tools %v", f.writes)
	}
	for tool := range readOnlyImportTools {
		if _, covered := contactImportTools[tool]; !covered {
			t.Fatalf("read-only tool %q is not a validated contact-import tool", tool)
		}
	}
}

func TestContactRowIdentitiesPrimaryFirstWithoutRepeats(t *testing.T) {
	row := contactRow{
		Platform: "linkedin", PlatformUserID: "jane",
		SecondaryIdentities: []rowIdentity{
			{Platform: "linkedin", PlatformHandle: "@jane"},
			{Platform: "x", PlatformHandle: "@jane_x"},
			{Platform: "x", PlatformUserID: ""},
			{Platform: "", PlatformUserID: "orphan"},
		},
	}
	got := row.identities()
	want := []rowIdentity{
		{Platform: "linkedin", PlatformUserID: "jane", primary: true},
		{Platform: "x", PlatformHandle: "@jane_x"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("identities = %+v, want %+v", got, want)
	}
	if got[1].claimKey() != "jane_x" {
		t.Fatalf("claimKey = %q", got[1].claimKey())
	}
}

// fakeSignalsServer serves /api/agent-tools/invoke from a fakeSignals, so the real cobra
// commands, client and --dry-run short-circuit run end to end.
func fakeSignalsServer(t *testing.T, f *fakeSignals) *httptest.Server {
	var mu sync.Mutex
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/agent-tools/invoke" {
			http.NotFound(w, r)
			return
		}
		var body struct {
			Tool  string         `json:"tool"`
			Input map[string]any `json:"input"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode request: %v", err)
			return
		}
		mu.Lock()
		result, err := f.invoke(body.Tool, body.Input)
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		if err != nil {
			w.WriteHeader(http.StatusConflict)
			_ = json.NewEncoder(w).Encode(map[string]any{"success": false, "code": "CONFLICT", "error": err.Error()})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "tool": body.Tool, "result": result})
	}))
	t.Cleanup(server.Close)
	return server
}

func runCommandCapturingStdout(t *testing.T, run func() error) (string, error) {
	t.Helper()
	original := os.Stdout
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	os.Stdout = writer
	runErr := run()
	writer.Close()
	os.Stdout = original
	out, _ := io.ReadAll(reader)
	return string(out), runErr
}

func writeRowsFile(t *testing.T, rows []map[string]any) string {
	t.Helper()
	data, err := json.Marshal(rows)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "contacts.json")
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func pointCLIAt(t *testing.T, server *httptest.Server) {
	t.Setenv("SIGNALS_BASE_URL", server.URL)
	t.Setenv("SIGNALS_PP_CLI_CONFIG", filepath.Join(t.TempDir(), "absent.toml"))
	t.Setenv("SIGNALS_AGENT_TOOL_TOKEN", "test-token")
}

// Before #568 a --dry-run import short-circuited the dedupe lookups too, so every row read
// as "created". Now the lookups run, nothing is written, and the rows are classified.
func TestImportContactsDryRunCommandClassifiesAgainstSignalsAndWritesNothing(t *testing.T) {
	f := newFakeSignals(t)
	f.contactClaim("x", "trung_rta", "UlrgYWF3", false)
	f.emails["jane@example.com"] = []string{"contact-a"}
	f.contactClaim("linkedin", "jane-doe", "contact-b", false)
	pointCLIAt(t, fakeSignalsServer(t, f))
	file := writeRowsFile(t, []map[string]any{
		{"name": "Trung Le", "platform": "x", "platform_user_id": "trung_rta", "provenance_kind": "self_declared"},
		{"name": "Jane Doe", "email": "jane@example.com", "platform": "linkedin", "platform_user_id": "jane-doe"},
		{"name": "Brand New", "platform": "x", "platform_user_id": "brand_new"},
	})

	cmd := newImportContactsCmd(&rootFlags{})
	cmd.SetArgs([]string{"--file", file, "--dedupe", "--dry-run"})
	out, err := runCommandCapturingStdout(t, cmd.Execute)
	if err != nil {
		t.Fatalf("import --dry-run error = %v (output %s)", err, out)
	}
	if len(f.writes) != 0 {
		t.Fatalf("dry run wrote %v", f.writes)
	}
	var summary importContactsSummary
	if err := json.Unmarshal([]byte(strings.TrimSpace(out)), &summary); err != nil {
		t.Fatalf("decode output %q: %v", out, err)
	}
	if summary.Created != 1 || summary.Conflicts != 1 || summary.Skipped != 1 || summary.Failed != 0 {
		t.Fatalf("summary = %+v", summary)
	}
	got := []string{}
	for _, row := range summary.Rows {
		got = append(got, row.Outcome+"/"+row.Action+"/"+row.ContactID)
	}
	want := []string{"match/update/UlrgYWF3", "conflict/skip/", "new/create/"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("rows = %v, want %v", got, want)
	}
}

func TestReconcileCommandReportsPerRowClassification(t *testing.T) {
	f := newFakeSignals(t)
	f.contactClaim("x", "trung_rta", "UlrgYWF3", false)
	f.emails["jane@example.com"] = []string{"contact-a"}
	f.contactClaim("linkedin", "jane-doe", "contact-b", false)
	pointCLIAt(t, fakeSignalsServer(t, f))
	file := writeRowsFile(t, []map[string]any{
		{"name": "Trung Le", "platform": "x", "platform_user_id": "trung_rta"},
		{"name": "Jane Doe", "email": "jane@example.com", "platform": "linkedin", "platform_user_id": "jane-doe"},
		{"name": "Brand New", "platform": "x", "platform_user_id": "brand_new"},
		{"name": "Brand New Again", "platform": "x", "platform_user_id": "brand_new"},
	})

	// The global --dry-run must not stop reconcile's read-only lookups.
	cmd := newReconcileCmd(&rootFlags{dryRun: true})
	cmd.SetArgs([]string{"--file", file})
	out, err := runCommandCapturingStdout(t, cmd.Execute)
	if err != nil {
		t.Fatalf("reconcile error = %v (output %s)", err, out)
	}
	if len(f.writes) != 0 {
		t.Fatalf("reconcile wrote %v", f.writes)
	}
	var summary reconcileSummary
	if err := json.Unmarshal([]byte(strings.TrimSpace(out)), &summary); err != nil {
		t.Fatalf("decode output %q: %v", out, err)
	}
	// Row 4 repeats row 3's identity: a real import would match the contact row 3 creates.
	if summary.Total != 4 || summary.WouldCreate != 1 || summary.WouldSkip != 3 || summary.WouldMatch != 2 || summary.Conflicts != 1 {
		t.Fatalf("summary = %+v", summary)
	}
	if got := summary.Rows[3]; got.Outcome != rowOutcomeMatch || got.ContactID != "row:3" {
		t.Fatalf("repeated row = %+v, want match on row:3", got)
	}
	if summary.Rows[0].ContactID != "UlrgYWF3" || summary.Rows[1].Outcome != rowOutcomeConflict ||
		!reflect.DeepEqual(summary.Rows[1].EmailMatches, []string{"contact-a"}) {
		t.Fatalf("rows = %+v", summary.Rows)
	}
}
