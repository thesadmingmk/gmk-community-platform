import React, { useState } from 'react';
import { Scanner } from '@yudiel/react-qr-scanner';
import { CommunityEvent, EventRegistration, Family, FamilyMember, EventAttendance } from '../types';
import { CheckCircle, XCircle, Search, QrCode, AlertTriangle, FileText, Download, Users, FileSpreadsheet } from 'lucide-react';
import { db, auth } from '../context/AuthContext';
import { doc, setDoc } from 'firebase/firestore';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import * as XLSX from 'xlsx';
import AttendanceReport from './shared/AttendanceReport';

interface Props {
  activeEvent: CommunityEvent;
  registrations: EventRegistration[];
  attendances?: EventAttendance[];
  families: Family[];
  familyMembers: FamilyMember[];
  activeTab?: 'events' | 'attendance' | 'reports';
  committeeName: string;
}

export default function AttendanceWorkspace({
  activeEvent,
  registrations,
  attendances = [],
  families,
  familyMembers,
  activeTab = 'events',
  committeeName
}: Props) {
  const [qrScannerOpen, setQrScannerOpen] = useState(false);
  const [scanInput, setScanInput] = useState('');
  const [scannedReg, setScannedReg] = useState<EventRegistration | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  
  // Attendance List State
  const [selectedReg, setSelectedReg] = useState<EventRegistration | null>(null);
  const [selectedParticipants, setSelectedParticipants] = useState<Record<string, boolean>>({});

  const handleScan = (detectedCodes: any[]) => {
    if (detectedCodes && detectedCodes.length > 0) {
      const code = detectedCodes[0].rawValue;
      if (code) {
        processScan(code);
        setQrScannerOpen(false);
      }
    }
  };

  const processScan = (code: string) => {
    setErrorMsg('');
    setSuccessMsg('');
    setScannedReg(null);
    setSelectedParticipants({});
    
    let searchCode = code.trim().toUpperCase();
    if (!isNaN(Number(searchCode)) && searchCode !== '') {
        searchCode = `GMK-${searchCode}`;
    }
        
    let reg = registrations.find(r => {
      const storedPass = (r.entryPassNumber || '').trim().toUpperCase();
      if (storedPass && storedPass === searchCode) return true;

      const derivedPass = `PASS-${activeEvent.id.slice(-6).toUpperCase()}-${r.primaryMemberGmkId || r.id.slice(-6).toUpperCase()}`;
      if (derivedPass.toUpperCase() === searchCode) return true;

      if (r.id.toUpperCase() === searchCode) return true;
      if (r.primaryMemberGmkId?.toUpperCase() === searchCode) return true;

      return false;
    });
        
    if (reg) {
      setScannedReg(reg);
    } else {
      setErrorMsg(`INVALID / ERROR — No registration found for Entry Pass or GMK ID: ${code}`);
    }
  };

  const handleManualSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (scanInput.trim()) {
      processScan(scanInput.trim());
    }
  };

  const handleCheckIn = async (reg: EventRegistration) => {
    if (!reg || !activeEvent.id) return;
    const gmkId = reg.primaryMemberGmkId || reg.id.split('_')?.[1];
    if (!gmkId) {
      setErrorMsg("Cannot process check-in: Missing GMK ID.");
      return;
    }
    
    const attRef = doc(db, "eventAttendance", `att_${gmkId}_${activeEvent.id}`);
    const existing = attendances.find(a => (a as any).primaryMemberGmkId === gmkId || a.id === `att_${gmkId}_${activeEvent.id}`);
    
    const { adults, children } = getParticipantDetails(reg);
    const allParticipants = [...adults, ...children];
    
    const newlySelected = allParticipants.filter(p => selectedParticipants[p.name]);
    
    if (newlySelected.length === 0) {
      setErrorMsg("Please select at least one attendee to check in.");
      return;
    }
    
    setIsSubmitting(true);
    setErrorMsg('');
    try {
      const nowStr = new Date().toISOString();
      const adminEmail = auth.currentUser?.email || 'Gate Attendance Officer';
      
      const existingArrivedDetails = (existing as any)?.arrivedDetails || [];
      const newArrivedDetails = newlySelected.map(p => ({
        name: p.name,
        category: p.category,
        arrivedAt: nowStr,
        scannedBy: adminEmail
      }));
      
      const combinedArrivedDetails = [...existingArrivedDetails, ...newArrivedDetails];
      const isFullyEntered = combinedArrivedDetails.length >= (reg.totalParticipants || 1);
      
      await setDoc(attRef, {
        id: `att_${gmkId}_${activeEvent.id}`,
        eventId: activeEvent.id,
        committeeKey: 'attendance',
        primaryMemberGmkId: gmkId,
        status: isFullyEntered ? 'attended' : 'checked_in',
        attendedAt: nowStr,
        scannedBy: adminEmail,
        totalParticipants: reg.totalParticipants || 1,
        totalAttended: combinedArrivedDetails.length,
        entryPassNumber: reg.entryPassNumber || `PASS-${activeEvent.id.slice(-6).toUpperCase()}-${gmkId}`,
        arrivedDetails: combinedArrivedDetails
      }, { merge: true });
      
      setSuccessMsg(`Gate entry recorded for ${newlySelected.length} attendees.`);
      setSelectedParticipants({});
    } catch (err: any) {
      setErrorMsg(`Gate check-in failed: ${err.message || err}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Helper for Adults/Children calc
  const getCounts = (reg: EventRegistration) => {
    let childrenCount = reg.paymentSummary?.childrenCount || 0;
    childrenCount += reg.paymentSummary?.halfPriceChildrenCount || 0;
    childrenCount += reg.paymentSummary?.freeChildrenCount || 0;
    const adultsCount = Math.max(0, (reg.totalParticipants || 0) - childrenCount);
    return { adultsCount, childrenCount };
  };

  const getParticipantDetails = (reg: EventRegistration) => {
    const fam = families.find(f => f.id === reg.familyId);
    const famMembers = familyMembers.filter(m => m.familyId === reg.familyId);
    const currentYear = new Date().getFullYear();
    const participants = reg.participants || [];
    
    const adults: { name: string, category: string, age: number }[] = [];
    const children: { name: string, category: string, age: number }[] = [];
    
    participants.forEach(name => {
      let category = 'Adult';
      let age = 30; // default adult
      
      const isPrimary = (name.trim().toLowerCase() === (fam?.fullName || reg.primaryMemberEmail).trim().toLowerCase());
      if (isPrimary) {
        category = 'Adult';
      } else {
        const mem = famMembers.find(m => m.name.toLowerCase().trim() === name.toLowerCase().trim());
        if (mem && mem.relationship === 'child') {
          if (mem.yearOfBirth) {
            const yob = parseInt(mem.yearOfBirth);
            if (!isNaN(yob)) {
              age = currentYear - yob;
              if (age <= 3) category = 'Kids 0-3';
              else if (age <= 9) category = 'Kids 4-9';
              else if (age < 18) category = 'Kids 10+';
              else category = 'Adult'; 
            } else {
              category = 'Kids 10+'; 
            }
          } else {
            category = 'Kids 10+';
          }
        }
      }
      
      if (category === 'Adult') {
        adults.push({ name, category, age });
      } else {
        children.push({ name, category, age });
      }
    });
    
    const externalCount = (reg.totalParticipants || 0) - participants.length;
    for (let i = 0; i < externalCount; i++) {
      adults.push({ name: `Guest/External ${i+1}`, category: 'Adult', age: 30 });
    }
    
    return { adults, children };
  };

  // Filter valid registrations for Attendance
  const validRegs = registrations.filter(r => {
    const st = r.paymentStatus || 'pending';
    return st === 'paid' || st === 'approved' || st === 'waived' || st === 'partially_paid' || st === 'overpaid';
  });

  const getAttendanceStatus = (reg: EventRegistration) => {
    const gmkId = reg.primaryMemberGmkId || reg.id.split('_')?.[1];
    const att = attendances.find(a => (a as any).primaryMemberGmkId === gmkId || a.id === `att_${gmkId}_${activeEvent.id}`);
    
    if (!att) return { label: 'NOT CHECKED IN', color: 'bg-stone-100 text-stone-600', checkedIn: false, partially: false, att, arrivedNames: [] };
    
    const arrivedDetails = (att as any).arrivedDetails || [];
    const arrivedNames = arrivedDetails.map((d: any) => d.name);
    let attTotal = arrivedNames.length > 0 ? arrivedNames.length : ((att as any).totalAttended || (att as any).totalParticipants || 0);
    
    if (att.status === 'attended' || att.status === 'checked_in' || attTotal > 0) {
      if (attTotal > 0 && attTotal < (reg.totalParticipants || 0)) {
         return { label: `${attTotal} / ${reg.totalParticipants} CHECKED IN`, color: 'bg-amber-100 text-amber-800', checkedIn: false, partially: true, att, arrivedNames };
      }
      return { label: 'FULLY ENTERED', color: 'bg-emerald-100 text-emerald-800', checkedIn: true, partially: false, att, arrivedNames };
    }
    return { label: 'NOT CHECKED IN', color: 'bg-stone-100 text-stone-600', checkedIn: false, partially: false, att, arrivedNames: [] };
  };

  const generatePDFReport = () => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text('ATTENDANCE REPORT', 14, 20);
    doc.setFontSize(10);
    doc.text(`Event: ${activeEvent.title}`, 14, 28);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 34);

    let totalEligible = validRegs.length;
    let totalAttendees = 0;
    let totalAdults = 0;
    let totalChildren = 0;
    let totalCheckedIn = 0;
    let totalPartially = 0;
    let totalNotChecked = 0;

    const tableData = validRegs.map((reg, index) => {
      const { adultsCount, childrenCount } = getCounts(reg);
      totalAttendees += reg.totalParticipants || 0;
      totalAdults += adultsCount;
      totalChildren += childrenCount;

      const stat = getAttendanceStatus(reg);
      if (stat.checkedIn) totalCheckedIn++;
      else if (stat.partially) totalPartially++;
      else totalNotChecked++;

      const fam = families.find(f => f.id === reg.familyId);
      const unit = fam?.displayUnitNumber || 'N/A';
      const name = fam?.fullName || reg.primaryMemberEmail;

      return [
        (index + 1).toString(),
        reg.entryPassNumber || `PASS-${reg.id.slice(-4)}`,
        reg.primaryMemberGmkId || 'N/A',
        name,
        unit,
        adultsCount.toString(),
        childrenCount.toString(),
        (reg.totalParticipants || 0).toString(),
        stat.label,
        stat.att?.checkedInAt || (stat.att as any)?.attendedAt ? new Date(stat.att?.checkedInAt || (stat.att as any)?.attendedAt).toLocaleTimeString() : '-'
      ];
    });

    doc.text(`Total Eligible Registrations: ${totalEligible}`, 14, 42);
    doc.text(`Total Registered Attendees: ${totalAttendees} (Adults: ${totalAdults}, Children: ${totalChildren})`, 14, 48);
    doc.text(`Checked In: ${totalCheckedIn} | Partially Checked In: ${totalPartially} | Not Checked In: ${totalNotChecked}`, 14, 54);

    (doc as any).autoTable({
      startY: 60,
      head: [['#', 'Pass #', 'GMK', 'Name', 'Unit', 'Adults', 'Children', 'Total', 'Status', 'Time']],
      body: tableData,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [15, 76, 42] }
    });

    const dateStr = new Date().toISOString().slice(0, 10);
    doc.save(`Attendance_Report_${activeEvent.id}_${dateStr}.pdf`);
  };

  const generateExcelReport = () => {
    let totalEligible = validRegs.length;
    let totalAttendees = 0;
    let totalAdults = 0;
    let totalChildren = 0;
    let totalCheckedIn = 0;
    let totalPartially = 0;
    let totalNotChecked = 0;

    const exportData = validRegs.map((reg, index) => {
      const { adultsCount, childrenCount } = getCounts(reg);
      totalAttendees += reg.totalParticipants || 0;
      totalAdults += adultsCount;
      totalChildren += childrenCount;

      const stat = getAttendanceStatus(reg);
      if (stat.checkedIn) totalCheckedIn++;
      else if (stat.partially) totalPartially++;
      else totalNotChecked++;

      const fam = families.find(f => f.id === reg.familyId);
      return {
        'Sl. No.': index + 1,
        'Entry Pass Number': reg.entryPassNumber || `PASS-${reg.id.slice(-4)}`,
        'GMK ID': reg.primaryMemberGmkId || 'N/A',
        'Primary Registrant': fam?.fullName || reg.primaryMemberEmail,
        'Unit': fam?.displayUnitNumber || 'N/A',
        'Adults': adultsCount,
        'Children': childrenCount,
        'Total Attendees': reg.totalParticipants || 0,
        'Attendance Status': stat.label,
        'Check-in Time': stat.att?.checkedInAt || (stat.att as any)?.attendedAt ? new Date(stat.att?.checkedInAt || (stat.att as any)?.attendedAt).toLocaleString() : ''
      };
    });

    const summaryData = [
      { Metric: 'Total Eligible', Value: totalEligible },
      { Metric: 'Total Attendees', Value: totalAttendees },
      { Metric: 'Adults', Value: totalAdults },
      { Metric: 'Children', Value: totalChildren },
      { Metric: 'Checked In', Value: totalCheckedIn },
      { Metric: 'Partially Checked In', Value: totalPartially },
      { Metric: 'Not Checked In', Value: totalNotChecked }
    ];

    const wb = XLSX.utils.book_new();
    const wsData = XLSX.utils.json_to_sheet(exportData);
    const wsSummary = XLSX.utils.json_to_sheet(summaryData);
    
    XLSX.utils.book_append_sheet(wb, wsData, "Attendance");
    XLSX.utils.book_append_sheet(wb, wsSummary, "Summary");
    
    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `Attendance_Report_${activeEvent.id}_${dateStr}.xlsx`);
  };

  return (
    <div className="bg-white border border-stone-200 rounded-3xl p-6 shadow-sm space-y-6 animate-fadeIn">
      {/* HEADER */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-stone-150 pb-4">
        <div>
          <h4 className="font-extrabold text-[#0f4c2a] text-lg uppercase tracking-wider font-heading flex items-center space-x-2">
            <span>🎟️ {committeeName} Workspace</span>
          </h4>
          <p className="text-stone-500 text-xs font-bold mt-1">
            Gate QR entry pass verification & real-time event attendance tracking
          </p>
        </div>
      </div>

      {activeTab === 'events' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* SCANNER SECTION */}
          <div className="space-y-4">
            <div className="p-5 bg-stone-50 border border-stone-200 rounded-2xl">
              <h5 className="font-extrabold text-stone-900 text-sm uppercase tracking-wider mb-4 flex items-center space-x-2">
                <QrCode className="w-5 h-5 text-[#0f4c2a]" />
                <span>Scan Entry Pass</span>
              </h5>
              
              {!qrScannerOpen ? (
                <button
                  onClick={() => setQrScannerOpen(true)}
                  className="w-full py-4 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white rounded-xl font-black text-sm uppercase tracking-wider shadow-md transition-all flex items-center justify-center space-x-2 cursor-pointer"
                >
                  <QrCode className="w-5 h-5" />
                  <span>Open Camera Scanner</span>
                </button>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-xl overflow-hidden border-2 border-[#0f4c2a] relative">
                    <Scanner onScan={handleScan} />
                    <div className="absolute top-0 left-0 right-0 p-2 bg-black/50 text-white text-center text-xs font-bold z-10">
                      Point camera at QR Code
                    </div>
                  </div>
                  <button
                    onClick={() => setQrScannerOpen(false)}
                    className="w-full py-2 bg-stone-200 hover:bg-stone-300 text-stone-800 rounded-xl font-bold text-xs uppercase tracking-wider transition-all cursor-pointer"
                  >
                    Close Scanner
                  </button>
                </div>
              )}

              <div className="mt-6">
                <p className="text-[10px] text-stone-500 font-bold uppercase tracking-wider mb-2 text-center">
                  OR FIND BY GMK ID
                </p>
                <form onSubmit={handleManualSearch} className="flex items-center space-x-2">
                  <div className="relative flex-1 flex items-center bg-white border border-stone-300 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-[#0f4c2a]">
                    <Search className="ml-3 w-4 h-4 text-stone-400" />
                    <span className="pl-2 font-bold text-stone-500 text-xs">GMK-</span>
                    <input
                      type="text"
                      value={scanInput}
                      onChange={(e) => setScanInput(e.target.value.replace(/\D/g, ''))}
                      placeholder="1001"
                      className="w-full pl-1 pr-3 py-2 font-bold text-stone-900 text-xs focus:outline-none"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={!scanInput.trim()}
                    className="px-4 py-2 bg-stone-800 hover:bg-stone-900 text-white rounded-xl font-black text-xs uppercase tracking-wider disabled:opacity-50 transition-all cursor-pointer shadow-xs"
                  >
                    Verify
                  </button>
                </form>
              </div>
            </div>
          </div>

          {/* VERIFICATION RESULT */}
          <div className="space-y-4">
            {errorMsg && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-2xl flex items-start space-x-3 text-red-800 animate-fadeIn">
                <XCircle className="w-5 h-5 shrink-0 mt-0.5" />
                <div>
                  <h6 className="font-extrabold text-sm uppercase tracking-wider">Invalid / Error</h6>
                  <p className="text-xs font-bold mt-1">{errorMsg}</p>
                </div>
              </div>
            )}
            
            {successMsg && (
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-start space-x-3 text-emerald-800 animate-fadeIn">
                <CheckCircle className="w-5 h-5 shrink-0 mt-0.5" />
                <div>
                  <h6 className="font-extrabold text-sm uppercase tracking-wider">Success</h6>
                  <p className="text-xs font-bold mt-1">{successMsg}</p>
                </div>
              </div>
            )}

            {scannedReg && (() => {
              const status = scannedReg.paymentStatus || 'pending';
              const isApproved = status === 'paid' || status === 'approved' || status === 'waived' || status === 'partially_paid' || status === 'overpaid';
              const isBlocked = !isApproved;
              const attStatus = getAttendanceStatus(scannedReg);
              const isFullyEntered = attStatus.checkedIn;
              const isPartiallyEntered = attStatus.partially;
              
              const fam = families.find(f => f.id === scannedReg.familyId);
              const primaryName = fam ? fam.fullName : (scannedReg.primaryMemberEmail ? scannedReg.primaryMemberEmail.split('@')[0] : 'Unknown');
              
              const { adults, children } = getParticipantDetails(scannedReg);
              const alreadyArrived = attStatus.arrivedNames || [];
              const showCheckboxes = isApproved && !isFullyEntered;
              
              return (
                <div className={`p-5 border-2 rounded-2xl animate-fadeIn ${
                  isFullyEntered ? 'bg-amber-50 border-amber-500' : (isApproved ? 'bg-emerald-50 border-emerald-500' : 'bg-rose-50 border-rose-500')
                }`}>
                  <div className="flex items-start justify-between border-b border-stone-200/50 pb-3 mb-3">
                    <div className="flex items-center space-x-3">
                      {isFullyEntered ? (
                        <CheckCircle className="w-8 h-8 text-amber-600" />
                      ) : isApproved ? (
                        <CheckCircle className="w-8 h-8 text-emerald-600" />
                      ) : (
                        <AlertTriangle className="w-8 h-8 text-rose-600" />
                      )}
                      <div>
                        <h5 className="font-extrabold text-lg uppercase tracking-wider font-heading text-stone-900">
                          {isFullyEntered ? 'ALL REGISTERED ATTENDEES HAVE ALREADY ENTERED' : (isApproved ? 'ACCESS GRANTED' : 'ACCESS DENIED')}
                        </h5>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                          isFullyEntered ? 'bg-amber-200 text-amber-900' : (isPartiallyEntered ? 'bg-emerald-200 text-emerald-900' : (isApproved ? 'bg-emerald-200 text-emerald-900' : 'bg-rose-200 text-rose-900'))
                        }`}>
                          STATUS: {attStatus.label !== 'NOT CHECKED IN' ? attStatus.label : status}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <p className="text-[10px] text-stone-500 font-bold uppercase tracking-wider">Registered Name</p>
                      <p className="text-sm font-black text-stone-900">{primaryName}</p>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-[10px] text-stone-500 font-bold uppercase tracking-wider">Entry Pass ID</p>
                        <p className="text-xs font-mono font-bold text-stone-700">{scannedReg.entryPassNumber || scannedReg.id}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-stone-500 font-bold uppercase tracking-wider">Total Participants</p>
                        <p className="text-xs font-black text-stone-900">{scannedReg.totalParticipants}</p>
                      </div>
                    </div>
                    
                    {isBlocked && (
                      <div className="p-3 bg-white/60 rounded-xl mt-3">
                        <p className="text-xs font-bold text-rose-800">
                          {status === 'pending' && "Payment is pending. Attendee must complete payment at Finance desk."}
                          {status === 'cancelled' && "Registration was cancelled."}
                          {status === 'refunded' && "Registration was refunded."}
                        </p>
                      </div>
                    )}

                    {isFullyEntered && (
                      <div className="p-3 bg-white/60 rounded-xl mt-3">
                        <p className="text-xs font-bold text-amber-800">
                          This Entry Pass has already been fully used for entry.
                        </p>
                      </div>
                    )}

                    {showCheckboxes && (
                      <div className="mt-4 pt-4 border-t border-emerald-200/50 space-y-4">
                        <div className="flex justify-between items-center mb-4 p-3 bg-white/60 rounded-xl border border-stone-200">
                          <div className="text-center">
                            <p className="text-[9px] font-bold text-stone-500 uppercase tracking-wider">Registered</p>
                            <p className="text-lg font-black text-stone-900">{scannedReg.totalParticipants}</p>
                          </div>
                          <div className="text-center">
                            <p className="text-[9px] font-bold text-stone-500 uppercase tracking-wider">Entered</p>
                            <p className="text-lg font-black text-emerald-700">{alreadyArrived.length}</p>
                          </div>
                          <div className="text-center">
                            <p className="text-[9px] font-bold text-stone-500 uppercase tracking-wider">Remaining</p>
                            <p className="text-lg font-black text-amber-700">{(scannedReg.totalParticipants || 0) - alreadyArrived.length}</p>
                          </div>
                        </div>

                        <p className="text-xs font-bold text-stone-600 mb-2">Select who has arrived:</p>
                        {adults.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-[10px] text-stone-500 font-bold uppercase tracking-wider">Adults — {adults.length}</p>
                            {adults.map(p => {
                              const arrived = alreadyArrived.includes(p.name);
                              return (
                                <label key={p.name} className={`flex items-center space-x-3 p-3 rounded-xl border ${arrived ? 'bg-emerald-50/50 border-emerald-200 opacity-70' : 'bg-white border-stone-200 cursor-pointer hover:bg-stone-50 shadow-xs'}`}>
                                  <input 
                                    type="checkbox" 
                                    disabled={arrived}
                                    checked={arrived || selectedParticipants[p.name] || false}
                                    onChange={(e) => setSelectedParticipants(prev => ({ ...prev, [p.name]: e.target.checked }))}
                                    className="w-4 h-4 text-[#0f4c2a] rounded border-stone-300 focus:ring-[#0f4c2a]"
                                  />
                                  <span className="text-xs font-bold text-stone-800">{p.name}</span>
                                  {arrived && <span className="text-[9px] font-black uppercase text-emerald-700 ml-auto tracking-wider">Entered</span>}
                                </label>
                              );
                            })}
                          </div>
                        )}
                        {children.length > 0 && (
                          <div className="space-y-2 mt-4">
                            <p className="text-[10px] text-stone-500 font-bold uppercase tracking-wider">Children — {children.length}</p>
                            {children.map(p => {
                              const arrived = alreadyArrived.includes(p.name);
                              return (
                                <label key={p.name} className={`flex items-center space-x-3 p-3 rounded-xl border ${arrived ? 'bg-emerald-50/50 border-emerald-200 opacity-70' : 'bg-white border-stone-200 cursor-pointer hover:bg-stone-50 shadow-xs'}`}>
                                  <input 
                                    type="checkbox" 
                                    disabled={arrived}
                                    checked={arrived || selectedParticipants[p.name] || false}
                                    onChange={(e) => setSelectedParticipants(prev => ({ ...prev, [p.name]: e.target.checked }))}
                                    className="w-4 h-4 text-[#0f4c2a] rounded border-stone-300 focus:ring-[#0f4c2a]"
                                  />
                                  <div className="flex flex-col">
                                    <span className="text-xs font-bold text-stone-800">{p.name}</span>
                                    <span className="text-[9px] font-bold text-stone-500 uppercase">{p.category}</span>
                                  </div>
                                  {arrived && <span className="text-[9px] font-black uppercase text-emerald-700 ml-auto tracking-wider">Entered</span>}
                                </label>
                              );
                            })}
                          </div>
                        )}
                        <button 
                          disabled={isSubmitting || !Object.values(selectedParticipants).some(v => v)}
                          onClick={() => handleCheckIn(scannedReg)}
                          className="w-full mt-4 py-3 bg-[#0f4c2a] hover:bg-[#0c3e22] disabled:opacity-50 text-white rounded-xl font-black text-xs uppercase tracking-wider transition-all shadow-md cursor-pointer"
                        >
                          Confirm Check-In
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 pt-4 border-t border-stone-200">
                    <button 
                      onClick={() => {
                        setScannedReg(null);
                        setScanInput('');
                        setErrorMsg('');
                        setSuccessMsg('');
                        setSelectedParticipants({});
                      }}
                      className="w-full py-2.5 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-xl font-black text-xs uppercase tracking-wider transition-all shadow-sm cursor-pointer border border-stone-200"
                    >
                      Back to Lookup
                    </button>
                  </div>
                </div>
              );
            })()}

            {!scannedReg && !errorMsg && !successMsg && (
              <div className="h-full flex flex-col items-center justify-center p-8 text-center border border-dashed border-stone-200 rounded-2xl bg-stone-50/50">
                <QrCode className="w-10 h-10 text-stone-300 mb-3" />
                <h6 className="text-xs font-extrabold text-stone-700 uppercase tracking-wider">Awaiting Scan</h6>
                <p className="text-[10px] text-stone-500 font-bold mt-1">
                  Scan a QR code or enter an ID manually to verify registration.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'attendance' && (() => {
        let totalCheckedIn = 0;
        let totalPartially = 0;
        let totalNotChecked = 0;
        let totalAttendees = 0;
        let totalAdults = 0;
        let totalChildren = 0;

        validRegs.forEach(reg => {
          const stat = getAttendanceStatus(reg);
          if (stat.checkedIn) totalCheckedIn++;
          else if (stat.partially) totalPartially++;
          else totalNotChecked++;

          const { adultsCount, childrenCount } = getCounts(reg);
          totalAttendees += reg.totalParticipants || 0;
          totalAdults += adultsCount;
          totalChildren += childrenCount;
        });

        return (
          <div className="space-y-6">
            {/* SUMMARY CARDS */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-4 bg-stone-50 border border-stone-200 rounded-2xl flex flex-col justify-center items-center text-center">
                <span className="text-[10px] text-stone-500 font-black uppercase tracking-wider mb-1 block">Total Eligible</span>
                <span className="text-2xl font-black text-stone-900">{validRegs.length}</span>
              </div>
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex flex-col justify-center items-center text-center">
                <span className="text-[10px] text-emerald-700 font-black uppercase tracking-wider mb-1 block">Checked In</span>
                <span className="text-2xl font-black text-emerald-700">{totalCheckedIn}</span>
              </div>
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex flex-col justify-center items-center text-center">
                <span className="text-[10px] text-amber-700 font-black uppercase tracking-wider mb-1 block">Partially</span>
                <span className="text-2xl font-black text-amber-700">{totalPartially}</span>
              </div>
              <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex flex-col justify-center items-center text-center">
                <span className="text-[10px] text-rose-700 font-black uppercase tracking-wider mb-1 block">Not Checked In</span>
                <span className="text-2xl font-black text-rose-700">{totalNotChecked}</span>
              </div>
            </div>

            <div className="flex items-center space-x-3 text-xs text-stone-600 font-bold bg-stone-100 p-3 rounded-xl">
              <Users className="w-4 h-4 text-stone-400" />
              <span>{totalAttendees} Total Attendees ({totalAdults} Adults, {totalChildren} Children)</span>
            </div>

            {/* DETAIL VIEW MODAL / EXPANDED SECTION */}
            {selectedReg && (() => {
              const stat = getAttendanceStatus(selectedReg);
              const fam = families.find(f => f.id === selectedReg.familyId);
              const { adultsCount, childrenCount } = getCounts(selectedReg);
              
              const { adults, children } = getParticipantDetails(selectedReg);
              const alreadyArrived = stat.arrivedNames || [];
              const isFullyEntered = stat.checkedIn;
              
              return (
                <div className="p-5 border-2 border-[#0f4c2a] rounded-2xl bg-white shadow-lg relative animate-fadeIn">
                  <button 
                    onClick={() => { setSelectedReg(null); setSelectedParticipants({}); }}
                    className="absolute top-4 right-4 text-stone-400 hover:text-stone-800"
                  >
                    <XCircle className="w-5 h-5" />
                  </button>
                  <h5 className="font-extrabold text-sm uppercase tracking-wider mb-4 border-b border-stone-200 pb-2">
                    Attendance Details
                  </h5>
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                    <div>
                      <span className="block text-[9px] uppercase font-bold text-stone-500">Primary Registrant</span>
                      <span className="block text-xs font-black">{fam?.fullName || selectedReg.primaryMemberEmail}</span>
                    </div>
                    <div>
                      <span className="block text-[9px] uppercase font-bold text-stone-500">Unit</span>
                      <span className="block text-xs font-black">{fam?.displayUnitNumber || 'N/A'}</span>
                    </div>
                    <div>
                      <span className="block text-[9px] uppercase font-bold text-stone-500">Entry Pass</span>
                      <span className="block text-xs font-black font-mono">{selectedReg.entryPassNumber || selectedReg.id.slice(-6)}</span>
                    </div>
                    <div>
                      <span className="block text-[9px] uppercase font-bold text-stone-500">Status</span>
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${stat.color}`}>
                        {stat.label}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4 mb-6 p-3 bg-stone-50 rounded-xl">
                    <div>
                      <span className="block text-[9px] uppercase font-bold text-stone-500">Total Participants</span>
                      <span className="block text-sm font-black">{selectedReg.totalParticipants}</span>
                    </div>
                    <div>
                      <span className="block text-[9px] uppercase font-bold text-stone-500">Adults</span>
                      <span className="block text-sm font-black">{adultsCount}</span>
                    </div>
                    <div>
                      <span className="block text-[9px] uppercase font-bold text-stone-500">Children</span>
                      <span className="block text-sm font-black">{childrenCount}</span>
                    </div>
                  </div>

                  {errorMsg && (
                    <div className="mb-4 text-xs font-bold text-rose-600 bg-rose-50 p-2 rounded-lg">{errorMsg}</div>
                  )}
                  {successMsg && (
                    <div className="mb-4 text-xs font-bold text-emerald-600 bg-emerald-50 p-2 rounded-lg">{successMsg}</div>
                  )}

                  {!isFullyEntered && (
                    <div className="mt-4 pt-4 border-t border-stone-200 space-y-4">
                      <div className="flex justify-between items-center mb-4 p-3 bg-stone-50 rounded-xl border border-stone-200">
                        <div className="text-center flex-1 border-r border-stone-200">
                          <p className="text-[9px] font-bold text-stone-500 uppercase tracking-wider">Registered</p>
                          <p className="text-lg font-black text-stone-900">{selectedReg.totalParticipants}</p>
                        </div>
                        <div className="text-center flex-1 border-r border-stone-200">
                          <p className="text-[9px] font-bold text-stone-500 uppercase tracking-wider">Entered</p>
                          <p className="text-lg font-black text-emerald-700">{alreadyArrived.length}</p>
                        </div>
                        <div className="text-center flex-1">
                          <p className="text-[9px] font-bold text-stone-500 uppercase tracking-wider">Remaining</p>
                          <p className="text-lg font-black text-amber-700">{(selectedReg.totalParticipants || 0) - alreadyArrived.length}</p>
                        </div>
                      </div>

                      <p className="text-xs font-bold text-stone-600 mb-2">Select who has arrived:</p>
                      {adults.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-[10px] text-stone-500 font-bold uppercase tracking-wider">Adults — {adults.length}</p>
                          {adults.map(p => {
                            const arrived = alreadyArrived.includes(p.name);
                            return (
                              <label key={p.name} className={`flex items-center space-x-3 p-3 rounded-xl border ${arrived ? 'bg-emerald-50/50 border-emerald-200 opacity-70' : 'bg-white border-stone-200 cursor-pointer hover:bg-stone-50 shadow-xs'}`}>
                                <input 
                                  type="checkbox" 
                                  disabled={arrived}
                                  checked={arrived || selectedParticipants[p.name] || false}
                                  onChange={(e) => setSelectedParticipants(prev => ({ ...prev, [p.name]: e.target.checked }))}
                                  className="w-4 h-4 text-[#0f4c2a] rounded border-stone-300 focus:ring-[#0f4c2a]"
                                />
                                <span className="text-xs font-bold text-stone-800">{p.name}</span>
                                {arrived && <span className="text-[9px] font-black uppercase text-emerald-700 ml-auto tracking-wider">Entered</span>}
                              </label>
                            );
                          })}
                        </div>
                      )}
                      {children.length > 0 && (
                        <div className="space-y-2 mt-4">
                          <p className="text-[10px] text-stone-500 font-bold uppercase tracking-wider">Children — {children.length}</p>
                          {children.map(p => {
                            const arrived = alreadyArrived.includes(p.name);
                            return (
                              <label key={p.name} className={`flex items-center space-x-3 p-3 rounded-xl border ${arrived ? 'bg-emerald-50/50 border-emerald-200 opacity-70' : 'bg-white border-stone-200 cursor-pointer hover:bg-stone-50 shadow-xs'}`}>
                                <input 
                                  type="checkbox" 
                                  disabled={arrived}
                                  checked={arrived || selectedParticipants[p.name] || false}
                                  onChange={(e) => setSelectedParticipants(prev => ({ ...prev, [p.name]: e.target.checked }))}
                                  className="w-4 h-4 text-[#0f4c2a] rounded border-stone-300 focus:ring-[#0f4c2a]"
                                />
                                <div className="flex flex-col">
                                  <span className="text-xs font-bold text-stone-800">{p.name}</span>
                                  <span className="text-[9px] font-bold text-stone-500 uppercase">{p.category}</span>
                                </div>
                                {arrived && <span className="text-[9px] font-black uppercase text-emerald-700 ml-auto tracking-wider">Entered</span>}
                              </label>
                            );
                          })}
                        </div>
                      )}
                      <button 
                        disabled={isSubmitting || !Object.values(selectedParticipants).some(v => v)}
                        onClick={() => handleCheckIn(selectedReg)}
                        className="w-full py-3 bg-[#0f4c2a] hover:bg-[#0c3e22] disabled:opacity-50 text-white rounded-xl font-black text-xs uppercase tracking-wider transition-all cursor-pointer"
                      >
                        Confirm Check-In Now
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* DATA TABLE */}
            <div className="overflow-x-auto border border-stone-200 rounded-2xl bg-white">
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead className="bg-stone-50 border-b border-stone-200 text-[10px] uppercase font-black tracking-wider text-stone-500">
                  <tr>
                    <th className="px-3 py-3 text-center w-10">#</th>
                    <th className="px-4 py-3">Pass #</th>
                    <th className="px-4 py-3">GMK ID</th>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Unit</th>
                    <th className="px-4 py-3 text-center">Total</th>
                    <th className="px-4 py-3 text-center">Adults / Kids</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {validRegs.map((reg, index) => {
                    const stat = getAttendanceStatus(reg);
                    const fam = families.find(f => f.id === reg.familyId);
                    const { adultsCount, childrenCount } = getCounts(reg);

                    return (
                      <tr 
                        key={reg.id} 
                        onClick={() => {
                          setErrorMsg(''); setSuccessMsg(''); setSelectedReg(reg);
                        }}
                        className="hover:bg-stone-50 cursor-pointer transition-colors"
                      >
                        <td className="px-3 py-3 font-mono font-bold text-stone-400 text-center">
                          {index + 1}
                        </td>
                        <td className="px-4 py-3 font-mono font-bold text-stone-600">
                          {reg.entryPassNumber || reg.id.slice(-6)}
                        </td>
                        <td className="px-4 py-3 font-bold text-stone-900">{reg.primaryMemberGmkId || '-'}</td>
                        <td className="px-4 py-3 font-black text-stone-900">{fam?.fullName || reg.primaryMemberEmail}</td>
                        <td className="px-4 py-3 font-bold text-stone-600">{fam?.displayUnitNumber || '-'}</td>
                        <td className="px-4 py-3 text-center font-black">{reg.totalParticipants}</td>
                        <td className="px-4 py-3 text-center font-bold text-stone-500">{adultsCount} / {childrenCount}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${stat.color}`}>
                            {stat.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-stone-500 font-bold">
                          {stat.att?.checkedInAt || (stat.att as any)?.attendedAt ? new Date(stat.att?.checkedInAt || (stat.att as any)?.attendedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-'}
                        </td>
                      </tr>
                    );
                  })}
                  {validRegs.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-stone-500 font-bold">
                        No eligible registrations found for this event.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {activeTab === 'reports' && (
        <div className="space-y-6">
          <div className="p-6 bg-stone-50 border border-stone-200 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h5 className="font-extrabold text-stone-900 text-sm uppercase tracking-wider flex items-center space-x-2">
                <FileText className="w-5 h-5 text-[#0f4c2a]" />
                <span>Download Attendance Reports</span>
              </h5>
              <p className="text-xs text-stone-500 font-bold mt-1">
                Export real-time gate attendance data for event records and audit purposes.
              </p>
            </div>
            
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={generatePDFReport}
                className="px-6 py-3 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white rounded-xl font-black text-xs uppercase tracking-wider transition-all flex items-center justify-center space-x-2 shadow-md cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>PDF Report</span>
              </button>
              <button
                onClick={generateExcelReport}
                className="px-6 py-3 bg-stone-800 hover:bg-stone-900 text-white rounded-xl font-black text-xs uppercase tracking-wider transition-all flex items-center justify-center space-x-2 shadow-md cursor-pointer"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>Excel Report</span>
              </button>
            </div>
          </div>
          
          <div className="p-4 border border-stone-200 rounded-xl bg-white space-y-2">
            <h6 className="text-[10px] font-black text-stone-500 uppercase tracking-wider flex items-center space-x-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
              <span>Report Details</span>
            </h6>
            <ul className="text-xs text-stone-600 space-y-1 list-disc list-inside ml-1">
              <li>Reports only include eligible paid or waived registrations.</li>
              <li>Partially checked in metrics refer to families arriving separately.</li>
              <li>Time recorded reflects the moment the Entry Pass was verified at the gate.</li>
            </ul>
          </div>
        </div>
      )}

      {/* REGISTRATION STATUS REPORT TAB */}
      {activeTab === ('registration_status' as any) && (
        <AttendanceReport initialEventId={activeEvent.id} />
      )}
    </div>
  );
}
