package cli

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"
	"signals-pp-cli/internal/client"
)

const (
	defaultImportBatchSize = 50
	maxImportBatchSize     = 50
	maxImportRows          = 500
)

type contactRow struct {
	Name           string
	Company        string
	Title          string
	Email          string
	Platform       string
	PlatformUserID string
	PlatformHandle string
	ProfileURL     string
	Notes          string
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
}

// contactMatch is the result of a dedupe lookup.
//
// Archived matters because the claim guard behind upsert_contact_identity does not
// filter archived contacts, so an archived owner still blocks the identity we would
// attach. OrgID matters because a platform account can be claimed by an org identity
// as well, which blocks a contact identity just as hard.
type contactMatch struct {
	ID       string
	Archived bool
	OrgID    string
}

func newImportContactsCmd(flags *rootFlags) *cobra.Command {
	var filePath string
	var dedupe bool
	var dryRun bool
	var batchSize int
	var limit int

	cmd := &cobra.Command{
		Use:   "contacts",
		Short: "Import contacts from staged CSV or JSON",
		Long: `Read workflow-runs/<runId>/contacts.csv or contacts.json, dedupe, and
create or enrich contacts via agent-tools invoke.`,
		Example: `  signals-pp-cli import contacts --file workflow-runs/run_1/contacts.csv --dedupe`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if filePath == "" {
				return usageErr(fmt.Errorf("required flag \"file\" not set"))
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

			summary := importContactsSummary{
				Success: true,
				Errors:  []string{},
				Notes:   []string{},
			}

			for start := 0; start < len(rows); start += batchSize {
				end := start + batchSize
				if end > len(rows) {
					end = len(rows)
				}
				chunk := rows[start:end]
				if err := importContactChunk(cmd, c, flags, chunk, dedupe, &summary); err != nil {
					return err
				}
			}

			if summary.Failed > 0 {
				summary.Success = false
			}

			payload, err := json.Marshal(summary)
			if err != nil {
				return err
			}
			fmt.Println(string(payload))
			if summary.Failed > 0 {
				return apiErr(fmt.Errorf("%d row(s) failed", summary.Failed))
			}
			return nil
		},
	}

	cmd.Flags().StringVar(&filePath, "file", "", "Path to contacts.csv or contacts.json")
	cmd.Flags().BoolVar(&dedupe, "dedupe", false, "Skip contacts that already exist (email or platform identity)")
	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "Preview without mutating Signals")
	cmd.Flags().IntVar(&batchSize, "batch-size", defaultImportBatchSize, "Rows per invoke chunk (max 50)")
	cmd.Flags().IntVar(&limit, "limit", 0, "Max rows to process (default 500, hard cap 500)")

	return cmd
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
		Name:           get("name"),
		Company:        get("company"),
		Title:          get("title"),
		Email:          strings.ToLower(get("email")),
		Platform:       get("platform"),
		PlatformUserID: get("platform_user_id", "platformUserId"),
		PlatformHandle: get("platform_handle", "platformHandle"),
		ProfileURL:     get("profile_url", "profileUrl"),
		Notes:          get("notes"),
	}
	if row.Email != "" && !strings.Contains(row.Email, "@") {
		return contactRow{}, usageErr(fmt.Errorf("invalid email %q", row.Email))
	}
	return row, nil
}

func importContactChunk(
	cmd *cobra.Command,
	c *client.Client,
	flags *rootFlags,
	rows []contactRow,
	dedupe bool,
	summary *importContactsSummary,
) error {
	for _, row := range rows {
		if dedupe {
			existing, err := findExistingContact(cmd, c, flags, row)
			if err != nil {
				if c.DryRun {
					summary.Created++
					continue
				}
				summary.Failed++
				summary.Errors = append(summary.Errors, err.Error())
				continue
			}
			if existing.OrgID != "" {
				// An org holds this platform account. Creating a contact would be
				// rejected by the same guard, so skip and name the owner.
				summary.Skipped++
				summary.Notes = append(summary.Notes, fmt.Sprintf(
					"%s: %s/%s is already claimed by org %s; reassign the account before importing this row",
					row.Name, row.Platform, row.PlatformUserID, existing.OrgID,
				))
				continue
			}
			if existing.ID != "" && existing.Archived {
				// Enriching would be invisible (the contact is hidden) and
				// un-archiving would silently undo a deliberate user action, so
				// skip and say why. Either way we must not create a duplicate:
				// upsert_contact_identity would reject the claim right after.
				summary.Skipped++
				summary.Notes = append(summary.Notes, fmt.Sprintf(
					"%s: %s/%s is already claimed by archived contact %s; restore it to import this row",
					row.Name, row.Platform, row.PlatformUserID, existing.ID,
				))
				continue
			}
			if existing.ID != "" {
				if enriched, err := enrichExistingContact(cmd, c, flags, existing.ID, row); err != nil {
					summary.Failed++
					summary.Errors = append(summary.Errors, err.Error())
				} else if enriched {
					summary.Enriched++
				} else {
					summary.Skipped++
				}
				continue
			}
		}

		contactID, err := createContactFromRow(cmd, c, flags, row)
		if err != nil {
			if c.DryRun {
				summary.Created++
				continue
			}
			summary.Failed++
			summary.Errors = append(summary.Errors, err.Error())
			continue
		}
		summary.Created++
		if enriched, err := enrichExistingContact(cmd, c, flags, contactID, row); err != nil {
			summary.Failed++
			summary.Errors = append(summary.Errors, err.Error())
		} else if enriched {
			summary.Enriched++
		}
	}
	return nil
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
		return nil, classifyAPIError(err, flags)
	}
	if c.DryRun {
		return map[string]any{"dryRun": true, "tool": tool}, nil
	}
	var envelope map[string]any
	if err := json.Unmarshal(data, &envelope); err != nil {
		return nil, apiErr(fmt.Errorf("decoding invoke response: %w", err))
	}
	if success, _ := envelope["success"].(bool); !success {
		code, _ := envelope["code"].(string)
		message, _ := envelope["error"].(string)
		if code == "VALIDATION_ERROR" {
			return nil, usageErr(fmt.Errorf("%s: %s", tool, message))
		}
		return nil, apiErr(fmt.Errorf("%s: %s", tool, message))
	}
	result, ok := envelope["result"].(map[string]any)
	if !ok {
		return map[string]any{}, nil
	}
	return result, nil
}

func findExistingContact(cmd *cobra.Command, c *client.Client, flags *rootFlags, row contactRow) (contactMatch, error) {
	if row.Email != "" {
		// Exact normalized match, server-side. Trust the filter rather than
		// re-checking payload fields the server may not send (#207).
		result, err := invokeAgentTool(cmd, c, flags, "query_contacts", map[string]any{
			"email":    row.Email,
			"pageSize": 20,
		})
		if err != nil {
			return contactMatch{}, err
		}
		if id := firstContactID(result); id != "" {
			return contactMatch{ID: id}, nil
		}
	}
	if row.Platform != "" && row.PlatformUserID != "" {
		// platformUserId is an exact identity-claim filter. Free-text search does
		// not cover contact_identities, so searching the handle never matched and
		// the import created a duplicate that upsert_contact_identity then
		// rejected as an already-claimed platform account (#202).
		// resolve_platform_claim is the same resolution upsert_contact_identity
		// enforces, so this cannot disagree with the guard the way a query_contacts
		// reconstruction could (#206).
		result, err := invokeAgentTool(cmd, c, flags, "resolve_platform_claim", map[string]any{
			"platform":       row.Platform,
			"platformUserId": row.PlatformUserID,
		})
		if err != nil {
			return contactMatch{}, err
		}
		return platformClaimMatch(result), nil
	}
	return contactMatch{}, nil
}

// firstContactID takes the first contact from an exact-filter query result. Safe only
// because the filter is exact and server-side; do not use it with fuzzy `search`.
func firstContactID(result map[string]any) string {
	contacts, ok := result["contacts"].([]any)
	if !ok || len(contacts) == 0 {
		return ""
	}
	contact, ok := contacts[0].(map[string]any)
	if !ok {
		return ""
	}
	id, _ := contact["id"].(string)
	return id
}

func platformClaimMatch(result map[string]any) contactMatch {
	if claimed, _ := result["claimed"].(bool); !claimed {
		return contactMatch{}
	}
	claimant, ok := result["claimant"].(map[string]any)
	if !ok {
		return contactMatch{}
	}
	switch kind, _ := claimant["kind"].(string); kind {
	case "org":
		orgID, _ := claimant["orgId"].(string)
		return contactMatch{OrgID: orgID}
	case "contact":
		contactID, _ := claimant["contactId"].(string)
		archived, _ := claimant["archived"].(bool)
		return contactMatch{ID: contactID, Archived: archived}
	default:
		return contactMatch{}
	}
}

func createContactFromRow(cmd *cobra.Command, c *client.Client, flags *rootFlags, row contactRow) (string, error) {
	input := map[string]any{
		"name": row.Name,
	}
	if row.Company != "" {
		input["company"] = row.Company
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
	result, err := invokeAgentTool(cmd, c, flags, "create_contact", input)
	if err != nil {
		return "", err
	}
	if c.DryRun {
		return "dry-run", nil
	}
	contactID, _ := result["id"].(string)
	if contactID == "" {
		return "", apiErr(fmt.Errorf("create_contact returned no id"))
	}
	return contactID, nil
}

func enrichExistingContact(cmd *cobra.Command, c *client.Client, flags *rootFlags, contactID string, row contactRow) (bool, error) {
	enriched := false
	enrichInput := map[string]any{
		"contactId": contactID,
	}
	if row.Title != "" {
		enrichInput["title"] = row.Title
	}
	if row.Notes != "" {
		enrichInput["notes"] = row.Notes
	}
	if len(enrichInput) > 1 {
		if _, err := invokeAgentTool(cmd, c, flags, "enrich_contact", enrichInput); err != nil {
			return false, err
		}
		enriched = true
	}

	if row.Platform != "" && (row.PlatformUserID != "" || row.PlatformHandle != "") {
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
		if strings.HasPrefix(row.ProfileURL, "https://") {
			identity["avatarUrl"] = row.ProfileURL
		}
		if _, err := invokeAgentTool(cmd, c, flags, "upsert_contact_identity", identity); err != nil {
			return enriched, err
		}
		enriched = true
	}
	return enriched, nil
}
