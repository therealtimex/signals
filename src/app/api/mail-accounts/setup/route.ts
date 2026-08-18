import { NextResponse } from "next/server";
import { getHimalayaConfigPath } from "@/lib/mail/himalaya";

/**
 * GET /api/mail-accounts/setup
 * Setup instructions for adding a Himalaya mail account via terminal.
 */
export async function GET() {
  const configPath = getHimalayaConfigPath();

  return NextResponse.json({
    configPath,
    steps: [
      "Open a RealTimeX terminal agent (or local shell) on this machine.",
      "Run `himalaya account configure` (or edit config.toml directly) to add a Google mail account.",
      `Config file: ${configPath}`,
      "Set EMAIL_CONFIG_FILE in plugin settings if using a non-default path.",
      "Return here and click Refresh to import accounts into Signals.",
    ],
    docs: "Agents read/send mail via Himalaya CLI: `himalaya -a <alias> --output json ...`",
  });
}
