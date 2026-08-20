import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, getDocs } from 'firebase/firestore';
import { db } from '../../context/AuthContext';
import { CommunityEvent, ResidentProfile, EventRegistration } from '../../types';
import { RefreshCw, Search, Calendar as CalendarIcon, Download, FileSpreadsheet, Users, CheckCircle2, Clock, XCircle, ShieldCheck } from 'lucide-react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatPhoneWithCountryCode } from '../../utils/phoneValidation';

type FilterState = 'ALL' | 'REGISTERED_PAID' | 'REGISTERED_NOT_PAID' | 'NOT_REGISTERED';

export interface AttendanceReportRow {
  resident: ResidentProfile;
  registration?: EventRegistration;
  status: 'REGISTERED — PAID' | 'REGISTERED — NOT PAID' | 'NOT REGISTERED';
  participantsDisplay: string | number;
  participantsCount: number;
  regReference: string;
  regDate: string;
  paymentStatusDisplay: string;
}

export default function AttendanceReport({ initialEventId }: { initialEventId?: string }) {
  const [events, setEvents] = useState<CommunityEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>(initialEventId || '');
  const [residents, setResidents] = useState<ResidentProfile[]>([]);
  const [allRegistrations, setAllRegistrations] = useState<EventRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterState>('ALL');
  const [searchTerm, setSearchTerm] = useState('');

  // Initial load
  useEffect(() => {
    fetchBaseData();
  }, []);

  // Update selection if initialEventId changes
  useEffect(() => {
    if (initialEventId && events.length > 0) {
      setSelectedEventId(initialEventId);
    }
  }, [initialEventId, events]);

  const fetchBaseData = async () => {
    setLoading(true);
    try {
      // 1. Fetch Events, Active Residents, and Event Registrations in parallel
      const [eventsSnap, residentsSnap, regsSnap] = await Promise.all([
        getDocs(query(collection(db, 'events'))),
        getDocs(query(collection(db, 'residents'))),
        getDocs(query(collection(db, 'event_registrations')))
      ]);

      const eventsData = eventsSnap.docs
        .map(d => ({ id: d.id, ...d.data() } as CommunityEvent))
        .filter(e => e.status !== 'archived')
        .sort((a, b) => new Date(b.date || b.createdAt || 0).getTime() - new Date(a.date || a.createdAt || 0).getTime());

      // Canonical active primary residents (families)
      const residentsData = residentsSnap.docs
        .map(d => ({ ...d.data() } as ResidentProfile))
        .filter(r => r.status === 'active')
        .sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''));

      const regsData = regsSnap.docs.map(d => ({ id: d.id, ...d.data() } as EventRegistration));

      setEvents(eventsData);
      setResidents(residentsData);
      setAllRegistrations(regsData);

      if (eventsData.length > 0) {
        if (initialEventId && eventsData.some(e => e.id === initialEventId)) {
          setSelectedEventId(initialEventId);
        } else if (!selectedEventId) {
          setSelectedEventId(eventsData[0].id);
        }
      }
    } catch (error) {
      console.error("Error fetching Attendance / Registration Status Report base data:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleManualRefresh = () => {
    setRefreshing(true);
    fetchBaseData();
  };

  const currentEvent = useMemo(() => {
    return events.find(e => e.id === selectedEventId) || null;
  }, [events, selectedEventId]);

  // Registrations matching the selected event
  const currentEventRegistrations = useMemo(() => {
    if (!currentEvent) return [];
    
    return allRegistrations.filter(r => {
      // Ignore cancelled registrations
      if (r.paymentStatus === 'cancelled') return false;

      const rEventId = r.eventId || '';
      return (
        rEventId === currentEvent.id ||
        (currentEvent.eventId && rEventId === currentEvent.eventId) ||
        (currentEvent.eventCode && rEventId === currentEvent.eventCode) ||
        r.id.endsWith(`_${currentEvent.id}`) ||
        (currentEvent.eventId && r.id.endsWith(`_${currentEvent.eventId}`)) ||
        (currentEvent.eventCode && r.id.endsWith(`_${currentEvent.eventCode}`))
      );
    });
  }, [allRegistrations, currentEvent]);

  // Compute family-level report rows
  const reportRows: AttendanceReportRow[] = useMemo(() => {
    if (!currentEvent) return [];

    return residents.map(resident => {
      const resGmk = (resident.gmkId || '').toUpperCase().trim();
      const resEmail = (resident.email || '').toLowerCase().trim();
      const resUnitKey = (resident.unitKey || '').toUpperCase().trim();

      // Find registration for this primary resident / family
      const matchingReg = currentEventRegistrations.find(r => {
        const rGmk = (r.primaryMemberGmkId || '').toUpperCase().trim();
        if (rGmk && resGmk && rGmk === resGmk) return true;

        const rEmail = (r.primaryMemberEmail || '').toLowerCase().trim();
        if (rEmail && resEmail && rEmail === resEmail) return true;

        const rFam = (r.familyId || '').toUpperCase().trim();
        if (rFam && resGmk && (rFam === resGmk || rFam === `FAM_${resGmk}` || (resUnitKey && rFam === resUnitKey))) return true;

        if (r.id && resGmk && (r.id.toUpperCase().includes(`_${resGmk}_`) || r.id.toUpperCase().startsWith(`REG_${resGmk}_`))) return true;

        return false;
      });

      if (!matchingReg) {
        return {
          resident,
          registration: undefined,
          status: 'NOT REGISTERED',
          participantsDisplay: '-',
          participantsCount: 0,
          regReference: '-',
          regDate: '-',
          paymentStatusDisplay: '-'
        };
      }

      // Determine payment status according to existing GMK Finance workflow
      const pStatus = (matchingReg.paymentStatus || 'pending').toLowerCase();
      const isPaid = (
        pStatus === 'paid' || 
        pStatus === 'approved' || 
        pStatus === 'waived' || 
        pStatus === 'overpaid' ||
        (matchingReg.amountReceived !== undefined && matchingReg.amountDue !== undefined && matchingReg.amountDue > 0 && matchingReg.amountReceived >= matchingReg.amountDue)
      );

      const status: 'REGISTERED — PAID' | 'REGISTERED — NOT PAID' = isPaid ? 'REGISTERED — PAID' : 'REGISTERED — NOT PAID';

      // Participants count
      const pCount = matchingReg.totalParticipants || (Array.isArray(matchingReg.participants) ? matchingReg.participants.length : 0) || 1;

      // Registration Reference
      const ref = matchingReg.entryPassNumber || matchingReg.receiptNumber || (matchingReg.id ? (matchingReg.id.length > 12 ? matchingReg.id.slice(-8).toUpperCase() : matchingReg.id) : '-');

      // Registration Date
      let dateDisplay = '-';
      const rawDate = matchingReg.createdAt || (matchingReg as any).registeredAt || matchingReg.updatedAt;
      if (rawDate) {
        try {
          const d = new Date(rawDate);
          if (!isNaN(d.getTime())) {
            dateDisplay = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
          }
        } catch {
          dateDisplay = '-';
        }
      }

      // Payment Status text
      const payDisplay = pStatus ? pStatus.toUpperCase().replace(/_/g, ' ') : 'PENDING';

      return {
        resident,
        registration: matchingReg,
        status,
        participantsDisplay: pCount,
        participantsCount: pCount,
        regReference: ref,
        regDate: dateDisplay,
        paymentStatusDisplay: payDisplay
      };
    });
  }, [residents, currentEvent, currentEventRegistrations]);

  // Accurate Summary Reconciliation
  const summary = useMemo(() => {
    const totalActiveFamilies = reportRows.length;
    const registeredPaid = reportRows.filter(r => r.status === 'REGISTERED — PAID');
    const registeredNotPaid = reportRows.filter(r => r.status === 'REGISTERED — NOT PAID');
    const notRegistered = reportRows.filter(r => r.status === 'NOT REGISTERED');

    const totalRegisteredParticipants = reportRows.reduce((acc, row) => acc + row.participantsCount, 0);

    return {
      totalActiveFamilies,
      registeredPaidCount: registeredPaid.length,
      registeredNotPaidCount: registeredNotPaid.length,
      notRegisteredCount: notRegistered.length,
      totalRegisteredFamilies: registeredPaid.length + registeredNotPaid.length,
      totalRegisteredParticipants
    };
  }, [reportRows]);

  // Filter & Search
  const filteredRows = useMemo(() => {
    return reportRows.filter(row => {
      // 1. Status Filter
      if (filter === 'REGISTERED_PAID' && row.status !== 'REGISTERED — PAID') return false;
      if (filter === 'REGISTERED_NOT_PAID' && row.status !== 'REGISTERED — NOT PAID') return false;
      if (filter === 'NOT_REGISTERED' && row.status !== 'NOT REGISTERED') return false;

      // 2. Search Filter (Full Name, GMK ID, Unit)
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase().trim();
        const nameMatch = (row.resident.fullName || '').toLowerCase().includes(term);
        const gmkMatch = (row.resident.gmkId || '').toLowerCase().includes(term);
        const unitMatch = (row.resident.displayUnitNumber || row.resident.unitKey || '').toLowerCase().includes(term);
        const phoneMatch = (row.resident.phone || '').includes(term);
        if (!nameMatch && !gmkMatch && !unitMatch && !phoneMatch) return false;
      }

      return true;
    });
  }, [reportRows, filter, searchTerm]);

  // PDF Export
  const exportPDF = () => {
    if (!currentEvent) return;

    const doc = new jsPDF('landscape');
    const eventTitle = currentEvent.title || currentEvent.displayName || 'Event';
    const eventCode = currentEvent.eventCode || currentEvent.eventId || currentEvent.id;

    // Header
    doc.setFontSize(16);
    doc.setTextColor(15, 76, 42); // #0f4c2a
    doc.text(`GMK EVENT REGISTRATION STATUS REPORT`, 14, 15);

    doc.setFontSize(10);
    doc.setTextColor(60, 60, 60);
    doc.text(`Event: ${eventCode} — ${eventTitle}  |  Generated: ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}  |  Filter: ${filter.replace(/_/g, ' ')}`, 14, 22);

    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.text(`Summary: Total Active Families: ${summary.totalActiveFamilies} | Reg & Paid: ${summary.registeredPaidCount} | Reg & Not Paid: ${summary.registeredNotPaidCount} | Not Registered: ${summary.notRegisteredCount} | Total Reg Participants: ${summary.totalRegisteredParticipants}`, 14, 27);

    const tableData = filteredRows.map((row, index) => [
      (index + 1).toString(),
      `${row.resident.salutation ? row.resident.salutation + ' ' : ''}${row.resident.fullName}`,
      row.resident.gmkId,
      formatPhoneWithCountryCode(row.resident.phone),
      row.resident.displayUnitNumber || row.resident.unitKey || 'N/A',
      row.status,
      row.participantsDisplay.toString(),
      row.regReference,
      row.regDate,
      row.paymentStatusDisplay
    ]);

    autoTable(doc, {
      startY: 31,
      head: [['#', 'Full Name', 'GMK ID', 'Mobile Number', 'Unit', 'Status', 'Participants', 'Reg Ref', 'Reg Date', 'Payment Status']],
      body: tableData,
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [15, 76, 42], textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 248] },
      columnStyles: {
        0: { cellWidth: 10, halign: 'center' },
        1: { cellWidth: 42 },
        2: { cellWidth: 24, fontStyle: 'bold' },
        3: { cellWidth: 26 },
        4: { cellWidth: 20 },
        5: { cellWidth: 38, fontStyle: 'bold' },
        6: { cellWidth: 20, halign: 'center' },
        7: { cellWidth: 24 },
        8: { cellWidth: 24 },
        9: { cellWidth: 30 }
      }
    });

    const safeTitle = eventTitle.replace(/[^a-zA-Z0-9]/g, '_');
    const dateStr = new Date().toISOString().slice(0, 10);
    doc.save(`GMK_Reg_Status_Report_${safeTitle}_${filter}_${dateStr}.pdf`);
  };

  // Excel Export
  const exportExcel = () => {
    if (!currentEvent) return;

    const eventTitle = currentEvent.title || currentEvent.displayName || 'Event';
    const exportData = filteredRows.map((row, index) => ({
      'Sl. No.': index + 1,
      'Full Name': `${row.resident.salutation ? row.resident.salutation + ' ' : ''}${row.resident.fullName}`,
      'GMK ID': row.resident.gmkId,
      'Mobile Number': formatPhoneWithCountryCode(row.resident.phone),
      'Unit Number': row.resident.displayUnitNumber || row.resident.unitKey || 'N/A',
      'Status': row.status,
      'Participants': row.participantsDisplay,
      'Registration Reference': row.regReference,
      'Registration Date': row.regDate,
      'Payment Status': row.paymentStatusDisplay
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Registration Status");
    const safeTitle = eventTitle.replace(/[^a-zA-Z0-9]/g, '_');
    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `GMK_Reg_Status_Report_${safeTitle}_${filter}_${dateStr}.xlsx`);
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header and Controls */}
      <div className="bg-white border border-stone-250 p-6 rounded-3xl space-y-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-stone-200 pb-4">
          <div>
            <h2 className="text-xl font-extrabold text-[#0f4c2a] font-heading flex items-center gap-2">
              <CalendarIcon className="w-5 h-5 text-[#d4af37]" />
              Attendance / Event Registration Status Report
            </h2>
            <p className="text-xs text-stone-600 font-semibold mt-1">
              Authoritative, read-only population status report tracking active GMK families against event registrations and Finance approvals.
            </p>
          </div>
          
          <div className="flex items-center gap-2 w-full md:w-auto">
            <div className="w-full md:w-80">
              <label className="text-[9px] uppercase font-black text-stone-500 tracking-wider block mb-1">
                Select Community Event
              </label>
              <select
                value={selectedEventId}
                onChange={e => setSelectedEventId(e.target.value)}
                className="w-full px-4 py-2 border border-stone-250 rounded-xl bg-stone-50 text-stone-900 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-[#0f4c2a]"
                disabled={loading}
              >
                {events.length === 0 && <option value="">No active events found</option>}
                {events.map(e => (
                  <option key={e.id} value={e.id}>
                    {e.eventCode || e.eventId || e.id} — {e.title || e.displayName}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={handleManualRefresh}
              disabled={loading || refreshing}
              className="mt-4 p-2 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-xl border border-stone-250 transition-colors"
              title="Refresh Report Data"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-[#0f4c2a]' : ''}`} />
            </button>
          </div>
        </div>

        {/* Reconciled Summary HUD */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {/* 1. Total Active GMK Families */}
          <div className="p-3.5 bg-stone-50 border border-stone-200 rounded-2xl text-center shadow-2xs">
            <div className="text-[9px] uppercase font-black text-stone-500 tracking-wider flex items-center justify-center gap-1">
              <Users className="w-3 h-3 text-stone-400" />
              <span>Total Active GMK</span>
            </div>
            <div className="text-xl font-black text-stone-900 mt-1">{summary.totalActiveFamilies}</div>
            <div className="text-[9px] font-bold text-stone-400 mt-0.5">Families</div>
          </div>

          {/* 2. Registered — Paid */}
          <div className="p-3.5 bg-emerald-50/80 border border-emerald-200 rounded-2xl text-center shadow-2xs">
            <div className="text-[9px] uppercase font-black text-emerald-700 tracking-wider flex items-center justify-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
              <span>Registered — Paid</span>
            </div>
            <div className="text-xl font-black text-emerald-900 mt-1">{summary.registeredPaidCount}</div>
            <div className="text-[9px] font-bold text-emerald-600 mt-0.5">Approved by Finance</div>
          </div>

          {/* 3. Registered — Not Paid */}
          <div className="p-3.5 bg-amber-50/80 border border-amber-200 rounded-2xl text-center shadow-2xs">
            <div className="text-[9px] uppercase font-black text-amber-700 tracking-wider flex items-center justify-center gap-1">
              <Clock className="w-3 h-3 text-amber-600" />
              <span>Registered — Not Paid</span>
            </div>
            <div className="text-xl font-black text-amber-900 mt-1">{summary.registeredNotPaidCount}</div>
            <div className="text-[9px] font-bold text-amber-600 mt-0.5">Payment Pending</div>
          </div>

          {/* 4. Not Registered */}
          <div className="p-3.5 bg-rose-50/80 border border-rose-200 rounded-2xl text-center shadow-2xs">
            <div className="text-[9px] uppercase font-black text-rose-700 tracking-wider flex items-center justify-center gap-1">
              <XCircle className="w-3 h-3 text-rose-600" />
              <span>Not Registered</span>
            </div>
            <div className="text-xl font-black text-rose-900 mt-1">{summary.notRegisteredCount}</div>
            <div className="text-[9px] font-bold text-rose-600 mt-0.5">No RSVP</div>
          </div>

          {/* 5. Total Registered Participants */}
          <div className="p-3.5 bg-blue-50/80 border border-blue-200 rounded-2xl text-center shadow-2xs col-span-2 sm:col-span-1">
            <div className="text-[9px] uppercase font-black text-blue-700 tracking-wider flex items-center justify-center gap-1">
              <ShieldCheck className="w-3 h-3 text-blue-600" />
              <span>Total Participants</span>
            </div>
            <div className="text-xl font-black text-blue-900 mt-1">{summary.totalRegisteredParticipants}</div>
            <div className="text-[9px] font-bold text-blue-600 mt-0.5">Across {summary.totalRegisteredFamilies} Regs</div>
          </div>
        </div>

        {/* Filters and Search Bar */}
        <div className="flex flex-col lg:flex-row gap-4 items-stretch lg:items-center justify-between">
          {/* Status Filter Buttons */}
          <div className="flex bg-stone-100 p-1 rounded-2xl w-full lg:w-auto overflow-x-auto hide-scrollbar gap-1">
            <button
              onClick={() => setFilter('ALL')}
              className={`px-3.5 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider whitespace-nowrap transition-all cursor-pointer ${
                filter === 'ALL'
                  ? 'bg-white shadow-xs text-stone-900'
                  : 'text-stone-500 hover:text-stone-800'
              }`}
            >
              All ({summary.totalActiveFamilies})
            </button>
            <button
              onClick={() => setFilter('REGISTERED_PAID')}
              className={`px-3.5 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider whitespace-nowrap transition-all cursor-pointer ${
                filter === 'REGISTERED_PAID'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-stone-500 hover:text-emerald-700'
              }`}
            >
              Registered — Paid ({summary.registeredPaidCount})
            </button>
            <button
              onClick={() => setFilter('REGISTERED_NOT_PAID')}
              className={`px-3.5 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider whitespace-nowrap transition-all cursor-pointer ${
                filter === 'REGISTERED_NOT_PAID'
                  ? 'bg-amber-500 text-white shadow-xs'
                  : 'text-stone-500 hover:text-amber-700'
              }`}
            >
              Registered — Not Paid ({summary.registeredNotPaidCount})
            </button>
            <button
              onClick={() => setFilter('NOT_REGISTERED')}
              className={`px-3.5 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider whitespace-nowrap transition-all cursor-pointer ${
                filter === 'NOT_REGISTERED'
                  ? 'bg-rose-600 text-white shadow-xs'
                  : 'text-stone-500 hover:text-rose-700'
              }`}
            >
              Not Registered ({summary.notRegisteredCount})
            </button>
          </div>

          {/* Search and Exports */}
          <div className="flex items-center gap-2 w-full lg:w-auto">
            <div className="relative flex-1 lg:w-72">
              <Search className="w-4 h-4 text-stone-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Search Name, GMK ID, Unit..."
                className="w-full pl-9 pr-3 py-2 bg-stone-50 border border-stone-250 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#0f4c2a]"
              />
            </div>
            <div className="flex gap-1 shrink-0">
              <button
                onClick={exportPDF}
                disabled={loading || filteredRows.length === 0}
                className="px-3 py-2 bg-red-50 hover:bg-red-100 text-red-700 rounded-xl border border-red-200 text-xs font-extrabold transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                title="Export PDF"
              >
                <Download className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">PDF</span>
              </button>
              <button
                onClick={exportExcel}
                disabled={loading || filteredRows.length === 0}
                className="px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-[#0f4c2a] rounded-xl border border-emerald-200 text-xs font-extrabold transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                title="Export Excel"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Excel</span>
              </button>
            </div>
          </div>
        </div>

        {/* Data Table */}
        {loading ? (
          <div className="py-14 text-center border border-stone-200 rounded-2xl bg-stone-50/50">
            <RefreshCw className="w-6 h-6 text-[#0f4c2a] animate-spin mx-auto opacity-75" />
            <p className="text-xs font-bold text-stone-600 mt-2">Compiling authoritative registration status report...</p>
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="py-14 text-center border border-stone-200 rounded-2xl bg-stone-50/50">
            <p className="text-xs font-bold text-stone-500">No GMK resident records match the current filter and search criteria.</p>
          </div>
        ) : (
          <div className="border border-stone-250 rounded-2xl overflow-hidden bg-white shadow-2xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-stone-50 border-b border-stone-200">
                  <tr>
                    <th className="px-3 py-3 text-[10px] font-black uppercase text-stone-600 tracking-wider text-center w-12">#</th>
                    <th className="px-4 py-3 text-[10px] font-black uppercase text-stone-600 tracking-wider">Full Name</th>
                    <th className="px-4 py-3 text-[10px] font-black uppercase text-stone-600 tracking-wider">GMK ID</th>
                    <th className="px-4 py-3 text-[10px] font-black uppercase text-stone-600 tracking-wider">Mobile Number</th>
                    <th className="px-4 py-3 text-[10px] font-black uppercase text-stone-600 tracking-wider">Unit</th>
                    <th className="px-4 py-3 text-[10px] font-black uppercase text-stone-600 tracking-wider">Status</th>
                    <th className="px-4 py-3 text-[10px] font-black uppercase text-stone-600 tracking-wider text-center">Participants</th>
                    <th className="px-4 py-3 text-[10px] font-black uppercase text-stone-600 tracking-wider">Reg Ref</th>
                    <th className="px-4 py-3 text-[10px] font-black uppercase text-stone-600 tracking-wider">Reg Date</th>
                    <th className="px-4 py-3 text-[10px] font-black uppercase text-stone-600 tracking-wider">Payment Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-150">
                  {filteredRows.map((row, index) => (
                    <tr key={row.resident.gmkId} className="hover:bg-stone-50/60 text-xs transition-colors">
                      {/* Serial Number */}
                      <td className="px-3 py-3 font-mono font-bold text-stone-400 text-center text-[11px]">
                        {index + 1}
                      </td>

                      {/* Full Name */}
                      <td className="px-4 py-3">
                        <div className="font-extrabold text-stone-900">
                          {row.resident.salutation ? `${row.resident.salutation} ` : ''}{row.resident.fullName}
                        </div>
                        <div className="text-[10px] text-stone-400 font-medium">{row.resident.email}</div>
                      </td>

                      {/* GMK ID */}
                      <td className="px-4 py-3 font-mono font-bold text-stone-800">
                        {row.resident.gmkId}
                      </td>

                      {/* Mobile Number */}
                      <td className="px-4 py-3 font-mono text-stone-700">
                        {formatPhoneWithCountryCode(row.resident.phone)}
                      </td>

                      {/* Unit */}
                      <td className="px-4 py-3 font-mono font-extrabold text-[#0f4c2a]">
                        {row.resident.displayUnitNumber || row.resident.unitKey || 'N/A'}
                      </td>

                      {/* Three-Way Mutually Exclusive Status */}
                      <td className="px-4 py-3">
                        {row.status === 'REGISTERED — PAID' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-lg text-[10px] font-black uppercase tracking-wider">
                            <CheckCircle2 className="w-3 h-3" />
                            REGISTERED — PAID
                          </span>
                        ) : row.status === 'REGISTERED — NOT PAID' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-amber-100 text-amber-900 border border-amber-300 rounded-lg text-[10px] font-black uppercase tracking-wider">
                            <Clock className="w-3 h-3" />
                            REGISTERED — NOT PAID
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-stone-100 text-stone-600 border border-stone-300 rounded-lg text-[10px] font-black uppercase tracking-wider">
                            <XCircle className="w-3 h-3 text-stone-400" />
                            NOT REGISTERED
                          </span>
                        )}
                      </td>

                      {/* Participants */}
                      <td className="px-4 py-3 text-center">
                        {row.participantsDisplay === '-' ? (
                          <span className="text-stone-300 font-bold">-</span>
                        ) : (
                          <span className="inline-block px-2 py-0.5 bg-stone-100 text-stone-800 rounded font-black text-xs">
                            {row.participantsDisplay}
                          </span>
                        )}
                      </td>

                      {/* Registration Reference */}
                      <td className="px-4 py-3 font-mono text-[11px] text-stone-600">
                        {row.regReference}
                      </td>

                      {/* Registration Date */}
                      <td className="px-4 py-3 text-stone-600 text-[11px]">
                        {row.regDate}
                      </td>

                      {/* Payment Status */}
                      <td className="px-4 py-3">
                        {row.paymentStatusDisplay === '-' ? (
                          <span className="text-stone-300 font-bold">-</span>
                        ) : (
                          <span className="text-[10px] font-black uppercase tracking-wider text-stone-700">
                            {row.paymentStatusDisplay}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
