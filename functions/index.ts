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
    const placeholders = {
      ...(platformSettings || {}),
      ...(data.data || {})
    };

    const subjectPattern = templateData?.subject || "";
    const htmlPattern = templateData?.html || "";
    const textPattern = templateData?.text || "";

    // Perform replacement using reusable template helper
    const finalSubject = replacePlaceholders(subjectPattern, placeholders);
    const finalHtml = replacePlaceholders(htmlPattern, placeholders);
    const finalText = replacePlaceholders(textPattern, placeholders);

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
  database: FIRESTORE_DATABASE_ID
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
