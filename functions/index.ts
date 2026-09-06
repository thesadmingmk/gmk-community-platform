import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { logger } from "firebase-functions";
import * as nodemailer from "nodemailer";
import { replacePlaceholders } from "./utils/template";

// Define the custom Firestore Database ID for this environment
const FIRESTORE_DATABASE_ID = "ai-studio-7d23ee96-a783-4875-9630-4390202b70b9";

// Initialize Firebase Admin SDK pointing to the custom Firestore database
initializeApp();
const db = getFirestore(FIRESTORE_DATABASE_ID);

// Define Gmail SMTP Secrets (stored securely in Google Cloud Secret Manager)
const gmkSmtpUser = defineSecret("GMK_SMTP_USER");
const gmkSmtpPassword = defineSecret("GMK_SMTP_PASSWORD");

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
    const templateDoc = await db.doc(`emailTemplates/${templateName}`).get();
    if (!templateDoc.exists) {
      throw new Error(`Email template 'emailTemplates/${templateName}' does not exist in Firestore.`);
    }

    const templateData = templateDoc.data();
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
    await docRef.update({
      status: "sent",
      deliveryStatus: "accepted",
      processedAt: new Date().toISOString(),
      sentAt: new Date().toISOString(),
      messageId: sendInfo.messageId,
      attempts: currentAttempts + 1,
      error: null
    });

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
export const processEventPayment = onCall(async (request: any) => {
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
export const processEventRefund = onCall(async (request: any) => {
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

// Define WhatsApp Secrets
const whatsappAccessToken = defineSecret("WHATSAPP_ACCESS_TOKEN");
const whatsappPhoneNumberId = defineSecret("WHATSAPP_PHONE_NUMBER_ID");

/**
 * Callable function to send a WhatsApp notification.
 */
export const sendWhatsAppNotification = onCall({
  secrets: [whatsappAccessToken, whatsappPhoneNumberId],
  cors: true,
  invoker: "public"
}, async (request: any) => {
  // Check auth
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "User must be authenticated to send WhatsApp messages.");
  }

  const { to, templateName, templateData = {}, components, dryRun = false } = request.data;
  
  if (!to || !templateName) {
    throw new HttpsError("invalid-argument", "Missing required fields 'to' or 'templateName'.");
  }

  try {
    const token = whatsappAccessToken.value();
    let phoneId;
    try {
      phoneId = whatsappPhoneNumberId.value();
    } catch(err) {
      phoneId = "1302067342984705";
    }
    
    if (!phoneId) {
      phoneId = "1302067342984705";
    }

    if (!token) {
      throw new HttpsError("failed-precondition", "WhatsApp integration is missing required configuration.");
    }

    // Format recipient phone number for Meta WhatsApp API:
    // Strictly pure digits without '+' or '00', preserving international country codes.
    // Example: +91 8589055855 -> 918589055855
    let formattedPhone = to.replace(/[^0-9]/g, '');
    if (formattedPhone.startsWith('00')) {
      formattedPhone = formattedPhone.substring(2);
    }
    // Oman legacy number check: if it's exactly 8 digits, prepend 968
    if (formattedPhone.length === 8) {
      formattedPhone = '968' + formattedPhone;
    }
    // India legacy mobile check: if it's exactly 10 digits starting with 6, 7, 8, or 9, prepend 91
    else if (formattedPhone.length === 10 && ['6', '7', '8', '9'].includes(formattedPhone[0])) {
      formattedPhone = '91' + formattedPhone;
    }
    // UAE legacy check: if it's exactly 9 digits starting with 5, prepend 971
    else if (formattedPhone.length === 9 && formattedPhone.startsWith('5')) {
      formattedPhone = '971' + formattedPhone;
    }

    // Build template components
    let templateComponents: any[] = [];

    if (Array.isArray(components) && components.length > 0) {
      // Direct custom components
      templateComponents = components;
    } else if (templateName === "gmk_entry_pass_ready") {
      // Template #2: Universal Official Entry Pass Ready Notification
      // Header: Optional Image
      if (templateData.headerMediaId) {
        templateComponents.push({
          type: "header",
          parameters: [
            { type: "image", image: { id: templateData.headerMediaId } }
          ]
        });
      } else if (templateData.headerImageUrl) {
        templateComponents.push({
          type: "header",
          parameters: [
            { type: "image", image: { link: templateData.headerImageUrl } }
          ]
        });
      }

      // Body: {{1}} Recipient Name, {{2}} Event Name, {{3}} Entry Pass Number
      templateComponents.push({
        type: "body",
        parameters: [
          { type: "text", text: templateData.recipientName || templateData.primaryRegistrantName || "Community Member" },
          { type: "text", text: templateData.eventName || "Community Gathering" },
          { type: "text", text: templateData.entryPassNumber || "PASS-PENDING" }
        ]
      });
    } else if (templateName === "gmk_external_registration_update") {
      // Template #1: External Registrant Registration Update
      // Category: Marketing
      // Variables:
      // {{1}} = Registrant name
      // {{2}} = Event name
      // {{3}} = Registration Reference ID
      templateComponents = [
        {
          type: "body",
          parameters: [
            { type: "text", text: templateData.recipientName || templateData.primaryRegistrantName || "Community Member" },
            { type: "text", text: templateData.eventName || "Community Event" },
            { type: "text", text: templateData.referenceId || templateData.publicReference || templateData.registrationId || "N/A" }
          ]
        }
      ];
    } else if (templateName === "gmk_registration_confirmed") {
      // Backward compatibility during Meta review transition
      templateComponents = [
        {
          type: "body",
          parameters: [
            { type: "text", text: templateData.recipientName || templateData.primaryRegistrantName || "Community Member" },
            { type: "text", text: templateData.eventName || "Community Event" },
            { type: "text", text: templateData.referenceId || templateData.publicReference || templateData.registrationId || "N/A" }
          ]
        }
      ];
    } else {
      // Generic template fallback
      templateComponents = [
        {
          type: "body",
          parameters: Object.keys(templateData).map((key) => ({
            type: "text",
            text: String(templateData[key])
          }))
        }
      ];
    }

    const payload = {
      messaging_product: "whatsapp",
      to: formattedPhone,
      type: "template",
      template: {
        name: templateName,
        language: { code: "en" },
        components: templateComponents
      }
    };

    // RTCO-090 Safeguard: If dryRun is requested, simulate without calling external Meta API
    if (dryRun) {
      logger.info("[WHATSAPP-DRY-RUN] Simulated message delivery:", {
        to: formattedPhone,
        templateName,
        payload
      });
      return {
        success: true,
        dryRun: true,
        messageId: `dry_run_msg_${Date.now()}`,
        simulatedPayload: payload
      };
    }

    const url = `https://graph.facebook.com/v19.0/${phoneId}/messages`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      logger.error("WhatsApp API Error:", data);
      throw new HttpsError("internal", `WhatsApp API rejected the request: ${data.error?.message || "Unknown error"}`);
    }

    return { success: true, messageId: data.messages?.[0]?.id };
  } catch (error: any) {
    logger.error("sendWhatsAppNotification error:", error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError("internal", error.message || "Failed to send WhatsApp message.");
  }
});
