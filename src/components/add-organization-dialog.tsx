"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Plus } from "lucide-react";
import type { Org } from "@/lib/db/types";

const orgTypes = ["company", "fund", "team", "community", "other"] as const;

interface AddOrganizationDialogProps {
  onCreated?: (org: Org) => void;
}

export function AddOrganizationDialog({ onCreated }: AddOrganizationDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [orgType, setOrgType] = useState<(typeof orgTypes)[number]>("company");
  const [domain, setDomain] = useState("");
  const [website, setWebsite] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");

  function resetForm() {
    setName("");
    setOrgType("company");
    setDomain("");
    setWebsite("");
    setLocation("");
    setDescription("");
    setError(null);
  }

  async function handleSave() {
    if (!name.trim()) return;

    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/orgs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          orgType,
          domain: domain.trim() || null,
          website: website.trim() || null,
          location: location.trim() || null,
          description: description.trim() || null,
          createdVia: "manual",
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(typeof body.error === "string" ? body.error : "Failed to save organization");
        return;
      }

      const org = (await res.json()) as Org;
      setOpen(false);
      resetForm();
      onCreated?.(org);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) resetForm();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Add Company
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Company</DialogTitle>
          <DialogDescription>Create a company, fund, team, or community in your graph.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="orgName">Name</Label>
            <Input
              id="orgName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Corp"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="orgType">Type</Label>
              <Select value={orgType} onValueChange={(v) => setOrgType(v as typeof orgType)}>
                <SelectTrigger id="orgType">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {orgTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="orgDomain">Domain</Label>
              <Input
                id="orgDomain"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="acme.com"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="orgWebsite">Website</Label>
              <Input
                id="orgWebsite"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://..."
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="orgLocation">Location</Label>
              <Input
                id="orgLocation"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="City, Country"
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="orgDescription">Description</Label>
            <Textarea
              id="orgDescription"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this company do?"
              rows={3}
            />
          </div>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? "Saving..." : "Save Company"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
