import { collection, addDoc } from 'firebase/firestore';
import { db } from '../context/AuthContext';

export interface QueueNotificationOptions {
  notificationType?: string;
  priority?: 'normal' | 'high';
  source?: string;
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
      const docRef = await addDoc(collection(db, "emailQueue"), payload);
      console.log(`[NotificationService] Enqueued notification successfully: ${docRef.id} for ${to}`);
      return docRef.id;
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
}
