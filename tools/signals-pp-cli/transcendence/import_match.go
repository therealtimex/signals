package cli

import (
	"fmt"
	"strings"

	"github.com/spf13/cobra"

	"signals-pp-cli/internal/client"
)

// Row classification for import dedupe, `import contacts --dry-run` and `reconcile` (#568).
//
// Every identity on a row is checked, not just the primary one: a row whose primary identity
// is unknown but whose secondary identity is already claimed belongs to that claimant. The
// claim check is the server's own (`resolve_platform_claim`, the same resolution
// `upsert_contact_identity` enforces), so the CLI and the write guard always agree on what
// "claimed" means. All three commands decide through classifyContactRow and plannedRowAction,
// so a dry run reports exactly what a real run does.

const (
	rowOutcomeNew      = "new"
	rowOutcomeMatch    = "match"
	rowOutcomeConflict = "conflict"
	// rowOutcomeUnchecked is a row imported without --dedupe: no lookup ran.
	rowOutcomeUnchecked = "unchecked"

	rowActionCreate = "create"
	rowActionUpdate = "update"
	rowActionSkip   = "skip"
	rowActionFailed = "failed"
)

// readOnlyImportTools are the lookups dedupe makes. They run against Signals even under
// --dry-run (they change nothing), which is what lets a dry run classify rows at all.
var readOnlyImportTools = map[string]struct{}{
	"query_contacts":         {},
	"resolve_platform_claim": {},
	"query_niches":           {},
}

// rowIdentity is one platform identity on an import row.
type rowIdentity struct {
	Platform       string
	PlatformUserID string
	PlatformHandle string
	ProfileURL     string
	// Provenance of this identity; for the primary it lives on contactRow.Provenance.
	Provenance *identityProvenance
	// primary is set by contactRow.identities for the row's own platform columns.
	primary bool
}

// claimKey is the account key resolve_platform_claim and create_contact use: the platform
// user ID, else the handle, without a leading "@".
func (id rowIdentity) claimKey() string {
	key := id.PlatformUserID
	if key == "" {
		key = id.PlatformHandle
	}
	return strings.TrimPrefix(strings.TrimSpace(key), "@")
}

// identities returns every platform identity on the row, primary first, without repeats.
// The primary comes from platform / platform_user_id / platform_handle (or identities[0]);
// SecondaryIdentities holds the rest of `identities[]` (#567).
func (row contactRow) identities() []rowIdentity {
	all := make([]rowIdentity, 0, 1+len(row.SecondaryIdentities))
	if row.Platform != "" {
		all = append(all, rowIdentity{
			Platform:       row.Platform,
			PlatformUserID: row.PlatformUserID,
			PlatformHandle: row.PlatformHandle,
			primary:        true,
		})
	}
	for _, identity := range row.SecondaryIdentities {
		identity.primary = false
		all = append(all, identity)
	}

	out := make([]rowIdentity, 0, len(all))
	seen := map[string]struct{}{}
	for _, identity := range all {
		key := identity.claimKey()
		if identity.Platform == "" || key == "" {
			continue
		}
		dedupeKey := strings.ToLower(identity.Platform) + "\x00" + key
		if _, exists := seen[dedupeKey]; exists {
			continue
		}
		seen[dedupeKey] = struct{}{}
		out = append(out, identity)
	}
	return out
}

// identityClaim is one row identity that an existing owner already holds.
type identityClaim struct {
	Platform       string `json:"platform"`
	PlatformUserID string `json:"platformUserId"`
	Primary        bool   `json:"primary"`
	ClaimantKind   string `json:"claimantKind"`
	ContactID      string `json:"contactId,omitempty"`
	OrgID          string `json:"orgId,omitempty"`
	Archived       bool   `json:"archived,omitempty"`
}

// rowMatch is the classification of one row against existing contacts.
type rowMatch struct {
	Outcome      string
	ContactID    string
	Archived     bool
	Claims       []identityClaim
	EmailMatches []string
	Reason       string
}

// rowReport is the per-row line of `import contacts --dedupe` (real and dry run) and
// `reconcile` output.
type rowReport struct {
	Row          int             `json:"row"`
	Key          string          `json:"key,omitempty"`
	Name         string          `json:"name"`
	Outcome      string          `json:"outcome"`
	Action       string          `json:"action"`
	ContactID    string          `json:"contactId,omitempty"`
	MatchedBy    []identityClaim `json:"matchedBy,omitempty"`
	EmailMatches []string        `json:"emailMatches,omitempty"`
	Reason       string          `json:"reason,omitempty"`
	Error        string          `json:"error,omitempty"`
	// RejectedIdentities are identities dropped before dedupe because their values fail the
	// server's checks (#569).
	RejectedIdentities []identityViolation `json:"rejectedIdentities,omitempty"`
}

func newRowReport(index int, row contactRow, match rowMatch, action string) rowReport {
	return rowReport{
		Row:                index,
		Key:                row.Key,
		Name:               row.Name,
		Outcome:            match.Outcome,
		Action:             action,
		ContactID:          match.ContactID,
		MatchedBy:          match.Claims,
		EmailMatches:       match.EmailMatches,
		Reason:             match.Reason,
		RejectedIdentities: row.RejectedIdentities,
	}
}

// plannedRowAction is what import does with a classified row. A match on an archived contact
// is skipped (enriching a hidden contact would be invisible, and un-archiving would undo a
// deliberate user action); a conflict is always skipped and never created.
func plannedRowAction(match rowMatch) string {
	switch match.Outcome {
	case rowOutcomeNew:
		return rowActionCreate
	case rowOutcomeMatch:
		if match.Archived {
			return rowActionSkip
		}
		return rowActionUpdate
	default:
		return rowActionSkip
	}
}

// classifyContactRow looks the row up by email and by every identity, then classifies it:
//
//   - new: nothing matches.
//   - match: exactly one existing contact matches, and every claimed identity and the email
//     agree on it.
//   - conflict: the matches point at two or more contacts (identities claimed by different
//     contacts, or an identity and the email disagreeing), the email alone matches several
//     contacts, or an org holds one of the row's accounts.
func classifyContactRow(row contactRow, invoke agentToolInvoker) (rowMatch, error) {
	match := rowMatch{}
	email := normalizeEmail(row.Email)
	if email != "" {
		// Exact normalized match, server-side. Trust the filter rather than re-checking
		// payload fields the server may not send (#207).
		result, err := invoke("query_contacts", map[string]any{
			"email":    email,
			"pageSize": 20,
		})
		if err != nil {
			return rowMatch{}, err
		}
		candidateIDs, err := distinctContactIDs(result)
		if err != nil {
			return rowMatch{}, err
		}
		match.EmailMatches = candidateIDs
		if len(candidateIDs) > 1 {
			match.Outcome = rowOutcomeConflict
			match.Reason = fmt.Sprintf(
				"email %s matches multiple contacts; candidate contact IDs: %s; merge or disambiguate them before importing this row",
				email, strings.Join(candidateIDs, ", "),
			)
			return match, nil
		}
	}

	for _, identity := range row.identities() {
		// platformUserId is an exact identity-claim filter: free-text search does not cover
		// contact_identities (#202), and resolve_platform_claim cannot disagree with the
		// upsert_contact_identity guard the way a query_contacts reconstruction could (#206).
		result, err := invoke("resolve_platform_claim", map[string]any{
			"platform":       identity.Platform,
			"platformUserId": identity.claimKey(),
		})
		if err != nil {
			return rowMatch{}, err
		}
		claimant, err := platformClaimMatch(result)
		if err != nil {
			return rowMatch{}, err
		}
		if !claimant.matched() {
			continue
		}
		claim := identityClaim{
			Platform:       identity.Platform,
			PlatformUserID: identity.claimKey(),
			Primary:        identity.primary,
			ContactID:      claimant.ID,
			OrgID:          claimant.OrgID,
			Archived:       claimant.Archived,
		}
		if claimant.OrgID != "" {
			claim.ClaimantKind = "org"
		} else {
			claim.ClaimantKind = "contact"
		}
		match.Claims = append(match.Claims, claim)
	}

	owners := map[string]bool{} // contact ID → archived
	orgs := map[string]struct{}{}
	for _, claim := range match.Claims {
		if claim.OrgID != "" {
			orgs[claim.OrgID] = struct{}{}
			continue
		}
		owners[claim.ContactID] = owners[claim.ContactID] || claim.Archived
	}
	if len(match.EmailMatches) == 1 {
		if _, exists := owners[match.EmailMatches[0]]; !exists {
			owners[match.EmailMatches[0]] = false
		}
	}

	switch {
	case len(owners) == 0 && len(orgs) == 0:
		match.Outcome = rowOutcomeNew
	case len(orgs) > 0 && len(owners) == 0 && len(orgs) == 1:
		match.Outcome = rowOutcomeConflict
		claim := firstClaim(match.Claims, func(c identityClaim) bool { return c.OrgID != "" })
		match.Reason = fmt.Sprintf(
			"%s/%s is already claimed by org %s; reassign the account before importing this row",
			claim.Platform, claim.PlatformUserID, claim.OrgID,
		)
	case len(owners)+len(orgs) > 1:
		match.Outcome = rowOutcomeConflict
		match.Reason = describeConflict(match, email) +
			"; merge or disambiguate these records before importing this row"
	default:
		match.Outcome = rowOutcomeMatch
		for id, archived := range owners {
			match.ContactID = id
			match.Archived = archived
		}
		if match.Archived {
			claim := firstClaim(match.Claims, func(c identityClaim) bool { return c.ContactID == match.ContactID })
			match.Reason = fmt.Sprintf(
				"%s/%s is already claimed by archived contact %s; restore it to import this row",
				claim.Platform, claim.PlatformUserID, match.ContactID,
			)
		}
	}
	return match, nil
}

func firstClaim(claims []identityClaim, keep func(identityClaim) bool) identityClaim {
	for _, claim := range claims {
		if keep(claim) {
			return claim
		}
	}
	return identityClaim{}
}

// describeConflict names every match, e.g.
// "matches disagree: linkedin/jane → contact A; x/jane_x → contact B; email jane@x.com → contact C".
func describeConflict(match rowMatch, email string) string {
	parts := make([]string, 0, len(match.Claims)+1)
	for _, claim := range match.Claims {
		owner := "contact " + claim.ContactID
		if claim.OrgID != "" {
			owner = "org " + claim.OrgID
		} else if claim.Archived {
			owner = "archived contact " + claim.ContactID
		}
		parts = append(parts, fmt.Sprintf("%s/%s → %s", claim.Platform, claim.PlatformUserID, owner))
	}
	if len(match.EmailMatches) == 1 {
		parts = append(parts, fmt.Sprintf("email %s → contact %s", email, match.EmailMatches[0]))
	}
	return "matches disagree: " + strings.Join(parts, "; ")
}

// dryRunPlan stands in for the writes a dry run or reconcile does not make. A real run
// classifies each row against data that already holds the rows before it: a contact it just
// created, an identity it just attached. Without the plan, a later row repeating an earlier
// row's identity or email would preview as `new` while the real run matches it. Lookups through
// plan.invoker see those planned writes, and a contact the file will create is named
// "row:<n>", the row that creates it.
type dryRunPlan struct {
	claims map[string]string // platform + "\x00" + claim key → owner
	emails map[string]string // normalized email → owner
}

func newDryRunPlan() *dryRunPlan {
	return &dryRunPlan{claims: map[string]string{}, emails: map[string]string{}}
}

func plannedRowOwner(index int) string {
	return fmt.Sprintf("row:%d", index)
}

func plannedClaimKey(platform, key string) string {
	return platform + "\x00" + key
}

// record notes what a real run writes for the row: create_contact stores the row's email and
// primary identity on a new contact, and every further identity is then attached to it; an
// update attaches all of the row's identities to the matched contact (enrich_contact does not
// add the email).
func (p *dryRunPlan) record(index int, row contactRow, match rowMatch, action string) {
	var owner string
	switch action {
	case rowActionCreate:
		owner = plannedRowOwner(index)
		if email := normalizeEmail(row.Email); email != "" {
			if _, exists := p.emails[email]; !exists {
				p.emails[email] = owner
			}
		}
	case rowActionUpdate:
		owner = match.ContactID
	default:
		return
	}
	for _, identity := range row.identities() {
		key := plannedClaimKey(identity.Platform, identity.claimKey())
		if _, exists := p.claims[key]; !exists {
			p.claims[key] = owner
		}
	}
}

// invoker answers lookups as if the planned writes had happened: an unclaimed account the plan
// assigns reads as claimed by its planned owner, and a planned email joins query_contacts.
func (p *dryRunPlan) invoker(next agentToolInvoker) agentToolInvoker {
	return func(tool string, input map[string]any) (map[string]any, error) {
		result, err := next(tool, input)
		if err != nil {
			return result, err
		}
		switch tool {
		case "resolve_platform_claim":
			platform, _ := input["platform"].(string)
			key, _ := input["platformUserId"].(string)
			owner, planned := p.claims[plannedClaimKey(platform, key)]
			if claimed, _ := result["claimed"].(bool); planned && !claimed {
				return map[string]any{
					"claimed": true,
					"claimant": map[string]any{
						"kind": "contact", "contactId": owner, "identityId": "planned", "archived": false,
					},
				}, nil
			}
		case "query_contacts":
			email, _ := input["email"].(string)
			owner, planned := p.emails[normalizeEmail(email)]
			contacts, ok := result["contacts"].([]any)
			if planned && ok {
				merged := append(append([]any{}, contacts...), map[string]any{"id": owner})
				out := map[string]any{}
				for k, v := range result {
					out[k] = v
				}
				out["contacts"] = merged
				return out, nil
			}
		}
		return result, nil
	}
}

// newImportInvoker routes dedupe lookups to a client that never short-circuits, and every
// other call to c, which honours --dry-run. A dry run therefore classifies rows against real
// data while still writing nothing.
func newImportInvoker(cmd *cobra.Command, flags *rootFlags, c *client.Client) (agentToolInvoker, error) {
	readClient, err := flags.newClient()
	if err != nil {
		return nil, err
	}
	readClient.DryRun = false
	return func(tool string, input map[string]any) (map[string]any, error) {
		if _, readOnly := readOnlyImportTools[tool]; readOnly {
			return invokeAgentTool(cmd, readClient, flags, tool, input)
		}
		return invokeAgentTool(cmd, c, flags, tool, input)
	}, nil
}
