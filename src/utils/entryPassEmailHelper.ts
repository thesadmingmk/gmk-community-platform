import { CommunityEvent, EventRegistration, Family, FamilyMember } from '../types';
import { getRegistrationDisplayId, formatExternalGmkId, isExternalGmkId, resolveEventDetails } from './gmkIdHelper';
import { NotificationService } from '../services/NotificationService';
import { db } from '../context/AuthContext';
import { doc, updateDoc } from 'firebase/firestore';

export interface EntryPassEmailData {
  isExt: boolean;
  recipientName: string;
  recipientEmail: string;
  isValidEmail: boolean;
  displayGmkId: string;
  canonicalGmkId: string;
  category: string;
  entryPassNumber: string;
  totalParticipants: number;
  registeredParticipants: string;
  amountReceived: number | string;
  receiptNumber: string;
  paymentStatus: string;
  eventName: string;
  eventDate: string;
  eventTime: string;
  eventVenue: string;
}

/**
 * Resolves the primary email address for an event registration.
 */
export function getRecipientEmail(reg: EventRegistration, families: Family[] = []): string {
  const direct = reg.primaryMemberEmail || reg.primaryRegistrantEmail || (reg as any).email;
  if (direct && typeof direct === 'string' && direct.trim()) {
    return direct.trim().toLowerCase();
  }
  if (reg.familyId) {
    const fam = families.find(f => f.id === reg.familyId);
    const famEmail = fam?.primaryMemberEmail || fam?.spouseEmail || (fam as any)?.email;
    if (famEmail && typeof famEmail === 'string' && famEmail.trim()) {
      return famEmail.trim().toLowerCase();
    }
  }
  return '';
}

/**
 * Prepares the authoritative Entry Pass email data payload according to GMK specifications.
 */
export function getEntryPassEmailData(
  reg: EventRegistration,
  activeEvent: CommunityEvent,
  families: Family[] = [],
  familyMembers: FamilyMember[] = [],
  getParticipantDetailsFn?: (r: EventRegistration) => { adults: { name: string }[]; children: { name: string }[] }
): EntryPassEmailData {
  const eventDetails = resolveEventDetails(activeEvent);
  const isExt = Boolean(reg.isExternal || isExternalGmkId(reg.publicReference) || isExternalGmkId(reg.primaryMemberGmkId));
  const fam = families.find(f => f.id === reg.familyId);
  const recipientName = fam 
    ? fam.fullName 
    : (reg.primaryRegistrantName || (reg.participants && reg.participants[0]) || (reg.primaryMemberEmail ? reg.primaryMemberEmail.split('@')[0] : 'Valued Guest'));
  
  const recipientEmail = getRecipientEmail(reg, families);

  const displayGmkId = getRegistrationDisplayId(reg) || (isExt ? formatExternalGmkId(reg.publicReference) : reg.primaryMemberGmkId) || reg.publicReference || reg.id;
  const canonicalGmkId = isExt
    ? (formatExternalGmkId(reg.publicReference) || reg.publicReference || reg.id)
    : (reg.primaryMemberGmkId || 'Resident');

  // Registration Category: "GMK Resident" for residents, specific type name for external guests
  const category = isExt
    ? (reg.externalRegistrationTypeName ||
       activeEvent?.externalRegistrationSettings?.types?.find((t: any) => t.id === reg.externalRegistrationTypeId)?.name ||
       reg.category ||
       reg.registrationTypeName ||
       'External Guest')
    : 'GMK Resident';

  // Authoritative Official Entry Pass Number
  const idPart = isExt
    ? (reg.publicReference || reg.primaryMemberGmkId || reg.id.slice(-6)).toUpperCase()
    : (reg.primaryMemberGmkId || reg.id.slice(-6)).toUpperCase();
  const entryPassNumber = (reg.entryPassNumber && reg.entryPassNumber.trim())
    ? reg.entryPassNumber.trim().toUpperCase()
    : `PASS-${activeEvent.id.slice(-6).toUpperCase()}-${idPart}`;

  let registeredParticipants = '';
  if (getParticipantDetailsFn) {
    const { adults, children } = getParticipantDetailsFn(reg);
    const allNames = [...adults.map(p => p.name), ...children.map(p => p.name)];
    if (allNames.length > 0) {
      registeredParticipants = allNames.join(", ");
    }
  }

  if (!registeredParticipants) {
    registeredParticipants = (reg.participants && reg.participants.length > 0) 
      ? reg.participants.join(", ") 
      : recipientName;
  }

  const totalParticipants = reg.totalParticipants || (reg.participants ? reg.participants.length : 1);
  const amountReceived = reg.amountReceived !== undefined ? reg.amountReceived : ((reg as any).amountPaid || reg.paymentAmount || 0);
  const receiptNumber = reg.receiptNumber || 'N/A';
  const paymentStatus = (reg.paymentStatus || 'PAID').toUpperCase();

  const isValidEmail = Boolean(recipientEmail && recipientEmail.includes('@') && recipientEmail.includes('.'));

  return {
    isExt,
    recipientName,
    recipientEmail,
    isValidEmail,
    displayGmkId,
    canonicalGmkId,
    category,
    entryPassNumber,
    totalParticipants,
    registeredParticipants,
    amountReceived,
    receiptNumber,
    paymentStatus,
    eventName: eventDetails.eventName,
    eventDate: eventDetails.eventDate,
    eventTime: eventDetails.eventTime,
    eventVenue: eventDetails.eventVenue || "Al Hail Greens Clubhouse / Main Lawn"
  };
}

/**
 * Sends a single Entry Pass email and records delivery metadata.
 */
export async function dispatchSingleEntryPassEmail(
  reg: EventRegistration,
  activeEvent: CommunityEvent,
  families: Family[] = [],
  familyMembers: FamilyMember[] = [],
  getParticipantDetailsFn?: (r: EventRegistration) => { adults: { name: string }[]; children: { name: string }[] }
): Promise<{ success: boolean; queueId?: string; error?: string }> {
  const data = getEntryPassEmailData(reg, activeEvent, families, familyMembers, getParticipantDetailsFn);
  if (!data.isValidEmail) {
    throw new Error(`Cannot send Entry Pass: No valid email address on file for ${data.recipientName} (${data.displayGmkId}).`);
  }

  const queueId = await NotificationService.sendPaymentReceiptEntryPass(
    data.recipientEmail,
    {
      residentName: data.recipientName,
      recipientName: data.recipientName,
      gmkId: data.canonicalGmkId,
      eventName: data.eventName,
      eventDate: data.eventDate,
      eventTime: data.eventTime,
      venue: data.eventVenue,
      eventVenue: data.eventVenue,
      category: data.category,
      registrationTypeName: data.category,
      totalParticipants: data.totalParticipants,
      registeredParticipants: data.registeredParticipants,
      amountReceived: data.amountReceived,
      receiptNumber: data.receiptNumber,
      entryPassNumber: data.entryPassNumber,
      paymentStatus: data.paymentStatus,
      isExternal: data.isExt,
      publicReference: data.isExt ? data.canonicalGmkId : undefined,
    },
    {
      notificationType: "ENTRY_PASS",
      priority: "high",
      source: "attendance_manual_entry_pass",
      customQueueId: `entry_pass_${activeEvent.id}_${reg.id}_${Date.now()}`
    }
  );

  const nowIso = new Date().toISOString();
  const updatedSendCount = (reg.entryPassEmailSendCount || 0) + 1;

  await updateDoc(doc(db, "event_registrations", reg.id), {
    entryPassNumber: data.entryPassNumber,
    entryPassEmailSentAt: nowIso,
    entryPassEmailRecipient: data.recipientEmail,
    entryPassEmailSendCount: updatedSendCount,
    entryPassEmailSource: 'attendance_manual',
    entryPassEmailLastStatus: 'queued',
    updatedAt: nowIso
  });

  // Mutate local object
  reg.entryPassNumber = data.entryPassNumber;
  reg.entryPassEmailSentAt = nowIso;
  reg.entryPassEmailRecipient = data.recipientEmail;
  reg.entryPassEmailSendCount = updatedSendCount;

  return { success: true, queueId };
}
