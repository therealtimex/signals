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
  Link as LinkIcon,
  Database,
  Shield,
  RefreshCw,
  UserPlus,
  Key,
  Mail,
  FileDown,
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
  anthropicKey: boolean;
  xConnected: boolean;
  xSynced: boolean;
  linkedinConnected: boolean;
  gmailConnected: boolean;
}

function useSetupChecklist(): ChecklistState {
  const [state, setState] = useState<ChecklistState>({
    loading: true,
    rtxEmbedded: false,
    rtxLlmReady: false,
    anthropicKey: false,
    xConnected: false,
    xSynced: false,
    linkedinConnected: false,
    gmailConnected: false,
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
      fetch("/api/platforms/gmail")
        .then((r) => r.json())
        .catch(() => ({ connected: false })),
    ]).then(([health, settings, xStatus, linkedinStatus, gmailStatus]) => {
      const rtxEmbedded = health?.rtx?.mode === "embedded";
      setState({
        loading: false,
        rtxEmbedded,
        rtxLlmReady: rtxEmbedded && health?.rtx?.pingOk === true,
        anthropicKey: settings.source !== "none",
        xConnected: xStatus.connected === true,
        xSynced: xStatus.account?.lastSyncedAt != null,
        linkedinConnected: linkedinStatus.connected === true,
        gmailConnected: gmailStatus.connected === true,
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

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="rounded-lg bg-muted px-4 py-3 text-xs font-mono overflow-x-auto">
      {children}
    </pre>
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
              for in-depth tutorials covering every feature.
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
            Signals helps you manage contacts from social platforms, track
            engagement, build living knowledge graphs, and leverage AI-powered agents. Everything
            runs locally on your machine with SQLite — your data never leaves
            your computer.
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="flex items-start gap-2">
              <Users className="h-4 w-4 mt-0.5 text-primary shrink-0" />
              <span>Import and manage contacts from X/Twitter</span>
            </div>
            <div className="flex items-start gap-2">
              <Sparkles className="h-4 w-4 mt-0.5 text-primary shrink-0" />
              <span>Track enrichment scores across platforms</span>
            </div>
            <div className="flex items-start gap-2">
              <ListChecks className="h-4 w-4 mt-0.5 text-primary shrink-0" />
              <span>Create tasks and track engagement workflows</span>
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
            Complete these steps to get the most out of Signals.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ChecklistItem
            label={
              checklist.rtxEmbedded
                ? "RealtimeX LLM connected (llm.chat / llm.embed)"
                : "Anthropic API key configured (.env.local)"
            }
            done={checklist.rtxEmbedded ? checklist.rtxLlmReady : checklist.anthropicKey}
            loading={checklist.loading}
          />
          <ChecklistItem
            label="X/Twitter account connected"
            done={checklist.xConnected}
            loading={checklist.loading}
            href="/dashboard/settings"
          />
          <ChecklistItem
            label="LinkedIn account connected"
            done={checklist.linkedinConnected}
            loading={checklist.loading}
            href="/dashboard/settings"
          />
          <ChecklistItem
            label="Gmail / Google account connected"
            done={checklist.gmailConnected}
            loading={checklist.loading}
            href="/dashboard/settings"
          />
          <ChecklistItem
            label="First contact sync completed"
            done={checklist.xSynced}
            loading={checklist.loading}
            href="/dashboard/settings"
          />
        </CardContent>
      </Card>

      {/* Environment Setup */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            Environment Setup
          </CardTitle>
          <CardDescription>
            Configure environment variables for API access.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Copy <Code>.env.example</Code> to <Code>.env.local</Code> and fill
            in your credentials:
          </p>
          <CodeBlock>{`ANTHROPIC_API_KEY="sk-ant-..."   # standalone dev only; Local App uses RealtimeX LLM proxy
SERPER_API_KEY="..."             # optional; search migration in progress
TAVILY_API_KEY="..."             # optional; search migration in progress
X_CLIENT_ID="your-oauth2-client-id"
X_CLIENT_SECRET="your-oauth2-client-secret"
LINKEDIN_CLIENT_ID="your-linkedin-client-id"
LINKEDIN_CLIENT_SECRET="your-linkedin-client-secret"
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"`}</CodeBlock>
          <p className="text-xs text-muted-foreground">
            When Signals runs as a RealtimeX Local App, configure LLM models and approve{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">llm.chat</code> /{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">llm.embed</code> in
            RealtimeX <strong className="font-medium text-foreground">Settings → Local Apps</strong>
            — not in Signals Settings. For standalone development, set provider keys in{" "}
            <Code>.env.local</Code> and restart the server. X, LinkedIn, and Google credentials
            must be set as environment variables.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function XSetupTab() {
  return (
    <div className="space-y-6">
      {/* Prerequisites */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Twitter className="h-5 w-5" />
            Prerequisites
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <ul className="list-disc pl-5 space-y-1">
            <li>
              An X Developer account at{" "}
              <span className="text-primary font-medium">developer.x.com</span>
            </li>
            <li>A project and app created in the X Developer Portal</li>
            <li>Free tier: account connection + posting (500 posts/month)</li>
            <li>Basic tier ($200/mo): also enables contact sync (importing following list)</li>
          </ul>
        </CardContent>
      </Card>

      {/* Step 1 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <StepNumber n={1} />
            Create X Developer App
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <ol className="list-decimal pl-5 space-y-1">
            <li>
              Go to{" "}
              <span className="text-primary font-medium">developer.x.com</span>{" "}
              and sign in
            </li>
            <li>Navigate to the Dashboard and create a new Project/App</li>
            <li>
              Note the API Key and API Secret shown on the{" "}
              <strong className="text-foreground">Keys and tokens</strong> tab
              (these are OAuth 1.0a credentials — for reference only)
            </li>
          </ol>
        </CardContent>
      </Card>

      {/* Step 2 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <StepNumber n={2} />
            Configure User Authentication
          </CardTitle>
          <CardDescription>
            This generates the OAuth 2.0 credentials that Signals uses.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <ol className="list-decimal pl-5 space-y-2">
            <li>
              In your app, go to{" "}
              <strong className="text-foreground">Settings</strong> &rarr;{" "}
              <strong className="text-foreground">
                User authentication settings
              </strong>{" "}
              &rarr;{" "}
              <strong className="text-foreground">Set up</strong>
            </li>
            <li>
              <strong className="text-foreground">App permissions</strong>:
              Select <Code>Read and write</Code>
            </li>
            <li>
              <strong className="text-foreground">Type of App</strong>: Select{" "}
              <Code>Web App, Automated App or Bot</Code> (Confidential client)
            </li>
            <li>
              <strong className="text-foreground">
                Callback URI / Redirect URL
              </strong>
              :
              <CodeBlock>http://localhost:3000/api/platforms/x/callback</CodeBlock>
            </li>
            <li>
              <strong className="text-foreground">Website URL</strong>: Your
              domain (e.g., <Code>https://yourdomain.com</Code>)
            </li>
            <li>
              Click <strong className="text-foreground">Save</strong> — X
              generates a new{" "}
              <strong className="text-foreground">OAuth 2.0 Client ID</strong>{" "}
              and{" "}
              <strong className="text-foreground">Client Secret</strong>
            </li>
          </ol>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            Save these immediately — the Client Secret is shown only once.
          </div>
        </CardContent>
      </Card>

      {/* Step 3 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <StepNumber n={3} />
            Configure Signals
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Add the OAuth 2.0 credentials to your <Code>.env.local</Code>:
          </p>
          <CodeBlock>{`X_CLIENT_ID="your-oauth2-client-id"
X_CLIENT_SECRET="your-oauth2-client-secret"`}</CodeBlock>
          <p>
            Restart the dev server (<Code>npm run dev</Code>) to pick up the new
            variables.
          </p>
          <div className="rounded-lg border bg-muted/50 p-3 text-xs">
            <strong className="text-foreground">Note:</strong> The OAuth 2.0
            Client ID/Secret (from User Authentication setup) are different from
            the API Key/Secret shown on the Keys tab. Signals uses OAuth 2.0.
          </div>
        </CardContent>
      </Card>

      {/* Step 4 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <StepNumber n={4} />
            Connect & Sync
          </CardTitle>
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
              &rarr; Platform Connections &rarr; Click{" "}
              <strong className="text-foreground">Connect</strong> on X/Twitter
            </li>
            <li>Authorize the app on X (works on all tiers, including Free)</li>
            <li>
              <strong className="text-foreground">Free tier</strong>: You&apos;re
              connected and can post. To import contacts, click{" "}
              <strong className="text-foreground">Enable Contact Sync</strong>{" "}
              (requires Basic tier)
            </li>
            <li>
              <strong className="text-foreground">Basic tier</strong>: Click{" "}
              <strong className="text-foreground">Enable Contact Sync</strong>{" "}
              &rarr; re-authorize with extended permissions &rarr; then click{" "}
              <strong className="text-foreground">Sync Now</strong>
            </li>
            <li>
              Contacts appear in{" "}
              <Link
                href="/dashboard/contacts"
                className="text-primary underline underline-offset-2"
              >
                Contacts
              </Link>{" "}
              with X identity badges and enrichment scores
            </li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

function LinkedInSetupTab() {
  return (
    <div className="space-y-6">
      {/* Prerequisites */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Linkedin className="h-5 w-5" />
            Prerequisites
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <ul className="list-disc pl-5 space-y-1">
            <li>
              A LinkedIn Developer account at{" "}
              <span className="text-primary font-medium">
                linkedin.com/developers
              </span>
            </li>
            <li>
              An app with the{" "}
              <strong className="text-foreground">
                Sign In with LinkedIn using OpenID Connect
              </strong>{" "}
              product enabled
            </li>
            <li>No paid tier required — the free API product is sufficient</li>
          </ul>
        </CardContent>
      </Card>

      {/* Step 1 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <StepNumber n={1} />
            Create LinkedIn App
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <ol className="list-decimal pl-5 space-y-2">
            <li>
              Go to{" "}
              <span className="text-primary font-medium">
                linkedin.com/developers
              </span>{" "}
              and sign in with your LinkedIn account
            </li>
            <li>
              Click{" "}
              <strong className="text-foreground">Create app</strong> — you will
              need to associate it with a LinkedIn Company Page (a personal page
              works fine)
            </li>
            <li>
              Under the{" "}
              <strong className="text-foreground">Products</strong> tab, request{" "}
              <strong className="text-foreground">
                Sign In with LinkedIn using OpenID Connect
              </strong>
            </li>
            <li>Approval is usually instant</li>
          </ol>
        </CardContent>
      </Card>

      {/* Step 2 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <StepNumber n={2} />
            Configure OAuth 2.0
          </CardTitle>
          <CardDescription>
            Set up the redirect URL and copy your credentials.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <ol className="list-decimal pl-5 space-y-2">
            <li>
              In your LinkedIn app, go to the{" "}
              <strong className="text-foreground">Auth</strong> tab
            </li>
            <li>
              Under{" "}
              <strong className="text-foreground">
                OAuth 2.0 settings
              </strong>
              , add this redirect URL:
              <CodeBlock>
                http://localhost:3000/api/platforms/linkedin/callback
              </CodeBlock>
            </li>
            <li>
              Copy the{" "}
              <strong className="text-foreground">Client ID</strong> and{" "}
              <strong className="text-foreground">Client Secret</strong> from
              the top of the Auth tab
            </li>
          </ol>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            Save the Client Secret immediately — you may not be able to view it
            again without regenerating.
          </div>
        </CardContent>
      </Card>

      {/* Step 3 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <StepNumber n={3} />
            Configure Signals
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Add the LinkedIn credentials to your <Code>.env.local</Code>:
          </p>
          <CodeBlock>{`LINKEDIN_CLIENT_ID="your-linkedin-client-id"
LINKEDIN_CLIENT_SECRET="your-linkedin-client-secret"`}</CodeBlock>
          <p>
            Restart the dev server (<Code>npm run dev</Code>) to pick up the new
            variables.
          </p>
          <div className="rounded-lg border bg-muted/50 p-3 text-xs">
            <strong className="text-foreground">Note:</strong> LinkedIn uses
            standard OAuth 2.0 (no PKCE). The client secret is sent as a POST
            body parameter during token exchange, not via Basic auth headers.
          </div>
        </CardContent>
      </Card>

      {/* Step 4 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <StepNumber n={4} />
            Connect & Sync
          </CardTitle>
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
              &rarr; Platform Connections &rarr; Click{" "}
              <strong className="text-foreground">Connect</strong> on LinkedIn
            </li>
            <li>Authorize Signals on LinkedIn</li>
            <li>
              Click{" "}
              <strong className="text-foreground">Sync Now</strong> to import
              your LinkedIn connections
            </li>
            <li>
              Contacts appear in{" "}
              <Link
                href="/dashboard/contacts"
                className="text-primary underline underline-offset-2"
              >
                Contacts
              </Link>{" "}
              with LinkedIn identity badges and enrichment scores
            </li>
          </ol>
        </CardContent>
      </Card>

      {/* CSV Import Alternative */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileDown className="h-5 w-5" />
            Alternative: Import from Data Export (No API Required)
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

function GmailSetupTab() {
  return (
    <div className="space-y-6">
      {/* Prerequisites */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Prerequisites
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <ul className="list-disc pl-5 space-y-1">
            <li>
              A Google Cloud Console account at{" "}
              <span className="text-primary font-medium">
                console.cloud.google.com
              </span>
            </li>
            <li>
              OAuth consent screen configured (can be in &ldquo;Testing&rdquo;
              mode)
            </li>
            <li>
              <strong className="text-foreground">People API</strong> and{" "}
              <strong className="text-foreground">Gmail API</strong> enabled on
              your project
            </li>
          </ul>
        </CardContent>
      </Card>

      {/* Step 1 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <StepNumber n={1} />
            Create Google Cloud Project
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <ol className="list-decimal pl-5 space-y-2">
            <li>
              Go to{" "}
              <span className="text-primary font-medium">
                console.cloud.google.com
              </span>{" "}
              and sign in
            </li>
            <li>Create a new project (or select an existing one)</li>
            <li>
              Navigate to{" "}
              <strong className="text-foreground">
                APIs &amp; Services
              </strong>{" "}
              &rarr;{" "}
              <strong className="text-foreground">Library</strong>
            </li>
            <li>
              Search for and enable{" "}
              <strong className="text-foreground">People API</strong> and{" "}
              <strong className="text-foreground">Gmail API</strong>
            </li>
          </ol>
          <div className="rounded-lg border bg-muted/50 p-3 text-xs">
            <strong className="text-foreground">Note:</strong> Both APIs must be
            enabled — People API for contact import, Gmail API for email metadata
            enrichment.
          </div>
        </CardContent>
      </Card>

      {/* Step 2 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <StepNumber n={2} />
            Configure OAuth Consent Screen
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <ol className="list-decimal pl-5 space-y-2">
            <li>
              Go to{" "}
              <strong className="text-foreground">
                APIs &amp; Services
              </strong>{" "}
              &rarr;{" "}
              <strong className="text-foreground">
                OAuth consent screen
              </strong>
            </li>
            <li>
              Choose <Code>External</Code> user type (or Internal for Workspace
              accounts)
            </li>
            <li>Set app name, user support email, and developer email</li>
            <li>
              Add scopes:{" "}
              <Code>contacts.readonly</Code> and{" "}
              <Code>gmail.readonly</Code>
            </li>
            <li>
              If in <strong className="text-foreground">Testing</strong> mode,
              add your Google account as a test user
            </li>
          </ol>
        </CardContent>
      </Card>

      {/* Step 3 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <StepNumber n={3} />
            Create OAuth Credentials
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <ol className="list-decimal pl-5 space-y-2">
            <li>
              Go to{" "}
              <strong className="text-foreground">
                APIs &amp; Services
              </strong>{" "}
              &rarr;{" "}
              <strong className="text-foreground">Credentials</strong>
            </li>
            <li>
              Click{" "}
              <strong className="text-foreground">
                Create Credentials
              </strong>{" "}
              &rarr;{" "}
              <strong className="text-foreground">OAuth client ID</strong>
            </li>
            <li>
              Application type:{" "}
              <Code>Web application</Code>
            </li>
            <li>
              Add authorized redirect URI:
              <CodeBlock>
                http://localhost:3000/api/platforms/gmail/callback
              </CodeBlock>
            </li>
            <li>
              Copy the{" "}
              <strong className="text-foreground">Client ID</strong> and{" "}
              <strong className="text-foreground">Client Secret</strong>
            </li>
          </ol>
        </CardContent>
      </Card>

      {/* Step 4 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <StepNumber n={4} />
            Configure Signals
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Add the Google credentials to your <Code>.env.local</Code>:
          </p>
          <CodeBlock>{`GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"`}</CodeBlock>
          <p>
            Restart the dev server (<Code>npm run dev</Code>) to pick up the new
            variables.
          </p>
        </CardContent>
      </Card>

      {/* Step 5 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <StepNumber n={5} />
            Connect &amp; Sync
          </CardTitle>
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
              &rarr; Platform Connections &rarr; Click{" "}
              <strong className="text-foreground">Connect</strong> on Gmail
            </li>
            <li>Authorize Signals on your Google account</li>
            <li>
              Click{" "}
              <strong className="text-foreground">Sync Now</strong> to import
              Google contacts via the People API
            </li>
            <li>
              Click{" "}
              <strong className="text-foreground">Sync Metadata</strong> to
              enrich contacts with email frequency data (sent/received counts in
              last 30 days, last message date)
            </li>
            <li>
              Contacts appear in{" "}
              <Link
                href="/dashboard/contacts"
                className="text-primary underline underline-offset-2"
              >
                Contacts
              </Link>{" "}
              with Gmail identity badges and enrichment scores
            </li>
          </ol>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            If your app is in &ldquo;Testing&rdquo; mode, you will see an
            &ldquo;unverified app&rdquo; warning. Click{" "}
            <strong>Advanced</strong> &rarr;{" "}
            <strong>Go to Signals (unsafe)</strong> to proceed.
          </div>
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
            Contacts
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <ul className="list-disc pl-5 space-y-1">
            <li>Create, edit, and delete contacts</li>
            <li>Search across name and email fields</li>
            <li>Filter by funnel stage and platform</li>
            <li>Each contact tracks an enrichment score (0 &ndash; 100)</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LinkIcon className="h-5 w-5" />
            Contact Identities & Enrichment
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <ul className="list-disc pl-5 space-y-1">
            <li>
              Contacts can have multiple platform identities (X, LinkedIn, etc.)
            </li>
            <li>
              Enrichment score computed from profile completeness: name, email,
              phone, bio, location, photo, and platform data
            </li>
            <li>
              Scores update automatically on every contact or identity change
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5" />
            X/Twitter Sync
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <ul className="list-disc pl-5 space-y-1">
            <li>
              Imports your &ldquo;following&rdquo; list as CRM contacts
            </li>
            <li>
              Deduplicates by platform user ID — re-syncing updates existing
              contacts
            </li>
            <li>
              Pulls: name, bio, location, profile photo, follower/following
              counts
            </li>
            <li>Rate limiting tracked from X API response headers</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Linkedin className="h-5 w-5" />
            LinkedIn Sync
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <ul className="list-disc pl-5 space-y-1">
            <li>Imports your LinkedIn connections as CRM contacts</li>
            <li>
              Deduplicates by LinkedIn platform user ID — re-syncing updates
              existing contacts
            </li>
            <li>
              Pulls: name, headline, vanity URL, profile photo
            </li>
            <li>
              Cross-platform enrichment: contacts with both X and LinkedIn
              identities get bonus enrichment score
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Gmail / Google
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <ul className="list-disc pl-5 space-y-1">
            <li>Imports contacts from Google Contacts (People API)</li>
            <li>
              Email metadata enrichment: sent/received counts in last 30 days
              and last interaction date
            </li>
            <li>
              Cross-platform dedup with X and LinkedIn contacts
            </li>
            <li>
              No email content is stored — only metadata (message counts and
              dates)
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListChecks className="h-5 w-5" />
            Tasks
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <ul className="list-disc pl-5 space-y-1">
            <li>Create manual tasks linked to contacts</li>
            <li>
              Track status: todo &rarr; in_progress &rarr; blocked &rarr; done
            </li>
            <li>Priority levels: low, medium, high, urgent</li>
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
          SQLite at <Code>~/.signals/data.db</Code>. All data stays on your
          machine — nothing is sent to external servers.
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
      q: "What X API plan do I need?",
      a: "Free tier supports account connection and posting (500 posts/month). To import your following list via Contact Sync, you need the Basic tier ($200/mo) which includes follows.read access.",
    },
    {
      icon: Key,
      q: "Why do I need two sets of X credentials?",
      a: (
        <>
          The API Key/Secret (Keys tab) are OAuth 1.0a credentials. The Client
          ID/Secret (from User Authentication setup) are OAuth 2.0 credentials.
          Signals uses OAuth 2.0.
        </>
      ),
    },
    {
      icon: RefreshCw,
      q: "What happens when I click Sync?",
      a: "Fetches up to 1,000 accounts you follow, creates or updates contacts with X profile data, and computes enrichment scores. Requires the X API Basic tier ($200/mo) for follows.read access.",
    },
    {
      icon: RefreshCw,
      q: "Why can't I sync contacts?",
      a: "Contact sync uses the follows.read endpoint which X removed from the Free tier in August 2025. You need the X API Basic tier ($200/mo). After upgrading your X Developer plan, click \"Enable Contact Sync\" in Settings to re-authorize with the required permissions.",
    },
    {
      icon: Linkedin,
      q: "What LinkedIn API product do I need?",
      a: "\"Sign In with LinkedIn using OpenID Connect\" — it's free and gives access to profile and email data. No paid LinkedIn Developer tier required.",
    },
    {
      icon: Sparkles,
      q: "How does cross-platform enrichment work?",
      a: "Contacts matched across X, LinkedIn, and Gmail get a +10 enrichment score bonus for having multiple platform identities. LinkedIn also contributes up to +15 points from professional fields like headline, company, and title.",
    },
    {
      icon: Mail,
      q: "What Google APIs do I need?",
      a: "People API (for importing Google contacts) and Gmail API (for email metadata enrichment). Both must be enabled in your Google Cloud Console project under APIs & Services.",
    },
    {
      icon: Mail,
      q: "What does Gmail metadata sync do?",
      a: "Enriches contacts with email frequency data — sent and received message counts in the last 30 days, plus the last message date. No email content is read or stored, only aggregate metadata.",
    },
    {
      icon: UserPlus,
      q: "Can I connect multiple X accounts?",
      a: "Currently one account per platform. The schema supports multiple but the UI assumes single-user.",
    },
    {
      icon: Key,
      q: "How do I update my API keys?",
      a: (
        <>
          When running as a RealtimeX Local App, configure LLM and search through
          RealtimeX <strong className="font-medium text-foreground">Settings → Local Apps</strong>
          (approve <Code>llm.chat</Code> and <Code>llm.embed</Code> for Signals). For
          standalone development, edit <Code>.env.local</Code> and restart the dev server.
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

const VALID_TABS = ["getting-started", "x-setup", "linkedin-setup", "gmail-setup", "features", "faq"] as const;
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
          <TabsTrigger value="gmail-setup">
            <Mail className="h-4 w-4" />
            Gmail Setup
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
        <TabsContent value="gmail-setup">
          <GmailSetupTab />
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
