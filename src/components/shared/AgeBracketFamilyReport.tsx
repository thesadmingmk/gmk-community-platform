import React, { useState, useMemo } from 'react';
import { CommunityEvent, EventRegistration, Family, FamilyMember } from '../../types';
import { 
  Users, 
  FileText, 
  Download, 
  FileSpreadsheet, 
  Plus, 
  Trash2, 
  RotateCcw, 
  Search, 
  AlertCircle, 
  CheckCircle2, 
  Layers,
  ChevronDown,
  Calendar,
  Phone,
  Baby
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import ReportExportButton from './ReportExportButton';
import { getRegistrationDisplayId, formatExternalGmkId, isExternalGmkId } from '../../utils/gmkIdHelper';
import { formatPhoneWithCountryCode } from '../../utils/phoneValidation';

export interface AgeBracket {
  id: string;
  from: number;
  to: number;
}

export interface AgeBracketReportRow {
  slNo: number;
  registrationId: string;
  familyId?: string;
  familyName: string;
  gmkId: string;
  phoneNumber: string;
  adultsCount: number;
  childName: string;
  age: number;
}

export interface AgeBracketSection {
  bracket: AgeBracket;
  rows: AgeBracketReportRow[];
  familiesCount: number;
  childrenCount: number;
}

export interface AgeBracketFamilyReportProps {
  activeEvent: CommunityEvent;
  registrations: EventRegistration[];
  families: Family[];
  familyMembers: FamilyMember[];
  sourceContext?: 'attendance' | 'games';
  className?: string;
}

export default function AgeBracketFamilyReport({
  activeEvent,
  registrations,
  families,
  familyMembers,
  sourceContext = 'attendance',
  className = '',
}: AgeBracketFamilyReportProps) {
  // Age Bracket Configuration State
  const [brackets, setBrackets] = useState<AgeBracket[]>([]);
  const [newFromAge, setNewFromAge] = useState<string>('');
  const [newToAge, setNewToAge] = useState<string>('');
  const [bracketError, setBracketError] = useState<string | null>(null);

  // Search filter for on-screen table
  const [searchTerm, setSearchTerm] = useState<string>('');

  // 1. ADD CUSTOM AGE BRACKET
  const handleAddBracket = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setBracketError(null);

    const from = parseInt(newFromAge, 10);
    const to = parseInt(newToAge, 10);

    if (isNaN(from) || isNaN(to)) {
      setBracketError('Please enter valid numeric values for From and To age.');
      return;
    }

    if (from < 0 || to < 0) {
      setBracketError('Ages cannot be negative.');
      return;
    }

    if (from > to) {
      setBracketError(`"From Age" (${from}) cannot be greater than "To Age" (${to}).`);
      return;
    }

    if (to > 100) {
      setBracketError('To Age cannot exceed 100.');
      return;
    }

    // Check for duplicate identical bracket
    const exists = brackets.some(b => b.from === from && b.to === to);
    if (exists) {
      setBracketError(`Age bracket ${from}–${to} already exists.`);
      return;
    }

    const newBracket: AgeBracket = {
      id: `b_${from}_${to}_${Date.now()}`,
      from,
      to,
    };

    const updated = [...brackets, newBracket].sort((a, b) => a.from - b.from || a.to - b.to);
    setBrackets(updated);
    setNewFromAge('');
    setNewToAge('');
  };

  // 2. REMOVE AGE BRACKET
  const handleRemoveBracket = (id: string) => {
    setBracketError(null);
    setBrackets(prev => prev.filter(b => b.id !== id));
  };

  // 3. CLEAR ALL BRACKETS
  const handleClearAllBrackets = () => {
    setBracketError(null);
    setBrackets([]);
    setNewFromAge('');
    setNewToAge('');
  };

  // 4. EXTRACT ELIGIBLE REGISTRATIONS & CALCULATE AGE DATA
  const processedFamilyData = useMemo(() => {
    const currentYear = new Date().getFullYear();

    // EXCLUDE: CANCELLED, REFUNDED, and cleaned_up records
    const eligibleRegs = registrations.filter(reg => {
      const pStatus = (reg.paymentStatus || '').toLowerCase().trim();
      const wStatus = ((reg as any).workflowStatus || '').toLowerCase().trim();
      const status = ((reg as any).status || '').toLowerCase().trim();
      const opStatus = ((reg as any).operationalStatus || '').toLowerCase().trim();

      if (pStatus === 'cancelled' || pStatus === 'refunded') return false;
      if (wStatus === 'cancelled' || wStatus === 'refunded') return false;
      if (status === 'cancelled' || status === 'refunded') return false;
      if (opStatus === 'cleaned_up' || (reg as any).isOperationalCleanedUp === true) return false;
      if (reg.isExternal && reg.adminReviewStatus === 'rejected') return false;
      return true;
    });

    // Map each eligible registration to its authoritative family details and qualifying children
    return eligibleRegs.map(reg => {
      const isExt = reg.isExternal || isExternalGmkId(reg.publicReference) || isExternalGmkId(reg.primaryMemberGmkId);
      const fam = families.find(f => f.id === reg.familyId || (reg.primaryMemberGmkId && f.primaryMemberGmkId === reg.primaryMemberGmkId));

      // 1. Authoritative Family / Registrant Name (Primary Display Name, never email)
      const familyName = isExt
        ? (reg.primaryRegistrantName || reg.participants?.[0] || 'External Guest')
        : (fam?.fullName || reg.primaryRegistrantName || reg.participants?.[0] || 'Resident Family');

      // 2. Authoritative GMK ID
      const gmkId = getRegistrationDisplayId(reg) || reg.primaryMemberGmkId || formatExternalGmkId(reg.publicReference) || reg.publicReference || 'N/A';

      // 3. Authoritative Phone Number
      const rawPhone = isExt
        ? (reg.primaryRegistrantPhone || (reg as any).phone || '')
        : (fam?.phone || fam?.whatsAppNumber || reg.primaryRegistrantPhone || (reg as any).phone || '');
      const phoneNumber = rawPhone ? formatPhoneWithCountryCode(rawPhone) : 'N/A';

      // 4. Calculate Authoritative Number of Adults
      let adultsCount = 0;

      if (!isExt && fam) {
        // Resident Family: Authoritative family-level adult count from household profile
        const regFamMembers = familyMembers.filter(m => m.familyId === fam.id);
        // Primary member is implicitly 1 adult. Plus any family member who is NOT a child.
        const nonChildMembers = regFamMembers.filter(m => m.relationship !== 'child');
        adultsCount = 1 + nonChildMembers.length;
      } else {
        // External Registrants: Count adults from registration details
        const explicitChildrenCount = (reg.paymentSummary?.childrenCount || 0) + 
                                      (reg.paymentSummary?.halfPriceChildrenCount || 0) + 
                                      (reg.paymentSummary?.freeChildrenCount || 0);

        if (reg.participantDetails && reg.participantDetails.length > 0) {
          const nonChildren = reg.participantDetails.filter(p => p.role !== 'child');
          adultsCount = nonChildren.length;
        } else if (reg.paymentSummary && explicitChildrenCount > 0) {
          adultsCount = Math.max(0, (reg.totalParticipants || 0) - explicitChildrenCount);
        } else if (reg.totalParticipants && reg.totalParticipants > 0) {
          adultsCount = reg.totalParticipants;
        } else {
          adultsCount = 1; // Default to at least 1 adult
        }
      }

      // 5. Extract Children / Participants with Authoritative Age
      const children: Array<{ name: string; age: number }> = [];
      const seenChildNames = new Set<string>();

      // Source A: reg.participantDetails (Authoritative source for event-specific participant declarations)
      if (reg.participantDetails && reg.participantDetails.length > 0) {
        reg.participantDetails.forEach(pd => {
          if (pd.role === 'child') {
            const cName = (pd.name || '').trim();
            if (!cName) return;
            const norm = cName.toLowerCase();
            if (seenChildNames.has(norm)) return;

            let age: number | undefined = undefined;
            if (pd.age !== undefined && !isNaN(pd.age) && pd.age >= 0) {
              age = pd.age;
            } else if (pd.yearOfBirth) {
              const yob = parseInt(pd.yearOfBirth, 10);
              if (!isNaN(yob) && yob > 1900 && yob <= currentYear) {
                age = currentYear - yob;
              }
            }

            // Fallback to familyMembers record if yearOfBirth missing on participantDetail
            if (age === undefined) {
              const matchingMem = familyMembers.find(m => 
                m.familyId === reg.familyId && m.name.toLowerCase().trim() === norm
              );
              if (matchingMem?.yearOfBirth) {
                const yob = parseInt(matchingMem.yearOfBirth, 10);
                if (!isNaN(yob) && yob > 1900 && yob <= currentYear) {
                  age = currentYear - yob;
                }
              } else if ((matchingMem as any)?.dateOfBirth) {
                const parsed = new Date((matchingMem as any).dateOfBirth);
                if (!isNaN(parsed.getTime())) {
                  age = currentYear - parsed.getFullYear();
                }
              }
            }

            if (age !== undefined && !isNaN(age) && age >= 0) {
              seenChildNames.add(norm);
              children.push({ name: cName, age });
            }
          }
        });
      }

      // Source B: reg.participants + familyMembers (For resident registrations without explicit participantDetails)
      if (!isExt && reg.participants && reg.participants.length > 0) {
        const regFamMembers = familyMembers.filter(m => m.familyId === reg.familyId);
        reg.participants.forEach(pName => {
          const trimmed = (pName || '').trim();
          if (!trimmed) return;
          const norm = trimmed.toLowerCase();
          if (seenChildNames.has(norm)) return;

          const matchingMem = regFamMembers.find(m => m.name.toLowerCase().trim() === norm);
          if (matchingMem && matchingMem.relationship === 'child') {
            let age: number | undefined = undefined;
            if (matchingMem.yearOfBirth) {
              const yob = parseInt(matchingMem.yearOfBirth, 10);
              if (!isNaN(yob) && yob > 1900 && yob <= currentYear) {
                age = currentYear - yob;
              }
            } else if ((matchingMem as any)?.dateOfBirth) {
              const parsed = new Date((matchingMem as any).dateOfBirth);
              if (!isNaN(parsed.getTime())) {
                age = currentYear - parsed.getFullYear();
              }
            }

            if (age !== undefined && !isNaN(age) && age >= 0) {
              seenChildNames.add(norm);
              children.push({ name: matchingMem.name || trimmed, age });
            }
          }
        });
      }

      return {
        reg,
        familyName,
        gmkId,
        phoneNumber,
        adultsCount,
        children,
      };
    });
  }, [registrations, families, familyMembers]);

  // 5. MAP DATA INTO SECTIONED AGE BRACKETS
  const reportSections: AgeBracketSection[] = useMemo(() => {
    return brackets.map(bracket => {
      const rows: AgeBracketReportRow[] = [];
      const qualifyingFamilyIds = new Set<string>();

      processedFamilyData.forEach(item => {
        // Children that fall into THIS specific age bracket (inclusive: from <= age <= to)
        const qualifyingChildren = item.children.filter(
          c => c.age >= bracket.from && c.age <= bracket.to
        );

        if (qualifyingChildren.length > 0) {
          qualifyingFamilyIds.add(item.reg.id);

          qualifyingChildren.forEach(child => {
            rows.push({
              slNo: rows.length + 1,
              registrationId: item.reg.id,
              familyId: item.reg.familyId,
              familyName: item.familyName,
              gmkId: item.gmkId,
              phoneNumber: item.phoneNumber,
              adultsCount: item.adultsCount,
              childName: child.name,
              age: child.age,
            });
          });
        }
      });

      return {
        bracket,
        rows,
        familiesCount: qualifyingFamilyIds.size,
        childrenCount: rows.length,
      };
    });
  }, [brackets, processedFamilyData]);

  // Total summary across all brackets
  const overallSummary = useMemo(() => {
    const allQualifyingFamilyIds = new Set<string>();
    let totalChildren = 0;

    reportSections.forEach(sec => {
      totalChildren += sec.childrenCount;
      sec.rows.forEach(r => allQualifyingFamilyIds.add(r.registrationId));
    });

    return {
      totalFamilies: allQualifyingFamilyIds.size,
      totalChildren,
      totalBrackets: brackets.length,
    };
  }, [reportSections, brackets]);

  // Filtered rows for live on-screen search
  const filteredSections = useMemo(() => {
    if (!searchTerm.trim()) return reportSections;

    const term = searchTerm.toLowerCase().trim();
    return reportSections.map(sec => {
      const matchingRows = sec.rows.filter(r => 
        r.familyName.toLowerCase().includes(term) ||
        r.childName.toLowerCase().includes(term) ||
        r.gmkId.toLowerCase().includes(term) ||
        r.phoneNumber.toLowerCase().includes(term)
      );

      const uniqueFams = new Set(matchingRows.map(r => r.registrationId));

      return {
        ...sec,
        rows: matchingRows,
        familiesCount: uniqueFams.size,
        childrenCount: matchingRows.length,
      };
    });
  }, [reportSections, searchTerm]);

  // 6. EXPORT CONSOLIDATED PDF (ONE PDF WITH ALL SECTIONS)
  const handleExportPDF = () => {
    const dateStr = new Date().toISOString().slice(0, 10);
    const doc = new jsPDF({ orientation: 'portrait' });

    // Report Header
    doc.setFontSize(15);
    doc.setTextColor(15, 76, 42); // GMK Dark Green #0f4c2a
    doc.setFont('helvetica', 'bold');
    doc.text('GMK / MyGMK — AGE-BRACKET FAMILY REPORT', 14, 18);

    doc.setFontSize(9.5);
    doc.setTextColor(70, 70, 70);
    doc.setFont('helvetica', 'normal');
    doc.text(`Event: ${activeEvent.title}`, 14, 25);
    doc.text(`Generated: ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Muscat' })} (Asia/Muscat)`, 14, 30);
    doc.text(`Selected Age Groups: ${brackets.map(b => `${b.from}–${b.to} Years`).join(', ')}`, 14, 35);
    doc.text(`Total Qualifying Families: ${overallSummary.totalFamilies} | Total Children: ${overallSummary.totalChildren}`, 14, 40);

    let currentY = 46;

    reportSections.forEach((section) => {
      // Add page if near bottom
      if (currentY > 245) {
        doc.addPage();
        currentY = 20;
      }

      // Section Header Banner
      doc.setFillColor(243, 246, 242);
      doc.rect(14, currentY - 5, 182, 9, 'F');
      
      doc.setFontSize(10.5);
      doc.setTextColor(15, 76, 42);
      doc.setFont('helvetica', 'bold');
      doc.text(`AGE GROUP: ${section.bracket.from}–${section.bracket.to} YEARS`, 17, currentY + 1.5);

      doc.setFontSize(8.5);
      doc.setTextColor(80, 80, 80);
      doc.setFont('helvetica', 'normal');
      const badgeText = `Families: ${section.familiesCount} | Qualifying Children: ${section.childrenCount}`;
      doc.text(badgeText, 193, currentY + 1.5, { align: 'right' });

      currentY += 8;

      if (section.rows.length === 0) {
        doc.setFontSize(8.5);
        doc.setTextColor(130, 130, 130);
        doc.setFont('helvetica', 'italic');
        doc.text('No qualifying participants in this age bracket.', 17, currentY + 4);
        currentY += 14;
      } else {
        const tableBody = section.rows.map(r => [
          r.slNo.toString(),
          r.familyName,
          r.gmkId,
          r.phoneNumber,
          r.adultsCount.toString(),
          r.childName,
          r.age.toString(),
        ]);

        autoTable(doc, {
          startY: currentY,
          head: [['Sl. No.', 'Family / Registrant', 'GMK ID', 'Phone Number', 'No. of Adults', 'Child / Participant Name', 'Age']],
          body: tableBody,
          theme: 'striped',
          headStyles: {
            fillColor: [15, 76, 42],
            textColor: [255, 255, 255],
            fontSize: 8,
            fontStyle: 'bold',
          },
          styles: {
            fontSize: 8,
            cellPadding: 2.2,
            overflow: 'linebreak',
          },
          columnStyles: {
            0: { cellWidth: 14, halign: 'center' },
            1: { cellWidth: 44 },
            2: { cellWidth: 24, halign: 'center' },
            3: { cellWidth: 32 },
            4: { cellWidth: 20, halign: 'center' },
            5: { cellWidth: 36 },
            6: { cellWidth: 12, halign: 'center' },
          },
          margin: { left: 14, right: 14 },
        });

        currentY = (doc as any).lastAutoTable.finalY + 12;
      }
    });

    const contextPrefix = sourceContext === 'games' ? 'Games_Committee' : 'Attendance';
    doc.save(`GMK_${contextPrefix}_Age_Bracket_Family_Report_${activeEvent.id}_${dateStr}.pdf`);
  };

  // 7. EXPORT CONSOLIDATED EXCEL (ONE SHEET WITH ALL SECTIONS)
  const handleExportExcel = () => {
    const dateStr = new Date().toISOString().slice(0, 10);
    const wb = XLSX.utils.book_new();

    const aoaData: any[][] = [];

    // Header Block
    aoaData.push(['GMK / MyGMK — AGE-BRACKET FAMILY REPORT']);
    aoaData.push([`Event: ${activeEvent.title}`]);
    aoaData.push([`Generated: ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Muscat' })} (Asia/Muscat)`]);
    aoaData.push([`Context: ${sourceContext === 'games' ? 'Games Committee Workspace' : 'Attendance Workspace'}`]);
    aoaData.push([`Configured Age Brackets: ${brackets.map(b => `${b.from}–${b.to} Years`).join(', ')}`]);
    aoaData.push([`Total Qualifying Families: ${overallSummary.totalFamilies}`, `Total Qualifying Children: ${overallSummary.totalChildren}`]);
    aoaData.push([]); // blank line

    // Iterate through sections
    reportSections.forEach(section => {
      // Section Divider Row
      aoaData.push([
        `AGE GROUP: ${section.bracket.from}–${section.bracket.to} YEARS`,
        `Families: ${section.familiesCount}`,
        `Qualifying Children: ${section.childrenCount}`
      ]);

      // Table Header Row
      aoaData.push([
        'Sl. No.',
        'Family / Registrant',
        'GMK ID',
        'Phone Number',
        'No. of Adults',
        'Child / Participant Name',
        'Age'
      ]);

      if (section.rows.length === 0) {
        aoaData.push(['-', 'No qualifying participants in this age bracket.', '-', '-', '-', '-', '-']);
      } else {
        section.rows.forEach(r => {
          aoaData.push([
            r.slNo,
            r.familyName,
            r.gmkId,
            r.phoneNumber,
            r.adultsCount,
            r.childName,
            r.age
          ]);
        });
      }

      aoaData.push([]); // blank separator line
    });

    const ws = XLSX.utils.aoa_to_sheet(aoaData);

    // Format column widths for clarity
    ws['!cols'] = [
      { wch: 10 }, // Sl. No.
      { wch: 32 }, // Family / Registrant
      { wch: 16 }, // GMK ID
      { wch: 22 }, // Phone Number
      { wch: 15 }, // No. of Adults
      { wch: 30 }, // Child / Participant Name
      { wch: 10 }, // Age
    ];

    XLSX.utils.book_append_sheet(wb, ws, "Age-Bracket Family Report");
    const contextPrefix = sourceContext === 'games' ? 'Games_Committee' : 'Attendance';
    XLSX.writeFile(wb, `GMK_${contextPrefix}_Age_Bracket_Family_Report_${activeEvent.id}_${dateStr}.xlsx`);
  };

  return (
    <div className={`space-y-6 ${className}`} id="age-bracket-family-report-root">
      {/* 1. TOP HEADER & EXPORT ACTION CONTROLS */}
      <div className="bg-white border border-stone-200 rounded-2xl p-5 shadow-xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center space-x-2.5 text-[#0f4c2a]">
              <div className="w-8 h-8 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-[#0f4c2a] shrink-0">
                <Baby className="w-4 h-4" />
              </div>
              <div>
                <h4 className="font-extrabold text-[#0f4c2a] text-sm uppercase tracking-wider font-heading">
                  Report: Age-Bracket Family Report
                </h4>
                <p className="text-[11px] text-stone-500 font-bold">
                  {sourceContext === 'games' ? 'Games Committee Operational Reporting' : 'Attendance Committee Reporting'} • Event: {activeEvent.title}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* SUMMARY STATS BAR */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2">
          <div className="p-3 bg-stone-50 border border-stone-200 rounded-xl">
            <span className="text-[10px] font-black uppercase tracking-wider text-stone-500 block">
              Active Age Brackets
            </span>
            <span className="text-base font-extrabold text-[#0f4c2a] font-mono">
              {overallSummary.totalBrackets} Groups
            </span>
          </div>

          <div className="p-3 bg-stone-50 border border-stone-200 rounded-xl">
            <span className="text-[10px] font-black uppercase tracking-wider text-stone-500 block">
              Qualifying Families
            </span>
            <span className="text-base font-extrabold text-stone-900 font-mono">
              {overallSummary.totalFamilies}
            </span>
          </div>

          <div className="p-3 bg-stone-50 border border-stone-200 rounded-xl col-span-2 sm:col-span-1">
            <span className="text-[10px] font-black uppercase tracking-wider text-stone-500 block">
              Total Qualifying Children
            </span>
            <span className="text-base font-extrabold text-emerald-700 font-mono">
              {overallSummary.totalChildren}
            </span>
          </div>
        </div>
      </div>

      {/* 2. AGE BRACKET DEFINITION PANEL */}
      <div className="bg-stone-50 border border-stone-200 rounded-2xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h5 className="font-extrabold text-stone-900 text-xs uppercase tracking-wider flex items-center space-x-2">
              <Layers className="w-4 h-4 text-[#0f4c2a]" />
              <span>Define & Customize Age Brackets</span>
            </h5>
            <p className="text-[11px] text-stone-500 font-bold mt-0.5">
              Add custom inclusive age ranges (e.g. 0–5, 6–10, 11–15). Families with children in multiple brackets appear in each applicable group.
            </p>
          </div>

          {brackets.length > 0 && (
            <button
              type="button"
              onClick={handleClearAllBrackets}
              className="self-start sm:self-auto px-3 py-1.5 bg-white border border-stone-250 hover:bg-rose-50 text-stone-700 hover:text-rose-600 rounded-lg text-[11px] font-black uppercase tracking-wider transition-all flex items-center space-x-1.5 shadow-2xs cursor-pointer"
              title="Clear all configured age brackets"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Clear All</span>
            </button>
          )}
        </div>

        {/* ACTIVE BRACKETS CHIP LIST */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-[10px] uppercase font-black text-stone-500 mr-1">Active Brackets:</span>
          {brackets.length === 0 ? (
            <span className="text-xs font-bold text-stone-400 italic">None configured</span>
          ) : (
            brackets.map(b => (
              <div 
                key={b.id}
                className="inline-flex items-center space-x-2 px-3 py-1.5 bg-white border border-stone-250 rounded-xl text-xs font-bold text-[#0f4c2a] shadow-2xs"
              >
                <span className="font-mono">{b.from} – {b.to} Years</span>
                <button
                  type="button"
                  onClick={() => handleRemoveBracket(b.id)}
                  className="text-stone-400 hover:text-rose-600 cursor-pointer p-0.5"
                  title={`Remove bracket ${b.from}–${b.to}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* ADD BRACKET FORM & EXPORTS */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pt-2">
          <form onSubmit={handleAddBracket} className="flex flex-wrap items-end gap-3">
            <div className="w-28">
              <label className="block text-[10px] font-black uppercase tracking-wider text-stone-600 mb-1">
                From Age (Yrs)
              </label>
              <input
                type="number"
                min="0"
                max="100"
                placeholder="e.g. 0"
                value={newFromAge}
                onChange={e => setNewFromAge(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-stone-250 rounded-xl text-xs font-bold text-stone-900 focus:outline-none focus:ring-1 focus:ring-[#0f4c2a]"
              />
            </div>

            <div className="w-28">
              <label className="block text-[10px] font-black uppercase tracking-wider text-stone-600 mb-1">
                To Age (Yrs)
              </label>
              <input
                type="number"
                min="0"
                max="100"
                placeholder="e.g. 5"
                value={newToAge}
                onChange={e => setNewToAge(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-stone-250 rounded-xl text-xs font-bold text-stone-900 focus:outline-none focus:ring-1 focus:ring-[#0f4c2a]"
              />
            </div>

            <button
              type="submit"
              className="px-4 py-2 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center space-x-1.5 shadow-xs cursor-pointer"
            >
              <Plus className="w-4 h-4 text-[#d4af37]" />
              <span>Add Bracket</span>
            </button>
          </form>

          {/* Consolidated Export Buttons */}
          {brackets.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <ReportExportButton
                exportType="pdf"
                onExport={handleExportPDF}
                label="Export PDF"
                generatingLabel="Generating PDF..."
                downloadedLabel="PDF Downloaded"
                failedLabel="PDF Failed"
                reportName="Age-Bracket Family Report"
                successMessage="✓ Consolidated Age-Bracket PDF downloaded successfully"
                className="py-2.5 px-4 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white rounded-xl font-black text-xs uppercase tracking-wider transition-all flex items-center justify-center space-x-2 shadow-xs cursor-pointer"
                icon={<Download className="w-4 h-4 text-[#d4af37]" />}
              />
              <ReportExportButton
                exportType="excel"
                onExport={handleExportExcel}
                label="Export Excel"
                generatingLabel="Generating Excel..."
                downloadedLabel="Excel Downloaded"
                failedLabel="Excel Failed"
                reportName="Age-Bracket Family Report"
                successMessage="✓ Consolidated Age-Bracket Excel downloaded successfully"
                className="py-2.5 px-4 bg-stone-800 hover:bg-stone-900 text-white rounded-xl font-black text-xs uppercase tracking-wider transition-all flex items-center justify-center space-x-2 shadow-xs cursor-pointer"
                icon={<FileSpreadsheet className="w-4 h-4 text-emerald-400" />}
              />
            </div>
          )}
        </div>

        {bracketError && (
          <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs font-bold flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{bracketError}</span>
          </div>
        )}
      </div>

      {/* 3. SCREEN REPORT SEARCH & CONTROLS */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400" />
          <input
            type="text"
            placeholder="Search family name, child name, or GMK ID in report..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white border border-stone-250 rounded-xl text-xs font-bold text-stone-900 focus:outline-none focus:ring-1 focus:ring-[#0f4c2a]"
          />
        </div>

        <div className="text-[11px] font-bold text-stone-500 self-end sm:self-auto">
          Excludes: <span className="font-extrabold text-stone-700">CANCELLED & REFUNDED</span> registrations
        </div>
      </div>

      {/* 4. SECTION-BASED CONSOLIDATED TABLES (ONE SECTION PER AGE GROUP) */}
      <div className="space-y-6">
        {brackets.length === 0 ? (
          <div className="bg-white border border-stone-200 rounded-2xl p-8 flex flex-col items-center justify-center text-center shadow-xs">
            <Layers className="w-8 h-8 text-stone-300 mb-3" />
            <h5 className="font-extrabold text-stone-900 text-sm mb-1">No age brackets configured</h5>
            <p className="text-xs text-stone-500 font-bold max-w-sm">
              Add one or more age ranges above to generate the family report.
            </p>
          </div>
        ) : (
          filteredSections.map((section) => (
          <div 
            key={section.bracket.id}
            className="bg-white border border-stone-200 rounded-2xl overflow-hidden shadow-xs"
            id={`section-${section.bracket.from}-${section.bracket.to}`}
          >
            {/* SECTION HEADER */}
            <div className="p-4 bg-stone-50 border-b border-stone-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center space-x-2.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#0f4c2a]"></span>
                <h5 className="font-extrabold text-[#0f4c2a] text-xs uppercase tracking-wider font-heading">
                  Age Group: {section.bracket.from}–{section.bracket.to} Years
                </h5>
              </div>

              <div className="flex items-center space-x-3 text-xs font-mono">
                <span className="px-2.5 py-1 bg-white border border-stone-200 rounded-lg text-stone-700 font-bold">
                  Families: <strong className="text-stone-900">{section.familiesCount}</strong>
                </span>
                <span className="px-2.5 py-1 bg-emerald-50 border border-emerald-200 rounded-lg text-[#0f4c2a] font-black">
                  Qualifying Children: <strong>{section.childrenCount}</strong>
                </span>
              </div>
            </div>

            {/* TABLE CONTENT */}
            {section.rows.length === 0 ? (
              <div className="p-8 text-center space-y-1.5">
                <p className="text-xs text-stone-500 italic font-bold">
                  No qualifying participants in this age bracket.
                </p>
                {searchTerm && (
                  <p className="text-[10px] text-stone-400 font-medium">
                    (No records matched search: "{searchTerm}")
                  </p>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-stone-100/70 border-b border-stone-200 text-[10px] uppercase font-black text-stone-600 tracking-wider">
                      <th className="py-2.5 px-3 text-center w-12">Sl. No.</th>
                      <th className="py-2.5 px-4">Family / Registrant</th>
                      <th className="py-2.5 px-3 text-center">GMK ID</th>
                      <th className="py-2.5 px-4">Phone Number</th>
                      <th className="py-2.5 px-3 text-center">No. of Adults</th>
                      <th className="py-2.5 px-4">Child / Participant Name</th>
                      <th className="py-2.5 px-3 text-center">Age</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-150 text-xs font-bold text-stone-850">
                    {section.rows.map((row, idx) => (
                      <tr 
                        key={`${row.registrationId}_${row.childName}_${idx}`}
                        className="hover:bg-stone-50/70 transition-colors"
                      >
                        <td className="py-2.5 px-3 text-center font-mono text-stone-500 text-[11px]">
                          {row.slNo}
                        </td>
                        <td className="py-2.5 px-4 font-semibold text-stone-900">
                          {row.familyName}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span className="px-2 py-0.5 bg-emerald-50 text-[#0f4c2a] border border-emerald-200 rounded font-mono text-[10px] font-black">
                            {row.gmkId}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 font-mono text-[11px] text-stone-700">
                          {row.phoneNumber}
                        </td>
                        <td className="py-2.5 px-3 text-center font-mono text-stone-800">
                          {row.adultsCount}
                        </td>
                        <td className="py-2.5 px-4 text-[#0f4c2a] font-bold">
                          {row.childName}
                        </td>
                        <td className="py-2.5 px-3 text-center font-mono font-black text-stone-900">
                          {row.age}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )))}
      </div>
    </div>
  );
}
