import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, where, onSnapshot, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../../context/AuthContext';
import { EventTeam, EventRegistration, Family, FamilyMember, CommunityEvent } from '../../types';
import { evaluateFamilyRegistrationParticipants } from '../../services/familyCheckInService';
import { getRegistrationDisplayId, formatExternalGmkId } from '../../utils/gmkIdHelper';
import { Plus, Users, Search, Trash2, Edit3, X, Save, CheckCircle } from 'lucide-react';

interface Props {
  activeEvent: CommunityEvent | null;
  registrations: EventRegistration[];
  families: Family[];
  familyMembers: FamilyMember[];
}

export default function TeamManagementWorkspace({ activeEvent, registrations, families, familyMembers }: Props) {
  const [teams, setTeams] = useState<EventTeam[]>([]);
  const [loading, setLoading] = useState(true);

  const [editingTeam, setEditingTeam] = useState<Partial<EventTeam> | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [captainSearchTerm, setCaptainSearchTerm] = useState('');

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
      setTeams(list);
      setLoading(false);
    });
    return () => unsub();
  }, [activeEvent]);

  // Build the list of all available participants across all registrations
  const availableParticipants = useMemo(() => {
    if (!activeEvent) return [];
    
    // Only consider approved or unconditionally registered people
    const validRegs = registrations.filter(r => r.eventId === activeEvent.id && r.workflowStatus !== 'cancelled' && r.paymentStatus !== 'cancelled' && (!r.isExternal || r.adminReviewStatus === 'approved'));

    const allPeople: Array<{
      name: string;
      gmkId: string;
      registrationId: string;
      relationship: string;
      sortKey: string;
    }> = [];

    validRegs.forEach(reg => {
      const gmkId = getRegistrationDisplayId(reg) || (reg.isExternal ? formatExternalGmkId(reg.publicReference) || reg.publicReference || reg.id : reg.primaryMemberGmkId || 'N/A');
      
      if (reg.isExternal) {
        // External standalone
        (reg.participants || []).forEach(pName => {
          allPeople.push({
            name: pName,
            gmkId,
            registrationId: reg.id,
            relationship: reg.externalRegistrationTypeName || 'External Guest',
            sortKey: `${pName} ${gmkId}`.toLowerCase()
          });
        });
      } else {
        // Resident/Family
        const evalResult = evaluateFamilyRegistrationParticipants(reg, [], families, familyMembers);
        evalResult.allParticipants.forEach(p => {
          allPeople.push({
            name: p.name,
            gmkId,
            registrationId: reg.id,
            relationship: p.relationship,
            sortKey: `${p.name} ${gmkId}`.toLowerCase()
          });
        });
      }
    });

    return allPeople.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }, [activeEvent, registrations, families, familyMembers]);

  const handleSaveTeam = async () => {
    if (!activeEvent || !editingTeam || !editingTeam.teamName || !editingTeam.captain) {
      alert("Please enter a team name and select a captain.");
      return;
    }
    
    try {
      const teamId = editingTeam.id || `team_${activeEvent.id}_${Date.now()}`;
      const payload: EventTeam = {
        id: teamId,
        eventId: activeEvent.id,
        teamName: editingTeam.teamName,
        captain: editingTeam.captain,
        members: editingTeam.members || [],
        createdAt: editingTeam.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      await setDoc(doc(db, 'eventTeams', teamId), payload);
      setIsFormOpen(false);
      setEditingTeam(null);
      setCaptainSearchTerm('');
      setSearchTerm('');
    } catch (err: any) {
      alert("Error saving team: " + err.message);
    }
  };

  const handleDeleteTeam = async (teamId: string) => {
    if (!window.confirm("Are you sure you want to delete this team?")) return;
    try {
      await deleteDoc(doc(db, 'eventTeams', teamId));
    } catch (err: any) {
      alert("Error deleting team: " + err.message);
    }
  };

  const assignedRegistrations = useMemo(() => {
    const map = new Map<string, string>();
    teams.forEach(t => {
      if (t.captain) {
        map.set(t.captain.registrationId, t.teamName);
      }
      (t.members || []).forEach(m => {
        map.set(m.registrationId, t.teamName);
      });
    });
    // Overlay the current editing team so immediate selections lock out the family
    if (editingTeam) {
      const tempName = editingTeam.teamName || 'Current Team';
      if (editingTeam.captain) {
        map.set(editingTeam.captain.registrationId, tempName);
      }
      (editingTeam.members || []).forEach(m => {
        map.set(m.registrationId, tempName);
      });
    }
    return map;
  }, [teams, editingTeam]);

  const filteredParticipants = useMemo(() => {
    if (!searchTerm) return []; // Require search to show list
    const lower = searchTerm.toLowerCase();
    return availableParticipants.filter(p => p.sortKey.includes(lower)).map(p => ({
      ...p,
      assignedTeam: assignedRegistrations.get(p.registrationId)
    })).slice(0, 50); // limit to 50 results
  }, [availableParticipants, searchTerm, assignedRegistrations]);

  const filteredCaptainCandidates = useMemo(() => {
    if (!captainSearchTerm) return [];
    const lower = captainSearchTerm.toLowerCase();
    return availableParticipants
      .filter(p => {
        const rel = p.relationship.toLowerCase();
        return (rel === 'gmk member' || rel === 'spouse' || rel === 'child') && p.sortKey.includes(lower);
      })
      .map(p => ({
        ...p,
        assignedTeam: assignedRegistrations.get(p.registrationId)
      }))
      .slice(0, 50);
  }, [availableParticipants, captainSearchTerm, assignedRegistrations]);

  const addMember = (person: any, role: 'captain' | 'member') => {
    if (!editingTeam) return;
    
    if (role === 'captain') {
      setEditingTeam(prev => ({
        ...prev,
        captain: {
          name: person.name,
          gmkId: person.gmkId,
          registrationId: person.registrationId
        }
      }));
      setCaptainSearchTerm('');
    } else {
      const currentMembers = editingTeam.members || [];
      // avoid dupes
      if (!currentMembers.find(m => m.name === person.name && m.registrationId === person.registrationId)) {
        setEditingTeam(prev => ({
          ...prev,
          members: [...currentMembers, {
            name: person.name,
            relationship: person.relationship,
            gmkId: person.gmkId,
            registrationId: person.registrationId
          }]
        }));
      }
      setSearchTerm(''); // reset search after pick
    }
  };

  const removeMember = (idx: number) => {
    if (!editingTeam) return;
    const currentMembers = [...(editingTeam.members || [])];
    currentMembers.splice(idx, 1);
    setEditingTeam(prev => ({ ...prev, members: currentMembers }));
  };

  if (!activeEvent) {
    return (
      <div className="bg-white rounded-xl shadow-xs border border-stone-200 p-8 text-center text-stone-500 font-medium">
        Please select an event to manage teams.
      </div>
    );
  }

  if (loading) {
    return <div className="p-4 text-stone-500 font-bold text-xs">Loading teams...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-black text-stone-800 uppercase tracking-wider">Team Management</h3>
          <p className="text-[11px] text-stone-500 font-bold mt-0.5">Create and manage event teams</p>
        </div>
        <button
          onClick={() => { setEditingTeam({ eventId: activeEvent.id, teamName: '', members: [] }); setIsFormOpen(true); }}
          className="px-4 py-2 bg-[#0f4c2a] hover:bg-emerald-800 text-white text-xs font-black uppercase tracking-wider rounded-lg transition-colors flex items-center space-x-2"
        >
          <Plus className="w-4 h-4" />
          <span>Add Team</span>
        </button>
      </div>

      {isFormOpen && editingTeam && (
        <div className="bg-white border border-stone-200 shadow-sm rounded-xl p-5 space-y-5">
          <div className="flex justify-between items-center pb-3 border-b border-stone-100">
            <h4 className="text-sm font-black uppercase tracking-wider text-[#0f4c2a]">
              {editingTeam.id ? 'Edit Team' : 'New Team'}
            </h4>
            <button onClick={() => { setIsFormOpen(false); setEditingTeam(null); setCaptainSearchTerm(''); setSearchTerm(''); }} className="text-stone-400 hover:text-stone-600">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-wider text-stone-500 mb-1">Team Name</label>
              <input
                type="text"
                value={editingTeam.teamName || ''}
                onChange={(e) => setEditingTeam({ ...editingTeam, teamName: e.target.value })}
                className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm font-bold text-stone-800 focus:ring-1 focus:ring-emerald-600 focus:border-emerald-600"
                placeholder="e.g. Red Dragons"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left Column: Team Structure */}
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-wider text-stone-500 mb-1">Captain</label>
                  {editingTeam.captain ? (
                    <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-between">
                      <div>
                        <div className="text-xs font-bold text-emerald-900">{editingTeam.captain.name}</div>
                        <div className="text-[10px] text-emerald-700 font-bold">{editingTeam.captain.gmkId}</div>
                      </div>
                      <button onClick={() => setEditingTeam({ ...editingTeam, captain: undefined })} className="text-emerald-600 hover:text-emerald-800">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="relative">
                        <Search className="w-4 h-4 text-stone-400 absolute left-3 top-2.5" />
                        <input
                          type="text"
                          value={captainSearchTerm}
                          onChange={(e) => setCaptainSearchTerm(e.target.value)}
                          placeholder="Type captain name / GMK ID..."
                          className="w-full pl-9 pr-3 py-2 bg-white border border-stone-200 rounded-lg text-xs font-bold text-stone-800 focus:ring-1 focus:ring-[#0f4c2a] focus:border-[#0f4c2a]"
                        />
                      </div>
                      {captainSearchTerm && (
                        <div className="max-h-48 overflow-y-auto border border-stone-200 rounded-lg bg-white hide-scrollbar divide-y divide-stone-100">
                          {filteredCaptainCandidates.length === 0 ? (
                            <div className="p-3 text-center text-[10px] text-stone-400 font-medium">
                              No eligible captains found (must be GMK Member, Spouse, or Child).
                            </div>
                          ) : (
                            filteredCaptainCandidates.map((p, idx) => {
                              const isAssigned = !!p.assignedTeam;
                              return (
                                <div key={idx} className={`p-2.5 flex items-center justify-between gap-2 ${isAssigned ? 'bg-stone-50/50' : 'hover:bg-stone-50 transition-colors'}`}>
                                  <div className="min-w-0 opacity-100">
                                    <div className={`text-[11px] font-bold truncate ${isAssigned ? 'text-stone-500' : 'text-stone-800'}`}>{p.name}</div>
                                    <div className="text-[9px] font-bold text-stone-500 uppercase">{p.relationship} • {p.gmkId}</div>
                                  </div>
                                  {isAssigned ? (
                                    <span className="shrink-0 px-2 py-0.5 bg-stone-100 text-stone-500 border border-stone-200 text-[9px] font-black uppercase tracking-wider rounded">
                                      In {p.assignedTeam}
                                    </span>
                                  ) : (
                                    <button
                                      onClick={() => addMember(p, 'captain')}
                                      className="shrink-0 px-2.5 py-1 bg-[#0f4c2a] text-white text-[10px] font-black uppercase tracking-wider rounded transition-colors hover:bg-[#0c3e22]"
                                    >
                                      Select
                                    </button>
                                  )}
                                </div>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase tracking-wider text-stone-500 mb-1">Members ({editingTeam.members?.length || 0})</label>
                  {editingTeam.members && editingTeam.members.length > 0 ? (
                    <div className="space-y-2 max-h-60 overflow-y-auto pr-1 hide-scrollbar">
                      {editingTeam.members.map((m, idx) => (
                        <div key={idx} className="p-2.5 bg-stone-50 border border-stone-200 rounded-lg flex items-center justify-between group">
                          <div>
                            <div className="text-xs font-bold text-stone-800">{m.name}</div>
                            <div className="flex items-center space-x-2 text-[9px] font-bold uppercase tracking-wider text-stone-500">
                              <span>{m.relationship}</span>
                              <span>•</span>
                              <span>{m.gmkId}</span>
                            </div>
                          </div>
                          <button onClick={() => removeMember(idx)} className="text-stone-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity">
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-3 bg-stone-50 border border-stone-200 border-dashed rounded-lg text-xs font-medium text-stone-500 italic">
                      No members added. Use the search panel.
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Search & Add */}
              <div className="bg-stone-50 border border-stone-200 rounded-xl p-4 flex flex-col">
                <label className="block text-[10px] font-black uppercase tracking-wider text-stone-500 mb-2">Search Participants</label>
                <div className="relative mb-3 shrink-0">
                  <Search className="w-4 h-4 text-stone-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search name or GMK ID..."
                    className="w-full pl-9 pr-3 py-2 bg-white border border-stone-200 rounded-lg text-xs font-bold text-stone-800 focus:ring-1 focus:ring-[#0f4c2a] focus:border-[#0f4c2a]"
                  />
                </div>
                
                <div className="flex-1 overflow-y-auto min-h-[200px] border border-stone-200 rounded-lg bg-white hide-scrollbar">
                  {!searchTerm ? (
                    <div className="p-6 text-center text-xs text-stone-400 font-medium flex flex-col items-center">
                      <Users className="w-6 h-6 mb-2 opacity-20" />
                      Type to search registered participants.
                    </div>
                  ) : filteredParticipants.length === 0 ? (
                    <div className="p-6 text-center text-xs text-stone-400 font-medium">
                      No matching participants found.
                    </div>
                  ) : (
                    <div className="divide-y divide-stone-100">
                      {filteredParticipants.map((p, idx) => {
                        const isCaptain = editingTeam?.captain?.registrationId === p.registrationId && editingTeam?.captain?.name === p.name;
                        const isMember = editingTeam?.members?.some(m => m.registrationId === p.registrationId && m.name === p.name);
                        
                        return (
                          <div key={idx} className={`p-2.5 flex items-center justify-between gap-3 ${p.assignedTeam ? 'bg-stone-50/50' : 'hover:bg-stone-50 transition-colors'}`}>
                            <div className="min-w-0 opacity-100">
                              <div className={`text-xs font-bold truncate ${p.assignedTeam ? 'text-stone-500' : 'text-stone-800'}`}>{p.name}</div>
                              <div className="flex items-center space-x-2 text-[9px] font-bold uppercase tracking-wider text-stone-500 truncate">
                                <span className={p.relationship === 'External Guest' || p.relationship === 'Guest' ? 'text-rose-600' : 'text-emerald-700'}>
                                  {p.relationship}
                                </span>
                                <span>•</span>
                                <span>{p.gmkId}</span>
                              </div>
                            </div>
                            <div className="flex items-center space-x-1 shrink-0">
                              {p.assignedTeam ? (
                                <span className="px-2 py-0.5 bg-stone-100 text-stone-500 border border-stone-200 text-[9px] font-black uppercase tracking-wider rounded">
                                  In {p.assignedTeam}
                                </span>
                              ) : (
                                <button onClick={() => addMember(p, 'member')} className="px-2 py-1 text-[9px] font-black uppercase tracking-wider bg-[#0f4c2a] hover:bg-[#0c3e22] text-white rounded transition-colors shadow-xs" title="Add Member">
                                  Add
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
            
            <div className="pt-3 border-t border-stone-100 flex justify-end">
              <button
                onClick={handleSaveTeam}
                className="px-5 py-2.5 bg-[#0f4c2a] hover:bg-emerald-800 text-white text-xs font-black uppercase tracking-wider rounded-lg transition-colors flex items-center space-x-2 shadow-xs"
              >
                <Save className="w-4 h-4" />
                <span>Save Team</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Team List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {teams.map(team => (
          <div key={team.id} className="bg-white border border-stone-200 rounded-xl shadow-xs overflow-hidden flex flex-col group">
            <div className="p-4 bg-stone-50 border-b border-stone-200 flex justify-between items-start">
              <div>
                <h4 className="text-sm font-black text-stone-900 tracking-wide">{team.teamName}</h4>
                <div className="text-[10px] font-black uppercase tracking-wider text-stone-500 mt-1">
                  {team.members.length + (team.captain ? 1 : 0)} Members
                </div>
              </div>
              <div className="flex space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => { setEditingTeam(team); setIsFormOpen(true); }} className="p-1.5 bg-white text-stone-400 hover:text-blue-600 border border-stone-200 rounded-lg">
                  <Edit3 className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => handleDeleteTeam(team.id)} className="p-1.5 bg-white text-stone-400 hover:text-rose-600 border border-stone-200 rounded-lg">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <div className="p-4 space-y-4 flex-1">
              {team.captain && (
                <div>
                  <div className="text-[9px] font-black uppercase text-stone-400 tracking-widest mb-1">Captain</div>
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-bold text-stone-800">{team.captain.name}</span>
                    <span className="text-[9px] font-bold text-stone-500 bg-stone-100 px-1.5 py-0.5 rounded">{team.captain.gmkId}</span>
                  </div>
                </div>
              )}
              {team.members.length > 0 && (
                <div>
                  <div className="text-[9px] font-black uppercase text-stone-400 tracking-widest mb-1.5">Members</div>
                  <div className="space-y-1.5">
                    {team.members.slice(0, 5).map((m, idx) => (
                      <div key={idx} className="flex justify-between items-center text-xs">
                        <span className="font-medium text-stone-700 truncate mr-2">{m.name}</span>
                        <span className="text-[9px] font-bold text-stone-400 uppercase shrink-0">{m.gmkId}</span>
                      </div>
                    ))}
                    {team.members.length > 5 && (
                      <div className="text-[10px] font-bold text-stone-400 italic pt-1">
                        + {team.members.length - 5} more
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
        {teams.length === 0 && !isFormOpen && (
          <div className="col-span-full py-12 text-center border border-stone-200 border-dashed rounded-xl bg-stone-50">
            <Users className="w-8 h-8 text-stone-300 mx-auto mb-2" />
            <h4 className="text-sm font-black text-stone-600">No Teams Created</h4>
            <p className="text-xs font-medium text-stone-500 mt-1">Click Add Team to create your first team.</p>
          </div>
        )}
      </div>
    </div>
  );
}
