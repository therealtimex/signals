import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPlatformAccountByPlatform } from "@/lib/db/queries/platform-accounts";
import { createEngagement } from "@/lib/db/queries/engagements";
import { resolveEngagementTargetContact } from "@/lib/db/queries/engagement-target-contact";
import {
  getAuthenticatedUser,
  likeTweet,
  unlikeTweet,
  retweet,
  unretweet,
  replyToTweet,
  RateLimitError,
  TierRestrictedError,
} from "@/lib/platforms/x/client";

const engageSchema = z.object({
  action: z.enum(["like", "unlike", "retweet", "unretweet", "reply"]),
  tweetId: z.string().min(1),
  contentPostId: z.string().optional(),
  text: z.string().optional(),
});

/**
 * POST /api/platforms/x/engage
 * Perform an engagement action (like, retweet, reply) on a tweet.
 */
export async function POST(req: NextRequest) {
  try {
    const account = getPlatformAccountByPlatform("x");
    // A credential-less row is an archive-import placeholder, not a connection.
    if (!account || !account.credentialsEncrypted) {
      return NextResponse.json({ error: "No X account connected" }, { status: 400 });
    }

    if (account.status === "needs_reauth") {
      return NextResponse.json({ error: "X account needs re-authentication" }, { status: 401 });
    }

    const body = await req.json();
    const { action, tweetId, contentPostId, text } = engageSchema.parse(body);

    if (action === "reply" && !text) {
      return NextResponse.json({ error: "Reply text is required" }, { status: 400 });
    }

    // Get the authenticated user's platform ID (needed for like/retweet endpoints)
    const me = await getAuthenticatedUser(account.id);

    let result: unknown;

    switch (action) {
      case "like":
        result = await likeTweet(account.id, me.id, tweetId);
        break;
      case "unlike":
        result = await unlikeTweet(account.id, me.id, tweetId);
        break;
      case "retweet":
        result = await retweet(account.id, me.id, tweetId);
        break;
      case "unretweet":
        result = await unretweet(account.id, me.id, tweetId);
        break;
      case "reply":
        result = await replyToTweet(account.id, tweetId, text!);
        break;
    }

    // Record the engagement in the database
    const engagementTypeMap = {
      like: "like",
      unlike: "like",
      retweet: "retweet",
      unretweet: "retweet",
      reply: "reply",
    } as const;

    const targetContactId = contentPostId
      ? resolveEngagementTargetContact(contentPostId)
      : null;

    createEngagement({
      contactId: targetContactId,
      platformAccountId: account.id,
      engagementType: engagementTypeMap[action],
      direction: "outbound",
      content: action === "reply" ? text ?? null : null,
      templateId: null,
      workflowRunId: null,
      contentPostId: contentPostId ?? null,
      platform: "x",
      platformEngagementId: null,
      threadId: null,
      source: "manual",
      platformData: JSON.stringify({ action, tweetId, result }),
    });

    return NextResponse.json({ success: true, action, result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    if (error instanceof RateLimitError) {
      return NextResponse.json(
        { error: `Rate limited. Try again in ${error.retryAfter} seconds.`, retryAfter: error.retryAfter },
        { status: 429 }
      );
    }
    if (error instanceof TierRestrictedError) {
      return NextResponse.json(
        { error: "This action requires a higher X API tier.", code: "TIER_RESTRICTED" },
        { status: 403 }
      );
    }
    const message = error instanceof Error ? error.message : "Engagement action failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
