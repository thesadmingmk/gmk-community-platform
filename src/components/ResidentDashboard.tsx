import React, { useState, useEffect } from 'react';
import { db, auth, useAuth } from '../context/AuthContext';
import { 
  collection, 
  doc, 
  onSnapshot, 
  query, 
  where 
} from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { ResidentProfile, Family, CommunityAnnouncement, FamilyMember, CommunityEvent } from '../types';

// Central Design System & Components
import AppShell from './gmk/AppShell';
import SuperAdminDashboard from './SuperAdminDashboard';
import { GMKCard, GMKButton, GMKBadge, GMKPageHeader } from './gmk/DesignSystem';

// Child components
import ProfileCompletionWizard from './resident/ProfileCompletionWizard';
import EventsManager from './resident/EventsManager';
import ProfessionalSearch from './resident/ProfessionalSearch';
import AdminDashboard from './AdminDashboard';
import GovernancePanel from './GovernancePanel';
import EventDirectorDashboard from './EventDirectorDashboard';
import { normalizeName } from '../utils/nameNormalization';
import { NotificationService } from '../services/NotificationService';

// Icons
import { 
  Home, 
  Users, 
  Calendar, 
  User, 
  LogOut, 
  ShieldCheck, 
  RefreshCw, 
  Sparkles, 
  Award,
  AlertCircle,
  MapPin,
  Clock,
  X,
  Check,
  Edit
} from 'lucide-react';

export default function ResidentDashboard({ activeEmail }: { activeEmail: string }) {
  const { profile } = useAuth();
  
  // Resolve default tab based on emergency admin preferences
  const isEmergencyAdmin = localStorage.getItem('gmk_emergency_admin_mode') === 'true';
  const defaultTab = (profile?.roles.includes('admin') && isEmergencyAdmin) ? 'admin_workspace' : 'home';
  
  const [activeTab, setActiveTab] = useState<'home' | 'events' | 'expertise_search' | 'admin_workspace' | 'super_admin_workspace' | 'governance' | 'event_director'>(defaultTab);
  const [forceEditingOnboarding, setForceEditingOnboarding] = useState(false);
  const [activeWorkspaceTarget, setActiveWorkspaceTarget] = useState<string | null>(null);
  
  // Real-time data
  const [residentProfile, setResidentProfile] = useState<ResidentProfile | null>(null);
  const [familyDoc, setFamilyDoc] = useState<Family | null>(null);
  const [announcements, setAnnouncements] = useState<CommunityAnnouncement[]>([]);
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([]);
  const [events, setEvents] = useState<CommunityEvent[]>([]);
  const [registrations, setRegistrations] = useState<any[]>([]);
  const [responsibilities, setResponsibilities] = useState<any[]>([]);
  const [viewingEventDetails, setViewingEventDetails] = useState<CommunityEvent | null>(null);
  const [attendanceLead, setAttendanceLead] = useState<{ name: string; phone: string } | null>(null);

  // Page level state
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const effectiveProfile = residentProfile;

  // Role Revocation Tab Guard: Instantly redirect to 'home' if the user's admin/super_admin privileges are revoked while they are currently on an admin workspace tab.
  useEffect(() => {
    const isUserAdmin = profile?.roles.includes('admin') || profile?.roles.includes('super_admin');
    const isUserSuperAdmin = profile?.roles.includes('super_admin');
    const isPresidentOrVP = profile?.roles.includes('president') || profile?.roles.includes('vp') || profile?.roles.includes('vice_president');
    const hasEventAccess = Boolean(
      (profile?.roles || []).some((r: string) => 
        ['event_director', 'president', 'vp', 'vice_president', 'admin', 'super_admin', 'committee_lead', 'program_lead', 'program_coordinator', 'committee_member', 'coordinator', 'lead'].includes(r) ||
        r.startsWith('committee_lead') ||
        r.startsWith('program_lead')
      ) || 
      responsibilities.some(r => r.targetTab === 'event_director')
    );
    
    if (activeTab === 'admin_workspace' && !isUserAdmin) {
      setActiveTab('home');
    } else if (activeTab === 'super_admin_workspace' && !isUserSuperAdmin) {
      setActiveTab('home');
    } else if (activeTab === 'governance' && !isPresidentOrVP) {
      setActiveTab('home');
    } else if (activeTab === 'event_director' && !hasEventAccess) {
      setActiveTab('home');
    }
  }, [profile?.roles, activeTab, responsibilities]);

  useEffect(() => {
    setLoading(true);
    const normalizedEmail = activeEmail.toLowerCase().trim();

    // 1. Subscribe to Resident document in residents collection
    const qProf = query(collection(db, "residents"), where("email", "==", normalizedEmail));
    const unsubProfile = onSnapshot(qProf, (snapshot) => {
      if (!snapshot.empty) {
        const data = snapshot.docs[0].data() as ResidentProfile;
        setResidentProfile(data);
      } else {
        setResidentProfile(null);
        setLoading(false);
      }
    }, (err) => {
      console.error("❌ ResidentProfile Subscription failed:", err);
      setErrorMsg("Failed to synchronize resident profile credentials due to a database permission/access constraint.");
      setLoading(false);
    });

    // 2. Subscribe to real-time CommunityAnnouncements
    const qAnn = collection(db, "announcements");
    const unsubAnn = onSnapshot(qAnn, (snapshot) => {
      const list: CommunityAnnouncement[] = [];
      snapshot.forEach(d => {
        list.push({ id: d.id, ...d.data() } as CommunityAnnouncement);
      });
      // Sort newest first
      list.sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setAnnouncements(list);
    }, (err) => {
      console.warn("⚠️ Announcements query locked down or unseeded:", err.message);
    });

    // 3. Subscribe to community events list
    const qEvents = collection(db, "events");
    const unsubEvents = onSnapshot(qEvents, (snapshot) => {
      const list: CommunityEvent[] = [];
      snapshot.forEach(d => {
        const item = { id: d.id, ...d.data() } as any;
        if (item.status === 'published') {
          list.push(item);
        }
      });
      list.sort((a,b) => new Date(a.date || '').getTime() - new Date(b.date || '').getTime());
      setEvents(list);
    }, (err) => {
      console.warn("⚠️ Events subscription locked down or unseeded:", err.message);
    });

    return () => {
      unsubProfile();
      unsubAnn();
      unsubEvents();
    };
  }, [activeEmail]);

  // Reactive Family subscription driven directly by the resolved residentProfile familyId / gmkId
  useEffect(() => {
    if (!residentProfile?.gmkId) {
      setFamilyDoc(null);
      return;
    }

    const familyId = `fam_${residentProfile.gmkId}`;
    console.log(`📡 Fetching family directly via doc ID: ${familyId}`);

    const docRef = doc(db, "families", familyId);
    const unsubFam = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data() as Family;
        setFamilyDoc(data);
      } else {
        console.log(`⚠️ No family document found for ID: ${familyId}`);
        setFamilyDoc(null);
      }
      setLoading(false);
    }, (err) => {
      console.error("❌ Families Subscription failed directly:", err);
      setErrorMsg("Failed to synchronize household family profile details due to a database permission/access constraint.");
      setLoading(false);
    });

    return () => unsubFam();
  }, [residentProfile?.gmkId]);

  // Reactive familyMembers subscription linked to the resolved gmkId
  useEffect(() => {
    if (!residentProfile?.gmkId) {
      setFamilyMembers([]);
      return;
    }
    const familyId = `fam_${residentProfile.gmkId}`;
    const qMems = query(collection(db, "familyMembers"), where("familyId", "==", familyId));
    const unsubMems = onSnapshot(qMems, (snapshot) => {
      const list: FamilyMember[] = [];
      snapshot.forEach(d => {
        list.push({ id: d.id, ...d.data() } as FamilyMember);
      });
      setFamilyMembers(list);
    }, (err) => {
      console.warn("⚠️ FamilyMembers subscription locked down or empty:", err.message);
    });
    return () => unsubMems();
  }, [residentProfile?.gmkId]);

  // Subscribe to Committees and Assignments for 'My Responsibilities'
  useEffect(() => {
    if (!residentProfile) return;
    const currentEmail = (residentProfile.email || '').toLowerCase().trim();
    const currentGmkId = (residentProfile.gmkId || '').toUpperCase().trim();
    const userRoles = profile?.roles || ['resident'];

    const assembled: any[] = [];

    // 1. Check user direct roles
    if (userRoles.includes('event_director')) {
      assembled.push({
        id: 'role_ed',
        source: 'user_role',
        title: 'Event Director',
        role: 'Event Director',
        type: 'Governance',
        targetTab: 'event_director'
      });
    }
    if (userRoles.includes('president')) {
      assembled.push({
        id: 'role_pres',
        source: 'user_role',
        title: 'President — Executive Committee',
        role: 'President',
        type: 'Governance',
        targetTab: 'governance'
      });
    }
    if (userRoles.includes('vp') || userRoles.includes('vice_president')) {
      assembled.push({
        id: 'role_vp',
        source: 'user_role',
        title: 'Vice President — Executive Committee',
        role: 'Vice President',
        type: 'Governance',
        targetTab: 'governance'
      });
    }

    let commCount = 0;
    let progCoordCount = 0;

    // 2. Subscribe to eventCommittees safely
    const qComm = collection(db, "eventCommittees");
    const unsubComm = onSnapshot(qComm, (snapshot) => {
      const commItems: any[] = [];
      snapshot.forEach(docSnap => {
        const commData = docSnap.data();
        const cName = (commData.name || '').trim();
        // Ignore obsolete Event&Program or generic program committees
        if (['event&program', 'event & program', 'program committee', 'programs', 'program'].includes(cName.toLowerCase())) {
          return;
        }
        const membersList = commData.members || [];
        const userMem = membersList.find((m: any) => 
          (m.email && m.email.toLowerCase().trim() === currentEmail) || 
          (m.residentId && m.residentId.toUpperCase().trim() === currentGmkId)
        );
        if (userMem) {
          commCount++;
          const roleTitle = userMem.role === 'Lead'
            ? `Committee Lead — ${cName}`
            : userMem.role === 'Coordinator'
            ? `Committee Coordinator — ${cName}`
            : `Committee Member — ${cName}`;

          commItems.push({
            id: docSnap.id,
            source: 'event_committee',
            title: roleTitle,
            role: roleTitle,
            type: 'Event Operation',
            committee: cName,
            targetTab: 'event_director',
            targetWorkspace: cName
          });
        }
      });
      
      setResponsibilities(prev => {
        const otherSources = prev.filter(r => r.source !== 'event_committee');
        return [...otherSources, ...commItems];
      });
    }, (err) => {
      console.warn("⚠️ [ResidentDashboard] eventCommittees snapshot handled:", err.message);
    });

    // 3. Subscribe to eventPrograms safely
    const qProg = collection(db, "eventPrograms");
    const unsubProg = onSnapshot(qProg, (snapshot) => {
      const progItems: any[] = [];
      snapshot.forEach(docSnap => {
        const progData = docSnap.data();
        const coordsList = progData.coordinators || [];
        const userCoord = coordsList.find((c: any) =>
          (c.email && c.email.toLowerCase().trim() === currentEmail) ||
          (c.residentId && c.residentId.toUpperCase().trim() === currentGmkId)
        );
        if (userCoord) {
          progCoordCount++;
          const pTitle = progData.title || 'Program';
          progItems.push({
            id: docSnap.id,
            source: 'event_program',
            title: `Program Coordinator — ${pTitle}`,
            role: `Program Coordinator — ${pTitle}`,
            type: 'Event Program',
            targetTab: 'event_director',
            targetWorkspace: 'programs',
            programId: docSnap.id
          });
        }
      });
      setResponsibilities(prev => {
        const otherSources = prev.filter(r => r.source !== 'event_program');
        return [...otherSources, ...progItems];
      });
    }, (err) => {
      console.warn("⚠️ [ResidentDashboard] eventPrograms snapshot handled:", err.message);
    });

    // 4. Subscribe to roleAssignments safely (supporting both email and gmkId keys, preserving Program Committee)
    const unsubRoles = onSnapshot(collection(db, "roleAssignments"), (snapshot) => {
      const roleItems: any[] = [];
      const seenCommittees = new Set<string>();
      
      snapshot.forEach(docSnap => {
        const ra = docSnap.data();
        
        // Filter for this user's email or GMK ID
        const matchEmail = ra.email && ra.email.toLowerCase().trim() === currentEmail;
        const matchGmk = residentProfile?.gmkId && ra.gmkId && ra.gmkId.toUpperCase().trim() === residentProfile.gmkId.toUpperCase().trim();
        if (!matchEmail && !matchGmk) return;

        let cName = (ra.committee || ra.committeeName || '').trim();
        const pos = (ra.position || ra.role || '').toLowerCase();
        
        // Skip orphaned "event&program" combined legacy records
        if (cName.toLowerCase() === 'event&program' || cName.toLowerCase() === 'event & program') {
          return;
        }
        
        // Program Coordinators should not get the main Program Committee workspace tab
        if (pos === 'program_coordinator') {
          return;
        }

        // Normalize Program Committee
        if (pos === 'program_lead' || cName.toLowerCase().includes('program')) {
          cName = 'Program';
        }

        if (cName) {
          const normCName = cName.toLowerCase();
          if (!seenCommittees.has(normCName)) {
            seenCommittees.add(normCName);
            const roleTitle = `Committee Lead — ${cName}`;
            roleItems.push({
              id: docSnap.id,
              source: 'role_assignment',
              title: roleTitle,
              role: roleTitle,
              type: 'Community Governance',
              committee: cName,
              targetTab: 'event_director',
              targetWorkspace: cName.toLowerCase() === 'program' ? 'programs' : cName
            });
          }
        }
      });
      
      setResponsibilities(prev => {
        const otherSources = prev.filter(r => r.source !== 'role_assignment');
        return [...otherSources, ...roleItems];
      });
    }, (err) => {
      console.warn("⚠️ [ResidentDashboard] roleAssignments query handled:", err.message);
    });

    // Set initial static user role items
    setResponsibilities(prev => {
      const otherSources = prev.filter(r => r.source !== 'user_role');
      return [...otherSources, ...assembled];
    });

    // 5. Subscribe to Attendance Committee Lead
    const unsubAttLead = onSnapshot(collection(db, "roleAssignments"), (snapshot) => {
      let leadInfo: { name: string; phone: string } | null = null;
      snapshot.forEach(d => {
        const data = d.data();
        const cName = (data.committee || data.committeeName || '').toLowerCase();
        if (cName.includes('attendance')) {
          leadInfo = {
            name: data.fullName || data.name || data.email?.split('@')[0] || 'Attendance Committee Lead',
            phone: data.phone || data.mobilePhone || data.whatsAppNumber || '+968 9000 0000'
          };
        }
      });
      if (leadInfo) setAttendanceLead(leadInfo);
    }, (err) => {
      console.warn("⚠️ [ResidentDashboard] attendance lead query handled:", err.message);
    });

    return () => {
      unsubComm();
      unsubProg();
      unsubRoles();
      unsubAttLead();
    };
  }, [residentProfile, profile?.roles]);

  // Reactive user registrations subscription
  useEffect(() => {
    if (!residentProfile?.email) {
      setRegistrations([]);
      return;
    }
    const normEmail = (residentProfile.email || '').toLowerCase().trim();
    const qRegs = query(collection(db, "event_registrations"), where("primaryMemberEmail", "==", normEmail));
    const unsubRegs = onSnapshot(qRegs, (snapshot) => {
      const list: any[] = [];
      snapshot.forEach(d => {
        list.push({ id: d.id, ...d.data() });
      });
      setRegistrations(list);
    }, (err) => {
      console.warn("⚠️ Event registrations load error inside ResidentDashboard:", err);
    });
    return () => unsubRegs();
  }, [residentProfile?.email]);

  const isEventDirectorRole = Boolean(
    (profile?.roles || []).some((r: string) => 
      ['event_director', 'president', 'vp', 'vice_president', 'admin', 'super_admin', 'committee_lead', 'program_lead', 'program_coordinator', 'committee_member', 'coordinator', 'lead'].includes(r) ||
      r.startsWith('committee_lead') ||
      r.startsWith('program_lead')
    ) ||
    responsibilities.some(r => r.targetTab === 'event_director')
  );

  useEffect(() => {
    if (isEventDirectorRole) {
      const activeUserEmail = profile?.email || residentProfile?.email || '';
      console.log(`[ED ACCESS 1] User authenticated: ${activeUserEmail}`);
      console.log(`[ED ACCESS 2] Event Director role resolved: ${profile?.roles?.includes('event_director') ? 'ACTIVE' : 'COMMITTEE_LEAD_ACCESS'}`);
      console.log(`[ED ACCESS 3] Committee assignments resolved: ${responsibilities.length} operational role(s) assigned`);
      console.log(`[ED ACCESS 4] Navigation permissions resolved: ED_WORKSPACE_PERMITTED`);
      console.log(`[ED ACCESS 5] Event Director menu enabled: TRUE`);
      console.log(`[ED ACCESS 6] Committee menu links resolved: ${responsibilities.map(r => r.committee || r.title).join(', ') || 'None'}`);
    }
  }, [isEventDirectorRole, profile?.email, residentProfile?.email, responsibilities]);

  const handleLogout = async () => {
    await signOut(auth);
  };

  if (errorMsg) {
    return (
      <div className="min-h-screen bg-stone-50 flex flex-col items-center justify-center p-6 text-center text-xs font-semibold text-stone-700">
        <div className="bg-white border border-stone-250 p-8 rounded-3xl max-w-md shadow-lg space-y-4 leading-relaxed">
          <AlertCircle className="w-12 h-12 text-red-655 mx-auto animate-pulse" />
          <h2 className="text-red-700 text-sm font-extrabold uppercase font-heading">Portal Connection Exception</h2>
          <p className="text-stone-800 font-semibold font-sans leading-relaxed">
            {errorMsg}
          </p>
          <p className="text-stone-650 font-semibold">
            If this issue persists, please check your network connection or contact the Greens Malayalee Koottayma (GMK) administrator group.
          </p>
          <div className="pt-2 flex gap-3">
            <button
              onClick={() => window.location.reload()}
              className="flex-1 py-2 border border-stone-300 hover:bg-stone-50 text-stone-750 font-bold uppercase tracking-wider rounded-xl cursor-pointer"
            >
              Retry
            </button>
            <button
              onClick={handleLogout}
              className="flex-1 py-2 bg-[#0f4c2a] text-white hover:bg-[#125831] font-bold uppercase tracking-wider rounded-xl cursor-pointer"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FFFDF6] flex flex-col items-center justify-center font-sans space-y-3">
        <RefreshCw className="w-7 h-7 text-[#0f4c2a] animate-spin mx-auto opacity-75" />
        <p className="text-sm font-medium text-stone-600 font-sans tracking-wide">
          Loading...
        </p>
      </div>
    );
  }

  // Dual validation: Must exist inside residents registry with approved/active status
  if (!effectiveProfile) {
    return (
      <div className="min-h-screen bg-stone-50 flex flex-col items-center justify-center p-6 text-center text-xs font-semibold text-stone-700">
        <div className="bg-white border border-stone-250 p-8 rounded-3xl max-w-md shadow-lg space-y-4 leading-relaxed">
          <Award className="w-10 h-10 text-[#d4af37] mx-auto animate-bounce" />
          <h2 className="text-[#0f4c2a] text-sm font-extrabold uppercase font-heading">Access Blocked</h2>
          <p className="text-stone-800 font-semibold">
            Your login email address is verified, but we were unable to retrieve corresponding files inside our approved resident registry.
          </p>
          <p className="text-stone-650 font-semibold">
            Kindly wait for administrator status activation or write to us for assistance.
          </p>
          <button
            onClick={handleLogout}
            className="w-full py-2 bg-[#0f4c2a] text-white hover:bg-emerald-850 font-bold uppercase tracking-wider rounded-xl cursor-pointer"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  const needsOnboarding = !familyDoc || !familyDoc.onboardingCompleted;

  if (needsOnboarding || forceEditingOnboarding) {
    return (
      <ProfileCompletionWizard 
        residentProfile={effectiveProfile} 
        onComplete={() => {
          setForceEditingOnboarding(false);
          setActiveTab('home');
        }} 
      />
    );
  }

  if (activeTab === 'event_director' && isEventDirectorRole) {
    return (
      <EventDirectorDashboard 
        onBackToResidentPortal={() => {
          setActiveTab('home');
          setActiveWorkspaceTarget(null);
        }} 
        initialTabTarget={activeWorkspaceTarget} 
        userResponsibilities={responsibilities} 
      />
    );
  }

  return (
    <AppShell 
      activeTab={activeTab} 
      setActiveTab={setActiveTab} 
      unitNumber={effectiveProfile.displayUnitNumber}
    >
      {/* A. HOME VIEW */}
      {activeTab === 'home' && (
        <div className="space-y-6 text-xs font-semibold text-stone-600 animate-fadeIn">
          
          {/* Header Greeting block inside a GMKCard */}
          <GMKCard className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div>
              <GMKPageHeader 
                title={`Welcome, ${normalizeName(familyDoc?.fullName || effectiveProfile?.fullName || 'Resident')}`} 
                subtitle="You are logged in to the GMK community registry. Keep your household list and settings updated inside My family."
              />
            </div>
            
            <div className="bg-emerald-50 border border-emerald-100 p-3.5 rounded-2xl text-[11px] font-sans shrink-0 flex items-center space-x-2">
              <ShieldCheck className="w-5 h-5 text-[#d4af37]" />
              <div>
                <span className="block text-[#0f4c2a] font-bold">Verified ID</span>
                <strong className="block text-emerald-900">{effectiveProfile.gmkId}</strong>
              </div>
            </div>
          </GMKCard>

          {/* Registered Events Section (Sprint GMK-STAB-003) */}
          {registrations.length > 0 && (
            <div className="space-y-4">
              <h4 className="text-xs font-extrabold text-[#0f4c2a] uppercase tracking-wider flex items-center space-x-1.5 font-heading">
                <Calendar className="w-4 h-4 text-[#d4af37]" />
                <span>My Registered Events</span>
              </h4>
              <div className="bg-white border border-stone-200 rounded-3xl p-5 shadow-sm space-y-3">
                <div className="divide-y divide-stone-100">
                  {registrations.map(reg => {
                    const evt = events.find(e => e.id === reg.eventId);
                    if (!evt) return null;
                    
                    return (
                      <div key={reg.id} className="py-3 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                        <span className="text-sm font-extrabold text-stone-900 font-heading capitalize">
                          {evt.title || evt.eventName}
                        </span>
                        <div className="flex items-center space-x-3">
                          <span className="text-[9px] uppercase tracking-wider text-emerald-800 font-extrabold bg-emerald-50 border border-emerald-100 px-2.5 py-0.5 rounded-full">
                            ✓ Registered
                          </span>
                          <button
                            type="button"
                            onClick={() => setActiveTab('events')}
                            className="text-[10px] uppercase tracking-wider text-[#0f4c2a] hover:underline font-extrabold cursor-pointer animate-pulse-slow"
                          >
                            Manage in GMK Events ➜
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* My Family Summary GMKCard */}
          <GMKCard className="space-y-4">
            <div className="flex items-center justify-between border-b border-stone-100 pb-3">
              <h4 className="text-xs font-extrabold text-[#0f4c2a] uppercase tracking-wider flex items-center space-x-1.5 font-heading">
                <Users className="w-4 h-4 text-[#d4af37]" />
                <span>My Family Summary</span>
              </h4>
              <GMKButton
                variant="primary"
                size="md"
                onClick={() => { setForceEditingOnboarding(true); }}
                className="flex items-center space-x-2 font-bold shadow-sm px-4 py-2 text-xs rounded-xl"
                title="Edit Family & Household Profile"
              >
                <Edit className="w-3.5 h-3.5 text-[#d4af37]" />
                <span>Edit</span>
              </GMKButton>
            </div>

            <div className="flex flex-wrap gap-4">
              <div className="flex-1 min-w-[180px] bg-stone-50/60 p-3.5 rounded-2xl border border-stone-150 flex flex-col justify-between">
                <div>
                  <span className="text-stone-650 block font-extrabold text-[8px] uppercase tracking-wider">Primary Resident</span>
                  <span className="text-stone-850 font-extrabold text-xs block mt-1 leading-tight">
                    {familyDoc?.salutation || "Mr/Mrs"} {normalizeName(familyDoc?.fullName || effectiveProfile.fullName)}
                  </span>
                </div>
                <span className="text-stone-700 text-[10px] font-bold mt-2 block font-sans truncate">
                  {familyDoc?.professionTitle || "Primary Resident"}
                </span>
              </div>

              {familyMembers.filter(m => m.relationship === 'spouse').map(sp => (
                <div key={sp.id} className="flex-1 min-w-[180px] bg-stone-50/60 p-3.5 rounded-2xl border border-stone-150 flex flex-col justify-between animate-fadeIn">
                  <div>
                    <span className="text-rose-600 block font-extrabold text-[8px] uppercase tracking-wider">Spouse</span>
                    <span className="text-stone-855 font-extrabold text-xs block mt-1 leading-tight">{normalizeName(sp.name)}</span>
                  </div>
                  <span className="text-stone-700 text-[10px] font-bold mt-2 block truncate capitalize">{sp.profession || "Spouse"}</span>
                </div>
              ))}

              {familyMembers.filter(m => m.relationship === 'child').length > 0 && (
                <div className="flex-1 min-w-[180px] bg-stone-50/60 p-3.5 rounded-2xl border border-stone-150 flex flex-col justify-between animate-fadeIn">
                  <div>
                    <span className="text-sky-600 block font-extrabold text-[8px] uppercase tracking-wider">Children</span>
                    <span className="text-stone-855 font-mono font-extrabold text-xl block mt-1">
                      {familyMembers.filter(m => m.relationship === 'child').length}
                    </span>
                  </div>
                  <span className="text-stone-700 text-[10px] font-bold mt-2 block truncate capitalize" title={familyMembers.filter(m => m.relationship === 'child').map(m => normalizeName(m.name)).join(', ')}>
                    {familyMembers.filter(m => m.relationship === 'child').map(m => normalizeName(m.name)).join(', ')}
                  </span>
                </div>
              )}

              {familyMembers.filter(m => m.relationship === 'parent').length > 0 && (
                <div className="flex-1 min-w-[180px] bg-stone-50/60 p-3.5 rounded-2xl border border-stone-150 flex flex-col justify-between animate-fadeIn">
                  <div>
                    <span className="text-purple-600 block font-extrabold text-[8px] uppercase tracking-wider">Parents</span>
                    <span className="text-stone-855 font-mono font-extrabold text-xl block mt-1">
                      {familyMembers.filter(m => m.relationship === 'parent').length}
                    </span>
                  </div>
                  <span className="text-stone-700 text-[10px] font-bold mt-2 block truncate capitalize" title={familyMembers.filter(m => m.relationship === 'parent').map(m => m.name).join(', ')}>
                    {familyMembers.filter(m => m.relationship === 'parent').map(m => m.name).join(', ')}
                  </span>
                </div>
              )}

              {familyMembers.filter(m => m.relationship === 'dependent').length > 0 && (
                <div className="flex-1 min-w-[180px] bg-stone-50/60 p-3.5 rounded-2xl border border-stone-150 flex flex-col justify-between animate-fadeIn">
                  <div>
                    <span className="text-amber-600 block font-extrabold text-[8px] uppercase tracking-wider">Others</span>
                    <span className="text-stone-855 font-mono font-extrabold text-xl block mt-1">
                      {familyMembers.filter(m => m.relationship === 'dependent').length}
                    </span>
                  </div>
                  <span className="text-stone-700 text-[10px] font-bold mt-2 block truncate capitalize" title={familyMembers.filter(m => m.relationship === 'dependent').map(m => m.name).join(', ')}>
                    {familyMembers.filter(m => m.relationship === 'dependent').map(m => m.name).join(', ')}
                  </span>
                </div>
              )}
            </div>
          </GMKCard>

          {/* Announcements block inside a card if any exist */}
          {announcements.length > 0 && (
            <GMKCard className="space-y-4">
              <h4 className="text-xs font-extrabold text-[#0f4c2a] uppercase tracking-wider flex items-center space-x-1.5 font-heading border-b border-stone-100 pb-3">
                <Sparkles className="w-4 h-4 text-[#d4af37]" />
                <span>Community Announcements</span>
              </h4>
              <div className="space-y-3.5 divide-y divide-stone-100">
                {announcements.slice(0, 3).map((ann) => (
                  <div key={ann.id} className="pt-3 first:pt-0 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-stone-900 font-extrabold text-xs">{ann.title}</span>
                      <span className="text-[10px] font-mono text-stone-500">{new Date(ann.date).toLocaleDateString()}</span>
                    </div>
                    <p className="text-stone-650 text-[11px] leading-relaxed font-medium">{ann.content}</p>
                  </div>
                ))}
              </div>
            </GMKCard>
          )}

        </div>
      )}

      {/* B. EVENTS TAB */}
      {activeTab === 'events' && (
        <EventsManager 
          residentProfile={effectiveProfile} 
          onViewEventDetails={(evt) => setViewingEventDetails(evt)}
        />
      )}

      {/* C. EXPERTISE SEARCH TAB */}
      {activeTab === 'expertise_search' && (
        <ProfessionalSearch />
      )}

      {/* D. ADMIN PORTAL TAB */}
      {activeTab === 'admin_workspace' && (profile?.roles.includes('admin') || profile?.roles.includes('super_admin')) && (
        <AdminDashboard activeEmail={effectiveProfile.email} isEmergency={isEmergencyAdmin} />
      )}

      {/* E. SUPER ADMIN PORTAL TAB */}
      {activeTab === 'super_admin_workspace' && profile?.roles.includes('super_admin') && (
        <SuperAdminDashboard activeEmail={effectiveProfile.email} />
      )}

      {/* F. GOVERNANCE TAB */}
      {activeTab === 'governance' && (profile?.roles.includes('president') || profile?.roles.includes('vp') || profile?.roles.includes('vice_president')) && (
        <GovernancePanel activeEmail={effectiveProfile.email} />
      )}

      {viewingEventDetails && (() => {
        const reg = registrations.find(r => r.eventId === viewingEventDetails.id);
        const pricing = viewingEventDetails.pricing;
        return (
          <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn" id="event-details-dialog">
            <div className="bg-white border border-stone-250 w-full max-w-2xl rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh] animate-scaleUp">
              
              {/* Modal Header & Poster Banner */}
              <div className="relative bg-stone-900 h-48 sm:h-56 w-full shrink-0">
                {viewingEventDetails.posterUrl || viewingEventDetails.logoUrl || viewingEventDetails.Poster ? (
                  <img 
                    src={viewingEventDetails.posterUrl || viewingEventDetails.logoUrl || viewingEventDetails.Poster} 
                    alt={viewingEventDetails.title}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover opacity-85"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-[#0f4c2a] to-[#125831] p-6 text-center text-white">
                    <Calendar className="w-10 h-10 text-[#d4af37] mb-2" />
                    <span className="font-extrabold uppercase tracking-widest text-[11px]">GMK Community Gathering</span>
                  </div>
                )}
                
                {/* Close Button on Image */}
                <button 
                  onClick={() => setViewingEventDetails(null)}
                  className="absolute top-4 right-4 bg-stone-900/60 hover:bg-stone-900 text-white p-2 rounded-full cursor-pointer transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>

                {/* Event Name Overlay */}
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-stone-950 to-transparent p-6 text-white text-left">
                  <span className="bg-[#d4af37] text-stone-950 font-black tracking-widest text-[8px] px-2 py-0.5 rounded-full uppercase">
                    Event Details
                  </span>
                  <h3 className="text-base sm:text-lg font-extrabold leading-tight font-heading capitalize mt-1.5">
                    {viewingEventDetails.title || viewingEventDetails.eventName}
                  </h3>
                </div>
              </div>

              {/* Modal Content - Scrollable */}
              <div className="p-6 overflow-y-auto space-y-6 text-left">
                
                {/* Description */}
                <div className="space-y-1">
                  <h4 className="text-[10px] uppercase font-black text-stone-500 tracking-wider font-heading">Event Description</h4>
                  <p className="text-stone-750 text-[11px] leading-relaxed font-medium">
                    {viewingEventDetails.description || 'No description available for this event.'}
                  </p>
                </div>

                {/* Event Logistics */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-stone-50 p-4 border border-stone-155 rounded-2xl text-[10px] font-bold text-stone-850">
                  <div className="space-y-3">
                    <span className="text-[8px] uppercase tracking-wider text-stone-500 block font-heading font-black">Event details</span>
                    
                    {viewingEventDetails.date && (
                      <div className="flex items-center space-x-2">
                        <Clock className="w-4 h-4 text-[#d4af37]" />
                        <span>{new Date(viewingEventDetails.date).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
                      </div>
                    )}
                    {viewingEventDetails.venue && (
                      <div className="flex items-center space-x-2">
                        <MapPin className="w-4 h-4 text-[#d4af37]" />
                        <span>{viewingEventDetails.venue}</span>
                      </div>
                    )}
                  </div>

                  <div className="space-y-3 md:border-l md:border-stone-200 md:pl-4">
                    <span className="text-[8px] uppercase tracking-wider text-stone-500 block font-heading font-black">Deadlines & Roles</span>
                    {viewingEventDetails.registrationEnd && (
                      <div className="flex items-center space-x-2">
                        <span className="font-black text-[9px] uppercase tracking-wider text-[#0f4c2a]">Registration Closes:</span>
                        <span>{new Date(viewingEventDetails.registrationEnd).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                      </div>
                    )}
                    <div className="flex items-center space-x-2">
                      <span className="font-black text-[9px] uppercase tracking-wider text-[#0f4c2a]">Contact:</span>
                      <span className="text-stone-700 font-bold">
                        {attendanceLead ? `${attendanceLead.name} (${attendanceLead.phone})` : 'Attendance Committee Lead (+968 9000 0000)'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Program Highlights */}
                {viewingEventDetails.highlights && viewingEventDetails.highlights.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-[10px] uppercase font-black text-[#0f4c2a] tracking-wider font-heading">Program Highlights</h4>
                    <div className="flex flex-wrap gap-2">
                      {viewingEventDetails.highlights.map((hl, idx) => (
                        <div key={idx} className="flex items-center space-x-1.5 bg-emerald-50 border border-emerald-100 px-3 py-1 rounded-full text-stone-800 text-[10px] font-bold">
                          <span>⭐ {hl}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* User's RSVP State */}
                {reg ? (
                  <div className="bg-emerald-50 border border-emerald-150 p-5 rounded-2xl space-y-3 animate-fadeIn">
                    <div className="flex items-center space-x-2 text-emerald-900">
                      <Check className="w-5 h-5 text-[#d4af37]" />
                      <div>
                        <strong className="text-xs font-black uppercase font-heading block">You are Registered!</strong>
                        <span className="text-[10px] text-emerald-800 font-bold block">Household RSVP snapshot was successfully finalized.</span>
                      </div>
                    </div>
                    
                    <div className="border-t border-emerald-100/60 pt-3 text-[10px] text-stone-800 font-bold space-y-1.5">
                      <div className="flex justify-between">
                        <span className="text-emerald-800/80">RSVP Scope:</span>
                        <span className="capitalize">{reg.registrationType || 'family'} Unit</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-emerald-800/80">Total Amount Paid:</span>
                        <span className="font-mono text-stone-900">OMR {reg.paymentAmount || reg.paymentSummary?.totalAmount || 0}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-emerald-800/80 font-bold">Registered Household Members ({reg.totalParticipants}):</span>
                        <span className="text-[#0f4c2a] text-right font-black max-w-[250px] truncate" title={reg.participants?.join(', ')}>
                          {reg.participants?.join(', ')}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 bg-stone-50 border border-stone-200 rounded-2xl text-[10px] font-bold text-stone-500 italic text-center">
                    You have not registered for this community event.
                  </div>
                )}

              </div>

              {/* Modal Footer */}
              <div className="p-4 bg-stone-50 border-t border-stone-150 flex justify-end shrink-0">
                <button
                  type="button"
                  onClick={() => setViewingEventDetails(null)}
                  className="px-5 py-2 rounded-xl bg-stone-850 hover:bg-stone-900 text-white text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer shadow-xs"
                >
                  Close Details
                </button>
              </div>

            </div>
          </div>
        );
      })()}
    </AppShell>
  );
}
