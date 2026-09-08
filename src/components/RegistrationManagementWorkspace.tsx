import React, { useState, useMemo } from 'react';
import { updateDoc, doc, deleteDoc } from 'firebase/firestore';
import { db } from '../context/AuthContext';
import { NotificationService } from '../services/NotificationService';
import { CommunityEvent, EventRegistration, Family, FamilyMember, EventRegistrationRefund, hasGenuineFinancialHistory, EventRegistrationParticipantDetail } from '../types';
import AdminRegistrationDetailsModal from './AdminRegistrationDetailsModal';

import { Search, Filter, RefreshCw, XCircle, Trash2, Archive, CheckCircle2, AlertCircle, Users, Mail, Phone, QrCode, FileDown, Plus, X, Edit3, UserPlus } from 'lucide-react';
import { useLocalGEASConfirmation, GEASConfirmationDialogUI } from './gmk/GEASConfirmationDialog';
import { formatExternalGmkId, resolveEventDetails } from '../utils/gmkIdHelper';
import { formatPhoneWithCountryCode } from '../utils/phoneValidation';
import GMKOfficialEntryPassCard from './shared/GMKOfficialEntryPassCard';

interface Props {
  eventId: string;
  activeEvent: CommunityEvent | null;
  events: CommunityEvent[];
  registrations: EventRegistration[];
  families: Family[];
  familyMembers: FamilyMember[];
}

export default function RegistrationManagementWorkspace({ eventId, activeEvent, events, registrations, families, familyMembers }: Props) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('active');
  const [filterFinance, setFilterFinance] = useState('all');
  const [showFilters, setShowFilters] = useState(false);
  
  const [selectedReg, setSelectedReg] = useState<EventRegistration | null>(null);
  const [isModifying, setIsModifying] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  
  const { confirm, isOpen, options, handleCancel, handleConfirm } = useLocalGEASConfirmation();

  // Sync selectedReg with live data updates
  React.useEffect(() => {
    if (selectedReg) {
      const updated = registrations.find(r => r.id === selectedReg.id);
      if (updated) setSelectedReg(updated);
    }
  }, [registrations]);

  const filteredRegistrations = useMemo(() => {
    return registrations.filter(reg => {
      // Search
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const gmkId = reg.primaryMemberGmkId?.toLowerCase() || '';
        const extRef = (reg.publicReference || '').toLowerCase();
        const formattedExtRef = (formatExternalGmkId(reg.publicReference) || '').toLowerCase();
        const id = reg.id.toLowerCase();
        
        const fam = !reg.isExternal ? families.find(f => 
          f.id === reg.familyId || 
          (reg.primaryMemberGmkId && (f.primaryMemberGmkId === reg.primaryMemberGmkId || f.id === `fam_${reg.primaryMemberGmkId}`)) || 
          (reg.primaryMemberEmail && f.primaryMemberEmail?.toLowerCase() === reg.primaryMemberEmail.toLowerCase())
        ) : null;

        const residentName = fam?.fullName?.toLowerCase() || '';
        const externalName = reg.primaryRegistrantName?.toLowerCase() || '';
        const primaryName = externalName || residentName;
        const phone = (reg.primaryRegistrantPhone || fam?.phone || '').toLowerCase();
        const email = (reg.primaryMemberEmail || reg.primaryRegistrantEmail || '').toLowerCase();
        
        let participantMatch = false;
        if (reg.participants) {
           participantMatch = reg.participants.some(p => p.toLowerCase().includes(q));
        }
        
        const match = gmkId.includes(q) || extRef.includes(q) || formattedExtRef.includes(q) || id.includes(q) || primaryName.includes(q) || residentName.includes(q) || externalName.includes(q) || phone.includes(q) || email.includes(q) || participantMatch;
        if (!match) return false;
      }
      
      // Type
      if (filterType === 'resident' && reg.isExternal) return false;
      if (filterType === 'external' && !reg.isExternal) return false;
      
      // Exclude terminal states from the active operational list
      const st = reg.workflowStatus || reg.paymentStatus || 'pending';
      const isArchived = reg.isOperationalCleanedUp === true;
      if (st === 'refunded' || isArchived) return false;
      
      // Status filter
      if (filterStatus === 'active' && (st === 'cancelled')) return false;
      if (filterStatus === 'cancelled' && st !== 'cancelled') return false;
      
      // Finance
      const hasFin = hasGenuineFinancialHistory(reg);
      if (filterFinance === 'paid' && reg.paymentStatus !== 'paid') return false;
      if (filterFinance === 'pending' && reg.paymentStatus !== 'pending') return false;
      if (filterFinance === 'no_trail' && hasFin) return false;
      
      return true;
    });
  }, [registrations, searchQuery, filterType, filterStatus, filterFinance, families]);

  const handleDelete = async (reg: EventRegistration) => {
    const hasFin = hasGenuineFinancialHistory(reg);
    if (hasFin) return; // Not allowed

    const isConfirmed = await confirm({
      title: 'Delete Registration',
      message: 'This registration has no Finance history. Deleting it will permanently remove the registration. This action cannot be undone.',
      severity: 'danger',
      confirmText: 'Permanently Delete'
    });
    if (!isConfirmed) return;

    setProcessingId(reg.id);
    try {
      await deleteDoc(doc(db, 'event_registrations', reg.id));
      setSelectedReg(null);
      setSuccessMsg('Registration deleted permanently.');
    } catch (e: any) {
      setErrorMsg(e.message);
    } finally {
      setProcessingId(null);
    }
  };

  const handleCancelReg = async (reg: EventRegistration) => {
    const isConfirmed = await confirm({
      title: 'Cancel Registration',
      message: 'Are you sure you want to cancel this registration? If payment was received, this will initiate a refund process in Finance.',
      severity: 'warning',
      confirmText: 'Cancel Registration'
    });
    if (!isConfirmed) return;

    setProcessingId(reg.id);
    try {
      const actualReceived = Number(reg.amountReceived ?? (reg.paymentStatus === 'paid' ? (reg.amountDue ?? reg.paymentAmount ?? 0) : 0));
      const alreadyRefunded = Number(reg.refundedAmount || 0);
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
          registrationId: reg.id,
          publicReference: reg.publicReference || reg.id,
          gmkId: reg.primaryMemberGmkId || '',
          registrantName: reg.primaryRegistrantName || reg.participants?.[0] || 'Guest',
          eventId: reg.eventId,
          eventName: activeEvent?.title || '',
          amountPaid: actualReceived,
          amount: refundableAmount,
          status: 'pending',
          refundReason: 'Admin Cancellation',
          date: new Date().toISOString(),
          refundedBy: ''
        };
        const existingRefundHistory = Array.isArray(reg.refundHistory) ? reg.refundHistory : [];
        updateData.refundDue = refundableAmount;
        updateData.amountReceived = actualReceived;
        updateData.amountDue = 0;
        updateData.refundHistory = [...existingRefundHistory, pendingRefundRecord];
      } else {
        updateData.amountDue = 0;
        updateData.refundDue = 0;
      }

      await updateDoc(doc(db, 'event_registrations', reg.id), updateData);
      setSuccessMsg(isPaid && refundableAmount > 0 ? 'Registration cancelled. Sent to Finance for refund.' : 'Registration cancelled.');
    } catch (e: any) {
      setErrorMsg(e.message);
    } finally {
      setProcessingId(null);
    }
  };

  const handleArchive = async (reg: EventRegistration) => {
    const isConfirmed = await confirm({
      title: 'Archive Registration',
      message: 'This will archive the registration from operational lists. It remains available for historical and financial reporting.',
      severity: 'info',
      confirmText: 'Archive Registration'
    });
    if (!isConfirmed) return;

    setProcessingId(reg.id);
    try {
      await updateDoc(doc(db, 'event_registrations', reg.id), {
        isOperationalCleanedUp: true,
        cleanedUpAt: new Date().toISOString()
      });
      setSuccessMsg('Registration archived.');
    } catch (e: any) {
      setErrorMsg(e.message);
    } finally {
      setProcessingId(null);
    }
  };

  const handleAddFamilyMember = async (reg: EventRegistration, member: FamilyMember) => {
     if (reg.participants?.includes(member.name)) return;
     
     setProcessingId(`add_member_${member.id}`);
     try {
       const newParticipants = [...(reg.participants || []), member.name];
       const roleMapping = member.relationship.toLowerCase() === 'self' ? 'primary' : member.relationship.toLowerCase();
       const newDetails: EventRegistrationParticipantDetail = {
         name: member.name,
         role: roleMapping as any,
         yearOfBirth: member.yearOfBirth
       };
       const newParticipantDetails = [...(reg.participantDetails || []), newDetails];
       
       await updateDoc(doc(db, 'event_registrations', reg.id), {
         participants: newParticipants,
         participantDetails: newParticipantDetails,
         totalParticipants: newParticipants.length,
         updatedAt: new Date().toISOString()
       });
       setSuccessMsg(`Added ${member.name} to registration.`);
     } catch (e: any) {
       setErrorMsg(e.message);
     } finally {
       setProcessingId(null);
     }
  };

  const handleApprove = async (reg: EventRegistration) => {
    setProcessingId(reg.id);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const event = activeEvent || events.find(e => e.id === reg.eventId);
      if (!event) throw new Error("Event not found");
      const eventDetails = resolveEventDetails(event as any);
      const eventName = eventDetails.eventName;
      const eventDate = eventDetails.eventDate;
      const eventTime = eventDetails.eventTime;
      const eventVenue = eventDetails.eventVenue;
      const externalGmkId = formatExternalGmkId(reg.publicReference) || reg.publicReference || reg.id;
      const recipientEmail = (reg.primaryRegistrantEmail || reg.primaryMemberEmail || "").trim().toLowerCase();
      let paymentInstructions = "Please contact the Event Director or Committee at the registration counter for payment settlement.";
      if (event?.paymentTransferAccounts && event.paymentTransferAccounts.length > 0) {
        paymentInstructions = event.paymentTransferAccounts.map(acc => {
          const lines: string[] = [];
          if (acc.name) lines.push(`Name: ${acc.name}`);
          if (acc.bank) lines.push(`Bank: ${acc.bank}`);
          if (acc.accountNumber) lines.push(`A/C: ${acc.accountNumber}`);
          if (acc.iban) lines.push(`IBAN: ${acc.iban}`);
          if (acc.mobilePhone) lines.push(`Mobile Transfer: ${acc.mobilePhone}`);
          return lines.join(" | ");
        }).join("\n");
      }
      const amountDue = typeof reg.amountDue === "number" ? reg.amountDue :
        (typeof reg.paymentAmount === "number" ? reg.paymentAmount :
        (reg.paymentSummary?.totalAmount || 0));
      let emailStatus = "skipped";
      if (recipientEmail) {
        try {
          await NotificationService.sendExternalRegistrationApproved(recipientEmail, {
            recipientName: reg.primaryRegistrantName || reg.participants?.[0] || "Guest",
            eventName, eventDate, eventTime, venue: eventVenue, eventVenue,
            gmkId: externalGmkId, publicReference: externalGmkId,
            registrationTypeName: reg.externalRegistrationTypeName || reg.category || "External Guest",
            totalParticipants: reg.totalParticipants || 1,
            amountDue: typeof amountDue === "number" ? amountDue.toFixed(3) : String(amountDue),
            paymentInstructions
          });
          emailStatus = "sent";
        } catch (emailErr: any) {
          console.warn("Failed to dispatch approval email:", emailErr);
          emailStatus = "failed";
        }
      }
      const nowIso = new Date().toISOString();
      const updateData: any = {
        adminReviewStatus: "approved",
        workflowStatus: "payment_pending",
        approvalEmailSentAt: emailStatus === "sent" ? nowIso : null,
        approvalEmailRecipient: emailStatus === "sent" ? recipientEmail : null,
        updatedAt: nowIso
      };
      await updateDoc(doc(db, "event_registrations", reg.id), updateData);
      setSuccessMsg(emailStatus === "sent" ? `Approved! Email sent to ${recipientEmail}` : "Approved successfully.");
      setSelectedReg(prev => prev ? { ...prev, ...updateData } as any : null);
    } catch (err: any) {
      setErrorMsg("Failed to approve: " + err.message);
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (reg: EventRegistration) => {
    const confirmed = await confirm({
      title: "Reject Registration",
      message: "Are you sure you want to reject this external registration? This will notify the applicant.",
      severity: "danger",
      confirmText: "Reject"
    });
    if (!confirmed) return;
    setProcessingId(reg.id);
    try {
      const event = activeEvent || events.find(e => e.id === reg.eventId);
      const eventDetails = event ? resolveEventDetails(event as any) : { eventName: "Event" };
      const recipientEmail = (reg.primaryRegistrantEmail || reg.primaryMemberEmail || "").trim().toLowerCase();
      let emailStatus = "skipped";
      if (recipientEmail) {
        try {
          await NotificationService.sendExternalRegistrationRejected(recipientEmail, {
            recipientName: reg.primaryRegistrantName || reg.participants?.[0] || "Guest",
            eventName: eventDetails.eventName,
            publicReference: reg.publicReference || reg.id,
            reason: "Did not meet criteria"
          });
          emailStatus = "sent";
        } catch (e) { console.warn(e); emailStatus = "failed"; }
      }
      const updateData = { adminReviewStatus: "rejected", workflowStatus: "cancelled", updatedAt: new Date().toISOString() };
      await updateDoc(doc(db, "event_registrations", reg.id), updateData);
      setSuccessMsg("Registration rejected.");
      setSelectedReg(prev => prev ? { ...prev, ...updateData } as any : null);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {errorMsg && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-center justify-between text-rose-700 animate-fadeIn">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4" />
            <span className="text-sm font-medium">{errorMsg}</span>
          </div>
          <button onClick={() => setErrorMsg(null)}><X className="w-4 h-4" /></button>
        </div>
      )}
      
      {successMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between text-emerald-800 animate-fadeIn">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4" />
            <span className="text-sm font-medium">{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)}><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Control Bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
          <input
            type="text"
            placeholder="Search by GMK ID, Name, Reference, Phone, Email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0f4c2a]"
          />
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl border text-sm font-bold uppercase tracking-wider transition-colors ${
            showFilters || filterType !== 'all' || filterStatus !== 'active' || filterFinance !== 'all'
              ? 'bg-[#0f4c2a] text-white border-[#0f4c2a]'
              : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-50'
          }`}
        >
          <Filter className="w-4 h-4" />
          <span>Filters</span>
        </button>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 bg-stone-50 border border-stone-200 rounded-xl">
          <div>
            <label className="block text-xs font-black uppercase tracking-wider text-stone-500 mb-1.5">Registration Type</label>
            <select value={filterType} onChange={e => setFilterType(e.target.value)} className="w-full p-2 text-sm border border-stone-200 rounded-lg">
              <option value="all">All Types</option>
              <option value="resident">Resident Only</option>
              <option value="external">External Only</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-black uppercase tracking-wider text-stone-500 mb-1.5">Status</label>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="w-full p-2 text-sm border border-stone-200 rounded-lg">
              <option value="all">Any Status</option>
              <option value="active">Active (Pending/Paid)</option>
              <option value="cancelled">Cancelled</option>
              
            </select>
          </div>
          <div>
            <label className="block text-xs font-black uppercase tracking-wider text-stone-500 mb-1.5">Finance State</label>
            <select value={filterFinance} onChange={e => setFilterFinance(e.target.value)} className="w-full p-2 text-sm border border-stone-200 rounded-lg">
              <option value="all">Any Finance State</option>
              <option value="paid">Paid</option>
              <option value="pending">Payment Pending</option>
              <option value="no_trail">No Finance Trail</option>
            </select>
          </div>
        </div>
      )}

      {/* Registration List */}
      <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-stone-50 border-b border-stone-200">
                <th className="px-4 py-3 text-xs font-black uppercase tracking-wider text-stone-500">Registrant</th>
                <th className="px-4 py-3 text-xs font-black uppercase tracking-wider text-stone-500 text-center">Type</th>
                <th className="px-4 py-3 text-xs font-black uppercase tracking-wider text-stone-500 text-center">Participants</th>
                <th className="px-4 py-3 text-xs font-black uppercase tracking-wider text-stone-500 text-center">Finance</th>
                <th className="px-4 py-3 text-xs font-black uppercase tracking-wider text-stone-500 text-center">Status</th>
                <th className="px-4 py-3 text-xs font-black uppercase tracking-wider text-stone-500 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {filteredRegistrations.map(reg => {
                const fam = !reg.isExternal ? families.find(f => 
                  f.id === reg.familyId || 
                  (reg.primaryMemberGmkId && (f.primaryMemberGmkId === reg.primaryMemberGmkId || f.id === `fam_${reg.primaryMemberGmkId}`)) || 
                  (reg.primaryMemberEmail && f.primaryMemberEmail?.toLowerCase() === reg.primaryMemberEmail.toLowerCase())
                ) : null;
                
                const displayName = reg.isExternal
                  ? (reg.primaryRegistrantName || (reg.participants && reg.participants[0]) || 'External Guest')
                  : (fam?.fullName || reg.primaryRegistrantName || (reg.participants && reg.participants[0]) || 'Resident Member');
                
                const ref = reg.isExternal 
                  ? (formatExternalGmkId(reg.publicReference) || reg.publicReference || reg.id) 
                  : (reg.primaryMemberGmkId || fam?.primaryMemberGmkId || reg.publicReference || reg.id);
                
                return (
                  <tr 
                    key={reg.id} 
                    className="hover:bg-stone-50 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="font-bold text-sm text-stone-800">{displayName}</div>
                      <div className="text-xs text-stone-500 font-mono mt-0.5">{ref}</div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded border ${
                        reg.isExternal 
                          ? 'bg-amber-50 text-amber-700 border-amber-200' 
                          : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      }`}>
                        {reg.isExternal ? 'External' : 'Resident'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-sm font-bold text-stone-700">{reg.totalParticipants || reg.participants?.length || 0}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded border ${
                        reg.paymentStatus === 'paid' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                        hasGenuineFinancialHistory(reg) ? 'bg-blue-50 text-blue-700 border-blue-200' :
                        'bg-stone-50 text-stone-600 border-stone-200'
                      }`}>
                        {reg.paymentStatus === 'paid' ? 'Paid' : (hasGenuineFinancialHistory(reg) ? reg.paymentStatus || 'Fin_Trail' : '—')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded border ${
                        reg.isOperationalCleanedUp ? 'bg-stone-100 text-stone-500 border-stone-300' :
                        (reg.workflowStatus === 'cancelled' || reg.paymentStatus === 'cancelled') ? 'bg-rose-50 text-rose-700 border-rose-200' :
                        'bg-stone-800 text-white border-stone-800'
                      }`}>
                        {reg.isOperationalCleanedUp ? 'Archived' : (reg.workflowStatus === 'cancelled' || reg.paymentStatus === 'cancelled') ? 'Cancelled' : 'Active'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => setSelectedReg(reg)} className="px-3 py-1.5 bg-white hover:bg-stone-100 text-[#0f4c2a] text-[10px] font-black uppercase tracking-wider rounded-lg border border-stone-200 shadow-sm transition-colors">
                        Open
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filteredRegistrations.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-stone-500 text-sm">
                    No registrations found matching the current criteria.
                  </td>
                </tr>
              )}
            </tbody>

          </table>
        </div>
      </div>
      {selectedReg && (
        <AdminRegistrationDetailsModal 
          registration={selectedReg} 
          activeEvent={activeEvent}
          events={events}
          families={families}
          familyMembers={familyMembers}
          onClose={() => setSelectedReg(null)} 
          onSuccess={(updated) => { 
            setSelectedReg(null); 
            setSuccessMsg("Registration updated."); 
          }} 
          onDeleted={(id) => {
            setSelectedReg(null);
            setSuccessMsg("Registration permanently deleted.");
          }}
          onCancelled={(updated) => {
            setSelectedReg(null);
            setSuccessMsg("Registration cancelled successfully.");
          }}
        />
      )}
    </div>
  );
}
