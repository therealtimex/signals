import type { RtxChatErrorCode } from "@/lib/rtx/llm";

export class PersonaEvidenceError extends Error {
  readonly code = "PERSONA_EVIDENCE_ERROR" as const;

  constructor(message: string) {
    super(message);
    this.name = "PersonaEvidenceError";
  }
}

export class PersonaScopeError extends Error {
  readonly code = "PERSONA_SCOPE_ERROR" as const;

  constructor(message: string) {
    super(message);
    this.name = "PersonaScopeError";
  }
}

export class PersonaSynthesisError extends Error {
  readonly code = "PERSONA_SYNTHESIS_ERROR" as const;

  constructor(message: string) {
    super(message);
    this.name = "PersonaSynthesisError";
  }
}

export class PersonaGenerationUnavailableError extends Error {
  readonly code = "PERSONA_GENERATION_UNAVAILABLE" as const;
  readonly rtxCode: RtxChatErrorCode;

  constructor(rtxCode: RtxChatErrorCode, message: string) {
    super(message);
    this.name = "PersonaGenerationUnavailableError";
    this.rtxCode = rtxCode;
  }
}
