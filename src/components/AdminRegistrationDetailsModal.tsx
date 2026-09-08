import React, { useState, useMemo, useEffect } from 'react';
import { doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../context/AuthContext';
import { CommunityEvent, EventRegistration, Family, FamilyMember, EventRegistrationRefund, hasGenuineFinancialHistory, EventRegistrationParticipantDetail } from '../types';
import { calculateEventPricing } from '../utils/pricingEngine';
import { X, Save, RefreshCw, Trash2, XCircle, Users, CheckCircle2, AlertCircle, Plus, Minus } from 'lucide-react';
import { formatExternalGmkId } from '../utils/gmkIdHelper';
import { formatPhoneWithCountryCode } from '../utils/phoneValidation';
import { useLocalGEASConfirmation, GEASConfirmationDialogUI } from './gmk/GEASConfirmationDialog';
import { NotificationService } from '../services/NotificationService';

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
  
  const { confirm, isOpen, options, handleCancel, handleConfirm } = useLocalGEASConfirmation();
  
  const event = activeEvent || events.find(e => e.id === initialReg.eventId);
  const hasFin = hasGenuineFinancialHistory(initialReg);
  const isCancelled = (initialReg.workflowStatus as any) === 'cancelled' || initialReg.paymentStatus === 'cancelled';
  
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

          {/* Critical Actions Block */}
          {!isCancelled && (
            <div className="flex justify-between items-center bg-stone-50 border border-stone-200 rounded-xl p-4">
              <div className="text-sm font-bold text-stone-700">Registration Status: Active</div>
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
        </div>
      </div>
      {isOpen && options && (
        <GEASConfirmationDialogUI options={options} onCancel={handleCancel} onConfirm={handleConfirm} />
      )}
    </div>
  );
}
