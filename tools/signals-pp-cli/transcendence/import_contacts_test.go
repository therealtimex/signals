package cli

import (
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestMapContactRow(t *testing.T) {
	item := map[string]any{
		"name":            "David Founder",
		"company":         "AuraBid",
		"title":           "CEO",
		"email":           "david@example.com",
		"platform":        "x",
		"platform_handle": "chhddavid",
		"profile_url":     "https://x.com/chhddavid",
		"avatar_url":      "https://pbs.twimg.com/profile_images/123/avatar.jpg",
		"notes":           "Top bidder",
	}

	row, err := mapContactRow(item)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if row.Name != "David Founder" {
		t.Errorf("expected Name 'David Founder', got %q", row.Name)
	}
	if row.ProfileURL != "https://x.com/chhddavid" {
		t.Errorf("expected ProfileURL 'https://x.com/chhddavid', got %q", row.ProfileURL)
	}
	if row.AvatarURL != "https://pbs.twimg.com/profile_images/123/avatar.jpg" {
		t.Errorf("expected AvatarURL 'https://pbs.twimg.com/profile_images/123/avatar.jpg', got %q", row.AvatarURL)
	}
}

func TestReadContactCSVWithAvatarURL(t *testing.T) {
	tmpDir := t.TempDir()
	csvPath := filepath.Join(tmpDir, "contacts.csv")

	csvContent := `name,company,title,email,platform,platform_handle,profile_url,avatar_url,notes
Miguel Peixoto,bidwall.app,Founder,miguel@example.com,x,mcpeixoto457,https://x.com/mcpeixoto457,https://pbs.twimg.com/profile_images/456/miguel.jpg,Met on X
`
	if err := os.WriteFile(csvPath, []byte(csvContent), 0o600); err != nil {
		t.Fatalf("failed to write test csv: %v", err)
	}

	rows, err := readContactCSV(csvPath, 10)
	if err != nil {
		t.Fatalf("unexpected readContactCSV error: %v", err)
	}

	if len(rows) != 1 {
		t.Fatalf("expected 1 row, got %d", len(rows))
	}

	row := rows[0]
	if row.Name != "Miguel Peixoto" {
		t.Errorf("expected Name 'Miguel Peixoto', got %q", row.Name)
	}
	if row.PlatformHandle != "mcpeixoto457" {
		t.Errorf("expected PlatformHandle 'mcpeixoto457', got %q", row.PlatformHandle)
	}
	if row.ProfileURL != "https://x.com/mcpeixoto457" {
		t.Errorf("expected ProfileURL 'https://x.com/mcpeixoto457', got %q", row.ProfileURL)
	}
	if row.AvatarURL != "https://pbs.twimg.com/profile_images/456/miguel.jpg" {
		t.Errorf("expected AvatarURL 'https://pbs.twimg.com/profile_images/456/miguel.jpg', got %q", row.AvatarURL)
	}
}

func TestDistinctContactIDs(t *testing.T) {
	tests := []struct {
		name   string
		result map[string]any
		want   []string
	}{
		{name: "zero", result: map[string]any{"contacts": []any{}}, want: []string{}},
		{
			name: "one",
			result: map[string]any{"contacts": []any{
				map[string]any{"id": "contact-2"},
			}},
			want: []string{"contact-2"},
		},
		{
			name: "duplicate ID",
			result: map[string]any{"contacts": []any{
				map[string]any{"id": "contact-2"},
				map[string]any{"id": "contact-2"},
			}},
			want: []string{"contact-2"},
		},
		{
			name: "multiple IDs are sorted",
			result: map[string]any{"contacts": []any{
				map[string]any{"id": "contact-9"},
				map[string]any{"id": "contact-2"},
			}},
			want: []string{"contact-2", "contact-9"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := distinctContactIDs(tt.result)
			if err != nil {
				t.Fatalf("distinctContactIDs() error = %v", err)
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("distinctContactIDs() = %#v, want %#v", got, tt.want)
			}
		})
	}
}

func TestDistinctContactIDsRejectsMalformedContacts(t *testing.T) {
	tests := []struct {
		name   string
		result map[string]any
	}{
		{name: "missing contacts", result: map[string]any{}},
		{name: "contacts not array", result: map[string]any{"contacts": map[string]any{}}},
		{name: "contact not object", result: map[string]any{"contacts": []any{"not a contact"}}},
		{name: "id not string", result: map[string]any{"contacts": []any{map[string]any{"id": 42}}}},
		{name: "id missing", result: map[string]any{"contacts": []any{map[string]any{"name": "missing id"}}}},
		{name: "id empty", result: map[string]any{"contacts": []any{map[string]any{"id": ""}}}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := distinctContactIDs(tt.result); err == nil || ExitCode(err) != 5 {
				t.Fatalf("distinctContactIDs() error = %v, want API error", err)
			}
		})
	}
}

func TestParseAgentToolEnvelopeRecordedContracts(t *testing.T) {
	t.Run("query success exposes every consumed key", func(t *testing.T) {
		result, err := parseAgentToolEnvelope("query_contacts", []byte(
			`{"success":true,"tool":"query_contacts","result":{"total":1,"contacts":[{"id":"contact-1"}]}}`,
		))
		if err != nil {
			t.Fatalf("parseAgentToolEnvelope() error = %v", err)
		}
		ids, err := distinctContactIDs(result)
		if err != nil || !reflect.DeepEqual(ids, []string{"contact-1"}) {
			t.Fatalf("distinctContactIDs() = %#v, %v", ids, err)
		}
	})

	t.Run("query no-match remains a successful typed outcome", func(t *testing.T) {
		result, err := parseAgentToolEnvelope("query_contacts", []byte(
			`{"success":true,"tool":"query_contacts","result":{"total":0,"contacts":[]}}`,
		))
		if err != nil {
			t.Fatalf("parseAgentToolEnvelope() error = %v", err)
		}
		ids, err := distinctContactIDs(result)
		if err != nil || len(ids) != 0 {
			t.Fatalf("distinctContactIDs() = %#v, %v", ids, err)
		}
	})

	t.Run("unclaimed platform remains a successful typed outcome", func(t *testing.T) {
		result, err := parseAgentToolEnvelope("resolve_platform_claim", []byte(
			`{"success":true,"tool":"resolve_platform_claim","result":{"claimed":false}}`,
		))
		if err != nil {
			t.Fatalf("parseAgentToolEnvelope() error = %v", err)
		}
		match, err := platformClaimMatch(result)
		if err != nil || match.matched() {
			t.Fatalf("platformClaimMatch() = %+v, %v", match, err)
		}
	})

	t.Run("claimed contact exposes kind contactId and archived", func(t *testing.T) {
		result, err := parseAgentToolEnvelope("resolve_platform_claim", []byte(
			`{"success":true,"tool":"resolve_platform_claim","result":{"claimed":true,"claimant":{"kind":"contact","contactId":"contact-2","identityId":"identity-2","archived":true}}}`,
		))
		if err != nil {
			t.Fatalf("parseAgentToolEnvelope() error = %v", err)
		}
		match, err := platformClaimMatch(result)
		if err != nil || match.ID != "contact-2" || !match.Archived {
			t.Fatalf("platformClaimMatch() = %+v, %v", match, err)
		}
	})

	t.Run("create success requires the consumed id", func(t *testing.T) {
		result, err := parseAgentToolEnvelope("create_contact", []byte(
			`{"success":true,"tool":"create_contact","result":{"id":"contact-created","name":"Created"}}`,
		))
		if err != nil {
			t.Fatalf("parseAgentToolEnvelope() error = %v", err)
		}
		if result["id"] != "contact-created" {
			t.Fatalf("create id = %#v", result["id"])
		}
	})

	t.Run("workflow attribution requires run id and cohort size", func(t *testing.T) {
		result, err := parseAgentToolEnvelope("record_workflow_run_contacts", []byte(
			`{"success":true,"tool":"record_workflow_run_contacts","result":{"runId":"run-1","templateId":"tpl-1","cohortSize":2,"addedContactIds":[],"alreadyRecorded":2,"processedItems":2}}`,
		))
		if err != nil {
			t.Fatalf("parseAgentToolEnvelope() error = %v", err)
		}
		if result["cohortSize"] != float64(2) {
			t.Fatalf("cohortSize = %#v", result["cohortSize"])
		}
	})

	t.Run("validation failure maps to usage error", func(t *testing.T) {
		_, err := parseAgentToolEnvelope("create_contact", []byte(
			`{"success":false,"code":"VALIDATION_ERROR","error":"Invalid tool input"}`,
		))
		if err == nil || ExitCode(err) != 2 || !strings.Contains(err.Error(), "Invalid tool input") {
			t.Fatalf("parseAgentToolEnvelope() error = %v, want usage error", err)
		}
	})

	t.Run("claim conflict maps to API error", func(t *testing.T) {
		_, err := parseAgentToolEnvelope("upsert_contact_identity", []byte(
			`{"success":false,"code":"CONFLICT","error":"Platform account is already claimed","details":{"claimant":{"kind":"org","orgId":"org-1"}}}`,
		))
		if err == nil || ExitCode(err) != 5 || !strings.Contains(err.Error(), "CONFLICT") {
			t.Fatalf("parseAgentToolEnvelope() error = %v, want API conflict", err)
		}
	})
}

func TestParseAgentToolEnvelopeRejectsMalformedResponses(t *testing.T) {
	tests := []struct {
		name string
		tool string
		body string
	}{
		{name: "invalid JSON", tool: "query_contacts", body: `{`},
		{name: "missing success", tool: "query_contacts", body: `{"result":{"contacts":[]}}`},
		{name: "non-boolean success", tool: "query_contacts", body: `{"success":"true","result":{"contacts":[]}}`},
		{name: "failure missing code", tool: "create_contact", body: `{"success":false,"error":"bad"}`},
		{name: "failure missing message", tool: "create_contact", body: `{"success":false,"code":"CONFLICT"}`},
		{name: "success missing result", tool: "create_contact", body: `{"success":true}`},
		{name: "success result not object", tool: "create_contact", body: `{"success":true,"result":[]}`},
		{name: "query missing contacts", tool: "query_contacts", body: `{"success":true,"result":{}}`},
		{name: "query contact missing id", tool: "query_contacts", body: `{"success":true,"result":{"contacts":[{}]}}`},
		{name: "claim missing claimed", tool: "resolve_platform_claim", body: `{"success":true,"result":{}}`},
		{name: "contact claim missing archived", tool: "resolve_platform_claim", body: `{"success":true,"result":{"claimed":true,"claimant":{"kind":"contact","contactId":"contact-1"}}}`},
		{name: "create missing id", tool: "create_contact", body: `{"success":true,"result":{"name":"Created"}}`},
		{name: "attribution missing run id", tool: "record_workflow_run_contacts", body: `{"success":true,"result":{"cohortSize":1}}`},
		{name: "attribution missing cohort size", tool: "record_workflow_run_contacts", body: `{"success":true,"result":{"runId":"run-1"}}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := parseAgentToolEnvelope(tt.tool, []byte(tt.body)); err == nil || ExitCode(err) != 5 {
				t.Fatalf("parseAgentToolEnvelope() error = %v, want API error", err)
			}
		})
	}
}

func TestValidateImportAttributionFlags(t *testing.T) {
	if err := validateImportAttributionFlags("", "tpl-1"); err == nil || ExitCode(err) != 2 {
		t.Fatalf("validateImportAttributionFlags() error = %v, want usage error", err)
	}
	if err := validateImportAttributionFlags("run-1", ""); err != nil {
		t.Fatalf("workflow run without template should be valid: %v", err)
	}
}

func TestRunContactImportPreflightFailureStopsBeforeMutations(t *testing.T) {
	tests := []struct {
		name     string
		failure  error
		exitCode int
	}{
		{name: "validation", failure: usageErr(fmt.Errorf("template mismatch")), exitCode: 2},
		{name: "not found", failure: apiErr(fmt.Errorf("workflow run missing")), exitCode: 5},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var calls []string
			invoke := func(tool string, _ map[string]any) (map[string]any, error) {
				calls = append(calls, tool)
				if tool != "record_workflow_run_contacts" {
					t.Fatalf("contact mutation ran before preflight completed: %q", tool)
				}
				return nil, tt.failure
			}

			summary := importContactsSummary{Success: true, Errors: []string{}, Notes: []string{}}
			preflightFailed, err := runContactImportWithInvoker(
				[]contactRow{{Name: "Must Not Mutate"}},
				1,
				false,
				false,
				"run-1",
				"tpl-1",
				&summary,
				invoke,
			)

			if !preflightFailed || err == nil || ExitCode(err) != tt.exitCode {
				t.Fatalf("preflightFailed = %v, error = %v, want exit %d", preflightFailed, err, tt.exitCode)
			}
			if !reflect.DeepEqual(calls, []string{"record_workflow_run_contacts"}) {
				t.Fatalf("calls = %#v, want preflight only", calls)
			}
			if summary.Created != 0 || summary.Enriched != 0 || summary.Skipped != 0 || summary.Failed != 0 {
				t.Fatalf("preflight failure changed row counts: %+v", summary)
			}
		})
	}
}

func TestImportContactChunkAttributesCreatedAndMatchedContacts(t *testing.T) {
	var calls []string
	var createInput map[string]any
	var enrichInputs []map[string]any
	var recordInput map[string]any
	invoke := func(tool string, input map[string]any) (map[string]any, error) {
		calls = append(calls, tool)
		switch tool {
		case "query_contacts":
			if input["email"] == "existing@example.com" {
				return map[string]any{"contacts": []any{map[string]any{"id": "contact-existing"}}}, nil
			}
			return map[string]any{"contacts": []any{}}, nil
		case "create_contact":
			createInput = input
			return map[string]any{"id": "contact-new"}, nil
		case "enrich_contact":
			enrichInputs = append(enrichInputs, input)
			return map[string]any{}, nil
		case "record_workflow_run_contacts":
			recordInput = input
			return map[string]any{"runId": "run-1", "templateId": "tpl-1", "cohortSize": float64(2)}, nil
		default:
			t.Fatalf("unexpected tool call %q", tool)
			return nil, nil
		}
	}

	attribution := newImportAttributionState("run-1", "tpl-1")
	summary := importContactsSummary{Success: true, Errors: []string{}, Notes: []string{}, Attribution: attribution.summary}
	err := importAttributedContactChunkWithInvoker([]contactRow{
		{Name: "New", Email: "new@example.com", Title: "Founder"},
		{Name: "Existing", Email: "existing@example.com", Title: "CEO"},
	}, true, false, "run-1", "tpl-1", attribution, &summary, invoke)
	if err != nil {
		t.Fatalf("importAttributedContactChunkWithInvoker() error = %v", err)
	}

	if createInput["workflowRunId"] != "run-1" || createInput["templateId"] != "tpl-1" {
		t.Fatalf("create input provenance = %#v", createInput)
	}
	for _, input := range enrichInputs {
		if _, exists := input["workflowRunId"]; exists {
			t.Fatalf("enrich input rewrote workflow provenance: %#v", input)
		}
		if _, exists := input["templateId"]; exists {
			t.Fatalf("enrich input rewrote template provenance: %#v", input)
		}
	}
	if got := recordInput["contactIds"]; !reflect.DeepEqual(got, []string{"contact-new", "contact-existing"}) {
		t.Fatalf("record contactIds = %#v", got)
	}
	if summary.Attribution == nil || summary.Attribution.Attributed != 2 || summary.Attribution.CohortSize != 2 {
		t.Fatalf("attribution summary = %+v", summary.Attribution)
	}
	wantCalls := []string{
		"query_contacts", "create_contact", "enrich_contact",
		"query_contacts", "enrich_contact", "record_workflow_run_contacts",
	}
	if !reflect.DeepEqual(calls, wantCalls) {
		t.Fatalf("calls = %#v, want %#v", calls, wantCalls)
	}
}

func TestImportContactChunkAttributesMatchEvenWhenEnrichmentFails(t *testing.T) {
	var recorded []string
	invoke := func(tool string, input map[string]any) (map[string]any, error) {
		switch tool {
		case "query_contacts":
			return map[string]any{"contacts": []any{map[string]any{"id": "contact-existing"}}}, nil
		case "enrich_contact":
			return nil, apiErr(fmt.Errorf("enrichment rejected"))
		case "record_workflow_run_contacts":
			recorded, _ = input["contactIds"].([]string)
			return map[string]any{"runId": "run-1", "cohortSize": float64(1)}, nil
		default:
			t.Fatalf("unexpected tool call %q", tool)
			return nil, nil
		}
	}

	attribution := newImportAttributionState("run-1", "")
	summary := importContactsSummary{Success: true, Errors: []string{}, Notes: []string{}, Attribution: attribution.summary}
	err := importAttributedContactChunkWithInvoker(
		[]contactRow{{Name: "Existing", Email: "existing@example.com", Title: "CEO"}},
		true,
		false,
		"run-1",
		"",
		attribution,
		&summary,
		invoke,
	)
	if err != nil {
		t.Fatalf("importAttributedContactChunkWithInvoker() error = %v", err)
	}
	if !reflect.DeepEqual(recorded, []string{"contact-existing"}) || summary.Failed != 1 {
		t.Fatalf("recorded = %#v, summary = %+v", recorded, summary)
	}
}

func TestImportContactChunkExcludesRowsWithoutConcreteActiveContactIDs(t *testing.T) {
	tests := []struct {
		name   string
		row    contactRow
		dedupe bool
		invoke agentToolInvoker
	}{
		{
			name:   "ambiguous email",
			row:    contactRow{Name: "Ambiguous", Email: "shared@example.com"},
			dedupe: true,
			invoke: func(tool string, _ map[string]any) (map[string]any, error) {
				if tool != "query_contacts" {
					t.Fatalf("unexpected tool call %q", tool)
				}
				return map[string]any{"contacts": []any{
					map[string]any{"id": "contact-a"},
					map[string]any{"id": "contact-b"},
				}}, nil
			},
		},
		{
			name: "org-held claim",
			row: contactRow{
				Name: "Org Held", Platform: "x", PlatformUserID: "org-held",
			},
			dedupe: true,
			invoke: func(tool string, _ map[string]any) (map[string]any, error) {
				if tool != "resolve_platform_claim" {
					t.Fatalf("unexpected tool call %q", tool)
				}
				return map[string]any{
					"claimed":  true,
					"claimant": map[string]any{"kind": "org", "orgId": "org-1"},
				}, nil
			},
		},
		{
			name: "archived contact claim",
			row: contactRow{
				Name: "Archived", Platform: "x", PlatformUserID: "archived",
			},
			dedupe: true,
			invoke: func(tool string, _ map[string]any) (map[string]any, error) {
				if tool != "resolve_platform_claim" {
					t.Fatalf("unexpected tool call %q", tool)
				}
				return map[string]any{
					"claimed": true,
					"claimant": map[string]any{
						"kind": "contact", "contactId": "contact-archived", "archived": true,
					},
				}, nil
			},
		},
		{
			name:   "failed create",
			row:    contactRow{Name: "Rejected"},
			dedupe: false,
			invoke: func(tool string, _ map[string]any) (map[string]any, error) {
				if tool != "create_contact" {
					t.Fatalf("unexpected tool call %q", tool)
				}
				return nil, apiErr(fmt.Errorf("create rejected"))
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			attribution := newImportAttributionState("run-1", "")
			summary := importContactsSummary{Success: true, Errors: []string{}, Notes: []string{}, Attribution: attribution.summary}
			if err := importAttributedContactChunkWithInvoker(
				[]contactRow{tt.row}, tt.dedupe, false, "run-1", "", attribution, &summary, tt.invoke,
			); err != nil {
				t.Fatalf("importAttributedContactChunkWithInvoker() error = %v", err)
			}
			if summary.Attribution.Attributed != 0 || summary.Attribution.CohortSize != 0 {
				t.Fatalf("unresolved row was attributed: %+v", summary.Attribution)
			}
		})
	}
}

func TestImportContactChunkDeduplicatesAttributionWithinChunk(t *testing.T) {
	var recorded []string
	invoke := func(tool string, input map[string]any) (map[string]any, error) {
		switch tool {
		case "create_contact":
			return map[string]any{"id": "contact-shared"}, nil
		case "record_workflow_run_contacts":
			recorded, _ = input["contactIds"].([]string)
			return map[string]any{"runId": "run-1", "cohortSize": float64(1)}, nil
		default:
			t.Fatalf("unexpected tool call %q", tool)
			return nil, nil
		}
	}

	attribution := newImportAttributionState("run-1", "")
	summary := importContactsSummary{Success: true, Errors: []string{}, Notes: []string{}, Attribution: attribution.summary}
	if err := importAttributedContactChunkWithInvoker(
		[]contactRow{{Name: "First"}, {Name: "Duplicate"}},
		false,
		false,
		"run-1",
		"",
		attribution,
		&summary,
		invoke,
	); err != nil {
		t.Fatalf("importAttributedContactChunkWithInvoker() error = %v", err)
	}
	if !reflect.DeepEqual(recorded, []string{"contact-shared"}) || summary.Attribution.Attributed != 1 {
		t.Fatalf("recorded = %#v, attribution = %+v", recorded, summary.Attribution)
	}
}

func TestImportContactChunkStopsOnAttributionFailure(t *testing.T) {
	invoke := func(tool string, _ map[string]any) (map[string]any, error) {
		switch tool {
		case "create_contact":
			return map[string]any{"id": "contact-new"}, nil
		case "record_workflow_run_contacts":
			return nil, usageErr(fmt.Errorf("template mismatch"))
		default:
			return map[string]any{}, nil
		}
	}

	attribution := newImportAttributionState("run-1", "tpl-1")
	summary := importContactsSummary{Success: true, Errors: []string{}, Notes: []string{}, Attribution: attribution.summary}
	err := importAttributedContactChunkWithInvoker(
		[]contactRow{{Name: "New"}}, false, false, "run-1", "tpl-1", attribution, &summary, invoke,
	)
	if err == nil || ExitCode(err) != 5 {
		t.Fatalf("error = %v, want API exit 5", err)
	}
	if summary.Success || len(summary.Errors) != 1 || !strings.Contains(summary.Errors[0], "template mismatch") {
		t.Fatalf("summary = %+v", summary)
	}
}

func TestRunContactImportStopsAfterChunkAttributionFailure(t *testing.T) {
	var calls []string
	recordCalls := 0
	invoke := func(tool string, _ map[string]any) (map[string]any, error) {
		calls = append(calls, tool)
		switch tool {
		case "record_workflow_run_contacts":
			recordCalls++
			if recordCalls == 1 {
				return map[string]any{"runId": "run-1", "cohortSize": float64(0)}, nil
			}
			return nil, apiErr(fmt.Errorf("cohort write rejected"))
		case "create_contact":
			return map[string]any{"id": fmt.Sprintf("contact-%d", len(calls))}, nil
		default:
			t.Fatalf("unexpected tool call %q", tool)
			return nil, nil
		}
	}

	summary := importContactsSummary{Success: true, Errors: []string{}, Notes: []string{}}
	preflightFailed, err := runContactImportWithInvoker(
		[]contactRow{{Name: "First"}, {Name: "Must Not Run"}},
		1,
		false,
		false,
		"run-1",
		"",
		&summary,
		invoke,
	)
	if preflightFailed || err == nil || ExitCode(err) != 5 {
		t.Fatalf("preflightFailed = %v, error = %v, want chunk API failure", preflightFailed, err)
	}
	wantCalls := []string{
		"record_workflow_run_contacts",
		"create_contact",
		"record_workflow_run_contacts",
	}
	if !reflect.DeepEqual(calls, wantCalls) {
		t.Fatalf("calls = %#v, want %#v", calls, wantCalls)
	}
}

func TestParseAgentToolEnvelopeRejectsLegacyImportToolErrors(t *testing.T) {
	for tool := range contactImportTools {
		t.Run(tool, func(t *testing.T) {
			body := `{"success":true,"result":{"error":"legacy failure"}}`
			if _, err := parseAgentToolEnvelope(tool, []byte(body)); err == nil || ExitCode(err) != 5 {
				t.Fatalf("parseAgentToolEnvelope() error = %v, want API error", err)
			}
		})
	}
}

func TestImportContactChunkPreservesZeroAndSingleMatchBehavior(t *testing.T) {
	tests := []struct {
		name         string
		queryResult  map[string]any
		wantCalls    []string
		wantCreated  int
		wantEnriched int
	}{
		{
			name:         "zero IDs creates and enriches",
			queryResult:  map[string]any{"contacts": []any{}},
			wantCalls:    []string{"query_contacts", "create_contact", "enrich_contact"},
			wantCreated:  1,
			wantEnriched: 1,
		},
		{
			name: "one ID enriches",
			queryResult: map[string]any{"contacts": []any{
				map[string]any{"id": "contact-2"},
			}},
			wantCalls:    []string{"query_contacts", "enrich_contact"},
			wantEnriched: 1,
		},
		{
			name: "duplicate rows for one ID enrich",
			queryResult: map[string]any{"contacts": []any{
				map[string]any{"id": "contact-2"},
				map[string]any{"id": "contact-2"},
			}},
			wantCalls:    []string{"query_contacts", "enrich_contact"},
			wantEnriched: 1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var calls []string
			invoke := func(tool string, _ map[string]any) (map[string]any, error) {
				calls = append(calls, tool)
				switch tool {
				case "query_contacts":
					return tt.queryResult, nil
				case "create_contact":
					return map[string]any{"id": "contact-created"}, nil
				case "enrich_contact":
					return map[string]any{}, nil
				default:
					t.Fatalf("unexpected tool call %q", tool)
					return nil, nil
				}
			}

			summary := importContactsSummary{Success: true, Errors: []string{}, Notes: []string{}}
			err := importContactChunkWithInvoker([]contactRow{{
				Name:  "Existing Behavior",
				Email: "person@example.com",
				Title: "CEO",
			}}, true, false, &summary, invoke)
			if err != nil {
				t.Fatalf("importContactChunkWithInvoker() error = %v", err)
			}

			if !reflect.DeepEqual(calls, tt.wantCalls) {
				t.Fatalf("tool calls = %#v, want %#v", calls, tt.wantCalls)
			}
			if summary.Created != tt.wantCreated || summary.Enriched != tt.wantEnriched || summary.Skipped != 0 || summary.Failed != 0 {
				t.Fatalf("unexpected summary counts: %+v", summary)
			}
		})
	}
}

func TestImportContactChunkDoesNotCountRejectedWrites(t *testing.T) {
	tests := []struct {
		name        string
		row         contactRow
		failureTool string
	}{
		{
			name:        "rejected create",
			row:         contactRow{Name: "Create Failure", Email: "create@example.com"},
			failureTool: "create_contact",
		},
		{
			name:        "rejected enrich",
			row:         contactRow{Name: "Enrich Failure", Email: "enrich@example.com", Title: "CEO"},
			failureTool: "enrich_contact",
		},
		{
			name: "rejected identity upsert",
			row: contactRow{
				Name:           "Identity Failure",
				Email:          "identity@example.com",
				Platform:       "x",
				PlatformUserID: "identity-failure",
			},
			failureTool: "upsert_contact_identity",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			invoke := func(tool string, _ map[string]any) (map[string]any, error) {
				if tool == tt.failureTool {
					return nil, apiErr(fmt.Errorf("%s rejected", tool))
				}
				switch tool {
				case "query_contacts":
					if tt.failureTool == "create_contact" {
						return map[string]any{"contacts": []any{}}, nil
					}
					return map[string]any{
						"contacts": []any{map[string]any{"id": "contact-existing"}},
					}, nil
				case "create_contact":
					return map[string]any{"id": "contact-created"}, nil
				case "enrich_contact", "upsert_contact_identity":
					return map[string]any{}, nil
				default:
					t.Fatalf("unexpected tool call %q", tool)
					return nil, nil
				}
			}

			summary := importContactsSummary{Success: true, Errors: []string{}, Notes: []string{}}
			if err := importContactChunkWithInvoker(
				[]contactRow{tt.row},
				true,
				false,
				&summary,
				invoke,
			); err != nil {
				t.Fatalf("importContactChunkWithInvoker() error = %v", err)
			}

			if summary.Created != 0 || summary.Enriched != 0 || summary.Failed != 1 {
				t.Fatalf("unexpected summary counts: %+v", summary)
			}
			if len(summary.Errors) != 1 || !strings.Contains(summary.Errors[0], tt.failureTool) {
				t.Fatalf("summary errors = %#v", summary.Errors)
			}
		})
	}
}

func TestImportContactChunkSkipsAmbiguousEmailWithoutMutations(t *testing.T) {
	var calls []string
	var queryInput map[string]any
	invoke := func(tool string, input map[string]any) (map[string]any, error) {
		calls = append(calls, tool)
		if tool != "query_contacts" {
			t.Fatalf("unexpected mutation tool call %q", tool)
		}
		queryInput = input
		return map[string]any{"contacts": []any{
			map[string]any{"id": "contact-z"},
			map[string]any{"id": "contact-a"},
			map[string]any{"id": "contact-z"},
		}}, nil
	}

	summary := importContactsSummary{Success: true, Errors: []string{}, Notes: []string{}}
	err := importContactChunkWithInvoker([]contactRow{{
		Name:           "Shared Email",
		Email:          " Shared@Example.COM ",
		Title:          "CEO",
		Platform:       "x",
		PlatformUserID: "shared-handle",
	}}, true, false, &summary, invoke)
	if err != nil {
		t.Fatalf("importContactChunkWithInvoker() error = %v", err)
	}

	if !reflect.DeepEqual(calls, []string{"query_contacts"}) {
		t.Fatalf("tool calls = %#v, want query_contacts only", calls)
	}
	if got := queryInput["email"]; got != "shared@example.com" {
		t.Fatalf("query email = %#v, want normalized email", got)
	}
	if summary.Created != 0 || summary.Enriched != 0 || summary.Failed != 0 || summary.Skipped != 1 {
		t.Fatalf("unexpected summary counts: %+v", summary)
	}
	if !summary.Success {
		t.Fatal("ambiguous skip must keep the summary successful")
	}
	wantNotes := []string{
		"Shared Email: email shared@example.com matches multiple contacts; candidate contact IDs: contact-a, contact-z; merge or disambiguate them before importing this row",
	}
	if !reflect.DeepEqual(summary.Notes, wantNotes) {
		t.Fatalf("notes = %#v, want %#v", summary.Notes, wantNotes)
	}
}
