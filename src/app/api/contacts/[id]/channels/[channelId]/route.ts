import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getInvalidJsonBodyError } from "@/lib/api/contact-route-validation";
import {
  CHANNEL_TYPE_IMMUTABLE_MESSAGE,
  ChannelDuplicateError,
  ChannelValueError,
  contactChannelPatchSchema,
  deleteChannelForContact,
  describeZodError,
  updateChannelForContact,
} from "@/lib/contact-channels-api";
import { getContactById } from "@/lib/db/queries/contacts";

type Params = { params: Promise<{ id: string; channelId: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id, channelId } = await params;
  try {
    if (!getContactById(id)) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    const body: unknown = await req.json().catch(() => null);
    const bodyError = getInvalidJsonBodyError(body);
    if (bodyError) {
      return NextResponse.json({ error: bodyError }, { status: 400 });
    }
    if ("channelType" in (body as Record<string, unknown>)) {
      return NextResponse.json({ error: CHANNEL_TYPE_IMMUTABLE_MESSAGE }, { status: 400 });
    }

    const channel = updateChannelForContact(id, channelId, contactChannelPatchSchema.parse(body));
    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }
    return NextResponse.json(channel);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: describeZodError(error) }, { status: 400 });
    }
    if (error instanceof ChannelValueError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof ChannelDuplicateError) {
      return NextResponse.json(
        { error: error.message, code: error.code, details: { channelId: error.channelId } },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id, channelId } = await params;
  if (!getContactById(id)) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }
  if (!deleteChannelForContact(id, channelId)) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  }
  return new NextResponse(null, { status: 204 });
}
