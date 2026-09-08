import React from 'react';
import { CommunityEvent, EventRegistration, Family } from '../../types';
import { Mail, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';
import { getRecipientEmail } from '../../utils/entryPassEmailHelper';

interface Props {
  registration: EventRegistration;
  activeEvent: CommunityEvent;
  families: Family[];
  onTriggerEmail: (reg: EventRegistration) => void;
  isSending?: boolean;
}

export function EntryPassEmailCard({
  registration,
  activeEvent,
  families,
  onTriggerEmail,
  isSending = false
}: Props) {
  const recipientEmail = getRecipientEmail(registration, families);
  const isSent = Boolean(registration.entryPassEmailSentAt);

  return (
    <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start space-x-3">
          <div className="p-2 bg-emerald-100 rounded-lg text-[#0f4c2a] mt-0.5">
            <Mail className="w-4 h-4" />
          </div>
          <div>
            <span className="block text-[9px] uppercase font-black text-stone-500 tracking-wider">
              Official Entry Pass & QR Email
            </span>
            <span className="block text-xs font-bold text-stone-900">
              {recipientEmail || <span className="text-rose-600 font-bold">No email on file</span>}
            </span>
            {isSent ? (
              <span className="text-[10px] text-emerald-800 font-semibold flex items-center gap-1 mt-0.5">
                <CheckCircle className="w-3 h-3 text-emerald-600 shrink-0" />
                <span>
                  Sent on {new Date(registration.entryPassEmailSentAt!).toLocaleDateString()} at {new Date(registration.entryPassEmailSentAt!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  {registration.entryPassEmailSendCount && registration.entryPassEmailSendCount > 1 
                    ? ` (Dispatched ${registration.entryPassEmailSendCount} times)` 
                    : ''}
                </span>
              </span>
            ) : (
              <span className="text-[10px] text-amber-700 font-semibold flex items-center gap-1 mt-0.5">
                <AlertCircle className="w-3 h-3 text-amber-600 shrink-0" />
                <span>Entry Pass email not yet sent</span>
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          disabled={!recipientEmail || isSending}
          onClick={(e) => {
            e.stopPropagation();
            onTriggerEmail(registration);
          }}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-[#0f4c2a] hover:bg-[#0c3e22] disabled:opacity-50 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer shadow-xs shrink-0"
        >
          {isSending ? (
            <>
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>Sending...</span>
            </>
          ) : (
            <>
              <Mail className="w-3.5 h-3.5" />
              <span>{isSent ? 'Resend Entry Pass Email' : 'Send Entry Pass Email'}</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
