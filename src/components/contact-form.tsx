"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ContactDTO } from "@/lib/db/queries/contact-dto";
import type { DraftContactIdentity } from "@/lib/contact-identity-draft";
import { OrgPicker } from "@/components/org-picker";
import { ContactIdentitiesInput } from "@/components/contact-identities-input";

const funnelStages = ["prospect", "engaged", "qualified", "opportunity", "customer", "advocate"];

interface ContactFormProps {
  defaultValues?: Partial<ContactDTO> & { orgId?: string };
  onChange: (data: Record<string, string>) => void;
  showIdentities?: boolean;
  onIdentitiesChange?: (identities: DraftContactIdentity[]) => void;
}

export function ContactForm({
  defaultValues,
  onChange,
  showIdentities = false,
  onIdentitiesChange,
}: ContactFormProps) {
  function handleChange(field: string, value: string) {
    onChange({ [field]: value });
  }

  function handleNameChange(field: "firstName" | "lastName", value: string) {
    const other =
      field === "firstName"
        ? defaultValues?.lastName ?? ""
        : defaultValues?.firstName ?? "";
    const full =
      field === "firstName"
        ? [value, other].filter(Boolean).join(" ")
        : [other, value].filter(Boolean).join(" ");
    onChange({ [field]: value, name: full });
  }

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label htmlFor="firstName">First Name</Label>
          <Input
            id="firstName"
            defaultValue={defaultValues?.firstName ?? ""}
            onChange={(e) => handleNameChange("firstName", e.target.value)}
            placeholder="First name"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="lastName">Last Name</Label>
          <Input
            id="lastName"
            defaultValue={defaultValues?.lastName ?? ""}
            onChange={(e) => handleNameChange("lastName", e.target.value)}
            placeholder="Last name"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <OrgPicker
          id="organization"
          defaultOrgId={defaultValues?.orgId}
          defaultOrgName={defaultValues?.company ?? ""}
          onChange={(value) => {
            onChange({ orgId: value.orgId, company: value.company });
          }}
        />
        <div className="grid gap-2">
          <Label htmlFor="title">Title</Label>
          <Input
            id="title"
            defaultValue={defaultValues?.title ?? ""}
            onChange={(e) => handleChange("title", e.target.value)}
            placeholder="Job title"
          />
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="headline">Headline</Label>
        <Input
          id="headline"
          defaultValue={defaultValues?.headline ?? ""}
          onChange={(e) => handleChange("headline", e.target.value)}
          placeholder="Professional headline"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            defaultValue={defaultValues?.email ?? ""}
            onChange={(e) => handleChange("email", e.target.value)}
            placeholder="email@example.com"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="phone">Phone</Label>
          <Input
            id="phone"
            defaultValue={defaultValues?.phone ?? ""}
            onChange={(e) => handleChange("phone", e.target.value)}
            placeholder="+1 (555) 000-0000"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label htmlFor="location">Location</Label>
          <Input
            id="location"
            defaultValue={defaultValues?.location ?? ""}
            onChange={(e) => handleChange("location", e.target.value)}
            placeholder="City, Country"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="website">Website</Label>
          <Input
            id="website"
            defaultValue={defaultValues?.website ?? ""}
            onChange={(e) => handleChange("website", e.target.value)}
            placeholder="https://..."
          />
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="funnelStage">Funnel Stage</Label>
        <Select
          defaultValue={defaultValues?.funnelStage ?? "prospect"}
          onValueChange={(v) => handleChange("funnelStage", v)}
        >
          <SelectTrigger id="funnelStage">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {funnelStages.map((s) => (
              <SelectItem key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {showIdentities && onIdentitiesChange ? (
        <ContactIdentitiesInput onChange={onIdentitiesChange} />
      ) : null}

      <div className="grid gap-2">
        <Label htmlFor="bio">Bio</Label>
        <Textarea
          id="bio"
          defaultValue={defaultValues?.bio ?? ""}
          onChange={(e) => handleChange("bio", e.target.value)}
          placeholder="Short bio..."
          rows={3}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="tags">Tags</Label>
        <Input
          id="tags"
          defaultValue={
            defaultValues?.tags
              ? (() => { try { return JSON.parse(defaultValues.tags).join(", "); } catch { return ""; } })()
              : ""
          }
          onChange={(e) =>
            handleChange(
              "tags",
              JSON.stringify(
                e.target.value
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean)
              )
            )
          }
          placeholder="tag1, tag2, tag3"
        />
      </div>
    </div>
  );
}
