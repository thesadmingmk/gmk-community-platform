import React, { useState, useEffect, useMemo } from 'react';
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

  // Search Logic
  const searchResults = useMemo(() => {
    if (!searchQuery || searchQuery.length < 2) return [];
    
    const queryLower = searchQuery.toLowerCase().trim();
    
    // Only search approved non-external, or external if they have GMK ID
    const validRegs = registrations.filter(r => !r.isExternal || r.adminReviewStatus === 'approved');

    return validRegs.filter(r => {
      const dispId = getRegistrationDisplayId(r)?.toLowerCase() || '';
      const primName = (r.primaryRegistrantName || r.primaryMemberEmail || '').toLowerCase();
      return dispId.includes(queryLower) || primName.includes(queryLower);
    });
  }, [searchQuery, registrations]);

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
      
      const isPrimary = (name.trim().toLowerCase() === (fam?.fullName || reg.primaryMemberEmail || '').trim().toLowerCase());
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

    return { adults, children };
  };

  // -------------------------------------------------------------
  // RENDER: LOGIN SCREEN
  // -------------------------------------------------------------
  if (!activeScanner) {
    return (
      <div className="min-h-screen bg-stone-950 text-stone-100 flex flex-col items-center justify-center p-6 font-sans">
        <div className="w-full max-w-sm space-y-8 animate-fadeIn">
          <div className="text-center space-y-2">
            <Shield className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
            <h1 className="text-3xl font-black tracking-tight text-white uppercase">GMK Event Scanner</h1>
            <p className="text-stone-400 font-bold uppercase tracking-widest text-[10px]">Gate Check-In Mode</p>
          </div>

          <form onSubmit={handlePinLogin} className="space-y-4 bg-stone-900 p-6 rounded-3xl border border-stone-800">
            <div className="text-center">
              <label className="block text-xs font-bold text-stone-400 uppercase tracking-widest mb-4">Enter Scanner PIN</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ''))}
                className="w-full bg-stone-950 border-2 border-stone-800 rounded-2xl text-center text-4xl font-black text-emerald-400 tracking-[0.5em] py-4 outline-none focus:border-emerald-500 transition-colors"
                autoFocus
              />
            </div>
            
            {errorMsg && (
              <div className="bg-red-900/30 text-red-400 text-xs font-bold text-center p-3 rounded-xl border border-red-900/50">
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
      <div className="min-h-screen bg-[#0A1A10] text-emerald-50 flex flex-col items-center justify-center p-6 font-sans animate-fadeIn">
        <div className="text-center space-y-6">
          <div className="w-24 h-24 bg-emerald-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-[0_0_50px_rgba(16,185,129,0.3)]">
            <Check className="w-12 h-12 text-white stroke-[3]" />
          </div>
          <h2 className="text-3xl font-black tracking-tight whitespace-pre-line leading-tight">
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
      <div className="min-h-screen bg-stone-950 text-stone-100 p-4 font-sans flex flex-col">
        <div className="flex items-center justify-between mb-6 pb-4 border-b border-stone-800">
          <div>
            <h2 className="text-2xl font-black text-white">{gmkId}</h2>
            <p className="text-xs text-stone-400 font-bold uppercase tracking-wider">Family Members ({allParticipants.length})</p>
          </div>
          <button onClick={() => setSelectedReg(null)} className="p-3 bg-stone-900 rounded-xl">
            <XCircle className="w-6 h-6 text-stone-400" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto pb-24">
          {allParticipants.map((p, idx) => {
            const isArrived = arrivedNames.has(p.name);
            const isSelected = !!selectedMembers[p.name];
            
            if (isArrived) {
              return (
                <div key={idx} className="bg-emerald-950/30 border border-emerald-900/50 p-4 rounded-2xl flex items-center gap-4 opacity-75">
                  <div className="w-8 h-8 rounded-lg bg-emerald-900 flex items-center justify-center shrink-0">
                    <Check className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div>
                    <div className="text-lg font-bold text-emerald-400">{p.name}</div>
                    <div className="text-[10px] text-emerald-600 font-bold uppercase tracking-wider">Already checked in</div>
                  </div>
                </div>
              );
            }

            return (
              <button
                key={idx}
                onClick={() => setSelectedMembers(prev => ({ ...prev, [p.name]: !prev[p.name] }))}
                className={`w-full text-left p-4 rounded-2xl border-2 transition-all flex items-center gap-4 ${isSelected ? 'bg-stone-800 border-emerald-500' : 'bg-stone-900 border-stone-800 active:bg-stone-800'}`}
              >
                <div className={`w-8 h-8 rounded-lg border-2 flex items-center justify-center shrink-0 transition-colors ${isSelected ? 'bg-emerald-500 border-emerald-500' : 'border-stone-600'}`}>
                  {isSelected && <Check className="w-5 h-5 text-white stroke-[3]" />}
                </div>
                <div>
                  <div className={`text-lg font-bold ${isSelected ? 'text-white' : 'text-stone-300'}`}>{p.name}</div>
                  <div className="text-[10px] text-stone-500 font-bold uppercase tracking-wider">{p.category}</div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="fixed bottom-0 left-0 right-0 p-4 bg-stone-950/90 backdrop-blur-md border-t border-stone-800">
          {errorMsg && (
            <div className="mb-4 text-center text-xs font-bold text-red-400 bg-red-950/30 p-2 rounded-xl">
              {errorMsg}
            </div>
          )}
          <button
            onClick={handleCheckIn}
            disabled={selectedCount === 0 || isSubmitting}
            className="w-full py-5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:bg-stone-800 text-white font-black text-lg uppercase tracking-widest rounded-2xl shadow-lg active:scale-[0.98] transition-all"
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
    <div className="min-h-screen bg-stone-950 text-stone-100 flex flex-col font-sans">
      <div className="bg-stone-900 p-4 flex items-center justify-between border-b border-stone-800">
        <div>
          <h1 className="text-xs font-black text-white uppercase tracking-widest">GMK Event Scanner</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">{activeScanner.name} &bull; Gate Check-In</span>
          </div>
        </div>
        <button onClick={handleLogout} className="p-2 text-stone-500 hover:text-stone-300">
          <LogOut className="w-5 h-5" />
        </button>
      </div>

      <div className="p-4 flex-1 flex flex-col">
        <div className="relative mb-6">
          <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
            <Search className="h-6 w-6 text-emerald-500" />
          </div>
          <input
            id="scanner-search-input"
            type="text"
            placeholder="ENTER GMK ID OR NAME..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-stone-900 border-2 border-stone-800 rounded-3xl pl-14 pr-4 py-5 text-xl font-black text-white placeholder-stone-600 outline-none focus:border-emerald-500 transition-colors uppercase"
            autoComplete="off"
            autoCorrect="off"
            spellCheck="false"
          />
        </div>

        {searchQuery.length > 0 && searchQuery.length < 2 && (
          <div className="text-center p-8 text-stone-500 font-bold uppercase tracking-wider text-xs">
            Type at least 2 characters...
          </div>
        )}

        {searchQuery.length >= 2 && searchResults.length === 0 && (
          <div className="text-center p-8 border-2 border-dashed border-stone-800 rounded-3xl mt-4">
            <AlertCircle className="w-10 h-10 text-stone-600 mx-auto mb-3" />
            <h3 className="text-sm font-black uppercase text-stone-400 tracking-wider">No Match Found</h3>
          </div>
        )}

        {searchQuery.length >= 2 && searchResults.length > 0 && (
          <div className="space-y-3 pb-6 flex-1 overflow-y-auto">
            <div className="text-[10px] font-bold text-stone-500 uppercase tracking-widest pl-2">
              {searchResults.length} matching residents
            </div>
            
            {searchResults.map(reg => {
              const gmkId = getRegistrationDisplayId(reg) || reg.id;
              const name = reg.primaryRegistrantName || reg.primaryMemberEmail || 'Guest';
              
              return (
                <button
                  key={reg.id}
                  onClick={() => setSelectedReg(reg)}
                  className="w-full text-left bg-stone-900 border border-stone-800 p-5 rounded-2xl flex items-center justify-between active:bg-stone-800 transition-colors group"
                >
                  <div>
                    <div className="text-lg font-bold text-white">{name}</div>
                    <div className="text-xs text-emerald-500 font-black uppercase tracking-wider">{gmkId}</div>
                  </div>
                  <div className="bg-stone-800 px-4 py-2 rounded-xl text-[10px] font-black text-stone-300 uppercase tracking-widest group-active:bg-stone-700">
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
