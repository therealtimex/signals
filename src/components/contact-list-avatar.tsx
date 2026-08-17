import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { contactDisplayInitials } from "@/lib/contact-avatar-client";
import type { ContactDTO } from "@/lib/db/queries/contact-dto";

type ContactListAvatarProps = {
  contact: Pick<ContactDTO, "name" | "firstName" | "lastName" | "resolvedAvatarUrl">;
};

export function ContactListAvatar({ contact }: ContactListAvatarProps) {
  const initials = contactDisplayInitials({
    name: contact.name,
    firstName: contact.firstName ?? undefined,
    lastName: contact.lastName ?? undefined,
  });

  return (
    <Avatar className="size-9 shrink-0">
      {contact.resolvedAvatarUrl ? (
        <AvatarImage src={contact.resolvedAvatarUrl} alt="" />
      ) : null}
      <AvatarFallback>{initials}</AvatarFallback>
    </Avatar>
  );
}
