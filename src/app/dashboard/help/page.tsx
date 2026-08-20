"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CheckCircle2,
  Circle,
  Loader2,
  Rocket,
  Twitter,
  Linkedin,
  LayoutList,
  HelpCircle,
  Users,
  Sparkles,
  ListChecks,
  Database,
  Shield,
  RefreshCw,
  Key,
  Mail,
  FileDown,
  Telescope,
} from "lucide-react";
import Link from "next/link";

export default function HelpPage() {
  return (
    <Suspense>
      <HelpContent />
    </Suspense>
  );
}

// ─── Setup Checklist Status ──────────────────────────────────────────────────

interface ChecklistState {
  loading: boolean;
  rtxEmbedded: boolean;
  rtxLlmReady: boolean;
  standaloneLlmReady: boolean;
  xConnected: boolean;
  linkedinConnected: boolean;
  facebookConnected: boolean;
  mailConnected: boolean;
}

function useSetupChecklist(): ChecklistState {
  const [state, setState] = useState<ChecklistState>({
    loading: true,
    rtxEmbedded: false,
    rtxLlmReady: false,
    standaloneLlmReady: false,
    xConnected: false,
    linkedinConnected: false,
    facebookConnected: false,
    mailConnected: false,
  });

  useEffect(() => {
    Promise.all([
      fetch("/api/health")
        .then((r) => r.json())
        .catch(() => ({ rtx: { mode: "standalone" } })),
      fetch("/api/settings")
        .then((r) => r.json())
        .catch(() => ({ source: "none" })),
      fetch("/api/platforms/x")
        .then((r) => r.json())
        .catch(() => ({ connected: false })),
      fetch("/api/platforms/linkedin")
        .then((r) => r.json())
        .catch(() => ({ connected: false })),
      fetch("/api/platforms/facebook")
        .then((r) => r.json())
        .catch(() => ({ connected: false })),
      fetch("/api/mail-accounts")
        .then((r) => r.json())
        .catch(() => ({ accounts: [] })),
    ]).then(([health, settings, xStatus, linkedinStatus, facebookStatus, mailStatus]) => {
      const rtxEmbedded = health?.rtx?.mode === "embedded";
      setState({
        loading: false,
        rtxEmbedded,
        rtxLlmReady: rtxEmbedded && health?.rtx?.pingOk === true,
        standaloneLlmReady: settings.source !== "none",
        xConnected: xStatus.connected === true,
        linkedinConnected: linkedinStatus.connected === true,
        facebookConnected: facebookStatus.connected === true,
        mailConnected: Array.isArray(mailStatus.accounts) && mailStatus.accounts.length > 0,
      });
    });
  }, []);

  return state;
}

// ─── Reusable Components ─────────────────────────────────────────────────────

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
      {children}
    </code>
  );
}

function StepNumber({ n }: { n: number }) {
  return (
    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold shrink-0">
      {n}
    </span>
  );
}

function ChecklistItem({
  label,
  done,
  loading,
  href,
}: {
  label: string;
  done: boolean;
  loading: boolean;
  href?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : done ? (
        <CheckCircle2 className="h-5 w-5 text-green-600" />
      ) : (
        <Circle className="h-5 w-5 text-muted-foreground" />
      )}
      <span className={done ? "text-muted-foreground line-through" : ""}>
        {label}
      </span>
      {!done && !loading && href && (
        <Link
          href={href}
          className="ml-auto text-xs text-primary underline underline-offset-2"
        >
          Configure
        </Link>
      )}
    </div>
  );
}

// ─── Tab Content ─────────────────────────────────────────────────────────────

function GettingStartedTab() {
  const checklist = useSetupChecklist();

  return (
    <div className="space-y-6">
      {/* Cross-link to User Guide */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="flex items-center gap-3 pt-6">
          <Rocket className="h-5 w-5 text-primary shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium">
              Want the full walkthrough?{" "}
              <Link
                href="/dashboard/guide"
                className="text-primary underline underline-offset-2"
              >
                Read the User Guide
              </Link>{" "}
              for deeper concepts and workflow examples.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Welcome */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Rocket className="h-5 w-5" />
            Welcome to Signals
          </CardTitle>
          <CardDescription>
            AI-Native Social GTM &amp; Relationship Knowledge Graph
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Signals keeps your CRM graph, credentials, and media on your machine while
            RealTimeX agents handle research, enrichment, and publishing when you ask them to.
            AI calls and browser actions may send bounded data to your configured model provider
            or the platform being used.
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="flex items-start gap-2">
              <Users className="h-4 w-4 mt-0.5 text-primary shrink-0" />
              <span>Unify contacts, organizations, identities, and audience relationships</span>
            </div>
            <div className="flex items-start gap-2">
              <Sparkles className="h-4 w-4 mt-0.5 text-primary shrink-0" />
              <span>Draft, simulate, launch, and publish content through RealTimeX agents</span>
            </div>
            <div className="flex items-start gap-2">
              <ListChecks className="h-4 w-4 mt-0.5 text-primary shrink-0" />
              <span>Run observable workflows and measure progress with analytics and goals</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quick Setup Checklist */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListChecks className="h-5 w-5" />
            Quick Setup Checklist
          </CardTitle>
          <CardDescription>
            Connect only the services you use. Social and mail connections are optional.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ChecklistItem
            label={
              checklist.rtxEmbedded
                ? "RealTimeX LLM access ready (llm.chat / llm.embed)"
                : "Standalone LLM access configured"
            }
            done={checklist.rtxEmbedded ? checklist.rtxLlmReady : checklist.standaloneLlmReady}
            loading={checklist.loading}
            href="/dashboard/settings"
          />
          <ChecklistItem
            label="X browser session connected"
            done={checklist.xConnected}
            loading={checklist.loading}
            href="/dashboard/settings"
          />
          <ChecklistItem
            label="LinkedIn browser session connected"
            done={checklist.linkedinConnected}
            loading={checklist.loading}
            href="/dashboard/settings"
          />
          <ChecklistItem
            label="Facebook browser session connected"
            done={checklist.facebookConnected}
            loading={checklist.loading}
            href="/dashboard/settings"
          />
          <ChecklistItem
            label="Himalaya mail account registered"
            done={checklist.mailConnected}
            loading={checklist.loading}
            href="/dashboard/settings"
          />
        </CardContent>
      </Card>

      {/* Connection model */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            How Signals Connects
          </CardTitle>
          <CardDescription>
            Current setup paths for AI, social platforms, imports, and mail.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <ul className="list-disc space-y-2 pl-5 text-muted-foreground">
            <li>
              <strong className="text-foreground">AI:</strong> approve <Code>llm.chat</Code> and{" "}
              <Code>llm.embed</Code> for Signals in RealTimeX Settings → Local Apps.
            </li>
            <li>
              <strong className="text-foreground">Social:</strong> connect X, LinkedIn, and
              Facebook through the shared RealTimeX Browser session in Signals Settings. Add
              acting targets there when agents need to use more than one identity.
            </li>
            <li>
              <strong className="text-foreground">Imports:</strong> upload X archives, LinkedIn
              exports, and Google Takeout files from Automation → Workflows. These do not require
              developer OAuth credentials.
            </li>
            <li>
              <strong className="text-foreground">Mail:</strong> configure accounts with Himalaya,
              then register and check them in Signals Settings. Gmail OAuth is a legacy path.
            </li>
          </ul>
          <p className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
            Source-checkout development can still use provider keys from <Code>.env.local</Code>.
            Optional X and LinkedIn OAuth API sync lives under{" "}
            <strong className="font-medium text-foreground">Advanced</strong> in Settings; it is
            not required for browser publishing or file imports.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function XSetupTab() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Twitter className="h-5 w-5" />
            Recommended X Setup
          </CardTitle>
          <CardDescription>
            Browser connection and archive import are the default paths. A developer app is optional.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <ul className="list-disc space-y-2 pl-5">
            <li>Use RealTimeX Browser to sign in, validate the active identity, and publish.</li>
            <li>Import an X archive to add contacts and follower/following graph edges.</li>
            <li>Send drafts from Content to a RealTimeX agent for target-aware publishing.</li>
            <li>Enable OAuth API sync only if your X developer plan includes the scopes you need.</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <StepNumber n={1} />
            Connect the Browser Session
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              Open{" "}
              <Link href="/dashboard/settings" className="text-primary underline underline-offset-2">
                Settings
              </Link>{" "}
              → Platform Connections and choose <strong className="text-foreground">Setup session</strong>.
            </li>
            <li>Sign in to X in the RealTimeX Browser window.</li>
            <li>
              Return to Settings and choose <strong className="text-foreground">Validate</strong>.
            </li>
            <li>Add or discover acting targets, then choose a default identity for agents.</li>
          </ol>
          <p className="rounded-lg border bg-muted/40 p-3 text-xs">
            The shared session is named <Code>signals-publish</Code>. Validation fails closed when
            the browser is logged out or the active identity does not match the requested target.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <StepNumber n={2} />
            Import Your X Network
          </CardTitle>
          <CardDescription>
            File import is the reliable, no-OAuth path for audience data.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              Request and download your X data archive from X account settings.
            </li>
            <li>
              Open{" "}
              <Link href="/dashboard/workflows" className="text-primary underline underline-offset-2">
                Automation → Workflows
              </Link>{" "}
              and run the X archive import action.
            </li>
            <li>
              Review imported contacts in Contacts and relationship edges in Explore.
            </li>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <StepNumber n={3} />
            Draft and Publish
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Create or edit a draft in{" "}
            <Link href="/dashboard/content" className="text-primary underline underline-offset-2">
              Content
            </Link>
            , choose the X target, and select <strong className="text-foreground">Send to agent</strong>.
            The RealTimeX agent receives a publish job, uses the verified browser target, and reports
            the result back to Signals.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Optional: OAuth API Sync
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Expand <strong className="text-foreground">Advanced: OAuth API sync</strong> on the X
            card in Settings only when you need API-based contact sync. Your X developer app must
            grant <Code>follows.read</Code>; plan availability and pricing are controlled by X.
          </p>
          <p className="text-xs">
            For source checkout, configure <Code>X_CLIENT_ID</Code> and <Code>X_CLIENT_SECRET</Code>,
            and register <Code>/api/platforms/x/callback</Code> on the Signals base URL.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function LinkedInSetupTab() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Linkedin className="h-5 w-5" />
            Recommended LinkedIn Setup
          </CardTitle>
          <CardDescription>
            Use the browser session for identity and publishing, and a LinkedIn export for contacts.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <ul className="list-disc space-y-2 pl-5">
            <li>No LinkedIn developer app is required for browser connection or export import.</li>
            <li>Importing a Connections export creates CRM contacts and audience graph edges.</li>
            <li>Publishing through the RealTimeX agent lane is available as a beta workflow.</li>
            <li>OAuth API sync is advanced and requires LinkedIn-granted connection scopes.</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <StepNumber n={1} />
            Connect the Browser Session
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              Open{" "}
              <Link href="/dashboard/settings" className="text-primary underline underline-offset-2">
                Settings
              </Link>{" "}
              → Platform Connections and choose <strong className="text-foreground">Setup session</strong>.
            </li>
            <li>Sign in to LinkedIn in the RealTimeX Browser window.</li>
            <li>
              Return to Settings and choose <strong className="text-foreground">Validate</strong>.
            </li>
            <li>Add the current acting target and make it the default when appropriate.</li>
          </ol>
          <p className="rounded-lg border bg-muted/40 p-3 text-xs">
            LinkedIn target switching is verify-first. Confirm the requested identity before an
            agent performs any mutating action.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <StepNumber n={2} />
            Import Connections
          </CardTitle>
          <CardDescription>
            Use LinkedIn&apos;s Basic Data Export; OAuth is not needed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              Request your Connections archive from LinkedIn Settings &amp; Privacy → Data Privacy.
            </li>
            <li>
              Open{" "}
              <Link href="/dashboard/workflows" className="text-primary underline underline-offset-2">
                Automation → Workflows
              </Link>{" "}
              and run <strong className="text-foreground">Import Connections Export</strong>.
            </li>
            <li>Upload the complete zip or the extracted <Code>Connections.csv</Code>.</li>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <StepNumber n={3} />
            Draft and Publish (Beta)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Draft in{" "}
            <Link href="/dashboard/content" className="text-primary underline underline-offset-2">
              Content
            </Link>
            , select LinkedIn and an acting target, then send the publish job to a RealTimeX agent.
            The job remains visible in Signals while the agent publishes and reports completion.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Optional: OAuth API Sync
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Expand <strong className="text-foreground">Advanced: OAuth API sync</strong> only when
            your LinkedIn app has the connection scopes required for API sync. OpenID Connect sign-in
            alone does not grant access to a member&apos;s connection list.
          </p>
          <p className="text-xs">
            For source checkout, configure <Code>LINKEDIN_CLIENT_ID</Code> and{" "}
            <Code>LINKEDIN_CLIENT_SECRET</Code>, and register{" "}
            <Code>/api/platforms/linkedin/callback</Code> on the Signals base URL.
          </p>
        </CardContent>
      </Card>

      {/* Export details */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileDown className="h-5 w-5" />
            What the Connections Export Includes
          </CardTitle>
          <CardDescription>
            Import LinkedIn connections from a Basic Data Export zip or
            Connections CSV — works without a connected LinkedIn account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <ol className="list-decimal pl-5 space-y-2">
            <li>
              On LinkedIn, go to{" "}
              <strong className="text-foreground">
                Settings &amp; Privacy
              </strong>{" "}
              &rarr;{" "}
              <strong className="text-foreground">Data Privacy</strong> &rarr;{" "}
              <strong className="text-foreground">
                Get a copy of your data
              </strong>
            </li>
            <li>
              Select <strong className="text-foreground">Connections</strong>{" "}
              only and request the archive
            </li>
            <li>
              Download the zip archive when LinkedIn emails the link (usually
              within 10 minutes)
            </li>
            <li>
              In Signals{" "}
              <Link
                href="/dashboard/workflows"
                className="text-primary underline underline-offset-2"
              >
                Automation &rarr; Workflows
              </Link>
              , find{" "}
              <strong className="text-foreground">Import Connections Export</strong>{" "}
              under LinkedIn, and upload the zip (or extracted{" "}
              <strong className="text-foreground">Connections.csv</strong>)
            </li>
          </ol>
          <div className="rounded-lg border bg-muted/50 p-3 text-xs">
            <strong className="text-foreground">Note:</strong> The export includes
            name, company, position, connected date, and email (if the
            connection shared it). Upload the full zip — Signals extracts{" "}
            <strong className="text-foreground">Connections.csv</strong>{" "}
            automatically. No LinkedIn API access is needed. Re-importing is
            safe: existing contacts are updated, not duplicated, and each
            import is recorded under Automation &rarr; Runs.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function FacebookSetupTab() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Browser session connect (no Meta OAuth)
          </CardTitle>
          <CardDescription>
            Facebook connect uses the shared RealTimeX Browser <Code>signals-publish</Code>{" "}
            session. Meta OAuth and Graph API sync are not available in Signals yet.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <ol className="list-decimal pl-5 space-y-2">
            <li>
              Go to{" "}
              <Link
                href="/dashboard/settings"
                className="text-primary underline underline-offset-2"
              >
                Settings
              </Link>{" "}
              &rarr; Platform Connections &rarr; click{" "}
              <strong className="text-foreground">Setup session</strong> on Facebook
            </li>
            <li>
              Sign in to your personal Facebook account in the RealTimeX Browser window
            </li>
            <li>
              Return to Settings and click{" "}
              <strong className="text-foreground">Validate</strong> to persist the session
              account
            </li>
            <li>
              Add the current personal profile or Page as an acting target for future agent use
            </li>
            <li>
              Use <strong className="text-foreground">Disconnect</strong> to clear the
              browser connection without deleting the <Code>signals-publish</Code> profile
            </li>
          </ol>
          <div className="rounded-lg border bg-muted/40 p-3 text-xs">
            <strong className="text-foreground">Current limitation:</strong> Facebook targets are
            browse-only. Publishing and Meta Graph API sync are not supported. Public profile URLs
            can also load while logged out, so validation requires authenticated navigation markers.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MailSetupTab() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Mail and Google Contacts
          </CardTitle>
          <CardDescription>
            Mail now uses Himalaya CLI. Google contact import uses Takeout files.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <ul className="list-disc space-y-2 pl-5">
            <li>Use Google Takeout zip or vCard exports for bulk contact import.</li>
            <li>Use Himalaya accounts for correspondent discovery and mail activity metadata.</li>
            <li>No Google Cloud project, Gmail OAuth client, or Google API scopes are required.</li>
            <li>Signals stores aggregate mail metadata, not message bodies.</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <StepNumber n={1} />
            Configure a Himalaya Account
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <ol className="list-decimal space-y-2 pl-5">
            <li>Open a RealTimeX terminal agent or a local shell on the Signals machine.</li>
            <li>Run <Code>himalaya account configure</Code> and complete the provider prompts.</li>
            <li>Confirm the account works with <Code>himalaya account list</Code>.</li>
          </ol>
          <p className="rounded-lg border bg-muted/40 p-3 text-xs">
            Signals reads the Himalaya config path shown in Settings. A plugin installation can
            override it with <Code>EMAIL_CONFIG_FILE</Code>.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <StepNumber n={2} />
            Register and Check Accounts
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              Open{" "}
              <Link href="/dashboard/settings" className="text-primary underline underline-offset-2">
                Settings
              </Link>{" "}
              and find <strong className="text-foreground">Mail Accounts</strong>.
            </li>
            <li>Choose <strong className="text-foreground">Refresh</strong> to import Himalaya aliases.</li>
            <li>Run <strong className="text-foreground">Check</strong> for each account and select a default.</li>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <StepNumber n={3} />
            Import Google Contacts
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <ol className="list-decimal space-y-2 pl-5">
            <li>Export Contacts from Google Takeout as a zip or vCard file.</li>
            <li>
              Open{" "}
              <Link href="/dashboard/workflows" className="text-primary underline underline-offset-2">
                Automation → Workflows
              </Link>{" "}
              and run <strong className="text-foreground">Import Google Contacts (Takeout)</strong>.
            </li>
            <li>Upload the export and review the recorded import run.</li>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <StepNumber n={4} />
            Run Mail Workflows
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            From Automation, run <strong className="text-foreground">Import Correspondents</strong>{" "}
            to discover people from message headers, then{" "}
            <strong className="text-foreground">Enrich Mail Activity</strong> to update sent/received
            counts and last-interaction dates.
          </p>
          <p className="text-xs">
            Agents can list configured aliases through Signals and use Himalaya directly to read or
            send mail when their task and permissions allow it.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Privacy and Legacy Gmail OAuth
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Signals stores email addresses, aggregate message counts, and interaction dates used for
            CRM context. It does not persist message bodies during correspondent or activity imports.
          </p>
          <p className="rounded-lg border bg-muted/40 p-3 text-xs">
            Existing Gmail OAuth connections are shown only for migration. Configure Himalaya first,
            then disconnect the legacy OAuth account from Settings.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function FeaturesTab() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            People, Organizations &amp; Relationship Graph
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <ul className="list-disc space-y-1 pl-5">
            <li>Unified contacts with multiple social and email identities</li>
            <li>Organizations, employment history, niches, and relationship edges</li>
            <li>Search, funnel stages, archival, provenance, and enrichment scores</li>
            <li>Agent-assisted enrichment through RealTimeX Browser and agent-tools</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Telescope className="h-5 w-5" />
            Explore audience map
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            The{" "}
            <Link
              href="/dashboard/explore"
              className="text-primary underline underline-offset-2"
            >
              Explore
            </Link>{" "}
            map visualizes your audience — contacts linked to you through
            platform relationships, not every CRM row.
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              Set which contact is you; the map anchors on that profile
            </li>
            <li>
              X: following sync and archive import write follower/following
              edges
            </li>
            <li>
              LinkedIn: connection sync and Connections CSV/zip import write
              connection edges
            </li>
            <li>
              Google Takeout and mail imports add contacts but not audience graph
              edges because email has no follow/connection semantics
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Rocket className="h-5 w-5" />
            Content, Launches &amp; Wind Tunnel
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <ul className="list-disc space-y-1 pl-5">
            <li>One content library for drafts, inbound posts, and published content</li>
            <li>Agent-mediated publishing to verified X and LinkedIn acting targets</li>
            <li>Launches group campaign variants, evidence, and publish state</li>
            <li>Wind Tunnel audience simulations with prediction and calibration history</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5" />
            Automation and RealTimeX Agents
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <ul className="list-disc space-y-1 pl-5">
            <li>Workflows define repeatable search, import, enrich, prune, and publishing jobs</li>
            <li>Runs and steps stay visible in Signals for observability</li>
            <li>RealTimeX terminal agents execute AI work through the Agent Tools API</li>
            <li>Recurring AI schedules belong in RealTimeX Agent Flows</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Linkedin className="h-5 w-5" />
            Analytics and Goals
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <ul className="list-disc space-y-1 pl-5">
            <li>Overview, agent, engagement, content, and sync-health analytics</li>
            <li>Date-range filters for recent and long-term performance</li>
            <li>Demand-generation goals with targets, deadlines, and progress history</li>
            <li>Workflow-linked progress plus manual adjustments when needed</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Connections, Imports and Mail
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <ul className="list-disc space-y-1 pl-5">
            <li>RealTimeX Browser connections and stable acting targets for social platforms</li>
            <li>X archive, LinkedIn export, and Google Takeout import workflows</li>
            <li>Himalaya correspondent and aggregate mail-activity enrichment</li>
            <li>Optional advanced OAuth API sync for supported X and LinkedIn accounts</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function FaqTab() {
  const faqs = [
    {
      icon: Database,
      q: "Where is my data stored?",
      a: (
        <>
          The CRM graph lives in SQLite at <Code>~/.signals/data.db</Code>; encrypted
          configuration and media also stay under <Code>~/.signals/</Code>. AI requests,
          terminal agents, web research, and platform actions may send the bounded data needed
          for the task to your configured provider or target service.
        </>
      ),
    },
    {
      icon: Shield,
      q: "How are credentials secured?",
      a: (
        <>
          AES-256-GCM encryption tied to your machine identity. Stored in{" "}
          <Code>~/.signals/config.json</Code>.
        </>
      ),
    },
    {
      icon: Twitter,
      q: "Do I need social-platform developer API keys?",
      a: "No for the normal workflow. Browser connection, file imports, and agent publishing do not require developer OAuth credentials. Optional API contact sync under Advanced requires platform-approved scopes; availability and pricing are controlled by each platform.",
    },
    {
      icon: RefreshCw,
      q: "How do I import my X network?",
      a: "Download your X data archive, then run the X archive import from Automation → Workflows. It creates or updates contacts and writes follower/following edges used by Explore. API sync is an optional advanced path.",
    },
    {
      icon: Linkedin,
      q: "How do I import LinkedIn connections?",
      a: "Request a Basic Data Export from LinkedIn, then upload the zip or Connections.csv through Automation → Workflows. OpenID Connect sign-in alone does not grant access to a member's connection list.",
    },
    {
      icon: Sparkles,
      q: "How does publishing work now?",
      a: "Compose or edit a draft in Signals, select platform targets, and send the job to a RealTimeX agent. The agent verifies the acting target, publishes through RealTimeX Browser, and reports per-platform results back to the visible job in Signals.",
    },
    {
      icon: ListChecks,
      q: "Where do AI workflows run?",
      a: "RealTimeX terminal agents execute AI work and call the Signals Agent Tools API. Signals records templates, runs, steps, and results for observability. Use RealTimeX Agent Flows for recurring AI schedules; legacy in-process agent loops are no longer available.",
    },
    {
      icon: Mail,
      q: "How do Google contacts and mail work?",
      a: "Import Google contacts from a Takeout zip or vCard. Configure mail accounts with Himalaya, register them in Settings, then run correspondent and activity workflows. The import stores addresses, aggregate counts, and dates—not message bodies.",
    },
    {
      icon: Users,
      q: "Can agents use more than one social identity?",
      a: "Yes. In an embedded RealTimeX install, use Acting targets on the platform card to add or discover identities, choose a default, and switch-and-verify before an agent acts. Platform-specific switching limitations still apply.",
    },
    {
      icon: Key,
      q: "Where do I configure AI models and keys?",
      a: (
        <>
          For the Local App, configure providers and approve <Code>llm.chat</Code> and{" "}
          <Code>llm.embed</Code> in RealTimeX{" "}
          <strong className="font-medium text-foreground">Settings → Local Apps</strong>.
          Standalone source development can use <Code>.env.local</Code> and requires a restart
          after environment changes.
        </>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {faqs.map((faq, i) => (
        <Card key={i}>
          <CardContent className="flex gap-3 pt-6">
            <faq.icon className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-medium text-sm">{faq.q}</p>
              <p className="text-sm text-muted-foreground">{faq.a}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Main Content ────────────────────────────────────────────────────────────

const VALID_TABS = ["getting-started", "x-setup", "linkedin-setup", "facebook-setup", "gmail-setup", "features", "faq"] as const;
type TabValue = (typeof VALID_TABS)[number];

function HelpContent() {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const initialTab: TabValue =
    tabParam && VALID_TABS.includes(tabParam as TabValue)
      ? (tabParam as TabValue)
      : "getting-started";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-heading-1">Help & Documentation</h1>
        <p className="text-muted-foreground mt-1">
          Guides, setup instructions, and frequently asked questions.
        </p>
      </div>

      <Tabs defaultValue={initialTab}>
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="getting-started">
            <Rocket className="h-4 w-4" />
            Getting Started
          </TabsTrigger>
          <TabsTrigger value="x-setup">
            <Twitter className="h-4 w-4" />
            X/Twitter Setup
          </TabsTrigger>
          <TabsTrigger value="linkedin-setup">
            <Linkedin className="h-4 w-4" />
            LinkedIn Setup
          </TabsTrigger>
          <TabsTrigger value="facebook-setup">
            <Users className="h-4 w-4" />
            Facebook Setup
          </TabsTrigger>
          <TabsTrigger value="gmail-setup">
            <Mail className="h-4 w-4" />
            Mail Setup
          </TabsTrigger>
          <TabsTrigger value="features">
            <LayoutList className="h-4 w-4" />
            Features
          </TabsTrigger>
          <TabsTrigger value="faq">
            <HelpCircle className="h-4 w-4" />
            FAQ
          </TabsTrigger>
        </TabsList>

        <TabsContent value="getting-started">
          <GettingStartedTab />
        </TabsContent>
        <TabsContent value="x-setup">
          <XSetupTab />
        </TabsContent>
        <TabsContent value="linkedin-setup">
          <LinkedInSetupTab />
        </TabsContent>
        <TabsContent value="facebook-setup">
          <FacebookSetupTab />
        </TabsContent>
        <TabsContent value="gmail-setup">
          <MailSetupTab />
        </TabsContent>
        <TabsContent value="features">
          <FeaturesTab />
        </TabsContent>
        <TabsContent value="faq">
          <FaqTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
