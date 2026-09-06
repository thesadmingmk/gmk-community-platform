import React, { useState, useMemo } from 'react';
import {
  Users, User, Phone, Mail, Home, MapPin, Plus, Trash2, CheckCircle2,
  AlertCircle, ChevronLeft, ArrowRight, Loader2, Info
} from 'lucide-react';
import {
  CommunityEvent,
  ExternalRegistrationTypeConfig,
  EventRegistration,
  EventRegistrationParticipantDetail
} from '../../types';
import { calculateEventPricing, calculateSingleFixedPricing } from '../../utils/pricingEngine';
import { sanitizeFirestorePayload } from '../../utils/sanitize';
import { validateAndNormalizePhoneNumber } from '../../utils/phoneValidation';
import { normalizeName } from '../../utils/nameNormalization';
import { generateExternalGmkId } from '../../utils/gmkIdHelper';
import {
  collection, query, where, getDocs, setDoc, doc
} from 'firebase/firestore';
import { Firestore } from 'firebase/firestore';

interface ExternalRegistrationFormProps {
  existingRegistration?: any;
  event: CommunityEvent;
  typeConfig: ExternalRegistrationTypeConfig;
  validationDb: Firestore;
  onBack: () => void;
  onSuccess?: (registration: EventRegistration) => void;
}

interface ChildFormState {
  id: string;
  birthYear: string;
}

interface ParticipantCountItem {
  id: string;
}

export default function ExternalRegistrationForm({
  event,
  typeConfig,
  validationDb,
  onBack,
  onSuccess,
  existingRegistration
}: ExternalRegistrationFormProps) {
  const currentYear = new Date().getFullYear();

  // Primary Registrant State
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneCode, setPhoneCode] = useState('+968');
  const [phone, setPhone] = useState('');
  const [whatsappCode, setWhatsappCode] = useState('+968');
  const [whatsapp, setWhatsapp] = useState('');
  const [whatsappSameAsMobile, setWhatsappSameAsMobile] = useState(true);

  // Single Entry Type State
  const [unitNumber, setUnitNumber] = useState('');

  // Family Entry Type State
  const [hasSpouse, setHasSpouse] = useState(false);
  const [children, setChildren] = useState<ChildFormState[]>([]);
  const [parents, setParents] = useState<ParticipantCountItem[]>([]);
  const [others, setOthers] = useState<ParticipantCountItem[]>([]);

  // Submission State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submittedReg, setSubmittedReg] = useState<EventRegistration | null>(null);

  React.useEffect(() => {
    if (existingRegistration) {
      setFullName(existingRegistration.primaryRegistrantName || '');
      setEmail(existingRegistration.primaryRegistrantEmail || '');

      // Parse mobile number & country code
      const rawPhone = (existingRegistration.primaryRegistrantPhone || '').trim();
      const rawWa = (existingRegistration.primaryRegistrantWhatsapp || '').trim();
      const storedPhoneCode = existingRegistration.phoneCountryCode;
      const storedWaCode = existingRegistration.whatsappCountryCode;

      const parsePhoneField = (raw: string, storedCode?: string) => {
        if (!raw) return { code: '+968', number: '' };
        if (storedCode && raw.startsWith(storedCode)) {
          return { code: storedCode, number: raw.substring(storedCode.length).trim() };
        }
        if (raw.startsWith('+')) {
          const knownCodes = ['+968', '+971', '+966', '+965', '+974', '+973', '+91', '+44', '+1'];
          for (const c of knownCodes) {
            if (raw.startsWith(c)) {
              return { code: c, number: raw.substring(c.length).trim() };
            }
          }
        }
        const digits = raw.replace(/\D/g, '');
        if (digits.length === 10 && ['6', '7', '8', '9'].includes(digits[0])) {
          return { code: '+91', number: digits };
        }
        if (digits.length === 8) {
          return { code: '+968', number: digits };
        }
        return { code: storedCode || '+968', number: digits || raw };
      };

      const parsedPhone = parsePhoneField(rawPhone, storedPhoneCode);
      setPhoneCode(parsedPhone.code);
      setPhone(parsedPhone.number);

      const parsedWa = parsePhoneField(rawWa, storedWaCode);
      setWhatsappCode(parsedWa.code);
      setWhatsapp(parsedWa.number);
      setWhatsappSameAsMobile(rawPhone === rawWa || !rawWa);
      
      if (existingRegistration.entryType === 'single') {
        const primaryUnit = existingRegistration.participantDetails?.find((p: any) => p.role === 'single')?.unitNumber;
        if (primaryUnit) setUnitNumber(primaryUnit);
      }
      
      const spouse = existingRegistration.participantDetails?.find((p: any) => p.role === 'spouse');
      if (spouse) setHasSpouse(true);
      
      const kids = existingRegistration.participantDetails?.filter((p: any) => p.role === 'child') || [];
      if (kids.length > 0) {
        setChildren(kids.map((k: any, idx: number) => ({
          id: `child_${idx}`,
          birthYear: k.yearOfBirth || ''
        })));
      }
      
      const pars = existingRegistration.participantDetails?.filter((p: any) => p.role === 'parent') || [];
      if (pars.length > 0) {
        setParents(pars.map((_, idx) => ({ id: `parent_${idx}` })));
      }
      
      const oths = existingRegistration.participantDetails?.filter((p: any) => p.role === 'other') || [];
      if (oths.length > 0) {
        setOthers(oths.map((_, idx) => ({ id: `other_${idx}` })));
      }
    }
  }, [existingRegistration]);


  // Auto-sync WhatsApp if toggle is on
  const handleMobileChange = (val: string) => {
    setPhone(val);
    if (whatsappSameAsMobile) {
      setWhatsapp(val);
      setWhatsappCode(phoneCode);
    }
  };

  const handleToggleWhatsappSame = (checked: boolean) => {
    setWhatsappSameAsMobile(checked);
    if (checked) {
      setWhatsapp(phone);
      setWhatsappCode(phoneCode);
    }
  };

  // Children helpers
  const handleAddChild = () => {
    setChildren(prev => [
      ...prev,
      {
        id: `child_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
        birthYear: ''
      }
    ]);
  };

  const handleUpdateChildBirthYear = (id: string, birthYear: string) => {
    const clean = birthYear.replace(/\D/g, '').slice(0, 4);
    setChildren(prev => prev.map(c => c.id === id ? { ...c, birthYear: clean } : c));
  };

  const handleRemoveChild = (id: string) => {
    setChildren(prev => prev.filter(c => c.id !== id));
  };

  // Parents helpers
  const handleAddParent = () => {
    setParents(prev => [
      ...prev,
      { id: `parent_${Date.now()}_${Math.random().toString(36).substring(2, 5)}` }
    ]);
  };

  const handleRemoveParent = (id: string) => {
    setParents(prev => prev.filter(p => p.id !== id));
  };

  // Others helpers
  const handleAddOther = () => {
    setOthers(prev => [
      ...prev,
      { id: `other_${Date.now()}_${Math.random().toString(36).substring(2, 5)}` }
    ]);
  };

  const handleRemoveOther = (id: string) => {
    setOthers(prev => prev.filter(o => o.id !== id));
  };

  // Internal Pricing Calculation (Not shown to public user, but strictly preserved and stored)
  const pricingResult = useMemo(() => {
    if (typeConfig.entryType === 'single') {
      const fixedAmount = typeConfig.fixedCostPerParticipant ?? 5;
      return calculateSingleFixedPricing(fixedAmount);
    }

    // Family Entry Type: Uses event's pricing policy
    return calculateEventPricing({
      pricing: event.pricing,
      hasPrimary: true,
      hasSpouse: hasSpouse,
      children: children.map((c, idx) => ({
        name: `Child ${idx + 1}`,
        yearOfBirth: c.birthYear
      })),
      parentsCount: parents.length,
      othersCount: others.length,
      externalGuestsCount: 0 // No guest category for external registrations
    });
  }, [typeConfig, event.pricing, hasSpouse, children, parents.length, others.length]);

  // List of all participant names for submission
  const participantNames = useMemo(() => {
    const normFullName = normalizeName(fullName);
    if (typeConfig.entryType === 'single') {
      return normFullName ? [normFullName] : [];
    }
    const names: string[] = [];
    if (normFullName) names.push(normFullName);
    if (hasSpouse) names.push('Spouse');
    children.forEach((_, idx) => {
      names.push(`Child ${idx + 1}`);
    });
    parents.forEach((_, idx) => {
      names.push(`Parent ${idx + 1}`);
    });
    others.forEach((_, idx) => {
      names.push(`Other ${idx + 1}`);
    });
    return names;
  }, [typeConfig.entryType, fullName, hasSpouse, children.length, parents.length, others.length]);

  // Structured Participant Details for Food Committee Headcount compatibility
  const participantDetailsList = useMemo<EventRegistrationParticipantDetail[]>(() => {
    const normFullName = normalizeName(fullName);
    if (typeConfig.entryType === 'single') {
      return [
        {
          name: normFullName || 'External Guest',
          role: 'single',
          unitNumber: unitNumber.trim()
        }
      ];
    }
    const details: EventRegistrationParticipantDetail[] = [];
    if (normFullName) {
      details.push({ name: normFullName, role: 'primary' });
    }
    if (hasSpouse) {
      details.push({ name: 'Spouse', role: 'spouse' });
    }
    children.forEach((c, idx) => {
      const yob = parseInt(c.birthYear, 10);
      const age = !isNaN(yob) && yob > 0 ? currentYear - yob : undefined;
      details.push({
        name: `Child ${idx + 1}`,
        role: 'child',
        yearOfBirth: c.birthYear,
        age
      });
    });
    parents.forEach((_, idx) => {
      details.push({ name: `Parent ${idx + 1}`, role: 'parent' });
    });
    others.forEach((_, idx) => {
      details.push({ name: `Other ${idx + 1}`, role: 'other' });
    });
    return details;
  }, [typeConfig.entryType, fullName, unitNumber, hasSpouse, children, parents.length, others.length, currentYear]);

  // Form Validation and Submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    // 1. Basic validation
    if (!fullName.trim()) {
      setErrorMsg("Full Name is required.");
      return;
    }
    const normalizedFullName = normalizeName(fullName);
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@') || !cleanEmail.includes('.')) {
      setErrorMsg("A valid email address is required.");
      return;
    }

    const phoneValidation = validateAndNormalizePhoneNumber(phoneCode, phone);
    if (!phoneValidation.isValid) {
      setErrorMsg(phoneValidation.error || "Please enter a valid mobile number.");
      return;
    }

    const cleanPhoneDigits = phoneValidation.normalized;
    const finalPhone = `${phoneCode} ${cleanPhoneDigits}`;

    let cleanWaDigits = cleanPhoneDigits;
    let finalWhatsapp = finalPhone;
    let finalWaCode = phoneCode;

    if (!whatsappSameAsMobile) {
      const waValidation = validateAndNormalizePhoneNumber(whatsappCode, whatsapp, true);
      if (!waValidation.isValid) {
        setErrorMsg(waValidation.error || "Please enter a valid WhatsApp number.");
        return;
      }
      cleanWaDigits = waValidation.normalized;
      finalWaCode = whatsappCode;
      finalWhatsapp = `${whatsappCode} ${cleanWaDigits}`;
    }

    // Single Entry validation
    if (typeConfig.entryType === 'single') {
      if (!unitNumber.trim()) {
        setErrorMsg("Address is required for Single registration.");
        return;
      }
    }

    // Family Entry validation
    if (typeConfig.entryType === 'family') {
      for (let i = 0; i < children.length; i++) {
        const yobStr = children[i].birthYear.trim();
        if (!yobStr) {
          setErrorMsg(`Please enter the Birth Year (YYYY) for Child #${i + 1}.`);
          return;
        }
        const yob = parseInt(yobStr, 10);
        if (!/^\d{4}$/.test(yobStr) || isNaN(yob) || yob < (currentYear - 30) || yob > currentYear) {
          setErrorMsg(`Please enter a valid 4-digit Birth Year (e.g. 2018) for Child #${i + 1}.`);
          return;
        }
      }
    }

    setIsSubmitting(true);

    try {
      // 2. Safe Duplicate Prevention Check:
      // Combination: Event ID + Primary Member Email
      // Note: Mobile & WhatsApp numbers are allowed across multiple registrations,
      // including within the same event (phone-number-based duplicate blocking removed).
      const regColl = collection(validationDb, "event_registrations");
      const qEmail = query(
        regColl,
        where("eventId", "==", event.id),
        where("primaryMemberEmail", "==", cleanEmail)
      );
      const emailSnap = await getDocs(qEmail);

      const duplicateEmailDoc = emailSnap.docs.find(d => d.id !== existingRegistration?.id);
      if (duplicateEmailDoc) {
        throw new Error(
          `A registration has already been submitted under email ${cleanEmail}. If you need to revise your details, please contact the Event Committee.`
        );
      }

      // 3. Construct Registration Record
      const uniqueSuffix = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
      const regId = `reg_ext_${event.id}_${uniqueSuffix}`;
      const publicReference = generateExternalGmkId();

      const now = existingRegistration?.timestamp || new Date().toISOString();
      const amountDue = pricingResult.totalAmount;
      
      const originalAmountPaid = existingRegistration ? (existingRegistration.amountReceived || 0) : 0;
      const totalAlreadyRefunded = existingRegistration ? (existingRegistration.refundedAmount || 0) : 0;
      const netPaid = originalAmountPaid - totalAlreadyRefunded;
      
      let nextPaymentStatus = existingRegistration?.paymentStatus || 'pending';
      let refundDue = 0;
      let newBalanceDue = Math.max(0, amountDue - netPaid);
      
      if (existingRegistration && existingRegistration.paymentStatus !== 'pending' && existingRegistration.paymentStatus !== 'cancelled') {
        if (amountDue < netPaid) {
          nextPaymentStatus = 'refund_due';
          refundDue = netPaid - amountDue;
        } else if (amountDue === netPaid) {
          nextPaymentStatus = 'paid';
        } else {
          nextPaymentStatus = 'partially_paid';
        }
      }

      const newRegistration: EventRegistration = {
        id: regId,
        publicReference,
        eventId: event.id,
        familyId: existingRegistration?.familyId || `ext_fam_${uniqueSuffix}`,
        primaryMemberGmkId: publicReference, // External registrants receive GMK-XXXXG ID
        primaryMemberEmail: cleanEmail,
        participants: participantNames,
        totalParticipants: participantNames.length,
        registrationType: pricingResult.registrationType,
        paymentAmount: amountDue,
        amountDue: amountDue,
        amountReceived: originalAmountPaid,
        balanceDue: newBalanceDue,
        refundDue: refundDue,
        refundedAmount: totalAlreadyRefunded,
        refundHistory: existingRegistration?.refundHistory || [],
        paymentStatus: nextPaymentStatus,
        ...(existingRegistration?.financeRemarks ? { financeRemarks: existingRegistration.financeRemarks } : {}),
        createdAt: existingRegistration?.createdAt || now,
        updatedAt: new Date().toISOString(),
        ...(existingRegistration?.receiptNumber ? { receiptNumber: existingRegistration.receiptNumber } : {}),
        ...(existingRegistration?.entryPassNumber ? { entryPassNumber: existingRegistration.entryPassNumber } : {}),
        ...(existingRegistration?.paymentProcessedAt ? { paymentProcessedAt: existingRegistration.paymentProcessedAt } : {}),
        ...(existingRegistration?.paymentProcessedBy ? { paymentProcessedBy: existingRegistration.paymentProcessedBy } : {}),

        // RTCO-088: Generic External Event Registrations
        registrationSource: 'external',
        isExternal: true,
        externalRegistrationTypeId: typeConfig.id,
        externalRegistrationTypeName: typeConfig.name,
        entryType: typeConfig.entryType,
        primaryRegistrantName: normalizedFullName,
        primaryRegistrantEmail: cleanEmail,
        primaryRegistrantPhone: finalPhone,
        primaryRegistrantWhatsapp: finalWhatsapp,
        phoneCountryCode: phoneCode,
        whatsappCountryCode: finalWaCode,
        unitNumber: typeConfig.entryType === 'single' ? unitNumber.trim() : undefined,
        participantDetails: participantDetailsList,

        // Lifecycle & Review Workflow Foundation
        workflowStatus: existingRegistration?.workflowStatus || 'submitted',
        adminReviewStatus: existingRegistration?.adminReviewStatus || 'pending',

        paymentSummary: {
          baseRate: pricingResult.baseRate,
          baseRateApplied: typeConfig.entryType === 'single' ? 'single_fixed' : pricingResult.registrationType,
          totalAmount: amountDue,
          details: pricingResult.details,
          childrenCount: children.length,
          freeChildrenCount: pricingResult.breakdown.freeChildren,
          halfPriceChildrenCount: pricingResult.breakdown.halfPriceChildren,
          parentsCount: parents.length,
          othersCount: others.length,
          pricingPolicyRef: typeConfig.pricingPolicyRef || '',
          timestamp: now
        },
        attendanceSummary: {
          attendedCount: 0,
          participantsStatus: participantNames.reduce((acc, name) => {
            acc[name] = 'pending';
            return acc;
          }, {} as Record<string, 'pending' | 'attended' | 'absent'>)
        }
      };

      // Sanitize payload to prevent undefined field errors
      const sanitizedPayload = sanitizeFirestorePayload(newRegistration as any);

      // Write to Firestore via isolated validationDb
      const docRef = doc(validationDb, "event_registrations", regId);
      await setDoc(docRef, sanitizedPayload);

      setSubmittedReg(newRegistration);
      if (onSuccess) {
        onSuccess(newRegistration);
      }
    } catch (err: any) {
      console.error("External registration failed:", err);
      setErrorMsg(err.message || "An error occurred while submitting your registration. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // If successfully submitted, show confirmation view (No pricing, no fees, completely generic)
  if (submittedReg) {
    return (
      <div className="bg-white rounded-3xl border border-stone-200 shadow-xl p-6 md:p-8 space-y-6 animate-fadeIn max-w-xl mx-auto text-left">
        {/* Success Header */}
        <div className="flex items-center space-x-3 pb-4 border-b border-stone-200">
          <div className="p-3 bg-emerald-50 text-emerald-700 rounded-2xl border border-emerald-200">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <div>
            <span className="text-[10px] font-black uppercase tracking-wider text-emerald-800 bg-emerald-100/80 px-2.5 py-0.5 rounded-full">
              Registration Complete
            </span>
            <h3 className="text-xl font-extrabold text-stone-900 font-heading mt-0.5">
              Thank You, {submittedReg.primaryRegistrantName}!
            </h3>
            <p className="text-xs text-stone-600 font-semibold">
              {typeConfig.name}
            </p>
          </div>
        </div>

        {/* Reference & Details Card */}
        <div className="bg-stone-50 border border-stone-200 rounded-2xl p-4 space-y-3">
          <div className="flex justify-between items-center text-xs">
            <span className="text-stone-500 font-bold uppercase tracking-wider text-[10px]">Reference ID:</span>
            <span className="font-mono font-black text-stone-900 bg-white px-2 py-1 rounded border border-stone-200">
              {submittedReg.publicReference || submittedReg.id}
            </span>
          </div>

          <div className="flex justify-between items-center text-xs">
            <span className="text-stone-500 font-bold uppercase tracking-wider text-[10px]">Category:</span>
            <span className="font-bold text-stone-800">
              {typeConfig.name}
            </span>
          </div>

          <div className="flex justify-between items-center text-xs">
            <span className="text-stone-500 font-bold uppercase tracking-wider text-[10px]">Registration Type:</span>
            <span className="font-bold text-stone-800">
              {typeConfig.entryType === 'family' ? 'Family Registration' : 'Single Registration'}
            </span>
          </div>

          {submittedReg.unitNumber && (
            <div className="flex justify-between items-center text-xs">
              <span className="text-stone-500 font-bold uppercase tracking-wider text-[10px]">Address:</span>
              <span className="font-mono font-black text-emerald-800">
                {submittedReg.unitNumber}
              </span>
            </div>
          )}

          <div className="flex justify-between items-center text-xs pt-2 border-t border-stone-200">
            <span className="text-stone-500 font-bold uppercase tracking-wider text-[10px]">Total Participants:</span>
            <span className="font-black text-stone-900">
              {submittedReg.totalParticipants} {submittedReg.totalParticipants === 1 ? 'Person' : 'People'}
            </span>
          </div>
        </div>

        {/* Participants Summary */}
        <div className="space-y-2">
          <h4 className="text-xs font-black uppercase text-stone-500 tracking-wider">
            Registered Participants ({submittedReg.participants.length})
          </h4>
          <div className="flex flex-wrap gap-2">
            {submittedReg.participantDetails?.map((p, idx) => (
              <span
                key={idx}
                className="px-2.5 py-1 bg-white border border-stone-200 rounded-lg text-xs font-bold text-stone-800 shadow-xs flex items-center space-x-1.5"
              >
                <span>{p.name}</span>
                <span className="text-[10px] text-stone-500 font-medium capitalize">
                  ({p.role}{p.age !== undefined ? `, Age ${p.age}` : ''})
                </span>
              </span>
            ))}
          </div>
        </div>

        {/* Confirmation Notice */}
        <div className="p-4 bg-emerald-50/70 border border-emerald-200/80 rounded-2xl space-y-1.5">
          <div className="flex items-center space-x-2 text-emerald-900 font-bold text-xs">
            <Info className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>Registration Status</span>
          </div>
          <p className="text-xs text-emerald-950 font-bold leading-relaxed">
            Your registration is complete and is awaiting Admin review.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="pt-2">
          <button
            type="button"
            onClick={onBack}
            className="w-full py-3 px-4 bg-stone-100 hover:bg-stone-200 text-stone-800 font-extrabold text-xs uppercase tracking-wider rounded-xl transition-all text-center cursor-pointer border border-stone-300"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-3xl border border-stone-200 shadow-xl p-6 md:p-8 space-y-6 animate-fadeIn max-w-2xl mx-auto text-left">
      {/* Header & Back Action */}
      <div className="flex items-start justify-between gap-4 pb-4 border-b border-stone-200">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center space-x-1 text-xs font-bold text-stone-500 hover:text-stone-900 transition-colors mb-2 cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>Back to Category Selection</span>
          </button>
          <div className="flex items-center space-x-2">
            <span className="text-[10px] font-black uppercase tracking-wider text-emerald-800 bg-emerald-100 px-2.5 py-0.5 rounded-md">
              External Registration
            </span>
            <span className="text-[10px] font-black uppercase tracking-wider text-stone-600 bg-stone-100 px-2 py-0.5 rounded-md">
              {typeConfig.entryType === 'family' ? 'Family Registration' : 'Single Registration'}
            </span>
          </div>
          <h2 className="text-2xl font-black text-stone-900 font-heading mt-1">
            {typeConfig.name}
          </h2>
          <p className="text-xs text-stone-600 font-medium">
            Please fill in your details to complete your registration.
          </p>
        </div>
        <div className="p-3 bg-emerald-50 text-[#0f4c2a] rounded-2xl border border-emerald-100 hidden sm:block">
          <Users className="w-6 h-6" />
        </div>
      </div>

      {/* Error Alert */}
      {errorMsg && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-start space-x-2.5 text-xs text-rose-800 font-semibold animate-shake">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Main Registration Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Section: Primary Registrant Details */}
        <div className="space-y-4">
          <div className="flex items-center space-x-2 pb-2 border-b border-stone-150">
            <User className="w-4 h-4 text-[#0f4c2a]" />
            <h3 className="text-xs font-black uppercase tracking-wider text-stone-700">
              Primary Registrant Details
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Full Name */}
            <div className="space-y-1 sm:col-span-2">
              <label className="text-xs font-bold text-stone-700">
                Full Name <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                placeholder="Enter full name"
                required
                className="w-full text-xs font-bold bg-stone-50 border border-stone-200 p-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0f4c2a] focus:bg-white"
              />
            </div>

            {/* Email Address */}
            <div className="space-y-1 sm:col-span-2">
              <label className="text-xs font-bold text-stone-700">
                Email Address <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-stone-400 absolute left-3 top-3.5" />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  required
                  className="w-full pl-9 text-xs font-bold bg-stone-50 border border-stone-200 p-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0f4c2a] focus:bg-white"
                />
              </div>
            </div>

            {/* Mobile Number */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-stone-700">
                Mobile Number <span className="text-rose-500">*</span>
              </label>
              <div className="flex space-x-1.5">
                <select
                  value={phoneCode}
                  onChange={e => {
                    setPhoneCode(e.target.value);
                    if (whatsappSameAsMobile) setWhatsappCode(e.target.value);
                  }}
                  className="w-24 text-xs font-bold bg-stone-50 border border-stone-200 p-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0f4c2a]"
                >
                  <option value="+968">+968 (OM)</option>
                  <option value="+91">+91 (IN)</option>
                  <option value="+971">+971 (UAE)</option>
                  <option value="+966">+966 (KSA)</option>
                  <option value="+974">+974 (QA)</option>
                  <option value="+965">+965 (KW)</option>
                  <option value="+973">+973 (BH)</option>
                  <option value="+44">+44 (UK)</option>
                  <option value="+1">+1 (US/CA)</option>
                </select>
                <div className="relative flex-1">
                  <Phone className="w-4 h-4 text-stone-400 absolute left-3 top-3.5" />
                  <input
                    type="tel"
                    value={phone}
                    onChange={e => handleMobileChange(e.target.value)}
                    required
                    className="w-full pl-9 text-xs font-bold bg-stone-50 border border-stone-200 p-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0f4c2a] focus:bg-white font-mono"
                  />
                </div>
              </div>
            </div>

            {/* WhatsApp Number with Sync Checkbox */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-stone-700">WhatsApp Number</label>
                <label className="flex items-center space-x-1.5 text-[11px] text-stone-600 font-semibold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={whatsappSameAsMobile}
                    onChange={e => handleToggleWhatsappSame(e.target.checked)}
                    className="rounded text-[#0f4c2a] focus:ring-[#0f4c2a]"
                  />
                  <span>Same as mobile</span>
                </label>
              </div>

              <div className="flex space-x-1.5">
                <select
                  disabled={whatsappSameAsMobile}
                  value={whatsappCode}
                  onChange={e => setWhatsappCode(e.target.value)}
                  className="w-24 text-xs font-bold bg-stone-50 border border-stone-200 p-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0f4c2a] disabled:opacity-50"
                >
                  <option value="+968">+968 (OM)</option>
                  <option value="+91">+91 (IN)</option>
                  <option value="+971">+971 (UAE)</option>
                  <option value="+966">+966 (KSA)</option>
                  <option value="+974">+974 (QA)</option>
                  <option value="+965">+965 (KW)</option>
                  <option value="+973">+973 (BH)</option>
                  <option value="+44">+44 (UK)</option>
                  <option value="+1">+1 (US/CA)</option>
                </select>
                <input
                  type="tel"
                  disabled={whatsappSameAsMobile}
                  value={whatsapp}
                  onChange={e => setWhatsapp(e.target.value)}
                  placeholder="WhatsApp number"
                  className="flex-1 text-xs font-bold bg-stone-50 border border-stone-200 p-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0f4c2a] focus:bg-white disabled:opacity-50 font-mono"
                />
              </div>
            </div>

            {/* If Single: Address Field */}
            {typeConfig.entryType === 'single' && (
              <div className="space-y-1 sm:col-span-2 pt-2 border-t border-stone-150">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-stone-700 flex items-center space-x-1.5">
                    <MapPin className="w-3.5 h-3.5 text-[#0f4c2a]" />
                    <span>Address <span className="text-rose-500">*</span></span>
                  </label>
                  <span className="text-[10px] text-stone-500 font-semibold bg-stone-100 px-2 py-0.5 rounded">
                    Residential / Work Address
                  </span>
                </div>
                <input
                  type="text"
                  value={unitNumber}
                  onChange={e => setUnitNumber(e.target.value)}
                  placeholder="e.g. Building / Flat, Street, Area"
                  required
                  className="w-full text-xs font-bold bg-stone-50 border border-stone-200 p-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0f4c2a] focus:bg-white font-mono"
                />
                <p className="text-[11px] text-stone-500 font-medium">
                  Multiple colleagues or team members belonging to the same organization can share this address.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Section: Family Members (ONLY FOR FAMILY ENTRY TYPE) */}
        {typeConfig.entryType === 'family' && (
          <div className="space-y-5 pt-4 border-t border-stone-200">
            <div className="flex items-center justify-between pb-2 border-b border-stone-150">
              <div className="flex items-center space-x-2">
                <Users className="w-4 h-4 text-[#0f4c2a]" />
                <h3 className="text-xs font-black uppercase tracking-wider text-stone-700">
                  Family Members
                </h3>
              </div>
              <span className="text-[10px] font-bold text-stone-500">
                Add participating family members
              </span>
            </div>

            {/* 1. Spouse Section */}
            <div className="bg-stone-50 border border-stone-200 rounded-2xl p-4 flex items-center justify-between">
              <div>
                <h4 className="text-xs font-black text-stone-800 uppercase tracking-wider">
                  Spouse
                </h4>
                <p className="text-[11px] text-stone-500 font-medium">
                  Attending with your family
                </p>
              </div>
              <label className="flex items-center space-x-2 text-xs text-stone-700 font-bold cursor-pointer">
                <input
                  type="checkbox"
                  checked={hasSpouse}
                  onChange={e => setHasSpouse(e.target.checked)}
                  className="rounded text-[#0f4c2a] focus:ring-[#0f4c2a]"
                />
                <span>Include Spouse</span>
              </label>
            </div>

            {/* 2. Children Section */}
            <div className="bg-stone-50 border border-stone-200 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-black text-stone-800 uppercase tracking-wider">
                    Children ({children.length})
                  </h4>
                  <p className="text-[11px] text-stone-500 font-medium">
                    Add children attending with your family
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleAddChild}
                  className="py-1.5 px-3 bg-white hover:bg-stone-100 border border-stone-300 text-stone-800 rounded-xl text-xs font-bold flex items-center space-x-1 shadow-xs cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5 text-[#0f4c2a]" />
                  <span>Add Child</span>
                </button>
              </div>

              {children.length === 0 ? (
                <p className="text-xs text-stone-400 italic py-1">No children added.</p>
              ) : (
                <div className="space-y-2">
                  {children.map((child, idx) => (
                    <div
                      key={child.id}
                      className="bg-white border border-stone-200 rounded-xl p-3 flex items-center justify-between gap-3"
                    >
                      <span className="text-xs font-extrabold text-stone-800">
                        Child {idx + 1}
                      </span>
                      <div className="flex items-center space-x-2">
                        <label className="text-[11px] font-bold text-stone-600 shrink-0">
                          Birth Year:
                        </label>
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          maxLength={4}
                          value={child.birthYear}
                          onChange={e => handleUpdateChildBirthYear(child.id, e.target.value)}
                          placeholder="YYYY"
                          required
                          className="w-24 text-center text-xs font-bold font-mono bg-stone-50 border border-stone-200 p-2 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#0f4c2a] focus:bg-white"
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveChild(child.id)}
                          className="p-2 text-stone-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                          title="Remove Child"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 3. Parents Section */}
            <div className="bg-stone-50 border border-stone-200 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-black text-stone-800 uppercase tracking-wider">
                    Parents ({parents.length})
                  </h4>
                  <p className="text-[11px] text-stone-500 font-medium">
                    Add parents attending with your family
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleAddParent}
                  className="py-1.5 px-3 bg-white hover:bg-stone-100 border border-stone-300 text-stone-800 rounded-xl text-xs font-bold flex items-center space-x-1 shadow-xs cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5 text-[#0f4c2a]" />
                  <span>Add Parent</span>
                </button>
              </div>

              {parents.length === 0 ? (
                <p className="text-xs text-stone-400 italic py-1">No parents added.</p>
              ) : (
                <div className="space-y-2">
                  {parents.map((p, idx) => (
                    <div
                      key={p.id}
                      className="bg-white border border-stone-200 rounded-xl p-3 flex items-center justify-between"
                    >
                      <span className="text-xs font-extrabold text-stone-800">
                        Parent {idx + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoveParent(p.id)}
                        className="p-2 text-stone-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                        title="Remove Parent"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 4. Others Section */}
            <div className="bg-stone-50 border border-stone-200 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-black text-stone-800 uppercase tracking-wider">
                    Other Family Dependents ({others.length})
                  </h4>
                  <p className="text-[11px] text-stone-500 font-medium">
                    Others are additional family dependents attending with your family who are not your spouse, children, or parents.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleAddOther}
                  className="py-1.5 px-3 bg-white hover:bg-stone-100 border border-stone-300 text-stone-800 rounded-xl text-xs font-bold flex items-center space-x-1 shadow-xs cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5 text-[#0f4c2a]" />
                  <span>Add Other</span>
                </button>
              </div>

              {others.length === 0 ? (
                <p className="text-xs text-stone-400 italic py-1">No other dependents added.</p>
              ) : (
                <div className="space-y-2">
                  {others.map((o, idx) => (
                    <div
                      key={o.id}
                      className="bg-white border border-stone-200 rounded-xl p-3 flex items-center justify-between"
                    >
                      <span className="text-xs font-extrabold text-stone-800">
                        Other {idx + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoveOther(o.id)}
                        className="p-2 text-stone-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                        title="Remove Other"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Submit Actions (Zero public pricing, clean submit button) */}
        <div className="space-y-3 pt-2">
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3.5 px-6 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white font-extrabold text-xs uppercase tracking-wider rounded-xl transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2 cursor-pointer"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-white" />
                <span>Processing Registration...</span>
              </>
            ) : (
              <>
                <span>Submit Registration</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>

          <p className="text-[11px] text-stone-500 text-center font-medium">
            Registrations are subject to administrative review. You will receive confirmation details via email upon approval.
          </p>
        </div>
      </form>
    </div>
  );
}
