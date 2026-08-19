import React, { useState, useMemo } from 'react';
import { Download, Filter, FileText, Search, X } from 'lucide-react';
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
  const [filterEventId, setFilterEventId] = useState<string>(activeEvent?.id || 'all');
  const [filterRegStatus, setFilterRegStatus] = useState<string>('all');
  const [filterPayStatus, setFilterPayStatus] = useState<string>('all');
  const [filterUnit, setFilterUnit] = useState<string>('all');
  const [filterRegType, setFilterRegType] = useState<string>('all');
  const [filterPayMethod, setFilterPayMethod] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Date filters
  const [regDateFrom, setRegDateFrom] = useState('');
  const [regDateTo, setRegDateTo] = useState('');
  const [payDateFrom, setPayDateFrom] = useState('');
  const [payDateTo, setPayDateTo] = useState('');

  const getDerivedStatus = (r: EventRegistration) => {
    const due = r.amountDue ?? r.paymentAmount ?? r.paymentSummary?.totalAmount ?? 0;
    const rec = r.amountReceived ?? (r.paymentStatus === 'paid' || r.paymentStatus === 'approved' ? due : 0);
    let status = r.paymentStatus;
    
    // Explicit dynamic derivations if missing or pending
    if (!status || status === 'pending') {
      if (due === 0) status = 'waived';
      else if (rec > 0 && rec < due) status = 'partially_paid';
      else if (rec >= due && due > 0) status = 'paid';
      else status = 'pending';
    }
    
    // Normalize approved to paid for consistency if needed, but let's keep it as is
    return { due, rec, bal: Math.max(0, due - rec), status };
  };

  const handleClearFilters = () => {
    setFilterEventId(activeEvent?.id || 'all');
    setFilterRegStatus('all');
    setFilterPayStatus('all');
    setFilterUnit('all');
    setFilterRegType('all');
    setFilterPayMethod('all');
    setSearchQuery('');
    setRegDateFrom('');
    setRegDateTo('');
    setPayDateFrom('');
    setPayDateTo('');
  };

  const filteredRegistrations = useMemo(() => {
    let regs = [...allRegistrations];

    if (filterEventId !== 'all') {
      regs = regs.filter(r => r.eventId === filterEventId);
    }
    
    if (filterRegStatus !== 'all') {
      regs = regs.filter(r => {
        const { status: pStatus } = getDerivedStatus(r);
        const regStatus = (pStatus === 'cancelled' || pStatus === 'refunded') ? 'cancelled' : 
                          (pStatus === 'pending' ? 'pending' : 'registered');
        if (filterRegStatus === 'refunded') return pStatus === 'refunded';
        return regStatus === filterRegStatus;
      });
    }

    if (filterUnit !== 'all') {
      regs = regs.filter(r => {
        const fam = families.find(f => f.id === r.familyId);
        return fam && fam.displayUnitNumber === filterUnit;
      });
    }
    
    if (filterRegType !== 'all') {
      regs = regs.filter(r => r.registrationType === filterRegType);
    }

    if (filterPayMethod !== 'all') {
      regs = regs.filter(r => {
        const method = r.financeRemarks?.toLowerCase() || '';
        if (filterPayMethod === 'cash') return method.includes('cash');
        if (filterPayMethod === 'bank_transfer') return method.includes('bank') || method.includes('transfer');
        return true;
      });
    }

    if (filterPayStatus !== 'all') {
      regs = regs.filter(r => {
        const { status: pStatus } = getDerivedStatus(r);
        if (filterPayStatus === 'paid') return pStatus === 'paid' || pStatus === 'approved';
        return pStatus === filterPayStatus;
      });
    }

    if (regDateFrom) {
      const fromDate = new Date(regDateFrom).getTime();
      regs = regs.filter(r => new Date(r.createdAt).getTime() >= fromDate);
    }
    
    if (regDateTo) {
      const toDate = new Date(regDateTo).getTime();
      regs = regs.filter(r => new Date(r.createdAt).getTime() <= toDate + 86400000);
    }
    
    if (payDateFrom) {
      const fromDate = new Date(payDateFrom).getTime();
      regs = regs.filter(r => r.paymentProcessedAt && new Date(r.paymentProcessedAt).getTime() >= fromDate);
    }
    
    if (payDateTo) {
      const toDate = new Date(payDateTo).getTime();
      regs = regs.filter(r => r.paymentProcessedAt && new Date(r.paymentProcessedAt).getTime() <= toDate + 86400000);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      regs = regs.filter(r => {
        const fam = families.find(f => f.id === r.familyId);
        const primaryName = fam ? fam.fullName.toLowerCase() : (r.primaryMemberEmail ? r.primaryMemberEmail.split('@')[0].toLowerCase() : '');
        const gmk = (r.primaryMemberGmkId || r.id.split('_')?.[1] || '').toLowerCase();
        const email = (r.primaryMemberEmail || '').toLowerCase();
        return primaryName.includes(q) || gmk.includes(q) || email.includes(q);
      });
    }

    return regs;
  }, [allRegistrations, filterEventId, filterRegStatus, filterPayStatus, filterUnit, filterRegType, filterPayMethod, regDateFrom, regDateTo, payDateFrom, payDateTo, searchQuery, families]);

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
      { A: 'Event:', B: filterEventId === 'all' ? 'All Events' : (events.find(e => e.id === filterEventId)?.title || filterEventId) },
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
    
    XLSX.writeFile(wb, "Event_Registration_Report.xlsx");
  };

  const exportPDF = () => {
    const doc = new jsPDF('landscape');
    
    doc.setFontSize(16);
    doc.text('GREENS MALAYALEE KOOTAYAMA', 14, 15);
    doc.setFontSize(12);
    doc.text('EVENT REGISTRATION REPORT', 14, 22);
    
    doc.setFontSize(10);
    const eventName = filterEventId === 'all' ? 'All Events' : (events.find(e => e.id === filterEventId)?.title || filterEventId);
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

    doc.save("Event_Registration_Report.pdf");
  };

  return (
    <div className="space-y-4">
      {/* Mobile-friendly Actions / Filter Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-stone-200 shadow-xs">
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`px-4 py-2 rounded-xl border text-xs font-bold uppercase tracking-wider flex items-center space-x-2 transition-all ${showFilters ? 'bg-stone-100 border-stone-300 text-stone-800' : 'bg-white border-stone-200 text-stone-600 hover:bg-stone-50'}`}
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
            className="px-4 py-2 rounded-xl bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 text-xs font-bold uppercase tracking-wider flex items-center space-x-1.5 transition-all shadow-xs"
          >
            <FileText className="w-4 h-4" />
            <span>Export PDF</span>
          </button>
          <button
            onClick={exportExcel}
            className="px-4 py-2 rounded-xl bg-[#0f4c2a] text-white hover:bg-[#0c3e22] text-xs font-bold uppercase tracking-wider flex items-center space-x-1.5 transition-all shadow-sm"
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
            <button onClick={handleClearFilters} className="text-[10px] uppercase font-black text-stone-400 hover:text-stone-700">
              Clear All
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase text-stone-500 tracking-wider">Event</label>
              <select 
                value={filterEventId} 
                onChange={e => setFilterEventId(e.target.value)}
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
                value={filterRegStatus} 
                onChange={e => setFilterRegStatus(e.target.value)}
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
                value={filterPayStatus} 
                onChange={e => setFilterPayStatus(e.target.value)}
                className="w-full text-xs font-bold bg-stone-50 border border-stone-200 p-2.5 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0f4c2a]"
              >
                <option value="all">All</option>
                <option value="paid">Paid</option>
                <option value="pending">Pending</option>
                <option value="partially_paid">Partial</option>
                <option value="waived">Waived</option>
                <option value="refunded">Refunded</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase text-stone-500 tracking-wider">Unit / Building</label>
              <select 
                value={filterUnit} 
                onChange={e => setFilterUnit(e.target.value)}
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
                value={filterRegType} 
                onChange={e => setFilterRegType(e.target.value)}
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
                value={filterPayMethod} 
                onChange={e => setFilterPayMethod(e.target.value)}
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
                value={regDateFrom} 
                onChange={e => setRegDateFrom(e.target.value)}
                className="w-full text-xs font-bold bg-stone-50 border border-stone-200 p-2.5 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0f4c2a]"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase text-stone-500 tracking-wider">Reg Date To</label>
              <input 
                type="date" 
                value={regDateTo} 
                onChange={e => setRegDateTo(e.target.value)}
                className="w-full text-xs font-bold bg-stone-50 border border-stone-200 p-2.5 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0f4c2a]"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase text-stone-500 tracking-wider">Pay Date From</label>
              <input 
                type="date" 
                value={payDateFrom} 
                onChange={e => setPayDateFrom(e.target.value)}
                className="w-full text-xs font-bold bg-stone-50 border border-stone-200 p-2.5 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0f4c2a]"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase text-stone-500 tracking-wider">Pay Date To</label>
              <input 
                type="date" 
                value={payDateTo} 
                onChange={e => setPayDateTo(e.target.value)}
                className="w-full text-xs font-bold bg-stone-50 border border-stone-200 p-2.5 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0f4c2a]"
              />
            </div>
            <div className="lg:col-span-2 space-y-1.5">
              <label className="text-[10px] font-black uppercase text-stone-500 tracking-wider">Search</label>
              <div className="relative">
                <Search className="w-4 h-4 text-stone-400 absolute left-3 top-2.5" />
                <input 
                  type="text" 
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search by name, GMK ID, email..."
                  className="w-full pl-9 text-xs font-bold bg-stone-50 border border-stone-200 p-2.5 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0f4c2a]"
                />
              </div>
            </div>
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
