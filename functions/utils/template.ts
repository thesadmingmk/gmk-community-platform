/**
 * Replaces placeholder keys denoted by {{key}} with matching values from a dictionary.
 * Strips any lingering unreplaced placeholders to ensure raw {{tags}} never leak to the recipient.
 */
export function replacePlaceholders(content: string, placeholders: Record<string, any>, stripRemaining = true): string {
  if (!content) return "";
  let result = content;
  for (const [key, value] of Object.entries(placeholders)) {
    const escapedKey = key.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
    const regex = new RegExp(`{{\\s*${escapedKey}\\s*}}`, "g");
    result = result.replace(regex, value !== undefined && value !== null ? String(value) : "");
  }
  if (stripRemaining) {
    // Strip any remaining unreplaced {{placeholders}} so raw syntax never leaks to end recipients
    result = result.replace(/{{\s*[\w.-]+\s*}}/g, "");
  }
  return result;
}
