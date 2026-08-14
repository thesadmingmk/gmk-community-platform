"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processEventPayment = exports.requestPasswordReset = exports.processEmailQueue = void 0;
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
    const amountReceived = parseFloat(amountReceivedInput);
    if (isNaN(amountReceived) || amountReceived < 0) {
        throw new https_1.HttpsError("invalid-argument", "Valid non-negative amountReceived parameter is required.");
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
        const diff = amountReceived - amountDue;
        let pStatus = "pending";
        if (amountReceived === 0 && (amountDue === 0 || financeRemarks.toLowerCase().includes("waiv"))) {
            pStatus = "waived";
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
        const balanceDue = Math.max(0, amountDue - amountReceived);
        const refundDue = Math.max(0, amountReceived - amountDue);
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
            amountReceived: amountReceived,
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
            amountReceived: amountReceived,
            balanceDue: balanceDue,
            refundDue: refundDue,
            paymentStatus: pStatus,
            receiptNumber: receiptNumber,
            entryPassNumber: entryPassNumber,
            remarks: financeRemarks,
            details: `Payment recorded via processEventPayment: Status=${pStatus}, Due=${amountDue.toFixed(3)}, Received=${amountReceived.toFixed(3)}`
        };
        transaction.set(auditRef, auditPayload);
        resultPayload = {
            success: true,
            registrationId: registrationId,
            paymentStatus: pStatus,
            amountDue: amountDue,
            amountReceived: amountReceived,
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
//# sourceMappingURL=index.js.map