import { NextResponse } from "next/server";
import { AgentToolError } from "@/lib/agent-tools/types";
import { getOwnerContactId } from "@/lib/db/queries/contacts";
import { renderPersonalityBlocks } from "@/lib/personality/render";
import {
  buildSourceSnapshot,
  computeSourceHash,
  sourceRevisions,
} from "@/lib/personality/snapshot";
import { loadPersonalitySourceBundle } from "@/lib/personality/sources";
import { resolveActiveVoiceProfileContext } from "@/lib/writing/voice-profile-store";

export async function GET() {
  try {
    const bundle = loadPersonalitySourceBundle();
    const snapshot = buildSourceSnapshot(bundle.sources, bundle.revisions);
    const activeVoice = resolveActiveVoiceProfileContext(getOwnerContactId());
    return NextResponse.json({
      self: bundle.sources.identity,
      org: bundle.sources.brand,
      voice: {
        status: activeVoice.status === "active"
          ? (activeVoice.ambiguous ? "ambiguous" : "active")
          : activeVoice.status,
        candidates: activeVoice.candidates,
      },
      statements: bundle.sources.statements,
      snapshot,
      sourceHash: computeSourceHash(snapshot),
      sourceRevisions: sourceRevisions(snapshot),
      blocks: renderPersonalityBlocks(bundle.sources),
    });
  } catch (error) {
    if (error instanceof AgentToolError) {
      const reason = (error.details as { reason?: string } | undefined)?.reason;
      return NextResponse.json(
        { error: error.message, code: error.code, reason, details: error.details },
        { status: reason === "self_contact_missing" ? 404 : 409 },
      );
    }
    throw error;
  }
}
