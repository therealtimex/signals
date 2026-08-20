package cli

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

type reconcileSummary struct {
	Success   bool `json:"success"`
	Total     int  `json:"total"`
	WouldSkip int  `json:"wouldSkip"`
	WouldCreate int `json:"wouldCreate"`
}

func newReconcileCmd(flags *rootFlags) *cobra.Command {
	var filePath string

	cmd := &cobra.Command{
		Use:   "reconcile",
		Short: "Preview import dedupe without mutating Signals",
		Example: `  signals-pp-cli reconcile --file workflow-runs/run_1/contacts.csv`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if filePath == "" {
				return usageErr(fmt.Errorf("required flag \"file\" not set"))
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
				// Shares findExistingContact with import, so the preview now also
				// sees archived claim holders. A row whose (platform, platformUserId)
				// belongs to an archived contact counts as WouldSkip because that is
				// exactly what import will do with it — the preview would otherwise
				// promise a create that import refuses.
				if existing.ID != "" {
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

	cmd.Flags().StringVar(&filePath, "file", "", "Path to contacts.csv or contacts.json")
	return cmd
}
