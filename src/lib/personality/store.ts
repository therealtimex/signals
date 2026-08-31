import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { AgentToolError } from "@/lib/agent-tools/types";
import {
  type PersonalityIndex,
  type PersonalityProposal,
  personalityIndexSchema,
  personalityProposalSchema,
} from "@/lib/personality/contracts";
import { personalityStoreDir } from "@/lib/personality/store-paths";
import {
  commitIndex,
  installImmutable,
  withStoreLock,
} from "@/lib/store/locked-json-store";
import { sha256Canonical } from "@/lib/writing/hash";

const HISTORY_LIMIT = 50;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1_000);
}

function storeConflict(message: string, details: Record<string, unknown> = {}): never {
  throw new AgentToolError("STORE_CONFLICT", message, {
    reason: "store_corrupt",
    ...details,
  });
}

export function emptyPersonalityIndex(at = 0): PersonalityIndex {
  return personalityIndexSchema.parse({
    schemaVersion: 1,
    generation: 0,
    bindings: {},
    proposals: {},
    updatedAt: at,
  });
}

export function computeProposalHash(proposal: PersonalityProposal): string {
  const {
    proposalHash: _proposalHash,
    proposedBy: _proposedBy,
    ...applyRelevant
  } = proposal;
  return sha256Canonical(applyRelevant);
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return storeConflict("Personality store contains invalid JSON", {
      path,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function indexPath(root: string): string {
  return join(root, "index.json");
}

function proposalsDir(root: string): string {
  return join(root, "proposals");
}

function proposalPath(root: string, proposalId: string): string {
  return join(proposalsDir(root), `${proposalId}.json`);
}

function parseProposal(root: string, proposalId: string): PersonalityProposal {
  const path = proposalPath(root, proposalId);
  if (!existsSync(path)) {
    return storeConflict("Personality proposal document is missing", {
      proposalId,
    });
  }
  const parsed = personalityProposalSchema.safeParse(readJson(path));
  if (!parsed.success || parsed.data.id !== proposalId) {
    return storeConflict("Personality proposal document is invalid", {
      proposalId,
      errors: parsed.success ? ["proposal_id_mismatch"] : parsed.error.flatten(),
    });
  }
  if (computeProposalHash(parsed.data) !== parsed.data.proposalHash) {
    return storeConflict("Personality proposal hash does not match its contents", {
      proposalId,
    });
  }
  return parsed.data;
}

function validateReferences(
  root: string,
  index: PersonalityIndex,
): Map<string, PersonalityProposal> {
  const proposals = new Map<string, PersonalityProposal>();
  for (const [proposalId, record] of Object.entries(index.proposals)) {
    const proposal = parseProposal(root, proposalId);
    if (proposal.workspace.key !== record.workspaceKey) {
      return storeConflict("Personality proposal workspace reference is invalid", {
        proposalId,
      });
    }
    proposals.set(proposalId, proposal);
  }
  for (const bindingSet of Object.values(index.bindings)) {
    const bindings = [bindingSet.active, ...bindingSet.history].filter(
      (binding): binding is NonNullable<typeof binding> => binding !== null,
    );
    for (const binding of bindings) {
      const proposal = proposals.get(binding.proposalId)
        ?? parseProposal(root, binding.proposalId);
      if (
        proposal.workspace.key !== binding.workspace.key
        || proposal.proposedBindingId !== binding.id
      ) {
        return storeConflict("Personality binding references an invalid proposal", {
          bindingId: binding.id,
          proposalId: binding.proposalId,
        });
      }
      proposals.set(proposal.id, proposal);
    }
  }
  return proposals;
}

export type PersonalityStoreSnapshot = {
  root: string;
  index: PersonalityIndex;
  proposals: Map<string, PersonalityProposal>;
  orphanProposalIds: string[];
};

export function readPersonalityStore(
  root = personalityStoreDir(),
): PersonalityStoreSnapshot {
  const path = indexPath(root);
  const index = existsSync(path)
    ? personalityIndexSchema.safeParse(readJson(path))
    : { success: true as const, data: emptyPersonalityIndex() };
  if (!index.success) {
    return storeConflict("Personality store index is invalid", {
      errors: index.error.flatten(),
    });
  }
  const proposals = validateReferences(root, index.data);
  const proposalRoot = proposalsDir(root);
  const referenced = new Set(proposals.keys());
  const orphanProposalIds = existsSync(proposalRoot)
    ? readdirSync(proposalRoot, { withFileTypes: true })
        .filter((entry) => entry.isFile() && /^prp_[A-Za-z0-9_-]{6,}\.json$/.test(entry.name))
        .map((entry) => entry.name.slice(0, -5))
        .filter((id) => !referenced.has(id))
        .sort()
    : [];
  return { root, index: index.data, proposals, orphanProposalIds };
}

export type PersonalityStoreSession = {
  readonly root: string;
  readonly index: PersonalityIndex;
  getProposal: (proposalId: string) => PersonalityProposal;
  commit: (
    next: Omit<PersonalityIndex, "generation" | "updatedAt">,
    proposals?: PersonalityProposal[],
  ) => PersonalityIndex;
};

export async function withPersonalityStore<T>(
  operation: (session: PersonalityStoreSession) => Promise<T> | T,
  options: { timeoutMs?: number } = {},
): Promise<T> {
  const root = personalityStoreDir();
  return withStoreLock(
    root,
    root,
    async () => {
      let snapshot = readPersonalityStore(root);
      const session: PersonalityStoreSession = {
        root,
        get index() {
          return snapshot.index;
        },
        getProposal(proposalId) {
          return snapshot.proposals.get(proposalId) ?? parseProposal(root, proposalId);
        },
        commit(nextInput, proposals = []) {
          for (const proposal of proposals) {
            const parsed = personalityProposalSchema.parse(proposal);
            if (parsed.proposalHash !== computeProposalHash(parsed)) {
              throw new AgentToolError(
                "STORE_CONFLICT",
                "Refusing to persist a proposal with an invalid hash",
                { proposalId: parsed.id },
              );
            }
            mkdirSync(proposalsDir(root), { recursive: true });
            const path = proposalPath(root, parsed.id);
            if (existsSync(path)) {
              const existing = parseProposal(root, parsed.id);
              if (sha256Canonical(existing) !== sha256Canonical(parsed)) {
                throw new AgentToolError(
                  "STORE_CONFLICT",
                  "Immutable Personality proposal already exists with different content",
                  { proposalId: parsed.id },
                );
              }
            } else {
              installImmutable(path, parsed);
            }
          }
          const next = personalityIndexSchema.parse({
            ...nextInput,
            generation: snapshot.index.generation + 1,
            updatedAt: nowSeconds(),
            bindings: Object.fromEntries(
              Object.entries(nextInput.bindings).map(([key, value]) => [
                key,
                { ...value, history: value.history.slice(0, HISTORY_LIMIT) },
              ]),
            ),
          });
          commitIndex(
            () => readPersonalityStore(root).index,
            snapshot.index,
            next,
            {
              path: indexPath(root),
              conflictMessage: "Personality store changed during commit",
            },
          );
          snapshot = readPersonalityStore(root);
          return snapshot.index;
        },
      };
      return operation(session);
    },
    {
      timeoutMs: options.timeoutMs,
      busyMessage: "Personality store is busy",
    },
  );
}

export function getPersonalityProposal(
  proposalId: string,
): { proposal: PersonalityProposal; record: PersonalityIndex["proposals"][string] } {
  const store = readPersonalityStore();
  const record = store.index.proposals[proposalId];
  if (!record) {
    throw new AgentToolError("NOT_FOUND", `Personality proposal not found: ${proposalId}`);
  }
  return {
    proposal: store.proposals.get(proposalId) ?? parseProposal(store.root, proposalId),
    record,
  };
}
