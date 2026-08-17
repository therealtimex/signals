/** Legacy scalar restore hook — channel/platform columns dropped in P1e. */
export function ensureContactScalarColumns(): { restored: string[]; projections: number } {
  return { restored: [], projections: 0 };
}
