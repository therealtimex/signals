"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ContactForm } from "@/components/contact-form";
import { AddTaskDialog } from "@/components/add-task-dialog";
import { FunnelStageBadge } from "@/components/funnel-stage-badge";
import { PriorityBadge } from "@/components/priority-badge";
import { EnrichmentScoreBadge } from "@/components/enrichment-score-badge";
import { IdentitiesSection } from "@/components/identities-section";
import { ArrowLeft, Trash2, Save, CheckCircle2, Circle, Archive, RotateCcw, Sparkles, Loader2 } from "lucide-react";
import Link from "next/link";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ContactWithIdentities, Task } from "@/lib/db/types";
import type { ContactExploreCard } from "@/lib/db/queries/contact-explore";
import type { DraftContactChannel } from "@/lib/contact-channel-draft";
import type { DraftContactEmployment } from "@/lib/contact-employment-draft";
import { ContactExploreCardView } from "@/components/contact-explore-card";
import { ContactTimelineTab } from "@/components/contact-timeline-tab";
import { ContactAvatarUpload } from "@/components/contact-avatar-upload";
import { ContactRelationshipSection } from "@/components/contact-relationship-section";
import { ContactSourceLine } from "@/components/contact-source-line";

const platformLabels: Record<string, string> = {
  x: "X / Twitter",
  linkedin: "LinkedIn",
  gmail: "Gmail",
  substack: "Substack",
};

interface ContactDetailClientProps {
  contact: ContactWithIdentities;
  tasks: Task[];
  explore: ContactExploreCard;
  createdTemplateName?: string | null;
  createdWorkflowRunHref?: string | null;
  profilePipelineTemplateId?: string | null;
}

export function ContactDetailClient({
  contact,
  tasks,
  explore,
  createdTemplateName,
  createdWorkflowRunHref,
  profilePipelineTemplateId = null,
}: ContactDetailClientProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [selfSaving, setSelfSaving] = useState(false);
  const formChanges = useRef<Record<string, string>>({});
  const channelsData = useRef<DraftContactChannel[] | null>(null);
  const employmentsData = useRef<DraftContactEmployment[] | null>(null);

  async function handleRunProfilePipeline() {
    if (!profilePipelineTemplateId) return;
    setPipelineRunning(true);
    setPipelineError(null);
    try {
      const res = await fetch(`/api/workflows/templates/${profilePipelineTemplateId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: { contactIds: [contact.id] } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPipelineError(
          typeof data.error === "string" ? data.error : "Failed to start profile pipeline",
        );
        return;
      }
      if (data.workflowRunId) {
        router.push(`/dashboard/workflows/${data.workflowRunId}`);
      }
    } catch {
      setPipelineError("Failed to start profile pipeline");
    } finally {
      setPipelineRunning(false);
    }
  }

  async function handleToggleSelf(nextValue: boolean) {
    setSelfSaving(true);
    try {
      const res = await fetch(`/api/contacts/${contact.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isSelf: nextValue }),
      });
      if (res.ok) {
        router.refresh();
      }
    } finally {
      setSelfSaving(false);
    }
  }

  async function handleSave() {
    const data = formChanges.current;
    const hasChannelChanges = channelsData.current !== null;
    const hasEmploymentChanges = employmentsData.current !== null;
    if (Object.keys(data).length === 0 && !hasChannelChanges && !hasEmploymentChanges) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/contacts/${contact.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          ...(hasChannelChanges ? { channels: channelsData.current } : {}),
          ...(hasEmploymentChanges ? { employments: employmentsData.current } : {}),
        }),
      });
      if (res.ok) {
        formChanges.current = {};
        channelsData.current = null;
        employmentsData.current = null;
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/contacts/${contact.id}`, { method: "DELETE" });
      if (res.ok) {
        router.push("/dashboard/contacts");
        router.refresh();
      } else {
        const body = await res.json().catch(() => null);
        setDeleteError(body?.error ?? "Failed to delete contact. Please try again.");
      }
    } finally {
      setDeleting(false);
    }
  }

  async function handleToggleTask(task: Task) {
    const newStatus = task.status === "done" ? "todo" : "done";
    await fetch(`/api/tasks/${task.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    router.refresh();
  }

  async function handleDeleteTask(taskId: string) {
    await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
    router.refresh();
  }

  let tags: string[] = [];
  if (contact.tags) {
    try { tags = JSON.parse(contact.tags); } catch { /* malformed JSON, ignore */ }
  }

  // Parse archived state from metadata
  const [restoring, setRestoring] = useState(false);
  let contactArchived = false;
  let archiveReason = "";
  let archivedAt: number | null = null;
  try {
    const meta = JSON.parse(contact.metadata ?? "{}");
    contactArchived = meta.archived === 1;
    archiveReason = meta.archiveReason ?? "";
    archivedAt = meta.archivedAt ?? null;
  } catch { /* ignore */ }

  async function handleRestore() {
    setRestoring(true);
    const res = await fetch(`/api/contacts/${contact.id}/restore`, { method: "POST" });
    if (res.ok) {
      router.refresh();
    }
    setRestoring(false);
  }

  return (
    <div className="space-y-6">
      {/* Archived banner */}
      {contactArchived && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex items-center justify-between py-3">
            <div className="flex items-center gap-3">
              <Archive className="h-4 w-4 text-destructive" />
              <div>
                <p className="text-sm font-medium">This contact is archived</p>
                {archiveReason && (
                  <p className="text-xs text-muted-foreground">{archiveReason}</p>
                )}
                {archivedAt && (
                  <p className="text-xs text-muted-foreground">
                    Archived {new Date(archivedAt * 1000).toLocaleDateString()}
                  </p>
                )}
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={handleRestore} disabled={restoring}>
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              Restore
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/contacts">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-heading-1">{contact.name}</h1>
            <div className="flex items-center gap-2 mt-1">
              {contact.company && (
                <span className="text-muted-foreground">{contact.company}</span>
              )}
              {contact.title && (
                <span className="text-muted-foreground">
                  {contact.company ? ` · ${contact.title}` : contact.title}
                </span>
              )}
            </div>
            {contact.createdSource ? (
              <ContactSourceLine
                createdSource={contact.createdSource}
                createdSourceDetail={contact.createdSourceDetail}
                createdWorkflowRunId={contact.createdWorkflowRunId}
                createdAt={contact.createdAt}
                createdTemplateName={createdTemplateName}
                runHref={createdWorkflowRunHref}
              />
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!contactArchived ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5">
                    <Label htmlFor="contact-is-self" className="text-sm">
                      This is me
                    </Label>
                    <Switch
                      id="contact-is-self"
                      checked={contact.isSelf}
                      disabled={selfSaving}
                      onCheckedChange={(checked) => void handleToggleSelf(checked)}
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  Marks this contact as you. Any previous self contact is cleared.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}
          {!contactArchived &&
            !contact.isSelf &&
            profilePipelineTemplateId && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleRunProfilePipeline()}
                disabled={pipelineRunning}
              >
                {pipelineRunning ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                )}
                Enrich profile
              </Button>
            )}
          {pipelineError && (
            <span className="text-xs text-destructive">{pipelineError}</span>
          )}
          <FunnelStageBadge stage={contact.funnelStage} />
          <EnrichmentScoreBadge score={contact.enrichmentScore} />
        </div>
      </div>

      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="identities">
            Identities ({contact.identities.length})
          </TabsTrigger>
          <TabsTrigger value="tasks">Tasks ({tasks.length})</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="audience">Audience</TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Contact Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <ContactAvatarUpload
                contactId={contact.id}
                currentAvatarUrl={contact.resolvedAvatarUrl ?? contact.avatarUrl}
              />
              {contact.headline && (
                <p className="text-sm text-muted-foreground">{contact.headline}</p>
              )}
              {contact.bio && <p className="text-sm">{contact.bio}</p>}

              <div className="grid grid-cols-2 gap-4 text-sm">
                {contact.email && (
                  <div>
                    <span className="text-muted-foreground">Email: </span>
                    {contact.email}
                  </div>
                )}
                {contact.phone && (
                  <div>
                    <span className="text-muted-foreground">Phone: </span>
                    {contact.phone}
                  </div>
                )}
                {contact.location && (
                  <div>
                    <span className="text-muted-foreground">Location: </span>
                    {contact.location}
                  </div>
                )}
                {contact.website && (
                  <div>
                    <span className="text-muted-foreground">Website: </span>
                    <a
                      href={contact.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      {contact.website}
                    </a>
                  </div>
                )}
                {(() => {
                  const primaryIdentity =
                    contact.identities.find((id) => id.isPrimary) ?? contact.identities[0];
                  if (!primaryIdentity) return null;
                  return (
                    <div>
                      <span className="text-muted-foreground">Platform: </span>
                      {platformLabels[primaryIdentity.platform] ?? primaryIdentity.platform}
                    </div>
                  );
                })()}
                {contact.profileUrl && (
                  <div>
                    <span className="text-muted-foreground">Profile: </span>
                    <a
                      href={contact.profileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      View Profile
                    </a>
                  </div>
                )}
              </div>

              {tags.length > 0 && (
                <div className="flex gap-1 flex-wrap">
                  {tags.map((tag) => (
                    <Badge key={tag} variant="secondary">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <ContactRelationshipSection contactId={contact.id} />

          <Card>
            <CardHeader>
              <CardTitle>Edit Contact</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <ContactForm
                defaultValues={contact}
                onChange={(partial) => {
                  formChanges.current = { ...formChanges.current, ...partial };
                }}
                onChannelsChange={(channels) => {
                  channelsData.current = channels;
                }}
                onEmploymentsChange={(employments) => {
                  employmentsData.current = employments;
                }}
              />
              <div className="flex justify-between">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" disabled={deleting}>
                      <Trash2 className="mr-2 h-4 w-4" />
                      {deleting ? "Deleting..." : "Delete Contact"}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete contact?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently delete {contact.name} and all associated
                        tasks. This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleDelete}>
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                {deleteError && (
                  <p className="text-sm text-destructive">{deleteError}</p>
                )}
                <Button onClick={handleSave} disabled={saving}>
                  <Save className="mr-2 h-4 w-4" />
                  {saving ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="identities" className="space-y-4">
          <IdentitiesSection
            contactId={contact.id}
            identities={contact.identities}
          />
        </TabsContent>

        <TabsContent value="tasks" className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold">Tasks</h3>
            <AddTaskDialog relatedContactId={contact.id} />
          </div>

          {tasks.length === 0 ? (
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground text-center">
                  No tasks for this contact yet.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {tasks.map((task) => (
                <Card key={task.id}>
                  <CardContent className="flex items-center justify-between py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <button onClick={() => handleToggleTask(task)}>
                        {task.status === "done" ? (
                          <CheckCircle2 className="h-5 w-5 text-green-500" />
                        ) : (
                          <Circle className="h-5 w-5 text-muted-foreground" />
                        )}
                      </button>
                      <div className="min-w-0">
                        <p
                          className={`text-sm font-medium truncate ${
                            task.status === "done" ? "line-through text-muted-foreground" : ""
                          }`}
                        >
                          {task.title}
                        </p>
                        {task.description && (
                          <p className="text-xs text-muted-foreground truncate">
                            {task.description}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <PriorityBadge priority={task.priority} />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteTask(task.id)}
                      >
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="activity" className="space-y-4">
          <ContactTimelineTab contactId={contact.id} />
        </TabsContent>

        <TabsContent value="audience" className="space-y-4">
          <ContactExploreCardView contactId={contact.id} explore={explore} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
