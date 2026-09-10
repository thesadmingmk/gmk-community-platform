import React, { useState, useMemo, useEffect } from 'react';
import { doc, getDoc, updateDoc, deleteDoc, runTransaction, onSnapshot, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../context/AuthContext';
import { CommunityEvent, EventRegistration, Family, FamilyMember, EventRegistrationRefund, hasGenuineFinancialHistory, EventRegistrationParticipantDetail } from '../types';
import { calculateEventPricing } from '../utils/pricingEngine';
import { X, Save, RefreshCw, Trash2, XCircle, Users, CheckCircle2, AlertCircle, Plus, Minus, Clock } from 'lucide-react';
import { formatExternalGmkId, resolveEventDetails, getRegistrationDisplayId } from '../utils/gmkIdHelper';
import { formatPhoneWithCountryCode } from '../utils/phoneValidation';
import { useAuth } from '../context/AuthContext';
import { useLocalGEASConfirmation, GEASConfirmationDialogUI } from './gmk/GEASConfirmationDialog';
import { NotificationService } from '../services/NotificationService';
import ExternalRegistrationForm from './external/ExternalRegistrationForm';
import { evaluateFamilyRegistrationParticipants } from '../services/familyCheckInService';

interface Props {
  registration: EventRegistration;
  activeEvent: CommunityEvent | null;
  events: CommunityEvent[];
  families: Family[];
  familyMembers: FamilyMember[];
  onClose: () => void;
  onSuccess: (updated: Partial<EventRegistration>) => void;
  onDeleted?: (id: string) => void;
  onCancelled?: (updated: Partial<EventRegistration>) => void;
}

export default function AdminRegistrationDetailsModal({ 
  registration: initialReg, activeEvent, events, families, familyMembers, onClose, onSuccess, onDeleted, onCancelled
}: Props) {
  const [editingReg, setEditingReg] = useState<EventRegistration>(initialReg);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successAlertMsg, setSuccessAlertMsg] = useState<string | null>(null);
  
  const { currentUser } = useAuth();
  const [attendanceData, setAttendanceData] = useState<any>(null);
  const [loadingAttendance, setLoadingAttendance] = useState(false);
  const [participantToCancel, setParticipantToCancel] = useState<{ name: string; category?: string } | null>(null);
  const [cancellingParticipant, setCancellingParticipant] = useState<string | null>(null);

  const event = activeEvent || events.find(e => e.id === initialReg.eventId);
  const hasFin = hasGenuineFinancialHistory(initialReg);
  const isCancelled = (initialReg.workflowStatus as any) === 'cancelled' || initialReg.paymentStatus === 'cancelled';

  useEffect(() => {
    const targetEventId = event?.id || activeEvent?.id || initialReg.eventId;
    if (!targetEventId) return;
    
    const gmkId = getRegistrationDisplayId(editingReg) || editingReg.primaryMemberGmkId || formatExternalGmkId(editingReg.publicReference) || editingReg.publicReference || editingReg.id.split('_')?.[1] || editingReg.id;
    if (!gmkId) return;

    setLoadingAttendance(true);
    const directDocId = `att_${gmkId}_${targetEventId}`;
    const directRef = doc(db, 'eventAttendance', directDocId);

    const unsubDirect = onSnapshot(directRef, (snap) => {
      if (snap.exists()) {
        setAttendanceData({ id: snap.id, ...snap.data() });
        setLoadingAttendance(false);
      } else {
        // Fallback: query by eventId and primaryMemberGmkId
        const q = query(
          collection(db, 'eventAttendance'),
          where('eventId', '==', targetEventId),
          where('primaryMemberGmkId', '==', gmkId)
        );
        getDocs(q).then((querySnap) => {
          if (!querySnap.empty) {
            const firstDoc = querySnap.docs[0];
            setAttendanceData({ id: firstDoc.id, ...firstDoc.data() });
          } else {
            setAttendanceData(null);
          }
          setLoadingAttendance(false);
        }).catch((err) => {
          console.warn("Attendance query lookup error:", err);
          setLoadingAttendance(false);
        });
      }
    }, (err) => {
      console.warn("Attendance onSnapshot error:", err);
      setLoadingAttendance(false);
    });

    return () => {
      unsubDirect();
    };
  }, [event?.id, activeEvent?.id, initialReg.eventId, editingReg]);

  const participantEvaluations = useMemo(() => {
    const arrivedList = Array.isArray(attendanceData?.arrivedDetails) ? attendanceData.arrivedDetails : [];
    if (arrivedList.length === 0) return [];

    if (editingReg.isExternal) {
      return arrivedList.map((arr: any) => ({
        name: arr.name || 'Guest',
        relationship: arr.category || editingReg.externalRegistrationTypeName || 'External Guest',
        arrivedAt: arr.arrivedAt,
        scannedBy: arr.scannedBy || 'Gate Scanner'
      }));
    }

    const evalResult = evaluateFamilyRegistrationParticipants(
      editingReg,
      arrivedList,
      families,
      familyMembers
    );

    return arrivedList.map((arr: any) => {
      const match = evalResult.allParticipants.find(
        p => p.name.trim().toLowerCase() === (arr.name || '').trim().toLowerCase()
      );
      return {
        name: arr.name,
        relationship: match ? match.relationship : (arr.category || 'Participant'),
        arrivedAt: arr.arrivedAt,
        scannedBy: arr.scannedBy || 'Gate Scanner'
      };
    });
  }, [attendanceData?.arrivedDetails, editingReg, families, familyMembers]);

  const getRelationshipBadgeClass = (rel?: string) => {
    switch (rel) {
      case 'GMK Member':
        return 'bg-emerald-100 text-emerald-800 border border-emerald-200';
      case 'Spouse':
        return 'bg-blue-100 text-blue-800 border border-blue-200';
      case 'Child':
        return 'bg-indigo-100 text-indigo-800 border border-indigo-200';
      case 'Parent':
        return 'bg-purple-100 text-purple-800 border border-purple-200';
      default:
        return 'bg-stone-100 text-stone-700 border border-stone-200';
    }
  };

  const formatCheckInDateTime = (isoString?: string) => {
    if (!isoString) return { date: '', time: '—' };
    try {
      const d = new Date(isoString);
      const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
      return { date: dateStr, time: timeStr };
    } catch {
      return { date: '', time: String(isoString) };
    }
  };

  const executeCancelCheckIn = async (participantName: string) => {
    setCancellingParticipant(participantName);
    setErrorMsg(null);
    try {
      const targetEventId = event?.id || activeEvent?.id || initialReg.eventId;
      const gmkId = getRegistrationDisplayId(editingReg) || editingReg.primaryMemberGmkId || formatExternalGmkId(editingReg.publicReference) || editingReg.publicReference || editingReg.id.split('_')?.[1] || editingReg.id;
      const attDocId = attendanceData?.id || `att_${gmkId}_${targetEventId}`;
      const attRef = doc(db, 'eventAttendance', attDocId);

      await runTransaction(db, async (transaction) => {
        const attDoc = await transaction.get(attRef);
        if (!attDoc.exists()) {
          throw new Error("Attendance record not found in database.");
        }

        const data = attDoc.data();
        const arrivedDetails = Array.isArray(data.arrivedDetails) ? [...data.arrivedDetails] : [];
        const auditTrail = Array.isArray(data.cancellationAuditTrail) ? [...data.cancellationAuditTrail] : [];

        const targetIdx = arrivedDetails.findIndex(
          (d: any) => d.name?.trim().toLowerCase() === participantName.trim().toLowerCase()
        );

        if (targetIdx === -1) {
          throw new Error(`Participant "${participantName}" is not currently in the active check-in list.`);
        }

        const removed = arrivedDetails[targetIdx];
        arrivedDetails.splice(targetIdx, 1);

        auditTrail.push({
          participant: removed.name,
          category: removed.category || 'Participant',
          gmkId: gmkId,
          eventId: targetEventId,
          originalCheckInTime: removed.arrivedAt || null,
          scannedBy: removed.scannedBy || 'Gate Scanner',
          cancellationTime: new Date().toISOString(),
          cancelledByAdmin: currentUser?.email || 'Admin',
          reason: 'Admin Check-In Cancellation'
        });

        const totalParticipants = data.totalParticipants || editingReg.totalParticipants || 1;
        const newTotalAttended = arrivedDetails.length;

        let newStatus: 'registered' | 'checked_in' | 'attended' = 'registered';
        if (newTotalAttended === 0) {
          newStatus = 'registered';
        } else if (newTotalAttended < totalParticipants) {
          newStatus = 'checked_in';
        } else {
          newStatus = 'attended';
        }

        const updatePayload: any = {
          arrivedDetails,
          totalAttended: newTotalAttended,
          status: newStatus,
          cancellationAuditTrail: auditTrail,
          updatedAt: new Date().toISOString(),
          committeeKey: 'attendance'
        };

        if (newTotalAttended === 0) {
          updatePayload.attendedAt = null;
          updatePayload.familyCheckInCompleted = false;
          updatePayload.familyCompletedAt = null;
        } else {
          updatePayload.familyCheckInCompleted = false;
          updatePayload.familyCompletedAt = null;
        }

        transaction.update(attRef, updatePayload);
      });

      setSuccessAlertMsg(`Check-in cancelled for ${participantName}. Attendance status updated.`);
      setParticipantToCancel(null);
    } catch (err: any) {
      console.error("Failed to cancel check-in:", err);
      setErrorMsg(err.message || "Failed to cancel check-in.");
    } finally {
      setCancellingParticipant(null);
    }
  };

  const [isEditingExternal, setIsEditingExternal] = useState(false);
  
  const { confirm, isOpen, options, handleCancel, handleConfirm } = useLocalGEASConfirmation();
  
  // Detect changes in participants
  const participantsChanged = useMemo(() => {
    const orig = initialReg.participants || [];
    const curr = editingReg.participants || [];
    if (orig.length !== curr.length) return true;
    for (let p of orig) {
      if (!curr.includes(p)) return true;
    }
    return false;
  }, [initialReg.participants, editingReg.participants]);
  
  const pricingResult = useMemo(() => {
    if (!event || initialReg.isExternal) return null;
    
    // Construct children with age and role
    const participants = editingReg.participants || [];
    const details = editingReg.participantDetails || [];
    
    let hasPrimary = false;
    let hasSpouse = false;
    const children: Array<{ name?: string; yearOfBirth?: string; age?: number }> = [];
    let parentsCount = 0;
    let othersCount = 0;
    
    participants.forEach(p => {
      const d = details.find(x => x.name === p);
      if (d) {
        if (d.role === 'primary') hasPrimary = true;
        else if (d.role === 'spouse') hasSpouse = true;
        else if (d.role === 'child') children.push({ name: p, yearOfBirth: d.yearOfBirth });
        else if (d.role === 'parent') parentsCount++;
        else othersCount++;
      } else {
        if (p === initialReg.primaryRegistrantName || p === participants[0]) hasPrimary = true;
        else if (p.toLowerCase().includes('wife') || p.toLowerCase().includes('husband') || p.toLowerCase().includes('spouse')) hasSpouse = true;
        else othersCount++;
      }
    });
    
    return calculateEventPricing({
      pricing: event.pricing,
      hasPrimary,
      hasSpouse,
      children,
      parentsCount,
      othersCount,
      externalGuestsCount: 0
    });
  }, [editingReg.participants, editingReg.participantDetails, event, initialReg.isExternal]);
  
  const handleAddParticipant = (member: FamilyMember) => {
    if (editingReg.participants?.includes(member.name)) return;
    
    const newParticipants = [...(editingReg.participants || []), member.name];
    const rel = member.relationship.toLowerCase();
    const roleMapping = rel === 'self' ? 'primary' : 
                        (rel === 'wife' || rel === 'husband' || rel === 'spouse' ? 'spouse' : 
                        (rel === 'son' || rel === 'daughter' || rel === 'child' ? 'child' : rel));
    const newDetails: EventRegistrationParticipantDetail = {
      name: member.name,
      role: roleMapping as any,
      yearOfBirth: (member as any).dateOfBirth ? (member as any).dateOfBirth.split('-')[0] : member.yearOfBirth
    };
    const newParticipantDetails = [...(editingReg.participantDetails || []), newDetails];
    
    setEditingReg(prev => ({
      ...prev,
      participants: newParticipants,
      participantDetails: newParticipantDetails,
      totalParticipants: newParticipants.length
    }));
  };
  
  const handleRemoveParticipant = (name: string) => {
    // Prevent removing everyone? At least one must remain? Admin choice.
    if ((editingReg.participants?.length || 0) <= 1) {
       setErrorMsg("Cannot remove the last participant.");
       return;
    }
    const newParticipants = (editingReg.participants || []).filter(p => p !== name);
    const newParticipantDetails = (editingReg.participantDetails || []).filter(d => d.name !== name);
    
    setEditingReg(prev => ({
      ...prev,
      participants: newParticipants,
      participantDetails: newParticipantDetails,
      totalParticipants: newParticipants.length
    }));
    setErrorMsg(null);
  };
  
  const handleSaveChanges = async () => {
    setSaving(true);
    setErrorMsg(null);
    try {
      const updates: any = {
        participants: editingReg.participants,
        participantDetails: editingReg.participantDetails,
        totalParticipants: editingReg.totalParticipants,
        updatedAt: new Date().toISOString()
      };
      
      const originalAmountPaid = Number(initialReg.amountReceived ?? (initialReg.paymentStatus === 'paid' ? (initialReg.amountDue ?? initialReg.paymentAmount ?? 0) : 0));
      const totalAlreadyRefunded = Number(initialReg.refundedAmount || 0);
      const netPaid = originalAmountPaid - totalAlreadyRefunded;

      if (pricingResult && !initialReg.isExternal) {
        updates.amountDue = pricingResult.totalAmount;
        updates.paymentAmount = pricingResult.totalAmount;
        updates.registrationType = pricingResult.registrationType;
        updates.amountReceived = originalAmountPaid;
        
        updates.paymentSummary = {
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
          externalParticipantsCount: pricingResult.externalCount || 0,
          externalParticipantRate: pricingResult.externalRate || 0,
          externalSubtotal: pricingResult.externalSubtotal || 0,
          totalAmount: pricingResult.totalAmount,
          details: pricingResult.details,
          timestamp: new Date().toISOString()
        };

        // Compute Finance state
        if (pricingResult.totalAmount > netPaid) {
          updates.paymentStatus = netPaid > 0 ? 'partially_paid' : 'pending';
          updates.balanceDue = Math.max(0, pricingResult.totalAmount - netPaid);
          updates.refundDue = 0;
          updates.refundedAmount = totalAlreadyRefunded;
        } else if (pricingResult.totalAmount < netPaid) {
          // If they owe less than what they already paid net of previous refunds, they are owed a refund
          updates.paymentStatus = 'paid'; // Or refund_due depending on how Finance expects it, but 'paid' works with the refund modal in Finance
          updates.balanceDue = 0;
          const newRefundDue = netPaid - pricingResult.totalAmount;
          updates.refundDue = newRefundDue;
          updates.refundedAmount = totalAlreadyRefunded;
          
          // Dispatch to finance
          if (newRefundDue > 0) {
            const refundId = `ref_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
            const pendingRefundRecord: EventRegistrationRefund = {
              id: refundId,
              registrationId: initialReg.id,
              publicReference: initialReg.publicReference || initialReg.id,
              gmkId: initialReg.primaryMemberGmkId || '',
              registrantName: initialReg.primaryRegistrantName || initialReg.participants?.[0] || 'Guest',
              eventId: initialReg.eventId,
              eventName: event?.title || '',
              amountPaid: netPaid,
              amount: newRefundDue,
              status: 'pending',
              refundReason: 'Admin Changed Participants',
              date: new Date().toISOString(),
              refundedBy: ''
            };
            const existingRefundHistory = Array.isArray(initialReg.refundHistory) ? initialReg.refundHistory : [];
            updates.refundHistory = [...existingRefundHistory, pendingRefundRecord];
          }
        } else {
          updates.paymentStatus = 'paid';
          updates.balanceDue = 0;
          updates.refundDue = 0;
          updates.refundedAmount = totalAlreadyRefunded;
        }
      }
      
      await updateDoc(doc(db, 'event_registrations', initialReg.id), updates);
      onSuccess(updates);
    } catch (e: any) {
      setErrorMsg(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleApproveExternal = async () => {
    setSaving(true);
    setErrorMsg(null);
    try {
      const eventDetails = resolveEventDetails(event);
      const eventName = eventDetails.eventName;
      const eventDate = eventDetails.eventDate;
      const eventTime = eventDetails.eventTime;
      const eventVenue = eventDetails.eventVenue;
      const externalGmkId = formatExternalGmkId(initialReg.publicReference) || initialReg.publicReference || initialReg.id;

      const recipientEmail = (initialReg.primaryRegistrantEmail || initialReg.primaryMemberEmail || '').trim().toLowerCase();

      let paymentInstructions = "Please contact the Event Director or Committee at the registration counter for payment settlement.";
      if (event?.paymentTransferAccounts && event.paymentTransferAccounts.length > 0) {
        paymentInstructions = event.paymentTransferAccounts.map(acc => {
          const lines: string[] = [];
          if (acc.name) lines.push(`Name: ${acc.name}`);
          if (acc.bank) lines.push(`Bank: ${acc.bank}`);
          if (acc.accountNumber) lines.push(`A/C: ${acc.accountNumber}`);
          if (acc.iban) lines.push(`IBAN: ${acc.iban}`);
          if (acc.mobilePhone) lines.push(`Mobile Transfer: ${acc.mobilePhone}`);
          return lines.join(' | ');
        }).join('\\n');
      }

      const amountDue = typeof initialReg.amountDue === 'number' ? initialReg.amountDue :
        (typeof initialReg.paymentAmount === 'number' ? initialReg.paymentAmount :
        (initialReg.paymentSummary?.totalAmount || 0));

      let emailStatus: 'sent' | 'skipped' | 'failed' = 'skipped';

      if (recipientEmail) {
        try {
          await NotificationService.sendExternalRegistrationApproved(recipientEmail, {
            recipientName: initialReg.primaryRegistrantName || initialReg.participants?.[0] || 'Guest',
            eventName,
            eventDate,
            eventTime,
            venue: eventVenue,
            eventVenue,
            gmkId: externalGmkId,
            publicReference: externalGmkId,
            registrationTypeName: initialReg.externalRegistrationTypeName || 
              event?.externalRegistrationSettings?.types?.find((t: any) => t.id === initialReg.externalRegistrationTypeId)?.name ||
              initialReg.category ||
              'External Guest',
            totalParticipants: initialReg.totalParticipants || 1,
            amountDue: typeof amountDue === 'number' ? amountDue.toFixed(3) : String(amountDue),
            paymentInstructions
          });
          emailStatus = 'sent';
        } catch (emailErr: any) {
          console.warn("Failed to dispatch approval email:", emailErr);
          emailStatus = 'failed';
        }
      }

      const regRef = doc(db, "event_registrations", initialReg.id);
      const nowIso = new Date().toISOString();
      const updates: any = {
        adminReviewStatus: 'approved',
        workflowStatus: 'payment_pending',
        approvalEmailSentAt: emailStatus === 'sent' ? nowIso : null,
        approvalEmailRecipient: emailStatus === 'sent' ? recipientEmail : null,
        updatedAt: nowIso
      };

      await updateDoc(regRef, updates);
      if (onSuccess) onSuccess(updates);
    } catch (err: any) {
      console.error("Approval failed:", err);
      setErrorMsg("Failed to approve registration: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRejectExternal = async () => {
    setSaving(true);
    setErrorMsg(null);
    try {
      const regRef = doc(db, "event_registrations", initialReg.id);
      
      const actualReceived = Number(
        initialReg.amountReceived !== undefined && initialReg.amountReceived !== null
          ? initialReg.amountReceived
          : (initialReg.paymentStatus === 'paid' ? (initialReg.amountDue ?? initialReg.paymentAmount ?? 0) : 0)
      );
      const alreadyRefunded = Number(initialReg.refundedAmount || 0);
      const refundableAmount = Math.max(0, actualReceived - alreadyRefunded);
      const isPaid = (refundableAmount > 0 || actualReceived > 0);
      
      const updates: any = {};

      if (isPaid && refundableAmount > 0) {
        const refundId = `ref_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
        const eventTitle = event?.title || event?.eventName || 'Community Gathering';
        const registrantName = initialReg.primaryRegistrantName || (initialReg.participants && initialReg.participants[0]) || initialReg.primaryMemberEmail || 'Guest';

        const pendingRefundRecord: EventRegistrationRefund = {
          id: refundId,
          registrationId: initialReg.id,
          publicReference: initialReg.publicReference || initialReg.id,
          gmkId: initialReg.primaryMemberGmkId || '',
          registrantName: registrantName,
          eventId: initialReg.eventId,
          eventName: eventTitle,
          amountPaid: actualReceived,
          amount: refundableAmount,
          status: 'pending',
          refundReason: 'Registration Rejection',
          paymentReference: initialReg.receiptNumber || '',
          date: new Date().toISOString(),
          refundedBy: ''
        };

        const existingRefundHistory = Array.isArray(initialReg.refundHistory) ? initialReg.refundHistory : [];

        updates.adminReviewStatus = 'rejected';
        updates.workflowStatus = 'rejected';
        updates.paymentStatus = 'cancelled';
        updates.refundDue = refundableAmount;
        updates.amountReceived = actualReceived;
        updates.amountDue = 0;
        updates.paymentAmount = 0;
        updates.refundHistory = [...existingRefundHistory, pendingRefundRecord];
        updates.entryPassNumber = "";
        updates.updatedAt = new Date().toISOString();
      } else {
        updates.adminReviewStatus = 'rejected';
        updates.workflowStatus = 'rejected';
        updates.paymentStatus = 'cancelled';
        updates.amountDue = 0;
        updates.paymentAmount = 0;
        updates.refundDue = 0;
        updates.updatedAt = new Date().toISOString();
      }

      await updateDoc(regRef, updates);

      const recipientEmail = (initialReg.primaryRegistrantEmail || initialReg.primaryMemberEmail || '').trim().toLowerCase();
      if (recipientEmail) {
        try {
          const eventDetails = resolveEventDetails(event);
          await NotificationService.sendExternalRegistrationRejected(recipientEmail, {
            recipientName: initialReg.primaryRegistrantName || (initialReg.participants && initialReg.participants[0]) || 'Guest',
            eventName: eventDetails.eventName,
            eventDate: eventDetails.eventDate,
            eventTime: eventDetails.eventTime,
            eventVenue: eventDetails.eventVenue,
            venue: eventDetails.eventVenue,
            gmkId: formatExternalGmkId(initialReg.publicReference) || initialReg.publicReference || initialReg.id,
            publicReference: formatExternalGmkId(initialReg.publicReference) || initialReg.publicReference || initialReg.id,
            category: initialReg.externalRegistrationTypeName || 
              event?.externalRegistrationSettings?.types?.find((t: any) => t.id === initialReg.externalRegistrationTypeId)?.name ||
              initialReg.category ||
              'External Guest',
            reason: 'Registration could not be accepted at this time.'
          });
        } catch (emailErr) {
          console.warn("Could not dispatch rejection email:", emailErr);
        }
      }

      if (onCancelled) onCancelled(updates);
      else if (onSuccess) onSuccess(updates);
    } catch (err: any) {
      console.error("Rejection failed:", err);
      setErrorMsg(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCancelReg = async () => {
    const isConfirmed = await confirm({
      title: 'CANCEL REGISTRATION?',
      message: 'This will cancel the event registration. If this registration has a Finance trail, the cancellation will be sent to Finance for refund processing.',
      severity: 'warning',
      confirmText: 'CANCEL REGISTRATION',
      cancelText: 'KEEP REGISTRATION'
    });
    if (!isConfirmed) return;

    setSaving(true);
    try {
      const actualReceived = Number(initialReg.amountReceived ?? (initialReg.paymentStatus === 'paid' ? (initialReg.amountDue ?? initialReg.paymentAmount ?? 0) : 0));
      const alreadyRefunded = Number(initialReg.refundedAmount || 0);
      const refundableAmount = Math.max(0, actualReceived - alreadyRefunded);
      const isPaid = (refundableAmount > 0 || actualReceived > 0);

      const updateData: any = {
        workflowStatus: 'cancelled',
        paymentStatus: 'cancelled',
        entryPassNumber: "",
        updatedAt: new Date().toISOString()
      };
      
      if (isPaid && refundableAmount > 0) {
        const refundId = `ref_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
        const pendingRefundRecord: EventRegistrationRefund = {
          id: refundId,
          registrationId: initialReg.id,
          publicReference: initialReg.publicReference || initialReg.id,
          gmkId: initialReg.primaryMemberGmkId || '',
          registrantName: initialReg.primaryRegistrantName || initialReg.participants?.[0] || 'Guest',
          eventId: initialReg.eventId,
          eventName: event?.title || '',
          amountPaid: actualReceived,
          amount: refundableAmount,
          status: 'pending',
          refundReason: 'Admin Cancellation',
          date: new Date().toISOString(),
          refundedBy: ''
        };
        const existingRefundHistory = Array.isArray(initialReg.refundHistory) ? initialReg.refundHistory : [];
        updateData.refundDue = refundableAmount;
        updateData.amountReceived = actualReceived;
        updateData.amountDue = 0;
        updateData.refundHistory = [...existingRefundHistory, pendingRefundRecord];
      } else {
        updateData.amountDue = 0;
        updateData.refundDue = 0;
      }

      await updateDoc(doc(db, 'event_registrations', initialReg.id), updateData);
      if (onCancelled) onCancelled(updateData);
    } catch (e: any) {
      setErrorMsg(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (hasFin) return; // Not allowed

    const isConfirmed = await confirm({
      title: 'Delete Registration',
      message: 'This registration has no Finance history. Deleting it will permanently remove the registration. This action cannot be undone.',
      severity: 'danger',
      confirmText: 'Permanently Delete'
    });
    if (!isConfirmed) return;

    setSaving(true);
    try {
      await deleteDoc(doc(db, 'event_registrations', initialReg.id));
      if (onDeleted) onDeleted(initialReg.id);
    } catch (e: any) {
      setErrorMsg(e.message);
    } finally {
      setSaving(false);
    }
  };
  
  if (isEditingExternal && event) {
    const typeConfig = event.externalRegistrationSettings?.types?.find(t => t.id === initialReg.externalRegistrationTypeId);
    return (
      <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-sm">
        <div className="bg-white rounded-3xl shadow-xl w-full max-w-3xl flex flex-col max-h-[90vh]">
          <div className="flex items-center justify-between p-4 border-b border-stone-200 shrink-0">
            <h2 className="text-lg font-black text-stone-800 uppercase tracking-wider">
              Edit External Registration
            </h2>
            <button
              onClick={() => setIsEditingExternal(false)}
              className="p-2 bg-stone-100 hover:bg-stone-200 text-stone-600 rounded-full transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="p-4 sm:p-6 overflow-y-auto flex-1">
            <ExternalRegistrationForm
              event={event}
              typeConfig={typeConfig as any}
              validationDb={db as any}
              onBack={() => setIsEditingExternal(false)}
              existingRegistration={initialReg}
              onSuccess={(updatedReg) => {
                if (onSuccess) onSuccess(updatedReg);
                setIsEditingExternal(false);
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-stone-900/60 backdrop-blur-sm" onClick={() => !saving && onClose()} />
      <div className="relative w-full max-w-3xl bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh] animate-scaleIn">
        
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-stone-200 bg-stone-50 rounded-t-2xl shrink-0">
          <h2 className="text-lg font-black uppercase tracking-wider text-[#0f4c2a]">Registration Details</h2>
          <button onClick={onClose} disabled={saving} className="p-2 hover:bg-stone-200 rounded-full transition-colors">
            <X className="w-5 h-5 text-stone-500" />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-5 md:p-8 space-y-8">
          
          {errorMsg && (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-center justify-between text-rose-700 animate-fadeIn shrink-0">
              <div className="flex items-center space-x-2">
                <AlertCircle className="w-4 h-4" />
                <span className="text-sm font-medium">{errorMsg}</span>
              </div>
              <button onClick={() => setErrorMsg(null)}><X className="w-4 h-4" /></button>
            </div>
          )}

          {successAlertMsg && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between text-emerald-800 animate-fadeIn shrink-0">
              <div className="flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span className="text-sm font-semibold">{successAlertMsg}</span>
              </div>
              <button onClick={() => setSuccessAlertMsg(null)} className="text-emerald-600 hover:text-emerald-800">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Critical Actions Block: Registration Lifecycle */}
          {!isCancelled && (
            <div className="flex justify-between items-center bg-stone-50 border border-stone-200 rounded-xl p-4">
              <div className="text-sm font-bold text-stone-700">
                Registration Status: {initialReg.isExternal && initialReg.adminReviewStatus === 'pending' ? <span className="text-amber-600">Pending Approval</span> : 'Active'}
              </div>
              <div className="flex gap-2">
                {!hasFin ? (
                  <button onClick={handleDelete} disabled={saving} className="px-4 py-2 bg-white text-rose-700 border border-rose-200 text-xs font-black uppercase tracking-wider rounded-lg hover:bg-rose-50 transition-colors">
                    Delete
                  </button>
                ) : null}
                <button onClick={handleCancelReg} disabled={saving} className="px-4 py-2 bg-rose-50 text-rose-700 border border-rose-200 text-xs font-black uppercase tracking-wider rounded-lg hover:bg-rose-100 transition-colors">
                  Cancel Registration
                </button>
              </div>
            </div>
          )}

          {/* CHECK-IN MANAGEMENT (Admin-Only) */}
          {!isCancelled && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-600" />
                  <h3 className="text-xs font-black uppercase tracking-widest text-stone-700">
                    Check-In Management
                  </h3>
                  <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">
                    (Admin Authority)
                  </span>
                </div>
                {attendanceData?.arrivedDetails && attendanceData.arrivedDetails.length > 0 && (
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-200">
                    {attendanceData.arrivedDetails.length} Active {attendanceData.arrivedDetails.length === 1 ? 'Check-In' : 'Check-Ins'}
                  </span>
                )}
              </div>

              {(!attendanceData || !attendanceData.arrivedDetails || attendanceData.arrivedDetails.length === 0) ? (
                <div className="bg-stone-50 border border-stone-200 rounded-xl p-5 text-center flex flex-col items-center justify-center space-y-1.5">
                  <div className="w-8 h-8 rounded-full bg-stone-100 flex items-center justify-center text-stone-400 mb-1">
                    <Users className="w-4 h-4" />
                  </div>
                  <div className="text-xs font-bold text-stone-700">No participants currently checked in.</div>
                  <p className="text-[11px] text-stone-500 max-w-md">
                    When participants scan their pass at the entrance gate, their active check-in timestamps and scanner identity will appear here.
                  </p>
                </div>
              ) : (
                <div className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-xs">
                  <div className="p-3 bg-stone-50/80 border-b border-stone-200">
                    <p className="text-[11px] text-stone-500 font-medium">
                      Cancelling an individual check-in reverses their physical gate arrival and food headcount while keeping their registration, payment, and entry pass 100% valid.
                    </p>
                  </div>
                  <div className="divide-y divide-stone-100">
                    {participantEvaluations.map((item, idx) => {
                      const { date, time } = formatCheckInDateTime(item.arrivedAt);
                      return (
                        <div key={idx} className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-stone-50/60 transition-colors">
                          <div className="space-y-1 min-w-0">
                            <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                              <span className="text-sm font-bold text-stone-900 truncate">
                                {item.name}
                              </span>
                              <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${getRelationshipBadgeClass(item.relationship)}`}>
                                {item.relationship}
                              </span>
                            </div>
                            <div className="flex items-center space-x-3 text-[11px] text-stone-500 flex-wrap gap-y-0.5">
                              <span className="flex items-center space-x-1">
                                <Clock className="w-3 h-3 text-stone-400" />
                                <span>{time} {date && <span className="text-stone-400">({date})</span>}</span>
                              </span>
                              <span className="text-stone-300">•</span>
                              <span className="flex items-center space-x-1">
                                <span className="font-semibold text-stone-600">Scanned by:</span>
                                <span className="font-medium text-stone-800">{item.scannedBy}</span>
                              </span>
                            </div>
                          </div>

                          <div className="shrink-0 flex items-center sm:self-center">
                            <button
                              type="button"
                              disabled={cancellingParticipant !== null || saving}
                              onClick={() => setParticipantToCancel({ name: item.name, category: item.relationship })}
                              className="w-full sm:w-auto inline-flex items-center justify-center px-3 py-1.5 rounded-lg border border-rose-200 text-rose-700 bg-rose-50 hover:bg-rose-100 hover:border-rose-300 text-xs font-black uppercase tracking-wider transition-colors disabled:opacity-40 cursor-pointer shadow-2xs"
                            >
                              <XCircle className="w-3.5 h-3.5 mr-1" />
                              <span>Cancel Check-In</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Registrant Info */}
          <section>
            <h3 className="text-xs font-black uppercase tracking-widest text-stone-400 mb-3">Registrant Information</h3>
            <div className="bg-white border border-stone-200 rounded-xl p-5 space-y-4 shadow-sm">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div className="text-[10px] uppercase font-bold text-stone-500 tracking-wider">Name</div>
                  <div className="text-base font-bold text-stone-800">{initialReg.primaryRegistrantName || initialReg.primaryMemberEmail || (initialReg.participants && initialReg.participants[0])}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase font-bold text-stone-500 tracking-wider">Email</div>
                  <div className="text-sm text-stone-800 font-mono mt-1">{initialReg.primaryMemberEmail || initialReg.primaryRegistrantEmail || '—'}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase font-bold text-stone-500 tracking-wider">Reference</div>
                  <div className="text-sm font-mono text-stone-800 font-bold mt-1">{initialReg.isExternal ? (formatExternalGmkId(initialReg.publicReference) || initialReg.publicReference) : (initialReg.primaryMemberGmkId || initialReg.publicReference)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase font-bold text-stone-500 tracking-wider">Type</div>
                  <div className="text-sm font-bold text-stone-800 mt-1">{initialReg.isExternal ? 'External' : 'Resident'}</div>
                </div>
              </div>
            </div>
          </section>
          
          {/* Participants */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-black uppercase tracking-widest text-stone-400">Participants ({editingReg.participants?.length || 0})</h3>
            </div>
            <div className="space-y-3">
              {editingReg.participants?.map((p, idx) => {
                const detail = editingReg.participantDetails?.find(d => d.name === p);
                return (
                  <div key={idx} className="flex items-center justify-between p-3 bg-white border border-stone-200 rounded-xl shadow-sm">
                    <div className="flex flex-col">
                      <span className="text-sm font-bold text-stone-700">{p}</span>
                      {detail?.role && (
                        <span className="text-[10px] text-stone-500 font-bold uppercase tracking-wider">
                          {detail.role}
                        </span>
                      )}
                    </div>
                    {!initialReg.isExternal && (
                      <button
                        onClick={() => handleRemoveParticipant(p)}
                        className="px-3 py-1.5 bg-white border border-stone-200 hover:bg-rose-50 hover:text-rose-700 text-stone-500 text-[10px] font-black uppercase tracking-wider rounded transition-colors flex items-center space-x-1"
                      >
                        <span>Remove</span>
                      </button>
                    )}
                  </div>
                );
              })}
              
              {/* Eligible Family Members (Resident Only) */}
              {!initialReg.isExternal && initialReg.familyId && !isCancelled && (
                <div className="mt-6 pt-6 border-t border-stone-200">
                  <h4 className="text-xs font-black uppercase tracking-wider text-stone-400 mb-3">Eligible Family Members</h4>
                  {(() => {
                    const family = families.find(f => f.id === initialReg.familyId);
                    const members = familyMembers.filter(m => m.familyId === initialReg.familyId);
                    const unaddedMembers = members.filter(m => !editingReg.participants?.includes(m.name));
                    
                    if (unaddedMembers.length === 0) {
                      return <div className="text-xs text-stone-500 italic p-4 bg-stone-50 rounded-xl border border-stone-200">All registered family members are already participating.</div>;
                    }
                    
                    return (
                      <div className="space-y-2">
                        {unaddedMembers.map(m => (
                          <div key={m.id} className="flex items-center justify-between p-3 bg-stone-50 border border-stone-200 rounded-xl">
                            <div>
                              <div className="text-sm font-bold text-stone-800">{m.name}</div>
                              <div className="text-[10px] text-stone-500 uppercase font-bold tracking-wider">{m.relationship}</div>
                            </div>
                            <button
                              onClick={() => handleAddParticipant(m)}
                              className="px-3 py-1.5 bg-white border border-stone-300 hover:border-[#0f4c2a] text-[#0f4c2a] text-[10px] font-black uppercase tracking-wider rounded transition-colors flex items-center space-x-1 shadow-sm"
                            >
                              <span>Add</span>
                            </button>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          </section>

          {/* Finance Section */}
          <section>
            <h3 className="text-xs font-black uppercase tracking-widest text-stone-400 mb-3">Finance</h3>
            <div className="bg-white border border-stone-200 rounded-xl p-5 shadow-sm">
              
              {/* Original State vs New State (if changed) */}
              {participantsChanged && pricingResult && !initialReg.isExternal ? (
                <div className="bg-stone-50 p-4 rounded-xl border border-[#0f4c2a]/20 mb-4 animate-fadeIn">
                  <h4 className="text-[10px] font-black uppercase tracking-wider text-[#0f4c2a] mb-2">Updated Pricing Breakdown</h4>
                  <div className="text-xs text-stone-700 mb-2">{pricingResult.details}</div>
                  <div className="flex justify-between items-end pt-2 border-t border-stone-200 mt-2">
                    <div className="text-xs font-bold uppercase tracking-wider text-stone-500">New Amount Due</div>
                    <div className="text-base font-bold font-mono text-stone-900">OMR {pricingResult.totalAmount.toFixed(3)}</div>
                  </div>
                  <div className="flex justify-between items-end pt-1">
                    <div className="text-[10px] uppercase tracking-wider text-stone-500">Amount Paid</div>
                    <div className="text-[11px] font-mono text-stone-500">OMR {Number(initialReg.amountReceived || 0).toFixed(3)}</div>
                  </div>
                  {pricingResult.totalAmount > Number(initialReg.amountReceived || 0) && (
                    <div className="flex justify-between items-end pt-2 border-t border-stone-200 mt-2">
                      <div className="text-[10px] font-black uppercase tracking-wider text-amber-700">Remaining Balance</div>
                      <div className="text-sm font-bold font-mono text-amber-700">OMR {(pricingResult.totalAmount - Number(initialReg.amountReceived || 0)).toFixed(3)}</div>
                    </div>
                  )}
                  {pricingResult.totalAmount < Number(initialReg.amountReceived || 0) && (
                    <div className="flex justify-between items-end pt-2 border-t border-stone-200 mt-2">
                      <div className="text-[10px] font-black uppercase tracking-wider text-emerald-700">Refund Due</div>
                      <div className="text-sm font-bold font-mono text-emerald-700">OMR {(Number(initialReg.amountReceived || 0) - pricingResult.totalAmount).toFixed(3)}</div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-[10px] uppercase font-bold text-stone-500 tracking-wider">Payment Status</div>
                    <div className="text-sm font-bold text-stone-800 capitalize">{initialReg.paymentStatus || 'Pending'}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase font-bold text-stone-500 tracking-wider">Amount Paid</div>
                    <div className="text-sm font-bold font-mono text-emerald-700">{initialReg.amountReceived !== undefined ? `OMR ${initialReg.amountReceived.toFixed(3)}` : (initialReg.paymentStatus === 'paid' ? `OMR ${(initialReg.amountDue || initialReg.paymentAmount || 0).toFixed(3)}` : 'OMR 0.000')}</div>
                  </div>
                </div>
              )}

              {/* How to Pay - Preserve existing display logic */}
              {(initialReg.paymentStatus === 'pending' || initialReg.paymentStatus === 'partially_paid' || (participantsChanged && pricingResult && pricingResult.totalAmount > Number(initialReg.amountReceived || 0))) && event?.paymentTransferAccounts && event.paymentTransferAccounts.length > 0 && (
                 <div className="mt-4 p-4 border border-[#0f4c2a]/20 bg-[#0f4c2a]/5 rounded-xl">
                   <h4 className="text-xs font-black uppercase tracking-wider text-[#0f4c2a] mb-2">How to Pay</h4>
                   <div className="text-xs text-stone-700 space-y-2">
                     {event.paymentTransferAccounts.map((acc, i) => (
                       <div key={i} className="flex flex-col space-y-1">
                         {acc.name && <span className="font-bold">{acc.name}</span>}
                         {acc.bank && <span>Bank: {acc.bank}</span>}
                         {acc.accountNumber && <span className="font-mono">A/C: {acc.accountNumber}</span>}
                       </div>
                     ))}
                   </div>
                 </div>
              )}
            </div>
          </section>

        </div>
        
        {/* Footer Actions */}
        <div className="p-5 border-t border-stone-200 bg-stone-50 rounded-b-2xl shrink-0 flex justify-end gap-3">
          {initialReg.isExternal ? (
            initialReg.adminReviewStatus === 'pending' ? (
              <>
                <button 
                  onClick={handleRejectExternal}
                  disabled={saving} 
                  className="px-6 py-3 text-xs font-black uppercase tracking-wider text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-xl transition-colors disabled:opacity-50"
                >
                  Reject
                </button>
                <button 
                  onClick={handleApproveExternal}
                  disabled={saving} 
                  className="px-8 py-3 bg-[#0f4c2a] hover:bg-[#0f4c2a]/90 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-colors shadow-sm disabled:opacity-50"
                >
                  {saving ? 'Processing...' : 'Accept & Notify'}
                </button>
              </>
            ) : (
              <>
                <button 
                  onClick={onClose} 
                  disabled={saving} 
                  className="px-6 py-3 text-xs font-black uppercase tracking-wider text-stone-600 hover:bg-stone-200 rounded-xl transition-colors"
                >
                  Close
                </button>
                {!isCancelled && (
                  <button 
                    onClick={() => setIsEditingExternal(true)}
                    disabled={saving} 
                    className="px-8 py-3 bg-[#0f4c2a] hover:bg-[#0f4c2a]/90 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-colors shadow-sm disabled:opacity-50"
                  >
                    Edit External Registration
                  </button>
                )}
              </>
            )
          ) : (
            <>
              <button 
                onClick={onClose} 
                disabled={saving} 
                className="px-6 py-3 text-xs font-black uppercase tracking-wider text-stone-600 hover:bg-stone-200 rounded-xl transition-colors"
              >
                Cancel Changes
              </button>
              <button 
                onClick={handleSaveChanges}
                disabled={!participantsChanged || saving} 
                className="px-8 py-3 bg-[#0f4c2a] hover:bg-[#0f4c2a]/90 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-colors flex items-center space-x-2 shadow-sm disabled:opacity-50"
              >
                {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                <span>Save Changes</span>
              </button>
            </>
          )}
        </div>
      </div>
      {isOpen && options && (
        <GEASConfirmationDialogUI options={options} onCancel={handleCancel} onConfirm={handleConfirm} />
      )}

      {/* Participant Check-In Cancellation Confirmation Dialog */}
      {participantToCancel && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs animate-fadeIn">
          <div className="bg-white rounded-2xl p-6 shadow-2xl border border-stone-200 max-w-md w-full animate-scaleIn space-y-4">
            <div className="flex items-start space-x-3">
              <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-600 shrink-0">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h4 className="text-base font-black text-stone-900 leading-tight">
                  Cancel check-in for {participantToCancel.name}?
                </h4>
                <p className="text-xs text-stone-600 font-medium leading-relaxed">
                  This will mark the participant as not checked in. Their registration, payment, and entry pass will remain valid.
                </p>
              </div>
            </div>

            <div className="bg-stone-50 rounded-xl p-3.5 border border-stone-200 text-xs space-y-1.5">
              <div className="flex justify-between items-center text-stone-600">
                <span className="font-semibold">Participant:</span>
                <span className="font-bold text-stone-900">{participantToCancel.name}</span>
              </div>
              {participantToCancel.category && (
                <div className="flex justify-between items-center text-stone-600">
                  <span className="font-semibold">Relationship:</span>
                  <span className="font-medium text-stone-700">{participantToCancel.category}</span>
                </div>
              )}
              <div className="flex justify-between items-center text-stone-600">
                <span className="font-semibold">Registration Status:</span>
                <span className="font-bold text-emerald-700">Remains Active</span>
              </div>
              <div className="flex justify-between items-center text-stone-600">
                <span className="font-semibold">Entry Pass & QR:</span>
                <span className="font-bold text-emerald-700">Remains Valid</span>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setParticipantToCancel(null)}
                disabled={cancellingParticipant !== null}
                className="px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs font-bold uppercase tracking-wider rounded-xl transition-colors cursor-pointer"
              >
                Keep Check-In
              </button>
              <button
                type="button"
                onClick={() => executeCancelCheckIn(participantToCancel.name)}
                disabled={cancellingParticipant !== null}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-colors shadow-sm flex items-center space-x-1.5 cursor-pointer disabled:opacity-50"
              >
                {cancellingParticipant === participantToCancel.name ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Cancelling...</span>
                  </>
                ) : (
                  <>
                    <XCircle className="w-3.5 h-3.5" />
                    <span>Confirm Cancel Check-In</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
