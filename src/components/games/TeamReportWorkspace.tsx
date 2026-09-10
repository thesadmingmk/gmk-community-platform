import React, { useState, useMemo, useEffect } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../../context/AuthContext';
import { EventTeam, EventRegistration, Family, FamilyMember, CommunityEvent } from '../../types';
import { evaluateFamilyRegistrationParticipants } from '../../services/familyCheckInService';
import { getRegistrationDisplayId, formatExternalGmkId } from '../../utils/gmkIdHelper';
import { Users, Filter, Plus, Trash2, Baby, Search, AlertCircle, FileText, FileSpreadsheet, Download } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import ReportExportButton from '../shared/ReportExportButton';

interface AgeBracket {
  id: string;
  from: number;
  to: number;
}

interface Props {
  activeEvent: CommunityEvent | null;
  registrations: EventRegistration[];
  families: Family[];
  familyMembers: FamilyMember[];
}

export default function TeamReportWorkspace({ activeEvent, registrations, families, familyMembers }: Props) {
  const [teams, setTeams] = useState<EventTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');
  const [viewMode, setViewMode] = useState<'all' | 'adults' | 'kids'>('all');

  // Age Bracket State
  const [brackets, setBrackets] = useState<AgeBracket[]>([]);
  const [newFromAge, setNewFromAge] = useState<string>('');
  const [newToAge, setNewToAge] = useState<string>('');
  const [bracketError, setBracketError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeEvent) {
      setTeams([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const q = query(collection(db, 'eventTeams'), where('eventId', '==', activeEvent.id));
    const unsub = onSnapshot(q, (snap) => {
      const list: EventTeam[] = [];
      snap.forEach(d => list.push({ id: d.id, ...d.data() } as EventTeam));
      // Sort teams alphabetically
      list.sort((a, b) => a.teamName.localeCompare(b.teamName));
      setTeams(list);
      setLoading(false);
      // Auto-select first team if none selected and list is not empty
      if (list.length > 0 && !selectedTeamId) {
        setSelectedTeamId(list[0].id);
      }
    });
    return () => unsub();
  }, [activeEvent]);

  // Handle bracket changes
  const handleAddBracket = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setBracketError(null);
    const from = parseInt(newFromAge, 10);
    const to = parseInt(newToAge, 10);
    if (isNaN(from) || isNaN(to) || from < 0 || to < 0) {
      setBracketError('Enter valid positive numeric ages.');
      return;
    }
    if (from > to) {
      setBracketError(`"From" (${from}) cannot be greater than "To" (${to}).`);
      return;
    }
    if (brackets.some(b => b.from === from && b.to === to)) {
      setBracketError(`Bracket ${from}–${to} exists.`);
      return;
    }
    setBrackets(prev => [...prev, { id: `b_${from}_${to}_${Date.now()}`, from, to }].sort((a, b) => a.from - b.from));
    setNewFromAge('');
    setNewToAge('');
  };

  const targetTeams = useMemo(() => {
    if (selectedTeamId === 'ALL_TEAMS') return teams;
    const t = teams.find(t => t.id === selectedTeamId);
    return t ? [t] : [];
  }, [teams, selectedTeamId]);

  // Resolve team members and their associated registrations
  const teamReportData = useMemo(() => {
    if (targetTeams.length === 0) return [];

    // Helper to evaluate age based on DOB or default age brackets
    const currentYear = new Date().getFullYear();
    const evaluateAge = (member: any, relationship: string) => {
      let isAdult = true;
      let age = -1;

      if (member.yearOfBirth) {
        age = currentYear - parseInt(member.yearOfBirth, 10);
        if (age < 18) isAdult = false;
      } else {
        if (relationship.toLowerCase() === 'child') {
           isAdult = false;
        } else if (relationship.toLowerCase() === 'parent' || relationship.toLowerCase() === 'spouse' || relationship.toLowerCase() === 'gmk member') {
           isAdult = true;
        }
      }
      return { isAdult, age };
    };

    const processRegistration = (regId: string) => {
      const reg = registrations.find(r => r.id === regId);
      if (!reg) return [];

      const gmkId = getRegistrationDisplayId(reg) || (reg.isExternal ? formatExternalGmkId(reg.publicReference) || reg.publicReference || reg.id : reg.primaryMemberGmkId || 'N/A');
      
      const people: Array<{ name: string; relationship: string; gmkId: string; isAdult: boolean; age: number }> = [];

      if (reg.isExternal) {
        (reg.participants || []).forEach(pName => {
          const pDetails = reg.participantDetails?.find(d => d.name === pName);
          let isAdult = true;
          let age = -1;
          if (pDetails && pDetails.role === 'child') isAdult = false;
          
          people.push({
            name: pName,
            relationship: reg.externalRegistrationTypeName || 'External Guest',
            gmkId,
            isAdult,
            age
          });
        });
      } else {
        const evalResult = evaluateFamilyRegistrationParticipants(reg, [], families, familyMembers);
        
        const fam = families.find(f => 
          f.id === reg.familyId || 
          f.id === `fam_${gmkId}` ||
          (gmkId && f.primaryMemberGmkId === gmkId)
        );
        const relevantFamilyMembers = familyMembers.filter(m => 
          m.familyId === reg.familyId || 
          (fam && m.familyId === fam.id) || 
          (fam && m.familyId === `fam_${fam.primaryMemberGmkId}`) ||
          (gmkId && m.familyId === `fam_${gmkId}`)
        );

        evalResult.allParticipants.forEach(p => {
          let fm = relevantFamilyMembers.find(m => m.name.toLowerCase() === p.name.toLowerCase());
          let yob = fm?.yearOfBirth;
          
          let isAdult = true;
          let age = -1;
          
          if (yob) {
            age = currentYear - parseInt(yob, 10);
            if (age < 18) isAdult = false;
          } else {
            if (p.relationship === 'Child') isAdult = false;
          }

          people.push({
            name: p.name,
            relationship: p.relationship,
            gmkId,
            isAdult,
            age
          });
        });
      }
      return people;
    };

    return targetTeams.map(team => {
      const captainGroup = team.captain ? {
        role: 'Captain',
        anchor: team.captain,
        people: processRegistration(team.captain.registrationId)
      } : null;

      const uniqueMemberRegIds = new Set<string>();
      if (team.captain) {
         uniqueMemberRegIds.add(team.captain.registrationId);
      }
      
      const memberGroups: any[] = [];
      (team.members || []).forEach(m => {
        if (!uniqueMemberRegIds.has(m.registrationId)) {
          uniqueMemberRegIds.add(m.registrationId);
          memberGroups.push({
            role: 'Member',
            anchor: m,
            people: processRegistration(m.registrationId)
          });
        }
      });

      return {
        team,
        captainGroup,
        memberGroups
      };
    });

  }, [targetTeams, registrations, families, familyMembers]);

  const [activeBracketId, setActiveBracketId] = useState<string>('all');

  const bracketCounts = useMemo(() => {
    let allKids = 0;
    const counts: Record<string, number> = {};
    brackets.forEach(b => counts[b.id] = 0);

    teamReportData.forEach(({ captainGroup, memberGroups }) => {
      const process = (group: any) => {
        if (!group) return;
        group.people.forEach((p: any) => {
          if (!p.isAdult) {
            allKids++;
            brackets.forEach(b => {
               if (p.age >= b.from && p.age <= b.to) {
                 counts[b.id]++;
               }
            });
          }
        });
      };
      process(captainGroup);
      memberGroups.forEach(process);
    });

    return { allKids, counts };
  }, [teamReportData, brackets]);

  const reportSections = useMemo(() => {
    if (teamReportData.length === 0) return [];
    
    const sections: { title: string, rows: any[] }[] = [];
    
    if (viewMode !== 'kids') {
      const rows: any[] = [];
      let sno = 1;
      
      const processGroup = (team: EventTeam, group: any, isCaptainFam: boolean) => {
        if (!group) return;
        group.people.forEach((p: any) => {
          if (viewMode === 'adults' && !p.isAdult) return;
          rows.push({
            'S.NO.': sno++,
            'Team Name': team.teamName,
            'Role / Source': isCaptainFam ? 'Captain Family' : 'Member Family',
            'Registration GMK ID': p.gmkId,
            'Name': p.name,
            'Relationship': p.relationship,
            'Category': p.isAdult ? 'Adult' : (p.age > -1 ? `Child (${p.age} yrs)` : 'Child')
          });
        });
      };
      
      teamReportData.forEach(({ team, captainGroup, memberGroups }) => {
        if (captainGroup) processGroup(team, captainGroup, true);
        memberGroups.forEach(g => processGroup(team, g, false));
      });
      
      if (rows.length > 0) sections.push({ title: '', rows });
    } else {
      if (activeBracketId === 'all') {
        const rows: any[] = [];
        let sno = 1;
        
        const processGroup = (team: EventTeam, group: any, isCaptainFam: boolean) => {
          if (!group) return;
          group.people.forEach((p: any) => {
            if (p.isAdult) return;
            rows.push({
              'S.NO.': sno++,
              'Team Name': team.teamName,
              'Role / Source': isCaptainFam ? 'Captain Family' : 'Member Family',
              'Registration GMK ID': p.gmkId,
              'Name': p.name,
              'Relationship': p.relationship,
              'Category': `Child (${p.age > -1 ? p.age + ' yrs' : '?'})`
            });
          });
        };
        
        teamReportData.forEach(({ team, captainGroup, memberGroups }) => {
          if (captainGroup) processGroup(team, captainGroup, true);
          memberGroups.forEach(g => processGroup(team, g, false));
        });
        
        if (rows.length > 0) sections.push({ title: '', rows });
      } else {
        const targetBrackets = brackets.filter(b => b.id === activeBracketId);
        
        targetBrackets.forEach(b => {
          const rows: any[] = [];
          let sno = 1;
          
          const processGroup = (team: EventTeam, group: any, isCaptainFam: boolean) => {
            if (!group) return;
            group.people.forEach((p: any) => {
              if (p.isAdult) return;
              if (p.age >= b.from && p.age <= b.to) {
                rows.push({
                  'S.NO.': sno++,
                  'Team Name': team.teamName,
                  'Role / Source': isCaptainFam ? 'Captain Family' : 'Member Family',
                  'Registration GMK ID': p.gmkId,
                  'Name': p.name,
                  'Relationship': p.relationship,
                  'Category': `Child (${p.age > -1 ? p.age + ' yrs' : '?'})`
                });
              }
            });
          };
          
          teamReportData.forEach(({ team, captainGroup, memberGroups }) => {
            if (captainGroup) processGroup(team, captainGroup, true);
            memberGroups.forEach(g => processGroup(team, g, false));
          });
          
          if (rows.length > 0) sections.push({ title: `KIDS ${b.from}–${b.to}`, rows });
        });
      }
    }
    
    return sections;
  }, [teamReportData, viewMode, activeBracketId, brackets]);

  // Export Logic
  const handleExportPDF = () => {
    const doc = new jsPDF();
    if (reportSections.length === 0) {
      alert("No data to export");
      return;
    }
    
    const titleTeam = selectedTeamId === 'ALL_TEAMS' ? 'ALL TEAMS' : (targetTeams[0]?.teamName || '');
    let titleFilter = viewMode.toUpperCase();
    if (viewMode === 'kids' && activeBracketId !== 'all') {
      const b = brackets.find(x => x.id === activeBracketId);
      if (b) titleFilter += ` (${b.from}-${b.to} yrs)`;
    }

    doc.setFontSize(14);
    doc.text(`Team Report: ${titleTeam} - ${titleFilter}`, 14, 15);
    
    const head = selectedTeamId === 'ALL_TEAMS' 
      ? [['S.NO.', 'Team Name', 'Role', 'GMK ID', 'Name', 'Relationship', 'Category']]
      : [['S.NO.', 'Role', 'GMK ID', 'Name', 'Relationship', 'Category']];

    let currentY = 25;

    reportSections.forEach((section, idx) => {
      if (section.title) {
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text(section.title, 14, currentY);
        currentY += 5;
      }

      const body = section.rows.map(r => {
        if (selectedTeamId === 'ALL_TEAMS') {
          return [r['S.NO.'].toString(), r['Team Name'], r['Role / Source'], r['Registration GMK ID'], r['Name'], r['Relationship'], r['Category']];
        }
        return [r['S.NO.'].toString(), r['Role / Source'], r['Registration GMK ID'], r['Name'], r['Relationship'], r['Category']];
      });

      autoTable(doc, {
        startY: currentY,
        head,
        body,
        theme: 'grid',
        styles: { fontSize: 8 },
        headStyles: { fillColor: [15, 76, 42] },
        margin: { bottom: 15 }
      });
      
      currentY = (doc as any).lastAutoTable.finalY + 15;
    });
    
    doc.save(`${titleTeam.replace(/\s+/g, '_')}_${viewMode}_Report.pdf`);
  };

  const handleExportExcel = () => {
    if (reportSections.length === 0) {
      alert("No data to export");
      return;
    }
    
    const excelData: any[] = [];
    
    reportSections.forEach(section => {
      if (section.title) {
        excelData.push({ 'S.NO.': `--- ${section.title} ---` });
      }
      section.rows.forEach(r => {
        const rowData = { ...r };
        if (selectedTeamId !== 'ALL_TEAMS') {
          delete rowData['Team Name'];
        }
        excelData.push(rowData);
      });
      excelData.push({}); // empty row for spacing
    });

    const ws = XLSX.utils.json_to_sheet(excelData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Team Report");
    
    const titleTeam = selectedTeamId === 'ALL_TEAMS' ? 'ALL_TEAMS' : (targetTeams[0]?.teamName || 'Team');
    XLSX.writeFile(wb, `${titleTeam.replace(/\s+/g, '_')}_${viewMode}_Report.xlsx`);
  };

  if (!activeEvent) {
    return (
      <div className="bg-white rounded-xl shadow-xs border border-stone-200 p-8 text-center text-stone-500 font-medium">
        Please select an event to view team reports.
      </div>
    );
  }

  if (loading) {
    return <div className="p-4 text-stone-500 font-bold text-xs">Loading team data...</div>;
  }

  if (teams.length === 0) {
    return (
      <div className="bg-stone-50 rounded-xl border border-stone-200 border-dashed p-10 text-center">
        <Users className="w-8 h-8 text-stone-300 mx-auto mb-2" />
        <h4 className="text-sm font-black text-stone-600">No Teams Found</h4>
        <p className="text-xs text-stone-500 font-medium mt-1">
          There are no teams created for this event. Manage teams in the Team Management tab.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Filter Bar */}
      <div className="bg-white rounded-xl shadow-xs border border-stone-200 p-4">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center space-x-4">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-wider text-stone-500 mb-1">Select Team</label>
              <select
                value={selectedTeamId}
                onChange={(e) => setSelectedTeamId(e.target.value)}
                className="w-48 sm:w-64 px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm font-bold text-stone-800 focus:ring-1 focus:ring-[#0f4c2a] focus:border-[#0f4c2a] outline-none"
              >
                <option value="ALL_TEAMS">ALL TEAMS</option>
                {teams.map(t => (
                  <option key={t.id} value={t.id}>{t.teamName}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex bg-stone-100 p-1 rounded-lg">
            <button
              onClick={() => setViewMode('all')}
              className={`px-4 py-1.5 text-xs font-black uppercase tracking-wider rounded-md transition-colors ${viewMode === 'all' ? 'bg-white text-[#0f4c2a] shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}
            >
              All
            </button>
            <button
              onClick={() => setViewMode('adults')}
              className={`px-4 py-1.5 text-xs font-black uppercase tracking-wider rounded-md transition-colors ${viewMode === 'adults' ? 'bg-white text-[#0f4c2a] shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}
            >
              Adults
            </button>
            <button
              onClick={() => {
                setViewMode('kids');
                setActiveBracketId('all');
              }}
              className={`px-4 py-1.5 text-xs font-black uppercase tracking-wider rounded-md transition-colors ${viewMode === 'kids' ? 'bg-white text-[#0f4c2a] shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}
            >
              Kids
            </button>
          </div>
          
          <div className="flex space-x-2 shrink-0">
            <ReportExportButton
              exportType="pdf"
              onExport={handleExportPDF}
              label="PDF"
              generatingLabel="Generating..."
              downloadedLabel="Downloaded"
              failedLabel="Failed"
              reportName={`Team Report (${viewMode})`}
              successMessage="✓ PDF report generated successfully."
              className="px-4 py-2 bg-[#0f4c2a] text-white hover:bg-emerald-800 text-xs font-black uppercase tracking-wider rounded-lg flex items-center space-x-2 shadow-xs cursor-pointer"
              icon={<Download className="w-4 h-4" />}
            />
            <ReportExportButton
              exportType="excel"
              onExport={handleExportExcel}
              label="EXCEL"
              generatingLabel="Generating..."
              downloadedLabel="Downloaded"
              failedLabel="Failed"
              reportName={`Team Report (${viewMode})`}
              successMessage="✓ Excel report generated successfully."
              className="px-4 py-2 bg-stone-800 hover:bg-stone-900 text-white text-xs font-black uppercase tracking-wider rounded-lg flex items-center space-x-2 shadow-xs cursor-pointer"
              icon={<FileSpreadsheet className="w-4 h-4 text-emerald-400" />}
            />
          </div>
        </div>
      </div>

      {/* Age Brackets for Kids view */}
      {viewMode === 'kids' && (
        <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 animate-fadeIn">
          <div className="flex items-center space-x-2 mb-3">
            <Baby className="w-5 h-5 text-indigo-600" />
            <h4 className="text-xs font-black uppercase tracking-wider text-indigo-900">Define & Customize Age Brackets</h4>
          </div>
          
          <form onSubmit={handleAddBracket} className="flex flex-wrap items-end gap-3">
            <div className="w-24">
              <label className="block text-[10px] font-bold text-indigo-700 mb-1">From Age</label>
              <input type="number" min="0" value={newFromAge} onChange={(e) => setNewFromAge(e.target.value)} className="w-full px-2 py-1.5 text-sm bg-white border border-indigo-200 rounded-md focus:ring-1 focus:ring-indigo-500 outline-none font-medium" placeholder="0" />
            </div>
            <div className="w-24">
              <label className="block text-[10px] font-bold text-indigo-700 mb-1">To Age</label>
              <input type="number" min="0" value={newToAge} onChange={(e) => setNewToAge(e.target.value)} className="w-full px-2 py-1.5 text-sm bg-white border border-indigo-200 rounded-md focus:ring-1 focus:ring-indigo-500 outline-none font-medium" placeholder="10" />
            </div>
            <button type="submit" className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-xs font-bold uppercase flex items-center space-x-1 transition-colors">
              <Plus className="w-3.5 h-3.5" />
              <span>Add Bracket</span>
            </button>
            {brackets.length > 0 && (
              <button type="button" onClick={() => setBrackets([])} className="px-3 py-1.5 bg-white border border-indigo-200 text-indigo-600 hover:bg-indigo-100 rounded-md text-xs font-bold uppercase transition-colors">
                Clear All
              </button>
            )}
          </form>
          
          {bracketError && (
            <div className="mt-2 text-[10px] font-bold text-rose-600 flex items-center space-x-1 bg-white px-2 py-1 inline-flex rounded-md border border-rose-200">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>{bracketError}</span>
            </div>
          )}

          {brackets.length > 0 && (
            <div className="mt-6 flex flex-wrap gap-4">
              <button
                type="button"
                onClick={() => setActiveBracketId('all')}
                className={`relative flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all min-w-[100px] ${activeBracketId === 'all' ? 'bg-indigo-600 border-indigo-600 text-white shadow-md scale-105' : 'bg-white border-indigo-100 text-indigo-800 hover:border-indigo-300 hover:bg-indigo-50'}`}
              >
                <span className="text-[10px] font-black uppercase tracking-wider mb-1 opacity-90">ALL AGES</span>
                <span className="text-2xl font-black">{bracketCounts.allKids}</span>
              </button>
              
              {brackets.map(b => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setActiveBracketId(b.id)}
                  className={`relative group flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all min-w-[100px] ${activeBracketId === b.id ? 'bg-indigo-600 border-indigo-600 text-white shadow-md scale-105' : 'bg-white border-indigo-100 text-indigo-800 hover:border-indigo-300 hover:bg-indigo-50'}`}
                >
                  <span className="text-[10px] font-black uppercase tracking-wider mb-1 opacity-90">KIDS {b.from}–{b.to}</span>
                  <span className="text-2xl font-black">{bracketCounts.counts[b.id]}</span>
                  
                  <div 
                    onClick={(e) => { 
                      e.stopPropagation(); 
                      setBrackets(prev => prev.filter(x => x.id !== b.id)); 
                      if (activeBracketId === b.id) setActiveBracketId('all'); 
                    }} 
                    className="absolute -top-2 -right-2 bg-white rounded-full p-1.5 text-stone-400 hover:text-rose-500 hover:bg-rose-50 border border-stone-200 shadow-sm transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Report Content */}
      {targetTeams.length > 0 && reportSections.length > 0 && reportSections.some(s => s.rows.length > 0) ? (
        <div className="space-y-8">
          {reportSections.map((section, sIdx) => {
            if (section.rows.length === 0) return null;
            return (
              <div key={sIdx} className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-xs">
                {section.title && (
                   <div className="px-4 py-3 bg-indigo-50 border-b border-indigo-100 font-black text-indigo-900 tracking-wider text-sm flex items-center justify-between">
                      <span>{section.title}</span>
                      <span className="text-xs bg-white text-indigo-700 px-2 py-1 rounded-md shadow-sm border border-indigo-100">{section.rows.length} {section.rows.length === 1 ? 'Child' : 'Children'}</span>
                   </div>
                )}
                <div className="overflow-x-auto hide-scrollbar">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-stone-50 border-b border-stone-200 text-[10px] font-black uppercase tracking-wider text-stone-500">
                      <tr>
                        <th className="px-4 py-3">S.NO.</th>
                        {selectedTeamId === 'ALL_TEAMS' && <th className="px-4 py-3">Team Name</th>}
                        <th className="px-4 py-3">Role</th>
                        <th className="px-4 py-3 whitespace-nowrap">GMK ID</th>
                        <th className="px-4 py-3 min-w-[150px]">Name</th>
                        <th className="px-4 py-3">Relationship</th>
                        <th className="px-4 py-3">Category</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {targetTeams.map((team) => {
                        const teamRows = section.rows.filter(r => r['Team Name'] === team.teamName);
                        if (teamRows.length === 0) return null;
                        
                        return (
                          <React.Fragment key={team.id}>
                            {selectedTeamId === 'ALL_TEAMS' && (
                              <tr className="bg-stone-100/80">
                                <td colSpan={7} className="px-4 py-2 font-black text-xs text-[#0f4c2a] uppercase tracking-wider border-y border-stone-200 bg-[#0f4c2a]/5">
                                  {team.teamName}
                                </td>
                              </tr>
                            )}
                            {teamRows.map((row, i) => (
                              <tr key={`${team.id}_${i}`} className="hover:bg-stone-50/50">
                                <td className="px-4 py-3 text-stone-500 font-bold">{row['S.NO.']}</td>
                                {selectedTeamId === 'ALL_TEAMS' && <td className="px-4 py-3 font-bold text-stone-800">{row['Team Name']}</td>}
                                <td className="px-4 py-3 text-[10px] font-black uppercase tracking-wider text-stone-500">{row['Role / Source']}</td>
                                <td className="px-4 py-3 font-medium text-stone-600 whitespace-nowrap">{row['Registration GMK ID']}</td>
                                <td className="px-4 py-3 font-bold text-stone-800">{row['Name']}</td>
                                <td className="px-4 py-3 text-[10px] font-black uppercase tracking-wider text-stone-500">{row['Relationship']}</td>
                                <td className="px-4 py-3">
                                  <span className={`px-2 py-1 rounded text-[10px] font-black uppercase tracking-wider whitespace-nowrap ${row['Category'] === 'Adult' ? 'bg-stone-100 text-stone-600' : 'bg-indigo-50 border border-indigo-100 text-indigo-700'}`}>
                                    {row['Category']}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        targetTeams.length > 0 && (
          <div className="p-8 text-center text-stone-500 font-bold text-sm bg-stone-50 rounded-xl border border-stone-200 border-dashed">
            No participants match the selected filters.
          </div>
        )
      )}
    </div>
  );
}
