// Centralized phone validation and normalization utility

export interface PhoneValidationResult {
  isValid: boolean;
  error: string | null;
  normalized: string;
  fullNumber: string;
  countryCode: string;
}

// Map of country code to expected number lengths
export const COUNTRY_PHONE_METADATA: Record<string, { name: string; lengths: number[]; formatHelp: string }> = {
  "+968": { name: "Oman", lengths: [8], formatHelp: "8 digits (e.g. 91234567)" },
  "+91": { name: "India", lengths: [10], formatHelp: "10 digits (e.g. 9876543210)" },
  "+971": { name: "UAE", lengths: [9], formatHelp: "9 digits excluding lead '0' (e.g. 501234567)" },
  "+966": { name: "Saudi Arabia", lengths: [9], formatHelp: "9 digits" },
  "+965": { name: "Kuwait", lengths: [8], formatHelp: "8 digits" },
  "+974": { name: "Qatar", lengths: [8], formatHelp: "8 digits" },
  "+973": { name: "Bahrain", lengths: [8], formatHelp: "8 digits" },
  "+44": { name: "United Kingdom", lengths: [10], formatHelp: "10 digits" },
  "+1": { name: "United States / Canada", lengths: [10], formatHelp: "10 digits" },
};

/**
 * Normalizes and validates a phone number based on country-aware numbering standards.
 * Supports auto-trimming and trunk "0" stripping for UAE (+971).
 */
export function validateAndNormalizePhoneNumber(
  code: string,
  number: string,
  isOptional = false
): PhoneValidationResult {
  // If optional and empty, it's valid
  if (isOptional && !number.trim()) {
    return { isValid: true, error: null, normalized: "", fullNumber: "", countryCode: code };
  }

  // Retrieve raw digits only
  let cleaned = number.trim().replace(/\D/g, "");

  // Fallback if empty and not optional
  if (!cleaned) {
    return {
      isValid: false,
      error: "Phone number is required and must contain digits.",
      normalized: "",
      fullNumber: "",
      countryCode: code,
    };
  }

  const metadata = COUNTRY_PHONE_METADATA[code];
  const countryName = metadata ? metadata.name : "Selected Country";

  // UAE local trunk prefix stripping: "+971" must not retain the local trunk prefix "0"
  if (code === "+971") {
    if (cleaned.startsWith("0")) {
      cleaned = cleaned.substring(1);
    }
  }

  // Get expected lengths
  const expectedLengths = metadata?.lengths || [8, 9, 10, 11, 12, 13, 14, 15];

  // Specific error messages for major countries
  if (code === "+968" && cleaned.length !== 8) {
    return {
      isValid: false,
      error: `Oman Phone Number must be exactly 8 digits.`,
      normalized: cleaned,
      fullNumber: `${code} ${cleaned}`,
      countryCode: code,
    };
  }

  if (code === "+91" && cleaned.length !== 10) {
    return {
      isValid: false,
      error: `India Phone Number must be exactly 10 digits. Captured: ${cleaned.length}/10`,
      normalized: cleaned,
      fullNumber: `${code} ${cleaned}`,
      countryCode: code,
    };
  }

  if (code === "+971") {
    if (cleaned.length !== 9) {
      return {
        isValid: false,
        error: `UAE Phone Number must be exactly 9 digits (excluding the local trunk prefix '0'). Captured: ${cleaned.length}/9`,
        normalized: cleaned,
        fullNumber: `${code} ${cleaned}`,
        countryCode: code,
      };
    }
  }

  // General length check
  if (!expectedLengths.includes(cleaned.length)) {
    const helpText = metadata?.formatHelp || `valid length (${expectedLengths.join(", ")} digits)`;
    return {
      isValid: false,
      error: `${countryName} phone number must be ${helpText}. Captured: ${cleaned.length} digits`,
      normalized: cleaned,
      fullNumber: `${code} ${cleaned}`,
      countryCode: code,
    };
  }

  return {
    isValid: true,
    error: null,
    normalized: cleaned,
    fullNumber: `${code} ${cleaned}`,
    countryCode: code,
  };
}

/**
 * Universal phone number formatter preserving international country codes.
 * Ensures numbers are displayed cleanly (e.g. "+91 8589055855", "+968 91234567")
 * while safely recognizing legacy numbers without explicit country codes.
 */
export function formatPhoneWithCountryCode(phone: string | undefined | null, fallbackCode = '+968'): string {
  if (!phone) return '';
  const trimmed = phone.trim();

  // If already starts with '+', format cleanly with a single space after country code
  if (trimmed.startsWith('+')) {
    const knownCodes = ['+968', '+971', '+966', '+965', '+974', '+973', '+91', '+44', '+1'];
    for (const code of knownCodes) {
      if (trimmed.startsWith(code)) {
        const rest = trimmed.substring(code.length).replace(/\D/g, '');
        return `${code} ${rest}`;
      }
    }
    // Generic '+' code: match up to 4 digits prefix
    const match = trimmed.match(/^(\+\d{1,4})\s*(.*)$/);
    if (match) {
      const rest = match[2].replace(/\D/g, '');
      return `${match[1]} ${rest}`;
    }
  }

  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';

  // Check if digits already include country code prefix (e.g. "96891234567" or "918589055855")
  if (digits.startsWith('968') && digits.length === 11) {
    return `+968 ${digits.substring(3)}`;
  }
  if (digits.startsWith('91') && digits.length === 12) {
    return `+91 ${digits.substring(2)}`;
  }
  if (digits.startsWith('971') && digits.length === 12) {
    return `+971 ${digits.substring(3)}`;
  }

  // 10 digits starting with 6,7,8,9 -> India (+91)
  if (digits.length === 10 && ['6', '7', '8', '9'].includes(digits[0])) {
    return `+91 ${digits}`;
  }

  // 8 digits -> Oman (+968)
  if (digits.length === 8) {
    return `+968 ${digits}`;
  }

  return `${fallbackCode} ${digits}`;
}

