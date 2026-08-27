import { registerPersonaAgentJobBackend } from "@/lib/settings/persona-generation-mode";

registerPersonaAgentJobBackend();

export * from "@/lib/persona/agent-job/prompt";
export * from "@/lib/persona/agent-job/service";
