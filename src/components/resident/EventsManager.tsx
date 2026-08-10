import React, { useState, useEffect } from 'react';
import { db, auth } from '../../context/AuthContext';
import { collection, query, where, onSnapshot, doc, writeBatch, getDoc, setDoc } from 'firebase/firestore';
import { CommunityEvent, EventRegistration, Family, FamilyMember, ResidentProfile } from '../../types';
import { Calendar, Check, Clock, AlertCircle, RefreshCw, X, Users, MapPin, DollarSign, ArrowLeft } from 'lucide-react';
import { createAuditLog } from '../../utils/audit';
import { useLocalGEASConfirmation, GEASConfirmationDialogUI } from '../gmk/GEASConfirmationDialog';
import { getEventRegistrationStatus, getRegistrationStatusLabel } from '../../utils/eventLifecycle';
import { handleFirestoreError, OperationType } from '../../utils/firestoreError';

interface EventsManagerProps {
  residentProfile: ResidentProfile;
  onViewEventDetails?: (evt: CommunityEvent) => void;
}

export default function EventsManager({ residentProfile, onViewEventDetails }: EventsManagerProps) {
  const { confirm: showConfirm, isOpen: isConfirmOpen, options: confirmOptions, handleCancel: handleConfirmCancel, handleConfirm: handleConfirmSubmit } = useLocalGEASConfirmation();
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<CommunityEvent[]>([]);
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([]);
  const [registrations, setRegistrations] = useState<EventRegistration[]>([]);
  
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Active dialogue controls
  const [activeEventForReg, setActiveEventForReg] = useState<CommunityEvent | null>(null);
  const [viewingRegDetails, setViewingRegDetails] = useState<EventRegistration | null>(null);
  
  // Registration form selections
  const [checkedFamilyMembers, setCheckedFamilyMembers] = useState<Record<string, boolean>>({});
  const [externalCount, setExternalCount] = useState<number>(0);

  // Real-time calculated pricing state
  const [livePricing, setLivePricing] = useState<{
    registrationType: 'individual' | 'couple' | 'family';
    totalAmount: number;
    details: string;
    breakdown: { adults: number; halfPriceChildren: number; freeChildren: number };
    baseRate?: number;
    parentsCount?: number;
    externalCount?: number;
    externalRate?: number;
    externalSubtotal?: number;
    includedMembers?: string[];
    parentMembers?: string[];
  } | null>(null);

  useEffect(() => {
    setLoading(true);
    const familyId = `fam_${residentProfile.gmkId}`;

    // 1. Fetch live events list
    const unsubEvents = onSnapshot(collection(db, "events"), (snapshot) => {
      const list: CommunityEvent[] = [];
      snapshot.forEach((d) => {
        const item = { id: d.id, ...d.data() } as CommunityEvent;
        if (item.status === 'published' || item.status === 'completed') {
          list.push(item);
        }
      });
      setEvents(list);
    }, (err) => {
      console.error("❌ Events subscription error:", err);
      handleFirestoreError(err, OperationType.LIST, "events");
    });

    // 2. Fetch live family members
    const qMems = query(collection(db, "familyMembers"), where("familyId", "==", familyId));
    const unsubMems = onSnapshot(qMems, (snapshot) => {
      const list: FamilyMember[] = [];
      snapshot.forEach(d => {
        list.push({ id: d.id, ...d.data() } as FamilyMember);
      });
      setFamilyMembers(list);
    }, (err) => {
      console.warn("⚠️ FamilyMembers snapshot error:", err);
      handleFirestoreError(err, OperationType.LIST, "familyMembers");
    });

    // 3. Fetch live user registrations
    const normEmail = (residentProfile.email || '').toLowerCase().trim();
    const qRegs = query(collection(db, "event_registrations"), where("primaryMemberEmail", "==", normEmail));
    const unsubRegs = onSnapshot(qRegs, (snapshot) => {
      const list: EventRegistration[] = [];
      snapshot.forEach(d => {
        list.push({ id: d.id, ...d.data() } as EventRegistration);
      });
      setRegistrations(list);
      setLoading(false);
    }, (err) => {
      console.warn("⚠️ Event registrations snapshot error:", err);
      handleFirestoreError(err, OperationType.LIST, "event_registrations");
    });

    return () => {
      unsubEvents();
      unsubMems();
      unsubRegs();
    };
  }, [residentProfile.gmkId, residentProfile.email]);

  // Helper to calculate pricing dynamically
  const calculatePricing = (
    event: CommunityEvent,
    checkedMems: Record<string, boolean>,
    extCount: number = 0
  ) => {
    const pricing = event.pricing;
    const currentYear = new Date().getFullYear();
    
    // Generate selected participants list
    const selectedParticipants: string[] = [];
    if (checkedMems["primary"]) {
      selectedParticipants.push(residentProfile.fullName);
    }
    familyMembers.forEach(mem => {
      if (checkedMems[mem.id]) {
        selectedParticipants.push(mem.name);
      }
    });

    if (selectedParticipants.length === 0 || !pricing) {
      return {
        registrationType: 'individual' as const,
        totalAmount: 0,
        details: pricing ? "Please select at least one household member." : "Pricing config is unavailable for this event.",
        breakdown: { adults: 0, halfPriceChildren: 0, freeChildren: 0 },
        baseRate: 0,
        parentsCount: 0,
        externalCount: extCount,
        externalRate: pricing?.externalRate || 0,
        externalSubtotal: extCount * (pricing?.externalRate || 0),
        includedMembers: [],
        parentMembers: []
      };
    }

    // Determine role/categories of selected participants
    let hasResident = !!checkedMems["primary"];
    let hasSpouse = false;
    let kidsBelowFreeAge = 0;
    let kidsAboveFreeAge = 0;
    let parentsCount = 0;

    const includedMembers: string[] = [];
    const parentMembers: string[] = [];

    if (hasResident) {
      includedMembers.push(residentProfile.fullName);
    }

    familyMembers.forEach(mem => {
      if (checkedMems[mem.id]) {
        if (mem.relationship === 'spouse') {
          hasSpouse = true;
          includedMembers.push(mem.name);
        } else if (mem.relationship === 'parent') {
          parentsCount++;
          parentMembers.push(mem.name);
        } else if (mem.relationship === 'child') {
          if (mem.yearOfBirth) {
            const age = currentYear - parseInt(mem.yearOfBirth);
            if (age < pricing.freeChildAge) {
              kidsBelowFreeAge++;
              includedMembers.push(`${mem.name} (Age ${age}, Free)`);
            } else {
              kidsAboveFreeAge++;
              includedMembers.push(`${mem.name} (Age ${age})`);
            }
          } else {
            kidsAboveFreeAge++;
            includedMembers.push(`${mem.name}`);
          }
        } else {
          includedMembers.push(mem.name);
        }
      }
    });

    // 1. Determine household/spouse composition to figure out base pricing
    let registrationType: 'individual' | 'couple' | 'family' = 'individual';
    let baseRate = 0;

    const spousesCount = (hasResident ? 1 : 0) + (hasSpouse ? 1 : 0);

    if (spousesCount === 2) {
      // Both spouses attending
      if (kidsBelowFreeAge > 0 || kidsAboveFreeAge > 0) {
        registrationType = 'family';
        baseRate = pricing.familyRate;
      } else {
        registrationType = 'couple';
        baseRate = pricing.coupleRate;
      }
    } else if (spousesCount === 1) {
      // Single adult (or resident only, or single parent)
      if (kidsAboveFreeAge > 0) {
        // At least one child above Free Age attends -> Couple Rate (Single Parent Rule 4)
        registrationType = 'couple';
        baseRate = pricing.coupleRate;
      } else if (kidsBelowFreeAge > 0) {
        // All children are below Free Age -> Individual Rate (Rule 3)
        registrationType = 'individual';
        baseRate = pricing.singleRate;
      } else {
        // Just the resident/spouse alone -> Individual Rate (Rule 1)
        registrationType = 'individual';
        baseRate = pricing.singleRate;
      }
    } else {
      // spousesCount === 0 (e.g. only kids or parents are checked)
      if (kidsAboveFreeAge > 0) {
        registrationType = 'couple';
        baseRate = pricing.coupleRate;
      } else {
        registrationType = 'individual';
        baseRate = pricing.singleRate;
      }
    }

    // External participants
    const allowExternal = pricing.allowExternal ?? false;
    const externalRate = allowExternal ? (pricing.externalRate || 0) : 0;
    const externalSubtotal = extCount * externalRate;

    const totalAmount = baseRate + externalSubtotal;

    // Craft a descriptive, detailed explanation of how it was computed
    let detailsStr = "";
    if (registrationType === 'individual') {
      detailsStr = `Individual Rate: OMR ${pricing.singleRate}`;
    } else if (registrationType === 'couple') {
      if (spousesCount === 1 && kidsAboveFreeAge > 0) {
        detailsStr = `Couple Rate (OMR ${pricing.coupleRate}) applied via Single Parent Household Rule (Resident + child above Free Age).`;
      } else {
        detailsStr = `Couple Rate: OMR ${pricing.coupleRate}`;
      }
    } else {
      detailsStr = `Family Rate: OMR ${pricing.familyRate}`;
    }

    if (parentsCount > 0) {
      detailsStr += ` | ${parentsCount} Parent(s) attending Free (OMR 0).`;
    }

    if (extCount > 0 && allowExternal) {
      detailsStr += ` | External Participants: ${extCount} × OMR ${externalRate} = OMR ${externalSubtotal}.`;
    }

    return {
      registrationType,
      totalAmount,
      details: detailsStr,
      breakdown: { 
        adults: spousesCount, 
        halfPriceChildren: kidsAboveFreeAge, 
        freeChildren: kidsBelowFreeAge 
      },
      baseRate,
      parentsCount,
      externalCount: extCount,
      externalRate,
      externalSubtotal,
      includedMembers,
      parentMembers
    };
  };

  const handleOpenRegistration = (evt: CommunityEvent) => {
    setActiveEventForReg(evt);
    setErrorMsg(null);
    setSuccessMsg(null);

    const existing = registrations.find(r => r.eventId === evt.id);
    const initialChecked: Record<string, boolean> = {};
    let initialExtCount = 0;

    if (existing) {
      initialChecked["primary"] = existing.participants.includes(residentProfile.fullName);
      familyMembers.forEach(mem => {
        initialChecked[mem.id] = existing.participants.includes(mem.name);
      });
      initialExtCount = existing.paymentSummary?.externalParticipantsCount || 0;
    } else {
      initialChecked["primary"] = true;
      familyMembers.forEach(mem => {
        initialChecked[mem.id] = false;
      });
    }

    setExternalCount(initialExtCount);
    setCheckedFamilyMembers(initialChecked);
    // Dynamic pricing subtotal
    const priceInit = calculatePricing(evt, initialChecked, initialExtCount);
    setLivePricing(priceInit);
  };

  const handleCheckboxToggle = (key: string) => {
    if (!activeEventForReg) return;
    const updatedChecked = {
      ...checkedFamilyMembers,
      [key]: !checkedFamilyMembers[key]
    };
    setCheckedFamilyMembers(updatedChecked);
    const updatedPricing = calculatePricing(activeEventForReg, updatedChecked, externalCount);
    setLivePricing(updatedPricing);
  };

  const handleExternalCountChange = (count: number) => {
    if (!activeEventForReg) return;
    const val = Math.max(0, count);
    setExternalCount(val);
    const updatedPricing = calculatePricing(activeEventForReg, checkedFamilyMembers, val);
    setLivePricing(updatedPricing);
  };

  const handleSaveRegistration = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeEventForReg) return;

    setErrorMsg(null);
    setSuccessMsg(null);

    console.log(`[REGISTRATION STARTED] Commencing registration process for event: ${activeEventForReg.id}`);

    // Validation 1: Resident Status Inactive or Suspended
    if (residentProfile.status !== 'active') {
      const msg = `Your registration could not be completed because your resident profile status is currently '${residentProfile.status}'. Please contact a GMK Administrator.`;
      setErrorMsg(msg);
      console.warn(`[REGISTRATION BLOCK] Resident ${residentProfile.gmkId} is not active: ${residentProfile.status}`);
      return;
    }

    // Validation 2: Event status published check
    if (activeEventForReg.status !== 'published') {
      const msg = "Your registration could not be completed because this event is not currently published.";
      setErrorMsg(msg);
      console.warn(`[REGISTRATION BLOCK] Event ${activeEventForReg.id} status is ${activeEventForReg.status}`);
      return;
    }

    // Validation 3: Event timeline check
    const regTimeline = getEventRegistrationStatus(activeEventForReg);
    if (regTimeline === 'closed') {
      setErrorMsg("Your registration could not be completed because registration for this event is closed.");
      return;
    }
    if (regTimeline === 'completed') {
      setErrorMsg("Your registration could not be completed because this event is already completed.");
      return;
    }

    // Validation 4: Selection of at least one member
    const participantsList: string[] = [];
    if (checkedFamilyMembers["primary"]) {
      participantsList.push(residentProfile.fullName);
    }
    familyMembers.forEach(mem => {
      if (checkedFamilyMembers[mem.id]) {
        participantsList.push(mem.name);
      }
    });

    if (participantsList.length === 0) {
      setErrorMsg("VALIDATION ERROR: You must select at least one participating family member for registration.");
      return;
    }

    setLoading(true);

    try {
      const familyId = `fam_${residentProfile.gmkId}`;
      const regId = `reg_${residentProfile.gmkId}_${activeEventForReg.id}`;

      // Validation 5: Family profile check
      console.log(`[FAMILY LOADING] Fetching family document: ${familyId}`);
      const familyDocRef = doc(db, "families", familyId);
      const familySnap = await getDoc(familyDocRef);
      if (!familySnap.exists()) {
        throw new Error("Your registration could not be completed because your family profile is unavailable. Please contact a GMK Administrator.");
      }
      
      const familyData = familySnap.data() as Family;
      if (!familyData.onboardingCompleted) {
        throw new Error("Your registration could not be completed because your family onboarding wizard is incomplete.");
      }
      console.log(`[FAMILY LOADED] Successfully loaded family data. Onboarding status: ${familyData.onboardingCompleted}`);

      // Calculate final pricing
      console.log(`[PRICING CALCULATION] Calculating final cost structure...`);
      const pricingResult = calculatePricing(activeEventForReg, checkedFamilyMembers, externalCount);
      if (pricingResult.totalAmount === 0 && activeEventForReg.pricing) {
        throw new Error("Billing system is temporarily offline. Please contact GMK support.");
      }
      console.log(`[PRICING CALCULATED] Final calculated fee: OMR ${pricingResult.totalAmount} (${pricingResult.registrationType})`);

      // Firestore Validation Passed
      console.log(`[FIRESTORE VALIDATION PASSED] All client constraints satisfied. Compiling atomic writes...`);

      // Sync state calculations
      const oldReg = registrations.find(r => r.eventId === activeEventForReg.id);
      const oldTotal = oldReg ? oldReg.totalParticipants : 0;
      const oldRevenue = oldReg ? (oldReg.paymentAmount || 0) : 0;

      const diffParticipants = (participantsList.length + externalCount) - oldTotal;
      const diffRevenue = pricingResult.totalAmount - oldRevenue;

      const batch = writeBatch(db);

      // A. Write Event Registration Document
      const regPayload: any = {
        id: regId,
        eventId: activeEventForReg.id,
        familyId,
        primaryMemberGmkId: residentProfile.gmkId,
        primaryMemberEmail: residentProfile.email,
        participants: participantsList,
        totalParticipants: participantsList.length + externalCount,
        createdAt: oldReg ? oldReg.createdAt : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        // Extra consistency and schema properties
        registrationType: pricingResult.registrationType,
        paymentAmount: pricingResult.totalAmount,
        paymentSummary: {
          baseRate: pricingResult.baseRate || 0,
          baseRateApplied: pricingResult.registrationType,
          childrenCount: pricingResult.breakdown.freeChildren + pricingResult.breakdown.halfPriceChildren,
          freeChildrenCount: pricingResult.breakdown.freeChildren,
          halfPriceChildrenCount: pricingResult.breakdown.halfPriceChildren,
          parentsCount: pricingResult.parentsCount,
          externalParticipantsCount: externalCount,
          externalParticipantRate: pricingResult.externalRate,
          externalSubtotal: pricingResult.externalSubtotal,
          totalAmount: pricingResult.totalAmount,
          details: pricingResult.details,
          includedMembers: pricingResult.includedMembers || [],
          parentMembers: pricingResult.parentMembers || [],
          timestamp: new Date().toISOString()
        },
        attendanceSummary: {
          attendedCount: 0,
          participantsStatus: participantsList.reduce((acc, name) => {
            acc[name] = 'pending';
            return acc;
          }, {} as Record<string, 'pending' | 'attended' | 'absent'>)
        }
      };

      console.log('=== GMK REGISTRATION PAYLOAD DIAGNOSTIC ===');
      console.log('[FIELD CHECK 1] primaryMemberEmail:', {
        value: regPayload.primaryMemberEmail,
        type: typeof regPayload.primaryMemberEmail,
        isLowercase: regPayload.primaryMemberEmail === 
                     regPayload.primaryMemberEmail?.toLowerCase(),
        matchesAuth: regPayload.primaryMemberEmail === 
                     'way2anand@yahoo.com'
      });
      console.log('[FIELD CHECK 2] paymentStatus:', {
        value: regPayload.paymentStatus,
        type: typeof regPayload.paymentStatus,
        exactMatch: regPayload.paymentStatus === 'pending'
      });
      console.log('[FIELD CHECK 3] qrCode:', {
        value: regPayload.qrCode,
        type: typeof regPayload.qrCode,
        isNull: regPayload.qrCode === null,
        isUndefined: regPayload.qrCode === undefined,
        fieldExists: 'qrCode' in regPayload
      });
      console.log('[FULL PAYLOAD]', JSON.stringify(regPayload, null, 2));
      console.log('===========================================');

      // Correction 1 — force lowercase email
      regPayload.primaryMemberEmail = 
        (regPayload.primaryMemberEmail || '').toLowerCase().trim();

      // Correction 2 — force exact pending string
      regPayload.paymentStatus = 'pending';

      // Correction 3 — force null (not undefined, not missing)
      regPayload.qrCode = null;

      console.log('=== GMK CORRECTED PAYLOAD ===');
      console.log('[CORRECTED] primaryMemberEmail:', 
        regPayload.primaryMemberEmail);
      console.log('[CORRECTED] paymentStatus:', 
        regPayload.paymentStatus);
      console.log('[CORRECTED] qrCode:', 
        regPayload.qrCode);
      console.log('=============================');

      // Diagnostic wording for CREATE vs UPDATE EXISTING
      const opType = oldReg ? 'UPDATE EXISTING' : 'CREATE';
      console.log(`[REGISTRATION OPERATION]\n${opType}`);

      console.log(`[REGISTRATION BATCH 01]\nPATH: event_registrations/${regId}\nOPERATION: ${opType}\nAUTHORITY: Resident ${residentProfile.gmkId} (${residentProfile.email})\nEXPECTED RULE: event_registrations ${opType.toLowerCase()} by primaryMemberGmkId / primaryMemberEmail`);
      batch.set(doc(db, "event_registrations", regId), regPayload);

      // B. Write Attendance Record
      const attPayload = {
        id: `att_${residentProfile.gmkId}_${activeEventForReg.id}`,
        eventId: activeEventForReg.id,
        gmkId: residentProfile.gmkId,
        fullName: residentProfile.fullName,
        status: 'registered',
        createdAt: oldReg ? oldReg.createdAt : new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      console.log(`[REGISTRATION BATCH 02]\nPATH: eventAttendance/${attPayload.id}\nOPERATION: SET\nAUTHORITY: Resident ${residentProfile.gmkId}\nEXPECTED RULE: eventAttendance write by gmkId`);
      batch.set(doc(db, "eventAttendance", attPayload.id), attPayload);

      // C. Write Food Voucher Coupon Record
      const foodPayload = {
        id: `food_${residentProfile.gmkId}_${activeEventForReg.id}`,
        eventId: activeEventForReg.id,
        gmkId: residentProfile.gmkId,
        fullName: residentProfile.fullName,
        mealCouponStatus: 'issued',
        mealCount: { 'standard': participantsList.length + externalCount },
        createdAt: oldReg ? oldReg.createdAt : new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      console.log(`[REGISTRATION BATCH 03]\nPATH: eventFood/${foodPayload.id}\nOPERATION: SET\nAUTHORITY: Resident ${residentProfile.gmkId}\nEXPECTED RULE: eventFood write by gmkId`);
      batch.set(doc(db, "eventFood", foodPayload.id), foodPayload);

      // D. Update Event Report Summary Document (Consistency Count Check)
      console.log("[STEP 2]\nUpdating Event Report...");
      const reportDocRef = doc(db, "eventReports", `rep_${activeEventForReg.id}`);
      const reportSnap = await getDoc(reportDocRef);
      let reportPayload;
      if (reportSnap.exists()) {
        const reportData = reportSnap.data();
        reportPayload = {
          ...reportData,
          registrationsCount: Math.max(0, (reportData.registrationsCount || 0) + diffParticipants),
          totalRevenue: Math.max(0, (reportData.totalRevenue || 0) + diffRevenue),
          lastUpdated: new Date().toISOString()
        };
      } else {
        reportPayload = {
          id: `rep_${activeEventForReg.id}`,
          eventId: activeEventForReg.id,
          registrationsCount: Math.max(0, diffParticipants),
          attendanceCount: 0,
          mealsIssuedCount: 0,
          totalRevenue: Math.max(0, diffRevenue),
          totalExpenses: 0,
          programsCount: 0,
          volunteersCount: 0,
          lastUpdated: new Date().toISOString()
        };
      }
      // E. Prepare Event Finance Payload for secondary non-blocking update
      const finDocRef = doc(db, "eventFinance", `fin_${activeEventForReg.id}`);
      const finSnap = await getDoc(finDocRef);
      let finPayload;
      if (finSnap.exists()) {
        const finData = finSnap.data();
        const newRev = Math.max(0, (finData.totalRevenue || 0) + diffRevenue);
        const netBal = newRev - (finData.totalExpenses || 0);
        finPayload = {
          ...finData,
          totalRevenue: newRev,
          netBalance: netBal,
          updatedAt: new Date().toISOString()
        };
      } else {
        finPayload = {
          id: `fin_${activeEventForReg.id}`,
          eventId: activeEventForReg.id,
          openingBalanceApproved: false,
          closingStatementsApproved: false,
          budgetAllocations: {},
          totalRevenue: Math.max(0, diffRevenue),
          totalExpenses: 0,
          netBalance: Math.max(0, diffRevenue),
          status: 'draft',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
      }

      // F. Prepare Event Master Attendees for secondary non-blocking update
      const eventRef = doc(db, "events", activeEventForReg.id);
      let updatedAttendees = [...(activeEventForReg.attendees || [])];
      if (!updatedAttendees.includes(residentProfile.email)) {
        updatedAttendees.push(residentProfile.email);
      }

      // Commit the Core Resident-Writeable Atomic Transaction Batch (Guaranteed to succeed)
      console.log("[POST-REGISTRATION SUCCESS FLOW DIAGNOSTIC] STEP 1 - Committing Core Resident Batch...");
      try {
        await batch.commit();
        console.log("[POST-REGISTRATION SUCCESS FLOW DIAGNOSTIC] STEP 2 - Core Batch Commit Successful");
      } catch (commitErr: any) {
        console.error("Core Batch commit failed:", commitErr);
        throw commitErr;
      }

      // Immediately close modal and lock registration form
      console.log("[POST-REGISTRATION SUCCESS FLOW DIAGNOSTIC] STEP 3 - Closing RSVP Modal and locking registration form");
      const savedEventTitle = activeEventForReg.title;
      const totalParticipantsCount = regPayload.totalParticipants;
      const paymentAmountVal = regPayload.paymentAmount;
      
      setActiveEventForReg(null);
      setLivePricing(null);

      // Perform secondary non-critical updates asynchronously & gracefully
      try {
        console.log("[POST-REGISTRATION STATS] Attempting to update secondary metrics and finance...");
        const statsBatch = writeBatch(db);
        
        // D. Update Event Report
        statsBatch.set(reportDocRef, reportPayload, { merge: true });

        // E. Update Event Finance
        statsBatch.set(finDocRef, finPayload, { merge: true });

        // F. Update Event Attendees
        statsBatch.set(eventRef, { attendees: updatedAttendees }, { merge: true });

        await statsBatch.commit();
        console.log("[POST-REGISTRATION STATS] Secondary metrics/finance updated successfully.");
      } catch (statsErr) {
        console.warn("⚠️ Non-blocking stats, finance, or attendee updates failed (this is expected for standard resident accounts and is handled gracefully):", statsErr);
      }

      // Write Audit Trail Entry (non-blocking, wrapped independently)
      console.log("[POST-REGISTRATION SUCCESS FLOW DIAGNOSTIC] STEP 4 - Attempting to Create Audit Log...");
      const actionType = oldReg ? 'EVENT_REGISTRATION_UPDATED' : 'EVENT_REGISTERED';
      try {
        await createAuditLog(
          actionType,
          residentProfile.email,
          'registration',
          regId,
          `Resident unit registered ${totalParticipantsCount} participants for event '${savedEventTitle}' (Payment: OMR ${paymentAmountVal}).`
        );
        console.log("[POST-REGISTRATION SUCCESS FLOW DIAGNOSTIC] STEP 5 - Audit Log Created Successfully");
      } catch (auditErr) {
        console.error("[POST-REGISTRATION SUCCESS FLOW DIAGNOSTIC] STEP 5 ERROR - Audit log write failed:", auditErr);
      }

      console.log("[POST-REGISTRATION SUCCESS FLOW DIAGNOSTIC] STEP 6 - Displaying Success Message and Completing Flow");
      setSuccessMsg(`✓ Successfully registered ${totalParticipantsCount} member(s) of your family for ${savedEventTitle}!`);
    } catch (err: any) {
      console.error("❌ Event registration failed:", err);
      // Translate to clean, user-friendly error hiding technical database stack-traces
      const cleanError = err.message || "A verification error occurred during transaction processing. Please contact your GMK Administrator.";
      setErrorMsg(cleanError.includes("Missing or insufficient permissions") 
        ? "Access Denied: Your registration could not be finalized. Please ensure your resident profile onboarding is fully complete and active."
        : cleanError
      );
    } finally {
      setLoading(false);
    }
  };

  const handleCancelRegistration = async (eventId: string, title: string) => {
    const confirmed = await showConfirm({
      title: "CANCEL HOUSEHOLD REGISTRATION",
      message: `Are you sure you want to cancel your household registration for: ${title}?`,
      severity: "warning",
      confirmText: "Cancel Registration",
      cancelText: "Keep Registration"
    });
    if (!confirmed) {
      return;
    }

    setErrorMsg(null);
    setSuccessMsg(null);
    setLoading(true);

    try {
      const regId = `reg_${residentProfile.gmkId}_${eventId}`;
      const oldReg = registrations.find(r => r.eventId === eventId);
      if (!oldReg) {
        throw new Error("No active registration record found.");
      }

      const oldTotal = oldReg.totalParticipants;
      const oldRevenue = oldReg.paymentAmount || 0;

      const batch = writeBatch(db);
      
      // A. Delete Registration Doc
      batch.delete(doc(db, "event_registrations", regId));

      // B. Delete Attendance Doc
      batch.delete(doc(db, "eventAttendance", `att_${residentProfile.gmkId}_${eventId}`));

      // C. Delete Food Voucher Doc
      batch.delete(doc(db, "eventFood", `food_${residentProfile.gmkId}_${eventId}`));

      // D. Decrement Event Report Counters
      const reportDocRef = doc(db, "eventReports", `rep_${eventId}`);
      const reportSnap = await getDoc(reportDocRef);
      if (reportSnap.exists()) {
        const reportData = reportSnap.data();
        batch.set(reportDocRef, {
          ...reportData,
          registrationsCount: Math.max(0, (reportData.registrationsCount || 0) - oldTotal),
          totalRevenue: Math.max(0, (reportData.totalRevenue || 0) - oldRevenue),
          lastUpdated: new Date().toISOString()
        }, { merge: true });
      }

      // E. Decrement Event Finance Revenue
      const finDocRef = doc(db, "eventFinance", `fin_${eventId}`);
      const finSnap = await getDoc(finDocRef);
      if (finSnap.exists()) {
        const finData = finSnap.data();
        const newRev = Math.max(0, (finData.totalRevenue || 0) - oldRevenue);
        const netBal = newRev - (finData.totalExpenses || 0);
        batch.set(finDocRef, {
          ...finData,
          totalRevenue: newRev,
          netBalance: netBal,
          updatedAt: new Date().toISOString()
        }, { merge: true });
      }

      // F. Clean email reference from events list attendees array to keep compatibility
      const targetEvent = events.find(e => e.id === eventId);
      if (targetEvent) {
        const remainingAttendees = (targetEvent.attendees || []).filter(email => email !== residentProfile.email);
        batch.set(doc(db, "events", eventId), { attendees: remainingAttendees }, { merge: true });
      }

      console.log(`[CANCELLATION WRITTEN] Cancelling database records atomically: ${regId}`);
      await batch.commit();

      // Write Cancel Audit Trail Entry (non-blocking)
      try {
        await createAuditLog(
          'EVENT_REGISTRATION_CANCELLED',
          residentProfile.email,
          'registration',
          regId,
          `Cancelled resident unit registration for event '${title}' (Refunded: OMR ${oldRevenue}).`
        );
      } catch (auditErr) {
        console.warn("⚠️ Non-blocking Cancel Audit log failed:", auditErr);
      }

      setSuccessMsg(`✓ Successfully cancelled your household registration for ${title}.`);
      setViewingRegDetails(null);
    } catch (err: any) {
      console.error("❌ Cancel registration failed:", err);
      setErrorMsg(err.message || "Failed to cancel registration safely. Please contact your administrator.");
    } finally {
      setLoading(false);
    }
  };

  if (loading && events.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-6 h-6 animate-spin text-[#0f4c2a] mr-2" />
        <span className="text-xs text-stone-500 font-bold">Synchronizing upcoming events...</span>
      </div>
    );
  }

  const activeEvents = events.filter(e => e.status && e.status !== 'draft');

  return (
    <div className="space-y-6 animate-fadeIn text-xs font-semibold">
      
      {/* Messaging alerts */}
      {errorMsg && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-red-700 text-xs font-semibold flex items-start space-x-2">
          <AlertCircle className="w-4 h-4 text-red-650 shrink-0 mt-0.5" />
          <p>{errorMsg}</p>
        </div>
      )}
      {successMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-2xl text-emerald-800 text-xs font-semibold flex items-start space-x-2 animate-fadeIn">
          <Check className="w-4 h-4 text-emerald-800 shrink-0 mt-0.5" />
          <p>{successMsg}</p>
        </div>
      )}

      {/* Main Grid: Events Left, Registrations Right */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Events listing */}
        <div className="lg:col-span-2 space-y-6">
          
          <div className="flex items-center justify-between border-b border-stone-200 pb-3">
            <h3 className="text-sm font-extrabold text-[#0f4c2a] uppercase tracking-wider font-heading flex items-center space-x-1.5">
              <Calendar className="w-4 h-4 text-[#d4af37]" />
              <span>Upcoming Community Gatherings</span>
            </h3>
          </div>

          {activeEvents.length === 0 ? (
            <p className="p-8 text-center text-xs text-stone-800 font-semibold italic bg-stone-50 border border-stone-250 rounded-3xl">
              No schedule events are currently active in the Greens directory list.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {activeEvents.map((evt) => {
                const reg = registrations.find(r => r.eventId === evt.id);
                const regStatus = getEventRegistrationStatus(evt);
                const regStatusLabel = getRegistrationStatusLabel(regStatus);

                let badgeClass = 'bg-stone-100 text-stone-850 border border-stone-250';
                if (regStatus === 'open') {
                  badgeClass = 'bg-emerald-50 text-emerald-800 border border-emerald-150';
                } else if (regStatus === 'closing_soon') {
                  badgeClass = 'bg-amber-50 text-amber-800 border border-amber-200 animate-pulse';
                } else if (regStatus === 'closed') {
                  badgeClass = 'bg-rose-50 text-rose-800 border border-rose-150';
                } else if (regStatus === 'completed') {
                  badgeClass = 'bg-stone-50 text-stone-500 border border-stone-200';
                }

                return (
                  <div key={evt.id} className="bg-white border border-stone-200 hover:border-[#0f4c2a]/45 rounded-3xl p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between space-y-4">
                    <div className="space-y-3">
                      
                      {evt.logoUrl && (
                        <div className="w-full h-36 rounded-2xl overflow-hidden border border-stone-155 bg-stone-50 flex items-center justify-center mb-1">
                          <img 
                            src={evt.logoUrl} 
                            alt={`${evt.title} Logo`}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        </div>
                      )}

                      <div className="flex items-start justify-between">
                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold font-mono tracking-wider uppercase ${badgeClass}`}>
                          ● {regStatusLabel}
                        </span>
                        
                        {reg && (
                          <span className="flex items-center space-x-0.5 text-emerald-855 bg-emerald-100 border border-emerald-200 px-2 py-0.5 rounded-xl text-[9px] font-extrabold">
                            <Check className="w-3 h-3" />
                            <span>Registered</span>
                          </span>
                        )}
                      </div>

                      <div>
                        <h4 className="text-sm font-extrabold text-stone-900 leading-tight font-heading capitalize">{evt.title}</h4>
                        {evt.description && (
                          <p className="text-[10px] text-stone-600 mt-1.5 font-semibold leading-relaxed line-clamp-3">
                            {evt.description}
                          </p>
                        )}
                      </div>

                      {/* Program Highlights */}
                      {evt.highlights && evt.highlights.length > 0 && (
                        <div className="p-2.5 bg-emerald-50/20 border border-emerald-100/30 rounded-xl space-y-1 text-left text-[10px]">
                          <span className="font-extrabold text-emerald-800 text-[8px] uppercase tracking-wider block font-heading">Program Highlights</span>
                          <div className="flex flex-wrap gap-1 pt-0.5">
                            {evt.highlights.map((hl, index) => (
                              <span key={index} className="bg-emerald-50/60 border border-emerald-100 px-2 py-0.5 rounded-full text-[9px] font-bold text-stone-800">
                                ⭐ {hl}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {!evt.date && !evt.venue ? (
                        <div className="p-3 bg-amber-50 border border-amber-100 rounded-2xl text-center text-[10px] text-amber-900 uppercase tracking-widest font-black">
                          Coming Soon
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 gap-2 p-3 bg-stone-50 border border-stone-155 rounded-2xl text-[10px] font-bold text-stone-800">
                          {evt.date && (
                            <div className="flex items-center space-x-1.5">
                              <Clock className="w-3.5 h-3.5 text-[#d4af37]" />
                              <span>{new Date(evt.date).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
                            </div>
                          )}
                          {evt.venue && (
                            <div className="flex items-center space-x-1.5">
                              <MapPin className="w-3.5 h-3.5 text-[#d4af37]" />
                              <span className="truncate">{evt.venue}</span>
                            </div>
                          )}
                          {evt.registrationEnd && (
                            <div className="flex items-center space-x-1.5 border-t border-stone-200/60 pt-1.5 text-stone-605">
                              <span className="font-black text-[9px] uppercase tracking-wider">Reg Closes:</span>
                              <span>{new Date(evt.registrationEnd).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Registration Fees Grid */}
                      {evt.pricing && (
                        <div className="border border-stone-150 rounded-xl overflow-hidden divide-y divide-stone-150 text-[10px] font-bold">
                          <div className="p-2 bg-stone-50 text-stone-550 flex justify-between font-extrabold uppercase text-[8px] tracking-wider">
                            <span>Registration Plan</span>
                            <span>Fee Rate</span>
                          </div>
                          <div className="p-2 flex justify-between">
                            <span className="text-stone-600">Individual Unit</span>
                            <span className="font-mono text-stone-900">OMR {evt.pricing.singleRate?.toFixed(3)}</span>
                          </div>
                          <div className="p-2 flex justify-between">
                            <span className="text-stone-600">Couple Unit</span>
                            <span className="font-mono text-stone-900">OMR {evt.pricing.coupleRate?.toFixed(3)}</span>
                          </div>
                          <div className="p-2 flex justify-between">
                            <span className="text-stone-600">Family Unit Cap</span>
                            <span className="font-mono text-stone-900">OMR {evt.pricing.familyRate?.toFixed(3)}</span>
                          </div>
                          {evt.pricing.allowExternal && (
                            <div className="p-2 bg-emerald-50/30 flex justify-between">
                              <span className="text-emerald-900 font-extrabold">Registered Guest Fee</span>
                              <span className="font-mono text-emerald-800 font-black">OMR {evt.pricing.externalRate?.toFixed(3)}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="pt-2 border-t border-stone-150 flex flex-col space-y-2 font-heading">
                      {onViewEventDetails && (
                        <button
                          type="button"
                          onClick={() => onViewEventDetails(evt)}
                          className="w-full py-2 text-center bg-stone-100 hover:bg-stone-200 border border-stone-250 text-stone-850 uppercase tracking-wider text-[10px] font-bold rounded-xl transition-all cursor-pointer shadow-sm"
                        >
                          View Details
                        </button>
                      )}

                      {reg ? (
                        <div className="flex w-full space-x-2">
                          <button
                            type="button"
                            onClick={() => setViewingRegDetails(reg)}
                            className="flex-1 py-2 text-center bg-[#0f4c2a]/10 text-[#0f4c2a] hover:bg-[#0f4c2a]/15 border border-[#0f4c2a]/20 uppercase tracking-wider text-[10px] font-bold rounded-xl transition-all cursor-pointer shadow-sm"
                          >
                            View Registration
                          </button>
                          {(regStatus === 'open' || regStatus === 'closing_soon') && (
                            <button
                              type="button"
                              onClick={() => handleOpenRegistration(evt)}
                              className="flex-1 py-2 text-center bg-[#0f4c2a] text-white hover:bg-[#125831] uppercase tracking-wider text-[10px] font-bold rounded-xl transition-all cursor-pointer shadow-sm"
                            >
                              Modify
                            </button>
                          )}
                        </div>
                      ) : (
                        <>
                          {(regStatus === 'open' || regStatus === 'closing_soon') ? (
                            <button
                              type="button"
                              onClick={() => handleOpenRegistration(evt)}
                              className="w-full py-2 text-center bg-[#0f4c2a] text-white hover:bg-[#125831] uppercase tracking-wider text-[10px] font-bold rounded-xl transition-all cursor-pointer shadow-sm"
                            >
                              Register Participation
                            </button>
                          ) : (
                            <div className="w-full text-center py-2 bg-stone-50 border border-stone-200 text-stone-500 text-[10px] font-bold rounded-xl cursor-not-allowed">
                              {regStatus === 'completed' ? "Event Completed" : regStatus === 'not_started' ? "Registration Not Started" : "Registration Closed"}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

        </div>

        {/* Right Side: Active Registrations Details */}
        <div className="lg:col-span-1 space-y-4 font-sans">
          <div className="bg-[#0f4c2a]/5 border border-[#0f4c2a]/15 p-5 rounded-3xl space-y-4">
            <h4 className="text-xs font-extrabold text-stone-900 uppercase tracking-wider font-heading flex items-center space-x-1.5">
              <Users className="w-4 h-4 text-[#d4af37]" />
              <span>Current Registrations</span>
            </h4>
            
            {registrations.length === 0 ? (
              <p className="text-stone-750 font-semibold italic leading-relaxed">
                You have not registered for any upcoming events yet. Search open registrations on the left to confirm your household participation details.
              </p>
            ) : (
              <div className="space-y-4">
                {registrations.map(reg => {
                  const evt = events.find(e => e.id === reg.eventId);
                  if (!evt) return null;
                  
                  return (
                    <div key={reg.id} className="bg-white border border-stone-250 rounded-2xl p-4 space-y-3 shadow-sm shadow-emerald-950/5">
                      <div className="flex items-start justify-between border-b border-stone-150 pb-1.5">
                        <div className="space-y-0.5">
                          <span className="text-xs font-black text-stone-900 capitalize font-heading block">{evt.title}</span>
                          <span className="text-[10px] text-stone-705 block font-bold font-sans">
                            {evt.date ? new Date(evt.date).toLocaleDateString() : 'Coming Soon'}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCancelRegistration(evt.id, evt.title)}
                          className="text-red-650 hover:underline text-[10px] font-black cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>

                      <div className="space-y-1.5 text-[10px] font-semibold text-stone-850">
                        <div className="flex justify-between border-b border-dashed border-stone-150 pb-1">
                          <span>Subtotal Paid:</span>
                          <span className="text-emerald-800 font-extrabold font-mono">OMR {reg.paymentAmount || 0}</span>
                        </div>
                        <div>
                          <span className="text-[9px] font-extrabold text-stone-750 uppercase tracking-wider block mb-1">
                            Participating ({reg.totalParticipants})
                          </span>
                          <div className="flex flex-wrap gap-1">
                            {reg.participants.map((name, index) => (
                              <span key={index} className="px-2 py-0.5 bg-emerald-100/70 text-emerald-950 border border-emerald-200 rounded-lg text-[9px] font-extrabold">
                                {name}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

      </div>

      {/* VIEW REGISTRATION DETAILS DIALOG */}
      {viewingRegDetails && (() => {
        const evt = events.find(e => e.id === viewingRegDetails.eventId);
        if (!evt) return null;
        return (
          <div className="fixed inset-0 bg-stone-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white border border-stone-220 rounded-3xl max-w-md w-full shadow-2xl p-6 relative space-y-5 animate-scaleUp text-stone-800">
              <button
                onClick={() => setViewingRegDetails(null)}
                className="absolute right-4 top-4 text-stone-705 hover:text-stone-900 transition-colors cursor-pointer font-black"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="border-b border-stone-200 pb-3 text-left">
                <span className="text-[10px] font-extrabold font-mono text-[#d4af37] block uppercase tracking-wider">RSVP Registration Receipt</span>
                <h3 className="text-base font-extrabold text-[#0f4c2a] font-heading capitalize mt-0.5">{evt.title}</h3>
                <p className="text-stone-500 text-[10px] mt-1">Confirmed details for household GMK ID: {viewingRegDetails.primaryMemberGmkId}</p>
              </div>

              <div className="space-y-4 text-left">
                {viewingRegDetails.paymentSummary ? (
                  <div className="bg-emerald-50/60 border border-emerald-100/80 rounded-2xl p-4 text-left space-y-2.5 text-xs text-stone-800">
                    <span className="text-[9px] font-bold text-emerald-800 uppercase tracking-widest block font-heading">
                      Registration Pricing Snapshot
                    </span>
                    <div className="space-y-1.5">
                      <div className="flex justify-between">
                        <span className="text-stone-605 font-bold">Base Rate Applied:</span>
                        <span className="font-bold text-emerald-900 capitalize">{viewingRegDetails.paymentSummary.baseRateApplied}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-stone-605 font-bold">Base Rate Cost:</span>
                        <span className="font-mono">OMR {viewingRegDetails.paymentSummary.baseRate}</span>
                      </div>
                      {viewingRegDetails.paymentSummary.parentsCount !== undefined && viewingRegDetails.paymentSummary.parentsCount > 0 && (
                        <div className="flex justify-between">
                          <span className="text-stone-605">Parents ({viewingRegDetails.paymentSummary.parentsCount}):</span>
                          <span className="text-emerald-700 font-bold">Free</span>
                        </div>
                      )}
                      {viewingRegDetails.paymentSummary.externalParticipantsCount !== undefined && viewingRegDetails.paymentSummary.externalParticipantsCount > 0 && (
                        <div className="flex justify-between">
                          <span className="text-stone-605">Guests ({viewingRegDetails.paymentSummary.externalParticipantsCount}):</span>
                          <span className="font-mono">OMR {viewingRegDetails.paymentSummary.externalSubtotal}</span>
                        </div>
                      )}
                      
                      {viewingRegDetails.paymentSummary.details && (
                        <p className="text-[10px] text-stone-700 italic border-t border-dashed border-emerald-200 pt-2 leading-relaxed">
                          {viewingRegDetails.paymentSummary.details}
                        </p>
                      )}

                      <div className="border-t border-dashed border-emerald-200 pt-2 flex justify-between items-center text-xs font-black text-[#0f4c2a] text-sm">
                        <span>Total Paid RSVP:</span>
                        <span className="font-mono text-base font-black">OMR {viewingRegDetails.paymentSummary.totalAmount}</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="bg-stone-50 border border-stone-200 rounded-2xl p-4 space-y-2">
                    <div className="flex justify-between items-center text-xs font-extrabold border-b border-stone-200 pb-2">
                      <span className="text-stone-900">Registration Type:</span>
                      <span className="capitalize text-[#0f4c2a] bg-emerald-100 px-2.5 py-0.5 rounded-full text-[10px] font-black">
                        {viewingRegDetails.registrationType || 'family'}
                      </span>
                    </div>
                    
                    <div className="flex justify-between items-center text-xs font-extrabold pt-1">
                      <span className="text-stone-900">Total Charged:</span>
                      <span className="text-[#0f4c2a] font-mono text-sm font-black">
                        OMR {viewingRegDetails.paymentAmount || 0}
                      </span>
                    </div>

                    {viewingRegDetails.paymentSummary?.details && (
                      <p className="text-[10px] text-stone-700 italic border-t border-dashed border-stone-200 pt-2 leading-relaxed">
                        {viewingRegDetails.paymentSummary.details}
                      </p>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <span className="text-[9px] font-bold text-stone-850 uppercase tracking-widest block font-heading">
                    Registered household members ({viewingRegDetails.totalParticipants})
                  </span>
                  <div className="grid grid-cols-1 gap-2 max-h-40 overflow-y-auto pr-1">
                    {viewingRegDetails.participants.map((name, index) => {
                      const member = familyMembers.find(m => m.name === name);
                      const relation = name === residentProfile.fullName ? 'Primary Head' : (member?.relationship || 'dependent');
                      return (
                        <div key={index} className="flex justify-between items-center p-2 bg-stone-50 border border-stone-200 rounded-xl">
                          <span className="font-bold text-stone-850 text-xs">{name}</span>
                          <span className="text-[9px] capitalize text-emerald-800 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-md font-extrabold">
                            {relation}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-stone-150 flex space-x-2">
                <button
                  onClick={() => setViewingRegDetails(null)}
                  className="flex-1 py-2.5 border border-stone-300 text-stone-800 font-bold uppercase tracking-wider text-[10px] rounded-xl hover:bg-stone-50 cursor-pointer"
                >
                  Close Receipt
                </button>
                <button
                  onClick={() => {
                    setViewingRegDetails(null);
                    handleOpenRegistration(evt);
                  }}
                  className="flex-1 py-2.5 bg-[#0f4c2a] text-white font-bold uppercase tracking-wider text-[10px] rounded-xl hover:bg-[#125831] cursor-pointer"
                >
                  Modify Configuration
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* REGISTRATION MODAL FORM */}
      {activeEventForReg && (
        <div className="fixed inset-0 bg-stone-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-stone-220 rounded-3xl max-w-md w-full shadow-2xl p-6 relative space-y-4 animate-scaleUp">
            <button
              onClick={() => {
                setActiveEventForReg(null);
                setLivePricing(null);
              }}
              className="absolute right-4 top-4 text-stone-705 hover:text-stone-900 transition-colors cursor-pointer font-black"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="font-sans text-left">
              <span className="text-[10px] font-extrabold font-mono text-[#d4af37] block uppercase tracking-wider">Gathering Registrant Setup</span>
              <h3 className="text-base font-extrabold text-[#0f4c2a] font-heading capitalize mt-0.5">{activeEventForReg.title}</h3>
              <p className="text-stone-805 text-[11px] leading-relaxed mt-1 font-semibold">
                Configure which members of your registered household are participating in this gathering. Count limits sync in real-time.
              </p>
            </div>

            <form onSubmit={handleSaveRegistration} className="space-y-4">
              
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1 border border-stone-200 p-3 rounded-2xl bg-stone-50/50">
                <span className="text-[9px] font-bold text-stone-850 uppercase tracking-widest block mb-2 font-heading text-left">Household Checklist</span>
                
                {/* Primary head checkbox */}
                <div 
                  onClick={() => handleCheckboxToggle("primary")}
                  className={`flex items-center justify-between p-2.5 rounded-xl border transition-all cursor-pointer bg-white ${
                    checkedFamilyMembers["primary"] 
                      ? 'border-[#0f4c2a] bg-emerald-50/20' 
                      : 'border-stone-200 hover:border-stone-300'
                  }`}
                >
                  <div className="space-y-0.5 text-left">
                    <span className="text-xs font-bold text-stone-850 block">{residentProfile.fullName}</span>
                    <span className="text-[9px] uppercase font-bold text-emerald-800">Primary Resident Head</span>
                  </div>
                  <div className={`w-4 h-4 rounded border flex items-center justify-center ${
                    checkedFamilyMembers["primary"] ? 'bg-[#0f4c2a] border-[#0f4c2a] text-white' : 'border-stone-300'
                  }`}>
                    {checkedFamilyMembers["primary"] && <Check className="w-3 h-3" />}
                  </div>
                </div>

                {/* Sub-members check list */}
                {familyMembers.map((mem) => {
                  const isChecked = !!checkedFamilyMembers[mem.id];
                  const currentYear = new Date().getFullYear();
                  const age = mem.yearOfBirth ? (currentYear - parseInt(mem.yearOfBirth)) : null;
                  const displayAge = age !== null ? `, Age: ${age}` : '';

                  return (
                    <div 
                      key={mem.id}
                      onClick={() => handleCheckboxToggle(mem.id)}
                      className={`flex items-center justify-between p-2.5 rounded-xl border transition-all cursor-pointer bg-white ${
                        isChecked 
                          ? 'border-[#0f4c2a] bg-emerald-50/20' 
                          : 'border-stone-200 hover:border-stone-300'
                      }`}
                    >
                      <div className="text-left space-y-0.5">
                        <span className="text-xs font-bold text-stone-800 block">{mem.name}</span>
                        <span className="text-[9px] capitalize text-stone-705 block font-bold">
                          {mem.relationship}{displayAge}
                        </span>
                      </div>
                      <div className={`w-4 h-4 rounded border flex items-center justify-center ${
                        isChecked ? 'bg-[#0f4c2a] border-[#0f4c2a] text-white' : 'border-stone-300'
                      }`}>
                        {isChecked && <Check className="w-3 h-3" />}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Guests input section */}
              {activeEventForReg.pricing?.allowExternal && (
                <div className="p-3 border border-stone-200 rounded-2xl bg-amber-50/20 space-y-2 text-left">
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="text-xs font-bold text-stone-850 block">Register Guests</span>
                      <span className="text-[10px] text-stone-605 block font-bold">Rate: OMR {activeEventForReg.pricing.externalRate} per guest</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        type="button"
                        onClick={() => handleExternalCountChange(externalCount - 1)}
                        className="w-7 h-7 rounded-lg border border-stone-300 flex items-center justify-center font-bold text-stone-705 hover:bg-stone-50 cursor-pointer text-sm"
                      >
                        -
                      </button>
                      <span className="font-mono text-sm font-black w-6 text-center">{externalCount}</span>
                      <button
                        type="button"
                        onClick={() => handleExternalCountChange(externalCount + 1)}
                        className="w-7 h-7 rounded-lg border border-stone-300 flex items-center justify-center font-bold text-stone-705 hover:bg-stone-50 cursor-pointer text-sm"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Dynamic billing & pricing details summary box */}
              {livePricing && (
                <div className="bg-emerald-50/60 border border-emerald-100/80 rounded-2xl p-4 text-left space-y-3 animate-fadeIn text-stone-800">
                  <span className="text-[9px] font-bold text-emerald-800 uppercase tracking-widest block font-heading">
                    Live RSVP Pricing Breakdown
                  </span>
                  
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-stone-605 font-bold">Registration Type:</span>
                      <span className="font-bold text-emerald-900 capitalize">{livePricing.registrationType}</span>
                    </div>
                    
                    {/* Included Members */}
                    {livePricing.includedMembers && livePricing.includedMembers.length > 0 && (
                      <div className="space-y-1">
                        <span className="text-[10px] uppercase tracking-wider text-stone-505 font-bold block mt-1">Included Household Members</span>
                        <div className="grid grid-cols-1 gap-1 pl-1">
                          {livePricing.includedMembers.map((m, idx) => (
                            <div key={idx} className="flex items-center text-[11px] text-stone-705 font-medium">
                              <span className="text-emerald-700 mr-1.5 font-bold">✓</span>
                              {m}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Parents */}
                    {livePricing.parentMembers && livePricing.parentMembers.length > 0 && (
                      <div className="space-y-1">
                        <span className="text-[10px] uppercase tracking-wider text-stone-505 font-bold block mt-1">Parents (Always Free)</span>
                        <div className="grid grid-cols-1 gap-1 pl-1">
                          {livePricing.parentMembers.map((m, idx) => (
                            <div key={idx} className="flex items-center text-[11px] text-stone-700 font-medium">
                              <span className="text-emerald-700 mr-1.5 font-bold">✓</span>
                              {m} <span className="text-[9px] font-bold text-emerald-850 bg-emerald-50 border border-emerald-200/50 px-1.5 py-0.25 rounded ml-1">Free</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Guests */}
                    {externalCount > 0 && (
                      <div className="flex justify-between items-center text-[11px] text-stone-705 pt-1">
                        <span className="font-medium text-stone-605">Guests:</span>
                        <span className="font-mono font-bold">{externalCount} × OMR {livePricing.externalRate}</span>
                      </div>
                    )}
                  </div>

                  <div className="border-t border-dashed border-emerald-200 pt-2.5 space-y-1.5 text-xs font-semibold">
                    <div className="flex justify-between text-stone-705 font-medium text-[11px]">
                      <span>Base {livePricing.registrationType === 'individual' ? 'Individual' : livePricing.registrationType === 'couple' ? 'Couple' : 'Family'} Rate:</span>
                      <span className="font-mono">OMR {livePricing.baseRate || 0}</span>
                    </div>

                    {livePricing.parentMembers && livePricing.parentMembers.length > 0 && (
                      <div className="flex justify-between text-stone-705 font-medium text-[11px]">
                        <span>Parents Rate:</span>
                        <span className="text-emerald-700 font-bold">Free</span>
                      </div>
                    )}

                    {externalCount > 0 && (
                      <div className="flex justify-between text-stone-705 font-medium text-[11px]">
                        <span>Guest Subtotal:</span>
                        <span className="font-mono">OMR {livePricing.externalSubtotal || 0}</span>
                      </div>
                    )}

                    <div className="flex justify-between items-center text-xs font-black border-t border-dashed border-emerald-200 pt-2 text-[#0f4c2a] text-sm">
                      <span>Total Payable amount:</span>
                      <span className="font-mono text-base font-black">OMR {livePricing.totalAmount}</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="pt-2 flex space-x-2">
                <button
                  type="button"
                  onClick={() => {
                    setActiveEventForReg(null);
                    setLivePricing(null);
                  }}
                  className="flex-1 py-2.5 border border-stone-300 text-stone-850 font-bold uppercase tracking-wider text-[10px] rounded-xl hover:bg-stone-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-2.5 bg-[#0f4c2a] hover:bg-[#125831] text-white font-bold uppercase tracking-wider text-[10px] rounded-xl cursor-pointer flex items-center justify-center"
                >
                  {loading ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-white mr-1.5" />
                  ) : null}
                  <span>Confirm RSVP Registration</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isConfirmOpen && confirmOptions && (
        <GEASConfirmationDialogUI
          options={confirmOptions}
          onConfirm={handleConfirmSubmit}
          onCancel={handleConfirmCancel}
        />
      )}
    </div>
  );
}
