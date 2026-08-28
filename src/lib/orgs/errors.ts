import type { NormalizeDomainErrorCode } from "@/lib/orgs/domain";

export class OrgValidationError extends Error {
  readonly code = "VALIDATION_ERROR";

  constructor(
    message: string,
    readonly details: { field: string; code?: NormalizeDomainErrorCode },
  ) {
    super(message);
    this.name = "OrgValidationError";
  }
}

export class OrgDomainConflictError extends Error {
  readonly code = "CONFLICT";

  constructor(
    readonly domain: string,
    readonly orgId: string,
  ) {
    super(`Domain ${domain} is already assigned to another company`);
    this.name = "OrgDomainConflictError";
  }
}
