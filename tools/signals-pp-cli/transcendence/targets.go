package cli

import (
	"encoding/json"
	"fmt"

	"github.com/spf13/cobra"
)

func printTargetResult(result map[string]any) error {
	payload, err := json.Marshal(result)
	if err != nil {
		return err
	}
	fmt.Println(string(payload))
	if code, _ := result["code"].(string); code != "" {
		message, _ := result["error"].(string)
		if code == "TARGET_NOT_FOUND" || code == "TARGET_FORGOTTEN" {
			return notFoundErr(fmt.Errorf("%s: %s", code, message))
		}
		return apiErr(fmt.Errorf("%s: %s", code, message))
	}
	return nil
}

func invokeTargetTool(
	cmd *cobra.Command,
	flags *rootFlags,
	tool string,
	input map[string]any,
) error {
	c, err := flags.newClient()
	if err != nil {
		return err
	}
	result, err := invokeAgentTool(cmd, c, flags, tool, input)
	if err != nil {
		return err
	}
	return printTargetResult(result)
}

func newTargetsCmd(flags *rootFlags) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "targets",
		Short: "List, inspect, prepare, and release platform acting targets",
	}
	cmd.AddCommand(newTargetsListCmd(flags))
	cmd.AddCommand(newTargetsShowCmd(flags))
	cmd.AddCommand(newTargetsPrepareCmd(flags))
	cmd.AddCommand(newTargetsReleaseCmd(flags))
	return cmd
}

func newTargetsListCmd(flags *rootFlags) *cobra.Command {
	var platform string
	var kind string
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List registered platform targets and browser connections",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			input := map[string]any{}
			if platform != "" {
				input["platform"] = platform
			}
			if kind != "" {
				input["kind"] = kind
			}
			return invokeTargetTool(cmd, flags, "list_platform_targets", input)
		},
	}
	cmd.Flags().StringVar(&platform, "platform", "", "Filter by x, linkedin, or facebook")
	cmd.Flags().StringVar(&kind, "kind", "", "Filter by account, profile, page, or organization")
	return cmd
}

func newTargetsShowCmd(flags *rootFlags) *cobra.Command {
	return &cobra.Command{
		Use:   "show <targetId>",
		Short: "Show one platform target and its lease state",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return invokeTargetTool(cmd, flags, "get_platform_target", map[string]any{
				"targetId": args[0],
			})
		},
	}
}

func newTargetsPrepareCmd(flags *rootFlags) *cobra.Command {
	var intent string
	var ttl int
	var leaseID string
	cmd := &cobra.Command{
		Use:   "prepare <targetId>",
		Short: "Lease, activate, and verify a platform target",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if intent != "browse" && intent != "publish" {
				return usageErr(fmt.Errorf("--intent must be browse or publish"))
			}
			input := map[string]any{
				"targetId": args[0],
				"intent":   intent,
			}
			if ttl > 0 {
				input["leaseTtlSeconds"] = ttl
			}
			if leaseID != "" {
				input["leaseId"] = leaseID
			}
			return invokeTargetTool(cmd, flags, "prepare_platform_target", input)
		},
	}
	cmd.Flags().StringVar(&intent, "intent", "browse", "Operation intent: browse or publish")
	cmd.Flags().IntVar(&ttl, "ttl", 0, "Lease TTL in seconds (30-1800)")
	cmd.Flags().StringVar(&leaseID, "lease", "", "Existing lease ID to renew")
	return cmd
}

func newTargetsReleaseCmd(flags *rootFlags) *cobra.Command {
	var leaseID string
	cmd := &cobra.Command{
		Use:   "release",
		Short: "Release a prepared platform-target lease",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			if leaseID == "" {
				return usageErr(fmt.Errorf("required flag \"lease\" not set"))
			}
			return invokeTargetTool(cmd, flags, "release_platform_target", map[string]any{
				"leaseId": leaseID,
			})
		},
	}
	cmd.Flags().StringVar(&leaseID, "lease", "", "Lease ID returned by targets prepare")
	return cmd
}
