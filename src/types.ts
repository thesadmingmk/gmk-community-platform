export interface UserProfile {
  uid: string;
  categoryId?: string;
  categoryName?: string;
  email: string;
  roles: string[];
  isActive: boolean;
  createdAt: string;
  positions?: string[];
  fullName?: string;
  gmkId?: string;
}

export interface ResidentProfile {
  gmkId: string;    // GMK-00XXXX
  displayUnitNumber: string; // e.g. "B3-04-72" or "VILLA-72" or "TH-04"
  unitKey: string;           // e.g. "B30472" or "VILLA72" or "TH04"
  phone: string;    // +968XXXXXXXX
  email: string;    // lowercased & sanitized
  fullName: string;
  salutation?: 'Mr' | 'Mrs' | 'Ms' | 'Mstr' | 'Dr';
  unitType?: 'Apartment' | 'Villa' | 'Townhouse';
  status: 'pending' | 'active' | 'archived' | 'deleted';
  gatedCommunity?: string; // e.g. Al Hail Greens
  createdAt: string;
  updatedAt: string;
  remarks?: string;
}

// Decoupled Family Model
export interface Family {
  id: string; // "fam_" + primaryGmkId
  primaryMemberGmkId: string;
  primaryMemberEmail: string;
  salutation: 'Mr' | 'Mrs' | 'Ms' | 'Dr';
  fullName: string;
  phone: string;
  whatsAppNumber: string;
  whatsAppSameAsMobile: boolean;
  unitKey: string;
  displayUnitNumber: string;
  unitType: 'Apartment' | 'Villa' | 'Townhouse';
  professionCategory: string;
  professionTitle: string;
  company: string;
  expertiseCategories?: string[]; // Multiple expertise categories / tags
  contactPreference?: 'Phone' | 'Email' | 'WhatsApp' | 'Any'; // Contact preferences for the community
  directoryConsent: boolean; // default: false
  directoryOption?: 'me' | 'spouse' | 'both' | 'none';
  doctorConsent?: boolean; // default: false
  spouseProfessionCategory?: string;
  spouseProfessionTitle?: string;
  spouseCompany?: string;
  spouseExpertiseCategories?: string[];
  spouseContactPreference?: 'Phone' | 'Email' | 'WhatsApp' | 'Any';
  spouseDoctorConsent?: boolean;
  spouseName?: string;
  spousePhone?: string;
  spouseWhatsApp?: string;
  spouseEmail?: string;
  onboardingCompleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FamilyMember {
  id: string;
  familyId: string; // links to Family
  name: string;
  relationship: 'spouse' | 'child' | 'parent' | 'dependent';
  gender: 'male' | 'female' | '';
  yearOfBirth?: string; // mandatory for children
  notes?: string; // for parent / dependent Optional Notes
  whatsAppNumber?: string; // for spouse
  phone?: string;
  email?: string;
  createdAt: string;
}

export interface PricingRule {
  id: string;
  name: string;
  price: number;
}

export interface CommunityEvent {
  id: string;
  eventCode?: string; // Immutable, automatically generated, independent of Firestore doc ID
  title: string; // Matches displayName for compatibility
  displayName?: string;
  description: string;
  date: string; // Matches startDate for compatibility
  venue: string;
  organizerEmail: string;
  attendees: string[]; // List of user emails or GMK IDs who registered (preserved for compatibility)
  pricingRules?: PricingRule[];
  status?: 'draft' | 'published' | 'registration_open' | 'registration_closed' | 'running' | 'completed' | 'financial_closure_pending' | 'closed' | 'archived';
  logoUrl?: string; // Matches posterUrl
  posterUrl?: string;
  bannerUrl?: string;
  createdAt: string;
  // Extended Event Master fields
  templateId?: string;
  eventType?: string;
  year?: number;
  registrationStart?: string;
  registrationEnd?: string;
  participationStart?: string;
  participationEnd?: string;
  pricing?: EventPricingConfig;
  highlights?: string[];
  createdBy?: string;
  updatedBy?: string;
  updatedAt?: string;
  auditTrail?: Array<{ timestamp: string; action: string; actor: string; details: string }>;
  // Normalized single-source-of-truth fields
  eventName?: string;
  eventYear?: number;
  Poster?: string;
  Thumbnail?: string;
  Venue?: string;
  committeeNeeded?: boolean;
  registrationSettings?: any;
  configurationStatus?: string;
  paymentTransferAccounts?: PaymentAccount[];
  externalRegistrationSettings?: ExternalRegistrationSettings;
}

export interface ExternalRegistrationTypeConfig {
  id: string; // Unique identifier, e.g. "ext_type_1725281234567"
  name: string; // Dynamic name entered by Event Director (e.g. "Team Greens", "Apollo Hospital Staff")
  entryType: 'family' | 'single';
  pricingPolicyRef?: string; // Reference of GMK pricing policy applied for Family
  fixedCostPerParticipant?: number; // Direct fixed amount in OMR for Single (e.g. 5.000)
  isActive?: boolean;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ExternalRegistrationSettings {
  enabled: boolean;
  types: ExternalRegistrationTypeConfig[];
}

export interface PaymentAccount {
  id: string;
  name: string;
  bank: string;
  accountNumber?: string;
  iban: string;
  mobilePhone: string;
  isSaved?: boolean;
}

export interface EventPermission {
  id: string; // perm_${gmkId}_${eventId}
  eventId: string;
  gmkId: string;
  email: string;
  fullName: string;
  permissions: string[]; // e.g. ['finance_view', 'program_coordinator', 'attendance_checker']
  grantedBy: string;
  grantedAt: string;
}

export interface EventTimelineEntry {
  id: string; // time_${eventId}_${timestampOrRandom}
  eventId: string;
  action: string;
  details: string;
  actor: string;
  timestamp: string;
}

export interface EventRegistrationParticipantDetail {
  name: string;
  role: 'primary' | 'spouse' | 'child' | 'parent' | 'other' | 'single';
  yearOfBirth?: string; // Stored for children to compute age brackets (Kids 0-3, 4-9, 10+, Adult)
  age?: number;
  unitNumber?: string;
}


export interface EventRegistrationRefund {
  id: string;
  amount: number;
  date: string;
  refundedBy: string;
  settlementMethod?: string;
  settlementReference?: string;
  remarks?: string;
  status: 'settled' | 'pending';
  registrationId?: string;
  publicReference?: string;
  gmkId?: string;
  registrantName?: string;
  eventId?: string;
  eventName?: string;
  amountPaid?: number;
  refundReason?: string;
  paymentReference?: string;
}

export interface EventRegistration {
  id: string; // reg_${gmkId}_${eventId} or reg_ext_${eventId}_${uniqueKey}
  publicReference?: string; // e.g. GMKG-XXXXXX for external guests
  eventId: string;
  familyId?: string;
  primaryMemberGmkId?: string;
  primaryMemberEmail: string;
  participants: string[]; // List of participating names, e.g. ["Mr. Primary Name", "Mrs. Spouse Name"]
  totalParticipants: number;
  createdAt: string;
  updatedAt: string;
  registrationType?: 'individual' | 'couple' | 'family' | 'single';
  paymentAmount?: number;
  paymentStatus?: 'pending' | 'paid' | 'partially_paid' | 'overpaid' | 'refund_due' | 'waived' | 'approved' | 'cancelled' | 'refunded';
  amountReceived?: number;
  amountDue?: number;
  balanceDue?: number;
  refundDue?: number;
  refundedAmount?: number;
  refundHistory?: EventRegistrationRefund[];
  paymentHistory?: Array<{ amount?: number; status?: string; [key: string]: any }>;
  financeRemarks?: string;
  paymentProcessedAt?: string;
  paymentProcessedBy?: string;
  receiptNumber?: string;
  entryPassNumber?: string;
  paymentSummary?: {
    baseRate: number;
    baseRateApplied: string;
    childrenCount: number;
    halfPriceChildrenCount: number;
    freeChildrenCount: number;
    totalAmount: number;
    details: string;
    parentsCount?: number;
    othersCount?: number;
    externalParticipantsCount?: number;
    externalParticipantRate?: number;
    externalSubtotal?: number;
    includedMembers?: string[];
    parentMembers?: string[];
    pricingPolicyRef?: string;
    timestamp?: string;
  };
  attendanceSummary?: {
    attendedCount: number;
    participantsStatus: Record<string, 'pending' | 'attended' | 'absent'>;
  };
  // RTCO-088 Generic External Event Registrations
  registrationSource?: 'resident' | 'external';
  isExternal?: boolean;
  externalRegistrationTypeId?: string;
  externalRegistrationTypeName?: string; // Dynamic ED-configured name e.g. "Team Greens", "Apollo Hospital Staff"
  category?: string;
  registrationTypeName?: string;
  entryType?: 'family' | 'single';
  primaryRegistrantName?: string;
  primaryRegistrantEmail?: string;
  primaryRegistrantPhone?: string;
  primaryRegistrantWhatsapp?: string;
  phoneCountryCode?: string;
  whatsappCountryCode?: string;
  unitNumber?: string; // Reusable unit number for Single entry type
  participantDetails?: EventRegistrationParticipantDetail[];
  workflowStatus?: 'submitted' | 'admin_review' | 'admin_approved' | 'awaiting_payment' | 'finance_review' | 'payment_confirmed' | 'qr_generated' | 'attended';
  adminReviewStatus?: 'pending' | 'approved' | 'rejected';
  adminReviewedAt?: string;
  adminReviewedBy?: string;
  adminReviewNotes?: string;

  // RTCO-095 Email Delivery Architecture Fields
  approvalEmailSentAt?: string | null;
  approvalEmailRecipient?: string | null;
  entryPassEmailSentAt?: string | null;
  entryPassEmailRecipient?: string | null;
  entryPassEmailSendCount?: number;
  entryPassEmailSource?: string;
  entryPassEmailLastStatus?: string;

  // Family Check-In Completion Email Fields
  completionEmailQueuedAt?: string | null;
  completionEmailSentAt?: string | null;
  completionEmailRecipient?: string | null;
  completionEmailQueueId?: string | null;
  familyCompletionEmailSent?: boolean;
  familyCheckInCompleted?: boolean;
  familyCompletedAt?: string | null;

  // RTCO-098 Operational Cleanup / Archival for External Registrations
  operationalStatus?: 'active' | 'cleaned_up' | 'archived';
  isOperationalCleanedUp?: boolean;
  cleanedUpAt?: string | null;
  cleanedUpBy?: string | null;
  restoredAt?: string | null;
  restoredBy?: string | null;
}

export interface CommunityAnnouncement {
  id: string;
  title: string;
  content: string;
  category: 'Event Notice' | 'Committee Notice' | 'Registration Deadline' | 'Community Update';
  date: string;
  createdAt: string;
}

export interface PendingRegistration {
  uid: string; // auth uid
  salutation: 'Mr' | 'Mrs' | 'Ms' | 'Mstr' | 'Dr';
  fullName: string;
  email: string;
  phone: string;
  unitType: 'Apartment' | 'Villa' | 'Townhouse';
  displayUnitNumber: string; // e.g. "B3-04-72" or "VILLA-72" or "TH-04"
  unitKey: string;           // e.g. "B30472" or "VILLA72" or "TH04"
  gatedCommunity: string;
  createdAt: string;
  status: 'pending';
}

export interface Committee {
  id: string;
  eventId: string;
  name: string;
  members: string[]; // List of resident emails or gmkIds
  createdAt: string;
}

export interface Program {
  id: string;
  eventId: string;
  title: string;
  description: string;
  coordinatorEmail: string; // Program Coordinator
  coordinatorName: string;
  participants: string[]; // list of participant names or emails
  volunteers: string[]; // list of volunteer names or emails
  createdAt: string;
}

export interface GovernanceAssignment {
  id: string; // unique assignment ID, e.g. `${gmkId}_${position}`
  gmkId: string;
  email: string;
  position: 'admin' | 'president' | 'vp' | 'event_director' | 'committee_lead' | string;
  assignedBy: string;
  assignedAt: string;
  committee?: string;
}

export interface AuditLog {
  id: string; // doc ID
  timestamp: string;
  action: 'APPROVE_RESIDENT' | 'ARCHIVE_RESIDENT' | 'ACTIVATE_RESIDENT' | 'DEACTIVATE_RESIDENT' | 'ASSIGN_ROLE' | 'REMOVE_ROLE' | 'APPOINT_EVENT_DIRECTOR' | 'REGISTRATION_SUBMITTED' | 'SUBMIT_REGISTRATION' | 'REJECT_REGISTRATION' | 'PROFILE_COMPLETED' | string;
  actorEmail: string;
  entityType: 'resident' | 'role_assignment' | 'registration' | 'event' | 'committee' | 'program' | string;
  entityId: string;
  details: string;
  targetName?: string; // Optional helper mapping
}

export interface EventPricingConfig {
  singleRate: number;
  coupleRate: number;
  familyRate: number;
  freeChildAge: number;
  halfChildAge?: number;
  adultAge?: number;
  allowExternal?: boolean;
  externalRate?: number;
  parentRate?: number;
  otherRate?: number;
  policyVersion?: string;
  policyRef?: string;
  policyRevisionDate?: string;
  policyUpdatedAt?: string;
  policyUpdatedBy?: string;
}

export interface EventTemplate {
  id: string;
  name: string; // e.g. 'Onam'
  displayName: string;
  description: string;
  defaultCommittees: string[];
  defaultPricing: EventPricingConfig;
  defaultProgramCategories: string[];
  defaultSettings: {
    guestRegistrationEnabled: boolean;
    qrAttendanceEnabled: boolean;
    certificateEnabled: boolean;
    attendanceRequired: boolean;
    mealCouponEnabled: boolean;
    volunteerCertificatesEnabled: boolean;
    programCertificatesEnabled: boolean;
    maxGuests: number;
    registrationLimits: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface EventSettings {
  id: string;
  eventId: string;
  guestRegistrationEnabled: boolean;
  qrAttendanceEnabled: boolean;
  certificateEnabled: boolean;
  attendanceRequired: boolean;
  mealCouponEnabled: boolean;
  volunteerCertificatesEnabled: boolean;
  programCertificatesEnabled: boolean;
  maxGuests: number;
  registrationLimits: number;
  createdAt: string;
  updatedAt: string;
}

export interface EventCommitteeMember {
  residentId: string;
  fullName: string;
  email: string;
  role: 'Lead' | 'Volunteer' | 'Coordinator';
  phone?: string;
  unitDisplay?: string;
  dutyRole?: string;
}

export interface EventCommitteeExpenseRefund {
  refundId: string;
  voucherNumber?: string;
  amount: number;
  date: string;
  refundedBy: string;
  refundMethod?: string;
  referenceNumber?: string;
  remarks?: string;
}

export interface EventCommitteeExpense {
  id: string;
  categoryId?: string;
  categoryName?: string;
  date: string;
  description: string;
  amount: number;
  createdAt: string;
  createdBy?: string;
  payee?: string;
  paidByType?: 'event_treasury' | 'event_direct' | 'resident' | 'sponsor';
  isPersonalPayment?: boolean;
  paidByResidentId?: string; // GMK ID e.g. GMK-001234
  paidByName?: string;       // Full name of resident or sponsor
  paidByUnit?: string;       // Display unit number
  paidByPhone?: string;
  paidByEmail?: string;
  paidBySponsorId?: string;  // Sponsor ID from eventFinance.sponsorshipIncome
  payableStatus?: 'pending' | 'partially_refunded' | 'refunded';
  refundedAmount?: number;
  refundHistory?: EventCommitteeExpenseRefund[];
  financeStatus?: 'pending' | 'accepted' | 'rejected';
  acceptedAt?: string;
  acceptedBy?: string;
  rejectedAt?: string;
  rejectedBy?: string;
  rejectionReason?: string;
  resubmittedAt?: string;
  resubmittedBy?: string;
  settlementStatus?: 'pending' | 'settled';
  settledAt?: string;
  settledBy?: string;
  settlementRemarks?: string;
  settlementMethod?: string;
  settlementReference?: string;
  createdScope?: 'finance' | 'committee';
  lastEditedBy?: string;
  lastEditedAt?: string;
}

export interface EventCommittee {
  id: string; // ${eventId}_${committeeName}
  eventId: string;
  name: string; // e.g., 'Program' | 'Finance' | 'Food' | 'Attendance' | 'Sponsorship' | 'Sourcing'
  type?: 'finance' | 'food' | 'attendance' | 'program' | 'sourcing' | 'sponsorship' | 'general';
  members: EventCommitteeMember[];
  isStandard?: boolean;
  requiresCoordinators?: boolean;
  requiresVolunteers?: boolean;
  requiresParticipants?: boolean;
  expenses?: EventCommitteeExpense[];
  status?: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
}

export interface EventProgram {
  committeeKey?: string;
  id: string;
  eventId: string;
  committeeId?: string;
  committeeName?: string;
  title: string;
  description: string;
  category: string;
  programType?: 'ADULTS' | 'KIDS' | 'MIXED';
  coordinators: Array<{ residentId: string; fullName: string; email: string; phone?: string; relation?: string; unitDisplay?: string }>;
  participants: Array<{ residentId: string; fullName: string; email: string; role?: string; phone?: string; unitDisplay?: string; accommodationType?: string; parentPhone?: string; isChild?: boolean; age?: number; gender?: string }>;
  volunteers: Array<{ residentId: string; fullName: string; email: string; phone?: string; unitDisplay?: string; role?: string }>;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  updatedAt: string;
  expenses?: EventCommitteeExpense[];
}

export interface EventAttendance {
  committeeKey?: string;
  id: string; // att_${gmkId}_${eventId}
  eventId: string;
  gmkId: string;
  fullName: string;
  registrationId?: string;
  status: 'registered' | 'checked_in' | 'completed' | 'attended';
  checkedInBy?: string;
  checkedInAt?: string;
  scannedBy?: string;
  adultsAttended?: number;
  childrenAttended?: number;
  totalAttended?: number;
  totalParticipants?: number;
  entryPassNumber?: string;
  primaryMemberGmkId?: string;
  attendedAt?: string;
  arrivedDetails?: Array<{
    name: string;
    category?: string;
    arrivedAt?: string;
    scannedBy?: string;
  }>;
  // Family Check-In Completion Email Fields
  completionEmailQueuedAt?: string | null;
  completionEmailSentAt?: string | null;
  completionEmailRecipient?: string | null;
  completionEmailQueueId?: string | null;
  familyCompletionEmailSent?: boolean;
  familyCheckInCompleted?: boolean;
  familyCompletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EventFood {
  committeeKey?: string;
  id: string; // food_${gmkId}_${eventId}
  eventId: string;
  gmkId: string;
  fullName: string;
  mealCouponStatus: 'issued' | 'claimed' | 'none';
  mealCount: { adults: number; halfChildren: number; freeChildren: number; guests: number };
  claimedBy?: string;
  claimedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EventCertificate {
  id: string; // cert_${gmkId}_${eventId}
  eventId: string;
  gmkId: string;
  fullName: string;
  certificateNumber: string;
  type: 'volunteer' | 'participant' | 'general';
  status: 'eligible' | 'issued' | 'none';
  issuedDate?: string;
  qrVerificationUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EventFinance {
  id: string; // fin_${eventId}
  eventId: string;
  openingBalance: number;
  openingBalanceApproved: boolean;
  openingBalanceApprovedBy?: string;
  closingStatementsApproved: boolean;
  closingStatementsApprovedBy?: string;
  budgetAllocations: { [committeeName: string]: number };
  sponsorshipIncome: { source: string; amount: number; date: string }[];
  totalRevenue: number;
  totalExpenses: number;
  netBalance: number;
  status: 'draft' | 'under_review' | 'approved';
  createdAt: string;
  updatedAt: string;
}

export interface EventReport {
  id: string; // rep_${eventId}
  eventId: string;
  registrationsCount: number;
  attendanceCount: number;
  mealsIssuedCount: number;
  totalRevenue: number;
  totalExpenses: number;
  programsCount: number;
  volunteersCount: number;
  lastUpdated: string;
}

export interface EventCommunication {
  id: string; // comm_${eventId}
  eventId: string;
  templates: {
    [notificationType: string]: {
      subject: string;
      body: string;
      active: boolean;
    };
  };
  createdAt: string;
  updatedAt: string;
}


export interface SponsorMaster {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
}

/**
 * RTCO-095 Authoritative Financial History Check
 * 
 * Determines whether an event registration has genuine financial history
 * that MUST be preserved for audit purposes.
 * 
 * Returns TRUE if and only if:
 * 1. Positive payment has actually been received (amountReceived > 0)
 * 2. Positive refund has actually been issued (refundedAmount > 0)
 * 3. Pending refund exists (refundDue > 0)
 * 4. Refund history contains meaningful transactions (> 0 amount or settled/pending/processing status)
 * 5. Payment transaction or receipt has been recorded (receiptNumber or paymentProcessedAt)
 * 6. Payment history contains completed or paid records
 * 
 * Crucially: Quoted ticket price without payment (e.g. paymentAmount: 25 with amountReceived: 0),
 * cancelled status without cash transactions, empty arrays, null, or zero values
 * DO NOT constitute financial history and must not block deletion of rejected registrations.
 */
export function hasGenuineFinancialHistory(reg: EventRegistration): boolean {
  if (!reg) return false;

  // 1. Positive payment received
  if (typeof reg.amountReceived === 'number' && reg.amountReceived > 0) {
    return true;
  }

  // 2. Positive refund issued
  if (typeof reg.refundedAmount === 'number' && reg.refundedAmount > 0) {
    return true;
  }

  // 3. Pending refund due
  if (typeof reg.refundDue === 'number' && reg.refundDue > 0) {
    return true;
  }

  // 4. Refund history contains meaningful transactions
  if (Array.isArray(reg.refundHistory) && reg.refundHistory.length > 0) {
    const hasMeaningfulRefund = reg.refundHistory.some(r => 
      (typeof r.amount === 'number' && r.amount > 0) || 
      r.status === 'settled' || 
      r.status === 'pending' || 
      r.status === 'processing'
    );
    if (hasMeaningfulRefund) return true;
  }

  // 5. Payment transaction or receipt recorded
  if (typeof reg.receiptNumber === 'string' && reg.receiptNumber.trim() !== '') {
    return true;
  }
  if (typeof reg.paymentProcessedAt === 'string' && reg.paymentProcessedAt.trim() !== '') {
    return true;
  }

  // 6. Payment history contains non-zero transactions
  if (Array.isArray(reg.paymentHistory) && reg.paymentHistory.length > 0) {
    const hasMeaningfulPayment = reg.paymentHistory.some(p => 
      (typeof p.amount === 'number' && p.amount > 0) || 
      p.status === 'completed' || 
      p.status === 'paid'
    );
    if (hasMeaningfulPayment) return true;
  }

  // 7. Payment status indicates settled funds with associated financial figures
  if (reg.paymentStatus === 'paid' || reg.paymentStatus === 'partially_paid' || reg.paymentStatus === 'overpaid' || reg.paymentStatus === 'refunded' || reg.paymentStatus === 'refund_due') {
    if ((typeof reg.amountReceived === 'number' && reg.amountReceived > 0) || (typeof reg.refundedAmount === 'number' && reg.refundedAmount > 0)) {
      return true;
    }
  }

  return false;
}

