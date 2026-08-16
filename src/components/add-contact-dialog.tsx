"use client";

import { useState, useRef } from "react";
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
import { Plus } from "lucide-react";

export function AddContactDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const formData = useRef<Record<string, string>>({ funnelStage: "prospect" });
  const identitiesData = useRef<DraftContactIdentity[]>([]);

  async function handleSave() {
    const data = formData.current;
    if (!data.name) return;

    setSaving(true);
    try {
      const identities = identitiesData.current.filter(
        (identity) => identity.platformUserId.trim().length > 0,
      );

      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          ...(identities.length > 0 ? { identities } : {}),
        }),
      });
      if (res.ok) {
        setOpen(false);
        formData.current = { funnelStage: "prospect" };
        identitiesData.current = [];
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Add Contact
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Contact</DialogTitle>
          <DialogDescription>Create a new contact in your CRM.</DialogDescription>
        </DialogHeader>
        <ContactForm
          showIdentities
          onChange={(partial) => {
            formData.current = { ...formData.current, ...partial };
          }}
          onIdentitiesChange={(identities) => {
            identitiesData.current = identities;
          }}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
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
