import { NextResponse } from "next/server";
import { SOCIAL_PERSONALITY_FILES } from "@/lib/personality/contracts";
import {
  PersonalityEditorHandoffError,
  openWorkspacePersonalityEditor,
  probePersonalityEditorCapability,
} from "@/lib/personality/editor-handoff";
import {
  PersonalityOnboardingError,
  buildPersonalityOnboardingTaskPrompt,
  stagePersonalityOnboardingFiles,
  validatePersonalityOnboardingInput,
  type PersonalityOnboardingUpload,
} from "@/lib/personality/onboarding";
import { PERSONALITY_ONBOARDING_MAX_BRIEF_CHARS } from "@/lib/personality/onboarding-contract";
import {
  readPersonalityWorkspaceFiles,
  resolvePersonalityWorkspaceContext,
} from "@/lib/personality/workspace";

function errorResponse(error: unknown): NextResponse {
  if (
    error instanceof PersonalityOnboardingError ||
    error instanceof PersonalityEditorHandoffError
  ) {
    return NextResponse.json(
      {
        success: false,
        error: error.message,
        code: error.code,
        details: error.details,
      },
      { status: error.status ?? 503 },
    );
  }
  return NextResponse.json(
    {
      success: false,
      error: error instanceof Error ? error.message : "Personality onboarding failed.",
      code: "WORKSPACE_UNAVAILABLE",
    },
    { status: 503 },
  );
}

export async function GET() {
  try {
    const context = await resolvePersonalityWorkspaceContext();
    const [editor, files] = await Promise.all([
      probePersonalityEditorCapability(),
      Promise.resolve(readPersonalityWorkspaceFiles(context.workspace)),
    ]);
    const personalityFiles = files
      .filter(
        (file) =>
          SOCIAL_PERSONALITY_FILES.includes(
            file.path as (typeof SOCIAL_PERSONALITY_FILES)[number],
          ) && file.content !== null,
      )
      .map((file) => file.path);

    return NextResponse.json({
      success: true,
      workspace: {
        id: context.workspace.id,
        slug: context.workspace.slug,
        displayName: context.displayName,
        path: context.workspace.dir,
      },
      personality: {
        present: personalityFiles.length > 0,
        files: personalityFiles,
      },
      editor,
      shouldOnboard: personalityFiles.length === 0,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

function uploadEntries(formData: FormData): PersonalityOnboardingUpload[] {
  const entries = formData.getAll("files");
  if (
    entries.some(
      (entry) =>
        typeof entry === "string" ||
        typeof entry.arrayBuffer !== "function" ||
        typeof entry.name !== "string",
    )
  ) {
    throw new PersonalityOnboardingError(
      "One or more attachments are invalid.",
      "INVALID_ATTACHMENT",
    );
  }
  return entries as File[];
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData().catch(() => null);
    if (!formData) {
      throw new PersonalityOnboardingError(
        "A multipart onboarding request is required.",
        "INVALID_BODY",
      );
    }
    const requestId = String(formData.get("requestId") ?? "").trim();
    const brief = String(formData.get("brief") ?? "");
    const files = uploadEntries(formData);
    validatePersonalityOnboardingInput({ requestId, brief, files });

    const [context, editor] = await Promise.all([
      resolvePersonalityWorkspaceContext(),
      probePersonalityEditorCapability(),
    ]);
    if (editor.state !== "available" || !editor.limits) {
      throw new PersonalityEditorHandoffError(
        editor.state === "not_granted"
          ? "Signals needs permission to open the RealTimeX Personality editor."
          : "This RealTimeX version does not support Personality editor handoff yet.",
        "PERSONALITY_EDITOR_UNAVAILABLE",
        503,
        { capability: editor.state, reason: editor.reason ?? null },
      );
    }
    if (files.length > editor.limits.maxAttachmentCount) {
      throw new PersonalityOnboardingError(
        `RealTimeX accepts up to ${editor.limits.maxAttachmentCount} attachments.`,
        "TOO_MANY_ATTACHMENTS",
        413,
      );
    }
    const oversizedForHost = files.find(
      (file) => file.size > editor.limits!.maxAttachmentBytes,
    );
    if (oversizedForHost) {
      throw new PersonalityOnboardingError(
        `RealTimeX cannot accept an attachment this large: ${oversizedForHost.name}`,
        "ATTACHMENT_TOO_LARGE",
        413,
        { name: oversizedForHost.name },
      );
    }
    const totalAttachmentBytes = files.reduce((total, file) => total + file.size, 0);
    if (totalAttachmentBytes > editor.limits.maxTotalAttachmentBytes) {
      throw new PersonalityOnboardingError(
        "These attachments exceed the RealTimeX Personality editor total size limit.",
        "ATTACHMENTS_TOO_LARGE",
        413,
      );
    }

    const taskPrompt = buildPersonalityOnboardingTaskPrompt(brief);
    if (
      brief.length > PERSONALITY_ONBOARDING_MAX_BRIEF_CHARS ||
      taskPrompt.length > editor.limits.maxTaskPromptChars
    ) {
      throw new PersonalityOnboardingError(
        "Your introduction is too long for the RealTimeX Personality editor.",
        "BRIEF_TOO_LARGE",
        413,
      );
    }
    const staged = await stagePersonalityOnboardingFiles({
      workspace: context.workspace,
      requestId,
      files,
    });
    const result = await openWorkspacePersonalityEditor({
      requestId,
      workspace: context.workspace,
      taskPrompt,
      attachmentPaths: staged.attachmentPaths,
    });

    return NextResponse.json({
      success: true,
      requestId: result.requestId,
      replayed: result.replayed,
      sessionId: result.sessionId,
      workspace: {
        id: context.workspace.id,
        slug: context.workspace.slug,
        displayName: context.displayName,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
