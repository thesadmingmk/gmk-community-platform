import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../context/AuthContext';
import { 
  CommunityEvent, 
  EventAttendance, 
  EventRegistration, 
  Family, 
  FamilyMember 
} from '../types';
import { NotificationService } from './NotificationService';
import { 
  getRegistrationDisplayId, 
  isExternalGmkId, 
  formatExternalGmkId 
} from '../utils/gmkIdHelper';

/**
 * Formats a timestamp into HH:MM:SS format strictly in Asia/Muscat (Oman Time)
 * Example: "08:31:42"
 */
export function formatCheckInTimeHHMMSS(dateInput?: string | Date | number | null): string {
  if (!dateInput) return '00:00:00';
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return '00:00:00';
    return d.toLocaleTimeString('en-GB', {
      timeZone: 'Asia/Muscat',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  } catch {
    return '00:00:00';
  }
}

/**
 * Formats a timestamp into display date in Asia/Muscat (Oman Time)
 * Example: "08 Sep 2026"
 */
export function formatCheckInDate(dateInput?: string | Date | number | null): string {
  if (!dateInput) return '';
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-GB', {
      timeZone: 'Asia/Muscat',
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  } catch {
    return '';
  }
}

export type FamilyRelationshipType = 'GMK Member' | 'Spouse' | 'Child' | 'Parent' | 'Other';

export interface ParticipantCheckInEvaluation {
  name: string;
  relationship: FamilyRelationshipType;
  isEligible: boolean; // True for GMK Member, Spouse, Child; False for Parent, Other
  isCheckedIn: boolean;
  checkInDate: string;
  checkInTime: string; // HH:MM:SS
  arrivedAt?: string;
  scannedBy?: string;
}

export interface FamilyCheckInProcessResult {
  completed: boolean;
  emailQueued?: boolean;
  alreadyQueued?: boolean;
  recipientEmail?: string;
  queueId?: string;
  totalEligible?: number;
  totalCheckedIn?: number;
  eligibleParticipants?: ParticipantCheckInEvaluation[];
  pendingParticipants?: string[];
  reason?: string;
}

/**
 * Evaluates registered participants for a GMK family registration,
 * categorizing them into GMK Member, Spouse, Child (eligible) vs Parent, Other (excluded),
 * and matches their arrival status against arrivedDetails.
 */
export function evaluateFamilyRegistrationParticipants(
  reg: EventRegistration,
  arrivedDetails: Array<{ name: string; arrivedAt?: string; scannedBy?: string }>,
  families: Family[],
  familyMembers: FamilyMember[]
): {
  allParticipants: ParticipantCheckInEvaluation[];
  eligibleParticipants: ParticipantCheckInEvaluation[];
  allEligibleCheckedIn: boolean;
  pendingEligibleNames: string[];
} {
  const gmkId = getRegistrationDisplayId(reg) || reg.primaryMemberGmkId || '';
  const fam = families.find(f => 
    f.id === reg.familyId || 
    f.id === `fam_${gmkId}` ||
    (gmkId && f.primaryMemberGmkId === gmkId) || 
    (reg.primaryMemberEmail && f.primaryMemberEmail?.toLowerCase() === reg.primaryMemberEmail.toLowerCase())
  );

  const relevantFamilyMembers = familyMembers.filter(m => 
    m.familyId === reg.familyId || 
    (fam && m.familyId === fam.id) || 
    (fam && m.familyId === `fam_${fam.primaryMemberGmkId}`) ||
    (gmkId && m.familyId === `fam_${gmkId}`)
  );

  const registeredNames = reg.participants || [];

  const allParticipants: ParticipantCheckInEvaluation[] = registeredNames.map(rawName => {
    const name = (rawName || '').trim();
    const lower = name.toLowerCase();
    let relationship: FamilyRelationshipType = 'Other';
    let isEligible = false;

    const primaryName = (fam?.fullName || reg.primaryRegistrantName || (fam as any)?.primaryMemberName || '').trim().toLowerCase();
    const spouseName = (fam?.spouseName || '').trim().toLowerCase();

    // 1. GMK Member check
    if (primaryName && lower === primaryName) {
      relationship = 'GMK Member';
      isEligible = true;
    } 
    // 2. Spouse check
    else if ((spouseName && lower === spouseName) || relevantFamilyMembers.some(m => m.relationship === 'spouse' && m.name.trim().toLowerCase() === lower)) {
      relationship = 'Spouse';
      isEligible = true;
    }
    // 3. Child check
    else if (relevantFamilyMembers.some(m => m.relationship === 'child' && m.name.trim().toLowerCase() === lower)) {
      relationship = 'Child';
      isEligible = true;
    }
    // 4. Parent check (EXCLUDED)
    else if (
      relevantFamilyMembers.some(m => m.relationship === 'parent' && m.name.trim().toLowerCase() === lower) ||
      reg.paymentSummary?.parentMembers?.some(p => p.trim().toLowerCase() === lower)
    ) {
      relationship = 'Parent';
      isEligible = false;
    }
    // 5. Other / Dependent (EXCLUDED)
    else {
      relationship = 'Other';
      isEligible = false;
    }

    // Match arrival details
    const arrival = arrivedDetails.find(a => a.name && a.name.trim().toLowerCase() === lower);
    const isCheckedIn = !!arrival;
    const arrivalTime = arrival?.arrivedAt || null;

    return {
      name,
      relationship,
      isEligible,
      isCheckedIn,
      checkInDate: arrivalTime ? formatCheckInDate(arrivalTime) : '',
      checkInTime: arrivalTime ? formatCheckInTimeHHMMSS(arrivalTime) : '',
      arrivedAt: arrivalTime || undefined,
      scannedBy: arrival?.scannedBy
    };
  });

  // Filter ONLY eligible participants: GMK Member, Spouse, Children
  const eligibleParticipants = allParticipants.filter(p => p.isEligible);
  
  // Sort eligible participants: GMK Member first, Spouse second, Children third
  const relationshipPriority: Record<string, number> = {
    'GMK Member': 1,
    'Spouse': 2,
    'Child': 3
  };
  eligibleParticipants.sort((a, b) => {
    const pA = relationshipPriority[a.relationship] || 99;
    const pB = relationshipPriority[b.relationship] || 99;
    if (pA !== pB) return pA - pB;
    return a.name.localeCompare(b.name);
  });

  const pendingEligible = eligibleParticipants.filter(p => !p.isCheckedIn);
  const allEligibleCheckedIn = eligibleParticipants.length > 0 && pendingEligible.length === 0;

  return {
    allParticipants,
    eligibleParticipants,
    allEligibleCheckedIn,
    pendingEligibleNames: pendingEligible.map(p => p.name)
  };
}

/**
 * Processes family check-in completion.
 * When all eligible registered participants (GMK Member, Spouse, Children)
 * have checked in, this queues ONE completion email to the primary member
 * via the existing emailQueue architecture and guarantees strict idempotency.
 */
export async function processFamilyCheckInCompletion({
  reg,
  activeEvent,
  combinedArrivedDetails,
  existingAttendance,
  families,
  familyMembers
}: {
  reg: EventRegistration;
  activeEvent: CommunityEvent;
  combinedArrivedDetails: Array<{ name: string; arrivedAt?: string; scannedBy?: string; category?: string }>;
  existingAttendance?: EventAttendance | null;
  families: Family[];
  familyMembers: FamilyMember[];
}): Promise<FamilyCheckInProcessResult> {
  if (!reg || !activeEvent || !activeEvent.id) {
    return { completed: false, reason: 'Invalid event or registration.' };
  }

  // Check if this is an external guest registration (only GMK resident registrations have family check-in completion)
  const isExternal = reg.isExternal || isExternalGmkId(reg.publicReference) || isExternalGmkId(reg.primaryMemberGmkId);
  if (isExternal) {
    return { completed: false, reason: 'External registration does not trigger family completion email.' };
  }

  const gmkId = getRegistrationDisplayId(reg) || reg.primaryMemberGmkId || reg.id.split('_')?.[1] || reg.id;
  if (!gmkId) {
    return { completed: false, reason: 'Missing GMK ID.' };
  }

  // 1. Evaluate participants
  const {
    eligibleParticipants,
    allEligibleCheckedIn,
    pendingEligibleNames
  } = evaluateFamilyRegistrationParticipants(reg, combinedArrivedDetails, families, familyMembers);

  if (eligibleParticipants.length === 0) {
    return { 
      completed: false, 
      reason: 'No eligible family participants (GMK Member, Spouse, Children) registered for this event.' 
    };
  }

  // If any eligible participant has not checked in, DO NOT send completion email
  if (!allEligibleCheckedIn) {
    return {
      completed: false,
      totalEligible: eligibleParticipants.length,
      totalCheckedIn: eligibleParticipants.filter(p => p.isCheckedIn).length,
      pendingParticipants: pendingEligibleNames,
      reason: `Waiting for ${pendingEligibleNames.join(', ')} to check in.`
    };
  }

  // 2. IDEMPOTENCY CHECKS
  // Check if already queued/sent in in-memory state
  if (
    existingAttendance?.completionEmailQueuedAt || 
    existingAttendance?.familyCompletionEmailSent || 
    existingAttendance?.completionEmailSentAt || 
    reg.completionEmailQueuedAt || 
    reg.completionEmailSentAt || 
    reg.familyCompletionEmailSent
  ) {
    return { 
      completed: true, 
      alreadyQueued: true, 
      totalEligible: eligibleParticipants.length,
      eligibleParticipants 
    };
  }

  // Check deterministic queue document ID in Firestore emailQueue collection
  const queueDocId = `family_checkin_complete_${activeEvent.id}_${gmkId}`;
  try {
    const queueDocRef = doc(db, "emailQueue", queueDocId);
    const queueSnap = await getDoc(queueDocRef);
    if (queueSnap.exists()) {
      return { 
        completed: true, 
        alreadyQueued: true, 
        queueId: queueDocId,
        totalEligible: eligibleParticipants.length,
        eligibleParticipants 
      };
    }
  } catch (checkErr) {
    console.warn("[familyCheckInService] Non-blocking warning during queue check:", checkErr);
  }

  // Check live attendance document in Firestore
  const attRef = doc(db, "eventAttendance", `att_${gmkId}_${activeEvent.id}`);
  try {
    const liveAttSnap = await getDoc(attRef);
    if (liveAttSnap.exists()) {
      const liveData = liveAttSnap.data();
      if (liveData?.completionEmailQueuedAt || liveData?.familyCompletionEmailSent || liveData?.completionEmailSentAt) {
        return { 
          completed: true, 
          alreadyQueued: true, 
          totalEligible: eligibleParticipants.length,
          eligibleParticipants 
        };
      }
    }
  } catch (checkErr) {
    console.warn("[familyCheckInService] Non-blocking warning during live attendance check:", checkErr);
  }

  // 3. Resolve primary recipient email
  const fam = families.find(f => 
    f.id === reg.familyId || 
    f.id === `fam_${gmkId}` || 
    f.primaryMemberGmkId === gmkId
  );
  const primaryEmail = (
    reg.primaryMemberEmail || 
    fam?.primaryMemberEmail || 
    ''
  ).trim().toLowerCase();

  if (!primaryEmail || !primaryEmail.includes('@')) {
    console.warn(`[familyCheckInService] Cannot queue completion email: no valid recipient email for GMK ID ${gmkId}`);
    return { 
      completed: true, 
      reason: 'No valid primary email found on registration or family profile.' 
    };
  }

  const primaryName = (reg.primaryRegistrantName || fam?.fullName || (fam as any)?.primaryMemberName || 'GMK Member').trim();
  const eventName = (activeEvent.title || activeEvent.eventName || (activeEvent as any)?.displayName || 'GMK Community Event').trim();

  // 4. Build individual check-in table (HTML) and plain text summary
  const tableRowsHtml = eligibleParticipants.map((p, idx) => {
    const rowBg = idx % 2 === 0 ? '#ffffff' : '#f9fafb';
    return `
      <tr style="background-color: ${rowBg};">
        <td style="padding: 10px 12px; border: 1px solid #e5e7eb; font-weight: bold; color: #111827;">${p.name}</td>
        <td style="padding: 10px 12px; border: 1px solid #e5e7eb; color: #0F4C2A; font-weight: 600;">${p.relationship}</td>
        <td style="padding: 10px 12px; border: 1px solid #e5e7eb; color: #4b5563;">${p.checkInDate}</td>
        <td style="padding: 10px 12px; border: 1px solid #e5e7eb; font-family: monospace; font-weight: bold; color: #0F4C2A;">${p.checkInTime}</td>
      </tr>
    `;
  }).join('');

  const checkInDetailsHtml = `
    <table style="width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 13px; color: #374151;">
      <thead>
        <tr style="background-color: #0F4C2A; color: #ffffff; text-align: left;">
          <th style="padding: 10px 12px; border: 1px solid #0F4C2A; font-size: 12px; text-transform: uppercase;">Participant Name</th>
          <th style="padding: 10px 12px; border: 1px solid #0F4C2A; font-size: 12px; text-transform: uppercase;">Relationship</th>
          <th style="padding: 10px 12px; border: 1px solid #0F4C2A; font-size: 12px; text-transform: uppercase;">Check-In Date</th>
          <th style="padding: 10px 12px; border: 1px solid #0F4C2A; font-size: 12px; text-transform: uppercase;">Check-In Time</th>
        </tr>
      </thead>
      <tbody>
        ${tableRowsHtml}
      </tbody>
    </table>
  `;

  const checkInDetailsText = eligibleParticipants.map(p => 
    `- ${p.relationship} (${p.name}) — Checked In — Date: ${p.checkInDate} — Time: ${p.checkInTime}`
  ).join('\n');

  // 5. Queue ONE notification in emailQueue using the existing architecture
  try {
    await NotificationService.sendFamilyCheckInCompletion(
      primaryEmail,
      {
        gmkId,
        eventName,
        recipientName: primaryName,
        primaryMemberEmail: primaryEmail,
        eventDate: activeEvent.date,
        eventVenue: activeEvent.venue,
        totalEligibleCheckedIn: eligibleParticipants.length,
        checkInDetailsHtml,
        checkInDetailsText,
        participants: eligibleParticipants.map(p => ({
          name: p.name,
          relationship: p.relationship,
          checkInDate: p.checkInDate,
          checkInTime: p.checkInTime
        })),
        eventId: activeEvent.id,
        registrationId: reg.id
      },
      queueDocId
    );

    // 6. Record sent/queued audit state on eventAttendance and event_registrations
    const nowIso = new Date().toISOString();
    await setDoc(attRef, {
      completionEmailQueuedAt: nowIso,
      completionEmailRecipient: primaryEmail,
      completionEmailQueueId: queueDocId,
      familyCompletionEmailSent: true,
      familyCheckInCompleted: true,
      familyCompletedAt: nowIso
    }, { merge: true });

    if (reg.id) {
      const regRef = doc(db, "event_registrations", reg.id);
      await setDoc(regRef, {
        completionEmailQueuedAt: nowIso,
        completionEmailRecipient: primaryEmail,
        completionEmailQueueId: queueDocId,
        familyCompletionEmailSent: true,
        familyCheckInCompleted: true,
        familyCompletedAt: nowIso
      }, { merge: true });
    }

    console.log(`[familyCheckInService] Successfully queued family completion email for ${gmkId} (${primaryEmail}) - Queue ID: ${queueDocId}`);

    return {
      completed: true,
      emailQueued: true,
      recipientEmail: primaryEmail,
      queueId: queueDocId,
      totalEligible: eligibleParticipants.length,
      totalCheckedIn: eligibleParticipants.length,
      eligibleParticipants
    };
  } catch (err: any) {
    console.error(`[familyCheckInService] Failed to queue family completion email for ${gmkId}:`, err);
    return {
      completed: true,
      emailQueued: false,
      reason: `Queue error: ${err.message || err}`
    };
  }
}
