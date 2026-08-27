package cli

import (
	"os"
	"path/filepath"
	"reflect"
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
		{
			name:   "zero",
			result: map[string]any{"contacts": []any{}},
			want:   []string{},
		},
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
		{
			name: "malformed entries are ignored",
			result: map[string]any{"contacts": []any{
				"not a contact",
				map[string]any{"id": 42},
				map[string]any{"name": "missing id"},
				map[string]any{"id": ""},
				map[string]any{"id": "contact-valid"},
			}},
			want: []string{"contact-valid"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := distinctContactIDs(tt.result); !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("distinctContactIDs() = %#v, want %#v", got, tt.want)
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
		{
			name: "malformed entries do not hide one valid ID",
			queryResult: map[string]any{"contacts": []any{
				"not a contact",
				map[string]any{"id": 42},
				map[string]any{"id": "contact-valid"},
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
