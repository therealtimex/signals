import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/contacts/[id]/channels/route";
import { DELETE, PATCH } from "@/app/api/contacts/[id]/channels/[channelId]/route";
import { createContact } from "@/lib/db/queries/contacts";
import {
  createContactChannel,
  getContactChannelById,
  listContactChannels,
} from "@/lib/db/queries/contact-channels";
import type { ContactChannel } from "@/lib/db/types";
import { resetCoreTables } from "@/test/db";

function jsonRequest(method: string, path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function post(contactId: string, body: unknown) {
  return POST(jsonRequest("POST", `/api/contacts/${contactId}/channels`, body), {
    params: Promise.resolve({ id: contactId }),
  });
}

async function patch(contactId: string, channelId: string, body: unknown) {
  return PATCH(jsonRequest("PATCH", `/api/contacts/${contactId}/channels/${channelId}`, body), {
    params: Promise.resolve({ id: contactId, channelId }),
  });
}

async function remove(contactId: string, channelId: string) {
  return DELETE(new NextRequest(`http://localhost/api/contacts/${contactId}/channels/${channelId}`), {
    params: Promise.resolve({ id: contactId, channelId }),
  });
}

function metadataOf(channel: ContactChannel | undefined): Record<string, unknown> {
  return JSON.parse(channel?.metadata ?? "{}") as Record<string, unknown>;
}

describe("/api/contacts/[id]/channels", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("creates a channel with the API source and lists primaries first", async () => {
    const contact = createContact({ name: "Bui Sy Giang" });

    const phone = await post(contact.id, { channelType: "phone", value: "+84 91 303 9986" });
    expect(phone.status).toBe(201);
    const email = await post(contact.id, {
      channelType: "email",
      value: "bui-sy.giang@mes-engineering.com.vn",
      label: "work",
      isPrimary: true,
    });
    expect(email.status).toBe(201);
    const created = (await email.json()) as ContactChannel;
    expect(created).toMatchObject({
      channelType: "email",
      label: "work",
      isPrimary: true,
      isVerified: false,
      source: "api:contact_channels",
    });

    const list = await GET(new NextRequest(`http://localhost/api/contacts/${contact.id}/channels`), {
      params: Promise.resolve({ id: contact.id }),
    });
    expect(list.status).toBe(200);
    const rows = (await list.json()) as ContactChannel[];
    expect(rows.map((row) => row.channelType)).toEqual(["email", "phone"]);
  });

  it("returns 404 for an unknown contact", async () => {
    const list = await GET(new NextRequest("http://localhost/api/contacts/missing/channels"), {
      params: Promise.resolve({ id: "missing" }),
    });
    expect(list.status).toBe(404);
    expect((await post("missing", { channelType: "email", value: "a@b.co" })).status).toBe(404);
  });

  it("rejects invalid bodies with a readable 400", async () => {
    const contact = createContact({ name: "Validation" });

    const unknownType = await post(contact.id, { channelType: "fax", value: "123" });
    expect(unknownType.status).toBe(400);
    expect((await unknownType.json()).error).toContain("channelType");

    const empty = await post(contact.id, { channelType: "email", value: "   " });
    expect(empty.status).toBe(400);
    expect((await empty.json()).error).toContain("Channel value is required");

    const junkPhone = await post(contact.id, { channelType: "phone", value: "call me" });
    expect(junkPhone.status).toBe(400);
    expect((await junkPhone.json()).error).toBe("Channel value is not a valid phone");

    expect((await post(contact.id, "not json")).status).toBe(400);
    expect((await post(contact.id, [1, 2])).status).toBe(400);
    expect(listContactChannels(contact.id)).toHaveLength(0);
  });

  it("returns 409 CHANNEL_DUPLICATE on create and on a value change", async () => {
    const contact = createContact({ name: "Duplicate" });
    const first = createContactChannel({
      contactId: contact.id,
      channelType: "email",
      value: "giang@mes-engineering.com.vn",
      source: "test",
    });
    const second = createContactChannel({
      contactId: contact.id,
      channelType: "email",
      value: "giang@gmail.com",
      source: "test",
    });

    const dup = await post(contact.id, { channelType: "email", value: "Giang@MES-Engineering.com.vn" });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toEqual({
      error: "This contact already has that channel",
      code: "CHANNEL_DUPLICATE",
      details: { channelId: first.id },
    });

    const clash = await patch(contact.id, second.id, { value: " GIANG@mes-engineering.com.vn " });
    expect(clash.status).toBe(409);
    expect((await clash.json()).details).toEqual({ channelId: first.id });
    expect(getContactChannelById(second.id)?.value).toBe("giang@gmail.com");

    // Re-saving a row's own value is not a duplicate of itself.
    const same = await patch(contact.id, first.id, { value: "giang@mes-engineering.com.vn" });
    expect(same.status).toBe(200);
  });

  it("treats a channel on another contact as missing", async () => {
    const owner = createContact({ name: "Owner" });
    const other = createContact({ name: "Other" });
    const foreign = createContactChannel({
      contactId: other.id,
      channelType: "phone",
      value: "+84913039986",
      source: "test",
    });

    expect((await patch(owner.id, foreign.id, { label: "work" })).status).toBe(404);
    expect((await remove(owner.id, foreign.id)).status).toBe(404);
    expect(getContactChannelById(foreign.id)?.label).toBeNull();
  });

  it("refuses a type change", async () => {
    const contact = createContact({ name: "Immutable" });
    const channel = createContactChannel({
      contactId: contact.id,
      channelType: "phone",
      value: "+84913039986",
      source: "test",
    });

    const res = await patch(contact.id, channel.id, { channelType: "zalo" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Channel type cannot change");
    expect(getContactChannelById(channel.id)?.channelType).toBe("phone");
  });

  it("moves the primary flag within a type", async () => {
    const contact = createContact({ name: "Primary Mover" });
    const work = createContactChannel({
      contactId: contact.id,
      channelType: "email",
      value: "work@example.com",
      isPrimary: true,
      source: "test",
    });
    const personal = createContactChannel({
      contactId: contact.id,
      channelType: "email",
      value: "personal@example.com",
      source: "test",
    });
    const phone = createContactChannel({
      contactId: contact.id,
      channelType: "phone",
      value: "+84913039986",
      isPrimary: true,
      source: "test",
    });

    const res = await patch(contact.id, personal.id, { isPrimary: true });
    expect(res.status).toBe(200);
    expect(getContactChannelById(personal.id)?.isPrimary).toBe(true);
    expect(getContactChannelById(work.id)?.isPrimary).toBe(false);
    expect(getContactChannelById(phone.id)?.isPrimary).toBe(true);
  });

  it("stamps manual verification on, removes it off, and keeps probe provenance on re-save", async () => {
    const contact = createContact({ name: "Verifier" });
    const created = await post(contact.id, {
      channelType: "email",
      value: "verified@example.com",
      isVerified: true,
    });
    const channel = (await created.json()) as ContactChannel;
    expect(channel.isVerified).toBe(true);
    expect(metadataOf(channel).verification).toEqual({ method: "manual", at: expect.any(Number) });

    const off = await patch(contact.id, channel.id, { isVerified: false });
    expect(off.status).toBe(200);
    const unverified = getContactChannelById(channel.id);
    expect(unverified?.isVerified).toBe(false);
    expect(metadataOf(unverified)).not.toHaveProperty("verification");

    const probed = createContactChannel({
      contactId: contact.id,
      channelType: "email",
      value: "probed@example.com",
      isVerified: true,
      source: "enrich:email_pattern",
      metadata: { pattern: "first.last" },
    });
    const resave = await patch(contact.id, probed.id, { isVerified: true, label: "work" });
    expect(resave.status).toBe(200);
    expect(metadataOf(getContactChannelById(probed.id))).toEqual({ pattern: "first.last" });

    const unprobed = createContactChannel({
      contactId: contact.id,
      channelType: "phone",
      value: "+84913039986",
      source: "test",
      metadata: { carrier: "viettel" },
    });
    await patch(contact.id, unprobed.id, { isVerified: true });
    expect(metadataOf(getContactChannelById(unprobed.id))).toEqual({
      carrier: "viettel",
      verification: { method: "manual", at: expect.any(Number) },
    });
  });

  it("drops a verification that described the old address when the value changes", async () => {
    const contact = createContact({ name: "Readdressed" });
    const probed = createContactChannel({
      contactId: contact.id,
      channelType: "email",
      value: "giang@mes-engineering.com.vn",
      isVerified: true,
      source: "enrich:email_pattern",
      metadata: { candidateId: "cand-1", verification: { method: "smtp_probe", at: 1 } },
    });

    // A case-only edit is the same address: verification stays.
    expect((await patch(contact.id, probed.id, { value: "Giang@MES-Engineering.com.vn" })).status).toBe(200);
    expect(getContactChannelById(probed.id)?.isVerified).toBe(true);
    expect(metadataOf(getContactChannelById(probed.id)).verification).toEqual({ method: "smtp_probe", at: 1 });

    // A new address starts unverified; other provenance stays.
    expect((await patch(contact.id, probed.id, { value: "bui-sy.giang@mes-engineering.com.vn" })).status).toBe(200);
    const readdressed = getContactChannelById(probed.id);
    expect(readdressed?.isVerified).toBe(false);
    expect(metadataOf(readdressed)).toEqual({ candidateId: "cand-1" });

    // Verifying the new address in the same request records a manual verification of it.
    const other = createContactChannel({
      contactId: contact.id,
      channelType: "phone",
      value: "+84913039986",
      isVerified: true,
      source: "enrich:email_pattern",
      metadata: { verification: { method: "smtp_probe", at: 1 } },
    });
    await patch(contact.id, other.id, { value: "+84 91 303 9987", isVerified: true });
    const reverified = getContactChannelById(other.id);
    expect(reverified?.isVerified).toBe(true);
    expect(metadataOf(reverified).verification).toEqual({ method: "manual", at: expect.any(Number) });
  });

  it("clears a label with an empty string", async () => {
    const contact = createContact({ name: "Labeler" });
    const channel = createContactChannel({
      contactId: contact.id,
      channelType: "email",
      value: "label@example.com",
      label: "work",
      source: "test",
    });

    const res = await patch(contact.id, channel.id, { label: "" });
    expect(res.status).toBe(200);
    expect(getContactChannelById(channel.id)?.label).toBeNull();
  });

  it("deletes with 204 and 404s the second time", async () => {
    const contact = createContact({ name: "Remover" });
    const channel = createContactChannel({
      contactId: contact.id,
      channelType: "zalo",
      value: "0913039986",
      source: "test",
    });

    expect((await remove(contact.id, channel.id)).status).toBe(204);
    expect(getContactChannelById(channel.id)).toBeUndefined();
    expect((await remove(contact.id, channel.id)).status).toBe(404);
  });
});
