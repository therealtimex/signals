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

/** Identity avatarUrl must be an external https URL from a synced platform — not local paths. */
export function validateIdentityAvatarUrl(avatarUrl: string | undefined): string | undefined {
  if (avatarUrl === undefined) return undefined;

  const trimmed = avatarUrl.trim();
  if (!trimmed) return undefined;

  if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) {
    return trimmed;
  }

  throw new Error(
    "avatarUrl must be an http(s) URL from a synced platform. For generated or local images, upload via upload-avatar.sh (POST /api/media + role=avatar attachment) instead of setting avatarUrl.",
  );
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
