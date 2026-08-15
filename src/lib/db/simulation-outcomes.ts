/** Open vocabulary for per-agent simulation outcomes — extend here as formats grow. */
export const SIMULATION_OUTCOMES = [
  "ignore",
  "impression",
  "like",
  "reply",
  "share",
  "click",
  "convert",
] as const;

export type SimulationOutcome = (typeof SIMULATION_OUTCOMES)[number];

export function isSimulationOutcome(value: string): value is SimulationOutcome {
  return (SIMULATION_OUTCOMES as readonly string[]).includes(value);
}

export function assertSimulationOutcome(value: string): SimulationOutcome {
  if (!isSimulationOutcome(value)) {
    throw new Error(`Invalid simulation outcome: ${value}`);
  }
  return value;
}
