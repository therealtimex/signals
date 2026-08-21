"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPlatformHandle } from "@/lib/contact-identity-handle";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Trash2, ExternalLink } from "lucide-react";
import type { ContactIdentity } from "@/lib/db/types";

const platformLabels: Record<string, string> = {
  x: "X / Twitter",
  linkedin: "LinkedIn",
  gmail: "Gmail",
  substack: "Substack",
};

interface IdentitiesSectionProps {
  contactId: string;
  identities: ContactIdentity[];
}

export function IdentitiesSection({ contactId, identities }: IdentitiesSectionProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    platform: "x" as "x" | "linkedin" | "gmail" | "substack",
    platformUserId: "",
    platformHandle: "",
    platformUrl: "",
  });

  async function handleAdd() {
    if (!form.platformUserId) return;
    setAdding(true);
    try {
      const res = await fetch(`/api/contacts/${contactId}/identities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setOpen(false);
        setForm({ platform: "x", platformUserId: "", platformHandle: "", platformUrl: "" });
        router.refresh();
      }
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(identityId: string) {
    await fetch(`/api/contacts/${contactId}/identities/${identityId}`, {
      method: "DELETE",
    });
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">Platform Identities</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">
              <Plus className="mr-2 h-4 w-4" />
              Add Identity
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Platform Identity</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label>Platform</Label>
                <Select
                  value={form.platform}
                  onValueChange={(v) =>
                    setForm({ ...form, platform: v as typeof form.platform })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(platformLabels).map(([k, v]) => (
                      <SelectItem key={k} value={k}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>User ID *</Label>
                <Input
                  value={form.platformUserId}
                  onChange={(e) =>
                    setForm({ ...form, platformUserId: e.target.value })
                  }
                  placeholder="Platform user ID"
                />
              </div>
              <div className="grid gap-2">
                <Label>Handle</Label>
                <Input
                  value={form.platformHandle}
                  onChange={(e) =>
                    setForm({ ...form, platformHandle: e.target.value })
                  }
                  placeholder="Handle without @"
                />
              </div>
              <div className="grid gap-2">
                <Label>Profile URL</Label>
                <Input
                  value={form.platformUrl}
                  onChange={(e) =>
                    setForm({ ...form, platformUrl: e.target.value })
                  }
                  placeholder="https://..."
                />
              </div>
              <Button onClick={handleAdd} disabled={adding || !form.platformUserId}>
                {adding ? "Adding..." : "Add Identity"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {identities.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground text-center">
              No platform identities linked yet.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {identities.map((identity) => (
            <Card key={identity.id}>
              <CardContent className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">
                        {platformLabels[identity.platform] ?? identity.platform}
                      </Badge>
                      {identity.isPrimary === 1 && (
                        <Badge variant="outline" className="text-xs">
                          Primary
                        </Badge>
                      )}
                      <Badge
                        variant="outline"
                        className={
                          identity.isActive
                            ? "bg-chart-4/15 text-chart-4 border-chart-4/25"
                            : "bg-muted/15 text-muted-foreground border-muted"
                        }
                      >
                        {identity.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    <p className="text-sm mt-1 truncate">
                      {identity.platformHandle
                        ? formatPlatformHandle(identity.platform, identity.platformHandle)
                        : identity.platformUserId}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {identity.platformUrl && (
                    <a
                      href={identity.platformUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button variant="ghost" size="icon">
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    </a>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(identity.id)}
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
