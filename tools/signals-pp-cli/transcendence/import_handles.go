package cli

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

// Per-platform checks on a row's account values (#569). This mirrors
// src/lib/identity-handle-validation.ts, which upsert_contact_identity and create_contact
// enforce. The shared cases in handle_cases_test.go run against both implementations, so a
// row the CLI accepts is never rejected by the server, and the reverse.
//
// Hard rules (foreign_url, syntax) reject what is provably wrong. Heuristic rules (too_short,
// placeholder) reject what is almost always junk, and --allow-unusual-handles skips them.

var identityPlatformHosts = map[string][]string{
	"x":         {"x.com", "twitter.com"},
	"linkedin":  {"linkedin.com", "lnkd.in"},
	"gmail":     {"mail.google.com"},
	"substack":  {"substack.com"},
	"instagram": {"instagram.com", "instagr.am"},
	"facebook":  {"facebook.com", "fb.com", "fb.me"},
	"threads":   {"threads.net", "threads.com"},
	"tiktok":    {"tiktok.com"},
	"youtube":   {"youtube.com", "youtu.be"},
	"bluesky":   {"bsky.app"},
	"telegram":  {"t.me", "telegram.me"},
	"whatsapp":  {"wa.me", "whatsapp.com"},
}

type handleSyntax struct {
	handle    *regexp.Regexp
	numericID *regexp.Regexp
	rule      string
}

var strictHandleSyntax = map[string]handleSyntax{
	"x": {
		handle:    regexp.MustCompile(`^[A-Za-z0-9_]{1,15}$`),
		numericID: regexp.MustCompile(`^[0-9]{1,20}$`),
		rule:      "X handles are 1–15 letters, digits or underscores (or a numeric account ID)",
	},
	"instagram": {
		handle: regexp.MustCompile(`^[A-Za-z0-9._]{1,30}$`),
		rule:   "Instagram usernames are 1–30 letters, digits, periods or underscores",
	},
	"threads": {
		handle: regexp.MustCompile(`^[A-Za-z0-9._]{1,30}$`),
		rule:   "Threads usernames are 1–30 letters, digits, periods or underscores",
	},
	"tiktok": {
		handle:    regexp.MustCompile(`^[A-Za-z0-9._]{1,24}$`),
		numericID: regexp.MustCompile(`^[0-9]{1,20}$`),
		rule:      "TikTok usernames are 1–24 letters, digits, periods or underscores (or a numeric account ID)",
	},
}

const shortHandleMaxLength = 2

var placeholderHandles = []string{
	"none", "null", "nil", "n/a", "nope", "unknown",
	"notwitter", "nolinkedin", "noinstagram",
	"twitter", "linkedin", "instagram", "facebook",
}

var platformLabels = map[string]string{
	"x": "X", "linkedin": "LinkedIn", "gmail": "Gmail", "substack": "Substack",
	"instagram": "Instagram", "facebook": "Facebook", "threads": "Threads", "tiktok": "TikTok",
	"youtube": "YouTube", "bluesky": "Bluesky", "telegram": "Telegram", "whatsapp": "WhatsApp",
}

var (
	urlShape   = regexp.MustCompile(`(?i)^(?:([a-z][a-z0-9+.-]*)://)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?::[0-9]+)?([/?#].*)?$`)
	allDigits  = regexp.MustCompile(`^[0-9]+$`)
	pathSplit  = regexp.MustCompile(`[/?#]`)
	leadingAts = regexp.MustCompile(`^@+`)
)

// identityViolation is one rejected value, as the row report shows it.
type identityViolation struct {
	Platform  string `json:"platform"`
	Field     string `json:"field"`
	Value     string `json:"value"`
	Rule      string `json:"rule"`
	Heuristic bool   `json:"heuristic,omitempty"`
	Message   string `json:"message"`
}

func platformLabel(platform string) string {
	if label, ok := platformLabels[platform]; ok {
		return label
	}
	return platform
}

func hostPlatform(host string) string {
	for platform, hosts := range identityPlatformHosts {
		for _, candidate := range hosts {
			if host == candidate || strings.HasSuffix(host, "."+candidate) {
				return platform
			}
		}
	}
	return ""
}

func jsonQuote(value string) string {
	encoded, _ := json.Marshal(value)
	return string(encoded)
}

// checkIdentityValue returns nil when the value passes. Empty values pass.
func checkIdentityValue(platform, field, raw string, allowUnusual bool) *identityViolation {
	value := leadingAts.ReplaceAllString(strings.TrimSpace(raw), "")
	if value == "" {
		return nil
	}
	label := platformLabel(platform)
	violation := func(rule string, heuristic bool, why string) *identityViolation {
		message := fmt.Sprintf("%s %s %s was rejected (rule: %s): %s", label, field, jsonQuote(raw), rule, why)
		if heuristic {
			message += ". If this really is the account, retry with allowUnusualHandle: true."
		} else {
			message += "."
		}
		return &identityViolation{Platform: platform, Field: field, Value: raw, Rule: rule, Heuristic: heuristic, Message: message}
	}

	var urlHost, urlPath, urlPlatform string
	if match := urlShape.FindStringSubmatch(value); match != nil && (match[1] != "" || match[3] != "") {
		urlHost, urlPath = strings.ToLower(match[2]), match[3]
		urlPlatform = hostPlatform(urlHost)
	}
	if urlPlatform != "" && urlPlatform != platform {
		other := platformLabel(urlPlatform)
		return violation("foreign_url", false, fmt.Sprintf("it is a %s URL, not an account on %s; put it on a %s identity", other, label, other))
	}
	if field == "platformUrl" {
		return nil
	}

	if syntax, strict := strictHandleSyntax[platform]; strict {
		valid := syntax.handle.MatchString(value) ||
			(field == "platformUserId" && syntax.numericID != nil && syntax.numericID.MatchString(value))
		if !valid {
			hint := ""
			if urlHost != "" && urlPlatform == platform {
				for _, part := range pathSplit.Split(urlPath, -1) {
					if part == "" {
						continue
					}
					segment := leadingAts.ReplaceAllString(part, "")
					if syntax.handle.MatchString(segment) {
						hint = fmt.Sprintf("; pass the bare handle %s, not the profile URL", jsonQuote(segment))
					}
					break
				}
			}
			return violation("syntax", false, syntax.rule+hint)
		}
	}

	if allowUnusual {
		return nil
	}
	if utf8.RuneCountInString(value) <= shortHandleMaxLength && !allDigits.MatchString(value) {
		return violation("too_short", true, fmt.Sprintf("%d characters or fewer is almost always a placeholder or a fragment of a pasted URL", shortHandleMaxLength))
	}
	lower := strings.ToLower(value)
	for _, placeholder := range placeholderHandles {
		if lower == placeholder {
			return violation("placeholder", true, "it reads as a placeholder, not an account")
		}
	}
	return nil
}

// checkRowIdentity checks one identity's values in the order the server does.
func checkRowIdentity(identity rowIdentity, allowUnusual bool) *identityViolation {
	if identity.PlatformUserID != "" {
		if v := checkIdentityValue(identity.Platform, "platformUserId", identity.PlatformUserID, allowUnusual); v != nil {
			return v
		}
	} else if identity.PlatformHandle != "" {
		// A handle-only identity is written with the handle as its platformUserId.
		if v := checkIdentityValue(identity.Platform, "platformUserId", identity.claimKey(), allowUnusual); v != nil {
			v.Field = "platformHandle"
			v.Value = identity.PlatformHandle
			return v
		}
	}
	if identity.PlatformHandle != "" {
		if v := checkIdentityValue(identity.Platform, "platformHandle", identity.PlatformHandle, allowUnusual); v != nil {
			return v
		}
	}
	if identity.ProfileURL != "" && !isLikelyAvatarURL(identity.ProfileURL) {
		if v := checkIdentityValue(identity.Platform, "platformUrl", identity.ProfileURL, allowUnusual); v != nil {
			return v
		}
	}
	return nil
}

// dropInvalidRowIdentities removes the identities whose values the server would reject, so a
// junk handle costs the row that identity and nothing else:
//
//   - A rejected secondary identity is dropped. The row's other identities and fields are
//     imported as usual.
//   - A rejected primary identity is dropped together with its provenance, and the first valid
//     secondary is promoted in its place, the way identities[0] is promoted when a row has no
//     legacy platform columns. With none left, the row is matched and written by email and name
//     alone.
//
// Dropping happens before dedupe, so a junk value can't match or conflict with a contact that
// already holds the same junk. Snowball evidence identities aren't checked: the server derives
// those accounts from browser evidence. Each drop is listed on the row's rejectedIdentities.
func dropInvalidRowIdentities(rows []contactRow, allowUnusual bool) {
	for index := range rows {
		row := &rows[index]
		row.AllowUnusualHandle = allowUnusual
		if row.Platform != "" && row.IdentityEvidenceToken == "" {
			primary := rowIdentity{
				Platform:       row.Platform,
				PlatformUserID: row.PlatformUserID,
				PlatformHandle: row.PlatformHandle,
				ProfileURL:     row.ProfileURL,
			}
			if v := checkRowIdentity(primary, allowUnusual); v != nil {
				row.RejectedIdentities = append(row.RejectedIdentities, *v)
				row.Platform, row.PlatformUserID, row.PlatformHandle, row.ProfileURL = "", "", "", ""
				row.Provenance = nil
			}
		}
		kept := row.SecondaryIdentities[:0]
		for _, identity := range row.SecondaryIdentities {
			if v := checkRowIdentity(identity, allowUnusual); v != nil {
				row.RejectedIdentities = append(row.RejectedIdentities, *v)
				continue
			}
			kept = append(kept, identity)
		}
		row.SecondaryIdentities = kept
		if row.Platform == "" && row.IdentityEvidenceToken == "" && len(row.SecondaryIdentities) > 0 {
			promoted := row.SecondaryIdentities[0]
			row.SecondaryIdentities = row.SecondaryIdentities[1:]
			row.Platform = promoted.Platform
			row.PlatformUserID = promoted.PlatformUserID
			row.PlatformHandle = promoted.PlatformHandle
			row.ProfileURL = promoted.ProfileURL
			row.Provenance = promoted.Provenance
		}
		if len(row.SecondaryIdentities) == 0 {
			row.SecondaryIdentities = nil
		}
	}
}

// rejectedIdentityNote is the summary note for one dropped identity.
func rejectedIdentityNote(row contactRow, v identityViolation) string {
	return fmt.Sprintf("%s: dropped %s identity %s (rule: %s); the row continues without it", row.Name, v.Platform, jsonQuote(v.Value), v.Rule)
}
