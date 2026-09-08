import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { Download, Copy, Check, Sparkles, ShieldCheck } from 'lucide-react';
import GMKLogo from '../gmk/GMKLogo';
import { downloadEntryPassImage } from '../../utils/entryPassImageGenerator';

export interface GMKOfficialEntryPassCardProps {
  entryPassNumber: string;
  eventName: string;
  eventDate?: string;
  eventVenue?: string;
  registrantName?: string;
  totalAttendees?: number;
  gmkId?: string;
  referenceId?: string;
  unitNumber?: string;
  isExternal?: boolean;
  className?: string;
  showActions?: boolean;
  id?: string;
}

/**
 * GMKOfficialEntryPassCard
 * 
 * The unified, reusable Official GMK Entry Pass visual card for:
 * 1. GMK Residents
 * 2. External Registrants / Guests
 * 
 * STRICT COMPLIANCE:
 * - QR payload is EXACTLY `entryPassNumber`.
 * - Zero financial details (no OMR, no balance, no payment remarks).
 * - Official GMK logo with green rounded-square & 3 gold sparkles.
 * - Dynamic event name and metadata.
 */
export const GMKOfficialEntryPassCard: React.FC<GMKOfficialEntryPassCardProps> = ({
  entryPassNumber,
  eventName,
  eventDate,
  eventVenue,
  registrantName,
  totalAttendees,
  gmkId,
  referenceId,
  unitNumber,
  isExternal = false,
  className = '',
  showActions = true,
  id = 'gmk-official-entry-pass-card'
}) => {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const [isDownloading, setIsDownloading] = useState<boolean>(false);

  // Generate QR Code dynamically from the exact entryPassNumber
  useEffect(() => {
    let isMounted = true;
    if (entryPassNumber) {
      QRCode.toDataURL(entryPassNumber, {
        margin: 4,
        width: 280,
        errorCorrectionLevel: 'H',
        color: {
          dark: '#000000', // Pure black for maximum iOS camera contrast
          light: '#ffffff'
        }
      })
        .then((url) => {
          if (isMounted) setQrDataUrl(url);
        })
        .catch((err) => {
          console.error('Failed to generate QR Code:', err);
        });
    }
    return () => {
      isMounted = false;
    };
  }, [entryPassNumber]);

  const handleCopyPassNumber = () => {
    if (!entryPassNumber) return;
    navigator.clipboard.writeText(entryPassNumber);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = async () => {
    try {
      setIsDownloading(true);
      await downloadEntryPassImage({
        entryPassNumber,
        eventName,
        eventDate,
        eventVenue,
        registrantName,
        totalAttendees,
        gmkId,
        referenceId
      });
    } catch (err) {
      console.error('Download failed:', err);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div 
      id={id}
      className={`w-full max-w-sm mx-auto bg-white rounded-3xl border border-stone-200 shadow-xl overflow-hidden text-center transition-all ${className}`}
    >
      {/* ========================================================
          TOP: GMK Logo & Community Identity
          ======================================================== */}
      <div 
        id="entry-pass-header"
        className="bg-gradient-to-r from-[#0f4c2a] via-[#125831] to-[#0f4c2a] px-6 py-5 text-white relative border-b-2 border-[#d4af37]"
      >
        <div className="flex items-center justify-center space-x-3.5">
          <GMKLogo size={52} className="shadow-md" id="entry-pass-gmk-logo" />
          <div className="text-left">
            <h2 className="text-sm font-extrabold tracking-tight uppercase font-heading leading-tight">
              Greens Malayalee Kootayama
            </h2>
            <div className="flex items-center space-x-1.5 mt-0.5">
              <Sparkles className="w-3 h-3 text-[#d4af37]" />
              <span className="text-[10px] text-[#f0d375] font-bold tracking-wider font-mono uppercase">
                Al Hail Greens Community
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================
          MIDDLE: Event Name, Official Pass Badge, QR Code, Pass Number
          ======================================================== */}
      <div className="p-6 space-y-4">
        {/* Dynamic Event Name */}
        <div id="entry-pass-event-info">
          <span className="inline-flex items-center space-x-1 px-3 py-1 bg-amber-50 border border-amber-200/60 rounded-full text-[11px] font-bold text-amber-900 mb-2">
            <ShieldCheck className="w-3.5 h-3.5 text-[#0f4c2a]" />
            <span>OFFICIAL ENTRY PASS</span>
          </span>
          <h3 className="text-xl font-black text-[#0f4c2a] tracking-tight leading-snug">
            {eventName || 'Community Gathering'}
          </h3>
          {eventDate && (
            <p className="text-xs text-stone-500 font-medium mt-1">
              {eventDate} {eventVenue ? `• ${eventVenue}` : ''}
            </p>
          )}
        </div>

        {/* Crisp QR Code Container (Payload = entryPassNumber) */}
        <div 
          id="entry-pass-qr-container"
          className="relative mx-auto w-56 h-56 p-3 bg-white rounded-2xl border-2 border-stone-200/80 shadow-sm flex items-center justify-center"
        >
          {qrDataUrl ? (
            <img 
              id="entry-pass-qr-image"
              src={qrDataUrl} 
              alt={`QR Code for ${entryPassNumber}`} 
              className="w-full h-full object-contain rounded-xl"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center space-y-2 text-stone-400">
              <div className="w-8 h-8 border-2 border-[#0f4c2a] border-t-transparent rounded-full animate-spin"></div>
              <span className="text-xs font-mono">Generating Pass QR...</span>
            </div>
          )}
        </div>

        {/* Monospace Entry Pass Number */}
        <div 
          id="entry-pass-number-section"
          className="bg-stone-50 border border-stone-200 rounded-xl py-2.5 px-4 inline-block w-full"
        >
          <span className="text-[10px] text-stone-400 font-bold uppercase tracking-wider block font-mono">
            Entry Pass Number
          </span>
          <div className="flex items-center justify-center space-x-2 mt-0.5">
            <span className="text-base font-black text-stone-900 font-mono tracking-wider">
              {entryPassNumber}
            </span>
            <button
              type="button"
              onClick={handleCopyPassNumber}
              className="p-1 hover:bg-stone-200 rounded text-stone-500 hover:text-stone-800 transition-colors"
              title="Copy Pass Number"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Optional Registrant & Attendee Details (NO financial data) */}
        {(registrantName || totalAttendees || gmkId || unitNumber) && (
          <div 
            id="entry-pass-attendee-details"
            className="text-xs text-stone-600 space-y-1 pt-1 border-t border-stone-100"
          >
            {registrantName && (
              <div className="flex justify-between items-center px-1">
                <span className="text-stone-400 font-medium">Registrant</span>
                <span className="font-bold text-stone-800">{registrantName}</span>
              </div>
            )}
            {totalAttendees !== undefined && (
              <div className="flex justify-between items-center px-1">
                <span className="text-stone-400 font-medium">Admission</span>
                <span className="font-bold text-[#0f4c2a]">
                  Admit {totalAttendees} {totalAttendees === 1 ? 'Person' : 'Persons'}
                </span>
              </div>
            )}
            {(gmkId || referenceId) && (
              <div className="flex justify-between items-center px-1">
                <span className="text-stone-400 font-medium">{isExternal ? 'Reference ID' : 'GMK ID'}</span>
                <span className="font-bold text-stone-800 font-mono">{referenceId || gmkId}</span>
              </div>
            )}
            <div className="flex justify-between items-center px-1 text-[11px] text-stone-400">
              <span>Type</span>
              <span className="font-medium text-stone-600">
                {isExternal ? 'External Guest' : `Resident ${unitNumber ? `(Unit ${unitNumber})` : ''}`}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ========================================================
          BOTTOM: Community Identity & Gate Instructions
          ======================================================== */}
      <div 
        id="entry-pass-footer"
        className="bg-stone-50 px-6 py-3.5 border-t border-stone-100 text-[11px] text-stone-500"
      >
        <p className="font-semibold text-stone-700">
          Present this QR Code or Entry Pass at the entrance gate.
        </p>
        <p className="text-[10px] text-stone-400 mt-0.5 font-mono">
          Greens Malayalee Kootayama Micro ERP
        </p>

        {/* Download Action */}
        {showActions && (
          <div className="mt-3 pt-2.5 border-t border-stone-200/60 flex items-center justify-center space-x-2">
            <button
              type="button"
              onClick={handleDownload}
              disabled={isDownloading}
              className="inline-flex items-center space-x-1.5 px-4 py-2 bg-[#0f4c2a] hover:bg-[#125831] active:bg-[#09351c] text-white text-xs font-bold rounded-xl shadow-sm transition-all disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{isDownloading ? 'Generating...' : 'Download Pass (PNG)'}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default GMKOfficialEntryPassCard;
