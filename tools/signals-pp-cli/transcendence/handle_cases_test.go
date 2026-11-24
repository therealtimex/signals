package cli

import (
	"encoding/json"
	"testing"
)

// sharedHandleCases is the contract between this package's checkIdentityValue and the server's
// src/lib/identity-handle-validation.ts (#569). identity-handle-validation.test.ts reads the
// JSON between the markers below and runs every case against the server module, so editing
// a case or a rule on one side alone fails a test. rule "" means accepted.
//
// BEGIN SHARED HANDLE CASES
const sharedHandleCases = `[
  {"platform": "x", "field": "platformUserId", "value": "in", "rule": "too_short"},
  {"platform": "x", "field": "platformUserId", "value": "x", "rule": "too_short"},
  {"platform": "x", "field": "platformUserId", "value": "i", "rule": "too_short"},
  {"platform": "x", "field": "platformUserId", "value": "hi", "rule": "too_short"},
  {"platform": "x", "field": "platformUserId", "value": "v", "rule": "too_short"},
  {"platform": "x", "field": "platformHandle", "value": "@v", "rule": "too_short"},
  {"platform": "x", "field": "platformUserId", "value": "notwitter", "rule": "placeholder"},
  {"platform": "x", "field": "platformHandle", "value": " NoTwitter ", "rule": "placeholder"},
  {"platform": "x", "field": "platformUserId", "value": "none", "rule": "placeholder"},
  {"platform": "x", "field": "platformHandle", "value": "linkedin.com/in/trung-le-rta", "rule": "foreign_url"},
  {"platform": "x", "field": "platformUserId", "value": "https://www.linkedin.com/in/trung-le-rta/", "rule": "foreign_url"},
  {"platform": "x", "field": "platformUrl", "value": "https://linkedin.com/in/trung-le-rta", "rule": "foreign_url"},
  {"platform": "x", "field": "platformUserId", "value": "instagram.com/trung.le", "rule": "foreign_url"},
  {"platform": "x", "field": "platformUserId", "value": "n/a", "rule": "syntax"},
  {"platform": "x", "field": "platformUserId", "value": "-", "rule": "syntax"},
  {"platform": "x", "field": "platformUserId", "value": "trung rta", "rule": "syntax"},
  {"platform": "x", "field": "platformUserId", "value": "https://x.com/trung_rta", "rule": "syntax"},
  {"platform": "x", "field": "platformHandle", "value": "twitter.com/trung_rta", "rule": "syntax"},
  {"platform": "x", "field": "platformUserId", "value": "a_handle_too_long", "rule": "syntax"},
  {"platform": "x", "field": "platformHandle", "value": "1234567890123456", "rule": "syntax"},

  {"platform": "x", "field": "platformUserId", "value": "x", "allowUnusualHandle": true, "rule": ""},
  {"platform": "x", "field": "platformUserId", "value": "hi", "allowUnusualHandle": true, "rule": ""},
  {"platform": "x", "field": "platformUserId", "value": "notwitter", "allowUnusualHandle": true, "rule": ""},
  {"platform": "x", "field": "platformUserId", "value": "linkedin.com/in/trung", "allowUnusualHandle": true, "rule": "foreign_url"},
  {"platform": "x", "field": "platformUserId", "value": "n/a", "allowUnusualHandle": true, "rule": "syntax"},

  {"platform": "x", "field": "platformUserId", "value": "trung_rta", "rule": ""},
  {"platform": "x", "field": "platformHandle", "value": "@trung_rta", "rule": ""},
  {"platform": "x", "field": "platformHandle", "value": " @Trung_RTA ", "rule": ""},
  {"platform": "x", "field": "platformUserId", "value": "jack", "rule": ""},
  {"platform": "x", "field": "platformUserId", "value": "abc", "rule": ""},
  {"platform": "x", "field": "platformUserId", "value": "12", "rule": ""},
  {"platform": "x", "field": "platformUserId", "value": "1234567890123456789", "rule": ""},
  {"platform": "x", "field": "platformUrl", "value": "https://x.com/trung_rta", "rule": ""},
  {"platform": "x", "field": "platformUrl", "value": "https://twitter.com/trung_rta", "rule": ""},
  {"platform": "x", "field": "platformUrl", "value": "https://trung.dev", "rule": ""},

  {"platform": "linkedin", "field": "platformUserId", "value": "trung-le-rta", "rule": ""},
  {"platform": "linkedin", "field": "platformHandle", "value": "https://www.linkedin.com/in/trung-le-rta", "rule": ""},
  {"platform": "linkedin", "field": "platformHandle", "value": "in/trung-le-rta", "rule": ""},
  {"platform": "linkedin", "field": "platformUserId", "value": "ACoAAB1x2y3z", "rule": ""},
  {"platform": "linkedin", "field": "platformUserId", "value": "in", "rule": "too_short"},
  {"platform": "linkedin", "field": "platformUserId", "value": "x.com/trung_rta", "rule": "foreign_url"},
  {"platform": "linkedin", "field": "platformUrl", "value": "https://twitter.com/trung_rta", "rule": "foreign_url"},
  {"platform": "bluesky", "field": "platformUserId", "value": "trungle.bsky.social", "rule": ""},
  {"platform": "bluesky", "field": "platformUrl", "value": "https://bsky.app/profile/trungle.bsky.social", "rule": ""},
  {"platform": "substack", "field": "platformUserId", "value": "trung.substack.com", "rule": ""},
  {"platform": "substack", "field": "platformUserId", "value": "https://newsletter.example.com", "rule": ""},
  {"platform": "gmail", "field": "platformUserId", "value": "trung@gmail.com", "rule": ""},
  {"platform": "gmail", "field": "platformUserId", "value": "none", "rule": "placeholder"},
  {"platform": "instagram", "field": "platformUserId", "value": "trung.le_", "rule": ""},
  {"platform": "instagram", "field": "platformUserId", "value": "trung-le", "rule": "syntax"},
  {"platform": "instagram", "field": "platformHandle", "value": "https://instagram.com/trung.le", "rule": "syntax"},
  {"platform": "threads", "field": "platformHandle", "value": "@trung.le", "rule": ""},
  {"platform": "tiktok", "field": "platformHandle", "value": "@trung.le", "rule": ""},
  {"platform": "tiktok", "field": "platformUserId", "value": "7012345678901234567", "rule": ""},
  {"platform": "youtube", "field": "platformHandle", "value": "@TrungLe", "rule": ""},
  {"platform": "youtube", "field": "platformUserId", "value": "UCabcdefghijklmnopqrstuv", "rule": ""},
  {"platform": "facebook", "field": "platformUserId", "value": "profile.php?id=100000", "rule": ""},
  {"platform": "telegram", "field": "platformUserId", "value": "trungle", "rule": ""},
  {"platform": "whatsapp", "field": "platformUserId", "value": "+1 555 0100", "rule": ""}
]`

// END SHARED HANDLE CASES

type sharedHandleCase struct {
	Platform           string `json:"platform"`
	Field              string `json:"field"`
	Value              string `json:"value"`
	AllowUnusualHandle bool   `json:"allowUnusualHandle"`
	Rule               string `json:"rule"`
}

func TestCheckIdentityValueSharedCases(t *testing.T) {
	var cases []sharedHandleCase
	if err := json.Unmarshal([]byte(sharedHandleCases), &cases); err != nil {
		t.Fatal(err)
	}
	if len(cases) < 50 {
		t.Fatalf("only %d cases parsed", len(cases))
	}
	for _, tc := range cases {
		got := ""
		violation := checkIdentityValue(tc.Platform, tc.Field, tc.Value, tc.AllowUnusualHandle)
		if violation != nil {
			got = violation.Rule
			if violation.Heuristic != (got == "too_short" || got == "placeholder") {
				t.Errorf("%s %s %q: heuristic = %v for rule %s", tc.Platform, tc.Field, tc.Value, violation.Heuristic, got)
			}
		}
		if got != tc.Rule {
			t.Errorf("%s %s %q (allowUnusual=%v): rule %q, want %q", tc.Platform, tc.Field, tc.Value, tc.AllowUnusualHandle, got, tc.Rule)
		}
	}
}
