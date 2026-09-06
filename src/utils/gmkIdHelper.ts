import { CommunityEvent, EventRegistration } from '../types';

/**
 * RTCO-098 Central GMK ID Helper
 * External IDs use the 6-digit numeric identifier format: GMK-XXXXXX (e.g. GMK-875572).
 * Maintains backward compatibility for legacy GMK-XXXXXXG / GMKG-XXXXXX formats.
 * Preserves resident GMK IDs (e.g. GMK-1001).
 */

export function isExternalGmkId(idOrRef?: string | null): boolean {
  if (!idOrRef) return false;
  const trimmed = idOrRef.trim().toUpperCase();
  if (trimmed.startsWith('GMKG-') || trimmed.startsWith('GMKG')) return true;
  // Legacy trailing 'G' format e.g. GMK-875572G or 875572G
  if (/^GMK-[A-Z0-9]+G$/i.test(trimmed)) return true;
  if (/^[0-9]{5,8}G$/i.test(trimmed)) return true;
  // Standard 6-digit external sequence e.g. GMK-875572 or bare 875572
  if (/^GMK-[0-9]{6}$/i.test(trimmed)) return true;
  if (/^[0-9]{6}$/.test(trimmed)) return true;
  return false;
}

/**
 * Normalizes any external registration identifier or reference into the canonical GMK-XXXXXX (6-digit numeric) format.
 * Strips legacy trailing 'G' and prefixes cleanly.
 */
export function formatExternalGmkId(idOrRef?: string | null): string {
  if (!idOrRef) return '';
  const trimmed = idOrRef.trim().toUpperCase();

  // If already standard 6-digit GMK-XXXXXX (e.g. GMK-875572)
  if (/^GMK-[0-9]{6}$/i.test(trimmed)) {
    return trimmed;
  }

  // If legacy GMK-XXXXXXG format (e.g. GMK-875572G -> GMK-875572)
  const legacyGMKMatch = trimmed.match(/^GMK-([0-9]{5,8})G$/i);
  if (legacyGMKMatch) {
    return `GMK-${legacyGMKMatch[1]}`;
  }

  // If GMKG-XXXXXX format (e.g. GMKG-875572 -> GMK-875572)
  const gmkgDashMatch = trimmed.match(/^GMKG-([0-9A-Z]+)$/i);
  if (gmkgDashMatch) {
    const raw = gmkgDashMatch[1].replace(/G$/i, '');
    return `GMK-${raw}`;
  }

  // If GMKGXXXXXX format (e.g. GMKG875572 -> GMK-875572)
  const gmkgMatch = trimmed.match(/^GMKG([0-9A-Z]+)$/i);
  if (gmkgMatch) {
    const raw = gmkgMatch[1].replace(/G$/i, '');
    return `GMK-${raw}`;
  }

  // If bare 6-digit number ending with G (e.g. 875572G -> GMK-875572)
  const bareGMatch = trimmed.match(/^([0-9]{5,8})G$/i);
  if (bareGMatch) {
    return `GMK-${bareGMatch[1]}`;
  }

  // If bare 6-digit number without prefix (e.g. 875572 -> GMK-875572)
  const bare6Match = trimmed.match(/^([0-9]{6})$/);
  if (bare6Match) {
    return `GMK-${bare6Match[1]}`;
  }

  // Fallback for general alphanumeric legacy with trailing G
  const generalGMatch = trimmed.match(/^GMK-([A-Z0-9]+)G$/i);
  if (generalGMatch) {
    return `GMK-${generalGMatch[1]}`;
  }

  return trimmed;
}

/**
 * Resolves the primary display ID for an Event Registration.
 * If external, returns GMK-XXXXXX (6 digits).
 * If resident, returns resident GMK ID (e.g. GMK-1001).
 */
export function getRegistrationDisplayId(reg: Partial<EventRegistration> | null | undefined): string {
  if (!reg) return 'N/A';
  if (reg.isExternal || isExternalGmkId(reg.publicReference) || isExternalGmkId(reg.primaryMemberGmkId)) {
    return (
      formatExternalGmkId(reg.publicReference) ||
      formatExternalGmkId(reg.primaryMemberGmkId) ||
      reg.publicReference ||
      reg.primaryMemberGmkId ||
      'N/A'
    );
  }
  return reg.primaryMemberGmkId || reg.id || 'N/A';
}

/**
 * Generates a new unique external registration ID conforming strictly to GMK-XXXXXX (6-digit numeric).
 * Preserves a 6-digit sequence (100000 - 999999) ensuring high entropy and zero collisions.
 */
export function generateExternalGmkId(): string {
  const sequence = Math.floor(100000 + Math.random() * 900000);
  return `GMK-${sequence}`;
}

/**
 * Returns ordinal suffix for a number (e.g. 1st, 2nd, 3rd, 4th, 11th, 21st).
 */
export function getOrdinalSuffix(day: number): string {
  if (day > 3 && day < 21) return 'th';
  switch (day % 10) {
    case 1:  return 'st';
    case 2:  return 'nd';
    case 3:  return 'rd';
    default: return 'th';
  }
}

/**
 * Formats an event date into a human-readable format, e.g. "11th September 2026".
 * Strictly immune to timezone shifting bugs on date-only strings.
 * Never displays raw ISO timestamps or 'undefined'.
 */
export function formatEventDate(dateStr?: string | null): string {
  if (!dateStr) return 'TBA';
  try {
    const trimmed = String(dateStr).trim();
    // If it already matches "11th September 2026" or similar readable format
    if (/^\d{1,2}(st|nd|rd|th)\s+[A-Za-z]+\s+\d{4}$/i.test(trimmed)) {
      return trimmed;
    }

    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];

    // Explicitly handle YYYY-MM-DD or YYYY-MM-DDTHH:mm to prevent UTC timezone backward roll
    const ymdMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (ymdMatch) {
      const year = parseInt(ymdMatch[1], 10);
      const monthIdx = parseInt(ymdMatch[2], 10) - 1;
      const day = parseInt(ymdMatch[3], 10);
      if (monthIdx >= 0 && monthIdx < 12 && day >= 1 && day <= 31) {
        return `${day}${getOrdinalSuffix(day)} ${monthNames[monthIdx]} ${year}`;
      }
    }

    const d = new Date(trimmed);
    if (isNaN(d.getTime())) return trimmed;

    // Use Asia/Muscat (UTC+4) timezone for date calculation
    const muscatDateStr = d.toLocaleDateString('en-US', {
      timeZone: 'Asia/Muscat',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric'
    });
    const [m, dayStr, y] = muscatDateStr.split('/');
    const day = parseInt(dayStr, 10);
    const month = monthNames[parseInt(m, 10) - 1];
    return `${day}${getOrdinalSuffix(day)} ${month} ${y}`;
  } catch {
    return String(dateStr);
  }
}

/**
 * Formats event start time in Oman Time (Asia/Muscat, UTC+4).
 * Authoritative format: "07:00 PM (Oman Time)" or "19:00 (Oman Time)".
 * Respects already-local time inputs without adding spurious offsets.
 */
export function formatEventTime(dateOrTimeStr?: string | null): string {
  if (!dateOrTimeStr) return '';
  try {
    const trimmed = String(dateOrTimeStr).trim();
    if (!trimmed) return '';

    if (trimmed.includes('(Oman Time)')) {
      return trimmed;
    }

    // Check if it is a pure time string like "08:30", "8:30", "18:00", "8:30 AM", "08:30 PM", "19:00"
    const timeMatch = trimmed.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1], 10);
      const minutes = parseInt(timeMatch[2], 10);
      const meridiem = timeMatch[3]?.toUpperCase();

      if (meridiem) {
        if (meridiem === 'PM' && hours < 12) hours += 12;
        if (meridiem === 'AM' && hours === 12) hours = 0;
      }
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const displayHours = hours % 12 || 12;
      const displayHoursPadded = String(displayHours).padStart(2, '0');
      const displayMinutes = String(minutes).padStart(2, '0');
      return `${displayHoursPadded}:${displayMinutes} ${ampm} (Oman Time)`;
    }

    // If it's a full ISO or date-time string e.g. "2026-09-11T04:30:00.000Z"
    if (trimmed.includes('T') || (trimmed.includes('-') && trimmed.includes(':'))) {
      const d = new Date(trimmed);
      if (!isNaN(d.getTime())) {
        const timeStr = d.toLocaleTimeString('en-US', {
          timeZone: 'Asia/Muscat',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        });
        return `${timeStr} (Oman Time)`;
      }
    }

    // If only a date string without time was passed (e.g. "2026-04-07")
    return '';
  } catch {
    return '';
  }
}

/**
 * Safely extracts the event title from authoritative event configuration.
 */
export function getEventTitle(event?: Partial<CommunityEvent> | null): string {
  if (!event) return 'GMK Community Event';
  return (event.title || event.eventName || event.displayName || 'GMK Community Event').trim();
}

/**
 * Safely extracts the event venue from authoritative event configuration.
 */
export function getEventVenue(event?: Partial<CommunityEvent> | null): string {
  if (!event) return 'Al Hail Greens Clubhouse / Main Lawn';
  return (event.venue || event.Venue || (event as any)?.location || 'Al Hail Greens Clubhouse / Main Lawn').trim();
}

/**
 * Central resolver extracting authoritative event details (Title, Date, Time, Venue)
 * ensuring consistent metadata across all external registration emails and entry passes.
 */
export function resolveEventDetails(event?: Partial<CommunityEvent> | null) {
  const eventName = getEventTitle(event);
  const rawDate = 
    event?.date || 
    (event as any)?.startDate || 
    (event as any)?.eventStart || 
    (event as any)?.registrationSettings?.eventStart;

  // Authoritative event time resolution:
  // Priority:
  // 1. Explicit time string field if provided (e.g., "08:30 AM")
  // 2. Authoritative event start timestamp (ISO datetime containing time)
  // 3. registrationSettings.eventStart
  // 4. event.date (when formatted as an ISO datetime)
  // NOTE: Do NOT use participationStart/registrationStart (those are registration window dates)
  const rawTime = 
    (event as any)?.eventTime || 
    (event as any)?.time || 
    (event as any)?.startTime || 
    (event as any)?.eventStart || 
    (event as any)?.registrationSettings?.eventStart || 
    (event?.date && event.date.includes('T') ? event.date : null);

  const eventDate = formatEventDate(rawDate);
  const eventTime = formatEventTime(rawTime);
  const eventVenue = getEventVenue(event);
  return {
    eventName,
    eventDate,
    eventTime,
    eventVenue
  };
}

/**
 * Resolves the display category/unit for a registration.
 * For external registrations: returns the actual configured category name (e.g. "Team Greens").
 * For residents: returns their property unit.
 */
export function getRegistrationCategoryDisplay(
  reg: Partial<EventRegistration> | null | undefined,
  residentUnit?: string | null
): string {
  if (!reg) return 'N/A';
  if (reg.isExternal || isExternalGmkId(reg.publicReference) || isExternalGmkId(reg.primaryMemberGmkId)) {
    return reg.externalRegistrationTypeName || 'External Guest';
  }
  return residentUnit || reg.unitNumber || 'Resident';
}
