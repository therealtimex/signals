"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
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
import { LAUNCH_STATUSES } from "@/lib/db/gtm-status";
import { PLATFORMS } from "@/lib/db/platforms";
import type { Launch } from "@/lib/db/types";

interface LaunchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  editLaunch?: Launch;
}

export function LaunchDialog({
  open,
  onOpenChange,
  onSuccess,
  editLaunch,
}: LaunchDialogProps) {
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const [status, setStatus] = useState<string>("draft");
  const [primaryPlatform, setPrimaryPlatform] = useState<string>("none");
  const [scope, setScope] = useState<"shared" | "local_only">("shared");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (editLaunch) {
      setName(editLaunch.name);
      setBrief(editLaunch.brief ?? "");
      setStatus(editLaunch.status);
      setPrimaryPlatform(editLaunch.primaryPlatform ?? "none");
      setScope(editLaunch.scope === "local_only" ? "local_only" : "shared");
    } else {
      setName("");
      setBrief("");
      setStatus("draft");
      setPrimaryPlatform("none");
      setScope("shared");
    }
    setError(null);
  }, [editLaunch, open]);

  async function handleSubmit() {
    if (!name.trim()) return;

    setSaving(true);
    setError(null);
    try {
      const body = {
        name: name.trim(),
        brief: brief.trim() ? brief.trim() : null,
        status,
        primaryPlatform: primaryPlatform === "none" ? null : primaryPlatform,
        scope,
      };

      const url = editLaunch ? `/api/launches/${editLaunch.id}` : "/api/launches";
      const method = editLaunch ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        onOpenChange(false);
        onSuccess();
        return;
      }

      const payload = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(payload?.error ?? "Failed to save launch");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editLaunch ? "Edit Launch" : "New Launch"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="launch-name">Name</Label>
            <Input
              id="launch-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Summer product launch"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="launch-brief">Brief</Label>
            <Textarea
              id="launch-brief"
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              rows={4}
              placeholder="What are we launching and why?"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LAUNCH_STATUSES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Platform</Label>
              <Select value={primaryPlatform} onValueChange={setPrimaryPlatform}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {PLATFORMS.map((platform) => (
                    <SelectItem key={platform} value={platform}>
                      {platform}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Scope</Label>
            <Select
              value={scope}
              onValueChange={(value) => setScope(value as "shared" | "local_only")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="shared">Shared</SelectItem>
                <SelectItem value="local_only">Private (local only)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving || !name.trim()}>
            {saving ? "Saving..." : editLaunch ? "Update" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
