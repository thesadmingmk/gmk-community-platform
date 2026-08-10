export interface UserProfile {
  uid: string;
  email: string;
  roles: string[];
  isActive: boolean;
  createdAt: string;
  positions?: string[];
  fullName?: string;
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
  registrationSettings?: any;
  configurationStatus?: string;
  paymentTransferAccounts?: PaymentAccount[];
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

export interface EventRegistration {
  id: string; // reg_${gmkId}_${eventId}
  eventId: string;
  familyId: string;
  primaryMemberGmkId: string;
  primaryMemberEmail: string;
  participants: string[]; // List of participating names, e.g. ["Mr. Primary Name", "Mrs. Spouse Name"]
  totalParticipants: number;
  createdAt: string;
  updatedAt: string;
  registrationType?: 'individual' | 'couple' | 'family';
  paymentAmount?: number;
  paymentSummary?: {
    baseRate: number;
    baseRateApplied: string;
    childrenCount: number;
    halfPriceChildrenCount: number;
    freeChildrenCount: number;
    totalAmount: number;
    details: string;
    parentsCount?: number;
    externalParticipantsCount?: number;
    externalParticipantRate?: number;
    externalSubtotal?: number;
    includedMembers?: string[];
    parentMembers?: string[];
    timestamp?: string;
  };
  attendanceSummary?: {
    attendedCount: number;
    participantsStatus: Record<string, 'pending' | 'attended' | 'absent'>;
  };
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
}

export interface EventCommitteeExpense {
  id: string;
  date: string;
  description: string;
  amount: number;
  createdAt: string;
  createdBy?: string;
}

export interface EventCommittee {
  id: string; // ${eventId}_${committeeName}
  eventId: string;
  name: string; // e.g., 'Program' | 'Finance' | 'Food' | 'Attendance' | 'Sponsorship' | 'Sourcing'
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
  id: string;
  eventId: string;
  title: string;
  description: string;
  category: string;
  programType?: 'ADULTS' | 'KIDS' | 'MIXED';
  coordinators: Array<{ residentId: string; fullName: string; email: string; phone?: string; relation?: string; unitDisplay?: string }>;
  participants: Array<{ residentId: string; fullName: string; email: string; role?: string; phone?: string; unitDisplay?: string; accommodationType?: string; parentPhone?: string; isChild?: boolean; age?: number; gender?: string }>;
  volunteers: Array<{ residentId: string; fullName: string; email: string; phone?: string; unitDisplay?: string }>;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  updatedAt: string;
  expenses?: EventCommitteeExpense[];
}

export interface EventAttendance {
  id: string; // att_${gmkId}_${eventId}
  eventId: string;
  gmkId: string;
  fullName: string;
  status: 'registered' | 'checked_in' | 'completed';
  checkedInBy?: string;
  checkedInAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EventFood {
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
  openingBalanceApproved: boolean;
  openingBalanceApprovedBy?: string;
  closingStatementsApproved: boolean;
  closingStatementsApprovedBy?: string;
  budgetAllocations: { [committeeName: string]: number };
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

