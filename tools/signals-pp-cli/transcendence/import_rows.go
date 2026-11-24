package cli

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
	"unicode/utf8"
)

// Multi-identity and profile fields on import rows (#567).
//
// JSON rows carry them natively:
//
//	{"key": "luma-123", "name": "...", "bio": "...", "headline": "...", "website": "...",
//	 "location": "...", "tags": ["hackwithbay-4"],
//	 "identities": [{"platform": "x", "handle": "@trung_rta", "url": "...",
//	                 "provenance": {"kind": "self_declared", "sourceUrl": "..."}}]}
//
// CSV cells hold the same arrays as JSON text (JSON-in-cell): `identities` is a JSON array of
// those objects, and `tags` is a JSON array or, for hand-written sheets, a `;`-separated list.
// Repeated columns (identity_1_platform, identity_1_handle, ...) were the alternative, but they
// need a numbering scheme, cap the count at whatever the header declares, and cannot carry the
// nested provenance object; JSON-in-cell round-trips exactly the JSON row shape instead.
//
// How the identities combine: the legacy platform / platform_user_id / platform_handle columns
// are the row's primary identity and identities[] adds to it. A row with no legacy platform
// promotes identities[0] to primary. The flat provenance_* columns always describe the primary.

const (
	maxRowIdentities = 20
	maxRowTags       = 50
	maxRowTagLength  = 100
)

// readRowKey reads the row's optional `key`, a string or a whole number.
func readRowKey(item map[string]any) (string, error) {
	switch v := item["key"].(type) {
	case nil:
		return "", nil
	case string:
		return strings.TrimSpace(v), nil
	case float64:
		if v != math.Trunc(v) || math.IsInf(v, 0) {
			return "", usageErr(fmt.Errorf("row key %v must be a string or a whole number", v))
		}
		return strconv.FormatFloat(v, 'f', -1, 64), nil
	default:
		return "", usageErr(fmt.Errorf("row key must be a string or a whole number"))
	}
}

// readRowTags reads `tags` as a JSON array, a JSON-array string (CSV) or a `;`-separated
// string. Tags are trimmed, deduped in order, and bounded.
func readRowTags(item map[string]any) ([]string, error) {
	var raw []any
	switch v := item["tags"].(type) {
	case nil:
		return nil, nil
	case []any:
		raw = v
	case string:
		text := strings.TrimSpace(v)
		if text == "" {
			return nil, nil
		}
		if strings.HasPrefix(text, "[") {
			if err := json.Unmarshal([]byte(text), &raw); err != nil {
				return nil, usageErr(fmt.Errorf("tags cell is not a JSON array: %v", err))
			}
		} else {
			for _, part := range strings.Split(text, ";") {
				raw = append(raw, part)
			}
		}
	default:
		return nil, usageErr(fmt.Errorf("tags must be an array of strings"))
	}

	tags := make([]string, 0, len(raw))
	seen := map[string]struct{}{}
	for _, entry := range raw {
		tag, ok := entry.(string)
		if !ok {
			return nil, usageErr(fmt.Errorf("tags must be an array of strings"))
		}
		tag = strings.TrimSpace(tag)
		if tag == "" {
			continue
		}
		if utf8.RuneCountInString(tag) > maxRowTagLength {
			return nil, usageErr(fmt.Errorf("tag %q is longer than %d characters", tag, maxRowTagLength))
		}
		if _, exists := seen[tag]; exists {
			continue
		}
		seen[tag] = struct{}{}
		tags = append(tags, tag)
	}
	if len(tags) > maxRowTags {
		return nil, usageErr(fmt.Errorf("a row has at most %d tags (got %d)", maxRowTags, len(tags)))
	}
	return tags, nil
}

// readRowIdentities reads `identities` as a JSON array or a JSON-array string (CSV).
func readRowIdentities(item map[string]any) ([]rowIdentity, error) {
	var raw []any
	switch v := item["identities"].(type) {
	case nil:
		return nil, nil
	case []any:
		raw = v
	case string:
		text := strings.TrimSpace(v)
		if text == "" {
			return nil, nil
		}
		if err := json.Unmarshal([]byte(text), &raw); err != nil {
			return nil, usageErr(fmt.Errorf("identities cell is not a JSON array: %v", err))
		}
	default:
		return nil, usageErr(fmt.Errorf("identities must be an array of objects"))
	}
	if len(raw) > maxRowIdentities {
		return nil, usageErr(fmt.Errorf("a row has at most %d identities (got %d)", maxRowIdentities, len(raw)))
	}

	identities := make([]rowIdentity, 0, len(raw))
	for index, entry := range raw {
		object, ok := entry.(map[string]any)
		if !ok {
			return nil, usageErr(fmt.Errorf("identities[%d] must be an object", index))
		}
		get := func(keys ...string) string {
			for _, key := range keys {
				if s, ok := object[key].(string); ok {
					return strings.TrimSpace(s)
				}
			}
			return ""
		}
		identity := rowIdentity{
			Platform:       strings.ToLower(get("platform")),
			PlatformUserID: get("platformUserId", "platform_user_id"),
			PlatformHandle: get("handle", "platformHandle", "platform_handle"),
			ProfileURL:     get("url", "profileUrl", "profile_url"),
		}
		if identity.Platform == "" {
			return nil, usageErr(fmt.Errorf("identities[%d] requires platform", index))
		}
		if identity.claimKey() == "" {
			return nil, usageErr(fmt.Errorf("identities[%d] (%s) requires platformUserId or handle", index, identity.Platform))
		}
		provenance, err := mapRowProvenance(map[string]any{"provenance": object["provenance"]}, func(...string) string { return "" })
		if err != nil {
			return nil, fmt.Errorf("identities[%d]: %w", index, err)
		}
		identity.Provenance = provenance
		identities = append(identities, identity)
	}
	return identities, nil
}

// applyRowIdentities combines identities[] with the legacy primary-identity columns.
func applyRowIdentities(row *contactRow, identities []rowIdentity) error {
	if len(identities) == 0 {
		return nil
	}
	if row.Platform == "" {
		primary := identities[0]
		identities = identities[1:]
		row.Platform = primary.Platform
		row.PlatformUserID = primary.PlatformUserID
		row.PlatformHandle = primary.PlatformHandle
		if row.ProfileURL == "" {
			row.ProfileURL = primary.ProfileURL
		}
		if primary.Provenance != nil {
			if row.Provenance != nil {
				return usageErr(fmt.Errorf(
					"row %q gives provenance twice: provenance_* columns and identities[0].provenance describe the same primary identity",
					row.Name,
				))
			}
			row.Provenance = primary.Provenance
		}
	}
	row.SecondaryIdentities = append(row.SecondaryIdentities, identities...)
	return nil
}

// assignRowKeys gives every row its rowKey (its own `key`, else its 1-based row number) and
// rejects duplicates, since the result's mapping is keyed by it.
func assignRowKeys(rows []contactRow) error {
	seen := make(map[string]int, len(rows))
	for index := range rows {
		key := rows[index].Key
		if key == "" {
			key = strconv.Itoa(index + 1)
		}
		if first, exists := seen[key]; exists {
			return usageErr(fmt.Errorf("rows %d and %d share row key %q; keys must be unique", first, index+1, key))
		}
		seen[key] = index + 1
		rows[index].RowKey = key
	}
	return nil
}
