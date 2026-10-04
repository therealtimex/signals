import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getInvalidJsonBodyError } from "@/lib/api/contact-route-validation";
import {
  ChannelDuplicateError,
  ChannelValueError,
  contactChannelCreateSchema,
  createChannelForContact,
  describeZodError,
} from "@/lib/contact-channels-api";
import { listContactChannels } from "@/lib/db/queries/contact-channels";
import { getContactById } from "@/lib/db/queries/contacts";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!getContactById(id)) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }
  return NextResponse.json(listContactChannels(id));
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    if (!getContactById(id)) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    const body: unknown = await req.json().catch(() => null);
    const bodyError = getInvalidJsonBodyError(body);
    if (bodyError) {
      return NextResponse.json({ error: bodyError }, { status: 400 });
    }

    const channel = createChannelForContact(id, contactChannelCreateSchema.parse(body));
    return NextResponse.json(channel, { status: 201 });
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
