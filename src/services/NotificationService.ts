import { collection, addDoc, doc, setDoc, getDoc } from 'firebase/firestore';
import { db } from '../context/AuthContext';
import QRCode from 'qrcode';
import { 
  formatExternalGmkId, 
  formatEventDate, 
  formatEventTime 
} from '../utils/gmkIdHelper';

export interface QueueNotificationOptions {
  notificationType?: string;
  priority?: 'normal' | 'high';
  source?: string;
  customQueueId?: string;
}

export class NotificationService {
  /**
   * Core method to queue any notification by inserting a properly formatted
   * document inside the 'emailQueue' collection.
   */
  static async queueNotification(
    to: string,
    template: string,
    data: Record<string, any>,
    options: QueueNotificationOptions = {}
  ): Promise<string> {
    if (!to) {
      throw new Error("Recipient email address 'to' is required.");
    }
    if (!template) {
      throw new Error("Template name is required.");
    }

    const payload = {
      to: to.toLowerCase().trim(),
      from: "", // Will be filled/overridden by Cloud Functions from systemSettings
      template: template.trim(),
      notificationType: (options.notificationType || template.toUpperCase()).trim(),
      provider: "gmail",
      priority: options.priority || "normal",
      status: "pending",
      attempts: 0,
      createdAt: new Date().toISOString(),
      processedAt: null,
      sentAt: null,
      messageId: null,
      error: null,
      source: options.source || "portal",
      data: data || {},
      isTemplate: false
    };

    try {
      if (options.customQueueId) {
        const customDocRef = doc(db, "emailQueue", options.customQueueId);
        const existingSnap = await getDoc(customDocRef);
        if (existingSnap.exists()) {
          console.log(`[NotificationService] Notification already queued with ID: ${options.customQueueId}`);
          return options.customQueueId;
        }
        await setDoc(customDocRef, payload);
        console.log(`[NotificationService] Enqueued notification with custom ID: ${options.customQueueId} for ${to}`);
        return options.customQueueId;
      } else {
        const docRef = await addDoc(collection(db, "emailQueue"), payload);
        console.log(`[NotificationService] Enqueued notification successfully: ${docRef.id} for ${to}`);
        return docRef.id;
      }
    } catch (err: any) {
      console.error("[NotificationService] Failed to enqueue notification:", err);
      throw err;
    }
  }

  /**
   * Sends a registration approved notification.
   */
  static async sendRegistrationApproved(
    to: string,
    data: { residentName: string; gmkId: string; unit: string }
  ): Promise<string> {
    return this.queueNotification(to, "registration_approved", data, {
      notificationType: "REGISTRATION_APPROVED",
      priority: "high",
      source: "registration_approval_flow"
    });
  }

  /**
   * Sends a registration rejected notification.
   */
  static async sendRegistrationRejected(
    to: string,
    data: { residentName: string; reason: string }
  ): Promise<string> {
    return this.queueNotification(to, "registration_rejected", data, {
      notificationType: "REGISTRATION_REJECTED",
      priority: "normal",
      source: "registration_rejection_flow"
    });
  }

  /**
   * Sends a password reset notification.
   */
  static async sendPasswordReset(
    to: string,
    data: { residentName: string; resetLink: string }
  ): Promise<string> {
    return this.queueNotification(to, "password_reset", data, {
      notificationType: "PASSWORD_RESET",
      priority: "high",
      source: "password_reset_flow"
    });
  }

  /**
   * Sends an Event Director Appointment notification.
   */
  static async sendEventDirectorAppointment(
    to: string,
    data: { residentName: string; appointedBy: string }
  ): Promise<string> {
    return this.queueNotification(to, "event_director_appointment", data, {
      notificationType: "EVENT_DIRECTOR_APPOINTMENT",
      priority: "high",
      source: "governance_appointment_flow"
    });
  }

  /**
   * Sends an Event Director Revocation notification.
   */
  static async sendEventDirectorRevocation(
    to: string,
    data: { residentName: string; revokedBy: string }
  ): Promise<string> {
    return this.queueNotification(to, "event_director_revocation", data, {
      notificationType: "EVENT_DIRECTOR_REVOCATION",
      priority: "normal",
      source: "governance_revocation_flow"
    });
  }

  /**
   * Sends a generic template-driven notification.
   */
  static async sendGenericTemplate(
    to: string,
    templateName: string,
    data: Record<string, any>,
    options: QueueNotificationOptions = {}
  ): Promise<string> {
    return this.queueNotification(to, templateName, data, {
      notificationType: options.notificationType || "GENERIC_TEMPLATE",
      priority: options.priority || "normal",
      source: options.source || "generic_template_flow"
    });
  }

  /**
   * 1. External Registration Received / Submitted notification.
   */
  static async sendExternalRegistrationReceived(
    to: string,
    data: {
      recipientName: string;
      eventName: string;
      eventDate?: string;
      eventTime?: string;
      venue?: string;
      eventVenue?: string;
      gmkId?: string;
      publicReference: string;
      registrationTypeName?: string;
      category?: string;
      totalParticipants: number;
    }
  ): Promise<string> {
    const canonicalGmkId = formatExternalGmkId(data.gmkId || data.publicReference) || data.publicReference;
    const resolvedVenue = data.eventVenue || data.venue || 'Al Hail Greens Clubhouse / Main Lawn';
    const resolvedCategory = data.category || data.registrationTypeName || 'External Guest';

    const enrichedData = {
      ...data,
      recipientName: data.recipientName || "Valued Guest",
      residentName: data.recipientName || "Valued Guest",
      gmkId: canonicalGmkId,
      publicReference: canonicalGmkId,
      eventName: data.eventName || 'GMK Community Event',
      eventDate: formatEventDate(data.eventDate),
      eventTime: formatEventTime(data.eventTime),
      eventVenue: resolvedVenue,
      venue: resolvedVenue,
      category: resolvedCategory,
      registrationTypeName: resolvedCategory,
      totalParticipants: data.totalParticipants || 1
    };

    return this.queueNotification(to, "external_registration_received", enrichedData, {
      notificationType: "EXTERNAL_REGISTRATION_RECEIVED",
      priority: "high",
      source: "external_registration_submit_flow"
    });
  }

  /**
   * 2. External Registration Approved & Payment Instructions notification.
   * Standardized to ensure GMK ID (GMK-XXXXXX 6-digit), Event Name, Date, Oman Time, and Venue.
   */
  static async sendExternalRegistrationApproved(
    to: string,
    data: {
      recipientName: string;
      eventName: string;
      eventDate?: string;
      eventTime?: string;
      venue?: string;
      eventVenue?: string;
      gmkId?: string;
      publicReference: string;
      registrationTypeName?: string;
      category?: string;
      totalParticipants: number;
      amountDue: number | string;
      paymentInstructions: string;
    }
  ): Promise<string> {
    const canonicalGmkId = formatExternalGmkId(data.gmkId || data.publicReference) || data.publicReference;
    const resolvedVenue = data.eventVenue || data.venue || 'Al Hail Greens Clubhouse / Main Lawn';
    const resolvedCategory = data.category || data.registrationTypeName || 'External Guest';

    const enrichedData = {
      ...data,
      recipientName: data.recipientName || "Valued Guest",
      residentName: data.recipientName || "Valued Guest",
      gmkId: canonicalGmkId,
      publicReference: canonicalGmkId,
      eventName: data.eventName || 'GMK Community Event',
      eventDate: formatEventDate(data.eventDate),
      eventTime: formatEventTime(data.eventTime),
      eventVenue: resolvedVenue,
      venue: resolvedVenue,
      category: resolvedCategory,
      registrationTypeName: resolvedCategory,
      totalParticipants: data.totalParticipants || 1,
      amountDue: typeof data.amountDue === 'number' ? data.amountDue.toFixed(3) : data.amountDue
    };

    return this.queueNotification(to, "external_registration_approved", enrichedData, {
      notificationType: "EXTERNAL_REGISTRATION_APPROVED",
      priority: "high",
      source: "external_registration_approval_flow"
    });
  }

  /**
   * 3. External Registration Rejected / Cancelled notification.
   */
  static async sendExternalRegistrationRejected(
    to: string,
    data: {
      recipientName: string;
      eventName: string;
      eventDate?: string;
      eventTime?: string;
      venue?: string;
      eventVenue?: string;
      gmkId?: string;
      publicReference: string;
      registrationTypeName?: string;
      category?: string;
      totalParticipants?: number;
      reason?: string;
    }
  ): Promise<string> {
    const canonicalGmkId = formatExternalGmkId(data.gmkId || data.publicReference) || data.publicReference;
    const resolvedVenue = data.eventVenue || data.venue || 'Al Hail Greens Clubhouse / Main Lawn';
    const resolvedCategory = data.category || data.registrationTypeName || 'External Guest';

    const enrichedData = {
      ...data,
      recipientName: data.recipientName || "Valued Guest",
      residentName: data.recipientName || "Valued Guest",
      gmkId: canonicalGmkId,
      publicReference: canonicalGmkId,
      eventName: data.eventName || 'GMK Community Event',
      eventDate: formatEventDate(data.eventDate),
      eventTime: formatEventTime(data.eventTime),
      eventVenue: resolvedVenue,
      venue: resolvedVenue,
      category: resolvedCategory,
      registrationTypeName: resolvedCategory,
      totalParticipants: data.totalParticipants || 1,
      reason: data.reason || 'Capacity limits or administrative scheduling constraints.'
    };

    return this.queueNotification(to, "external_registration_rejected", enrichedData, {
      notificationType: "EXTERNAL_REGISTRATION_REJECTED",
      priority: "normal",
      source: "external_registration_rejection_flow"
    });
  }

  /**
   * 4. Payment Receipt & Official Entry Pass notification.
   * Standardized to embed high-res QR code encoding the Entry Pass / GMK ID,
   * prominent 6-digit numeric GMK ID (GMK-XXXXXX), and authoritative event details.
   */
  static async sendPaymentReceiptEntryPass(
    to: string,
    data: {
      residentName: string;
      recipientName?: string;
      gmkId?: string;
      eventName: string;
      eventDate?: string;
      eventTime?: string;
      venue?: string;
      eventVenue?: string;
      amountReceived: number | string;
      receiptNumber: string;
      entryPassNumber: string;
      paymentStatus: string;
      isExternal?: boolean;
      publicReference?: string;
      totalParticipants?: number;
      category?: string;
      registrationTypeName?: string;
      externalRegistrationTypeName?: string;
      qrCodeDataUrl?: string;
      registeredParticipants?: string;
      participants?: string[];
    },
    options?: QueueNotificationOptions
  ): Promise<string> {
    const isExt = data.isExternal || false;
    const canonicalGmkId = isExt
      ? (formatExternalGmkId(data.gmkId || data.publicReference) || data.publicReference || '')
      : (data.gmkId || 'Resident');

    const resolvedName = data.recipientName || data.residentName || 'Valued Guest';
    const resolvedVenue = data.eventVenue || data.venue || 'Al Hail Greens Clubhouse / Main Lawn';
    const resolvedCategory = isExt
      ? (data.externalRegistrationTypeName || data.category || data.registrationTypeName || 'External Guest')
      : (data.category || data.registrationTypeName || 'GMK Resident');
    const qrPayload = data.entryPassNumber || canonicalGmkId;

    // Use quickchart.io for reliable hosted QR code generation to avoid broken Base64 CID attachments in email clients
    let qrUrl = data.qrCodeDataUrl;
    if (!qrUrl && qrPayload) {
      qrUrl = `https://quickchart.io/qr?text=${encodeURIComponent(qrPayload)}&size=240&margin=1&dark=0f4c2a`;
    }

    const formattedAmount = typeof data.amountReceived === 'number'
      ? data.amountReceived.toFixed(3)
      : String(data.amountReceived);

    const resolvedParticipantsList = data.registeredParticipants || (Array.isArray(data.participants) && data.participants.length > 0 ? data.participants.join(", ") : resolvedName);

    const enrichedData = {
      ...data,
      recipientName: resolvedName,
      residentName: resolvedName,
      gmkId: canonicalGmkId,
      publicReference: isExt ? canonicalGmkId : (data.publicReference || canonicalGmkId),
      eventName: data.eventName || 'GMK Community Event',
      eventDate: formatEventDate(data.eventDate),
      eventTime: formatEventTime(data.eventTime),
      eventVenue: resolvedVenue,
      venue: resolvedVenue,
      category: resolvedCategory,
      registrationTypeName: resolvedCategory,
      totalParticipants: data.totalParticipants || (Array.isArray(data.participants) ? data.participants.length : 1),
      registeredParticipants: resolvedParticipantsList,
      receiptNumber: data.receiptNumber || 'N/A',
      entryPassNumber: data.entryPassNumber || canonicalGmkId,
      amountReceived: formattedAmount,
      paymentStatus: (data.paymentStatus || 'paid').toUpperCase(),
      qrCodeDataUrl: qrUrl || ''
    };

    return this.queueNotification(to, "payment_receipt_entry_pass", enrichedData, {
      notificationType: options?.notificationType || "ENTRY_PASS",
      priority: options?.priority || "high",
      source: options?.source || "payment_confirmation_flow",
      customQueueId: options?.customQueueId
    });
  }

  /**
   * 5. External Registration Refund Confirmation notification.
   */
  static async sendExternalRegistrationRefundConfirmation(
    to: string,
    data: {
      recipientName: string;
      eventName: string;
      eventDate?: string;
      eventTime?: string;
      venue?: string;
      eventVenue?: string;
      gmkId?: string;
      publicReference: string;
      registrationTypeName?: string;
      category?: string;
      totalParticipants?: number;
      refundAmount: number | string;
      settlementMethod?: string;
      settlementReference?: string;
      financeRemarks?: string;
    }
  ): Promise<string> {
    const canonicalGmkId = formatExternalGmkId(data.gmkId || data.publicReference) || data.publicReference;
    const resolvedVenue = data.eventVenue || data.venue || 'Al Hail Greens Clubhouse / Main Lawn';
    const resolvedCategory = data.category || data.registrationTypeName || 'External Guest';

    const formattedRefund = typeof data.refundAmount === 'number'
      ? data.refundAmount.toFixed(3)
      : String(data.refundAmount);

    const enrichedData = {
      ...data,
      recipientName: data.recipientName || "Valued Guest",
      residentName: data.recipientName || "Valued Guest",
      gmkId: canonicalGmkId,
      publicReference: canonicalGmkId,
      eventName: data.eventName || 'GMK Community Event',
      eventDate: formatEventDate(data.eventDate),
      eventTime: formatEventTime(data.eventTime),
      eventVenue: resolvedVenue,
      venue: resolvedVenue,
      category: resolvedCategory,
      registrationTypeName: resolvedCategory,
      totalParticipants: data.totalParticipants || 1,
      refundAmount: formattedRefund,
      settlementMethod: data.settlementMethod || 'Bank Transfer',
      settlementReference: data.settlementReference || 'N/A',
      financeRemarks: data.financeRemarks || 'Refund settled by GMK Finance'
    };

    return this.queueNotification(to, "external_registration_refund_confirmed", enrichedData, {
      notificationType: "EXTERNAL_REGISTRATION_REFUND_CONFIRMED",
      priority: "high",
      source: "external_registration_refund_flow"
    });
  }

  /**
   * Family Check-In Completion notification.
   * Dispatched when all eligible participants (GMK Member, Spouse, Children)
   * belonging to a GMK event registration have completed gate check-in.
   */
  static async sendFamilyCheckInCompletion(
    to: string,
    data: {
      gmkId: string;
      eventName: string;
      recipientName: string;
      primaryMemberEmail: string;
      eventDate?: string;
      eventVenue?: string;
      totalEligibleCheckedIn: number;
      checkInDetailsHtml: string;
      checkInDetailsText: string;
      participants: Array<{
        name: string;
        relationship: string;
        checkInDate: string;
        checkInTime: string;
      }>;
      eventId: string;
      registrationId: string;
    },
    customQueueId?: string
  ): Promise<string> {
    const enrichedData = {
      ...data,
      recipientName: data.recipientName || "GMK Member",
      residentName: data.recipientName || "GMK Member",
      gmkId: data.gmkId,
      eventName: data.eventName || 'GMK Community Event',
      eventDate: formatEventDate(data.eventDate),
      eventVenue: data.eventVenue || 'Al Hail Greens Clubhouse / Main Lawn',
      venue: data.eventVenue || 'Al Hail Greens Clubhouse / Main Lawn',
      totalParticipants: data.totalEligibleCheckedIn,
      totalEligibleCheckedIn: data.totalEligibleCheckedIn,
      category: 'Resident Member'
    };

    return this.queueNotification(to, "family_checkin_completion", enrichedData, {
      notificationType: "FAMILY_CHECKIN_COMPLETION",
      priority: "high",
      source: "gate_attendance_workspace",
      customQueueId
    });
  }
}

