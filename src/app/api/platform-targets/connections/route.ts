import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureBrowserConnection } from "@/lib/db/queries/platform-targets";

const schema = z.object({
  sessionName: z.string().min(1),
  kind: z.enum(["shared", "dedicated"]).default("dedicated"),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }
  return NextResponse.json({
    connection: ensureBrowserConnection({
      ...parsed.data,
      source: "settings",
    }),
  });
}
