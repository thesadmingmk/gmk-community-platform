// Centralized phone validation and normalization utility

export interface PhoneValidationResult {
  isValid: boolean;
  error: string | null;
  normalized: string;
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
    return { isValid: true, error: null, normalized: "" };
  }

  // Retrieve raw digits only
  let cleaned = number.trim().replace(/\D/g, "");

  // Fallback if empty and not optional
  if (!cleaned) {
    return {
      isValid: false,
      error: "Phone number is required and must contain digits.",
      normalized: "",
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
    };
  }

  if (code === "+91" && cleaned.length !== 10) {
    return {
      isValid: false,
      error: `India Phone Number must be exactly 10 digits. Captured: ${cleaned.length}/10`,
      normalized: cleaned,
    };
  }

  if (code === "+971") {
    if (cleaned.length !== 9) {
      return {
        isValid: false,
        error: `UAE Phone Number must be exactly 9 digits (excluding the local trunk prefix '0'). Captured: ${cleaned.length}/9`,
        normalized: cleaned,
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
    };
  }

  return {
    isValid: true,
    error: null,
    normalized: cleaned,
  };
}

export function formatPhoneWithCountryCode(phone: string | undefined | null): string {
  if (!phone) return '';
  let cleaned = phone.trim();
  
  // Remove duplicate "+968" or "968" prefixes
  let digits = cleaned.replace(/\D/g, '');
  while (digits.startsWith('968968')) {
    digits = digits.substring(3);
  }
  if (digits.startsWith('968') && digits.length > 8) {
    digits = digits.substring(3);
  }
  
  return `+968 ${digits}`;
}

