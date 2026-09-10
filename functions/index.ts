import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { getApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { logger } from "firebase-functions";
import * as nodemailer from "nodemailer";
import { replacePlaceholders } from "./utils/template";

// Define the custom Firestore Database ID for this environment
const FIRESTORE_DATABASE_ID = "ai-studio-7d23ee96-a783-4875-9630-4390202b70b9";

// Lazy-initialized Firestore instance to avoid blocking global scope during deployment discovery
let _db: FirebaseFirestore.Firestore | null = null;
function getDbInstance(): FirebaseFirestore.Firestore {
  if (!_db) {
    try {
  getApp();
} catch {
  initializeApp();
}
    _db = getFirestore(FIRESTORE_DATABASE_ID);
  }
  return _db;
}

const db = new Proxy({} as FirebaseFirestore.Firestore, {
  get(_target, prop, receiver) {
    const realDb = getDbInstance();
    const value = Reflect.get(realDb, prop, receiver);
    if (typeof value === "function") {
      return value.bind(realDb);
    }
    return value;
  }
});

// Define Gmail SMTP Secrets (stored securely in Google Cloud Secret Manager)
const gmkSmtpUser = defineSecret("GMK_SMTP_USER");
const gmkSmtpPassword = defineSecret("GMK_SMTP_PASSWORD");

// Define Meta WhatsApp Secrets
const metaWhatsAppToken = defineSecret("META_WHATSAPP_TOKEN");
const metaPhoneNumberId = defineSecret("META_PHONE_NUMBER_ID");

/**
 * Firestore trigger that watches new document additions in the emailQueue collection.
 * Processes pending notification documents automatically and manages retries securely.
 */
export const processEmailQueue = onDocumentCreated({
  document: "emailQueue/{queueId}",
  database: FIRESTORE_DATABASE_ID,
  secrets: [gmkSmtpUser, gmkSmtpPassword]
}, async (event: any) => {
  const startTime = Date.now();
  const queueId = event.params.queueId;

  // Retrieve document snapshot
  const snapshot = event.data;
  if (!snapshot) {
    logger.info(`[Queue: ${queueId}] No snapshot data available. Returning.`);
    return;
  }

  // Fetch the actual, live document from the named Firestore database instance
  // to bypass any Eventarc deserialization/database-alignment issues in Gen 2 triggers.
  const docRef = db.collection("emailQueue").doc(queueId);
  const liveSnapshot = await docRef.get();
  if (!liveSnapshot.exists) {
    logger.info(`[Queue: ${queueId}] Document does not exist in named Firestore database. Returning.`);
    return;
  }

  const data = liveSnapshot.data();
  if (!data) {
    logger.info(`[Queue: ${queueId}] Document has no body data. Returning.`);
    return;
  }

  // Enhanced debug logging to inspect the complete payload and identify field names/mismatches
  logger.info(`[Queue: ${queueId}] Raw payload keys: ${Object.keys(data).join(", ")}, status: ${data.status}`);

  const recipient = data.to || "Unknown";
  const templateName = data.template || "None";
  const notificationType = data.notificationType || "GENERIC";

  // 1. Check if the queue document is marked as isTemplate
  if (data.isTemplate === true) {
    logger.info(`[Queue: ${queueId}] isTemplate == true. Reference template document. Skipping.`);
    return;
  }

  // 2. Check if status is pending
  if (data.status !== "pending") {
    logger.info(`[Queue: ${queueId}] Status is '${data.status}' (not pending). Skipping processing.`);
    return;
  }

  // 3. Check attempts threshold
  const currentAttempts = data.attempts || 0;
  if (currentAttempts >= 3) {
    logger.warn(`[Queue: ${queueId}] Maximum retry attempts reached (${currentAttempts}/3). Marking status as failed.`);
    await docRef.update({
      status: "failed",
      error: "Maximum retry attempts reached before execution.",
      processedAt: new Date().toISOString()
    });
    return;
  }

  // Retrieve secret values safely
  const GMK_SMTP_USER = gmkSmtpUser.value();
  const GMK_SMTP_PASSWORD = gmkSmtpPassword.value();

  if (!GMK_SMTP_USER || !GMK_SMTP_PASSWORD) {
    logger.error(`[Queue: ${queueId}] Firebase Secrets 'GMK_SMTP_USER' or 'GMK_SMTP_PASSWORD' are undefined or unconfigured.`);
    await docRef.update({
      status: "failed",
      error: "SMTP Secret credentials configuration missing on environment.",
      processedAt: new Date().toISOString(),
      attempts: currentAttempts + 1
    });
    return;
  }

  try {
    logger.info(`[Queue: ${queueId}] Initiating processing for recipient: ${recipient}, template: ${templateName}, notificationType: ${notificationType}`);

    // Fetch system settings platform info
    const platformDoc = await db.doc("systemSettings/platform").get();
    const platformSettings = platformDoc.exists ? platformDoc.data() : null;

    if (!templateName) {
      throw new Error(`Queue record does not specify a target 'template'.`);
    }

    // Fetch email templates
    let templateDoc = await db.doc(`emailTemplates/${templateName}`).get();
    let templateData = templateDoc.exists ? templateDoc.data() : null;

    if (!templateData && templateName === "family_checkin_completion") {
      templateData = {
        enabled: true,
        subject: "GMK Event Family Check-In Completed - {{eventName}} ({{gmkId}})",
        text: `Dear {{recipientName}},\n\nYour family check-in for {{eventName}} has been completed. All eligible registered members have successfully entered the venue.\n\nEvent & Registration Details:\n- GMK ID: {{gmkId}}\n- Event Name: {{eventName}}\n- Primary Member: {{recipientName}}\n- Family Check-In Status: Completed\n\nIndividual Check-In Details:\n{{checkInDetailsText}}\n\nWe hope you and your family enjoy the event!\n\nGreens Malayalee Koottayma (GMK) • Al Hail Greens\ntheadmingmk@gmail.com`,
        html: `<div style="font-family: Arial, Helvetica, sans-serif; max-width: 600px; margin: 0 auto; padding: 0; border: 1px solid #e5e7eb; border-radius: 12px; background-color: #ffffff; overflow: hidden;">
  <div style="background-color: #0F4C2A; padding: 24px 20px; text-align: center; border-bottom: 3px solid #D4AF37;">
    <h1 style="color: #ffffff; font-size: 22px; margin: 0; font-family: Georgia, serif; font-weight: bold; letter-spacing: 0.5px;">Al Hail Greens</h1>
    <p style="color: #F3E5AB; font-size: 11px; font-weight: bold; text-transform: uppercase; margin: 6px 0 0 0; letter-spacing: 1.5px;">Greens Malayalee Koottayma • GMK Community Events</p>
  </div>
  <div style="padding: 28px 24px; color: #374151; font-size: 14px; line-height: 1.6;">
    <div style="background-color: #f0fdf4; border: 2px solid #0F4C2A; border-radius: 10px; padding: 18px 20px; margin-bottom: 24px; text-align: center;">
      <h2 style="color: #0F4C2A; font-size: 19px; margin: 0 0 6px 0; font-family: Georgia, serif; font-weight: bold;">Family Check-In Completed</h2>
      <p style="margin: 0; font-size: 13px; color: #166534; font-weight: 600;">All eligible registered members of your family have entered the venue.</p>
    </div>
    <p style="margin: 0 0 16px 0;">Dear <strong>{{recipientName}}</strong>,</p>
    <p style="margin: 0 0 20px 0;">This email confirms that all eligible registered family members for <strong>{{eventName}}</strong> have successfully checked in at the gate.</p>
    <div style="background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin: 20px 0;">
      <h3 style="margin: 0 0 12px 0; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; color: #0F4C2A; font-weight: bold;">Event & Registration Information</h3>
      <table style="width: 100%; font-size: 13px; color: #374151; border-collapse: collapse;">
        <tr><td style="padding: 5px 0; width: 40%; font-weight: bold; color: #4b5563;">GMK ID:</td><td style="padding: 5px 0; font-family: monospace; font-weight: bold; color: #0F4C2A; font-size: 14px;">{{gmkId}}</td></tr>
        <tr><td style="padding: 5px 0; font-weight: bold; color: #4b5563;">Event Name:</td><td style="padding: 5px 0; font-weight: bold;">{{eventName}}</td></tr>
        <tr><td style="padding: 5px 0; font-weight: bold; color: #4b5563;">Primary Member:</td><td style="padding: 5px 0;">{{recipientName}}</td></tr>
        <tr><td style="padding: 5px 0; font-weight: bold; color: #4b5563;">Status:</td><td style="padding: 5px 0; font-weight: bold; color: #15803d; text-transform: uppercase;">Completed</td></tr>
      </table>
    </div>
    <div style="margin: 24px 0;">
      <h3 style="margin: 0 0 12px 0; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; color: #0F4C2A; font-weight: bold;">Individual Check-In Details</h3>
      {{checkInDetailsHtml}}
    </div>
    <div style="background-color: #fefcf3; border-left: 4px solid #D4AF37; padding: 14px 16px; margin: 20px 0; border-radius: 0 8px 8px 0; font-size: 12.5px; color: #78350f;">
      <p style="margin: 0;">We hope you and your family have a wonderful time at <strong>{{eventName}}</strong>!</p>
    </div>
  </div>
  <div style="text-align: center; padding: 20px; background-color: #f9fafb; border-top: 1px solid #e5e7eb; font-size: 11px; color: #6b7280; line-height: 1.5;">
    <p style="margin: 0; font-weight: bold; color: #374151;">Greens Malayalee Koottayma (GMK) • Al Hail Greens</p>
    <p style="margin: 4px 0 0 0;">For inquiries or assistance, please contact <a href="mailto:theadmingmk@gmail.com" style="color: #0F4C2A; text-decoration: underline;">theadmingmk@gmail.com</a></p>
  </div>
</div>`
      };
    }

    if (!templateData && templateName === "payment_receipt_entry_pass") {
      templateData = {
        enabled: true,
        subject: "GMK Official Entry Pass & Payment Confirmed - {{eventName}} ({{gmkId}})",
        text: `Dear {{recipientName}},\n\nYour payment for {{eventName}} has been confirmed and your Official Entry Pass is issued.\n\nRegistration & Event Details:\n- GMK ID: {{gmkId}}\n- Official Entry Pass Number: {{entryPassNumber}}\n- Event Name: {{eventName}}\n- Event Date: {{eventDate}}\n- Event Time: {{eventTime}}\n- Event Venue: {{eventVenue}}\n- Registrant Name: {{recipientName}}\n- Category: {{category}}\n- Total Participants: {{totalParticipants}}\n- Registered Participants: {{registeredParticipants}}\n- Receipt Number: {{receiptNumber}}\n- Amount Paid: {{amountReceived}} OMR\n- Payment Status: {{paymentStatus}}\n\nPlease present your Official Entry Pass Number or digital QR pass at the entrance check-in counter on the day of the event.\n\nThank you,\nGreens Malayalee Koottayma (GMK)\nAl Hail Greens\ntheadmingmk@gmail.com`,
        html: `<div style="font-family: Arial, Helvetica, sans-serif; max-width: 600px; margin: 0 auto; padding: 0; border: 1px solid #e5e7eb; border-radius: 12px; background-color: #ffffff; overflow: hidden;">
  <div style="background-color: #0F4C2A; padding: 24px 20px; text-align: center; border-bottom: 3px solid #D4AF37;">
    <h1 style="color: #ffffff; font-size: 22px; margin: 0; font-family: Georgia, serif; font-weight: bold; letter-spacing: 0.5px;">Al Hail Greens</h1>
    <p style="color: #F3E5AB; font-size: 11px; font-weight: bold; text-transform: uppercase; margin: 6px 0 0 0; letter-spacing: 1.5px;">Greens Malayalee Koottayma • GMK Community Events</p>
  </div>
  <div style="padding: 28px 24px; color: #374151; font-size: 14px; line-height: 1.6;">
    <h2 style="color: #0F4C2A; font-size: 19px; margin-top: 0; margin-bottom: 16px; font-family: Georgia, serif; font-weight: bold;">Payment Confirmed & Official Entry Pass</h2>
    <p style="margin: 0 0 16px 0;">Dear <strong>{{recipientName}}</strong>,</p>
    <p style="margin: 0 0 20px 0;">Your payment for <strong>{{eventName}}</strong> has been confirmed. Your official Entry Pass and gate admission QR code have been issued below.</p>
    
    <div style="background-color: #f9fafb; border: 2px solid #0F4C2A; border-radius: 10px; padding: 20px; margin: 24px 0; text-align: center;">
      <div style="margin-bottom: 16px;">
        <img src="{{qrCodeDataUrl}}" width="160" height="160" alt="Official Entry Pass QR" style="display: block; margin: 0 auto; border-radius: 8px; border: 1px solid #d1d5db; background: #ffffff; padding: 6px;" />
        <p style="margin: 6px 0 0 0; font-size: 11px; color: #6b7280; font-weight: bold;">Scan at gate for instant check-in</p>
      </div>
      <p style="margin: 0 0 4px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #15803d; font-weight: bold;">Official Entry Pass Number</p>
      <p style="margin: 0; font-size: 22px; font-family: monospace; font-weight: bold; color: #0f4c2a; letter-spacing: 2px;">{{entryPassNumber}}</p>
      <div style="margin-top: 12px; padding-top: 12px; border-top: 1px dashed #d1d5db; font-size: 13px; color: #374151;">
        <p style="margin: 0; font-size: 13px;"><strong>GMK ID:</strong> <span style="font-family: monospace; font-weight: bold; color: #0F4C2A; font-size: 14px;">{{gmkId}}</span></p>
      </div>
    </div>

    <div style="background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin: 20px 0;">
      <h3 style="margin: 0 0 12px 0; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; color: #0F4C2A; font-weight: bold;">Registration & Event Details</h3>
      <table style="width: 100%; font-size: 13px; color: #374151; border-collapse: collapse;">
        <tr><td style="padding: 5px 0; width: 40%; font-weight: bold; color: #4b5563;">Event Name:</td><td style="padding: 5px 0; font-weight: bold;">{{eventName}}</td></tr>
        <tr><td style="padding: 5px 0; font-weight: bold; color: #4b5563;">Event Date:</td><td style="padding: 5px 0;">{{eventDate}}</td></tr>
        <tr><td style="padding: 5px 0; font-weight: bold; color: #4b5563;">Event Time:</td><td style="padding: 5px 0;">{{eventTime}}</td></tr>
        <tr><td style="padding: 5px 0; font-weight: bold; color: #4b5563;">Event Venue:</td><td style="padding: 5px 0;">{{eventVenue}}</td></tr>
        <tr><td style="padding: 5px 0; font-weight: bold; color: #4b5563;">Registrant Name:</td><td style="padding: 5px 0;">{{recipientName}}</td></tr>
        <tr><td style="padding: 5px 0; font-weight: bold; color: #4b5563;">GMK ID:</td><td style="padding: 5px 0; font-family: monospace; font-weight: bold; color: #0F4C2A; font-size: 14px;">{{gmkId}}</td></tr>
        <tr><td style="padding: 5px 0; font-weight: bold; color: #4b5563;">Category:</td><td style="padding: 5px 0;">{{category}}</td></tr>
        <tr><td style="padding: 5px 0; font-weight: bold; color: #4b5563;">Total Participants:</td><td style="padding: 5px 0; font-weight: bold; color: #0F4C2A;">{{totalParticipants}} person(s)</td></tr>
        <tr><td style="padding: 5px 0; font-weight: bold; color: #4b5563;">Registered Participants:</td><td style="padding: 5px 0;">{{registeredParticipants}}</td></tr>
        <tr><td style="padding: 5px 0; font-weight: bold; color: #4b5563;">Receipt Number:</td><td style="padding: 5px 0; font-family: monospace;">{{receiptNumber}}</td></tr>
        <tr><td style="padding: 5px 0; font-weight: bold; color: #4b5563;">Amount Paid:</td><td style="padding: 5px 0; font-weight: bold; color: #0F4C2A;">{{amountReceived}} OMR</td></tr>
        <tr><td style="padding: 5px 0; font-weight: bold; color: #4b5563;">Payment Status:</td><td style="padding: 5px 0; text-transform: uppercase; font-weight: bold; color: #15803d;">{{paymentStatus}}</td></tr>
      </table>
    </div>

    <div style="background-color: #fefcf3; border-left: 4px solid #D4AF37; padding: 14px 16px; margin: 20px 0; border-radius: 0 8px 8px 0; font-size: 12.5px; color: #78350f;">
      <p style="margin: 0 0 4px 0; font-weight: bold; color: #92400e;">Gate Admission Notice:</p>
      <p style="margin: 0;">Please present your digital QR code or state your Entry Pass Number at the entrance verification desk. We look forward to seeing you!</p>
    </div>
  </div>
  <div style="text-align: center; padding: 20px; background-color: #f9fafb; border-top: 1px solid #e5e7eb; font-size: 11px; color: #6b7280; line-height: 1.5;">
    <p style="margin: 0; font-weight: bold; color: #374151;">Greens Malayalee Koottayma (GMK) • Al Hail Greens</p>
    <p style="margin: 4px 0 0 0;">For inquiries or assistance, please contact <a href="mailto:theadmingmk@gmail.com" style="color: #0F4C2A; text-decoration: underline;">theadmingmk@gmail.com</a></p>
  </div>
</div>`
      };
    }

    if (!templateData) {
      throw new Error(`Email template 'emailTemplates/${templateName}' does not exist in Firestore.`);
    }

    if (templateData?.enabled === false) {
      throw new Error(`Email template 'emailTemplates/${templateName}' is currently marked disabled.`);
    }

    // Prepare placeholder mappings (Platform settings merged with queue message data)
    const rawPayload = data.data || {};
    const recipientNameVal = rawPayload.recipientName || rawPayload.residentName || rawPayload.registrantName || "Valued Guest";
    const venueVal = rawPayload.eventVenue || rawPayload.venue || "Al Hail Greens Clubhouse / Main Lawn";
    const timeVal = rawPayload.eventTime || "07:00 PM (Oman Time)";
    const categoryVal = rawPayload.category || rawPayload.registrationTypeName || rawPayload.externalRegistrationTypeName || (rawPayload.isExternal ? "External Guest" : "Resident");
    const gmkIdVal = rawPayload.gmkId || rawPayload.publicReference || "";

    const placeholders: Record<string, any> = {
      ...(platformSettings || {}),
      recipientName: recipientNameVal,
      residentName: recipientNameVal,
      registrantName: recipientNameVal,
      eventVenue: venueVal,
      venue: venueVal,
      eventTime: timeVal,
      category: categoryVal,
      registrationTypeName: categoryVal,
      gmkId: gmkIdVal,
      ...rawPayload
    };

    const subjectPattern = templateData?.subject || "";
    const htmlPattern = templateData?.html || "";
    const textPattern = templateData?.text || "";

    // Perform replacement using reusable template helper (strips unresolved placeholders)
    const finalSubject = replacePlaceholders(subjectPattern, placeholders, true);
    let finalHtml = replacePlaceholders(htmlPattern, placeholders, true);
    const finalText = replacePlaceholders(textPattern, placeholders, true);

    // Handle inline QR code attachment (RFC standard CID embedding)
    const attachments: any[] = [];
    const qrData = placeholders.qrCodeDataUrl || placeholders.qrCode;
    if (qrData && typeof qrData === "string" && qrData.includes("base64,")) {
      const base64Content = qrData.split("base64,")[1];
      attachments.push({
        filename: "entry-pass-qr.png",
        content: Buffer.from(base64Content, "base64"),
        cid: "entryPassQr",
        contentType: "image/png",
        contentDisposition: "inline"
      });
      // Replace data URL or placeholder in html with standard CID
      finalHtml = finalHtml.replace(/src=["']data:image\/png;base64,[^"']+["']/g, 'src="cid:entryPassQr"');
      finalHtml = finalHtml.replace(/src=["']{{\s*qrCodeDataUrl\s*}}["']/g, 'src="cid:entryPassQr"');
      finalHtml = finalHtml.replace(/{{\s*qrCodeDataUrl\s*}}/g, "cid:entryPassQr");
    }

    // Setup hardened Explicit SMTP transporter
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: GMK_SMTP_USER,
        pass: GMK_SMTP_PASSWORD
      }
    });

    // Derive sender info strictly from platform settings and authenticated SMTP account (never from emailQueue document)
    const senderName = platformSettings?.senderName || "GMK Community Platform";
    const derivedFrom = `"${senderName}" <${GMK_SMTP_USER}>`;

    const mailOptions: any = {
      from: derivedFrom,
      to: data.to,
      replyTo: platformSettings?.replyTo || platformSettings?.supportEmail || undefined,
      subject: finalSubject,
      html: finalHtml,
      text: finalText
    };

    if (attachments.length > 0) {
      mailOptions.attachments = attachments;
    }

    logger.info(`[Queue: ${queueId}] Dispatching SMTP message to: ${data.to}`);
    
    // Send email securely
    const sendInfo = await transporter.sendMail(mailOptions);
    const duration = Date.now() - startTime;

    logger.info(`[Queue: ${queueId}] Dispatch success! Message ID: ${sendInfo.messageId}. Duration: ${duration}ms`);

    // Update the document to reflect successful completion
    const sentIso = new Date().toISOString();
    await docRef.update({
      status: "sent",
      deliveryStatus: "accepted",
      processedAt: sentIso,
      sentAt: sentIso,
      messageId: sendInfo.messageId,
      attempts: currentAttempts + 1,
      error: null
    });

    // If family_checkin_completion, update attendance and registration completionEmailSentAt
    if (templateName === "family_checkin_completion") {
      const payloadData = data.data || {};
      const targetGmkId = payloadData.gmkId;
      const targetEventId = payloadData.eventId;
      const targetRegistrationId = payloadData.registrationId;
      if (targetGmkId && targetEventId) {
        try {
          await db.collection("eventAttendance").doc(`att_${targetGmkId}_${targetEventId}`).set({
            completionEmailSentAt: sentIso,
            familyCompletionEmailSent: true
          }, { merge: true });
        } catch (auditErr) {
          logger.warn(`[Queue: ${queueId}] Non-blocking warning: failed to update eventAttendance sentAt:`, auditErr);
        }
      }
      if (targetRegistrationId) {
        try {
          await db.collection("event_registrations").doc(targetRegistrationId).set({
            completionEmailSentAt: sentIso,
            familyCompletionEmailSent: true
          }, { merge: true });
        } catch (auditErr) {
          logger.warn(`[Queue: ${queueId}] Non-blocking warning: failed to update event_registrations sentAt:`, auditErr);
        }
      }
    }

  } catch (error: any) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`[Queue: ${queueId}] Error occurred during dispatch. Duration: ${duration}ms. Error: ${errorMessage}`);

    const nextAttempts = currentAttempts + 1;
    const nextStatus = nextAttempts >= 3 ? "failed" : "pending";

    // Non-blocking fail/retry write back
    await docRef.update({
      status: nextStatus,
      error: errorMessage,
      processedAt: new Date().toISOString(),
      attempts: nextAttempts
    });
  }
});

/**
 * Callable HTTPS Cloud Function to securely generate a Firebase Password Reset Link
 * and enqueue a beautifully branded notification without revealing user existence.
 */
export const requestPasswordReset = onCall({
  cors: true
}, async (request: any) => {
  const email = request.data?.email?.toLowerCase().trim();
  if (!email) {
    throw new HttpsError("invalid-argument", "Email parameter is required.");
  }

  // Define operational metadata to be saved or returned
  let residentName = "Resident";
  let resetLink = "";

  try {
    // 1. Securely generate Firebase password reset link using admin Auth SDK
    resetLink = await getAuth().generatePasswordResetLink(email);

    // 2. Fetch the resident's or user's full name to personalize the email template
    const residentSnap = await db.collection("residents")
      .where("email", "==", email)
      .limit(1)
      .get();

    if (!residentSnap.empty) {
      residentName = residentSnap.docs[0].data().fullName || "Resident";
    } else {
      const userSnap = await db.collection("users")
        .where("email", "==", email)
        .limit(1)
        .get();
      if (!userSnap.empty) {
        residentName = userSnap.docs[0].data().fullName || "Resident";
      }
    }

    // 3. Create document in the emailQueue collection to trigger notification engine
    const queueDocRef = await db.collection("emailQueue").add({
      to: email,
      from: "",
      template: "password_reset",
      notificationType: "PASSWORD_RESET",
      provider: "gmail",
      priority: "high",
      status: "pending",
      attempts: 0,
      createdAt: new Date().toISOString(),
      processedAt: null,
      sentAt: null,
      messageId: null,
      error: null,
      source: "password_reset_flow",
      data: {
        residentName: residentName,
        resetLink: resetLink
      },
      isTemplate: false
    });

    // 4. Securely log this action in the audit trail (never logging token or link)
    const auditId = "audit_" + Math.random().toString(36).substring(2, 15);
    await db.collection("auditLogs").doc(auditId).set({
      id: auditId,
      action: "PASSWORD_RESET_REQUESTED",
      actorEmail: email,
      targetId: email,
      targetName: residentName,
      details: `Password reset request enqueued in emailQueue (${queueDocRef.id}) for ${email}`,
      timestamp: new Date().toISOString()
    });

    logger.info(`[PasswordReset] Successfully generated link and enqueued mail queue item ${queueDocRef.id} for email: ${email}`);

  } catch (err: any) {
    // If the error indicates user not found, swallow the error and log it internally.
    // This strictly prevents account enumeration/disclosure security issues.
    if (err.code === "auth/user-not-found") {
      logger.info(`[PasswordReset] Silent fallback: requested password reset for unregistered or un-activated email address: ${email}`);
    } else {
      logger.error(`[PasswordReset] Critical failure generating password reset link for email ${email}:`, err);
      throw new HttpsError("internal", "An error occurred while initiating your password reset. Please try again later.");
    }
  }

  // Secure identical response to the caller regardless of existence
  return { success: true };
});

/**
 * Helper function to verify Finance Committee / Administrator authorization
 */
async function isAuthorizedForPayment(uid: string, email: string, eventId: string): Promise<boolean> {
  const normEmail = (email || "").toLowerCase().trim();
  if (normEmail === "thesadmingmk@gmail.com" || normEmail === "theadmingmk@gmail.com") {
    return true;
  }

  if (uid) {
    try {
      const uDoc = await db.collection("users").doc(uid).get();
      if (uDoc.exists) {
        const uData = uDoc.data();
        const roles: string[] = Array.isArray(uData?.roles) ? uData.roles : [];
        const allowedRoles = [
          "super_admin", "admin", 
          "event_director", 
          "finance", "treasurer", "finance_team", "committee_lead_finance", "finance_lead",
          `event_director_${eventId}`,
          `finance_${eventId}`, `finance_team_${eventId}`, `finance_lead_${eventId}`, `treasurer_${eventId}`
        ].map(r => r.toLowerCase());

        if (roles.some((r) => allowedRoles.includes(r.toLowerCase()))) {
          return true;
        }
      }
    } catch (err) {
      logger.warn(`[isAuthorizedForPayment] Error reading users/${uid}:`, err);
    }
  }

  return false;
}

/**
 * Callable HTTPS Cloud Function to securely process and record Event Registration Payments.
 * Bypasses client-side Firestore rules via Admin SDK, ensuring atomic payment updates and audit logging.
 */
export const processEventPayment = onCall({ cors: true }, async (request: any) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication is required to process event payments.");
  }
  
  const uid = request.auth.uid;
  const callerEmail = (request.auth.token?.email || "").toLowerCase().trim();
  
  const registrationId = request.data?.registrationId;
  const amountReceivedInput = request.data?.amountReceived;
  const financeRemarks = (request.data?.financeRemarks || "").toString().trim();

  if (!registrationId || typeof registrationId !== "string") {
    throw new HttpsError("invalid-argument", "Registration ID parameter is required.");
  }

  const newPaymentAmount = parseFloat(amountReceivedInput);
  if (isNaN(newPaymentAmount) || newPaymentAmount <= 0) {
    throw new HttpsError("invalid-argument", "Valid positive amountReceived parameter is required.");
  }

  const regRef = db.collection("event_registrations").doc(registrationId);
  const nowIso = new Date().toISOString();
  let resultPayload: any = null;

  logger.info(`[processEventPayment] Attempting payment for regId: ${registrationId} by UID: ${uid}`);

  await db.runTransaction(async (transaction) => {
    const regSnap = await transaction.get(regRef);
    if (!regSnap.exists) {
      throw new HttpsError("not-found", `Event registration '${registrationId}' was not found.`);
    }

    const regData = regSnap.data()!;
    const selectedEventId = regData.eventId;
    
    if (!selectedEventId) {
      throw new HttpsError("failed-precondition", "Registration record is missing an eventId.");
    }

    // Validate Finance / Admin Authorization for this specific event
    const authorized = await isAuthorizedForPayment(uid, callerEmail, selectedEventId);
    if (!authorized) {
      logger.warn(`[processEventPayment] Authorization denied for UID: ${uid}, Email: ${callerEmail}, Event: ${selectedEventId}`);
      throw new HttpsError("permission-denied", "Unauthorized. Only authorized Event Directors or Finance team members can process payments.");
    }

    // Obtain authoritative amountDue server-side
    let amountDue = 0;
    if (typeof regData.amountDue === "number") {
      amountDue = regData.amountDue;
    } else if (typeof regData.paymentAmount === "number") {
      amountDue = regData.paymentAmount;
    } else if (regData.paymentSummary && typeof regData.paymentSummary.totalAmount === "number") {
      amountDue = regData.paymentSummary.totalAmount;
    } else if (regData.amountDue) {
      amountDue = parseFloat(regData.amountDue) || 0;
    }

    const currentTotalReceived = parseFloat(regData.amountReceived) || 0;
    const totalAlreadyRefunded = parseFloat(regData.refundedAmount) || 0;
    
    const newTotalConfirmedPaid = currentTotalReceived + newPaymentAmount;
    const netPaid = newTotalConfirmedPaid - totalAlreadyRefunded;
    
    const diff = netPaid - amountDue;
    let pStatus: "paid" | "partially_paid" | "overpaid" | "waived" | "pending" | "refund_due" | "refunded" = regData.paymentStatus || "pending";

    if (netPaid === 0 && (amountDue === 0 || financeRemarks.toLowerCase().includes("waiv"))) {
      pStatus = "waived";
    } else if (netPaid === 0 && amountDue > 0) {
      pStatus = "pending";
    } else if (Math.abs(diff) < 0.0001) {
      pStatus = "paid";
    } else if (diff < 0) {
      pStatus = "partially_paid";
    } else {
      pStatus = "overpaid";
    }

    const balanceDue = Math.max(0, amountDue - netPaid);
    const refundDue = Math.max(0, netPaid - amountDue);

    const eventShort = selectedEventId.slice(-6).toUpperCase();
    const memberShort = (regData.primaryMemberGmkId || registrationId.slice(-6)).toUpperCase();
    const receiptNumber = regData.receiptNumber || `RCP-${eventShort}-${memberShort}-${Math.floor(1000 + Math.random() * 9000)}`;
    
    // Only generate an entry pass if payment is cleared or waived, and it doesn't already exist
    let entryPassNumber = regData.entryPassNumber || "";
    if ((pStatus === "paid" || pStatus === "waived" || pStatus === "overpaid") && !entryPassNumber) {
        entryPassNumber = `PASS-${eventShort}-${memberShort}`;
    }

    const paymentUpdates: any = {
      paymentStatus: pStatus,
      amountDue: amountDue,
      amountReceived: newTotalConfirmedPaid,
      balanceDue: balanceDue,
      refundDue: refundDue,
      financeRemarks: financeRemarks,
      paymentProcessedAt: nowIso,
      paymentProcessedBy: uid, // Use UID as requested instead of email for better canonical tracking
    };

    if (receiptNumber) paymentUpdates["receiptNumber"] = receiptNumber;
    if (entryPassNumber) paymentUpdates["entryPassNumber"] = entryPassNumber;

    transaction.update(regRef, paymentUpdates);

    // Record Audit Log atomically
    const auditId = `audit_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const auditRef = db.collection("auditLogs").doc(auditId);
    const auditPayload = {
      id: auditId,
      action: "RECORD_PAYMENT",
      operation: "PAYMENT_RECORDED",
      actorEmail: callerEmail,
      performedByUid: uid,
      processedBy: uid,
      processedAt: nowIso,
      timestamp: nowIso,
      targetId: registrationId,
      registrationId: registrationId,
      eventId: selectedEventId,
      gmkId: regData.primaryMemberGmkId || regData.gmkId || "",
      amountDue: amountDue,
      amountReceived: newTotalConfirmedPaid,
      newPaymentAmount: newPaymentAmount,
      balanceDue: balanceDue,
      refundDue: refundDue,
      paymentStatus: pStatus,
      receiptNumber: receiptNumber,
      entryPassNumber: entryPassNumber,
      remarks: financeRemarks,
      details: `Payment recorded via processEventPayment: Status=${pStatus}, Due=${amountDue.toFixed(3)}, New Payment=${newPaymentAmount.toFixed(3)}, Total Received=${newTotalConfirmedPaid.toFixed(3)}`
    };

    transaction.set(auditRef, auditPayload);

    resultPayload = {
      success: true,
      registrationId: registrationId,
      paymentStatus: pStatus,
      amountDue: amountDue,
      amountReceived: newTotalConfirmedPaid,
      newPaymentAmount: newPaymentAmount,
      balanceDue: balanceDue,
      refundDue: refundDue,
      receiptNumber: receiptNumber,
      entryPassNumber: entryPassNumber,
      processedAt: nowIso
    };
  });

  logger.info(`[processEventPayment] Payment processed successfully for regId: ${registrationId} by UID: ${uid}`);
  return resultPayload;
});

/**
 * Callable HTTPS Cloud Function to securely process and record Event Registration Refunds.
 */
export const processEventRefund = onCall({ cors: true }, async (request: any) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication is required to process refunds.");
  }
  
  const uid = request.auth.uid;
  const callerEmail = (request.auth.token?.email || "").toLowerCase().trim();
  
  const registrationId = request.data?.registrationId;
  const financeRemarks = (request.data?.financeRemarks || "").toString().trim();
  const settlementMethod = (request.data?.settlementMethod || "").toString().trim();
  const settlementReference = (request.data?.settlementReference || "").toString().trim();

  if (!registrationId || typeof registrationId !== "string") {
    throw new HttpsError("invalid-argument", "Registration ID parameter is required.");
  }

  const regRef = db.collection("event_registrations").doc(registrationId);
  const nowIso = new Date().toISOString();
  let resultPayload: any = null;

  logger.info(`[processEventRefund] Attempting refund for regId: ${registrationId} by UID: ${uid}`);

  await db.runTransaction(async (transaction) => {
    const regSnap = await transaction.get(regRef);
    if (!regSnap.exists) {
      throw new HttpsError("not-found", `Event registration '${registrationId}' was not found.`);
    }

    const regData = regSnap.data()!;
    const selectedEventId = regData.eventId;
    
    if (!selectedEventId) {
      throw new HttpsError("failed-precondition", "Registration record is missing an eventId.");
    }

    // Validate Finance / Admin Authorization for this specific event
    const authorized = await isAuthorizedForPayment(uid, callerEmail, selectedEventId);
    if (!authorized) {
      logger.warn(`[processEventRefund] Authorization denied for UID: ${uid}, Email: ${callerEmail}, Event: ${selectedEventId}`);
      throw new HttpsError("permission-denied", "Unauthorized. Only authorized Event Directors or Finance team members can process refunds.");
    }

    let amountDue = 0;
    if (typeof regData.amountDue === "number") {
      amountDue = regData.amountDue;
    } else if (typeof regData.paymentAmount === "number") {
      amountDue = regData.paymentAmount;
    } else if (regData.paymentSummary && typeof regData.paymentSummary.totalAmount === "number") {
      amountDue = regData.paymentSummary.totalAmount;
    } else if (regData.amountDue) {
      amountDue = parseFloat(regData.amountDue) || 0;
    }

    const currentTotalReceived = parseFloat(regData.amountReceived) || 0;
    const totalAlreadyRefunded = parseFloat(regData.refundedAmount) || 0;
    const netPaid = currentTotalReceived - totalAlreadyRefunded;
    
    const refundAmt = Math.max(0, netPaid - amountDue);

    if (refundAmt <= 0) {
      throw new HttpsError("failed-precondition", "No refund is due for this registration.");
    }

    const newRefundedAmount = totalAlreadyRefunded + refundAmt;

    let pStatus = regData.paymentStatus === 'cancelled' ? 'refunded' : (amountDue > 0 ? 'paid' : 'refunded');

    const paymentUpdates: any = {
      paymentStatus: pStatus,
      refundDue: 0,
      refundedAmount: newRefundedAmount,
      refundedAt: nowIso,
      refundedBy: uid,
      settlementMethod: settlementMethod,
      settlementReference: settlementReference,
      financeRemarks: financeRemarks,
      updatedAt: nowIso
    };

    transaction.update(regRef, paymentUpdates);

    // Record Audit Log atomically
    const auditId = `audit_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const auditRef = db.collection("auditLogs").doc(auditId);
    const auditPayload = {
      id: auditId,
      action: "PROCESS_REFUND",
      operation: "REFUND_PROCESSED",
      actorEmail: callerEmail,
      performedByUid: uid,
      processedBy: uid,
      processedAt: nowIso,
      timestamp: nowIso,
      targetId: registrationId,
      registrationId: registrationId,
      eventId: selectedEventId,
      gmkId: regData.primaryMemberGmkId || regData.gmkId || "",
      amountDue: amountDue,
      amountReceived: currentTotalReceived,
      refundedAmount: refundAmt,
      totalRefundedAmount: newRefundedAmount,
      paymentStatus: pStatus,
      remarks: financeRemarks,
      details: `Refund recorded via processEventRefund: Status=${pStatus}, Due=${amountDue.toFixed(3)}, Refund=${refundAmt.toFixed(3)}`
    };

    transaction.set(auditRef, auditPayload);

    resultPayload = {
      success: true,
      registrationId: registrationId,
      paymentStatus: pStatus,
      refundedAmount: refundAmt,
      totalRefundedAmount: newRefundedAmount
    };
  });

  logger.info(`[processEventRefund] Refund processed successfully for regId: ${registrationId} by UID: ${uid}`);
  return resultPayload;
});


import { onDocumentUpdated } from "firebase-functions/v2/firestore";

/**
 * Automates WhatsApp Entry Pass delivery when an Event Registration gets approved (paid/waived).
 * Checks idempotency state on the document to ensure no duplicates.
 */

function formatPhoneForWhatsApp(phone: string | undefined | null, fallbackCode = '968'): string {
  if (!phone) return '';
  const trimmed = phone.trim();
  
  // If already starts with '+', format cleanly
  if (trimmed.startsWith('+')) {
    const knownCodes = ['+968', '+971', '+966', '+965', '+974', '+973', '+91', '+44', '+1'];
    for (const code of knownCodes) {
      if (trimmed.startsWith(code)) {
        const rest = trimmed.substring(code.length).replace(/\D/g, '');
        return `${code.substring(1)}${rest}`;
      }
    }
    // Generic '+' code: match up to 4 digits prefix
    const match = trimmed.match(/^(\+\d{1,4})\s*(.*)$/);
    if (match) {
      const rest = match[2].replace(/\D/g, '');
      return `${match[1].substring(1)}${rest}`;
    }
  }

  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';

  // Check if digits already include country code prefix
  if (digits.startsWith('968') && digits.length === 11) return digits;
  if (digits.startsWith('91') && digits.length === 12) return digits;
  if (digits.startsWith('971') && digits.length === 12) return digits;

  // 10 digits starting with 6,7,8,9 -> India (+91)
  if (digits.length === 10 && ['6', '7', '8', '9'].includes(digits[0])) return `91${digits}`;
  // 8 digits -> Oman (+968)
  if (digits.length === 8) return `968${digits}`;

  return `${fallbackCode.replace('+', '')}${digits}`;
}

async function getAuthoritativeWhatsAppNumber(regData: any): Promise<string> {
  let rawPhone = String(regData.primaryRegistrantWhatsapp || regData.whatsappNumber || regData.primaryRegistrantPhone || regData.phone || "");
  
  if (!rawPhone && regData.familyId) {
    try {
      const famSnap = await db.collection("families").doc(regData.familyId).get();
      if (famSnap.exists) {
        const famData = famSnap.data()!;
        rawPhone = String(famData.whatsAppNumber || famData.phone || "");
      }
    } catch (e) {
      logger.error("Error fetching family for phone resolution", e);
    }
  }
  
  return formatPhoneForWhatsApp(rawPhone);
}

export const processAutomaticWhatsAppEntryPass = onDocumentUpdated({
  document: "event_registrations/{registrationId}",
  secrets: [metaWhatsAppToken, metaPhoneNumberId]
}, async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after) return;
  
  const pStatus = String(after.paymentStatus || "").toLowerCase().trim();
  const wStatus = String(after.workflowStatus || "").toLowerCase().trim();
  const status = String(after.status || "").toLowerCase().trim();

  // Strict Eligibility Checks:
  // Must be paid/waived/overpaid
  // Must have an entry pass number generated
  // Must NOT be cancelled or refunded across any status field
  const isEligible = (pStatus === "paid" || pStatus === "waived" || pStatus === "overpaid") 
    && !!after.entryPassNumber 
    && status !== "cancelled" 
    && status !== "refunded"
    && wStatus !== "cancelled"
    && wStatus !== "refunded";

  if (!isEligible) return;

  const currentWhatsAppStatus = after.entryPassWhatsAppLastStatus;
  
  // Idempotency Check: Do NOT resend if it was already attempted or if it's currently pending.
  if (currentWhatsAppStatus === "sent" || currentWhatsAppStatus === "delivered" || currentWhatsAppStatus === "read" || currentWhatsAppStatus === "failed" || currentWhatsAppStatus === "pending" || currentWhatsAppStatus === "not_eligible") {
    return;
  }

  const regRef = db.collection("event_registrations").doc(event.params.registrationId);

  // Extract phone number - prioritizing whatsapp fields, then mobile
  const normalizedPhone = await getAuthoritativeWhatsAppNumber(after);

  if (!normalizedPhone || normalizedPhone.length < 8) {
    logger.info(`[WhatsApp Auto] No valid phone number for registration ${event.params.registrationId}`);
    await regRef.update({
      entryPassWhatsAppLastStatus: "not_eligible",
      entryPassWhatsAppLastError: "No valid WhatsApp number found."
    });
    return;
  }

  // Atomically claim the pending state
  await regRef.update({ entryPassWhatsAppLastStatus: "pending" });

  try {
    const token = metaWhatsAppToken.value();
    const phoneId = metaPhoneNumberId.value();

    if (!token || !phoneId) {
      throw new Error("Missing Meta WhatsApp configuration secrets.");
    }

    let eventName = "GMK Event";
    let venueName = "GMK Venue";

    if (after.eventId) {
      const eventDoc = await db.collection("events").doc(after.eventId).get();
      if (eventDoc.exists) {
        const evData = eventDoc.data()!;
        eventName = evData.title || evData.eventName || eventName;
        venueName = evData.venue || evData.location || venueName;
      }
    }

    let residentName = "";
    let gmkId = String(after.primaryMemberGmkId || after.publicReference || "").trim();
    if (after.familyId) {
      const famSnap = await db.collection("families").doc(after.familyId).get();
      if (famSnap.exists) {
        residentName = famSnap.data()?.fullName || "";
        gmkId = gmkId || String(famSnap.data()?.primaryMemberGmkId || "").trim();
      }
    }
    residentName = residentName || after.primaryRegistrantName || after.fullName || (after.primaryMemberEmail ? after.primaryMemberEmail.split('@')[0] : "") || "Resident";
    
    if (gmkId && /^\d+G?$/i.test(gmkId)) {
      gmkId = `GMK-${gmkId.replace(/G$/i, '')}`;
    } else if (gmkId && !gmkId.toUpperCase().startsWith("GMK-") && !gmkId.toUpperCase().startsWith("EXT-")) {
      gmkId = `GMK-${gmkId}`;
    }
    const displayName = gmkId ? `${residentName} (${gmkId.toUpperCase()})` : residentName;
    const entryPass = after.entryPassNumber;
    const qrCodeUrl = `https://quickchart.io/qr?size=500&text=${encodeURIComponent(entryPass)}`;

    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: normalizedPhone,
      type: "template",
      template: {
        name: "gmk_entry_pass_ready",
        language: { code: "en" },
        components: [
          {
            type: "header",
            parameters: [
              {
                type: "image",
                image: { link: qrCodeUrl }
              }
            ]
          },
          {
            type: "body",
            parameters: [
              { type: "text", text: displayName },
              { type: "text", text: eventName }
            ]
          }
        ]
      }
    };

    const response = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (response.ok) {
      logger.info(`[WhatsApp Auto] Successfully sent entry pass to ${normalizedPhone} for reg: ${event.params.registrationId}`);
      await regRef.update({
        entryPassWhatsAppLastStatus: "sent",
        entryPassWhatsAppSentAt: new Date().toISOString(),
        entryPassWhatsAppMessageId: data.messages?.[0]?.id || "",
        entryPassWhatsAppRecipient: normalizedPhone,
        entryPassWhatsAppLastError: null
      });
    } else {
      logger.error(`[WhatsApp Auto] Meta API error for reg: ${event.params.registrationId}`, data);
      await regRef.update({
        entryPassWhatsAppLastStatus: "failed",
        entryPassWhatsAppLastError: data.error?.message || "Meta API Error"
      });
    }
  } catch (err: any) {
    logger.error(`[WhatsApp Auto] Exception sending to ${normalizedPhone}:`, err);
    await regRef.update({
      entryPassWhatsAppLastStatus: "failed",
      entryPassWhatsAppLastError: err.message || "Internal Server Error"
    });
  }
});


/**
 * Manual Callable Function to resend the WhatsApp Entry Pass.
 * Intended for operational recovery from the Attendance Workspace.
 */
export const resendWhatsAppEntryPass = onCall({
  cors: true,
  secrets: [metaWhatsAppToken, metaPhoneNumberId]
}, async (request: any) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  
  const registrationId = request.data?.registrationId;
  if (!registrationId) {
    throw new HttpsError("invalid-argument", "registrationId is required.");
  }

  const token = metaWhatsAppToken.value();
  const phoneId = metaPhoneNumberId.value();

  if (!token || !phoneId) {
    throw new HttpsError("failed-precondition", "WhatsApp API is not configured on the server.");
  }

  const regRef = db.collection("event_registrations").doc(registrationId);
  const regSnap = await regRef.get();
  
  if (!regSnap.exists) {
    throw new HttpsError("not-found", "Registration not found.");
  }
  
  const regData = regSnap.data()!;
  
  const normalizedPhone = await getAuthoritativeWhatsAppNumber(regData);

  if (!normalizedPhone || normalizedPhone.length < 8) {
    throw new HttpsError("invalid-argument", "No valid phone number exists on this registration.");
  }
  
  if (!regData.entryPassNumber) {
    throw new HttpsError("failed-precondition", "Entry Pass has not been generated for this registration yet.");
  }

  let eventName = "GMK Event";
  let venueName = "GMK Venue";

  if (regData.eventId) {
    const eventDoc = await db.collection("events").doc(regData.eventId).get();
    if (eventDoc.exists) {
      const evData = eventDoc.data()!;
      eventName = evData.title || evData.eventName || eventName;
      venueName = evData.venue || evData.location || venueName;
    }
  }

  let residentName = "";
  let gmkId = String(regData.primaryMemberGmkId || regData.publicReference || "").trim();
  if (regData.familyId) {
    const famSnap = await db.collection("families").doc(regData.familyId).get();
    if (famSnap.exists) {
      residentName = famSnap.data()?.fullName || "";
      gmkId = gmkId || String(famSnap.data()?.primaryMemberGmkId || "").trim();
    }
  }
  residentName = residentName || regData.primaryRegistrantName || regData.fullName || (regData.primaryMemberEmail ? regData.primaryMemberEmail.split('@')[0] : "") || "Resident";
  
  if (gmkId && /^\d+G?$/i.test(gmkId)) {
    gmkId = `GMK-${gmkId.replace(/G$/i, '')}`;
  } else if (gmkId && !gmkId.toUpperCase().startsWith("GMK-") && !gmkId.toUpperCase().startsWith("EXT-")) {
    gmkId = `GMK-${gmkId}`;
  }
  const displayName = gmkId ? `${residentName} (${gmkId.toUpperCase()})` : residentName;
  const entryPass = regData.entryPassNumber;
  const qrCodeUrl = `https://quickchart.io/qr?size=500&text=${encodeURIComponent(entryPass)}`;

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: normalizedPhone,
    type: "template",
    template: {
      name: "gmk_entry_pass_ready",
      language: { code: "en" },
      components: [
        {
          type: "header",
          parameters: [
            {
              type: "image",
              image: { link: qrCodeUrl }
            }
          ]
        },
        {
          type: "body",
          parameters: [
            { type: "text", text: displayName },
            { type: "text", text: eventName }
          ]
        }
      ]
    }
  };

  try {
    const response = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (response.ok) {
      logger.info(`[WhatsApp Manual] Successfully resent entry pass to ${normalizedPhone}`);
      await regRef.update({
        entryPassWhatsAppLastStatus: "sent",
        entryPassWhatsAppSentAt: new Date().toISOString(),
        entryPassWhatsAppMessageId: data.messages?.[0]?.id || "",
        entryPassWhatsAppRecipient: normalizedPhone,
        entryPassWhatsAppLastError: null
      });
      return { success: true };
    } else {
      logger.error(`[WhatsApp Manual] Meta API error`, data);
      await regRef.update({
        entryPassWhatsAppLastStatus: "failed",
        entryPassWhatsAppLastError: data.error?.message || "Meta API Error"
      });
      throw new HttpsError("internal", data.error?.message || "Meta API Error");
    }
  } catch (err: any) {
    if (err instanceof HttpsError) throw err;
    logger.error(`[WhatsApp Manual] Exception`, err);
    throw new HttpsError("internal", err.message || "Failed to send WhatsApp message.");
  }
});

/**
 * Validates a scanner PIN securely and returns minimum necessary scanner identity.
 * Rejects with appropriate error if PIN is invalid or inactive.
 */
export const resolveScannerPin = onCall({ cors: true }, async (request: any) => {
  const pin = request.data.pin;
  if (!pin || !/^\d{4}$/.test(pin)) {
    throw new HttpsError("invalid-argument", "PIN must be exactly 4 digits");
  }

  const db = getDbInstance();
  
  // Rate limiting for public endpoint (IP-based instead of Auth-based)
  const rawIp = request.rawRequest?.ip || request.rawRequest?.headers?.['x-forwarded-for'] || 'unknown-ip';
  const ipStr = Array.isArray(rawIp) ? rawIp[0] : (typeof rawIp === 'string' ? rawIp.split(',')[0] : 'unknown-ip');
  const safeIp = ipStr.trim().replace(/[^a-zA-Z0-9]/g, '_');
  const attemptRef = db.collection("scannerLoginAttempts").doc(`ip_${safeIp}`);
  
  await db.runTransaction(async (transaction) => {
    const attemptDoc = await transaction.get(attemptRef);
    const now = Date.now();
    let attempts = 0;
    let windowStart = now;

    if (attemptDoc.exists) {
      const data = attemptDoc.data()!;
      if (now - data.windowStart < 5 * 60 * 1000) { // 5 minutes window
        attempts = data.attempts;
        windowStart = data.windowStart;
      }
    }

    if (attempts >= 10) {
      throw new HttpsError("resource-exhausted", "Too many failed attempts. Please try again later.");
    }

    transaction.set(attemptRef, {
      attempts: attempts + 1,
      windowStart
    });
  });

  const committeesSnap = await db.collection("eventCommittees").get();
  
  let inactiveMatchFound = false;

  for (const docSnap of committeesSnap.docs) {
    const committee = docSnap.data();
    const scanners = committee.scanners || [];
    
    // Check if matching PIN is in active scanner
    const activeMatch = scanners.find((s: any) => s.pin === pin && s.isActive);
    if (activeMatch) {
      // Clear attempts on success
      await attemptRef.delete();
      return {
        scannerId: activeMatch.id,
        scannerName: activeMatch.name,
        eventId: activeMatch.eventId
      };
    }
    
    const inactiveMatch = scanners.find((s: any) => s.pin === pin && !s.isActive);
    if (inactiveMatch) {
      inactiveMatchFound = true;
    }
  }

  if (inactiveMatchFound) {
    throw new HttpsError("failed-precondition", "SCANNER INACTIVE");
  }

  throw new HttpsError("not-found", "INVALID SCANNER PIN");
});


export const sendWhatsAppNotification = onCall({
  cors: true,
  invoker: "public",
  secrets: [metaWhatsAppToken, metaPhoneNumberId]
}, async (request: any) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required");
  }

  const { to, templateName, templateData = {}, components, dryRun = false } = request.data;

  if (!to || !templateName) {
    throw new HttpsError("invalid-argument", "Missing required fields");
  }

  const token = metaWhatsAppToken.value();
  let phoneId = "";
  try {
    phoneId = metaPhoneNumberId.value();
  } catch (e) {
    // Ignore and fallback
  }
  
  if (!phoneId) {
    phoneId = "1302067342984705";
  }

  if (!token) {
    throw new HttpsError("failed-precondition", "Missing WhatsApp token");
  }

  let normalizedPhone = String(to).replace(/\D/g, "");
  if (normalizedPhone.startsWith("00")) {
    normalizedPhone = normalizedPhone.substring(2);
  }
  
  if (normalizedPhone.length === 8) {
    normalizedPhone = "968" + normalizedPhone;
  } else if (normalizedPhone.length === 10 && /^[6789]/.test(normalizedPhone)) {
    normalizedPhone = "91" + normalizedPhone;
  } else if (normalizedPhone.length === 9 && normalizedPhone.startsWith("5")) {
    normalizedPhone = "971" + normalizedPhone;
  }

  let finalComponents = components;

  if (!finalComponents) {
    if (templateName === "gmk_entry_pass_ready") {
      const headerParams: any[] = [];
      if (templateData.headerMediaId) {
        headerParams.push({
          type: "image",
          image: { id: templateData.headerMediaId }
        });
      } else if (templateData.headerImageUrl) {
        headerParams.push({
          type: "image",
          image: { link: templateData.headerImageUrl }
        });
      }

      finalComponents = [];
      if (headerParams.length > 0) {
        finalComponents.push({
          type: "header",
          parameters: headerParams
        });
      }

      finalComponents.push({
        type: "body",
        parameters: [
          { type: "text", text: String(templateData.recipientName || templateData.primaryRegistrantName || "Community Member") },
          { type: "text", text: String(templateData.eventName || "Community Gathering") },
          { type: "text", text: String(templateData.entryPassNumber || "PASS-PENDING") }
        ]
      });
    } else if (templateName === "gmk_external_registration_update") {
      finalComponents = [
        {
          type: "body",
          parameters: [
            { type: "text", text: String(templateData.recipientName || templateData.primaryRegistrantName || "") },
            { type: "text", text: String(templateData.eventName || "") },
            { type: "text", text: String(templateData.referenceId || templateData.publicReference || templateData.registrationId || "") }
          ]
        }
      ];
    } else if (templateName === "gmk_registration_confirmed") {
      finalComponents = [
        {
          type: "body",
          parameters: [
            { type: "text", text: String(templateData.recipientName || templateData.primaryRegistrantName || "") },
            { type: "text", text: String(templateData.eventName || "") }
          ]
        }
      ];
    } else {
      const bodyParams = Object.keys(templateData).map(key => ({
        type: "text",
        text: String(templateData[key])
      }));
      if (bodyParams.length > 0) {
        finalComponents = [
          {
            type: "body",
            parameters: bodyParams
          }
        ];
      }
    }
  }

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: normalizedPhone,
    type: "template",
    template: {
      name: templateName,
      language: { code: "en" },
      components: finalComponents
    }
  };

  if (dryRun) {
    return {
      success: true,
      dryRun: true,
      messageId: `dry_run_msg_${Date.now()}`,
      simulatedPayload: payload
    };
  }

  try {
    const response = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      logger.error(`[WhatsApp Error] Meta Graph API rejected the request for ${normalizedPhone}`, data);
      throw new HttpsError("internal", `WhatsApp API error: ${data.error?.message || 'Unknown error'}`);
    }

    return { 
      success: true, 
      messageId: data.messages?.[0]?.id || "unknown" 
    };
  } catch (error: any) {
    logger.error(`[WhatsApp Error] Fetch exception for ${normalizedPhone}:`, error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "Failed to communicate with WhatsApp API.");
  }
});

/**
 * Transactionally enforces global PIN uniqueness across all event committees
 */
export const manageScannerPin = onCall({ cors: true }, async (request: any) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required");
  }

  const { committeeId, scanner, action } = request.data;
  // action: 'create' | 'edit' | 'toggle'
  
  if (!committeeId || !scanner || !scanner.pin) {
    throw new HttpsError("invalid-argument", "Missing required fields");
  }
  
  if (!/^\d{4}$/.test(scanner.pin)) {
    throw new HttpsError("invalid-argument", "PIN must be exactly 4 digits");
  }

  const db = getDbInstance();

  await db.runTransaction(async (transaction) => {
    // 1. Get all committees to check global uniqueness
    const committeesSnap = await transaction.get(db.collection("eventCommittees"));
    
    let pinInUseBy = null;
    let targetCommitteeDoc = null;
    
    for (const doc of committeesSnap.docs) {
      if (doc.id === committeeId) targetCommitteeDoc = doc;
      
      const commScanners = doc.data().scanners || [];
      const match = commScanners.find((s: any) => 
        s.pin === scanner.pin && 
        // We check against all records, not just active ones, for strict global uniqueness as requested:
        // "If the PIN already exists anywhere, reject it... across ALL scanner records."
        s.id !== scanner.id // exclude self
      );
      
      if (match) {
        pinInUseBy = match.name;
        break;
      }
    }
    
    if (pinInUseBy) {
      throw new HttpsError("already-exists", `This PIN is already in use by ${pinInUseBy}. Please choose another PIN.`);
    }
    
    if (!targetCommitteeDoc) {
      throw new HttpsError("not-found", "Committee not found");
    }
    
    const currentScanners = targetCommitteeDoc.data().scanners || [];
    let updatedScanners = [];
    
    if (action === 'create') {
      updatedScanners = [...currentScanners, scanner];
    } else if (action === 'edit' || action === 'toggle') {
      const exists = currentScanners.some((s: any) => s.id === scanner.id);
      if (!exists) throw new HttpsError("not-found", "Scanner not found in this committee");
      
      updatedScanners = currentScanners.map((s: any) => 
        s.id === scanner.id ? { ...s, ...scanner } : s
      );
    } else {
      throw new HttpsError("invalid-argument", "Invalid action");
    }
    
    transaction.update(targetCommitteeDoc.ref, { scanners: updatedScanners });
  });

  return { success: true };
});
