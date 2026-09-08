import React, { useState } from 'react';
import { Scanner } from '@yudiel/react-qr-scanner';
import { CommunityEvent, EventRegistration, Family, FamilyMember, EventAttendance } from '../types';
import { CheckCircle, XCircle, Search, QrCode, AlertTriangle, FileText, Download, Users, FileSpreadsheet, X, Mail, Send, RefreshCw, Check, Clock, AlertCircle, Filter, CheckSquare } from 'lucide-react';
import { db, auth } from '../context/AuthContext';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import AttendanceReport from './shared/AttendanceReport';
import { getRegistrationDisplayId, formatExternalGmkId, isExternalGmkId, resolveEventDetails } from '../utils/gmkIdHelper';
import { NotificationService } from '../services/NotificationService';
import { SingleEntryPassEmailModal, BulkEntryPassEmailModal } from './attendance/EntryPassEmailModals';
import { EntryPassEmailCard } from './attendance/EntryPassEmailCard';
import { getRecipientEmail } from '../utils/entryPassEmailHelper';
import { 
  processFamilyCheckInCompletion, 
  evaluateFamilyRegistrationParticipants, 
  formatCheckInTimeHHMMSS, 
  formatCheckInDate 
} from '../services/familyCheckInService';

interface Props {
  activeEvent: CommunityEvent;
  registrations: EventRegistration[];
  attendances?: EventAttendance[];
  families: Family[];
  familyMembers: FamilyMember[];
  activeTab?: 'events' | 'attendance' | 'reports';
  committeeName: string;
}

export default function AttendanceWorkspace({
  activeEvent,
  registrations,
  attendances = [],
  families,
  familyMembers,
  activeTab = 'events',
  committeeName
}: Props) {
  const [qrScannerOpen, setQrScannerOpen] = useState(false);
  const [scanInput, setScanInput] = useState('');
  const [scannedReg, setScannedReg] = useState<EventRegistration | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  
  // Attendance List State
  const [selectedReg, setSelectedReg] = useState<EventRegistration | null>(null);
  const [selectedParticipants, setSelectedParticipants] = useState<Record<string, boolean>>({});

  // Entry Pass Email State
  const [confirmEmailModalReg, setConfirmEmailModalReg] = useState<EventRegistration | null>(null);
  const [bulkEmailModalOpen, setBulkEmailModalOpen] = useState(false);
  const [selectedRegIds, setSelectedRegIds] = useState<Set<string>>(new Set());
  const [sendingEmailRegId, setSendingEmailRegId] = useState<string | null>(null);
  const [isBulkSending, setIsBulkSending] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0, success: 0, skipped: 0, failed: 0 });
  const [emailActionSuccess, setEmailActionSuccess] = useState<string | null>(null);
  const [emailActionError, setEmailActionError] = useState<string | null>(null);
  const [emailFilter, setEmailFilter] = useState<'all' | 'sent' | 'not_sent'>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'resident' | 'external'>('all');
  const [attendanceSearchTerm, setAttendanceSearchTerm] = useState('');

  const toggleSelectReg = (id: string, checked: boolean) => {
    setSelectedRegIds(prev => {
      const next = new Set(prev);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };

  // Name Search State (Part 1: Participant Name Lookup at the Gate)
  const [nameSearchInput, setNameSearchInput] = useState('');
  const [nameSearchResults, setNameSearchResults] = useState<Array<{
    registration: EventRegistration;
    participantName: string;
    relationship: string;
    displayGmkId: string;
    primaryMemberName: string;
    unitNumber: string;
  }>>([]);
  const [hasSearchedName, setHasSearchedName] = useState(false);

  const handleScan = (detectedCodes: any[]) => {
    if (detectedCodes && detectedCodes.length > 0) {
      const code = detectedCodes[0].rawValue;
      if (code) {
        processScan(code);
        setQrScannerOpen(false);
      }
    }
  };

  const processScan = (code: string) => {
    setErrorMsg('');
    setSuccessMsg('');
    setScannedReg(null);
    setSelectedParticipants({});
    
    const rawCode = code.trim();
    let searchCode = rawCode.toUpperCase();
    if (!isNaN(Number(searchCode)) && searchCode !== '') {
      searchCode = `GMK-${searchCode}`;
    }
    const formattedExternalSearch = formatExternalGmkId(rawCode);
    const bareNumber = rawCode.replace(/[^0-9]/g, '');
        
    let reg = registrations.find(r => {
      // Exclude operationally cleaned up external registrations
      if ((r as any).operationalStatus === 'cleaned_up' || (r as any).isOperationalCleanedUp === true) {
        return false;
      }

      const storedPass = (r.entryPassNumber || '').trim().toUpperCase();
      if (storedPass && (storedPass === searchCode || storedPass === rawCode.toUpperCase())) return true;

      const derivedPass = `PASS-${activeEvent.id.slice(-6).toUpperCase()}-${r.primaryMemberGmkId || r.id.slice(-6).toUpperCase()}`;
      if (derivedPass.toUpperCase() === searchCode) return true;

      if (r.id.toUpperCase() === searchCode || r.id.toUpperCase() === rawCode.toUpperCase()) return true;

      const primaryGmk = (r.primaryMemberGmkId || '').trim().toUpperCase();
      const primaryGmkFormatted = formatExternalGmkId(primaryGmk);
      if (primaryGmk && (
        primaryGmk === searchCode ||
        primaryGmk === formattedExternalSearch ||
        primaryGmkFormatted === searchCode ||
        primaryGmkFormatted === formattedExternalSearch
      )) return true;

      const publicRef = (r.publicReference || '').trim().toUpperCase();
      const publicRefFormatted = formatExternalGmkId(publicRef);
      if (publicRef && (
        publicRef === searchCode ||
        publicRef === rawCode.toUpperCase() ||
        publicRef === formattedExternalSearch ||
        publicRefFormatted === searchCode ||
        publicRefFormatted === formattedExternalSearch
      )) return true;

      const displayId = getRegistrationDisplayId(r);
      const displayIdFormatted = formatExternalGmkId(displayId);
      if (displayId && (
        displayId.toUpperCase() === searchCode ||
        displayId.toUpperCase() === formattedExternalSearch ||
        displayIdFormatted.toUpperCase() === searchCode ||
        displayIdFormatted.toUpperCase() === formattedExternalSearch
      )) return true;

      // Numeric comparison for 5-6 digit IDs (e.g. 875572)
      if (bareNumber.length >= 5) {
        const rBareRef = (r.publicReference || '').replace(/[^0-9]/g, '');
        const rBareGmk = (r.primaryMemberGmkId || '').replace(/[^0-9]/g, '');
        if (rBareRef && rBareRef === bareNumber) return true;
        if (rBareGmk && rBareGmk === bareNumber) return true;
      }

      return false;
    });
        
    if (reg) {
      setScannedReg(reg);
    } else {
      setErrorMsg(`INVALID / ERROR — No registration found for Entry Pass or GMK ID: ${code}`);
    }
  };

  const handleManualSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (scanInput.trim()) {
      processScan(scanInput.trim());
    }
  };

  const performNameSearch = (query: string) => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed || trimmed.length < 2) {
      setNameSearchResults([]);
      setHasSearchedName(false);
      return;
    }

    setHasSearchedName(true);

    const matches: Array<{
      registration: EventRegistration;
      participantName: string;
      relationship: string;
      displayGmkId: string;
      primaryMemberName: string;
      unitNumber: string;
    }> = [];

    // Filter registrations for active event (exclude operationally cleaned up)
    const eventRegs = registrations.filter(r => {
      if ((r as any).operationalStatus === 'cleaned_up' || (r as any).isOperationalCleanedUp === true) {
        return false;
      }
      const rEventId = r.eventId || '';
      return rEventId === activeEvent.id || 
        (activeEvent.eventCode && rEventId === activeEvent.eventCode) ||
        r.id.endsWith(`_${activeEvent.id}`);
    });

    eventRegs.forEach(reg => {
      const gmkId = getRegistrationDisplayId(reg) || reg.primaryMemberGmkId || '';
      const fam = families.find(f => 
        f.id === reg.familyId || 
        f.id === `fam_${gmkId}` ||
        (gmkId && f.primaryMemberGmkId === gmkId) || 
        (reg.primaryMemberEmail && f.primaryMemberEmail?.toLowerCase() === reg.primaryMemberEmail.toLowerCase())
      );
      const isExt = reg.isExternal || isExternalGmkId(reg.publicReference) || isExternalGmkId(reg.primaryMemberGmkId);
      const unitNumber = isExt
        ? (reg.externalRegistrationTypeName || 'External Guest')
        : (fam?.displayUnitNumber || reg.unitNumber || (fam as any)?.unitNumber || 'Resident');
      const primaryMemberName = fam?.fullName || reg.primaryRegistrantName || (reg.primaryMemberEmail ? reg.primaryMemberEmail.split('@')[0] : 'Unknown');
      const displayGmkId = getRegistrationDisplayId(reg) || reg.primaryMemberGmkId || formatExternalGmkId(reg.publicReference) || reg.publicReference || reg.id;

      if (!isExt) {
        const relevantFamilyMembers = familyMembers.filter(m => 
          m.familyId === reg.familyId || 
          (fam && m.familyId === fam.id) || 
          (fam && m.familyId === `fam_${fam.primaryMemberGmkId}`) ||
          (gmkId && m.familyId === `fam_${gmkId}`)
        );

        const registeredParticipantsList: Array<{ name: string; role: string }> = [];

        // Check registered participants in reg.participants
        (reg.participants || []).forEach(rawName => {
          const name = (rawName || '').trim();
          if (!name) return;
          const lower = name.toLowerCase();

          let role = 'Other';
          const primaryLower = primaryMemberName.trim().toLowerCase();
          const spouseLower = (fam?.spouseName || '').trim().toLowerCase();

          if (primaryLower && (lower === primaryLower || primaryLower.includes(lower) || lower.includes(primaryLower))) {
            role = 'GMK Member';
          } else if ((spouseLower && (lower === spouseLower || spouseLower.includes(lower) || lower.includes(spouseLower))) ||
            relevantFamilyMembers.some(m => m.relationship === 'spouse' && m.name.trim().toLowerCase() === lower)) {
            role = 'Spouse';
          } else if (relevantFamilyMembers.some(m => m.relationship === 'child' && m.name.trim().toLowerCase() === lower)) {
            role = 'Child';
          } else if (reg.participantDetails?.some(d => d.name.trim().toLowerCase() === lower)) {
            const detail = reg.participantDetails.find(d => d.name.trim().toLowerCase() === lower);
            if (detail?.role === 'primary' || detail?.role === 'single') role = 'GMK Member';
            else if (detail?.role === 'spouse') role = 'Spouse';
            else if (detail?.role === 'child') role = 'Child';
            else if (detail?.role === 'parent') role = 'Parent';
            else role = 'Other';
          } else if (relevantFamilyMembers.some(m => m.relationship === 'parent' && m.name.trim().toLowerCase() === lower) ||
            reg.paymentSummary?.parentMembers?.some(p => p.trim().toLowerCase() === lower)) {
            role = 'Parent';
          }

          if (!registeredParticipantsList.some(p => p.name.toLowerCase() === name.toLowerCase())) {
            registeredParticipantsList.push({ name, role });
          }
        });

        // Also ensure primary member is present as registered participant if registered
        if (primaryMemberName && !registeredParticipantsList.some(p => p.name.toLowerCase() === primaryMemberName.toLowerCase())) {
          registeredParticipantsList.unshift({ name: primaryMemberName, role: 'GMK Member' });
        }

        registeredParticipantsList.forEach(p => {
          if (p.name.toLowerCase().includes(trimmed)) {
            matches.push({
              registration: reg,
              participantName: p.name,
              relationship: p.role,
              displayGmkId,
              primaryMemberName,
              unitNumber
            });
          }
        });
      } else {
        // External registrations
        const { adults, children } = getParticipantDetails(reg);
        const allExt = [...adults, ...children];
        const extCategory = reg.externalRegistrationTypeName || reg.category || 'External Guest';

        allExt.forEach(p => {
          if (p.name.toLowerCase().includes(trimmed)) {
            matches.push({
              registration: reg,
              participantName: p.name,
              relationship: p.category && p.category !== 'Adult' ? `${extCategory} (${p.category})` : extCategory,
              displayGmkId,
              primaryMemberName,
              unitNumber
            });
          }
        });
      }
    });

    setNameSearchResults(matches);
  };

  const handleNameSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    performNameSearch(nameSearchInput);
  };

  const handleSelectRegistrationFromSearch = (reg: EventRegistration) => {
    setErrorMsg('');
    setSuccessMsg('');
    setScannedReg(reg);
    setSelectedParticipants({});
  };

  const handleCheckIn = async (reg: EventRegistration) => {
    if (!reg || !activeEvent.id) return;
    const gmkId = getRegistrationDisplayId(reg) || reg.primaryMemberGmkId || formatExternalGmkId(reg.publicReference) || reg.publicReference || reg.id.split('_')?.[1] || reg.id;
    if (!gmkId) {
      setErrorMsg("Cannot process check-in: Missing GMK ID.");
      return;
    }
    
    const attRef = doc(db, "eventAttendance", `att_${gmkId}_${activeEvent.id}`);
    const existing = attendances.find(a => (a as any).primaryMemberGmkId === gmkId || a.id === `att_${gmkId}_${activeEvent.id}`);
    
    const { adults, children } = getParticipantDetails(reg);
    const allParticipants = [...adults, ...children];
    
    const newlySelected = allParticipants.filter(p => selectedParticipants[p.name]);
    
    if (newlySelected.length === 0) {
      setErrorMsg("Please select at least one attendee to check in.");
      return;
    }
    
    setIsSubmitting(true);
    setErrorMsg('');
    try {
      const nowStr = new Date().toISOString();
      const adminEmail = auth.currentUser?.email || 'Gate Attendance Officer';
      
      const existingArrivedDetails = (existing as any)?.arrivedDetails || [];
      const newArrivedDetails = newlySelected.map(p => ({
        name: p.name,
        category: p.category,
        arrivedAt: nowStr,
        scannedBy: adminEmail
      }));
      
      const combinedArrivedDetails = [...existingArrivedDetails, ...newArrivedDetails];
      const isFullyEntered = combinedArrivedDetails.length >= (reg.totalParticipants || 1);
      
      await setDoc(attRef, {
        id: `att_${gmkId}_${activeEvent.id}`,
        eventId: activeEvent.id,
        committeeKey: 'attendance',
        primaryMemberGmkId: gmkId,
        status: isFullyEntered ? 'attended' : 'checked_in',
        attendedAt: nowStr,
        scannedBy: adminEmail,
        totalParticipants: reg.totalParticipants || 1,
        totalAttended: combinedArrivedDetails.length,
        entryPassNumber: reg.entryPassNumber || `PASS-${activeEvent.id.slice(-6).toUpperCase()}-${gmkId}`,
        arrivedDetails: combinedArrivedDetails
      }, { merge: true });

      // RTCO-FamilyCheckIn: Process family-level check-in completion notification
      let completionResult: any = null;
      try {
        completionResult = await processFamilyCheckInCompletion({
          reg,
          activeEvent,
          combinedArrivedDetails,
          existingAttendance: existing,
          families,
          familyMembers
        });
      } catch (completionErr) {
        console.error("[AttendanceWorkspace] Non-blocking completion email processing error:", completionErr);
      }
      
      if (completionResult?.emailQueued) {
        setSuccessMsg(`Gate entry recorded for ${newlySelected.length} attendees. Family check-in complete — completion confirmation email queued for ${completionResult.recipientEmail}.`);
      } else if (completionResult?.alreadyQueued) {
        setSuccessMsg(`Gate entry recorded for ${newlySelected.length} attendees. (Family completion email was previously recorded).`);
      } else {
        setSuccessMsg(`Gate entry recorded for ${newlySelected.length} attendees.`);
      }

      setSelectedParticipants({});
    } catch (err: any) {
      setErrorMsg(`Gate check-in failed: ${err.message || err}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Helper for Adults/Children calc
  const getCounts = (reg: EventRegistration) => {
    let childrenCount = reg.paymentSummary?.childrenCount || 0;
    childrenCount += reg.paymentSummary?.halfPriceChildrenCount || 0;
    childrenCount += reg.paymentSummary?.freeChildrenCount || 0;
    const adultsCount = Math.max(0, (reg.totalParticipants || 0) - childrenCount);
    return { adultsCount, childrenCount };
  };

  const getParticipantDetails = (reg: EventRegistration) => {
    const fam = families.find(f => f.id === reg.familyId);
    const famMembers = familyMembers.filter(m => m.familyId === reg.familyId);
    const currentYear = new Date().getFullYear();
    const participants = reg.participants || [];
    
    const adults: { name: string, category: string, age: number }[] = [];
    const children: { name: string, category: string, age: number }[] = [];
    
    participants.forEach(name => {
      let category = 'Adult';
      let age = 30; // default adult
      
      const isPrimary = (name.trim().toLowerCase() === (fam?.fullName || reg.primaryMemberEmail).trim().toLowerCase());
      if (isPrimary) {
        category = 'Adult';
      } else {
        const mem = famMembers.find(m => m.name.toLowerCase().trim() === name.toLowerCase().trim());
        if (mem && mem.relationship === 'child') {
          if (mem.yearOfBirth) {
            const yob = parseInt(mem.yearOfBirth);
            if (!isNaN(yob)) {
              age = currentYear - yob;
              if (age <= 3) category = 'Kids 0-3';
              else if (age <= 9) category = 'Kids 4-9';
              else if (age < 18) category = 'Kids 10+';
              else category = 'Adult'; 
            } else {
              category = 'Kids 10+'; 
            }
          } else {
            category = 'Kids 10+';
          }
        }
      }
      
      if (category === 'Adult') {
        adults.push({ name, category, age });
      } else {
        children.push({ name, category, age });
      }
    });
    
    const isExt = reg.isExternal || isExternalGmkId(reg.publicReference) || isExternalGmkId(reg.primaryMemberGmkId);

    if (isExt) {
      const externalCount = (reg.totalParticipants || 0) - participants.length;
      for (let i = 0; i < externalCount; i++) {
        adults.push({ name: `Guest/External ${i+1}`, category: 'Adult', age: 30 });
      }
    } else {
      const explicitExternalCount = reg.paymentSummary?.externalParticipantsCount || 0;
      for (let i = 0; i < explicitExternalCount; i++) {
        adults.push({ name: `External Guest ${i+1}`, category: 'Adult', age: 30 });
      }
    }
    
    return { adults, children };
  };

  // Filter valid registrations for Attendance (excluding operationally cleaned up, cancelled, refunded)
  const validRegs = registrations.filter(r => {
    if ((r as any).operationalStatus === 'cleaned_up' || (r as any).isOperationalCleanedUp === true) {
      return false;
    }
    if ((r as any).workflowStatus === 'cancelled' || (r as any).workflowStatus === 'refunded') {
      return false;
    }
    if ((r as any).status === 'cancelled' || (r as any).status === 'refunded') {
      return false;
    }
    const st = r.paymentStatus || 'pending';
    return st === 'paid' || st === 'approved' || st === 'waived' || st === 'partially_paid' || st === 'overpaid';
  });

  const getAttendanceStatus = (reg: EventRegistration) => {
    const gmkId = getRegistrationDisplayId(reg) || reg.primaryMemberGmkId || formatExternalGmkId(reg.publicReference) || reg.publicReference || reg.id.split('_')?.[1] || reg.id;
    const att = attendances.find(a => (a as any).primaryMemberGmkId === gmkId || a.id === `att_${gmkId}_${activeEvent.id}`);
    
    if (!att) return { label: 'NOT CHECKED IN', color: 'bg-stone-100 text-stone-600', checkedIn: false, partially: false, att, arrivedNames: [], completionEmailSent: false };
    
    const arrivedDetails = (att as any).arrivedDetails || [];
    const arrivedNames = arrivedDetails.map((d: any) => d.name);
    let attTotal = arrivedNames.length > 0 ? arrivedNames.length : ((att as any).totalAttended || (att as any).totalParticipants || 0);
    const completionEmailSent = !!(
      att.completionEmailSentAt || 
      att.familyCompletionEmailSent || 
      att.completionEmailQueuedAt || 
      reg.completionEmailQueuedAt || 
      reg.completionEmailSentAt || 
      reg.familyCompletionEmailSent
    );
    
    if (att.status === 'attended' || att.status === 'checked_in' || attTotal > 0) {
      if (attTotal > 0 && attTotal < (reg.totalParticipants || 0)) {
         return { label: `${attTotal} / ${reg.totalParticipants} CHECKED IN`, color: 'bg-amber-100 text-amber-800', checkedIn: false, partially: true, att, arrivedNames, completionEmailSent };
      }
      return { label: 'FULLY ENTERED', color: 'bg-emerald-100 text-emerald-800', checkedIn: true, partially: false, att, arrivedNames, completionEmailSent };
    }
    return { label: 'NOT CHECKED IN', color: 'bg-stone-100 text-stone-600', checkedIn: false, partially: false, att, arrivedNames: [], completionEmailSent };
  };

  const getIndividualAttendanceData = () => {
    const records: Array<{
      gmkId: string;
      name: string;
      relationship: string;
      checkInDate: string;
      checkInTime: string;
      status: 'Checked In' | 'Not Checked In';
    }> = [];

    validRegs.forEach(reg => {
      const isExt = reg.isExternal || isExternalGmkId(reg.publicReference) || isExternalGmkId(reg.primaryMemberGmkId);
      const displayGmk = getRegistrationDisplayId(reg) || reg.primaryMemberGmkId || formatExternalGmkId(reg.publicReference) || reg.publicReference || reg.id;
      const stat = getAttendanceStatus(reg);
      const arrivedDetails: Array<{ name: string; arrivedAt?: string; scannedBy?: string; category?: string }> = (stat.att as any)?.arrivedDetails || [];

      if (!isExt) {
        // Resident registration: strictly include GMK Member, Spouse, Children. Explicitly exclude Parents, Relatives, Others.
        const evalResult = evaluateFamilyRegistrationParticipants(reg, arrivedDetails, families, familyMembers);

        evalResult.allParticipants.forEach(p => {
          let isEligible = p.isEligible;
          let relationship: string = p.relationship;

          if (!isEligible && reg.participantDetails) {
            const detail = reg.participantDetails.find(d => d.name.trim().toLowerCase() === p.name.trim().toLowerCase());
            if (detail) {
              if (detail.role === 'child') {
                relationship = 'Child';
                isEligible = true;
              } else if (detail.role === 'spouse') {
                relationship = 'Spouse';
                isEligible = true;
              } else if (detail.role === 'primary' || detail.role === 'single') {
                relationship = 'GMK Member';
                isEligible = true;
              }
            }
          }

          // EXPLICITLY EXCLUDE Parents, Relatives, Others
          if (!isEligible) {
            return;
          }

          const arrival = arrivedDetails.find(a => a.name && a.name.trim().toLowerCase() === p.name.trim().toLowerCase());
          const isCheckedIn = !!arrival;
          const arrivalTimestamp = arrival?.arrivedAt;

          let checkInDate = '-';
          let checkInTime = '-';

          if (isCheckedIn && arrivalTimestamp) {
            const rawDate = formatCheckInDate(arrivalTimestamp);
            checkInDate = rawDate ? rawDate.replace(/ /g, '-') : '-';
            checkInTime = formatCheckInTimeHHMMSS(arrivalTimestamp);
          }

          records.push({
            gmkId: displayGmk,
            name: p.name,
            relationship,
            checkInDate,
            checkInTime,
            status: isCheckedIn ? 'Checked In' : 'Not Checked In'
          });
        });
      } else {
        // External registration: Preserve existing external attendance model.
        // Do NOT classify as GMK Member, Spouse, or Child!
        const { adults, children } = getParticipantDetails(reg);
        const allExt = [...adults, ...children];
        const extCategory = reg.externalRegistrationTypeName || reg.category || 'External Guest';

        allExt.forEach(p => {
          const arrival = arrivedDetails.find(a => a.name && a.name.trim().toLowerCase() === p.name.trim().toLowerCase());
          const isCheckedIn = !!arrival || (stat.checkedIn && arrivedDetails.length === 0);
          const arrivalTimestamp = arrival?.arrivedAt || (stat.checkedIn ? ((stat.att as any)?.checkedInAt || (stat.att as any)?.attendedAt) : undefined);

          let checkInDate = '-';
          let checkInTime = '-';

          if (isCheckedIn && arrivalTimestamp) {
            const rawDate = formatCheckInDate(arrivalTimestamp);
            checkInDate = rawDate ? rawDate.replace(/ /g, '-') : '-';
            checkInTime = formatCheckInTimeHHMMSS(arrivalTimestamp);
          }

          let extRelationship = extCategory;
          if (p.category && p.category !== 'Adult') {
            extRelationship += ` (${p.category})`;
          }

          records.push({
            gmkId: displayGmk,
            name: p.name,
            relationship: extRelationship,
            checkInDate,
            checkInTime,
            status: isCheckedIn ? 'Checked In' : 'Not Checked In'
          });
        });
      }
    });

    return records;
  };

  const generateGmkWisePDFReport = () => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text('GMK-WISE ATTENDANCE REPORT', 14, 20);
    doc.setFontSize(10);
    doc.text(`Event: ${activeEvent.title}`, 14, 28);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 34);

    let totalEligible = validRegs.length;
    let totalAttendees = 0;
    let totalCheckedIn = 0;
    let totalPartially = 0;
    let totalNotChecked = 0;

    const tableData = validRegs.map((reg, index) => {
      const isExt = reg.isExternal || isExternalGmkId(reg.publicReference) || isExternalGmkId(reg.primaryMemberGmkId);
      const fam = families.find(f => f.id === reg.familyId);
      const displayGmk = getRegistrationDisplayId(reg) || reg.primaryMemberGmkId || formatExternalGmkId(reg.publicReference) || 'N/A';
      const name = fam?.fullName || reg.primaryRegistrantName || reg.primaryMemberEmail || 'N/A';
      const unit = isExt
        ? (reg.externalRegistrationTypeName || 'External Guest')
        : (fam?.displayUnitNumber || reg.unitNumber || (fam as any)?.unitNumber || 'Resident');
      const category = isExt ? (reg.externalRegistrationTypeName || 'External Guest') : 'Resident';

      const stat = getAttendanceStatus(reg);
      const arrivedDetails: Array<{ name: string; arrivedAt?: string; scannedBy?: string }> = (stat.att as any)?.arrivedDetails || [];

      let eligibleCount = 0;
      let checkedInCount = 0;
      let familyCompletionStatus = 'Not Arrived';

      if (!isExt) {
        const evalResult = evaluateFamilyRegistrationParticipants(reg, arrivedDetails, families, familyMembers);
        const eligibleList = evalResult.allParticipants.filter(p => {
          if (p.isEligible) return true;
          const detail = reg.participantDetails?.find(d => d.name.trim().toLowerCase() === p.name.trim().toLowerCase());
          return detail && (detail.role === 'child' || detail.role === 'spouse' || detail.role === 'primary' || detail.role === 'single');
        });

        eligibleCount = eligibleList.length;
        checkedInCount = eligibleList.filter(p => p.isCheckedIn).length;

        if (stat.completionEmailSent || (eligibleCount > 0 && checkedInCount === eligibleCount)) {
          familyCompletionStatus = 'Completed';
        } else if (checkedInCount > 0) {
          familyCompletionStatus = 'Partial';
        } else {
          familyCompletionStatus = 'Not Arrived';
        }
      } else {
        eligibleCount = reg.totalParticipants || (reg.participants ? reg.participants.length : 0);
        checkedInCount = arrivedDetails.length > 0 ? arrivedDetails.length : ((stat.att as any)?.totalAttended || (stat.checkedIn ? eligibleCount : 0));
        familyCompletionStatus = (eligibleCount > 0 && checkedInCount >= eligibleCount) ? 'Completed' : (checkedInCount > 0 ? 'Partial' : 'Not Arrived');
      }

      totalAttendees += eligibleCount;
      if (stat.checkedIn || (eligibleCount > 0 && checkedInCount === eligibleCount)) totalCheckedIn++;
      else if (stat.partially || checkedInCount > 0) totalPartially++;
      else totalNotChecked++;

      return [
        (index + 1).toString(),
        displayGmk,
        name,
        unit,
        category,
        eligibleCount.toString(),
        checkedInCount.toString(),
        stat.label,
        familyCompletionStatus
      ];
    });

    doc.text(`Total Eligible Registrations: ${totalEligible} | Total Eligible Attendees: ${totalAttendees}`, 14, 42);
    doc.text(`Checked In: ${totalCheckedIn} | Partially Checked In: ${totalPartially} | Not Checked In: ${totalNotChecked}`, 14, 48);

    autoTable(doc, {
      startY: 54,
      head: [['#', 'GMK ID', 'Primary Registrant', 'Unit / Property', 'Category', 'Eligible', 'Checked In', 'Status', 'Family Completion']],
      body: tableData,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [15, 76, 42] }
    });

    const dateStr = new Date().toISOString().slice(0, 10);
    doc.save(`GMK_Wise_Attendance_Report_${activeEvent.id}_${dateStr}.pdf`);
  };

  const generateGmkWiseExcelReport = () => {
    let totalEligible = validRegs.length;
    let totalAttendees = 0;
    let totalCheckedIn = 0;
    let totalPartially = 0;
    let totalNotChecked = 0;

    const exportData = validRegs.map((reg, index) => {
      const isExt = reg.isExternal || isExternalGmkId(reg.publicReference) || isExternalGmkId(reg.primaryMemberGmkId);
      const fam = families.find(f => f.id === reg.familyId);
      const displayGmk = getRegistrationDisplayId(reg) || reg.primaryMemberGmkId || formatExternalGmkId(reg.publicReference) || 'N/A';
      const name = fam?.fullName || reg.primaryRegistrantName || reg.primaryMemberEmail || 'N/A';
      const unit = isExt
        ? (reg.externalRegistrationTypeName || 'External Guest')
        : (fam?.displayUnitNumber || reg.unitNumber || (fam as any)?.unitNumber || 'Resident');
      const category = isExt ? (reg.externalRegistrationTypeName || 'External Guest') : 'Resident';

      const stat = getAttendanceStatus(reg);
      const arrivedDetails: Array<{ name: string; arrivedAt?: string; scannedBy?: string }> = (stat.att as any)?.arrivedDetails || [];

      let eligibleCount = 0;
      let checkedInCount = 0;
      let familyCompletionStatus = 'Not Arrived';

      if (!isExt) {
        const evalResult = evaluateFamilyRegistrationParticipants(reg, arrivedDetails, families, familyMembers);
        const eligibleList = evalResult.allParticipants.filter(p => {
          if (p.isEligible) return true;
          const detail = reg.participantDetails?.find(d => d.name.trim().toLowerCase() === p.name.trim().toLowerCase());
          return detail && (detail.role === 'child' || detail.role === 'spouse' || detail.role === 'primary' || detail.role === 'single');
        });

        eligibleCount = eligibleList.length;
        checkedInCount = eligibleList.filter(p => p.isCheckedIn).length;

        if (stat.completionEmailSent || (eligibleCount > 0 && checkedInCount === eligibleCount)) {
          familyCompletionStatus = 'Completed';
        } else if (checkedInCount > 0) {
          familyCompletionStatus = 'Partial';
        } else {
          familyCompletionStatus = 'Not Arrived';
        }
      } else {
        eligibleCount = reg.totalParticipants || (reg.participants ? reg.participants.length : 0);
        checkedInCount = arrivedDetails.length > 0 ? arrivedDetails.length : ((stat.att as any)?.totalAttended || (stat.checkedIn ? eligibleCount : 0));
        familyCompletionStatus = (eligibleCount > 0 && checkedInCount >= eligibleCount) ? 'Completed' : (checkedInCount > 0 ? 'Partial' : 'Not Arrived');
      }

      totalAttendees += eligibleCount;
      if (stat.checkedIn || (eligibleCount > 0 && checkedInCount === eligibleCount)) totalCheckedIn++;
      else if (stat.partially || checkedInCount > 0) totalPartially++;
      else totalNotChecked++;

      return {
        'Sl. No.': index + 1,
        'GMK ID': displayGmk,
        'Primary Registrant': name,
        'Unit / Property': unit,
        'Registration Category': category,
        'Eligible Participants': eligibleCount,
        'Checked-In Participants': checkedInCount,
        'Attendance Status': stat.label,
        'Family Completion Status': familyCompletionStatus,
        'Entry Pass Number': reg.entryPassNumber || `PASS-${reg.id.slice(-4)}`
      };
    });

    const summaryData = [
      { Metric: 'Total Eligible Registrations', Value: totalEligible },
      { Metric: 'Total Eligible Attendees', Value: totalAttendees },
      { Metric: 'Fully Checked In Families', Value: totalCheckedIn },
      { Metric: 'Partially Checked In Families', Value: totalPartially },
      { Metric: 'Not Checked In Families', Value: totalNotChecked }
    ];

    const wb = XLSX.utils.book_new();
    const wsData = XLSX.utils.json_to_sheet(exportData);
    const wsSummary = XLSX.utils.json_to_sheet(summaryData);

    XLSX.utils.book_append_sheet(wb, wsData, "GMK-Wise Attendance");
    XLSX.utils.book_append_sheet(wb, wsSummary, "Summary");

    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `GMK_Wise_Attendance_Report_${activeEvent.id}_${dateStr}.xlsx`);
  };

  const generateIndividualPDFReport = () => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text('INDIVIDUAL ATTENDANCE REPORT', 14, 20);
    doc.setFontSize(10);
    doc.text(`Event: ${activeEvent.title}`, 14, 28);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 34);

    const records = getIndividualAttendanceData();
    const totalCount = records.length;
    const checkedInCount = records.filter(r => r.status === 'Checked In').length;
    const notCheckedInCount = totalCount - checkedInCount;

    doc.text(`Total Eligible Participants: ${totalCount} | Checked In: ${checkedInCount} | Not Checked In: ${notCheckedInCount}`, 14, 42);

    const tableData = records.map((r, idx) => [
      (idx + 1).toString(),
      r.gmkId,
      r.name,
      r.relationship,
      r.checkInDate,
      r.checkInTime,
      r.status
    ]);

    autoTable(doc, {
      startY: 48,
      head: [['#', 'GMK ID', 'Participant Name', 'Relationship', 'Check-in Date', 'Check-in Time', 'Status']],
      body: tableData,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [15, 76, 42] }
    });

    const dateStr = new Date().toISOString().slice(0, 10);
    doc.save(`Individual_Attendance_Report_${activeEvent.id}_${dateStr}.pdf`);
  };

  const generateIndividualExcelReport = () => {
    const records = getIndividualAttendanceData();
    const totalCount = records.length;
    const checkedInCount = records.filter(r => r.status === 'Checked In').length;
    const notCheckedInCount = totalCount - checkedInCount;

    const exportData = records.map((r, idx) => ({
      'Sl. No.': idx + 1,
      'GMK ID': r.gmkId,
      'Participant Name': r.name,
      'Relationship': r.relationship,
      'Check-in Date': r.checkInDate === '-' ? '' : r.checkInDate,
      'Check-in Time': r.checkInTime === '-' ? '' : r.checkInTime,
      'Attendance Status': r.status
    }));

    const summaryData = [
      { Metric: 'Total Eligible Participants', Value: totalCount },
      { Metric: 'Checked In', Value: checkedInCount },
      { Metric: 'Not Checked In', Value: notCheckedInCount }
    ];

    const wb = XLSX.utils.book_new();
    const wsData = XLSX.utils.json_to_sheet(exportData);
    const wsSummary = XLSX.utils.json_to_sheet(summaryData);

    XLSX.utils.book_append_sheet(wb, wsData, "Individual Attendance");
    XLSX.utils.book_append_sheet(wb, wsSummary, "Summary");

    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `Individual_Attendance_Report_${activeEvent.id}_${dateStr}.xlsx`);
  };

  const generatePDFReport = generateGmkWisePDFReport;
  const generateExcelReport = generateGmkWiseExcelReport;

  return (
    <div className="bg-white border border-stone-200 rounded-3xl p-6 shadow-sm space-y-6 animate-fadeIn">
      {/* HEADER */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-stone-150 pb-4">
        <div>
          <h4 className="font-extrabold text-[#0f4c2a] text-lg uppercase tracking-wider font-heading flex items-center space-x-2">
            <QrCode className="w-5 h-5 text-[#0f4c2a] shrink-0" />
            <span>{committeeName} Workspace</span>
          </h4>
          <p className="text-stone-500 text-xs font-bold mt-1">
            Gate QR entry pass verification & real-time event attendance tracking
          </p>
        </div>
      </div>

      {activeTab === 'events' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* SCANNER SECTION */}
          <div className="space-y-4">
            <div className="p-5 bg-stone-50 border border-stone-200 rounded-2xl">
              <h5 className="font-extrabold text-stone-900 text-sm uppercase tracking-wider mb-4 flex items-center space-x-2">
                <QrCode className="w-5 h-5 text-[#0f4c2a]" />
                <span>Scan Entry Pass</span>
              </h5>
              
              {!qrScannerOpen ? (
                <button
                  onClick={() => setQrScannerOpen(true)}
                  className="w-full py-4 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white rounded-xl font-black text-sm uppercase tracking-wider shadow-md transition-all flex items-center justify-center space-x-2 cursor-pointer"
                >
                  <QrCode className="w-5 h-5" />
                  <span>Open Camera Scanner</span>
                </button>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-xl overflow-hidden border-2 border-[#0f4c2a] relative">
                    <Scanner onScan={handleScan} />
                    <div className="absolute top-0 left-0 right-0 p-2 bg-black/50 text-white text-center text-xs font-bold z-10">
                      Point camera at QR Code
                    </div>
                  </div>
                  <button
                    onClick={() => setQrScannerOpen(false)}
                    className="w-full py-2 bg-stone-200 hover:bg-stone-300 text-stone-800 rounded-xl font-bold text-xs uppercase tracking-wider transition-all cursor-pointer"
                  >
                    Close Scanner
                  </button>
                </div>
              )}

              <div className="mt-6">
                <p className="text-[10px] text-stone-500 font-bold uppercase tracking-wider mb-2 text-center">
                  OR FIND BY GMK ID
                </p>
                <form onSubmit={handleManualSearch} className="flex items-center space-x-2">
                  <div className="relative flex-1 flex items-center bg-white border border-stone-300 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-[#0f4c2a]">
                    <Search className="ml-3 w-4 h-4 text-stone-400 shrink-0" />
                    <span className="pl-2 font-bold text-stone-500 text-xs shrink-0">GMK-</span>
                    <input
                      type="text"
                      value={scanInput}
                      onChange={(e) => {
                        let val = e.target.value.trim().toUpperCase();
                        if (val.startsWith('GMK-')) {
                          val = val.slice(4);
                        }
                        setScanInput(val);
                      }}
                      placeholder="1001 or 875572"
                      className="w-full pl-1 pr-3 py-2 font-bold text-stone-900 text-xs focus:outline-none font-mono"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={!scanInput.trim()}
                    className="px-4 py-2 bg-stone-800 hover:bg-stone-900 text-white rounded-xl font-black text-xs uppercase tracking-wider disabled:opacity-50 transition-all cursor-pointer shadow-xs shrink-0"
                  >
                    Verify
                  </button>
                </form>
              </div>

              {/* PART 1: PARTICIPANT NAME SEARCH AT THE GATE */}
              <div className="mt-6 pt-5 border-t border-stone-200">
                <p className="text-[10px] text-stone-500 font-bold uppercase tracking-wider mb-2 text-center">
                  OR SEARCH BY PARTICIPANT NAME
                </p>
                <form onSubmit={handleNameSearchSubmit} className="space-y-3">
                  <div className="flex items-center space-x-2">
                    <div className="relative flex-1 flex items-center bg-white border border-stone-300 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-[#0f4c2a]">
                      <Search className="ml-3 w-4 h-4 text-stone-400 shrink-0" />
                      <input
                        type="text"
                        value={nameSearchInput}
                        onChange={(e) => {
                          const val = e.target.value;
                          setNameSearchInput(val);
                          if (val.trim().length >= 2) {
                            performNameSearch(val);
                          } else {
                            setNameSearchResults([]);
                            setHasSearchedName(false);
                          }
                        }}
                        placeholder="Search participant name..."
                        className="w-full pl-2 pr-8 py-2 font-medium text-stone-900 text-xs focus:outline-none"
                      />
                      {nameSearchInput && (
                        <button
                          type="button"
                          onClick={() => {
                            setNameSearchInput('');
                            setNameSearchResults([]);
                            setHasSearchedName(false);
                          }}
                          className="absolute right-2 p-1 text-stone-400 hover:text-stone-600 rounded-full hover:bg-stone-100 cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <button
                      type="submit"
                      disabled={nameSearchInput.trim().length < 2}
                      className="px-4 py-2 bg-stone-800 hover:bg-stone-900 text-white rounded-xl font-black text-xs uppercase tracking-wider disabled:opacity-50 transition-all cursor-pointer shadow-xs shrink-0"
                    >
                      Search
                    </button>
                  </div>
                </form>

                {/* Name Search Results */}
                {hasSearchedName && (
                  <div className="mt-3 space-y-2">
                    {nameSearchResults.length === 0 ? (
                      <div className="p-3 bg-stone-50 border border-stone-200 rounded-xl text-center">
                        <p className="text-xs text-stone-600 font-bold">
                          No matching participants found for "{nameSearchInput.trim()}"
                        </p>
                        <p className="text-[10px] text-stone-400 mt-0.5">
                          Only registered participants for this event are searched.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                        <p className="text-[10px] text-stone-500 font-extrabold uppercase tracking-wider">
                          Found {nameSearchResults.length} match{nameSearchResults.length > 1 ? 'es' : ''} (select to verify):
                        </p>
                        {nameSearchResults.map((match, idx) => (
                          <div
                            key={`${match.registration.id}_${match.participantName}_${idx}`}
                            className="p-3 bg-white border border-stone-200 hover:border-[#0f4c2a] rounded-xl shadow-2xs transition-all space-y-1.5"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-extrabold text-stone-900 text-xs">
                                  {match.participantName}
                                </span>
                                <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md ${
                                  match.relationship.toLowerCase().includes('member')
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : match.relationship.toLowerCase().includes('spouse')
                                    ? 'bg-purple-100 text-purple-800'
                                    : match.relationship.toLowerCase().includes('child')
                                    ? 'bg-blue-100 text-blue-800'
                                    : 'bg-stone-100 text-stone-700'
                                }`}>
                                  {match.relationship}
                                </span>
                              </div>
                              <span className="font-mono font-bold text-xs text-[#0f4c2a] shrink-0">
                                {match.displayGmkId}
                              </span>
                            </div>

                            <div className="flex items-center justify-between text-[11px] text-stone-500 gap-2">
                              <div className="truncate">
                                <span className="font-semibold text-stone-700">Primary:</span> {match.primaryMemberName}
                                <span className="mx-1 text-stone-300">•</span>
                                <span className="font-semibold text-stone-700">Unit:</span> {match.unitNumber}
                              </div>
                              <button
                                type="button"
                                onClick={() => handleSelectRegistrationFromSearch(match.registration)}
                                className="px-3 py-1 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white text-[10px] font-black uppercase tracking-wider rounded-lg shadow-2xs cursor-pointer transition-all shrink-0"
                              >
                                Verify
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* VERIFICATION RESULT */}
          <div className="space-y-4">
            {errorMsg && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-2xl flex items-start space-x-3 text-red-800 animate-fadeIn">
                <XCircle className="w-5 h-5 shrink-0 mt-0.5" />
                <div>
                  <h6 className="font-extrabold text-sm uppercase tracking-wider">Invalid / Error</h6>
                  <p className="text-xs font-bold mt-1">{errorMsg}</p>
                </div>
              </div>
            )}
            
            {successMsg && (
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-start space-x-3 text-emerald-800 animate-fadeIn">
                <CheckCircle className="w-5 h-5 shrink-0 mt-0.5" />
                <div>
                  <h6 className="font-extrabold text-sm uppercase tracking-wider">Success</h6>
                  <p className="text-xs font-bold mt-1">{successMsg}</p>
                </div>
              </div>
            )}

            {scannedReg && (() => {
              const status = scannedReg.paymentStatus || 'pending';
              const isApproved = status === 'paid' || status === 'approved' || status === 'waived' || status === 'partially_paid' || status === 'overpaid';
              const isBlocked = !isApproved;
              const attStatus = getAttendanceStatus(scannedReg);
              const isFullyEntered = attStatus.checkedIn;
              const isPartiallyEntered = attStatus.partially;
              
              const fam = families.find(f => f.id === scannedReg.familyId);
              const primaryName = fam ? fam.fullName : (scannedReg.primaryRegistrantName || (scannedReg.primaryMemberEmail ? scannedReg.primaryMemberEmail.split('@')[0] : 'Unknown'));
              
              const isExt = scannedReg.isExternal || isExternalGmkId(scannedReg.publicReference) || isExternalGmkId(scannedReg.primaryMemberGmkId);
              const categoryOrUnit = isExt
                ? (scannedReg.externalRegistrationTypeName || 'External Guest')
                : (fam?.displayUnitNumber || scannedReg.unitNumber || 'Resident');

              const { adults, children } = getParticipantDetails(scannedReg);
              const alreadyArrived = attStatus.arrivedNames || [];
              const showCheckboxes = isApproved && !isFullyEntered;
              
              return (
                <div className={`p-5 border-2 rounded-2xl animate-fadeIn ${
                  isFullyEntered ? 'bg-amber-50 border-amber-500' : (isApproved ? 'bg-emerald-50 border-emerald-500' : 'bg-rose-50 border-rose-500')
                }`}>
                  <div className="flex items-start justify-between border-b border-stone-200/50 pb-3 mb-3">
                    <div className="flex items-center space-x-3">
                      {isFullyEntered ? (
                        <CheckCircle className="w-8 h-8 text-amber-600" />
                      ) : isApproved ? (
                        <CheckCircle className="w-8 h-8 text-emerald-600" />
                      ) : (
                        <AlertTriangle className="w-8 h-8 text-rose-600" />
                      )}
                      <div>
                        <h5 className="font-extrabold text-lg uppercase tracking-wider font-heading text-stone-900">
                          {isFullyEntered ? 'ALL REGISTERED ATTENDEES HAVE ALREADY ENTERED' : (isApproved ? 'ACCESS GRANTED' : 'ACCESS DENIED')}
                        </h5>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                          isFullyEntered ? 'bg-amber-200 text-amber-900' : (isPartiallyEntered ? 'bg-emerald-200 text-emerald-900' : (isApproved ? 'bg-emerald-200 text-emerald-900' : 'bg-rose-200 text-rose-900'))
                        }`}>
                          STATUS: {attStatus.label !== 'NOT CHECKED IN' ? attStatus.label : status}
                        </span>
                        {attStatus.completionEmailSent && (
                          <span className="inline-flex items-center gap-1 ml-2 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-300">
                            <CheckCircle className="w-3 h-3 text-emerald-600" />
                            Completion Email Sent
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <p className="text-[10px] text-stone-500 font-bold uppercase tracking-wider">Registered Name</p>
                      <p className="text-sm font-black text-stone-900">{primaryName}</p>
                    </div>
                    
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <p className="text-[10px] text-stone-500 font-bold uppercase tracking-wider">
                          {isExt ? 'Category' : 'Property Unit'}
                        </p>
                        <p className="text-xs font-bold text-stone-900">{categoryOrUnit}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-stone-500 font-bold uppercase tracking-wider">Entry Pass / GMK</p>
                        <p className="text-xs font-mono font-bold text-stone-700">{scannedReg.entryPassNumber || getRegistrationDisplayId(scannedReg) || scannedReg.id}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-stone-500 font-bold uppercase tracking-wider">Attendees</p>
                        <p className="text-xs font-black text-stone-900">{scannedReg.totalParticipants}</p>
                      </div>
                    </div>
                    
                    {isBlocked && (
                      <div className="p-3 bg-white/60 rounded-xl mt-3">
                        <p className="text-xs font-bold text-rose-800">
                          {status === 'pending' && "Payment is pending. Attendee must complete payment at Finance desk."}
                          {status === 'cancelled' && "Registration was cancelled."}
                          {status === 'refunded' && "Registration was refunded."}
                        </p>
                      </div>
                    )}

                    {isFullyEntered && (
                      <div className="p-3 bg-white/60 rounded-xl mt-3">
                        <p className="text-xs font-bold text-amber-800">
                          This Entry Pass has already been fully used for entry.
                        </p>
                      </div>
                    )}

                    {showCheckboxes && (
                      <div className="mt-4 pt-4 border-t border-emerald-200/50 space-y-4">
                        <div className="flex justify-between items-center mb-4 p-3 bg-white/60 rounded-xl border border-stone-200">
                          <div className="text-center">
                            <p className="text-[9px] font-bold text-stone-500 uppercase tracking-wider">Registered</p>
                            <p className="text-lg font-black text-stone-900">{scannedReg.totalParticipants}</p>
                          </div>
                          <div className="text-center">
                            <p className="text-[9px] font-bold text-stone-500 uppercase tracking-wider">Entered</p>
                            <p className="text-lg font-black text-emerald-700">{alreadyArrived.length}</p>
                          </div>
                          <div className="text-center">
                            <p className="text-[9px] font-bold text-stone-500 uppercase tracking-wider">Remaining</p>
                            <p className="text-lg font-black text-amber-700">{(scannedReg.totalParticipants || 0) - alreadyArrived.length}</p>
                          </div>
                        </div>

                        <p className="text-xs font-bold text-stone-600 mb-2">Select who has arrived:</p>
                        {adults.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-[10px] text-stone-500 font-bold uppercase tracking-wider">Adults — {adults.length}</p>
                            {adults.map(p => {
                              const arrived = alreadyArrived.includes(p.name);
                              return (
                                <label key={p.name} className={`flex items-center space-x-3 p-3 rounded-xl border ${arrived ? 'bg-emerald-50/50 border-emerald-200 opacity-70' : 'bg-white border-stone-200 cursor-pointer hover:bg-stone-50 shadow-xs'}`}>
                                  <input 
                                    type="checkbox" 
                                    disabled={arrived}
                                    checked={arrived || selectedParticipants[p.name] || false}
                                    onChange={(e) => setSelectedParticipants(prev => ({ ...prev, [p.name]: e.target.checked }))}
                                    className="w-4 h-4 text-[#0f4c2a] rounded border-stone-300 focus:ring-[#0f4c2a]"
                                  />
                                  <span className="text-xs font-bold text-stone-800">{p.name}</span>
                                  {arrived && <span className="text-[9px] font-black uppercase text-emerald-700 ml-auto tracking-wider">Entered</span>}
                                </label>
                              );
                            })}
                          </div>
                        )}
                        {children.length > 0 && (
                          <div className="space-y-2 mt-4">
                            <p className="text-[10px] text-stone-500 font-bold uppercase tracking-wider">Children — {children.length}</p>
                            {children.map(p => {
                              const arrived = alreadyArrived.includes(p.name);
                              return (
                                <label key={p.name} className={`flex items-center space-x-3 p-3 rounded-xl border ${arrived ? 'bg-emerald-50/50 border-emerald-200 opacity-70' : 'bg-white border-stone-200 cursor-pointer hover:bg-stone-50 shadow-xs'}`}>
                                  <input 
                                    type="checkbox" 
                                    disabled={arrived}
                                    checked={arrived || selectedParticipants[p.name] || false}
                                    onChange={(e) => setSelectedParticipants(prev => ({ ...prev, [p.name]: e.target.checked }))}
                                    className="w-4 h-4 text-[#0f4c2a] rounded border-stone-300 focus:ring-[#0f4c2a]"
                                  />
                                  <div className="flex flex-col">
                                    <span className="text-xs font-bold text-stone-800">{p.name}</span>
                                    <span className="text-[9px] font-bold text-stone-500 uppercase">{p.category}</span>
                                  </div>
                                  {arrived && <span className="text-[9px] font-black uppercase text-emerald-700 ml-auto tracking-wider">Entered</span>}
                                </label>
                              );
                            })}
                          </div>
                        )}
                        <button 
                          disabled={isSubmitting || !Object.values(selectedParticipants).some(v => v)}
                          onClick={() => handleCheckIn(scannedReg)}
                          className="w-full mt-4 py-3 bg-[#0f4c2a] hover:bg-[#0c3e22] disabled:opacity-50 text-white rounded-xl font-black text-xs uppercase tracking-wider transition-all shadow-md cursor-pointer"
                        >
                          Confirm Check-In
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Official Entry Pass Email Card */}
                  <div className="mt-4">
                    <EntryPassEmailCard
                      registration={scannedReg}
                      activeEvent={activeEvent}
                      families={families}
                      onTriggerEmail={(r) => setConfirmEmailModalReg(r)}
                      isSending={sendingEmailRegId === scannedReg.id}
                    />
                  </div>

                  <div className="mt-4 pt-4 border-t border-stone-200">
                    <button 
                      onClick={() => {
                        setScannedReg(null);
                        setScanInput('');
                        setErrorMsg('');
                        setSuccessMsg('');
                        setSelectedParticipants({});
                      }}
                      className="w-full py-2.5 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-xl font-black text-xs uppercase tracking-wider transition-all shadow-sm cursor-pointer border border-stone-200"
                    >
                      Back to Lookup
                    </button>
                  </div>
                </div>
              );
            })()}

            {!scannedReg && !errorMsg && !successMsg && (
              <div className="h-full flex flex-col items-center justify-center p-8 text-center border border-dashed border-stone-200 rounded-2xl bg-stone-50/50">
                <QrCode className="w-10 h-10 text-stone-300 mb-3" />
                <h6 className="text-xs font-extrabold text-stone-700 uppercase tracking-wider">Awaiting Scan</h6>
                <p className="text-[10px] text-stone-500 font-bold mt-1">
                  Scan a QR code or enter an ID manually to verify registration.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'attendance' && (() => {
        let totalCheckedIn = 0;
        let totalPartially = 0;
        let totalNotChecked = 0;
        let totalAttendees = 0;
        let totalAdults = 0;
        let totalChildren = 0;

        validRegs.forEach(reg => {
          const stat = getAttendanceStatus(reg);
          if (stat.checkedIn) totalCheckedIn++;
          else if (stat.partially) totalPartially++;
          else totalNotChecked++;

          const { adultsCount, childrenCount } = getCounts(reg);
          totalAttendees += reg.totalParticipants || 0;
          totalAdults += adultsCount;
          totalChildren += childrenCount;
        });

        // Category breakdown counts
        const allCount = validRegs.length;
        const residentRegs = validRegs.filter(r => !(r.isExternal || isExternalGmkId(r.publicReference) || isExternalGmkId(r.primaryMemberGmkId)));
        const externalRegs = validRegs.filter(r => (r.isExternal || isExternalGmkId(r.publicReference) || isExternalGmkId(r.primaryMemberGmkId)));
        const residentCount = residentRegs.length;
        const externalCount = externalRegs.length;

        // Base registrations scoped to current category filter
        const categoryScopedRegs = categoryFilter === 'resident'
          ? residentRegs
          : categoryFilter === 'external'
          ? externalRegs
          : validRegs;

        const sentEmailsCount = categoryScopedRegs.filter(r => Boolean(r.entryPassEmailSentAt)).length;
        const notSentEmailsCount = categoryScopedRegs.length - sentEmailsCount;

        const filteredRegs = categoryScopedRegs.filter(reg => {
          const isSent = Boolean(reg.entryPassEmailSentAt);
          if (emailFilter === 'sent' && !isSent) return false;
          if (emailFilter === 'not_sent' && isSent) return false;

          if (attendanceSearchTerm.trim()) {
            const q = attendanceSearchTerm.trim().toLowerCase();
            const fam = families.find(f => f.id === reg.familyId);
            const name = (fam?.fullName || reg.primaryRegistrantName || reg.primaryMemberEmail || '').toLowerCase();
            const gmkId = (getRegistrationDisplayId(reg) || reg.primaryMemberGmkId || formatExternalGmkId(reg.publicReference) || reg.publicReference || '').toLowerCase();
            const passNo = (reg.entryPassNumber || '').toLowerCase();
            const unit = (reg.isExternal ? (reg.externalRegistrationTypeName || '') : (fam?.displayUnitNumber || reg.unitNumber || '')).toLowerCase();
            const email = getRecipientEmail(reg, families).toLowerCase();

            return name.includes(q) || gmkId.includes(q) || passNo.includes(q) || unit.includes(q) || email.includes(q);
          }
          return true;
        });

        return (
          <div className="space-y-6">
            {/* SUMMARY CARDS */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-4 bg-stone-50 border border-stone-200 rounded-2xl flex flex-col justify-center items-center text-center">
                <span className="text-[10px] text-stone-500 font-black uppercase tracking-wider mb-1 block">Total Eligible</span>
                <span className="text-2xl font-black text-stone-900">{validRegs.length}</span>
              </div>
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex flex-col justify-center items-center text-center">
                <span className="text-[10px] text-emerald-700 font-black uppercase tracking-wider mb-1 block">Checked In</span>
                <span className="text-2xl font-black text-emerald-700">{totalCheckedIn}</span>
              </div>
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex flex-col justify-center items-center text-center">
                <span className="text-[10px] text-amber-700 font-black uppercase tracking-wider mb-1 block">Partially</span>
                <span className="text-2xl font-black text-amber-700">{totalPartially}</span>
              </div>
              <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex flex-col justify-center items-center text-center">
                <span className="text-[10px] text-rose-700 font-black uppercase tracking-wider mb-1 block">Not Checked In</span>
                <span className="text-2xl font-black text-rose-700">{totalNotChecked}</span>
              </div>
            </div>

            {/* DETAIL VIEW MODAL / EXPANDED SECTION */}
            {selectedReg && (() => {
              const stat = getAttendanceStatus(selectedReg);
              const fam = families.find(f => f.id === selectedReg.familyId);
              const { adultsCount, childrenCount } = getCounts(selectedReg);
              
              const { adults, children } = getParticipantDetails(selectedReg);
              const alreadyArrived = stat.arrivedNames || [];
              const isFullyEntered = stat.checkedIn;
              
              const isExtReg = selectedReg.isExternal || isExternalGmkId(selectedReg.publicReference) || isExternalGmkId(selectedReg.primaryMemberGmkId);
              const explicitExternal = selectedReg.paymentSummary?.externalParticipantsCount || 0;
              const expectedTotal = (selectedReg.participants || []).length + explicitExternal;
              const isInconsistentResident = !isExtReg && expectedTotal < (selectedReg.totalParticipants || 0);
              
              return (
                <div className="p-5 border-2 border-[#0f4c2a] rounded-2xl bg-white shadow-lg relative animate-fadeIn">
                  <button 
                    onClick={() => { setSelectedReg(null); setSelectedParticipants({}); }}
                    className="absolute top-4 right-4 text-stone-400 hover:text-stone-800"
                  >
                    <XCircle className="w-5 h-5" />
                  </button>
                  <h5 className="font-extrabold text-sm uppercase tracking-wider mb-4 border-b border-stone-200 pb-2">
                    Attendance Details
                  </h5>
                  
                  {isInconsistentResident && (
                    <div className="mb-4 text-xs font-bold text-amber-700 bg-amber-50 p-3 rounded-xl border border-amber-200">
                      <div className="flex items-center space-x-2">
                        <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
                        <span><strong>Data Inconsistency Warning:</strong> Participant information is incomplete or inconsistent with the total participant count. Family completion email cannot be triggered for this registration. Please update the registration in Admin Events.</span>
                      </div>
                    </div>
                  )}
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                    <div>
                      <span className="block text-[9px] uppercase font-bold text-stone-500">Primary Registrant</span>
                      <span className="block text-xs font-black">{fam?.fullName || selectedReg.primaryRegistrantName || selectedReg.primaryMemberEmail}</span>
                    </div>
                    <div>
                      <span className="block text-[9px] uppercase font-bold text-stone-500">
                        {selectedReg.isExternal ? 'Registration Category' : 'Property Unit'}
                      </span>
                      <span className="block text-xs font-black">
                        {selectedReg.isExternal 
                          ? (selectedReg.externalRegistrationTypeName || 'External Guest') 
                          : (fam?.displayUnitNumber || selectedReg.unitNumber || 'Resident')}
                      </span>
                    </div>
                    <div>
                      <span className="block text-[9px] uppercase font-bold text-stone-500">Entry Pass / GMK</span>
                      <span className="block text-xs font-black font-mono">{selectedReg.entryPassNumber || getRegistrationDisplayId(selectedReg) || selectedReg.id.slice(-6)}</span>
                    </div>
                    <div>
                      <span className="block text-[9px] uppercase font-bold text-stone-500">Status</span>
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${stat.color}`}>
                        {stat.label}
                      </span>
                      {stat.completionEmailSent && (
                        <div className="mt-1 flex items-center gap-1 text-[8.5px] font-black text-emerald-700 uppercase tracking-tight">
                          <CheckCircle className="w-3 h-3 text-emerald-600" />
                          <span>Completion Email Sent</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4 mb-4 p-3 bg-stone-50 rounded-xl">
                    <div>
                      <span className="block text-[9px] uppercase font-bold text-stone-500">Total Participants</span>
                      <span className="block text-sm font-black">{selectedReg.totalParticipants}</span>
                    </div>
                    <div>
                      <span className="block text-[9px] uppercase font-bold text-stone-500">Adults</span>
                      <span className="block text-sm font-black">{adultsCount}</span>
                    </div>
                    <div>
                      <span className="block text-[9px] uppercase font-bold text-stone-500">Children</span>
                      <span className="block text-sm font-black">{childrenCount}</span>
                    </div>
                  </div>

                  {errorMsg && (
                    <div className="mb-4 text-xs font-bold text-rose-600 bg-rose-50 p-2 rounded-lg">{errorMsg}</div>
                  )}
                  {successMsg && (
                    <div className="mb-4 text-xs font-bold text-emerald-600 bg-emerald-50 p-2 rounded-lg">{successMsg}</div>
                  )}

                  {/* Official Entry Pass Email Card */}
                  <div className="mb-4">
                    <EntryPassEmailCard
                      registration={selectedReg}
                      activeEvent={activeEvent}
                      families={families}
                      onTriggerEmail={(r) => setConfirmEmailModalReg(r)}
                      isSending={sendingEmailRegId === selectedReg.id}
                    />
                  </div>

                  {!isFullyEntered && (
                    <div className="mt-4 pt-4 border-t border-stone-200 space-y-4">
                      <div className="flex justify-between items-center mb-4 p-3 bg-stone-50 rounded-xl border border-stone-200">
                        <div className="text-center flex-1 border-r border-stone-200">
                          <p className="text-[9px] font-bold text-stone-500 uppercase tracking-wider">Registered</p>
                          <p className="text-lg font-black text-stone-900">{selectedReg.totalParticipants}</p>
                        </div>
                        <div className="text-center flex-1 border-r border-stone-200">
                          <p className="text-[9px] font-bold text-stone-500 uppercase tracking-wider">Entered</p>
                          <p className="text-lg font-black text-emerald-700">{alreadyArrived.length}</p>
                        </div>
                        <div className="text-center flex-1">
                          <p className="text-[9px] font-bold text-stone-500 uppercase tracking-wider">Remaining</p>
                          <p className="text-lg font-black text-amber-700">{(selectedReg.totalParticipants || 0) - alreadyArrived.length}</p>
                        </div>
                      </div>

                      <p className="text-xs font-bold text-stone-600 mb-2">Select who has arrived:</p>
                      {adults.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-[10px] text-stone-500 font-bold uppercase tracking-wider">Adults — {adults.length}</p>
                          {adults.map(p => {
                            const arrived = alreadyArrived.includes(p.name);
                            return (
                              <label key={p.name} className={`flex items-center space-x-3 p-3 rounded-xl border ${arrived ? 'bg-emerald-50/50 border-emerald-200 opacity-70' : 'bg-white border-stone-200 cursor-pointer hover:bg-stone-50 shadow-xs'}`}>
                                <input 
                                  type="checkbox" 
                                  disabled={arrived}
                                  checked={arrived || selectedParticipants[p.name] || false}
                                  onChange={(e) => setSelectedParticipants(prev => ({ ...prev, [p.name]: e.target.checked }))}
                                  className="w-4 h-4 text-[#0f4c2a] rounded border-stone-300 focus:ring-[#0f4c2a]"
                                />
                                <span className="text-xs font-bold text-stone-800">{p.name}</span>
                                {arrived && <span className="text-[9px] font-black uppercase text-emerald-700 ml-auto tracking-wider">Entered</span>}
                              </label>
                            );
                          })}
                        </div>
                      )}
                      {children.length > 0 && (
                        <div className="space-y-2 mt-4">
                          <p className="text-[10px] text-stone-500 font-bold uppercase tracking-wider">Children — {children.length}</p>
                          {children.map(p => {
                            const arrived = alreadyArrived.includes(p.name);
                            return (
                              <label key={p.name} className={`flex items-center space-x-3 p-3 rounded-xl border ${arrived ? 'bg-emerald-50/50 border-emerald-200 opacity-70' : 'bg-white border-stone-200 cursor-pointer hover:bg-stone-50 shadow-xs'}`}>
                                <input 
                                  type="checkbox" 
                                  disabled={arrived}
                                  checked={arrived || selectedParticipants[p.name] || false}
                                  onChange={(e) => setSelectedParticipants(prev => ({ ...prev, [p.name]: e.target.checked }))}
                                  className="w-4 h-4 text-[#0f4c2a] rounded border-stone-300 focus:ring-[#0f4c2a]"
                                />
                                <div className="flex flex-col">
                                  <span className="text-xs font-bold text-stone-800">{p.name}</span>
                                  <span className="text-[9px] font-bold text-stone-500 uppercase">{p.category}</span>
                                </div>
                                {arrived && <span className="text-[9px] font-black uppercase text-emerald-700 ml-auto tracking-wider">Entered</span>}
                              </label>
                            );
                          })}
                        </div>
                      )}
                      <button 
                        disabled={isSubmitting || !Object.values(selectedParticipants).some(v => v)}
                        onClick={() => handleCheckIn(selectedReg)}
                        className="w-full py-3 bg-[#0f4c2a] hover:bg-[#0c3e22] disabled:opacity-50 text-white rounded-xl font-black text-xs uppercase tracking-wider transition-all cursor-pointer"
                      >
                        Confirm Check-In Now
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ALERT BANNERS */}
            {emailActionSuccess && (
              <div className="p-3.5 bg-emerald-50 border border-emerald-300 text-emerald-900 rounded-xl text-xs font-bold flex items-center justify-between animate-fadeIn shadow-2xs">
                <span className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{emailActionSuccess}</span>
                </span>
                <button 
                  type="button"
                  onClick={() => setEmailActionSuccess(null)} 
                  className="text-emerald-700 hover:text-emerald-900 font-bold ml-2 p-1 rounded-md hover:bg-emerald-100 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
            {emailActionError && (
              <div className="p-3.5 bg-rose-50 border border-rose-300 text-rose-900 rounded-xl text-xs font-bold flex items-center justify-between animate-fadeIn shadow-2xs">
                <span className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{emailActionError}</span>
                </span>
                <button 
                  type="button"
                  onClick={() => setEmailActionError(null)} 
                  className="text-rose-700 hover:text-rose-900 font-bold ml-2 p-1 rounded-md hover:bg-rose-100 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* ------------------------------------------------------------- */}
            {/* ENTRY PASS EMAIL SECTION / CARD                               */}
            {/* ------------------------------------------------------------- */}
            <div className="bg-white border-2 border-stone-200 rounded-3xl p-5 shadow-sm space-y-4">
              {/* Card Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stone-200 pb-4">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-[#0f4c2a] shrink-0">
                    <Mail className="w-5 h-5 text-[#0f4c2a]" />
                  </div>
                  <div>
                    <h5 className="font-extrabold text-[#0f4c2a] text-sm uppercase tracking-wider font-heading flex items-center gap-2">
                      <span>ENTRY PASS EMAIL</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-black tracking-normal">
                        Bulk Dispatch
                      </span>
                    </h5>
                    <p className="text-stone-500 text-xs font-bold mt-0.5">
                      Batch send official entry pass QR code emails to approved resident and external attendees
                    </p>
                  </div>
                </div>

                {/* Primary Action Button: SEND ENTRY PASS EMAILS */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={selectedRegIds.size === 0}
                    onClick={() => setBulkEmailModalOpen(true)}
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#0f4c2a] hover:bg-[#0c3e22] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-sm cursor-pointer"
                  >
                    <Send className="w-4 h-4 text-amber-300" />
                    <span>SEND ENTRY PASS EMAILS {selectedRegIds.size > 0 ? `(${selectedRegIds.size})` : ''}</span>
                  </button>
                </div>
              </div>

              {/* Filters & Actions Bar */}
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 p-3.5 bg-stone-50 border border-stone-200 rounded-2xl">
                <div className="flex flex-wrap items-center gap-2.5 flex-1">
                  {/* Resident / External / All Filter */}
                  <div className="flex items-center bg-white border border-stone-300 rounded-xl p-0.5 shadow-2xs">
                    <button
                      type="button"
                      onClick={() => setCategoryFilter('all')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        categoryFilter === 'all' 
                          ? 'bg-[#0f4c2a] text-white shadow-2xs' 
                          : 'text-stone-600 hover:text-stone-900'
                      }`}
                    >
                      All ({allCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => setCategoryFilter('resident')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        categoryFilter === 'resident' 
                          ? 'bg-[#0f4c2a] text-white shadow-2xs' 
                          : 'text-stone-600 hover:text-stone-900'
                      }`}
                    >
                      Resident ({residentCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => setCategoryFilter('external')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        categoryFilter === 'external' 
                          ? 'bg-[#0f4c2a] text-white shadow-2xs' 
                          : 'text-stone-600 hover:text-stone-900'
                      }`}
                    >
                      External ({externalCount})
                    </button>
                  </div>

                  {/* All / Pass Email Sent / Pass Email Not Sent Filter */}
                  <div className="flex items-center space-x-1.5">
                    <Filter className="w-3.5 h-3.5 text-stone-500" />
                    <select
                      value={emailFilter}
                      onChange={(e) => setEmailFilter(e.target.value as any)}
                      className="py-1.5 px-3 bg-white border border-stone-300 rounded-xl text-xs font-bold text-stone-700 focus:outline-hidden focus:ring-2 focus:ring-[#0f4c2a]"
                    >
                      <option value="all">All Statuses ({categoryScopedRegs.length})</option>
                      <option value="sent">Pass Email Sent ({sentEmailsCount})</option>
                      <option value="not_sent">Pass Email Not Sent ({notSentEmailsCount})</option>
                    </select>
                  </div>

                  {/* Search */}
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={attendanceSearchTerm}
                      onChange={(e) => setAttendanceSearchTerm(e.target.value)}
                      placeholder="Search name, GMK ID, pass #, unit, email..."
                      className="w-full pl-8 pr-7 py-1.5 bg-white border border-stone-300 rounded-xl text-xs font-semibold focus:outline-hidden focus:ring-2 focus:ring-[#0f4c2a] focus:border-transparent placeholder:text-stone-400"
                    />
                    {attendanceSearchTerm && (
                      <button
                        type="button"
                        onClick={() => setAttendanceSearchTerm('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 p-0.5 cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Quick Selection & Selected Count */}
                <div className="flex items-center gap-2 shrink-0">
                  {notSentEmailsCount > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        const unsentIds = categoryScopedRegs.filter(r => !r.entryPassEmailSentAt).map(r => r.id);
                        const next = new Set(selectedRegIds);
                        unsentIds.forEach(id => next.add(id));
                        setSelectedRegIds(next);
                        if (emailFilter === 'sent') setEmailFilter('all');
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-stone-100 border border-stone-300 text-stone-700 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-2xs"
                    >
                      <CheckSquare className="w-3.5 h-3.5 text-[#0f4c2a]" />
                      <span>SELECT ALL UNSENT ({notSentEmailsCount})</span>
                    </button>
                  )}

                  <span className="text-xs font-black px-2.5 py-1.5 bg-stone-200 text-stone-800 rounded-xl">
                    {selectedRegIds.size} Selected
                  </span>

                  {selectedRegIds.size > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedRegIds(new Set())}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-600 rounded-xl text-xs font-bold transition-all cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Clear</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Selectable Registrations Table */}
              <div className="overflow-x-auto border border-stone-200 rounded-2xl bg-white">
                <table className="w-full text-left text-xs whitespace-nowrap">
                  <thead className="bg-stone-50 border-b border-stone-200 text-[10px] uppercase font-black tracking-wider text-stone-500">
                    <tr>
                      <th className="px-3 py-3 text-center w-8">
                        <input
                          type="checkbox"
                          checked={filteredRegs.length > 0 && filteredRegs.every(r => selectedRegIds.has(r.id))}
                          onChange={(e) => {
                            if (e.target.checked) {
                              const next = new Set(selectedRegIds);
                              filteredRegs.forEach(r => next.add(r.id));
                              setSelectedRegIds(next);
                            } else {
                              const next = new Set(selectedRegIds);
                              filteredRegs.forEach(r => next.delete(r.id));
                              setSelectedRegIds(next);
                            }
                          }}
                          className="w-3.5 h-3.5 text-[#0f4c2a] rounded border-stone-300 focus:ring-[#0f4c2a]"
                          title="Select/Deselect visible rows"
                        />
                      </th>
                      <th className="px-3 py-3 text-center w-8">#</th>
                      <th className="px-4 py-3">Pass #</th>
                      <th className="px-4 py-3">GMK ID</th>
                      <th className="px-4 py-3">Name</th>
                      <th className="px-4 py-3">Category / Unit</th>
                      <th className="px-4 py-3">Recipient Email</th>
                      <th className="px-4 py-3 text-center">Total</th>
                      <th className="px-4 py-3">Attendance</th>
                      <th className="px-4 py-3 text-center">Pass Email</th>
                      <th className="px-4 py-3 text-right">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {filteredRegs.map((reg, index) => {
                      const stat = getAttendanceStatus(reg);
                      const fam = families.find(f => f.id === reg.familyId);
                      const { adultsCount, childrenCount } = getCounts(reg);
                      const isExt = reg.isExternal || isExternalGmkId(reg.publicReference) || isExternalGmkId(reg.primaryMemberGmkId);
                      const categoryOrUnit = isExt
                        ? (reg.externalRegistrationTypeName || 'External Guest')
                        : (fam?.displayUnitNumber || reg.unitNumber || '-');
                      const recipientEmail = getRecipientEmail(reg, families);
                      const isSent = Boolean(reg.entryPassEmailSentAt);
                      const isSelected = selectedRegIds.has(reg.id);

                      return (
                        <tr 
                          key={reg.id} 
                          onClick={() => {
                            setErrorMsg(''); setSuccessMsg(''); setSelectedReg(reg);
                          }}
                          className={`hover:bg-stone-50 cursor-pointer transition-colors ${isSelected ? 'bg-emerald-50/40' : ''}`}
                        >
                          <td 
                            className="px-3 py-3 text-center w-8"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(e) => toggleSelectReg(reg.id, e.target.checked)}
                              className="w-3.5 h-3.5 text-[#0f4c2a] rounded border-stone-300 focus:ring-[#0f4c2a]"
                            />
                          </td>
                          <td className="px-3 py-3 font-mono font-bold text-stone-400 text-center">
                            {index + 1}
                          </td>
                          <td className="px-4 py-3 font-mono font-bold text-stone-600">
                            {reg.entryPassNumber || reg.id.slice(-6)}
                          </td>
                          <td className="px-4 py-3 font-bold text-stone-900">{getRegistrationDisplayId(reg) || reg.primaryMemberGmkId || formatExternalGmkId(reg.publicReference) || '-'}</td>
                          <td className="px-4 py-3 font-black text-stone-900">{fam?.fullName || reg.primaryRegistrantName || reg.primaryMemberEmail}</td>
                          <td className="px-4 py-3 font-bold text-stone-600">{categoryOrUnit}</td>
                          <td className="px-4 py-3 text-stone-600 font-mono text-[11px]">
                            {recipientEmail ? (
                              <span className="truncate max-w-[180px] inline-block">{recipientEmail}</span>
                            ) : (
                              <span className="text-amber-700 font-semibold italic">Missing</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center font-black">{reg.totalParticipants}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${stat.color}`}>
                              {stat.label}
                            </span>
                          </td>
                          <td 
                            className="px-4 py-3 text-center"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {isSent ? (
                              <button
                                type="button"
                                onClick={() => setConfirmEmailModalReg(reg)}
                                title={`Sent on ${new Date(reg.entryPassEmailSentAt!).toLocaleString()} - Click to resend`}
                                className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all shadow-2xs cursor-pointer"
                              >
                                <Check className="w-3 h-3 text-emerald-600" />
                                <span>Sent</span>
                              </button>
                            ) : recipientEmail ? (
                              <button
                                type="button"
                                onClick={() => setConfirmEmailModalReg(reg)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white rounded-lg text-[10px] font-black uppercase tracking-wider transition-all shadow-2xs cursor-pointer"
                              >
                                <Mail className="w-3 h-3 text-amber-300" />
                                <span>Send</span>
                              </button>
                            ) : (
                              <span className="inline-block px-2 py-0.5 bg-stone-100 text-stone-400 rounded-md text-[9px] font-bold uppercase tracking-wider">
                                No Email
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right text-stone-500 font-bold">
                            {stat.att?.checkedInAt || (stat.att as any)?.attendedAt ? new Date(stat.att?.checkedInAt || (stat.att as any)?.attendedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-'}
                          </td>
                        </tr>
                      );
                    })}
                    {filteredRegs.length === 0 && (
                      <tr>
                        <td colSpan={11} className="px-4 py-8 text-center text-stone-500 font-bold">
                          {attendanceSearchTerm || emailFilter !== 'all' || categoryFilter !== 'all'
                            ? 'No registrations match your search or filter criteria.' 
                            : 'No eligible registrations found for this event.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })()}

      {activeTab === 'reports' && (
        <div className="space-y-6">
          <div className="p-6 bg-stone-50 border border-stone-200 rounded-2xl space-y-6">
            <div>
              <h5 className="font-extrabold text-stone-900 text-sm uppercase tracking-wider flex items-center space-x-2">
                <FileText className="w-5 h-5 text-[#0f4c2a]" />
                <span>Download Attendance Reports</span>
              </h5>
              <p className="text-xs text-stone-500 font-bold mt-1">
                Export real-time gate attendance data for event records and audit purposes.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
              {/* REPORT 1: GMK-WISE ATTENDANCE REPORT */}
              <div className="p-5 bg-white border border-stone-200 rounded-2xl space-y-4 shadow-xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center space-x-2 text-[#0f4c2a] mb-1">
                    <Users className="w-4 h-4 shrink-0" />
                    <h6 className="font-extrabold text-xs uppercase tracking-wider text-stone-900">
                      GMK-Wise Attendance Report
                    </h6>
                  </div>
                  <p className="text-xs text-stone-500 font-bold">
                    Family / registration-level attendance
                  </p>
                </div>
                <div className="flex items-center gap-3 pt-2">
                  <button
                    onClick={generateGmkWisePDFReport}
                    className="flex-1 py-2.5 px-4 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white rounded-xl font-black text-xs uppercase tracking-wider transition-all flex items-center justify-center space-x-2 shadow-xs cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    <span>PDF</span>
                  </button>
                  <button
                    onClick={generateGmkWiseExcelReport}
                    className="flex-1 py-2.5 px-4 bg-stone-800 hover:bg-stone-900 text-white rounded-xl font-black text-xs uppercase tracking-wider transition-all flex items-center justify-center space-x-2 shadow-xs cursor-pointer"
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                    <span>Excel</span>
                  </button>
                </div>
              </div>

              {/* REPORT 2: INDIVIDUAL ATTENDANCE REPORT */}
              <div className="p-5 bg-white border border-stone-200 rounded-2xl space-y-4 shadow-xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center space-x-2 text-[#0f4c2a] mb-1">
                    <FileText className="w-4 h-4 shrink-0" />
                    <h6 className="font-extrabold text-xs uppercase tracking-wider text-stone-900">
                      Individual Attendance Report
                    </h6>
                  </div>
                  <p className="text-xs text-stone-500 font-bold">
                    Participant-level attendance with individual check-in times
                  </p>
                </div>
                <div className="flex items-center gap-3 pt-2">
                  <button
                    onClick={generateIndividualPDFReport}
                    className="flex-1 py-2.5 px-4 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white rounded-xl font-black text-xs uppercase tracking-wider transition-all flex items-center justify-center space-x-2 shadow-xs cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    <span>PDF</span>
                  </button>
                  <button
                    onClick={generateIndividualExcelReport}
                    className="flex-1 py-2.5 px-4 bg-stone-800 hover:bg-stone-900 text-white rounded-xl font-black text-xs uppercase tracking-wider transition-all flex items-center justify-center space-x-2 shadow-xs cursor-pointer"
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                    <span>Excel</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
          
          <div className="p-4 border border-stone-200 rounded-xl bg-white space-y-2">
            <h6 className="text-[10px] font-black text-stone-500 uppercase tracking-wider flex items-center space-x-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
              <span>Report Details</span>
            </h6>
            <ul className="text-xs text-stone-600 space-y-1 list-disc list-inside ml-1">
              <li>Reports only include eligible paid or waived registrations.</li>
              <li>GMK-Wise report provides registration-level totals and family arrival completion status.</li>
              <li>Individual report provides participant-level records with individual check-in timestamps in Asia/Muscat time.</li>
              <li>Resident individual report explicitly includes Member, Spouse, and Children (Parents/Others excluded).</li>
            </ul>
          </div>
        </div>
      )}

      {/* REGISTRATION STATUS REPORT TAB */}
      {activeTab === ('registration_status' as any) && (
        <AttendanceReport initialEventId={activeEvent.id} />
      )}

      {/* ENTRY PASS EMAIL CONFIRMATION MODAL */}
      {confirmEmailModalReg && (
        <SingleEntryPassEmailModal
          registration={confirmEmailModalReg}
          activeEvent={activeEvent}
          families={families}
          familyMembers={familyMembers}
          getParticipantDetailsFn={getParticipantDetails}
          onClose={() => setConfirmEmailModalReg(null)}
          onSuccess={(msg) => setEmailActionSuccess(msg)}
          onError={(err) => setEmailActionError(err)}
        />
      )}

      {/* BULK ENTRY PASS EMAIL MODAL */}
      {bulkEmailModalOpen && (
        <BulkEntryPassEmailModal
          selectedRegistrations={validRegs.filter(r => selectedRegIds.has(r.id))}
          activeEvent={activeEvent}
          families={families}
          familyMembers={familyMembers}
          getParticipantDetailsFn={getParticipantDetails}
          onClose={() => setBulkEmailModalOpen(false)}
          onFinished={(summary) => {
            setBulkEmailModalOpen(false);
            setSelectedRegIds(new Set());
            setEmailActionSuccess(summary);
          }}
        />
      )}
    </div>
  );
}
