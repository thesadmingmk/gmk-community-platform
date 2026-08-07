import React, { useEffect, useState } from 'react';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../context/AuthContext';
import { AuditLog } from '../types';
import { 
  Search, 
  ShieldAlert, 
  Users, 
  Briefcase, 
  Key, 
  Terminal, 
  BookOpen, 
  Clock, 
  RefreshCw,
  X
} from 'lucide-react';

export function getLogCategory(log: AuditLog): 'governance' | 'resident' | 'administration' | 'authentication' | 'system' {
  const action = (log.action || '').toUpperCase();
  const entityType = (log.entityType || '').toLowerCase();
  const details = (log.details || '').toLowerCase();

  // Governance Log
  if (
    action.includes('ASSIGN_ROLE') ||
    action.includes('REMOVE_ROLE') ||
    action.includes('ROLE_ASSIGNMENT') ||
    action.includes('GOVERNANCE') ||
    action.includes('APPOINT_EVENT_DIRECTOR') ||
    entityType === 'role_assignment' ||
    entityType === 'governance_assignment' ||
    details.includes('governance') ||
    details.includes('role assignment')
  ) {
    return 'governance';
  }

  // Authentication Log
  if (
    action.includes('REGISTRATION_SUBMITTED') ||
    action.includes('SUBMIT_REGISTRATION') ||
    action.includes('LOGIN') ||
    action.includes('LOGOUT') ||
    action.includes('AUTH') ||
    entityType === 'registration' ||
    details.includes('verification queue') ||
    details.includes('registered with') ||
    details.includes('onboarding') ||
    details.includes('gateway')
  ) {
    return 'authentication';
  }

  // Resident Log
  if (
    action.includes('APPROVE_RESIDENT') ||
    action.includes('ARCHIVE_RESIDENT') ||
    action.includes('ACTIVATE_RESIDENT') ||
    action.includes('PROFILE_COMPLETED') ||
    entityType === 'resident' ||
    entityType === 'family' ||
    entityType === 'family_member' ||
    details.includes('profile completed') ||
    details.includes('resident profile') ||
    details.includes('family structure')
  ) {
    return 'resident';
  }

  // Administration Log
  if (
    action.includes('DELETE_RESIDENT') ||
    action.includes('REJECT_REGISTRATION') ||
    entityType === 'event' ||
    entityType === 'committee' ||
    entityType === 'program' ||
    details.includes('deleted resident') ||
    details.includes('rejected registration') ||
    details.includes('event director') ||
    details.includes('deduplication')
  ) {
    return 'administration';
  }

  // System Log
  return 'system';
}

export default function LogCenter() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeSection, setActiveSection] = useState<'all' | 'governance' | 'resident' | 'administration' | 'authentication' | 'system'>('all');

  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, "auditLogs"), orderBy("timestamp", "desc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedLogs: AuditLog[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data() as Omit<AuditLog, 'id'>;
        fetchedLogs.push({
          id: doc.id,
          ...data
        });
      });
      setLogs(fetchedLogs);
      setLoading(false);
    }, (error) => {
      console.error("Error subscribing to auditLogs:", error);
      setErrorMsg("Failed to load audit trail data due to database access restrictions.");
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Categorized logs
  const governanceLogs = logs.filter(log => getLogCategory(log) === 'governance');
  const residentLogs = logs.filter(log => getLogCategory(log) === 'resident');
  const administrationLogs = logs.filter(log => getLogCategory(log) === 'administration');
  const authenticationLogs = logs.filter(log => getLogCategory(log) === 'authentication');
  const systemLogs = logs.filter(log => getLogCategory(log) === 'system');

  // Filter logs by active section
  const getSelectedSectionLogs = () => {
    switch (activeSection) {
      case 'governance': return governanceLogs;
      case 'resident': return residentLogs;
      case 'administration': return administrationLogs;
      case 'authentication': return authenticationLogs;
      case 'system': return systemLogs;
      default: return logs;
    }
  };

  // Filter logs by search term - simplified as requested to rely entirely on classification filters
  const searchedLogs = getSelectedSectionLogs();

  const getSectionStats = () => {
    return {
      all: logs.length,
      governance: governanceLogs.length,
      resident: residentLogs.length,
      administration: administrationLogs.length,
      authentication: authenticationLogs.length,
      system: systemLogs.length,
    };
  };

  const stats = getSectionStats();

  const getLogBadgeColors = (action: string) => {
    const act = action.toUpperCase();
    if (act.includes('DELETE') || act.includes('REMOVE') || act.includes('REJECT') || act.includes('DEACTIVATE')) {
      return 'bg-red-50 text-red-700 border border-red-200';
    }
    if (act.includes('APPROVE') || act.includes('CREATE') || act.includes('ACTIVATE') || act.includes('ASSIGN') || act.includes('COMPLETE')) {
      return 'bg-emerald-50 text-emerald-800 border border-emerald-200';
    }
    if (act.includes('SUBMIT')) {
      return 'bg-blue-50 text-blue-700 border border-blue-200';
    }
    return 'bg-stone-50 text-stone-600 border border-stone-200';
  };

  const getSectionIcon = (section: string) => {
    switch (section) {
      case 'governance': return <ShieldAlert className="w-4 h-4 text-[#0f4c2a]" />;
      case 'resident': return <Users className="w-4 h-4 text-emerald-600" />;
      case 'administration': return <Briefcase className="w-4 h-4 text-blue-600" />;
      case 'authentication': return <Key className="w-4 h-4 text-amber-600" />;
      case 'system': return <Terminal className="w-4 h-4 text-purple-600" />;
      default: return <BookOpen className="w-4 h-4 text-stone-600" />;
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn" id="log-center-container">
      {/* Header and Controls */}
      <div className="bg-stone-50 border border-stone-200 rounded-xl p-4 flex justify-between items-center">
        <div>
          <h2 className="text-base font-extrabold text-[#0f4c2a] uppercase tracking-wider font-heading">
            COMMUNITY TRANSACTION LOG CENTER
          </h2>
          <p className="text-[10.5px] text-stone-600 font-medium mt-0.5 leading-relaxed font-sans">
            Immutable audit logging and security operations repository
          </p>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs font-mono text-red-700 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Grid: Sections list left, Logs listing right */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        
        {/* Sections Sidebar */}
        <div className="lg:col-span-1 space-y-2">
          <p className="text-[10px] font-extrabold uppercase tracking-widest text-stone-500 font-mono px-1">
            Log Classifications
          </p>
          <div className="space-y-1 bg-white border border-stone-200 rounded-xl p-2 shadow-sm">
            {[
              { id: 'all', label: 'All Transactions', count: stats.all },
              { id: 'governance', label: 'Governance Log', count: stats.governance },
              { id: 'resident', label: 'Resident Log', count: stats.resident },
              { id: 'administration', label: 'Administration Log', count: stats.administration },
              { id: 'authentication', label: 'Authentication Log', count: stats.authentication },
              { id: 'system', label: 'System Log', count: stats.system },
            ].map((sec) => (
              <button
                key={sec.id}
                onClick={() => setActiveSection(sec.id as any)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-mono font-medium transition-all cursor-pointer ${
                  activeSection === sec.id
                    ? 'bg-[#0f4c2a]/10 text-[#0f4c2a] border-l-4 border-[#0f4c2a]'
                    : 'text-stone-600 hover:bg-stone-50 hover:text-stone-900 border-l-4 border-transparent'
                }`}
              >
                <div className="flex items-center gap-2">
                  {getSectionIcon(sec.id)}
                  <span>{sec.label}</span>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                  activeSection === sec.id ? 'bg-[#0f4c2a] text-white' : 'bg-stone-100 text-stone-500 border border-stone-200'
                }`}>
                  {sec.count}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Logs Listing Panel */}
        <div className="lg:col-span-3 bg-white border border-stone-200 rounded-xl shadow-sm p-4 space-y-4">
          <div className="flex justify-between items-center border-b border-stone-100 pb-2">
            <h3 className="text-xs font-extrabold text-stone-800 uppercase font-mono tracking-wider flex items-center gap-1.5">
              {getSectionIcon(activeSection)}
              <span>
                {activeSection === 'all' ? 'All Ledger Inscriptions' : `${activeSection} audits`}
              </span>
            </h3>
            <span className="text-[10px] font-mono text-stone-400 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Latest activity first
            </span>
          </div>

          <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2 font-mono text-xs">
            {loading ? (
              <div className="py-20 text-center text-stone-400 flex flex-col items-center justify-center gap-2">
                <RefreshCw className="w-6 h-6 animate-spin text-stone-400" />
                <span className="text-xs font-semibold">Decrypting Ledger Entries...</span>
              </div>
            ) : searchedLogs.length === 0 ? (
              <div className="py-20 text-center text-stone-400 italic">
                <p className="text-stone-450 font-semibold font-sans">No audit records detected matching specifications.</p>
                <p className="text-[10px] text-stone-400 mt-1">Check search parameters or verify category classification status.</p>
              </div>
            ) : (
              searchedLogs.map((log) => {
                const category = getLogCategory(log);
                return (
                  <div 
                    key={log.id} 
                    className="p-3.5 border border-stone-150 rounded-lg bg-stone-50/20 hover:bg-stone-50/50 hover:border-stone-300 transition-all space-y-2 animate-fadeIn"
                    id={`log-entry-${log.id}`}
                  >
                    <div className="flex flex-wrap justify-between items-start gap-2 text-[10px]">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`px-2 py-0.5 rounded font-bold uppercase tracking-wider ${getLogBadgeColors(log.action)}`}>
                          {log.action ? log.action.replace(/_/g, ' ') : 'UNKNOWN'}
                        </span>
                        <span className="px-1.5 py-0.5 bg-stone-100 text-stone-500 rounded font-bold border border-stone-200 uppercase text-[8px] tracking-widest">
                          {category}
                        </span>
                      </div>
                      <span className="text-stone-400 font-sans">{new Date(log.timestamp).toLocaleString()}</span>
                    </div>

                    <p className="text-stone-800 leading-relaxed font-sans text-xs pt-0.5">{log.details}</p>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-stone-400 pt-1.5 border-t border-stone-100/80">
                      <span>Actor: <strong className="text-stone-600 font-sans">{log.actorEmail}</strong></span>
                      {log.entityId && <span>Entity ID: <strong className="text-stone-600">{log.entityId}</strong></span>}
                      {log.targetName && <span>Target: <strong className="text-stone-600 font-sans">{log.targetName}</strong></span>}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
