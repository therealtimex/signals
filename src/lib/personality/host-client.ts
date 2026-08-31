import { z } from "zod";
import { type PersonalityWorkspace } from "@/lib/personality/workspace";
import { getRtxAppId, resolveRtxApiBase, type EnvLike } from "@/lib/rtx/env";

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/).nullable();
const shimSchema = z.object({
  requested: z.boolean(),
  created: z.boolean(),
  state: z.enum(["symlink", "regular_file", "missing", "copy"]),
  error: z.string().optional(),
}).strict();
const workspaceSchema = z.object({
  slug: z.string().min(1),
  id: z.union([z.string(), z.number()]).nullable(),
  dir: z.string().min(1),
  key: z.string().min(1).optional(),
}).passthrough();
const committedFileSchema = z.object({ path: z.string().min(1), fileHash: hashSchema }).strict();
const recoveryFileSchema = z.object({
  path: z.string().min(1),
  expectedBeforeHash: hashSchema,
  proposedFileHash: hashSchema,
  currentFileHash: hashSchema,
}).strict();

const hostTransactionSchema = z.object({
  transactionId: z.string().min(8).max(200),
  status: z.enum([
    "committed",
    "restored_failure",
    "recovery_required",
    "resolved_discarded",
    "not_started",
  ]),
  origin: z.string(),
  appId: z.string().nullable(),
  workspace: workspaceSchema,
  requestHash: hashSchema,
  files: z.array(z.union([committedFileSchema, recoveryFileSchema])),
  shim: shimSchema,
  reason: z.string().optional(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  replayed: z.boolean(),
}).strict();

const listingSchema = z.object({
  success: z.literal(true),
  workspace: workspaceSchema,
  files: z.array(z.object({
    path: z.string().min(1),
    fileHash: hashSchema,
    size: z.number().int().nonnegative(),
    content: z.string().nullable(),
  }).strict()),
  claudeShim: z.enum(["symlink", "regular_file", "missing", "copy"]),
  allowlist: z.object({ pattern: z.string(), excluded: z.array(z.string()) }).strict(),
}).strict();

const transactionResponseSchema = z.object({
  success: z.boolean(),
  transaction: hostTransactionSchema,
}).passthrough();

export type HostPersonalityListing = z.infer<typeof listingSchema>;
export type HostPersonalityTransaction = z.infer<typeof hostTransactionSchema>;
export type HostTransactionFile = {
  path: string;
  expectedFileHash: string | null;
  proposedFile: string | null;
  proposedFileHash: string | null;
};

export class HostPersonalityError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number | null,
    public readonly details: Record<string, unknown> = {},
    public readonly transaction: HostPersonalityTransaction | null = null,
    public readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "HostPersonalityError";
  }
}

type ClientOptions = { env?: EnvLike; fetchImpl?: typeof fetch };

export class PersonalityHostClient {
  readonly appId: string;
  readonly apiBase: string;
  readonly fetchImpl: typeof fetch;

  constructor(options: ClientOptions = {}) {
    const env = options.env ?? process.env;
    const appId = getRtxAppId(env);
    const apiBase = resolveRtxApiBase(env);
    if (!appId || !apiBase) {
      throw new HostPersonalityError(
        "RealTimeX Personality writer is not configured",
        "HOST_UNAVAILABLE",
        null,
      );
    }
    this.appId = appId;
    this.apiBase = apiBase;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request(path: string, init: RequestInit): Promise<{
    response: Response;
    body: unknown;
  }> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.apiBase}${path}`, {
        ...init,
        headers: {
          "content-type": "application/json",
          "x-app-id": this.appId,
          ...(init.headers ?? {}),
        },
      });
    } catch (error) {
      throw new HostPersonalityError(
        error instanceof Error ? error.message : "RealTimeX Personality writer request failed",
        "NETWORK_ERROR",
        null,
      );
    }
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { response, body };
  }

  private error(response: Response, body: unknown): HostPersonalityError {
    const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const transaction = hostTransactionSchema.safeParse(record.transaction);
    const retryAfterRaw = response.headers.get("retry-after");
    const retryAfter = retryAfterRaw === null ? null : Number.parseInt(retryAfterRaw, 10);
    const { transaction: _transaction, error: _error, ...details } = record;
    return new HostPersonalityError(
      typeof record.error === "string" ? record.error : `RealTimeX Personality writer failed (${response.status})`,
      typeof record.code === "string" ? record.code : "HOST_ERROR",
      response.status,
      details,
      transaction.success ? transaction.data : null,
      Number.isFinite(retryAfter) ? retryAfter : null,
    );
  }

  async listPersonalityFiles(workspace: PersonalityWorkspace): Promise<HostPersonalityListing> {
    const { response, body } = await this.request(
      `/sdk/workspaces/${encodeURIComponent(workspace.slug)}/personality-files?include=content&workspaceId=${encodeURIComponent(workspace.id ?? "")}`,
      { method: "GET" },
    );
    if (!response.ok) throw this.error(response, body);
    const parsed = listingSchema.safeParse(body);
    if (!parsed.success) {
      throw new HostPersonalityError("RealTimeX returned an invalid Personality listing", "INVALID_RESPONSE", response.status);
    }
    return parsed.data;
  }

  async putTransaction(
    workspace: PersonalityWorkspace,
    transactionId: string,
    files: HostTransactionFile[],
    createClaudeShim: boolean,
  ): Promise<HostPersonalityTransaction> {
    const { response, body } = await this.request(
      `/sdk/workspaces/${encodeURIComponent(workspace.slug)}/personality-files/transactions/${encodeURIComponent(transactionId)}`,
      {
        method: "PUT",
        body: JSON.stringify({
          schemaVersion: 1,
          workspaceId: workspace.id,
          files,
          claudeShim: { createIfAbsent: createClaudeShim },
        }),
      },
    );
    if (!response.ok) throw this.error(response, body);
    const parsed = transactionResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new HostPersonalityError("RealTimeX returned an invalid Personality transaction", "INVALID_RESPONSE", response.status);
    }
    return parsed.data.transaction;
  }

  async inspectTransaction(
    workspace: PersonalityWorkspace,
    transactionId: string,
  ): Promise<HostPersonalityTransaction> {
    return this.transactionRequest(workspace, transactionId, "inspect");
  }

  async recoverTransaction(
    workspace: PersonalityWorkspace,
    transactionId: string,
  ): Promise<HostPersonalityTransaction> {
    return this.transactionRequest(workspace, transactionId, "recover");
  }

  private async transactionRequest(
    workspace: PersonalityWorkspace,
    transactionId: string,
    operation: "inspect" | "recover",
  ): Promise<HostPersonalityTransaction> {
    const suffix = operation === "recover" ? "/recover" : "";
    const { response, body } = await this.request(
      `/sdk/workspaces/${encodeURIComponent(workspace.slug)}/personality-files/transactions/${encodeURIComponent(transactionId)}${suffix}`,
      operation === "recover"
        ? { method: "POST", body: JSON.stringify({ mode: "restore", workspaceId: workspace.id }) }
        : { method: "GET" },
    );
    if (!response.ok) throw this.error(response, body);
    const parsed = transactionResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new HostPersonalityError("RealTimeX returned an invalid Personality transaction", "INVALID_RESPONSE", response.status);
    }
    return parsed.data.transaction;
  }
}
