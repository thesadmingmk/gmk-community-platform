"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processEventRefund = exports.processEventPayment = exports.requestPasswordReset = exports.processEmailQueue = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const app_1 = require("firebase-admin/app");
const firestore_2 = require("firebase-admin/firestore");
const auth_1 = require("firebase-admin/auth");
const firebase_functions_1 = require("firebase-functions");
const nodemailer = require("nodemailer");
const template_1 = require("./utils/template");
// Define the custom Firestore Database ID for this environment
const FIRESTORE_DATABASE_ID = "ai-studio-7d23ee96-a783-4875-9630-4390202b70b9";
// Lazy-initialized Firestore instance to avoid blocking global scope during deployment discovery
let _db = null;
function getDbInstance() {
    if (!_db) {
        if ((0, app_1.getApps)().length === 0) {
            (0, app_1.initializeApp)();
        }
        _db = (0, firestore_2.getFirestore)(FIRESTORE_DATABASE_ID);
    }
    return _db;
}
const db = new Proxy({}, {
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
const gmkSmtpUser = (0, params_1.defineSecret)("GMK_SMTP_USER");
const gmkSmtpPassword = (0, params_1.defineSecret)("GMK_SMTP_PASSWORD");
/**
 * Firestore trigger that watches new document additions in the emailQueue collection.
 * Processes pending notification documents automatically and manages retries securely.
 */
exports.processEmailQueue = (0, firestore_1.onDocumentCreated)({
    document: "emailQueue/{queueId}",
    database: FIRESTORE_DATABASE_ID,
    secrets: [gmkSmtpUser, gmkSmtpPassword]
}, async (event) => {
    const startTime = Date.now();
    const queueId = event.params.queueId;
    // Retrieve document snapshot
    const snapshot = event.data;
    if (!snapshot) {
        firebase_functions_1.logger.info(`[Queue: ${queueId}] No snapshot data available. Returning.`);
        return;
    }
    // Fetch the actual, live document from the named Firestore database instance
    // to bypass any Eventarc deserialization/database-alignment issues in Gen 2 triggers.
    const docRef = db.collection("emailQueue").doc(queueId);
    const liveSnapshot = await docRef.get();
    if (!liveSnapshot.exists) {
        firebase_functions_1.logger.info(`[Queue: ${queueId}] Document does not exist in named Firestore database. Returning.`);
        return;
    }
    const data = liveSnapshot.data();
    if (!data) {
        firebase_functions_1.logger.info(`[Queue: ${queueId}] Document has no body data. Returning.`);
        return;
    }
    // Enhanced debug logging to inspect the complete payload and identify field names/mismatches
    firebase_functions_1.logger.info(`[Queue: ${queueId}] Raw payload keys: ${Object.keys(data).join(", ")}, status: ${data.status}`);
    const recipient = data.to || "Unknown";
    const templateName = data.template || "None";
    const notificationType = data.notificationType || "GENERIC";
    // 1. Check if the queue document is marked as isTemplate
    if (data.isTemplate === true) {
        firebase_functions_1.logger.info(`[Queue: ${queueId}] isTemplate == true. Reference template document. Skipping.`);
        return;
    }
    // 2. Check if status is pending
    if (data.status !== "pending") {
        firebase_functions_1.logger.info(`[Queue: ${queueId}] Status is '${data.status}' (not pending). Skipping processing.`);
        return;
    }
    // 3. Check attempts threshold
    const currentAttempts = data.attempts || 0;
    if (currentAttempts >= 3) {
        firebase_functions_1.logger.warn(`[Queue: ${queueId}] Maximum retry attempts reached (${currentAttempts}/3). Marking status as failed.`);
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
        firebase_functions_1.logger.error(`[Queue: ${queueId}] Firebase Secrets 'GMK_SMTP_USER' or 'GMK_SMTP_PASSWORD' are undefined or unconfigured.`);
        await docRef.update({
            status: "failed",
            error: "SMTP Secret credentials configuration missing on environment.",
            processedAt: new Date().toISOString(),
            attempts: currentAttempts + 1
        });
        return;
    }
    try {
        firebase_functions_1.logger.info(`[Queue: ${queueId}] Initiating processing for recipient: ${recipient}, template: ${templateName}, notificationType: ${notificationType}`);
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
        const placeholders = {
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
        const finalSubject = (0, template_1.replacePlaceholders)(subjectPattern, placeholders, true);
        let finalHtml = (0, template_1.replacePlaceholders)(htmlPattern, placeholders, true);
        const finalText = (0, template_1.replacePlaceholders)(textPattern, placeholders, true);
        // Handle inline QR code attachment (RFC standard CID embedding)
        const attachments = [];
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
        const mailOptions = {
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
        firebase_functions_1.logger.info(`[Queue: ${queueId}] Dispatching SMTP message to: ${data.to}`);
        // Send email securely
        const sendInfo = await transporter.sendMail(mailOptions);
        const duration = Date.now() - startTime;
        firebase_functions_1.logger.info(`[Queue: ${queueId}] Dispatch success! Message ID: ${sendInfo.messageId}. Duration: ${duration}ms`);
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
                }
                catch (auditErr) {
                    firebase_functions_1.logger.warn(`[Queue: ${queueId}] Non-blocking warning: failed to update eventAttendance sentAt:`, auditErr);
                }
            }
            if (targetRegistrationId) {
                try {
                    await db.collection("event_registrations").doc(targetRegistrationId).set({
                        completionEmailSentAt: sentIso,
                        familyCompletionEmailSent: true
                    }, { merge: true });
                }
                catch (auditErr) {
                    firebase_functions_1.logger.warn(`[Queue: ${queueId}] Non-blocking warning: failed to update event_registrations sentAt:`, auditErr);
                }
            }
        }
    }
    catch (error) {
        const duration = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : String(error);
        firebase_functions_1.logger.error(`[Queue: ${queueId}] Error occurred during dispatch. Duration: ${duration}ms. Error: ${errorMessage}`);
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
exports.requestPasswordReset = (0, https_1.onCall)({}, async (request) => {
    const email = request.data?.email?.toLowerCase().trim();
    if (!email) {
        throw new https_1.HttpsError("invalid-argument", "Email parameter is required.");
    }
    // Define operational metadata to be saved or returned
    let residentName = "Resident";
    let resetLink = "";
    try {
        // 1. Securely generate Firebase password reset link using admin Auth SDK
        resetLink = await (0, auth_1.getAuth)().generatePasswordResetLink(email);
        // 2. Fetch the resident's or user's full name to personalize the email template
        const residentSnap = await db.collection("residents")
            .where("email", "==", email)
            .limit(1)
            .get();
        if (!residentSnap.empty) {
            residentName = residentSnap.docs[0].data().fullName || "Resident";
        }
        else {
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
        firebase_functions_1.logger.info(`[PasswordReset] Successfully generated link and enqueued mail queue item ${queueDocRef.id} for email: ${email}`);
    }
    catch (err) {
        // If the error indicates user not found, swallow the error and log it internally.
        // This strictly prevents account enumeration/disclosure security issues.
        if (err.code === "auth/user-not-found") {
            firebase_functions_1.logger.info(`[PasswordReset] Silent fallback: requested password reset for unregistered or un-activated email address: ${email}`);
        }
        else {
            firebase_functions_1.logger.error(`[PasswordReset] Critical failure generating password reset link for email ${email}:`, err);
            throw new https_1.HttpsError("internal", "An error occurred while initiating your password reset. Please try again later.");
        }
    }
    // Secure identical response to the caller regardless of existence
    return { success: true };
});
/**
 * Helper function to verify Finance Committee / Administrator authorization
 */
async function isAuthorizedForPayment(uid, email, eventId) {
    const normEmail = (email || "").toLowerCase().trim();
    if (normEmail === "thesadmingmk@gmail.com" || normEmail === "theadmingmk@gmail.com") {
        return true;
    }
    if (uid) {
        try {
            const uDoc = await db.collection("users").doc(uid).get();
            if (uDoc.exists) {
                const uData = uDoc.data();
                const roles = Array.isArray(uData?.roles) ? uData.roles : [];
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
        }
        catch (err) {
            firebase_functions_1.logger.warn(`[isAuthorizedForPayment] Error reading users/${uid}:`, err);
        }
    }
    return false;
}
/**
 * Callable HTTPS Cloud Function to securely process and record Event Registration Payments.
 * Bypasses client-side Firestore rules via Admin SDK, ensuring atomic payment updates and audit logging.
 */
exports.processEventPayment = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Authentication is required to process event payments.");
    }
    const uid = request.auth.uid;
    const callerEmail = (request.auth.token?.email || "").toLowerCase().trim();
    const registrationId = request.data?.registrationId;
    const amountReceivedInput = request.data?.amountReceived;
    const financeRemarks = (request.data?.financeRemarks || "").toString().trim();
    if (!registrationId || typeof registrationId !== "string") {
        throw new https_1.HttpsError("invalid-argument", "Registration ID parameter is required.");
    }
    const newPaymentAmount = parseFloat(amountReceivedInput);
    if (isNaN(newPaymentAmount) || newPaymentAmount <= 0) {
        throw new https_1.HttpsError("invalid-argument", "Valid positive amountReceived parameter is required.");
    }
    const regRef = db.collection("event_registrations").doc(registrationId);
    const nowIso = new Date().toISOString();
    let resultPayload = null;
    firebase_functions_1.logger.info(`[processEventPayment] Attempting payment for regId: ${registrationId} by UID: ${uid}`);
    await db.runTransaction(async (transaction) => {
        const regSnap = await transaction.get(regRef);
        if (!regSnap.exists) {
            throw new https_1.HttpsError("not-found", `Event registration '${registrationId}' was not found.`);
        }
        const regData = regSnap.data();
        const selectedEventId = regData.eventId;
        if (!selectedEventId) {
            throw new https_1.HttpsError("failed-precondition", "Registration record is missing an eventId.");
        }
        // Validate Finance / Admin Authorization for this specific event
        const authorized = await isAuthorizedForPayment(uid, callerEmail, selectedEventId);
        if (!authorized) {
            firebase_functions_1.logger.warn(`[processEventPayment] Authorization denied for UID: ${uid}, Email: ${callerEmail}, Event: ${selectedEventId}`);
            throw new https_1.HttpsError("permission-denied", "Unauthorized. Only authorized Event Directors or Finance team members can process payments.");
        }
        // Obtain authoritative amountDue server-side
        let amountDue = 0;
        if (typeof regData.amountDue === "number") {
            amountDue = regData.amountDue;
        }
        else if (typeof regData.paymentAmount === "number") {
            amountDue = regData.paymentAmount;
        }
        else if (regData.paymentSummary && typeof regData.paymentSummary.totalAmount === "number") {
            amountDue = regData.paymentSummary.totalAmount;
        }
        else if (regData.amountDue) {
            amountDue = parseFloat(regData.amountDue) || 0;
        }
        const currentTotalReceived = parseFloat(regData.amountReceived) || 0;
        const totalAlreadyRefunded = parseFloat(regData.refundedAmount) || 0;
        const newTotalConfirmedPaid = currentTotalReceived + newPaymentAmount;
        const netPaid = newTotalConfirmedPaid - totalAlreadyRefunded;
        const diff = netPaid - amountDue;
        let pStatus = regData.paymentStatus || "pending";
        if (netPaid === 0 && (amountDue === 0 || financeRemarks.toLowerCase().includes("waiv"))) {
            pStatus = "waived";
        }
        else if (netPaid === 0 && amountDue > 0) {
            pStatus = "pending";
        }
        else if (Math.abs(diff) < 0.0001) {
            pStatus = "paid";
        }
        else if (diff < 0) {
            pStatus = "partially_paid";
        }
        else {
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
        const paymentUpdates = {
            paymentStatus: pStatus,
            amountDue: amountDue,
            amountReceived: newTotalConfirmedPaid,
            balanceDue: balanceDue,
            refundDue: refundDue,
            financeRemarks: financeRemarks,
            paymentProcessedAt: nowIso,
            paymentProcessedBy: uid, // Use UID as requested instead of email for better canonical tracking
        };
        if (receiptNumber)
            paymentUpdates["receiptNumber"] = receiptNumber;
        if (entryPassNumber)
            paymentUpdates["entryPassNumber"] = entryPassNumber;
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
    firebase_functions_1.logger.info(`[processEventPayment] Payment processed successfully for regId: ${registrationId} by UID: ${uid}`);
    return resultPayload;
});
/**
 * Callable HTTPS Cloud Function to securely process and record Event Registration Refunds.
 */
exports.processEventRefund = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Authentication is required to process refunds.");
    }
    const uid = request.auth.uid;
    const callerEmail = (request.auth.token?.email || "").toLowerCase().trim();
    const registrationId = request.data?.registrationId;
    const financeRemarks = (request.data?.financeRemarks || "").toString().trim();
    const settlementMethod = (request.data?.settlementMethod || "").toString().trim();
    const settlementReference = (request.data?.settlementReference || "").toString().trim();
    if (!registrationId || typeof registrationId !== "string") {
        throw new https_1.HttpsError("invalid-argument", "Registration ID parameter is required.");
    }
    const regRef = db.collection("event_registrations").doc(registrationId);
    const nowIso = new Date().toISOString();
    let resultPayload = null;
    firebase_functions_1.logger.info(`[processEventRefund] Attempting refund for regId: ${registrationId} by UID: ${uid}`);
    await db.runTransaction(async (transaction) => {
        const regSnap = await transaction.get(regRef);
        if (!regSnap.exists) {
            throw new https_1.HttpsError("not-found", `Event registration '${registrationId}' was not found.`);
        }
        const regData = regSnap.data();
        const selectedEventId = regData.eventId;
        if (!selectedEventId) {
            throw new https_1.HttpsError("failed-precondition", "Registration record is missing an eventId.");
        }
        // Validate Finance / Admin Authorization for this specific event
        const authorized = await isAuthorizedForPayment(uid, callerEmail, selectedEventId);
        if (!authorized) {
            firebase_functions_1.logger.warn(`[processEventRefund] Authorization denied for UID: ${uid}, Email: ${callerEmail}, Event: ${selectedEventId}`);
            throw new https_1.HttpsError("permission-denied", "Unauthorized. Only authorized Event Directors or Finance team members can process refunds.");
        }
        let amountDue = 0;
        if (typeof regData.amountDue === "number") {
            amountDue = regData.amountDue;
        }
        else if (typeof regData.paymentAmount === "number") {
            amountDue = regData.paymentAmount;
        }
        else if (regData.paymentSummary && typeof regData.paymentSummary.totalAmount === "number") {
            amountDue = regData.paymentSummary.totalAmount;
        }
        else if (regData.amountDue) {
            amountDue = parseFloat(regData.amountDue) || 0;
        }
        const currentTotalReceived = parseFloat(regData.amountReceived) || 0;
        const totalAlreadyRefunded = parseFloat(regData.refundedAmount) || 0;
        const netPaid = currentTotalReceived - totalAlreadyRefunded;
        const refundAmt = Math.max(0, netPaid - amountDue);
        if (refundAmt <= 0) {
            throw new https_1.HttpsError("failed-precondition", "No refund is due for this registration.");
        }
        const newRefundedAmount = totalAlreadyRefunded + refundAmt;
        let pStatus = regData.paymentStatus === 'cancelled' ? 'refunded' : (amountDue > 0 ? 'paid' : 'refunded');
        const paymentUpdates = {
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
    firebase_functions_1.logger.info(`[processEventRefund] Refund processed successfully for regId: ${registrationId} by UID: ${uid}`);
    return resultPayload;
});
//# sourceMappingURL=index.js.map