/** Polymorphic attachment parent types (contact-golden-record §2.3). */
export const ATTACHMENT_PARENTS = [
  "interaction",
  "contact",
  "org",
  "content_item",
] as const;

export type AttachmentParentType = (typeof ATTACHMENT_PARENTS)[number];

export const ATTACHMENT_ROLES = [
  "attachment",
  "avatar",
  "thumbnail",
  "evidence",
] as const;

export type AttachmentRole = (typeof ATTACHMENT_ROLES)[number];

export function isAttachmentParentType(value: string): value is AttachmentParentType {
  return (ATTACHMENT_PARENTS as readonly string[]).includes(value);
}

export function assertAttachmentParentType(value: string): AttachmentParentType {
  if (!isAttachmentParentType(value)) {
    throw new Error(`Invalid attachment parent type: ${value}`);
  }
  return value;
}

export function isAttachmentRole(value: string): value is AttachmentRole {
  return (ATTACHMENT_ROLES as readonly string[]).includes(value);
}

export function assertAttachmentRole(value: string): AttachmentRole {
  if (!isAttachmentRole(value)) {
    throw new Error(`Invalid attachment role: ${value}`);
  }
  return value;
}
