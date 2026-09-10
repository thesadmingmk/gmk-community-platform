import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { collection, query, where, onSnapshot, doc, getDocs, runTransaction } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, auth, functions } from '../../context/AuthContext';
import { 
  CommunityEvent, 
  EventCommittee, 
  EventScanner, 
  EventRegistration, 
  EventAttendance, 
  Family, 
  FamilyMember 
} from '../../types';
import { 
  getRegistrationDisplayId, 
  formatExternalGmkId 
} from '../../utils/gmkIdHelper';
import { processFamilyCheckInCompletion } from '../../services/familyCheckInService';
import { Check, Search, XCircle, Shield, AlertCircle, LogOut } from 'lucide-react';

export default function EventScannerApp() {
  // Authentication & Scanner State
  const [pinInput, setPinInput] = useState('');
  const [activeScanner, setActiveScanner] = useState<EventScanner | null>(null);
  const [activeEvent, setActiveEvent] = useState<CommunityEvent | null>(null);
  
  // Data State
  const [events, setEvents] = useState<CommunityEvent[]>([]);
  
  // RTCO State (only loaded after scanner activation)
  const [registrations, setRegistrations] = useState<EventRegistration[]>([]);
  const [attendances, setAttendances] = useState<EventAttendance[]>([]);
  const [families, setFamilies] = useState<Family[]>([]);
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([]);
  
  // Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedReg, setSelectedReg] = useState<EventRegistration | null>(null);
  
  // Check-in State
  const [selectedMembers, setSelectedMembers] = useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [showExitFullscreen, setShowExitFullscreen] = useState(false);

  useEffect(() => {
    const handleFullscreenChange = () => { if (!document.fullscreenElement) setShowExitFullscreen(false); };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const handleEmptyTap = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && document.fullscreenElement) {
      setShowExitFullscreen(true);
      setTimeout(() => setShowExitFullscreen(false), 3000);
    }
  };

  const handleExitFullscreen = () => {
    if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
    setShowExitFullscreen(false);
  };

  // 1. Initial Load: Fetch active events to verify PIN against
  useEffect(() => {
    const qEvents = query(collection(db, 'events'), where('status', 'in', ['published', 'draft']));
    const unsubEvents = onSnapshot(qEvents, snap => {
      setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() } as CommunityEvent)));
    });

    return () => {
      unsubEvents();
    };
  }, []);

  // 2. Load RTCO data once authenticated
  useEffect(() => {
    if (!activeScanner || !activeEvent) return;

    const qRegs = query(collection(db, 'event_registrations'), where('eventId', '==', activeEvent.id));
    const unsubRegs = onSnapshot(qRegs, snap => {
      setRegistrations(snap.docs.map(d => ({ id: d.id, ...d.data() } as EventRegistration)));
    });

    const qAtt = query(collection(db, 'eventAttendance'), where('eventId', '==', activeEvent.id));
    const unsubAtt = onSnapshot(qAtt, snap => {
      setAttendances(snap.docs.map(d => ({ id: d.id, ...d.data() } as EventAttendance)));
    });

    const unsubFam = onSnapshot(collection(db, 'families'), snap => {
      setFamilies(snap.docs.map(d => ({ id: d.id, ...d.data() } as Family)));
    });

    const unsubMem = onSnapshot(collection(db, 'familyMembers'), snap => {
      setFamilyMembers(snap.docs.map(d => ({ id: d.id, ...d.data() } as FamilyMember)));
    });

    return () => {
      unsubRegs();
      unsubAtt();
      unsubFam();
      unsubMem();
    };
  }, [activeScanner, activeEvent]);

  // Handle PIN Submission
  const handlePinLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setIsSubmitting(true);
    
    try {
      const resolveScannerPin = httpsCallable(functions, 'resolveScannerPin');
      const result = await resolveScannerPin({ pin: pinInput });
      const data = result.data as any;

      const evt = events.find(e => e.id === data.eventId);
      if (evt) {
        setActiveScanner({ id: data.scannerId, name: data.scannerName, pin: pinInput, isActive: true, eventId: data.eventId } as EventScanner);
        setActiveEvent(evt);
        setPinInput('');
        try { if (document.documentElement.requestFullscreen) { document.documentElement.requestFullscreen().catch(() => {}); } } catch (e) {}
      } else {
        setErrorMsg('EVENT NOT FOUND');
      }
    } catch (error: any) {
      if (error.message === 'SCANNER INACTIVE') {
        setErrorMsg('SCANNER INACTIVE');
      } else if (error.message === 'INVALID SCANNER PIN' || error.message.includes('NOT FOUND')) {
        setErrorMsg('INVALID SCANNER PIN');
      } else {
        setErrorMsg(error.message || 'LOGIN FAILED');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = () => {
    setActiveScanner(null);
    setActiveEvent(null);
    setSearchQuery('');
    setSelectedReg(null);
    setSelectedMembers({});
    setSuccessMsg('');
    setErrorMsg('');
  };

  // Participant Details extraction
  const getParticipantDetails = useCallback((reg: EventRegistration) => {
    const gmkId = getRegistrationDisplayId(reg) || reg.primaryMemberGmkId || '';
    
    const fam = families.find(f => 
      f.id === reg.familyId || 
      f.id === `fam_${gmkId}` ||
      (gmkId && f.primaryMemberGmkId === gmkId) || 
      (reg.primaryMemberEmail && f.primaryMemberEmail?.toLowerCase() === reg.primaryMemberEmail.toLowerCase())
    );
    
    const relevantFamilyMembers = familyMembers.filter(m => 
      m.familyId === reg.familyId || 
      (fam && m.familyId === fam.id) || 
      (fam && m.familyId === `fam_${fam.primaryMemberGmkId}`) ||
      (gmkId && m.familyId === `fam_${gmkId}`)
    );
    
    const primaryMemberName = fam?.fullName || reg.primaryRegistrantName || (reg.primaryMemberEmail ? reg.primaryMemberEmail.split('@')[0] : 'Unknown');
    const participants = reg.participants || [];
    
    const adults: { name: string, category: string, age: number }[] = [];
    const children: { name: string, category: string, age: number }[] = [];
    
    participants.forEach(rawName => {
      const name = (rawName || '').trim();
      if (!name) return;
      const lower = name.toLowerCase();

      let category = 'Other';
      const primaryLower = primaryMemberName.trim().toLowerCase();
      const spouseLower = (fam?.spouseName || '').trim().toLowerCase();

      if (primaryLower && (lower === primaryLower || primaryLower.includes(lower) || lower.includes(primaryLower))) {
        category = 'GMK Member';
      } else if ((spouseLower && (lower === spouseLower || spouseLower.includes(lower) || lower.includes(spouseLower))) ||
        relevantFamilyMembers.some(m => m.relationship === 'spouse' && m.name.trim().toLowerCase() === lower)) {
        category = 'Spouse';
      } else if (relevantFamilyMembers.some(m => m.relationship === 'child' && m.name.trim().toLowerCase() === lower)) {
        category = 'Child';
      } else if (reg.participantDetails?.some(d => d.name.trim().toLowerCase() === lower)) {
        const detail = reg.participantDetails.find(d => d.name.trim().toLowerCase() === lower);
        if (detail?.role === 'primary' || detail?.role === 'single') category = 'GMK Member';
        else if (detail?.role === 'spouse') category = 'Spouse';
        else if (detail?.role === 'child') category = 'Child';
        else if (detail?.role === 'parent') category = 'Parent';
        else category = 'Other';
      } else if (relevantFamilyMembers.some(m => m.relationship === 'parent' && m.name.trim().toLowerCase() === lower) ||
        (reg as any).paymentSummary?.parentMembers?.some((p: any) => p.trim().toLowerCase() === lower)) {
        category = 'Parent';
      }

      if (category === 'Child') {
        children.push({ name, category, age: 10 });
      } else {
        adults.push({ name, category, age: 30 });
      }
    });

    const isExternalGmkId = (id?: string | null) => id ? id.toLowerCase().startsWith('ext-') : false;
    const isExt = reg.isExternal || isExternalGmkId(reg.publicReference) || isExternalGmkId(reg.primaryMemberGmkId);

    if (isExt) {
      const externalCount = (reg.totalParticipants || 0) - participants.length;
      for (let i = 0; i < externalCount; i++) {
        adults.push({ name: `Guest/External ${i+1}`, category: 'Other', age: 30 });
      }
    } else {
      const explicitExternalCount = (reg as any).paymentSummary?.externalParticipantsCount || 0;
      for (let i = 0; i < explicitExternalCount; i++) {
        adults.push({ name: `External Guest ${i+1}`, category: 'Other', age: 30 });
      }
    }

    return { adults, children };
  }, [families, familyMembers]);

  // Search Logic
  const searchResults = useMemo(() => {
    if (!searchQuery || searchQuery.length < 2) return [];
    
    const queryLower = searchQuery.toLowerCase().trim();
    
    // Only search approved non-external, or external if they have GMK ID
    const validRegs = registrations.filter(r => !r.isExternal || r.adminReviewStatus === 'approved');

    const results: { reg: EventRegistration; displayNames: string; displayCategory: string }[] = [];

    validRegs.forEach(r => {
      const gmkId = getRegistrationDisplayId(r) || r.primaryMemberGmkId || '';
      const dispIdLower = gmkId.toLowerCase();
      
      const { adults, children } = getParticipantDetails(r);
      const allParticipants = [...adults, ...children];
      
      // Match individual names
      const matchedParticipants = allParticipants.filter(p => p.name.toLowerCase().includes(queryLower));
      
      const isGmkIdMatch = dispIdLower.includes(queryLower);
      
      if (matchedParticipants.length > 0) {
        // If names matched, display the exact matched names and their categories
        const displayNames = matchedParticipants.map(p => p.name).join(', ');
        const categories = Array.from(new Set(matchedParticipants.map(p => p.category))).join(' / ');
        
        results.push({
          reg: r,
          displayNames,
          displayCategory: categories
        });
      } else if (isGmkIdMatch) {
        // If GMK ID matched, fallback to primary member
        const primaryParticipant = allParticipants.find(p => p.category === 'GMK Member') || allParticipants[0];
        const fam = families.find(f => f.id === r.familyId || f.id === `fam_${gmkId}`);
        const fallbackName = primaryParticipant?.name || fam?.fullName || r.primaryRegistrantName || r.primaryMemberEmail || 'GMK Member';
        const fallbackCategory = primaryParticipant?.category || 'GMK Member';

        results.push({
          reg: r,
          displayNames: fallbackName,
          displayCategory: fallbackCategory
        });
      } else {
        // Last fallback: Family name or email matches
        const fam = families.find(f => f.id === r.familyId || f.id === `fam_${gmkId}`);
        const famName = (fam?.fullName || '').toLowerCase();
        const primEmail = (r.primaryMemberEmail || '').toLowerCase();
        
        if (famName.includes(queryLower) || primEmail.includes(queryLower)) {
          const primaryParticipant = allParticipants.find(p => p.category === 'GMK Member') || allParticipants[0];
          const fallbackName = primaryParticipant?.name || fam?.fullName || r.primaryRegistrantName || 'GMK Member';
          const fallbackCategory = primaryParticipant?.category || 'GMK Member';
          
          results.push({
            reg: r,
            displayNames: fallbackName,
            displayCategory: fallbackCategory
          });
        }
      }
    });

    return results;
  }, [searchQuery, registrations, families, getParticipantDetails]);

  // Check-In Logic
  const handleCheckIn = async () => {
    if (!selectedReg || !activeEvent || !activeScanner) return;
    
    const gmkId = getRegistrationDisplayId(selectedReg) || selectedReg.primaryMemberGmkId || formatExternalGmkId(selectedReg.publicReference) || selectedReg.publicReference || selectedReg.id.split('_')?.[1] || selectedReg.id;
    if (!gmkId) {
      setErrorMsg("Missing GMK ID.");
      return;
    }

    const { adults, children } = getParticipantDetails(selectedReg);
    const allParticipants = [...adults, ...children];
    const newlySelected = allParticipants.filter(p => selectedMembers[p.name]);

    if (newlySelected.length === 0) {
      setErrorMsg("Select at least one member.");
      return;
    }

    setIsSubmitting(true);
    setErrorMsg('');

    try {
      const attRef = doc(db, 'eventAttendance', `att_${gmkId}_${activeEvent.id}`);
      
      let finalArrivedDetails: any[] = [];
      let finalAttendanceState: any = null;
      let newlyAddedCount = 0;

      await runTransaction(db, async (transaction) => {
        const docSnap = await transaction.get(attRef);
        const existingData = docSnap.exists() ? docSnap.data() : {};
        const existingArrivedDetails = existingData.arrivedDetails || [];

        const nowStr = new Date().toISOString();
        
        // Filter out those already checked in based on the transaction snapshot
        const actualNewSelections = newlySelected.filter(
          p => !existingArrivedDetails.some((e: any) => e.name === p.name)
        );

        newlyAddedCount = actualNewSelections.length;

        if (actualNewSelections.length === 0 && existingArrivedDetails.length > 0) {
          finalArrivedDetails = existingArrivedDetails;
          finalAttendanceState = existingData;
          return;
        }

        const newArrivedDetails = actualNewSelections.map(p => ({
          name: p.name,
          category: p.category,
          arrivedAt: nowStr,
          scannedBy: activeScanner.name // Preserves SCANNER 1 identity if deleted
        }));

        finalArrivedDetails = [...existingArrivedDetails, ...newArrivedDetails];
        const isFullyEntered = finalArrivedDetails.length >= (selectedReg.totalParticipants || 1);

        const updateData = {
          id: `att_${gmkId}_${activeEvent.id}`,
          eventId: activeEvent.id,
          committeeKey: 'attendance',
          primaryMemberGmkId: gmkId,
          status: isFullyEntered ? 'attended' : 'checked_in',
          attendedAt: nowStr,
          scannedBy: activeScanner.name, // Preserves SCANNER 1 identity if deleted
          totalParticipants: selectedReg.totalParticipants || 1,
          totalAttended: finalArrivedDetails.length,
          entryPassNumber: selectedReg.entryPassNumber || `PASS-${activeEvent.id.slice(-6).toUpperCase()}-${gmkId}`,
          arrivedDetails: finalArrivedDetails
        };
        
        finalAttendanceState = { ...existingData, ...updateData };
        transaction.set(attRef, updateData, { merge: true });
      });

      // Trigger identical email completion
      try {
        await processFamilyCheckInCompletion({
          reg: selectedReg,
          activeEvent,
          combinedArrivedDetails: finalArrivedDetails,
          existingAttendance: finalAttendanceState as EventAttendance,
          families,
          familyMembers
        });
      } catch (err) {
        console.error("Non-blocking email error:", err);
      }

      setSuccessMsg(`CHECK-IN COMPLETE\n${newlyAddedCount || newlySelected.length} MEMBERS CHECKED IN`);
      
      // Automatic Reset after 2 seconds
      setTimeout(() => {
        setSuccessMsg('');
        setSelectedReg(null);
        setSearchQuery('');
        setSelectedMembers({});
        // Attempt to refocus search box
        document.getElementById('scanner-search-input')?.focus();
      }, 2000);

    } catch (err: any) {
      setErrorMsg(err.message || 'Check-in failed');
    } finally {
      setIsSubmitting(false);
    }
  };



  // -------------------------------------------------------------
  // RENDER: LOGIN SCREEN
  // -------------------------------------------------------------
  if (!activeScanner) {
    return (
      <div className="min-h-screen bg-stone-50 text-stone-900 flex flex-col items-center justify-center p-6 font-sans">
        <div className="w-full max-w-sm space-y-8 animate-fadeIn">
          <div className="text-center space-y-2">
            <Shield className="w-12 h-12 text-emerald-600 mx-auto mb-4" />
            <h1 className="text-3xl font-black tracking-tight text-stone-900 uppercase">GMK Event Scanner</h1>
            <p className="text-stone-500 font-bold uppercase tracking-widest text-[10px]">Gate Check-In Mode</p>
          </div>

          <form onSubmit={handlePinLogin} className="space-y-4 bg-white p-6 rounded-3xl border border-stone-200 shadow-sm">
            <div className="text-center">
              <label className="block text-xs font-bold text-stone-500 uppercase tracking-widest mb-4">Enter Scanner PIN</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ''))}
                className="w-full bg-stone-50 border-2 border-stone-200 rounded-2xl text-center text-4xl font-black text-emerald-600 tracking-[0.5em] py-4 outline-none focus:border-emerald-500 transition-colors"
                autoFocus
              />
            </div>
            
            {errorMsg && (
              <div className="bg-red-50 text-red-600 text-xs font-bold text-center p-3 rounded-xl border border-red-200">
                {errorMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={pinInput.length !== 4}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-black text-sm uppercase tracking-widest py-4 rounded-xl transition-all shadow-lg active:scale-95"
            >
              Start Scanner
            </button>
          </form>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // RENDER: SUCCESS STATE
  // -------------------------------------------------------------
  if (successMsg) {
    return (
      <div className="min-h-screen bg-emerald-50 flex flex-col items-center justify-center p-6 font-sans animate-fadeIn relative" onClick={handleEmptyTap}>
        {showExitFullscreen && (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 animate-fadeIn">
            <button onClick={handleExitFullscreen} className="bg-stone-900/90 backdrop-blur-sm text-white px-6 py-3 rounded-full text-xs font-black uppercase tracking-widest shadow-2xl border border-stone-700 active:scale-95 transition-all">
              Exit Full Screen
            </button>
          </div>
        )}

        <div className="text-center space-y-6">
          <div className="w-24 h-24 bg-emerald-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-[0_0_50px_rgba(16,185,129,0.3)]">
            <Check className="w-12 h-12 text-white stroke-[3]" />
          </div>
          <h2 className="text-3xl font-black tracking-tight text-emerald-900 whitespace-pre-line leading-tight">
            {successMsg}
          </h2>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // RENDER: SCREEN 2 (FAMILY MEMBER CHECK-IN)
  // -------------------------------------------------------------
  if (selectedReg) {
    const gmkId = getRegistrationDisplayId(selectedReg) || selectedReg.id;
    const { adults, children } = getParticipantDetails(selectedReg);
    const allParticipants = [...adults, ...children];
    
    const existingAtt = attendances.find(a => (a as any).primaryMemberGmkId === gmkId || a.id === `att_${gmkId}_${activeEvent?.id}`);
    const arrivedDetails = (existingAtt as any)?.arrivedDetails || [];
    const arrivedNames = new Set(arrivedDetails.map((a: any) => a.name));

    const selectedCount = Object.values(selectedMembers).filter(Boolean).length;

    return (
      <div className="min-h-screen bg-stone-50 text-stone-900 p-4 font-sans flex flex-col relative" onClick={handleEmptyTap}>
        {showExitFullscreen && (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 animate-fadeIn">
            <button onClick={handleExitFullscreen} className="bg-stone-900/90 backdrop-blur-sm text-white px-6 py-3 rounded-full text-xs font-black uppercase tracking-widest shadow-2xl border border-stone-700 active:scale-95 transition-all">
              Exit Full Screen
            </button>
          </div>
        )}

        <div className="flex items-center justify-between mb-6 pb-4 border-b border-stone-200">
          <div>
            <h2 className="text-2xl font-black text-stone-900">{gmkId}</h2>
            <p className="text-xs text-stone-500 font-bold uppercase tracking-wider">Family Members ({allParticipants.length})</p>
          </div>
          <button onClick={() => { setSelectedReg(null); setSearchQuery(''); }} className="p-3 bg-white border border-stone-200 rounded-xl hover:bg-stone-100 transition-colors">
            <XCircle className="w-6 h-6 text-stone-500" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto pb-24">
          {allParticipants.map((p, idx) => {
            const isArrived = arrivedNames.has(p.name);
            const isSelected = !!selectedMembers[p.name];
            
            if (isArrived) {
              return (
                <div key={idx} className="bg-emerald-50 border border-emerald-200 p-4 rounded-2xl flex items-center gap-4">
                  <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
                    <Check className="w-5 h-5 text-emerald-600" />
                  </div>
                  <div>
                    <div className="text-lg font-bold text-emerald-800">{p.name}</div>
                    <div className="text-[10px] text-emerald-600 font-bold uppercase tracking-wider">Already checked in</div>
                  </div>
                </div>
              );
            }

            return (
              <button
                key={idx}
                onClick={() => setSelectedMembers(prev => ({ ...prev, [p.name]: !prev[p.name] }))}
                className={`w-full text-left p-4 rounded-2xl border-2 transition-all flex items-center gap-4 ${isSelected ? 'bg-emerald-50 border-emerald-500' : 'bg-white border-stone-200 active:bg-stone-50'}`}
              >
                <div className={`w-8 h-8 rounded-lg border-2 flex items-center justify-center shrink-0 transition-colors ${isSelected ? 'bg-emerald-500 border-emerald-500' : 'border-stone-300'}`}>
                  {isSelected && <Check className="w-5 h-5 text-white stroke-[3]" />}
                </div>
                <div>
                  <div className={`text-lg font-bold ${isSelected ? 'text-emerald-900' : 'text-stone-700'}`}>{p.name}</div>
                  <div className="text-[10px] text-stone-500 font-bold uppercase tracking-wider">{p.category}</div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="fixed bottom-0 left-0 right-0 p-4 bg-stone-50/90 backdrop-blur-md border-t border-stone-200">
          {errorMsg && (
            <div className="mb-4 text-center text-xs font-bold text-red-600 bg-red-50 border border-red-200 p-2 rounded-xl">
              {errorMsg}
            </div>
          )}
          <button
            onClick={handleCheckIn}
            disabled={selectedCount === 0 || isSubmitting}
            className="w-full py-5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:bg-stone-300 disabled:text-stone-500 text-white font-black text-lg uppercase tracking-widest rounded-2xl shadow-lg active:scale-[0.98] transition-all"
          >
            {isSubmitting ? 'Processing...' : 'Confirm Check-In'}
          </button>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // RENDER: SCREEN 1 (SEARCH)
  // -------------------------------------------------------------
  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 flex flex-col font-sans relative" onClick={handleEmptyTap}>
      {showExitFullscreen && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 animate-fadeIn">
          <button onClick={handleExitFullscreen} className="bg-stone-900/90 backdrop-blur-sm text-white px-6 py-3 rounded-full text-xs font-black uppercase tracking-widest shadow-2xl border border-stone-700 active:scale-95 transition-all">
            Exit Full Screen
          </button>
        </div>
      )}

      <div className="bg-white p-4 flex items-center justify-between border-b border-stone-200 shadow-sm">
        <div>
          <h1 className="text-xs font-black text-stone-900 uppercase tracking-widest">GMK Event Scanner</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">{activeScanner.name} &bull; Gate Check-In</span>
            <span className="bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest border border-emerald-200 flex items-center gap-1.5 ml-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              LIVE
            </span>
          </div>
        </div>
        <button onClick={handleLogout} className="p-2 text-stone-500 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition-colors">
          <LogOut className="w-5 h-5" />
        </button>
      </div>

      <div className="p-4 flex-1 flex flex-col">
        <div className="relative mb-6 shadow-sm rounded-3xl">
          <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
            <Search className="h-6 w-6 text-emerald-600" />
          </div>
          <input
            id="scanner-search-input"
            type="text"
            placeholder="ENTER GMK ID OR NAME..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white border-2 border-stone-200 rounded-3xl pl-14 pr-12 py-5 text-xl font-black text-stone-900 placeholder-stone-400 outline-none focus:border-emerald-500 transition-colors uppercase"
            autoComplete="off"
            autoCorrect="off"
            spellCheck="false"
          />
          {searchQuery && (
            <button 
              onClick={() => setSearchQuery('')}
              className="absolute inset-y-0 right-4 flex items-center justify-center p-2 text-stone-400 hover:text-stone-600 transition-colors"
              type="button"
            >
              <XCircle className="w-6 h-6" />
            </button>
          )}
        </div>

        {searchQuery.length > 0 && searchQuery.length < 2 && (
          <div className="text-center p-8 text-stone-500 font-bold uppercase tracking-wider text-xs">
            Type at least 2 characters...
          </div>
        )}

        {searchQuery.length >= 2 && searchResults.length === 0 && (
          <div className="text-center p-8 border-2 border-dashed border-stone-300 rounded-3xl mt-4 bg-white">
            <AlertCircle className="w-10 h-10 text-stone-400 mx-auto mb-3" />
            <h3 className="text-sm font-black uppercase text-stone-500 tracking-wider">No Match Found</h3>
          </div>
        )}

        {searchQuery.length >= 2 && searchResults.length > 0 && (
          <div className="space-y-3 pb-6 flex-1 overflow-y-auto">
            <div className="text-[10px] font-bold text-stone-500 uppercase tracking-widest pl-2">
              {searchResults.length} matching residents
            </div>
            
            {searchResults.map((result, idx) => {
              const { reg, displayNames, displayCategory } = result;
              const gmkId = getRegistrationDisplayId(reg) || reg.primaryMemberGmkId || reg.id;
              
              return (
                <button
                  key={`${reg.id}-${idx}`}
                  onClick={() => setSelectedReg(reg)}
                  className="w-full text-left bg-white border-2 border-stone-100 hover:border-emerald-200 p-5 rounded-2xl flex items-center justify-between active:bg-stone-50 transition-colors group shadow-sm"
                >
                  <div>
                    <div className="text-lg font-bold text-stone-900">{displayNames}</div>
                    <div className="text-xs text-stone-500 font-bold uppercase tracking-wider mt-0.5 mb-0.5">{displayCategory}</div>
                    <div className="text-xs text-emerald-600 font-black uppercase tracking-wider">{gmkId}</div>
                  </div>
                  <div className="bg-stone-100 px-4 py-2 rounded-xl text-[10px] font-black text-stone-600 uppercase tracking-widest group-hover:bg-emerald-50 group-hover:text-emerald-700 transition-colors">
                    Select
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
