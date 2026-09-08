import React, { useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../context/AuthContext';
import { Filter, Trash2, Plus, Users, FileSpreadsheet, FileText } from 'lucide-react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import ReportExportButton from './shared/ReportExportButton';

interface AgeFilter {
  id: string;
  minAge: string;
  maxAge: string;
}

interface ReportRow {
  id: string;
  name: string;
  age: number | string;
  gender: string;
  parentName?: string;
  parentGmkId: string;
  houseUnit: string;
  source: 'DIRECTORY' | 'EVENT REGISTRATION';
}

export default function AdminReportingWorkspace() {
  const [reportType, setReportType] = useState<'KIDS' | 'ADULTS'>('KIDS');

  // Kids Report State
  const [ageFilters, setAgeFilters] = useState<AgeFilter[]>([{ id: '1', minAge: '', maxAge: '' }]);
  const [kidsIsExecuting, setKidsIsExecuting] = useState(false);
  const [kidsHasRun, setKidsHasRun] = useState(false);
  const [kidsResults, setKidsResults] = useState<ReportRow[]>([]);
  const [lastKidsFilters, setLastKidsFilters] = useState<AgeFilter[]>([]);

  // Adults (Gents / Ladies) State
  const [adultGender, setAdultGender] = useState<'All' | 'Gents' | 'Ladies'>('All');
  const [adultIsExecuting, setAdultIsExecuting] = useState(false);
  const [adultHasRun, setAdultHasRun] = useState(false);
  const [adultResults, setAdultResults] = useState<ReportRow[]>([]);
  const [lastAdultGenderRun, setLastAdultGenderRun] = useState<'All' | 'Gents' | 'Ladies'>('All');

  // Spouses State
  const [spouseGender, setSpouseGender] = useState<'All' | 'Gents' | 'Ladies'>('All');
  const [spouseIsExecuting, setSpouseIsExecuting] = useState(false);
  const [spouseHasRun, setSpouseHasRun] = useState(false);
  const [spouseResults, setSpouseResults] = useState<ReportRow[]>([]);
  const [lastSpouseGenderRun, setLastSpouseGenderRun] = useState<'All' | 'Gents' | 'Ladies'>('All');

  const currentYear = new Date().getFullYear();

  // Helper Functions
  const checkGender = (genderStr: string, filter: 'All' | 'Gents' | 'Ladies') => {
    if (filter === 'All') return true;
    const g = (genderStr || '').toLowerCase().trim();
    if (filter === 'Gents' && (g === 'male' || g === 'm')) return true;
    if (filter === 'Ladies' && (g === 'female' || g === 'f')) return true;
    return false;
  };

  const getAge = (yearOfBirth?: string, dob?: string) => {
    let age = -1;
    if (yearOfBirth) {
      age = currentYear - parseInt(yearOfBirth);
    } else if (dob) {
      const dobDate = new Date(dob);
      if (!isNaN(dobDate.getTime())) age = currentYear - dobDate.getFullYear();
    }
    return age;
  };

  const isChildRel = (rel?: string) => {
    if (!rel) return false;
    const r = rel.toLowerCase().trim();
    return r === 'child';
  };

  const isSpouseRel = (rel?: string) => {
    if (!rel) return false;
    const r = rel.toLowerCase().trim();
    return r === 'spouse';
  };

  // --- KIDS REPORT ---
  const runKidsReport = async () => {
    setKidsIsExecuting(true);
    setKidsHasRun(false);

    try {
      const rows: ReportRow[] = [];
      const resSnap = await getDocs(collection(db, "residents"));
      const residents = resSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
      const famSnap = await getDocs(collection(db, "families"));
      const families = famSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
      const regSnap = await getDocs(collection(db, "event_registrations"));
      const allRegistrations = regSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
      const registrations = allRegistrations.filter((r: any) => {
        const pStatus = (r.paymentStatus || '').toLowerCase().trim();
        const wStatus = (r.workflowStatus || '').toLowerCase().trim();
        const status = (r.status || '').toLowerCase().trim();
        if (pStatus === 'cancelled' || pStatus === 'refunded') return false;
        if (wStatus === 'cancelled' || wStatus === 'refunded') return false;
        if (status === 'cancelled' || status === 'refunded') return false;
        return true;
      });

      const famMap = new Map<string, any>();
      for (const fam of families) famMap.set(fam.id, fam);

      const validAgeFilters = ageFilters
        .map(f => ({ min: parseInt(f.minAge), max: parseInt(f.maxAge) }))
        .filter(f => !isNaN(f.min) && !isNaN(f.max) && f.min <= f.max);

      const checkAge = (age: number) => {
        if (validAgeFilters.length === 0) return true;
        return validAgeFilters.some(f => age >= f.min && age <= f.max);
      };

      const addedKeys = new Set<string>();

      // Directory Kids
      for (const res of residents) {
        const fam = famMap.get(res.uid || res.id);
        if (fam && fam.members) {
          fam.members.forEach((m: any) => {
            if (isChildRel(m.relationship)) {
              const age = getAge(m.yearOfBirth, m.dob);
              if (checkAge(age)) {
                const key = `${res.gmkId}-${(m.name || m.fullName || '').toLowerCase().trim()}`;
                if (!addedKeys.has(key)) {
                  rows.push({
                    id: `dir-${res.id}-${m.name}`,
                    name: m.name || m.fullName || 'Unknown',
                    age: age >= 0 ? age : 'N/A',
                    gender: m.gender || 'Not specified',
                    parentName: res.fullName || 'Unknown',
                    parentGmkId: res.gmkId || 'N/A',
                    houseUnit: res.displayUnitNumber || res.unitNumber || 'N/A',
                    source: 'DIRECTORY'
                  });
                  addedKeys.add(key);
                }
              }
            }
          });
        }
      }

      // Event Kids
      for (const reg of registrations) {
        const res = residents.find(r => r.gmkId === reg.primaryMemberGmkId);
        let famMembers: any[] = [];
        if (res) {
          const fam = famMap.get(res.uid || res.id);
          if (fam && fam.members) famMembers = fam.members;
        } else if (reg.familyId) {
          const fam = famMap.get(reg.familyId);
          if (fam && fam.members) famMembers = fam.members;
        }

        const primaryName = reg.primaryMemberName || '';

        if (reg.participants && Array.isArray(reg.participants)) {
          reg.participants.forEach((pName: string) => {
            if (pName !== primaryName) {
               const match = famMembers.find(m => (m.name || m.fullName || '').toLowerCase().trim() === pName.toLowerCase().trim());
               if (match && isChildRel(match.relationship)) {
                  const age = getAge(match.yearOfBirth, match.dob);
                  if (checkAge(age)) {
                     const key = `${reg.primaryMemberGmkId}-${pName.toLowerCase().trim()}`;
                     if (!addedKeys.has(key)) {
                       rows.push({
                         id: `reg-${reg.id}-${pName}`,
                         name: match.name || match.fullName || pName,
                         age: age >= 0 ? age : 'N/A',
                         gender: match.gender || 'Not specified',
                         parentName: reg.primaryMemberName || res?.fullName || 'Unknown',
                         parentGmkId: reg.primaryMemberGmkId || 'N/A',
                         houseUnit: reg.unitNumber || res?.displayUnitNumber || 'N/A',
                         source: 'EVENT REGISTRATION'
                       });
                       addedKeys.add(key);
                     }
                  }
               }
            }
          });
        }
      }

      setKidsResults(rows);
      setLastKidsFilters([...ageFilters]);
      setKidsHasRun(true);
    } catch (err) {
      console.error(err);
      alert("Failed to run Kids Report.");
    } finally {
      setKidsIsExecuting(false);
    }
  };

  const exportKidsExcel = () => {
    if (kidsResults.length === 0) return;
    const data = kidsResults.map(r => ({
      'Child Name': r.name,
      'Age': r.age,
      'Gender': r.gender,
      'Parent Name': r.parentName,
      'Parent GMK ID': r.parentGmkId,
      'House / Unit': r.houseUnit,
      'Source': r.source
    }));
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Kids Report");
    XLSX.writeFile(workbook, `Kids_Demographic_Report_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  const exportKidsPDF = () => {
    if (kidsResults.length === 0) return;
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text("GMK - Kids Demographic Report", 14, 20);
    doc.setFontSize(10);
    doc.text(`Generated on: ${new Date().toLocaleString()}`, 14, 30);
    doc.text(`Result count: ${kidsResults.length}`, 14, 35);
    
    const valid = lastKidsFilters.map(f => ({ min: parseInt(f.minAge), max: parseInt(f.maxAge) })).filter(f => !isNaN(f.min) && !isNaN(f.max));
    doc.text(`Selected age brackets: ${valid.length > 0 ? valid.map(f => `${f.min}-${f.max}`).join(', ') : 'All'}`, 14, 40);

    autoTable(doc, {
      startY: 45,
      head: [['Child Name', 'Age', 'Gender', 'Parent Name', 'GMK ID', 'House/Unit', 'Source']],
      body: kidsResults.map(r => [r.name, r.age.toString(), r.gender, r.parentName || '', r.parentGmkId, r.houseUnit, r.source]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [15, 76, 42] }
    });
    doc.save(`Kids_Demographic_Report_${new Date().toISOString().slice(0,10)}.pdf`);
  };

  // --- ADULTS REPORT (Gents / Ladies) ---
  const runAdultsReport = async () => {
    setAdultIsExecuting(true);
    setAdultHasRun(false);
    
    try {
      const rows: ReportRow[] = [];
      const resSnap = await getDocs(collection(db, "residents"));
      const residents = resSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
      const famSnap = await getDocs(collection(db, "families"));
      const families = famSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
      const regSnap = await getDocs(collection(db, "event_registrations"));
      const allRegistrations = regSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
      const registrations = allRegistrations.filter((r: any) => {
        const pStatus = (r.paymentStatus || '').toLowerCase().trim();
        const wStatus = (r.workflowStatus || '').toLowerCase().trim();
        const status = (r.status || '').toLowerCase().trim();
        if (pStatus === 'cancelled' || pStatus === 'refunded') return false;
        if (wStatus === 'cancelled' || wStatus === 'refunded') return false;
        if (status === 'cancelled' || status === 'refunded') return false;
        return true;
      });

      const famMap = new Map<string, any>();
      for (const fam of families) famMap.set(fam.id, fam);
      const addedKeys = new Set<string>();

      // Helper to add an adult record safely
      const addAdult = (key: string, data: any) => {
         if (!addedKeys.has(key)) {
            rows.push(data);
            addedKeys.add(key);
         }
      };

      // 1. Process Directory
      for (const res of residents) {
        // Add Primary Member
        if (checkGender(res.gender, adultGender)) {
           addAdult(res.gmkId, {
             id: `dir-adult-${res.id}`,
             name: res.fullName || 'Unknown',
             gender: res.gender || 'Not specified',
             age: 'N/A',
             parentGmkId: res.gmkId || 'N/A',
             houseUnit: res.displayUnitNumber || res.unitNumber || 'N/A',
             source: 'DIRECTORY'
           });
        }
        
        // Add Family Members (Spouses, Relatives, Adult Children not explicitly 'child')
        const fam = famMap.get(res.uid || res.id);
        if (fam && fam.members) {
          fam.members.forEach((m: any) => {
            if (!isChildRel(m.relationship) && checkGender(m.gender, adultGender)) {
                addAdult(`${res.gmkId}-${(m.name || m.fullName || '').toLowerCase().trim()}`, {
                  id: `dir-spouse-${res.id}-${m.name}`,
                  name: m.name || m.fullName || 'Unknown',
                  gender: m.gender || 'Not specified',
                  age: getAge(m.yearOfBirth, m.dob) >= 0 ? getAge(m.yearOfBirth, m.dob) : 'N/A',
                  parentName: res.fullName || 'Unknown',
                  parentGmkId: res.gmkId || 'N/A',
                  houseUnit: res.displayUnitNumber || res.unitNumber || 'N/A',
                  source: 'DIRECTORY'
                });
            }
          });
        }
      }

      // 2. Process Registrations
      for (const reg of registrations) {
        const primaryName = reg.primaryMemberName || '';
        const res = residents.find(r => r.gmkId === reg.primaryMemberGmkId);
        
        let famMembers: any[] = [];
        if (res) {
          const fam = famMap.get(res.uid || res.id);
          if (fam && fam.members) famMembers = fam.members;
        } else if (reg.familyId) {
          const fam = famMap.get(reg.familyId);
          if (fam && fam.members) famMembers = fam.members;
        }

        // Add Primary Member
        let primaryGenderObj = 'Not specified';
        if (res) primaryGenderObj = res.gender || primaryGenderObj;
        if (primaryName && checkGender(primaryGenderObj, adultGender)) {
           addAdult(reg.primaryMemberGmkId, {
             id: `reg-${reg.id}-pri`,
             name: primaryName,
             gender: primaryGenderObj,
             age: 'N/A',
             parentGmkId: reg.primaryMemberGmkId || 'N/A',
             houseUnit: reg.unitNumber || res?.displayUnitNumber || 'N/A',
             source: 'EVENT REGISTRATION'
           });
        }

        // Add Other Adult Participants
        if (reg.participants && Array.isArray(reg.participants)) {
          reg.participants.forEach((pName: string) => {
            if (pName !== primaryName) {
               const match = famMembers.find(m => (m.name || m.fullName || '').toLowerCase().trim() === pName.toLowerCase().trim());
               if (match && !isChildRel(match.relationship) && checkGender(match.gender, adultGender)) {
                     addAdult(`${reg.primaryMemberGmkId}-${pName.toLowerCase().trim()}`, {
                       id: `reg-${reg.id}-${pName}`,
                       name: match.name || match.fullName || pName,
                       age: getAge(match.yearOfBirth, match.dob) >= 0 ? getAge(match.yearOfBirth, match.dob) : 'N/A',
                       gender: match.gender || 'Not specified',
                       parentName: reg.primaryMemberName || res?.fullName || 'Unknown',
                       parentGmkId: reg.primaryMemberGmkId || 'N/A',
                       houseUnit: reg.unitNumber || res?.displayUnitNumber || 'N/A',
                       source: 'EVENT REGISTRATION'
                     });
               }
            }
          });
        }
      }

      setAdultResults(rows);
      setLastAdultGenderRun(adultGender);
      setAdultHasRun(true);
    } catch (err) {
      console.error(err);
      alert("Failed to run Adults Report.");
    } finally {
      setAdultIsExecuting(false);
    }
  };

  const exportAdultsExcel = () => {
    if (adultResults.length === 0) return;
    const data = adultResults.map(r => ({
      'Adult Name': r.name,
      'Gender': r.gender,
      'Age': r.age,
      'Primary Member / Sponsor': r.parentName || r.name,
      'GMK ID': r.parentGmkId,
      'House / Unit': r.houseUnit,
      'Source': r.source
    }));
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Adults (Gents-Ladies)");
    XLSX.writeFile(workbook, `Adults_Demographic_Report_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  const exportAdultsPDF = () => {
    if (adultResults.length === 0) return;
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text("GMK - Adults Demographic Report", 14, 20);
    doc.setFontSize(10);
    doc.text(`Generated on: ${new Date().toLocaleString()}`, 14, 30);
    doc.text(`Gender filter used: ${lastAdultGenderRun}`, 14, 35);
    doc.text(`Result count: ${adultResults.length}`, 14, 40);
    
    autoTable(doc, {
      startY: 45,
      head: [['Adult Name', 'Gender', 'Age', 'GMK ID', 'House/Unit', 'Source']],
      body: adultResults.map(r => [r.name, r.gender, r.age.toString(), r.parentGmkId, r.houseUnit, r.source]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [15, 76, 42] }
    });
    doc.save(`Adults_Demographic_Report_${new Date().toISOString().slice(0,10)}.pdf`);
  };

  

  return (
    <div className="space-y-6">
      <div className="flex border-b border-stone-200 bg-white rounded-t-3xl overflow-hidden shadow-sm">
        <button
          onClick={() => setReportType('KIDS')}
          className={`cursor-pointer flex-1 py-4 text-sm font-black uppercase tracking-widest transition-colors ${
            reportType === 'KIDS' ? 'bg-[#0f4c2a] text-white' : 'bg-white text-stone-500 hover:bg-stone-50'
          }`}
        >
          Kids Report
        </button>
        <button
          onClick={() => setReportType('ADULTS')}
          className={`cursor-pointer flex-1 py-4 text-sm font-black uppercase tracking-widest transition-colors ${
            reportType === 'ADULTS' ? 'bg-[#0f4c2a] text-white' : 'bg-white text-stone-500 hover:bg-stone-50'
          }`}
        >
          Adults (Gents / Ladies)
        </button>
      </div>

      {reportType === 'KIDS' && (
        <>
          <div className="bg-white border border-stone-200 rounded-b-3xl p-6 shadow-sm">
            <h2 className="text-xl font-extrabold text-[#0f4c2a] font-heading mb-6 flex items-center gap-2">
              <Filter className="w-5 h-5" /> Kids Demographic Report
            </h2>
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-stone-800 uppercase tracking-wider border-b border-stone-100 pb-2">
                Child Age Filters
              </h3>
              {ageFilters.map((f, idx) => (
                <div key={f.id} className="flex flex-wrap items-center gap-3">
                  <span className="text-xs font-bold text-stone-500 w-16">Range {idx + 1}</span>
                  <input
                    type="number"
                    placeholder="Min"
                    value={f.minAge}
                    onChange={e => setAgeFilters(prev => prev.map(p => p.id === f.id ? { ...p, minAge: e.target.value } : p))}
                    className="w-20 px-3 py-1.5 border border-stone-200 rounded-xl text-sm font-mono text-center focus:outline-none focus:border-[#0f4c2a]"
                  />
                  <span className="text-stone-400 font-bold">-</span>
                  <input
                    type="number"
                    placeholder="Max"
                    value={f.maxAge}
                    onChange={e => setAgeFilters(prev => prev.map(p => p.id === f.id ? { ...p, maxAge: e.target.value } : p))}
                    className="w-20 px-3 py-1.5 border border-stone-200 rounded-xl text-sm font-mono text-center focus:outline-none focus:border-[#0f4c2a]"
                  />
                  <button
                    onClick={() => setAgeFilters(prev => prev.filter(p => p.id !== f.id))}
                    className="cursor-pointer p-1.5 text-stone-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <button
                onClick={() => setAgeFilters(prev => [...prev, { id: Date.now().toString(), minAge: '', maxAge: '' }])}
                className="cursor-pointer mt-2 flex items-center gap-1.5 text-xs font-bold text-[#0f4c2a] hover:text-emerald-700 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> ADD FILTER
              </button>
            </div>
            <div className="mt-8 pt-6 border-t border-stone-100 flex justify-end">
              <button
                onClick={runKidsReport}
                disabled={kidsIsExecuting}
                className="cursor-pointer px-6 py-2.5 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all shadow-md disabled:opacity-50 flex items-center gap-2"
              >
                {kidsIsExecuting ? 'Processing...' : 'Run Kids Report'}
              </button>
            </div>
          </div>
          {kidsHasRun && (
            <div className="bg-white border border-stone-200 rounded-3xl overflow-hidden shadow-sm">
              <div className="px-6 py-4 border-b border-stone-100 flex flex-wrap gap-4 justify-between items-center bg-stone-50">
                <h3 className="text-sm font-extrabold text-[#0f4c2a] uppercase">
                  Kids Report Results <span className="text-stone-500 font-medium">({kidsResults.length} matches)</span>
                </h3>
                <div className="flex gap-2">
                  <ReportExportButton
                    exportType="excel"
                    onExport={exportKidsExcel}
                    disabled={kidsResults.length === 0}
                    label="Export Excel"
                    generatingLabel="Generating Excel..."
                    downloadedLabel="Excel Downloaded"
                    failedLabel="Excel Failed"
                    reportName="Kids Demographic"
                    successMessage="✓ Excel report downloaded successfully"
                    className="cursor-pointer px-3 py-1.5 text-xs font-bold bg-white border border-stone-200 text-stone-700 hover:bg-stone-50 rounded-lg flex items-center gap-1.5 disabled:opacity-50"
                    icon={<FileSpreadsheet className="w-3.5 h-3.5 text-green-600" />}
                  />
                  <ReportExportButton
                    exportType="pdf"
                    onExport={exportKidsPDF}
                    disabled={kidsResults.length === 0}
                    label="Export PDF"
                    generatingLabel="Generating PDF..."
                    downloadedLabel="PDF Downloaded"
                    failedLabel="PDF Failed"
                    reportName="Kids Demographic"
                    successMessage="✓ PDF downloaded successfully"
                    className="cursor-pointer px-3 py-1.5 text-xs font-bold bg-white border border-stone-200 text-stone-700 hover:bg-stone-50 rounded-lg flex items-center gap-1.5 disabled:opacity-50"
                    icon={<FileText className="w-3.5 h-3.5 text-red-500" />}
                  />
                </div>
              </div>
              {kidsResults.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm border-collapse">
                    <thead>
                      <tr className="bg-white text-[10px] font-black text-stone-400 uppercase tracking-widest border-b border-stone-200">
                        <th className="p-4">Child Name</th>
                        <th className="p-4">Age</th>
                        <th className="p-4">Gender</th>
                        <th className="p-4">Parent Name</th>
                        <th className="p-4">GMK ID</th>
                        <th className="p-4">House/Unit</th>
                        <th className="p-4">Source</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100 text-stone-700 font-medium">
                      {kidsResults.map(r => (
                        <tr key={r.id} className="hover:bg-stone-50">
                          <td className="p-4 font-bold text-stone-900">{r.name}</td>
                          <td className="p-4 font-mono font-bold">{r.age}</td>
                          <td className="p-4">{r.gender}</td>
                          <td className="p-4">{r.parentName}</td>
                          <td className="p-4 font-mono text-xs">{r.parentGmkId}</td>
                          <td className="p-4 font-mono text-xs">{r.houseUnit}</td>
                          <td className="p-4">
                            <span className={`px-2 py-1 rounded text-[9px] font-black uppercase ${r.source === 'DIRECTORY' ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700'}`}>
                              {r.source}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-12 text-center flex flex-col items-center">
                  <Users className="w-12 h-12 text-stone-200 mb-3" />
                  <p className="text-stone-500 font-bold">No matching children found.</p>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {reportType === 'ADULTS' && (
        <>
          <div className="bg-white border border-stone-200 rounded-b-3xl p-6 shadow-sm">
            <h2 className="text-xl font-extrabold text-[#0f4c2a] font-heading mb-6 flex items-center gap-2">
              <Filter className="w-5 h-5" /> Adults (Gents / Ladies) Report
            </h2>
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-stone-800 uppercase tracking-wider border-b border-stone-100 pb-2">
                Gender Filter
              </h3>
              <div className="flex gap-6 pt-2">
                {['All', 'Gents', 'Ladies'].map(g => (
                  <label key={g} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="adultGender"
                      value={g}
                      checked={adultGender === g}
                      onChange={() => setAdultGender(g as any)}
                      className="accent-[#0f4c2a] w-4 h-4 cursor-pointer"
                    />
                    <span className="text-sm font-bold text-stone-700">{g}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="mt-8 pt-6 border-t border-stone-100 flex justify-end">
              <button
                onClick={runAdultsReport}
                disabled={adultIsExecuting}
                className="cursor-pointer px-6 py-2.5 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all shadow-md disabled:opacity-50 flex items-center gap-2"
              >
                {adultIsExecuting ? 'Processing...' : 'Run Adults (Gents / Ladies) Report'}
              </button>
            </div>
          </div>
          {adultHasRun && (
            <div className="bg-white border border-stone-200 rounded-3xl overflow-hidden shadow-sm">
              <div className="px-6 py-4 border-b border-stone-100 flex flex-wrap gap-4 justify-between items-center bg-stone-50">
                <h3 className="text-sm font-extrabold text-[#0f4c2a] uppercase">
                  Adults (Gents / Ladies) Results <span className="text-stone-500 font-medium">({adultResults.length} matches)</span>
                </h3>
                <div className="flex gap-2">
                  <ReportExportButton
                    exportType="excel"
                    onExport={exportAdultsExcel}
                    disabled={adultResults.length === 0}
                    label="Export Excel"
                    generatingLabel="Generating Excel..."
                    downloadedLabel="Excel Downloaded"
                    failedLabel="Excel Failed"
                    reportName="Adults Demographic"
                    successMessage="✓ Excel report downloaded successfully"
                    className="cursor-pointer px-3 py-1.5 text-xs font-bold bg-white border border-stone-200 text-stone-700 hover:bg-stone-50 rounded-lg flex items-center gap-1.5 disabled:opacity-50"
                    icon={<FileSpreadsheet className="w-3.5 h-3.5 text-green-600" />}
                  />
                  <ReportExportButton
                    exportType="pdf"
                    onExport={exportAdultsPDF}
                    disabled={adultResults.length === 0}
                    label="Export PDF"
                    generatingLabel="Generating PDF..."
                    downloadedLabel="PDF Downloaded"
                    failedLabel="PDF Failed"
                    reportName="Adults Demographic"
                    successMessage="✓ PDF downloaded successfully"
                    className="cursor-pointer px-3 py-1.5 text-xs font-bold bg-white border border-stone-200 text-stone-700 hover:bg-stone-50 rounded-lg flex items-center gap-1.5 disabled:opacity-50"
                    icon={<FileText className="w-3.5 h-3.5 text-red-500" />}
                  />
                </div>
              </div>
              {adultResults.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm border-collapse">
                    <thead>
                      <tr className="bg-white text-[10px] font-black text-stone-400 uppercase tracking-widest border-b border-stone-200">
                        <th className="p-4">Primary Member Name</th>
                        <th className="p-4">Gender</th>
                        <th className="p-4">Age</th>
                        <th className="p-4">GMK ID</th>
                        <th className="p-4">House/Unit</th>
                        <th className="p-4">Source</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100 text-stone-700 font-medium">
                      {adultResults.map(r => (
                        <tr key={r.id} className="hover:bg-stone-50">
                          <td className="p-4 font-bold text-stone-900">{r.name}</td>
                          <td className="p-4">{r.gender}</td>
                          <td className="p-4 font-mono font-bold">{r.age}</td>
                          <td className="p-4 font-mono text-xs">{r.parentGmkId}</td>
                          <td className="p-4 font-mono text-xs">{r.houseUnit}</td>
                          <td className="p-4">
                            <span className={`px-2 py-1 rounded text-[9px] font-black uppercase ${r.source === 'DIRECTORY' ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700'}`}>
                              {r.source}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-12 text-center flex flex-col items-center">
                  <Users className="w-12 h-12 text-stone-200 mb-3" />
                  <p className="text-stone-500 font-bold">No matching primary members found.</p>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
