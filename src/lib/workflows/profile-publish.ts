/**
 * "Profile Publishing & Repost" — multi-platform broadcasting to the operator's own timelines.
 *
 * The inbound counterpart to "Social Intent Patrol" (src/lib/workflows/social-patrol.ts): that
 * template hunts other people's threads, this one publishes to the acting profiles' own feeds and
 * curates quote-posts/reposts across every selected network in a single run.
 *
 * The slider bounds, defaults, and run-config shape live here so the activate dialog, the seed
 * template, and the launch brief cannot drift apart.
 */

import {
  MAX_TAG_COUNT,
  clampSlider,
  normalizeIdList,
  normalizeTagList,
  type SliderBounds,
} from "@/lib/workflows/template-field-utils";

export const PROFILE_PUBLISH_TEMPLATE_NAME = "Profile Publishing & Repost";

/** Marker key in a template config that switches the activate dialog to the publishing form. */
export const PROFILE_PUBLISH_CONFIG_KEY = "profilePublish";

export const PROFILE_PUBLISH_CONFIG_VERSION = 1;

/** Cross-posting fan-out ceiling for one run. */
export const MAX_PUBLISH_TARGETS = 10;

/** Guard against a runaway instruction blob riding into every agent brief. */
export const MAX_INSTRUCTIONS_LENGTH = 4000;

export type ProfilePublishSliderKey = "maxOriginalPosts" | "maxReposts";

/** Per-profile publishing budget — the bounds come from the template contract. */
export const PROFILE_PUBLISH_SLIDERS: Record<ProfilePublishSliderKey, SliderBounds> = {
  maxOriginalPosts: { min: 0, max: 3, step: 1, fallback: 1 },
  maxReposts: { min: 0, max: 5, step: 1, fallback: 1 },
};

/**
 * Voice presets. `brief` is what reaches the agent — the label alone ("Punchy Tips") does not
 * tell it what to actually write.
 */
export const PROFILE_PUBLISH_TONES = [
  {
    value: "technical",
    label: "Technical Teardown",
    brief: "explain the mechanism — what broke, why, and the concrete fix, with specifics over adjectives",
  },
  {
    value: "founder",
    label: "Founder Story",
    brief: "first-person build narrative — the decision, the tradeoff, and what it cost to learn",
  },
  {
    value: "punchy_tips",
    label: "Punchy Tips",
    brief: "short, scannable, one actionable idea per line — no windup",
  },
  {
    value: "story",
    label: "Casual",
    brief: "conversational and human — write it the way you would tell a friend",
  },
] as const;

export type ProfilePublishTone = (typeof PROFILE_PUBLISH_TONES)[number]["value"];

export const DEFAULT_PROFILE_PUBLISH_TONE: ProfilePublishTone = "technical";

/** The tone entry itself — `PROFILE_PUBLISH_TONES` is exhaustive over `ProfilePublishTone`. */
function toneSpec(tone: ProfilePublishTone): (typeof PROFILE_PUBLISH_TONES)[number] {
  return PROFILE_PUBLISH_TONES.find((entry) => entry.value === tone) ?? PROFILE_PUBLISH_TONES[0];
}

export interface ProfilePublishConfig {
  /** `platform_targets.id` of every acting profile this run cross-posts to. */
  targetIds: string[];
  /** Raw operator talking points, release notes, or prompt guidance. */
  instructions: string;
  /** Local folder holding markdown notes, screenshots, and media assets. */
  sourceFolderPath?: string;
  /** Original timeline posts per selected profile. */
  maxOriginalPosts: number;
  /** Curated quote-posts / reposts per selected profile. */
  maxReposts: number;
  /**
   * Focus topics and keyword tags.
   *
   * `topics` and `tone` are also generic `content` template-limit keys
   * (src/lib/workflows/template-config.ts). A *duplicated* publish template edited through the
   * builder's free-text Tone input therefore stores an arbitrary string here, which
   * `readProfilePublishTone` coerces back to the default. Values left alone round-trip fine.
   */
  topics: string[];
  tone: ProfilePublishTone;
  /** Render drafts in the thread and wait for a go-ahead before publishing. */
  requireApproval: boolean;
}

export function isProfilePublishTemplateConfig(config: Record<string, unknown>): boolean {
  return Boolean(config[PROFILE_PUBLISH_CONFIG_KEY]);
}

/** Snap to the slider's step grid, then clamp into range. */
export function clampProfilePublishSlider(
  key: ProfilePublishSliderKey,
  value: unknown,
): number {
  return clampSlider(PROFILE_PUBLISH_SLIDERS[key], value);
}

export function readProfilePublishTone(value: unknown): ProfilePublishTone {
  return PROFILE_PUBLISH_TONES.some((tone) => tone.value === value)
    ? (value as ProfilePublishTone)
    : DEFAULT_PROFILE_PUBLISH_TONE;
}

export function profilePublishToneLabel(tone: ProfilePublishTone): string {
  return toneSpec(tone).label;
}

/** Read stored template/run config into a fully-populated, in-range publishing config. */
export function readProfilePublishConfig(
  config: Record<string, unknown>,
): ProfilePublishConfig {
  const sourceFolderPath =
    typeof config.sourceFolderPath === "string" ? config.sourceFolderPath.trim() : "";
  return {
    targetIds: normalizeIdList(config.targetIds, MAX_PUBLISH_TARGETS),
    instructions:
      typeof config.instructions === "string"
        ? config.instructions.trim().slice(0, MAX_INSTRUCTIONS_LENGTH)
        : "",
    ...(sourceFolderPath ? { sourceFolderPath } : {}),
    maxOriginalPosts: clampProfilePublishSlider("maxOriginalPosts", config.maxOriginalPosts),
    maxReposts: clampProfilePublishSlider("maxReposts", config.maxReposts),
    topics: normalizeTagList(config.topics),
    tone: readProfilePublishTone(config.tone),
    // The publish gate stays on unless the operator explicitly turned it off.
    requireApproval: config.requireApproval !== false,
  };
}

/**
 * Build the `config` payload posted to `POST /api/workflows/templates/[id]/run`.
 * Re-clamps the draft so a hand-edited or stale dialog state cannot widen the guardrails.
 */
export function buildProfilePublishRunConfig(
  draft: ProfilePublishConfig,
): Record<string, unknown> {
  return {
    targetIds: normalizeIdList(draft.targetIds, MAX_PUBLISH_TARGETS),
    instructions: draft.instructions.trim().slice(0, MAX_INSTRUCTIONS_LENGTH),
    sourceFolderPath: draft.sourceFolderPath?.trim() || null,
    maxOriginalPosts: clampProfilePublishSlider("maxOriginalPosts", draft.maxOriginalPosts),
    maxReposts: clampProfilePublishSlider("maxReposts", draft.maxReposts),
    topics: normalizeTagList(draft.topics),
    tone: readProfilePublishTone(draft.tone),
    requireApproval: draft.requireApproval !== false,
  };
}

/** Default config stored on the seeded template. */
export function buildProfilePublishTemplateConfig(): Record<string, unknown> {
  return {
    [PROFILE_PUBLISH_CONFIG_KEY]: { version: PROFILE_PUBLISH_CONFIG_VERSION },
    targetIds: [],
    instructions: "",
    sourceFolderPath: null,
    maxOriginalPosts: PROFILE_PUBLISH_SLIDERS.maxOriginalPosts.fallback,
    maxReposts: PROFILE_PUBLISH_SLIDERS.maxReposts.fallback,
    topics: [],
    tone: DEFAULT_PROFILE_PUBLISH_TONE,
    requireApproval: true,
  };
}

/**
 * Execution contract appended to the launch brief.
 *
 * Every publish action — originals on X/LinkedIn/Facebook and X reposts/quote-posts — goes through
 * the deterministic publish-job lane (`/api/content/send-to-agent`). The signals-publish skill
 * dispatches on job kind and platform.
 *
 * The media hop is spelled out for the same reason. A publish job carries `mediaAssetIds`, not
 * file paths, and no agent-tool uploads a local file — `get_publish_job` resolves an id it does
 * not know to `path: null`, so an agent that skips the upload silently ships a post with no
 * image (src/lib/agent-tools/publish-handlers.ts:116).
 */
export function buildProfilePublishBriefSection(input: {
  workflowRunId: string;
  config: Record<string, unknown>;
  signalsBaseUrl: string;
}): string {
  const publish = readProfilePublishConfig(input.config);
  const tone = toneSpec(publish.tone);
  const targets = publish.targetIds.length > 0
    ? publish.targetIds.join(", ")
    : "<no acting profile selected — stop and ask the operator which profiles to publish to>";

  const lines = [
    "Profile Publishing & Repost execution contract:",
    "B0. This run broadcasts to the acting profiles' own timelines. Do not patrol communities or cold-comment on strangers' posts — that is the \"Social Intent Patrol\" template's job.",
    `B1. Cross-post to every selected acting profile: ${targets}`,
    "    Resolve each one first (list_platform_targets, or signals-pp-cli targets get <targetId>) so you know its platform and handle before drafting — the same idea ships in a different shape per network.",
    publish.instructions
      ? `B2. Operator instructions (this is the source material — do not invent a different topic):\n${indentBlock(publish.instructions)}`
      : "B2. No operator instructions were provided. Draft from the topics below plus recent Signals content for this profile, and show the plan before writing.",
    publish.sourceFolderPath
      ? `B3. Scan ${publish.sourceFolderPath} for deeper context: read .md and .txt notes, and attach matching .png/.jpg assets to the post they belong to. Never attach an asset you cannot tie to a specific claim in the draft.`
      : "B3. No source folder configured — draft from the instructions and topics alone, and publish without media unless the operator supplies some.",
    "B4. Upload every asset you intend to attach before you draft the publish call — a publish job carries media asset ids, not file paths, and there is no agent-tool that uploads one:",
    `    a. POST ${input.signalsBaseUrl}/api/media as multipart/form-data with file=@<local path>, context=compose, and platformTarget set to the platform you are attaching it to. The 201 response is the created asset; its \`id\` is what goes into mediaAssetIds.`,
    "    b. platformTarget accepts x, linkedin, or facebook and selects the size and type limits the file is checked against (X: 5 MB, 4 images; LinkedIn/Facebook: 10 MB, up to 9–10 images; JPEG/PNG/GIF/WebP or MP4). Upload the file once per platform you attach it to so each asset is checked against that platform's limits.",
    "    c. Never invent or reuse an id you did not get back from /api/media — an unknown id resolves to no media and the post ships without the image.",
    publish.topics.length > 0
      ? `B5. Focus topics: ${publish.topics.join(", ")}. Tone: ${tone.label} — ${tone.brief}.`
      : `B5. No focus topics configured — follow the operator instructions. Tone: ${tone.label} — ${tone.brief}.`,
    `B6. Budget per selected profile: at most ${publish.maxOriginalPosts} original timeline post(s) and ${publish.maxReposts} curated quote-post/repost(s).`,
    publish.maxOriginalPosts === 0
      ? "    maxOriginalPosts is 0 — this is a curation-only run. Quote and repost other people's work; publish nothing original."
      : null,
    publish.maxReposts === 0
      ? "    maxReposts is 0 — original posts only. Do not quote or repost anything."
      : null,
    "B7. Platform-native drafting — same substance, native shape: X is a punchy thread with a standalone hook post; LinkedIn is structured takeaways with line breaks and a closing question; Facebook is one conversational post with no jargon shorthand. Never cross-post identical text.",
    publish.requireApproval
      ? "B8. Approval gate is ON: post every draft in this thread grouped by target profile and wait for explicit confirmation before publishing anything."
      : "B8. Approval gate is OFF: publish the drafts directly, and log each one in this thread as it goes out.",
    "B9. Publish every draft through the deterministic publish-job lane (original posts on any selected platform; X reposts and quote-posts):",
    `    a. POST ${input.signalsBaseUrl}/api/content with the draft (contentType "post" or "thread", status "draft", origin "authored", direction "outbound").`,
    `    b. POST ${input.signalsBaseUrl}/api/content/send-to-agent with { contentItemId, targets: [{ targetId }], text, mediaAssetIds, kind, sourcePostUrl? | sourcePostId? }.`,
    "       - Original posts: omit kind (defaults to \"original\") or set kind: \"original\"; include text and mediaAssetIds from B4.",
    "       - X reposts: kind: \"repost\" plus sourcePostUrl or sourcePostId for the post to amplify; text may be empty.",
    "       - X quote-posts: kind: \"quote\" plus sourcePostUrl or sourcePostId and text as your comment.",
    "       That opens the publish job and hands it to the signals-publish lane. Record the returned jobId here.",
    `B10. Attribute every published item to workflow run ${input.workflowRunId} when you create or update content rows, then summarize what went live per profile with links in this thread.`,
  ];

  return lines.filter((line) => line !== null).join("\n");
}

function indentBlock(text: string): string {
  return text
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}
