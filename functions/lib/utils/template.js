"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.replacePlaceholders = replacePlaceholders;
/**
 * Replaces placeholder keys denoted by {{key}} with matching values from a dictionary.
 */
function replacePlaceholders(content, placeholders) {
    if (!content)
        return "";
    let result = content;
    for (const [key, value] of Object.entries(placeholders)) {
        const escapedKey = key.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
        const regex = new RegExp(`{{\\s*${escapedKey}\\s*}}`, "g");
        result = result.replace(regex, value !== undefined && value !== null ? String(value) : "");
    }
    return result;
}
//# sourceMappingURL=template.js.map