package cli

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"
)

const maxMergeGroups = 500

type reconcileSummary struct {
	Success   bool `json:"success"`
	Total     int  `json:"total"`
	WouldSkip int  `json:"wouldSkip"`
	WouldCreate int `json:"wouldCreate"`
}

// mergeSummary is the --merge counterpart of reconcileSummary. AlreadyMerged is
// reported separately from Merged so a replayed file reads as "nothing to do"
// rather than as a second round of merges.
type mergeSummary struct {
	Success       bool     `json:"success"`
	Groups        int      `json:"groups"`
	Merged        int      `json:"merged"`
	AlreadyMerged int      `json:"alreadyMerged"`
	Skipped       int      `json:"skipped"`
	Failed        int      `json:"failed"`
	DryRun        bool     `json:"dryRun"`
	Errors        []string `json:"errors"`
	Notes         []string `json:"notes"`
}

// dedupGroup mirrors one entry of find_duplicate_contacts output.
type dedupGroup struct {
	PrimaryContactID    string
	SecondaryContactIDs []string
	Confidence          float64
	Tier                int
}

func newReconcileCmd(flags *rootFlags) *cobra.Command {
	var filePath string
	var merge bool
	var dryRun bool
	var minConfidence float64

	cmd := &cobra.Command{
		Use:   "reconcile",
		Short: "Preview import dedupe, or merge staged duplicate groups",
		Example: `  signals-pp-cli reconcile --file workflow-runs/run_1/contacts.csv
  signals-pp-cli reconcile --merge --file workflow-runs/run_1/dedup-candidates.json`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if filePath == "" {
				return usageErr(fmt.Errorf("required flag \"file\" not set"))
			}
			if merge {
				return runReconcileMerge(cmd, flags, filePath, dryRun, minConfidence)
			}
			if minConfidence != 0 {
				return usageErr(fmt.Errorf("--min-confidence only applies with --merge"))
			}

			rows, err := readContactRows(filePath, maxImportRows)
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

			summary := reconcileSummary{
				Success: true,
				Total:   len(rows),
			}

			for _, row := range rows {
				existing, err := findExistingContact(cmd, c, flags, row)
				if err != nil {
					return classifyAPIError(err, flags)
				}
				// Shares findExistingContact with import, so the preview also sees
				// claim holders import will refuse: an archived contact, or an org
				// identity holding the platform account. Both count as WouldSkip
				// because that is exactly what import does with them — the preview
				// would otherwise promise a create that import refuses.
				if existing.matched() {
					summary.WouldSkip++
				} else {
					summary.WouldCreate++
				}
			}

			payload, err := json.Marshal(summary)
			if err != nil {
				return err
			}
			fmt.Println(string(payload))
			return nil
		},
	}

	cmd.Flags().StringVar(&filePath, "file", "", "Path to contacts.csv/.json, or dedup-candidates.json with --merge")
	cmd.Flags().BoolVar(&merge, "merge", false, "Merge the duplicate groups staged in --file via merge_contacts")
	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "Preview the merge without mutating Signals")
	cmd.Flags().Float64Var(&minConfidence, "min-confidence", 0, "Skip groups below this confidence (0-1, requires --merge)")
	return cmd
}

func runReconcileMerge(
	cmd *cobra.Command,
	flags *rootFlags,
	filePath string,
	dryRun bool,
	minConfidence float64,
) error {
	if minConfidence < 0 || minConfidence > 1 {
		return usageErr(fmt.Errorf("--min-confidence must be between 0 and 1"))
	}

	groups, err := readDedupGroups(filePath)
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
	// merge_contacts has a real server-side dry run that validates ids and reports
	// the plan, which is more useful than the client-level short circuit — so both
	// the command flag and the global flag are forwarded as options.dryRun rather
	// than set on c.DryRun. Either way nothing is written.
	effectiveDryRun := dryRun || flags.dryRun

	summary := mergeSummary{
		Success: true,
		Groups:  len(groups),
		DryRun:  effectiveDryRun,
		Errors:  []string{},
		Notes:   []string{},
	}

	for _, group := range groups {
		if minConfidence > 0 && group.Confidence < minConfidence {
			summary.Skipped += len(group.SecondaryContactIDs)
			summary.Notes = append(summary.Notes, fmt.Sprintf(
				"%s: confidence %.2f below --min-confidence %.2f",
				group.PrimaryContactID, group.Confidence, minConfidence,
			))
			continue
		}

		// merge_contacts is idempotent server-side, so a re-run of the same file
		// needs no local bookkeeping — it just reports already_merged.
		result, err := invokeAgentTool(cmd, c, flags, "merge_contacts", map[string]any{
			"primaryContactId":    group.PrimaryContactID,
			"secondaryContactIds": group.SecondaryContactIDs,
			"options": map[string]any{
				"dryRun": effectiveDryRun,
				"reason": fmt.Sprintf("signals-pp-cli reconcile --merge (%s)", filepath.Base(filePath)),
			},
		})
		if err != nil {
			summary.Failed += len(group.SecondaryContactIDs)
			summary.Errors = append(summary.Errors, err.Error())
			continue
		}

		tallyMergeResult(result, &summary)
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
		return apiErr(fmt.Errorf("%d contact(s) failed to merge", summary.Failed))
	}
	return nil
}

func tallyMergeResult(result map[string]any, summary *mergeSummary) {
	merged, ok := result["merged"].([]any)
	if !ok {
		// --dry-run through the client short-circuits before decoding a body.
		return
	}
	for _, item := range merged {
		entry, ok := item.(map[string]any)
		if !ok {
			continue
		}
		status, _ := entry["status"].(string)
		switch status {
		case "merged":
			summary.Merged++
		case "already_merged":
			summary.AlreadyMerged++
		default:
			summary.Skipped++
			if detail, _ := entry["detail"].(string); detail != "" {
				contactID, _ := entry["contactId"].(string)
				summary.Notes = append(summary.Notes, fmt.Sprintf("%s: %s", contactID, detail))
			}
		}
	}
}

// readDedupGroups accepts either the raw find_duplicate_contacts response
// (`{"candidates": [...]}`) or a bare array of groups, so a staged file can be
// the tool output verbatim.
func readDedupGroups(filePath string) ([]dedupGroup, error) {
	path := filePath
	if !filepath.IsAbs(path) {
		if cwd, err := os.Getwd(); err == nil {
			path = filepath.Join(cwd, filePath)
		}
	}
	if ext := filepath.Ext(path); ext != ".json" {
		return nil, fmt.Errorf("unsupported file type %q (--merge expects .json)", ext)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var envelope struct {
		Candidates []map[string]any `json:"candidates"`
	}
	var raw []map[string]any
	if err := json.Unmarshal(data, &envelope); err == nil && envelope.Candidates != nil {
		raw = envelope.Candidates
	} else if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("parsing JSON: %w", err)
	}

	if len(raw) > maxMergeGroups {
		return nil, fmt.Errorf("file has %d groups; max %d per invocation", len(raw), maxMergeGroups)
	}

	groups := make([]dedupGroup, 0, len(raw))
	for _, item := range raw {
		group, err := mapDedupGroup(item)
		if err != nil {
			return nil, err
		}
		groups = append(groups, group)
	}
	if len(groups) == 0 {
		return nil, fmt.Errorf("no duplicate groups found in %s", filePath)
	}
	return groups, nil
}

func mapDedupGroup(item map[string]any) (dedupGroup, error) {
	getString := func(keys ...string) string {
		for _, key := range keys {
			if v, ok := item[key].(string); ok && v != "" {
				return v
			}
		}
		return ""
	}
	getFloat := func(keys ...string) float64 {
		for _, key := range keys {
			if v, ok := item[key].(float64); ok {
				return v
			}
		}
		return 0
	}
	getStrings := func(keys ...string) []string {
		for _, key := range keys {
			raw, ok := item[key].([]any)
			if !ok {
				continue
			}
			values := make([]string, 0, len(raw))
			for _, entry := range raw {
				if s, ok := entry.(string); ok && s != "" {
					values = append(values, s)
				}
			}
			return values
		}
		return nil
	}

	group := dedupGroup{
		PrimaryContactID:    getString("primaryContactId", "primary_contact_id"),
		SecondaryContactIDs: getStrings("secondaryContactIds", "secondary_contact_ids"),
		Confidence:          getFloat("confidence"),
		Tier:                int(getFloat("tier")),
	}
	if group.PrimaryContactID == "" {
		return dedupGroup{}, fmt.Errorf("each group requires primaryContactId")
	}
	if len(group.SecondaryContactIDs) == 0 {
		return dedupGroup{}, fmt.Errorf(
			"group %s requires at least one secondaryContactIds entry", group.PrimaryContactID)
	}
	return group, nil
}
