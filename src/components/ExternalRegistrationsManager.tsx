import React, { useState, useEffect } from 'react';
import {
  collection, query, where, getDocs, updateDoc, doc, deleteDoc, Timestamp
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions, auth } from '../context/AuthContext';
import { EventRegistration, CommunityEvent, hasGenuineFinancialHistory, EventRegistrationRefund } from '../types';
import { NotificationService } from '../services/NotificationService';
import { CheckCircle2, XCircle, Trash2, Clock, Eye, AlertCircle, RefreshCw, Users, Mail, Phone, Calendar, QrCode, Send, Sparkles, X, FileDown, Archive, ArchiveRestore } from 'lucide-react';
import { useLocalGEASConfirmation, GEASConfirmationDialogUI } from './gmk/GEASConfirmationDialog';
import ExternalRegistrationForm from './external/ExternalRegistrationForm';
import GMKOfficialEntryPassCard from './shared/GMKOfficialEntryPassCard';
import { generateRefundSettlementPDF } from '../utils/refundSettlementPDF';
import { formatExternalGmkId, formatEventDate, formatEventTime, getEventTitle, getEventVenue, resolveEventDetails } from '../utils/gmkIdHelper';
import { formatPhoneWithCountryCode } from '../utils/phoneValidation';

export default function ExternalRegistrationsManager({ eventId }: { eventId: string }) {
  const [registrations, setRegistrations] = useState<EventRegistration[]>([]);
  const [events, setEvents] = useState<Record<string, CommunityEvent>>({});
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [previewPassReg, setPreviewPassReg] = useState<EventRegistration | null>(null);

  const [activeTab, setActiveTab] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [showCleanedUp, setShowCleanedUp] = useState(false);
  const [editReg, setEditReg] = useState<EventRegistration | null>(null);

  const { confirm: showConfirm, isOpen: isConfirmOpen, options: confirmOptions, handleCancel: handleConfirmCancel, handleConfirm: handleConfirmSubmit } = useLocalGEASConfirmation();

  const fetchData = async () => {
    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      // 1. Fetch Events for name mapping
      const eventsSnap = await getDocs(collection(db, "events"));
      const eventsMap: Record<string, CommunityEvent> = {};
      eventsSnap.forEach(d => {
        eventsMap[d.id] = { id: d.id, ...d.data() } as CommunityEvent;
      });
      setEvents(eventsMap);

      // 2. Fetch External Registrations
      let qRegs = query(
        collection(db, "event_registrations"),
        where("isExternal", "==", true)
      );
      
      if (eventId) {
        qRegs = query(qRegs, where("eventId", "==", eventId));
      }
      
      const regsSnap = await getDocs(qRegs);
      const list: EventRegistration[] = [];
      regsSnap.forEach(d => {
        list.push({ id: d.id, ...d.data() } as EventRegistration);
      });
      
      // Sort by creation date descending
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      
      setRegistrations(list);
    } catch (err: any) {
      console.error("Error fetching external registrations:", err);
      setErrorMsg("Failed to load external registrations. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (eventId) {
      fetchData();
    } else {
      setRegistrations([]);
      setLoading(false);
    }
  }, [eventId]);

  const handleTabChange = (tab: 'pending' | 'approved' | 'rejected') => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setActiveTab(tab);
  };

  const handleApprove = async (reg: EventRegistration) => {
    setProcessingId(reg.id);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const event = events[reg.eventId];
      const eventDetails = resolveEventDetails(event);
      const eventName = eventDetails.eventName;
      const eventDate = eventDetails.eventDate;
      const eventTime = eventDetails.eventTime;
      const eventVenue = eventDetails.eventVenue;
      const externalGmkId = formatExternalGmkId(reg.publicReference) || reg.publicReference || reg.id;

      const recipientEmail = (reg.primaryRegistrantEmail || reg.primaryMemberEmail || '').trim().toLowerCase();

      // 1. Prepare payment instructions from event bank accounts or general instructions
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
        }).join('\n');
      }

      const amountDue = typeof reg.amountDue === 'number' ? reg.amountDue :
        (typeof reg.paymentAmount === 'number' ? reg.paymentAmount :
        (reg.paymentSummary?.totalAmount || 0));

      let emailStatus: 'sent' | 'skipped' | 'failed' = 'skipped';

      // 2. Dispatch Email Notification (Template: external_registration_approved)
      if (recipientEmail) {
        try {
          await NotificationService.sendExternalRegistrationApproved(recipientEmail, {
            recipientName: reg.primaryRegistrantName || reg.participants?.[0] || 'Guest',
            eventName,
            eventDate,
            eventTime,
            venue: eventVenue,
            eventVenue,
            gmkId: externalGmkId,
            publicReference: externalGmkId,
            registrationTypeName: reg.externalRegistrationTypeName || 
              events[reg.eventId]?.externalRegistrationSettings?.types?.find((t: any) => t.id === reg.externalRegistrationTypeId)?.name ||
              reg.category ||
              'External Guest',
            totalParticipants: reg.totalParticipants || 1,
            amountDue: typeof amountDue === 'number' ? amountDue.toFixed(3) : String(amountDue),
            paymentInstructions
          });
          emailStatus = 'sent';
        } catch (emailErr: any) {
          console.warn("Failed to dispatch approval email:", emailErr);
          emailStatus = 'failed';
        }
      }

      // 3. Update Firestore registration document
      const regRef = doc(db, "event_registrations", reg.id);
      const nowIso = new Date().toISOString();
      await updateDoc(regRef, {
        adminReviewStatus: 'approved',
        workflowStatus: 'payment_pending',
        approvalEmailSentAt: emailStatus === 'sent' ? nowIso : null,
        approvalEmailRecipient: emailStatus === 'sent' ? recipientEmail : null,
        updatedAt: nowIso
      });

      await fetchData();
      if (emailStatus === 'sent') {
        setSuccessMsg(`Registration approved! Payment instructions email sent to ${recipientEmail}.`);
      } else {
        setSuccessMsg("Registration approved successfully.");
      }
      setErrorMsg(null);
    } catch (err: any) {
      console.error("Approval failed:", err);
      setErrorMsg("Failed to approve registration: " + err.message);
    } finally {
      setProcessingId(null);
    }
  };

  const handleCancelApproved = async (reg: EventRegistration) => {
    const confirmed = await showConfirm({
      title: "Cancel Approved Registration?",
      message: "Are you sure you want to cancel this approved registration? If payment was received, this will invalidate their entry pass and initiate a refund.",
      severity: "warning",
      confirmText: "Cancel Registration",
      cancelText: "Keep Active"
    });

    if (!confirmed) return;
    
    setProcessingId(reg.id);
    try {
      const regRef = doc(db, "event_registrations", reg.id);
      
      // Calculate actual confirmed payment and refundable amount
      const actualReceived = Number(
        reg.amountReceived !== undefined && reg.amountReceived !== null
          ? reg.amountReceived
          : (reg.paymentStatus === 'paid' ? (reg.amountDue ?? reg.paymentAmount ?? 0) : 0)
      );
      const alreadyRefunded = Number(reg.refundedAmount || 0);
      const refundableAmount = Math.max(0, actualReceived - alreadyRefunded);
      const isPaid = (refundableAmount > 0 || actualReceived > 0);
      
      if (isPaid && refundableAmount > 0) {
        const refundId = `ref_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
        const eventTitle = events[reg.eventId]?.title || events[reg.eventId]?.eventName || 'Community Gathering';
        const registrantName = reg.primaryRegistrantName || (reg.participants && reg.participants[0]) || reg.primaryMemberEmail || 'Guest';

        const pendingRefundRecord: EventRegistrationRefund = {
          id: refundId,
          registrationId: reg.id,
          publicReference: reg.publicReference || '',
          gmkId: reg.primaryMemberGmkId || '',
          registrantName: registrantName,
          eventId: reg.eventId,
          eventName: eventTitle,
          amountPaid: actualReceived,
          amount: refundableAmount,
          status: 'pending',
          refundReason: 'Registration Cancellation',
          paymentReference: reg.receiptNumber || '',
          date: new Date().toISOString(),
          refundedBy: ''
        };

        const existingRefundHistory = Array.isArray(reg.refundHistory) ? reg.refundHistory : [];

        await updateDoc(regRef, {
          adminReviewStatus: 'rejected',
          workflowStatus: 'rejected',
          paymentStatus: 'cancelled',
          refundDue: refundableAmount,
          amountReceived: actualReceived, // Preserves actual received amount for audit
          amountDue: 0,
          paymentAmount: 0,
          refundHistory: [...existingRefundHistory, pendingRefundRecord],
          entryPassNumber: "",
          updatedAt: new Date().toISOString()
        });
      } else {
        await updateDoc(regRef, {
          adminReviewStatus: 'rejected',
          workflowStatus: 'rejected',
          paymentStatus: 'cancelled',
          amountDue: 0,
          paymentAmount: 0,
          refundDue: 0,
          updatedAt: new Date().toISOString()
        });
      }
      await fetchData();
      setSuccessMsg(
        isPaid && refundableAmount > 0 
          ? `Registration cancelled. A pending refund of OMR ${refundableAmount.toFixed(3)} has been registered for Finance processing.`
          : "Registration cancelled successfully."
      );
    } catch (err: any) {
      console.error("Cancellation failed:", err);
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (reg: EventRegistration) => {
    setProcessingId(reg.id);
    try {
      const regRef = doc(db, "event_registrations", reg.id);
      
      // Calculate actual confirmed payment and refundable amount
      const actualReceived = Number(
        reg.amountReceived !== undefined && reg.amountReceived !== null
          ? reg.amountReceived
          : (reg.paymentStatus === 'paid' ? (reg.amountDue ?? reg.paymentAmount ?? 0) : 0)
      );
      const alreadyRefunded = Number(reg.refundedAmount || 0);
      const refundableAmount = Math.max(0, actualReceived - alreadyRefunded);
      const isPaid = (refundableAmount > 0 || actualReceived > 0);
      
      if (isPaid && refundableAmount > 0) {
        const refundId = `ref_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
        const eventTitle = events[reg.eventId]?.title || events[reg.eventId]?.eventName || 'Community Gathering';
        const registrantName = reg.primaryRegistrantName || (reg.participants && reg.participants[0]) || reg.primaryMemberEmail || 'Guest';

        const pendingRefundRecord: EventRegistrationRefund = {
          id: refundId,
          registrationId: reg.id,
          publicReference: reg.publicReference || '',
          gmkId: reg.primaryMemberGmkId || '',
          registrantName: registrantName,
          eventId: reg.eventId,
          eventName: eventTitle,
          amountPaid: actualReceived,
          amount: refundableAmount,
          status: 'pending',
          refundReason: 'Registration Rejection',
          paymentReference: reg.receiptNumber || '',
          date: new Date().toISOString(),
          refundedBy: ''
        };

        const existingRefundHistory = Array.isArray(reg.refundHistory) ? reg.refundHistory : [];

        await updateDoc(regRef, {
          adminReviewStatus: 'rejected',
          workflowStatus: 'rejected',
          paymentStatus: 'cancelled',
          refundDue: refundableAmount,
          amountReceived: actualReceived, // Preserves actual received amount for audit
          amountDue: 0,
          paymentAmount: 0,
          refundHistory: [...existingRefundHistory, pendingRefundRecord],
          entryPassNumber: "",
          updatedAt: new Date().toISOString()
        });
      } else {
        await updateDoc(regRef, {
          adminReviewStatus: 'rejected',
          workflowStatus: 'rejected',
          paymentStatus: 'cancelled',
          amountDue: 0,
          paymentAmount: 0,
          refundDue: 0,
          updatedAt: new Date().toISOString()
        });
      }

      const recipientEmail = (reg.primaryRegistrantEmail || reg.primaryMemberEmail || '').trim().toLowerCase();
      if (recipientEmail) {
        try {
          const eventDetails = resolveEventDetails(events[reg.eventId]);
          await NotificationService.sendExternalRegistrationRejected(recipientEmail, {
            recipientName: reg.primaryRegistrantName || (reg.participants && reg.participants[0]) || 'Guest',
            eventName: eventDetails.eventName,
            eventDate: eventDetails.eventDate,
            eventTime: eventDetails.eventTime,
            eventVenue: eventDetails.eventVenue,
            venue: eventDetails.eventVenue,
            gmkId: formatExternalGmkId(reg.publicReference) || reg.publicReference || reg.id,
            publicReference: formatExternalGmkId(reg.publicReference) || reg.publicReference || reg.id,
            category: reg.externalRegistrationTypeName || 
              events[reg.eventId]?.externalRegistrationSettings?.types?.find((t: any) => t.id === reg.externalRegistrationTypeId)?.name ||
              reg.category ||
              'External Guest',
            reason: 'Registration could not be accepted at this time.'
          });
        } catch (emailErr) {
          console.warn("Could not dispatch rejection email:", emailErr);
        }
      }

      await fetchData();
      setSuccessMsg(
        isPaid && refundableAmount > 0
          ? `Registration moved to rejected. A pending refund of OMR ${refundableAmount.toFixed(3)} has been registered for Finance processing.`
          : "Registration moved to rejected."
      );
    } catch (err: any) {
      console.error("Rejection failed:", err);
    } finally {
      setProcessingId(null);
    }
  };

  const handleDelete = async (reg: EventRegistration) => {
    // RTCO-096 Authoritative financial history check: cleanly prevent deletion of financial audit records
    if (hasGenuineFinancialHistory(reg)) {
      console.warn(`[ExternalRegistrationsManager] Deletion prevented for ${reg.id}: financial records exist.`);
      return;
    }
    
    const confirmed = await showConfirm({
      title: "Delete Registration?",
      message: "Are you sure you want to permanently delete this registration? This action cannot be undone.",
      severity: "danger",
      confirmText: "Delete Registration",
      cancelText: "Cancel"
    });

    if (!confirmed) return;
    
    setProcessingId(reg.id);
    try {
      const regRef = doc(db, "event_registrations", reg.id);
      await deleteDoc(regRef);
      // Immediately remove from local state for responsive UI
      setRegistrations(prev => prev.filter(r => r.id !== reg.id));
      setSuccessMsg("Registration successfully deleted.");
    } catch (err: any) {
      console.error("Deletion failed:", err);
    } finally {
      setProcessingId(null);
    }
  };

  const handleSendEmailEntryPass = async (reg: EventRegistration) => {
    const event = events[reg.eventId];
    const recipientEmail = (reg.primaryRegistrantEmail || reg.primaryMemberEmail || '').trim().toLowerCase();

    if (!recipientEmail) {
      setErrorMsg("No recipient email found for this registration.");
      return;
    }

    if (!reg.entryPassNumber) {
      setErrorMsg("No official entry pass number generated yet for this registration.");
      return;
    }

    setProcessingId(reg.id);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const eventDetails = resolveEventDetails(event);
      const eventName = eventDetails.eventName;
      const eventDate = eventDetails.eventDate;
      const eventTime = eventDetails.eventTime;
      const eventVenue = eventDetails.eventVenue;
      const externalGmkId = formatExternalGmkId(reg.publicReference) || reg.publicReference || reg.id;
      const totalParticipants = reg.totalParticipants || (reg.participants ? reg.participants.length : 1);
      const category = reg.externalRegistrationTypeName || 
        event?.externalRegistrationSettings?.types?.find((t: any) => t.id === reg.externalRegistrationTypeId)?.name ||
        events[reg.eventId]?.externalRegistrationSettings?.types?.find((t: any) => t.id === reg.externalRegistrationTypeId)?.name ||
        reg.category ||
        reg.registrationTypeName ||
        'External Guest';

      await NotificationService.sendPaymentReceiptEntryPass(recipientEmail, {
        residentName: reg.primaryRegistrantName || reg.participants?.[0] || 'Guest',
        recipientName: reg.primaryRegistrantName || reg.participants?.[0] || 'Guest',
        gmkId: externalGmkId,
        eventName,
        eventDate,
        eventTime,
        venue: eventVenue,
        eventVenue,
        category,
        registrationTypeName: category,
        amountReceived: reg.amountReceived || 0,
        receiptNumber: reg.receiptNumber || 'N/A',
        entryPassNumber: reg.entryPassNumber,
        paymentStatus: reg.paymentStatus || 'paid',
        isExternal: true,
        publicReference: externalGmkId,
        totalParticipants
      });

      const nowIso = new Date().toISOString();
      await updateDoc(doc(db, "event_registrations", reg.id), {
        entryPassEmailSentAt: nowIso,
        entryPassEmailRecipient: recipientEmail,
        updatedAt: nowIso
      });

      setSuccessMsg(`Official Entry Pass email successfully dispatched to ${recipientEmail}.`);
    } catch (err: any) {
      console.error("Failed to send Entry Pass email:", err);
      setErrorMsg("Failed to dispatch Entry Pass email: " + err.message);
    } finally {
      setProcessingId(null);
    }
  };

  const handleCleanupSettledRegistration = async (reg: EventRegistration) => {
    const confirmed = await showConfirm({
      title: "Archive / Clean Up Settled Registration?",
      message: "This will safely archive this external registration from active operational lists (Attendance, Gate Check-In). All financial audit records, payment transactions, refund records, and settled vouchers will remain permanently preserved for audit and accounting.",
      severity: "warning",
      confirmText: "Archive / Clean Up",
      cancelText: "Cancel"
    });

    if (!confirmed) return;

    setProcessingId(reg.id);
    try {
      const regRef = doc(db, "event_registrations", reg.id);
      const nowIso = new Date().toISOString();
      const adminIdentifier = auth.currentUser?.email || 'Admin';
      await updateDoc(regRef, {
        operationalStatus: 'cleaned_up',
        isOperationalCleanedUp: true,
        cleanedUpAt: nowIso,
        cleanedUpBy: adminIdentifier,
        updatedAt: nowIso
      });

      setRegistrations(prev => prev.map(r => r.id === reg.id ? {
        ...r,
        operationalStatus: 'cleaned_up',
        isOperationalCleanedUp: true,
        cleanedUpAt: nowIso,
        cleanedUpBy: adminIdentifier
      } : r));

      setSuccessMsg("Registration successfully archived from active operational lists while preserving financial audit records.");
    } catch (err: any) {
      console.error("Cleanup failed:", err);
      setErrorMsg("Failed to archive registration: " + err.message);
    } finally {
      setProcessingId(null);
    }
  };

  const handleRestoreCleanedUpRegistration = async (reg: EventRegistration) => {
    const confirmed = await showConfirm({
      title: "Restore Registration to Operational List?",
      message: "This will restore this external registration to the active operational lists.",
      severity: "info",
      confirmText: "Restore Registration",
      cancelText: "Cancel"
    });

    if (!confirmed) return;

    setProcessingId(reg.id);
    try {
      const regRef = doc(db, "event_registrations", reg.id);
      const nowIso = new Date().toISOString();
      const adminIdentifier = auth.currentUser?.email || 'Admin';
      await updateDoc(regRef, {
        operationalStatus: 'active',
        isOperationalCleanedUp: false,
        cleanedUpAt: null,
        cleanedUpBy: null,
        restoredAt: nowIso,
        restoredBy: adminIdentifier,
        updatedAt: nowIso
      });

      setRegistrations(prev => prev.map(r => r.id === reg.id ? {
        ...r,
        operationalStatus: 'active',
        isOperationalCleanedUp: false,
        cleanedUpAt: null,
        cleanedUpBy: null,
        restoredAt: nowIso,
        restoredBy: adminIdentifier
      } : r));

      setSuccessMsg("Registration successfully restored to active operational lists.");
    } catch (err: any) {
      console.error("Restore failed:", err);
      setErrorMsg("Failed to restore registration: " + err.message);
    } finally {
      setProcessingId(null);
    }
  };

  const filteredRegs = registrations.filter(r => {
    const isCleanedUp = (r as any).operationalStatus === 'cleaned_up' || (r as any).isOperationalCleanedUp === true;
    if (isCleanedUp && !showCleanedUp) {
      return false;
    }
    const matchesTab = (r as any).adminReviewStatus === activeTab || (!r.adminReviewStatus && activeTab === 'pending');
    return matchesTab;
  });

  const cleanedUpCount = registrations.filter(r => 
    ((r as any).operationalStatus === 'cleaned_up' || (r as any).isOperationalCleanedUp === true) &&
    ((r as any).adminReviewStatus === activeTab || (!r.adminReviewStatus && activeTab === 'pending'))
  ).length;

  if (!eventId) {
    return (
      <div className="flex items-center justify-center p-12 bg-white rounded-2xl border border-stone-200">
        <span className="text-sm font-semibold text-stone-500 uppercase tracking-wider">Please select an event</span>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 space-x-3 text-stone-500">
        <RefreshCw className="w-5 h-5 animate-spin" />
        <span className="font-bold text-sm tracking-wider uppercase">Loading External Registrations...</span>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden flex flex-col h-full animate-fadeIn">
      {/* Header */}
      <div className="bg-stone-50 border-b border-stone-200 p-4 md:p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <h2 className="text-xl font-black text-stone-900 uppercase tracking-tight flex items-center space-x-2">
            <Users className="w-5 h-5 text-emerald-700" />
            <span>External Registrations</span>
          </h2>
          <button
            onClick={() => fetchData()}
            disabled={loading}
            className="p-1.5 text-stone-500 hover:text-stone-800 hover:bg-stone-200/60 rounded-lg transition-colors cursor-pointer"
            title="Refresh registrations"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          {activeTab === 'rejected' && cleanedUpCount > 0 && (
            <button
              onClick={() => setShowCleanedUp(prev => !prev)}
              className={`px-3 py-2 text-[11px] font-bold uppercase tracking-wider rounded-xl transition-all border flex items-center space-x-1.5 cursor-pointer ${
                showCleanedUp
                  ? 'bg-stone-800 text-white border-stone-800 shadow-sm'
                  : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-50'
              }`}
              title="Toggle visibility of archived / cleaned-up settled registrations"
            >
              <Archive className="w-3.5 h-3.5" />
              <span>{showCleanedUp ? 'Hide Archived' : `Show Archived (${cleanedUpCount})`}</span>
            </button>
          )}

          <div className="flex bg-stone-200/50 p-1 rounded-xl">
          <button
            onClick={() => handleTabChange('pending')}
            className={`px-4 py-2 text-[11px] font-black uppercase tracking-wider rounded-lg transition-all ${
              activeTab === 'pending'
                ? 'bg-amber-500 text-white shadow-md'
                : 'text-stone-600 hover:text-stone-900 hover:bg-white/50'
            }`}
          >
            Pending Review
          </button>
          <button
            onClick={() => handleTabChange('approved')}
            className={`px-4 py-2 text-[11px] font-black uppercase tracking-wider rounded-lg transition-all ${
              activeTab === 'approved'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-stone-600 hover:text-stone-900 hover:bg-white/50'
            }`}
          >
            Approved
          </button>
          <button
            onClick={() => handleTabChange('rejected')}
            className={`px-4 py-2 text-[11px] font-black uppercase tracking-wider rounded-lg transition-all ${
              activeTab === 'rejected'
                ? 'bg-rose-600 text-white shadow-md'
                : 'text-stone-600 hover:text-stone-900 hover:bg-white/50'
            }`}
          >
            Rejected
          </button>
        </div>
      </div>
    </div>

      {successMsg && (
        <div className="p-4 m-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start justify-between space-x-2.5 text-xs text-emerald-800 font-semibold">
          <div className="flex items-start space-x-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <span>{successMsg}</span>
          </div>
          <button
            onClick={() => setSuccessMsg(null)}
            className="text-emerald-500 hover:text-emerald-800 cursor-pointer p-0.5 rounded"
            title="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-auto bg-stone-50/30 p-4 md:p-6 space-y-4">
        {filteredRegs.length === 0 ? (
          <div className="text-center py-12 bg-white border border-stone-200 border-dashed rounded-2xl">
            <CheckCircle2 className="w-8 h-8 text-stone-300 mx-auto mb-3" />
            <h3 className="text-sm font-bold text-stone-700">No {activeTab} registrations</h3>
            <p className="text-xs text-stone-500 mt-1">
              {activeTab === 'pending' ? 'All external registrations have been processed.' : `You have no ${activeTab} external registrations.`}
            </p>
          </div>
        ) : (
          filteredRegs.map(reg => {
            const event = events[reg.eventId];
            const eventName = event?.title || 'Unknown Event';
            const publicRef = formatExternalGmkId(reg.publicReference) || reg.publicReference || reg.id.substring(0, 12) + '...';
            
            return (
              <div key={reg.id} className="bg-white border border-stone-200 rounded-2xl p-4 shadow-2xs hover:border-emerald-200 transition-colors">
                <div className="flex flex-col md:flex-row gap-4 md:items-start justify-between">
                  <div className="space-y-3 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2.5 py-1 bg-stone-100 border border-stone-200 text-stone-700 rounded-md text-[10px] font-black font-mono tracking-wider">
                        {publicRef}
                      </span>
                      {((reg as any).operationalStatus === 'cleaned_up' || (reg as any).isOperationalCleanedUp === true) && (
                        <span className="px-2.5 py-1 bg-stone-200 text-stone-800 border border-stone-300 rounded-md text-[10px] font-black uppercase tracking-wider flex items-center space-x-1">
                          <Archive className="w-3 h-3" />
                          <span>Archived / Cleaned Up</span>
                        </span>
                      )}
                      <span className="px-2.5 py-1 bg-emerald-50 text-emerald-800 border border-emerald-100 rounded-md text-[10px] font-black uppercase tracking-wider">
                        {reg.externalRegistrationTypeName || 'External Guest'}
                      </span>
                      <span className="px-2.5 py-1 bg-blue-50 text-blue-800 border border-blue-100 rounded-md text-[10px] font-black uppercase tracking-wider">
                        {(reg as any).entryType === 'family' ? 'Family' : 'Single'}
                      </span>
                    </div>

                    <div>
                      <h4 className="text-lg font-black text-stone-900">{reg.primaryRegistrantName || 'Unknown Name'}</h4>
                      <div className="flex items-center space-x-1.5 text-xs text-stone-600 font-medium mt-1">
                        <Calendar className="w-3.5 h-3.5 text-stone-400" />
                        <span className="font-bold text-stone-800">{eventName}</span>
                        <span className="text-stone-300">•</span>
                        <span>Submitted: {new Date(reg.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-x-6 gap-y-2 text-xs font-semibold text-stone-700 pt-2 border-t border-stone-100">
                      <div className="flex items-center space-x-1.5">
                        <Mail className="w-3.5 h-3.5 text-stone-400" />
                        <span>{reg.primaryRegistrantEmail}</span>
                      </div>
                      <div className="flex items-center space-x-1.5">
                        <Phone className="w-3.5 h-3.5 text-stone-400" />
                        <span>{formatPhoneWithCountryCode(reg.primaryRegistrantPhone || reg.primaryRegistrantWhatsapp) || 'N/A'}</span>
                      </div>
                    </div>

                    <div className="bg-stone-50 border border-stone-200 rounded-xl p-3 mt-2">
                      <div className="text-[10px] font-black uppercase text-stone-500 tracking-wider mb-2">
                        Participant Composition (Total: {reg.totalParticipants})
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {reg.participantDetails?.map((p, idx) => (
                          <span key={idx} className="px-2 py-0.5 bg-white border border-stone-200 rounded text-[10px] font-bold text-stone-700 shadow-xs">
                            {p.name} <span className="text-stone-400 font-medium capitalize">({p.role}{p.age !== undefined ? `, Age ${p.age}` : ''})</span>
                          </span>
                        )) || (
                          <span className="text-xs text-stone-500 italic">No details provided</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  {activeTab === 'pending' && (
                    <div className="flex flex-row md:flex-col gap-2 pt-2 md:pt-0 border-t border-stone-100 md:border-t-0 md:pl-4 md:border-l shrink-0">
                      <button
                        onClick={() => handleApprove(reg)}
                        disabled={processingId === reg.id}
                        className="flex-1 md:flex-none flex items-center justify-center space-x-1.5 px-4 py-2 bg-[#0f4c2a] hover:bg-[#125831] text-white text-[11px] font-black uppercase tracking-wider rounded-lg transition-all shadow-sm disabled:opacity-50 cursor-pointer"
                      >
                        {processingId === reg.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                        <span>Approve</span>
                      </button>
                      <button
                        onClick={() => handleReject(reg)}
                        disabled={processingId === reg.id}
                        className="flex-1 md:flex-none flex items-center justify-center space-x-1.5 px-4 py-2 bg-white hover:bg-stone-50 text-stone-700 border border-stone-200 text-[11px] font-black uppercase tracking-wider rounded-lg transition-all disabled:opacity-50 cursor-pointer shadow-sm hover:border-stone-300"
                      >
                        <XCircle className="w-3.5 h-3.5 text-stone-500" />
                        <span>Reject</span>
                      </button>
                      {!hasGenuineFinancialHistory(reg) && (
                        <button
                          onClick={() => handleDelete(reg)}
                          disabled={processingId === reg.id}
                          className="flex-1 md:flex-none flex items-center justify-center space-x-1.5 px-4 py-2 bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 hover:border-rose-300 text-[11px] font-black uppercase tracking-wider rounded-lg transition-all disabled:opacity-50 cursor-pointer shadow-sm mt-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Delete</span>
                        </button>
                      )}
                    </div>
                  )}
                  {activeTab !== 'pending' && (
                    <div className="flex flex-row md:flex-col gap-2 pt-2 md:pt-0 border-t border-stone-100 md:border-t-0 md:pl-4 md:border-l shrink-0 justify-center">
                      <span className={`px-3 py-1 text-[10px] font-black uppercase tracking-widest rounded-full text-center ${
                        activeTab === 'approved' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                      }`}>
                        {activeTab}
                      </span>

                      {activeTab === 'approved' && reg.entryPassNumber && (
                        <div className="flex flex-col gap-1.5 mt-1">
                          <button
                            onClick={() => setPreviewPassReg(reg)}
                            className="flex items-center justify-center space-x-1 px-3 py-1.5 bg-[#0f4c2a] hover:bg-[#125831] text-white text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all shadow-xs cursor-pointer"
                            title="Preview official GMK Entry Pass"
                          >
                            <QrCode className="w-3.5 h-3.5" />
                            <span>Entry Pass</span>
                          </button>

                          <button
                            onClick={() => handleSendEmailEntryPass(reg)}
                            disabled={processingId === reg.id}
                            className="flex items-center justify-center space-x-1 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all shadow-xs cursor-pointer border bg-blue-50 hover:bg-blue-100 text-blue-900 border-blue-300"
                            title={
                              reg.entryPassEmailSentAt
                                ? `Delivered via email on ${new Date(reg.entryPassEmailSentAt).toLocaleDateString()} to ${reg.entryPassEmailRecipient || 'guest'}. Click to resend.`
                                : 'Send Entry Pass & Receipt via Email'
                            }
                          >
                            <Mail className="w-3 h-3" />
                            <span>{reg.entryPassEmailSentAt ? 'Pass Emailed' : 'Email Pass'}</span>
                          </button>
                        </div>
                      )}

                      {activeTab === 'approved' && (
                        <button
                          onClick={() => setEditReg(reg)}
                          disabled={processingId === reg.id}
                          className="flex-1 md:flex-none flex items-center justify-center space-x-1.5 px-4 py-2 bg-white hover:bg-blue-50 text-blue-700 border border-blue-200 hover:border-blue-300 text-[11px] font-black uppercase tracking-wider rounded-lg transition-all disabled:opacity-50 cursor-pointer shadow-sm mt-2"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Edit Registration</span>
                        </button>
                      )}
                      {activeTab === 'approved' && (
                        <button
                          onClick={() => handleCancelApproved(reg)}
                          disabled={processingId === reg.id}
                          className="flex-1 md:flex-none flex items-center justify-center space-x-1.5 px-4 py-2 bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 hover:border-rose-300 text-[11px] font-black uppercase tracking-wider rounded-lg transition-all disabled:opacity-50 cursor-pointer shadow-sm mt-2"
                        >
                          {processingId === reg.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                          <span>Cancel Reg</span>
                        </button>
                      )}

                      {activeTab === 'rejected' && (
                        hasGenuineFinancialHistory(reg) ? (
                          <div className="mt-2 flex flex-col items-center space-y-1.5 w-full min-w-[130px]">
                            <span className="px-2.5 py-1 text-[9px] font-black uppercase tracking-wider bg-stone-100 text-stone-600 rounded-md border border-stone-200 block text-center w-full" title="Protected: Genuine financial history exists for audit records">
                              Financial Audit Record
                            </span>
                            {(() => {
                              const settledRefund = Array.isArray(reg.refundHistory) 
                                ? reg.refundHistory.find(h => h.status === 'settled')
                                : null;
                              const isRefundSettled = (
                                reg.paymentStatus === 'refunded' ||
                                (Number(reg.refundedAmount || 0) > 0 && Number(reg.refundDue || 0) === 0) ||
                                Boolean(settledRefund)
                              );
                              const isCleanedUp = (reg as any).operationalStatus === 'cleaned_up' || (reg as any).isOperationalCleanedUp === true;

                              return (
                                <div className="flex flex-col gap-1.5 w-full">
                                  {isRefundSettled && (
                                    <button
                                      onClick={() => generateRefundSettlementPDF(reg, settledRefund || Number(reg.refundedAmount || 0), undefined, undefined, undefined, events[reg.eventId])}
                                      className="w-full px-2.5 py-1.5 bg-[#0f4c2a] hover:bg-[#125831] text-white text-[10px] font-bold uppercase tracking-wider rounded-md flex items-center justify-center space-x-1 shadow-xs transition-colors cursor-pointer"
                                      title="Download Settled Refund Voucher (PDF)"
                                    >
                                      <FileDown className="w-3 h-3" />
                                      <span>Refund Proof</span>
                                    </button>
                                  )}

                                  {isRefundSettled && (
                                    isCleanedUp ? (
                                      <div className="flex flex-col gap-1 items-center w-full">
                                        <span className="px-2 py-0.5 text-[9px] font-black uppercase tracking-wider bg-stone-200 text-stone-700 rounded border border-stone-300 w-full text-center">
                                          Archived from Ops
                                        </span>
                                        <button
                                          onClick={() => handleRestoreCleanedUpRegistration(reg)}
                                          disabled={processingId === reg.id}
                                          className="w-full px-2.5 py-1 bg-stone-100 hover:bg-stone-200 text-stone-700 text-[10px] font-bold uppercase tracking-wider rounded-md flex items-center justify-center space-x-1 border border-stone-300 transition-colors cursor-pointer"
                                          title="Restore registration to active operational lists"
                                        >
                                          <ArchiveRestore className="w-3 h-3 text-stone-600" />
                                          <span>Restore to List</span>
                                        </button>
                                      </div>
                                    ) : (
                                      <button
                                        onClick={() => handleCleanupSettledRegistration(reg)}
                                        disabled={processingId === reg.id}
                                        className="w-full px-2.5 py-1.5 bg-stone-700 hover:bg-stone-800 text-white text-[10px] font-bold uppercase tracking-wider rounded-md flex items-center justify-center space-x-1 shadow-xs transition-colors cursor-pointer"
                                        title="Safely archive from active operational lists (Attendance, Gate Check-In) while permanently preserving financial audit records"
                                      >
                                        <Archive className="w-3 h-3" />
                                        <span>Archive / Clean Up</span>
                                      </button>
                                    )
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        ) : (
                          <button
                            onClick={() => handleDelete(reg)}
                            disabled={processingId === reg.id}
                            className="flex-1 md:flex-none flex items-center justify-center space-x-1.5 px-4 py-2 bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 hover:border-rose-300 text-[11px] font-black uppercase tracking-wider rounded-lg transition-all disabled:opacity-50 cursor-pointer shadow-sm mt-2"
                          >
                            {processingId === reg.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                            <span>Delete</span>
                          </button>
                        )
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Edit External Registration Modal */}
      {editReg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl shadow-xl w-full max-w-3xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between p-4 border-b border-stone-200 shrink-0">
              <h2 className="text-lg font-black text-stone-800 uppercase tracking-wider">
                Edit External Registration
              </h2>
              <button
                onClick={() => setEditReg(null)}
                className="p-2 bg-stone-100 hover:bg-stone-200 text-stone-600 rounded-full transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 sm:p-6 overflow-y-auto flex-1">
              <ExternalRegistrationForm
                event={events[editReg.eventId] || Object.values(events)[0]}
                typeConfig={(events[editReg.eventId] || Object.values(events)[0])?.externalRegistrationSettings?.types.find(t => t.id === editReg.externalRegistrationTypeId) as any}
                validationDb={db as any}
                onBack={() => setEditReg(null)}
                existingRegistration={editReg}
                onSuccess={(updatedReg) => {
                  setRegistrations(prev => prev.map(r => r.id === updatedReg.id ? updatedReg : r));
                  setEditReg(null);
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Official Entry Pass Preview Modal */}
      {previewPassReg && (
        <div 
          id="entry-pass-preview-modal"
          className="fixed inset-0 bg-stone-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
        >
          <div className="relative max-w-sm w-full my-auto animate-scaleUp">
            <button
              onClick={() => setPreviewPassReg(null)}
              className="absolute -top-3 -right-3 z-10 w-8 h-8 rounded-full bg-stone-800 text-white flex items-center justify-center hover:bg-black transition-colors shadow-lg cursor-pointer"
              title="Close Pass Preview"
            >
              <X className="w-4 h-4" />
            </button>
            <GMKOfficialEntryPassCard
              entryPassNumber={previewPassReg.entryPassNumber || 'PASS-PENDING'}
              eventName={events[previewPassReg.eventId]?.title || 'Community Gathering'}
              eventDate={events[previewPassReg.eventId]?.date}
              eventVenue={events[previewPassReg.eventId]?.location}
              registrantName={previewPassReg.primaryRegistrantName}
              totalAttendees={previewPassReg.totalParticipants}
              referenceId={formatExternalGmkId(previewPassReg.publicReference) || previewPassReg.publicReference || previewPassReg.id}
              isExternal={true}
              showActions={true}
            />
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
