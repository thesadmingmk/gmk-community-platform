import React, { useState, useEffect } from 'react';
import { db, auth, useAuth } from '../../context/AuthContext';
import { collection, query, where, onSnapshot, doc, writeBatch, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { CommunityEvent, EventRegistration, Family, FamilyMember, ResidentProfile } from '../../types';
import { Calendar, Check, Clock, AlertCircle, RefreshCw, X, Users, MapPin, ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react';
import { createAuditLog } from '../../utils/audit';
import { useLocalGEASConfirmation, GEASConfirmationDialogUI } from '../gmk/GEASConfirmationDialog';
import { getEventRegistrationStatus, getRegistrationStatusLabel } from '../../utils/eventLifecycle';
import { handleFirestoreError, OperationType } from '../../utils/firestoreError';

interface EventsManagerProps {
  residentProfile: ResidentProfile;
  onViewEventDetails?: (evt: CommunityEvent) => void;
}

export default function EventsManager({ residentProfile, onViewEventDetails }: EventsManagerProps) {
  const { profile } = useAuth();
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
  const [showingPaymentModalEvent, setShowingPaymentModalEvent] = useState<{ evt: CommunityEvent; reg?: EventRegistration } | null>(null);
  const [showingPricingModalEvent, setShowingPricingModalEvent] = useState<CommunityEvent | null>(null);
  
  // Registration form selections
  const [checkedFamilyMembers, setCheckedFamilyMembers] = useState<Record<string, boolean>>({});
  const [externalCount, setExternalCount] = useState<number>(0);
  const [isPricingExpanded, setIsPricingExpanded] = useState<boolean>(false);

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
    let othersCount = 0;

    const includedMembers: string[] = [];
    const parentMembers: string[] = [];
    const otherMembers: string[] = [];
    const freeChildrenMembers: string[] = [];

    const freeChildAge = pricing.freeChildAge ?? 5;
    const parentRate = pricing.parentRate ?? 5;
    const otherRate = pricing.otherRate ?? 5;

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
            if (age < freeChildAge) {
              kidsBelowFreeAge++;
              freeChildrenMembers.push(`${mem.name} (Age ${age})`);
              includedMembers.push(`${mem.name} (Age ${age}, Free)`);
            } else {
              kidsAboveFreeAge++;
              includedMembers.push(`${mem.name} (Age ${age})`);
            }
          } else {
            kidsAboveFreeAge++;
            includedMembers.push(mem.name);
          }
        } else {
          // dependent or other relationship
          othersCount++;
          otherMembers.push(mem.name);
        }
      }
    });

    // 1. Determine household/spouse composition to figure out base pricing
    let registrationType: 'individual' | 'couple' | 'family' = 'individual';
    let baseRate = 0;

    const spousesCount = (hasResident ? 1 : 0) + (hasSpouse ? 1 : 0);

    const singleRate = pricing.singleRate ?? 10;
    const coupleRate = pricing.coupleRate ?? 20;
    const familyRate = pricing.familyRate ?? 25;

    if (spousesCount === 2) {
      // Both spouses attending
      if (kidsBelowFreeAge > 0 || kidsAboveFreeAge > 0) {
        registrationType = 'family';
        baseRate = familyRate;
      } else {
        registrationType = 'couple';
        baseRate = coupleRate;
      }
    } else if (spousesCount === 1) {
      // Single adult (or resident only, or single parent)
      if (kidsAboveFreeAge > 0) {
        // At least one child above Free Age attends -> Couple Rate (Single Parent Rule)
        registrationType = 'couple';
        baseRate = coupleRate;
      } else if (kidsBelowFreeAge > 0) {
        // All children are below Free Age -> Individual Rate
        registrationType = 'individual';
        baseRate = singleRate;
      } else {
        // Just the resident/spouse alone -> Individual Rate
        registrationType = 'individual';
        baseRate = singleRate;
      }
    } else {
      // spousesCount === 0 (e.g. only kids or parents checked without primary/spouse)
      if (kidsAboveFreeAge > 0) {
        registrationType = 'couple';
        baseRate = coupleRate;
      } else {
        registrationType = 'individual';
        baseRate = singleRate;
      }
    }

    // Additional subtotals
    const parentsSubtotal = parentsCount * parentRate;
    const othersSubtotal = othersCount * otherRate;

    // External participants (Guests)
    const allowExternal = pricing.allowExternal ?? false;
    const externalRate = allowExternal ? (pricing.externalRate ?? 10) : 0;
    const externalSubtotal = extCount * externalRate;

    const totalAmount = baseRate + parentsSubtotal + othersSubtotal + externalSubtotal;

    // Craft transparent breakdown details string
    const detailsParts: string[] = [];
    if (registrationType === 'individual') {
      detailsParts.push(`Base Registration (Individual): OMR ${baseRate}`);
    } else if (registrationType === 'couple') {
      if (spousesCount === 1 && kidsAboveFreeAge > 0) {
        detailsParts.push(`Base Registration (Couple - Single Parent Rule): OMR ${baseRate}`);
      } else {
        detailsParts.push(`Base Registration (Couple): OMR ${baseRate}`);
      }
    } else {
      detailsParts.push(`Base Registration (Family): OMR ${baseRate}`);
    }

    if (parentsCount > 0) {
      detailsParts.push(`Parents: ${parentsCount} × OMR ${parentRate} = OMR ${parentsSubtotal}`);
    }
    if (othersCount > 0) {
      detailsParts.push(`Others: ${othersCount} × OMR ${otherRate} = OMR ${othersSubtotal}`);
    }
    if (extCount > 0 && allowExternal) {
      detailsParts.push(`Guests: ${extCount} × OMR ${externalRate} = OMR ${externalSubtotal}`);
    }
    if (kidsBelowFreeAge > 0) {
      detailsParts.push(`Children below ${freeChildAge} years: FREE`);
    }

    const detailsStr = detailsParts.join(' | ');

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
      parentRate,
      parentsSubtotal,
      othersCount,
      otherRate,
      othersSubtotal,
      externalCount: extCount,
      externalRate,
      externalSubtotal,
      includedMembers,
      parentMembers,
      otherMembers,
      freeChildrenMembers
    };
  };

  const handleOpenRegistration = (evt: CommunityEvent) => {
    setActiveEventForReg(evt);
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsPricingExpanded(false);

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

    console.log("[RTCO-024L STEP 01] Registration function entered");
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
      // Identity & Ownership Gate: Enforce that the registration belongs to the authenticated resident
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error("Authentication error: You must be logged in to register for events.");
      }

      const authEmail = (currentUser.email || '').toLowerCase().trim();
      const residentEmail = (residentProfile.email || '').toLowerCase().trim();
      const residentGmkId = (residentProfile.gmkId || '').trim();

      if (!residentGmkId || !residentEmail) {
        throw new Error("Access Denied: Invalid resident profile credentials.");
      }

      // Ensure that non-administrative users register under their own verified identity
      const userRoles = profile?.roles || ['resident'];
      const isExecutiveAdmin = userRoles.some((r: string) => 
        ['super_admin', 'admin', 'event_director'].includes(r)
      );

      if (!isExecutiveAdmin && authEmail && residentEmail && authEmail !== residentEmail) {
        throw new Error("Access Denied: You are not authorized to create a registration for another resident.");
      }

      const familyId = `fam_${residentGmkId}`;
      const regId = `reg_${residentGmkId}_${activeEventForReg.id}`;

      // Step A: READ PHASE
      console.log("[RTCO-024L STEP 02] Family/profile loading");
      console.log(`[FAMILY LOADING] Fetching family document: ${familyId}`);
      const familyDocRef = doc(db, "families", familyId);
      
      let familySnap;
      try {
        familySnap = await getDoc(familyDocRef);
      } catch (famErr: any) {
        console.error("[RTCO-024L FAILURE]", {
          step: "STEP 02",
          operation: "READ",
          path: `families/${familyId}`,
          errorCode: famErr?.code,
          errorMessage: famErr?.message,
          errorName: famErr?.name
        });
        throw famErr;
      }

      if (!familySnap.exists()) {
        throw new Error("Your registration could not be completed because your family profile is unavailable. Please contact a GMK Administrator.");
      }
      
      const familyData = familySnap.data() as Family;
      if (!familyData.onboardingCompleted) {
        throw new Error("Your registration could not be completed because your family onboarding wizard is incomplete.");
      }
      console.log(`[FAMILY LOADED] Successfully loaded family data. Onboarding status: ${familyData.onboardingCompleted}`);
      console.log("[RTCO-024L STEP 03] Family/profile validation passed");

      // Calculate final pricing
      console.log(`[PRICING CALCULATION] Calculating final cost structure...`);
      const pricingResult = calculatePricing(activeEventForReg, checkedFamilyMembers, externalCount);
      if (pricingResult.totalAmount === 0 && activeEventForReg.pricing) {
        throw new Error("Billing system is temporarily offline. Please contact GMK support.");
      }
      console.log(`[PRICING CALCULATED] Final calculated fee: OMR ${pricingResult.totalAmount} (${pricingResult.registrationType})`);
      console.log("[RTCO-024L STEP 04] Pricing calculation passed");

      // Sync state calculations
      const oldReg = registrations.find(r => r.eventId === activeEventForReg.id);
      const oldTotal = oldReg ? oldReg.totalParticipants : 0;
      const oldRevenue = oldReg ? (oldReg.paymentAmount || 0) : 0;

      const diffParticipants = (participantsList.length + externalCount) - oldTotal;
      const diffRevenue = pricingResult.totalAmount - oldRevenue;

      // Step B: PREPARE RESIDENT-OWNED PAYLOADS
      const regPayload: any = {
        id: regId,
        eventId: activeEventForReg.id,
        familyId,
        primaryMemberGmkId: residentGmkId,
        primaryMemberEmail: residentEmail,
        participants: participantsList,
        totalParticipants: participantsList.length + externalCount,
        createdAt: oldReg ? oldReg.createdAt : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        registrationType: pricingResult.registrationType,
        paymentAmount: pricingResult.totalAmount,
        paymentStatus: 'pending',
        qrCode: null,
        paymentSummary: {
          baseRate: pricingResult.baseRate || 0,
          baseRateApplied: pricingResult.registrationType,
          childrenCount: pricingResult.breakdown.freeChildren + pricingResult.breakdown.halfPriceChildren,
          freeChildrenCount: pricingResult.breakdown.freeChildren,
          halfPriceChildrenCount: pricingResult.breakdown.halfPriceChildren,
          parentsCount: pricingResult.parentsCount,
          parentRate: pricingResult.parentRate || 5,
          parentsSubtotal: pricingResult.parentsSubtotal || 0,
          othersCount: pricingResult.othersCount || 0,
          otherRate: pricingResult.otherRate || 5,
          othersSubtotal: pricingResult.othersSubtotal || 0,
          externalParticipantsCount: externalCount,
          externalParticipantRate: pricingResult.externalRate,
          externalSubtotal: pricingResult.externalSubtotal,
          totalAmount: pricingResult.totalAmount,
          details: pricingResult.details,
          includedMembers: pricingResult.includedMembers || [],
          parentMembers: pricingResult.parentMembers || [],
          otherMembers: pricingResult.otherMembers || [],
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

      const currentUid = auth.currentUser?.uid || profile?.uid || "";

      const attPayload = {
        id: `att_${residentGmkId}_${activeEventForReg.id}`,
        eventId: activeEventForReg.id,
        uid: currentUid,
        gmkId: residentGmkId,
        email: residentEmail,
        fullName: residentProfile.fullName,
        status: 'registered',
        createdAt: oldReg ? oldReg.createdAt : new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const foodPayload = {
        id: `food_${residentGmkId}_${activeEventForReg.id}`,
        eventId: activeEventForReg.id,
        uid: auth.currentUser?.uid || currentUid,
        gmkId: residentGmkId,
        email: auth.currentUser?.email || residentEmail,
        fullName: residentProfile.fullName,
        mealCouponStatus: 'issued',
        mealCount: { 'standard': participantsList.length + externalCount },
        createdAt: oldReg ? oldReg.createdAt : new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // Check current Firestore existence
      const regDocRef = doc(db, "event_registrations", regId);
      const attDocRef = doc(db, "eventAttendance", attPayload.id);
      const foodDocRef = doc(db, "eventFood", foodPayload.id);

      let regSnap, attSnap, foodSnap;
      try {
        [regSnap, attSnap, foodSnap] = await Promise.all([
          getDoc(regDocRef),
          getDoc(attDocRef),
          getDoc(foodDocRef)
        ]);
      } catch (checkErr: any) {
        console.error("[RTCO-024L FAILURE]", {
          step: "STEP 02 (PRE-CHECK DOCS)",
          operation: "READ",
          path: `event_registrations/${regId} | eventAttendance/${attPayload.id} | eventFood/${foodPayload.id}`,
          errorCode: checkErr?.code,
          errorMessage: checkErr?.message,
          errorName: checkErr?.name
        });
        throw checkErr;
      }

      const registrationExists = regSnap.exists();
      const attendanceExists = attSnap.exists();
      const foodExists = foodSnap.exists();

      const regOp = registrationExists ? "UPDATE" : "CREATE";
      const attOp = attendanceExists ? "UPDATE" : "CREATE";
      const foodOp = foodExists ? "UPDATE" : "CREATE";

      // Identity & Ownership Diagnostic Logging
      const authUid = currentUser.uid;
      const userGmkId = profile?.gmkId || residentGmkId;
      const userEmail = profile?.email || residentEmail || authEmail;
      const roles = profile?.roles || userRoles;

      console.log("[FIREBASE RUNTIME CONFIG]", {
        firebaseProjectId: db.app.options.projectId,
        firebaseDatabaseId: (db.app.options as any).databaseId || '(default)',
        firestoreInstance: db ? "INITIALIZED" : "NULL"
      });

      console.log("[REGISTRATION AUTHENTICATED USER IDENTITY]", {
        AUTH_UID: authUid,
        AUTH_EMAIL: authEmail,
        USER_GMK_ID: userGmkId,
        USER_EMAIL: userEmail,
        USER_ROLES: roles
      });

      console.log("[REGISTRATION PAYLOAD IDENTITY]", {
        PRIMARY_MEMBER_GMK_ID: regPayload.primaryMemberGmkId,
        PRIMARY_MEMBER_EMAIL: regPayload.primaryMemberEmail
      });

      // Verification of ownership if updating existing document
      if (registrationExists) {
        const existingData = regSnap.data();
        const isOwner = (existingData?.primaryMemberGmkId && existingData.primaryMemberGmkId === residentGmkId) ||
                        (existingData?.primaryMemberEmail && existingData.primaryMemberEmail.toLowerCase().trim() === authEmail);
        if (!isOwner && !isExecutiveAdmin) {
          throw new Error("Access Denied: You are not authorized to update another resident's registration.");
        }
      }

      // STEP 5: CREATE REGISTRATION
      console.log("[RTCO-024L STEP 05] event_registrations setDoc START", `event_registrations/${regId}`);
      try {
        await setDoc(regDocRef, regPayload);
        console.log("[RTCO-024L STEP 05] event_registrations setDoc SUCCESS");
      } catch (step5Err: any) {
        console.error("[RTCO-024L FAILURE]", {
          step: "STEP 05",
          operation: regOp,
          path: `event_registrations/${regId}`,
          errorCode: step5Err?.code,
          errorMessage: step5Err?.message,
          errorName: step5Err?.name
        });
        throw step5Err;
      }

      // STEP 6: CREATE ATTENDANCE
      console.log("[RTCO-024L STEP 06] eventAttendance setDoc START", `eventAttendance/${attPayload.id}`);
      try {
        console.log("[RTCO-024P ACTUAL ATTENDANCE PAYLOAD]", JSON.stringify(attPayload));
        console.log("[RTCO-024P CLIENT AUTH UID]", auth.currentUser?.uid);
        console.log("[RTCO-024P CLIENT AUTH EMAIL]", auth.currentUser?.email);
        console.log("[RTCO-024P PAYLOAD UID]", attPayload.uid);
        console.log("[RTCO-024P UID EQUALITY]", {
          payloadUid: attPayload.uid,
          authUid: auth.currentUser?.uid,
          equal: attPayload.uid === auth.currentUser?.uid
        });

        const existingAtt = await getDoc(attDocRef);
        console.log("[RTCO-024P ATTENDANCE EXISTENCE]", {
          exists: existingAtt.exists(),
          path: attDocRef.path
        });

        console.log("[RTCO-024P FIREBASE TARGET]", {
          projectId: db.app.options.projectId,
          databaseId: (db.app.options as any).databaseId || '(default)',
          firestoreInstance: "INITIALIZED"
        });

        await setDoc(attDocRef, attPayload);
        console.log("[RTCO-024L STEP 06] eventAttendance setDoc SUCCESS");
      } catch (step6Err: any) {
        console.error("[RTCO-024L FAILURE]", {
          step: "STEP 06",
          operation: attOp,
          path: `eventAttendance/${attPayload.id}`,
          errorCode: step6Err?.code,
          errorMessage: step6Err?.message,
          errorName: step6Err?.name
        });
        // Compensation: rollback step 5 registration
        try {
          await deleteDoc(regDocRef);
          console.log("[RTCO-024L ROLLBACK SUCCESS] deleted event_registrations doc");
        } catch (rbErr: any) {
          console.error("[RTCO-024L ROLLBACK FAILURE] event_registrations delete failed:", rbErr);
        }
        throw step6Err;
      }

      // STEP 7: CREATE FOOD
      console.log("[RTCO-024L STEP 07] eventFood setDoc START", `eventFood/${foodPayload.id}`);
      try {
        await setDoc(foodDocRef, foodPayload);
        console.log("[RTCO-024L STEP 07] eventFood setDoc SUCCESS");
      } catch (step7Err: any) {
        console.error("[RTCO-024L FAILURE]", {
          step: "STEP 07",
          operation: foodOp,
          path: `eventFood/${foodPayload.id}`,
          errorCode: step7Err?.code,
          errorMessage: step7Err?.message,
          errorName: step7Err?.name
        });
        // Compensation: rollback step 6 attendance and step 5 registration
        try {
          await deleteDoc(attDocRef);
          console.log("[RTCO-024L ROLLBACK SUCCESS] deleted eventAttendance doc");
        } catch (rbErr: any) {
          console.error("[RTCO-024L ROLLBACK FAILURE] eventAttendance delete failed:", rbErr);
        }
        try {
          await deleteDoc(regDocRef);
          console.log("[RTCO-024L ROLLBACK SUCCESS] deleted event_registrations doc");
        } catch (rbErr: any) {
          console.error("[RTCO-024L ROLLBACK FAILURE] event_registrations delete failed:", rbErr);
        }
        throw step7Err;
      }

      console.log("[RTCO-024L STEP 08] Registration core writes completed");

      // Save references for UI notification
      const savedEventTitle = activeEventForReg.title;
      const totalParticipantsCount = regPayload.totalParticipants;
      const paymentAmountVal = regPayload.paymentAmount;

      // STEP 9: AGGREGATE / POST-REGISTRATION PROCESSING (NON-BLOCKING)
      console.log("[RTCO-024L STEP 09] Aggregate/post-registration processing START");
      try {
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

        const eventRef = doc(db, "events", activeEventForReg.id);
        let updatedAttendees = [...(activeEventForReg.attendees || [])];
        if (!updatedAttendees.includes(residentEmail)) {
          updatedAttendees.push(residentEmail);
        }

        const statsBatch = writeBatch(db);
        statsBatch.set(reportDocRef, reportPayload, { merge: true });
        statsBatch.set(finDocRef, finPayload, { merge: true });
        statsBatch.set(eventRef, { attendees: updatedAttendees }, { merge: true });
        await statsBatch.commit();
        console.log("[RTCO-024L STEP 09] Aggregate/post-registration processing SUCCESS");
      } catch (statsErr: any) {
        console.error("[RTCO-024L FAILURE - NON-BLOCKING POST-REGISTRATION]", {
          step: "STEP 09",
          operation: "AGGREGATE_UPDATE",
          path: "eventReports / eventFinance / events",
          errorCode: statsErr?.code,
          errorMessage: statsErr?.message,
          errorName: statsErr?.name
        });
      }

      // Audit Log (Non-blocking)
      const actionType = oldReg ? 'EVENT_REGISTRATION_UPDATED' : 'EVENT_REGISTERED';
      try {
        await createAuditLog(
          actionType,
          residentEmail,
          'registration',
          regId,
          `Resident unit registered ${totalParticipantsCount} participants for event '${savedEventTitle}' (Payment: OMR ${paymentAmountVal}).`
        );
      } catch (auditErr: any) {
        console.error("[RTCO-024L FAILURE - NON-BLOCKING AUDIT LOG]", {
          step: "STEP 09 (AUDIT LOG)",
          operation: "CREATE_AUDIT_LOG",
          path: "audit_logs",
          errorCode: auditErr?.code,
          errorMessage: auditErr?.message,
          errorName: auditErr?.name
        });
      }

      // STEP 10: UI STATE UPDATE
      console.log("[RTCO-024L STEP 10] UI state update START");
      try {
        setActiveEventForReg(null);
        setLivePricing(null);
        setSuccessMsg(`✓ Successfully registered ${totalParticipantsCount} member(s) of your family for ${savedEventTitle}!`);
        console.log("[RTCO-024L STEP 10] UI state update SUCCESS");
        console.log("[RTCO-024L COMPLETE] REGISTRATION SUCCESS");
      } catch (uiErr: any) {
        console.error("[RTCO-024L FAILURE]", {
          step: "STEP 10",
          operation: "UI_STATE_UPDATE",
          path: "UI",
          errorCode: uiErr?.code,
          errorMessage: uiErr?.message,
          errorName: uiErr?.name
        });
      }
    } catch (err: any) {
      console.error("❌ Core event registration failed:", err);
      const cleanError = err.message || "A verification error occurred during transaction processing. Please contact your GMK Administrator.";
      setErrorMsg(cleanError.includes("Missing or insufficient permissions") 
        ? "Access Denied: You do not have authorization to complete this event registration. Please contact your administrator."
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
      console.log(`[REGISTRATION CANCEL 01] Authenticated resident verified: GMK ID ${residentProfile.gmkId} (${residentProfile.email})`);

      const regId = `reg_${residentProfile.gmkId}_${eventId}`;
      const attId = `att_${residentProfile.gmkId}_${eventId}`;
      const foodId = `food_${residentProfile.gmkId}_${eventId}`;

      const regRef = doc(db, "event_registrations", regId);
      const attRef = doc(db, "eventAttendance", attId);
      const foodRef = doc(db, "eventFood", foodId);

      // STEP 1: READ ALL REQUIRED DOCUMENTS BEFORE ANY BATCH WRITES
      console.log(`[REGISTRATION CANCEL 02] Performing pre-reads for reg: ${regId}, att: ${attId}, food: ${foodId}`);
      const [regSnap, attSnap, foodSnap] = await Promise.all([
        getDoc(regRef),
        getDoc(attRef),
        getDoc(foodRef)
      ]);

      if (!regSnap.exists()) {
        throw new Error("No active registration record found.");
      }

      const regData = regSnap.data();

      // STEP 2: EVALUATE OWNERSHIP
      const normUserEmail = (residentProfile.email || '').toLowerCase();
      const normRegEmail = (regData?.primaryMemberEmail || '').toLowerCase();
      const isOwner = (regData?.primaryMemberGmkId === residentProfile.gmkId) || (normRegEmail && normRegEmail === normUserEmail);

      if (!isOwner) {
        throw new Error("Access Denied: You do not have authorization to cancel a registration belonging to another resident.");
      }

      console.log(`[REGISTRATION CANCEL 03] Ownership verified for event ${eventId} (regId: ${regId})`);

      const oldRevenue = regData?.paymentAmount || 0;

      // STEP 3: CREATE BATCH & STAGE AUTHORIZED EXISTING DOCUMENT DELETES ONLY
      console.log(`[REGISTRATION CANCEL 04] Preparing resident cleanup batch`);
      const batch = writeBatch(db);

      // A. Registration Doc (guaranteed to exist)
      batch.delete(regRef);

      // B. Attendance Doc (only if exists)
      if (attSnap.exists()) {
        batch.delete(attRef);
        console.log(`[REGISTRATION CANCEL 05] Staged eventAttendance delete: ${attId}`);
      } else {
        console.log(`[REGISTRATION CANCEL 05] Skipped eventAttendance delete (document does not exist)`);
      }

      // C. Food Voucher Doc (only if exists)
      if (foodSnap.exists()) {
        batch.delete(foodRef);
        console.log(`[REGISTRATION CANCEL 06] Staged eventFood delete: ${foodId}`);
      } else {
        console.log(`[REGISTRATION CANCEL 06] Skipped eventFood delete (document does not exist)`);
      }

      // STEP 4: COMMIT BATCH
      await batch.commit();

      console.log(`[REGISTRATION CANCEL 07] Resident cleanup batch committed successfully for regId: ${regId}`);
      console.log(`[REGISTRATION CANCEL 08] Aggregate event documents not modified by resident client`);

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
      const cleanError = err.message || "Failed to cancel registration safely. Please contact your administrator.";
      if (cleanError.includes("Missing or insufficient permissions")) {
        setErrorMsg("Access Denied: You do not have authorization to cancel this registration. Please contact your administrator.");
      } else {
        setErrorMsg(cleanError);
      }
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
                        {reg ? (
                          <span className="flex items-center space-x-1 text-emerald-855 bg-emerald-100 border border-emerald-200 px-2.5 py-0.5 rounded-full text-[9px] font-extrabold font-mono tracking-wider uppercase">
                            <Check className="w-3 h-3" />
                            <span>Registered</span>
                          </span>
                        ) : (
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold font-mono tracking-wider uppercase ${badgeClass}`}>
                            ● {regStatusLabel}
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
                    </div>

                    <div className="pt-2 border-t border-stone-150 flex flex-col space-y-2 font-heading">
                      {reg ? (
                        /* WHEN REGISTRATION IS COMPLETED */
                        <div className="flex flex-col space-y-2">
                          {/* 1. View Registration */}
                          <button
                            type="button"
                            onClick={() => setViewingRegDetails(reg)}
                            className="w-full py-2 text-center bg-stone-100 hover:bg-stone-200 border border-stone-250 text-stone-850 uppercase tracking-wider text-[10px] font-bold rounded-xl transition-all cursor-pointer shadow-sm"
                          >
                            View Registration
                          </button>

                          {/* 2. Payment Options */}
                          <button
                            type="button"
                            onClick={() => setShowingPaymentModalEvent({ evt, reg })}
                            className="w-full py-2 text-center bg-[#0f4c2a] text-white hover:bg-[#125831] uppercase tracking-wider text-[10px] font-bold rounded-xl transition-all cursor-pointer shadow-sm flex items-center justify-center space-x-1"
                          >
                            <span>Payment options</span>
                          </button>

                          {/* 3. Pricing Details */}
                          <button
                            type="button"
                            onClick={() => setShowingPricingModalEvent(evt)}
                            className="w-full py-2 text-center bg-stone-50 hover:bg-stone-100 border border-stone-200 text-stone-700 uppercase tracking-wider text-[10px] font-bold rounded-xl transition-all cursor-pointer shadow-xs flex items-center justify-center"
                          >
                            <span>Pricing Details</span>
                          </button>
                        </div>
                      ) : (
                        /* WHEN REGISTRATION IS NOT COMPLETED */
                        <div className="flex flex-col space-y-2">
                          {/* 1. Register Participation (above) */}
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

                          {/* 2. Pricing Details */}
                          <button
                            type="button"
                            onClick={() => setShowingPricingModalEvent(evt)}
                            className="w-full py-2 text-center bg-stone-100 hover:bg-stone-200 border border-stone-250 text-stone-850 uppercase tracking-wider text-[10px] font-bold rounded-xl transition-all cursor-pointer shadow-sm flex items-center justify-center"
                          >
                            <span>Pricing Details</span>
                          </button>

                          {/* 3. Inactive Payment Options when not registered */}
                          <button
                            type="button"
                            disabled
                            className="w-full py-2 text-center bg-stone-100 border border-stone-200 text-stone-400 uppercase tracking-wider text-[10px] font-bold rounded-xl cursor-not-allowed opacity-60"
                            title="Complete registration first to enable payment options"
                          >
                            Payment options
                          </button>
                        </div>
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
        <div className="fixed inset-0 bg-stone-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white border border-stone-220 rounded-3xl max-w-md w-full shadow-2xl p-4 sm:p-6 relative my-auto max-h-[92vh] flex flex-col animate-scaleUp text-left overflow-hidden">
            <button
              onClick={() => {
                setActiveEventForReg(null);
                setLivePricing(null);
              }}
              className="absolute right-4 top-4 text-stone-705 hover:text-stone-900 transition-colors cursor-pointer font-black z-20"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="font-sans text-left shrink-0 pr-6">
              <span className="text-[10px] font-extrabold font-mono text-[#d4af37] block uppercase tracking-wider">Select Attendees</span>
              <h3 className="text-base font-extrabold text-[#0f4c2a] font-heading capitalize mt-0.5">{activeEventForReg.title}</h3>
              <p className="text-stone-805 text-[11px] leading-relaxed mt-0.5 font-semibold">
                Select Attendees from your household for this gathering. Count limits sync in real-time.
              </p>
            </div>

            <form onSubmit={handleSaveRegistration} className="flex-1 flex flex-col min-h-0 overflow-hidden mt-3">
              
              <div className="flex-1 overflow-y-auto pr-1 space-y-3 pb-2">
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

                {/* Dynamic billing & pricing details summary dropdown card */}
                {livePricing && (
                  <div className="bg-emerald-50/70 border border-emerald-200/80 rounded-2xl overflow-hidden text-left text-stone-800 transition-all shadow-xs">
                    {/* Accordion / Dropdown Toggle Header */}
                    <button
                      type="button"
                      onClick={() => setIsPricingExpanded(prev => !prev)}
                      className="w-full px-3.5 py-2.5 flex items-center justify-between text-left hover:bg-emerald-100/50 transition-colors cursor-pointer"
                    >
                      <div className="flex items-center space-x-2">
                        <span className="text-[10px] font-extrabold text-emerald-900 uppercase tracking-wider font-heading">
                          Pricing Breakdown
                        </span>
                        <span className="text-[9px] font-bold text-emerald-800 bg-emerald-100/90 px-2 py-0.5 rounded-full capitalize border border-emerald-200/50">
                          {livePricing.registrationType}
                        </span>
                      </div>

                      <div className="flex items-center space-x-2">
                        <div className="text-right">
                          <span className="text-[8px] text-stone-500 font-bold block uppercase leading-none">Total</span>
                          <span className="font-mono text-sm font-black text-[#0f4c2a] leading-tight">
                            OMR {livePricing.totalAmount}
                          </span>
                        </div>
                        <div className="p-1 rounded-lg bg-emerald-100/80 text-emerald-900 shrink-0">
                          {isPricingExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </div>
                      </div>
                    </button>

                    {/* Expandable Breakdown Content */}
                    {isPricingExpanded && (
                      <div className="p-3.5 border-t border-emerald-200/60 bg-emerald-50/40 space-y-3 animate-fadeIn text-xs">
                        <div className="space-y-1.5">
                          <div className="flex justify-between">
                            <span className="text-stone-600 font-bold">Registration Type:</span>
                            <span className="font-bold text-emerald-900 capitalize">{livePricing.registrationType}</span>
                          </div>
                          
                          {/* Included Members */}
                          {livePricing.includedMembers && livePricing.includedMembers.length > 0 && (
                            <div className="space-y-1">
                              <span className="text-[10px] uppercase tracking-wider text-stone-500 font-bold block mt-1">Included Household Members</span>
                              <div className="grid grid-cols-1 gap-1 pl-1">
                                {livePricing.includedMembers.map((m, idx) => (
                                  <div key={idx} className="flex items-center text-[11px] text-stone-700 font-medium">
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
                              <span className="text-[10px] uppercase tracking-wider text-stone-500 font-bold block mt-1">Parents ({livePricing.parentsCount} × OMR {livePricing.parentRate || 5})</span>
                              <div className="grid grid-cols-1 gap-1 pl-1">
                                {livePricing.parentMembers.map((m, idx) => (
                                  <div key={idx} className="flex items-center text-[11px] text-stone-700 font-medium">
                                    <span className="text-emerald-700 mr-1.5 font-bold">✓</span>
                                    {m} <span className="text-[9px] font-bold text-stone-700 bg-amber-50 border border-amber-200/60 px-1.5 py-0.25 rounded ml-1">OMR {livePricing.parentRate || 5}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Others / Maids */}
                          {livePricing.otherMembers && livePricing.otherMembers.length > 0 && (
                            <div className="space-y-1">
                              <span className="text-[10px] uppercase tracking-wider text-stone-500 font-bold block mt-1">Others / Maids ({livePricing.othersCount} × OMR {livePricing.otherRate || 5})</span>
                              <div className="grid grid-cols-1 gap-1 pl-1">
                                {livePricing.otherMembers.map((m, idx) => (
                                  <div key={idx} className="flex items-center text-[11px] text-stone-700 font-medium">
                                    <span className="text-emerald-700 mr-1.5 font-bold">✓</span>
                                    {m} <span className="text-[9px] font-bold text-stone-700 bg-blue-50 border border-blue-200/60 px-1.5 py-0.25 rounded ml-1">OMR {livePricing.otherRate || 5}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Guests */}
                          {externalCount > 0 && (
                            <div className="flex justify-between items-center text-[11px] text-stone-700 pt-1">
                              <span className="font-medium text-stone-600">Guests:</span>
                              <span className="font-mono font-bold">{externalCount} × OMR {livePricing.externalRate || 10}</span>
                            </div>
                          )}
                        </div>

                        {/* Fee Calculation Lines */}
                        <div className="border-t border-dashed border-emerald-200 pt-2.5 space-y-1.5 font-semibold text-xs">
                          <div className="flex justify-between text-stone-700 font-medium text-[11px]">
                            <span>Base Registration ({livePricing.registrationType === 'individual' ? 'Individual' : livePricing.registrationType === 'couple' ? 'Couple' : 'Family'}):</span>
                            <span className="font-mono font-bold">OMR {livePricing.baseRate || 0}</span>
                          </div>

                          {(livePricing.parentsCount || 0) > 0 && (
                            <div className="flex justify-between text-stone-700 font-medium text-[11px]">
                              <span>Parents ({livePricing.parentsCount} × OMR {livePricing.parentRate || 5}):</span>
                              <span className="font-mono font-bold">OMR {livePricing.parentsSubtotal || 0}</span>
                            </div>
                          )}

                          {(livePricing.othersCount || 0) > 0 && (
                            <div className="flex justify-between text-stone-700 font-medium text-[11px]">
                              <span>Others ({livePricing.othersCount} × OMR {livePricing.otherRate || 5}):</span>
                              <span className="font-mono font-bold">OMR {livePricing.othersSubtotal || 0}</span>
                            </div>
                          )}

                          {externalCount > 0 && (
                            <div className="flex justify-between text-stone-700 font-medium text-[11px]">
                              <span>Guests ({externalCount} × OMR {livePricing.externalRate || 10}):</span>
                              <span className="font-mono font-bold">OMR {livePricing.externalSubtotal || 0}</span>
                            </div>
                          )}

                          {(livePricing.breakdown?.freeChildren || 0) > 0 && (
                            <div className="flex justify-between text-stone-700 font-medium text-[11px]">
                              <span>Children below {activeEventForReg?.pricing?.freeChildAge ?? 5} years:</span>
                              <span className="text-emerald-700 font-extrabold uppercase">FREE</span>
                            </div>
                          )}

                          <div className="flex justify-between items-center text-xs font-black border-t border-dashed border-emerald-200 pt-2 text-[#0f4c2a]">
                            <span>TOTAL:</span>
                            <span className="font-mono text-base font-black">OMR {livePricing.totalAmount}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Sticky Footer with Action Buttons */}
              <div className="pt-3 border-t border-stone-200 flex space-x-2 shrink-0 bg-white mt-auto z-10">
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
                  <span>Confirm Registration</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PAYMENT OPTIONS MODAL */}
      {showingPaymentModalEvent && (
        <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-white border border-stone-220 rounded-3xl max-w-md w-full shadow-2xl p-6 relative space-y-4 text-left animate-scaleUp">
            <button
              type="button"
              onClick={() => setShowingPaymentModalEvent(null)}
              className="absolute right-4 top-4 text-stone-500 hover:text-stone-900 transition-colors cursor-pointer font-black"
            >
              <X className="w-5 h-5" />
            </button>

            <div>
              <span className="text-[10px] font-extrabold font-mono text-[#d4af37] block uppercase tracking-wider">Payment Options & Transfer Details</span>
              <h3 className="text-base font-extrabold text-[#0f4c2a] font-heading capitalize mt-0.5">
                {showingPaymentModalEvent.evt.title}
              </h3>
              {showingPaymentModalEvent.reg && (
                <div className="mt-2 p-3 bg-emerald-50 border border-emerald-100 rounded-2xl flex justify-between items-center text-xs">
                  <span className="font-bold text-emerald-900">Total Payable Amount:</span>
                  <span className="font-mono font-black text-sm text-[#0f4c2a]">OMR {showingPaymentModalEvent.reg.paymentAmount}</span>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <p className="text-xs font-bold text-stone-800">
                Please transfer the registration amount to
              </p>

              {showingPaymentModalEvent.evt.paymentTransferAccounts && showingPaymentModalEvent.evt.paymentTransferAccounts.length > 0 ? (
                showingPaymentModalEvent.evt.paymentTransferAccounts.map((acc, index) => (
                  <div key={acc.id || index} className="p-4 bg-stone-50 border border-stone-200 rounded-2xl space-y-2 text-xs font-semibold text-stone-850">
                    <div className="flex items-center justify-between border-b border-stone-200 pb-1.5 text-[10px] font-extrabold text-[#0f4c2a] uppercase tracking-wider font-heading">
                      <span>Payment Option #{index + 1}</span>
                    </div>
                    <div className="grid grid-cols-1 gap-1 text-[11px]">
                      {acc.name && (
                        <div className="flex justify-between">
                          <span className="text-stone-500 font-bold">Name:</span>
                          <span className="font-bold text-stone-900">{acc.name}</span>
                        </div>
                      )}
                      {acc.bank && (
                        <div className="flex justify-between">
                          <span className="text-stone-500 font-bold">Bank:</span>
                          <span className="font-bold text-stone-900">{acc.bank}</span>
                        </div>
                      )}
                      {acc.accountNumber && (
                        <div className="flex justify-between">
                          <span className="text-stone-500 font-bold">Account Number:</span>
                          <span className="font-mono font-bold text-stone-900">{acc.accountNumber}</span>
                        </div>
                      )}
                      {acc.iban && (
                        <div className="flex justify-between">
                          <span className="text-stone-500 font-bold">IBAN:</span>
                          <span className="font-mono font-bold text-stone-900">{acc.iban}</span>
                        </div>
                      )}
                      {acc.mobilePhone && (
                        <div className="flex justify-between">
                          <span className="text-stone-500 font-bold">Mobile transfer Phone number:</span>
                          <span className="font-mono font-bold text-stone-900">{acc.mobilePhone.startsWith('+968') ? acc.mobilePhone : `+968 ${acc.mobilePhone}`}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-4 bg-stone-50 border border-stone-200 rounded-2xl text-xs text-stone-500 italic font-medium text-center">
                  No payment transfer information configured yet for this event.
                </div>
              )}
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={() => setShowingPaymentModalEvent(null)}
                className="w-full py-2.5 bg-[#0f4c2a] hover:bg-[#125831] text-white font-bold uppercase tracking-wider text-[10px] rounded-xl cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PRICING DETAILS MODAL */}
      {showingPricingModalEvent && (
        <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-white border border-stone-220 rounded-3xl max-w-md w-full shadow-2xl p-6 relative space-y-4 text-left animate-scaleUp font-sans">
            <button
              type="button"
              onClick={() => setShowingPricingModalEvent(null)}
              className="absolute right-4 top-4 text-stone-500 hover:text-stone-900 transition-colors cursor-pointer font-black"
            >
              <X className="w-5 h-5" />
            </button>

            <div>
              <span className="text-[10px] font-extrabold font-mono text-[#d4af37] block uppercase tracking-wider">Official Event Tariff</span>
              <h3 className="text-base font-extrabold text-[#0f4c2a] font-heading capitalize mt-0.5">
                {showingPricingModalEvent.title}
              </h3>
              <p className="text-stone-500 text-xs mt-1">
                Review the applicable registration rates and fee breakdown for this gathering.
              </p>
            </div>

            {showingPricingModalEvent.pricing ? (
              <div className="border border-stone-200 rounded-2xl overflow-hidden divide-y divide-stone-150 text-xs font-semibold">
                <div className="p-3 bg-stone-50 text-stone-600 flex justify-between font-extrabold uppercase text-[9px] tracking-wider font-heading">
                  <span>Registration Plan Composition</span>
                  <span>Fee Rate</span>
                </div>
                <div className="p-3 flex justify-between">
                  <span className="text-stone-700">Individual Resident Unit</span>
                  <span className="font-mono font-bold text-stone-900">OMR {(showingPricingModalEvent.pricing.singleRate ?? 0).toFixed(3)}</span>
                </div>
                <div className="p-3 flex justify-between">
                  <span className="text-stone-700">Couple Resident Unit</span>
                  <span className="font-mono font-bold text-stone-900">OMR {(showingPricingModalEvent.pricing.coupleRate ?? 0).toFixed(3)}</span>
                </div>
                <div className="p-3 flex justify-between">
                  <span className="text-stone-700">Full Family Unit Cap</span>
                  <span className="font-mono font-bold text-stone-900">OMR {(showingPricingModalEvent.pricing.familyRate ?? 0).toFixed(3)}</span>
                </div>
                <div className="p-3 flex justify-between">
                  <span className="text-stone-700">Parent Rate</span>
                  <span className="font-mono font-bold text-stone-900">OMR {(showingPricingModalEvent.pricing.parentRate ?? 5).toFixed(3)} per parent</span>
                </div>
                <div className="p-3 flex justify-between">
                  <span className="text-stone-700">Other Resident Rate (Maids/Dependents)</span>
                  <span className="font-mono font-bold text-stone-900">OMR {(showingPricingModalEvent.pricing.otherRate ?? 5).toFixed(3)} per person</span>
                </div>
                <div className="p-3 flex justify-between">
                  <span className="text-stone-700">Free Children Age Limit</span>
                  <span className="font-mono font-bold text-stone-900">Below {showingPricingModalEvent.pricing.freeChildAge ?? 5} years old</span>
                </div>
                {showingPricingModalEvent.pricing.allowExternal && (
                  <div className="p-3 bg-emerald-50/40 flex justify-between">
                    <span className="text-emerald-900 font-extrabold">Registered Guest Fee</span>
                    <span className="font-mono text-emerald-800 font-black">OMR {(showingPricingModalEvent.pricing.externalRate ?? 0).toFixed(3)} per guest</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-4 bg-stone-50 border border-stone-200 rounded-2xl text-xs text-stone-500 italic font-medium text-center">
                No custom pricing structure set. Standard event entry rules apply.
              </div>
            )}

            <div className="pt-2">
              <button
                type="button"
                onClick={() => setShowingPricingModalEvent(null)}
                className="w-full py-2.5 bg-[#0f4c2a] hover:bg-[#125831] text-white font-bold uppercase tracking-wider text-[10px] rounded-xl cursor-pointer"
              >
                Close
              </button>
            </div>
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
