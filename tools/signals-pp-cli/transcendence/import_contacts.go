package cli

import (
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/spf13/cobra"
	"signals-pp-cli/internal/client"
)

const (
	defaultImportBatchSize = 50
	maxImportBatchSize     = 50
	maxImportRows          = 500
)

var contactImportTools = map[string]struct{}{
	"query_contacts":               {},
	"resolve_platform_claim":       {},
	"create_contact":               {},
	"enrich_contact":               {},
	"upsert_contact_identity":      {},
	"record_workflow_run_contacts": {},
}

type contactRow struct {
	Name                  string
	Company               string
	Title                 string
	Email                 string
	Platform              string
	PlatformUserID        string
	PlatformHandle        string
	ProfileURL            string
	AvatarURL             string
	IdentityEvidenceToken string
	Notes                 string
	// Provenance of the row's platform identity (#571). Nil when the row carries none.
	Provenance *identityProvenance
	// SecondaryIdentities are further platform identities on the row. Dedupe checks every one
	// of them (#568). No reader fills this yet; #567's `identities[]` will, and will also
	// decide how they are written.
	SecondaryIdentities []rowIdentity
}

// identityProvenance mirrors the agent-tools `provenance` input: kind is required, sourceUrl
// and observedAt (unix seconds) are optional. The server owns the downgrade rule.
type identityProvenance struct {
	Kind       string
	SourceURL  string
	ObservedAt int64
}

var identityProvenanceKinds = map[string]struct{}{
	"self_declared":  {},
	"agent_verified": {},
	"inferred":       {},
}

func (p *identityProvenance) payload() map[string]any {
	out := map[string]any{"kind": p.Kind}
	if p.SourceURL != "" {
		out["sourceUrl"] = p.SourceURL
	}
	if p.ObservedAt > 0 {
		out["observedAt"] = p.ObservedAt
	}
	return out
}

type importContactsSummary struct {
	Success  bool     `json:"success"`
	Created  int      `json:"created"`
	Skipped  int      `json:"skipped"`
	Enriched int      `json:"enriched"`
	Failed   int      `json:"failed"`
	Errors   []string `json:"errors"`
	// Notes carries non-failure explanations (e.g. a row skipped because an
	// archived contact already holds the platform claim). Kept separate from
	// Errors so it never affects Success or the exit code.
	Notes []string `json:"notes"`
	// Conflicts counts rows skipped because their matches disagree (#568). They are a subset
	// of Skipped and are never created.
	Conflicts int `json:"conflicts"`
	// Rows has one classification per row when --dedupe is on, in file order, for real and
	// dry runs alike.
	Rows        []rowReport               `json:"rows,omitempty"`
	Attribution *importAttributionSummary `json:"attribution,omitempty"`
	// plan carries a dry run's planned writes across chunks (see dryRunPlan).
	plan *dryRunPlan
}

type importAttributionSummary struct {
	WorkflowRunID string  `json:"workflowRunId"`
	TemplateID    *string `json:"templateId"`
	Attributed    int     `json:"attributed"`
	CohortSize    int     `json:"cohortSize"`
}

type importAttributionState struct {
	summary *importAttributionSummary
	seen    map[string]struct{}
}

func newImportAttributionState(workflowRunID, templateID string) *importAttributionState {
	var templateIDValue *string
	if templateID != "" {
		templateIDValue = &templateID
	}
	return &importAttributionState{
		summary: &importAttributionSummary{
			WorkflowRunID: workflowRunID,
			TemplateID:    templateIDValue,
		},
		seen: map[string]struct{}{},
	}
}

func (state *importAttributionState) applyResult(result map[string]any) {
	if templateID, ok := nonEmptyString(result["templateId"]); ok {
		state.summary.TemplateID = &templateID
	}
	if cohortSize, ok := result["cohortSize"].(float64); ok {
		state.summary.CohortSize = int(cohortSize)
	}
}

func (state *importAttributionState) add(ids []string) {
	for _, id := range ids {
		if id == "" {
			continue
		}
		state.seen[id] = struct{}{}
	}
	state.summary.Attributed = len(state.seen)
}

// contactMatch is the result of a dedupe lookup.
//
// Archived matters because the claim guard behind upsert_contact_identity does not
// filter archived contacts, so an archived owner still blocks the identity we would
// attach. OrgID matters because a platform account can be claimed by an org identity
// as well, which blocks a contact identity just as hard.
type contactMatch struct {
	ID           string
	Archived     bool
	OrgID        string
	CandidateIDs []string
}

// matched reports whether the row resolved to an existing owner of any kind.
// Every consumer deciding "create or not" must branch on this rather than on ID
// alone, or a new claimant kind silently reverts to creating a duplicate — which
// is what happened to reconcile when org claims were added.
func (m contactMatch) matched() bool {
	return m.ID != "" || m.OrgID != "" || len(m.CandidateIDs) > 0
}

func (m contactMatch) ambiguous() bool {
	return len(m.CandidateIDs) > 1
}

type agentToolInvoker func(tool string, input map[string]any) (map[string]any, error)

func newImportContactsCmd(flags *rootFlags) *cobra.Command {
	var filePath string
	var dedupe bool
	var dryRun bool
	var batchSize int
	var limit int
	var workflowRunID string
	var templateID string

	cmd := &cobra.Command{
		Use:   "contacts",
		Short: "Import contacts from staged CSV or JSON",
		Long: `Read workflow-runs/<runId>/contacts.csv or contacts.json, dedupe, and
create or enrich contacts via agent-tools invoke.

With --dedupe, every platform identity on a row and its email are checked
against existing contacts. A row is a match (one existing contact, which
is updated), a conflict (the matches point at different contacts, or an org
holds the account; skipped, never created) or new (created). The "rows"
output lists each row's outcome, the matched contact and the identity that
matched. --dry-run runs the same read-only lookups and reports the same
classification, writing nothing; a row that repeats an earlier row's
identity or email matches that row, named "row:<n>", as the real run would
match the contact it creates. Conflicts are skipped, not failed: they do
not change the exit code, so read "conflicts".

Optional identity provenance per row: CSV columns provenance_kind
(self_declared | agent_verified | inferred), provenance_source_url and
provenance_observed_at (unix seconds), or a JSON "provenance" object with
kind, sourceUrl and observedAt. A weaker kind never replaces a stronger one
already stored on the identity.`,
		Example: `  signals-pp-cli import contacts --file workflow-runs/run_1/contacts.csv --dedupe`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if filePath == "" {
				return usageErr(fmt.Errorf("required flag \"file\" not set"))
			}
			if err := validateImportAttributionFlags(workflowRunID, templateID); err != nil {
				return err
			}
			if batchSize <= 0 {
				batchSize = defaultImportBatchSize
			}
			if batchSize > maxImportBatchSize {
				return usageErr(fmt.Errorf("--batch-size max is %d", maxImportBatchSize))
			}
			if limit < 0 {
				return usageErr(fmt.Errorf("--limit must be >= 0"))
			}
			if limit == 0 {
				limit = maxImportRows
			}
			if limit > maxImportRows {
				return usageErr(fmt.Errorf("--limit max is %d rows per invocation", maxImportRows))
			}

			rows, err := readContactRows(filePath, limit)
			if err != nil {
				if os.IsNotExist(err) {
					return notFoundErr(fmt.Errorf("file not found: %s", filePath))
				}
				return usageErr(err)
			}

			c, err := flags.newClient()
			if err != nil {
				return err
			}
			c.DryRun = dryRun || flags.dryRun
			invoke, err := newImportInvoker(cmd, flags, c)
			if err != nil {
				return err
			}

			summary := importContactsSummary{
				Success: true,
				Errors:  []string{},
				Notes:   []string{},
			}
			preflightFailed, terminalErr := runContactImportWithInvoker(
				rows,
				batchSize,
				dedupe,
				c.DryRun,
				workflowRunID,
				templateID,
				&summary,
				invoke,
			)
			if preflightFailed {
				return terminalErr
			}

			if summary.Failed > 0 {
				summary.Success = false
			}

			payload, err := json.Marshal(summary)
			if err != nil {
				return err
			}
			fmt.Println(string(payload))
			if terminalErr != nil {
				return terminalErr
			}
			if summary.Failed > 0 {
				return apiErr(fmt.Errorf("%d row(s) failed", summary.Failed))
			}
			return nil
		},
	}

	cmd.Flags().StringVar(&filePath, "file", "", "Path to contacts.csv or contacts.json")
	cmd.Flags().BoolVar(&dedupe, "dedupe", false, "Match rows to existing contacts by email and every platform identity; skip conflicts")
	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "Preview without mutating Signals (dedupe lookups still run)")
	cmd.Flags().IntVar(&batchSize, "batch-size", defaultImportBatchSize, "Rows per invoke chunk (max 50)")
	cmd.Flags().IntVar(&limit, "limit", 0, "Max rows to process (default 500, hard cap 500)")
	cmd.Flags().StringVar(&workflowRunID, "workflow-run-id", "", "Attribute imported contacts to this workflow run")
	cmd.Flags().StringVar(&templateID, "template-id", "", "Template for --workflow-run-id")

	return cmd
}

func validateImportAttributionFlags(workflowRunID, templateID string) error {
	if templateID != "" && workflowRunID == "" {
		return usageErr(fmt.Errorf("--template-id requires --workflow-run-id"))
	}
	return nil
}

func runContactImportWithInvoker(
	rows []contactRow,
	batchSize int,
	dedupe bool,
	dryRun bool,
	workflowRunID string,
	templateID string,
	summary *importContactsSummary,
	invoke agentToolInvoker,
) (preflightFailed bool, terminalErr error) {
	var attribution *importAttributionState
	if workflowRunID != "" {
		attribution = newImportAttributionState(workflowRunID, templateID)
		summary.Attribution = attribution.summary
		if !dryRun {
			result, err := recordWorkflowRunContacts(workflowRunID, templateID, nil, invoke)
			if err != nil {
				return true, err
			}
			attribution.applyResult(result)
		}
	}

	for start := 0; start < len(rows); start += batchSize {
		end := start + batchSize
		if end > len(rows) {
			end = len(rows)
		}
		if err := importAttributedContactChunkWithInvoker(
			rows[start:end],
			dedupe,
			dryRun,
			workflowRunID,
			templateID,
			attribution,
			summary,
			invoke,
		); err != nil {
			return false, err
		}
	}

	return false, nil
}

func readContactRows(filePath string, limit int) ([]contactRow, error) {
	path := filePath
	if !filepath.IsAbs(path) {
		if cwd, err := os.Getwd(); err == nil {
			path = filepath.Join(cwd, filePath)
		}
	}

	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".json":
		return readContactJSON(path, limit)
	case ".csv":
		return readContactCSV(path, limit)
	default:
		return nil, fmt.Errorf("unsupported file type %q (use .csv or .json)", ext)
	}
}

func readContactJSON(path string, limit int) ([]contactRow, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var raw []map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("parsing JSON: %w", err)
	}
	if len(raw) > limit {
		return nil, usageErr(fmt.Errorf("file has %d rows; max %d per invocation", len(raw), limit))
	}
	rows := make([]contactRow, 0, len(raw))
	for _, item := range raw {
		row, err := mapContactRow(item)
		if err != nil {
			return nil, err
		}
		if row.Name == "" {
			return nil, usageErr(fmt.Errorf("each contact requires name"))
		}
		rows = append(rows, row)
	}
	return rows, nil
}

func readContactCSV(path string, limit int) ([]contactRow, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	reader := csv.NewReader(f)
	reader.TrimLeadingSpace = true
	header, err := reader.Read()
	if err != nil {
		return nil, fmt.Errorf("reading CSV header: %w", err)
	}
	colIndex := map[string]int{}
	for i, name := range header {
		colIndex[normalizeColumn(name)] = i
	}

	var rows []contactRow
	for {
		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("reading CSV row: %w", err)
		}
		item := map[string]any{}
		for key, idx := range colIndex {
			if idx < len(record) {
				item[key] = strings.TrimSpace(record[idx])
			}
		}
		row, err := mapContactRow(item)
		if err != nil {
			return nil, err
		}
		if row.Name == "" {
			continue
		}
		if len(rows) >= limit {
			return nil, usageErr(fmt.Errorf("file exceeds %d rows; split the import", limit))
		}
		rows = append(rows, row)
	}
	return rows, nil
}

func normalizeColumn(name string) string {
	key := strings.ToLower(strings.TrimSpace(name))
	key = strings.ReplaceAll(key, "-", "_")
	return key
}

func mapContactRow(item map[string]any) (contactRow, error) {
	get := func(keys ...string) string {
		for _, key := range keys {
			if v, ok := item[key]; ok {
				if s, ok := v.(string); ok {
					return strings.TrimSpace(s)
				}
			}
		}
		return ""
	}
	row := contactRow{
		Name:                  get("name"),
		Company:               get("company"),
		Title:                 get("title"),
		Email:                 normalizeEmail(get("email")),
		Platform:              get("platform"),
		PlatformUserID:        get("platform_user_id", "platformUserId"),
		PlatformHandle:        get("platform_handle", "platformHandle"),
		ProfileURL:            get("profile_url", "profileUrl"),
		AvatarURL:             get("avatar_url", "avatarUrl"),
		IdentityEvidenceToken: get("identity_evidence_token", "identityEvidenceToken"),
		Notes:                 get("notes"),
	}
	if row.Email != "" && !strings.Contains(row.Email, "@") {
		return contactRow{}, usageErr(fmt.Errorf("invalid email %q", row.Email))
	}
	provenance, err := mapRowProvenance(item, get)
	if err != nil {
		return contactRow{}, err
	}
	row.Provenance = provenance
	return row, nil
}

// mapRowProvenance reads either a nested JSON "provenance" object or flat
// provenance_* columns. Returns nil when the row has no provenance at all.
func mapRowProvenance(item map[string]any, get func(keys ...string) string) (*identityProvenance, error) {
	kind := get("provenance_kind", "provenanceKind")
	sourceURL := get("provenance_source_url", "provenanceSourceUrl")
	observedAt := item["provenance_observed_at"]
	if observedAt == nil {
		observedAt = item["provenanceObservedAt"]
	}
	if nested, ok := item["provenance"].(map[string]any); ok {
		nestedGet := func(keys ...string) string {
			for _, key := range keys {
				if s, ok := nested[key].(string); ok {
					return strings.TrimSpace(s)
				}
			}
			return ""
		}
		if v := nestedGet("kind"); v != "" {
			kind = v
		}
		if v := nestedGet("sourceUrl", "source_url"); v != "" {
			sourceURL = v
		}
		if v, ok := nested["observedAt"]; ok {
			observedAt = v
		} else if v, ok := nested["observed_at"]; ok {
			observedAt = v
		}
	}

	observed, err := parseObservedAt(observedAt)
	if err != nil {
		return nil, err
	}
	if kind == "" {
		if sourceURL != "" || observed != 0 {
			return nil, usageErr(fmt.Errorf("provenance source URL or observed-at given without provenance_kind"))
		}
		return nil, nil
	}
	if _, ok := identityProvenanceKinds[kind]; !ok {
		return nil, usageErr(fmt.Errorf(
			"invalid provenance_kind %q (use self_declared, agent_verified or inferred)", kind,
		))
	}
	return &identityProvenance{Kind: kind, SourceURL: sourceURL, ObservedAt: observed}, nil
}

func parseObservedAt(value any) (int64, error) {
	switch v := value.(type) {
	case nil:
		return 0, nil
	case string:
		trimmed := strings.TrimSpace(v)
		if trimmed == "" {
			return 0, nil
		}
		parsed, err := strconv.ParseInt(trimmed, 10, 64)
		if err != nil || parsed <= 0 {
			return 0, usageErr(fmt.Errorf("invalid provenance_observed_at %q (unix seconds)", v))
		}
		return parsed, nil
	case float64:
		if v <= 0 || v != math.Trunc(v) {
			return 0, usageErr(fmt.Errorf("invalid provenance observedAt %v (unix seconds)", v))
		}
		return int64(v), nil
	default:
		return 0, usageErr(fmt.Errorf("invalid provenance observedAt %v (unix seconds)", v))
	}
}

func importContactChunk(
	cmd *cobra.Command,
	c *client.Client,
	flags *rootFlags,
	rows []contactRow,
	dedupe bool,
	workflowRunID string,
	templateID string,
	attribution *importAttributionState,
	summary *importContactsSummary,
) error {
	return importAttributedContactChunkWithInvoker(rows, dedupe, c.DryRun, workflowRunID, templateID, attribution, summary, func(tool string, input map[string]any) (map[string]any, error) {
		return invokeAgentTool(cmd, c, flags, tool, input)
	})
}

func importContactChunkWithInvoker(
	rows []contactRow,
	dedupe bool,
	dryRun bool,
	summary *importContactsSummary,
	invoke agentToolInvoker,
) error {
	return importAttributedContactChunkWithInvoker(rows, dedupe, dryRun, "", "", nil, summary, invoke)
}

func importAttributedContactChunkWithInvoker(
	rows []contactRow,
	dedupe bool,
	dryRun bool,
	workflowRunID string,
	templateID string,
	attribution *importAttributionState,
	summary *importContactsSummary,
	invoke agentToolInvoker,
) error {
	chunkContactIDs := make([]string, 0, len(rows))
	chunkSeen := map[string]struct{}{}
	attribute := func(contactID string) {
		if dryRun || workflowRunID == "" || contactID == "" {
			return
		}
		if _, exists := chunkSeen[contactID]; exists {
			return
		}
		chunkSeen[contactID] = struct{}{}
		chunkContactIDs = append(chunkContactIDs, contactID)
	}

	lookup := invoke
	if dryRun && dedupe {
		if summary.plan == nil {
			summary.plan = newDryRunPlan()
		}
		lookup = summary.plan.invoker(invoke)
	}

	for _, row := range rows {
		if dedupe {
			index := len(summary.Rows) + 1
			match, err := classifyContactRow(row, lookup)
			if err != nil {
				// A failed lookup fails the row in a dry run too: counting it as a create
				// would promise something the real run might refuse.
				summary.Failed++
				summary.Errors = append(summary.Errors, err.Error())
				report := newRowReport(index, row, rowMatch{}, rowActionFailed)
				report.Error = err.Error()
				summary.Rows = append(summary.Rows, report)
				continue
			}
			action := plannedRowAction(match)
			report := newRowReport(index, row, match, action)
			if summary.plan != nil {
				summary.plan.record(index, row, match, action)
			}
			switch action {
			case rowActionSkip:
				// A conflict, an org-held account, or an archived owner. Never create:
				// upsert_contact_identity would reject the claim right after.
				summary.Skipped++
				if match.Outcome == rowOutcomeConflict {
					summary.Conflicts++
				}
				summary.Notes = append(summary.Notes, fmt.Sprintf("%s: %s", row.Name, match.Reason))
				summary.Rows = append(summary.Rows, report)
				continue
			case rowActionUpdate:
				result, err := enrichExistingContact(match.ContactID, row, workflowRunID, templateID, true, invoke)
				if row.IdentityEvidenceToken == "" || result.IdentityCommitted {
					attribute(match.ContactID)
				}
				if err != nil {
					summary.Failed++
					summary.Errors = append(summary.Errors, err.Error())
					report.Action = rowActionFailed
					report.Error = err.Error()
				} else if result.Enriched {
					summary.Enriched++
				} else {
					summary.Skipped++
				}
				summary.Rows = append(summary.Rows, report)
				continue
			}
			// rowActionCreate falls through to the create below.
			contactID, err := createAndEnrichRow(row, dryRun, workflowRunID, templateID, summary, attribute, invoke)
			if err != nil {
				report.Action = rowActionFailed
				report.Error = err.Error()
			} else if !dryRun {
				report.ContactID = contactID
			}
			summary.Rows = append(summary.Rows, report)
			continue
		}

		_, _ = createAndEnrichRow(row, dryRun, workflowRunID, templateID, summary, attribute, invoke)
	}

	if len(chunkContactIDs) > 0 {
		if attribution != nil {
			attribution.add(chunkContactIDs)
		}
		result, err := recordWorkflowRunContacts(workflowRunID, templateID, chunkContactIDs, invoke)
		if err != nil {
			summary.Success = false
			summary.Errors = append(summary.Errors, fmt.Sprintf("workflow attribution: %v", err))
			return apiErr(fmt.Errorf("recording workflow attribution: %w", err))
		}
		if attribution != nil {
			attribution.applyResult(result)
		}
	}
	return nil
}

// createAndEnrichRow creates the row's contact and then fills the remaining fields, counting
// the outcome in summary. It returns the new contact ID ("dry-run" in a dry run) and the
// create error, if any; an enrichment error is counted but does not undo the create.
func createAndEnrichRow(
	row contactRow,
	dryRun bool,
	workflowRunID string,
	templateID string,
	summary *importContactsSummary,
	attribute func(contactID string),
	invoke agentToolInvoker,
) (string, error) {
	contactID, err := createContactFromRow(row, dryRun, workflowRunID, templateID, invoke)
	if err != nil {
		if dryRun {
			summary.Created++
			return "", nil
		}
		summary.Failed++
		summary.Errors = append(summary.Errors, err.Error())
		return "", err
	}
	summary.Created++
	attribute(contactID)
	if result, err := enrichExistingContact(contactID, row, workflowRunID, templateID, false, invoke); err != nil {
		summary.Failed++
		summary.Errors = append(summary.Errors, err.Error())
	} else if result.Enriched {
		summary.Enriched++
	}
	return contactID, nil
}

func recordWorkflowRunContacts(
	workflowRunID string,
	templateID string,
	contactIDs []string,
	invoke agentToolInvoker,
) (map[string]any, error) {
	input := map[string]any{"runId": workflowRunID}
	if templateID != "" {
		input["templateId"] = templateID
	}
	if contactIDs != nil {
		input["contactIds"] = contactIDs
	}
	return invoke("record_workflow_run_contacts", input)
}

func invokeAgentTool(
	cmd *cobra.Command,
	c *client.Client,
	flags *rootFlags,
	tool string,
	input map[string]any,
) (map[string]any, error) {
	body := map[string]any{
		"tool":  tool,
		"input": input,
	}
	data, _, err := c.PostWithParams(cmd.Context(), "/api/agent-tools/invoke", nil, body)
	if err != nil {
		var responseErr *client.APIError
		if errors.As(err, &responseErr) {
			var envelope map[string]any
			if json.Unmarshal([]byte(responseErr.Body), &envelope) == nil {
				if success, ok := envelope["success"].(bool); ok && !success {
					_, envelopeErr := parseAgentToolEnvelope(tool, []byte(responseErr.Body))
					return nil, envelopeErr
				}
			}
		}
		return nil, classifyAPIError(err, flags)
	}
	if c.DryRun {
		return map[string]any{"dryRun": true, "tool": tool}, nil
	}
	return parseAgentToolEnvelope(tool, data)
}

func parseAgentToolEnvelope(tool string, data []byte) (map[string]any, error) {
	var envelope map[string]any
	if err := json.Unmarshal(data, &envelope); err != nil {
		return nil, apiErr(fmt.Errorf("decoding %s invoke response: %w", tool, err))
	}

	rawSuccess, exists := envelope["success"]
	if !exists {
		return nil, apiErr(fmt.Errorf("%s invoke response missing boolean success", tool))
	}
	success, ok := rawSuccess.(bool)
	if !ok {
		return nil, apiErr(fmt.Errorf("%s invoke response has non-boolean success", tool))
	}

	if !success {
		code, codeOK := nonEmptyString(envelope["code"])
		message, messageOK := nonEmptyString(envelope["error"])
		if !codeOK || !messageOK {
			return nil, apiErr(fmt.Errorf(
				"%s invoke failure missing usable code or error message",
				tool,
			))
		}
		if code == "VALIDATION_ERROR" {
			return nil, usageErr(fmt.Errorf("%s: %s", tool, message))
		}
		return nil, apiErr(fmt.Errorf("%s (%s): %s", tool, code, message))
	}

	rawResult, exists := envelope["result"]
	if !exists {
		return nil, apiErr(fmt.Errorf("%s invoke success response missing result object", tool))
	}
	result, ok := rawResult.(map[string]any)
	if !ok {
		return nil, apiErr(fmt.Errorf("%s invoke success response has non-object result", tool))
	}

	if _, covered := contactImportTools[tool]; covered {
		if legacyError, exists := result["error"]; exists {
			message, _ := nonEmptyString(legacyError)
			if message == "" {
				message = "legacy error result"
			}
			return nil, apiErr(fmt.Errorf(
				"%s returned %s inside a successful invoke response",
				tool,
				message,
			))
		}
	}

	if err := validateContactImportResult(tool, result); err != nil {
		return nil, err
	}
	return result, nil
}

func nonEmptyString(value any) (string, bool) {
	text, ok := value.(string)
	if !ok {
		return "", false
	}
	text = strings.TrimSpace(text)
	return text, text != ""
}

func validateContactImportResult(tool string, result map[string]any) error {
	switch tool {
	case "query_contacts":
		_, err := distinctContactIDs(result)
		return err
	case "resolve_platform_claim":
		_, err := platformClaimMatch(result)
		return err
	case "create_contact":
		if _, ok := nonEmptyString(result["id"]); !ok {
			return apiErr(fmt.Errorf("create_contact result missing non-empty string id"))
		}
	case "record_workflow_run_contacts":
		if _, ok := nonEmptyString(result["runId"]); !ok {
			return apiErr(fmt.Errorf("record_workflow_run_contacts result missing non-empty string runId"))
		}
		if _, ok := result["cohortSize"].(float64); !ok {
			return apiErr(fmt.Errorf("record_workflow_run_contacts result missing numeric cohortSize"))
		}
	}
	return nil
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

// distinctContactIDs returns every contact ID from an exact-filter query. The
// response is strict because a missing or mistyped ID changes dedupe behavior.
func distinctContactIDs(result map[string]any) ([]string, error) {
	contacts, ok := result["contacts"].([]any)
	if !ok {
		return nil, apiErr(fmt.Errorf("query_contacts result missing contacts array"))
	}
	seen := make(map[string]struct{}, len(contacts))
	for index, item := range contacts {
		contact, ok := item.(map[string]any)
		if !ok {
			return nil, apiErr(fmt.Errorf("query_contacts contacts[%d] is not an object", index))
		}
		id, ok := nonEmptyString(contact["id"])
		if !ok {
			return nil, apiErr(fmt.Errorf(
				"query_contacts contacts[%d] missing non-empty string id",
				index,
			))
		}
		seen[id] = struct{}{}
	}
	ids := make([]string, 0, len(seen))
	for id := range seen {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids, nil
}

func platformClaimMatch(result map[string]any) (contactMatch, error) {
	claimed, ok := result["claimed"].(bool)
	if !ok {
		return contactMatch{}, apiErr(fmt.Errorf(
			"resolve_platform_claim result missing boolean claimed",
		))
	}
	if !claimed {
		return contactMatch{}, nil
	}
	claimant, ok := result["claimant"].(map[string]any)
	if !ok {
		return contactMatch{}, apiErr(fmt.Errorf(
			"resolve_platform_claim claimed result missing claimant object",
		))
	}
	kind, ok := nonEmptyString(claimant["kind"])
	if !ok {
		return contactMatch{}, apiErr(fmt.Errorf(
			"resolve_platform_claim claimant missing non-empty string kind",
		))
	}
	switch kind {
	case "org":
		orgID, ok := nonEmptyString(claimant["orgId"])
		if !ok {
			return contactMatch{}, apiErr(fmt.Errorf(
				"resolve_platform_claim org claimant missing non-empty string orgId",
			))
		}
		return contactMatch{OrgID: orgID}, nil
	case "contact":
		contactID, ok := nonEmptyString(claimant["contactId"])
		if !ok {
			return contactMatch{}, apiErr(fmt.Errorf(
				"resolve_platform_claim contact claimant missing non-empty string contactId",
			))
		}
		archived, ok := claimant["archived"].(bool)
		if !ok {
			return contactMatch{}, apiErr(fmt.Errorf(
				"resolve_platform_claim contact claimant missing boolean archived",
			))
		}
		return contactMatch{
			ID:       contactID,
			Archived: archived,
		}, nil
	default:
		return contactMatch{}, apiErr(fmt.Errorf(
			"resolve_platform_claim claimant has unsupported kind %q",
			kind,
		))
	}
}

func isLikelyAvatarURL(url string) bool {
	lower := strings.ToLower(url)
	return strings.Contains(lower, "pbs.twimg.com") ||
		strings.Contains(lower, "media.licdn.com") ||
		strings.Contains(lower, "avatars.githubusercontent.com") ||
		strings.HasSuffix(lower, ".jpg") ||
		strings.HasSuffix(lower, ".jpeg") ||
		strings.HasSuffix(lower, ".png") ||
		strings.HasSuffix(lower, ".webp") ||
		strings.HasSuffix(lower, ".gif")
}

func createContactFromRow(
	row contactRow,
	dryRun bool,
	workflowRunID string,
	templateID string,
	invoke agentToolInvoker,
) (string, error) {
	input := map[string]any{
		"name": row.Name,
	}
	if row.Company != "" {
		input["company"] = row.Company
	}
	if row.Title != "" {
		input["title"] = row.Title
	}
	if row.Email != "" {
		input["channels"] = []map[string]any{
			{
				"channelType": "email",
				"value":       row.Email,
				"isPrimary":   true,
			},
		}
	}
	if row.Platform != "" {
		input["platform"] = row.Platform
	}
	if row.PlatformUserID != "" {
		input["platformUserId"] = row.PlatformUserID
	}
	if row.PlatformHandle != "" {
		input["platformHandle"] = row.PlatformHandle
	}
	profileURL := row.ProfileURL
	avatarURL := row.AvatarURL
	if isLikelyAvatarURL(profileURL) {
		if avatarURL == "" {
			avatarURL = profileURL
		}
		profileURL = ""
	}
	if profileURL != "" {
		input["platformUrl"] = profileURL
	}
	if avatarURL != "" {
		input["avatarUrl"] = avatarURL
	}
	if row.Notes != "" {
		input["notes"] = row.Notes
	}
	if row.IdentityEvidenceToken != "" {
		input["identityEvidenceToken"] = row.IdentityEvidenceToken
	}
	if row.Provenance != nil && row.Platform != "" {
		input["provenance"] = row.Provenance.payload()
	}
	if workflowRunID != "" {
		input["workflowRunId"] = workflowRunID
	}
	if templateID != "" {
		input["templateId"] = templateID
	}

	result, err := invoke("create_contact", input)
	if err != nil {
		return "", err
	}
	if dryRun {
		return "dry-run", nil
	}
	contactID, _ := result["id"].(string)
	if contactID == "" {
		return "", apiErr(fmt.Errorf("create_contact returned no id"))
	}
	return contactID, nil
}

type existingContactEnrichmentResult struct {
	Enriched          bool
	IdentityCommitted bool
}

func enrichExistingContact(
	contactID string,
	row contactRow,
	workflowRunID string,
	templateID string,
	includeIdentity bool,
	invoke agentToolInvoker,
) (existingContactEnrichmentResult, error) {
	result := existingContactEnrichmentResult{}
	// Validate and persist the evidence-gated identity before changing any other field on an
	// existing contact. A rejected Snowball row must leave the matched contact untouched.
	if includeIdentity && row.Platform != "" && (row.PlatformUserID != "" || row.PlatformHandle != "" || row.IdentityEvidenceToken != "") {
		identity := map[string]any{
			"contactId": contactID,
			"platform":  row.Platform,
		}
		if row.PlatformUserID != "" {
			identity["platformUserId"] = row.PlatformUserID
		}
		if row.PlatformHandle != "" {
			identity["platformHandle"] = row.PlatformHandle
		}
		profileURL := row.ProfileURL
		avatarURL := row.AvatarURL
		if isLikelyAvatarURL(profileURL) {
			if avatarURL == "" {
				avatarURL = profileURL
			}
			profileURL = ""
		}
		if profileURL != "" {
			identity["platformUrl"] = profileURL
		}
		if avatarURL != "" {
			identity["avatarUrl"] = avatarURL
		}
		if workflowRunID != "" {
			identity["workflowRunId"] = workflowRunID
		}
		if templateID != "" {
			identity["templateId"] = templateID
		}
		if row.Provenance != nil {
			identity["provenance"] = row.Provenance.payload()
		}
		if row.IdentityEvidenceToken != "" {
			identity["identityEvidenceToken"] = row.IdentityEvidenceToken
			if row.Company != "" {
				identity["candidateCompany"] = row.Company
			}
			if row.Title != "" {
				identity["candidateTitle"] = row.Title
			}
		}
		if _, err := invoke("upsert_contact_identity", identity); err != nil {
			return result, err
		}
		result.Enriched = true
		result.IdentityCommitted = true
	}

	enrichInput := map[string]any{
		"contactId": contactID,
	}
	if row.Company != "" {
		enrichInput["company"] = row.Company
	}
	if row.Title != "" {
		enrichInput["title"] = row.Title
	}
	if row.Notes != "" {
		enrichInput["notes"] = row.Notes
	}
	if len(enrichInput) > 1 {
		if _, err := invoke("enrich_contact", enrichInput); err != nil {
			return result, err
		}
		result.Enriched = true
	}
	return result, nil
}
