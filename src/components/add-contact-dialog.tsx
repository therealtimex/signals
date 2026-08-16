"use client";

import { useState, useRef, type ReactNode } from "react";
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
import { ContactForm } from "@/components/contact-form";
import type { DraftContactIdentity } from "@/lib/contact-identity-draft";
import type { DraftContactChannel } from "@/lib/contact-channel-draft";
import { Plus } from "lucide-react";

const defaultFormData = { funnelStage: "prospect" } as const;

type AddContactDialogProps = {
  trigger?: ReactNode;
  title?: string;
  payloadExtras?: Record<string, unknown>;
  onCreated?: () => void;
};

export function AddContactDialog({
  trigger,
  title = "Add Contact",
  payloadExtras = {},
  onCreated,
}: AddContactDialogProps = {}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const formData = useRef<Record<string, string>>({ ...defaultFormData });
  const identitiesData = useRef<DraftContactIdentity[]>([]);
  const channelsData = useRef<DraftContactChannel[]>([]);

  function resetDraft() {
    formData.current = { ...defaultFormData };
    identitiesData.current = [];
    channelsData.current = [];
    setFormKey((key) => key + 1);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      resetDraft();
    }
    setOpen(nextOpen);
  }

  async function handleSave() {
    const data = formData.current;
    if (!data.name) return;

    setSaving(true);
    try {
      const identities = identitiesData.current.filter(
        (identity) => identity.platformUserId.trim().length > 0,
      );
      const channels = channelsData.current.filter((channel) => channel.value.trim().length > 0);

      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          ...payloadExtras,
          ...(identities.length > 0 ? { identities } : {}),
          ...(channels.length > 0 ? { channels } : {}),
        }),
      });
      if (res.ok) {
        handleOpenChange(false);
        onCreated?.();
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  const description =
    title === "Add Contact"
      ? "Create a new contact in your CRM."
      : "Create your profile to anchor the audience map.";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Add Contact
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <ContactForm
          key={formKey}
          showIdentities
          onChange={(partial) => {
            formData.current = { ...formData.current, ...partial };
          }}
          onIdentitiesChange={(identities) => {
            identitiesData.current = identities;
          }}
          onChannelsChange={(channels) => {
            channelsData.current = channels;
          }}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Contact"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
