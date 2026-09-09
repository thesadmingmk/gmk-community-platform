import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, doc, updateDoc, runTransaction } from 'firebase/firestore';
import { db, auth } from '../../context/AuthContext';
import { EventScanner, CommunityEvent, EventCommittee } from '../../types';
import { Shield, Plus, Trash2, Power, PowerOff, Key, RefreshCw } from 'lucide-react';

interface Props {
  activeEvent: CommunityEvent;
  committeeName: string;
}

export default function ScannerManager({ activeEvent, committeeName }: Props) {
  const [committee, setCommittee] = useState<EventCommittee | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  
  const [isCreating, setIsCreating] = useState(false);
  const [newScannerName, setNewScannerName] = useState('');
  const [newScannerPin, setNewScannerPin] = useState('');
  const [scannerToDelete, setScannerToDelete] = useState<string | null>(null);

  useEffect(() => {
    if (!activeEvent.id || !committeeName) return;
    
    const q = query(
      collection(db, 'eventCommittees'), 
      where('eventId', '==', activeEvent.id),
      where('name', '==', committeeName)
    );
    
    const unsub = onSnapshot(q, (snap) => {
      if (!snap.empty) {
        const docData = snap.docs[0];
        setCommittee({ id: docData.id, ...docData.data() } as EventCommittee);
      }
      setLoading(false);
    }, (err) => {
      console.error(err);
      setErrorMsg("Failed to load scanners configuration.");
      setLoading(false);
    });
    
    return () => unsub();
  }, [activeEvent.id, committeeName]);

  const generatePin = () => {
    return Math.floor(1000 + Math.random() * 9000).toString();
  };

  const handleCreate = async () => {
    if (!committee) return;
    if (!newScannerName.trim() || !newScannerPin.trim()) return;
    
    if (!/^\d{4}$/.test(newScannerPin)) {
      setErrorMsg("PIN must be exactly 4 digits.");
      return;
    }

    try {
      const committeeRef = doc(db, 'eventCommittees', committee.id);
      
      await runTransaction(db, async (transaction) => {
        const commDoc = await transaction.get(committeeRef);
        if (!commDoc.exists()) {
          throw new Error("Committee configuration not found.");
        }
        
        const currentScanners: EventScanner[] = commDoc.data().scanners || [];
        const pinInUse = currentScanners.find(s => s.pin === newScannerPin && s.isActive);
        
        if (pinInUse) {
          throw new Error(`PIN ALREADY IN USE. This PIN is currently assigned to ${pinInUse.name}.`);
        }
        
        const newScanner: EventScanner = {
          id: `scan_${Date.now()}`,
          name: newScannerName.trim(),
          pin: newScannerPin,
          isActive: true, // Always created as active
          eventId: activeEvent.id,
          createdBy: auth.currentUser?.email || 'Admin',
          createdAt: new Date().toISOString()
        };
        
        transaction.update(committeeRef, {
          scanners: [...currentScanners, newScanner]
        });
      });

      setIsCreating(false);
      setNewScannerName('');
      setNewScannerPin('');
      setErrorMsg('');
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const toggleStatus = async (scanner: EventScanner) => {
    if (!committee) return;
    try {
      const committeeRef = doc(db, 'eventCommittees', committee.id);
      
      await runTransaction(db, async (transaction) => {
        const commDoc = await transaction.get(committeeRef);
        if (!commDoc.exists()) {
          throw new Error("Committee configuration not found.");
        }
        
        const currentScanners: EventScanner[] = commDoc.data().scanners || [];
        
        // If we are activating, check if PIN is in use by ANOTHER active scanner
        if (!scanner.isActive) {
          const pinInUse = currentScanners.find(s => s.pin === scanner.pin && s.isActive && s.id !== scanner.id);
          if (pinInUse) {
            throw new Error(`PIN ALREADY IN USE. This PIN is currently assigned to ${pinInUse.name}.`);
          }
        }
        
        const updatedScanners = currentScanners.map(s => 
          s.id === scanner.id ? { ...s, isActive: !s.isActive } : s
        );
        
        transaction.update(committeeRef, { scanners: updatedScanners });
      });
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleDelete = (id: string) => {
    setScannerToDelete(id);
  };

  const confirmDelete = async () => {
    if (!committee || !scannerToDelete) return;
    try {
      const updatedScanners = (committee.scanners || []).filter(s => s.id !== scannerToDelete);
      await updateDoc(doc(db, 'eventCommittees', committee.id), {
        scanners: updatedScanners
      });
      setScannerToDelete(null);
    } catch (err: any) {
      setErrorMsg(err.message);
      setScannerToDelete(null);
    }
  };

  if (loading) return <div className="p-4 text-xs">Loading scanners...</div>;

  const scanners = committee?.scanners || [];

  return (
    <div className="space-y-6 animate-fadeIn p-6 bg-white border border-stone-200 rounded-2xl">
      <div className="flex items-center justify-between border-b border-stone-100 pb-4">
        <div>
          <h2 className="text-xl font-serif font-bold text-[#0f4c2a] flex items-center gap-2">
            <Shield className="w-5 h-5" />
            Gate Scanners
          </h2>
          <p className="text-[10px] text-stone-500 font-bold mt-1 uppercase tracking-wider">Manage physical/logical scanner credentials for the mobile gate interface.</p>
        </div>
        <button
          onClick={() => {
            setIsCreating(true);
            setNewScannerName(`SCANNER ${scanners.length + 1}`);
            setNewScannerPin(generatePin());
          }}
          className="px-4 py-2.5 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white text-[10px] font-black uppercase tracking-wider rounded-xl shadow-sm flex items-center gap-2 transition-all cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>New Scanner</span>
        </button>
      </div>

      {errorMsg && (
        <div className="p-3 bg-red-50 text-red-700 text-xs rounded-xl font-bold border border-red-200">
          {errorMsg}
        </div>
      )}

      {isCreating && (
        <div className="p-5 bg-[#FFFDF6] border border-stone-200 rounded-2xl shadow-sm space-y-4">
          <h3 className="text-[10px] font-black uppercase text-stone-900 tracking-wider">Create New Scanner</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1">Scanner Name</label>
              <input
                type="text"
                value={newScannerName}
                onChange={(e) => setNewScannerName(e.target.value)}
                className="w-full p-2.5 bg-white border border-stone-200 rounded-xl text-sm focus:ring-2 focus:ring-[#0f4c2a]/20 outline-none font-bold text-stone-900"
                placeholder="e.g. SCANNER 1"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1">4-Digit PIN</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  maxLength={4}
                  value={newScannerPin}
                  onChange={(e) => setNewScannerPin(e.target.value.replace(/\D/g, ''))}
                  className="w-full p-2.5 bg-white border border-stone-200 rounded-xl text-sm focus:ring-2 focus:ring-[#0f4c2a]/20 outline-none font-bold text-stone-900 tracking-[0.2em]"
                  placeholder="1234"
                />
                <button
                  type="button"
                  onClick={() => setNewScannerPin(generatePin())}
                  className="px-3 bg-stone-200 hover:bg-stone-300 rounded-xl text-stone-700 transition-colors"
                  title="Generate Random PIN"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setIsCreating(false)}
              className="px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 text-[10px] font-black uppercase tracking-wider rounded-xl transition-all cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={!newScannerName || newScannerPin.length !== 4}
              className="px-4 py-2 bg-[#0f4c2a] hover:bg-[#0c3e22] disabled:opacity-50 text-white text-[10px] font-black uppercase tracking-wider rounded-xl shadow-sm transition-all cursor-pointer"
            >
              Create Scanner
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-stone-50 border-b border-stone-200 text-[10px] font-black uppercase text-stone-500 tracking-wider">
                <th className="p-3 pl-4">Scanner Name</th>
                <th className="p-3">PIN</th>
                <th className="p-3">Status</th>
                <th className="p-3 text-right pr-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {scanners.map(s => (
                <tr key={s.id} className={`transition-colors hover:bg-stone-50/50 ${!s.isActive ? 'opacity-60 bg-stone-50/30' : ''}`}>
                  <td className="p-3 pl-4">
                    <div className="flex items-center gap-2">
                      <Shield className={`w-4 h-4 ${s.isActive ? 'text-[#0f4c2a]' : 'text-stone-400'}`} />
                      <span className="font-black text-stone-900 text-xs uppercase tracking-wider">{s.name}</span>
                    </div>
                  </td>
                  <td className="p-3">
                    <div className="inline-flex items-center gap-1.5 bg-stone-100 px-2 py-1 rounded-lg border border-stone-200">
                      <Key className="w-3 h-3 text-stone-500" />
                      <span className="font-mono font-bold text-sm text-[#0f4c2a] tracking-[0.2em]">{s.pin}</span>
                    </div>
                  </td>
                  <td className="p-3">
                    <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md inline-block ${s.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-200 text-stone-600'}`}>
                      {s.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="p-3 pr-4 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => toggleStatus(s)}
                        className={`p-1.5 rounded-lg transition-colors cursor-pointer ${s.isActive ? 'text-amber-600 hover:bg-amber-50' : 'text-emerald-600 hover:bg-emerald-50'}`}
                        title={s.isActive ? 'Deactivate' : 'Activate'}
                      >
                        {s.isActive ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={() => handleDelete(s.id)}
                        className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 transition-colors cursor-pointer"
                        title="Delete Scanner"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {scanners.length === 0 && !isCreating && (
                <tr>
                  <td colSpan={4} className="p-8 text-center bg-stone-50">
                    <Shield className="w-6 h-6 text-stone-300 mx-auto mb-2" />
                    <p className="text-xs font-black uppercase tracking-wider text-stone-500">No scanners configured</p>
                    <p className="text-[10px] text-stone-400 mt-1 font-bold">Create a scanner to enable the mobile gate interface.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {scannerToDelete && (
        <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-xl border border-stone-200 animate-fadeIn">
            <h3 className="text-lg font-bold text-stone-900 mb-2 flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-red-500" />
              Delete Scanner?
            </h3>
            <p className="text-sm text-stone-500 mb-6 font-medium">
              Are you sure you want to delete this scanner? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setScannerToDelete(null)}
                className="px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 text-[10px] font-black uppercase tracking-wider rounded-xl transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-[10px] font-black uppercase tracking-wider rounded-xl shadow-sm transition-all cursor-pointer"
              >
                Delete Scanner
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
