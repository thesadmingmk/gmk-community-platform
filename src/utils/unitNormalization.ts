export interface NormalizedUnitResult {
  isValid: boolean;
  displayUnitNumber: string;
  unitKey: string;
  error?: string;
}

export function normalizeUnit(
  unitType: 'Apartment' | 'Villa' | 'Townhouse',
  inputValue: string
): NormalizedUnitResult {
  if (!inputValue || !inputValue.trim()) {
    return {
      isValid: false,
      displayUnitNumber: 'INVALID',
      unitKey: 'INVALID',
      error: 'Unit number input is required'
    };
  }

  const cleaned = inputValue.trim().toUpperCase().replace(/[\s\-\/\.]/g, '');
  
  if (unitType === 'Apartment') {
    // Apartment normalization rules
    // Support display formats like B3-04-72 or B10-12-05 (including space, hyphens, dots cleanup)
    const cleanHyphen = inputValue.toUpperCase().replace(/[\s\.]/g, ''); // keep hyphen for splitting if present
    
    let bNum = "";
    let sectionStr = "";
    let flatStr = "";

    if (cleanHyphen.includes('-')) {
      const parts = cleanHyphen.split('-');
      if (parts.length === 3 && parts[0].startsWith('B')) {
        bNum = parts[0].substring(1);
        sectionStr = parts[1];
        flatStr = parts[2];
      }
    } else {
      const cleanedText = cleanHyphen.replace(/-/g, '');
      const match = cleanedText.match(/^B(\d+?)(\d{2})(\d{2})$/) || cleanedText.match(/^B(\d+)(\d)$/); 
      // e.g. B30472 -> B followed by 3 (bNum), 04 (section), 72 (flat)
      if (match) {
        if (match.length === 4) {
          bNum = match[1];
          sectionStr = match[2];
          flatStr = match[3];
        } else {
          // If digits is 3 (e.g., B3472 -> building 3, section 04, flat 72)
          bNum = match[1];
          const remaining = match[2];
          if (remaining.length === 3) {
            sectionStr = "0" + remaining[0];
            flatStr = remaining.slice(1);
          }
        }
      }
    }

    if (!bNum || !sectionStr || !flatStr) {
      return {
        isValid: false,
        displayUnitNumber: 'INVALID',
        unitKey: 'INVALID',
        error: 'Apartment format invalid. Must be [Building]-[Section]-[Flat] (e.g. B3-04-72)'
      };
    }

    const section = parseInt(sectionStr, 10);
    const flat = parseInt(flatStr, 10);

    if (isNaN(section) || section <= 0) {
      return {
        isValid: false,
        displayUnitNumber: 'INVALID',
        unitKey: 'INVALID',
        error: 'Apartment section must be a positive number'
      };
    }
    if (isNaN(flat) || flat <= 0) {
      return {
        isValid: false,
        displayUnitNumber: 'INVALID',
        unitKey: 'INVALID',
        error: 'Apartment flat must be a positive number'
      };
    }

    const origBNumName = `B${bNum}`;
    const formattedSection = sectionStr.padStart(2, '0');
    const formattedFlat = flatStr.padStart(2, '0');

    return {
      isValid: true,
      displayUnitNumber: `${origBNumName}-${formattedSection}-${formattedFlat}`,
      unitKey: `${origBNumName}${formattedSection}${formattedFlat}`
    };
  } else if (unitType === 'Villa') {
    const numOnly = cleaned.replace(/[^\d]/g, '');
    if (!numOnly) {
      return {
        isValid: false,
        displayUnitNumber: 'INVALID',
        unitKey: 'INVALID',
        error: 'Villa must contain a valid number (e.g. 72, 105)'
      };
    }
    const val = parseInt(numOnly, 10);
    if (val <= 0) {
      return {
        isValid: false,
        displayUnitNumber: 'INVALID',
        unitKey: 'INVALID',
        error: 'Villa number must be greater than zero'
      };
    }
    return {
      isValid: true,
      displayUnitNumber: `VILLA-${val}`,
      unitKey: `VILLA${val}`
    };
  } else if (unitType === 'Townhouse') {
    const numOnly = cleaned.replace(/[^\d]/g, '');
    if (!numOnly) {
      return {
        isValid: false,
        displayUnitNumber: 'INVALID',
        unitKey: 'INVALID',
        error: 'Townhouse must contain a valid number (e.g. 4, 17, 88)'
      };
    }
    const val = parseInt(numOnly, 10);
    if (val <= 0) {
      return {
        isValid: false,
        displayUnitNumber: 'INVALID',
        unitKey: 'INVALID',
        error: 'Townhouse number must be greater than zero'
      };
    }
    const padded = val < 10 ? `0${val}` : `${val}`;
    return {
      isValid: true,
      displayUnitNumber: `TH-${padded}`,
      unitKey: `TH${padded}`
    };
  }
  
  return {
    isValid: false,
    displayUnitNumber: 'INVALID',
    unitKey: 'INVALID',
    error: 'Invalid Unit Type selected'
  };
}

/**
 * Normalizes gated community values. Maps legacy 'Al Mouj Muscat' or 'Al Mouj' 
 * to the standardized default 'Al Hail Greens', ensuring the old development is 
 * completely eliminated from UI/database rendering.
 */
export function normalizeGatedCommunity(val: string | null | undefined): string {
  if (!val) return "Al Hail Greens";
  const trimmed = val.trim();
  if (
    trimmed.toLowerCase() === "al mouj muscat" || 
    trimmed.toLowerCase() === "al mouj" || 
    trimmed.toLowerCase() === "muscat hills" ||
    trimmed.toLowerCase() === "gmk heights"
  ) {
    return "Al Hail Greens";
  }
  return trimmed;
}

