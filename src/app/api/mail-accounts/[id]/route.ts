import { NextRequest, NextResponse } from "next/server";
import {
  getHimalayaMailAccountById,
  setDefaultMailAccount,
  unregisterMailAccount,
} from "@/lib/db/queries/mail-accounts";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * PATCH /api/mail-accounts/:id
 * Set default mail account for agents.
 */
export async function PATCH(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const body = await req.json().catch(() => ({}));

  if (!body.default) {
    return NextResponse.json({ error: "Only { default: true } is supported" }, { status: 400 });
  }

  const account = setDefaultMailAccount(id);
  if (!account) {
    return NextResponse.json({ error: "Mail account not found" }, { status: 404 });
  }

  return NextResponse.json({ account });
}

/**
 * DELETE /api/mail-accounts/:id
 * Unregister from Signals (Himalaya config must be edited manually).
 */
export async function DELETE(_req: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  if (!getHimalayaMailAccountById(id)) {
    return NextResponse.json({ error: "Mail account not found" }, { status: 404 });
  }

  unregisterMailAccount(id);
  return NextResponse.json({
    success: true,
    warning:
      "Removed from Signals registry. To fully remove the account, edit your Himalaya config.toml manually.",
  });
}
