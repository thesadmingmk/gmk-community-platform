import React, { useState, useEffect } from 'react';
import { db, auth, useAuth } from '../../context/AuthContext';
import { collection, query, where, onSnapshot, doc, writeBatch, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { CommunityEvent, EventRegistration, Family, FamilyMember, ResidentProfile } from '../../types';
import { Calendar, Check, Clock, AlertCircle, RefreshCw, X, Users, MapPin, ArrowLeft, ChevronDown, ChevronUp, QrCode } from 'lucide-react';
import { createAuditLog } from '../../utils/audit';
import { useLocalGEASConfirmation, GEASConfirmationDialogUI } from '../gmk/GEASConfirmationDialog';
import { getEventRegistrationStatus, getRegistrationStatusLabel } from '../../utils/eventLifecycle';
import { handleFirestoreError, OperationType } from '../../utils/firestoreError';
import QRCode from 'qrcode';

interface EventsManagerProps {
  residentProfile: ResidentProfile;
  onViewEventDetails?: (evt: CommunityEvent) => void;
}


// Helper to format consistent Pricing Policy metadata with reference numbers and timestamps
const getTariffMetadata = (event: CommunityEvent | null) => {
  if (!event) {
    return {
      version: 'v2.0',
      ref: 'GMK-POL-v2.0-GEN-001',
      revisionDate: '16 Aug 2026',
      date: '16 Aug 2026',
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }),
      fullFormatted: '16 Aug 2026'
    };
  }
  
  const storedPolicyDate = event.pricing?.policyUpdatedAt;
  const rawDate = storedPolicyDate || event.updatedAt || event.createdAt || new Date().toISOString();
  let dateObj = new Date(rawDate);
  if (isNaN(dateObj.getTime())) dateObj = new Date();
  
  // v2.0 Core Heads policy was enacted on 16 Aug 2026
  const v2EnactmentDate = new Date('2026-08-16T00:00:00Z');
  const effectiveDateObj = (!storedPolicyDate || dateObj < v2EnactmentDate) ? new Date('2026-08-16T11:00:00') : dateObj;
  
  const code = (event.eventCode || event.id || 'GEN').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const yyyy = effectiveDateObj.getFullYear();
  const mm = String(effectiveDateObj.getMonth() + 1).padStart(2, '0');
  const dd = String(effectiveDateObj.getDate()).padStart(2, '0');
  const hh = String(effectiveDateObj.getHours()).padStart(2, '0');
  const min = String(effectiveDateObj.getMinutes()).padStart(2, '0');
  
  const version = event.pricing?.policyVersion || 'v2.0';
  const ref = event.pricing?.policyRef || `GMK-POL-${version}-${code}-${yyyy}${mm}${dd}-${hh}${min}`;
  
  const formattedDate = effectiveDateObj.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const formattedTime = effectiveDateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  const revisionDate = event.pricing?.policyRevisionDate || '16 Aug 2026';
  
  return {
    version,
    ref,
    revisionDate,
    date: formattedDate,
    time: formattedTime,
    fullFormatted: `${formattedDate} ${formattedTime}`
  };
};
export default function EventsManager({ residentProfile, onViewEventDetails }: EventsManagerProps) {
  const { profile } = useAuth();
  const { confirm: showConfirm, isOpen: isConfirmOpen, options: confirmOptions, handleCancel: handleConfirmCancel, handleConfirm: handleConfirmSubmit } = useLocalGEASConfirmation();
  const [loading, setLoading] = useState(true);
  const [isRegistering, setIsRegistering] = useState(false);
  const [registrationSuccessData, setRegistrationSuccessData] = useState<{ evt: CommunityEvent; count: number; reg?: EventRegistration } | null>(null);
  const [events, setEvents] = useState<CommunityEvent[]>([]);
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([]);
  const [registrations, setRegistrations] = useState<EventRegistration[]>([]);
  
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Active dialogue controls
  const [activeEventForReg, setActiveEventForReg] = useState<CommunityEvent | null>(null);
  const [viewingRegDetails, setViewingRegDetails] = useState<EventRegistration | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [showingPaymentModalEvent, setShowingPaymentModalEvent] = useState<{ evt: CommunityEvent; reg?: EventRegistration } | null>(null);

  // Sync viewingRegDetails and showingPaymentModalEvent with registrations updates
  useEffect(() => {
    if (viewingRegDetails) {
      const updatedReg = registrations.find(r => r.id === viewingRegDetails.id);
      if (updatedReg && JSON.stringify(updatedReg) !== JSON.stringify(viewingRegDetails)) {
        setViewingRegDetails(updatedReg);
      }
    }
    if (showingPaymentModalEvent && showingPaymentModalEvent.reg) {
      const updatedReg = registrations.find(r => r.id === showingPaymentModalEvent.reg!.id);
      if (updatedReg && JSON.stringify(updatedReg) !== JSON.stringify(showingPaymentModalEvent.reg)) {
        setShowingPaymentModalEvent(prev => prev ? { ...prev, reg: updatedReg } : null);
      }
    }
  }, [registrations, viewingRegDetails, showingPaymentModalEvent]);

  useEffect(() => {
    if (viewingRegDetails) {
      const passNo = viewingRegDetails.entryPassNumber || `PASS-${viewingRegDetails.eventId.slice(-6).toUpperCase()}-${viewingRegDetails.primaryMemberGmkId || viewingRegDetails.id.slice(-6).toUpperCase()}`;
      // RTCO-053: Do NOT encode unnecessary personal information inside the QR payload.
      const payload = passNo;
      QRCode.toDataURL(payload, { margin: 1, width: 220, color: { dark: '#0f4c2a', light: '#ffffff' } })
        .then(url => setQrDataUrl(url))
        .catch(err => console.error("QR Code Error:", err));
    } else {
      setQrDataUrl('');
    }
  }, [viewingRegDetails]);
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
    const coreHeads = spousesCount + kidsAboveFreeAge;
    
    const singleRate = pricing.singleRate ?? 10;
    const coupleRate = pricing.coupleRate ?? 20;
    const familyRate = pricing.familyRate ?? 25;

    if (coreHeads >= 3) {
      registrationType = 'family';
      baseRate = familyRate;
    } else if (coreHeads === 2) {
      registrationType = 'couple';
      baseRate = coupleRate;
    } else if (coreHeads === 1) {
      registrationType = 'individual';
      baseRate = singleRate;
    } else {
      registrationType = 'individual';
      baseRate = 0;
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
    
    if (coreHeads > 0) {
      if (registrationType === 'individual') {
        detailsParts.push(`Core Registration (Single): OMR ${baseRate}`);
      } else if (registrationType === 'couple') {
        detailsParts.push(`Core Registration (Couple): OMR ${baseRate}`);
      } else {
        detailsParts.push(`Core Registration (Family): OMR ${baseRate}`);
      }
    }

    if (parentsCount > 0) {
      detailsParts.push(`Extra Adults (Parents): ${parentsCount} × OMR ${parentRate} = OMR ${parentsSubtotal}`);
    }
    
    if (othersCount > 0) {
      detailsParts.push(`Extra Adults (Others): ${othersCount} × OMR ${otherRate} = OMR ${othersSubtotal}`);
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
    setIsRegistering(true);

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
      
      let nextPaymentStatus = 'pending';
      let originalAmountPaid = oldReg ? (oldReg.amountReceived || (oldReg.paymentStatus === 'paid' ? oldReg.paymentAmount : 0)) : 0;
      let existingAmountDue = oldReg?.amountDue;
      let existingBalanceDue = oldReg?.balanceDue;
      let refundDue = oldReg?.refundDue || 0;

      if (oldReg && ['paid', 'waived', 'overpaid', 'refund_due', 'approved'].includes(oldReg.paymentStatus!)) {
        if (pricingResult.totalAmount < originalAmountPaid) {
          nextPaymentStatus = 'refund_due';
          refundDue = originalAmountPaid - pricingResult.totalAmount;
        } else if (pricingResult.totalAmount === originalAmountPaid) {
          nextPaymentStatus = oldReg.paymentStatus;
        } else {
          nextPaymentStatus = 'partially_paid';
        }
      }
      const regPayload: any = {
        id: regId,
        eventId: activeEventForReg.id,
        familyId,
        primaryMemberGmkId: residentGmkId,
        primaryMemberEmail: residentEmail,
        participants: participantsList,
        totalParticipants: participantsList.length + externalCount,
        mealCount: { 'standard': participantsList.length + externalCount },
        createdAt: oldReg ? oldReg.createdAt : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        registrationType: pricingResult.registrationType,
        paymentAmount: pricingResult.totalAmount, // This is the revised value
        paymentStatus: nextPaymentStatus,
        qrCode: oldReg?.qrCode || null,
        amountReceived: originalAmountPaid,
        amountDue: pricingResult.totalAmount,
        refundDue: refundDue,
        ...(oldReg?.receiptNumber ? { receiptNumber: oldReg.receiptNumber } : {}),
        ...(oldReg?.entryPassNumber ? { entryPassNumber: oldReg.entryPassNumber } : {}),
        ...(oldReg?.paymentProcessedAt ? { paymentProcessedAt: oldReg.paymentProcessedAt } : {}),
        ...(oldReg?.paymentProcessedBy ? { paymentProcessedBy: oldReg.paymentProcessedBy } : {}),
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
        committeeKey: 'attendance',
        uid: currentUid,
        gmkId: residentGmkId,
        email: residentEmail,
        fullName: residentProfile.fullName,
        status: 'registered',
        createdAt: oldReg ? oldReg.createdAt : new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // Check current Firestore existence
      const regDocRef = doc(db, "event_registrations", regId);
      const attDocRef = doc(db, "eventAttendance", attPayload.id);

      let regSnap, attSnap;
      try {
        [regSnap, attSnap] = await Promise.all([
          getDoc(regDocRef),
          getDoc(attDocRef)
        ]);
      } catch (checkErr: any) {
        console.error("[RTCO-024L FAILURE]", {
          step: "STEP 02 (PRE-CHECK DOCS)",
          operation: "READ",
          path: `event_registrations/${regId} | eventAttendance/${attPayload.id}`,
          errorCode: checkErr?.code,
          errorMessage: checkErr?.message,
          errorName: checkErr?.name
        });
        throw checkErr;
      }

      const registrationExists = regSnap.exists();
      const attendanceExists = attSnap.exists();

      const regOp = registrationExists ? "UPDATE" : "CREATE";
      const attOp = attendanceExists ? "UPDATE" : "CREATE";

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

      // Defer direct eventFood creation by resident client
      // eventFood creation
      const foodDocRef = doc(db, "eventFood", `food_${residentGmkId}_${activeEventForReg.id}`);
      const foodPayload = {
        id: `food_${residentGmkId}_${activeEventForReg.id}`,
        eventId: activeEventForReg.id,
        committeeKey: 'food',
        gmkId: residentGmkId,
        fullName: residentProfile.fullName,
        mealCouponStatus: 'none',
        mealCount: {
          adults: regPayload.totalParticipants || 1,
          halfChildren: 0,
          freeChildren: 0,
          guests: 0
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      try {
        await setDoc(foodDocRef, foodPayload);
        console.log("[RTCO-024L STEP 07] eventFood setDoc SUCCESS");
      } catch (foodErr: any) {
        console.error("[RTCO-024L FAILURE] eventFood write failed", foodErr);
        // non-blocking
      }
      console.log("[RTCO-EMERGENCY-015] FOOD RECORD DEFERRED");
      console.log("[RTCO-EMERGENCY-015] EVENT REGISTRATION SUCCESS");

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
            committeeKey: "finance",
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
        setRegistrationSuccessData({ evt: activeEventForReg, count: totalParticipantsCount, reg: regPayload as any });
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
      setIsRegistering(false);
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

      console.log(`[RTCO-CANCEL-FORENSIC] REGISTRATION REF: ${regRef.path}`);
      console.log(`[RTCO-CANCEL-FORENSIC] REGISTRATION EXISTS: ${regSnap.exists()}`);
      console.log(`[RTCO-CANCEL-FORENSIC] ATTENDANCE EXISTS: ${attSnap.exists()}`);

      // STEP 2: EVALUATE OWNERSHIP
      const normUserEmail = (residentProfile.email || '').toLowerCase();
      const normRegEmail = (regData?.primaryMemberEmail || '').toLowerCase();
      const isOwner = (regData?.primaryMemberGmkId === residentProfile.gmkId) || (normRegEmail && normRegEmail === normUserEmail);

      if (!isOwner) {
        throw new Error("Access Denied: You do not have authorization to cancel a registration belonging to another resident.");
      }

      console.log(`[REGISTRATION CANCEL 03] Ownership verified for event ${eventId} (regId: ${regId})`);

      const oldRevenue = regData?.paymentAmount || 0;
      const amountReceived = regData?.amountReceived || (regData?.paymentStatus === 'paid' ? regData?.paymentAmount : 0);
      const isPaid = ['paid', 'waived', 'overpaid', 'refund_due', 'approved', 'partially_paid'].includes(regData?.paymentStatus!);

      // STEP 3: EXECUTE PRIMARY CANCELLATION (CRITICAL OPERATION)
      if (isPaid && amountReceived > 0) {
        console.log(`[PRIMARY CANCELLATION] Updating event_registrations/${regId} to cancelled/refund_due`);
        await setDoc(regRef, { 
          paymentStatus: 'cancelled',
          refundDue: amountReceived,
          amountDue: 0,
          paymentAmount: 0,
          updatedAt: new Date().toISOString()
        }, { merge: true });
        console.log(`[PRIMARY CANCELLATION SUCCESS] Registration ${regId} marked as cancelled with refund due.`);
      } else {
        console.log(`[PRIMARY CANCELLATION] Deleting event_registrations/${regId}`);
        await deleteDoc(regRef);
        console.log(`[PRIMARY CANCELLATION SUCCESS] Registration ${regId} deleted.`);
      }

      // Primary operation succeeded — user registration is cancelled!
      setSuccessMsg(`✓ Successfully cancelled your household registration for ${title}.`);
      setViewingRegDetails(null);

      // STEP 4: SECONDARY CLEANUP OPERATIONS (INDEPENDENT, NON-BLOCKING)
      let attCleanupStatus = 'SKIPPED';
      let foodCleanupStatus = 'SKIPPED';
      let certCleanupStatus = 'SKIPPED';

      // 4A: Secondary Attendance Cleanup
      if (attSnap.exists()) {
        try {
          await deleteDoc(attRef);
          attCleanupStatus = 'SUCCESS';
          console.log(`[RTCO-CLEANUP] ATTENDANCE SUCCESS (${attId})`);
        } catch (attErr: any) {
          attCleanupStatus = 'PENDING';
          console.warn(`[RTCO-CLEANUP] ATTENDANCE PENDING`, {
            eventId,
            registrationId: regId,
            attendanceId: attId,
            code: attErr?.code,
            message: attErr?.message
          });
        }
      }

      // 4B: Secondary Food Cleanup
      if (foodSnap.exists()) {
        try {
          await deleteDoc(foodRef);
          foodCleanupStatus = 'SUCCESS';
          console.log(`[RTCO-CLEANUP] FOOD SUCCESS (${foodId})`);
        } catch (foodErr: any) {
          foodCleanupStatus = 'PENDING';
          console.warn(`[RTCO-CLEANUP] FOOD PENDING`, {
            eventId,
            registrationId: regId,
            foodId,
            code: foodErr?.code,
            message: foodErr?.message
          });
        }
      }

      // 4C: Secondary Certificate Cleanup
      const certRef = doc(db, "eventCertificates", `cert_${residentProfile.gmkId}_${eventId}`);
      try {
        const certSnap = await getDoc(certRef);
        if (certSnap.exists()) {
          await deleteDoc(certRef);
          certCleanupStatus = 'SUCCESS';
          console.log(`[RTCO-CLEANUP] CERTIFICATE SUCCESS (${certRef.id})`);
        }
      } catch (certErr: any) {
        certCleanupStatus = 'PENDING';
        console.warn(`[RTCO-CLEANUP] CERTIFICATE PENDING`, {
          eventId,
          registrationId: regId,
          certId: certRef.id,
          code: certErr?.code,
          message: certErr?.message
        });
      }

      // 4D: Write Cancel Audit Trail Entry with detailed cleanup statuses
      try {
        await createAuditLog(
          'EVENT_REGISTRATION_CANCELLED',
          residentProfile.email,
          'registration',
          regId,
          JSON.stringify({
            eventId,
            registrationId: regId,
            gmkId: residentProfile.gmkId,
            email: residentProfile.email,
            cancellationSource: 'resident',
            attendanceCleanupStatus: attCleanupStatus,
            foodCleanupStatus: foodCleanupStatus,
            certificateCleanupStatus: certCleanupStatus,
            timestamp: new Date().toISOString()
          })
        );
      } catch (auditErr) {
        console.warn("⚠️ Non-blocking Cancel Audit log failed:", auditErr);
      }
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
                          <>
                            {reg.paymentStatus === 'cancelled' ? (
                              <span className="flex items-center space-x-1 text-red-800 bg-red-100 border border-red-200 px-2.5 py-0.5 rounded-full text-[9px] font-extrabold font-mono tracking-wider uppercase">
                                <AlertCircle className="w-3 h-3" />
                                <span>Cancelled & Refund Pending</span>
                              </span>
                            ) : reg.paymentStatus === 'refund_due' ? (
                              <span className="flex items-center space-x-1 text-amber-800 bg-amber-100 border border-amber-200 px-2.5 py-0.5 rounded-full text-[9px] font-extrabold font-mono tracking-wider uppercase">
                                <Clock className="w-3 h-3" />
                                <span>Finance Review Required</span>
                              </span>
                            ) : (
                              <span className="flex items-center space-x-1 text-emerald-855 bg-emerald-100 border border-emerald-200 px-2.5 py-0.5 rounded-full text-[9px] font-extrabold font-mono tracking-wider uppercase">
                                <Check className="w-3 h-3" />
                                <span>{(reg.paymentStatus === 'paid' || reg.paymentStatus === 'approved' || reg.paymentStatus === 'waived' || reg.paymentStatus === 'overpaid') ? 'Paid & Registered' : 'Registered'}</span>
                              </span>
                            )}
                          </>
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
                          {reg.paymentStatus === 'cancelled' || reg.paymentStatus === 'refund_due' ? (
                            <button
                              type="button"
                              onClick={() => setViewingRegDetails(reg)}
                              className="w-full py-2.5 text-center bg-stone-100 text-stone-850 border border-stone-250 hover:bg-stone-200 uppercase tracking-wider text-[11px] font-black rounded-xl transition-all cursor-pointer shadow-sm flex items-center justify-center space-x-2"
                            >
                              <span>View Details</span>
                            </button>
                          ) : (reg.paymentStatus === 'paid' || reg.paymentStatus === 'approved' || reg.paymentStatus === 'waived' || reg.paymentStatus === 'overpaid') ? (
                            <button
                              type="button"
                              onClick={() => setViewingRegDetails(reg)}
                              className="w-full py-2.5 text-center bg-[#0f4c2a] text-white hover:bg-[#125831] uppercase tracking-wider text-[11px] font-black rounded-xl transition-all cursor-pointer shadow-md flex items-center justify-center space-x-2"
                            >
                              <QrCode className="w-4 h-4" />
                              <span>Entry Pass</span>
                            </button>
                          ) : (
                            <>
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
                            </>
                          )}
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

        const pStatus = viewingRegDetails.paymentStatus || 'pending';
        const amtDue = viewingRegDetails.amountDue ?? viewingRegDetails.paymentAmount ?? viewingRegDetails.paymentSummary?.totalAmount ?? 0;
        const amtRec = viewingRegDetails.amountReceived ?? (pStatus === 'paid' ? amtDue : 0);
        const balDue = viewingRegDetails.balanceDue ?? Math.max(0, amtDue - amtRec);
        const refDue = viewingRegDetails.refundDue ?? Math.max(0, amtRec - amtDue);
        const entryPassNo = viewingRegDetails.entryPassNumber || `PASS-${evt.id.slice(-6).toUpperCase()}-${viewingRegDetails.primaryMemberGmkId || viewingRegDetails.id.slice(-6).toUpperCase()}`;

        return (
          <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
            <div className="bg-white border border-stone-200 rounded-3xl max-w-lg w-full shadow-2xl p-5 sm:p-6 relative space-y-4 animate-scaleUp text-stone-800 my-auto max-h-[92vh] flex flex-col">
              <button
                onClick={() => setViewingRegDetails(null)}
                className="absolute right-4 top-4 text-stone-400 hover:text-stone-800 transition-colors cursor-pointer font-black z-10"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="border-b border-stone-150 pb-3 text-left pr-6">
                <div className="flex items-center space-x-2">
                  <span className="text-[10px] font-black font-mono text-[#d4af37] uppercase tracking-wider">
                    Official Event Entry Pass & Receipt
                  </span>
                </div>
                <h3 className="text-lg font-black text-[#0f4c2a] font-heading mt-0.5">{evt.title}</h3>
                <p className="text-stone-500 text-[11px] mt-0.5 font-medium">
                  Household GMK ID: <span className="font-mono font-bold text-stone-800">{viewingRegDetails.primaryMemberGmkId}</span> • Reg ID: <span className="font-mono text-stone-700">{viewingRegDetails.id}</span>
                </p>
              </div>

              {/* CONFIRMATION / PAYMENT STATUS BANNER */}
              <div className="text-left">
                {(pStatus === 'paid' || pStatus === 'approved') && (
                  <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-2xl flex items-start space-x-2.5 text-xs font-bold">
                    <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-black text-emerald-950">Registration Confirmed</p>
                      <p className="text-[11px] text-emerald-800 mt-0.5">Payment received. Thank you. Your registration is confirmed.</p>
                    </div>
                  </div>
                )}

                {pStatus === 'partially_paid' && (
                  <div className="p-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-2xl flex items-start space-x-2.5 text-xs font-bold">
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-black text-amber-950">Partial Payment Received</p>
                      <p className="text-[11px] text-amber-850 mt-0.5">
                        Balance Due: <span className="font-mono font-black text-amber-950">OMR {balDue.toFixed(3)}</span>. Please pay the outstanding balance to complete your payment.
                      </p>
                    </div>
                  </div>
                )}

                {(pStatus === 'overpaid' || pStatus === 'refund_due') && (
                  <div className="p-3 bg-blue-50 border border-blue-200 text-blue-900 rounded-2xl flex items-start space-x-2.5 text-xs font-bold">
                    <Check className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-black text-blue-950">Payment Verified — Overpayment Logged</p>
                      <p className="text-[11px] text-blue-850 mt-0.5">
                        Refund Due: <span className="font-mono font-black text-blue-950">OMR {refDue.toFixed(3)}</span>. Our Finance Committee will process the refund.
                      </p>
                    </div>
                  </div>
                )}

                {pStatus === 'waived' && (
                  <div className="p-3 bg-blue-50 border border-blue-200 text-blue-900 rounded-2xl flex items-start space-x-2.5 text-xs font-bold">
                    <Check className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-black text-blue-950">Payment Waived</p>
                      <p className="text-[11px] text-blue-850 mt-0.5">Payment Waived — Registration Confirmed.</p>
                    </div>
                  </div>
                )}

                {pStatus === 'pending' && (
                  <div className="p-3 bg-stone-100 border border-stone-200 text-stone-800 rounded-2xl flex items-start space-x-2.5 text-xs font-bold">
                    <Clock className="w-4 h-4 text-stone-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-black text-stone-900">Payment Pending Verification</p>
                      <p className="text-[11px] text-stone-600 mt-0.5">Registration Pending Payment Verification with the Finance Committee.</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="overflow-y-auto pr-1 space-y-4 text-left flex-1 min-h-0">
                {/* PASS & QR CODE CARD */}
                {['paid', 'waived', 'overpaid', 'approved', 'partially_paid', 'pending'].includes(pStatus) && (
                  <div className="bg-stone-50 border border-stone-200 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="space-y-1.5 text-center sm:text-left">
                      <span className="text-[9px] uppercase font-black text-stone-500 tracking-wider block">Gate Entry Pass</span>
                      <span className="text-xs font-mono font-black text-[#0f4c2a] bg-emerald-100 border border-emerald-200 px-2.5 py-1 rounded-xl block w-fit mx-auto sm:mx-0">
                        {entryPassNo}
                      </span>
                      {viewingRegDetails.receiptNumber && (
                        <div className="text-[10px] text-stone-600 font-medium">
                          Receipt #: <span className="font-mono font-bold text-stone-900">{viewingRegDetails.receiptNumber}</span>
                        </div>
                      )}
                      <p className="text-[10px] text-stone-500 font-medium max-w-xs">
                        Present this QR code or Entry Pass number at the event gate for instant check-in.
                      </p>
                    </div>
                    {qrDataUrl && (['paid', 'waived', 'overpaid', 'approved'].includes(pStatus)) ? (
                      <div className="bg-white p-2 border border-stone-200 rounded-2xl shadow-xs shrink-0 text-center">
                        <img src={qrDataUrl} alt="Entry Pass QR Code" className="w-28 h-28 mx-auto rounded-lg" />
                        <span className="text-[8px] font-mono text-stone-400 block mt-1 uppercase">Scan at Gate</span>
                      </div>
                    ) : (
                      <div className="w-28 h-28 bg-stone-100 rounded-2xl flex items-center justify-center shrink-0 text-stone-400 text-[9px] font-bold text-center p-2">
                        Pending Payment
                      </div>
                    )}
                  </div>
                )}

                {/* FINANCIAL SNAPSHOT */}
                <div className="bg-stone-50 border border-stone-200 rounded-2xl p-3.5 space-y-2 text-xs">
                  <span className="text-[9px] font-black text-[#0f4c2a] uppercase tracking-wider block">Financial Summary</span>
                  <div className="grid grid-cols-2 gap-2 text-[11px] font-bold">
                    <div className="p-2 bg-white rounded-xl border border-stone-150">
                      <span className="text-[9px] text-stone-500 uppercase block">Amount Due</span>
                      <span className="text-sm font-mono font-black text-stone-900">OMR {amtDue.toFixed(3)}</span>
                    </div>
                    <div className="p-2 bg-white rounded-xl border border-stone-150">
                      <span className="text-[9px] text-stone-500 uppercase block">Amount Received</span>
                      <span className="text-sm font-mono font-black text-[#0f4c2a]">OMR {amtRec.toFixed(3)}</span>
                    </div>
                  </div>
                  {viewingRegDetails.financeRemarks && (
                    <div className="p-2 bg-stone-100/80 rounded-xl text-[10px] text-stone-700 italic border border-stone-200">
                      <strong className="not-italic text-stone-900">Finance Remarks: </strong>
                      {viewingRegDetails.financeRemarks}
                    </div>
                  )}
                </div>

                {/* PARTICIPANTS BREAKDOWN */}
                <div className="space-y-2">
                  <span className="text-[9px] font-black text-stone-600 uppercase tracking-wider block font-heading">
                    Registered Household Attendees ({viewingRegDetails.totalParticipants})
                  </span>
                  <div className="grid grid-cols-1 gap-1.5 max-h-36 overflow-y-auto pr-1">
                    {viewingRegDetails.participants.map((name, index) => {
                      const member = familyMembers.find(m => m.name === name);
                      const relation = name === residentProfile.fullName ? 'Primary Head' : (member?.relationship || 'dependent');
                      return (
                        <div key={index} className="flex justify-between items-center p-2 bg-stone-50 border border-stone-200 rounded-xl text-xs font-bold">
                          <span className="text-stone-900 truncate">{name}</span>
                          <span className="text-[9px] capitalize text-[#0f4c2a] bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-md font-extrabold shrink-0">
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
                  type="button"
                  onClick={() => setViewingRegDetails(null)}
                  className="flex-1 py-2.5 border border-stone-300 text-stone-800 font-bold uppercase tracking-wider text-[10px] rounded-xl hover:bg-stone-50 transition-colors cursor-pointer"
                >
                  Close Pass
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setViewingRegDetails(null);
                    handleOpenRegistration(evt);
                  }}
                  className="flex-1 py-2.5 bg-[#0f4c2a] text-white font-bold uppercase tracking-wider text-[10px] rounded-xl hover:bg-[#0c3e22] transition-colors cursor-pointer"
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

      
      {/* SUCCESS POPUP MODAL */}
      {registrationSuccessData && (
        <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-[60] animate-fadeIn">
          <div className="bg-white border border-stone-220 rounded-3xl max-w-sm w-full shadow-2xl p-6 relative space-y-4 text-center animate-scaleUp">
            <div className="mx-auto w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600 mb-2 shadow-inner">
              <Check className="w-8 h-8 stroke-[3]" />
            </div>
            <div>
              <h3 className="text-lg font-extrabold text-[#0f4c2a] font-heading capitalize mt-0.5">
                Registration Completed!
              </h3>
              <p className="text-xs text-stone-600 font-semibold mt-2 px-2">
                ✓ Successfully registered {registrationSuccessData.count} member(s) of your family for {registrationSuccessData.evt.title}.
              </p>
            </div>
            
            <div className="pt-2 space-y-2">
              <button
                type="button"
                onClick={() => {
                   setShowingPaymentModalEvent({ evt: registrationSuccessData.evt, reg: registrationSuccessData.reg });
                   setRegistrationSuccessData(null);
                }}
                className="w-full bg-[#0f4c2a] text-white py-3 px-4 rounded-xl font-bold text-xs tracking-wide hover:bg-[#125831] focus:ring-4 focus:ring-emerald-500/20 shadow-md flex items-center justify-center"
              >
                PAYMENT OPTIONS & TRANSFER DETAILS
              </button>
              <button
                type="button"
                onClick={() => setRegistrationSuccessData(null)}
                className="w-full bg-stone-100 text-stone-700 py-3 px-4 rounded-xl font-bold text-xs tracking-wide hover:bg-stone-200"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REGISTERING SPINNER MODAL */}
      {isRegistering && (
        <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-[60] animate-fadeIn">
          <div className="bg-white border border-stone-220 rounded-3xl p-8 flex flex-col items-center shadow-2xl space-y-4 animate-scaleUp">
            <div className="w-12 h-12 border-4 border-[#0f4c2a] border-t-[#d4af37] rounded-full animate-spin"></div>
            <p className="font-extrabold text-[#0f4c2a] tracking-wide text-sm">Registering...</p>
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
              <div className="flex items-center space-x-2">
                <span className="text-[10px] font-extrabold font-mono text-[#d4af37] block uppercase tracking-wider">Official Event Tariff</span>
                <span className="px-2 py-0.5 bg-amber-50 border border-amber-200 text-amber-900 text-[9px] font-mono font-bold rounded-md">
                  Ref: {getTariffMetadata(showingPricingModalEvent).ref}
                </span>
              </div>
              <h3 className="text-base font-extrabold text-[#0f4c2a] font-heading capitalize mt-0.5">
                {showingPricingModalEvent.title}
              </h3>
              <div className="text-[10px] text-stone-500 font-mono font-medium mt-1 flex flex-wrap items-center gap-2">
                <span className="px-1.5 py-0.5 bg-amber-50 border border-amber-200/60 rounded text-amber-900 font-bold">
                  Rev Date: {getTariffMetadata(showingPricingModalEvent).revisionDate}
                </span>
                <span>Effective: <strong className="text-stone-700 font-bold">{getTariffMetadata(showingPricingModalEvent).fullFormatted}</strong></span>
              </div>
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
