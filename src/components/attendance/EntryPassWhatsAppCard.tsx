import React from 'react';
import { CommunityEvent, EventRegistration } from '../../types';
import { MessageSquare, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';

interface Props {
  registration: EventRegistration;
  activeEvent: CommunityEvent;
  onTriggerWhatsApp: (reg: EventRegistration) => void;
  isSending?: boolean;
}

export function EntryPassWhatsAppCard({
  registration,
  onTriggerWhatsApp,
  isSending = false
}: Props) {
  const recipientPhone = registration.entryPassWhatsAppRecipient || registration.primaryRegistrantWhatsapp || registration.primaryRegistrantPhone || '';
  const status = registration.entryPassWhatsAppLastStatus;
  const isSent = status === 'sent' || status === 'delivered' || status === 'read';
  const isFailed = status === 'failed';
  const isPending = status === 'pending';
  
  return (
    <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-xl mt-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start space-x-3">
          <div className="p-2 bg-emerald-100 rounded-lg text-emerald-800 mt-0.5">
            <MessageSquare className="w-4 h-4" />
          </div>
          <div>
            <span className="block text-[9px] uppercase font-black text-stone-500 tracking-wider">
              Official WhatsApp Entry Pass
            </span>
            <span className="block text-xs font-bold text-stone-900">
              {recipientPhone || <span className="text-rose-600 font-bold">No mobile number on file</span>}
            </span>
            {isSent ? (
              <span className="text-[10px] text-emerald-800 font-semibold flex items-center gap-1 mt-0.5">
                <CheckCircle className="w-3 h-3 text-emerald-600 shrink-0" />
                <span>
                  Sent on {registration.entryPassWhatsAppSentAt ? new Date(registration.entryPassWhatsAppSentAt).toLocaleDateString() : 'N/A'} at {registration.entryPassWhatsAppSentAt ? new Date(registration.entryPassWhatsAppSentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A'}
                </span>
              </span>
            ) : isFailed ? (
              <span className="text-[10px] text-rose-700 font-semibold flex items-center gap-1 mt-0.5">
                <AlertCircle className="w-3 h-3 text-rose-600 shrink-0" />
                <span>Failed: {registration.entryPassWhatsAppLastError || 'Unknown error'}</span>
              </span>
            ) : isPending ? (
              <span className="text-[10px] text-amber-700 font-semibold flex items-center gap-1 mt-0.5">
                <RefreshCw className="w-3 h-3 text-amber-600 shrink-0 animate-spin" />
                <span>Delivery Pending...</span>
              </span>
            ) : (
              <span className="text-[10px] text-stone-600 font-semibold flex items-center gap-1 mt-0.5">
                <AlertCircle className="w-3 h-3 text-stone-400 shrink-0" />
                <span>WhatsApp Entry Pass not yet sent</span>
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          disabled={!recipientPhone || isSending || isPending}
          onClick={(e) => {
            e.stopPropagation();
            onTriggerWhatsApp(registration);
          }}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer shadow-xs shrink-0"
        >
          {isSending || isPending ? (
            <>
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>Sending...</span>
            </>
          ) : (
            <>
              <MessageSquare className="w-3.5 h-3.5" />
              <span>{isSent || isFailed ? 'Resend WhatsApp' : 'Send WhatsApp'}</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
