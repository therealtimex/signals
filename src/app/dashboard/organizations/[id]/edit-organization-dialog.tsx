"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { normalizeOrgDomain } from "@/lib/orgs/domain";
import type { OrgDTO } from "@/lib/serializers/org";

const orgTypes = ["company", "fund", "team", "community", "other"] as const;
const companySizes = [
  "1-10",
  "11-50",
  "51-200",
  "201-500",
  "501-1000",
  "1001-5000",
  "5001-10000",
  "10001+",
] as const;
const accountStages = [
  "prospect",
  "engaged",
  "qualified",
  "opportunity",
  "customer",
  "advocate",
] as const;

export function EditOrganizationDialog({
  org,
  selfContact,
  open,
  onOpenChange,
  onSaved,
}: {
  org: OrgDTO;
  selfContact: { id: string; name: string } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (org: OrgDTO) => void;
}) {
  const [form, setForm] = useState({
    name: org.name,
    orgType: org.orgType,
    domain: org.domain ?? "",
    website: org.website ?? "",
    location: org.location ?? "",
    description: org.description ?? "",
    avatarUrl: org.avatarUrl ?? "",
    industry: org.industry ?? "",
    companySize: org.companySize ?? "none",
    tags: org.tags.join(", "),
    ownerContactId: org.ownerContactId ?? "none",
    accountStage: org.accountStage ?? "none",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm({
      name: org.name,
      orgType: org.orgType,
      domain: org.domain ?? "",
      website: org.website ?? "",
      location: org.location ?? "",
      description: org.description ?? "",
      avatarUrl: org.avatarUrl ?? "",
      industry: org.industry ?? "",
      companySize: org.companySize ?? "none",
      tags: org.tags.join(", "),
      ownerContactId: org.ownerContactId ?? "none",
      accountStage: org.accountStage ?? "none",
    });
    setError(null);
  }, [open, org]);

  async function save() {
    const domainResult = form.domain.trim() ? normalizeOrgDomain(form.domain) : null;
    if (domainResult && !domainResult.ok) {
      setError(domainResult.message);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/orgs/${org.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          orgType: form.orgType,
          domain: domainResult?.domain ?? null,
          website: form.website.trim() || null,
          location: form.location.trim() || null,
          description: form.description.trim() || null,
          avatarUrl: form.avatarUrl.trim() || null,
          industry: form.industry.trim() || null,
          companySize: form.companySize === "none" ? null : form.companySize,
          tags: form.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
          ownerContactId: form.ownerContactId === "none" ? null : form.ownerContactId,
          accountStage: form.accountStage === "none" ? null : form.accountStage,
          updatedVia: "manual",
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(typeof body.error === "string" ? body.error : "Could not update this company.");
        return;
      }
      onSaved(await response.json() as OrgDTO);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit company</DialogTitle>
          <DialogDescription>Keep the company profile accurate for people and agents.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="edit-company-name">Name</Label>
            <Input id="edit-company-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-company-type">Type</Label>
            <Select value={form.orgType} onValueChange={(value) => setForm({ ...form, orgType: value as typeof form.orgType })}>
              <SelectTrigger id="edit-company-type"><SelectValue /></SelectTrigger>
              <SelectContent>{orgTypes.map((type) => <SelectItem key={type} value={type}>{type[0]!.toUpperCase() + type.slice(1)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-company-domain">Domain</Label>
            <Input id="edit-company-domain" value={form.domain} onChange={(event) => setForm({ ...form, domain: event.target.value })} placeholder="acme.com" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-company-website">Website</Label>
            <Input id="edit-company-website" value={form.website} onChange={(event) => setForm({ ...form, website: event.target.value })} placeholder="https://acme.com" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-company-location">Headquarters</Label>
            <Input id="edit-company-location" value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="San Francisco, CA" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-company-industry">Industry</Label>
            <Input id="edit-company-industry" value={form.industry} onChange={(event) => setForm({ ...form, industry: event.target.value })} placeholder="Financial technology" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-company-size">Company size</Label>
            <Select value={form.companySize} onValueChange={(value) => setForm({ ...form, companySize: value as typeof form.companySize })}>
              <SelectTrigger id="edit-company-size"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not set</SelectItem>
                {companySizes.map((size) => <SelectItem key={size} value={size}>{size} employees</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-company-stage">Account stage</Label>
            <Select value={form.accountStage} onValueChange={(value) => setForm({ ...form, accountStage: value as typeof form.accountStage })}>
              <SelectTrigger id="edit-company-stage"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not set</SelectItem>
                {accountStages.map((stage) => <SelectItem key={stage} value={stage}>{stage[0]!.toUpperCase() + stage.slice(1)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-company-owner">Owner</Label>
            <Select value={form.ownerContactId} onValueChange={(value) => setForm({ ...form, ownerContactId: value })}>
              <SelectTrigger id="edit-company-owner"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Unassigned</SelectItem>
                {selfContact ? <SelectItem value={selfContact.id}>{selfContact.name}</SelectItem> : null}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="edit-company-tags">Tags</Label>
            <Input id="edit-company-tags" value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} placeholder="portfolio, fintech, partner" />
            <p className="text-xs text-muted-foreground">Separate tags with commas.</p>
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="edit-company-logo">Logo URL</Label>
            <Input id="edit-company-logo" value={form.avatarUrl} onChange={(event) => setForm({ ...form, avatarUrl: event.target.value })} placeholder="https://…" />
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="edit-company-description">Description</Label>
            <Textarea id="edit-company-description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={4} />
          </div>
        </div>
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !form.name.trim()}>{saving ? "Saving…" : "Save changes"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
