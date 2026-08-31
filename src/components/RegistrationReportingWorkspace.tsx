import React, { useState, useMemo } from 'react';
import { Download, Filter, FileText, Search, X, Play } from 'lucide-react';
import { CommunityEvent, EventRegistration, Family, FamilyMember } from '../types';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { GMKCard } from './gmk/DesignSystem';

interface RegistrationReportingWorkspaceProps {
  events: CommunityEvent[];
  registrations: EventRegistration[];
  families: Family[];
  familyMembers: FamilyMember[];
  activeEvent: CommunityEvent | null;
  setPaymentModalReg?: (reg: EventRegistration) => void;
  isSubmitting?: boolean;
}

interface FilterState {
  filterEventId: string;
  filterRegStatus: string;
  filterPayStatus: string;
  filterUnit: string;
  filterRegType: string;
  filterPayMethod: string;
  searchQuery: string;
  regDateFrom: string;
  regDateTo: string;
  payDateFrom: string;
  payDateTo: string;
}

export default function RegistrationReportingWorkspace({
  events,
  registrations: allRegistrations,
  families,
  familyMembers,
  activeEvent,
  setPaymentModalReg,
  isSubmitting
}: RegistrationReportingWorkspaceProps) {
  const [showFilters, setShowFilters] = useState(false);

  const initialFilters: FilterState = {
    filterEventId: activeEvent?.id || 'all',
    filterRegStatus: 'all',
    filterPayStatus: 'all',
    filterUnit: 'all',
    filterRegType: 'all',
    filterPayMethod: 'all',
    searchQuery: '',
    regDateFrom: '',
    regDateTo: '',
    payDateFrom: '',
    payDateTo: ''
  };

  // Draft filters staged in the UI vs Applied filters active on data
  const [draftFilters, setDraftFilters] = useState<FilterState>(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState<FilterState>(initialFilters);

  const getDerivedStatus = (r: EventRegistration) => {
    const due = r.amountDue ?? r.paymentAmount ?? r.paymentSummary?.totalAmount ?? 0;
    const rec = r.amountReceived ?? (r.paymentStatus === 'paid' || r.paymentStatus === 'approved' ? due : 0);
    let rawStatus = r.paymentStatus || 'pending';
    let status = rawStatus;
    
    // UI Presentation Rule: Ignore PARTIALLY_PAID, use strict math
    if (rawStatus === 'partially_paid' || rawStatus === 'pending') {
      if (due === 0) status = 'waived';
      else if (rec >= due && due > 0) status = 'paid';
      else status = 'pending';
    }
    
    return { due, rec, bal: Math.max(0, due - rec), status };
  };

  const handleRunReport = () => {
    setAppliedFilters({ ...draftFilters });
  };

  const handleClearFilters = () => {
    const resetState: FilterState = {
      filterEventId: activeEvent?.id || 'all',
      filterRegStatus: 'all',
      filterPayStatus: 'all',
      filterUnit: 'all',
      filterRegType: 'all',
      filterPayMethod: 'all',
      searchQuery: '',
      regDateFrom: '',
      regDateTo: '',
      payDateFrom: '',
      payDateTo: ''
    };
    setDraftFilters(resetState);
    setAppliedFilters(resetState);
  };

  const filteredRegistrations = useMemo(() => {
    let regs = [...allRegistrations];

    if (appliedFilters.filterEventId !== 'all') {
      regs = regs.filter(r => r.eventId === appliedFilters.filterEventId);
    }
    
    if (appliedFilters.filterRegStatus !== 'all') {
      regs = regs.filter(r => {
        const { status: pStatus } = getDerivedStatus(r);
        const regStatus = (pStatus === 'cancelled' || pStatus === 'refunded') ? 'cancelled' : 
                          (pStatus === 'pending' ? 'pending' : 'registered');
        if (appliedFilters.filterRegStatus === 'refunded') return pStatus === 'refunded';
        return regStatus === appliedFilters.filterRegStatus;
      });
    }

    if (appliedFilters.filterUnit !== 'all') {
      regs = regs.filter(r => {
        const fam = families.find(f => f.id === r.familyId);
        return fam && fam.displayUnitNumber === appliedFilters.filterUnit;
      });
    }
    
    if (appliedFilters.filterRegType !== 'all') {
      regs = regs.filter(r => r.registrationType === appliedFilters.filterRegType);
    }

    if (appliedFilters.filterPayMethod !== 'all') {
      regs = regs.filter(r => {
        const method = r.financeRemarks?.toLowerCase() || '';
        if (appliedFilters.filterPayMethod === 'cash') return method.includes('cash');
        if (appliedFilters.filterPayMethod === 'bank_transfer') return method.includes('bank') || method.includes('transfer');
        return true;
      });
    }

    if (appliedFilters.filterPayStatus !== 'all') {
      regs = regs.filter(r => {
        const { status: pStatus } = getDerivedStatus(r);
        if (appliedFilters.filterPayStatus === 'paid') return pStatus === 'paid' || pStatus === 'approved';
        return pStatus === appliedFilters.filterPayStatus;
      });
    }

    if (appliedFilters.regDateFrom) {
      const fromDate = new Date(appliedFilters.regDateFrom).getTime();
      regs = regs.filter(r => new Date(r.createdAt).getTime() >= fromDate);
    }
    
    if (appliedFilters.regDateTo) {
      const toDate = new Date(appliedFilters.regDateTo).getTime();
      regs = regs.filter(r => new Date(r.createdAt).getTime() <= toDate + 86400000);
    }
    
    if (appliedFilters.payDateFrom) {
      const fromDate = new Date(appliedFilters.payDateFrom).getTime();
      regs = regs.filter(r => r.paymentProcessedAt && new Date(r.paymentProcessedAt).getTime() >= fromDate);
    }
    
    if (appliedFilters.payDateTo) {
      const toDate = new Date(appliedFilters.payDateTo).getTime();
      regs = regs.filter(r => r.paymentProcessedAt && new Date(r.paymentProcessedAt).getTime() <= toDate + 86400000);
    }

    if (appliedFilters.searchQuery.trim()) {
      const q = appliedFilters.searchQuery.toLowerCase().trim();
      regs = regs.filter(r => {
        const fam = families.find(f => f.id === r.familyId);
        const primaryName = fam ? fam.fullName.toLowerCase() : (r.primaryMemberEmail ? r.primaryMemberEmail.split('@')[0].toLowerCase() : '');
        const gmk = (r.primaryMemberGmkId || r.id.split('_')?.[1] || '').toLowerCase();
        const email = (r.primaryMemberEmail || '').toLowerCase();
        return primaryName.includes(q) || gmk.includes(q) || email.includes(q);
      });
    }

    return regs;
  }, [allRegistrations, appliedFilters, families]);

  // Totals for summary
  const summary = useMemo(() => {
    let totalAttendees = 0;
    let paidCount = 0;
    let pendingCount = 0;
    let cancelledCount = 0;
    
    let totalDue = 0;
    let totalReceived = 0;
    let outstanding = 0;
    let refundDue = 0;

    filteredRegistrations.forEach(r => {
      const { due: amountToPay, rec: received, status: pStatus } = getDerivedStatus(r);
      
      totalAttendees += r.totalParticipants || 1;
      
      if (pStatus === 'paid' || pStatus === 'approved') paidCount++;
      else if (pStatus === 'pending') pendingCount++;
      else if (pStatus === 'cancelled' || pStatus === 'refunded') cancelledCount++;

      totalDue += amountToPay;
      totalReceived += received;
      const bal = Math.max(0, amountToPay - received);
      outstanding += bal;
      if (pStatus === 'refund_due') {
        refundDue += Math.max(0, received - amountToPay);
      }
    });

    return { totalAttendees, paidCount, pendingCount, cancelledCount, totalDue, totalReceived, outstanding, refundDue };
  }, [filteredRegistrations]);

  const generateReportData = () => {
    return filteredRegistrations.map((reg, index) => {
      const fam = families.find(f => f.id === reg.familyId);
      const primaryName = fam ? fam.fullName : (reg.primaryMemberEmail ? reg.primaryMemberEmail.split('@')[0] : 'Unknown');
      const unit = fam ? fam.displayUnitNumber : 'Unknown';
      const phone = fam ? fam.phone : 'Unknown';
      const famMembers = familyMembers.filter(m => m.familyId === reg.familyId);
      const participants = reg.participants || [];
      
      let adults = 0;
      let children = 0;
      let childAges: string[] = [];

      if (reg.paymentSummary && typeof reg.paymentSummary.childrenCount === 'number') {
        children = reg.paymentSummary.childrenCount;
        adults = Math.max(0, participants.length - children);
      } else {
        participants.forEach(name => {
          if (name === primaryName) {
            adults++;
          } else {
            const match = famMembers.find(m => m.name.toLowerCase().trim() === name.toLowerCase().trim());
            if (match && match.relationship === 'child') {
              children++;
              if (match.yearOfBirth) {
                const age = new Date().getFullYear() - parseInt(match.yearOfBirth);
                childAges.push(age.toString());
              }
            } else {
              adults++;
            }
          }
        });
      }

      const amountToPay = reg.amountDue ?? reg.paymentAmount ?? reg.paymentSummary?.totalAmount ?? 0;
      const pStatus = reg.paymentStatus || (amountToPay === 0 ? 'waived' : 'pending');
      const received = reg.amountReceived ?? (pStatus === 'paid' ? amountToPay : 0);
      const bal = Math.max(0, amountToPay - received);

      return {
        'Serial No.': index + 1,
        'GMK ID': reg.primaryMemberGmkId || reg.id.split('_')?.[1] || 'N/A',
        'Registration ID': reg.id,
        'Registrant Name': primaryName,
        'Participants': participants.join(', '),
        'Email': reg.primaryMemberEmail,
        'Phone': phone,
        'Unit': unit,
        'Registration Date': new Date(reg.createdAt).toLocaleDateString(),
        'Attendees': reg.totalParticipants || (adults + children),
        'Adults': adults,
        'Children': children,
        'Child Ages': childAges.length > 0 ? childAges.join(', ') : '-',
        'Amount Due': `OMR ${amountToPay.toFixed(3)}`,
        'Amount Received': `OMR ${received.toFixed(3)}`,
        'Balance': `OMR ${bal.toFixed(3)}`,
        'Payment Status': pStatus.toUpperCase(),
        'Registration Status': (reg.paymentStatus === 'cancelled' || reg.paymentStatus === 'refunded') ? 'CANCELLED' : 'REGISTERED',
        'Payment Method': reg.financeRemarks || '-',
        'Entry Pass Number': reg.entryPassNumber || '-',
      };
    });
  };

  const exportExcel = () => {
    const data = generateReportData();
    const ws = XLSX.utils.json_to_sheet(data);
    
    // Auto-size columns roughly
    const cols = Object.keys(data[0] || {}).map(k => ({ wch: Math.max(k.length, 12) }));
    ws['!cols'] = cols;

    // Create summary sheet
    const summaryData = [
      { A: 'GREENS MALAYALEE KOOTAYAMA' },
      { A: 'EVENT REGISTRATION REPORT' },
      { A: 'Event:', B: appliedFilters.filterEventId === 'all' ? 'All Events' : (events.find(e => e.id === appliedFilters.filterEventId)?.title || appliedFilters.filterEventId) },
      { A: 'Report Generated:', B: new Date().toLocaleString() },
      { A: '' },
      { A: 'SUMMARY' },
      { A: 'Total Registrations:', B: filteredRegistrations.length },
      { A: 'Total Attendees:', B: summary.totalAttendees },
      { A: 'Paid Registrations:', B: summary.paidCount },
      { A: 'Pending Registrations:', B: summary.pendingCount },
      { A: 'Cancelled/Refunded:', B: summary.cancelledCount },
      { A: '' },
      { A: 'Total Amount Due:', B: `OMR ${summary.totalDue.toFixed(3)}` },
      { A: 'Total Amount Received:', B: `OMR ${summary.totalReceived.toFixed(3)}` },
      { A: 'Outstanding:', B: `OMR ${summary.outstanding.toFixed(3)}` },
      { A: 'Refund Due:', B: `OMR ${summary.refundDue.toFixed(3)}` },
    ];
    const wsSummary = XLSX.utils.json_to_sheet(summaryData, { skipHeader: true });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsSummary, "SUMMARY");
    XLSX.utils.book_append_sheet(wb, ws, "REGISTRATIONS");
    
    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `Event_Registration_Report_${dateStr}.xlsx`);
  };

  const exportPDF = () => {
    const doc = new jsPDF('landscape');
    
    doc.setFontSize(16);
    doc.text('GREENS MALAYALEE KOOTAYAMA', 14, 15);
    doc.setFontSize(12);
    doc.text('EVENT REGISTRATION REPORT', 14, 22);
    
    doc.setFontSize(10);
    const eventName = appliedFilters.filterEventId === 'all' ? 'All Events' : (events.find(e => e.id === appliedFilters.filterEventId)?.title || appliedFilters.filterEventId);
    doc.text(`Event: ${eventName}`, 14, 32);
    doc.text(`Report Generated: ${new Date().toLocaleString()}`, 14, 38);
    
    // Summary
    doc.text('SUMMARY:', 14, 48);
    doc.text(`Total Registrations: ${filteredRegistrations.length} | Total Attendees: ${summary.totalAttendees}`, 14, 54);
    doc.text(`Paid: ${summary.paidCount} | Pending: ${summary.pendingCount} | Cancelled: ${summary.cancelledCount}`, 14, 60);
    doc.text(`Amount Due: OMR ${summary.totalDue.toFixed(3)} | Amount Received: OMR ${summary.totalReceived.toFixed(3)}`, 14, 66);
    doc.text(`Outstanding: OMR ${summary.outstanding.toFixed(3)} | Refund Due: OMR ${summary.refundDue.toFixed(3)}`, 14, 72);

    const data = generateReportData();
    const columns = [
      { header: 'Serial No.', dataKey: 'Serial No.' },
      { header: 'GMK ID', dataKey: 'GMK ID' },
      { header: 'Name', dataKey: 'Registrant Name' },
      { header: 'Participants', dataKey: 'Participants' },
      { header: 'Unit', dataKey: 'Unit' },
      { header: 'Date', dataKey: 'Registration Date' },
      { header: 'Total', dataKey: 'Attendees' },
      { header: 'Adults', dataKey: 'Adults' },
      { header: 'Kids', dataKey: 'Children' },
      { header: 'Amt Due', dataKey: 'Amount Due' },
      { header: 'Amt Paid', dataKey: 'Amount Received' },
      { header: 'Status', dataKey: 'Payment Status' },
      { header: 'Pass', dataKey: 'Entry Pass Number' }
    ];

    autoTable(doc, {
      startY: 80,
      head: [columns.map(c => c.header)],
      body: data.map(row => columns.map(c => (row as any)[c.dataKey])),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [15, 76, 42] }
    });

    const dateStr = new Date().toISOString().slice(0, 10);
    doc.save(`Event_Registration_Report_${dateStr}.pdf`);
  };

  return (
    <div className="space-y-4">
      {/* Mobile-friendly Actions / Filter Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-stone-200 shadow-xs">
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`px-4 py-2 rounded-xl border text-xs font-bold uppercase tracking-wider flex items-center space-x-2 transition-all cursor-pointer ${showFilters ? 'bg-stone-100 border-stone-300 text-stone-800' : 'bg-white border-stone-200 text-stone-600 hover:bg-stone-50'}`}
          >
            <Filter className="w-4 h-4" />
            <span>{showFilters ? 'Hide Filters' : 'Filters'}</span>
          </button>
          <span className="text-[10px] font-bold text-stone-500 uppercase tracking-widest">
            Showing {filteredRegistrations.length} of {allRegistrations.length} registrations
          </span>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={exportPDF}
            className="px-4 py-2 rounded-xl bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 text-xs font-bold uppercase tracking-wider flex items-center space-x-1.5 transition-all shadow-xs cursor-pointer"
          >
            <FileText className="w-4 h-4" />
            <span>Export PDF</span>
          </button>
          <button
            onClick={exportExcel}
            className="px-4 py-2 rounded-xl bg-[#0f4c2a] text-white hover:bg-[#0c3e22] text-xs font-bold uppercase tracking-wider flex items-center space-x-1.5 transition-all shadow-sm cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>Export Excel</span>
          </button>
        </div>
      </div>

      {/* Expandable Filters Panel */}
      {showFilters && (
        <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-sm animate-fadeIn space-y-4">
          <div className="flex justify-between items-center border-b border-stone-100 pb-3">
            <h4 className="font-extrabold text-[#0f4c2a] text-xs uppercase tracking-wider font-heading flex items-center space-x-2">
              <Filter className="w-4 h-4" />
              <span>Report Filters</span>
            </h4>
            <button 
              type="button"
              onClick={handleClearFilters} 
              className="px-3 py-1.5 text-xs font-black uppercase tracking-wider text-stone-700 bg-stone-100 hover:bg-stone-200 hover:text-stone-900 rounded-xl transition-colors border border-stone-300 shadow-xs cursor-pointer flex items-center space-x-1.5"
            >
              <X className="w-3.5 h-3.5 text-stone-600" />
              <span>Clear All</span>
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase text-stone-500 tracking-wider">Event</label>
              <select 
                value={draftFilters.filterEventId} 
                onChange={e => setDraftFilters(prev => ({ ...prev, filterEventId: e.target.value }))}
                className="w-full text-xs font-bold bg-stone-50 border border-stone-200 p-2.5 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0f4c2a]"
              >
                <option value="all">All Events</option>
                {events.map(ev => (
                  <option key={ev.id} value={ev.id}>{ev.title}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase text-stone-500 tracking-wider">Reg Status</label>
              <select 
                value={draftFilters.filterRegStatus} 
                onChange={e => setDraftFilters(prev => ({ ...prev, filterRegStatus: e.target.value }))}
                className="w-full text-xs font-bold bg-stone-50 border border-stone-200 p-2.5 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0f4c2a]"
              >
                <option value="all">All</option>
                <option value="registered">Registered</option>
                <option value="pending">Pending</option>
                <option value="cancelled">Cancelled</option>
                <option value="refunded">Refunded</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase text-stone-500 tracking-wider">Payment Status</label>
              <select 
                value={draftFilters.filterPayStatus} 
                onChange={e => setDraftFilters(prev => ({ ...prev, filterPayStatus: e.target.value }))}
                className="w-full text-xs font-bold bg-stone-50 border border-stone-200 p-2.5 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0f4c2a]"
              >
                <option value="all">All</option>
                <option value="paid">Paid</option>
                <option value="pending">Pending</option>
                <option value="waived">Waived</option>
                <option value="refunded">Refunded</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase text-stone-500 tracking-wider">Unit / Building</label>
              <select 
                value={draftFilters.filterUnit} 
                onChange={e => setDraftFilters(prev => ({ ...prev, filterUnit: e.target.value }))}
                className="w-full text-xs font-bold bg-stone-50 border border-stone-200 p-2.5 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0f4c2a]"
              >
                <option value="all">All Units</option>
                {Array.from(new Set(families.map(f => f.displayUnitNumber))).sort().map(unit => (
                  <option key={unit} value={unit}>{unit}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase text-stone-500 tracking-wider">Reg Type</label>
              <select 
                value={draftFilters.filterRegType} 
                onChange={e => setDraftFilters(prev => ({ ...prev, filterRegType: e.target.value }))}
                className="w-full text-xs font-bold bg-stone-50 border border-stone-200 p-2.5 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0f4c2a]"
              >
                <option value="all">All</option>
                <option value="family">Family</option>
                <option value="couple">Couple</option>
                <option value="individual">Single</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase text-stone-500 tracking-wider">Payment Method</label>
              <select 
                value={draftFilters.filterPayMethod} 
                onChange={e => setDraftFilters(prev => ({ ...prev, filterPayMethod: e.target.value }))}
                className="w-full text-xs font-bold bg-stone-50 border border-stone-200 p-2.5 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0f4c2a]"
              >
                <option value="all">All</option>
                <option value="cash">Cash</option>
                <option value="bank_transfer">Bank Transfer</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase text-stone-500 tracking-wider">Reg Date From</label>
              <input 
                type="date" 
                value={draftFilters.regDateFrom} 
                onChange={e => setDraftFilters(prev => ({ ...prev, regDateFrom: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') handleRunReport(); }}
                className="w-full text-xs font-bold bg-stone-50 border border-stone-200 p-2.5 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0f4c2a]"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase text-stone-500 tracking-wider">Reg Date To</label>
              <input 
                type="date" 
                value={draftFilters.regDateTo} 
                onChange={e => setDraftFilters(prev => ({ ...prev, regDateTo: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') handleRunReport(); }}
                className="w-full text-xs font-bold bg-stone-50 border border-stone-200 p-2.5 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0f4c2a]"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase text-stone-500 tracking-wider">Pay Date From</label>
              <input 
                type="date" 
                value={draftFilters.payDateFrom} 
                onChange={e => setDraftFilters(prev => ({ ...prev, payDateFrom: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') handleRunReport(); }}
                className="w-full text-xs font-bold bg-stone-50 border border-stone-200 p-2.5 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0f4c2a]"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase text-stone-500 tracking-wider">Pay Date To</label>
              <input 
                type="date" 
                value={draftFilters.payDateTo} 
                onChange={e => setDraftFilters(prev => ({ ...prev, payDateTo: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') handleRunReport(); }}
                className="w-full text-xs font-bold bg-stone-50 border border-stone-200 p-2.5 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0f4c2a]"
              />
            </div>
            <div className="lg:col-span-2 space-y-1.5">
              <label className="text-[10px] font-black uppercase text-stone-500 tracking-wider">Search</label>
              <div className="relative">
                <Search className="w-4 h-4 text-stone-400 absolute left-3 top-2.5" />
                <input 
                  type="text" 
                  value={draftFilters.searchQuery}
                  onChange={e => setDraftFilters(prev => ({ ...prev, searchQuery: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') handleRunReport(); }}
                  placeholder="Search by name, GMK ID, email..."
                  className="w-full pl-9 text-xs font-bold bg-stone-50 border border-stone-200 p-2.5 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0f4c2a]"
                />
              </div>
            </div>
          </div>

          {/* Centered RUN REPORT Action */}
          <div className="flex items-center justify-center pt-3 border-t border-stone-100">
            <button 
              type="button"
              onClick={handleRunReport}
              className="px-8 py-2.5 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all shadow-sm flex items-center space-x-2 cursor-pointer"
            >
              <Play className="w-4 h-4 text-[#d4af37] fill-[#d4af37]" />
              <span>Run Report</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Table View */}
      <GMKCard className="bg-white border border-stone-200 overflow-hidden shadow-xs">
        <div className="overflow-x-auto max-h-[600px]">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-stone-50 z-10 shadow-sm">
              <tr className="border-b border-stone-200 text-[10px] uppercase font-black text-stone-500 tracking-wider">
                <th className="p-3">GMK / Reg ID</th>
                <th className="p-3">Registrant Name</th>
                <th className="p-3">Unit</th>
                <th className="p-3 text-center">Attendees</th>
                <th className="p-3 text-right">Amount to Pay</th>
                <th className="p-3 text-center">Status</th>
                
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-150 text-stone-750 font-bold font-sans text-xs">
              {filteredRegistrations.map(reg => {
                const fam = families.find(f => f.id === reg.familyId);
                const primaryName = fam ? fam.fullName : (reg.primaryMemberEmail ? reg.primaryMemberEmail.split('@')[0] : 'Unknown');
                const unit = fam ? fam.displayUnitNumber : 'Unknown';
                const { due: amountToPay, status: pStatus } = getDerivedStatus(reg);
                const isPaid = pStatus === 'paid' || pStatus === 'approved';
                const isWaived = pStatus === 'waived';
                const isCancelled = pStatus === 'cancelled' || pStatus === 'refunded';

                return (
                  <tr key={reg.id} className="hover:bg-stone-50/50 cursor-pointer" onClick={() => setPaymentModalReg && setPaymentModalReg(reg)}>
                    <td className="p-3 font-mono text-[10px] text-stone-600 uppercase">
                      {reg.primaryMemberGmkId || reg.id.split('_')?.[1] || 'N/A'}
                    </td>
                    <td className="p-3">
                      <span className="text-stone-900 font-black block">{primaryName}</span>
                    </td>
                    <td className="p-3 font-mono text-[11px] text-emerald-800 font-bold">{unit}</td>
                    <td className="p-3 text-center font-black text-stone-900">{reg.totalParticipants || 1}</td>
                    <td className="p-3 text-right font-mono font-black text-[#0f4c2a]">
                      OMR {amountToPay.toFixed(3)}
                    </td>
                    <td className="p-3 text-center">
                      <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider border ${
                        isPaid ? 'bg-emerald-50 text-emerald-800 border-emerald-200' :
                        isWaived ? 'bg-blue-50 text-blue-800 border-blue-200' :
                        isCancelled ? 'bg-stone-100 text-stone-600 border-stone-200' :
                        'bg-amber-50 text-amber-800 border-amber-200'
                      }`}>
                        {pStatus}
                      </span>
                    </td>
                    
                  </tr>
                );
              })}
              {filteredRegistrations.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-stone-500 font-bold italic">
                    No registrations found matching the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </GMKCard>
    </div>
  );
}
