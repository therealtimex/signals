export class SimulationScopeError extends Error {
  readonly code = "SIMULATION_SCOPE_ERROR" as const;

  constructor(message: string) {
    super(message);
    this.name = "SimulationScopeError";
  }
}

export class SimulationRunStateError extends Error {
  readonly code = "SIMULATION_RUN_STATE_ERROR" as const;

  constructor(message: string) {
    super(message);
    this.name = "SimulationRunStateError";
  }
}
