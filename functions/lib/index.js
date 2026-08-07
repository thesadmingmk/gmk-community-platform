"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processEmailQueue = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const params_1 = require("firebase-functions/params");
const app_1 = require("firebase-admin/app");
const firestore_2 = require("firebase-admin/firestore");
const firebase_functions_1 = require("firebase-functions");
const nodemailer = require("nodemailer");
const template_1 = require("./utils/template");
// Define the custom Firestore Database ID for this environment
const FIRESTORE_DATABASE_ID = "ai-studio-7d23ee96-a783-4875-9630-4390202b70b9";
// Initialize Firebase Admin SDK pointing to the custom Firestore database
(0, app_1.initializeApp)();
const db = (0, firestore_2.getFirestore)(FIRESTORE_DATABASE_ID);
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
        const finalSubject = (0, template_1.replacePlaceholders)(subjectPattern, placeholders);
        const finalHtml = (0, template_1.replacePlaceholders)(htmlPattern, placeholders);
        const finalText = (0, template_1.replacePlaceholders)(textPattern, placeholders);
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
        firebase_functions_1.logger.info(`[Queue: ${queueId}] Dispatching SMTP message to: ${data.to}`);
        // Send email securely
        const sendInfo = await transporter.sendMail(mailOptions);
        const duration = Date.now() - startTime;
        firebase_functions_1.logger.info(`[Queue: ${queueId}] Dispatch success! Message ID: ${sendInfo.messageId}. Duration: ${duration}ms`);
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
//# sourceMappingURL=index.js.map