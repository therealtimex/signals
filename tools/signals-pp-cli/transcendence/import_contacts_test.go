package cli

import (
	"os"
	"path/filepath"
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
