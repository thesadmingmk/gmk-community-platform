import React, { useState, useMemo } from 'react';
import { CommunityEvent, EventRegistration, Family, FamilyMember } from '../../types';
import { Mail, Send, RefreshCw, X, Clock, AlertTriangle, CheckCircle, UserCheck } from 'lucide-react';
import { getEntryPassEmailData, getRecipientEmail, dispatchSingleEntryPassEmail } from '../../utils/entryPassEmailHelper';
import { getRegistrationDisplayId, formatExternalGmkId, isExternalGmkId } from '../../utils/gmkIdHelper';

interface SingleModalProps {
  registration: EventRegistration;
  activeEvent: CommunityEvent;
  families: Family[];
  familyMembers: FamilyMember[];
  getParticipantDetailsFn?: (r: EventRegistration) => { adults: { name: string }[]; children: { name: string }[] };
  onClose: () => void;
  onSuccess: (message: string) => void;
  onError: (error: string) => void;
}

export function SingleEntryPassEmailModal({
  registration,
  activeEvent,
  families,
  familyMembers,
  getParticipantDetailsFn,
  onClose,
  onSuccess,
  onError
}: SingleModalProps) {
  const [isSending, setIsSending] = useState(false);
  const data = getEntryPassEmailData(registration, activeEvent, families, familyMembers, getParticipantDetailsFn);
  const isResend = Boolean(registration.entryPassEmailSentAt);

  const handleConfirmSend = async () => {
    setIsSending(true);
    try {
      await dispatchSingleEntryPassEmail(
        registration,
        activeEvent,
        families,
        familyMembers,
        getParticipantDetailsFn
      );
      onSuccess(`Official Entry Pass email queued successfully for ${data.recipientName} (${data.recipientEmail}).`);
      onClose();
    } catch (err: any) {
      console.error("Error sending Entry Pass email:", err);
      onError(err?.message || "Failed to enqueue Entry Pass email. Please try again.");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-fadeIn">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-stone-200 overflow-hidden">
        {/* Header */}
        <div className="bg-[#0f4c2a] px-5 py-4 text-white flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-white/10 rounded-xl">
              <Mail className="w-5 h-5 text-amber-300" />
            </div>
            <div>
              <h3 className="text-sm font-black uppercase tracking-wider">
                {isResend ? 'Resend Official Entry Pass Email' : 'Send Official Entry Pass Email'}
              </h3>
              <p className="text-[11px] text-emerald-100">{data.eventName}</p>
            </div>
          </div>
          <button 
            type="button" 
            onClick={onClose}
            className="text-emerald-100 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Recipient & Pass Summary */}
          <div className="p-4 bg-stone-50 rounded-xl border border-stone-200 space-y-2.5 text-xs">
            <div className="flex justify-between items-center border-b border-stone-200 pb-2">
              <span className="text-stone-500 font-bold uppercase text-[10px]">Recipient Name</span>
              <span className="font-black text-stone-900">{data.recipientName}</span>
            </div>
            <div className="flex justify-between items-center border-b border-stone-200 pb-2">
              <span className="text-stone-500 font-bold uppercase text-[10px]">Email Address</span>
              <span className="font-black font-mono text-stone-900">
                {data.recipientEmail || <span className="text-rose-600 font-bold">None</span>}
              </span>
            </div>
            <div className="flex justify-between items-center border-b border-stone-200 pb-2">
              <span className="text-stone-500 font-bold uppercase text-[10px]">GMK ID / Ref</span>
              <span className="font-black font-mono text-[#0f4c2a]">{data.displayGmkId}</span>
            </div>
            <div className="flex justify-between items-center border-b border-stone-200 pb-2">
              <span className="text-stone-500 font-bold uppercase text-[10px]">Official Entry Pass #</span>
              <span className="font-black font-mono text-stone-900">{data.entryPassNumber}</span>
            </div>
            <div className="flex justify-between items-center border-b border-stone-200 pb-2">
              <span className="text-stone-500 font-bold uppercase text-[10px]">Category</span>
              <span className="font-black text-stone-900">{data.category}</span>
            </div>
            <div className="flex justify-between items-center border-b border-stone-200 pb-2">
              <span className="text-stone-500 font-bold uppercase text-[10px]">Total Participants</span>
              <span className="font-black text-stone-900">{data.totalParticipants}</span>
            </div>
            <div>
              <span className="text-stone-500 font-bold uppercase text-[10px] block mb-1">Registered Participants</span>
              <span className="font-semibold text-stone-800 text-[11px] bg-white p-2 rounded-lg border border-stone-200 block">
                {data.registeredParticipants}
              </span>
            </div>
          </div>

          {/* Previous delivery notice */}
          {isResend && (
            <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 space-y-1">
              <p className="font-bold flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Previously sent Entry Pass email:</span>
              </p>
              <p className="font-mono text-[11px] text-amber-800 ml-5">
                {new Date(registration.entryPassEmailSentAt!).toLocaleString()}
                {registration.entryPassEmailRecipient ? ` to ${registration.entryPassEmailRecipient}` : ''}
              </p>
              <p className="text-[11px] text-amber-700 ml-5">
                Confirming will queue a fresh Entry Pass email with gate QR pass and complete event information.
              </p>
            </div>
          )}

          {!data.isValidEmail && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800">
              <div className="flex items-center space-x-2 font-bold">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>Cannot Send Email</span>
              </div>
              <p className="mt-1 text-[11px] text-rose-700">
                No valid email address is associated with this registration. Please update the attendee's profile or registration before sending.
              </p>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="bg-stone-50 px-5 py-3 border-t border-stone-200 flex justify-end items-center space-x-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSending}
            className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-stone-600 hover:text-stone-900 rounded-xl hover:bg-stone-200/60 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!data.isValidEmail || isSending}
            onClick={handleConfirmSend}
            className="px-5 py-2.5 bg-[#0f4c2a] hover:bg-[#0c3e22] disabled:opacity-50 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center space-x-2 shadow-sm cursor-pointer"
          >
            {isSending ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Queuing Email...</span>
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                <span>{isResend ? 'Confirm & Resend Email' : 'Confirm & Send Email'}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

interface BulkModalProps {
  selectedRegistrations: EventRegistration[];
  activeEvent: CommunityEvent;
  families: Family[];
  familyMembers: FamilyMember[];
  getParticipantDetailsFn?: (r: EventRegistration) => { adults: { name: string }[]; children: { name: string }[] };
  onClose: () => void;
  onFinished: (summary: string) => void;
}

export function BulkEntryPassEmailModal({
  selectedRegistrations,
  activeEvent,
  families,
  familyMembers,
  getParticipantDetailsFn,
  onClose,
  onFinished
}: BulkModalProps) {
  const [isSending, setIsSending] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: selectedRegistrations.length, success: 0, skipped: 0, failed: 0 });
  const [completedSummary, setCompletedSummary] = useState<string | null>(null);

  // Analyze each selected registration for preview & validation
  const analyzedList = useMemo(() => {
    return selectedRegistrations.map(reg => {
      const email = getRecipientEmail(reg, families);
      const hasValidEmail = Boolean(email && email.includes('@') && email.includes('.'));
      const isEligible = !['cancelled', 'refunded'].includes(reg.workflowStatus || '') &&
        ['paid', 'approved', 'waived', 'partially_paid', 'overpaid'].includes(reg.paymentStatus || 'pending') &&
        (reg as any).operationalStatus !== 'cleaned_up';

      const fam = families.find(f => f.id === reg.familyId);
      const name = fam?.fullName || reg.primaryRegistrantName || (reg.primaryMemberEmail ? reg.primaryMemberEmail.split('@')[0] : 'Attendee');
      const gmkId = getRegistrationDisplayId(reg) || reg.primaryMemberGmkId || formatExternalGmkId(reg.publicReference) || reg.publicReference || reg.id.slice(-6);
      const passNo = reg.entryPassNumber || `PASS-${activeEvent.id.slice(-6).toUpperCase()}-${gmkId}`;

      let status: 'ready' | 'missing_email' | 'ineligible' = 'ready';
      let reason = 'Ready to send';
      if (!isEligible) {
        status = 'ineligible';
        reason = `Ineligible: ${reg.paymentStatus || reg.workflowStatus || 'excluded'}`;
      } else if (!hasValidEmail) {
        status = 'missing_email';
        reason = 'No valid email address';
      }

      return {
        reg,
        name,
        gmkId,
        passNo,
        email: email || '',
        status,
        reason,
        alreadySent: Boolean(reg.entryPassEmailSentAt),
        sentAt: reg.entryPassEmailSentAt
      };
    });
  }, [selectedRegistrations, families, activeEvent.id]);

  const readyItems = analyzedList.filter(item => item.status === 'ready');
  const missingEmailItems = analyzedList.filter(item => item.status === 'missing_email');
  const ineligibleItems = analyzedList.filter(item => item.status === 'ineligible');
  const skippedIneligibleCount = missingEmailItems.length + ineligibleItems.length;

  const handleStartBulkSend = async () => {
    setIsSending(true);
    let success = 0;
    let skipped = 0;
    let failed = 0;

    for (let i = 0; i < selectedRegistrations.length; i++) {
      const reg = selectedRegistrations[i];
      const email = getRecipientEmail(reg, families);
      const hasValidEmail = Boolean(email && email.includes('@') && email.includes('.'));
      const isEligible = !['cancelled', 'refunded'].includes(reg.workflowStatus || '') &&
        ['paid', 'approved', 'waived', 'partially_paid', 'overpaid'].includes(reg.paymentStatus || 'pending') &&
        (reg as any).operationalStatus !== 'cleaned_up';

      if (!hasValidEmail || !isEligible) {
        skipped++;
        setProgress({ current: i + 1, total: selectedRegistrations.length, success, skipped, failed });
        continue;
      }

      try {
        await dispatchSingleEntryPassEmail(
          reg,
          activeEvent,
          families,
          familyMembers,
          getParticipantDetailsFn
        );
        success++;
      } catch (err) {
        console.error(`Bulk send failure for ${reg.id}:`, err);
        failed++;
      }

      setProgress({ current: i + 1, total: selectedRegistrations.length, success, skipped, failed });
      // Throttling delay between dispatches
      await new Promise(r => setTimeout(r, 120));
    }

    setIsSending(false);
    const summary = `Bulk dispatch completed: ${success} queued successfully` +
      (skipped > 0 ? `, ${skipped} skipped (missing email or ineligible)` : '') +
      (failed > 0 ? `, ${failed} failed` : '') + '.';
    setCompletedSummary(summary);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-fadeIn">
      <div className="bg-white w-full max-w-xl rounded-2xl shadow-2xl border border-stone-200 overflow-hidden">
        {/* Header */}
        <div className="bg-[#0f4c2a] px-5 py-4 text-white flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-white/10 rounded-xl">
              <Mail className="w-5 h-5 text-amber-300" />
            </div>
            <div>
              <h3 className="text-sm font-black uppercase tracking-wider">
                Bulk Send Official Entry Pass Emails
              </h3>
              <p className="text-[11px] text-emerald-100">{activeEvent.title}</p>
            </div>
          </div>
          {!isSending && (
            <button 
              type="button" 
              onClick={completedSummary ? () => onFinished(completedSummary) : onClose}
              className="text-emerald-100 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Confirmation / Preview Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-center">
            <div className="p-2.5 bg-stone-50 border border-stone-200 rounded-xl">
              <span className="text-[9px] uppercase font-bold text-stone-500 block">Total Selected</span>
              <span className="text-xl font-black text-stone-900">{selectedRegistrations.length}</span>
            </div>
            <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl">
              <span className="text-[9px] uppercase font-bold text-emerald-700 block">Ready to Send</span>
              <span className="text-xl font-black text-emerald-700">{readyItems.length}</span>
            </div>
            <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl">
              <span className="text-[9px] uppercase font-bold text-amber-700 block">Missing Email</span>
              <span className="text-xl font-black text-amber-700">{missingEmailItems.length}</span>
            </div>
            <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl">
              <span className="text-[9px] uppercase font-bold text-rose-700 block">Skipped / Ineligible</span>
              <span className="text-xl font-black text-rose-700">{skippedIneligibleCount}</span>
            </div>
          </div>

          {/* Recipient Emails Preview List */}
          {!completedSummary && !isSending && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-black text-stone-700 px-1">
                <span className="flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-[#0f4c2a]" />
                  <span>Recipient Emails Preview ({analyzedList.length})</span>
                </span>
                <span className="text-[10px] text-stone-500 font-medium">
                  {readyItems.length} will be dispatched
                </span>
              </div>
              <div className="border border-stone-200 rounded-xl max-h-52 overflow-y-auto divide-y divide-stone-100 bg-white">
                {analyzedList.map((item) => (
                  <div key={item.reg.id} className="p-2.5 flex items-center justify-between gap-3 text-xs hover:bg-stone-50 transition-colors">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center space-x-2">
                        <span className="font-extrabold text-stone-900 truncate">{item.name}</span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-stone-100 text-stone-600 font-bold shrink-0">{item.gmkId}</span>
                        <span className="text-[10px] font-mono text-stone-400 shrink-0">{item.passNo}</span>
                      </div>
                      <div className="text-[11px] text-stone-600 font-mono mt-0.5 truncate flex items-center gap-1">
                        {item.email ? (
                          <span>{item.email}</span>
                        ) : (
                          <span className="text-amber-700 font-semibold italic">No email address on file</span>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      {item.status === 'ready' ? (
                        item.alreadySent ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-black bg-blue-50 text-blue-700 border border-blue-200">
                            Ready (Resend)
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-black bg-emerald-50 text-emerald-700 border border-emerald-200">
                            Ready to Send
                          </span>
                        )
                      ) : item.status === 'missing_email' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-black bg-amber-50 text-amber-800 border border-amber-200">
                          Missing Email (Skip)
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-black bg-rose-50 text-rose-700 border border-rose-200">
                          Ineligible (Skip)
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {skippedIneligibleCount > 0 && !completedSummary && !isSending && (
            <p className="text-[11px] font-bold text-amber-800 bg-amber-50 p-2.5 rounded-lg border border-amber-200">
              Notice: {skippedIneligibleCount} selected attendee(s) have no valid email or are ineligible and will be skipped automatically.
            </p>
          )}

          {/* Progress bar during send */}
          {isSending && (
            <div className="space-y-2 p-4 bg-stone-50 rounded-xl border border-stone-200">
              <div className="flex justify-between text-xs font-black">
                <span>Dispatching Entry Pass Emails...</span>
                <span>{progress.current} / {progress.total}</span>
              </div>
              <div className="w-full bg-stone-200 h-2.5 rounded-full overflow-hidden">
                <div 
                  className="bg-[#0f4c2a] h-full transition-all duration-200"
                  style={{ width: `${(progress.current / Math.max(1, progress.total)) * 100}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] font-bold text-stone-500">
                <span className="text-emerald-700">Success: {progress.success}</span>
                <span className="text-amber-700">Skipped: {progress.skipped}</span>
                <span className="text-rose-700">Failed: {progress.failed}</span>
              </div>
            </div>
          )}

          {/* Complete Summary */}
          {completedSummary && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-center space-y-2 animate-fadeIn">
              <CheckCircle className="w-8 h-8 text-emerald-600 mx-auto" />
              <h4 className="text-xs font-black text-emerald-900 uppercase tracking-wider">
                Batch Complete
              </h4>
              <p className="text-xs font-bold text-emerald-800">{completedSummary}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-stone-50 px-5 py-3 border-t border-stone-200 flex justify-end items-center space-x-3">
          {completedSummary ? (
            <button
              type="button"
              onClick={() => onFinished(completedSummary)}
              className="px-5 py-2.5 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-sm cursor-pointer"
            >
              Done & Close
            </button>
          ) : !isSending ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-stone-600 hover:text-stone-900 rounded-xl hover:bg-stone-200/60 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={readyItems.length === 0}
                onClick={handleStartBulkSend}
                className="px-5 py-2.5 bg-[#0f4c2a] hover:bg-[#0c3e22] disabled:opacity-50 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center space-x-2 shadow-sm cursor-pointer"
              >
                <Send className="w-4 h-4" />
                <span>Send {readyItems.length} Entry Pass Emails</span>
              </button>
            </>
          ) : (
            <span className="text-xs font-bold text-stone-500 animate-pulse">Processing batch...</span>
          )}
        </div>
      </div>
    </div>
  );
}
