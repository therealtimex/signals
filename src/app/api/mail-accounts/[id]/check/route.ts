import { NextResponse } from "next/server";
import {
  getHimalayaMailAccountById,
  updateMailAccountCheckStatus,
} from "@/lib/db/queries/mail-accounts";
import { checkHimalayaAccount, getHimalayaConfigPath } from "@/lib/mail/himalaya";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/mail-accounts/:id/check
 * Validate account via `himalaya account doctor <alias>` (Himalaya v1.2+).
 */
export async function POST(_req: Request, context: RouteContext) {
  const { id } = await context.params;
  const account = getHimalayaMailAccountById(id);
  if (!account) {
    return NextResponse.json({ error: "Mail account not found" }, { status: 404 });
  }

  let alias = account.displayName;
  if (account.metadata) {
    try {
      const meta = JSON.parse(account.metadata) as { himalayaAlias?: string };
      alias = meta.himalayaAlias ?? alias;
    } catch {
      // use displayName fallback
    }
  }

  const result = await checkHimalayaAccount(alias, getHimalayaConfigPath());
  const updated = updateMailAccountCheckStatus(id, result);

  return NextResponse.json({
    ok: result.ok,
    message: result.message,
    account: updated,
  });
}
