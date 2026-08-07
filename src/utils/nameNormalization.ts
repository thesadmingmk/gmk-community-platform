/**
 * Centralized name normalization utility.
 * Formats names to standard Title Case (e.g., "meena kesavan" -> "Meena Kesavan").
 */
export function normalizeName(val: string | null | undefined): string {
  if (!val) return "";
  return val
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
