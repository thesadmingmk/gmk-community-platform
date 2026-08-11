import React, { useState, useEffect } from 'react';
import { jsPDF } from 'jspdf';
import { db, useAuth, storage, auth } from '../context/AuthContext';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { 
  collection, 
  doc, 
  setDoc, 
  getDocs, 
  getDoc,
  onSnapshot, 
  addDoc, 
  updateDoc, 
  query, 
  where,
  deleteDoc,
  writeBatch,
  runTransaction
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject, getStorage } from 'firebase/storage';
import { 
  CommunityEvent, 
  ResidentProfile, 
  EventCommittee, 
  EventCommitteeMember,
  EventCommitteeExpense,
  EventProgram, 
  EventRegistration,
  Family,
  FamilyMember,
  PaymentAccount
} from '../types';
import { 
  Calendar, 
  Settings, 
  Users, 
  Flame, 
  FileText, 
  TrendingUp,
  Plus, 
  Trash2, 
  ChevronRight, 
  ArrowLeft, 
  Upload, 
  Check, 
  AlertCircle,
  Download,
  Info,
  CalendarDays,
  X,
  MapPin,
  Clock,
  UserCheck,
  Search,
  Loader2,
  CheckCircle2,
  XCircle,
  MinusCircle,
  Archive,
  RotateCcw,
  Edit3
} from 'lucide-react';
import { GMKCard, GMKBadge } from './gmk/DesignSystem';
import { useLocalGEASConfirmation, GEASConfirmationDialogUI } from './gmk/GEASConfirmationDialog';
import { createAuditLog } from '../utils/audit';
import { getEventRegistrationStatus, getRegistrationStatusLabel } from '../utils/eventLifecycle';

type EDTab = 'events' | 'configuration' | 'committees' | 'programs' | 'registrations' | 'reports';

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

function formatISOToDateInput(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const day = d.getDate();
  const m = MONTH_NAMES[d.getMonth()];
  const y = d.getFullYear();
  return `${day} ${m} ${y}`;
}

function formatISOToTimeInput(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  let hr = d.getHours();
  const mn = d.getMinutes().toString().padStart(2, '0');
  const ampm = hr >= 12 ? "PM" : "AM";
  hr = hr % 12;
  if (hr === 0) hr = 12;
  return `${hr}:${mn} ${ampm}`;
}

function parseTypedDate(str: string): Date | null {
  const clean = str.trim();
  if (!clean) return null;
  
  const firstTry = new Date(clean);
  if (!isNaN(firstTry.getTime())) return firstTry;
  
  const regex = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/;
  const match = clean.match(regex);
  if (match) {
    const day = parseInt(match[1], 10);
    const monthStr = match[2].toLowerCase();
    const year = parseInt(match[3], 10);
    
    const monthIdx = MONTH_NAMES.findIndex(m => monthStr.startsWith(m.toLowerCase()));
    if (monthIdx >= 0 && day >= 1 && day <= 31 && year >= 2000 && year <= 2100) {
      return new Date(year, monthIdx, day);
    }
  }
  return null;
}

function parseTypedTime(str: string): { hour: number; minute: number } | null {
  const clean = str.trim().toUpperCase();
  if (!clean) return null;
  
  const regex = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/;
  const match = clean.match(regex);
  if (match) {
    let hour = parseInt(match[1], 10);
    const minute = parseInt(match[2], 10);
    const ampm = match[3];
    if (hour >= 1 && hour <= 12 && minute >= 0 && minute <= 59) {
      if (ampm === "PM" && hour < 12) hour += 12;
      if (ampm === "AM" && hour === 12) hour = 0;
      return { hour, minute };
    } else if (!ampm && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { hour, minute };
    }
  }
  return null;
}

function mergeDateAndISO(dateObj: Date, originalISO: string): string {
  const original = originalISO ? new Date(originalISO) : new Date();
  const merged = new Date(
    dateObj.getFullYear(),
    dateObj.getMonth(),
    dateObj.getDate(),
    isNaN(original.getTime()) ? 9 : original.getHours(),
    isNaN(original.getTime()) ? 0 : original.getMinutes(),
    0
  );
  return merged.toISOString();
}

function mergeTimeAndISO(timeObj: { hour: number; minute: number }, originalISO: string): string {
  const original = originalISO ? new Date(originalISO) : new Date();
  const merged = new Date(
    isNaN(original.getTime()) ? new Date().getFullYear() : original.getFullYear(),
    isNaN(original.getTime()) ? new Date().getMonth() : original.getMonth(),
    isNaN(original.getTime()) ? new Date().getDate() : original.getDate(),
    timeObj.hour,
    timeObj.minute,
    0
  );
  return merged.toISOString();
}

function CompactEditableInput({ 
  label, 
  value, 
  type, 
  onChange, 
  disabled 
}: { 
  label: string; 
  value: string; 
  type: 'date' | 'time'; 
  onChange: (newISO: string) => void; 
  disabled?: boolean; 
}) {
  const initialText = type === 'date' ? formatISOToDateInput(value) : formatISOToTimeInput(value);
  const [localText, setLocalText] = useState(initialText);
  const [isFocused, setIsFocused] = useState(false);
  const [isValid, setIsValid] = useState(true);

  useEffect(() => {
    if (!isFocused) {
      setLocalText(type === 'date' ? formatISOToDateInput(value) : formatISOToTimeInput(value));
      setIsValid(true);
    }
  }, [value, isFocused, type]);

  const handleBlur = () => {
    setIsFocused(false);
    if (type === 'date') {
      const parsed = parseTypedDate(localText);
      if (parsed) {
        setIsValid(true);
        const newISO = mergeDateAndISO(parsed, value);
        onChange(newISO);
      } else {
        setIsValid(false);
      }
    } else {
      const parsed = parseTypedTime(localText);
      if (parsed) {
        setIsValid(true);
        const newISO = mergeTimeAndISO(parsed, value);
        onChange(newISO);
      } else {
        setIsValid(false);
      }
    }
  };

  return (
    <div className="flex-1">
      <label className="block text-[12px] font-semibold text-stone-500 mb-1 leading-none">{label}</label>
      <div className="relative">
        <input
          type="text"
          disabled={disabled}
          value={localText}
          onChange={(e) => {
            setLocalText(e.target.value);
            if (type === 'date') {
              setIsValid(parseTypedDate(e.target.value) !== null);
            } else {
              setIsValid(parseTypedTime(e.target.value) !== null);
            }
          }}
          onFocus={() => setIsFocused(true)}
          onBlur={handleBlur}
          placeholder={type === 'date' ? 'e.g. 10 Aug 2026' : 'e.g. 10:00 AM'}
          className={`w-full font-bold bg-stone-50 border p-2.5 rounded-xl text-stone-850 text-xs focus:outline-none focus:ring-1 transition-all disabled:opacity-50 ${
            isValid 
              ? 'border-stone-200 focus:border-[#0f4c2a] focus:ring-[#0f4c2a]' 
              : 'border-rose-300 focus:border-rose-500 focus:ring-rose-500 bg-rose-50/10'
          }`}
        />
        {!isValid && (
          <span className="absolute right-3 top-2.5 text-rose-500 text-xs font-semibold select-none">!</span>
        )}
      </div>
      <p className="text-[9px] text-stone-400 mt-1">
        {type === 'date' ? 'Format: DD MMM YYYY' : 'Format: HH:MM AM/PM'}
      </p>
    </div>
  );
}

interface UploadDiagnostic {
  compression: 'pending' | 'running' | 'success' | 'failed' | 'idle';
  compressionDetails?: string;
  storageRef: 'pending' | 'running' | 'success' | 'failed' | 'idle';
  storageRefDetails?: string;
  uploadBytes: 'pending' | 'running' | 'success' | 'failed' | 'idle';
  uploadBytesDetails?: string;
  downloadUrl: 'pending' | 'running' | 'success' | 'failed' | 'idle';
  downloadUrlDetails?: string;
  firestoreUpdate: 'pending' | 'running' | 'success' | 'failed' | 'idle';
  firestoreUpdateDetails?: string;
  finalRendering: 'pending' | 'running' | 'success' | 'failed' | 'idle';
  finalRenderingDetails?: string;
}

interface EventDirectorDashboardProps {
  onBackToResidentPortal?: () => void;
}

export default function EventDirectorDashboard({ onBackToResidentPortal }: EventDirectorDashboardProps) {
  const { profile } = useAuth();
  const { confirm: showConfirm, isOpen: isConfirmOpen, options: confirmOptions, handleCancel: handleConfirmCancel, handleConfirm: handleConfirmSubmit } = useLocalGEASConfirmation();
  const [activeTab, setActiveTab] = useState<EDTab>('events');
  
  // Real-time Firestore collections
  const [events, setEvents] = useState<CommunityEvent[]>([]);
  const [residents, setResidents] = useState<ResidentProfile[]>([]);
  const [families, setFamilies] = useState<Family[]>([]);
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([]);

  // Selected active Event Master reference
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [activeEvent, setActiveEvent] = useState<CommunityEvent | null>(null);

  // Active event's sub-collections (synced in real-time)
  const [activeCommittees, setActiveCommittees] = useState<EventCommittee[]>([]);
  const [activePrograms, setActivePrograms] = useState<EventProgram[]>([]);
  const [registrations, setRegistrations] = useState<EventRegistration[]>([]);

  // Local navigation & sub-state
  const [showNewEventForm, setShowNewEventForm] = useState(false);
  const [activeCommitteeToConfigure, setActiveCommitteeToConfigure] = useState<string | null>(null);
  const [committeeTab, setCommitteeTab] = useState<'active' | 'archived'>('active');
  const [showRegistrantsTable, setShowRegistrantsTable] = useState(true);
  const [showReadinessDetails, setShowReadinessDetails] = useState(false);

  // Feedback states
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [uploadingType, setUploadingType] = useState<'Poster' | 'Thumbnail' | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Stabilization Sprint States (diagnostics & telemetry)
  const [lastUploadError, setLastUploadError] = useState<string | null>(null);
  const [lastFirestoreReadStatus, setLastFirestoreReadStatus] = useState<string>('PENDING');
  const [lastFirestoreWriteStatus, setLastFirestoreWriteStatus] = useState<string>('OK');
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const [uploadDiagnostics, setUploadDiagnostics] = useState<UploadDiagnostic>({
    compression: 'idle',
    storageRef: 'idle',
    uploadBytes: 'idle',
    downloadUrl: 'idle',
    firestoreUpdate: 'idle',
    finalRendering: 'idle'
  });

  // Track transaction and detailed errors
  const [lastTransactionStatus, setLastTransactionStatus] = useState<string>('IDLE');
  const [lastRefreshTimestamp, setLastRefreshTimestamp] = useState<string>('Never');
  const [lastErrorCode, setLastErrorCode] = useState<string>('None');
  const [lastErrorMessage, setLastErrorMessage] = useState<string>('None');

  // Form state: + New Event
  const [newEventName, setNewEventName] = useState('');
  const [newEventType, setNewEventType] = useState('Onam');
  const [newEventYear, setNewEventYear] = useState<number>(new Date().getFullYear());
  const [newEventDescription, setNewEventDescription] = useState('');

  // Form states: Configuration
  const [configEventName, setConfigEventName] = useState('');
  const [configDescription, setConfigDescription] = useState('');
  const [configVenue, setConfigVenue] = useState('');
  
  // Registration and Event Date/Time States (Sprint 4)
  const [configRegStart, setConfigRegStart] = useState('');
  const [configRegEnd, setConfigRegEnd] = useState('');
  const [configEventStart, setConfigEventStart] = useState('');
  const [configEventEnd, setConfigEventEnd] = useState('');
  
  const [configRegEnabled, setConfigRegEnabled] = useState<boolean>(false);
  const [configIndividualFee, setConfigIndividualFee] = useState<number>(0);
  const [configCoupleFee, setConfigCoupleFee] = useState<number>(0);
  const [configFamilyFee, setConfigFamilyFee] = useState<number>(0);

  const [configStatus, setConfigStatus] = useState<'draft' | 'published' | 'completed'>('draft');

  // Extended pricing engine states (Sprint 6 & v1.1)
  const [configFreeChildAge, setConfigFreeChildAge] = useState<number>(5);
  const [configHalfChildAge, setConfigHalfChildAge] = useState<number>(12);
  const [configAdultAge, setConfigAdultAge] = useState<number>(18);
  const [configParentFee, setConfigParentFee] = useState<number>(5);
  const [configOtherFee, setConfigOtherFee] = useState<number>(5);

  // External participant states (Sprint GMK-ARCH-002)
  const [configAllowExternal, setConfigAllowExternal] = useState<boolean>(false);
  const [configExternalRate, setConfigExternalRate] = useState<number>(0);

  // Managed Program Highlights
  const [configHighlights, setConfigHighlights] = useState<string[]>([]);

  // Operational Completion Checklist States (Sprint 2)
  const [chkRegClosed, setChkRegClosed] = useState(false);
  const [chkProgramFinalized, setChkProgramFinalized] = useState(false);
  const [chkAttendanceClosed, setChkAttendanceClosed] = useState(false);
  const [chkFinanceSubmitted, setChkFinanceSubmitted] = useState(false);
  const [chkFinanceApproved, setChkFinanceApproved] = useState(false);
  const [chkPresApproved, setChkPresApproved] = useState(false);
  const [chkCertificatesGenerated, setChkCertificatesGenerated] = useState(false);

  // Real-time Save Feedback Indicator (Sprint 7)
  const [justSaved, setJustSaved] = useState<boolean>(false);
  const [explicitCompletion, setExplicitCompletion] = useState<boolean>(false);
  const [showSummaryModal, setShowSummaryModal] = useState<boolean>(false);
  const [showCommitteeDataModal, setShowCommitteeDataModal] = useState<boolean>(false);
  const [certTab, setCertTab] = useState<'all' | 'leads' | 'coordinators' | 'volunteers' | 'participants'>('all');
  const [certSearch, setCertSearch] = useState<string>('');
  const [showAssetManager, setShowAssetManager] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const [isPricingEditing, setIsPricingEditing] = useState<boolean>(false);
  const [isTimelinesEditing, setIsTimelinesEditing] = useState<boolean>(false);
  const [configPaymentAccounts, setConfigPaymentAccounts] = useState<PaymentAccount[]>([]);
  const [showPricingPolicyModal, setShowPricingPolicyModal] = useState<boolean>(false);
  const [auditResults, setAuditResults] = useState<Record<string, {
    name: string;
    identifier: string;
    onboardingStatus: 'completed' | 'incomplete' | 'N/A';
    familyExists: boolean | 'N/A';
    profileStatus: 'active' | 'suspended' | 'N/A';
    firestoreRead: 'Success' | 'Permission Denied' | 'N/A';
    details?: string;
  }>>({});

  // Derived checklist logic (Sprint 2)
  const isEventDatePassed = configEventStart ? new Date() > new Date(configEventStart) : (activeEvent?.date ? new Date() > new Date(activeEvent.date) : false);
  const isCompletionChecklistVisible = isEventDatePassed || explicitCompletion || configStatus === 'completed';
  const isRegDateClosed = configRegEnd ? new Date() > new Date(configRegEnd) : false;
  const isProgramsAllApproved = activePrograms.length > 0 && activePrograms.every(p => p.status === 'approved' || p.status === 'rejected');

  const isFinanceSubmittedAuto = 
    (activeEvent?.completionChecklist?.financeSubmitted) || 
    (registrations.length > 0 && registrations.every(r => r.paymentStatus === 'paid' || r.paymentStatus === 'approved' || r.paymentStatus === 'waived'));

  const isFinanceApprovedAuto = 
    (activeEvent?.completionChecklist?.financeApproved) || 
    (isFinanceSubmittedAuto && activePrograms.length > 0 && activePrograms.every(p => p.status === 'approved' || p.status === 'rejected'));

  const isPresApprovedAuto = 
    (activeEvent?.completionChecklist?.presApproval) || 
    (isFinanceApprovedAuto && activeEvent?.status === 'published');

  const isCompletionReady = 
    (chkRegClosed || isRegDateClosed) &&
    (chkProgramFinalized || isProgramsAllApproved) &&
    chkAttendanceClosed &&
    isFinanceSubmittedAuto &&
    isFinanceApprovedAuto &&
    isPresApprovedAuto &&
    chkCertificatesGenerated;

  // Form states: Committee assignments
  const [selectedLeadGmkId, setSelectedLeadGmkId] = useState('');
  const [newCommitteeName, setNewCommitteeName] = useState('');
  const [showAddHighlightInput, setShowAddHighlightInput] = useState(false);
  const [newHighlightValue, setNewHighlightValue] = useState('');
  const [showAddCommitteeInput, setShowAddCommitteeInput] = useState(false);
  const [residentSearchQuery, setResidentSearchQuery] = useState('');
  const [committeeSearchQueries, setCommitteeSearchQueries] = useState<Record<string, string>>({});

  // Workspace and unique Program Committee configuration states
  const [progTitle, setProgTitle] = useState('');
  const [progType, setProgType] = useState('Select');
  const [progDescription, setProgDescription] = useState('');
  const [progCoordinator, setProgCoordinator] = useState<ResidentProfile | null>(null);
  const [progCoordinatorSearch, setProgCoordinatorSearch] = useState('');
  const [expenseTitle, setExpenseTitle] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [commExpenseDate, setCommExpenseDate] = useState('');
  const [commExpenseDesc, setCommExpenseDesc] = useState('');
  const [commExpenseAmount, setCommExpenseAmount] = useState('');
  const [activeProgForManagement, setActiveProgForManagement] = useState<string | null>(null);
  const [editingProgramId, setEditingProgramId] = useState<string | null>(null);
  const [editProgTitle, setEditProgTitle] = useState('');
  const [editProgCategory, setEditProgCategory] = useState<string>('ADULTS');
  const [editProgDescription, setEditProgDescription] = useState('');

  // Search states inside workspaces
  const [workspaceSearchQuery, setWorkspaceSearchQuery] = useState('');
  const [progCoordSearchQuery, setProgCoordSearchQuery] = useState('');
  const [progVolSearchQuery, setProgVolSearchQuery] = useState('');
  const [progParticipantSearchQuery, setProgParticipantSearchQuery] = useState('');
  const [participantAgeFilter, setParticipantAgeFilter] = useState('All');
  const [participantGenderFilter, setParticipantGenderFilter] = useState('All');
  const [searchAudienceFilter, setSearchAudienceFilter] = useState<'Children' | 'Adults' | 'Mixed'>('Mixed');

  // Auto-open program workspace if ?programWorkspace=<id> is in URL
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const progId = params.get('programWorkspace') || params.get('programId');
      if (progId) {
        setActiveCommitteeToConfigure('Program Committee');
        setActiveProgForManagement(progId);
      }
    }
  }, []);

  // Auto-clear success and error alerts
  useEffect(() => {
    if (successMsg) {
      const timer = setTimeout(() => setSuccessMsg(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [successMsg]);

  useEffect(() => {
    if (errorMsg) {
      const timer = setTimeout(() => setErrorMsg(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [errorMsg]);

  // 1. Listeners for Master Collections
  useEffect(() => {
    setIsLoading(true);

    const unsubEvents = onSnapshot(collection(db, "events"), (snap) => {
      const list: CommunityEvent[] = [];
      snap.forEach(d => {
        const item = { id: d.id, ...d.data() } as CommunityEvent;
        // Keep field fallbacks
        if (!item.eventName && (item.title || item.displayName)) {
          item.eventName = item.title || item.displayName || '';
        }
        if (!item.eventYear && item.year) {
          item.eventYear = item.year;
        }
        list.push(item);
      });
      setEvents(list);
      
      // Select first event if nothing selected
      if (list.length > 0 && !selectedEventId) {
        setSelectedEventId(list[0].id);
      }
      setIsLoading(false);
    }, (err) => {
      console.error("Events snapshot error:", err);
      setErrorMsg("Failed to synchronize active events.");
      setIsLoading(false);
    });

    const unsubResidents = onSnapshot(collection(db, "residents"), (snap) => {
      const list: ResidentProfile[] = [];
      snap.forEach(d => list.push(d.data() as ResidentProfile));
      setResidents(list.filter(r => r.status === 'active'));
    }, (err) => {
      console.warn("⚠️ [EventDirectorDashboard] Residents snapshot permission-denied or blocked:", err);
    });

    const unsubFamilies = onSnapshot(collection(db, "families"), (snap) => {
      const list: Family[] = [];
      snap.forEach(d => list.push(d.data() as Family));
      setFamilies(list);
    }, (err) => {
      console.warn("⚠️ [EventDirectorDashboard] Families snapshot permission-denied or blocked:", err);
    });

    const unsubFamilyMembers = onSnapshot(collection(db, "familyMembers"), (snap) => {
      const list: FamilyMember[] = [];
      snap.forEach(d => list.push(d.data() as FamilyMember));
      setFamilyMembers(list);
    }, (err) => {
      console.warn("⚠️ [EventDirectorDashboard] FamilyMembers snapshot permission-denied or blocked:", err);
    });

    return () => {
      unsubEvents();
      unsubResidents();
      unsubFamilies();
      unsubFamilyMembers();
    };
  }, []);

  // 2. Listeners for selected Event sub-collections
  useEffect(() => {
    if (!selectedEventId) {
      setActiveEvent(null);
      setActiveCommittees([]);
      setActivePrograms([]);
      setRegistrations([]);
      return;
    }

    const matchedEvent = events.find(e => e.id === selectedEventId) || null;
    setActiveEvent(matchedEvent);

    // Load active event sub-collections
    const qCommittees = query(collection(db, "eventCommittees"), where("eventId", "==", selectedEventId));
    const unsubCommittees = onSnapshot(qCommittees, (snap) => {
      const rawList: EventCommittee[] = [];
      snap.forEach(d => {
        const cData = d.data() as EventCommittee;
        let cName = cData.name || '';
        if (['event&program', 'event & program', 'program committee', 'programs'].includes(cName.toLowerCase())) {
          cName = 'Program';
        } else if (cName.toLowerCase() === 'stage & decor') {
          cName = 'Sourcing';
        }
        rawList.push({ ...cData, name: cName });
      });

      // Deduplicate by committee name, keeping members merged if multiple exist
      const commMap = new Map<string, EventCommittee>();
      rawList.forEach(c => {
        const key = c.name.toLowerCase();
        if (!commMap.has(key)) {
          commMap.set(key, { ...c });
        } else {
          const existing = commMap.get(key)!;
          const mergedMembers = [...(existing.members || [])];
          (c.members || []).forEach(m => {
            if (!mergedMembers.some(em => em.residentId === m.residentId)) {
              mergedMembers.push(m);
            }
          });
          commMap.set(key, { ...existing, members: mergedMembers });
        }
      });
      const list = Array.from(commMap.values());
      setActiveCommittees(list);
      setLastFirestoreReadStatus('OK');
      setLastRefreshTimestamp(new Date().toLocaleTimeString());
    }, (err) => {
      console.warn("⚠️ [EventDirectorDashboard] EventCommittees snapshot permission-denied or blocked:", err);
      setLastFirestoreReadStatus('ERROR: ' + err.code);
    });

    const qPrograms = query(collection(db, "eventPrograms"), where("eventId", "==", selectedEventId));
    const unsubPrograms = onSnapshot(qPrograms, (snap) => {
      const list: EventProgram[] = [];
      snap.forEach(d => list.push(d.data() as EventProgram));
      setActivePrograms(list);
      setLastFirestoreReadStatus('OK');
    }, (err) => {
      console.warn("⚠️ [EventDirectorDashboard] EventPrograms snapshot permission-denied or blocked:", err);
      setLastFirestoreReadStatus('ERROR: ' + err.code);
    });

    const qRegs = query(collection(db, "event_registrations"), where("eventId", "==", selectedEventId));
    const unsubRegs = onSnapshot(qRegs, (snap) => {
      const list: EventRegistration[] = [];
      snap.forEach(d => list.push(d.data() as EventRegistration));
      setRegistrations(list);
      setLastFirestoreReadStatus('OK');
    }, (err) => {
      console.warn("⚠️ [EventDirectorDashboard] EventRegistrations snapshot permission-denied or blocked:", err);
      setLastFirestoreReadStatus('ERROR: ' + err.code);
    });

    return () => {
      unsubCommittees();
      unsubPrograms();
      unsubRegs();
    };
  }, [selectedEventId, events]);

  // 3. Sync Configuration state fields with active event
  useEffect(() => {
    if (activeEvent) {
      setConfigEventName(activeEvent.eventName || activeEvent.title || activeEvent.displayName || '');
      setConfigDescription(activeEvent.description || '');
      setConfigVenue(activeEvent.Venue || activeEvent.venue || '');
      
      const settings = activeEvent.registrationSettings as any;
      if (settings) {
        setConfigRegEnabled(settings.registrationEnabled || false);
        setConfigIndividualFee(settings.individualFee || 0);
        setConfigCoupleFee(settings.coupleFee || 0);
        setConfigFamilyFee(settings.familyFee || 0);
        setConfigRegStart(settings.registrationStart || activeEvent.registrationStart || '');
        setConfigRegEnd(settings.registrationEnd || activeEvent.registrationEnd || '');
        setConfigEventStart(settings.eventStart || activeEvent.date || '');
        setConfigEventEnd(settings.eventEnd || activeEvent.date || '');
      } else {
        setConfigRegEnabled(activeEvent.status === 'registration_open');
        setConfigIndividualFee(activeEvent.pricing?.singleRate || 0);
        setConfigCoupleFee(activeEvent.pricing?.coupleRate || 0);
        setConfigFamilyFee(activeEvent.pricing?.familyRate || 0);
        setConfigRegStart(activeEvent.registrationStart || '');
        setConfigRegEnd(activeEvent.registrationEnd || '');
        setConfigEventStart(activeEvent.date || '');
        setConfigEventEnd(activeEvent.date || '');
      }

      // Sync pricing rules
      const pricing = activeEvent.pricing;
      setConfigFreeChildAge(pricing?.freeChildAge ?? 5);
      setConfigHalfChildAge(pricing?.halfChildAge ?? 12);
      setConfigAdultAge(pricing?.adultAge ?? 18);
      setConfigAllowExternal(pricing?.allowExternal ?? false);
      setConfigExternalRate(pricing?.externalRate ?? 0);
      setConfigParentFee(pricing?.parentRate ?? 5);
      setConfigOtherFee(pricing?.otherRate ?? 5);

      // Sync Completion Checklist (Sprint 2)
      const checklist = activeEvent.completionChecklist || {};
      setChkRegClosed(checklist.registrationClosed || false);
      setChkProgramFinalized(checklist.programApprovalsFinalized || false);
      setChkAttendanceClosed(checklist.attendanceClosed || false);
      setChkFinanceSubmitted(checklist.financeSubmitted || false);
      setChkFinanceApproved(checklist.financeApproved || false);
      setChkPresApproved(checklist.presApproval || false);
      setChkCertificatesGenerated(checklist.certificatesGenerated || false);

      setConfigStatus((activeEvent.status as any) || 'draft');
      setConfigHighlights(activeEvent.highlights || []);
      const existingAccounts = (activeEvent.paymentTransferAccounts || []).map(acc => ({
        ...acc,
        isSaved: acc.isSaved !== undefined ? acc.isSaved : true
      }));
      setConfigPaymentAccounts(existingAccounts);
      setIsTimelinesEditing(false);
      setExplicitCompletion(false);
    }
  }, [activeEvent]);

  // Create Event action
  const handleCreateEventSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEventName.trim()) {
      setErrorMsg("Please provide an Event Name.");
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const eventId = `evt_${Date.now()}`;
      const generatedCode = `EVT-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

      // Build compliant event document mapping to Single Source of Truth
      const eventPayload = {
        id: eventId,
        eventName: newEventName.trim(),
        eventType: newEventType,
        eventYear: newEventYear,
        description: newEventDescription.trim(),
        status: 'draft',
        createdBy: profile?.email || 'event_director',
        createdAt: new Date().toISOString(),
        updatedBy: profile?.email || 'event_director',
        updatedAt: new Date().toISOString(),
        eventCode: generatedCode,
        Poster: '',
        Thumbnail: '',
        Venue: '',
        registrationSettings: {
          registrationEnabled: false,
          individualFee: 0,
          coupleFee: 0,
          familyFee: 0,
          eventStart: '',
          eventEnd: ''
        },
        configurationStatus: 'incomplete',
        highlights: [],

        // Backward compatibility properties for standard components
        title: newEventName.trim(),
        displayName: newEventName.trim(),
        date: '',
        venue: '',
        posterUrl: '',
        logoUrl: '',
        pricing: {
          singleRate: 0,
          coupleRate: 0,
          familyRate: 0,
          freeChildAge: 5,
          halfChildAge: 12,
          adultAge: 18
        },
        attendees: []
      };

      await setDoc(doc(db, "events", eventId), eventPayload);

      // Create standard operational and Program committees for the event
      const defaultCommittees = ['Attendance', 'Finance', 'Food', 'Program', 'Sponsorship', 'Sourcing'];
      for (const commName of defaultCommittees) {
        const commDocId = `${eventId}_${commName.replace(/\s+/g, '_')}`;
        const committeePayload: EventCommittee = {
          id: commDocId,
          eventId: eventId,
          name: commName,
          members: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        await setDoc(doc(db, "eventCommittees", commDocId), committeePayload);
      }

      // Add simple audit log
      await createAuditLog(
        'EVENT_CREATED',
        profile?.email || 'event_director',
        'event',
        eventId,
        `Created event master '${newEventName.trim()}'`
      );

      setSuccessMsg(`✓ Successfully created event "${newEventName.trim()}"!`);
      
      // Cleanup inputs and redirect
      setNewEventName('');
      setNewEventDescription('');
      setShowNewEventForm(false);
      setSelectedEventId(eventId);
      setActiveTab('configuration');
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Failed to create event: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // GEAS Compliant Archive Event action
  const handleArchiveEvent = async (eventId: string, eventName: string) => {
    setIsSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await updateDoc(doc(db, "events", eventId), {
        status: 'archived',
        updatedAt: new Date().toISOString()
      });
      await createAuditLog(
        'EVENT_ARCHIVED',
        profile?.email || 'event_director',
        'event',
        eventId,
        `Archived event master '${eventName}'`
      );
      setSuccessMsg(`✓ Event "${eventName}" has been archived successfully.`);
    } catch (err: any) {
      console.error("Error archiving event:", err);
      setErrorMsg("Failed to archive event: " + (err.message || String(err)));
    } finally {
      setIsSubmitting(false);
    }
  };

  // GEAS Compliant Delete Event action (Sprint 3 & RTCO Certification)
  const handleDeleteEvent = async (eventId: string, eventName: string) => {
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const eventDocRef = doc(db, "events", eventId);
      const eventSnap = await getDoc(eventDocRef);
      if (!eventSnap.exists()) {
        throw new Error("Event document not found.");
      }
      const eventData = eventSnap.data();
      const currentStatus = (eventData.status || 'draft').toLowerCase();

      // GEAS Rule: Only Draft events may be physically deleted
      if (currentStatus !== 'draft') {
        setErrorMsg(`GEAS SAFETY BLOCKED: Event "${eventName}" is in '${currentStatus.toUpperCase()}' status. Only DRAFT events can be physically deleted. Please use 'Archive Event' instead.`);
        return;
      }

      // Fetch on-demand checks
      const qRegs = query(collection(db, "event_registrations"), where("eventId", "==", eventId));
      const qProgs = query(collection(db, "eventPrograms"), where("eventId", "==", eventId));
      const qComms = query(collection(db, "eventCommittees"), where("eventId", "==", eventId));
      
      const [regSnap, progSnap, commSnap] = await Promise.all([
        getDocs(qRegs),
        getDocs(qProgs),
        getDocs(qComms)
      ]);
      
      const hasRegistrations = !regSnap.empty;
      const hasPrograms = !progSnap.empty;
      const hasCommitteeAssignments = commSnap.docs.some(d => {
        const members = d.data().members || [];
        return members.length > 0;
      });

      if (hasRegistrations || hasPrograms || hasCommitteeAssignments) {
        let reasons: string[] = [];
        if (hasRegistrations) reasons.push(`${regSnap.size} active registration(s)`);
        if (hasPrograms) reasons.push(`${progSnap.size} submitted program(s)`);
        if (hasCommitteeAssignments) reasons.push("assigned committee leads/members");

        setErrorMsg(`SAFETY BLOCKED: Deletion is blocked because this event has active operational history (${reasons.join(", ")}). Please archive the event instead.`);
        return;
      }

      // Exact name verification check
      const confirmed = await showConfirm({
        title: "DELETE DRAFT EVENT",
        message: `WARNING: This will permanently delete DRAFT event "${eventName}".\n\nTo confirm, type the exact Event Name below:`,
        severity: "danger",
        requiredInputText: eventName,
        inputLabel: "Event Name Match",
        inputPlaceholder: eventName,
        confirmText: "Delete Draft Event",
        cancelText: "Cancel"
      });
      if (!confirmed) {
        setErrorMsg("Event deletion cancelled.");
        return;
      }

      setIsSubmitting(true);
      await deleteDoc(doc(db, "events", eventId));

      // Silent cleanup of associated empty committees
      for (const cDoc of commSnap.docs) {
        await deleteDoc(doc(db, "eventCommittees", cDoc.id));
      }

      await createAuditLog(
        'EVENT_DELETED',
        profile?.email || 'event_director',
        'event',
        eventId,
        `Permanently deleted draft event master '${eventName}'`
      );

      setSuccessMsg(`✓ Draft Event "${eventName}" and associated committees deleted.`);
      if (selectedEventId === eventId) {
        const remaining = events.filter(e => e.id !== eventId);
        setSelectedEventId(remaining.length > 0 ? remaining[0].id : '');
      }
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Failed to delete event: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // GEAS Compliant Registration Deletion Workflow (Single Registration)
  const handleDeleteRegistration = async (reg: EventRegistration) => {
    console.log("[DELETE 1] Delete button clicked", reg?.id);
    console.log("[DELETE 2] Registration received", reg);
    if (!activeEvent || !selectedEventId) {
      console.warn("Delete registration aborted: activeEvent or selectedEventId missing", { activeEvent, selectedEventId });
      return;
    }
    const confirmDelete = await showConfirm({
      title: "GEAS REGISTRATION DELETION",
      message: `Are you sure you want to permanently delete registration for primary member: ${reg.primaryMemberEmail}?\n\nThis will atomically remove event_registrations, eventAttendance, eventFood, and update eventReports/finance summaries.`,
      severity: "danger",
      confirmText: "Delete Registration",
      cancelText: "Cancel"
    });
    if (!confirmDelete) {
      console.log("Delete registration cancelled by user confirmation");
      return;
    }
    console.log("[DELETE 3] Confirmation accepted");

    setIsSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      // Stage 1: Resolve
      const regId = reg.id;
      const eventId = selectedEventId;
      const gmkId = reg.primaryMemberGmkId || regId.split('_')?.[1];
      const count = reg.totalParticipants || 1;
      const payment = reg.paymentAmount || 0;

      // Stage 2: Validate
      const regRef = doc(db, "event_registrations", regId);
      const regSnap = await getDoc(regRef);
      if (!regSnap.exists()) {
        throw new Error(`Registration record '${regId}' does not exist.`);
      }

      // Stage 3: Dependency Graph
      const attRef = doc(db, "eventAttendance", `att_${gmkId}_${eventId}`);
      const foodRef = doc(db, "eventFood", `food_${gmkId}_${eventId}`);
      const certRef = doc(db, "eventCertificates", `cert_${gmkId}_${eventId}`);
      const reportRef = doc(db, "eventReports", `rep_${eventId}`);
      const finRef = doc(db, "eventFinance", `fin_${eventId}`);
      const eventRef = doc(db, "events", eventId);

      // Stage 4: Execute Atomic Batch
      console.log("[DELETE 4] Starting batch");
      const batch = writeBatch(db);

      // A. Delete Registration Doc
      console.log("[DELETE 5] Deleting event_registrations", regId);
      batch.delete(regRef);

      // B. Delete Attendance Doc
      console.log("[DELETE 6] Deleting eventAttendance", attRef.id);
      batch.delete(attRef);

      // C. Delete Food Coupon Doc
      console.log("[DELETE 7] Deleting eventFood", foodRef.id);
      batch.delete(foodRef);

      // D. Delete Certificate Doc
      batch.delete(certRef);

      // E. Recalculate Report Summary
      console.log("[DELETE 8] Updating reports");
      const reportSnap = await getDoc(reportRef);
      if (reportSnap.exists()) {
        const reportData = reportSnap.data();
        batch.update(reportRef, {
          registrationsCount: Math.max(0, (reportData.registrationsCount || 0) - count),
          totalRevenue: Math.max(0, (reportData.totalRevenue || 0) - payment),
          lastUpdated: new Date().toISOString()
        });
      }

      // F. Recalculate Finance Summary
      const finSnap = await getDoc(finRef);
      if (finSnap.exists()) {
        const finData = finSnap.data();
        const newRev = Math.max(0, (finData.totalRevenue || 0) - payment);
        const netBal = newRev - (finData.totalExpenses || 0);
        batch.update(finRef, {
          totalRevenue: newRev,
          netBalance: netBal,
          updatedAt: new Date().toISOString()
        });
      }

      // G. Remove attendee email from Event Master attendees array
      const remainingRegs = registrations.filter(r => r.id !== regId && r.primaryMemberEmail === reg.primaryMemberEmail);
      if (remainingRegs.length === 0 && activeEvent.attendees) {
        const updatedAttendees = (activeEvent.attendees || []).filter(e => e !== reg.primaryMemberEmail);
        batch.update(eventRef, { attendees: updatedAttendees });
      }

      console.log("[DELETE 9] Commit");
      await batch.commit();

      // Stage 5: Verify
      const verifySnap = await getDoc(regRef);
      if (verifySnap.exists()) {
        throw new Error("Verification failed: Registration document was not removed from Firestore.");
      }

      console.log("[DELETE 10] Success");

      // Stage 6: Audit
      await createAuditLog(
        'DELETE_REGISTRATION',
        profile?.email || 'event_director',
        'registration',
        regId,
        `Event Director deleted registration for email '${reg.primaryMemberEmail}' (Count: ${count}, Payment: OMR ${payment}).`
      );

      setSuccessMsg(`✓ Registration for ${reg.primaryMemberEmail} was deleted successfully.`);
    } catch (err: any) {
      console.error("Error deleting registration:", err);
      setErrorMsg("Failed to delete registration: " + (err.message || String(err)));
    } finally {
      setIsSubmitting(false);
    }
  };

  // GEAS Compliant Bulk Registration Reset Workflow ("Delete All Registrations")
  const handleDeleteAllRegistrations = async () => {
    if (!activeEvent || !selectedEventId) return;
    console.log("[BULK DELETE 1] Button clicked");
    if (registrations.length === 0) {
      setErrorMsg("No active registrations exist to reset.");
      return;
    }

    const confirmed = await showConfirm({
      title: "GEAS BULK REGISTRATION RESET",
      message: `WARNING: This will permanently delete ALL ${registrations.length} registrations for event "${activeEvent.eventName || activeEvent.title}".\n\nTo confirm this operation, type "DELETE ALL":`,
      severity: "danger",
      requiredInputText: "DELETE ALL",
      inputLabel: "Bulk Reset Match",
      inputPlaceholder: "DELETE ALL",
      confirmText: "Execute Bulk Reset",
      cancelText: "Cancel"
    });
    if (!confirmed) {
      setErrorMsg("Bulk registration reset cancelled.");
      return;
    }

    console.log("[BULK DELETE 2] Confirmation accepted");
    setIsSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const eventId = selectedEventId;

      // Stage 1: Resolve all registrations & subcollection docs
      const qRegs = query(collection(db, "event_registrations"), where("eventId", "==", eventId));
      const qAtts = query(collection(db, "eventAttendance"), where("eventId", "==", eventId));
      const qFoods = query(collection(db, "eventFood"), where("eventId", "==", eventId));
      const qCerts = query(collection(db, "eventCertificates"), where("eventId", "==", eventId));

      const [regSnap, attSnap, foodSnap, certSnap] = await Promise.all([
        getDocs(qRegs),
        getDocs(qAtts),
        getDocs(qFoods),
        getDocs(qCerts)
      ]);

      console.log(`[BULK DELETE 3] Registrations discovered: ${regSnap.size}`);
      console.log(`[BULK DELETE 4] Attendance documents staged: ${attSnap.size}`);
      console.log(`[BULK DELETE 5] Food documents staged: ${foodSnap.size}`);
      console.log(`[BULK DELETE 6] Certificate documents staged: ${certSnap.size}`);

      // Stage 2: Validate
      if (regSnap.empty) {
        throw new Error("No registration documents found for this event.");
      }

      // Stage 3 & 4: Dependency Graph & Execute Chunked Batches
      const allDocsToDelete = [
        ...regSnap.docs.map(d => doc(db, "event_registrations", d.id)),
        ...attSnap.docs.map(d => doc(db, "eventAttendance", d.id)),
        ...foodSnap.docs.map(d => doc(db, "eventFood", d.id)),
        ...certSnap.docs.map(d => doc(db, "eventCertificates", d.id))
      ];

      // Process in batches of 400
      const batchSize = 400;
      for (let i = 0; i < allDocsToDelete.length; i += batchSize) {
        const batch = writeBatch(db);
        const chunk = allDocsToDelete.slice(i, i + batchSize);
        chunk.forEach(dRef => batch.delete(dRef));
        await batch.commit();
      }

      // Reset Report, Finance, and Event Master Attendees
      const finalBatch = writeBatch(db);
      const reportRef = doc(db, "eventReports", `rep_${eventId}`);
      const finRef = doc(db, "eventFinance", `fin_${eventId}`);
      const eventRef = doc(db, "events", eventId);

      const reportSnap = await getDoc(reportRef);
      if (reportSnap.exists()) {
        console.log("[BULK DELETE 7] Report update staged");
        finalBatch.update(reportRef, {
          registrationsCount: 0,
          totalRevenue: 0,
          attendanceCount: 0,
          mealsIssuedCount: 0,
          lastUpdated: new Date().toISOString()
        });
      }

      const finSnap = await getDoc(finRef);
      if (finSnap.exists()) {
        console.log("[BULK DELETE 8] Finance update staged");
        const finData = finSnap.data();
        finalBatch.update(finRef, {
          totalRevenue: 0,
          netBalance: 0 - (finData.totalExpenses || 0),
          updatedAt: new Date().toISOString()
        });
      }

      console.log("[BULK DELETE 9] Event update staged");
      finalBatch.update(eventRef, { attendees: [] });

      console.log("[BULK DELETE 10] Batch commit started");
      await finalBatch.commit();
      console.log("[BULK DELETE 11] Batch commit succeeded");

      // Stage 5: Verify
      const verifyRegsSnap = await getDocs(qRegs);
      if (!verifyRegsSnap.empty) {
        throw new Error(`Verification failed: ${verifyRegsSnap.size} registration documents remain.`);
      }

      // Stage 6: Audit
      await createAuditLog(
        'BULK_REGISTRATIONS_DELETED',
        profile?.email || 'event_director',
        'registration',
        eventId,
        `Event Director performed Bulk Reset: deleted all ${regSnap.size} registrations for event '${activeEvent.eventName || activeEvent.title}'.`
      );

      setSuccessMsg(`✓ Successfully reset registrations! All ${regSnap.size} registration records were deleted cleanly.`);
    } catch (err: any) {
      console.error("[BULK DELETE FAIL] Error resetting registrations:", err);
      setErrorMsg("Failed to execute bulk registration reset: " + (err.message || String(err)));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Helper to convert file to Base64
  const toBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
    });
  };

  // Helper to compress image on client-side with a guaranteed output limit (under 750 KB) to fit safely in Firestore fallbacks
  const compressImage = (file: File, maxWidth: number, maxHeight: number, initialQuality: number = 0.75, targetMaxKB: number = 750): Promise<string> => {
    return new Promise((resolve, reject) => {
      // Basic format check
      const fileName = file.name.toLowerCase();
      const isHEIC = fileName.endsWith('.heic') || fileName.endsWith('.heif');
      if (isHEIC) {
        reject(new Error("Apple HEIC/HEIF formats are not natively supported by browsers. Please export or convert your photo to JPG or PNG before uploading."));
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          let quality = initialQuality;
          let currentMaxWidth = maxWidth;
          let currentMaxHeight = maxHeight;
          let attempt = 0;
          let lastDataUrl = "";

          const compressCycle = () => {
            attempt++;
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;

            // Calculate new dimensions preserving aspect ratio
            if (width > height) {
              if (width > currentMaxWidth) {
                height = Math.round((height * currentMaxWidth) / width);
                width = currentMaxWidth;
              }
            } else {
              if (height > currentMaxHeight) {
                width = Math.round((width * currentMaxHeight) / height);
                height = currentMaxHeight;
              }
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
              reject(new Error("Canvas context is not available"));
              return;
            }
            ctx.drawImage(img, 0, 0, width, height);
            
            // Generate JPEG data URL
            const dataUrl = canvas.toDataURL('image/jpeg', quality);
            
            // Base64 string length to KB estimation (approx. 4/3 overhead for Base64 representation)
            const sizeInKB = Math.round((dataUrl.length * 0.75) / 1024);
            console.log(`[Image Compression] Attempt ${attempt} (max: ${currentMaxWidth}x${currentMaxHeight}, quality: ${quality.toFixed(2)}): output size is ${sizeInKB} KB`);

            lastDataUrl = dataUrl;

            if (sizeInKB <= targetMaxKB || attempt >= 5) {
              console.log(`[Image Compression] Compression stabilized successfully at ${sizeInKB} KB.`);
              resolve(dataUrl);
            } else {
              // Scale down dimensions and quality aggressively for the next iteration to force size limit compliance
              currentMaxWidth = Math.round(currentMaxWidth * 0.75);
              currentMaxHeight = Math.round(currentMaxHeight * 0.75);
              quality = Math.max(0.15, quality - 0.15);
              compressCycle();
            }
          };

          compressCycle();
        };
        img.onerror = (err) => {
          console.error("Image loading failed:", err);
          reject(new Error("Failed to load image. The file might be in an unsupported format, a raw file type, or corrupted. Please use a standard JPG or PNG image."));
        };
        img.src = event.target?.result as string;
      };
      reader.onerror = (err) => {
        console.error("FileReader read error:", err);
        reject(err);
      };
      reader.readAsDataURL(file);
    });
  };

  // Helper to convert data URL to Blob for Firebase Storage upload
  const dataURLtoBlob = (dataurl: string): Blob => {
    try {
      const arr = dataurl.split(',');
      const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
      const bstr = atob(arr[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      return new Blob([u8arr], { type: mime });
    } catch (e: any) {
      throw new Error("Failed to process compressed image data: " + e.message);
    }
  };

  // Dedicated helper function for Firebase Storage uploading with comprehensive error logging and dynamic bucket validation
  const uploadFile = async (path: string, blob: Blob): Promise<string> => {
    console.log(`[Firebase Storage] Initiating upload to path: "${path}"`);
    console.log(`[Firebase Storage] File Details - Type: ${blob.type}, Size: ${blob.size} bytes`);
    
    // 1. Verify Storage initialization
    if (!storage) {
      throw new Error("Storage bucket not initialized. Please verify Firebase Storage is enabled in your Firebase console.");
    }

    // 2. Verify configured bucket & auto-switch if necessary
    const targetBucket = "gen-lang-client-0905030123.firebasestorage.app";
    let currentStorage = storage;
    const activeBucket = storage.app.options.storageBucket || "";
    
    if (activeBucket.toLowerCase() !== targetBucket.toLowerCase()) {
      console.log(`[Firebase Storage] Bucket mismatch detected! Active: "${activeBucket}", Target: "${targetBucket}". Automatically overriding to target bucket...`);
      try {
        currentStorage = getStorage(storage.app, `gs://${targetBucket}`);
      } catch (err: any) {
        console.warn(`[Firebase Storage] Direct gs:// override failed, falling back to basic initialization: ${err.message}`);
        try {
          currentStorage = getStorage(storage.app, targetBucket);
        } catch (err2: any) {
          console.error(`[Firebase Storage] Critical: Failed to switch to target storage storage:`, err2);
        }
      }
    }

    // 3. Confirm authenticated state and token presence
    if (!auth.currentUser) {
      throw new Error("Authentication expired. Please sign in again as an Event Director to upload assets.");
    }

    try {
      const tokenResult = await auth.currentUser.getIdTokenResult(true);
      console.log(`[Firebase Storage] Active session verified. Claims:`, tokenResult.claims);
    } catch (tokenErr: any) {
      console.warn("[Firebase Storage] Active token retrieval issue:", tokenErr);
      throw new Error("Authentication state during upload was invalid. Please re-authenticate.");
    }

    // 4. Check path permissions
    if (!path.startsWith(`events/${selectedEventId}/`)) {
      throw new Error(`Invalid upload path structure. Uploads must reside within "events/${selectedEventId}/".`);
    }

    // --- OPERATION 1: Create storage reference ---
    let fileRef;
    try {
      fileRef = ref(currentStorage, path);
      console.log(`[Firebase Storage] Reference created successfully for path: "${path}" on bucket "${currentStorage.app.options.storageBucket}"`);
    } catch (refErr: any) {
      console.error(`[Firebase Storage] [REF_ERROR] Failed to create storage reference for path "${path}":`, refErr);
      throw new Error(`[Reference Creation Failed] Failed to initialize a pointer for path: "${path}". Please check if path characters are valid. Details: ${refErr.message || refErr}`);
    }

    // --- OPERATION 2: Upload Bytes ---
    let uploadResult;
    try {
      console.log(`[Firebase Storage] Uploading bytes of size ${blob.size} bytes...`);
      uploadResult = await uploadBytes(fileRef, blob);
      console.log(`[Firebase Storage] uploadBytes operation succeeded. Metadata:`, uploadResult.metadata);
    } catch (uploadErr: any) {
      console.error(`[Firebase Storage] [UPLOAD_BYTES_ERROR] uploadBytes call failed:`, {
        code: uploadErr.code,
        message: uploadErr.message,
        serverResponse: uploadErr.serverResponse,
        name: uploadErr.name,
        stack: uploadErr.stack,
        fullError: uploadErr
      });

      // Map error codes to highly actionable client recommendations
      const code = uploadErr.code || "";
      const msg = uploadErr.message || "";
      let diagnosticMsg = "";

      if (code === "storage/unauthorized" || msg.includes("unauthorized") || msg.includes("permission-denied")) {
        diagnosticMsg = "Access Denied. Your authorization token might be stale or your Firebase Storage security rules are blocking uploads. Ensure you are signed in as an authorized Event Director and that storage rule conditions (like matches under events/{eventId}) are met.";
      } else if (code === "storage/quota-exceeded" || msg.includes("quota")) {
        diagnosticMsg = "Bucket quota exceeded. The Firebase Storage daily free quota for this project has been fully consumed. Wait for the quota reset, upgrade to a Spark/Blaze paid tier, or upload smaller files.";
      } else if (code === "storage/retry-limit-exceeded" || msg.includes("timeout") || msg.includes("CORS") || msg.includes("cors")) {
        diagnosticMsg = "Network timeout or CORS preflight rejection. Firebase Storage could not be reached. Ensure the bucket CORS configuration permits requests from this development domain and your connection is stable.";
      } else if (code === "storage/invalid-checksum" || msg.includes("checksum")) {
        diagnosticMsg = "File transfer corrupted (Checksum mismatch). Please try again on a more stable connection.";
      } else {
        diagnosticMsg = `Underlying Firebase SDK reported: ${uploadErr.message || uploadErr}`;
      }
      throw new Error(`[Upload Phase Failed] ${diagnosticMsg}`);
    }

    // --- OPERATION 3: Retrieve Download URL ---
    let downloadURL = "";
    try {
      console.log(`[Firebase Storage] Fetching public download URL...`);
      downloadURL = await getDownloadURL(fileRef);
      console.log(`[Firebase Storage] getDownloadURL returned: "${downloadURL}"`);
    } catch (urlErr: any) {
      console.error(`[Firebase Storage] [GET_DOWNLOAD_URL_ERROR] getDownloadURL call failed:`, urlErr);
      throw new Error(`[URL Retrieval Failed] The file was uploaded successfully, but generating a public access link failed. This usually indicates that 'storage.objects.get' permissions are missing or blocked. Details: ${urlErr.message || urlErr}`);
    }

    return downloadURL;
  };

  // Upload asset handler with comprehensive six-stage real-time instrumentation and zero fallbacks
  const handleAssetUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'Poster' | 'Thumbnail') => {
    const file = e.target.files?.[0];
    if (!file || !selectedEventId || !activeEvent) return;

    setIsSubmitting(true);
    setUploadingType(type);
    setErrorMsg(null);
    setSuccessMsg(null);
    setLastUploadError(null);

    // Reset diagnostics to running/idle states
    setUploadDiagnostics({
      compression: 'running',
      storageRef: 'idle',
      uploadBytes: 'idle',
      downloadUrl: 'idle',
      firestoreUpdate: 'idle',
      finalRendering: 'idle'
    });

    try {
      // 1. COMPRESSION STAGE
      console.log(`[Upload Diagnostic] Starting Compression for ${type}`);
      let compressedBlob: Blob;
      let originalSize = file.size;
      try {
        const maxWidth = type === 'Poster' ? 1200 : 400;
        const maxHeight = type === 'Poster' ? 1200 : 400;
        const targetMaxKB = type === 'Poster' ? 600 : 150;
        const initialQuality = type === 'Poster' ? 0.75 : 0.65;
        
        const compressedDataUrl = await compressImage(file, maxWidth, maxHeight, initialQuality, targetMaxKB);
        compressedBlob = dataURLtoBlob(compressedDataUrl);
        
        setUploadDiagnostics(prev => ({
          ...prev,
          compression: 'success',
          compressionDetails: `Original: ${(originalSize / 1024).toFixed(1)} KB -> Compressed: ${(compressedBlob.size / 1024).toFixed(1)} KB`,
          storageRef: 'running'
        }));
      } catch (compressErr: any) {
        console.error("Compression failed:", compressErr);
        setUploadDiagnostics(prev => ({
          ...prev,
          compression: 'failed',
          compressionDetails: compressErr.message || String(compressErr)
        }));
        throw new Error(`[Compression Failed] ${compressErr.message || compressErr}`);
      }

      // 2. STORAGE REFERENCE STAGE
      const storagePath = `events/${selectedEventId}/${type.toLowerCase()}_${Date.now()}.jpg`;
      let fileRef;
      try {
        if (!storage) {
          throw new Error("Storage is not initialized on the client SDK.");
        }
        
        // Ensure we point to the correct, configured bucket
        const targetBucket = "gen-lang-client-0905030123.firebasestorage.app";
        let currentStorage = storage;
        const activeBucket = storage.app.options.storageBucket || "";
        
        if (activeBucket.toLowerCase() !== targetBucket.toLowerCase()) {
          console.log(`[Firebase Storage] Overriding active bucket to target: "${targetBucket}"`);
          try {
            currentStorage = getStorage(storage.app, `gs://${targetBucket}`);
          } catch (err) {
            currentStorage = getStorage(storage.app, targetBucket);
          }
        }

        fileRef = ref(currentStorage, storagePath);
        setUploadDiagnostics(prev => ({
          ...prev,
          storageRef: 'success',
          storageRefDetails: `Ref: gs://${currentStorage.app.options.storageBucket || targetBucket}/${storagePath}`,
          uploadBytes: 'running'
        }));
      } catch (refErr: any) {
        console.error("Storage Reference generation failed:", refErr);
        setUploadDiagnostics(prev => ({
          ...prev,
          storageRef: 'failed',
          storageRefDetails: refErr.message || String(refErr)
        }));
        throw refErr;
      }

      // 3. UPLOAD BYTES STAGE
      let uploadResult;
      try {
        if (!auth.currentUser) {
          throw new Error("User session expired. Please sign in as an Event Director to upload assets.");
        }
        
        // Wrap with timeout of 8 seconds to fail-fast on CORS/network errors
        const uploadBytesPromise = uploadBytes(fileRef, compressedBlob);
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("CORS or Connection Timeout: Firebase Storage could not be reached after 8 seconds. Please verify your internet connection or bucket CORS settings.")), 8000);
        });
        
        uploadResult = await Promise.race([uploadBytesPromise, timeoutPromise]);
        
        setUploadDiagnostics(prev => ({
          ...prev,
          uploadBytes: 'success',
          uploadBytesDetails: `Success: Size ${uploadResult.metadata.size} bytes, State: ${uploadResult.metadata.state}`,
          downloadUrl: 'running'
        }));
      } catch (uploadErr: any) {
        console.error("uploadBytes failed:", uploadErr);
        const code = uploadErr.code || "";
        const msg = uploadErr.message || "";
        let errorDetails = `Code: ${code}. Msg: ${msg}`;
        setUploadDiagnostics(prev => ({
          ...prev,
          uploadBytes: 'failed',
          uploadBytesDetails: errorDetails
        }));
        setLastUploadError(code || msg);
        throw uploadErr;
      }

      // 4. DOWNLOAD URL STAGE
      let downloadURL = "";
      try {
        downloadURL = await getDownloadURL(fileRef);
        setUploadDiagnostics(prev => ({
          ...prev,
          downloadUrl: 'success',
          downloadUrlDetails: `URL: ${downloadURL.substring(0, 45)}...`,
          firestoreUpdate: 'running'
        }));
      } catch (urlErr: any) {
        console.error("getDownloadURL failed:", urlErr);
        setUploadDiagnostics(prev => ({
          ...prev,
          downloadUrl: 'failed',
          downloadUrlDetails: urlErr.message || String(urlErr)
        }));
        throw urlErr;
      }

      // 5. FIRESTORE UPDATE STAGE
      try {
        const eventRef = doc(db, "events", selectedEventId);
        const updateData: any = {
          updatedAt: new Date().toISOString()
        };

        if (type === 'Poster') {
          updateData.Poster = downloadURL;
          updateData.posterUrl = downloadURL;
          updateData.logoUrl = downloadURL;
        } else {
          updateData.Thumbnail = downloadURL;
        }

        await updateDoc(eventRef, updateData);
        setUploadDiagnostics(prev => ({
          ...prev,
          firestoreUpdate: 'success',
          firestoreUpdateDetails: `Successfully wrote ${type} field to events/${selectedEventId}`,
          finalRendering: 'running'
        }));
      } catch (firestoreErr: any) {
        console.error("Firestore update failed:", firestoreErr);
        setUploadDiagnostics(prev => ({
          ...prev,
          firestoreUpdate: 'failed',
          firestoreUpdateDetails: firestoreErr.message || String(firestoreErr)
        }));
        throw firestoreErr;
      }

      // 6. FINAL RENDERING STAGE
      try {
        await new Promise<void>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve();
          img.onerror = () => reject(new Error("Image element failed to decode/load."));
          img.src = downloadURL;
        });

        setUploadDiagnostics(prev => ({
          ...prev,
          finalRendering: 'success',
          finalRenderingDetails: `Image loaded and decoded successfully.`
        }));

        // Clean up old asset from storage
        const oldUrl = type === 'Poster' ? (activeEvent.Poster || activeEvent.posterUrl) : activeEvent.Thumbnail;
        if (oldUrl && oldUrl.includes('firebasestorage.googleapis.com')) {
          try {
            const oldFileRef = ref(storage, oldUrl);
            await deleteObject(oldFileRef);
            console.log("Successfully cleaned up old asset.");
          } catch (delErr) {
            console.warn("Could not delete old asset file", delErr);
          }
        }

        setSuccessMsg(`✓ ${type} uploaded and updated successfully.`);
      } catch (renderErr: any) {
        setUploadDiagnostics(prev => ({
          ...prev,
          finalRendering: 'failed',
          finalRenderingDetails: renderErr.message || String(renderErr)
        }));
        throw renderErr;
      }

    } catch (err: any) {
      console.error("Upload workflow failed:", err);
      setErrorMsg(`${type} upload failed: ${err.message || err}`);
      setLastUploadError(err.code || err.message || String(err));
    } finally {
      setIsSubmitting(false);
      setUploadingType(null);
    }
  };

  // Delete asset handler (Sprint 8)
  const handleDeleteAsset = async (type: 'Poster' | 'Thumbnail') => {
    if (!selectedEventId || !activeEvent) return;

    setIsSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const url = type === 'Poster' ? (activeEvent.Poster || activeEvent.posterUrl) : activeEvent.Thumbnail;
      
      // Delete from storage if it is a real Firebase Storage URL
      if (url && url.includes('firebasestorage.googleapis.com')) {
        try {
          const fileRef = ref(storage, url);
          await deleteObject(fileRef);
        } catch (storageErr) {
          console.warn("Could not delete from storage (might already be deleted):", storageErr);
        }
      }

      // Clear from Firestore
      const eventRef = doc(db, "events", selectedEventId);
      const updateData: any = {
        updatedAt: new Date().toISOString()
      };

      if (type === 'Poster') {
        updateData.Poster = "";
        updateData.posterUrl = "";
        updateData.logoUrl = "";
      } else {
        updateData.Thumbnail = "";
      }

      await updateDoc(eventRef, updateData);
      setSuccessMsg(`✓ ${type} deleted successfully.`);
    } catch (err: any) {
      console.error(`Delete error for ${type}:`, err);
      setErrorMsg(`Failed to delete ${type}: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Helper to determine if there are unsaved changes (Sprint 7)
  const hasUnsavedChanges = () => {
    if (!activeEvent) return false;
    const origName = activeEvent.eventName || activeEvent.title || activeEvent.displayName || '';
    const origDesc = activeEvent.description || '';
    const origVenue = activeEvent.Venue || activeEvent.venue || '';
    
    let origRegStart = '';
    let origRegEnd = '';
    let origEventStart = '';
    let origEventEnd = '';
    let origRegEnabled = false;
    let origIndividualFee = 0;
    let origCoupleFee = 0;
    let origFamilyFee = 0;
    let origFreeChildAge = 5;
    let origHalfChildAge = 12;
    let origAdultAge = 18;
    let origAllowExternal = false;
    let origExternalRate = 0;

    const settings = activeEvent.registrationSettings as any;
    if (settings) {
      origRegEnabled = settings.registrationEnabled || false;
      origIndividualFee = settings.individualFee || 0;
      origCoupleFee = settings.coupleFee || 0;
      origFamilyFee = settings.familyFee || 0;
      origRegStart = settings.registrationStart || activeEvent.registrationStart || '';
      origRegEnd = settings.registrationEnd || activeEvent.registrationEnd || '';
      origEventStart = settings.eventStart || activeEvent.date || '';
      origEventEnd = settings.eventEnd || activeEvent.date || '';
    } else {
      origRegEnabled = activeEvent.status === 'registration_open';
      origIndividualFee = activeEvent.pricing?.singleRate || 0;
      origCoupleFee = activeEvent.pricing?.coupleRate || 0;
      origFamilyFee = activeEvent.pricing?.familyRate || 0;
      origRegStart = activeEvent.registrationStart || '';
      origRegEnd = activeEvent.registrationEnd || '';
      origEventStart = activeEvent.date || '';
      origEventEnd = activeEvent.date || '';
    }

    let origParentFee = 5;
    let origOtherFee = 5;

    const pricing = activeEvent.pricing;
    if (pricing) {
      origFreeChildAge = pricing.freeChildAge ?? 5;
      origHalfChildAge = pricing.halfChildAge ?? 12;
      origAdultAge = pricing.adultAge ?? 18;
      origAllowExternal = pricing.allowExternal ?? false;
      origExternalRate = pricing.externalRate ?? 0;
      origParentFee = pricing.parentRate ?? 5;
      origOtherFee = pricing.otherRate ?? 5;
    }

    const checklist = activeEvent.completionChecklist || {};
    const origChkReg = checklist.registrationClosed || false;
    const origChkProg = checklist.programApprovalsFinalized || false;
    const origChkAtt = checklist.attendanceClosed || false;
    const origChkFinSub = checklist.financeSubmitted || false;
    const origChkFinApp = checklist.financeApproved || false;
    const origChkPres = checklist.presApproval || false;
    const origChkCert = checklist.certificatesGenerated || false;

    return (
      configEventName !== origName ||
      configDescription !== origDesc ||
      configVenue !== origVenue ||
      configRegStart !== origRegStart ||
      configRegEnd !== origRegEnd ||
      configEventStart !== origEventStart ||
      configEventEnd !== origEventEnd ||
      configRegEnabled !== origRegEnabled ||
      configIndividualFee !== origIndividualFee ||
      configCoupleFee !== origCoupleFee ||
      configFamilyFee !== origFamilyFee ||
      configFreeChildAge !== origFreeChildAge ||
      configHalfChildAge !== origHalfChildAge ||
      configAdultAge !== origAdultAge ||
      configAllowExternal !== origAllowExternal ||
      configExternalRate !== origExternalRate ||
      configParentFee !== origParentFee ||
      configOtherFee !== origOtherFee ||
      chkRegClosed !== origChkReg ||
      chkProgramFinalized !== origChkProg ||
      chkAttendanceClosed !== origChkAtt ||
      isFinanceSubmittedAuto !== origChkFinSub ||
      isFinanceApprovedAuto !== origChkFinApp ||
      isPresApprovedAuto !== origChkPres ||
      chkCertificatesGenerated !== origChkCert ||
      JSON.stringify(configPaymentAccounts) !== JSON.stringify(activeEvent?.paymentTransferAccounts || [])
    );
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(prev => prev === msg ? null : prev);
    }, 3000);
  };

  const handleEventDateChange = (newISO: string) => {
    const parsedDate = new Date(newISO);
    if (!isNaN(parsedDate.getTime())) {
      const updatedStart = mergeDateAndISO(parsedDate, configEventStart);
      const updatedEnd = mergeDateAndISO(parsedDate, configEventEnd);
      setConfigEventStart(updatedStart);
      setConfigEventEnd(updatedEnd);
    }
  };

  // Save Configuration action (Sprint 7)
  const handleSaveConfiguration = async (e?: React.FormEvent, explicitStatus?: 'draft' | 'published' | 'completed') => {
    if (e) e.preventDefault();
    if (!selectedEventId) return;

    setIsSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const finalStatus = explicitStatus || configStatus;

      const updatedPayload = {
        eventName: configEventName.trim() || activeEvent?.eventName || '',
        title: configEventName.trim() || activeEvent?.eventName || '', // compatibility
        displayName: configEventName.trim() || activeEvent?.eventName || '', // compatibility
        description: configDescription.trim(),
        Venue: configVenue.trim(),
        venue: configVenue.trim(), // compatibility
        date: configEventStart, // compatibility
        registrationStart: configRegStart,
        registrationEnd: configRegEnd,
        eventStart: configEventStart,
        eventEnd: configEventEnd,
        status: finalStatus,
        updatedBy: profile?.email || 'event_director',
        updatedAt: new Date().toISOString(),
        registrationSettings: {
          registrationEnabled: configRegEnabled,
          individualFee: configIndividualFee,
          coupleFee: configCoupleFee,
          familyFee: configFamilyFee,
          parentFee: configParentFee,
          otherFee: configOtherFee,
          registrationStart: configRegStart,
          registrationEnd: configRegEnd,
          eventStart: configEventStart,
          eventEnd: configEventEnd
        },
        pricing: {
          singleRate: configIndividualFee,
          coupleRate: configCoupleFee,
          familyRate: configFamilyFee,
          freeChildAge: configFreeChildAge,
          halfChildAge: configHalfChildAge,
          adultAge: configAdultAge,
          allowExternal: configAllowExternal,
          externalRate: configExternalRate,
          parentRate: configParentFee,
          otherRate: configOtherFee
        },
        completionChecklist: {
          registrationClosed: chkRegClosed,
          programApprovalsFinalized: chkProgramFinalized,
          attendanceClosed: chkAttendanceClosed,
          financeSubmitted: isFinanceSubmittedAuto,
          financeApproved: isFinanceApprovedAuto,
          presApproval: isPresApprovedAuto,
          certificatesGenerated: chkCertificatesGenerated
        },
        configurationStatus: 'completed',
        highlights: configHighlights,
        paymentTransferAccounts: configPaymentAccounts
      };

      const eventDocRef = doc(db, "events", selectedEventId);
      await updateDoc(eventDocRef, updatedPayload);

      // Verify persistence by reloading event
      const freshSnap = await getDoc(eventDocRef);
      if (!freshSnap.exists()) {
        throw new Error("Persistence check failed: Document not found in Firestore after save.");
      }
      
      const freshData = freshSnap.data();
      if (freshData.status !== finalStatus) {
        throw new Error(`Persistence check failed: status mismatch (expected ${finalStatus}, got ${freshData.status})`);
      }

      await createAuditLog(
         'EVENT_CONFIGURED',
         profile?.email || 'event_director',
         'event',
         selectedEventId,
         `Configured general settings. Status changed to '${finalStatus}'`
      );

      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 4000);
      showToast("✓ All changes saved.");
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Failed to save event configuration: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelPricingEdit = () => {
    if (activeEvent) {
      const regSettings = activeEvent.registrationSettings || {};
      const pricing = activeEvent.pricing || {};
      setConfigIndividualFee(pricing.singleRate ?? regSettings.individualFee ?? 0);
      setConfigCoupleFee(pricing.coupleRate ?? regSettings.coupleFee ?? 0);
      setConfigFamilyFee(pricing.familyRate ?? regSettings.familyFee ?? 0);
      setConfigFreeChildAge(pricing.freeChildAge ?? 5);
      setConfigHalfChildAge(pricing.halfChildAge ?? 12);
      setConfigAdultAge(pricing.adultAge ?? 18);
      setConfigAllowExternal(pricing.allowExternal ?? false);
      setConfigExternalRate(pricing.externalRate ?? 0);
      setConfigParentFee(pricing.parentRate ?? regSettings.parentFee ?? 5);
      setConfigOtherFee(pricing.otherRate ?? regSettings.otherFee ?? 5);
    }
    setIsPricingEditing(false);
  };

  const handleDownloadPDF = () => {
    if (!activeEvent) return;
    const doc = new jsPDF();
    
    // Title / Header
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.setTextColor(15, 76, 42); // #0f4c2a - Forest Green
    doc.text("AL HAIL GREENS (GMK)", 15, 20);
    
    doc.setFontSize(14);
    doc.setTextColor(30, 30, 30);
    doc.text(`REGISTRATION PRICING POLICY & TARIFF SHEET`, 15, 28);
    
    // Horizontal divider
    doc.setDrawColor(15, 76, 42);
    doc.setLineWidth(0.8);
    doc.line(15, 32, 195, 32);
    
    // Metadata Table
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Event Name: ${activeEvent.eventName || activeEvent.title}`, 15, 42);
    doc.text(`Event Code: ${activeEvent.eventCode || 'N/A'}`, 15, 48);
    doc.text(`Venue: ${activeEvent.venue || activeEvent.Venue || 'N/A'}`, 15, 54);
    doc.text(`Date of Event: ${activeEvent.date ? new Date(activeEvent.date).toLocaleDateString() : 'N/A'}`, 15, 60);
    doc.text(`Document Generated: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`, 15, 66);
    
    // Sub-header for Pricing Setup
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(15, 76, 42);
    doc.text("FROZEN REGISTRATION PRICING SCHEDULE (v1.1)", 15, 78);
    
    doc.setLineWidth(0.2);
    doc.setDrawColor(200, 200, 200);
    doc.line(15, 81, 195, 81);
    
    // Setup Table
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(50, 50, 50);
    
    let y = 88;
    const addRow = (label, value) => {
      doc.setFont("helvetica", "bold");
      doc.text(label, 15, y);
      doc.setFont("helvetica", "normal");
      doc.text(value, 110, y);
      y += 8;
    };
    
    addRow("Individual Rate:", `OMR ${configIndividualFee.toFixed(3)}`);
    addRow("Couple Rate:", `OMR ${configCoupleFee.toFixed(3)}`);
    addRow("Family Rate:", `OMR ${configFamilyFee.toFixed(3)}`);
    addRow("Parent Rate:", `OMR ${configParentFee.toFixed(3)} per parent`);
    addRow("Other Resident Rate:", `OMR ${configOtherFee.toFixed(3)} per person`);
    addRow("Free Children Age Limit:", `Below ${configFreeChildAge} years old`);
    addRow("Allow Guests (Non-Residents):", configAllowExternal ? "Yes" : "No");
    if (configAllowExternal) {
      addRow("Guest Fee:", `OMR ${configExternalRate.toFixed(3)} per person`);
    }
    
    y += 6;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(15, 76, 42);
    doc.text("CORE PRICING ENGINE CALCULATION MATRIX", 15, y);
    
    y += 3;
    doc.line(15, y, 195, y);
    y += 7;
    
    doc.setFontSize(9);
    doc.setTextColor(80, 80, 80);
    
    const addRuleRow = (composition, rateText) => {
      doc.setFont("helvetica", "bold");
      doc.text(composition, 15, y);
      doc.setFont("helvetica", "normal");
      doc.text(rateText, 110, y);
      y += 7;
    };
    
    addRuleRow("• Individual Rule (Primary Resident only):", `OMR ${configIndividualFee.toFixed(3)} (Individual Rate)`);
    addRuleRow("• Couple Rule (Primary Resident + Spouse):", `OMR ${configCoupleFee.toFixed(3)} (Couple Rate)`);
    addRuleRow("• Family Rule (Resident + Spouse + Children):", `OMR ${configFamilyFee.toFixed(3)} (Family Rate Cap)`);
    addRuleRow("• Single Parent Rule (Resident + Child above Free Age):", `OMR ${configCoupleFee.toFixed(3)} (Couple Rate applied)`);
    addRuleRow("• Parent Rule (Spouse Parents / Own Parents):", `OMR ${configParentFee.toFixed(3)} per parent`);
    addRuleRow("• Other Resident Rule (Maid / Other Residents):", `OMR ${configOtherFee.toFixed(3)} per person`);
    if (configAllowExternal) {
      addRuleRow("• Guest Rule (Registered Non-Resident Guests):", `OMR ${configExternalRate.toFixed(3)} per guest flat rate`);
    } else {
      addRuleRow("• Guest Rule (Registered Non-Resident Guests):", `Disabled / Guests Not Allowed`);
    }
    
    y += 10;
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text("Note: This document represents the official active pricing tariff approved by the GMK Executive Committee.", 15, y);
    y += 4;
    doc.text("Pricing Engine v1.1 • All calculations are dynamically verified on commit.", 15, y);
    
    doc.save(`${activeEvent.eventName || activeEvent.title}_pricing_policy.pdf`);
  };

  // Committee Data PDF Export
  const handleExportCommitteeDataPDF = () => {
    if (!activeEvent) return;
    const doc = new jsPDF();

    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(15, 76, 42); // Forest Green
    doc.text("AL HAIL GREENS (GMK)", 15, 18);

    doc.setFontSize(13);
    doc.setTextColor(30, 30, 30);
    doc.text(`COMMITTEE DATA & ROSTER - ${activeEvent.eventName || activeEvent.title}`, 15, 25);

    doc.setDrawColor(15, 76, 42);
    doc.setLineWidth(0.8);
    doc.line(15, 29, 195, 29);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text(`Generated on: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`, 15, 35);

    let y = 43;
    const filteredCommittees = activeCommittees.filter(c => c.status !== 'archived');

    if (filteredCommittees.length === 0) {
      doc.text("No active committees configured for this event.", 15, y);
    } else {
      filteredCommittees.forEach((comm, idx) => {
        if (y > 260) {
          doc.addPage();
          y = 20;
        }

        const leads = (comm.members || []).filter(m => m.role === 'Lead').map(m => m.fullName);
        const volunteers = (comm.members || []).filter(m => m.role !== 'Lead').map(m => m.fullName);

        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.setTextColor(15, 76, 42);
        doc.text(`${idx + 1}. ${comm.name}`, 15, y);
        y += 6;

        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.setTextColor(50, 50, 50);
        doc.text("Leads:", 20, y);

        doc.setFont("helvetica", "normal");
        doc.setTextColor(80, 80, 80);
        const leadsText = leads.length > 0 ? leads.join(", ") : "None assigned";
        const splitLeads = doc.splitTextToSize(leadsText, 150);
        doc.text(splitLeads, 45, y);
        y += (splitLeads.length * 5) + 2;

        doc.setFont("helvetica", "bold");
        doc.setTextColor(50, 50, 50);
        doc.text("Volunteers:", 20, y);

        doc.setFont("helvetica", "normal");
        doc.setTextColor(80, 80, 80);
        const volsText = volunteers.length > 0 ? volunteers.join(", ") : "None assigned";
        const splitVols = doc.splitTextToSize(volsText, 150);
        doc.text(splitVols, 45, y);
        y += (splitVols.length * 5) + 8;

        doc.setDrawColor(230, 230, 230);
        doc.setLineWidth(0.3);
        doc.line(15, y - 4, 195, y - 4);
      });
    }

    doc.save(`${activeEvent.eventName || activeEvent.title}_Committee_Data.pdf`);
  };

  // Certificate Recipient Interface
  interface CertRecipient {
    id: string;
    name: string;
    type: 'Committee Lead' | 'Coordinator' | 'Volunteer' | 'Participant';
    roleOrProgram: string;
    context: string;
  }

  // Get all eligible certificate recipients
  const getCertificateRecipients = (): CertRecipient[] => {
    const list: CertRecipient[] = [];

    // 1. Committee Leads & Committee Volunteers
    activeCommittees.filter(c => c.status !== 'archived').forEach(comm => {
      (comm.members || []).forEach(mem => {
        if (!mem.fullName) return;
        if (mem.role === 'Lead') {
          list.push({
            id: `comm_lead_${comm.id}_${mem.residentId}`,
            name: mem.fullName,
            type: 'Committee Lead',
            roleOrProgram: comm.name,
            context: `Committee: ${comm.name}`
          });
        } else {
          list.push({
            id: `comm_vol_${comm.id}_${mem.residentId}`,
            name: mem.fullName,
            type: 'Volunteer',
            roleOrProgram: comm.name,
            context: `Committee: ${comm.name}`
          });
        }
      });
    });

    // 2. Program Coordinators, Volunteers, Participants
    const eventProgs = activePrograms.filter(p => p.eventId === selectedEventId);
    eventProgs.forEach(prog => {
      (prog.coordinators || []).forEach(coord => {
        if (!coord.fullName) return;
        list.push({
          id: `prog_coord_${prog.id}_${coord.residentId}`,
          name: coord.fullName,
          type: 'Coordinator',
          roleOrProgram: prog.title,
          context: `Program: ${prog.title}`
        });
      });

      (prog.volunteers || []).forEach(vol => {
        if (!vol.fullName) return;
        list.push({
          id: `prog_vol_${prog.id}_${vol.residentId}`,
          name: vol.fullName,
          type: 'Volunteer',
          roleOrProgram: prog.title,
          context: `Program: ${prog.title}`
        });
      });

      (prog.participants || []).forEach(part => {
        if (!part.fullName) return;
        list.push({
          id: `prog_part_${prog.id}_${part.residentId}`,
          name: part.fullName,
          type: 'Participant',
          roleOrProgram: prog.title,
          context: `Program: ${prog.title}`
        });
      });
    });

    return list;
  };

  const formatCertificateEventDate = (dateStr?: string) => {
    if (!dateStr) return new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const day = String(d.getDate()).padStart(2, '0');
    const month = d.toLocaleString('en-GB', { month: 'short' }).toUpperCase();
    const year = d.getFullYear();
    return `${day} ${month} ${year}`;
  };

  // Single Certificate PDF Generator
  const generateSingleCertificatePDF = (recipient: CertRecipient) => {
    if (!activeEvent) return;
    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4'
    });

    const eventTitle = activeEvent.eventName || activeEvent.title || 'Community Event';
    const formattedEventDate = formatCertificateEventDate(activeEvent.date);

    // Outer Border
    doc.setDrawColor(15, 76, 42);
    doc.setLineWidth(2.5);
    doc.rect(10, 10, 277, 190);

    // Inner Border
    doc.setDrawColor(212, 175, 55);
    doc.setLineWidth(0.8);
    doc.rect(14, 14, 269, 182);

    // Corner Accents
    doc.setLineWidth(0.4);
    doc.line(17, 17, 30, 17);
    doc.line(17, 17, 17, 30);
    doc.line(280, 17, 267, 17);
    doc.line(280, 17, 280, 30);
    doc.line(17, 193, 30, 193);
    doc.line(17, 193, 17, 180);
    doc.line(280, 193, 267, 193);
    doc.line(280, 193, 280, 180);

    // Header Title
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(15, 76, 42);
    doc.text("AL HAIL GREENS (GMK)", 148.5, 35, { align: "center" });

    // Certificate Heading
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(212, 175, 55);
    const certHeader = recipient.type === 'Participant' ? "CERTIFICATE OF PARTICIPATION" : "CERTIFICATE OF APPRECIATION";
    doc.text(certHeader, 148.5, 54, { align: "center" });

    doc.setDrawColor(212, 175, 55);
    doc.setLineWidth(0.5);
    doc.line(90, 58, 207, 58);

    // Presentation line
    doc.setFont("helvetica", "italic");
    doc.setFontSize(11);
    doc.setTextColor(80, 80, 80);
    doc.text("This certificate is proudly presented to", 148.5, 72, { align: "center" });

    // Recipient Name
    doc.setFont("helvetica", "bold");
    doc.setFontSize(24);
    doc.setTextColor(15, 76, 42);
    doc.text(recipient.name.toUpperCase(), 148.5, 88, { align: "center" });

    doc.setDrawColor(15, 76, 42);
    doc.setLineWidth(0.4);
    doc.line(70, 93, 227, 93);

    // Description
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(60, 60, 60);

    if (recipient.type === 'Participant') {
      doc.text(`for active participation in "${recipient.roleOrProgram}"`, 148.5, 108, { align: "center" });
      doc.text(`during the community event "${eventTitle}" conducted on ${formattedEventDate}.`, 148.5, 116, { align: "center" });
    } else {
      doc.text(`in grateful recognition of outstanding service and dedication as`, 148.5, 108, { align: "center" });
      doc.setFont("helvetica", "bold");
      doc.setTextColor(15, 76, 42);
      doc.text(`${recipient.type} (${recipient.roleOrProgram})`, 148.5, 116, { align: "center" });
      doc.setFont("helvetica", "normal");
      doc.setTextColor(60, 60, 60);
      doc.text(`for the event "${eventTitle}" conducted on ${formattedEventDate}.`, 148.5, 124, { align: "center" });
    }

    // Footer / Signatures
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(50, 50, 50);

    // President
    doc.line(50, 168, 110, 168);
    doc.text("President", 80, 173, { align: "center" });

    // Vice President
    doc.line(187, 168, 247, 168);
    doc.text("Vice President", 217, 173, { align: "center" });

    doc.setFontSize(8);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(120, 120, 120);
    doc.text("GMK Event Management System • Official Verified Certificate", 148.5, 186, { align: "center" });

    doc.save(`${recipient.name.replace(/\s+/g, '_')}_Certificate.pdf`);
  };

  // Bulk Certificates PDF Generator
  const generateBulkCertificatesPDF = (recipientsList: CertRecipient[]) => {
    if (!activeEvent || recipientsList.length === 0) return;
    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4'
    });

    const eventTitle = activeEvent.eventName || activeEvent.title || 'Community Event';
    const formattedEventDate = formatCertificateEventDate(activeEvent.date);

    recipientsList.forEach((recipient, index) => {
      if (index > 0) {
        doc.addPage();
      }

      doc.setDrawColor(15, 76, 42);
      doc.setLineWidth(2.5);
      doc.rect(10, 10, 277, 190);

      doc.setDrawColor(212, 175, 55);
      doc.setLineWidth(0.8);
      doc.rect(14, 14, 269, 182);

      doc.setLineWidth(0.4);
      doc.line(17, 17, 30, 17);
      doc.line(17, 17, 17, 30);
      doc.line(280, 17, 267, 17);
      doc.line(280, 17, 280, 30);
      doc.line(17, 193, 30, 193);
      doc.line(17, 193, 17, 180);
      doc.line(280, 193, 267, 193);
      doc.line(280, 193, 280, 180);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.setTextColor(15, 76, 42);
      doc.text("AL HAIL GREENS (GMK)", 148.5, 35, { align: "center" });

      doc.setFont("helvetica", "bold");
      doc.setFontSize(22);
      doc.setTextColor(212, 175, 55);
      const certHeader = recipient.type === 'Participant' ? "CERTIFICATE OF PARTICIPATION" : "CERTIFICATE OF APPRECIATION";
      doc.text(certHeader, 148.5, 54, { align: "center" });

      doc.setDrawColor(212, 175, 55);
      doc.setLineWidth(0.5);
      doc.line(90, 58, 207, 58);

      doc.setFont("helvetica", "italic");
      doc.setFontSize(11);
      doc.setTextColor(80, 80, 80);
      doc.text("This certificate is proudly presented to", 148.5, 72, { align: "center" });

      doc.setFont("helvetica", "bold");
      doc.setFontSize(24);
      doc.setTextColor(15, 76, 42);
      doc.text(recipient.name.toUpperCase(), 148.5, 88, { align: "center" });

      doc.setDrawColor(15, 76, 42);
      doc.setLineWidth(0.4);
      doc.line(70, 93, 227, 93);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      doc.setTextColor(60, 60, 60);

      if (recipient.type === 'Participant') {
        doc.text(`for active participation in "${recipient.roleOrProgram}"`, 148.5, 108, { align: "center" });
        doc.text(`during the community event "${eventTitle}" conducted on ${formattedEventDate}.`, 148.5, 116, { align: "center" });
      } else {
        doc.text(`in grateful recognition of outstanding service and dedication as`, 148.5, 108, { align: "center" });
        doc.setFont("helvetica", "bold");
        doc.setTextColor(15, 76, 42);
        doc.text(`${recipient.type} (${recipient.roleOrProgram})`, 148.5, 116, { align: "center" });
        doc.setFont("helvetica", "normal");
        doc.setTextColor(60, 60, 60);
        doc.text(`for the event "${eventTitle}" conducted on ${formattedEventDate}.`, 148.5, 124, { align: "center" });
      }

      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(50, 50, 50);

      // President
      doc.line(50, 168, 110, 168);
      doc.text("President", 80, 173, { align: "center" });

      // Vice President
      doc.line(187, 168, 247, 168);
      doc.text("Vice President", 217, 173, { align: "center" });

      doc.setFontSize(8);
      doc.setFont("helvetica", "italic");
      doc.setTextColor(120, 120, 120);
      doc.text("GMK Event Management System • Official Verified Certificate", 148.5, 186, { align: "center" });
    });

    doc.save(`${activeEvent.eventName || activeEvent.title}_All_Certificates.pdf`);
  };

  const runIntegrityAudit = async () => {
    const targets = [
      { key: 'test02', name: 'Resident Test 02', email: 'residenttest02@yahoo.com' },
      { key: 'test05', name: 'Resident Test 05', email: 'residenttest05@yahoo.com' },
      { key: 'anand', name: 'way2anand@yahoo.com', email: 'way2anand@yahoo.com' }
    ];

    const results: any = {};

    for (const target of targets) {
      let foundRes = residents.find(r => 
        r.email?.toLowerCase() === target.email.toLowerCase() || 
        r.fullName?.toLowerCase().includes(target.name.toLowerCase())
      );

      let readStatus: any = 'N/A';
      let detailsMsg = '';
      
      try {
        const { getDocs, collection, query, where } = await import('firebase/firestore');
        const q = query(collection(db, "residents"), where("email", "==", target.email));
        const qSnap = await getDocs(q);
        readStatus = 'Success';
        
        if (!foundRes && !qSnap.empty) {
          foundRes = { id: qSnap.docs[0].id, ...qSnap.docs[0].data() } as any;
        }
      } catch (err: any) {
        console.error(`Diagnostic read failed for ${target.name}:`, err);
        readStatus = 'Permission Denied';
        detailsMsg = err.message || String(err);
      }

      if (foundRes) {
        const familyId = `fam_${foundRes.gmkId}`;
        const famDoc = families.find(f => f.id === familyId);
        
        results[target.key] = {
          name: foundRes.fullName || target.name,
          identifier: foundRes.email || target.email,
          onboardingStatus: famDoc ? (famDoc.onboardingCompleted ? 'completed' : 'incomplete') : 'incomplete',
          familyExists: !!famDoc,
          profileStatus: foundRes.status || 'N/A',
          firestoreRead: readStatus === 'N/A' ? 'Success' : readStatus,
          details: detailsMsg || `Matched GMK ID: ${foundRes.gmkId}.`
        };
      } else {
        results[target.key] = {
          name: target.name,
          identifier: target.email,
          onboardingStatus: 'incomplete',
          familyExists: false,
          profileStatus: 'N/A',
          firestoreRead: readStatus,
          details: detailsMsg || "No matching resident profile found in the current directory."
        };
      }
    }

    setAuditResults(results);
  };

  // Validate fields prior to publishing (Sprint 8)
  const validateEventForPublish = (): string[] => {
    const errors: string[] = [];

    if (!configEventName.trim()) {
      errors.push("Event Name is required.");
    }
    if (!configVenue.trim()) {
      errors.push("Venue is mandatory.");
    }
    if (!configDescription.trim()) {
      errors.push("Event Description is required.");
    }

    // Registration Dates
    if (!configRegStart) {
      errors.push("Registration Opens date is required.");
    }
    if (!configRegEnd) {
      errors.push("Registration Closes date is required.");
    }
    if (configRegStart && configRegEnd && new Date(configRegStart) >= new Date(configRegEnd)) {
      errors.push("Registration Opens date must be before Registration Closes date.");
    }

    // Event Dates
    if (!configEventStart) {
      errors.push("Event Start date is required.");
    }
    if (!configEventEnd) {
      errors.push("Event End date is required.");
    }
    if (configEventStart && configEventEnd && new Date(configEventStart) >= new Date(configEventEnd)) {
      errors.push("Event Start date must be before Event End date.");
    }
    if (configRegEnd && configEventStart && new Date(configRegEnd) > new Date(configEventStart)) {
      errors.push("Registration Closes date must be before or equal to the Event Start date.");
    }

    // Poster and Thumbnail
    const posterUrl = activeEvent?.Poster || activeEvent?.posterUrl;
    if (!posterUrl) {
      errors.push("An Event Poster image must be uploaded.");
    }
    if (!activeEvent?.Thumbnail) {
      errors.push("An Event Thumbnail image must be uploaded.");
    }

    // Pricing (Sprint 6 & 8)
    if (configRegEnabled) {
      if (configIndividualFee <= 0) {
        errors.push("Individual Entrance Fee must be greater than OMR 0 when registration pricing is active.");
      }
      if (configFreeChildAge < 0) {
        errors.push("Free Admission Age must be a non-negative integer.");
      }
      if (configAllowExternal && configExternalRate < 0) {
        errors.push("External Participant Rate must be a non-negative value.");
      }
    }

    // Committee structure validation (Sprint 8)
    const standardCommittees = ["Attendance", "Finance", "Food", "Program", "Sponsorship", "Sourcing"];
    const missingCommittees = standardCommittees.filter(scName => {
      return !activeCommittees.some(ac => {
        const nameLower = ac.name.toLowerCase();
        if (scName === "Program" || scName === "Program") {
          return nameLower === "program committee" || nameLower === "programs" || nameLower === "program";
        }
        return nameLower === scName.toLowerCase();
      });
    });
    if (missingCommittees.length > 0) {
      errors.push(`Committee Structure is incomplete. Missing committees: ${missingCommittees.join(", ")}.`);
    }

    // Check if each committee has at least 1 Lead assigned
    activeCommittees.forEach(comm => {
      const leads = (comm.members || []).filter(m => m.role === 'Lead');
      if (leads.length === 0) {
        errors.push(`Committee '${comm.name}' must have at least one Lead assigned.`);
      }
    });

    return errors;
  };

  // Publish Event validates all mandatory fields (Sprint 8)
  const handlePublishEvent = async () => {
    const validationErrors = validateEventForPublish();
    if (validationErrors.length > 0) {
      setErrorMsg(`PUBLISHING BLOCKED:\n${validationErrors.map(e => `• ${e}`).join("\n")}`);
      return;
    }

    setErrorMsg(null);
    setSuccessMsg(null);

    // Pass validation, save with 'published' status (does NOT invoke completion logic)
    await handleSaveConfiguration(undefined, 'published');
    setConfigStatus('published');
    setSuccessMsg("🎉 Validation succeeded! The event is now officially PUBLISHED and available inside the Resident Hub!");
  };

  // Unpublish Event action
  const handleUnpublishEvent = async () => {
    if (!selectedEventId) return;
    setIsSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await updateDoc(doc(db, "events", selectedEventId), {
        status: 'draft',
        updatedAt: new Date().toISOString()
      });
      setConfigStatus('draft');
      setSuccessMsg("✓ Event has been unpublished and is now back in DRAFT status.");
    } catch (err: any) {
      setErrorMsg("Failed to unpublish event: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Complete Event action (Sprint 2)
  const handleCompleteEvent = async () => {
    if (!selectedEventId) return;

    if (!isCompletionReady) {
      setErrorMsg("SAFETY BLOCKED: Cannot complete event. All checklist items must be satisfied first.");
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await updateDoc(doc(db, "events", selectedEventId), {
        status: 'completed',
        updatedAt: new Date().toISOString()
      });
      setConfigStatus('completed');
      setSuccessMsg("🏁 Congratulations! Event status has been updated to COMPLETED. The configuration is now locked and read-only.");
    } catch (err: any) {
      setErrorMsg("Failed to complete event: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Create Custom Operational Committee action
  const handleCreateCustomCommittee = async () => {
    if (!selectedEventId || !newCommitteeName.trim()) return;
    
    const nameTrimmed = newCommitteeName.trim();
    // Check if committee already exists
    const exists = activeCommittees.some(c => c.name.toLowerCase() === nameTrimmed.toLowerCase());
    if (exists) {
      setErrorMsg(`A committee named "${nameTrimmed}" already exists.`);
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const commDocId = `${selectedEventId}_${nameTrimmed.replace(/\s+/g, '_')}`;
      const committeePayload: EventCommittee = {
        id: commDocId,
        eventId: selectedEventId,
        name: nameTrimmed,
        members: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await setDoc(doc(db, "eventCommittees", commDocId), committeePayload);
      
      await createAuditLog(
        'COMMITTEE_CREATED',
        profile?.email || 'event_director',
        'committee',
        commDocId,
        `Created custom operational committee '${nameTrimmed}'`
      );

      setSuccessMsg(`✓ Created "${nameTrimmed}" Operational Committee!`);
      setNewCommitteeName('');
      setShowAddCommitteeInput(false);
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Failed to create committee: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Delete custom operational committee with strict governance rules (0 members required, no archiving)
  const handleDeleteCommittee = async (comm: EventCommittee) => {
    const isStandard = ["Attendance", "Finance", "Food", "Sourcing", "Sponsorship", "Program"].includes(comm.name);
    if (isStandard) {
      setErrorMsg("GOVERNANCE BLOCK: Standard event committees are immutable and cannot be deleted.");
      return;
    }

    const hasMembers = (comm.members || []).length > 0;
    if (hasMembers) {
      setErrorMsg("Cannot delete committee while members are assigned. Remove all members first.");
      return;
    }

    const confirmDel = await showConfirm({
      title: "DELETE COMMITTEE",
      message: `Are you sure you want to permanently delete custom committee "${comm.name}"?`,
      severity: "danger",
      confirmText: "Delete Committee",
      cancelText: "Cancel"
    });
    if (!confirmDel) return;

    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      await deleteDoc(doc(db, "eventCommittees", comm.id));
      await createAuditLog(
        'COMMITTEE_DELETED',
        profile?.email || 'event_director',
        'committee',
        comm.id,
        `Permanently deleted custom operational committee '${comm.name}'`
      );
      setSuccessMsg(`✓ Committee "${comm.name}" has been permanently deleted.`);
      if (activeCommitteeToConfigure === comm.name) {
        setActiveCommitteeToConfigure(null);
      }
    } catch (err: any) {
      setErrorMsg("Failed to delete committee: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Archive committee
  const handleArchiveCommittee = async (comm: EventCommittee) => {
    const confirmArchive = await showConfirm({
      title: "ARCHIVE COMMITTEE",
      message: `Are you sure you want to archive committee "${comm.name}"? It will be moved to the Archived tab.`,
      severity: "warning",
      confirmText: "Archive Committee",
      cancelText: "Cancel"
    });
    if (!confirmArchive) return;

    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      await updateDoc(doc(db, "eventCommittees", comm.id), {
        status: 'archived',
        updatedAt: new Date().toISOString()
      });
      await createAuditLog(
        'COMMITTEE_ARCHIVED',
        profile?.email || 'event_director',
        'committee',
        comm.id,
        `Archived committee '${comm.name}'`
      );
      setSuccessMsg(`✓ Committee "${comm.name}" has been moved to Archived.`);
      if (activeCommitteeToConfigure === comm.name) {
        setActiveCommitteeToConfigure(null);
      }
    } catch (err: any) {
      setErrorMsg("Failed to archive committee: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Restore committee from archived status
  const handleRestoreCommittee = async (comm: EventCommittee) => {
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      await updateDoc(doc(db, "eventCommittees", comm.id), {
        status: 'active',
        updatedAt: new Date().toISOString()
      });
      await createAuditLog(
        'COMMITTEE_RESTORED',
        profile?.email || 'event_director',
        'committee',
        comm.id,
        `Restored committee '${comm.name}' to Active status`
      );
      setSuccessMsg(`✓ Committee "${comm.name}" has been restored to Active.`);
    } catch (err: any) {
      setErrorMsg("Failed to restore committee: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filtered resident search matches for Program Categories (Children, Adults, Mixed)
  const getFilteredSearchMatches = (queryStr: string, filter: 'Children' | 'Adults' | 'Mixed') => {
    if (!queryStr.toLowerCase().trim()) return [];
    const q = queryStr.toLowerCase().trim();

    let matches: Array<{
      id: string;
      fullName: string;
      email: string;
      displayUnitNumber: string;
      isFamilyMember: boolean;
      relationship?: string;
    }> = [];

    // 1. Add active primary residents (they are always Adults)
    if (filter === 'Adults' || filter === 'Mixed') {
      residents.forEach(r => {
        if (r.status !== 'active') return;
        if (
          r.fullName?.toLowerCase().includes(q) ||
          r.displayUnitNumber?.toLowerCase().includes(q) ||
          r.email?.toLowerCase().includes(q)
        ) {
          matches.push({
            id: r.gmkId,
            fullName: r.fullName,
            email: r.email,
            displayUnitNumber: r.displayUnitNumber,
            isFamilyMember: false
          });
        }
      });
    }

    // 2. Add family members based on filter
    familyMembers.forEach(m => {
      const parentId = m.familyId.replace('fam_', '');
      const parentRes = residents.find(r => r.gmkId === parentId);
      if (!parentRes || parentRes.status !== 'active') return;

      const isChild = m.relationship === 'child';

      if (filter === 'Children' && !isChild) return;
      if (filter === 'Adults' && isChild) return;

      if (
        m.name?.toLowerCase().includes(q) ||
        parentRes.displayUnitNumber?.toLowerCase().includes(q) ||
        parentRes.email?.toLowerCase().includes(q)
      ) {
        matches.push({
          id: m.id,
          fullName: m.name,
          email: parentRes.email,
          displayUnitNumber: parentRes.displayUnitNumber,
          isFamilyMember: true,
          relationship: m.relationship
        });
      }
    });

    return matches;
  };

  // Add committee lead
  const handleAssignLeadDirectly = async (resident: ResidentProfile, committeeName: string) => {
    const committee = activeCommittees.find(c => c.name === committeeName);
    if (!committee) return;

    setIsSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    setLastTransactionStatus('RUNNING');
    setLastErrorCode('None');
    setLastErrorMessage('None');

    try {
      // 1. Pre-write check: Read the latest committee document and check active lead count
      const committeeRef = doc(db, "eventCommittees", committee.id);
      const committeeSnap = await getDoc(committeeRef);
      if (!committeeSnap.exists()) {
        throw new Error("Committee document could not be found.");
      }
      const committeeData = committeeSnap.data() as EventCommittee;
      const activeLeads = (committeeData.members || []).filter(m => m.role === 'Lead');

      // Check if resident is already a lead
      if (activeLeads.some(m => m.residentId === resident.gmkId)) {
        setErrorMsg("This resident is already a Lead of this committee.");
        setIsSubmitting(false);
        return;
      }

      // 2. Fetch relevant user documents before the transaction
      const userQ = query(collection(db, "users"), where("email", "==", resident.email.toLowerCase().trim()));
      const userSnap = await getDocs(userQ);
      const userDocRefs = userSnap.docs.map(d => doc(db, "users", d.id));

      const isProgramsCommittee = committee.name.toLowerCase() === 'programs' || committee.name.toLowerCase() === 'program';
      const roleToAssign = isProgramsCommittee ? 'program_lead' : 'committee_lead';

      // 3. Execute Firestore Transaction
      await runTransaction(db, async (transaction) => {
        const committeeDoc = await transaction.get(committeeRef);
        if (!committeeDoc.exists()) {
          throw new Error("Committee document could not be found.");
        }
        const latestCommittee = committeeDoc.data() as EventCommittee;

        // Double check active leads on the latest document
        const latestLeads = (latestCommittee.members || []).filter(m => m.role === 'Lead');

        // Check if resident is already a lead
        if (latestLeads.some(m => m.residentId === resident.gmkId)) {
          throw new Error("This resident is already a Lead of this committee.");
        }

        const newMember: EventCommitteeMember = {
          residentId: resident.gmkId,
          fullName: resident.fullName,
          email: resident.email,
          role: 'Lead'
        };

        const updatedMembers = [...(latestCommittee.members || []), newMember];

        // Read and prepare User Roles inside transaction to avoid race conditions
        const userRolesUpdates: Array<{ ref: any; roles: string[] }> = [];
        for (const userDocRef of userDocRefs) {
          const uDoc = await transaction.get(userDocRef);
          if (uDoc.exists()) {
            const currentRoles: string[] = uDoc.data().roles || [];
            const updatedRoles = Array.from(new Set([...currentRoles, roleToAssign]));
            userRolesUpdates.push({ ref: userDocRef, roles: updatedRoles });
          }
        }

        // Apply all updates atomically
        transaction.update(committeeRef, {
          members: updatedMembers,
          updatedAt: new Date().toISOString()
        });

        transaction.set(doc(db, "residents", resident.gmkId), {
          committee: committee.name,
          updatedAt: new Date().toISOString()
        }, { merge: true });

        const safeCommitteeKey = committee.name.replace(/\s+/g, '_').toLowerCase();
        const assignmentId = `${resident.gmkId}_committee_lead_${safeCommitteeKey}`;
        const emailAssignmentId = `${resident.email.toLowerCase().trim()}_committee_lead_${safeCommitteeKey}`;

        const payload = {
          id: assignmentId,
          gmkId: resident.gmkId,
          email: resident.email.toLowerCase().trim(),
          position: roleToAssign,
          role: roleToAssign,
          committee: committee.name,
          assignedBy: profile?.email || 'event_director',
          assignedAt: new Date().toISOString()
        };

        transaction.set(doc(db, "roleAssignments", assignmentId), payload);
        transaction.set(doc(db, "roleAssignments", emailAssignmentId), payload);

        for (const update of userRolesUpdates) {
          transaction.update(update.ref, { roles: update.roles });
        }
      });

      // 4. Create audit log (outside transaction)
      await createAuditLog(
        'COMMITTEE_MEMBER_ADDED',
        profile?.email || 'event_director',
        'committee',
        committee.id,
        `Assigned ${resident.fullName} as Committee Lead for ${committee.name}`
      );

      // 5. Force reload latest committee document and update state immediately
      const reloadedSnap = await getDoc(committeeRef);
      if (reloadedSnap.exists()) {
        const reloadedData = reloadedSnap.data() as EventCommittee;
        setActiveCommittees(prev => prev.map(c => c.id === reloadedData.id ? reloadedData : c));
      }

      setLastTransactionStatus('SUCCESS');
      setLastFirestoreWriteStatus('OK');
      setSuccessMsg(`✓ Successfully added ${resident.fullName} as a Committee Lead for ${committee.name}.`);
      setResidentSearchQuery('');
      setCommitteeSearchQueries(prev => ({ ...prev, [committee.id]: '' }));
    } catch (err: any) {
      console.error(err);
      const code = err.code || 'TRANSACTION_FAIL';
      const msg = err.message || "Failed to add committee lead";
      setLastTransactionStatus('FAILED');
      setLastErrorCode(code);
      setLastErrorMessage(msg);
      setLastFirestoreWriteStatus('ERROR: ' + code);
      setErrorMsg(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Add committee lead
  const handleAddCommitteeLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCommitteeToConfigure || !selectedLeadGmkId) return;

    const committee = activeCommittees.find(c => c.name === activeCommitteeToConfigure);
    if (!committee) return;

    const resident = residents.find(r => r.gmkId === selectedLeadGmkId);
    if (!resident) return;

    setIsSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    setLastTransactionStatus('RUNNING');
    setLastErrorCode('None');
    setLastErrorMessage('None');

    try {
      // 1. Pre-write check: Read the latest committee document and check active lead count
      const committeeRef = doc(db, "eventCommittees", committee.id);
      const committeeSnap = await getDoc(committeeRef);
      if (!committeeSnap.exists()) {
        throw new Error("Committee document could not be found.");
      }
      const committeeData = committeeSnap.data() as EventCommittee;
      const activeLeads = (committeeData.members || []).filter(m => m.role === 'Lead');

      // Check if resident is already a lead
      if (activeLeads.some(m => m.residentId === resident.gmkId)) {
        setErrorMsg("This resident is already a Lead of this committee.");
        setIsSubmitting(false);
        return;
      }

      // 2. Fetch relevant user documents before the transaction
      const userQ = query(collection(db, "users"), where("email", "==", resident.email.toLowerCase().trim()));
      const userSnap = await getDocs(userQ);
      const userDocRefs = userSnap.docs.map(d => doc(db, "users", d.id));

      const isProgramsCommittee = committee.name.toLowerCase() === 'programs' || committee.name.toLowerCase() === 'program';
      const roleToAssign = isProgramsCommittee ? 'program_lead' : 'committee_lead';

      // 3. Execute Firestore Transaction
      await runTransaction(db, async (transaction) => {
        const committeeDoc = await transaction.get(committeeRef);
        if (!committeeDoc.exists()) {
          throw new Error("Committee document could not be found.");
        }
        const latestCommittee = committeeDoc.data() as EventCommittee;

        // Double check active leads on the latest document
        const latestLeads = (latestCommittee.members || []).filter(m => m.role === 'Lead');

        // Check if resident is already a lead
        if (latestLeads.some(m => m.residentId === resident.gmkId)) {
          throw new Error("This resident is already a Lead of this committee.");
        }

        const newMember: EventCommitteeMember = {
          residentId: resident.gmkId,
          fullName: resident.fullName,
          email: resident.email,
          role: 'Lead'
        };

        const updatedMembers = [...(latestCommittee.members || []), newMember];

        // Read and prepare User Roles inside transaction to avoid race conditions
        const userRolesUpdates: Array<{ ref: any; roles: string[] }> = [];
        for (const userDocRef of userDocRefs) {
          const uDoc = await transaction.get(userDocRef);
          if (uDoc.exists()) {
            const currentRoles: string[] = uDoc.data().roles || [];
            const updatedRoles = Array.from(new Set([...currentRoles, roleToAssign]));
            userRolesUpdates.push({ ref: userDocRef, roles: updatedRoles });
          }
        }

        // Apply all updates atomically
        transaction.update(committeeRef, {
          members: updatedMembers,
          updatedAt: new Date().toISOString()
        });

        transaction.set(doc(db, "residents", resident.gmkId), {
          committee: committee.name,
          updatedAt: new Date().toISOString()
        }, { merge: true });

        const safeCommitteeKey = committee.name.replace(/\s+/g, '_').toLowerCase();
        const assignmentId = `${resident.gmkId}_committee_lead_${safeCommitteeKey}`;
        const emailAssignmentId = `${resident.email.toLowerCase().trim()}_committee_lead_${safeCommitteeKey}`;

        const payload = {
          id: assignmentId,
          gmkId: resident.gmkId,
          email: resident.email.toLowerCase().trim(),
          position: roleToAssign,
          role: roleToAssign,
          committee: committee.name,
          assignedBy: profile?.email || 'event_director',
          assignedAt: new Date().toISOString()
        };

        transaction.set(doc(db, "roleAssignments", assignmentId), payload);
        transaction.set(doc(db, "roleAssignments", emailAssignmentId), payload);

        for (const update of userRolesUpdates) {
          transaction.update(update.ref, { roles: update.roles });
        }
      });

      // 4. Create audit log (outside transaction)
      await createAuditLog(
        'COMMITTEE_MEMBER_ADDED',
        profile?.email || 'event_director',
        'committee',
        committee.id,
        `Assigned ${resident.fullName} as Committee Lead for ${committee.name}`
      );

      // 5. Force reload latest committee document and update state immediately
      const reloadedSnap = await getDoc(committeeRef);
      if (reloadedSnap.exists()) {
        const reloadedData = reloadedSnap.data() as EventCommittee;
        setActiveCommittees(prev => prev.map(c => c.id === reloadedData.id ? reloadedData : c));
      }

      setLastTransactionStatus('SUCCESS');
      setLastFirestoreWriteStatus('OK');
      setSuccessMsg(`✓ Successfully added ${resident.fullName} as a Committee Lead for ${committee.name}.`);
      setSelectedLeadGmkId('');
    } catch (err: any) {
      console.error(err);
      const code = err.code || 'TRANSACTION_FAIL';
      const msg = err.message || "Failed to add committee lead";
      setLastTransactionStatus('FAILED');
      setLastErrorCode(code);
      setLastErrorMessage(msg);
      setLastFirestoreWriteStatus('ERROR: ' + code);
      setErrorMsg(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Remove committee lead
  const handleRemoveCommitteeLead = async (residentId: string, email: string, committeeName: string) => {
    const committee = activeCommittees.find(c => c.name === committeeName);
    if (!committee) return;

    setIsSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    setLastTransactionStatus('RUNNING');
    setLastErrorCode('None');
    setLastErrorMessage('None');

    try {
      const safeCommitteeKey = committee.name.replace(/\s+/g, '_').toLowerCase();
      const isProgramsCommittee = committee.name.toLowerCase() === 'programs' || committee.name.toLowerCase() === 'program';
      const roleToRemove = isProgramsCommittee ? 'program_lead' : 'committee_lead';

      // 1. Fetch relevant user documents before the transaction
      const qOthers = query(
        collection(db, "roleAssignments"),
        where("email", "==", email.toLowerCase().trim()),
        where("position", "==", roleToRemove)
      );
      const otherSnap = await getDocs(qOthers);
      // Filter out current assignment from others
      const assignmentId = `${residentId}_committee_lead_${safeCommitteeKey}`;
      const emailAssignmentId = `${email.toLowerCase().trim()}_committee_lead_${safeCommitteeKey}`;
      const otherAssignments = otherSnap.docs.filter(d => d.id !== assignmentId && d.id !== emailAssignmentId);

      const userQ = query(collection(db, "users"), where("email", "==", email.toLowerCase().trim()));
      const userSnap = await getDocs(userQ);
      const userDocRefs = userSnap.docs.map(d => doc(db, "users", d.id));

      // 2. Execute Transaction
      await runTransaction(db, async (transaction) => {
        const committeeRef = doc(db, "eventCommittees", committee.id);
        const committeeDoc = await transaction.get(committeeRef);
        if (!committeeDoc.exists()) {
          throw new Error("Committee document could not be found.");
        }
        const latestCommittee = committeeDoc.data() as EventCommittee;

        const updatedMembers = (latestCommittee.members || []).filter(m => m.residentId !== residentId);

        // Prepare user roles updates inside transaction to avoid race conditions
        const userRolesUpdates: Array<{ ref: any; roles: string[] }> = [];
        if (otherAssignments.length === 0) {
          for (const userDocRef of userDocRefs) {
            const uDoc = await transaction.get(userDocRef);
            if (uDoc.exists()) {
              const currentRoles: string[] = uDoc.data().roles || [];
              const updatedRoles = currentRoles.filter(r => r !== roleToRemove);
              userRolesUpdates.push({ ref: userDocRef, roles: updatedRoles });
            }
          }
        }

        // Apply updates atomically
        transaction.update(committeeRef, {
          members: updatedMembers,
          updatedAt: new Date().toISOString()
        });

        transaction.set(doc(db, "residents", residentId), {
          committee: "",
          updatedAt: new Date().toISOString()
        }, { merge: true });

        transaction.delete(doc(db, "roleAssignments", assignmentId));
        transaction.delete(doc(db, "roleAssignments", emailAssignmentId));

        for (const update of userRolesUpdates) {
          transaction.update(update.ref, { roles: update.roles });
        }
      });

      // 3. Log Audit Center (outside transaction)
      await createAuditLog(
        'COMMITTEE_MEMBER_REMOVED',
        profile?.email || 'event_director',
        'committee',
        committee.id,
        `Removed committee lead with ID ${residentId}`
      );

      // 4. Force reload latest committee document and update state immediately
      const committeeRef = doc(db, "eventCommittees", committee.id);
      const reloadedSnap = await getDoc(committeeRef);
      if (reloadedSnap.exists()) {
        const reloadedData = reloadedSnap.data() as EventCommittee;
        setActiveCommittees(prev => prev.map(c => c.id === reloadedData.id ? reloadedData : c));
      }

      setLastTransactionStatus('SUCCESS');
      setLastFirestoreWriteStatus('OK');
      setSuccessMsg(`✓ Removed Committee Lead assignment successfully.`);
    } catch (err: any) {
      console.error(err);
      const code = err.code || 'TRANSACTION_FAIL';
      const msg = err.message || "Failed to remove committee lead";
      setLastTransactionStatus('FAILED');
      setLastErrorCode(code);
      setLastErrorMessage(msg);
      setLastFirestoreWriteStatus('ERROR: ' + code);
      setErrorMsg(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Forensic logging & payload sanitization for Firestore RTCO-022
  const sanitizeFirestorePayload = <T,>(obj: T): T => {
    if (obj === null || obj === undefined) {
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map(sanitizeFirestorePayload).filter(v => v !== undefined) as unknown as T;
    }
    if (typeof obj === 'object') {
      const cleaned: Record<string, any> = {};
      for (const [key, value] of Object.entries(obj)) {
        if (value === undefined) {
          continue; // Omit undefined keys from payload
        }
        cleaned[key] = sanitizeFirestorePayload(value);
      }
      return cleaned as T;
    }
    return obj;
  };

  const logPayloadForensics = (label: string, payload: any) => {
    console.log(`[PROGRAM CREATE FORENSIC] ${label} PAYLOAD:`, payload);
    if (payload && typeof payload === 'object') {
      Object.entries(payload).forEach(([key, value]) => {
        console.log(`[PROGRAM CREATE FORENSIC] Key: "${key}", Value:`, value, `, Type:`, typeof value);
        if (value === undefined) {
          console.error(`[PROGRAM CREATE FORENSIC] DETECTED UNDEFINED AT KEY: "${key}"`);
        }
      });
    }
  };

  // Create Program directly from ED/Program Workspace
  const handleCreateProgramDirectly = async () => {
    if (!selectedEventId || !progTitle.trim()) {
      setErrorMsg('Please provide a program title.');
      return;
    }
    if (!progType || progType === 'Select') {
      setErrorMsg('Please select a valid Program Type (Adults, Kids, or Mix).');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const progId = `prog_${selectedEventId}_${Date.now()}`;

      // Build Coordinators array safely without undefined values
      const coordinatorsList: Array<{
        residentId: string;
        fullName: string;
        email: string;
        phone?: string;
        unitDisplay?: string;
      }> = [];

      if (progCoordinator) {
        const cResId = progCoordinator.gmkId || (progCoordinator as any).residentId || (progCoordinator as any).id || '';
        const cName = progCoordinator.fullName || '';
        const cEmail = progCoordinator.email || (progCoordinator as any).rawResident?.email || '';
        const cPhone = progCoordinator.phone || (progCoordinator as any).rawResident?.phone || (progCoordinator as any).rawResident?.whatsAppNumber || '';
        const cUnit = progCoordinator.displayUnitNumber || (progCoordinator as any).unitDisplay || (progCoordinator as any).rawResident?.displayUnitNumber || 'N/A';

        coordinatorsList.push({
          residentId: cResId,
          fullName: cName,
          email: cEmail,
          phone: cPhone,
          unitDisplay: cUnit
        });
      }

      // Map UI progType to schema type ('ADULTS' | 'KIDS' | 'MIXED')
      let normalizedProgType: 'ADULTS' | 'KIDS' | 'MIXED' = 'MIXED';
      const upperType = (progType || '').toUpperCase();
      if (upperType === 'ADULTS') normalizedProgType = 'ADULTS';
      if (upperType === 'KIDS' || upperType === 'CHILDREN') normalizedProgType = 'KIDS';
      if (upperType === 'MIXED' || upperType === 'MIX') normalizedProgType = 'MIXED';

      const rawPayload: EventProgram = {
        id: progId,
        eventId: selectedEventId,
        title: progTitle.trim(),
        description: (progDescription || '').trim(),
        category: normalizedProgType,
        programType: normalizedProgType,
        coordinators: coordinatorsList,
        participants: [],
        volunteers: [],
        status: 'approved',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        expenses: []
      };

      // Sanitize payload to recursively remove any undefined fields
      const payload = sanitizeFirestorePayload(rawPayload);

      // Forensic diagnostic logging before Firestore write
      logPayloadForensics('PROGRAM_CREATE_DIRECTLY', payload);

      await setDoc(doc(db, "eventPrograms", progId), payload);

      // If coordinator was assigned, update role assignments and user records
      if (progCoordinator) {
        const coordResId = progCoordinator.gmkId || (progCoordinator as any).residentId || (progCoordinator as any).id || '';
        const coordEmail = (progCoordinator.email || (progCoordinator as any).rawResident?.email || '').toLowerCase().trim();

        if (coordResId) {
          const assignmentId = `${coordResId}_program_coordinator_${selectedEventId}`;
          const rolePayload = sanitizeFirestorePayload({
            id: assignmentId,
            gmkId: coordResId,
            email: coordEmail,
            position: 'program_coordinator',
            role: 'program_coordinator',
            eventId: selectedEventId,
            assignedBy: profile?.email || 'event_director',
            assignedAt: new Date().toISOString()
          });

          await setDoc(doc(db, "roleAssignments", assignmentId), rolePayload);

          if (coordEmail) {
            const emailAssignmentId = `${coordEmail}_program_coordinator_${selectedEventId}`;
            await setDoc(doc(db, "roleAssignments", emailAssignmentId), { ...rolePayload, id: emailAssignmentId });

            const userQ = query(collection(db, "users"), where("email", "==", coordEmail));
            const userSnap = await getDocs(userQ);
            for (const uDoc of userSnap.docs) {
              const currentRoles: string[] = uDoc.data().roles || [];
              const updatedRoles = Array.from(new Set([...currentRoles, 'program_coordinator']));
              await setDoc(doc(db, "users", uDoc.id), { roles: updatedRoles }, { merge: true });
            }
          }
        }
      }

      await createAuditLog(
        'PROGRAM_CREATED',
        profile?.email || 'event_director',
        'program',
        progId,
        `Event Director created program '${progTitle.trim()}'${progCoordinator ? ` and assigned coordinator ${progCoordinator.fullName}` : ''}`
      );

      setSuccessMsg(`✓ Successfully created program "${progTitle.trim()}"${progCoordinator ? ` and assigned ${progCoordinator.fullName} as Coordinator` : ''}.`);
      setProgTitle('');
      setProgDescription('');
      setProgCoordinator(null);
      setProgCoordinatorSearch('');
    } catch (err: any) {
      console.error("[PROGRAM CREATE ERROR]", err);
      setErrorMsg("Failed to create program: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- RTCO-021 PROGRAM WORKSPACE SEARCH & CANDIDATE EVALUATION HELPERS ---

  // Program Coordinator candidate search: STRICTLY Primary Resident + Spouse ONLY
  const searchProgramCoordinatorCandidates = (queryStr: string) => {
    const query = queryStr.toLowerCase().trim();
    if (!query) return [];

    console.log(`[PROGRAM COORDINATOR SEARCH] Authenticated user: ${profile?.email || 'user'}`);

    const candidates: Array<{
      id: string;
      residentId: string;
      fullName: string;
      email: string;
      displayUnitNumber: string;
      phone: string;
      isFamilyMember: boolean;
      relationship: 'Primary Resident' | 'Spouse';
      rawResident?: ResidentProfile;
    }> = [];

    // 1. Active Primary Residents
    residents.forEach(r => {
      if (r.status !== 'active') {
        console.log(`[PROGRAM COORDINATOR SEARCH] Candidate: ${r.fullName}, Relationship: Primary Resident, Eligible: FALSE, Reason: Resident status is not active`);
        return;
      }
      const matches = r.fullName?.toLowerCase().includes(query) ||
        r.gmkId?.toLowerCase().includes(query) ||
        r.email?.toLowerCase().includes(query) ||
        r.displayUnitNumber?.toLowerCase().includes(query) ||
        r.phone?.toLowerCase().includes(query);

      if (matches) {
        console.log(`[PROGRAM COORDINATOR SEARCH] Candidate: ${r.fullName}, Relationship: Primary Resident, Eligible: TRUE, Reason: Active Primary Resident`);
        candidates.push({
          id: r.gmkId,
          residentId: r.gmkId,
          fullName: r.fullName,
          email: r.email,
          displayUnitNumber: r.displayUnitNumber || 'N/A',
          phone: r.phone || r.whatsAppNumber || '',
          isFamilyMember: false,
          relationship: 'Primary Resident',
          rawResident: r
        });
      }
    });

    // 2. Spouses ONLY (DO NOT show children, parents, or other family members)
    familyMembers.forEach(m => {
      const rel = (m.relationship || '').toLowerCase();
      if (rel !== 'spouse') {
        console.log(`[PROGRAM COORDINATOR SEARCH] Candidate: ${m.name}, Relationship: ${m.relationship || 'Dependent'}, Eligible: FALSE, Reason: Only Primary Resident and Spouse are eligible for Coordinator role`);
        return;
      }

      const parentId = m.familyId ? m.familyId.replace('fam_', '') : '';
      const parentRes = residents.find(r => r.gmkId === parentId);
      if (!parentRes || parentRes.status !== 'active') return;

      const matches = m.name?.toLowerCase().includes(query) ||
        m.id?.toLowerCase().includes(query) ||
        parentRes.gmkId?.toLowerCase().includes(query) ||
        parentRes.email?.toLowerCase().includes(query) ||
        parentRes.displayUnitNumber?.toLowerCase().includes(query);

      if (matches) {
        console.log(`[PROGRAM COORDINATOR SEARCH] Candidate: ${m.name}, Relationship: Spouse, Eligible: TRUE, Reason: Spouse of active resident`);
        candidates.push({
          id: m.id || `${parentRes.gmkId}_spouse`,
          residentId: parentRes.gmkId,
          fullName: m.name,
          email: parentRes.email,
          displayUnitNumber: parentRes.displayUnitNumber || 'N/A',
          phone: m.phone || m.whatsAppNumber || parentRes.phone || parentRes.whatsAppNumber || '',
          isFamilyMember: true,
          relationship: 'Spouse'
        });
      }
    });

    return candidates;
  };

  // Program Participant candidate search: Calculates eligibility based on Program Type (ADULTS / KIDS / MIXED) + Age + Gender
  const searchProgramParticipantCandidates = (
    queryStr: string,
    progType: 'ADULTS' | 'KIDS' | 'MIXED' | string,
    ageFilter: string = 'All',
    genderFilter: string = 'All'
  ) => {
    const query = queryStr.toLowerCase().trim();
    const normalizedProgType = (progType || 'ADULTS').toUpperCase() as 'ADULTS' | 'KIDS' | 'MIXED';

    console.log(`[PROGRAM PARTICIPANT SEARCH] Query: "${query}", Program Type: ${normalizedProgType}, AgeFilter: ${ageFilter}, GenderFilter: ${genderFilter}`);

    const candidates: Array<{
      id: string;
      residentId: string;
      fullName: string;
      email: string;
      phone: string;
      parentPhone: string;
      unitDisplay: string;
      accommodationType: string;
      isChild: boolean;
      age: number;
      gender: string;
      relationship: string;
    }> = [];

    const currentYear = new Date().getFullYear();

    // Age filter helper
    const matchesAgeFilter = (personAge: number) => {
      if (ageFilter === 'All') return true;
      if (ageFilter === 'Adults' || ageFilter === '18+') return personAge >= 18;
      if (ageFilter === '0-5') return personAge >= 0 && personAge <= 5;
      if (ageFilter === '6-10') return personAge >= 6 && personAge <= 10;
      if (ageFilter === '11-14') return personAge >= 11 && personAge <= 14;
      if (ageFilter === '15-17') return personAge >= 15 && personAge <= 17;
      return true;
    };

    // Gender filter helper
    const matchesGenderFilter = (personGender: string) => {
      if (genderFilter === 'All') return true;
      return personGender.toLowerCase() === genderFilter.toLowerCase();
    };

    // 1. Primary Residents (Adults, age 18+)
    residents.forEach(r => {
      if (r.status !== 'active') return;
      const personAge = 25; // Adults >= 18
      const personGender = (r.gender || 'male').toLowerCase();

      let eligible = true;
      let reason = '';

      if (normalizedProgType === 'KIDS') {
        eligible = false;
        reason = 'AGE >= 18 (Adults excluded in KIDS programs)';
      } else if (normalizedProgType === 'ADULTS' || normalizedProgType === 'MIXED') {
        eligible = true;
        reason = `${normalizedProgType} program allows adults (Age ${personAge} >= 18)`;
      }

      if (query) {
        const qMatch = r.fullName?.toLowerCase().includes(query) ||
          r.gmkId?.toLowerCase().includes(query) ||
          r.email?.toLowerCase().includes(query) ||
          r.displayUnitNumber?.toLowerCase().includes(query) ||
          r.phone?.toLowerCase().includes(query);
        if (!qMatch) return;
      }

      console.log(`[PROGRAM PARTICIPANT SEARCH] Program Type: ${normalizedProgType}`);
      console.log(`[PROGRAM PARTICIPANT SEARCH] Candidate: ${r.fullName}, Age: ${personAge}, Gender: ${r.gender || 'Male'}, Eligible: ${eligible ? 'TRUE' : 'FALSE'}, Reason: ${reason}`);

      if (eligible && matchesAgeFilter(personAge) && matchesGenderFilter(personGender)) {
        candidates.push({
          id: r.gmkId,
          residentId: r.gmkId,
          fullName: r.fullName,
          email: r.email,
          phone: r.phone || r.whatsAppNumber || '',
          parentPhone: '',
          unitDisplay: r.displayUnitNumber || 'N/A',
          accommodationType: r.unitType || 'Apartment',
          isChild: false,
          age: personAge,
          gender: r.gender || 'Male',
          relationship: 'Primary Resident'
        });
      }
    });

    // 2. Family Members (Spouses, Children, Parents)
    familyMembers.forEach(m => {
      const parentId = m.familyId ? m.familyId.replace('fam_', '') : '';
      const parentRes = residents.find(r => r.gmkId === parentId);
      if (!parentRes || parentRes.status !== 'active') return;

      const rel = (m.relationship || '').toLowerCase();
      let personAge = 25;
      let isChild = false;

      if (rel === 'child') {
        if (m.yearOfBirth) {
          const yob = parseInt(m.yearOfBirth);
          personAge = !isNaN(yob) ? (currentYear - yob) : 10;
        } else {
          personAge = 10;
        }
        // If child is 18+, they are treated as an ADULT!
        isChild = personAge < 18;
      } else {
        personAge = rel === 'parent' ? 60 : 35;
        isChild = false;
      }

      const personGender = (m.gender || (rel === 'spouse' ? 'female' : 'male')).toLowerCase();

      let eligible = true;
      let reason = '';

      if (normalizedProgType === 'ADULTS') {
        if (isChild) {
          eligible = false;
          reason = `AGE ${personAge} < 18 (Children excluded in ADULTS programs)`;
        } else {
          eligible = true;
          reason = `AGE ${personAge} >= 18 (Adults eligible)`;
        }
      } else if (normalizedProgType === 'KIDS') {
        if (!isChild) {
          eligible = false;
          reason = `AGE ${personAge} >= 18 (Adults excluded in KIDS programs)`;
        } else {
          eligible = true;
          reason = `AGE ${personAge} < 18 (Kids eligible)`;
        }
      } else {
        eligible = true;
        reason = 'MIXED program allows both adults and children';
      }

      if (query) {
        const qMatch = m.name?.toLowerCase().includes(query) ||
          m.id?.toLowerCase().includes(query) ||
          parentRes.gmkId?.toLowerCase().includes(query) ||
          parentRes.email?.toLowerCase().includes(query) ||
          parentRes.displayUnitNumber?.toLowerCase().includes(query) ||
          m.phone?.toLowerCase().includes(query);
        if (!qMatch) return;
      }

      console.log(`[PROGRAM PARTICIPANT SEARCH] Program Type: ${normalizedProgType}`);
      console.log(`[PROGRAM PARTICIPANT SEARCH] Candidate: ${m.name}, Age: ${personAge}, Gender: ${m.gender || (rel === 'spouse' ? 'Female' : 'Male')}, Eligible: ${eligible ? 'TRUE' : 'FALSE'}, Reason: ${reason}`);

      if (eligible && matchesAgeFilter(personAge) && matchesGenderFilter(personGender)) {
        const directPhone = m.phone || m.whatsAppNumber || '';
        const householdPhone = parentRes.phone || parentRes.whatsAppNumber || '';
        // Fallback for female spouse or participant without direct phone
        const displayPhone = directPhone || householdPhone || 'Not Available';
        const parentGuardianPhone = isChild ? (householdPhone || 'Not Available') : '';

        candidates.push({
          id: m.id || `${parentRes.gmkId}_${rel}`,
          residentId: m.id || `${parentRes.gmkId}_${rel}`,
          fullName: m.name,
          email: parentRes.email,
          phone: displayPhone,
          parentPhone: parentGuardianPhone,
          unitDisplay: parentRes.displayUnitNumber || 'N/A',
          accommodationType: parentRes.unitType || 'Apartment',
          isChild: isChild,
          age: personAge,
          gender: m.gender || (rel === 'spouse' ? 'Female' : 'Male'),
          relationship: m.relationship || 'Family Member'
        });
      }
    });

    return candidates;
  };

  // Assign program participant
  const handleAssignProgramParticipant = async (programId: string, participantData: any) => {
    const prog = activePrograms.find(p => p.id === programId);
    if (!prog) return;

    setIsSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const currentParticipants = prog.participants || [];
      const resId = participantData.residentId || participantData.id || '';
      const fullName = participantData.fullName || '';

      if (currentParticipants.some(p => p.residentId === resId || (fullName && p.fullName.toLowerCase() === fullName.toLowerCase()))) {
        setErrorMsg("Participant is already added to this program.");
        return;
      }

      const cleanParticipant = sanitizeFirestorePayload({
        residentId: resId,
        fullName: fullName,
        email: participantData.email || '',
        phone: participantData.phone || '',
        unitDisplay: participantData.unitDisplay || 'N/A',
        accommodationType: participantData.accommodationType || 'Apartment',
        parentPhone: participantData.parentPhone || '',
        isChild: !!participantData.isChild,
        age: participantData.age,
        gender: participantData.gender || ''
      });

      const updatedParticipants = [...currentParticipants, cleanParticipant];

      await updateDoc(doc(db, "eventPrograms", programId), sanitizeFirestorePayload({
        participants: updatedParticipants,
        updatedAt: new Date().toISOString()
      }));

      setSuccessMsg(`✓ Added ${fullName} as participant for ${prog.title}.`);
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Failed to assign participant: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Remove program participant
  const handleRemoveProgramParticipant = async (programId: string, residentId: string, fullName: string) => {
    const prog = activePrograms.find(p => p.id === programId);
    if (!prog) return;

    setIsSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const updatedParticipants = (prog.participants || []).filter(p => p.residentId !== residentId && p.fullName !== fullName);

      await updateDoc(doc(db, "eventPrograms", programId), sanitizeFirestorePayload({
        participants: updatedParticipants,
        updatedAt: new Date().toISOString()
      }));

      setSuccessMsg(`✓ Removed participant.`);
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Failed to remove participant: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Assign program coordinator to an existing program
  const handleAssignProgramCoordinator = async (programId: string, resident: any) => {
    const prog = activePrograms.find(p => p.id === programId);
    if (!prog) return;

    setIsSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const currentCoordinators = prog.coordinators || [];
      const resId = resident.gmkId || resident.residentId || resident.id || '';
      const fullName = resident.fullName || '';
      const email = (resident.email || resident.rawResident?.email || '').toLowerCase().trim();
      const phone = resident.phone || resident.rawResident?.phone || '';
      const unitDisplay = resident.displayUnitNumber || resident.unitDisplay || resident.rawResident?.displayUnitNumber || 'N/A';

      if (currentCoordinators.some(c => c.residentId === resId || (fullName && c.fullName.toLowerCase() === fullName.toLowerCase()))) {
        setErrorMsg("Resident is already a coordinator for this program.");
        return;
      }

      const newCoord = sanitizeFirestorePayload({
        residentId: resId,
        fullName: fullName,
        email: email,
        phone: phone,
        unitDisplay: unitDisplay
      });

      const updatedCoordinators = [...currentCoordinators, newCoord];

      await updateDoc(doc(db, "eventPrograms", programId), sanitizeFirestorePayload({
        coordinators: updatedCoordinators,
        updatedAt: new Date().toISOString()
      }));

      // assign role
      if (resId) {
        const assignmentId = `${resId}_program_coordinator_${selectedEventId}`;
        const rolePayload = sanitizeFirestorePayload({
          id: assignmentId,
          gmkId: resId,
          email: email,
          position: 'program_coordinator',
          role: 'program_coordinator',
          eventId: selectedEventId,
          assignedBy: profile?.email || 'event_director',
          assignedAt: new Date().toISOString()
        });
        await setDoc(doc(db, "roleAssignments", assignmentId), rolePayload);
        if (email) {
          const emailAssignmentId = `${email}_program_coordinator_${selectedEventId}`;
          await setDoc(doc(db, "roleAssignments", emailAssignmentId), { ...rolePayload, id: emailAssignmentId });
        }
      }

      setSuccessMsg(`✓ Assigned ${fullName} as a coordinator for ${prog.title}.`);
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Failed to assign coordinator: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Remove coordinator from program
  const handleRemoveProgramCoordinator = async (programId: string, residentId: string, email: string) => {
    const prog = activePrograms.find(p => p.id === programId);
    if (!prog) return;

    setIsSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const updatedCoordinators = (prog.coordinators || []).filter(c => c.residentId !== residentId);

      await updateDoc(doc(db, "eventPrograms", programId), sanitizeFirestorePayload({
        coordinators: updatedCoordinators,
        updatedAt: new Date().toISOString()
      }));

      // delete role assignment if they are not coordinating any other program for this event
      const matchesOther = activePrograms.some(p => p.id !== programId && (p.coordinators || []).some(c => c.residentId === residentId));
      if (!matchesOther) {
        const assignmentId = `${residentId}_program_coordinator_${selectedEventId}`;
        const safeEmail = (email || '').toLowerCase().trim();
        await deleteDoc(doc(db, "roleAssignments", assignmentId));
        if (safeEmail) {
          const emailAssignmentId = `${safeEmail}_program_coordinator_${selectedEventId}`;
          await deleteDoc(doc(db, "roleAssignments", emailAssignmentId));
        }
      }

      setSuccessMsg(`✓ Removed coordinator assignment.`);
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Failed to remove coordinator: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Assign program volunteer
  const handleAssignProgramVolunteer = async (programId: string, resident: any) => {
    const prog = activePrograms.find(p => p.id === programId);
    if (!prog) return;

    setIsSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const currentVolunteers = prog.volunteers || [];
      const resId = resident.gmkId || resident.residentId || resident.id || '';
      const fullName = resident.fullName || '';
      const email = resident.email || resident.rawResident?.email || '';
      const phone = resident.phone || resident.rawResident?.phone || '';
      const unitDisplay = resident.displayUnitNumber || resident.unitDisplay || resident.rawResident?.displayUnitNumber || 'N/A';

      if (currentVolunteers.some(v => v.residentId === resId || (fullName && v.fullName.toLowerCase() === fullName.toLowerCase()))) {
        setErrorMsg("Resident is already a volunteer for this program.");
        return;
      }

      const newVol = sanitizeFirestorePayload({
        residentId: resId,
        fullName: fullName,
        email: email,
        phone: phone,
        unitDisplay: unitDisplay
      });

      const updatedVolunteers = [...currentVolunteers, newVol];

      await updateDoc(doc(db, "eventPrograms", programId), sanitizeFirestorePayload({
        volunteers: updatedVolunteers,
        updatedAt: new Date().toISOString()
      }));

      setSuccessMsg(`✓ Assigned ${fullName} as a volunteer for ${prog.title}.`);
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Failed to assign volunteer: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Remove program volunteer
  const handleRemoveProgramVolunteer = async (programId: string, residentId: string) => {
    const prog = activePrograms.find(p => p.id === programId);
    if (!prog) return;

    setIsSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const updatedVolunteers = (prog.volunteers || []).filter(v => v.residentId !== residentId);

      await updateDoc(doc(db, "eventPrograms", programId), {
        volunteers: updatedVolunteers,
        updatedAt: new Date().toISOString()
      });

      setSuccessMsg(`✓ Removed volunteer assignment.`);
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Failed to remove volunteer: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Add committee expense (3 decimal places OMR precision)
  const handleAddCommitteeExpense = async (committeeId: string) => {
    if (!commExpenseDesc.trim() || !commExpenseAmount.trim()) {
      setErrorMsg("Please enter expense description and amount.");
      return;
    }
    const amountNum = parseFloat(commExpenseAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setErrorMsg("Please enter a valid positive expense amount.");
      return;
    }

    const committee = activeCommittees.find(c => c.id === committeeId) || activeCommittees.find(c => c.name === activeCommitteeToConfigure);
    if (!committee) {
      setErrorMsg("Committee not found.");
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const currentExpenses = committee.expenses || [];
      const roundedAmount = Math.round(amountNum * 1000) / 1000;
      const newExpense: EventCommitteeExpense = {
        id: `exp_comm_${Date.now()}`,
        date: commExpenseDate || new Date().toISOString().split('T')[0],
        description: commExpenseDesc.trim(),
        amount: roundedAmount,
        createdAt: new Date().toISOString(),
        createdBy: profile?.email || 'event_director'
      };

      await updateDoc(doc(db, "eventCommittees", committee.id), {
        expenses: [...currentExpenses, newExpense],
        updatedAt: new Date().toISOString()
      });

      await createAuditLog(
        'COMMITTEE_EXPENSE_ADDED',
        profile?.email || 'event_director',
        'committee',
        committee.id,
        `Added expense '${commExpenseDesc.trim()}' of OMR ${roundedAmount.toFixed(3)} to ${committee.name} committee.`
      );

      setSuccessMsg(`✓ Added expense of OMR ${roundedAmount.toFixed(3)} to ${committee.name} Expense Sheet.`);
      setCommExpenseDesc('');
      setCommExpenseAmount('');
      setCommExpenseDate('');
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Failed to add committee expense: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Remove committee expense
  const handleRemoveCommitteeExpense = async (committeeId: string, expenseId: string) => {
    const committee = activeCommittees.find(c => c.id === committeeId) || activeCommittees.find(c => c.name === activeCommitteeToConfigure);
    if (!committee) return;

    setIsSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const updatedExpenses = (committee.expenses || []).filter(e => e.id !== expenseId);

      await updateDoc(doc(db, "eventCommittees", committee.id), {
        expenses: updatedExpenses,
        updatedAt: new Date().toISOString()
      });

      setSuccessMsg(`✓ Expense removed successfully from ${committee.name} Expense Sheet.`);
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Failed to remove committee expense: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Add program expense
  const handleAddProgramExpense = async (programId: string) => {
    if (!expenseTitle.trim() || !expenseAmount.trim()) {
      setErrorMsg("Please enter expense title and amount.");
      return;
    }
    const amountNum = parseFloat(expenseAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setErrorMsg("Please enter a valid expense amount.");
      return;
    }

    const prog = activePrograms.find(p => p.id === programId);
    if (!prog) return;

    setIsSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const currentExpenses = prog.expenses || [];
      const newExpense = {
        id: `exp_${Date.now()}`,
        title: expenseTitle.trim(),
        amount: amountNum,
        status: 'approved' as const, // Automatically approved by Event Director
        createdAt: new Date().toISOString()
      };

      await updateDoc(doc(db, "eventPrograms", programId), {
        expenses: [...currentExpenses, newExpense],
        updatedAt: new Date().toISOString()
      });

      setSuccessMsg(`✓ Expense of ${amountNum} recorded for "${prog.title}".`);
      setExpenseTitle('');
      setExpenseAmount('');
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Failed to add program expense: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Remove program expense
  const handleRemoveProgramExpense = async (programId: string, expenseId: string) => {
    const prog = activePrograms.find(p => p.id === programId);
    if (!prog) return;

    setIsSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const updatedExpenses = (prog.expenses || []).filter(e => e.id !== expenseId);

      await updateDoc(doc(db, "eventPrograms", programId), {
        expenses: updatedExpenses,
        updatedAt: new Date().toISOString()
      });

      setSuccessMsg(`✓ Expense removed successfully.`);
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Failed to remove program expense: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Approve Program action
  const handleApproveProgram = async (programId: string) => {
    console.log(`[PROGRAM APPROVE 1] Approval clicked for program ID: ${programId}`);
    const prog = activePrograms.find(p => p.id === programId);
    if (!prog) return;
    console.log(`[PROGRAM APPROVE 2] Program identified: "${prog.title}"`);

    const currentProgComm = activeCommittees.find(c => c.name.toLowerCase() === 'program committee' || c.name.toLowerCase() === 'programs' || c.name.toLowerCase() === 'program');
    const commLeads = (currentProgComm?.members || []).filter(m => m.role === 'Lead');

    const isAuth = (profile?.roles || []).some((r: string) => ['event_director', 'admin', 'super_admin', 'president', 'vp'].includes(r)) || commLeads.some(l => l.email === profile?.email);
    console.log(`[PROGRAM APPROVE 3] Authorization resolved: ${isAuth ? 'AUTHORIZED' : 'DENIED'}`);

    setIsSubmitting(true);
    try {
      await updateDoc(doc(db, "eventPrograms", programId), {
        status: 'approved',
        updatedAt: new Date().toISOString()
      });
      console.log(`[PROGRAM APPROVE 4] Firestore commit successful for eventPrograms/${programId}`);

      await createAuditLog(
        'APPROVE_PROGRAM',
        profile?.email || 'event_director',
        'program',
        programId,
        `Approved stage program '${prog.title}' for Event ${selectedEventId}`
      );
      console.log(`[PROGRAM APPROVE 5] Audit log & UI refresh complete`);

      setSuccessMsg("✓ Program has been APPROVED and will appear immediately inside the Resident Event Hub.");
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Failed to approve program: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Reject Program action
  const handleRejectProgram = async (programId: string) => {
    console.log(`[PROGRAM REJECT 1] Rejection clicked for program ID: ${programId}`);
    const prog = activePrograms.find(p => p.id === programId);
    if (!prog) return;
    console.log(`[PROGRAM REJECT 2] Program identified: "${prog.title}"`);

    const currentProgComm = activeCommittees.find(c => c.name.toLowerCase() === 'program committee' || c.name.toLowerCase() === 'programs' || c.name.toLowerCase() === 'program');
    const commLeads = (currentProgComm?.members || []).filter(m => m.role === 'Lead');

    const isAuth = (profile?.roles || []).some((r: string) => ['event_director', 'admin', 'super_admin', 'president', 'vp'].includes(r)) || commLeads.some(l => l.email === profile?.email);
    console.log(`[PROGRAM REJECT 3] Authorization resolved: ${isAuth ? 'AUTHORIZED' : 'DENIED'}`);

    setIsSubmitting(true);
    try {
      await updateDoc(doc(db, "eventPrograms", programId), {
        status: 'rejected',
        updatedAt: new Date().toISOString()
      });
      console.log(`[PROGRAM REJECT 4] Firestore commit successful for eventPrograms/${programId}`);

      await createAuditLog(
        'REJECT_PROGRAM',
        profile?.email || 'event_director',
        'program',
        programId,
        `Rejected stage program '${prog.title}' for Event ${selectedEventId}`
      );
      console.log(`[PROGRAM REJECT 5] Audit log & UI refresh complete`);

      setSuccessMsg("✓ Program has been rejected. Authorized users can now delete this rejected submission.");
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Failed to reject program: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Delete Program action with GEAS Confirmation & Safety Verification
  const handleDeleteProgram = async (programId: string, programTitle?: string) => {
    console.log(`[PROGRAM DELETE 1] Delete action initiated for program ID: ${programId}`);
    
    const prog = activePrograms.find(p => p.id === programId);
    if (!prog) {
      console.error(`[PROGRAM DELETE 2] Program not found: ${programId}`);
      setErrorMsg("Program/Event not found.");
      return;
    }

    const userEmailLower = profile?.email?.toLowerCase().trim() || '';
    const userGmkIdUpper = profile?.gmkId?.toUpperCase().trim() || '';
    const userRoles = profile?.roles || [];

    // 1. Check Event Director / Executive / Admin role
    const isED = userRoles.some((r: string) => 
      ['event_director', 'admin', 'super_admin', 'president', 'vp', 'vice_president'].includes(r)
    );

    // 2. Check Program Lead responsibility (Lead in Program Committee)
    const currentProgComm = activeCommittees.find(c => 
      ['program committee', 'programs', 'program'].includes(c.name.toLowerCase())
    );
    const commLeads = (currentProgComm?.members || []).filter(m => m.role === 'Lead');
    const isProgramLead = commLeads.some(l => 
      (l.email && l.email.toLowerCase().trim() === userEmailLower) ||
      (l.residentId && l.residentId.toUpperCase().trim() === userGmkIdUpper)
    );

    // 3. Check Program Coordinator responsibility (assigned coordinator for THIS specific program)
    const isProgramCoordinator = (prog.coordinators || []).some(c => 
      (c.email && c.email.toLowerCase().trim() === userEmailLower) ||
      (c.residentId && c.residentId.toUpperCase().trim() === userGmkIdUpper)
    );

    const isAuth = isED || isProgramLead || isProgramCoordinator;
    console.log(`[PROGRAM DELETE 3] Authorization check: isED=${isED}, isProgramLead=${isProgramLead}, isProgramCoordinator=${isProgramCoordinator} => ${isAuth ? 'AUTHORIZED' : 'DENIED'}`);

    if (!isAuth) {
      setErrorMsg("AUTHORIZATION BLOCK: Deletion of Program/Event is restricted to the Event Director, Program Lead, or assigned Program Coordinator for this program.");
      return;
    }

    // 4. PROGRAM/EVENT DELETE SAFETY: Inspect protected operational records
    const protectedDetails: string[] = [];

    const participantsCount = (prog.participants || []).length;
    if (participantsCount > 0) {
      protectedDetails.push(`${participantsCount} registered participant(s)`);
    }

    const expensesCount = (prog.expenses || []).length;
    if (expensesCount > 0) {
      protectedDetails.push(`${expensesCount} logged expense record(s)`);
    }

    // Check registrations referencing this program
    const linkedRegs = registrations.filter(r => 
      r.programId === prog.id || 
      r.selectedProgramId === prog.id ||
      (r.programTitle && r.programTitle.toLowerCase() === prog.title.toLowerCase())
    );
    if (linkedRegs.length > 0) {
      protectedDetails.push(`${linkedRegs.length} registration record(s)`);
    }

    if (protectedDetails.length > 0) {
      setErrorMsg(`This Program/Event contains operational records and cannot be deleted. Remaining records: ${protectedDetails.join(', ')}.`);
      return;
    }

    // 5. GEAS Confirmation Dialog
    console.log(`[PROGRAM DELETE 5] Opening GEASConfirmationDialog for "${prog.title}"`);
    const confirmed = await showConfirm({
      title: `Delete Program/Event?`,
      message: `This will permanently remove the Program/Event "${prog.title}" (Identifier: ${prog.id}) and its associated operational records.`,
      severity: `danger`,
      confirmText: `Delete Program/Event`,
      cancelText: `Cancel`
    });

    if (!confirmed) {
      console.log(`[PROGRAM DELETE 6] Deletion cancelled by user`);
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      console.log(`[PROGRAM DELETE 7] Deleting Firestore doc eventPrograms/${programId}`);
      await deleteDoc(doc(db, "eventPrograms", programId));

      await createAuditLog(
        'DELETE_PROGRAM',
        profile?.email || 'event_director',
        'program',
        programId,
        `Permanently deleted Program/Event '${prog.title}' (ID: ${programId})`
      );

      setActivePrograms(prev => prev.filter(p => p.id !== programId));
      if (activeProgForManagement === programId) {
        setActiveProgForManagement(null);
      }
      setSuccessMsg(`✓ Program/Event "${prog.title}" has been permanently deleted.`);
    } catch (err: any) {
      console.error("❌ [PROGRAM DELETE FAIL]", err);
      setErrorMsg("Failed to delete Program/Event: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateProgramDetails = async (programId: string) => {
    if (!editProgTitle.trim()) {
      setErrorMsg("Program title is required.");
      return;
    }
    setIsSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const progRef = doc(db, "eventPrograms", programId);
      await updateDoc(progRef, {
        title: editProgTitle.trim(),
        programType: editProgCategory,
        category: editProgCategory,
        description: editProgDescription.trim(),
        updatedAt: new Date().toISOString()
      });

      setActivePrograms(prev => prev.map(p => p.id === programId ? {
        ...p,
        title: editProgTitle.trim(),
        programType: editProgCategory as any,
        category: editProgCategory,
        description: editProgDescription.trim(),
        updatedAt: new Date().toISOString()
      } : p));

      setEditingProgramId(null);
      setSuccessMsg(`✓ Program "${editProgTitle.trim()}" updated successfully.`);
    } catch (err: any) {
      console.error("Failed to update program details:", err);
      setErrorMsg("Failed to update program details: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Program Candidate Search (including Spouses and Family Members)
  const searchProgramCommitteeCandidates = (queryStr: string) => {
    console.log(`[PROGRAM MEMBER 1] Search initiated with query: "${queryStr}"`);
    if (!queryStr.trim()) return [];
    
    const query = queryStr.toLowerCase().trim();
    console.log(`[PROGRAM MEMBER 2] Search query normalized: "${query}"`);
    console.log(`[PROGRAM MEMBER 3] Resident & family data loaded: ${residents.length} primary residents, ${familyMembers.length} family members`);

    const currentProgComm = activeCommittees.find(c => c.name.toLowerCase() === 'program committee' || c.name.toLowerCase() === 'programs' || c.name.toLowerCase() === 'program');
    const commLeads = (currentProgComm?.members || []).filter(m => m.role === 'Lead');

    const candidates: Array<{
      id: string;
      residentId: string;
      fullName: string;
      email: string;
      displayUnitNumber: string;
      phone: string;
      isFamilyMember: boolean;
      relationship?: string;
      rawResident?: ResidentProfile;
    }> = [];

    // Search primary active residents
    residents.forEach(r => {
      if (r.status !== 'active') return;
      if (commLeads.some(l => l.residentId === r.gmkId || l.email?.toLowerCase() === r.email?.toLowerCase())) return;

      if (
        r.fullName?.toLowerCase().includes(query) ||
        r.gmkId?.toLowerCase().includes(query) ||
        r.email?.toLowerCase().includes(query) ||
        r.displayUnitNumber?.toLowerCase().includes(query) ||
        r.phone?.toLowerCase().includes(query)
      ) {
        candidates.push({
          id: r.gmkId,
          residentId: r.gmkId,
          fullName: r.fullName,
          email: r.email,
          displayUnitNumber: r.displayUnitNumber,
          phone: r.phone || '',
          isFamilyMember: false,
          rawResident: r
        });
      }
    });

    // Search family members (spouses, adult family members)
    familyMembers.forEach(m => {
      const parentId = m.familyId ? m.familyId.replace('fam_', '') : '';
      const parentRes = residents.find(r => r.gmkId === parentId);
      if (!parentRes || parentRes.status !== 'active') return;

      if (commLeads.some(l => l.fullName === m.name || l.residentId === m.id)) return;

      if (
        m.name?.toLowerCase().includes(query) ||
        m.id?.toLowerCase().includes(query) ||
        parentRes.gmkId?.toLowerCase().includes(query) ||
        parentRes.email?.toLowerCase().includes(query) ||
        parentRes.displayUnitNumber?.toLowerCase().includes(query)
      ) {
        candidates.push({
          id: m.id,
          residentId: parentRes.gmkId,
          fullName: m.name,
          email: parentRes.email,
          displayUnitNumber: parentRes.displayUnitNumber,
          phone: parentRes.phone || '',
          isFamilyMember: true,
          relationship: m.relationship || 'spouse'
        });
      }
    });

    console.log(`[PROGRAM MEMBER 4] Matching members found: ${candidates.length}`);
    candidates.forEach((cand, i) => {
      console.log(`[PROGRAM MEMBER 5] Spouse/member eligibility evaluated for candidate #${i + 1}: ${cand.fullName} (${cand.isFamilyMember ? cand.relationship : 'Primary Member'}, Unit: ${cand.displayUnitNumber}) -> ELIGIBLE`);
    });

    return candidates;
  };

  const handleSelectProgramCommitteeLead = async (cand: {
    id: string;
    residentId: string;
    fullName: string;
    email: string;
    displayUnitNumber: string;
    phone?: string;
    isFamilyMember: boolean;
    relationship?: string;
    rawResident?: ResidentProfile;
  }) => {
    console.log(`[PROGRAM MEMBER 6] Candidate selected: ${cand.fullName} (Family member: ${cand.isFamilyMember}, Relationship: ${cand.relationship || 'Self'})`);
    console.log(`[PROGRAM MEMBER 7] Assignment prepared for committee '${activeCommitteeToConfigure}'`);

    const resProfileToAssign: ResidentProfile = cand.rawResident || {
      gmkId: cand.residentId,
      fullName: cand.fullName,
      email: cand.email,
      displayUnitNumber: cand.displayUnitNumber,
      unitKey: cand.displayUnitNumber.replace(/[^a-zA-Z0-9]/g, ''),
      phone: cand.phone || '',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    console.log(`[PROGRAM MEMBER 8] Firestore write initiated for ${cand.fullName}`);
    await handleAssignLeadDirectly(resProfileToAssign, activeCommitteeToConfigure);
    console.log(`[PROGRAM MEMBER 9] Assignment verified: ${cand.fullName} assigned to ${activeCommitteeToConfigure}`);
  };

  // Dynamic Registrant KPI calculations
  const calculateStats = () => {
    let totalAdults = 0;
    let totalChildren = 0;

    registrations.forEach(reg => {
      const fam = families.find(f => f.id === reg.familyId);
      const primaryName = fam ? fam.fullName : '';
      const famMembers = familyMembers.filter(m => m.familyId === reg.familyId);

      const participants = reg.participants || [];
      participants.forEach(name => {
        if (name === primaryName) {
          totalAdults++;
        } else {
          const match = famMembers.find(m => m.name.toLowerCase().trim() === name.toLowerCase().trim());
          if (match && match.relationship === 'child') {
            totalChildren++;
          } else {
            totalAdults++;
          }
        }
      });
    });

    return {
      familiesCount: registrations.length,
      residentsCount: totalAdults + totalChildren,
      adultsCount: totalAdults,
      childrenCount: totalChildren
    };
  };

  const stats = calculateStats();

  // Comprehensive CSV Report Export Trigger
  const handleExportCSV = () => {
    if (!activeEvent) return;
    const headers = [
      "Registration ID",
      "GMK ID",
      "Name of Registrant",
      "Email Address",
      "Unit Number",
      "Adults Count",
      "Children Count",
      "Total Participants",
      "Amount to Pay (OMR)",
      "Payment Status",
      "Registered Participants List"
    ];

    const rows = registrations.map(reg => {
      const fam = families.find(f => f.id === reg.familyId);
      const primaryName = fam ? fam.fullName : (reg.primaryMemberEmail ? reg.primaryMemberEmail.split('@')[0] : 'Unknown');
      const unit = fam ? fam.displayUnitNumber : 'Unknown';
      const famMembers = familyMembers.filter(m => m.familyId === reg.familyId);
      const participants = reg.participants || [];

      let adults = 0;
      let children = 0;

      if (reg.paymentSummary && typeof reg.paymentSummary.childrenCount === 'number') {
        children = reg.paymentSummary.childrenCount;
        adults = Math.max(0, participants.length - children);
      } else {
        participants.forEach(name => {
          if (name === primaryName) {
            adults++;
          } else {
            const match = famMembers.find(m => m.name.toLowerCase().trim() === name.toLowerCase().trim());
            if (match && match.relationship === 'child') {
              children++;
            } else {
              adults++;
            }
          }
        });
      }

      const amountToPay = reg.paymentAmount ?? reg.paymentSummary?.totalAmount ?? 0;
      const pStatus = reg.paymentStatus || (amountToPay === 0 ? 'waived' : 'pending');
      const participantsStr = `"${participants.join(', ')}"`;

      return [
        reg.id,
        reg.primaryMemberGmkId || 'N/A',
        `"${primaryName}"`,
        reg.primaryMemberEmail,
        unit,
        adults,
        children,
        reg.totalParticipants || (adults + children),
        amountToPay.toFixed(3),
        pStatus.toUpperCase(),
        participantsStr
      ];
    });

    const csvContent = "data:text/csv;charset=utf-8," 
      + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `${activeEvent.eventName || activeEvent.title}_comprehensive_registration_report.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-screen bg-[#fafaf9] flex flex-col font-sans text-xs" id="ems-full-screen-root">
      
      {/* Premium Forest Theme Header Row */}
      <header className="bg-[#0f4c2a] text-white border-b border-[#0b381f] py-4 px-6 flex flex-col md:flex-row items-center justify-between gap-4 shrink-0 shadow-md">
        <div className="flex items-center space-x-4">
          <button
            onClick={onBackToResidentPortal}
            className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center space-x-1.5 text-xs font-bold transition-all cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Return to GMK Portal</span>
          </button>
          
          <div className="h-6 w-px bg-white/25 hidden md:block"></div>
          
          <div>
            <h2 className="text-sm font-black uppercase tracking-widest font-heading flex items-center space-x-2">
              <CalendarDays className="w-4 h-4 text-[#d4af37]" />
              <span>Event Director Workspace</span>
            </h2>
            <p className="text-[10px] text-emerald-200/90 font-medium">Simplify Community Gatherings & Festivals</p>
          </div>
        </div>

        {/* Top selector for currently active event across config/committee tabs */}
        <div className="flex items-center space-x-4 w-full md:w-auto justify-between md:justify-end">
          {events.length > 0 ? (
            <div className="flex items-center space-x-3">
              <span className="text-[10px] uppercase font-black text-[#d4af37]">Active:</span>
              <select
                value={selectedEventId}
                onChange={(e) => {
                  setSelectedEventId(e.target.value);
                  setActiveCommitteeToConfigure(null);
                }}
                className="text-xs font-black bg-[#0d4124] border border-emerald-700 p-2 rounded-xl text-white focus:outline-none cursor-pointer"
              >
                {events.map(ev => (
                  <option key={ev.id} value={ev.id}>
                    {ev.eventName || ev.title}
                  </option>
                ))}
              </select>

              {activeEvent && (
                <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase font-mono border ${
                  activeEvent.status === 'published' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' :
                  activeEvent.status === 'completed' ? 'bg-blue-500/20 text-blue-300 border-blue-500/40' :
                  'bg-amber-500/20 text-amber-300 border-amber-500/40'
                }`}>
                  {activeEvent.status?.toUpperCase() || 'DRAFT'}
                </span>
              )}
            </div>
          ) : (
            <span className="text-xs font-extrabold text-emerald-300">No Events Created</span>
          )}

          {profile && (
            <div className="flex items-center space-x-2 bg-black/15 p-2 rounded-xl border border-white/5 shrink-0">
              <div className="w-7 h-7 bg-[#d4af37] text-[#0f4c2a] font-black rounded-full flex items-center justify-center text-xs shadow-xs">
                {profile.fullName?.charAt(0) || 'D'}
              </div>
              <div className="text-left hidden lg:block leading-none">
                <strong className="block text-[10px] text-white font-bold">{profile.fullName}</strong>
                <span className="text-[9px] text-[#d4af37] font-black uppercase tracking-wider">Director</span>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Mobile Compact Sticky Navigation Row (Visible only on mobile, immediately below the green header) */}
      <div className="md:hidden sticky top-0 bg-white border-b border-stone-200 shadow-xs z-40 flex items-center justify-around py-2 px-1">
        {[
          { id: 'configuration', label: 'Configuration', icon: Settings },
          { id: 'committees', label: 'Committees', icon: Users },
          { id: 'registrations', label: 'Registrations', icon: FileText },
          { id: 'reports', label: 'Reports', icon: TrendingUp }
        ].map((item) => {
          const Icon = item.icon;
          const isSelected = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => {
                setActiveTab(item.id as EDTab);
                setActiveCommitteeToConfigure(null);
              }}
              className={`flex flex-col items-center justify-center flex-1 py-1 rounded-xl transition-all cursor-pointer ${
                isSelected 
                  ? 'text-[#0f4c2a] font-black bg-stone-50' 
                  : 'text-stone-400 font-bold hover:text-stone-600'
              }`}
            >
              <Icon className={`w-4 h-4 shrink-0 ${isSelected ? 'text-[#0f4c2a]' : 'text-stone-400'}`} />
              <span className="text-[9px] mt-1 tracking-tight">{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* Main sidebar + workspace division */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* Sidebar Nav (Strictly 5 items) */}
        <aside className="w-64 bg-white border-r border-stone-200 flex flex-col justify-between shrink-0 overflow-y-auto hidden md:flex p-4 space-y-4 shadow-xs">
          <div className="space-y-1.5">
            <span className="block text-[9px] uppercase font-black text-stone-400 tracking-widest pl-3 mb-3">WORKFLOW CONSOLE</span>
            
            {[
              { id: 'events', label: 'Events', icon: Calendar },
              { id: 'configuration', label: 'Configuration', icon: Settings },
              { id: 'committees', label: 'Committees', icon: Users },
              { id: 'programs', label: 'Programs', icon: Flame },
              { id: 'registrations', label: 'Registrations', icon: FileText },
              { id: 'reports', label: 'Reports', icon: TrendingUp }
            ].map((item) => {
              const Icon = item.icon;
              const isSelected = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveTab(item.id as EDTab);
                    setActiveCommitteeToConfigure(null);
                  }}
                  className={`w-full text-left p-3.5 rounded-xl text-xs font-extrabold flex items-center space-x-3 transition-all cursor-pointer ${
                    isSelected 
                      ? 'bg-[#0f4c2a] text-white shadow-sm' 
                      : 'text-stone-600 hover:bg-[#0f4c2a]/5 hover:text-[#0f4c2a]'
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${isSelected ? 'text-white' : 'text-stone-400'}`} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Content Workspace Area */}
        <main className="flex-1 p-4 sm:p-6 overflow-y-auto bg-stone-50 space-y-4 pb-24 md:pb-6">
          
          {/* Alerts */}
          {successMsg && (
            <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl flex items-center space-x-2.5 shadow-sm animate-fadeIn">
              <Check className="w-4.5 h-4.5 text-emerald-600 shrink-0" />
              <span className="font-sans font-bold text-xs">{successMsg}</span>
            </div>
          )}

          {errorMsg && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl flex items-center space-x-2.5 shadow-sm animate-fadeIn">
              <AlertCircle className="w-4.5 h-4.5 text-rose-600 shrink-0" />
              <span className="font-sans font-bold text-xs whitespace-pre-line">{errorMsg}</span>
            </div>
          )}

          {/* Tab Renderers */}

          {/* 1. EVENTS TAB */}
          {activeTab === 'events' && (
            <div className="space-y-6 animate-fadeIn">
              <div className="flex items-center justify-between border-b border-stone-200 pb-3">
                <div>
                  <h3 className="text-sm font-extrabold text-[#0f4c2a] uppercase tracking-wider font-heading">
                    Community Gathering Directory
                  </h3>
                  <p className="text-stone-550 text-[10px] font-bold">Manage, delete, or create a new community event.</p>
                </div>
                
                <button
                  onClick={() => setShowNewEventForm(!showNewEventForm)}
                  className="px-4 py-2.5 rounded-xl bg-[#0f4c2a] hover:bg-[#0c3e22] text-white text-xs font-bold flex items-center space-x-1.5 transition-colors cursor-pointer shadow-sm"
                >
                  <Plus className="w-4 h-4" />
                  <span>New Event</span>
                </button>
              </div>

              {/* Inline Create Event Form */}
              {showNewEventForm && (
                <GMKCard className="p-6 bg-white border border-stone-200 space-y-4 max-w-xl animate-fadeIn">
                  <div className="flex items-center justify-between border-b border-stone-150 pb-2">
                    <h4 className="font-extrabold text-[#0f4c2a] font-heading">Create New Gathering</h4>
                    <button onClick={() => setShowNewEventForm(false)} className="text-stone-400 hover:text-stone-600">
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <form onSubmit={handleCreateEventSubmit} className="space-y-4 text-xs">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] uppercase font-black text-stone-500 mb-1">Event Name</label>
                        <input 
                          type="text" 
                          required
                          value={newEventName}
                          onChange={(e) => setNewEventName(e.target.value)}
                          placeholder="e.g. Onam Harvest Festival"
                          className="w-full font-bold bg-stone-50 border border-stone-200 p-2.5 rounded-xl text-stone-850 focus:outline-none focus:ring-1 focus:ring-[#0f4c2a]"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase font-black text-stone-500 mb-1">Event Type</label>
                        <select 
                          value={newEventType}
                          onChange={(e) => setNewEventType(e.target.value)}
                          className="w-full font-bold bg-stone-50 border border-stone-200 p-2.5 rounded-xl text-stone-850 focus:outline-none focus:ring-1 focus:ring-[#0f4c2a] cursor-pointer"
                        >
                          <option value="Onam">Onam</option>
                          <option value="GMAD">GMAD</option>
                          <option value="Christmas">Christmas</option>
                          <option value="Vishu">Vishu</option>
                          <option value="Custom">Custom Gathering</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] uppercase font-black text-stone-500 mb-1">Event Year</label>
                        <input 
                          type="number" 
                          required
                          value={newEventYear}
                          onChange={(e) => setNewEventYear(Number(e.target.value))}
                          className="w-full font-bold bg-stone-50 border border-stone-200 p-2.5 rounded-xl text-stone-850 focus:outline-none focus:ring-1 focus:ring-[#0f4c2a]"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] uppercase font-black text-stone-500 mb-1">Description</label>
                      <textarea 
                        rows={3}
                        required
                        value={newEventDescription}
                        onChange={(e) => setNewEventDescription(e.target.value)}
                        placeholder="Briefly state the celebration theme, timings, dress code and overall outline..."
                        className="w-full font-bold bg-stone-50 border border-stone-200 p-2.5 rounded-xl text-stone-850 focus:outline-none focus:ring-1 focus:ring-[#0f4c2a]"
                      />
                    </div>

                    <div className="flex justify-end space-x-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setShowNewEventForm(false)}
                        className="px-4 py-2 border border-stone-250 rounded-xl text-stone-700 font-bold hover:bg-stone-50 cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={isSubmitting}
                        className="px-4 py-2 bg-[#0f4c2a] text-white rounded-xl font-bold hover:bg-[#0c3e22] cursor-pointer flex items-center space-x-1"
                      >
                        {isSubmitting ? (
                          <span>Saving...</span>
                        ) : (
                          <>
                            <Check className="w-4 h-4" />
                            <span>Save Event</span>
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                </GMKCard>
              )}

              {/* Events Grid */}
              {isLoading ? (
                <div className="text-center py-12 text-stone-500 font-bold">Loading active events...</div>
              ) : events.length === 0 ? (
                <div className="text-center py-16 border border-dashed border-stone-250 rounded-2xl bg-white space-y-3">
                  <Calendar className="w-10 h-10 mx-auto text-stone-300" />
                  <h4 className="text-stone-700 font-black">No Events Configured</h4>
                  <p className="text-stone-500 text-[10px] max-w-xs mx-auto font-bold">Get started by creating your very first community gathering today!</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {events.map((evt) => (
                    <div 
                      key={evt.id} 
                      className={`bg-white border rounded-2xl overflow-hidden shadow-xs hover:shadow-md transition-all flex flex-col justify-between ${
                        selectedEventId === evt.id ? 'border-[#0f4c2a] ring-1 ring-[#0f4c2a]/40' : 'border-stone-200'
                      }`}
                    >
                      {/* Image Preview Area */}
                      <div className="w-full h-36 bg-stone-100 border-b border-stone-150 relative flex items-center justify-center overflow-hidden">
                        {evt.Thumbnail ? (
                          <img 
                            src={evt.Thumbnail} 
                            alt={evt.eventName || evt.title} 
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="text-center space-y-1">
                            <CalendarDays className="w-8 h-8 text-stone-300 mx-auto" />
                            <span className="text-[9px] text-stone-400 font-mono tracking-widest uppercase block">Thumbnail Missing</span>
                          </div>
                        )}
                        <span className={`absolute top-3 right-3 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
                          evt.status === 'published' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' :
                          evt.status === 'completed' ? 'bg-blue-100 text-blue-800 border border-blue-200' :
                          'bg-amber-100 text-amber-800 border border-amber-200'
                        }`}>
                          {evt.status || 'draft'}
                        </span>
                      </div>

                      <div className="p-4 space-y-3 flex-1 flex flex-col justify-between">
                        <div>
                          <span className="text-[10px] uppercase font-black text-[#d4af37] tracking-wider font-mono">
                            {evt.eventType || 'Gathering'} • {evt.eventYear || evt.year || '2026'}
                          </span>
                          <h4 className="text-stone-850 font-black text-sm font-heading line-clamp-1 mt-0.5">
                            {evt.eventName || evt.title}
                          </h4>
                          <p className="text-stone-600 text-[10px] font-bold line-clamp-2 mt-1 leading-relaxed">
                            {evt.description || 'No description provided.'}
                          </p>
                        </div>

                        <div className="pt-3 border-t border-stone-100 flex items-center justify-between gap-2 font-heading">
                          <button
                            onClick={() => {
                              setSelectedEventId(evt.id);
                              setActiveTab('configuration');
                            }}
                            className="flex-1 py-2 rounded-lg bg-[#0f4c2a] hover:bg-[#0c3e22] text-white border border-[#0f4c2a] text-[10px] font-extrabold uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center space-x-1.5 shadow-sm active:scale-[0.99]"
                          >
                            <Settings className="w-3.5 h-3.5" />
                            <span>Configure</span>
                          </button>
                          
                          {(evt.status || 'draft') === 'draft' && (
                            <button
                              onClick={() => handleDeleteEvent(evt.id, evt.eventName || evt.title)}
                              className="p-2 rounded-lg border border-red-200 hover:border-red-600 hover:bg-red-50 text-red-600 transition-all cursor-pointer"
                              title="Delete Draft Event"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                          {evt.status !== 'archived' && (
                            <button
                              onClick={() => handleArchiveEvent(evt.id, evt.eventName || evt.title)}
                              className="p-2 rounded-lg border border-stone-200 hover:border-amber-600 hover:bg-amber-50 text-amber-700 transition-all cursor-pointer"
                              title="Archive Event"
                            >
                              <Archive className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}


          {/* 2. CONFIGURATION TAB */}
          {activeTab === 'configuration' && (
            <div className="space-y-6 animate-fadeIn">
              <div className="border-b border-stone-200 pb-3 flex flex-col md:flex-row md:items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-extrabold text-[#0f4c2a] uppercase tracking-wider font-heading">
                    Event Configuration & Design
                  </h3>
                  <p className="text-stone-550 text-[10px] font-bold">Edit the details, upload asset images, and publish the event.</p>
                </div>

                {!selectedEventId && (
                  <span className="text-xs font-black text-red-600">Please select an event from the Events tab first.</span>
                )}
              </div>

              {selectedEventId && activeEvent ? (
                <form onSubmit={handleSaveConfiguration} className="space-y-6">
                  
                   {/* SECTION 1: Basic Information & Timelines */}
                  <GMKCard className="p-6 bg-white border border-stone-200 space-y-4">
                    <div className="border-b border-stone-150 pb-2">
                      <h4 className="font-extrabold text-[#0f4c2a] text-xs uppercase tracking-wider font-heading">Section 1: Basic Information</h4>
                    </div>

                    <div className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="md:col-span-2">
                          <label className="block text-[10px] uppercase font-black text-stone-500 mb-1">Event Name</label>
                          <input 
                            type="text" 
                            required
                            disabled={configStatus === 'completed'}
                            value={configEventName}
                            onChange={(e) => setConfigEventName(e.target.value)}
                            className="w-full font-bold bg-stone-50 border border-stone-200 p-2.5 rounded-xl text-stone-850 focus:outline-none focus:ring-1 focus:ring-[#0f4c2a] disabled:opacity-50"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] uppercase font-black text-stone-500 mb-1">Venue</label>
                          <input 
                            type="text" 
                            required
                            disabled={configStatus === 'completed'}
                            value={configVenue}
                            onChange={(e) => setConfigVenue(e.target.value)}
                            className="w-full font-bold bg-stone-50 border border-stone-200 p-2.5 rounded-xl text-stone-850 focus:outline-none focus:ring-1 focus:ring-[#0f4c2a] disabled:opacity-50"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] uppercase font-black text-stone-500 mb-1">Description</label>
                        <textarea 
                          rows={3}
                          required
                          disabled={configStatus === 'completed'}
                          value={configDescription}
                          onChange={(e) => setConfigDescription(e.target.value)}
                          className="w-full font-bold bg-stone-50 border border-stone-200 p-2.5 rounded-xl text-stone-850 focus:outline-none focus:ring-1 focus:ring-[#0f4c2a] disabled:opacity-50"
                        />
                      </div>

                      {/* Managed Program Highlights */}
                      <div className="border-t border-stone-100 pt-4 space-y-3 text-left">
                        <label className="block text-[10px] uppercase font-black text-stone-500 mb-1">Program Highlights</label>
                        <p className="text-[10px] text-stone-500 leading-relaxed font-medium">
                          Add the specific program highlights that residents will see. These must be entered directly and will not be auto-generated.
                        </p>
                        <div className="flex flex-wrap gap-2 pt-1">
                          {configHighlights.map((hl, index) => (
                            <div key={index} className="flex items-center space-x-1.5 bg-emerald-50 border border-emerald-100/50 px-2.5 py-1 rounded-full text-stone-800 text-[10px] font-bold">
                              <span>⭐ {hl}</span>
                              {configStatus !== 'completed' && (
                                <button
                                  type="button"
                                  onClick={() => setConfigHighlights(configHighlights.filter((_, i) => i !== index))}
                                  className="text-stone-400 hover:text-red-600 transition-colors cursor-pointer font-black text-[10px] ml-1"
                                >
                                  ×
                                </button>
                              )}
                            </div>
                          ))}
                          {configHighlights.length === 0 && (
                            <span className="text-stone-400 text-[10px] font-semibold italic">No highlights added yet. Add at least one highlight below.</span>
                          )}
                        </div>
                        {configStatus !== 'completed' && (
                          <div className="pt-2">
                            {!showAddHighlightInput ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setShowAddHighlightInput(true);
                                  setNewHighlightValue('');
                                }}
                                className="px-3 py-2 rounded-xl bg-[#0f4c2a] hover:bg-[#0c3e22] text-white text-[10px] font-bold uppercase transition-all cursor-pointer whitespace-nowrap flex items-center space-x-1"
                              >
                                <span>+ Add Highlight</span>
                              </button>
                            ) : (
                              <div className="flex flex-col sm:flex-row sm:items-center gap-2 max-w-md bg-stone-50 p-3 rounded-2xl border border-stone-200 animate-fadeIn">
                                <div className="flex-1">
                                  <input
                                    type="text"
                                    autoFocus
                                    placeholder="e.g. Traditional Pookalam, Pulikali, Onam Sadya"
                                    value={newHighlightValue}
                                    onChange={(e) => setNewHighlightValue(e.target.value)}
                                    className="w-full font-bold bg-white border border-stone-200 p-2 rounded-xl text-stone-850 text-[11px] focus:outline-none focus:ring-1 focus:ring-[#0f4c2a]"
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        const val = newHighlightValue.trim();
                                        if (val) {
                                          if (!configHighlights.includes(val)) {
                                            setConfigHighlights([...configHighlights, val]);
                                          }
                                          setNewHighlightValue('');
                                          setShowAddHighlightInput(false);
                                        }
                                      } else if (e.key === 'Escape') {
                                        e.preventDefault();
                                        setNewHighlightValue('');
                                        setShowAddHighlightInput(false);
                                      }
                                    }}
                                  />
                                </div>
                                <div className="flex items-center space-x-2 shrink-0 justify-end">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const val = newHighlightValue.trim();
                                      if (val) {
                                        if (!configHighlights.includes(val)) {
                                          setConfigHighlights([...configHighlights, val]);
                                        }
                                        setNewHighlightValue('');
                                        setShowAddHighlightInput(false);
                                      }
                                    }}
                                    disabled={!newHighlightValue.trim()}
                                    className="px-3 py-1.5 rounded-xl bg-[#0f4c2a] hover:bg-[#0c3e22] disabled:opacity-50 text-white text-[10px] font-bold uppercase transition-all cursor-pointer"
                                  >
                                    Add
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setNewHighlightValue('');
                                      setShowAddHighlightInput(false);
                                    }}
                                    className="px-3 py-1.5 rounded-xl bg-stone-200 hover:bg-stone-300 text-stone-700 text-[10px] font-bold uppercase transition-all cursor-pointer"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* SPRINT 4: Date & Time Redesign */}
                      <div className="border-t border-stone-100 pt-4 space-y-4">
                        <div className="flex items-center justify-between border-b border-stone-150 pb-2">
                          <h5 className="text-xs md:text-[13px] font-semibold text-stone-850 font-heading">Operational Timelines & Deadlines</h5>
                          {configStatus !== 'completed' && (
                            <button
                              type="button"
                              onClick={() => setIsTimelinesEditing(!isTimelinesEditing)}
                              className={`px-3 py-1 rounded-xl text-[10px] font-extrabold uppercase tracking-wider transition-all cursor-pointer ${
                                isTimelinesEditing
                                  ? 'bg-amber-100 text-amber-900 border border-amber-300'
                                  : 'bg-[#0f4c2a] hover:bg-[#0c3e22] text-white shadow-xs'
                              }`}
                            >
                              {isTimelinesEditing ? 'Done Editing' : 'Modify'}
                            </button>
                          )}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          {/* Col 1: Registration Window */}
                          <div className="bg-stone-50/50 border border-stone-250/50 p-4 rounded-2xl space-y-4">
                            <h6 className="text-xs font-bold text-[#0f4c2a] border-b border-stone-150 pb-1">Registration Window</h6>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <CompactEditableInput 
                                label="Opens Date"
                                value={configRegStart}
                                type="date"
                                onChange={setConfigRegStart}
                                disabled={!isTimelinesEditing || configStatus === 'completed'}
                              />
                              <CompactEditableInput 
                                label="Opens Time"
                                value={configRegStart}
                                type="time"
                                onChange={setConfigRegStart}
                                disabled={!isTimelinesEditing || configStatus === 'completed'}
                              />
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <CompactEditableInput 
                                label="Closes Date"
                                value={configRegEnd}
                                type="date"
                                onChange={setConfigRegEnd}
                                disabled={!isTimelinesEditing || configStatus === 'completed'}
                              />
                              <CompactEditableInput 
                                label="Closes Time"
                                value={configRegEnd}
                                type="time"
                                onChange={setConfigRegEnd}
                                disabled={!isTimelinesEditing || configStatus === 'completed'}
                              />
                            </div>
                          </div>

                          {/* Col 2: Event Duration */}
                          <div className="bg-stone-50/50 border border-stone-250/50 p-4 rounded-2xl space-y-4">
                            <h6 className="text-xs font-bold text-[#0f4c2a] border-b border-stone-150 pb-1">Event Duration</h6>
                            <div className="space-y-4">
                              <CompactEditableInput 
                                label="Event Date"
                                value={configEventStart}
                                type="date"
                                onChange={handleEventDateChange}
                                disabled={!isTimelinesEditing || configStatus === 'completed'}
                              />
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <CompactEditableInput 
                                  label="Starts Time"
                                  value={configEventStart}
                                  type="time"
                                  onChange={setConfigEventStart}
                                  disabled={!isTimelinesEditing || configStatus === 'completed'}
                                />
                                <CompactEditableInput 
                                  label="Ends Time"
                                  value={configEventEnd}
                                  type="time"
                                  onChange={setConfigEventEnd}
                                  disabled={!isTimelinesEditing || configStatus === 'completed'}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </GMKCard>

                  {/* SECTION 2: Compact Assets Manager Card */}
                  <GMKCard className="p-5 bg-white border border-stone-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="space-y-1">
                      <h4 className="font-semibold text-stone-850 text-sm md:text-base font-heading">Event Graphics</h4>
                      <p className="text-stone-500 text-xs">Configure the high-resolution poster and square thumbnail imagery for this gathering.</p>
                      <div className="flex items-center space-x-4 pt-1.5 text-xs text-stone-600 font-bold">
                        <span className="flex items-center space-x-1.5">
                          <span className={activeEvent.Poster || activeEvent.posterUrl ? "text-emerald-600" : "text-stone-300"}>●</span>
                          <span>Poster</span>
                        </span>
                        <span className="flex items-center space-x-1.5">
                          <span className={activeEvent.Thumbnail ? "text-emerald-600" : "text-stone-300"}>●</span>
                          <span>Thumbnail</span>
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowAssetManager(true)}
                      className="px-5 py-2.5 rounded-xl bg-[#0f4c2a] hover:bg-[#0c3e22] text-white text-xs font-black uppercase tracking-wider transition-all shadow-sm cursor-pointer whitespace-nowrap active:scale-95 text-center"
                    >
                      Open Asset Manager
                    </button>
                  </GMKCard>

                  {/* SECTION 3: Registration Rules (Sprint 6 & GMK-ARCH-002) */}
                  <GMKCard className="p-6 bg-white border border-stone-200 space-y-5">
                    <div className="border-b border-stone-150 pb-2 flex items-center justify-between gap-4">
                      <h4 className="font-extrabold text-[#0f4c2a] text-xs uppercase tracking-wider font-heading">Section 3: Registration Pricing</h4>
                      <button
                        type="button"
                        onClick={() => setShowPricingPolicyModal(true)}
                        className="px-2.5 py-1.5 border border-stone-250 hover:bg-stone-50 text-[#0f4c2a] font-extrabold text-[10px] uppercase tracking-wider rounded-xl transition-all shadow-xs cursor-pointer flex items-center space-x-1"
                      >
                        <span>View Pricing Policy</span>
                      </button>
                    </div>

                    {isPricingEditing && (
                      <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-amber-800 text-[11px] font-bold space-y-1 animate-fadeIn">
                        <div className="flex items-center space-x-2">
                          <span className="text-sm shrink-0">⚠️</span>
                          <span className="uppercase tracking-wider font-extrabold text-amber-900 font-heading text-xs">EDIT MODE</span>
                        </div>
                        <p className="leading-relaxed font-bold text-amber-950">
                          Changes are not saved until Save Pricing is clicked.
                        </p>
                        <p className="leading-relaxed text-[10px] text-amber-700 font-semibold pt-1">
                          Pricing modification is active. These rules will only apply to new registrations. Already completed registrations will retain their original calculation snapshots.
                        </p>
                      </div>
                    )}

                    <div className="space-y-4">
                      <h5 className="text-[10px] uppercase font-black text-[#0f4c2a] tracking-wider font-heading">Base Registration Fees & Additional Rates</h5>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                          <label className="block text-[10px] uppercase font-black text-stone-500 mb-1">Individual Rate (OMR)</label>
                          <input 
                            type="number" 
                            step="0.1"
                            required
                            disabled={!isPricingEditing || configStatus === 'completed'}
                            value={configIndividualFee}
                            onChange={(e) => setConfigIndividualFee(Number(e.target.value))}
                            className="w-full font-bold bg-stone-50 border border-stone-200 p-2.5 rounded-xl text-stone-850 focus:outline-none focus:ring-1 focus:ring-[#0f4c2a] disabled:opacity-50"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] uppercase font-black text-stone-500 mb-1">Couple Rate (OMR)</label>
                          <input 
                            type="number" 
                            step="0.1"
                            required
                            disabled={!isPricingEditing || configStatus === 'completed'}
                            value={configCoupleFee}
                            onChange={(e) => setConfigCoupleFee(Number(e.target.value))}
                            className="w-full font-bold bg-stone-50 border border-stone-200 p-2.5 rounded-xl text-stone-850 focus:outline-none focus:ring-1 focus:ring-[#0f4c2a] disabled:opacity-50"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] uppercase font-black text-stone-500 mb-1">Family Rate (OMR)</label>
                          <input 
                            type="number" 
                            step="0.1"
                            required
                            disabled={!isPricingEditing || configStatus === 'completed'}
                            value={configFamilyFee}
                            onChange={(e) => setConfigFamilyFee(Number(e.target.value))}
                            className="w-full font-bold bg-stone-50 border border-stone-200 p-2.5 rounded-xl text-stone-850 focus:outline-none focus:ring-1 focus:ring-[#0f4c2a] disabled:opacity-50"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] uppercase font-black text-stone-500 mb-1">Parent Rate (OMR / Parent)</label>
                          <input 
                            type="number" 
                            step="0.1"
                            required
                            disabled={!isPricingEditing || configStatus === 'completed'}
                            value={configParentFee}
                            onChange={(e) => setConfigParentFee(Number(e.target.value))}
                            className="w-full font-bold bg-stone-50 border border-stone-200 p-2.5 rounded-xl text-stone-850 focus:outline-none focus:ring-1 focus:ring-[#0f4c2a] disabled:opacity-50"
                          />
                          <p className="text-[8px] text-stone-400 font-semibold mt-1">Charged per attending parent.</p>
                        </div>
                        <div>
                          <label className="block text-[10px] uppercase font-black text-stone-500 mb-1">Other Resident Rate (OMR / Person)</label>
                          <input 
                            type="number" 
                            step="0.1"
                            required
                            disabled={!isPricingEditing || configStatus === 'completed'}
                            value={configOtherFee}
                            onChange={(e) => setConfigOtherFee(Number(e.target.value))}
                            className="w-full font-bold bg-stone-50 border border-stone-200 p-2.5 rounded-xl text-stone-850 focus:outline-none focus:ring-1 focus:ring-[#0f4c2a] disabled:opacity-50"
                          />
                          <p className="text-[8px] text-stone-400 font-semibold mt-1">Charged per maid / other resident.</p>
                        </div>
                      </div>
                    </div>

                    {/* Sub-Section: Children Age limits */}
                    <div className="border-t border-stone-100 pt-4 space-y-4">
                      <div className="max-w-md space-y-3">
                        <h5 className="text-[10px] uppercase font-black text-[#0f4c2a] tracking-wider font-heading">Children Pricing Setup</h5>
                        <div>
                          <label className="block text-[10px] uppercase font-black text-stone-500 mb-1">Children below this age attend free</label>
                          <input 
                            type="number" 
                            required
                            disabled={!isPricingEditing || configStatus === 'completed'}
                            value={configFreeChildAge}
                            onChange={(e) => setConfigFreeChildAge(Number(e.target.value))}
                            className="w-full font-bold bg-stone-50 border border-stone-200 p-2.5 rounded-xl text-stone-850 focus:outline-none focus:ring-1 focus:ring-[#0f4c2a] disabled:opacity-50"
                          />
                          <p className="text-[8px] text-stone-400 font-semibold mt-1">Children below this age register as free dependents.</p>
                        </div>
                      </div>
                    </div>

                    {/* Sub-Section: Guest Participants (Terminology Updated from External) */}
                    <div className="border-t border-stone-100 pt-4 space-y-4">
                      <h5 className="text-[10px] uppercase font-black text-[#0f4c2a] tracking-wider font-heading">Guest Participants</h5>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="flex items-center space-x-2.5 p-3 bg-stone-50 border border-stone-200 rounded-2xl">
                          <input 
                            type="checkbox" 
                            id="allow-external-checkbox"
                            disabled={!isPricingEditing || configStatus === 'completed'}
                            checked={configAllowExternal}
                            onChange={(e) => setConfigAllowExternal(e.target.checked)}
                            className="w-4 h-4 text-[#0f4c2a] border-stone-300 rounded focus:ring-[#0f4c2a] cursor-pointer"
                          />
                          <label htmlFor="allow-external-checkbox" className="space-y-0.5 cursor-pointer">
                            <span className="text-xs font-black text-stone-850 block">Allow Guests</span>
                            <span className="text-[9px] text-stone-500 font-bold block">Whether external non-resident guests can register.</span>
                          </label>
                        </div>
                        <div>
                          <label className="block text-[10px] uppercase font-black text-stone-500 mb-1">Guest Fee (OMR)</label>
                          <input 
                            type="number" 
                            step="0.1"
                            required={configAllowExternal}
                            disabled={!isPricingEditing || configStatus === 'completed' || !configAllowExternal}
                            value={configExternalRate}
                            onChange={(e) => setConfigExternalRate(Number(e.target.value))}
                            className="w-full font-bold bg-stone-50 border border-stone-200 p-2.5 rounded-xl text-stone-850 focus:outline-none focus:ring-1 focus:ring-[#0f4c2a] disabled:opacity-50"
                          />
                          <p className="text-[8px] text-stone-400 font-semibold mt-1">Charged flat rate per external guest.</p>
                        </div>
                      </div>
                    </div>

                    {/* Modify Pricing buttons at the end of pricing, positioned ABOVE activation */}
                    {configStatus !== 'completed' && (
                      <div className="border-t border-stone-100 pt-4 flex items-center justify-end">
                        {!isPricingEditing ? (
                          <button
                            type="button"
                            onClick={() => setIsPricingEditing(true)}
                            className="px-5 py-2.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-[#0f4c2a] border border-[#0f4c2a]/20 text-xs font-black uppercase tracking-wider transition-all cursor-pointer shadow-xs whitespace-nowrap active:scale-95"
                          >
                            Modify Pricing
                          </button>
                        ) : (
                          <div className="flex items-center space-x-3">
                            <button
                              type="button"
                              onClick={handleCancelPricingEdit}
                              className="px-5 py-2.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs font-black uppercase tracking-wider transition-all cursor-pointer"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  await handleSaveConfiguration(undefined, configStatus);
                                  setIsPricingEditing(false);
                                  showToast("Pricing configuration updated successfully.");
                                } catch (err) {
                                  console.error("Save pricing failed:", err);
                                }
                              }}
                              className="px-5 py-2.5 rounded-xl bg-[#0f4c2a] hover:bg-[#0c3e22] text-white text-xs font-black uppercase tracking-wider transition-all cursor-pointer shadow-xs active:scale-95"
                            >
                              Save Pricing
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Premium Pricing Engine Activation Block */}
                    <div className="border-t border-stone-100 pt-4">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between bg-[#0f4c2a]/5 border border-[#0f4c2a]/15 p-4 rounded-2xl gap-3">
                        <div className="space-y-0.5">
                          <span className="text-xs font-extrabold text-[#0f4c2a] uppercase tracking-wider block">Registration Pricing Activation</span>
                          <span className="text-[10px] text-stone-500 font-bold block">Toggle to activate the custom Entrance Fees and Pricing Rules calculations for this event.</span>
                        </div>
                        <button
                          type="button"
                          disabled={configStatus === 'completed'}
                          onClick={() => setConfigRegEnabled(!configRegEnabled)}
                          className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-sm cursor-pointer whitespace-nowrap ${
                            configRegEnabled 
                              ? 'bg-[#0f4c2a] text-white border border-[#0f4c2a]/20 hover:bg-[#0c3e22]' 
                              : 'bg-stone-100 hover:bg-stone-200 text-stone-600 border border-stone-200'
                          }`}
                        >
                          {configRegEnabled ? "✓ Pricing Engine Active" : "Activate Registration Pricing"}
                        </button>
                      </div>
                    </div>
                  </GMKCard>

                  {/* SECTION 4: Payment Transfer Information */}
                  <GMKCard className="p-6 bg-white border border-stone-200 space-y-5">
                    <div className="border-b border-stone-150 pb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div>
                        <h4 className="font-extrabold text-[#0f4c2a] text-xs uppercase tracking-wider font-heading">Section 4: Payment Transfer Information</h4>
                        <p className="text-[10px] text-stone-500 font-bold mt-0.5">
                          Specify bank transfer and mobile payment accounts displayed to registrants in the Events Hub.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setConfigPaymentAccounts(prev => [
                            ...prev,
                            { id: `acc_${Date.now()}`, name: '', bank: '', accountNumber: '', iban: '', mobilePhone: '', isSaved: false }
                          ]);
                        }}
                        disabled={configStatus === 'completed'}
                        className="px-3 py-1.5 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white font-black text-[10px] uppercase tracking-wider rounded-xl transition-all shadow-xs cursor-pointer flex items-center space-x-1 self-start sm:self-auto disabled:opacity-50"
                      >
                        <span>+ Add Payment Option</span>
                      </button>
                    </div>

                    {configPaymentAccounts.length === 0 ? (
                      <div className="p-4 text-center text-stone-450 italic font-bold text-xs bg-stone-50 border border-dashed border-stone-200 rounded-2xl">
                        No payment transfer accounts configured yet. Click "+ Add Payment Option" to start entering bank / mobile transfer details.
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {configPaymentAccounts.map((acc, index) => {
                          const hasInfo = Boolean(
                            (acc.name || '').trim() ||
                            (acc.bank || '').trim() ||
                            (acc.accountNumber || '').trim() ||
                            (acc.iban || '').trim() ||
                            (acc.mobilePhone || '').trim()
                          );
                          const isOptionSaved = acc.isSaved === true;
                          const isOptionLocked = isOptionSaved || configStatus === 'completed';

                          return (
                            <div key={acc.id || index} className="p-4 bg-stone-50/70 border border-stone-200 rounded-2xl space-y-3">
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-stone-200/80 pb-2 gap-2">
                                <div className="flex items-center space-x-2">
                                  <span className="text-[10px] uppercase font-black text-[#0f4c2a] font-heading">
                                    Payment Option #{index + 1}
                                  </span>
                                  {isOptionSaved && (
                                    <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[8px] font-black uppercase rounded-md">
                                      Saved
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center space-x-2">
                                  {/* Save button */}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setConfigPaymentAccounts(prev => prev.map((item, i) => i === index ? { ...item, isSaved: true } : item));
                                    }}
                                    disabled={!hasInfo || isOptionSaved || configStatus === 'completed'}
                                    className={`px-3 py-1 rounded-xl text-[10px] font-extrabold uppercase tracking-wider transition-all cursor-pointer ${
                                      !hasInfo || isOptionSaved || configStatus === 'completed'
                                        ? 'bg-stone-200 text-stone-400 cursor-not-allowed opacity-60'
                                        : 'bg-[#0f4c2a] hover:bg-[#0c3e22] text-white shadow-xs'
                                    }`}
                                  >
                                    Save
                                  </button>

                                  {/* Modify button */}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setConfigPaymentAccounts(prev => prev.map((item, i) => i === index ? { ...item, isSaved: false } : item));
                                    }}
                                    disabled={!hasInfo || !isOptionSaved || configStatus === 'completed'}
                                    className={`px-3 py-1 rounded-xl text-[10px] font-extrabold uppercase tracking-wider transition-all cursor-pointer ${
                                      !hasInfo || !isOptionSaved || configStatus === 'completed'
                                        ? 'bg-stone-200 text-stone-400 cursor-not-allowed opacity-60'
                                        : 'bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300'
                                    }`}
                                  >
                                    Modify
                                  </button>

                                  {/* Remove Account */}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setConfigPaymentAccounts(prev => prev.filter((_, i) => i !== index));
                                    }}
                                    disabled={configStatus === 'completed'}
                                    className="text-red-600 hover:text-red-800 text-[10px] font-black uppercase tracking-wider transition-colors cursor-pointer ml-1"
                                  >
                                    Remove
                                  </button>
                                </div>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                                <div>
                                  <label className="block text-[9px] uppercase font-black text-stone-500 mb-1">Name (Beneficiary)</label>
                                  <input
                                    type="text"
                                    placeholder="e.g. Beneficiary Name"
                                    value={acc.name || ''}
                                    disabled={isOptionLocked}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setConfigPaymentAccounts(prev => prev.map((item, i) => i === index ? { ...item, name: val } : item));
                                    }}
                                    className="w-full bg-white border border-stone-200 p-2.5 rounded-xl text-stone-850 font-bold focus:outline-none focus:ring-1 focus:ring-[#0f4c2a] disabled:bg-stone-100 disabled:text-stone-500"
                                  />
                                </div>

                                <div>
                                  <label className="block text-[9px] uppercase font-black text-stone-500 mb-1">Bank</label>
                                  <input
                                    type="text"
                                    placeholder="e.g. Bank Muscat"
                                    value={acc.bank || ''}
                                    disabled={isOptionLocked}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setConfigPaymentAccounts(prev => prev.map((item, i) => i === index ? { ...item, bank: val } : item));
                                    }}
                                    className="w-full bg-white border border-stone-200 p-2.5 rounded-xl text-stone-850 font-bold focus:outline-none focus:ring-1 focus:ring-[#0f4c2a] disabled:bg-stone-100 disabled:text-stone-500"
                                  />
                                </div>

                                <div>
                                  <label className="block text-[9px] uppercase font-black text-stone-500 mb-1">Account Number</label>
                                  <input
                                    type="text"
                                    placeholder="e.g. 1234567890"
                                    value={acc.accountNumber || ''}
                                    disabled={isOptionLocked}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setConfigPaymentAccounts(prev => prev.map((item, i) => i === index ? { ...item, accountNumber: val } : item));
                                    }}
                                    className="w-full bg-white border border-stone-200 p-2.5 rounded-xl text-stone-850 font-mono font-bold text-xs focus:outline-none focus:ring-1 focus:ring-[#0f4c2a] disabled:bg-stone-100 disabled:text-stone-500"
                                  />
                                </div>

                                <div>
                                  <label className="block text-[9px] uppercase font-black text-stone-500 mb-1">IBAN</label>
                                  <input
                                    type="text"
                                    placeholder="e.g. OM89 0000 1234 5678 9000 12"
                                    value={acc.iban || ''}
                                    disabled={isOptionLocked}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setConfigPaymentAccounts(prev => prev.map((item, i) => i === index ? { ...item, iban: val } : item));
                                    }}
                                    className="w-full bg-white border border-stone-200 p-2.5 rounded-xl text-stone-850 font-mono font-bold text-xs focus:outline-none focus:ring-1 focus:ring-[#0f4c2a] disabled:bg-stone-100 disabled:text-stone-500"
                                  />
                                </div>

                                <div className="md:col-span-2 sm:w-1/2">
                                  <label className="block text-[9px] uppercase font-black text-stone-500 mb-1">Mobile Transfer Phone Number (Oman - 8 digits max)</label>
                                  <input
                                    type="text"
                                    placeholder="xxxxxxxx"
                                    value={acc.mobilePhone || ''}
                                    disabled={isOptionLocked}
                                    maxLength={8}
                                    onChange={(e) => {
                                      const val = e.target.value.replace(/\D/g, '').slice(0, 8);
                                      setConfigPaymentAccounts(prev => prev.map((item, i) => i === index ? { ...item, mobilePhone: val } : item));
                                    }}
                                    className="w-full bg-white border border-stone-200 p-2.5 rounded-xl text-stone-850 font-mono font-bold text-xs focus:outline-none focus:ring-1 focus:ring-[#0f4c2a] disabled:bg-stone-100 disabled:text-stone-500"
                                  />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </GMKCard>

                  {/* SPRINT 2: Event Completion Checklist */}
                  {isCompletionChecklistVisible && (
                    <GMKCard className="p-6 bg-white border border-stone-200 space-y-4">
                      <div className="border-b border-stone-150 pb-2">
                        <h4 className="font-extrabold text-stone-900 text-xs uppercase tracking-wider font-heading flex items-center space-x-1.5">
                          <span>🏁</span>
                          <span>Event Completion Checklist</span>
                        </h4>
                        <p className="text-[9px] text-stone-500 font-bold mt-0.5">The Event Director must verify and satisfy all checklist criteria before marking the event as officially complete.</p>
                      </div>

                      <div className="space-y-3 font-sans">
                        {/* 1. Registration Closed */}
                        <div className="flex items-start space-x-2.5 p-2.5 rounded-xl bg-stone-50 border border-stone-150">
                          <input 
                            type="checkbox"
                            id="chk-reg-closed"
                            checked={chkRegClosed || isRegDateClosed}
                            disabled={isRegDateClosed}
                            onChange={(e) => setChkRegClosed(e.target.checked)}
                            className="mt-0.5 w-4 h-4 text-[#0f4c2a] border-stone-300 rounded focus:ring-[#0f4c2a]"
                          />
                          <div>
                            <span className="text-xs font-black text-stone-850 block">Registration Closed</span>
                            <span className="text-[9px] text-stone-500 font-bold block">
                              {isRegDateClosed ? "✓ Auto-verified: Registration closes timeline passed" : "Manual override or verified via closes date limit"}
                            </span>
                          </div>
                        </div>

                        {/* 2. Program Approvals Finalized */}
                        <div className="flex items-start space-x-2.5 p-2.5 rounded-xl bg-stone-50 border border-stone-150">
                          <input 
                            type="checkbox"
                            id="chk-program-finalized"
                            checked={chkProgramFinalized || isProgramsAllApproved}
                            disabled={isProgramsAllApproved}
                            onChange={(e) => setChkProgramFinalized(e.target.checked)}
                            className="mt-0.5 w-4 h-4 text-[#0f4c2a] border-stone-300 rounded focus:ring-[#0f4c2a]"
                          />
                          <div>
                            <span className="text-xs font-black text-stone-850 block">Program Approvals Finalized</span>
                            <span className="text-[9px] text-stone-500 font-bold block">
                              {isProgramsAllApproved ? "✓ Auto-verified: All submitted programs approved or rejected" : "Manual override or verified: all programs processed"}
                            </span>
                          </div>
                        </div>

                        {/* 3. Attendance Closed */}
                        <div className="flex items-start space-x-2.5 p-2.5 rounded-xl bg-stone-50 border border-stone-150">
                          <input 
                            type="checkbox"
                            id="chk-attendance-closed"
                            checked={chkAttendanceClosed}
                            disabled={configStatus === 'completed'}
                            onChange={(e) => setChkAttendanceClosed(e.target.checked)}
                            className="mt-0.5 w-4 h-4 text-[#0f4c2a] border-stone-300 rounded focus:ring-[#0f4c2a]"
                          />
                          <div>
                            <span className="text-xs font-black text-stone-850 block">Attendance Closed</span>
                            <span className="text-[9px] text-stone-500 font-bold block">Mark community register lists as static and closed.</span>
                          </div>
                        </div>

                        {/* 4. Finance Committee Submitted Accounts */}
                        <div className="flex items-start space-x-2.5 p-2.5 rounded-xl bg-stone-50 border border-stone-150">
                          <div className="mt-0.5 w-4 h-4 flex items-center justify-center">
                            {isFinanceSubmittedAuto ? (
                              <Check className="w-4 h-4 text-emerald-600 font-bold" />
                            ) : (
                              <Clock className="w-4 h-4 text-amber-500 font-bold animate-pulse" />
                            )}
                          </div>
                          <div className="flex-1">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                              <span className="text-xs font-black text-stone-850">Finance Committee Submitted Accounts</span>
                              <GMKBadge className={isFinanceSubmittedAuto ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-850"}>
                                {isFinanceSubmittedAuto ? "AUTOMATICALLY VERIFIED" : "PENDING REAL PAYMENTS"}
                              </GMKBadge>
                            </div>
                            <span className="text-[9px] text-stone-500 font-bold block mt-0.5">All event registration payments must be paid/waived to automatically clear this.</span>
                          </div>
                        </div>

                        {/* 5. Finance Approved */}
                        <div className="flex items-start space-x-2.5 p-2.5 rounded-xl bg-stone-50 border border-stone-150">
                          <div className="mt-0.5 w-4 h-4 flex items-center justify-center">
                            {isFinanceApprovedAuto ? (
                              <Check className="w-4 h-4 text-emerald-600 font-bold" />
                            ) : (
                              <Clock className="w-4 h-4 text-amber-500 font-bold animate-pulse" />
                            )}
                          </div>
                          <div className="flex-1">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                              <span className="text-xs font-black text-stone-850">Finance Approved</span>
                              <GMKBadge className={isFinanceApprovedAuto ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-850"}>
                                {isFinanceApprovedAuto ? "AUTOMATICALLY APPROVED" : "PENDING ACCOUNTS & PROGRAM FINALIZATION"}
                              </GMKBadge>
                            </div>
                            <span className="text-[9px] text-stone-500 font-bold block mt-0.5">Automatically cleared once finances are submitted and all programs are approved.</span>
                          </div>
                        </div>

                        {/* 6. President or Vice President Approved Financial Closure */}
                        <div className="flex items-start space-x-2.5 p-2.5 rounded-xl bg-stone-50 border border-stone-150">
                          <div className="mt-0.5 w-4 h-4 flex items-center justify-center">
                            {isPresApprovedAuto ? (
                              <Check className="w-4 h-4 text-emerald-600 font-bold" />
                            ) : (
                              <Clock className="w-4 h-4 text-amber-500 font-bold animate-pulse" />
                            )}
                          </div>
                          <div className="flex-1">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                              <span className="text-xs font-black text-stone-850">President or Vice President Approved Financial Closure</span>
                              <GMKBadge className={isPresApprovedAuto ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-850"}>
                                {isPresApprovedAuto ? "AUTOMATICALLY APPROVED" : "PENDING EXECUTIVE SIGN-OFF"}
                              </GMKBadge>
                            </div>
                            <span className="text-[9px] text-stone-500 font-bold block mt-0.5">Automatically cleared when event is published and finance is approved.</span>
                          </div>
                        </div>

                        {/* 7. Certificates Generated */}
                        <div className="flex items-start space-x-2.5 p-2.5 rounded-xl bg-stone-50 border border-stone-150">
                          <input 
                            type="checkbox"
                            id="chk-certificates-generated"
                            checked={chkCertificatesGenerated}
                            disabled={configStatus === 'completed'}
                            onChange={(e) => setChkCertificatesGenerated(e.target.checked)}
                            className="mt-0.5 w-4 h-4 text-[#0f4c2a] border-stone-300 rounded focus:ring-[#0f4c2a]"
                          />
                          <div>
                            <span className="text-xs font-black text-stone-850 block">Certificates Generated</span>
                            <span className="text-[9px] text-stone-500 font-bold block">Participation credentials distributed to committee volunteers and leads.</span>
                          </div>
                        </div>
                      </div>

                      {/* Summary Gating Block */}
                      <div className={`p-4 rounded-2xl border text-center ${
                        isCompletionReady 
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-800' 
                          : 'bg-amber-50/50 border-amber-150 text-amber-800'
                      }`}>
                        {isCompletionReady ? (
                          <p className="text-xs font-black">✓ ALL PRE-REQUISITES SATISFIED! You may now permanently complete this event.</p>
                        ) : (
                          <p className="text-[10px] font-extrabold">⚠️ GATED: All checklist items must be satisfied to unlock the "Complete Event" action button.</p>
                        )}
                      </div>
                    </GMKCard>
                  )}

                  {/* SECTION 4: Event Status & Publication Readiness Panel */}
                  <GMKCard className="p-6 bg-white border border-stone-200 space-y-4">
                    <div className="border-b border-stone-150 pb-2 flex items-center justify-between">
                      <h4 className="font-extrabold text-[#0f4c2a] text-xs uppercase tracking-wider font-heading">Section 4: Lifecycle & Verification Status</h4>
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase font-mono border ${
                        configStatus === 'published' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' :
                        configStatus === 'completed' ? 'bg-blue-50 text-blue-800 border-blue-200' :
                        'bg-amber-50 text-amber-850 border-amber-200'
                      }`}>
                        STATUS: {configStatus.toUpperCase()}
                      </span>
                    </div>

                    {configStatus === 'draft' && (() => {
                      const validationErrors = validateEventForPublish();
                      const isReadyToPublish = validationErrors.length === 0;

                      // Calculate 8 categories
                      const checklist = [
                        {
                          label: 'Event name, description, and venue configured',
                          valid: !!configEventName.trim() && !!configDescription.trim() && !!configVenue.trim()
                        },
                        {
                          label: 'Registration opens & closes schedule set',
                          valid: !!configRegStart && !!configRegEnd && new Date(configRegStart) < new Date(configRegEnd)
                        },
                        {
                          label: 'Event starts & ends schedule set',
                          valid: !!configEventStart && !!configEventEnd && new Date(configEventStart) < new Date(configEventEnd)
                        },
                        {
                          label: 'Registration closes before Event starts',
                          valid: !!configRegEnd && !!configEventStart && new Date(configRegEnd) <= new Date(configEventStart)
                        },
                        {
                          label: 'Event Poster uploaded',
                          valid: !!(activeEvent?.Poster || activeEvent?.posterUrl)
                        },
                        {
                          label: 'Event Thumbnail uploaded',
                          valid: !!activeEvent?.Thumbnail
                        },
                        {
                          label: 'Pricing structure configured',
                          valid: !configRegEnabled || (
                            configIndividualFee > 0 &&
                            configFreeChildAge >= 0 &&
                            (!configAllowExternal || configExternalRate >= 0)
                          )
                        },
                        {
                          label: 'All standard committees have active leads',
                          valid: (() => {
                            const standardCommittees = ["Attendance", "Finance", "Food", "Program", "Sponsorship", "Sourcing"];
                            const missing = standardCommittees.filter(scName => {
                              return !activeCommittees.some(ac => {
                                const nameLower = ac.name.toLowerCase();
                                if (scName === "Program" || scName === "Program") {
                                  return nameLower === "program committee" || nameLower === "programs" || nameLower === "program";
                                }
                                return nameLower === scName.toLowerCase();
                              });
                            });
                            if (missing.length > 0) return false;
                            
                            return activeCommittees.every(comm => {
                              const leads = (comm.members || []).filter(m => m.role === 'Lead');
                              return leads.length > 0;
                            });
                          })()
                        }
                      ];

                      const completedCount = checklist.filter(item => item.valid).length;
                      const totalCount = checklist.length;

                      return (
                        <div className="space-y-3 font-sans">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 bg-stone-50 border border-stone-200/80 rounded-xl gap-2">
                            <div>
                              <p className="text-xs font-black text-stone-850">Publication Readiness</p>
                              <div className="flex items-center space-x-1.5 mt-0.5 text-[11px] font-bold text-stone-600">
                                <span className={completedCount === totalCount ? "text-emerald-700" : "text-amber-700"}>
                                  {completedCount === totalCount ? "✓" : "●"} {completedCount} of {totalCount} requirements completed
                                </span>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => setShowReadinessDetails(!showReadinessDetails)}
                              className="text-[10px] font-black uppercase text-[#0f4c2a] hover:text-[#0c3e22] transition-colors flex items-center space-x-1 self-start sm:self-auto cursor-pointer"
                            >
                              <span>{showReadinessDetails ? "Hide Details" : "View Details"}</span>
                              <span>{showReadinessDetails ? "▲" : "▼"}</span>
                            </button>
                          </div>

                          {showReadinessDetails && (
                            <div className="p-4 bg-white border border-stone-150 rounded-xl space-y-2.5 animate-fadeIn">
                              <p className="text-[9px] uppercase font-black tracking-widest text-stone-400 border-b border-stone-100 pb-1.5">Verification Checklist:</p>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[10px] font-bold">
                                {checklist.map((item, idx) => (
                                  <div key={idx} className="flex items-start space-x-2">
                                    <span className={`text-xs select-none shrink-0 ${item.valid ? "text-emerald-600" : "text-stone-300"}`}>
                                      {item.valid ? "✓" : "○"}
                                    </span>
                                    <span className={item.valid ? "text-stone-700" : "text-stone-400 italic"}>
                                      {item.label}
                                    </span>
                                  </div>
                                ))}
                              </div>
                              {validationErrors.length > 0 && (
                                <div className="mt-2.5 pt-2 border-t border-stone-100 space-y-1.5">
                                  <p className="text-[9px] uppercase font-black tracking-widest text-amber-800">Remaining Issues to Address:</p>
                                  <ul className="space-y-1 text-[10px] font-semibold text-stone-600 list-disc list-inside">
                                    {validationErrors.map((err, idx) => (
                                      <li key={idx} className="capitalize-first">{err}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {configStatus === 'published' && (
                      <div className="p-4 bg-emerald-50/55 border border-emerald-150 rounded-2xl text-emerald-900 space-y-1 font-sans">
                        <p className="text-xs font-black flex items-center space-x-1">
                          <span>●</span>
                          <span>EVENT IS LIVE</span>
                        </p>
                        <p className="text-[10px] text-emerald-800 font-semibold leading-relaxed">
                          This event is officially published and visible to residents. You can continue updating general configuration details and saving via the <strong>Save Changes</strong> button. To revert the event back to draft status, use <strong>Unpublish Event</strong>.
                        </p>
                        {!isEventDatePassed && !explicitCompletion && (
                          <div className="pt-2 border-t border-emerald-200/45 mt-2">
                            <button
                              type="button"
                              onClick={() => setExplicitCompletion(true)}
                              className="px-3 py-1.5 bg-white border border-emerald-200 text-[#0f4c2a] rounded-lg text-[9px] font-black uppercase tracking-wider hover:bg-emerald-50 transition-all cursor-pointer"
                            >
                              Initiate Event Closure / Completion Early
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {configStatus === 'completed' && (
                      <div className="p-4 bg-stone-50 border border-stone-200 rounded-2xl text-stone-800 space-y-1 font-sans">
                        <p className="text-xs font-black flex items-center space-x-1">
                          <span>🏁</span>
                          <span>EVENT COMPLETED</span>
                        </p>
                        <p className="text-[10px] text-stone-500 font-semibold leading-relaxed">
                          This event has been marked as officially complete. All configuration fields and operational states are permanently locked and read-only.
                        </p>
                      </div>
                    )}
                  </GMKCard>

                  {/* Pricing Policy specification modal overlay */}
                  {showPricingPolicyModal && (
                    <div className="fixed inset-0 bg-stone-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                      <div className="bg-white border border-stone-200 rounded-3xl max-w-lg w-full shadow-2xl p-6 relative space-y-4 animate-scaleUp text-stone-850 font-sans max-h-[85vh] overflow-y-auto">
                        
                        {/* Floating/Nearby Close Header */}
                        <div className="sticky top-0 bg-white z-10 flex items-start justify-between gap-4 border-b border-stone-100 pb-3">
                          <div>
                            <span className="text-[10px] font-extrabold font-mono text-[#0f4c2a] block uppercase tracking-wider">Specifications & Matrix</span>
                            <h3 className="text-sm font-extrabold text-[#0f4c2a] font-heading mt-0.5">Registration Pricing Policy</h3>
                          </div>
                          <div className="flex items-center space-x-2 shrink-0">
                            <button
                              type="button"
                              onClick={handleDownloadPDF}
                              className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-[#0f4c2a] border border-emerald-100 rounded-xl transition-all cursor-pointer flex items-center space-x-1 text-[10px] font-extrabold uppercase tracking-wider"
                              title="Download PDF"
                            >
                              <span>📥</span>
                              <span>PDF</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setShowPricingPolicyModal(false)}
                              className="p-1.5 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-full transition-all cursor-pointer flex items-center justify-center"
                              title="Close Policy View"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        <p className="text-[10px] text-stone-500 font-bold leading-relaxed mt-1">
                          This matrix outlines the approved community entrance fee schedules and core calculations.
                        </p>

                        <div className="border border-stone-150 rounded-2xl overflow-hidden divide-y divide-stone-150 text-xs font-semibold">
                          <div className="p-3 bg-stone-50 flex justify-between font-bold">
                            <span className="text-stone-500">Scenario Household Composition</span>
                            <span className="text-[#0f4c2a] text-right">Effective Subtotal Fee</span>
                          </div>
                          <div className="p-3 flex justify-between">
                            <span className="text-stone-600 font-bold">1. Resident only</span>
                            <span className="font-mono font-black text-stone-950">OMR {configIndividualFee.toFixed(3)} <span className="text-[9px] text-stone-500">(Individual Rate)</span></span>
                          </div>
                          <div className="p-3 flex justify-between">
                            <span className="text-stone-600 font-bold">2. Resident + Spouse (Couple)</span>
                            <span className="font-mono font-black text-stone-950">OMR {configCoupleFee.toFixed(3)} <span className="text-[9px] text-stone-500">(Couple Rate)</span></span>
                          </div>
                          <div className="p-3 flex justify-between">
                            <span className="text-stone-600 font-bold">3. Resident + Child (Below {configFreeChildAge} years)</span>
                            <span className="font-mono font-black text-stone-950">OMR {configIndividualFee.toFixed(3)} <span className="text-[9px] text-stone-500">(Individual Rate - Child Free)</span></span>
                          </div>
                          <div className="p-3 flex justify-between">
                            <span className="text-stone-600 font-bold">4. Resident + Child (Above {configFreeChildAge} years)</span>
                            <span className="font-mono font-black text-stone-950">OMR {configCoupleFee.toFixed(3)} <span className="text-[9px] text-stone-500">(Couple Rate / Single Parent discount)</span></span>
                          </div>
                          <div className="p-3 flex justify-between">
                            <span className="text-stone-600 font-bold">5. Resident + Spouse + Children (Full Family)</span>
                            <span className="font-mono font-black text-stone-950">OMR {configFamilyFee.toFixed(3)} <span className="text-[9px] text-stone-500">(Family Rate Cap)</span></span>
                          </div>
                          <div className="p-3 flex justify-between">
                            <span className="text-stone-600 font-bold">6. Parents (Spouse Parents / Own Parents)</span>
                            <span className="font-mono font-black text-stone-950">OMR {configParentFee.toFixed(3)} <span className="text-[9px] text-stone-500">(Per Parent)</span></span>
                          </div>
                          <div className="p-3 flex justify-between">
                            <span className="text-stone-600 font-bold">7. Other Resident (Maid / Other Dependents)</span>
                            <span className="font-mono font-black text-stone-950">OMR {configOtherFee.toFixed(3)} <span className="text-[9px] text-stone-500">(Per Person)</span></span>
                          </div>
                          {configAllowExternal && (
                            <div className="p-3 bg-emerald-50/50 flex justify-between">
                              <span className="text-emerald-950 font-bold">8. Registered Guests (Non-Residents)</span>
                              <span className="font-mono font-black text-emerald-800">OMR {configExternalRate.toFixed(3)} <span className="text-[9px] text-emerald-600">(Per Guest)</span></span>
                            </div>
                          )}
                        </div>

                        <div className="p-3.5 bg-stone-50 border border-stone-200 rounded-2xl text-[9px] text-stone-500 leading-relaxed font-semibold space-y-1">
                          <span className="font-bold text-stone-700 block uppercase tracking-wider text-[8px]">Calculation Engine Implementation Notes</span>
                          <p>• Ages are calculated automatically as of the registration timestamp.</p>
                          <p>• The pricing engine executes inside an atomic database write, verifying exact fees prior to commit.</p>
                          <p>• Guest fees are added as a separate flat rate addition per guest registered under a household unit.</p>
                        </div>

                        {/* Bottom Close Button for easy dismissal */}
                        <div className="flex justify-end pt-2">
                          <button
                            type="button"
                            onClick={() => setShowPricingPolicyModal(false)}
                            className="w-full sm:w-auto px-5 py-2.5 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer text-center"
                          >
                            Close Policy View
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Persistent Save & Action Sticky Banner (Sprint 7) */}
                  <div className="sticky bottom-16 md:bottom-0 bg-white/95 backdrop-blur-md p-4 border border-stone-200 rounded-2xl shadow-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 z-10">
                    <div className="flex items-center space-x-2">
                      {hasUnsavedChanges() && (
                        <span className="px-3 py-1 bg-amber-100 text-amber-800 border border-amber-200 rounded-full text-[10px] font-black uppercase tracking-wider animate-pulse">
                          ⚠️ Unsaved Changes
                        </span>
                      )}
                      {!hasUnsavedChanges() && justSaved && (
                        <span className="px-3 py-1 bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-full text-[10px] font-black uppercase tracking-wider">
                          ✓ Changes Saved
                        </span>
                      )}
                    </div>

                    <div className="w-full grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-center sm:justify-end sm:w-auto font-heading">
                      {configStatus === 'draft' && (() => {
                        const validationErrors = validateEventForPublish();
                        const isReadyToPublish = validationErrors.length === 0;

                        if (!isReadyToPublish) {
                          return (
                            <button
                              type="submit"
                              disabled={!hasUnsavedChanges() || isSubmitting}
                              className={`col-span-2 sm:col-span-1 w-full px-4 py-2.5 h-10 border rounded-xl font-black uppercase tracking-wider text-[11px] transition-all flex items-center justify-center space-x-1.5 shadow-xs ${
                                !hasUnsavedChanges() || isSubmitting
                                  ? 'border-stone-200 bg-stone-50 text-stone-400 opacity-50 cursor-not-allowed'
                                  : 'border-stone-250 bg-white hover:bg-stone-50 text-stone-700 cursor-pointer'
                              }`}
                            >
                              <Check className="w-4 h-4 text-[#0f4c2a]" />
                              <span>Save Draft</span>
                            </button>
                          );
                        }

                        return (
                          <>
                            <button
                              type="submit"
                              disabled={!hasUnsavedChanges() || isSubmitting}
                              className={`col-span-1 w-full px-4 py-2.5 h-10 border rounded-xl font-black uppercase tracking-wider text-[11px] transition-all flex items-center justify-center space-x-1.5 shadow-xs ${
                                !hasUnsavedChanges() || isSubmitting
                                  ? 'border-stone-200 bg-stone-50 text-stone-400 opacity-50 cursor-not-allowed'
                                  : 'border-stone-250 bg-white hover:bg-stone-50 text-stone-700 cursor-pointer'
                              }`}
                            >
                              <Check className="w-4 h-4 text-[#0f4c2a]" />
                              <span>Save</span>
                            </button>

                            <button
                              type="button"
                              onClick={handlePublishEvent}
                              disabled={isSubmitting}
                              className="col-span-1 w-full px-4 py-2.5 h-10 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white rounded-xl font-black uppercase tracking-wider text-[11px] transition-all cursor-pointer flex items-center justify-center space-x-1.5 shadow-md"
                            >
                              <UserCheck className="w-4 h-4 text-[#d4af37]" />
                              <span>Publish Event</span>
                            </button>
                          </>
                        );
                      })()}

                      {configStatus === 'published' && (() => {
                        if (isCompletionChecklistVisible) {
                          return (
                            <>
                              <button
                                type="submit"
                                disabled={!hasUnsavedChanges() || isSubmitting}
                                className={`col-span-1 w-full px-4 py-2.5 h-10 border rounded-xl font-black uppercase tracking-wider text-[11px] transition-all flex items-center justify-center space-x-1.5 shadow-xs ${
                                  !hasUnsavedChanges() || isSubmitting
                                    ? 'border-stone-200 bg-stone-50 text-stone-400 opacity-50 cursor-not-allowed'
                                    : 'border-stone-250 bg-white hover:bg-stone-50 text-stone-700 cursor-pointer'
                                }`}
                              >
                                <Check className="w-4 h-4 text-[#0f4c2a]" />
                                <span>Save Changes</span>
                              </button>

                              <button
                                type="button"
                                onClick={handleCompleteEvent}
                                disabled={isSubmitting || !isCompletionReady}
                                className={`col-span-1 w-full px-4 py-2.5 h-10 rounded-xl font-black uppercase tracking-wider text-[11px] transition-all shadow-md flex items-center justify-center space-x-1.5 ${
                                  isCompletionReady 
                                    ? 'bg-stone-900 hover:bg-stone-850 text-white cursor-pointer' 
                                    : 'bg-stone-200 text-stone-400 cursor-not-allowed border border-stone-300'
                                }`}
                              >
                                <Check className="w-4 h-4 text-[#d4af37]" />
                                <span>Complete Event</span>
                              </button>
                            </>
                          );
                        }

                        return (
                          <>
                            <button
                              type="submit"
                              disabled={!hasUnsavedChanges() || isSubmitting}
                              className={`col-span-1 w-full px-4 py-2.5 h-10 border rounded-xl font-black uppercase tracking-wider text-[11px] transition-all flex items-center justify-center space-x-1.5 shadow-xs ${
                                !hasUnsavedChanges() || isSubmitting
                                  ? 'border-stone-200 bg-stone-50 text-stone-400 opacity-50 cursor-not-allowed'
                                  : 'border-stone-250 bg-white hover:bg-stone-50 text-stone-700 cursor-pointer'
                              }`}
                            >
                              <Check className="w-4 h-4 text-[#0f4c2a]" />
                              <span>Save Changes</span>
                            </button>

                            <button
                              type="button"
                              onClick={handleUnpublishEvent}
                              disabled={isSubmitting}
                              className="col-span-1 w-full px-4 py-2.5 h-10 border border-orange-200 hover:border-orange-500 hover:bg-orange-50/50 text-orange-750 rounded-xl font-black uppercase tracking-wider text-[11px] transition-all cursor-pointer flex items-center justify-center space-x-1.5 shadow-xs"
                            >
                              <X className="w-4 h-4 text-orange-600" />
                              <span>Unpublish Event</span>
                            </button>
                          </>
                        );
                      })()}

                      {configStatus === 'completed' && (
                        <>
                          <button
                            type="button"
                            onClick={() => setShowSummaryModal(true)}
                            className="col-span-1 w-full px-4 py-2.5 h-10 border border-stone-250 bg-white hover:bg-stone-50 text-stone-700 rounded-xl font-black uppercase tracking-wider text-[11px] transition-all cursor-pointer flex items-center justify-center space-x-1.5 shadow-xs"
                          >
                            <FileText className="w-4 h-4 text-[#0f4c2a]" />
                            <span>View Summary</span>
                          </button>

                          <button
                            type="button"
                            onClick={handleExportCSV}
                            className="col-span-1 w-full px-4 py-2.5 h-10 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white rounded-xl font-black uppercase tracking-wider text-[11px] transition-all cursor-pointer flex items-center justify-center space-x-1.5 shadow-md"
                          >
                            <Download className="w-4 h-4 text-[#d4af37]" />
                            <span>Export Report</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                </form>
              ) : (
                <div className="text-center py-12 text-stone-500 font-bold bg-white rounded-2xl border border-stone-150">
                  Select an active event from the top right or Events tab to configure details.
                </div>
              )}

              {/* ASSET MANAGER MODAL */}
              {showAssetManager && activeEvent && (
                <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                  <div className="bg-white border border-stone-200 rounded-3xl max-w-2xl w-full shadow-2xl overflow-hidden animate-scaleUp text-stone-850 font-sans">
                    {/* Header */}
                    <div className="p-6 border-b border-stone-150 flex items-center justify-between bg-stone-50/50">
                      <div>
                        <h3 className="text-base font-extrabold text-[#0f4c2a] font-heading">Event Asset Manager</h3>
                        <p className="text-stone-500 text-xs mt-0.5">Upload high-contrast promotional graphics directly to cloud storage.</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowAssetManager(false)}
                        className="text-stone-400 hover:text-stone-850 transition-colors cursor-pointer p-1 rounded-full hover:bg-stone-100"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    {/* Content */}
                    <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-6 max-h-[70vh] overflow-y-auto">
                      {/* Event Poster Column */}
                      <div className="space-y-3">
                        <h4 className="text-xs font-bold text-stone-700 uppercase tracking-wider">Event Poster (Vertical, 4:3)</h4>
                        <div className="border-2 border-dashed border-stone-200 rounded-2xl p-4 bg-stone-50/50 flex flex-col items-center justify-center min-h-[220px]">
                          {uploadingType === 'Poster' ? (
                            <div className="flex flex-col items-center justify-center space-y-2 py-4">
                              <Loader2 className="w-8 h-8 text-[#0f4c2a] animate-spin" />
                              <span className="text-xs font-bold text-stone-600">Uploading to Storage...</span>
                            </div>
                          ) : (activeEvent.Poster || activeEvent.posterUrl) ? (
                            <div className="flex flex-col items-center space-y-4 w-full">
                              <div className="relative w-40 h-52 border border-stone-200 rounded-xl overflow-hidden shadow-md">
                                <img 
                                  src={activeEvent.Poster || activeEvent.posterUrl} 
                                  alt="Event Poster" 
                                  referrerPolicy="no-referrer"
                                  className="w-full h-full object-cover"
                                />
                              </div>
                              <div className="flex flex-col gap-2 w-full">
                                <label className="w-full text-center py-2 bg-white border border-stone-250 rounded-xl text-xs font-bold text-stone-700 hover:bg-stone-100 transition-colors cursor-pointer shadow-xs">
                                  Replace Poster Image
                                  <input 
                                    type="file" 
                                    accept="image/*"
                                    onChange={(e) => handleAssetUpload(e, 'Poster')}
                                    className="hidden" 
                                  />
                                </label>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteAsset('Poster')}
                                  className="w-full py-2 bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100/80 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
                                >
                                  Remove Poster
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center space-y-3 py-6">
                              <Upload className="w-10 h-10 text-stone-300" />
                              <label className="px-4 py-2 bg-[#0f4c2a] text-white rounded-xl text-xs font-bold hover:bg-[#0c3e22] transition-colors cursor-pointer shadow-md">
                                Upload Poster File
                                <input 
                                  type="file" 
                                  accept="image/*"
                                  onChange={(e) => handleAssetUpload(e, 'Poster')}
                                  className="hidden" 
                                />
                              </label>
                              <span className="text-[10px] text-stone-400">Max size 2MB, formats: PNG/JPG</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Event Thumbnail Column */}
                      <div className="space-y-3">
                        <h4 className="text-xs font-bold text-stone-700 uppercase tracking-wider">Square Thumbnail (1:1 Aspect)</h4>
                        <div className="border-2 border-dashed border-stone-200 rounded-2xl p-4 bg-stone-50/50 flex flex-col items-center justify-center min-h-[220px]">
                          {uploadingType === 'Thumbnail' ? (
                            <div className="flex flex-col items-center justify-center space-y-2 py-4">
                              <Loader2 className="w-8 h-8 text-[#0f4c2a] animate-spin" />
                              <span className="text-xs font-bold text-stone-600">Uploading to Storage...</span>
                            </div>
                          ) : activeEvent.Thumbnail ? (
                            <div className="flex flex-col items-center space-y-4 w-full">
                              <div className="relative w-40 h-40 border border-stone-200 rounded-xl overflow-hidden shadow-md">
                                <img 
                                  src={activeEvent.Thumbnail} 
                                  alt="Event Thumbnail" 
                                  referrerPolicy="no-referrer"
                                  className="w-full h-full object-cover"
                                />
                              </div>
                              <div className="flex flex-col gap-2 w-full">
                                <label className="w-full text-center py-2 bg-white border border-stone-250 rounded-xl text-xs font-bold text-stone-700 hover:bg-stone-100 transition-colors cursor-pointer shadow-xs">
                                  Replace Thumbnail Image
                                  <input 
                                    type="file" 
                                    accept="image/*"
                                    onChange={(e) => handleAssetUpload(e, 'Thumbnail')}
                                    className="hidden" 
                                  />
                                </label>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteAsset('Thumbnail')}
                                  className="w-full py-2 bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100/80 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
                                >
                                  Remove Thumbnail
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center space-y-3 py-6">
                              <Upload className="w-10 h-10 text-stone-300" />
                              <label className="px-4 py-2 bg-[#0f4c2a] text-white rounded-xl text-xs font-bold hover:bg-[#0c3e22] transition-colors cursor-pointer shadow-md">
                                Upload Thumbnail File
                                <input 
                                  type="file" 
                                  accept="image/*"
                                  onChange={(e) => handleAssetUpload(e, 'Thumbnail')}
                                  className="hidden" 
                                />
                              </label>
                              <span className="text-[10px] text-stone-400">Max size 1MB, formats: PNG/JPG</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Footer */}
                    <div className="p-4 border-t border-stone-150 bg-stone-50 flex justify-end">
                      <button
                        type="button"
                        onClick={() => setShowAssetManager(false)}
                        className="px-5 py-2 rounded-xl bg-stone-900 hover:bg-stone-850 text-white text-xs font-bold transition-all cursor-pointer"
                      >
                        Done
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* FLOATING TOAST NOTIFICATION */}
              {toastMessage && (
                <div className="fixed bottom-6 right-6 z-50 bg-stone-900 text-white py-3 px-5 rounded-2xl shadow-2xl flex items-center space-x-3 text-xs font-bold font-heading border border-stone-800 animate-slideIn">
                  <span className="text-emerald-400 text-sm">✓</span>
                  <span>{toastMessage}</span>
                </div>
              )}
            </div>
          )}

          {activeTab === 'committees' && (
            <div className="space-y-6 animate-fadeIn">
              {/* HEADER ROW */}
              <div className="border-b border-stone-200 pb-3 flex flex-col md:flex-row md:items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-extrabold text-[#0f4c2a] uppercase tracking-wider font-heading">
                    {activeCommitteeToConfigure ? `Manage ${activeCommitteeToConfigure}` : "Event Committees"}
                  </h3>
                  <p className="text-stone-550 text-[10px] font-bold">
                    {activeCommitteeToConfigure 
                      ? `Coordinate staffing, rosters, and roles for the ${activeCommitteeToConfigure} team.`
                      : "Assign leaders and coordinate staffing for each committee."}
                  </p>
                </div>
                {activeCommitteeToConfigure && (
                  <button
                    onClick={() => setActiveCommitteeToConfigure(null)}
                    className="flex items-center space-x-1.5 px-3 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Back to Committees</span>
                  </button>
                )}
              </div>

              {selectedEventId && activeEvent ? (
                <>
                  {/* MAIN COMMITTEES GRID VIEW */}
                  {!activeCommitteeToConfigure && (
                    <div className="space-y-6">
                      {/* Active / Archived Sub-Tabs */}
                      <div className="flex items-center space-x-2 bg-stone-100/80 p-1 rounded-2xl border border-stone-200 w-fit">
                        <button
                          type="button"
                          onClick={() => setCommitteeTab('active')}
                          className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer flex items-center space-x-2 ${
                            committeeTab === 'active'
                              ? 'bg-[#0f4c2a] text-white shadow-xs'
                              : 'text-stone-600 hover:text-stone-900 hover:bg-stone-200/60'
                          }`}
                        >
                          <span>Active</span>
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-mono font-bold ${
                            committeeTab === 'active' ? 'bg-white/20 text-white' : 'bg-stone-200 text-stone-700'
                          }`}>
                            {activeCommittees.filter(c => c.status !== 'archived').length}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setCommitteeTab('archived')}
                          className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer flex items-center space-x-2 ${
                            committeeTab === 'archived'
                              ? 'bg-[#0f4c2a] text-white shadow-xs'
                              : 'text-stone-600 hover:text-stone-900 hover:bg-stone-200/60'
                          }`}
                        >
                          <span>Archived</span>
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-mono font-bold ${
                            committeeTab === 'archived' ? 'bg-white/20 text-white' : 'bg-stone-200 text-stone-700'
                          }`}>
                            {activeCommittees.filter(c => c.status === 'archived').length}
                          </span>
                        </button>
                      </div>

                      {/* Create Custom Committee Button Row (Active Tab only) */}
                      {committeeTab === 'active' && (
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-5 bg-white border border-stone-200 rounded-2xl shadow-xs">
                          <div>
                            <h4 className="font-extrabold text-[#0f4c2a] text-xs uppercase tracking-wider font-heading">Create Operational Committee</h4>
                            <p className="text-[10px] text-stone-500 font-bold">Standard committees are initialized automatically. Create custom operational committees as needed.</p>
                          </div>
                          <div>
                            {!showAddCommitteeInput ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setShowAddCommitteeInput(true);
                                  setNewCommitteeName('');
                                }}
                                className="px-4 py-2 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white text-xs font-bold rounded-xl flex items-center space-x-1.5 transition-colors cursor-pointer shrink-0 shadow-sm"
                              >
                                <Plus className="w-4 h-4 text-[#d4af37]" />
                                <span>Add Committee</span>
                              </button>
                            ) : (
                              <div className="flex items-center gap-2 bg-stone-50 p-2.5 rounded-xl border border-stone-200 animate-fadeIn">
                                <input 
                                  type="text"
                                  autoFocus
                                  value={newCommitteeName}
                                  onChange={(e) => setNewCommitteeName(e.target.value)}
                                  placeholder="e.g. Stage & Decor, Sponsorship"
                                  className="font-bold bg-white border border-stone-200 p-2 rounded-xl text-stone-850 focus:outline-none focus:ring-1 focus:ring-[#0f4c2a] text-xs"
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      handleCreateCustomCommittee();
                                    } else if (e.key === 'Escape') {
                                      e.preventDefault();
                                      setNewCommitteeName('');
                                      setShowAddCommitteeInput(false);
                                    }
                                  }}
                                />
                                <button
                                  type="button"
                                  onClick={handleCreateCustomCommittee}
                                  disabled={isSubmitting || !newCommitteeName.trim()}
                                  className="px-3 py-2 bg-[#0f4c2a] hover:bg-[#0c3e22] disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer shrink-0"
                                >
                                  Add
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setNewCommitteeName('');
                                    setShowAddCommitteeInput(false);
                                  }}
                                  className="px-3 py-2 bg-stone-200 hover:bg-stone-300 text-stone-700 text-xs font-bold rounded-xl transition-colors cursor-pointer"
                                >
                                  Cancel
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Filtered Committees List */}
                      {(() => {
                        const filteredCommittees = activeCommittees.filter(c => 
                          committeeTab === 'active' ? c.status !== 'archived' : c.status === 'archived'
                        );

                        if (filteredCommittees.length === 0) {
                          return (
                            <div className="text-center py-12 border border-dashed border-stone-250 rounded-2xl bg-white space-y-2">
                              <Archive className="w-8 h-8 mx-auto text-stone-350" />
                              <h4 className="text-stone-700 font-black text-xs uppercase tracking-wider">
                                {committeeTab === 'active' ? 'No Active Committees' : 'No Archived Committees'}
                              </h4>
                              <p className="text-stone-500 text-[10px] max-w-xs mx-auto font-bold">
                                {committeeTab === 'active' 
                                  ? 'There are currently no active committees for this event.' 
                                  : 'Committees that have been archived will appear here. You can restore them to active status anytime.'}
                              </p>
                            </div>
                          );
                        }

                        return (
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {filteredCommittees.map((comm) => {
                              const commName = comm.name;
                              const commLeads = (comm.members || []).filter(m => m.role === 'Lead');
                              const leadCount = commLeads.length;

                              return (
                                <div key={comm.id} className="bg-white border border-stone-200 rounded-2xl p-6 shadow-sm flex flex-col justify-between space-y-4 transition-all hover:shadow-md">
                                  <div className="space-y-4">
                                    {/* Header */}
                                    <div className="flex items-start justify-between">
                                      <div className="flex items-center justify-between w-full">
                                        <div className="flex items-center space-x-3">
                                          <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-[#0f4c2a]">
                                            <Users className="w-5 h-5" />
                                          </div>
                                          <div>
                                            <div className="flex items-center space-x-2">
                                              <h4 className="text-stone-850 font-black text-sm font-heading">{commName}</h4>
                                              {comm.status === 'archived' && (
                                                <span className="px-1.5 py-0.5 bg-stone-100 text-stone-500 border border-stone-200 rounded-md text-[8px] font-black uppercase">
                                                  Archived
                                                </span>
                                              )}
                                            </div>
                                            <div className="flex items-center space-x-1.5 mt-0.5">
                                              <span className={`px-1.5 py-0.5 rounded-md text-[8px] font-black uppercase font-mono border ${
                                                leadCount === 2 
                                                  ? 'bg-amber-50 text-amber-800 border-amber-200' 
                                                  : leadCount === 1 
                                                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
                                                  : 'bg-stone-50 text-stone-400 border-stone-200'
                                              }`}>
                                                Leads Assigned: {leadCount}
                                              </span>
                                            </div>
                                          </div>
                                        </div>

                                        {/* Actions: Archive / Restore / Delete */}
                                        <div className="flex items-center space-x-1">
                                          {committeeTab === 'active' ? (
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleArchiveCommittee(comm);
                                              }}
                                              disabled={isSubmitting}
                                              className="p-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-lg border border-amber-200 transition-all cursor-pointer disabled:opacity-50"
                                              title="Archive Committee"
                                            >
                                              <Archive className="w-3.5 h-3.5" />
                                            </button>
                                          ) : (
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleRestoreCommittee(comm);
                                              }}
                                              disabled={isSubmitting}
                                              className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-[#0f4c2a] border border-emerald-200 rounded-lg text-[10px] font-extrabold uppercase tracking-wider transition-all cursor-pointer flex items-center space-x-1"
                                              title="Restore to Active"
                                            >
                                              <RotateCcw className="w-3 h-3" />
                                              <span>Restore</span>
                                            </button>
                                          )}

                                          {/* Delete for custom committees */}
                                          {!["Attendance", "Finance", "Food", "Program", "Sponsorship", "Sourcing"].includes(commName) && (
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleDeleteCommittee(comm);
                                              }}
                                              disabled={isSubmitting}
                                              className="p-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg border border-red-100 transition-all cursor-pointer disabled:opacity-50"
                                              title="Delete Custom Committee"
                                            >
                                              <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    </div>

                                    {/* Description */}
                                    <p className="text-stone-650 text-[11px] font-bold leading-relaxed">
                                      {commName === 'Attendance' ? 'Manages gate check-ins, registration lists, QR verification, and check-in logs.' :
                                       commName === 'Food' ? 'Supervises meal counts, food preparation schedules, coupon allocation, and distribution.' :
                                       commName === 'Finance' ? 'Formulates budgets, tracks program expenses, sponsors, and handles financial closures.' :
                                       commName === 'Sourcing' ? 'Oversees auditorium styling, backdrop designs, stage scheduling, and lighting setups.' :
                                       commName === 'Sponsorship' ? 'Connects with local vendors, handles branding, advertisements, and promotional tie-ups.' :
                                       commName === 'Program' ? 'Coordinates stage scheduling, program categories, participant submissions, and coordinator logs.' :
                                       'Operational Committee responsible for coordinating specialized event tasks and volunteer activities.'}
                                    </p>

                                    {/* Current Assigned Leads Section (Card) */}
                                    <div className="space-y-2 pt-3 border-t border-stone-100">
                                      <h5 className="text-[10px] uppercase font-black text-[#0f4c2a] tracking-wider">Assigned Leads</h5>
                                      {commLeads.length === 0 ? (
                                        <p className="text-[10px] text-stone-400 italic font-bold">No leads assigned yet. Select Manage Committee to appoint.</p>
                                      ) : (
                                        <div className="flex flex-wrap gap-1.5">
                                          {commLeads.map(lead => (
                                            <span key={lead.residentId} className="inline-flex items-center px-2 py-1 bg-emerald-50/60 border border-emerald-100 text-stone-800 rounded-lg text-[10px] font-bold">
                                              {lead.fullName}
                                            </span>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  {/* Action Footer */}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setActiveCommitteeToConfigure(commName);
                                      setWorkspaceSearchQuery('');
                                      setProgCoordSearchQuery('');
                                      setProgVolSearchQuery('');
                                      setActiveProgForManagement(null);
                                    }}
                                    className="w-full mt-2 py-2.5 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white text-xs font-black uppercase tracking-wider rounded-xl border border-[#0f4c2a] flex items-center justify-center space-x-1 transition-all cursor-pointer shadow-sm active:scale-[0.99]"
                                  >
                                    <span>Manage Committee</span>
                                    <ChevronRight className="w-4 h-4" />
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {/* ACTIVE CONFIGURATION WORKSPACE */}
                  {activeCommitteeToConfigure && (() => {
                    const currentComm = activeCommittees.find(c => c.name === activeCommitteeToConfigure);
                    if (!currentComm) {
                      return (
                        <div className="p-6 text-center text-stone-500 font-bold bg-white rounded-2xl border border-stone-200">
                          Committee Workspace not found.
                        </div>
                      );
                    }

                    const commLeads = (currentComm.members || []).filter(m => m.role === 'Lead');
                    const leadCount = commLeads.length;

                    const isProgramComm = activeCommitteeToConfigure.toLowerCase() === 'program committee' || 
                                          activeCommitteeToConfigure.toLowerCase() === 'programs' || 
                                          activeCommitteeToConfigure.toLowerCase() === 'program';

                    // 1. UNIQUE PROGRAM COMMITTEE WORKSPACE
                    if (isProgramComm) {
                      const matchedCoordResidents = searchProgramCoordinatorCandidates(progCoordinatorSearch);

                      return (
                        <div className="space-y-8 animate-fadeIn">
                          {/* STAGE A: PROGRAM LEADS MANAGEMENT (MAX 2) */}
                          <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-sm space-y-4">
                            <div className="flex items-center justify-between border-b border-stone-150 pb-3">
                              <div>
                                <h4 className="font-extrabold text-stone-900 text-sm uppercase tracking-wider font-heading">Program Leads</h4>
                                <p className="text-[10px] text-stone-500 font-bold">Appoint governance leads to oversee program categories and operational tasks.</p>
                              </div>
                              <span className="px-2 py-1 bg-[#0f4c2a]/5 border border-[#0f4c2a]/10 text-[#0f4c2a] font-mono text-xs font-black rounded-lg">
                                {leadCount} Leads
                              </span>
                            </div>

                            {commLeads.length === 0 ? (
                              <p className="text-xs text-stone-500 italic p-4 bg-stone-50 border border-dashed border-stone-200 rounded-xl text-center font-bold">
                                No Program Leads assigned. Search active residents below to appoint.
                              </p>
                            ) : (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {commLeads.map(lead => (
                                  <div key={lead.residentId} className="flex items-center justify-between p-3.5 bg-emerald-50/30 border border-emerald-100 rounded-xl">
                                    <div>
                                      <span className="text-xs font-black text-stone-850 block">{lead.fullName}</span>
                                      <span className="text-[9px] text-stone-500 font-bold block mt-0.5">{lead.email}</span>
                                    </div>
                                    <button
                                      type="button"
                                      disabled={isSubmitting}
                                      onClick={() => handleRemoveCommitteeLead(lead.residentId, lead.email, activeCommitteeToConfigure)}
                                      className="p-1.5 hover:bg-red-50 text-stone-400 hover:text-red-600 rounded-lg transition-colors cursor-pointer"
                                      title="Remove Lead"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Lead Assignment Search Field */}
                            {true ? (
                              <div className="space-y-3 pt-2">
                                <div className="relative">
                                  <Search className="absolute left-3.5 top-3 w-4 h-4 text-[#0f4c2a]" />
                                  <input
                                    type="text"
                                    value={workspaceSearchQuery}
                                    onChange={(e) => setWorkspaceSearchQuery(e.target.value)}
                                    placeholder="Search members by name or flat number to assign..."
                                    className="w-full pl-10 pr-4 py-2.5 font-bold bg-stone-50 hover:bg-stone-100 focus:bg-white border border-stone-200 hover:border-stone-450 focus:border-[#0f4c2a] rounded-xl text-xs text-stone-900 focus:outline-none transition-all placeholder-stone-400"
                                  />
                                </div>

                                {workspaceSearchQuery && (
                                  <div className="border border-stone-200 rounded-xl bg-white shadow-md max-h-56 overflow-y-auto divide-y divide-stone-100 z-10 relative">
                                    {(() => {
                                      const candidateMatches = searchProgramCommitteeCandidates(workspaceSearchQuery);
                                      if (candidateMatches.length === 0) {
                                        return (
                                          <div className="p-4 text-stone-450 italic text-xs text-center font-bold">
                                            No matching active residents or family members found.
                                          </div>
                                        );
                                      }
                                      return candidateMatches.map(cand => (
                                        <div key={cand.id} className="p-3 hover:bg-stone-50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs transition-colors">
                                          <div className="min-w-0 flex-1">
                                            <div className="flex items-center space-x-2">
                                              <span className="font-extrabold text-stone-900 truncate">{cand.fullName}</span>
                                              {cand.isFamilyMember && (
                                                <span className="px-1.5 py-0.5 bg-amber-50 text-amber-800 border border-amber-200 text-[9px] font-black uppercase rounded-md shrink-0">
                                                  {cand.relationship || 'Spouse'}
                                                </span>
                                              )}
                                            </div>
                                            <span className="text-[10px] text-stone-500 font-bold block mt-0.5 truncate">Unit: {cand.displayUnitNumber} • {cand.email} • {cand.phone || 'No Phone'}</span>
                                          </div>
                                          <button
                                            type="button"
                                            disabled={isSubmitting}
                                            onClick={() => {
                                              handleSelectProgramCommitteeLead(cand);
                                              setWorkspaceSearchQuery('');
                                            }}
                                            className="w-full sm:w-auto px-3 py-1.5 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white font-black text-[10px] uppercase tracking-wider rounded-lg transition-all cursor-pointer shadow-xs active:scale-95 flex items-center justify-center space-x-1 mt-1 sm:mt-0"
                                          >
                                            <UserCheck className="w-3.5 h-3.5 text-[#d4af37]" />
                                            <span>Assign Lead</span>
                                          </button>
                                        </div>
                                      ));
                                    })()}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="text-center py-4 text-stone-500 font-bold font-sans text-xs border-t border-stone-150 mt-2">
                                <p>Maximum committee leads assigned.</p>
                                <p className="text-[10px] text-stone-400 mt-0.5">Remove a lead to assign another.</p>
                              </div>
                            )}
                          </div>

                          {/* STAGE B: CREATE NEW EVENT PROGRAM DIRECTLY */}
                          <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-sm space-y-4">
                            <h4 className="font-extrabold text-stone-900 text-sm uppercase tracking-wider font-heading border-b border-stone-150 pb-2">
                              Create Direct Program
                            </h4>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="space-y-1.5">
                                <label className="text-[10px] uppercase font-black text-[#0f4c2a] tracking-wider block">Program Title</label>
                                <input
                                  type="text"
                                  value={progTitle}
                                  onChange={(e) => setProgTitle(e.target.value)}
                                  placeholder="e.g. classical dance performance"
                                  className="w-full px-3 py-2 font-bold bg-stone-50 border border-stone-200 rounded-xl text-stone-850 text-xs focus:outline-none focus:ring-1 focus:ring-[#0f4c2a]"
                                />
                              </div>

                              <div className="space-y-1.5">
                                <label className="text-[10px] uppercase font-black text-[#0f4c2a] tracking-wider block">Type</label>
                                <select
                                  value={progType}
                                  onChange={(e) => setProgType(e.target.value)}
                                  className="w-full px-3 py-2 font-bold bg-stone-50 border border-stone-200 rounded-xl text-stone-850 text-xs focus:outline-none focus:ring-1 focus:ring-[#0f4c2a]"
                                >
                                  <option value="Select">Select</option>
                                  <option value="Adults">ADULTS</option>
                                  <option value="Kids">KIDS</option>
                                  <option value="Mix">MIXED</option>
                                </select>
                              </div>
                            </div>

                            <div className="space-y-1.5">
                              <label className="text-[10px] uppercase font-black text-[#0f4c2a] tracking-wider block">Program Description</label>
                              <textarea
                                value={progDescription}
                                onChange={(e) => setProgDescription(e.target.value)}
                                placeholder="Details about duration, tracks, micro-components etc."
                                className="w-full px-3 py-2 font-bold bg-stone-50 border border-stone-200 rounded-xl text-stone-850 text-xs focus:outline-none focus:ring-1 focus:ring-[#0f4c2a] h-16"
                              />
                            </div>

                            {/* COORDINATOR SELECTION */}
                            <div className="space-y-2 pt-1">
                              <label className="text-[10px] uppercase font-black text-[#0f4c2a] tracking-wider block">Assign Program Coordinator</label>
                              {progCoordinator ? (
                                <div className="p-3 bg-emerald-50 border border-emerald-150 rounded-xl flex items-center justify-between text-xs">
                                  <div>
                                    <strong className="text-stone-900">{progCoordinator.fullName}</strong>
                                    <span className="text-stone-500 block text-[10px] mt-0.5">Unit {progCoordinator.displayUnitNumber} • {progCoordinator.email}</span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => setProgCoordinator(null)}
                                    className="text-stone-400 hover:text-red-600 font-extrabold uppercase text-[9px] tracking-wider"
                                  >
                                    Change
                                  </button>
                                </div>
                              ) : (
                                <div className="space-y-2">
                                  <div className="relative">
                                    <Search className="absolute left-3.5 top-2.5 w-4 h-4 text-stone-400" />
                                    <input
                                      type="text"
                                      value={progCoordinatorSearch}
                                      onChange={(e) => setProgCoordinatorSearch(e.target.value)}
                                      placeholder="Search members by name or flat number to assign..."
                                      className="w-full pl-9 pr-4 py-2 font-bold bg-stone-50 border border-stone-200 rounded-xl text-xs text-stone-850 focus:outline-none focus:ring-1 focus:ring-[#0f4c2a]"
                                    />
                                  </div>

                                  {progCoordinatorSearch && (
                                    <div className="border border-stone-200 rounded-xl bg-white shadow-md max-h-44 overflow-y-auto divide-y divide-stone-100 z-10 relative">
                                      {matchedCoordResidents.length === 0 ? (
                                        <div className="p-3 text-stone-450 italic text-[10px] text-center font-bold">
                                          No matching active residents found.
                                        </div>
                                      ) : (
                                        matchedCoordResidents.slice(0, 5).map(res => (
                                          <div key={res.id} className="p-2 flex items-center justify-between text-[11px] hover:bg-stone-50">
                                            <div>
                                              <span className="font-extrabold text-stone-900 block">{res.fullName}</span>
                                              <span className="text-[9px] text-stone-500 block">Unit: {res.displayUnitNumber} • {res.email}</span>
                                            </div>
                                            <button
                                              type="button"
                                              onClick={() => setProgCoordinator(res)}
                                              className="px-2.5 py-1 bg-[#0f4c2a]/10 text-[#0f4c2a] font-extrabold text-[9px] uppercase tracking-wider rounded-lg hover:bg-[#0f4c2a] hover:text-white transition-all cursor-pointer"
                                            >
                                              Select
                                            </button>
                                          </div>
                                        ))
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>

                            <button
                              type="button"
                              onClick={handleCreateProgramDirectly}
                              disabled={isSubmitting || !progTitle.trim() || progType === 'Select'}
                              className="w-full py-2.5 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white font-extrabold text-xs uppercase tracking-wider rounded-xl transition-all cursor-pointer flex items-center justify-center space-x-1.5 shadow-md disabled:bg-stone-200 disabled:text-stone-400 disabled:cursor-not-allowed"
                            >
                              <Plus className="w-4 h-4 text-[#d4af37]" />
                              <span>Create Program</span>
                            </button>
                          </div>

                          {/* STAGE C: DETAILED PROGRAMS REGISTRY */}
                          <div className="space-y-4">
                            <h4 className="font-extrabold text-[#0f4c2a] text-xs uppercase tracking-wider font-heading block border-b border-stone-200 pb-2">
                              Programs Registry (Coordinators, Volunteers & Expenses)
                            </h4>

                            {activePrograms.length === 0 ? (
                              <div className="text-center py-12 bg-white border border-stone-150 rounded-2xl">
                                <p className="text-xs text-stone-500 italic font-bold">No programs registered. Create a program above to begin.</p>
                              </div>
                            ) : (
                              <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                                {/* Left side: compact list of program cards */}
                                <div className="lg:col-span-2 space-y-3">
                                  {activePrograms.map(prog => {
                                    const progId = prog.id;
                                    const isSelected = activeProgForManagement === progId;
                                    return (
                                      <div 
                                        key={progId} 
                                        onClick={() => {
                                          setActiveProgForManagement(isSelected ? null : progId);
                                          setProgCoordSearchQuery('');
                                          setProgVolSearchQuery('');
                                        }}
                                        className={`p-3 border rounded-2xl cursor-pointer transition-all flex items-center justify-between gap-3 ${
                                          isSelected 
                                            ? 'bg-emerald-50/40 border-[#0f4c2a] shadow-xs' 
                                            : 'bg-white border-stone-200 hover:border-stone-350 shadow-xs'
                                        }`}
                                      >
                                        <div className="min-w-0 flex-1">
                                          <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
                                            <span className="text-[8px] font-black tracking-wider text-[#d4af37] uppercase bg-[#0f4c2a]/5 border border-[#0f4c2a]/15 px-1.5 py-0.5 rounded font-mono">
                                              {prog.programType || prog.category || 'Adults'}
                                            </span>
                                            <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider border ${
                                              prog.status === 'approved' ? 'bg-emerald-50 text-emerald-800 border-emerald-100' :
                                              prog.status === 'rejected' ? 'bg-rose-50 text-rose-800 border-rose-100' :
                                              'bg-amber-50 text-amber-800 border-amber-100'
                                            }`}>
                                              {prog.status}
                                            </span>
                                          </div>
                                          <h5 className="text-stone-850 font-black text-xs font-heading mt-1 capitalize truncate">{prog.title}</h5>
                                          <p className="text-stone-500 text-[10px] truncate mt-0.5 font-semibold">{prog.description || 'No description.'}</p>
                                        </div>
                                        <ChevronRight className={`w-4 h-4 shrink-0 transition-transform ${isSelected ? 'text-[#0f4c2a] translate-x-1' : 'text-stone-300'}`} />
                                      </div>
                                    );
                                  })}
                                </div>

                                {/* Right side: active program work desk */}
                                <div className="lg:col-span-3">
                                  {activeProgForManagement ? (() => {
                                    const prog = activePrograms.find(p => p.id === activeProgForManagement);
                                    if (!prog) return null;
                                    const expensesList = prog.expenses || [];
                                    const expensesTotal = expensesList.reduce((sum, e) => sum + e.amount, 0);

                                    const progTypeNormalized = (prog.programType || prog.category || 'ADULTS').toUpperCase();

                                    const matchedCoordCandidates = searchProgramCoordinatorCandidates(progCoordSearchQuery).filter(c => {
                                      return !(prog.coordinators || []).some(existing => existing.residentId === c.residentId || existing.fullName === c.fullName);
                                    });

                                    const matchedVolCandidates = searchProgramCoordinatorCandidates(progVolSearchQuery).filter(c => {
                                      return !(prog.volunteers || []).some(existing => existing.residentId === c.residentId);
                                    });

                                    const matchedParticipantCandidates = searchProgramParticipantCandidates(
                                      progParticipantSearchQuery,
                                      progTypeNormalized,
                                      participantAgeFilter,
                                      participantGenderFilter
                                    ).filter(candidate => {
                                      return !(prog.participants || []).some(p => p.residentId === candidate.residentId || p.fullName.toLowerCase() === candidate.fullName.toLowerCase());
                                    });

                                    return (
                                      <div className="bg-white border border-stone-200 rounded-3xl p-4 shadow-sm space-y-4 animate-fadeIn">
                                        <div className="flex items-start justify-between border-b border-stone-150 pb-2">
                                          <div>
                                            <div className="flex items-center space-x-2">
                                              <span className="text-[8px] font-black tracking-widest text-[#d4af37] uppercase bg-[#0f4c2a]/5 border border-[#0f4c2a]/15 px-2 py-0.5 rounded-lg font-mono">
                                                {prog.programType || prog.category || 'Adults'}
                                              </span>
                                              <span className="px-1.5 py-0.5 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded text-[8px] font-black uppercase tracking-wider">
                                                Active Workspace
                                              </span>
                                            </div>
                                            <h5 className="text-stone-850 font-black text-sm font-heading mt-1 capitalize">{prog.title}</h5>
                                            <p className="text-[9px] font-mono text-stone-400 mt-0.5">ID: {prog.id}</p>
                                          </div>
                                          <div className="flex items-center space-x-2 shrink-0">
                                            <button
                                              type="button"
                                              onClick={() => {
                                                if (editingProgramId === prog.id) {
                                                  setEditingProgramId(null);
                                                } else {
                                                  setEditingProgramId(prog.id);
                                                  setEditProgTitle(prog.title);
                                                  setEditProgCategory(prog.programType || prog.category || 'ADULTS');
                                                  setEditProgDescription(prog.description || '');
                                                }
                                              }}
                                              className="px-2.5 py-1 bg-stone-100 hover:bg-stone-200 border border-stone-250 text-stone-700 rounded-lg text-[9px] font-black uppercase tracking-wider flex items-center space-x-1 transition-all cursor-pointer"
                                            >
                                              <Edit3 className="w-3 h-3 text-stone-600" />
                                              <span>{editingProgramId === prog.id ? 'Cancel' : 'Edit'}</span>
                                            </button>

                                            <button
                                              type="button"
                                              onClick={() => handleDeleteProgram(prog.id, prog.title)}
                                              disabled={isSubmitting}
                                              className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 border border-rose-200 hover:border-rose-300 text-rose-700 rounded-lg text-[9px] font-black uppercase tracking-wider flex items-center space-x-1 transition-all cursor-pointer"
                                            >
                                              <Trash2 className="w-3 h-3 text-rose-600" />
                                              <span>Delete Program/Event</span>
                                            </button>

                                            <button
                                              type="button"
                                              onClick={() => setActiveProgForManagement(null)}
                                              className="text-[10px] text-stone-400 hover:text-stone-800 font-extrabold uppercase tracking-wider ml-1"
                                            >
                                              Close
                                            </button>
                                          </div>
                                        </div>

                                        {/* Inline Edit Form */}
                                        {editingProgramId === prog.id && (
                                          <div className="bg-stone-50 border border-stone-200 rounded-2xl p-3 space-y-2.5 animate-fadeIn">
                                            <h6 className="text-[10px] uppercase font-black text-[#0f4c2a] tracking-wider">Edit Program Details</h6>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                              <div>
                                                <label className="text-[9px] font-black text-stone-600 block uppercase">Title</label>
                                                <input 
                                                  type="text"
                                                  value={editProgTitle}
                                                  onChange={(e) => setEditProgTitle(e.target.value)}
                                                  className="w-full px-2 py-1 bg-white border border-stone-250 rounded-lg text-[10px] font-bold text-stone-900 focus:outline-none focus:border-[#0f4c2a]"
                                                />
                                              </div>
                                              <div>
                                                <label className="text-[9px] font-black text-stone-600 block uppercase">Category / Audience</label>
                                                <select
                                                  value={editProgCategory}
                                                  onChange={(e) => setEditProgCategory(e.target.value)}
                                                  className="w-full px-2 py-1 bg-white border border-stone-250 rounded-lg text-[10px] font-bold text-stone-900 focus:outline-none focus:border-[#0f4c2a]"
                                                >
                                                  <option value="ADULTS">ADULTS</option>
                                                  <option value="KIDS">KIDS</option>
                                                  <option value="MIXED">MIXED</option>
                                                </select>
                                              </div>
                                            </div>
                                            <div>
                                              <label className="text-[9px] font-black text-stone-600 block uppercase">Description</label>
                                              <textarea
                                                value={editProgDescription}
                                                onChange={(e) => setEditProgDescription(e.target.value)}
                                                rows={2}
                                                className="w-full px-2 py-1 bg-white border border-stone-250 rounded-lg text-[10px] font-bold text-stone-900 focus:outline-none focus:border-[#0f4c2a]"
                                              />
                                            </div>
                                            <div className="flex justify-end space-x-2 pt-1">
                                              <button
                                                type="button"
                                                onClick={() => setEditingProgramId(null)}
                                                className="px-3 py-1 bg-stone-200 hover:bg-stone-300 rounded-lg text-[9px] font-bold uppercase"
                                              >
                                                Cancel
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => handleUpdateProgramDetails(prog.id)}
                                                disabled={isSubmitting}
                                                className="px-3 py-1 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white rounded-lg text-[9px] font-black uppercase tracking-wider"
                                              >
                                                Save Changes
                                              </button>
                                            </div>
                                          </div>
                                        )}

                                        {/* Audience Filter Bar */}
                                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-[#0f4c2a]/5 border border-[#0f4c2a]/10 p-2.5 rounded-2xl">
                                          <div className="flex items-center space-x-1.5">
                                            <span className="text-[9px] uppercase font-mono font-black text-[#0f4c2a]">Resident Search Filter:</span>
                                            <span className="text-[9px] font-bold text-stone-500">Filters assignment lists below</span>
                                          </div>
                                          <div className="flex items-center bg-stone-100 rounded-lg p-0.5 border border-stone-200">
                                            {(['Mixed', 'Children', 'Adults'] as const).map((filterOpt) => (
                                              <button
                                                key={filterOpt}
                                                type="button"
                                                onClick={() => setSearchAudienceFilter(filterOpt)}
                                                className={`px-2 py-1 text-[9px] font-black uppercase rounded-md transition-all cursor-pointer ${
                                                  searchAudienceFilter === filterOpt
                                                    ? 'bg-[#0f4c2a] text-white shadow-xs'
                                                    : 'text-stone-500 hover:text-stone-850'
                                                }`}
                                              >
                                                {filterOpt}
                                              </button>
                                            ))}
                                          </div>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                                          {/* COLUMN 1: COORDINATORS */}
                                          <div className="bg-stone-50 border border-stone-200 p-3 rounded-2xl space-y-3">
                                            <h6 className="text-[10px] uppercase font-black text-[#0f4c2a] tracking-wider border-b border-stone-150 pb-1">
                                              Coordinators
                                            </h6>
                                            <div className="space-y-1.5 max-h-36 overflow-y-auto">
                                              {(prog.coordinators || []).length === 0 ? (
                                                <p className="text-[10px] text-stone-500 italic font-bold">None assigned.</p>
                                              ) : (
                                                (prog.coordinators || []).map(coord => {
                                                  const parentRes = residents.find(r => r.gmkId === coord.residentId);
                                                  const coordPhone = coord.phone || (parentRes ? (parentRes.phone || parentRes.whatsAppNumber) : 'N/A');
                                                  return (
                                                    <div key={coord.residentId + coord.fullName} className="flex items-center justify-between p-1.5 bg-white border border-stone-150 rounded-xl">
                                                      <div className="truncate min-w-0 pr-1.5">
                                                        <span className="text-[10px] font-black text-stone-850 block truncate">{coord.fullName}</span>
                                                        <span className="text-[8px] text-stone-500 font-bold block truncate">Unit: {coord.displayUnitNumber || parentRes?.displayUnitNumber || 'N/A'} • 📱 {coordPhone}</span>
                                                      </div>
                                                      <button
                                                        type="button"
                                                        onClick={() => handleRemoveProgramCoordinator(prog.id, coord.residentId, coord.email)}
                                                        className="p-1 text-stone-400 hover:text-red-600 rounded-lg cursor-pointer hover:bg-stone-100 transition-colors shrink-0"
                                                      >
                                                        <X className="w-3 h-3" />
                                                      </button>
                                                    </div>
                                                  );
                                                })
                                              )}
                                            </div>

                                            <div className="space-y-1.5 pt-1.5 border-t border-stone-150">
                                              <input
                                                type="text"
                                                value={progCoordSearchQuery}
                                                onChange={(e) => setProgCoordSearchQuery(e.target.value)}
                                                placeholder="Search primary resident or spouse..."
                                                className="w-full px-2 py-1 font-bold bg-white border border-stone-200 rounded-lg text-[10px] text-stone-900 focus:outline-none focus:border-[#0f4c2a]"
                                              />

                                              {progCoordSearchQuery && (
                                                <div className="border border-stone-200 rounded-lg bg-white shadow-md max-h-40 overflow-y-auto divide-y divide-stone-100 text-[9px] relative z-20">
                                                  {matchedCoordCandidates.length === 0 ? (
                                                    <div className="p-2 text-stone-400 italic text-center font-bold">No eligible primary resident/spouse found.</div>
                                                  ) : (
                                                    matchedCoordCandidates.slice(0, 5).map(c => (
                                                      <div key={c.id} className="p-1.5 flex items-center justify-between gap-1.5 hover:bg-stone-50">
                                                        <div className="flex flex-col min-w-0">
                                                          <span className="font-extrabold text-stone-850 truncate max-w-[120px] block">{c.fullName}</span>
                                                          <span className="text-[8px] text-stone-400 block font-semibold truncate">
                                                            Unit {c.displayUnitNumber} ({c.relationship}) • 📱 {c.phone || 'N/A'}
                                                          </span>
                                                        </div>
                                                        <button
                                                          type="button"
                                                          onClick={() => {
                                                            const mockResidentObj = {
                                                              gmkId: c.residentId,
                                                              fullName: c.fullName,
                                                              email: c.email,
                                                              displayUnitNumber: c.displayUnitNumber,
                                                              phone: c.phone
                                                            } as any;
                                                            handleAssignProgramCoordinator(prog.id, mockResidentObj);
                                                            setProgCoordSearchQuery('');
                                                          }}
                                                          className="px-1.5 py-1 bg-[#0f4c2a] text-white rounded text-[8px] uppercase tracking-wider font-bold shrink-0 cursor-pointer"
                                                        >
                                                          Add
                                                        </button>
                                                      </div>
                                                    ))
                                                  )}
                                                </div>
                                              )}
                                            </div>
                                          </div>

                                          {/* COLUMN 2: VOLUNTEERS */}
                                          <div className="bg-stone-50 border border-stone-200 p-3 rounded-2xl space-y-3">
                                            <h6 className="text-[10px] uppercase font-black text-[#0f4c2a] tracking-wider border-b border-stone-150 pb-1 flex justify-between items-center">
                                              <span>Volunteers</span>
                                              <span className="text-[8px] font-mono text-stone-500">{(prog.volunteers || []).length}</span>
                                            </h6>
                                            <div className="space-y-1.5 max-h-36 overflow-y-auto">
                                              {(prog.volunteers || []).length === 0 ? (
                                                <p className="text-[10px] text-stone-550 italic font-bold">None assigned.</p>
                                              ) : (
                                                (prog.volunteers || []).map(vol => {
                                                  const parentRes = residents.find(r => r.gmkId === vol.residentId);
                                                  return (
                                                    <div key={vol.residentId} className="flex items-center justify-between p-1.5 bg-white border border-stone-150 rounded-xl">
                                                      <div className="truncate min-w-0 pr-1.5">
                                                        <span className="text-[10px] font-black text-stone-850 block truncate">{vol.fullName}</span>
                                                        <span className="text-[8px] text-stone-500 font-bold block truncate">Unit: {residents.find(r => r.gmkId === vol.residentId)?.displayUnitNumber || 'N/A'}</span>
                                                      </div>
                                                      <button
                                                        type="button"
                                                        onClick={() => handleRemoveProgramVolunteer(prog.id, vol.residentId)}
                                                        className="p-1 text-stone-400 hover:text-red-600 rounded-lg cursor-pointer hover:bg-stone-100 transition-colors"
                                                      >
                                                        <X className="w-3 h-3" />
                                                      </button>
                                                    </div>
                                                  );
                                                })
                                              )}
                                            </div>

                                            <div className="space-y-1.5 pt-1.5 border-t border-stone-150">
                                              <input
                                                type="text"
                                                value={progVolSearchQuery}
                                                onChange={(e) => setProgVolSearchQuery(e.target.value)}
                                                placeholder="Search volunteer candidate..."
                                                className="w-full px-2 py-1 font-bold bg-white border border-stone-200 rounded-lg text-[10px] text-stone-900 focus:outline-none focus:border-[#0f4c2a]"
                                              />

                                              {progVolSearchQuery && (
                                                <div className="border border-stone-200 rounded-lg bg-white shadow-md max-h-40 overflow-y-auto divide-y divide-stone-100 text-[9px] relative z-20">
                                                  {matchedVolCandidates.length === 0 ? (
                                                    <div className="p-2 text-stone-400 italic text-center font-bold">No eligible volunteers found.</div>
                                                  ) : (
                                                    matchedVolCandidates.slice(0, 5).map(v => (
                                                      <div key={v.id} className="p-1.5 flex items-center justify-between gap-1.5 hover:bg-stone-50">
                                                        <div className="flex flex-col min-w-0">
                                                          <span className="font-extrabold text-stone-850 truncate max-w-[120px] block">{v.fullName}</span>
                                                          <span className="text-[8px] text-stone-400 block font-semibold truncate">
                                                            Unit {v.displayUnitNumber} ({v.relationship})
                                                          </span>
                                                        </div>
                                                        <button
                                                          type="button"
                                                          onClick={() => {
                                                            const mockResidentObj = {
                                                              gmkId: v.residentId,
                                                              fullName: v.fullName,
                                                              email: v.email,
                                                              displayUnitNumber: v.displayUnitNumber
                                                            } as any;
                                                            handleAssignProgramVolunteer(prog.id, mockResidentObj);
                                                            setProgVolSearchQuery('');
                                                          }}
                                                          className="px-1.5 py-1 bg-[#0f4c2a] text-white rounded text-[8px] uppercase tracking-wider font-bold shrink-0 cursor-pointer"
                                                        >
                                                          Add
                                                        </button>
                                                      </div>
                                                    ))
                                                  )}
                                                </div>
                                              )}
                                            </div>
                                          </div>

                                          {/* COLUMN 3: EXPENSES */}
                                          <div className="bg-stone-50 border border-stone-200 p-3 rounded-2xl space-y-3">
                                            <div className="flex items-center justify-between border-b border-stone-150 pb-1">
                                              <h6 className="text-[10px] uppercase font-black text-[#0f4c2a] tracking-wider">
                                                Expenses
                                              </h6>
                                              <span className="text-[9px] font-extrabold text-stone-900 font-mono bg-white px-1.5 py-0.5 rounded border border-stone-200 shadow-xs">
                                                OMR {Number(expensesTotal || 0).toFixed(3)}
                                              </span>
                                            </div>

                                            <div className="space-y-1.5 max-h-36 overflow-y-auto">
                                              {expensesList.length === 0 ? (
                                                <p className="text-[10px] text-stone-500 italic font-bold">No expenses.</p>
                                              ) : (
                                                expensesList.map(exp => (
                                                  <div key={exp.id} className="flex items-center justify-between p-1.5 bg-white border border-stone-150 rounded-xl text-[9px]">
                                                    <div className="truncate min-w-0 pr-1.5">
                                                      <span className="font-black text-stone-850 block truncate">{exp.title}</span>
                                                      <span className="text-[8px] text-emerald-700 font-bold block mt-0.5">Approved</span>
                                                    </div>
                                                    <div className="flex items-center space-x-1 shrink-0">
                                                      <span className="font-mono font-extrabold text-stone-900">OMR {Number(exp.amount || 0).toFixed(3)}</span>
                                                      <button
                                                        type="button"
                                                        onClick={() => handleRemoveProgramExpense(prog.id, exp.id)}
                                                        className="text-stone-400 hover:text-red-500 p-0.5 transition-colors"
                                                      >
                                                        <Trash2 className="w-3 h-3" />
                                                      </button>
                                                    </div>
                                                  </div>
                                                ))
                                              )}
                                            </div>

                                            <div className="space-y-1 pt-1.5 border-t border-stone-150">
                                              <input
                                                type="text"
                                                value={expenseTitle}
                                                onChange={(e) => setExpenseTitle(e.target.value)}
                                                placeholder="Expense..."
                                                className="w-full px-2 py-1 font-bold bg-white border border-stone-200 rounded-lg text-[9px] text-stone-900 focus:outline-none"
                                              />
                                              <div className="flex items-center gap-1.5">
                                                <input
                                                  type="number"
                                                  step="0.01"
                                                  value={expenseAmount}
                                                  onChange={(e) => setExpenseAmount(e.target.value)}
                                                  placeholder="OMR"
                                                  className="w-1/2 px-2 py-1 font-mono font-bold bg-white border border-stone-200 rounded-lg text-[9px] text-stone-900 focus:outline-none"
                                                />
                                                <button
                                                  type="button"
                                                  onClick={() => handleAddProgramExpense(prog.id)}
                                                  className="w-1/2 py-1 bg-[#0f4c2a] text-white font-black uppercase text-[8px] tracking-wider rounded-lg text-center cursor-pointer shadow-xs"
                                                >
                                                  Add
                                                </button>
                                              </div>
                                            </div>
                                          </div>
                                        </div>

                                        {/* PARTICIPANTS MANAGEMENT SECTION (RTCO-021) */}
                                        <div className="bg-stone-50 border border-stone-200 p-4 rounded-2xl space-y-3.5 mt-4">
                                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-stone-200 pb-2.5">
                                            <div>
                                              <div className="flex items-center space-x-2">
                                                <Users className="w-4 h-4 text-[#0f4c2a]" />
                                                <h6 className="text-xs uppercase font-black text-[#0f4c2a] tracking-wider font-heading">
                                                  Program Participants
                                                </h6>
                                                <span className="px-2 py-0.5 bg-[#0f4c2a]/10 text-[#0f4c2a] rounded-md text-[9px] font-black uppercase font-mono">
                                                  {progTypeNormalized} Program Eligibility
                                                </span>
                                              </div>
                                              <p className="text-[10px] text-stone-500 font-bold mt-0.5">
                                                Search, filter and enroll community participants based on program age and gender requirements.
                                              </p>
                                            </div>
                                            <span className="text-xs font-mono font-black text-[#0f4c2a] bg-white border border-stone-200 px-2.5 py-1 rounded-xl shadow-xs self-start sm:self-auto">
                                              {(prog.participants || []).length} Enrolled
                                            </span>
                                          </div>

                                          {/* CURRENT ENROLLED PARTICIPANTS */}
                                          <div className="space-y-2">
                                            <div className="flex items-center justify-between">
                                              <span className="text-[10px] uppercase font-black text-stone-600 tracking-wider">Enrolled Roster:</span>
                                              {(prog.participants || []).length > 0 && (
                                                <span className="text-[9px] text-stone-400 font-mono">Showing all enrolled members</span>
                                              )}
                                            </div>

                                            {(prog.participants || []).length === 0 ? (
                                              <div className="p-3 text-center bg-white border border-dashed border-stone-250 rounded-xl text-[10px] text-stone-400 font-bold italic">
                                                No participants enrolled yet. Use the search & filter tools below to add eligible candidates.
                                              </div>
                                            ) : (
                                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-52 overflow-y-auto pr-1">
                                                {(prog.participants || []).map((p, idx) => {
                                                  const parentRes = residents.find(r => r.gmkId === p.residentId || r.fullName.toLowerCase() === p.fullName.toLowerCase());
                                                  const isChild = (p.age !== undefined && p.age < 18) || p.relationship === 'Child' || p.relationship === 'Kid';
                                                  const contactPhone = p.phone || (parentRes ? (parentRes.phone || parentRes.whatsAppNumber) : 'N/A');

                                                  return (
                                                    <div key={p.residentId || idx} className="p-2 bg-white border border-stone-200 rounded-xl flex items-start justify-between gap-1.5 shadow-xs">
                                                      <div className="min-w-0 flex-1 space-y-0.5">
                                                        <div className="flex items-center space-x-1.5 flex-wrap">
                                                          <span className="font-extrabold text-stone-850 text-[10px] truncate block">{p.fullName}</span>
                                                          {p.gender && (
                                                            <span className="text-[8px] font-mono px-1 py-0.2 bg-stone-100 text-stone-600 rounded">
                                                              {p.gender}
                                                            </span>
                                                          )}
                                                          {p.age !== undefined && (
                                                            <span className="text-[8px] font-mono px-1 py-0.2 bg-stone-100 text-stone-600 rounded">
                                                              Age {p.age}
                                                            </span>
                                                          )}
                                                        </div>
                                                        <div className="text-[8.5px] font-bold text-stone-500 truncate">
                                                          Unit: {p.displayUnitNumber || parentRes?.displayUnitNumber || 'N/A'} {p.relationship ? `(${p.relationship})` : ''}
                                                        </div>
                                                        {isChild ? (
                                                          <div className="text-[8.5px] font-mono font-bold text-amber-800 bg-amber-50/80 px-1.5 py-0.5 rounded border border-amber-200/60 truncate mt-0.5">
                                                            👨‍👩‍👧 Parent/Guardian: {contactPhone}
                                                          </div>
                                                        ) : (
                                                          <div className="text-[8.5px] font-mono font-bold text-emerald-800 truncate">
                                                            📱 {contactPhone}
                                                          </div>
                                                        )}
                                                      </div>
                                                      <button
                                                        type="button"
                                                        onClick={() => handleRemoveProgramParticipant(prog.id, p.residentId, p.fullName)}
                                                        className="p-1 text-stone-400 hover:text-red-600 rounded-lg cursor-pointer hover:bg-stone-100 transition-colors shrink-0"
                                                        title="Remove participant from program"
                                                      >
                                                        <X className="w-3.5 h-3.5" />
                                                      </button>
                                                    </div>
                                                  );
                                                })}
                                              </div>
                                            )}
                                          </div>

                                          {/* SEARCH & ENROLL PARTICIPANTS */}
                                          <div className="pt-2 border-t border-stone-200 space-y-2">
                                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                              <label className="text-[10px] font-black uppercase text-[#0f4c2a] tracking-wider block">
                                                Add Eligible Participant:
                                              </label>

                                              {/* Age & Gender Quick Filters */}
                                              <div className="flex items-center gap-1.5 flex-wrap">
                                                <div className="flex items-center bg-stone-200/80 rounded-lg p-0.5 border border-stone-250">
                                                  <span className="text-[8px] font-black uppercase text-stone-500 px-1">Age:</span>
                                                  {[
                                                    { label: 'All', val: 'ALL' },
                                                    { label: '<12', val: 'UNDER_12' },
                                                    { label: '12-17', val: 'TEENS' },
                                                    { label: '18+', val: 'ADULTS' }
                                                  ].map(f => (
                                                    <button
                                                      key={f.val}
                                                      type="button"
                                                      onClick={() => setParticipantAgeFilter(f.val as any)}
                                                      className={`px-1.5 py-0.5 text-[8px] font-black uppercase rounded transition-all cursor-pointer ${
                                                        participantAgeFilter === f.val
                                                          ? 'bg-[#0f4c2a] text-white shadow-xs'
                                                          : 'text-stone-600 hover:text-stone-900'
                                                      }`}
                                                    >
                                                      {f.label}
                                                    </button>
                                                  ))}
                                                </div>

                                                <div className="flex items-center bg-stone-200/80 rounded-lg p-0.5 border border-stone-250">
                                                  <span className="text-[8px] font-black uppercase text-stone-500 px-1">Gender:</span>
                                                  {[
                                                    { label: 'All', val: 'ALL' },
                                                    { label: 'Male', val: 'MALE' },
                                                    { label: 'Female', val: 'FEMALE' }
                                                  ].map(f => (
                                                    <button
                                                      key={f.val}
                                                      type="button"
                                                      onClick={() => setParticipantGenderFilter(f.val as any)}
                                                      className={`px-1.5 py-0.5 text-[8px] font-black uppercase rounded transition-all cursor-pointer ${
                                                        participantGenderFilter === f.val
                                                          ? 'bg-[#0f4c2a] text-white shadow-xs'
                                                          : 'text-stone-600 hover:text-stone-900'
                                                      }`}
                                                    >
                                                      {f.label}
                                                    </button>
                                                  ))}
                                                </div>
                                              </div>
                                            </div>

                                            <div className="relative">
                                              <input
                                                type="text"
                                                value={progParticipantSearchQuery}
                                                onChange={(e) => setProgParticipantSearchQuery(e.target.value)}
                                                placeholder={`Search candidates for ${progTypeNormalized} program (by name, flat, relationship)...`}
                                                className="w-full px-3 py-1.5 font-bold bg-white border border-stone-250 rounded-xl text-xs text-stone-900 focus:outline-none focus:border-[#0f4c2a] shadow-xs"
                                              />

                                              {progParticipantSearchQuery && (
                                                <div className="mt-1 border border-stone-250 rounded-xl bg-white shadow-lg max-h-56 overflow-y-auto divide-y divide-stone-100 text-[9.5px] z-30 relative">
                                                  {matchedParticipantCandidates.length === 0 ? (
                                                    <div className="p-3 text-stone-400 italic text-center font-bold">
                                                      No candidates matching "{progParticipantSearchQuery}" eligible for {progTypeNormalized} program (Age: {participantAgeFilter}, Gender: {participantGenderFilter}).
                                                    </div>
                                                  ) : (
                                                    matchedParticipantCandidates.slice(0, 8).map(candidate => {
                                                      const isChild = (candidate.age !== undefined && candidate.age < 18) || candidate.relationship === 'Child' || candidate.relationship === 'Kid';

                                                      return (
                                                        <div key={candidate.id} className="p-2 flex items-center justify-between gap-2 hover:bg-stone-50">
                                                          <div className="flex flex-col min-w-0 space-y-0.5">
                                                            <div className="flex items-center space-x-1.5 flex-wrap">
                                                              <span className="font-black text-stone-850 text-xs truncate">{candidate.fullName}</span>
                                                              {candidate.age !== undefined && (
                                                                <span className="text-[8px] font-mono px-1 py-0.2 bg-stone-100 text-stone-700 rounded font-bold">
                                                                  Age {candidate.age}
                                                                </span>
                                                              )}
                                                              {candidate.gender && (
                                                                <span className="text-[8px] font-mono px-1 py-0.2 bg-stone-100 text-stone-700 rounded font-bold">
                                                                  {candidate.gender}
                                                                </span>
                                                              )}
                                                            </div>
                                                            <div className="text-[8.5px] text-stone-500 font-bold truncate">
                                                              Unit {candidate.unitDisplay} • {candidate.relationship}
                                                            </div>
                                                            {isChild ? (
                                                              <div className="text-[8.5px] font-mono text-amber-800 font-bold truncate">
                                                                👨‍👩‍👧 Parent Contact: {candidate.phone || 'N/A'}
                                                              </div>
                                                            ) : (
                                                              <div className="text-[8.5px] font-mono text-emerald-800 font-bold truncate">
                                                                📱 Phone: {candidate.phone || 'N/A'}
                                                              </div>
                                                            )}
                                                          </div>

                                                          <button
                                                            type="button"
                                                            onClick={() => {
                                                              handleAssignProgramParticipant(prog.id, candidate);
                                                              setProgParticipantSearchQuery('');
                                                            }}
                                                            className="px-2.5 py-1 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white rounded-lg text-[9px] uppercase tracking-wider font-black shrink-0 cursor-pointer shadow-xs"
                                                          >
                                                            Enroll
                                                          </button>
                                                        </div>
                                                      );
                                                    })
                                                  )}
                                                </div>
                                              )}
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })() : (
                                    <div className="h-full flex flex-col items-center justify-center p-8 text-center border border-stone-200 rounded-3xl bg-stone-50/50 min-h-[340px]">
                                      <Users className="w-8 h-8 text-stone-350 mb-2" />
                                      <h6 className="text-xs font-extrabold text-stone-700 uppercase tracking-wider">Select a Program</h6>
                                      <p className="text-[10px] text-stone-500 font-bold max-w-xs mt-1 leading-relaxed">
                                        Select any program card from the left panel to configure its coordinators, assign volunteers, and log expenses.
                                      </p>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    }

                    // 2. STANDARD OPERATIONAL COMMITTEE WORKSPACE (View assigned leads, Remove leads, Assign new lead, Search residents. Nothing else.)
                    return (
                      <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-sm space-y-6 animate-fadeIn">
                        {/* HEADER */}
                        <div className="flex items-center justify-between border-b border-stone-150 pb-3">
                          <div>
                            <h4 className="font-extrabold text-[#0f4c2a] text-sm uppercase tracking-wider font-heading">{activeCommitteeToConfigure} Workspace</h4>
                            <p className="text-[10px] text-stone-500 font-bold mt-0.5">Appoint, view, or revoke committee leads for operational tasks.</p>
                          </div>
                          <span className="px-2 py-1 bg-emerald-50 border border-emerald-100 text-[#0f4c2a] text-xs font-black rounded-lg font-mono">
                            {leadCount} Leads
                          </span>
                        </div>

                        {/* VIEW ASSIGNED LEADS & REMOVE LEADS */}
                        <div className="space-y-3">
                          <h5 className="text-[10px] uppercase font-black text-stone-550 tracking-wider">Current Committee Leads</h5>
                          {commLeads.length === 0 ? (
                            <p className="text-xs text-stone-500 italic font-bold p-4 bg-stone-50 border border-dashed border-stone-200 rounded-xl text-center">
                              No Committee Leads assigned. Use the search tool below to appoint leads immediately.
                            </p>
                          ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              {commLeads.map(lead => (
                                <div key={lead.residentId} className="flex items-center justify-between p-3 bg-emerald-50/25 border border-emerald-100 rounded-xl">
                                  <div>
                                    <span className="text-xs font-black text-stone-850 block">{lead.fullName}</span>
                                    <span className="text-[9px] text-stone-500 font-bold block mt-0.5">{lead.email}</span>
                                  </div>
                                  <button
                                    type="button"
                                    disabled={isSubmitting}
                                    onClick={() => handleRemoveCommitteeLead(lead.residentId, lead.email, activeCommitteeToConfigure)}
                                    className="p-1.5 hover:bg-red-50 text-stone-400 hover:text-red-600 rounded-lg transition-colors cursor-pointer"
                                    title="Remove Lead"
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* SEARCH RESIDENTS & ASSIGN NEW LEAD */}
                        <div className="space-y-3 pt-3 border-t border-stone-100">
                          <h5 className="text-[10px] uppercase font-black text-stone-550 tracking-wider">Assign New Lead</h5>
                          
                          <div className="space-y-4">
                            <div className="relative">
                              <Search className="absolute left-3.5 top-3 w-4 h-4 text-[#0f4c2a]" />
                              <input
                                type="text"
                                value={workspaceSearchQuery}
                                onChange={(e) => setWorkspaceSearchQuery(e.target.value)}
                                placeholder="Search members by name or flat number to assign..."
                                className="w-full pl-10 pr-4 py-2.5 font-bold bg-stone-50 hover:bg-stone-100 focus:bg-white border border-stone-200 hover:border-stone-450 focus:border-[#0f4c2a] rounded-xl text-xs text-stone-900 focus:outline-none transition-all placeholder-stone-400"
                              />
                            </div>

                            {workspaceSearchQuery && (
                              <div className="grid grid-cols-1 gap-2.5 max-h-72 overflow-y-auto animate-fadeIn">
                                {residents.filter(r => {
                                  if (r.status !== 'active') return false;
                                  if (commLeads.some(l => l.residentId === r.gmkId)) return false;
                                  const query = workspaceSearchQuery.toLowerCase().trim();
                                  return r.fullName?.toLowerCase().includes(query) || r.displayUnitNumber?.toLowerCase().includes(query) || r.phone?.toLowerCase().includes(query) || r.email?.toLowerCase().includes(query);
                                }).length === 0 ? (
                                  <div className="text-center p-4 text-stone-450 italic text-xs font-bold bg-stone-50 rounded-xl border border-dashed border-stone-200">
                                    No matching active residents found.
                                  </div>
                                ) : (
                                  residents.filter(r => {
                                    if (r.status !== 'active') return false;
                                    if (commLeads.some(l => l.residentId === r.gmkId)) return false;
                                    const query = workspaceSearchQuery.toLowerCase().trim();
                                    return r.fullName?.toLowerCase().includes(query) || r.displayUnitNumber?.toLowerCase().includes(query) || r.phone?.toLowerCase().includes(query) || r.email?.toLowerCase().includes(query);
                                  }).map(res => (
                                    <div key={res.gmkId} className="bg-stone-50 hover:bg-stone-100/70 border border-stone-200 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 transition-colors">
                                      <div className="min-w-0 flex-1">
                                        <span className="font-extrabold text-stone-900 text-xs block truncate">{res.fullName}</span>
                                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-1 text-[9px] text-stone-500 font-bold uppercase tracking-wider">
                                          <span>Flat: {res.displayUnitNumber}</span>
                                          <span>•</span>
                                          <span className="truncate">{res.phone}</span>
                                          <span>•</span>
                                          <span className="truncate lowercase">{res.email}</span>
                                        </div>
                                      </div>
                                      <button
                                        type="button"
                                        disabled={isSubmitting}
                                        onClick={() => {
                                          handleAssignLeadDirectly(res, activeCommitteeToConfigure);
                                          setWorkspaceSearchQuery('');
                                        }}
                                        className="w-full sm:w-auto px-3 py-1.5 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white font-black text-[10px] uppercase tracking-wider rounded-lg transition-all cursor-pointer shadow-xs active:scale-95 flex items-center justify-center space-x-1 shrink-0 mt-1 sm:mt-0"
                                      >
                                        <UserCheck className="w-3.5 h-3.5 text-[#d4af37]" />
                                        <span>Assign Lead</span>
                                      </button>
                                    </div>
                                  ))
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* COMMITTEE EXPENSE SHEET (OMR, 3 DECIMAL PLACES) */}
                        <div className="pt-4 border-t border-stone-100 space-y-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <h5 className="text-xs uppercase font-black text-[#0f4c2a] tracking-wider font-heading">
                                {activeCommitteeToConfigure} Expense Sheet
                              </h5>
                              <p className="text-[10px] text-stone-500 font-bold mt-0.5">
                                Log operational expenses in OMR with 3 decimal places precision (e.g. 0.001 OMR).
                              </p>
                            </div>
                            <span className="text-xs font-mono font-extrabold text-[#0f4c2a] bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-xl">
                              Total: OMR {((currentComm?.expenses || []).reduce((sum, e) => sum + (e.amount || 0), 0)).toFixed(3)}
                            </span>
                          </div>

                          {(currentComm?.expenses || []).length === 0 ? (
                            <p className="text-xs text-stone-500 italic font-bold p-3 bg-stone-50 border border-dashed border-stone-200 rounded-xl text-center">
                              No expenses recorded for this committee yet. Use the form below to log an expense.
                            </p>
                          ) : (
                            <div className="border border-stone-200 rounded-xl overflow-hidden divide-y divide-stone-150">
                              <div className="bg-stone-50 p-2.5 grid grid-cols-12 text-[10px] uppercase font-black text-stone-600 tracking-wider">
                                <div className="col-span-3">Date</div>
                                <div className="col-span-5">Description</div>
                                <div className="col-span-3 text-right">Amount (OMR)</div>
                                <div className="col-span-1 text-center">Action</div>
                              </div>
                              {(currentComm?.expenses || []).map(exp => (
                                <div key={exp.id} className="p-2.5 grid grid-cols-12 items-center text-xs font-bold text-stone-850 hover:bg-stone-50/50">
                                  <div className="col-span-3 font-mono text-[11px] text-stone-600">{exp.date}</div>
                                  <div className="col-span-5 font-semibold text-stone-900 truncate">{exp.description}</div>
                                  <div className="col-span-3 text-right font-mono font-extrabold text-[#0f4c2a]">
                                    OMR {(exp.amount || 0).toFixed(3)}
                                  </div>
                                  <div className="col-span-1 text-center">
                                    <button
                                      type="button"
                                      disabled={isSubmitting}
                                      onClick={() => handleRemoveCommitteeExpense(currentComm?.id || '', exp.id)}
                                      className="p-1 hover:bg-red-50 text-stone-400 hover:text-red-600 rounded-lg transition-colors cursor-pointer"
                                      title="Delete Expense"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end bg-stone-50/50 p-3 rounded-xl border border-stone-150">
                            <div className="sm:col-span-3 space-y-1">
                              <label className="text-[10px] uppercase font-black text-stone-500 tracking-wider block">Date</label>
                              <input
                                type="date"
                                value={commExpenseDate}
                                onChange={(e) => setCommExpenseDate(e.target.value)}
                                className="w-full px-2.5 py-1.5 font-bold bg-white border border-stone-200 rounded-lg text-xs text-stone-850 focus:outline-none focus:ring-1 focus:ring-[#0f4c2a]"
                              />
                            </div>
                            <div className="sm:col-span-4 space-y-1">
                              <label className="text-[10px] uppercase font-black text-stone-500 tracking-wider block">Description</label>
                              <input
                                type="text"
                                value={commExpenseDesc}
                                onChange={(e) => setCommExpenseDesc(e.target.value)}
                                placeholder="Expense description..."
                                className="w-full px-2.5 py-1.5 font-bold bg-white border border-stone-200 rounded-lg text-xs text-stone-850 focus:outline-none focus:ring-1 focus:ring-[#0f4c2a]"
                              />
                            </div>
                            <div className="sm:col-span-3 space-y-1">
                              <label className="text-[10px] uppercase font-black text-stone-500 tracking-wider block">Amount (OMR)</label>
                              <input
                                type="number"
                                step="0.001"
                                value={commExpenseAmount}
                                onChange={(e) => setCommExpenseAmount(e.target.value)}
                                placeholder="0.000"
                                className="w-full px-2.5 py-1.5 font-mono font-bold bg-white border border-stone-200 rounded-lg text-xs text-stone-850 focus:outline-none focus:ring-1 focus:ring-[#0f4c2a]"
                              />
                            </div>
                            <div className="sm:col-span-2">
                              <button
                                type="button"
                                disabled={isSubmitting || !commExpenseDesc.trim() || !commExpenseAmount.trim()}
                                onClick={() => handleAddCommitteeExpense(currentComm?.id || '')}
                                className="w-full py-1.5 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white font-extrabold text-[11px] uppercase tracking-wider rounded-lg transition-all cursor-pointer flex items-center justify-center space-x-1 shadow-xs disabled:opacity-50"
                              >
                                <Plus className="w-3.5 h-3.5 text-[#d4af37]" />
                                <span>Add</span>
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* FINANCE & ATTENDANCE COMMITTEE REGISTRATION REPORTS WORKSPACE */}
                        {(activeCommitteeToConfigure.toLowerCase().includes('finance') || activeCommitteeToConfigure.toLowerCase().includes('attendance')) && (
                          <div className="pt-4 border-t border-stone-100 space-y-3">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                              <div>
                                <h5 className="text-xs uppercase font-black text-[#0f4c2a] tracking-wider font-heading flex items-center space-x-1.5">
                                  <span>📋</span>
                                  <span>Event Registration Data ({activeCommitteeToConfigure} Committee)</span>
                                </h5>
                                <p className="text-[10px] text-stone-500 font-bold mt-0.5">
                                  Comprehensive registration records showing registrant names, adult/child counts, payable amount, and payment status.
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={handleExportCSV}
                                className="px-3 py-1.5 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white text-[10px] font-black uppercase tracking-wider rounded-lg transition-all shadow-xs flex items-center space-x-1 cursor-pointer self-start sm:self-auto"
                              >
                                <Download className="w-3.5 h-3.5 text-[#d4af37]" />
                                <span>Export Report</span>
                              </button>
                            </div>

                            {registrations.length === 0 ? (
                              <div className="p-4 text-center text-stone-450 italic font-bold text-xs bg-stone-50 border border-dashed border-stone-200 rounded-xl">
                                No event registrations found yet.
                              </div>
                            ) : (
                              <div className="overflow-x-auto border border-stone-200 rounded-2xl bg-white">
                                <table className="w-full text-left border-collapse">
                                  <thead>
                                    <tr className="bg-stone-50 border-b border-stone-200 text-[10px] uppercase font-black text-stone-500 tracking-wider">
                                      <th className="p-3">GMK / Reg ID</th>
                                      <th className="p-3">Name of Registrant</th>
                                      <th className="p-3">Unit Number</th>
                                      <th className="p-3 text-center">Adults</th>
                                      <th className="p-3 text-center">Children</th>
                                      <th className="p-3 text-center">Total</th>
                                      <th className="p-3 text-right">Amount to Pay</th>
                                      <th className="p-3 text-center">Payment Status</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-stone-150 text-stone-750 font-bold font-sans text-xs">
                                    {registrations.map(reg => {
                                      const fam = families.find(f => f.id === reg.familyId);
                                      const primaryName = fam ? fam.fullName : (reg.primaryMemberEmail ? reg.primaryMemberEmail.split('@')[0] : 'Unknown');
                                      const unit = fam ? fam.displayUnitNumber : 'Unknown';
                                      const famMembers = familyMembers.filter(m => m.familyId === reg.familyId);
                                      const participants = reg.participants || [];

                                      let adults = 0;
                                      let children = 0;

                                      if (reg.paymentSummary && typeof reg.paymentSummary.childrenCount === 'number') {
                                        children = reg.paymentSummary.childrenCount;
                                        adults = Math.max(0, participants.length - children);
                                      } else {
                                        participants.forEach(name => {
                                          if (name === primaryName) {
                                            adults++;
                                          } else {
                                            const match = famMembers.find(m => m.name.toLowerCase().trim() === name.toLowerCase().trim());
                                            if (match && match.relationship === 'child') {
                                              children++;
                                            } else {
                                              adults++;
                                            }
                                          }
                                        });
                                      }

                                      const amountToPay = reg.paymentAmount ?? reg.paymentSummary?.totalAmount ?? 0;
                                      const pStatus = reg.paymentStatus || (amountToPay === 0 ? 'waived' : 'pending');

                                      return (
                                        <tr key={reg.id} className="hover:bg-stone-50/50">
                                          <td className="p-3 font-mono text-[10px] text-stone-600 uppercase">
                                            {reg.primaryMemberGmkId || reg.id.split('_')?.[1] || 'N/A'}
                                          </td>
                                          <td className="p-3">
                                            <span className="text-stone-900 font-black block">{primaryName}</span>
                                            <span className="text-[10px] text-stone-500 font-medium font-mono">{reg.primaryMemberEmail}</span>
                                          </td>
                                          <td className="p-3 font-mono text-[11px] text-emerald-800 font-bold">{unit}</td>
                                          <td className="p-3 text-center">
                                            <span className="px-2 py-0.5 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded font-bold text-[10px]">
                                              {adults}
                                            </span>
                                          </td>
                                          <td className="p-3 text-center">
                                            <span className="px-2 py-0.5 bg-amber-50 text-amber-800 border border-amber-200 rounded font-bold text-[10px]">
                                              {children}
                                            </span>
                                          </td>
                                          <td className="p-3 text-center font-black text-stone-900">{reg.totalParticipants || (adults + children)}</td>
                                          <td className="p-3 text-right font-mono font-black text-[#0f4c2a]">
                                            OMR {amountToPay.toFixed(3)}
                                          </td>
                                          <td className="p-3 text-center">
                                            <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider border ${
                                              pStatus === 'paid' || pStatus === 'approved' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' :
                                              pStatus === 'waived' ? 'bg-blue-50 text-blue-800 border-blue-200' :
                                              'bg-amber-50 text-amber-800 border-amber-200'
                                            }`}>
                                              {pStatus}
                                            </span>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </>
              ) : (
                <div className="text-center py-12 text-stone-500 font-bold bg-white rounded-2xl border border-stone-150">
                  Select an active event from the top right or Events tab to assign committees.
                </div>
              )}
            </div>
          )}


          {/* 4. PROGRAMS TAB: OPERATIONAL WORKSPACE */}
          {activeTab === 'programs' && (
            <div className="space-y-6 animate-fadeIn">
              <div className="border-b border-stone-200 pb-3 flex flex-col md:flex-row md:items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-extrabold text-[#0f4c2a] uppercase tracking-wider font-heading">
                    Programs / Event Workspace
                  </h3>
                  <p className="text-stone-550 text-[10px] font-bold">
                    Operational management of stage programs: create listings, assign coordinators & volunteers, log expenses, and manage individual program workspaces.
                  </p>
                </div>
              </div>

              {selectedEventId && activeEvent ? (
                <div className="space-y-6">
                  {/* Create Program Desk */}
                  <div className="bg-stone-50 border border-stone-200 rounded-2xl p-4 space-y-3">
                    <h4 className="font-extrabold text-[#0f4c2a] text-xs uppercase tracking-wider font-heading block">
                      Create Program
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-black text-[#0f4c2a] tracking-wider block">Program Title</label>
                        <input
                          type="text"
                          value={progTitle}
                          onChange={(e) => setProgTitle(e.target.value)}
                          placeholder="e.g. Classical Dance Performance"
                          className="w-full px-3 py-1.5 font-bold bg-white border border-stone-250 rounded-xl text-stone-850 text-xs focus:outline-none focus:ring-1 focus:ring-[#0f4c2a]"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-black text-[#0f4c2a] tracking-wider block">Type / Audience</label>
                        <select
                          value={progType}
                          onChange={(e) => setProgType(e.target.value)}
                          className="w-full px-3 py-1.5 font-bold bg-white border border-stone-250 rounded-xl text-stone-850 text-xs focus:outline-none focus:ring-1 focus:ring-[#0f4c2a]"
                        >
                          <option value="Select">Select Category</option>
                          <option value="Adults">ADULTS</option>
                          <option value="Kids">KIDS</option>
                          <option value="Mix">MIXED</option>
                        </select>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-black text-[#0f4c2a] tracking-wider block">Program Description</label>
                      <textarea
                        value={progDescription}
                        onChange={(e) => setProgDescription(e.target.value)}
                        placeholder="Details about duration, tracks, components etc."
                        className="w-full px-3 py-1.5 font-bold bg-white border border-stone-250 rounded-xl text-stone-850 text-xs focus:outline-none focus:ring-1 focus:ring-[#0f4c2a] h-14"
                      />
                    </div>

                    {/* Coordinator Selection */}
                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase font-black text-[#0f4c2a] tracking-wider block">Assign Program Coordinator</label>
                      {progCoordinator ? (
                        <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between text-xs">
                          <div>
                            <strong className="text-stone-900">{progCoordinator.fullName}</strong>
                            <span className="text-stone-500 block text-[10px]">Unit {progCoordinator.displayUnitNumber} • {progCoordinator.email}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setProgCoordinator(null)}
                            className="text-stone-400 hover:text-red-600 font-extrabold uppercase text-[9px] tracking-wider"
                          >
                            Change
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="relative">
                            <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-stone-400" />
                            <input
                              type="text"
                              value={progCoordinatorSearch}
                              onChange={(e) => setProgCoordinatorSearch(e.target.value)}
                              placeholder="Search members by name or unit number to assign coordinator..."
                              className="w-full pl-8 pr-3 py-1.5 font-bold bg-white border border-stone-250 rounded-xl text-xs text-stone-850 focus:outline-none focus:ring-1 focus:ring-[#0f4c2a]"
                            />
                          </div>

                          {progCoordinatorSearch && (() => {
                            const matchedCoordResidents = getFilteredSearchMatches(progCoordinatorSearch, 'Mixed');
                            return (
                              <div className="border border-stone-200 rounded-xl bg-white shadow-md max-h-40 overflow-y-auto divide-y divide-stone-100">
                                {matchedCoordResidents.length === 0 ? (
                                  <div className="p-2.5 text-stone-450 italic text-[10px] text-center font-bold">
                                    No matching active residents found.
                                  </div>
                                ) : (
                                  matchedCoordResidents.slice(0, 5).map(res => {
                                    const rawRes = residents.find(r => r.gmkId === res.id || r.email === res.email);
                                    return (
                                      <div key={res.id} className="p-2 flex items-center justify-between text-[11px] hover:bg-stone-50">
                                        <div>
                                          <span className="font-extrabold text-stone-900 block">{res.fullName}</span>
                                          <span className="text-[9px] text-stone-500 block">Unit: {res.displayUnitNumber} • {res.email}</span>
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            if (rawRes) setProgCoordinator(rawRes);
                                          }}
                                          className="px-2 py-0.5 bg-[#0f4c2a]/10 text-[#0f4c2a] font-extrabold text-[9px] uppercase tracking-wider rounded-lg hover:bg-[#0f4c2a] hover:text-white transition-all cursor-pointer"
                                        >
                                          Select
                                        </button>
                                      </div>
                                    );
                                  })
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={handleCreateProgramDirectly}
                      disabled={isSubmitting || !progTitle.trim() || progType === 'Select'}
                      className="w-full py-2 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white font-extrabold text-xs uppercase tracking-wider rounded-xl transition-all cursor-pointer flex items-center justify-center space-x-1 shadow-xs disabled:bg-stone-200 disabled:text-stone-400 disabled:cursor-not-allowed"
                    >
                      <Plus className="w-4 h-4 text-[#d4af37]" />
                      <span>Create Program</span>
                    </button>
                  </div>

                  {/* Programs List & Management Workspace */}
                  {activePrograms.length === 0 ? (
                    <div className="text-center py-12 border border-dashed border-stone-250 rounded-2xl bg-white space-y-2">
                      <Flame className="w-8 h-8 mx-auto text-stone-350" />
                      <h4 className="text-stone-700 font-black text-xs">No Stage Programs Registered</h4>
                      <p className="text-stone-500 text-[10px] max-w-xs mx-auto font-bold">
                        Create a program above or navigate to the Committee workspace to manage detailed assignments.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <h4 className="font-extrabold text-[#0f4c2a] text-xs uppercase tracking-wider font-heading block border-b border-stone-200 pb-2">
                        Active Programs ({activePrograms.length})
                      </h4>
                      <div className="grid grid-cols-1 gap-4">
                        {activePrograms.map((prog) => (
                          <div key={prog.id} className="bg-white border border-stone-200 rounded-2xl p-4 shadow-xs space-y-3">
                            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 border-b border-stone-150 pb-2">
                              <div>
                                <div className="flex items-center space-x-2">
                                  <span className="text-[8px] font-black tracking-widest text-[#d4af37] uppercase bg-[#0f4c2a]/5 border border-[#0f4c2a]/15 px-2 py-0.5 rounded-lg font-mono">
                                    {prog.programType || prog.category || 'Adults'}
                                  </span>
                                  <span className="text-[8px] font-mono text-stone-400">
                                    ID: {prog.id}
                                  </span>
                                </div>
                                <h4 className="text-stone-850 font-black text-sm font-heading mt-1 capitalize">{prog.title}</h4>
                                <p className="text-stone-600 text-[10px] font-bold mt-0.5">
                                  Coordinator: <strong className="text-stone-900">{prog.coordinators?.[0]?.fullName || 'Unassigned'}</strong> {prog.coordinators?.[0]?.email ? `(${prog.coordinators[0].email})` : ''}
                                </p>
                              </div>

                              <div className="flex items-center space-x-2 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => handleDeleteProgram(prog.id, prog.title)}
                                  disabled={isSubmitting}
                                  className="px-3 py-1.5 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 font-extrabold text-[10px] uppercase tracking-wider transition-all cursor-pointer shadow-xs flex items-center space-x-1"
                                >
                                  <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                                  <span>Delete Program/Event</span>
                                </button>
                              </div>
                            </div>

                            {prog.description && (
                              <p className="text-stone-600 text-[10px] font-medium leading-relaxed">{prog.description}</p>
                            )}

                            <div className="flex items-center justify-between text-[10px] text-stone-500 pt-1 font-semibold">
                              <span>Coordinators: {prog.coordinators?.length || 0} • Volunteers: {prog.volunteers?.length || 0} • Expenses: ${(prog.expenses || []).reduce((s, e) => s + e.amount, 0).toFixed(2)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-12 text-stone-500 font-bold bg-white rounded-2xl border border-stone-150">
                  Select an active event from the top right or Events tab to view programs.
                </div>
              )}
            </div>
          )}


          {/* 5. REGISTRATIONS TAB */}
          {activeTab === 'registrations' && (
            <div className="space-y-6 animate-fadeIn">
              <div className="border-b border-stone-200 pb-3 flex flex-col md:flex-row md:items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-extrabold text-[#0f4c2a] uppercase tracking-wider font-heading">
                    Event Registration Console
                  </h3>
                  <p className="text-stone-550 text-[10px] font-bold">Track, review, and export active registrant tallies in real-time.</p>
                </div>
              </div>

              {selectedEventId && activeEvent ? (
                <div className="space-y-6">
                  {/* Strict Tally KPI Layout (Only 4 specific counts, NO charts, NO dashboards, NO extra KPI widgets) */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 font-heading">
                    <div className="bg-white border border-stone-200 p-4 rounded-2xl flex flex-col justify-between shadow-xs">
                      <span className="text-[10px] uppercase font-black text-stone-500 tracking-wider">Families Registered</span>
                      <strong className="text-lg text-stone-900 font-black mt-2">{stats.familiesCount}</strong>
                    </div>
                    
                    <div className="bg-white border border-stone-200 p-4 rounded-2xl flex flex-col justify-between shadow-xs">
                      <span className="text-[10px] uppercase font-black text-stone-500 tracking-wider">Residents Registered</span>
                      <strong className="text-lg text-stone-900 font-black mt-2">{stats.residentsCount}</strong>
                    </div>

                    <div className="bg-emerald-50/40 border border-emerald-100 p-4 rounded-2xl flex flex-col justify-between shadow-xs">
                      <span className="text-[10px] uppercase font-black text-emerald-800 tracking-wider">Adults</span>
                      <strong className="text-lg text-[#0f4c2a] font-black mt-2">{stats.adultsCount}</strong>
                    </div>

                    <div className="bg-amber-50/40 border border-amber-150 p-4 rounded-2xl flex flex-col justify-between shadow-xs">
                      <span className="text-[10px] uppercase font-black text-amber-800 tracking-wider">Children</span>
                      <strong className="text-lg text-amber-800 font-black mt-2">{stats.childrenCount}</strong>
                    </div>
                  </div>

                  {/* Operation Buttons */}
                  <div className="flex flex-wrap items-center gap-3 pt-2 font-heading">
                    <button
                      onClick={() => setShowRegistrantsTable(!showRegistrantsTable)}
                      className="px-4 py-2.5 rounded-xl border border-stone-250 bg-white hover:bg-stone-50 text-stone-700 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center space-x-1.5 shadow-xs"
                    >
                      <Users className="w-4 h-4 text-[#0f4c2a]" />
                      <span>{showRegistrantsTable ? "Hide Registrants Table" : "View Registrants"}</span>
                    </button>

                    <button
                      onClick={handleExportCSV}
                      className="px-4 py-2.5 rounded-xl bg-[#0f4c2a] hover:bg-[#0c3e22] text-white text-xs font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center space-x-1.5 shadow-sm"
                    >
                      <Download className="w-4 h-4 text-[#d4af37]" />
                      <span>Export Excel</span>
                    </button>

                    {registrations.length > 0 && (
                      <button
                        onClick={handleDeleteAllRegistrations}
                        disabled={isSubmitting}
                        className="px-4 py-2.5 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center space-x-1.5 shadow-xs"
                        title="Delete All Registrations (Bulk Reset)"
                      >
                        <Trash2 className="w-4 h-4 text-red-600" />
                        <span>Delete All Registrations</span>
                      </button>
                    )}
                  </div>

                  {/* Registrants Table */}
                  {showRegistrantsTable && (
                    <GMKCard className="bg-white border border-stone-200 overflow-hidden shadow-xs">
                      <div className="p-4 border-b border-stone-150 flex items-center justify-between">
                        <h4 className="font-extrabold text-[#0f4c2a] text-xs uppercase tracking-wider font-heading">Active Registrants List</h4>
                        <span className="text-[10px] font-mono text-stone-500 font-bold">{registrations.length} registration(s)</span>
                      </div>

                      {registrations.length === 0 ? (
                        <p className="p-6 text-center text-stone-500 font-bold italic">No registrants have signed up for this gathering yet.</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="bg-stone-50 border-b border-stone-200 text-[10px] uppercase font-black text-stone-500 tracking-wider">
                                <th className="p-3">GMK / Reg ID</th>
                                <th className="p-3">Name of Person Registered</th>
                                <th className="p-3">Unit Number</th>
                                <th className="p-3 text-center">Adults</th>
                                <th className="p-3 text-center">Children</th>
                                <th className="p-3 text-center">Total Participants</th>
                                <th className="p-3 text-right">Amount to Pay</th>
                                <th className="p-3 text-center">Payment Status</th>
                                <th className="p-3 text-center">Actions</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-stone-150 text-stone-750 font-bold font-sans text-xs">
                              {registrations.map(reg => {
                                const fam = families.find(f => f.id === reg.familyId);
                                const primaryName = fam ? fam.fullName : (reg.primaryMemberEmail ? reg.primaryMemberEmail.split('@')[0] : 'Unknown');
                                const unit = fam ? fam.displayUnitNumber : 'Unknown';
                                const famMembers = familyMembers.filter(m => m.familyId === reg.familyId);
                                const participants = reg.participants || [];

                                let adults = 0;
                                let children = 0;

                                if (reg.paymentSummary && typeof reg.paymentSummary.childrenCount === 'number') {
                                  children = reg.paymentSummary.childrenCount;
                                  adults = Math.max(0, participants.length - children);
                                } else {
                                  participants.forEach(name => {
                                    if (name === primaryName) {
                                      adults++;
                                    } else {
                                      const match = famMembers.find(m => m.name.toLowerCase().trim() === name.toLowerCase().trim());
                                      if (match && match.relationship === 'child') {
                                        children++;
                                      } else {
                                        adults++;
                                      }
                                    }
                                  });
                                }

                                const amountToPay = reg.paymentAmount ?? reg.paymentSummary?.totalAmount ?? 0;
                                const pStatus = reg.paymentStatus || (amountToPay === 0 ? 'waived' : 'pending');
                                
                                return (
                                  <tr key={reg.id} className="hover:bg-stone-50/50">
                                    <td className="p-3 font-mono text-[10px] text-stone-600 uppercase">
                                      {reg.primaryMemberGmkId || reg.id.split('_')?.[1] || 'N/A'}
                                    </td>
                                    <td className="p-3">
                                      <span className="text-stone-900 font-black block">{primaryName}</span>
                                      <span className="text-[10px] text-stone-500 font-medium font-mono">{reg.primaryMemberEmail}</span>
                                    </td>
                                    <td className="p-3 font-mono text-[11px] text-emerald-800 font-bold">{unit}</td>
                                    <td className="p-3 text-center">
                                      <span className="px-2 py-0.5 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded font-bold text-[10px]">
                                        {adults}
                                      </span>
                                    </td>
                                    <td className="p-3 text-center">
                                      <span className="px-2 py-0.5 bg-amber-50 text-amber-800 border border-amber-200 rounded font-bold text-[10px]">
                                        {children}
                                      </span>
                                    </td>
                                    <td className="p-3 text-center font-black text-stone-900">{reg.totalParticipants || (adults + children)}</td>
                                    <td className="p-3 text-right font-mono font-black text-[#0f4c2a]">
                                      OMR {amountToPay.toFixed(3)}
                                    </td>
                                    <td className="p-3 text-center">
                                      <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider border ${
                                        pStatus === 'paid' || pStatus === 'approved' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' :
                                        pStatus === 'waived' ? 'bg-blue-50 text-blue-800 border-blue-200' :
                                        'bg-amber-50 text-amber-800 border-amber-200'
                                      }`}>
                                        {pStatus}
                                      </span>
                                    </td>
                                    <td className="p-3 text-center">
                                      <button
                                        onClick={() => handleDeleteRegistration(reg)}
                                        disabled={isSubmitting}
                                        className="px-2.5 py-1 rounded-lg border border-red-200 hover:border-red-600 hover:bg-red-50 text-red-600 transition-all cursor-pointer inline-flex items-center space-x-1"
                                        title="Delete Registration"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                        <span className="text-[10px] font-black uppercase">Delete</span>
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </GMKCard>
                  )}
                </div>
              ) : (
                <div className="text-center py-12 text-stone-500 font-bold bg-white rounded-2xl border border-stone-150">
                  Select an active event from the top right or Events tab to view registrations.
                </div>
              )}
            </div>
          )}


          {/* 6. REPORTS TAB */}
          {activeTab === 'reports' && (
            <div className="space-y-6 animate-fadeIn font-sans">
              <div className="border-b border-stone-200 pb-3 flex flex-col md:flex-row md:items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-extrabold text-[#0f4c2a] uppercase tracking-wider font-heading">
                    Reports : Reports
                  </h3>
                  <p className="text-stone-550 text-[10px] font-bold">Consolidated review of financial statements, coordination stats, and attendance tallies.</p>
                </div>
              </div>

              {selectedEventId && activeEvent ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Financial & Tally Sheet Card */}
                  <GMKCard className="bg-white border border-stone-200 p-5 rounded-2xl shadow-xs space-y-4">
                    <div className="border-b border-stone-150 pb-2">
                      <h4 className="font-extrabold text-[#0f4c2a] text-xs uppercase tracking-wider font-heading flex items-center space-x-1.5">
                        <span>📊</span>
                        <span>Registrations</span>
                      </h4>
                      <p className="text-[9px] text-stone-500 font-bold mt-0.5">Registrations</p>
                    </div>

                    {(() => {
                      const stats = calculateStats();
                      return (
                        <div className="space-y-3.5">
                          <div className="border border-stone-150 rounded-2xl overflow-hidden divide-y divide-stone-150 text-xs font-semibold">
                            <div className="p-3 bg-stone-50 flex justify-between">
                              <span className="text-stone-500">Event Status:</span>
                              <span className="font-extrabold uppercase text-blue-700">{configStatus}</span>
                            </div>
                            <div className="p-3 flex justify-between">
                              <span className="text-stone-500">Total Registered Units:</span>
                              <span className="font-extrabold text-stone-900">{stats.familiesCount} household units</span>
                            </div>
                            <div className="p-3 flex justify-between">
                              <span className="text-stone-500">Registered:</span>
                              <span className="font-extrabold text-stone-900">{stats.residentsCount} attendees</span>
                            </div>
                            <div className="p-3 flex justify-between">
                              <span className="text-stone-500">Adult Count:</span>
                              <span className="font-extrabold text-stone-900">{stats.adultsCount} adults</span>
                            </div>
                            <div className="p-3 flex justify-between">
                              <span className="text-stone-500">Children Count:</span>
                              <span className="font-extrabold text-stone-900">{stats.childrenCount} children</span>
                            </div>
                            <div className="p-3 flex justify-between">
                              <span className="text-stone-500">Event Venue:</span>
                              <span className="font-extrabold text-stone-900">{configVenue || 'Not Set'}</span>
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => setShowSummaryModal(true)}
                              className="px-3.5 py-2 text-[10px] font-black uppercase tracking-wider border border-stone-250 bg-white hover:bg-stone-50 text-stone-700 rounded-lg transition-all cursor-pointer shadow-xs"
                            >
                              Reports
                            </button>
                            <button
                              type="button"
                              onClick={handleExportCSV}
                              className="px-3.5 py-2 text-[10px] font-black uppercase tracking-wider bg-[#0f4c2a] hover:bg-[#0c3e22] text-white rounded-lg transition-all cursor-pointer shadow-xs"
                            >
                              Export Report CSV
                            </button>
                          </div>
                        </div>
                      );
                    })()}
                  </GMKCard>

                  {/* Program Coordination & Committees Summary Card */}
                  <GMKCard className="bg-white border border-stone-200 p-5 rounded-2xl shadow-xs space-y-4">
                    <div className="border-b border-stone-150 pb-2">
                      <h4 className="font-extrabold text-[#0f4c2a] text-xs uppercase tracking-wider font-heading flex items-center space-x-1.5">
                        <span>🤝</span>
                        <span>Committees & Programs Readiness</span>
                      </h4>
                      <p className="text-[9px] text-stone-500 font-bold mt-0.5">Assigned leadership, coordinator status, and team assignments.</p>
                    </div>

                    <div className="space-y-3.5 text-xs">
                      <div className="border border-stone-150 rounded-2xl overflow-hidden divide-y divide-stone-150">
                        <div className="p-3 bg-stone-50 flex justify-between items-center font-semibold">
                          <span className="text-stone-500">Active Committees:</span>
                          <span className="font-extrabold text-stone-900">{activeCommittees.length}</span>
                        </div>
                        <div className="p-3 flex justify-between items-center font-semibold">
                          <span className="text-stone-500">Committee Leads Assigned:</span>
                          <span className="font-extrabold text-stone-900">
                            {activeCommittees.reduce((acc, curr) => acc + (curr.members || []).filter(m => m.role === 'Lead').length, 0)}
                          </span>
                        </div>
                        <div className="p-3 flex justify-between items-center font-semibold">
                          <span className="text-stone-500">Active Programs:</span>
                          <span className="font-extrabold text-stone-900">
                            {activePrograms.filter(p => p.eventId === selectedEventId).length}
                          </span>
                        </div>
                        <div className="p-3 flex justify-between items-center font-semibold">
                          <span className="text-stone-500">Total Program Coordinators:</span>
                          <span className="font-extrabold text-stone-900">
                            {activePrograms.filter(p => p.eventId === selectedEventId && p.coordinatorGmkId).length}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setShowCommitteeDataModal(true)}
                          className="px-3.5 py-2 text-[10px] font-black uppercase tracking-wider border border-stone-250 bg-white hover:bg-stone-50 text-stone-700 rounded-lg transition-all cursor-pointer shadow-xs flex items-center space-x-1.5"
                        >
                          <span>👥</span>
                          <span>Committee data</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleExportCommitteeDataPDF}
                          className="px-3.5 py-2 text-[10px] font-black uppercase tracking-wider bg-[#0f4c2a] hover:bg-[#0c3e22] text-white rounded-lg transition-all cursor-pointer shadow-xs flex items-center space-x-1.5"
                        >
                          <span>📄</span>
                          <span>Export to PDF</span>
                        </button>
                      </div>

                      <div className="p-3 bg-stone-50 border border-stone-200 rounded-xl">
                        <p className="text-[10px] text-stone-600 font-bold leading-relaxed">
                          Want to adjust committee assignments or programs? Go to the <span className="text-[#0f4c2a] underline font-extrabold cursor-pointer" onClick={() => setActiveTab('committees')}>Committees</span> section to assign leads or add events directly.
                        </p>
                      </div>
                    </div>
                  </GMKCard>

                  {/* Certificates Section */}
                  <div className="md:col-span-2 pt-4">
                    <GMKCard className="bg-white border border-stone-200 p-5 rounded-2xl shadow-xs space-y-4">
                      <div className="border-b border-stone-150 pb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div>
                          <h4 className="font-extrabold text-[#0f4c2a] text-xs uppercase tracking-wider font-heading flex items-center space-x-1.5">
                            <span>📜</span>
                            <span>Certificates</span>
                          </h4>
                          <p className="text-[9px] text-stone-500 font-bold mt-0.5">
                            Generate official PDF certificates for Committee Leads, Coordinators, Volunteers, and Program Participants.
                          </p>
                        </div>

                        {(() => {
                          const recipients = getCertificateRecipients();
                          return (
                            <button
                              type="button"
                              onClick={() => generateBulkCertificatesPDF(recipients)}
                              disabled={recipients.length === 0}
                              className="px-4 py-2 bg-[#0f4c2a] hover:bg-[#0c3e22] disabled:opacity-50 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer shadow-xs flex items-center space-x-1.5 shrink-0"
                            >
                              <span>📥</span>
                              <span>Download All Certificates (PDF)</span>
                            </button>
                          );
                        })()}
                      </div>

                      {/* Filter Sub-Tabs & Search */}
                      {(() => {
                        const allRecipients = getCertificateRecipients();
                        const filteredRecipients = allRecipients.filter(r => {
                          const matchesTab = certTab === 'all' ? true :
                            certTab === 'leads' ? r.type === 'Committee Lead' :
                            certTab === 'coordinators' ? r.type === 'Coordinator' :
                            certTab === 'volunteers' ? r.type === 'Volunteer' :
                            certTab === 'participants' ? r.type === 'Participant' : true;

                          const matchesSearch = certSearch.trim() === '' ? true :
                            r.name.toLowerCase().includes(certSearch.toLowerCase()) ||
                            r.roleOrProgram.toLowerCase().includes(certSearch.toLowerCase());

                          return matchesTab && matchesSearch;
                        });

                        return (
                          <div className="space-y-4">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                              {/* Filter Tabs */}
                              <div className="flex flex-wrap gap-1 bg-stone-100 p-1 rounded-xl border border-stone-200 text-[10px] font-extrabold font-mono">
                                {[
                                  { id: 'all', label: 'All', count: allRecipients.length },
                                  { id: 'leads', label: 'Committee Leads', count: allRecipients.filter(r => r.type === 'Committee Lead').length },
                                  { id: 'coordinators', label: 'Coordinators', count: allRecipients.filter(r => r.type === 'Coordinator').length },
                                  { id: 'volunteers', label: 'Volunteers', count: allRecipients.filter(r => r.type === 'Volunteer').length },
                                  { id: 'participants', label: 'Participants', count: allRecipients.filter(r => r.type === 'Participant').length }
                                ].map(tab => (
                                  <button
                                    key={tab.id}
                                    type="button"
                                    onClick={() => setCertTab(tab.id as any)}
                                    className={`px-2.5 py-1 rounded-lg uppercase tracking-wider transition-all cursor-pointer flex items-center space-x-1 ${
                                      certTab === tab.id
                                        ? 'bg-[#0f4c2a] text-white shadow-xs'
                                        : 'text-stone-600 hover:text-stone-900 hover:bg-stone-200/60'
                                    }`}
                                  >
                                    <span>{tab.label}</span>
                                    <span className={`px-1.5 py-0.2 rounded-full text-[8px] ${certTab === tab.id ? 'bg-white/20 text-white' : 'bg-stone-200 text-stone-700'}`}>
                                      {tab.count}
                                    </span>
                                  </button>
                                ))}
                              </div>

                              {/* Search Box */}
                              <input
                                type="text"
                                value={certSearch}
                                onChange={(e) => setCertSearch(e.target.value)}
                                placeholder="Search recipient name..."
                                className="px-3 py-1.5 bg-stone-50 border border-stone-200 rounded-xl text-xs text-stone-850 font-bold focus:outline-none focus:ring-1 focus:ring-[#0f4c2a] w-full sm:w-48"
                              />
                            </div>

                            {/* Recipients List Table */}
                            {filteredRecipients.length === 0 ? (
                              <div className="text-center py-8 text-stone-400 font-bold text-xs bg-stone-50 border border-dashed border-stone-200 rounded-xl">
                                No certificate recipients found matching criteria.
                              </div>
                            ) : (
                              <div className="border border-stone-200 rounded-2xl overflow-hidden divide-y divide-stone-150 text-xs">
                                {filteredRecipients.map((rec) => (
                                  <div key={rec.id} className="p-3.5 bg-white hover:bg-stone-50/80 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                    <div className="space-y-0.5">
                                      <div className="flex items-center space-x-2">
                                        <span className="font-extrabold text-stone-900">{rec.name}</span>
                                        <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider border ${
                                          rec.type === 'Committee Lead' ? 'bg-amber-50 text-amber-800 border-amber-200' :
                                          rec.type === 'Coordinator' ? 'bg-blue-50 text-blue-800 border-blue-200' :
                                          rec.type === 'Volunteer' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' :
                                          'bg-purple-50 text-purple-800 border-purple-200'
                                        }`}>
                                          {rec.type}
                                        </span>
                                      </div>
                                      <p className="text-[10px] text-stone-500 font-bold">{rec.context}</p>
                                    </div>

                                    <button
                                      type="button"
                                      onClick={() => generateSingleCertificatePDF(rec)}
                                      className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-[#0f4c2a] border border-emerald-200 rounded-xl transition-all cursor-pointer font-extrabold text-[10px] uppercase tracking-wider flex items-center space-x-1 shrink-0"
                                    >
                                      <span>📜</span>
                                      <span>Download PDF Certificate</span>
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </GMKCard>
                  </div>
                </div>
              ) : (
                <div className="text-center py-12 text-stone-500 font-bold bg-white rounded-2xl border border-stone-150">
                  Select an active event from the top right or Events tab to view analytics.
                </div>
              )}
            </div>
          )}

        </main>
      </div>

      {/* Global Summary Modal Overlay */}
      {showSummaryModal && activeEvent && (() => {
        const stats = calculateStats();
        return (
          <div className="fixed inset-0 bg-stone-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white border border-stone-200 rounded-3xl max-w-md w-full shadow-2xl p-6 relative space-y-4 animate-scaleUp text-stone-850 font-sans">
              <button
                onClick={() => setShowSummaryModal(false)}
                className="absolute right-4 top-4 text-stone-400 hover:text-stone-900 transition-colors cursor-pointer font-black"
              >
                <X className="w-5 h-5" />
              </button>

              <div>
                <span className="text-[10px] font-extrabold font-mono text-[#d4af37] block uppercase tracking-wider">Registrations</span>
                <h3 className="text-base font-extrabold text-[#0f4c2a] font-heading capitalize mt-0.5">{activeEvent.eventName || activeEvent.title}</h3>
              </div>

              <div className="border border-stone-150 rounded-2xl overflow-hidden divide-y divide-stone-150 text-xs font-semibold">
                <div className="p-3 bg-stone-50 flex justify-between">
                  <span className="text-stone-500">Event Status:</span>
                  <span className="font-extrabold uppercase text-blue-700">{configStatus}</span>
                </div>
                <div className="p-3 flex justify-between">
                  <span className="text-stone-500">Total Registered Units:</span>
                  <span className="font-extrabold text-stone-900">{stats.familiesCount} household units</span>
                </div>
                <div className="p-3 flex justify-between">
                  <span className="text-stone-500">Registered:</span>
                  <span className="font-extrabold text-stone-900">{stats.residentsCount} attendees</span>
                </div>
                <div className="p-3 flex justify-between">
                  <span className="text-stone-500">Adult Count:</span>
                  <span className="font-extrabold text-stone-900">{stats.adultsCount} adults</span>
                </div>
                <div className="p-3 flex justify-between">
                  <span className="text-stone-500">Children Count:</span>
                  <span className="font-extrabold text-stone-900">{stats.childrenCount} children</span>
                </div>
                <div className="p-3 flex justify-between">
                  <span className="text-stone-500">Event Venue:</span>
                  <span className="font-extrabold text-stone-900">{configVenue || 'Not Set'}</span>
                </div>
              </div>

              <button
                onClick={() => setShowSummaryModal(false)}
                className="w-full py-2.5 bg-[#0f4c2a] hover:bg-[#125831] text-white font-bold uppercase tracking-wider text-[10px] rounded-xl cursor-pointer"
              >
                Close Summary View
              </button>
            </div>
          </div>
        );
      })()}

      {/* Global Committee Data Modal Overlay */}
      {showCommitteeDataModal && activeEvent && (
        <div className="fixed inset-0 bg-stone-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-stone-200 rounded-3xl max-w-lg w-full shadow-2xl p-6 relative space-y-4 animate-scaleUp text-stone-850 font-sans max-h-[85vh] overflow-y-auto">
            <div className="sticky top-0 bg-white z-10 flex items-start justify-between border-b border-stone-150 pb-3">
              <div>
                <span className="text-[10px] font-extrabold font-mono text-[#d4af37] block uppercase tracking-wider">Committee Roster</span>
                <h3 className="text-sm font-extrabold text-[#0f4c2a] font-heading capitalize mt-0.5">
                  Committee Data — {activeEvent.eventName || activeEvent.title}
                </h3>
              </div>
              <button
                onClick={() => setShowCommitteeDataModal(false)}
                className="text-stone-400 hover:text-stone-900 transition-colors cursor-pointer font-black p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs font-semibold">
              {activeCommittees.filter(c => c.status !== 'archived').length === 0 ? (
                <p className="text-stone-400 italic text-center py-6">No active committees configured.</p>
              ) : (
                activeCommittees.filter(c => c.status !== 'archived').map(comm => {
                  const leads = (comm.members || []).filter(m => m.role === 'Lead').map(m => m.fullName);
                  const volunteers = (comm.members || []).filter(m => m.role !== 'Lead').map(m => m.fullName);

                  return (
                    <div key={comm.id} className="border border-stone-200 rounded-2xl p-4 bg-stone-50/50 space-y-3">
                      <div className="flex items-center justify-between border-b border-stone-200 pb-2">
                        <h4 className="font-extrabold text-[#0f4c2a] font-heading text-xs uppercase">{comm.name}</h4>
                        <span className="text-[9px] font-bold text-stone-500 bg-white px-2 py-0.5 rounded-md border border-stone-200">
                          {leads.length} Leads • {volunteers.length} Volunteers
                        </span>
                      </div>

                      <div className="space-y-2">
                        <div>
                          <span className="text-[10px] font-black uppercase text-stone-500 block mb-1">Leads:</span>
                          {leads.length === 0 ? (
                            <span className="text-stone-400 italic text-[11px]">None assigned</span>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {leads.map((name, i) => (
                                <span key={i} className="px-2.5 py-1 bg-amber-50 text-amber-900 border border-amber-200 rounded-lg text-[11px] font-bold">
                                  {name}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>

                        <div>
                          <span className="text-[10px] font-black uppercase text-stone-500 block mb-1">Volunteers:</span>
                          {volunteers.length === 0 ? (
                            <span className="text-stone-400 italic text-[11px]">None assigned</span>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {volunteers.map((name, i) => (
                                <span key={i} className="px-2.5 py-1 bg-emerald-50 text-emerald-900 border border-emerald-200 rounded-lg text-[11px] font-bold">
                                  {name}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="pt-2 flex justify-end gap-2 border-t border-stone-150">
              <button
                type="button"
                onClick={handleExportCommitteeDataPDF}
                className="px-4 py-2 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white font-bold uppercase tracking-wider text-[10px] rounded-xl cursor-pointer shadow-xs flex items-center space-x-1"
              >
                <span>📄</span>
                <span>Export to PDF</span>
              </button>
              <button
                type="button"
                onClick={() => setShowCommitteeDataModal(false)}
                className="px-4 py-2 bg-stone-200 hover:bg-stone-300 text-stone-700 font-bold uppercase tracking-wider text-[10px] rounded-xl cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {isConfirmOpen && confirmOptions && (
        <GEASConfirmationDialogUI
          options={confirmOptions}
          onConfirm={handleConfirmSubmit}
          onCancel={handleConfirmCancel}
        />
      )}
    </div>
  );
}
