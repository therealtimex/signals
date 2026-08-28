/** Convert unix seconds to ARPP month precision (YYYY-MM). */
export function unixToYearMonth(unixSeconds: number | null | undefined): string | null {
  if (unixSeconds == null || unixSeconds <= 0) return null;
  const date = new Date(unixSeconds * 1000);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function unixToIso8601(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString();
}
