export function contactDisplayInitials(input: {
  name?: string;
  firstName?: string;
  lastName?: string;
}): string {
  const first = input.firstName?.trim();
  const last = input.lastName?.trim();
  if (first && last) {
    return `${first[0]}${last[0]}`.toUpperCase();
  }

  const name = (input.name ?? [first, last].filter(Boolean).join(" ")).trim();
  if (!name) return "?";

  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return parts[0].slice(0, 2).toUpperCase();
}

export async function uploadAndAttachContactAvatar(
  contactId: string,
  file: File,
): Promise<void> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("context", "attachment");

  const uploadRes = await fetch("/api/media", { method: "POST", body: formData });
  if (!uploadRes.ok) {
    const body = await uploadRes.json().catch(() => null);
    throw new Error(body?.error ?? "Upload failed");
  }
  const asset = (await uploadRes.json()) as { id: string };

  const attachRes = await fetch("/api/media/attachments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mediaAssetId: asset.id,
      parentType: "contact",
      parentId: contactId,
      role: "avatar",
    }),
  });
  if (!attachRes.ok) {
    const body = await attachRes.json().catch(() => null);
    throw new Error(body?.error ?? "Failed to attach avatar");
  }
}
