import React, { createContext, useContext, useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, User } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)'
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);
export const functions = getFunctions(app);
export const storage = getStorage(app);
storage.maxUploadRetryTime = 6000;
storage.maxOperationRetryTime = 6000;

export interface UserProfile {
  uid: string;
  email: string;
  roles: string[];
  isActive: boolean;
  createdAt: string;
  positions?: string[];
  fullName?: string;
  gmkId?: string;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  error: string | null;
  refreshProfile?: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({ 
  user: null, 
  profile: null, 
  loading: true, 
  error: null,
  refreshProfile: async () => {}
});

async function seedDefaultTemplates() {
  try {
    const approvedTemplateRef = doc(db, "emailTemplates", "registration_approved");
    await setDoc(approvedTemplateRef, {
      subject: "GMK Registration Approved - Activate Your Account",
      enabled: true,
      text: `Dear {{residentName}},\n\nWe are pleased to inform you that your registration for {{unit}} has been reviewed and approved by the GMK Administration.\n\nTo securely access the GMK Resident Portal, you must first activate your account and set up your login password.\n\nPlease set up your password by visiting the following activation link:\nhttps://mygmk.me?setup=true\n\nResidential Details:\n- Resident ID: {{gmkId}}\n- Property Unit: {{unit}}\n- Gated Community: Al Hail Greens\n\nOnce you have configured your password, you will be able to securely sign in using your registered email and participate in community events, search professional services, and manage your household profile.\n\nWelcome to our community!\n\nGMK Resident Administration Portal • Al Hail Greens\ntheadmingmk@gmail.com`,
      html: `<div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 12px; background-color: #ffffff;">\n  <div style="text-align: center; padding-bottom: 20px; border-bottom: 2px solid #0F4C2A;">\n    <h1 style="color: #0F4C2A; font-size: 24px; margin: 0; font-family: Georgia, serif;">Al Hail Greens</h1>\n    <p style="color: #D4AF37; font-size: 12px; font-weight: bold; text-transform: uppercase; margin: 5px 0 0 0; letter-spacing: 1px;">GMK Resident Portal</p>\n  </div>\n  <div style="padding: 30px 20px; color: #374151; line-height: 1.6;">\n    <h2 style="color: #0F4C2A; font-size: 20px; margin-top: 0; font-family: Georgia, serif;">Registration Approved!</h2>\n    <p>Dear <strong>{{residentName}}</strong>,</p>\n    <p>We are pleased to inform you that your registration for <strong>{{unit}}</strong> has been reviewed and approved by the GMK Administration.</p>\n    <p>To securely access the GMK Resident Portal, you must first activate your account and set up your login password.</p>\n    <div style="text-align: center; margin: 30px 0;">\n      <a href="https://mygmk.me?setup=true" style="display: inline-block; padding: 12px 28px; background-color: #0F4C2A; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 14px; box-shadow: 0 4px 6px -1px rgba(15, 76, 42, 0.2); transition: background-color 0.2s;">Set Up My Password</a>\n    </div>\n    <div style="background-color: #fefcf3; border-left: 4px solid #D4AF37; padding: 15px; margin: 25px 0; border-radius: 0 8px 8px 0; font-size: 13px;">\n      <p style="margin: 0; font-weight: bold; color: #0F4C2A;">Residential Details:</p>\n      <ul style="margin: 5px 0 0 0; padding-left: 20px; color: #4b5563;">\n        <li><strong>Resident ID:</strong> {{gmkId}}</li>\n        <li><strong>Property Unit:</strong> {{unit}}</li>\n        <li><strong>Gated Community:</strong> Al Hail Greens</li>\n      </ul>\n    </div>\n    <p>Once you have configured your password, you will be able to securely sign in using your registered email and participate in community events, search professional services, and manage your household profile.</p>\n    <p style="margin-bottom: 0;">Welcome to our community!</p>\n  </div>\n  <div style="text-align: center; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #9ca3af; line-height: 1.5;">\n    <p style="margin: 0;">GMK Resident Administration Portal • Al Hail Greens</p>\n    <p style="margin: 5px 0 0 0;">For any support or questions, contact us at <a href="mailto:theadmingmk@gmail.com" style="color: #0F4C2A; text-decoration: underline;">theadmingmk@gmail.com</a></p>\n  </div>\n</div>`
    }, { merge: true });
    console.log("🌱 Default approved email template seeded/updated successfully.");

    const resetTemplateRef = doc(db, "emailTemplates", "password_reset");
    await setDoc(resetTemplateRef, {
      subject: "Reset Your GMK Resident Portal Password",
      enabled: true,
      text: `Dear {{residentName}},\n\nWe received a request to reset the password for your GMK Resident Portal account.\n\nIf you made this request, copy and paste the following link into your browser to reset your password:\n{{resetLink}}\n\nFor your security, this link will expire automatically after the configured Firebase Authentication validity period.\n\nIf you did not request a password reset, no further action is required.\n\nRegards,\nGreens Malayalee Koottayma\nGMK Resident Portal`,
      html: `<div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 12px; background-color: #ffffff;">\n  <div style="text-align: center; padding-bottom: 20px; border-bottom: 2px solid #0F4C2A;">\n    <h1 style="color: #0F4C2A; font-size: 24px; margin: 0; font-family: Georgia, serif;">Al Hail Greens</h1>\n    <p style="color: #D4AF37; font-size: 12px; font-weight: bold; text-transform: uppercase; margin: 5px 0 0 0; letter-spacing: 1px;">GMK Resident Portal</p>\n  </div>\n  <div style="padding: 30px 20px; color: #374151; line-height: 1.6;">\n    <h2 style="color: #0F4C2A; font-size: 20px; margin-top: 0; font-family: Georgia, serif;">Reset Your Password</h2>\n    <p>Dear <strong>{{residentName}}</strong>,</p>\n    <p>We received a request to reset the password for your GMK Resident Portal account.</p>\n    <p>If you made this request, click the button below.</p>\n    <div style="text-align: center; margin: 30px 0;">\n      <a href="{{resetLink}}" style="display: inline-block; padding: 12px 28px; background-color: #0F4C2A; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 14px; box-shadow: 0 4px 6px -1px rgba(15, 76, 42, 0.2); transition: background-color 0.2s;">Reset My Password</a>\n    </div>\n    <p>For your security, this link will expire automatically after the configured Firebase Authentication validity period.</p>\n    <p>If you did not request a password reset, no further action is required.</p>\n    <p style="margin-bottom: 0;">Regards,<br><strong>Greens Malayalee Koottayma</strong><br>GMK Resident Portal</p>\n  </div>\n  <div style="text-align: center; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #9ca3af; line-height: 1.5;">\n    <p style="margin: 0;">GMK Resident Administration Portal • Al Hail Greens</p>\n    <p style="margin: 5px 0 0 0;">For any support or questions, contact us at <a href="mailto:theadmingmk@gmail.com" style="color: #0F4C2A; text-decoration: underline;">theadmingmk@gmail.com</a></p>\n  </div>\n</div>`
    }, { merge: true });
    console.log("🌱 Default password reset email template seeded/updated successfully.");

    const entryPassTemplateRef = doc(db, "emailTemplates", "payment_receipt_entry_pass");
    await setDoc(entryPassTemplateRef, {
      subject: "GMK Official Entry Pass & Payment Confirmed - {{eventName}} ({{gmkId}})",
      enabled: true,
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
    }, { merge: true });
    console.log("🌱 Default entry pass email template seeded/updated successfully.");

    const extApprovedTemplateRef = doc(db, "emailTemplates", "external_registration_approved");
    await setDoc(extApprovedTemplateRef, {
      subject: "GMK Event Registration Approved: Payment Instructions - {{eventName}} ({{gmkId}})",
      enabled: true,
      text: `Dear {{recipientName}},\n\nWe are pleased to inform you that your registration for {{eventName}} has been approved by the Event Administration.\n\nRegistration & Event Details:\n- GMK ID: {{gmkId}}\n- Event Name: {{eventName}}\n- Event Date: {{eventDate}}\n- Event Time: {{eventTime}}\n- Event Venue: {{eventVenue}}\n- Registrant Name: {{recipientName}}\n- Category: {{category}}\n- Total Participants: {{totalParticipants}}\n- Total Amount Due: {{amountDue}} OMR\n\nPayment Instructions:\n{{paymentInstructions}}\n\nPlease complete your payment to finalize your registration. Once your payment is verified by the Event Director, your official Entry Pass and QR code will be issued.\n\nThank you,\nGreens Malayalee Koottayma (GMK)\nAl Hail Greens\ntheadmingmk@gmail.com`,
      html: `<div style="font-family: Arial, Helvetica, sans-serif; max-width: 600px; margin: 0 auto; padding: 0; border: 1px solid #e5e7eb; border-radius: 12px; background-color: #ffffff; overflow: hidden;">
  <div style="background-color: #0F4C2A; padding: 24px 20px; text-align: center; border-bottom: 3px solid #D4AF37;">
    <h1 style="color: #ffffff; font-size: 22px; margin: 0; font-family: Georgia, serif; font-weight: bold; letter-spacing: 0.5px;">Al Hail Greens</h1>
    <p style="color: #F3E5AB; font-size: 11px; font-weight: bold; text-transform: uppercase; margin: 6px 0 0 0; letter-spacing: 1.5px;">Greens Malayalee Koottayma • GMK Community Events</p>
  </div>
  <div style="padding: 28px 24px; color: #374151; font-size: 14px; line-height: 1.6;">
    <h2 style="color: #0F4C2A; font-size: 19px; margin-top: 0; margin-bottom: 16px; font-family: Georgia, serif; font-weight: bold;">Registration Approved — Payment Instructions</h2>
    <p style="margin: 0 0 16px 0;">Dear <strong>{{recipientName}}</strong>,</p>
    <p style="margin: 0 0 20px 0;">We are delighted to confirm that your registration for <strong>{{eventName}}</strong> has been reviewed and approved by the Event Committee.</p>
    
    <div style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin: 20px 0;">
      <h3 style="margin: 0 0 12px 0; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; color: #0F4C2A; font-weight: bold;">Registration & Event Details</h3>
      <table style="width: 100%; font-size: 13px; color: #374151; border-collapse: collapse;">
        <tr><td style="padding: 5px 0; width: 40%; font-weight: bold; color: #4b5563;">Event Name:</td><td style="padding: 5px 0; font-weight: bold;">{{eventName}}</td></tr>
        <tr><td style="padding: 5px 0; font-weight: bold; color: #4b5563;">Event Date:</td><td style="padding: 5px 0;">{{eventDate}}</td></tr>
        <tr><td style="padding: 5px 0; font-weight: bold; color: #4b5563;">Event Time:</td><td style="padding: 5px 0;">{{eventTime}}</td></tr>
        <tr><td style="padding: 5px 0; font-weight: bold; color: #4b5563;">Event Venue:</td><td style="padding: 5px 0;">{{eventVenue}}</td></tr>
        <tr><td style="padding: 5px 0; font-weight: bold; color: #4b5563;">Registrant Name:</td><td style="padding: 5px 0;">{{recipientName}}</td></tr>
        <tr><td style="padding: 5px 0; font-weight: bold; color: #4b5563;">GMK ID:</td><td style="padding: 5px 0; font-family: monospace; font-weight: bold; color: #0F4C2A; font-size: 14px;">{{gmkId}}</td></tr>
        <tr><td style="padding: 5px 0; font-weight: bold; color: #4b5563;">Category:</td><td style="padding: 5px 0;">{{category}}</td></tr>
        <tr><td style="padding: 5px 0; font-weight: bold; color: #4b5563;">Total Participants:</td><td style="padding: 5px 0;">{{totalParticipants}} person(s)</td></tr>
        <tr><td style="padding: 6px 0; font-weight: bold; color: #0F4C2A;">Total Amount Due:</td><td style="padding: 6px 0; font-weight: bold; color: #0F4C2A; font-size: 15px;">{{amountDue}} OMR</td></tr>
      </table>
    </div>

    <div style="background-color: #fefce8; border-left: 4px solid #ca8a04; padding: 16px; margin: 20px 0; border-radius: 0 8px 8px 0; font-size: 13px; line-height: 1.5;">
      <p style="margin: 0 0 6px 0; font-weight: bold; color: #854d0e;">Payment Instructions:</p>
      <p style="margin: 0; color: #713f12; white-space: pre-wrap;">{{paymentInstructions}}</p>
    </div>

    <p style="font-size: 13px; color: #64748b; margin-top: 16px;">Once your payment is completed and verified by the Event Director, your official Entry Pass and digital QR code will be generated and dispatched.</p>
  </div>
  <div style="text-align: center; padding: 20px; background-color: #f9fafb; border-top: 1px solid #e5e7eb; font-size: 11px; color: #6b7280; line-height: 1.5;">
    <p style="margin: 0; font-weight: bold; color: #374151;">Greens Malayalee Koottayma (GMK) • Al Hail Greens</p>
    <p style="margin: 4px 0 0 0;">For inquiries or assistance, please contact <a href="mailto:theadmingmk@gmail.com" style="color: #0F4C2A; text-decoration: underline;">theadmingmk@gmail.com</a></p>
  </div>
</div>`
    }, { merge: true });
    console.log("🌱 Default external registration approved email template seeded/updated successfully.");

    const extReceivedTemplateRef = doc(db, "emailTemplates", "external_registration_received");
    await setDoc(extReceivedTemplateRef, {
      subject: "GMK Event Registration Received - {{eventName}} ({{gmkId}})",
      enabled: true,
      text: `Dear {{recipientName}},\n\nThank you for submitting your external registration for {{eventName}}.\n\nRegistration & Event Details:\n- GMK ID: {{gmkId}}\n- Event Name: {{eventName}}\n- Event Date: {{eventDate}}\n- Event Time: {{eventTime}}\n- Event Venue: {{eventVenue}}\n- Registrant Name: {{recipientName}}\n- Category: {{category}}\n- Total Participants: {{totalParticipants}}\n\nYour registration is currently under administrative review. Once approved, you will receive payment instructions and subsequent Entry Pass issuance.\n\nThank you,\nGreens Malayalee Koottayma (GMK)\nAl Hail Greens\ntheadmingmk@gmail.com`,
      html: `<div style="font-family: Arial, Helvetica, sans-serif; max-width: 600px; margin: 0 auto; padding: 0; border: 1px solid #e5e7eb; border-radius: 12px; background-color: #ffffff; overflow: hidden;">
  <div style="background-color: #0F4C2A; padding: 24px 20px; text-align: center; border-bottom: 3px solid #D4AF37;">
    <h1 style="color: #ffffff; font-size: 22px; margin: 0; font-family: Georgia, serif; font-weight: bold; letter-spacing: 0.5px;">Al Hail Greens</h1>
    <p style="color: #F3E5AB; font-size: 11px; font-weight: bold; text-transform: uppercase; margin: 6px 0 0 0; letter-spacing: 1.5px;">Greens Malayalee Koottayma • GMK Community Events</p>
  </div>
  <div style="padding: 28px 24px; color: #374151; font-size: 14px; line-height: 1.6;">
    <h2 style="color: #0F4C2A; font-size: 19px; margin-top: 0; margin-bottom: 16px; font-family: Georgia, serif; font-weight: bold;">Registration Received — Under Review</h2>
    <p style="margin: 0 0 16px 0;">Dear <strong>{{recipientName}}</strong>,</p>
    <p style="margin: 0 0 20px 0;">Thank you for registering for <strong>{{eventName}}</strong>. Your registration details have been received and logged in our system.</p>
    
    <div style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin: 20px 0;">
      <h3 style="margin: 0 0 12px 0; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; color: #0F4C2A; font-weight: bold;">Registration & Event Details</h3>
      <table style="width: 100%; font-size: 13px; color: #374151; border-collapse: collapse;">
        <tr><td style="padding: 5px 0; width: 40%; font-weight: bold; color: #4b5563;">Event Name:</td><td style="padding: 5px 0; font-weight: bold;">{{eventName}}</td></tr>
        <tr><td style="padding: 5px 0; font-weight: bold; color: #4b5563;">Event Date:</td><td style="padding: 5px 0;">{{eventDate}}</td></tr>
        <tr><td style="padding: 5px 0; font-weight: bold; color: #4b5563;">Event Time:</td><td style="padding: 5px 0;">{{eventTime}}</td></tr>
        <tr><td style="padding: 5px 0; font-weight: bold; color: #4b5563;">Event Venue:</td><td style="padding: 5px 0;">{{eventVenue}}</td></tr>
        <tr><td style="padding: 5px 0; font-weight: bold; color: #4b5563;">Registrant Name:</td><td style="padding: 5px 0;">{{recipientName}}</td></tr>
        <tr><td style="padding: 5px 0; font-weight: bold; color: #4b5563;">GMK ID:</td><td style="padding: 5px 0; font-family: monospace; font-weight: bold; color: #0F4C2A; font-size: 14px;">{{gmkId}}</td></tr>
        <tr><td style="padding: 5px 0; font-weight: bold; color: #4b5563;">Category:</td><td style="padding: 5px 0;">{{category}}</td></tr>
        <tr><td style="padding: 5px 0; font-weight: bold; color: #4b5563;">Total Participants:</td><td style="padding: 5px 0;">{{totalParticipants}} person(s)</td></tr>
      </table>
    </div>

    <div style="background-color: #f0fdf4; border-left: 4px solid #16a34a; padding: 16px; margin: 20px 0; border-radius: 0 8px 8px 0; font-size: 13px; line-height: 1.5;">
      <p style="margin: 0 0 4px 0; font-weight: bold; color: #166534;">Next Steps:</p>
      <p style="margin: 0; color: #14532d;">Our Event Committee is reviewing registrations. You will receive an email update with payment details once your registration is approved.</p>
    </div>
  </div>
  <div style="text-align: center; padding: 20px; background-color: #f9fafb; border-top: 1px solid #e5e7eb; font-size: 11px; color: #6b7280; line-height: 1.5;">
    <p style="margin: 0; font-weight: bold; color: #374151;">Greens Malayalee Koottayma (GMK) • Al Hail Greens</p>
    <p style="margin: 4px 0 0 0;">For inquiries or assistance, please contact <a href="mailto:theadmingmk@gmail.com" style="color: #0F4C2A; text-decoration: underline;">theadmingmk@gmail.com</a></p>
  </div>
</div>`
    }, { merge: true });

    const extRejectedTemplateRef = doc(db, "emailTemplates", "external_registration_rejected");
    await setDoc(extRejectedTemplateRef, {
      subject: "GMK Event Registration Update - {{eventName}} ({{gmkId}})",
      enabled: true,
      text: `Dear {{recipientName}},\n\nThank you for your interest in {{eventName}}.\n\nWe regret to inform you that your registration could not be accepted at this time.\n\nRegistration Details:\n- GMK ID: {{gmkId}}\n- Event Name: {{eventName}}\n- Category: {{category}}\n- Reason: {{reason}}\n\nThank you for your understanding,\nGreens Malayalee Koottayma (GMK)\nAl Hail Greens\ntheadmingmk@gmail.com`,
      html: `<div style="font-family: Arial, Helvetica, sans-serif; max-width: 600px; margin: 0 auto; padding: 0; border: 1px solid #e5e7eb; border-radius: 12px; background-color: #ffffff; overflow: hidden;">
  <div style="background-color: #0F4C2A; padding: 24px 20px; text-align: center; border-bottom: 3px solid #D4AF37;">
    <h1 style="color: #ffffff; font-size: 22px; margin: 0; font-family: Georgia, serif; font-weight: bold; letter-spacing: 0.5px;">Al Hail Greens</h1>
    <p style="color: #F3E5AB; font-size: 11px; font-weight: bold; text-transform: uppercase; margin: 6px 0 0 0; letter-spacing: 1.5px;">Greens Malayalee Koottayma • GMK Community Events</p>
  </div>
  <div style="padding: 28px 24px; color: #374151; font-size: 14px; line-height: 1.6;">
    <h2 style="color: #991b1b; font-size: 19px; margin-top: 0; margin-bottom: 16px; font-family: Georgia, serif; font-weight: bold;">Registration Update</h2>
    <p style="margin: 0 0 16px 0;">Dear <strong>{{recipientName}}</strong>,</p>
    <p style="margin: 0 0 20px 0;">Thank you for your interest in attending <strong>{{eventName}}</strong>. Following review, we regret to inform you that we are unable to confirm your registration for this event.</p>
    
    <div style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin: 20px 0;">
      <h3 style="margin: 0 0 12px 0; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; color: #0F4C2A; font-weight: bold;">Registration Details</h3>
      <table style="width: 100%; font-size: 13px; color: #374151; border-collapse: collapse;">
        <tr><td style="padding: 5px 0; width: 40%; font-weight: bold; color: #4b5563;">Event Name:</td><td style="padding: 5px 0; font-weight: bold;">{{eventName}}</td></tr>
        <tr><td style="padding: 5px 0; font-weight: bold; color: #4b5563;">Event Date:</td><td style="padding: 5px 0;">{{eventDate}}</td></tr>
        <tr><td style="padding: 5px 0; font-weight: bold; color: #4b5563;">Registrant Name:</td><td style="padding: 5px 0;">{{recipientName}}</td></tr>
        <tr><td style="padding: 5px 0; font-weight: bold; color: #4b5563;">GMK ID:</td><td style="padding: 5px 0; font-family: monospace; font-weight: bold; color: #0F4C2A; font-size: 14px;">{{gmkId}}</td></tr>
        <tr><td style="padding: 5px 0; font-weight: bold; color: #4b5563;">Category:</td><td style="padding: 5px 0;">{{category}}</td></tr>
      </table>
    </div>

    <div style="background-color: #fff1f2; border-left: 4px solid #f43f5e; padding: 16px; margin: 20px 0; border-radius: 0 8px 8px 0; font-size: 13px; line-height: 1.5;">
      <p style="margin: 0 0 4px 0; font-weight: bold; color: #9f1239;">Administrative Remarks:</p>
      <p style="margin: 0; color: #881337;">{{reason}}</p>
    </div>

    <p style="font-size: 13px; color: #64748b; margin-top: 16px;">If you have already submitted any advance payments, GMK Finance will process your refund according to community financial guidelines.</p>
  </div>
  <div style="text-align: center; padding: 20px; background-color: #f9fafb; border-top: 1px solid #e5e7eb; font-size: 11px; color: #6b7280; line-height: 1.5;">
    <p style="margin: 0; font-weight: bold; color: #374151;">Greens Malayalee Koottayma (GMK) • Al Hail Greens</p>
    <p style="margin: 4px 0 0 0;">For inquiries or assistance, please contact <a href="mailto:theadmingmk@gmail.com" style="color: #0F4C2A; text-decoration: underline;">theadmingmk@gmail.com</a></p>
  </div>
</div>`
    }, { merge: true });

    const extRefundTemplateRef = doc(db, "emailTemplates", "external_registration_refund_confirmed");
    await setDoc(extRefundTemplateRef, {
      subject: "GMK Registration Refund Settled - {{eventName}} ({{gmkId}})",
      enabled: true,
      text: `Dear {{recipientName}},\n\nYour registration refund for {{eventName}} has been processed and settled by GMK Finance.\n\nRefund Details:\n- GMK ID: {{gmkId}}\n- Event Name: {{eventName}}\n- Registrant Name: {{recipientName}}\n- Category: {{category}}\n- Refund Amount: {{refundAmount}} OMR\n- Settlement Method: {{settlementMethod}}\n- Settlement Reference: {{settlementReference}}\n- Remarks: {{financeRemarks}}\n\nThank you,\nGreens Malayalee Koottayma (GMK) Finance\nAl Hail Greens\ntheadmingmk@gmail.com`,
      html: `<div style="font-family: Arial, Helvetica, sans-serif; max-width: 600px; margin: 0 auto; padding: 0; border: 1px solid #e5e7eb; border-radius: 12px; background-color: #ffffff; overflow: hidden;">
  <div style="background-color: #0F4C2A; padding: 24px 20px; text-align: center; border-bottom: 3px solid #D4AF37;">
    <h1 style="color: #ffffff; font-size: 22px; margin: 0; font-family: Georgia, serif; font-weight: bold; letter-spacing: 0.5px;">Al Hail Greens</h1>
    <p style="color: #F3E5AB; font-size: 11px; font-weight: bold; text-transform: uppercase; margin: 6px 0 0 0; letter-spacing: 1.5px;">Greens Malayalee Koottayma • GMK Community Events</p>
  </div>
  <div style="padding: 28px 24px; color: #374151; font-size: 14px; line-height: 1.6;">
    <h2 style="color: #0F4C2A; font-size: 19px; margin-top: 0; margin-bottom: 16px; font-family: Georgia, serif; font-weight: bold;">Refund Settlement Confirmation</h2>
    <p style="margin: 0 0 16px 0;">Dear <strong>{{recipientName}}</strong>,</p>
    <p style="margin: 0 0 20px 0;">This confirms that your refund for <strong>{{eventName}}</strong> has been processed and settled by Greens Malayalee Koottayma Finance.</p>
    
    <div style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin: 20px 0;">
      <h3 style="margin: 0 0 12px 0; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; color: #0F4C2A; font-weight: bold;">Settlement & Event Details</h3>
      <table style="width: 100%; font-size: 13px; color: #374151; border-collapse: collapse;">
        <tr><td style="padding: 5px 0; width: 40%; font-weight: bold; color: #4b5563;">Event Name:</td><td style="padding: 5px 0; font-weight: bold;">{{eventName}}</td></tr>
        <tr><td style="padding: 5px 0; font-weight: bold; color: #4b5563;">Event Date:</td><td style="padding: 5px 0;">{{eventDate}}</td></tr>
        <tr><td style="padding: 5px 0; font-weight: bold; color: #4b5563;">Registrant Name:</td><td style="padding: 5px 0;">{{recipientName}}</td></tr>
        <tr><td style="padding: 5px 0; font-weight: bold; color: #4b5563;">GMK ID:</td><td style="padding: 5px 0; font-family: monospace; font-weight: bold; color: #0F4C2A; font-size: 14px;">{{gmkId}}</td></tr>
        <tr><td style="padding: 5px 0; font-weight: bold; color: #4b5563;">Category:</td><td style="padding: 5px 0;">{{category}}</td></tr>
        <tr><td style="padding: 5px 0; font-weight: bold; color: #4b5563;">Settlement Method:</td><td style="padding: 5px 0;">{{settlementMethod}}</td></tr>
        <tr><td style="padding: 5px 0; font-weight: bold; color: #4b5563;">Settlement Reference:</td><td style="padding: 5px 0; font-family: monospace;">{{settlementReference}}</td></tr>
        <tr><td style="padding: 6px 0; font-weight: bold; color: #0F4C2A;">Net Refund Settled:</td><td style="padding: 6px 0; font-weight: bold; color: #0F4C2A; font-size: 15px;">{{refundAmount}} OMR</td></tr>
      </table>
    </div>

    <div style="background-color: #f0fdf4; border-left: 4px solid #16a34a; padding: 16px; margin: 20px 0; border-radius: 0 8px 8px 0; font-size: 13px; line-height: 1.5;">
      <p style="margin: 0 0 4px 0; font-weight: bold; color: #166534;">Finance Remarks & Audit Notes:</p>
      <p style="margin: 0; color: #14532d;">{{financeRemarks}}</p>
    </div>
  </div>
  <div style="text-align: center; padding: 20px; background-color: #f9fafb; border-top: 1px solid #e5e7eb; font-size: 11px; color: #6b7280; line-height: 1.5;">
    <p style="margin: 0; font-weight: bold; color: #374151;">Greens Malayalee Koottayma (GMK) • Al Hail Greens</p>
    <p style="margin: 4px 0 0 0;">For inquiries or assistance, please contact <a href="mailto:theadmingmk@gmail.com" style="color: #0F4C2A; text-decoration: underline;">theadmingmk@gmail.com</a></p>
  </div>
</div>`
    }, { merge: true });
    console.log("🌱 All 5 GMK External Registration email templates seeded/updated successfully.");

    const familyCheckInTemplateRef = doc(db, "emailTemplates", "family_checkin_completion");
    await setDoc(familyCheckInTemplateRef, {
      subject: "GMK Event Family Check-In Completed - {{eventName}} ({{gmkId}})",
      enabled: true,
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
    }, { merge: true });
    console.log("🌱 Default family check-in completion email template seeded/updated successfully.");
  } catch (err: any) {
    console.warn("⚠️ Non-blocking warning: failed to seed default email template", err.message);
  }
}

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);  

  const loadProfile = async (firebaseUser: User) => {
    const normalizedEmail = firebaseUser.email?.toLowerCase().trim() || "";
    const userDocRef = doc(db, "users", firebaseUser.uid);

    console.log("[RTCO-CONNECTION] PROFILE READ START", firebaseUser.uid);
    console.log("[RTCO-TRANSLOG] OPERATION: loadProfile");
    console.log(`[RTCO-TRANSLOG] PATH: users/${firebaseUser.uid}`);
    console.log(`[RTCO-TRANSLOG] AUTH UID: ${firebaseUser.uid}`);
    console.log(`[RTCO-TRANSLOG] EMAIL: ${normalizedEmail}`);
    console.log(`[RTCO-TRANSLOG] EMAIL VERIFIED: ${firebaseUser.emailVerified}`);

    // Pre-flight guard: Verify auth session is still valid for this specific user UID
    if (!auth.currentUser || auth.currentUser.uid !== firebaseUser.uid) {
      console.log("[RTCO-CONNECTION] AUTH TRANSITION IGNORED", {
        reason: "USER_SIGNED_OUT_DURING_PROFILE_LOAD",
        uid: firebaseUser.uid,
        emailVerified: firebaseUser.emailVerified
      });
      return;
    }

    try {
      console.log(`[RTCO-TRANSLOG] OPERATION: getDoc(users/${firebaseUser.uid})`);
      let userDocSnap;
      try {
        userDocSnap = await getDoc(userDocRef);
        console.log(`[RTCO-TRANSLOG] RESULT: SUCCESS (getDoc users/${firebaseUser.uid})`);
      } catch (docErr: any) {
        console.error(`[RTCO-TRANSLOG] RESULT: FAILED (getDoc users/${firebaseUser.uid})`);
        console.error(`[RTCO-TRANSLOG] ERROR CODE: ${docErr.code}`);
        console.error(`[RTCO-TRANSLOG] ERROR MESSAGE: ${docErr.message}`);
        throw docErr;
      }
      let userProfile: UserProfile | null = null;

      if (userDocSnap.exists()) {
        console.log("✅ Live profile match located in Firestore collection:", userDocSnap.data());
        userProfile = userDocSnap.data() as UserProfile;

        // Self-healing check for Super Admin and Admin emails to guarantee correct roles
        if (normalizedEmail === "thesadmingmk@gmail.com" && (!userProfile.roles || !userProfile.roles.includes("super_admin"))) {
          console.log("🚀 Self-healing Super Admin roles in Firestore...");
          userProfile.roles = ["super_admin"];
          userProfile.isActive = true;
          await setDoc(userDocRef, userProfile, { merge: true });
        } else if (normalizedEmail === "theadmingmk@gmail.com" && (!userProfile.roles || !userProfile.roles.includes("admin"))) {
          console.log("🚀 Self-healing Admin roles in Firestore...");
          userProfile.roles = ["admin"];
          userProfile.isActive = true;
          await setDoc(userDocRef, userProfile, { merge: true });
        }
      } else {
        console.warn("⚠️ Firestore tracking document is empty for this authenticated UID.");
        
        if (normalizedEmail === "thesadmingmk@gmail.com") {
          console.log("🚀 Executing Self-Healing Bootstrapping for Super Admin record...");
          const superAdminPayload: UserProfile = {
            uid: firebaseUser.uid,
            email: normalizedEmail,
            roles: ["super_admin"],
            isActive: true,
            createdAt: new Date().toISOString()
          };
          await setDoc(userDocRef, superAdminPayload);
          console.log("🎯 Super Admin successfully provisioned inside Firestore root!");
          userProfile = superAdminPayload;
        } else if (normalizedEmail === "theadmingmk@gmail.com") {
          console.log("🚀 Executing Self-Healing Bootstrapping for Admin record...");
          const adminPayload: UserProfile = {
            uid: firebaseUser.uid,
            email: normalizedEmail,
            roles: ["admin"],
            isActive: true,
            createdAt: new Date().toISOString()
          };
          await setDoc(userDocRef, adminPayload);
          console.log("🎯 Admin successfully provisioned inside Firestore root!");
          userProfile = adminPayload;
        } else {
          console.log("Creating default user profile mapping during authentication...");
          const defaultResidentPayload: UserProfile = {
            uid: firebaseUser.uid,
            email: normalizedEmail || '',
            roles: ["pending"],
            isActive: false,
            createdAt: new Date().toISOString()
          };
          try {
            console.log(`[RTCO-TRANSLOG] OPERATION: setDoc(users/${firebaseUser.uid}) default payload`);
            await setDoc(userDocRef, defaultResidentPayload);
            console.log(`[RTCO-TRANSLOG] RESULT: SUCCESS (setDoc default payload)`);
          } catch (setErr: any) {
            console.error(`[RTCO-TRANSLOG] RESULT: FAILED (setDoc default payload)`);
            console.error(`[RTCO-TRANSLOG] ERROR CODE: ${setErr.code}`);
            console.error(`[RTCO-TRANSLOG] ERROR MESSAGE: ${setErr.message}`);
            throw setErr;
          }
          userProfile = defaultResidentPayload;
        }
      }

      console.log(`[RTCO-TRANSLOG] USER ROLES: ${JSON.stringify(userProfile?.roles || [])}`);

      // POLYMORPHIC USER AUTHENTICATION HIERARCHY
      if (normalizedEmail) {
        const assignedRoles: string[] = [];
        const positions: string[] = [];
        let hasResidentDoc = false;
        let residentData: any = null;

        try {
          // Check if there is an active resident profile
        try {
          console.log(`[RTCO-CONNECTION] OPERATION: query(getDocs)`);
          console.log(`[RTCO-CONNECTION] PATH: residents where email == ${normalizedEmail}`);
          console.log(`[RTCO-CONNECTION] UID: ${firebaseUser.uid}`);
          const resQuery = query(collection(db, "residents"), where("email", "==", normalizedEmail));
          const resSnap = await getDocs(resQuery);
          console.log(`[RTCO-CONNECTION] RESULT: SUCCESS (residents)`);
          hasResidentDoc = !resSnap.empty;
          if (hasResidentDoc) {
            residentData = resSnap.docs[0].data();
          }
        } catch (err: any) {
          console.error(`[RTCO-CONNECTION] RESULT: FAILED`);
          console.error(`[RTCO-CONNECTION] ERROR CODE: ${err.code || 'UNKNOWN'}`);
          console.error(`[RTCO-CONNECTION] ERROR MESSAGE: ${err.message || String(err)}`);
          console.warn("⚠️ Non-blocking warning: residents query failed", err.message);
        }

        
          // 1. Query governanceAssignments collection
          console.log(`[RTCO-CONNECTION] OPERATION: query(getDocs)`);
          console.log(`[RTCO-CONNECTION] PATH: governanceAssignments where email == ${normalizedEmail}`);
          console.log(`[RTCO-CONNECTION] UID: ${firebaseUser.uid}`);
          const govQuery = query(collection(db, "governanceAssignments"), where("email", "==", normalizedEmail));
          const govSnap = await getDocs(govQuery);
          console.log(`[RTCO-CONNECTION] RESULT: SUCCESS (governanceAssignments)`);
          govSnap.forEach((govDoc) => {
            const data = govDoc.data();
            if (data) {
              const pos = (data.position || data.role || '').toLowerCase();
              if (pos === 'admin') {
                assignedRoles.push('admin');
              } else if (pos) {
                positions.push(pos);
                if (pos === 'committee_lead' && (data.committeeType || data.committee)) {
                  let cType = String(data.committeeType || data.committee).toLowerCase().replace(/\s+/g, '_').replace(/&/g, 'and');
                  if (cType === 'events_and_programs' || cType === 'programs' || cType === 'events_&_programs') cType = 'program';
                  positions.push(`committee_lead_${cType}`);
                  if (data.eventId) {
                    positions.push(`committee_lead_${cType}_${data.eventId}`);
                  }
                } else if (pos === 'program_lead' && data.eventId) {
                  positions.push(`program_lead_${data.eventId}`);
                }
              }
            }
          });

          // 2. Query legacy roleAssignments for perfect backward-compatible fallback
          console.log(`[RTCO-CONNECTION] OPERATION: query(getDocs)`);
          console.log(`[RTCO-CONNECTION] PATH: roleAssignments where email == ${normalizedEmail}`);
          console.log(`[RTCO-CONNECTION] UID: ${firebaseUser.uid}`);
          const rolesQuery = query(collection(db, "roleAssignments"), where("email", "==", normalizedEmail));
          const rolesSnap = await getDocs(rolesQuery);
          console.log(`[RTCO-CONNECTION] RESULT: SUCCESS (roleAssignments by email)`);
          
          let rolesDocs = [...rolesSnap.docs];
          
          if (hasResidentDoc && residentData && residentData.gmkId) {
            const rolesGmkQuery = query(collection(db, "roleAssignments"), where("gmkId", "==", residentData.gmkId.toUpperCase()));
            const rolesGmkSnap = await getDocs(rolesGmkQuery);
            console.log(`[RTCO-CONNECTION] RESULT: SUCCESS (roleAssignments by gmkId)`);
            rolesGmkSnap.forEach(doc => {
              if (!rolesDocs.find(d => d.id === doc.id)) {
                rolesDocs.push(doc);
              }
            });
          }
          
          rolesDocs.forEach((roleDoc) => {
            const data = roleDoc.data();
            if (data) {
              const pos = (data.position || data.role || '').toLowerCase();
              if (pos === 'admin') {
                assignedRoles.push('admin');
              } else if (pos) {
                positions.push(pos);
                if (pos === 'committee_lead' && (data.committeeType || data.committee)) {
                  let cType = String(data.committeeType || data.committee).toLowerCase().replace(/\s+/g, '_').replace(/&/g, 'and');
                  if (cType === 'events_and_programs' || cType === 'programs' || cType === 'events_&_programs') cType = 'program';
                  positions.push(`committee_lead_${cType}`);
                  if (data.eventId) {
                    positions.push(`committee_lead_${cType}_${data.eventId}`);
                  }
                } else if (pos === 'program_lead' && data.eventId) {
                  positions.push(`program_lead_${data.eventId}`);
                }
              }
            }
          });
        } catch (err: any) {
          console.error(`[RTCO-CONNECTION] RESULT: FAILED`);
          console.error(`[RTCO-CONNECTION] ERROR CODE: ${err.code || 'UNKNOWN'}`);
          console.error(`[RTCO-CONNECTION] ERROR MESSAGE: ${err.message || String(err)}`);
          console.warn("⚠️ Non-blocking warning: governance role/position query failed", err.message);
        }

        // Check if there is a pending registration
        let isPending = false;
        try {
          console.log(`[RTCO-CONNECTION] OPERATION: query(getDocs)`);
          console.log(`[RTCO-CONNECTION] PATH: pending_registrations where email == ${normalizedEmail}`);
          console.log(`[RTCO-CONNECTION] UID: ${firebaseUser.uid}`);
          const pendingQuery = query(collection(db, "pending_registrations"), where("email", "==", normalizedEmail));
          const pendingSnap = await getDocs(pendingQuery);
          console.log(`[RTCO-CONNECTION] RESULT: SUCCESS (pending_registrations)`);
          isPending = !pendingSnap.empty;
        } catch (err: any) {
          console.error(`[RTCO-CONNECTION] RESULT: FAILED`);
          console.error(`[RTCO-CONNECTION] ERROR CODE: ${err.code || 'UNKNOWN'}`);
          console.error(`[RTCO-CONNECTION] ERROR MESSAGE: ${err.message || String(err)}`);
          console.warn("⚠️ Non-blocking warning: pending_registrations query failed", err.message);
        }

        if (userProfile) {
          let finalRoles = [...userProfile.roles];
          
          const isFullyRegistered = hasResidentDoc && residentData && residentData.status === 'active';

          // If the user matches a pending registration and is not fully registered, force 'pending' state
          if (isPending && !isFullyRegistered) {
            console.log("⏳ User email matches a pending registration. Blocking active session authorization.");
            userProfile = {
              ...userProfile,
              roles: ["pending"],
              isActive: false,
              positions: []
            };
          } else {
            // Otherwise, compile their roles
            if (isFullyRegistered) {
              finalRoles.push('resident');
              finalRoles = finalRoles.filter(role => role !== 'pending');
            }
            
            finalRoles = [...finalRoles, ...assignedRoles, ...positions];
            if (positions.includes('vp')) {
              finalRoles.push('vice_president');
            }
            
            const resolvedGmkId = (hasResidentDoc && residentData && residentData.gmkId) ? residentData.gmkId : (userProfile.gmkId || '');

            userProfile = {
              ...userProfile,
              gmkId: resolvedGmkId,
              email: normalizedEmail,
              roles: Array.from(new Set(finalRoles)),
              positions: Array.from(new Set(positions)),
              isActive: hasResidentDoc ? (residentData.status === 'active') : userProfile.isActive,
              fullName: hasResidentDoc && residentData ? residentData.fullName : userProfile.fullName
            };

            // Sync gmkId & email to users document in Firestore
            try {
              await setDoc(userDocRef, {
                gmkId: resolvedGmkId,
                email: normalizedEmail,
                roles: userProfile.roles,
                isActive: userProfile.isActive
              }, { merge: true });
            } catch (syncErr) {
              console.warn("[AUTH SYNC] Non-blocking user profile sync warning:", syncErr);
            }
          }
        }
      }

      // Post-load guard: verify auth session is still valid for this UID before committing profile
      if (!auth.currentUser || auth.currentUser.uid !== firebaseUser.uid) {
        console.log("[RTCO-CONNECTION] AUTH TRANSITION IGNORED", {
          reason: "USER_SIGNED_OUT_DURING_PROFILE_LOAD",
          uid: firebaseUser.uid,
          emailVerified: firebaseUser.emailVerified
        });
        setProfile(null);
        return;
      }

      console.log("[RTCO-CONNECTION] PROFILE READ SUCCESS", firebaseUser.uid);
      setProfile(userProfile);
      if (userProfile && (userProfile.roles.includes("super_admin") || userProfile.roles.includes("admin"))) {
        seedDefaultTemplates();
      }
    } catch (err: any) {
      const activeUid = auth.currentUser?.uid;
      const isSignedOutOrChanged = !activeUid || activeUid !== firebaseUser.uid;
      const isPermissionDeniedOnUnverifiedOrSignedOut =
        (err.code === "permission-denied" || err.code === "permission_denied") &&
        (!firebaseUser.emailVerified || isSignedOutOrChanged);

      if (isSignedOutOrChanged || isPermissionDeniedOnUnverifiedOrSignedOut) {
        console.log("[RTCO-CONNECTION] AUTH TRANSITION IGNORED", {
          reason: "USER_SIGNED_OUT_DURING_PROFILE_LOAD",
          uid: firebaseUser.uid,
          emailVerified: firebaseUser.emailVerified,
          errorCode: err.code
        });
        console.log("[RTCO-CONNECTION] PROFILE READ FAILED (IGNORED AUTH TRANSITION)");
        setProfile(null);
        return;
      }

      console.log("[RTCO-CONNECTION] PROFILE READ FAILED", firebaseUser.uid, err);
      console.error("[RTCO-TRANSLOG] RESULT: FAILED");
      console.error(`[RTCO-TRANSLOG] ERROR CODE: ${err.code}`);
      console.error(`[RTCO-TRANSLOG] ERROR MESSAGE: ${err.message}`);
      console.error("❌ CRITICAL DATABASE TRANS-LOG EXCEPTION:", err);
      console.error(`Error Code: ${err.code} | Message string: ${err.message}`);
      setError(`${err.code}: ${err.message}`);
      setProfile(null);
    }
  };

  const refreshProfile = async () => {
    if (auth.currentUser) {
      await loadProfile(auth.currentUser);
    }
  };

  useEffect(() => {
    console.log("📡 Initializing Live Core Firebase Connection Engine...");
    console.log(`🎯 Active Target Project ID Reference: ${firebaseConfig.projectId}`);  

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setLoading(true);
      setError(null);
      
      if (firebaseUser) {
        console.log("[RTCO-CONNECTION] AUTH STATE READY", firebaseUser.uid);
        console.log("🔑 Authentication event detected. User email:", firebaseUser.email);
        setUser(firebaseUser);
        await loadProfile(firebaseUser);
        setLoading(false);
      } else {
        setUser(null);
        setProfile(null);
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ user, profile, loading, error, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
