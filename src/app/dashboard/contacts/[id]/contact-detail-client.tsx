"use client";

import { useState, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ContactForm } from "@/components/contact-form";
import { AddTaskDialog } from "@/components/add-task-dialog";
import { FunnelStageBadge } from "@/components/funnel-stage-badge";
import { RelationshipGoalSelector } from "@/components/relationship-goal-badge";
import type { RelationshipGoal, RelationshipGoalStatus } from "@/lib/relationship-goals";
import { PriorityBadge } from "@/components/priority-badge";
import { EnrichmentScoreBadge } from "@/components/enrichment-score-badge";
import { IdentitiesSection } from "@/components/identities-section";
import {
  ArrowLeft,
  Trash2,
  Save,
  CheckCircle2,
  Circle,
  Archive,
  RotateCcw,
  Sparkles,
  Loader2,
  Pencil,
} from "lucide-react";
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
import { ContactProfileSection } from "@/components/contact-profile-section";
import { AgentProfileView } from "@/components/agent-profile-view";
import { SnowballDialog } from "@/components/snowball-dialog";
import { formatWebsiteLabel, hrefForWebsite, isRedundantHeadline } from "@/lib/contact-detail-format";
import type { ArppPersonDocument } from "@/lib/arpp/types";

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
  agentProfile?: ArppPersonDocument;
}

function MetaLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary hover:underline"
    >
      {children}
    </a>
  );
}

export function ContactDetailClient({
  contact,
  tasks,
  explore,
  createdTemplateName,
  createdWorkflowRunHref,
  profilePipelineTemplateId = null,
  agentProfile,
}: ContactDetailClientProps) {
  const router = useRouter();
  const [tab, setTab] = useState("details");
  const [editOpen, setEditOpen] = useState(false);
  const [snowballOpen, setSnowballOpen] = useState(false);
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
        setEditOpen(false);
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

  async function handleRelationshipGoalChange(
    goal: RelationshipGoal | null,
    status: RelationshipGoalStatus
  ) {
    await fetch(`/api/contacts/${contact.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        relationshipGoal: goal,
        relationshipGoalStatus: goal ? status : null,
      }),
    });
    router.refresh();
  }

  const primaryIdentity =
    contact.identities.find((id) => id.isPrimary) ?? contact.identities[0];
  const openTaskCount = tasks.filter((task) => task.status !== "done").length;
  const canEnrich = !contactArchived && !contact.isSelf && Boolean(profilePipelineTemplateId);
  const thinProfile = contact.enrichmentScore < 60 && !contact.isSelf;
  const showHeadline = !isRedundantHeadline(contact.headline, contact.title, contact.company);
  const metaItems: { key: string; node: ReactNode }[] = [];
  if (contact.location) metaItems.push({ key: "location", node: contact.location });
  if (contact.email) metaItems.push({ key: "email", node: contact.email });
  if (contact.phone) metaItems.push({ key: "phone", node: contact.phone });
  if (primaryIdentity) {
    metaItems.push({
      key: "platform",
      node: platformLabels[primaryIdentity.platform] ?? primaryIdentity.platform,
    });
  }
  if (contact.website) {
    metaItems.push({
      key: "website",
      node: (
        <MetaLink href={hrefForWebsite(contact.website)}>
          {formatWebsiteLabel(contact.website)}
        </MetaLink>
      ),
    });
  }
  if (contact.profileUrl) {
    metaItems.push({
      key: "profile",
      node: <MetaLink href={contact.profileUrl}>View profile</MetaLink>,
    });
  }
  const identityDetails = [
    showHeadline && contact.headline ? (
      <p key="headline" className="text-sm text-muted-foreground">
        {contact.headline}
      </p>
    ) : null,
    contact.bio ? (
      <p key="bio" className="max-w-2xl text-sm">
        {contact.bio}
      </p>
    ) : null,
    thinProfile ? (
      <p key="thin" className="text-sm text-muted-foreground">
        This profile is still thin. Enrich to pull public details.
      </p>
    ) : null,
    metaItems.length > 0 ? (
      <p key="meta" className="flex flex-wrap text-sm text-muted-foreground">
        {metaItems.map((item) => (
          <span key={item.key} className="after:mx-1.5 after:content-['·'] last:after:hidden">
            {item.node}
          </span>
        ))}
      </p>
    ) : null,
    tags.length > 0 ? (
      <div key="tags" className="flex flex-wrap gap-1">
        {tags.map((tag) => (
          <Badge key={tag} variant="secondary">
            {tag}
          </Badge>
        ))}
      </div>
    ) : null,
  ].filter(Boolean);

  return (
    <div className="space-y-6">
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

      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-1 basis-64 items-start gap-2">
          <Link href="/dashboard/contacts" className="-ml-2 mt-1 shrink-0">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex min-w-0 flex-1 items-center gap-4">
            <ContactAvatarUpload
              contactId={contact.id}
              currentAvatarUrl={contact.resolvedAvatarUrl ?? contact.avatarUrl}
              name={contact.name}
              firstName={contact.firstName}
              lastName={contact.lastName}
              size="md"
            />
            <div className="min-w-0 flex-1 space-y-2">
              <div>
                <h1 className="text-heading-1 truncate">{contact.name}</h1>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {contact.currentEmployment ? (
                    <span className="text-muted-foreground">
                      <Link
                        href={`/dashboard/organizations/${contact.currentEmployment.orgId}`}
                        className="text-primary hover:underline"
                      >
                        {contact.currentEmployment.orgName}
                      </Link>
                      {contact.currentEmployment.title ? ` · ${contact.currentEmployment.title}` : ""}
                    </span>
                  ) : (contact.company || contact.title) ? (
                    <span className="text-muted-foreground">
                      {[contact.company, contact.title].filter(Boolean).join(" · ")}
                    </span>
                  ) : null}
                  <FunnelStageBadge stage={contact.funnelStage} />
                  <RelationshipGoalSelector
                    goal={contact.relationshipGoal}
                    status={contact.relationshipGoalStatus}
                    onSelect={handleRelationshipGoalChange}
                    disabled={contactArchived}
                  />
                  <EnrichmentScoreBadge score={contact.enrichmentScore} />
                </div>
                {contact.createdSource ? (
                  <ContactSourceLine
                    createdSource={contact.createdSource}
                    createdSourceDetail={contact.createdSourceDetail}
                    createdWorkflowRunId={contact.createdWorkflowRunId}
                    createdAt={contact.createdAt}
                    createdTemplateName={createdTemplateName}
                    runHref={createdWorkflowRunHref}
                    compact
                  />
                ) : null}
              </div>
              {identityDetails.length > 0 ? identityDetails : null}
            </div>
          </div>
        </div>
        <div
          role="group"
          aria-label="Contact actions"
          className="flex w-full min-w-0 flex-wrap items-center gap-3 sm:w-auto sm:shrink-0"
        >
          {!contactArchived ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-2">
                    <Label htmlFor="contact-is-self" className="text-xs text-muted-foreground">
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
          {!contactArchived ? (
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
          ) : null}
          {!contactArchived ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSnowballOpen(true)}
            >
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              Snowball Network
            </Button>
          ) : null}
          {canEnrich ? (
            <Button
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
          ) : null}
          {pipelineError && (
            <span className="text-xs text-destructive">{pipelineError}</span>
          )}
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="identities">
            Identities ({contact.identities.length})
          </TabsTrigger>
          <TabsTrigger value="tasks">Tasks ({tasks.length})</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="audience">Audience</TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="space-y-4">
          <ContactProfileSection
            contact={contact}
            canEnrich={canEnrich}
            onEdit={() => setEditOpen(true)}
            onEnrich={() => void handleRunProfilePipeline()}
          />
          <ContactRelationshipSection
            contactId={contact.id}
            isSelf={contact.isSelf}
            openTaskCount={openTaskCount}
            onOpenTasks={() => setTab("tasks")}
          />
          {agentProfile ? <AgentProfileView profile={agentProfile} /> : null}
        </TabsContent>

        <TabsContent value="identities" className="space-y-4">
          <IdentitiesSection
            contactId={contact.id}
            identities={contact.identities}
            contactName={contact.name}
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
          <ContactExploreCardView
            contactId={contact.id}
            explore={explore}
            showIdentityHeader={false}
          />
        </TabsContent>
      </Tabs>

      <Sheet open={editOpen} onOpenChange={setEditOpen}>
        <SheetContent className="sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Edit contact</SheetTitle>
            <SheetDescription>
              Update name, role, and profile fields for {contact.name}.
            </SheetDescription>
          </SheetHeader>
          <div className="px-4">
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
          </div>
          {deleteError && (
            <p className="px-4 text-sm text-destructive">{deleteError}</p>
          )}
          <SheetFooter className="flex-row justify-between sm:justify-between">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={deleting}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  {deleting ? "Deleting..." : "Delete"}
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
            <Button onClick={handleSave} disabled={saving}>
              <Save className="mr-2 h-4 w-4" />
              {saving ? "Saving..." : "Save changes"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <SnowballDialog
        open={snowballOpen}
        onClose={() => setSnowballOpen(false)}
        seedType="contact_id"
        seedValue={primaryIdentity?.platformHandle ? `@${primaryIdentity.platformHandle}` : contact.name}
        entityName={contact.name}
      />
    </div>
  );
}
