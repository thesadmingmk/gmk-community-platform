import { doc, updateDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../context/AuthContext';
import { EventRegistration, CommunityEvent } from '../types';
import { formatExternalGmkId, resolveEventDetails } from '../utils/gmkIdHelper';

export const WHATSAPP_TEMPLATE_EXTERNAL_REGISTRATION_UPDATE = 'gmk_external_registration_update';
export const WHATSAPP_TEMPLATE_ENTRY_PASS_READY = 'gmk_entry_pass_ready';

// Backward compatibility alias during Meta review transition
export const WHATSAPP_TEMPLATE_REGISTRATION_CONFIRMED = WHATSAPP_TEMPLATE_EXTERNAL_REGISTRATION_UPDATE;

export interface EntryPassNotificationEligibility {
  eligible: boolean;
  reason?: string;
  recipientPhone?: string;
  entryPassNumber?: string;
}

export interface SendEntryPassNotificationOptions {
  dryRun?: boolean; // Set to true by default for RTCO-090 safety
  adminEmail?: string;
  headerImageUrl?: string;
  headerMediaId?: string;
  forceResend?: boolean;
}

export interface SendEntryPassNotificationResult {
  success: boolean;
  messageId?: string;
  dryRun?: boolean;
  error?: string;
  duplicateBlocked?: boolean;
  entryPassNumber?: string;
  recipientPhone?: string;
}

/**
 * Extracts the best available WhatsApp phone number for an event registration.
 * Normalizes to pure digits (E.164 format without leading '+', spaces, or hyphens)
 * strictly preserving international country codes across all countries.
 * Example: +91 858905585 -> 91858905585
 */
export function extractRegistrationWhatsAppNumber(reg: EventRegistration): string | null {
  const regAny = reg as any;
  const rawNumber = 
    reg.primaryRegistrantWhatsapp || 
    reg.primaryRegistrantPhone || 
    regAny.whatsappNumber || 
    regAny.primaryMemberPhone || 
    regAny.phone || 
    '';

  if (!rawNumber) return null;

  const trimmed = String(rawNumber).trim();
  const countryCode = (reg.whatsappCountryCode || reg.phoneCountryCode || regAny.countryCode || '').trim();

  let digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;

  // Strip international dialing prefix '00' (e.g. 0091... -> 91...)
  if (digits.startsWith('00')) {
    digits = digits.substring(2);
  }

  // 1. If an explicit country code was stored on the registration record:
  if (countryCode) {
    const codeDigits = countryCode.replace(/\D/g, '');
    if (codeDigits && !digits.startsWith(codeDigits)) {
      digits = codeDigits + digits;
    }
  } else {
    // 2. If the raw string explicitly started with '+', the digits already represent E.164:
    // (e.g. "+91 8589055855" -> "918589055855", "+968 91234567" -> "96891234567")
    if (!trimmed.startsWith('+')) {
      // 3. Heuristic recovery for legacy records where the country code was stripped:
      // 8 digits: Oman (+968)
      if (digits.length === 8) {
        digits = '968' + digits;
      }
      // 10 digits starting with 6, 7, 8, 9: India (+91)
      else if (digits.length === 10 && ['6', '7', '8', '9'].includes(digits[0])) {
        digits = '91' + digits;
      }
      // 9 digits starting with 5: UAE (+971)
      else if (digits.length === 9 && digits.startsWith('5')) {
        digits = '971' + digits;
      }
    }
  }

  return digits.length >= 8 ? digits : null;
}

/**
 * Checks whether a registration is eligible for WhatsApp Entry Pass delivery.
 * 
 * STRICT ELIGIBILITY RULES:
 * 1. Financial Clearance: paymentStatus must be 'paid', 'waived', or 'overpaid'.
 *    (Pending, partially paid, or rejected registrations are strictly ineligible).
 * 2. Identity Clearance: A valid entryPassNumber must exist.
 * 3. Contact Clearance: A valid phone/WhatsApp number must be present.
 */
export function isRegistrationEligibleForWhatsAppEntryPass(
  reg: EventRegistration
): EntryPassNotificationEligibility {
  // 1. Check entry pass number
  if (!reg.entryPassNumber || reg.entryPassNumber.trim().length === 0) {
    return {
      eligible: false,
      reason: 'No official Entry Pass Number generated yet for this registration.'
    };
  }

  // 2. Check financial clearance
  const financiallyClearedStatuses = ['paid', 'waived', 'overpaid'];
  if (!reg.paymentStatus || !financiallyClearedStatuses.includes(reg.paymentStatus)) {
    return {
      eligible: false,
      reason: `Registration is not financially cleared. Current payment status: "${reg.paymentStatus || 'unpaid'}".`
    };
  }

  // 3. Check WhatsApp contact number
  const recipientPhone = extractRegistrationWhatsAppNumber(reg);
  if (!recipientPhone) {
    return {
      eligible: false,
      reason: 'No valid WhatsApp phone number found on this registration record.'
    };
  }

  return {
    eligible: true,
    recipientPhone,
    entryPassNumber: reg.entryPassNumber
  };
}

/**
 * Duplicate Send Protection:
 * Verifies whether an Entry Pass WhatsApp notification has already been sent to this registration.
 */
export function hasEntryPassNotificationBeenSent(reg: EventRegistration): boolean {
  return reg.entryPassNotificationStatus === 'sent';
}

/**
 * Duplicate Send Protection:
 * Verifies whether an External Registration Update WhatsApp notification has already been sent.
 */
export function hasRegistrationUpdateNotificationBeenSent(reg: EventRegistration): boolean {
  return reg.registrationUpdateNotificationStatus === 'sent';
}

/**
 * Prepares the exact template payload for Meta Template #1: `gmk_external_registration_update`.
 * Category: Marketing
 * Purpose: External registrant registration update / next-step communication.
 * Variables:
 * {{1}} = Registrant name
 * {{2}} = Event name
 * {{3}} = Registration Reference ID
 * 
 * STRICT COMPLIANCE:
 * - Zero financial details (no payment amounts, no balances, no bank accounts, no UPI).
 */
export function prepareExternalRegistrationUpdatePayload(
  reg: EventRegistration,
  event?: CommunityEvent,
  options?: { dryRun?: boolean }
) {
  const recipientPhone = extractRegistrationWhatsAppNumber(reg) || '';
  const recipientName = 
    reg.primaryRegistrantName || 
    reg.participants?.[0] || 
    'Community Member';

  const eventDetails = resolveEventDetails(event);
  const eventName = eventDetails.eventName || event?.title || 'GMK Community Event';
  const referenceId = formatExternalGmkId(reg.publicReference) || reg.publicReference || reg.id;

  return {
    to: recipientPhone,
    templateName: WHATSAPP_TEMPLATE_EXTERNAL_REGISTRATION_UPDATE,
    templateData: {
      recipientName,
      eventName,
      referenceId,
      eventDate: eventDetails.eventDate,
      eventTime: eventDetails.eventTime,
      eventVenue: eventDetails.eventVenue
    },
    dryRun: options?.dryRun !== false // Default to TRUE for safety
  };
}

/**
 * Executes or simulates external registration update notification via WhatsApp (Template #1: `gmk_external_registration_update`).
 * 
 * Includes:
 * - Duplicate protection check (blocks if already sent)
 * - Zero financial data
 * - Dry-run safeguard support
 * - Atomic Firestore state recording upon completion in live mode
 */
export async function sendExternalRegistrationUpdateWhatsAppNotification(
  reg: EventRegistration,
  event?: CommunityEvent,
  options: { dryRun?: boolean; forceResend?: boolean } = { dryRun: true }
): Promise<{ success: boolean; messageId?: string; dryRun?: boolean; error?: string; duplicateBlocked?: boolean }> {
  // 1. Duplicate Send Protection
  if (!options.forceResend && hasRegistrationUpdateNotificationBeenSent(reg)) {
    return {
      success: false,
      duplicateBlocked: true,
      error: `Duplicate blocked: Registration update WhatsApp was already sent to this registration at ${reg.registrationUpdateNotificationSentAt || 'an earlier date'}.`
    };
  }

  const payload = prepareExternalRegistrationUpdatePayload(reg, event, options);
  if (!payload.to) {
    return { success: false, error: 'No valid phone or WhatsApp number available on registration.' };
  }

  try {
    const sendWhatsAppFn = httpsCallable(functions, 'sendWhatsAppNotification');
    const response = await sendWhatsAppFn(payload);
    const data = response.data as any;
    if (data && data.success) {
      const nowIso = new Date().toISOString();
      const messageId = data.messageId || `dry_run_update_${Date.now()}`;

      // In non-dry-run mode, persist notification status
      if (!options.dryRun) {
        await updateDoc(doc(db, 'event_registrations', reg.id), {
          registrationUpdateNotificationStatus: 'sent',
          registrationUpdateNotificationSentAt: nowIso,
          registrationUpdateNotificationRecipient: payload.to,
          registrationUpdateNotificationMessageId: messageId,
          updatedAt: nowIso
        });
      }

      return {
        success: true,
        dryRun: options.dryRun,
        messageId
      };
    } else {
      throw new Error(data?.error || 'Unknown error received from WhatsApp notification service.');
    }
  } catch (err: any) {
    console.error('sendExternalRegistrationUpdateWhatsAppNotification error:', err);
    return {
      success: false,
      error: err.message || 'Failed to dispatch external registration update WhatsApp message.'
    };
  }
}

/**
 * Backward compatibility helper for registration confirmation notification during transition.
 */
export function prepareRegistrationConfirmedPayload(
  reg: EventRegistration,
  event?: CommunityEvent,
  options?: { dryRun?: boolean }
) {
  return prepareExternalRegistrationUpdatePayload(reg, event, options);
}

/**
 * Backward compatibility helper for registration confirmation notification during transition.
 */
export async function sendRegistrationConfirmedWhatsAppNotification(
  reg: EventRegistration,
  event?: CommunityEvent,
  options: { dryRun?: boolean } = { dryRun: true }
) {
  return sendExternalRegistrationUpdateWhatsAppNotification(reg, event, options);
}

/**
 * Prepares the exact template payload for Meta Template #2: `gmk_entry_pass_ready`.
 */
export function prepareEntryPassNotificationPayload(
  reg: EventRegistration,
  event: CommunityEvent,
  options?: SendEntryPassNotificationOptions
) {
  const recipientPhone = extractRegistrationWhatsAppNumber(reg) || '';
  const recipientName = 
    reg.primaryRegistrantName || 
    reg.participants?.[0] || 
    reg.primaryMemberGmkId || 
    'Community Member';

  const eventDetails = resolveEventDetails(event);
  const eventName = eventDetails.eventName || event.title || 'Community Gathering';
  const entryPassNumber = reg.entryPassNumber || '';

  return {
    to: recipientPhone,
    templateName: WHATSAPP_TEMPLATE_ENTRY_PASS_READY,
    templateData: {
      recipientName,
      eventName,
      entryPassNumber,
      eventDate: eventDetails.eventDate,
      eventTime: eventDetails.eventTime,
      eventVenue: eventDetails.eventVenue,
      headerImageUrl: options?.headerImageUrl,
      headerMediaId: options?.headerMediaId
    },
    dryRun: options?.dryRun !== false // Default to TRUE for RTCO-090 safeguard
  };
}

/**
 * Executes or simulates the delivery of an Entry Pass via WhatsApp.
 * 
 * Includes:
 * - Duplicate protection check (blocks if already sent)
 * - Strict financial and identity eligibility verification
 * - Dry-run safeguard support
 * - Atomic Firestore state recording upon completion
 */
export async function sendEntryPassWhatsAppNotification(
  reg: EventRegistration,
  event: CommunityEvent,
  options: SendEntryPassNotificationOptions = { dryRun: true }
): Promise<SendEntryPassNotificationResult> {
  // 1. Duplicate Send Protection
  if (!options.forceResend && hasEntryPassNotificationBeenSent(reg)) {
    return {
      success: false,
      duplicateBlocked: true,
      error: `Duplicate blocked: Entry Pass WhatsApp was already sent to this registration at ${reg.entryPassNotificationSentAt || 'an earlier date'}.`,
      entryPassNumber: reg.entryPassNumber,
      recipientPhone: reg.entryPassNotificationRecipient
    };
  }

  // 2. Eligibility Validation
  const eligibility = isRegistrationEligibleForWhatsAppEntryPass(reg);
  if (!eligibility.eligible) {
    return {
      success: false,
      error: eligibility.reason,
      entryPassNumber: reg.entryPassNumber
    };
  }

  const payload = prepareEntryPassNotificationPayload(reg, event, options);

  try {
    // 3. Invoke Cloud Function
    const sendWhatsAppFn = httpsCallable(functions, 'sendWhatsAppNotification');
    const response = await sendWhatsAppFn(payload);
    const data = response.data as any;

    if (data && data.success) {
      const nowIso = new Date().toISOString();
      const messageId = data.messageId || `simulated_${Date.now()}`;

      // In non-dry-run mode (or controlled testing), persist notification status
      if (!options.dryRun) {
        await updateDoc(doc(db, 'event_registrations', reg.id), {
          entryPassNotificationStatus: 'sent',
          entryPassNotificationSentAt: nowIso,
          entryPassNotificationRecipient: eligibility.recipientPhone,
          entryPassNotificationMessageId: messageId,
          updatedAt: nowIso
        });
      }

      return {
        success: true,
        dryRun: options.dryRun,
        messageId,
        entryPassNumber: reg.entryPassNumber,
        recipientPhone: eligibility.recipientPhone
      };
    } else {
      throw new Error(data?.error || 'Unknown error received from WhatsApp notification service.');
    }
  } catch (err: any) {
    console.error('sendEntryPassWhatsAppNotification error:', err);
    return {
      success: false,
      error: err.message || 'Failed to dispatch WhatsApp notification.'
    };
  }
}
