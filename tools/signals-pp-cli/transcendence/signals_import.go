// Hand-maintained transcendence commands for signals-pp-cli (#174).
// Copied into Printing Press source/internal/cli during build.

package cli

import "github.com/spf13/cobra"

func newSignalsImportCmd(flags *rootFlags) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "import",
		Short: "Bulk import staged workflow contacts into Signals CRM",
	}
	cmd.AddCommand(newImportContactsCmd(flags))
	return cmd
}
