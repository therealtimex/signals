import type {
  ContactExploreContact,
  ContactExploreIdentity,
  ContactExploreOrg,
  ContactExploreRelationship,
} from "@/lib/db/queries/contact-explore";
import { formatAccountAge, platformLabels } from "@/components/explore/explore-format";
import { ExplorePlatformHandle } from "@/components/explore/explore-platform-handle";
import { Badge } from "@/components/ui/badge";

type ExploreIdentityHeaderProps = {
  contact: ContactExploreContact;
  primaryIdentity: ContactExploreIdentity | null;
  relationship: ContactExploreRelationship | null;
  org: ContactExploreOrg | null;
};

export function ExploreIdentityHeader({
  contact,
  primaryIdentity,
  relationship,
  org,
}: ExploreIdentityHeaderProps) {
  const avatarUrl = primaryIdentity?.avatarUrl ?? contact.avatarUrl;
  const displayName = primaryIdentity?.displayName ?? contact.name;
  const handle = primaryIdentity?.platformHandle;
  const location = primaryIdentity?.location ?? contact.location;
  const bio = primaryIdentity?.bio;
  const platformLabel = primaryIdentity
    ? (platformLabels[primaryIdentity.platform] ?? primaryIdentity.platform)
    : null;
  const accountAge =
    primaryIdentity?.platformCreatedAt != null && platformLabel
      ? formatAccountAge(primaryIdentity.platformCreatedAt, platformLabel)
      : null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-start gap-3">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt=""
            className="h-12 w-12 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-sm font-medium">
            {displayName.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{displayName}</span>
            {primaryIdentity?.isVerified && (
              <Badge variant="secondary" className="text-xs">
                Verified
              </Badge>
            )}
            {relationship && <Badge variant="outline">{relationship.label}</Badge>}
            {org && (
              <a
                href={`/dashboard/organizations/${org.id}`}
                className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs hover:bg-muted"
              >
                @ {org.name}
              </a>
            )}
          </div>
          <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {handle && (
              <ExplorePlatformHandle
                handle={handle}
                platformUrl={primaryIdentity?.platformUrl ?? null}
              />
            )}
            {location && <span>{location}</span>}
            {accountAge && <span>{accountAge}</span>}
          </div>
          {bio && <p className="line-clamp-2 text-sm text-muted-foreground">{bio}</p>}
        </div>
      </div>
    </div>
  );
}
