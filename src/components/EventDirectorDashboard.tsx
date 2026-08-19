import FinanceWorkspace from "./FinanceWorkspace";
import RegistrationReportingWorkspace from "./RegistrationReportingWorkspace";
import AttendanceWorkspace from "./AttendanceWorkspace";
import React, { useState, useEffect } from 'react';
import { Scanner } from '@yudiel/react-qr-scanner';
import { jsPDF } from 'jspdf';
import { db, useAuth, storage, auth, functions } from '../context/AuthContext';
import { httpsCallable } from 'firebase/functions';
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
  EventAttendance,
  Family,
  FamilyMember,
  PaymentAccount,
  EventPricingConfig
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
  Edit3,
  QrCode,
  Receipt,
  CreditCard,
  Printer,
  DollarSign,
  ChevronDown,
  ChevronUp,
  ArrowDownCircle, 
  PieChart, 
  HeartHandshake,
  Save,
  Edit2
} from 'lucide-react';
import { GMKCard, GMKBadge } from './gmk/DesignSystem';
import { useLocalGEASConfirmation, GEASConfirmationDialogUI } from './gmk/GEASConfirmationDialog';
import { createAuditLog } from '../utils/audit';
import { getEventRegistrationStatus, getRegistrationStatusLabel } from '../utils/eventLifecycle';

type EDTab = 'events' | 'configuration' | 'committees' | 'programs' | 'registrations' | 'reports' | 'finance';

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
  initialTabTarget?: string | null;
  userResponsibilities?: any[];
}

export default function EventDirectorDashboard({ onBackToResidentPortal, initialTabTarget, userResponsibilities = [] }: EventDirectorDashboardProps) {
  const { profile } = useAuth();
  
  const { confirm: showConfirm, isOpen: isConfirmOpen, options: confirmOptions, handleCancel: handleConfirmCancel, handleConfirm: handleConfirmSubmit } = useLocalGEASConfirmation();
  const userRolesList = profile?.roles || [];
  const isGlobalED = userRolesList.some((r: string) => ['event_director', 'admin', 'super_admin', 'president', 'vp', 'vice_president'].includes(r));
  const isFinanceLeadAuth = userResponsibilities.some(r => r.committee && r.committee.toLowerCase().includes('finance')) ||
    userRolesList.some((r: string) => r.includes('finance'));
  const isProgramLeadAuth = userResponsibilities.some(r => r.committee && r.committee.toLowerCase().includes('program')) ||
    userRolesList.some((r: string) => r.includes('program'));
  const showFinanceTab = isGlobalED || isFinanceLeadAuth;

  const [activeTab, setActiveTab] = useState<EDTab>(() => {
    if (initialTabTarget) {
      const target = initialTabTarget.toLowerCase();
      if (target.includes('finance')) return 'finance';
      if (target.includes('program')) return 'programs';
      if (target.includes('registration')) return 'registrations';
      return 'committees';
    }
    if (!isGlobalED) {
      if (showFinanceTab) return 'finance';
      const firstComm = userResponsibilities.find(r => r.committee && !r.committee.toLowerCase().includes('finance') && !r.committee.toLowerCase().includes('program'));
      if (firstComm) return 'committees';
      if (isProgramLeadAuth) return 'programs';
    }
    return 'events';
  });
  
  // Real-time Firestore collections
  const [events, setEvents] = useState<CommunityEvent[]>([]);
  const [residents, setResidents] = useState<ResidentProfile[]>([]);
  const [families, setFamilies] = useState<Family[]>([]);
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([]);

  // Selected active Event Master reference
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [activeEvent, setActiveEvent] = useState<CommunityEvent | null>(null);
  const [eventFinance, setEventFinance] = useState<any | null>(null);

  // Active event's sub-collections (synced in real-time)
  const [activeCommittees, setActiveCommittees] = useState<EventCommittee[]>([]);
  const [activePrograms, setActivePrograms] = useState<EventProgram[]>([]);
  const [registrations, setRegistrations] = useState<EventRegistration[]>([]);
  const [activeAttendances, setActiveAttendances] = useState<EventAttendance[]>([]);

  // Finance Committee Workspace & Payment Processing States
  const [financeTab, setFinanceTab] = useState<'registrations' | 'expenses' | 'reports' | 'refunds'>('registrations');
  const [financeLeadsExpanded, setFinanceLeadsExpanded] = useState<boolean>(false);
  const [finEventFilter, setFinEventFilter] = useState<string>('all');
  const [finStatusFilter, setFinStatusFilter] = useState<string>('all');
  const [finSearchQuery, setFinSearchQuery] = useState<string>('');

  // Record / Process Payment Modal State
  const [paymentModalReg, setPaymentModalReg] = useState<EventRegistration | null>(null);
  const [paymentModalAmtRec, setPaymentModalAmtRec] = useState<string>('');
  const [paymentModalRemarks, setPaymentModalRemarks] = useState<string>('');

  // Attendance Gate Check-In & Scanner States
  const [attendanceScanInput, setAttendanceScanInput] = useState<string>('');
  const [attendanceScannedReg, setAttendanceScannedReg] = useState<EventRegistration | null>(null);
  const [attendanceScanFilter, setAttendanceScanFilter] = useState<'all' | 'attended' | 'pending'>('all');
  const [checkInSelection, setCheckInSelection] = useState<Record<string, boolean>>({});
  const [qrScannerOpen, setQrScannerOpen] = useState(false);

  // Local navigation & sub-state
  const [showNewEventForm, setShowNewEventForm] = useState(false);
  const [activeCommitteeToConfigure, setActiveCommitteeToConfigure] = useState<string | null>(() => {
    if (initialTabTarget) {
      const target = initialTabTarget.toLowerCase();
      if (target.includes('finance') || target.includes('program') || target.includes('registration')) return null;
      return initialTabTarget;
    }
    if (!isGlobalED && !showFinanceTab) {
      const firstComm = userResponsibilities.find(r => r.committee && !r.committee.toLowerCase().includes('finance') && !r.committee.toLowerCase().includes('program'));
      if (firstComm) return firstComm.committee;
    }
    return null;
  });
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
  const [foodTab, setFoodTab] = useState<'events' | 'expenses'>('events');
  const [attendanceTab, setAttendanceTab] = useState<'events' | 'attendance' | 'expenses' | 'reports'>('events');

  // Workspace and unique Program configuration states
  const [progTitle, setProgTitle] = useState('');
  const [progOwningCommittee, setProgOwningCommittee] = useState<string>('');
  const [isCreateProgOpen, setIsCreateProgOpen] = useState<boolean>(false);
  const [progType, setProgType] = useState('Select');
  const [progDescription, setProgDescription] = useState('');
  const [progCoordinator, setProgCoordinator] = useState<ResidentProfile | null>(null);
  const [progCoordinatorSearch, setProgCoordinatorSearch] = useState('');
  const [expenseTitle, setExpenseTitle] = useState('');
  const [expenseDate, setExpenseDate] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [commExpenseDate, setCommExpenseDate] = useState('');
  const [commExpenseDesc, setCommExpenseDesc] = useState('');
  const [commExpenseAmount, setCommExpenseAmount] = useState('');
  const [activeProgForManagement, setActiveProgForManagement] = useState<string | null>(null);
  const [workingProgram, setWorkingProgram] = useState<any>(null);
  const [isEditingProgram, setIsEditingProgram] = useState(false);
  const [isProgramDirty, setIsProgramDirty] = useState(false);
  const [editingProgramId, setEditingProgramId] = useState<string | null>(null);
  const [editProgTitle, setEditProgTitle] = useState('');
  const [editProgCategory, setEditProgCategory] = useState<string>('ADULTS');
  const [editProgDescription, setEditProgDescription] = useState('');

  // Search states inside workspaces
  const [workspaceSearchQuery, setWorkspaceSearchQuery] = useState('');
  const [progCoordSearchQuery, setProgCoordSearchQuery] = useState('');
  const [progVolSearchQuery, setProgVolSearchQuery] = useState('');
  const [progVolRoleInput, setProgVolRoleInput] = useState('');
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
        setActiveTab('programs');
        setActiveProgForManagement(progId);
      }
    }
  }, []);

  // Sync working program
  useEffect(() => {
    if (activeProgForManagement) {
      const prog = activePrograms.find(p => p.id === activeProgForManagement);
      if (prog && !isProgramDirty) {
        setWorkingProgram(JSON.parse(JSON.stringify(prog)));
      }
    } else {
      setWorkingProgram(null);
      setIsEditingProgram(false);
      setIsProgramDirty(false);
    }
  }, [activeProgForManagement, activePrograms, isProgramDirty]);

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

    // Load Finance Record
    const unsubFinance = onSnapshot(doc(db, "eventFinance", `fin_${selectedEventId}`), (snap) => {
      if (snap.exists()) {
        setEventFinance({ id: snap.id, ...snap.data() });
      } else {
        setEventFinance(null);
      }
    });

    // Load active event sub-collections
    const qCommittees = query(collection(db, "eventCommittees"), where("eventId", "==", selectedEventId));
    const unsubCommittees = onSnapshot(qCommittees, (snap) => {
      const rawList: EventCommittee[] = [];
      snap.forEach(d => {
        const cData = d.data() as EventCommittee;
        let cName = cData.name || '';
        // Skip obsolete legacy Event&Program / Program committee from active operational committees list
        if (['event&program', 'event & program'].includes(cName.toLowerCase())) {
          return;
        }
        if (cName.toLowerCase() === 'stage & decor') {
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
      snap.forEach(d => list.push({ id: d.id, ...d.data() } as EventRegistration));
      setRegistrations(list);
      setLastFirestoreReadStatus('OK');
    }, (err) => {
      console.warn("⚠️ [EventDirectorDashboard] EventRegistrations snapshot permission-denied or blocked:", err);
      setLastFirestoreReadStatus('ERROR: ' + err.code);
    });

    const qAtts = query(collection(db, "eventAttendance"), where("eventId", "==", selectedEventId));
    const unsubAtts = onSnapshot(qAtts, (snap) => {
      const list: EventAttendance[] = [];
      snap.forEach(d => list.push(d.data() as EventAttendance));
      setActiveAttendances(list);
    }, (err) => {
      console.warn("⚠️ [EventDirectorDashboard] EventAttendance snapshot permission-denied or blocked:", err);
    });

    return () => {
      unsubFinance();
      unsubCommittees();
      unsubPrograms();
      unsubRegs();
      unsubAtts();
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

      // Create standard operational committees for the event
      const defaultCommittees = ['Attendance', 'Finance', 'Food', 'Cultural', 'Sports', 'Sponsorship', 'Sourcing'];
      for (const commName of defaultCommittees) {
        const commDocId = `${eventId}_${commName.replace(/\s+/g, '_')}`;
        const canonicalType = (['finance', 'food', 'attendance', 'sourcing', 'sponsorship', 'program', 'events_&_programs'].includes(commName.toLowerCase()) ? (commName.toLowerCase() === 'events_&_programs' || commName.toLowerCase() === 'programs') ? 'program' : commName.toLowerCase() : 'general') as any;
        const committeePayload: EventCommittee = {
          id: commDocId,
          eventId: eventId,
          name: commName,
          type: canonicalType,
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
  const handleUpdateFinance = async (updates: any) => {
    if (!selectedEventId) return;
    try {
      setIsSubmitting(true);
      const finRef = doc(db, "eventFinance", `fin_${selectedEventId}`);
      const snap = await getDoc(finRef);
      if (snap.exists()) {
        await updateDoc(finRef, { ...updates, updatedAt: new Date().toISOString() });
      } else {
        await setDoc(finRef, {
          eventId: selectedEventId,
          committeeKey: 'finance',
          openingBalance: 0,
          budgetAllocations: {},
          sponsorshipIncome: [],
          status: 'draft',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          ...updates
        });
      }
      setSuccessMsg('Finance record updated successfully.');
    } catch (err: any) {
      console.error(err);
      setErrorMsg('Failed to update finance record.');
    } finally {
      setIsSubmitting(false);
    }
  };

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

      const [attSnap, foodSnap, certSnap] = await Promise.all([
        getDoc(attRef),
        getDoc(foodRef),
        getDoc(certRef)
      ]);

      // Stage 4: Primary Registration Deletion (Critical Operation)
      console.log("[DELETE PRIMARY] Deleting event_registrations", regId);
      await deleteDoc(regRef);
      console.log("[DELETE PRIMARY SUCCESS] Registration deleted:", regId);

      // Stage 5: Secondary Cleanups & Administrative Updates (Independent, Non-blocking)
      let attStatus = 'SKIPPED';
      let foodStatus = 'SKIPPED';
      let certStatus = 'SKIPPED';

      // 5A. Delete Attendance Doc
      if (attSnap.exists()) {
        try {
          await deleteDoc(attRef);
          attStatus = 'SUCCESS';
          console.log("[DELETE CLEANUP] Attendance deleted:", attRef.id);
        } catch (attErr: any) {
          attStatus = 'PENDING';
          console.warn("[DELETE CLEANUP] Attendance delete failed:", attErr);
        }
      }

      // 5B. Delete Food Coupon Doc
      if (foodSnap.exists()) {
        try {
          await deleteDoc(foodRef);
          foodStatus = 'SUCCESS';
          console.log("[DELETE CLEANUP] Food deleted:", foodRef.id);
        } catch (foodErr: any) {
          foodStatus = 'PENDING';
          console.warn("[DELETE CLEANUP] Food delete failed:", foodErr);
        }
      }

      // 5C. Delete Certificate Doc
      if (certSnap.exists()) {
        try {
          await deleteDoc(certRef);
          certStatus = 'SUCCESS';
          console.log("[DELETE CLEANUP] Certificate deleted:", certRef.id);
        } catch (certErr: any) {
          certStatus = 'PENDING';
          console.warn("[DELETE CLEANUP] Certificate delete failed:", certErr);
        }
      }

      // 5D. Recalculate Report Summary
      try {
        const reportSnap = await getDoc(reportRef);
        if (reportSnap.exists()) {
          const reportData = reportSnap.data();
          const batchReports = writeBatch(db);
          batchReports.update(reportRef, {
            registrationsCount: Math.max(0, (reportData.registrationsCount || 0) - count),
            totalRevenue: Math.max(0, (reportData.totalRevenue || 0) - payment),
            lastUpdated: new Date().toISOString()
          });
          await batchReports.commit();
          console.log("[DELETE CLEANUP] Reports updated");
        }
      } catch (repErr) {
        console.warn("[DELETE CLEANUP] Reports update failed:", repErr);
      }

      // 5E. Recalculate Finance Summary
      try {
        const finSnap = await getDoc(finRef);
        if (finSnap.exists()) {
          const finData = finSnap.data();
          const newRev = Math.max(0, (finData.totalRevenue || 0) - payment);
          const netBal = newRev - (finData.totalExpenses || 0);
          const batchFin = writeBatch(db);
          batchFin.update(finRef, {
            totalRevenue: newRev,
            netBalance: netBal,
            updatedAt: new Date().toISOString()
          });
          await batchFin.commit();
          console.log("[DELETE CLEANUP] Finance updated");
        }
      } catch (finErr) {
        console.warn("[DELETE CLEANUP] Finance update failed:", finErr);
      }

      // 5F. Remove attendee email from Event Master attendees array
      try {
        const remainingRegs = registrations.filter(r => r.id !== regId && r.primaryMemberEmail === reg.primaryMemberEmail);
        if (remainingRegs.length === 0 && activeEvent.attendees) {
          const eventSnap = await getDoc(eventRef);
          if (eventSnap.exists()) {
            const updatedAttendees = (activeEvent.attendees || []).filter(e => e !== reg.primaryMemberEmail);
            const batchEvent = writeBatch(db);
            batchEvent.update(eventRef, { attendees: updatedAttendees });
            await batchEvent.commit();
            console.log("[DELETE CLEANUP] Event master attendees updated");
          }
        }
      } catch (evtErr) {
        console.warn("[DELETE CLEANUP] Event master update failed:", evtErr);
      }

      // Stage 6: Audit
      try {
        await createAuditLog(
          'DELETE_REGISTRATION',
          profile?.email || 'event_director',
          'registration',
          regId,
          `Event Director deleted registration for email '${reg.primaryMemberEmail}' (Count: ${count}, Payment: OMR ${payment}). Attendance Cleanup: ${attStatus}, Food Cleanup: ${foodStatus}, Cert Cleanup: ${certStatus}.`
        );
      } catch (auditErr) {
        console.warn("⚠️ Non-blocking ED Audit log failed:", auditErr);
      }

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
          otherRate: configOtherFee,
          policyVersion: 'v2.0',
          policyRevisionDate: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
          policyRef: `GMK-POL-v2.0-${(activeEvent?.eventCode || selectedEventId || 'GEN').toUpperCase().replace(/[^A-Z0-9]/g, '')}-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}${String(new Date().getDate()).padStart(2, '0')}-${String(new Date().getHours()).padStart(2, '0')}${String(new Date().getMinutes()).padStart(2, '0')}`,
          policyUpdatedAt: new Date().toISOString(),
          policyUpdatedBy: profile?.email || 'event_director'
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


// Helper to format consistent Pricing Policy metadata with reference numbers and timestamps
const getPolicyMetadata = (event: CommunityEvent | null, pricingConfig?: EventPricingConfig) => {
  if (!event) {
    return {
      version: 'v2.0',
      ref: 'GMK-POL-v2.0-GEN-001',
      revisionDate: '16 Aug 2026',
      date: '16 Aug 2026',
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }),
      fullFormatted: '16 Aug 2026',
      iso: new Date().toISOString()
    };
  }
  
  // Stored policy updated date or fallbacks
  const storedPolicyDate = pricingConfig?.policyUpdatedAt || event.pricing?.policyUpdatedAt;
  const rawDate = storedPolicyDate || event.updatedAt || event.createdAt || new Date().toISOString();
  let dateObj = new Date(rawDate);
  if (isNaN(dateObj.getTime())) dateObj = new Date();
  
  // v2.0 Core Heads policy was enacted on 16 Aug 2026
  const v2EnactmentDate = new Date('2026-08-16T00:00:00Z');
  const effectiveDateObj = (!storedPolicyDate || dateObj < v2EnactmentDate) ? new Date('2026-08-16T11:00:00') : dateObj;
  
  const code = (event.eventCode || event.id || 'GEN').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const yyyy = effectiveDateObj.getFullYear();
  const mm = String(effectiveDateObj.getMonth() + 1).padStart(2, '0');
  const dd = String(effectiveDateObj.getDate()).padStart(2, '0');
  const hh = String(effectiveDateObj.getHours()).padStart(2, '0');
  const min = String(effectiveDateObj.getMinutes()).padStart(2, '0');
  
  const version = pricingConfig?.policyVersion || event.pricing?.policyVersion || 'v2.0';
  const ref = pricingConfig?.policyRef || event.pricing?.policyRef || `GMK-POL-${version}-${code}-${yyyy}${mm}${dd}-${hh}${min}`;
  
  const formattedDate = effectiveDateObj.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const formattedTime = effectiveDateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  const revisionDate = pricingConfig?.policyRevisionDate || event.pricing?.policyRevisionDate || '16 Aug 2026';
  
  return {
    version,
    ref,
    revisionDate,
    date: formattedDate,
    time: formattedTime,
    fullFormatted: `${formattedDate} ${formattedTime}`,
    iso: effectiveDateObj.toISOString()
  };
};
const handleDownloadPDF = () => {
    if (!activeEvent) return;
    const doc = new jsPDF();
    const policyMeta = getPolicyMetadata(activeEvent, activeEvent.pricing);

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
    doc.text(`Event Name: ${activeEvent.eventName || activeEvent.title}`, 15, 40);
    doc.text(`Event Code: ${activeEvent.eventCode || 'N/A'}`, 15, 46);
    doc.text(`Policy Reference: ${policyMeta.ref}`, 15, 52);
    doc.text(`Policy Revision: ${policyMeta.version} (Core Heads Schedule)`, 15, 58);
    doc.text(`Revision Date: ${policyMeta.revisionDate}`, 15, 64);
    doc.text(`Policy Effective: ${policyMeta.fullFormatted}`, 15, 70);
    doc.text(`Venue: ${activeEvent.venue || activeEvent.Venue || 'N/A'}`, 15, 76);
    doc.text(`Date of Event: ${activeEvent.date ? new Date(activeEvent.date).toLocaleDateString() : 'N/A'}`, 15, 82);
    doc.text(`Document Exported: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`, 15, 88);
    
    // Sub-header for Pricing Setup
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(15, 76, 42);
    doc.text(`FROZEN REGISTRATION PRICING SCHEDULE (${policyMeta.version} • Rev: ${policyMeta.revisionDate})`, 15, 98);
    
    doc.setLineWidth(0.2);
    doc.setDrawColor(200, 200, 200);
    doc.line(15, 101, 195, 101);
    
    // Setup Table
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(50, 50, 50);
    
    let y = 108;
    const addRow = (label: string, value: string) => {
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
    
    const addRuleRow = (composition: string, rateText: string) => {
      doc.setFont("helvetica", "bold");
      doc.text(composition, 15, y);
      doc.setFont("helvetica", "normal");
      doc.text(rateText, 110, y);
      y += 7;
    };
    
    addRuleRow("• Core 1 Head (e.g. 1 Parent, 0 Children > Free Age):", `OMR ${configIndividualFee.toFixed(3)} (Single Rate)`);
    addRuleRow("• Core 2 Heads (e.g. 2 Parents OR 1 Parent + 1 Child > Free Age):", `OMR ${configCoupleFee.toFixed(3)} (Couple Rate)`);
    addRuleRow("• Core 3+ Heads (e.g. 2 Parents + 1+ Children > Free Age):", `OMR ${configFamilyFee.toFixed(3)} (Family Rate Cap)`);
    addRuleRow("• Children < Free Age:", `OMR 0.000 (Free - Excluded from Core Heads)`);
    addRuleRow("• Extra Adult (Spouse Parents / Own Parents):", `OMR ${configParentFee.toFixed(3)} per parent`);
    addRuleRow("• Extra Adult (Maid / Other Residents):", `OMR ${configOtherFee.toFixed(3)} per person`);
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
    doc.text(`Official Policy Ref: ${policyMeta.ref} • Rev Date: ${policyMeta.revisionDate} • Effective: ${policyMeta.fullFormatted} • Verified on commit.`, 15, y);
    
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
        type: 'general',
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
      unitDisplay: string;
      isFamilyMember: boolean;
      relationship?: string;
      phone?: string;
      gender?: string;
      type?: string;
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
            phone: r.phone || '',
            displayUnitNumber: r.displayUnitNumber,
            unitDisplay: r.displayUnitNumber,
            isFamilyMember: false,
            gender: r.gender,
            relationship: 'Primary Resident',
            type: 'adult'
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
          phone: m.phone || parentRes.phone || '',
          displayUnitNumber: parentRes.displayUnitNumber,
          unitDisplay: parentRes.displayUnitNumber,
          isFamilyMember: true,
          gender: m.gender,
          relationship: m.relationship,
          type: isChild ? 'child' : 'adult'
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

      // Compute canonical committee type for role generation
      let committeeType = committee.type;
      if (!committeeType) {
        const n = committee.name.toLowerCase();
        if (n.includes('finance')) committeeType = 'finance';
        else if (n.includes('food')) committeeType = 'food';
        else if (n.includes('attendance')) committeeType = 'attendance';
        else if (n.includes('program')) committeeType = 'program';
        else if (n.includes('sourcing')) committeeType = 'sourcing';
        else if (n.includes('sponsorship')) committeeType = 'sponsorship';
        else committeeType = 'general';
      }

      const isProgramsCommittee = committeeType === 'program';
      const roleToAssign = isProgramsCommittee ? 'program_lead' : 'committee_lead';
      const specificRoleToAssign = isProgramsCommittee ? 'program_lead' : `committee_lead_${committeeType}`;
      const eventScopedRoleToAssign = isProgramsCommittee ? `program_lead_${selectedEventId}` : `committee_lead_${committeeType}_${selectedEventId}`;

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
            const updatedRoles = Array.from(new Set([...currentRoles, roleToAssign, specificRoleToAssign, eventScopedRoleToAssign]));
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
          committeeType: committeeType,
          eventId: selectedEventId,
          updatedAt: new Date().toISOString()
        }, { merge: true });

        let safeCommitteeKey = committee.name.replace(/\s+/g, '_').toLowerCase();
        if (safeCommitteeKey === 'events_&_programs' || safeCommitteeKey === 'programs') safeCommitteeKey = 'program';
        const assignmentId = `${resident.gmkId}_committee_lead_${safeCommitteeKey}`;
        const emailAssignmentId = `${resident.email.toLowerCase().trim()}_committee_lead_${safeCommitteeKey}`;

        const payload = {
          id: assignmentId,
          gmkId: resident.gmkId,
          email: resident.email.toLowerCase().trim(),
          position: roleToAssign,
          role: roleToAssign,
          committee: committee.name,
          committeeType: committeeType,
          eventId: selectedEventId,
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

      // Compute canonical committee type for role generation
      let committeeType = committee.type;
      if (!committeeType) {
        const n = committee.name.toLowerCase();
        if (n.includes('finance')) committeeType = 'finance';
        else if (n.includes('food')) committeeType = 'food';
        else if (n.includes('attendance')) committeeType = 'attendance';
        else if (n.includes('program')) committeeType = 'program';
        else if (n.includes('sourcing')) committeeType = 'sourcing';
        else if (n.includes('sponsorship')) committeeType = 'sponsorship';
        else committeeType = 'general';
      }

      const isProgramsCommittee = committeeType === 'program';
      const roleToAssign = isProgramsCommittee ? 'program_lead' : 'committee_lead';
      const specificRoleToAssign = isProgramsCommittee ? 'program_lead' : `committee_lead_${committeeType}`;
      const eventScopedRoleToAssign = isProgramsCommittee ? `program_lead_${selectedEventId}` : `committee_lead_${committeeType}_${selectedEventId}`;

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
            const updatedRoles = Array.from(new Set([...currentRoles, roleToAssign, specificRoleToAssign, eventScopedRoleToAssign]));
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
          committeeType: committeeType,
          eventId: selectedEventId,
          updatedAt: new Date().toISOString()
        }, { merge: true });

        let safeCommitteeKey = committee.name.replace(/\s+/g, '_').toLowerCase();
        if (safeCommitteeKey === 'events_&_programs' || safeCommitteeKey === 'programs') safeCommitteeKey = 'program';
        const assignmentId = `${resident.gmkId}_committee_lead_${safeCommitteeKey}`;
        const emailAssignmentId = `${resident.email.toLowerCase().trim()}_committee_lead_${safeCommitteeKey}`;

        const payload = {
          id: assignmentId,
          gmkId: resident.gmkId,
          email: resident.email.toLowerCase().trim(),
          position: roleToAssign,
          role: roleToAssign,
          committee: committee.name,
          committeeType: committeeType,
          eventId: selectedEventId,
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
      // Compute canonical committee type for role generation
      let committeeType = committee.type;
      if (!committeeType) {
        const n = committee.name.toLowerCase();
        if (n.includes('finance')) committeeType = 'finance';
        else if (n.includes('food')) committeeType = 'food';
        else if (n.includes('attendance')) committeeType = 'attendance';
        else if (n.includes('program')) committeeType = 'program';
        else if (n.includes('sourcing')) committeeType = 'sourcing';
        else if (n.includes('sponsorship')) committeeType = 'sponsorship';
        else committeeType = 'general';
      }

      const safeCommitteeKey = committeeType;
      const isProgramsCommittee = committeeType === 'program';
      const roleToRemove = isProgramsCommittee ? 'program_lead' : 'committee_lead';
      const specificRoleToRemove = isProgramsCommittee ? 'program_lead' : `committee_lead_${committeeType}`;
      const eventScopedRoleToRemove = isProgramsCommittee ? `program_lead_${selectedEventId}` : `committee_lead_${committeeType}_${selectedEventId}`;

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
        
        for (const userDocRef of userDocRefs) {
          const uDoc = await transaction.get(userDocRef);
          if (uDoc.exists()) {
            const currentRoles: string[] = uDoc.data().roles || [];
            let updatedRoles = currentRoles.filter(r => r !== eventScopedRoleToRemove); // Always remove event-scoped
            
            if (otherAssignments.length === 0) {
              updatedRoles = updatedRoles.filter(r => r !== roleToRemove && r !== specificRoleToRemove);
            }
            
            userRolesUpdates.push({ ref: userDocRef, roles: updatedRoles });
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

      const owningCommittee = activeCommittees.find(c => ['program committee', 'programs', 'program'].includes(c.name.toLowerCase()));

      const rawPayload: EventProgram = {
        id: progId,
        eventId: selectedEventId,
        committeeKey: 'program',
        committeeId: owningCommittee?.id || '',
        committeeName: owningCommittee?.name || 'Program Committee',
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
            programId: progId,
            programTitle: progTitle.trim(),
            eventId: selectedEventId,
            status: 'ACTIVE',
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
        `Event Director created program '${progTitle.trim()}'${owningCommittee ? ` under ${owningCommittee.name}` : ''}${progCoordinator ? ` and assigned coordinator ${progCoordinator.fullName}` : ''}`
      );

      setSuccessMsg(`✓ Successfully created program "${progTitle.trim()}"${progCoordinator ? ` and assigned ${progCoordinator.fullName} as Coordinator` : ''}.`);
      setProgTitle('');
      setProgDescription('');
      setProgCoordinator(null);
      setProgCoordinatorSearch('');
      setProgOwningCommittee('');
      setIsCreateProgOpen(false);
      setActiveProgForManagement(progId);
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
          residentId: m.id || `${parentRes.gmkId}_spouse`,
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
          status: 'ACTIVE',
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
  const handleAssignProgramVolunteer = async (programId: string, resident: any, role?: string) => {
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
        unitDisplay: unitDisplay,
        role: (role || 'Volunteer').trim()
      });

      const updatedVolunteers = [...currentVolunteers, newVol];

      await updateDoc(doc(db, "eventPrograms", programId), sanitizeFirestorePayload({
        volunteers: updatedVolunteers,
        updatedAt: new Date().toISOString()
      }));

      setSuccessMsg(`✓ Assigned ${fullName} as a volunteer (${role || 'Volunteer'}) for ${prog.title}.`);
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
      const expId = `exp_${Date.now()}`;
      const newExpense = {
        id: expId,
        title: expenseTitle.trim(),
        amount: Number(amountNum.toFixed(3)),
        status: 'approved' as const, // Automatically approved by Event Director
        createdAt: new Date().toISOString()
      };

      await updateDoc(doc(db, "eventPrograms", programId), {
        expenses: [...currentExpenses, newExpense],
        updatedAt: new Date().toISOString()
      });

      // Synchronize with owning committee expenses
      const owningComm = activeCommittees.find(c => 
        (prog.committeeId && c.id === prog.committeeId) || 
        (prog.committeeName && c.name.toLowerCase() === prog.committeeName.toLowerCase()) ||
        ['program committee', 'programs', 'program'].includes(c.name.toLowerCase())
      );

      if (owningComm) {
        const commExpenses = owningComm.expenses || [];
        const newCommExpense = {
          id: expId,
          date: new Date().toISOString().split('T')[0],
          description: `[${prog.title}] ${expenseTitle.trim()}`,
          amount: Number(amountNum.toFixed(3)),
          programId: prog.id,
          programTitle: prog.title,
          createdAt: new Date().toISOString(),
          createdBy: profile?.email || 'program_coordinator'
        };

        await updateDoc(doc(db, "eventCommittees", owningComm.id), {
          expenses: [...commExpenses, newCommExpense],
          updatedAt: new Date().toISOString()
        });
      }

      setSuccessMsg(`✓ Expense of OMR ${amountNum.toFixed(3)} recorded for "${prog.title}"${owningComm ? ` and aggregated to ${owningComm.name}` : ''}.`);
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

      // Also remove from owning committee if present
      const owningComm = activeCommittees.find(c => 
        (prog.committeeId && c.id === prog.committeeId) || 
        (prog.committeeName && c.name.toLowerCase() === prog.committeeName.toLowerCase()) ||
        ['program committee', 'programs', 'program'].includes(c.name.toLowerCase())
      );

      if (owningComm && owningComm.expenses) {
        const updatedCommExpenses = owningComm.expenses.filter(e => e.id !== expenseId && (e as any).programExpenseId !== expenseId);
        await updateDoc(doc(db, "eventCommittees", owningComm.id), {
          expenses: updatedCommExpenses,
          updatedAt: new Date().toISOString()
        });
      }

      setSuccessMsg(`✓ Expense removed successfully.`);
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Failed to remove program expense: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveProgramWorkspace = async () => {
    if (!workingProgram || !activeProgForManagement) return;
    setIsSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const originalProg = activePrograms.find(p => p.id === activeProgForManagement);
      if (!originalProg) return;

      const programId = workingProgram.id;

      // Update the program doc
      await updateDoc(doc(db, "eventPrograms", programId), sanitizeFirestorePayload({
        coordinators: workingProgram.coordinators || [],
        volunteers: workingProgram.volunteers || [],
        participants: workingProgram.participants || [],
        expenses: workingProgram.expenses || [],
        updatedAt: new Date().toISOString()
      }));

      // Role assignments for Coordinators
      const oldCoords = originalProg.coordinators || [];
      const newCoords = workingProgram.coordinators || [];
      const addedCoords = newCoords.filter((c: any) => !oldCoords.some((oc: any) => oc.residentId === c.residentId));
      const removedCoords = oldCoords.filter((oc: any) => !newCoords.some((c: any) => c.residentId === oc.residentId));

      for (const c of addedCoords) {
        if (c.residentId && c.residentId.indexOf('manual') === -1) {
          const assignmentId = `${c.residentId}_program_coordinator_${selectedEventId}`;
          const emailAssignmentId = c.email ? `${c.email.replace(/[@.]/g, '_')}_program_coordinator_${selectedEventId}` : null;
          const rolePayload = sanitizeFirestorePayload({
            id: assignmentId,
            gmkId: c.residentId,
            email: c.email || '',
            position: 'program_coordinator',
            role: 'program_coordinator',
            eventId: selectedEventId,
            status: 'ACTIVE',
            assignedAt: new Date().toISOString()
          });
          
          await setDoc(doc(db, "roleAssignments", assignmentId), rolePayload);
          if (emailAssignmentId) {
            await setDoc(doc(db, "roleAssignments", emailAssignmentId), { ...rolePayload, id: emailAssignmentId });
          }
        }
      }

      for (const c of removedCoords) {
        if (c.residentId) {
          const assignmentId = `${c.residentId}_program_coordinator_${selectedEventId}`;
          const emailAssignmentId = c.email ? `${c.email.replace(/[@.]/g, '_')}_program_coordinator_${selectedEventId}` : null;
          
          await deleteDoc(doc(db, "roleAssignments", assignmentId)).catch(() => {});
          if (emailAssignmentId) {
            await deleteDoc(doc(db, "roleAssignments", emailAssignmentId)).catch(() => {});
          }
        }
      }

      // Role assignments for Volunteers
      const oldVols = originalProg.volunteers || [];
      const newVols = workingProgram.volunteers || [];
      const addedVols = newVols.filter((v: any) => !oldVols.some((ov: any) => ov.residentId === v.residentId));
      const removedVols = oldVols.filter((ov: any) => !newVols.some((v: any) => v.residentId === ov.residentId));

      for (const v of addedVols) {
        if (v.residentId && v.residentId.indexOf('manual') === -1) {
          const assignmentId = `${v.residentId}_event_volunteer_${selectedEventId}`;
          const emailAssignmentId = v.email ? `${v.email.replace(/[@.]/g, '_')}_event_volunteer_${selectedEventId}` : null;
          const rolePayload = sanitizeFirestorePayload({
            id: assignmentId,
            gmkId: v.residentId,
            email: v.email || '',
            position: 'event_volunteer',
            role: 'event_volunteer',
            eventId: selectedEventId,
            committeeType: 'program',
            programId: workingProgram.id,
            status: 'ACTIVE',
            assignedAt: new Date().toISOString()
          });
          
          await setDoc(doc(db, "roleAssignments", assignmentId), rolePayload);
          if (emailAssignmentId) {
            await setDoc(doc(db, "roleAssignments", emailAssignmentId), { ...rolePayload, id: emailAssignmentId });
          }
        }
      }

      for (const v of removedVols) {
        if (v.residentId) {
          const assignmentId = `${v.residentId}_event_volunteer_${selectedEventId}`;
          const emailAssignmentId = v.email ? `${v.email.replace(/[@.]/g, '_')}_event_volunteer_${selectedEventId}` : null;
          
          await deleteDoc(doc(db, "roleAssignments", assignmentId)).catch(() => {});
          if (emailAssignmentId) {
            await deleteDoc(doc(db, "roleAssignments", emailAssignmentId)).catch(() => {});
          }
        }
      }

      // Synchronize expenses with owning committee
      const oldExpenses = originalProg.expenses || [];
      const newExpenses = workingProgram.expenses || [];
      
      const addedExpenses = newExpenses.filter((e: any) => !oldExpenses.some((oe: any) => oe.id === e.id));
      const removedExpenses = oldExpenses.filter((oe: any) => !newExpenses.some((e: any) => e.id === oe.id));
      
      if (addedExpenses.length > 0 || removedExpenses.length > 0) {
        const owningComm = activeCommittees.find(c => 
          (originalProg.committeeId && c.id === originalProg.committeeId) || 
          (originalProg.committeeName && c.name.toLowerCase() === originalProg.committeeName.toLowerCase()) ||
          ['program committee', 'programs', 'program'].includes(c.name.toLowerCase())
        );

        if (owningComm) {
          let commExpenses = [...(owningComm.expenses || [])];
          
          // Remove deleted expenses
          for (const rx of removedExpenses) {
            commExpenses = commExpenses.filter((ce: any) => ce.id !== rx.id && ce.programExpenseId !== rx.id);
          }

          // Add new expenses
          for (const ax of addedExpenses) {
            commExpenses.push({
              id: ax.id,
              programExpenseId: ax.id, // Keeping this for explicit tracking
              date: ax.date || new Date().toISOString().split('T')[0],
              description: `[${workingProgram.title}] ${ax.title}`,
              amount: ax.amount,
              programId: workingProgram.id,
              programTitle: workingProgram.title,
              createdAt: ax.createdAt || new Date().toISOString(),
              createdBy: profile?.email || 'program_coordinator'
            });
          }

          await updateDoc(doc(db, "eventCommittees", owningComm.id), {
            expenses: commExpenses,
            updatedAt: new Date().toISOString()
          });
        }
      }

      setIsProgramDirty(false);
      setIsEditingProgram(false);
      setSuccessMsg("Program changes saved successfully.");
    } catch (err: any) {
      console.error("[PROGRAM SAVE ERROR]", err);
      setErrorMsg("Failed to save program changes.");
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
          residentId: m.id || `${parentRes.gmkId}_spouse`,
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

  // Record / Process Payment Submission (Direct Offline Payment Confirmation)
  const handleRecordPaymentSubmit = async () => {
    if (!paymentModalReg || !selectedEventId) return;

    const amtRec = parseFloat(paymentModalAmtRec) || 0;
    const remarksTrimmed = paymentModalRemarks.trim();

    setIsSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      if (!paymentModalReg.id) {
        setErrorMsg("Registration document ID is missing. Payment was not recorded.");
        setIsSubmitting(false);
        return;
      }

      console.log("[PAYMENT-DEBUG] registrationId:", paymentModalReg.id);
      console.log("[PAYMENT-DEBUG] eventId:", paymentModalReg.eventId || selectedEventId);
      console.log("[PAYMENT-DEBUG] target:", `event_registrations/${paymentModalReg.id}`);
      console.log("[PAYMENT-DEBUG] operation: Callable Function (processEventPayment)");

      const processPaymentFn = httpsCallable(functions, 'processEventPayment');
      
      const response = await processPaymentFn({
        registrationId: paymentModalReg.id,
        amountReceived: amtRec,
        financeRemarks: remarksTrimmed
      });

      const data = response.data as any;

      if (data && data.success) {
        if (data.paymentStatus === 'paid' || data.paymentStatus === 'waived' || data.paymentStatus === 'overpaid') {
          try {
            await addDoc(collection(db, "emailQueue"), {
              to: paymentModalReg.primaryMemberEmail,
              template: "payment_receipt_entry_pass",
              notificationType: "ENTRY_PASS",
              status: "pending",
              attempts: 0,
              createdAt: new Date().toISOString(),
              data: {
                residentName: paymentModalReg.participants?.[0] || paymentModalReg.primaryMemberEmail,
                gmkId: paymentModalReg.primaryMemberGmkId || '',
                eventName: activeEvent?.title || 'Community Event',
                eventDate: activeEvent?.date || '',
                amountReceived: amtRec,
                receiptNumber: data.receiptNumber || '',
                entryPassNumber: data.entryPassNumber || '',
                paymentStatus: data.paymentStatus
              },
              isTemplate: false
            });
            console.log("[EMAIL-QUEUE] Successfully enqueued email for", paymentModalReg.primaryMemberEmail);
          } catch (emailErr) {
            console.error("[EMAIL-QUEUE] Failed to enqueue email:", emailErr);
          }
        }

        setSuccessMsg(`Payment recorded successfully for ${paymentModalReg.primaryMemberGmkId || paymentModalReg.primaryMemberEmail}. Receipt #${data.receiptNumber || 'generated'}.`);
        setPaymentModalReg(null);
        setPaymentModalAmtRec('');
        setPaymentModalRemarks('');
      } else {
        throw new Error("Invalid response from payment service.");
      }
    } catch (err: any) {
      console.error("Failed to record payment:", err);
      setErrorMsg(`Failed to record payment: ${err.message || err}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Gate Check-In & Entry Pass Verification
  const handleGateCheckInSubmit = async (reg: EventRegistration) => {
    if (!reg || !selectedEventId) return;

    const gmkId = reg.primaryMemberGmkId || reg.id.split('_')?.[1];
    if (!gmkId) {
      setErrorMsg("Cannot process check-in: Missing GMK ID on registration.");
      return;
    }

    const attRef = doc(db, "eventAttendance", `att_${gmkId}_${selectedEventId}`);
    
    // Check if already attended
    const existing = activeAttendances.find(a => a.primaryMemberGmkId === gmkId || a.id === `att_${gmkId}_${selectedEventId}`);
    if (existing && existing.status === 'attended') {
      setErrorMsg(`Household ${gmkId} is ALREADY CHECKED IN (Recorded at ${existing.attendedAt || 'earlier'}).`);
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const nowStr = new Date().toISOString();
      const adminEmail = auth.currentUser?.email || 'Gate Attendance Officer';

      await setDoc(attRef, {
        id: `att_${gmkId}_${selectedEventId}`,
        eventId: selectedEventId,
        committeeKey: 'attendance',
        primaryMemberGmkId: gmkId,
        status: 'attended',
        attendedAt: nowStr,
        scannedBy: adminEmail,
        totalParticipants: reg.totalParticipants || 1,
        entryPassNumber: reg.entryPassNumber || `PASS-${selectedEventId.slice(-6).toUpperCase()}-${gmkId}`
      }, { merge: true });

      setSuccessMsg(`Gate check-in CONFIRMED for ${gmkId} (${reg.primaryMemberEmail}). Gate entry granted.`);
      setAttendanceScannedReg(null);
      setAttendanceScanInput('');
    } catch (err: any) {
      console.error("Gate check-in error:", err);
      setErrorMsg(`Gate check-in failed: ${err.message || err}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Print Financial & Registration Report
  const handlePrintFinancialReport = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const filteredRegs = registrations.filter(reg => {
      if (finStatusFilter !== 'all' && reg.paymentStatus !== finStatusFilter) return false;
      if (finSearchQuery) {
        const q = finSearchQuery.toLowerCase();
        return (
          reg.primaryMemberGmkId?.toLowerCase().includes(q) ||
          reg.primaryMemberEmail?.toLowerCase().includes(q) ||
          reg.id.toLowerCase().includes(q) ||
          reg.entryPassNumber?.toLowerCase().includes(q) ||
          reg.receiptNumber?.toLowerCase().includes(q)
        );
      }
      return true;
    });

    const rowsHtml = filteredRegs.map(r => {
      const amtDue = r.amountDue ?? r.paymentAmount ?? r.paymentSummary?.totalAmount ?? 0;
      const amtRec = r.amountReceived ?? (r.paymentStatus === 'paid' ? amtDue : 0);
      const bal = r.balanceDue ?? Math.max(0, amtDue - amtRec);
      return `
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #ddd; font-family: monospace;">${r.primaryMemberGmkId || 'N/A'}</td>
          <td style="padding: 8px; border-bottom: 1px solid #ddd;">${r.primaryMemberEmail}</td>
          <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: center;">${r.totalParticipants || 1}</td>
          <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right; font-family: monospace;">OMR ${amtDue.toFixed(3)}</td>
          <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right; font-family: monospace;">OMR ${amtRec.toFixed(3)}</td>
          <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right; font-family: monospace;">OMR ${bal.toFixed(3)}</td>
          <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: center; font-weight: bold;">${(r.paymentStatus || 'pending').toUpperCase()}</td>
        </tr>
      `;
    }).join('');

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>GMK Event Financial Registration Report - ${activeEvent?.title || ''}</title>
          <style>
            body { font-family: sans-serif; font-size: 12px; margin: 20px; color: #111; }
            h2 { color: #0f4c2a; margin-bottom: 5px; }
            p { margin-top: 0; color: #555; }
            table { width: 100%; border-collapse: collapse; margin-top: 15px; }
            th { background: #f2f4f3; text-align: left; padding: 8px; border-bottom: 2px solid #0f4c2a; font-size: 11px; text-transform: uppercase; }
          </style>
        </head>
        <body>
          <h2>Greens Malayalee Kootayama (GMK) - Financial Report</h2>
          <p><strong>Event:</strong> ${activeEvent?.title || 'Community Event'} | <strong>Generated:</strong> ${new Date().toLocaleString()}</p>
          <table>
            <thead>
              <tr>
                <th>GMK ID</th>
                <th>Registrant Email</th>
                <th style="text-align: center;">Count</th>
                <th style="text-align: right;">Amount Due</th>
                <th style="text-align: right;">Amount Rec.</th>
                <th style="text-align: right;">Balance</th>
                <th style="text-align: center;">Status</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
          <script>
            window.onload = function() { window.print(); };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };


  const navItems = [];
  if (isGlobalED) {
    navItems.push(
      { id: 'events', label: 'Events', icon: Calendar },
      { id: 'configuration', label: 'Configuration', icon: Settings },
      { id: 'registrations', label: 'Registrations', icon: FileText },
      { id: 'committees', label: 'Committees', icon: Users },
      { id: 'programs', label: 'Programs', icon: Flame }
    );
    if (showFinanceTab) navItems.push({ id: 'finance', label: 'Finance Workspace', icon: PieChart });
    navItems.push({ id: 'reports', label: 'Reports', icon: TrendingUp });
  } else {
    // Non-Global ED: Left Work Console shows ONLY the committees for which user has an active Lead assignment
    if (showFinanceTab) navItems.push({ id: 'finance', label: 'Finance Workspace', icon: PieChart });
    
    // Add other assigned committees dynamically from canonical userResponsibilities
    const myLedCommittees = userResponsibilities.filter(r => r.committee);
    
    myLedCommittees.forEach(comm => {
      const cName = comm.committee.toLowerCase();
      if (!cName.includes('finance') && !cName.includes('program')) {
        // Prevent duplicate tabs
        if (!navItems.find(i => i.id === `comm_${comm.committee}`)) {
          navItems.push({
            id: `comm_${comm.committee}`,
            label: `${comm.committee} Workspace`,
            icon: Users,
            targetComm: comm.committee
          });
        }
      }
    });
    
    const isProgramCoordinatorAny = activePrograms.some(p => 
      (p.coordinators || []).some(c => 
        (c.email && c.email.toLowerCase().trim() === (profile?.email?.toLowerCase().trim() || '')) ||
        (c.residentId && c.residentId.toUpperCase().trim() === (profile?.gmkId?.toUpperCase().trim() || ''))
      )
    );
    if (isProgramCoordinatorAny || isProgramLeadAuth) {
      navItems.push({ id: 'programs', label: 'Programs', icon: Flame });
    }
  }

  // Automatic routing synchronization for Committee Leads (RTCO-069)
  useEffect(() => {
    if (!isGlobalED && navItems.length > 0) {
      const isCurrentTabValid = navItems.some(item => {
        if (item.id.startsWith('comm_')) {
          return activeTab === 'committees' && activeCommitteeToConfigure?.toLowerCase() === (item as any).targetComm?.toLowerCase();
        }
        return activeTab === item.id;
      });

      if (!isCurrentTabValid || activeTab === 'events') {
        const firstItem = navItems[0];
        if (firstItem.id.startsWith('comm_')) {
          setActiveTab('committees');
          setActiveCommitteeToConfigure((firstItem as any).targetComm);
        } else {
          setActiveTab(firstItem.id as EDTab);
          setActiveCommitteeToConfigure(null);
        }
      }
    }
  }, [isGlobalED, navItems, activeTab, activeCommitteeToConfigure]);

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
              <span>{isGlobalED ? "Event Director Workspace" : "Committee Lead Work Console"}</span>
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
                  if (isGlobalED) {
                    setActiveCommitteeToConfigure(null);
                  }
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
                <span className="text-[9px] text-[#d4af37] font-black uppercase tracking-wider">
                  {isGlobalED ? "Director" : "Committee Lead"}
                </span>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Mobile Compact Sticky Navigation Row (Visible only on mobile, immediately below the green header) */}
      <div className="md:hidden sticky top-0 bg-white border-b border-stone-200 shadow-xs z-40 flex items-center justify-start overflow-x-auto hide-scrollbar space-x-2 py-2 px-2">
        {navItems.filter(i => i.id !== 'events').map((item) => {
          const Icon = item.icon;
          const isSelected = item.id.startsWith('comm_') ? (activeTab === 'committees' && activeCommitteeToConfigure === item.targetComm) : (activeTab === item.id && !activeCommitteeToConfigure);
          return (
            <button
              key={item.id}
              onClick={() => {
                if (item.id.startsWith('comm_')) {
                  setActiveTab('committees');
                  setActiveCommitteeToConfigure(item.targetComm);
                } else {
                  setActiveTab(item.id as EDTab);
                  setActiveCommitteeToConfigure(null);
                }
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
            
            {navItems.map((item) => {
              const Icon = item.icon;
              const isSelected = item.id.startsWith('comm_') ? (activeTab === 'committees' && activeCommitteeToConfigure === item.targetComm) : (activeTab === item.id && !activeCommitteeToConfigure);
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    if (item.id.startsWith('comm_')) {
                      setActiveTab('committees');
                      setActiveCommitteeToConfigure(item.targetComm);
                    } else {
                      setActiveTab(item.id as EDTab);
                      setActiveCommitteeToConfigure(null);
                    }
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
          {activeTab === 'finance' && (
            <FinanceWorkspace
              activeEvent={activeEvent}
              events={events}
              registrations={registrations}
              eventFinance={eventFinance}
              setPaymentModalReg={setPaymentModalReg}
              handleUpdateFinance={handleUpdateFinance}
              profile={profile}
              activeCommittees={activeCommittees}
              setSuccessMsg={setSuccessMsg}
              setErrorMsg={setErrorMsg}
              families={families}
              familyMembers={familyMembers}
              isSubmitting={isSubmitting}
            />
          )}
          {activeTab === 'events' && (
            <div className="space-y-6 animate-fadeIn">
              <div className="flex items-center justify-between border-b border-stone-200 pb-3">
                <div>
                  <h3 className="text-sm font-extrabold text-[#0f4c2a] uppercase tracking-wider font-heading">
                    Community Gathering Directory
                  </h3>
                  <p className="text-stone-550 text-[10px] font-bold">Manage, delete, or create a new community event.</p>
                </div>
                
                {isGlobalED && (
                  <button
                    onClick={() => setShowNewEventForm(!showNewEventForm)}
                    className="px-4 py-2.5 rounded-xl bg-[#0f4c2a] hover:bg-[#0c3e22] text-white text-xs font-bold flex items-center space-x-1.5 transition-colors cursor-pointer shadow-sm"
                  >
                    <Plus className="w-4 h-4" />
                    <span>New Event</span>
                  </button>
                )}
              </div>

              {/* Inline Create Event Form */}
              {isGlobalED && showNewEventForm && (
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
                          {isGlobalED ? (
                            <>
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
                            </>
                          ) : (
                            <button
                              onClick={() => {
                                setSelectedEventId(evt.id);
                                const allowedWorkspaces = navItems.filter(i => i.id !== 'events');
                                if (allowedWorkspaces.length > 0) {
                                  const targetItem = allowedWorkspaces[0];
                                  if (targetItem.id.startsWith('comm_')) {
                                    setActiveTab('committees');
                                    setActiveCommitteeToConfigure((targetItem as any).targetComm);
                                  } else {
                                    setActiveTab(targetItem.id as any);
                                    setActiveCommitteeToConfigure(null);
                                  }
                                }
                              }}
                              className="flex-1 py-2.5 rounded-xl bg-[#0f4c2a] hover:bg-[#0b381f] text-white text-[10px] font-extrabold uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center space-x-1.5 shadow-sm active:scale-[0.99]"
                            >
                              <span>Open Committee Workspace</span>
                              <span>➜</span>
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
                    <div className="border-b border-stone-150 pb-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <div>
                        <div className="flex items-center space-x-2">
                          <h4 className="font-extrabold text-[#0f4c2a] text-xs uppercase tracking-wider font-heading">Section 3: Registration Pricing</h4>
                          <span className="px-2 py-0.5 bg-emerald-50 border border-emerald-200 text-[#0f4c2a] text-[9px] font-mono font-bold rounded-md">
                            Ref: {getPolicyMetadata(activeEvent, activeEvent?.pricing).ref}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-stone-500 font-medium mt-0.5">
                          <span>Revision Date: <strong className="text-stone-800 font-mono font-bold">{getPolicyMetadata(activeEvent, activeEvent?.pricing).revisionDate}</strong></span>
                          <span className="text-stone-300">•</span>
                          <span>Effective: <strong className="text-stone-700 font-mono font-bold">{getPolicyMetadata(activeEvent, activeEvent?.pricing).fullFormatted}</strong></span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowPricingPolicyModal(true)}
                        className="px-2.5 py-1.5 border border-stone-250 hover:bg-stone-50 text-[#0f4c2a] font-extrabold text-[10px] uppercase tracking-wider rounded-xl transition-all shadow-xs cursor-pointer flex items-center space-x-1 shrink-0"
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
                          Specify bank transfer and mobile payment accounts displayed to registrants in GMK Events.
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
                            <div className="flex items-center space-x-2">
                              <span className="text-[10px] font-extrabold font-mono text-[#0f4c2a] block uppercase tracking-wider">Specifications & Matrix</span>
                              <span className="px-2 py-0.5 bg-emerald-50 border border-emerald-200 text-[#0f4c2a] text-[9px] font-mono font-black rounded-md">
                                Ref: {getPolicyMetadata(activeEvent, activeEvent?.pricing).ref}
                              </span>
                            </div>
                            <h3 className="text-sm font-extrabold text-[#0f4c2a] font-heading mt-0.5">Registration Pricing Policy</h3>
                            <div className="text-[10px] text-stone-500 font-mono font-medium mt-1 flex flex-wrap items-center gap-2">
                              <span className="px-1.5 py-0.5 bg-stone-100 border border-stone-200 rounded text-stone-700 font-bold">
                                Rev Date: {getPolicyMetadata(activeEvent, activeEvent?.pricing).revisionDate}
                              </span>
                              <span>📅 Effective: <strong className="text-stone-800 font-bold">{getPolicyMetadata(activeEvent, activeEvent?.pricing).fullFormatted}</strong></span>
                            </div>
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
                            <span className="text-stone-600 font-bold">1. Core 1 Head (1 Parent, 0 Children &gt; Free Age)</span>
                            <span className="font-mono font-black text-stone-950">OMR {configIndividualFee.toFixed(3)} <span className="text-[9px] text-stone-500">(Single Rate)</span></span>
                          </div>
                          <div className="p-3 flex justify-between">
                            <span className="text-stone-600 font-bold">2. Core 2 Heads (2 Parents, 0 Children &gt; Free Age)</span>
                            <span className="font-mono font-black text-stone-950">OMR {configCoupleFee.toFixed(3)} <span className="text-[9px] text-stone-500">(Couple Rate)</span></span>
                          </div>
                          <div className="p-3 flex justify-between">
                            <span className="text-stone-600 font-bold">3. Core 2 Heads (1 Parent, 1 Child &gt; Free Age)</span>
                            <span className="font-mono font-black text-stone-950">OMR {configCoupleFee.toFixed(3)} <span className="text-[9px] text-stone-500">(Couple Rate)</span></span>
                          </div>
                          <div className="p-3 flex justify-between">
                            <span className="text-stone-600 font-bold">4. Core 3+ Heads (2 Parents, 1+ Children &gt; Free Age)</span>
                            <span className="font-mono font-black text-stone-950">OMR {configFamilyFee.toFixed(3)} <span className="text-[9px] text-stone-500">(Family Rate Cap)</span></span>
                          </div>
                          <div className="p-3 flex justify-between">
                            <span className="text-stone-600 font-bold">5. Children &lt; Free Age</span>
                            <span className="font-mono font-black text-stone-950">OMR 0.000 <span className="text-[9px] text-stone-500">(Free)</span></span>
                          </div>
                          <div className="p-3 flex justify-between">
                            <span className="text-stone-600 font-bold">6. Extra Adult (Parents / In-laws)</span>
                            <span className="font-mono font-black text-stone-950">OMR {configParentFee.toFixed(3)} <span className="text-[9px] text-stone-500">(Per Parent)</span></span>
                          </div>
                          <div className="p-3 flex justify-between">
                            <span className="text-stone-600 font-bold">7. Extra Adult (Other Dependents / Maids)</span>
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
                {activeCommitteeToConfigure && isGlobalED && (
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
                    const currentComm = activeCommittees.find(c => c.name?.toLowerCase() === activeCommitteeToConfigure?.toLowerCase());
                    if (!currentComm) {
                      return (
                        <div className="p-6 text-center text-stone-500 font-bold bg-white rounded-2xl border border-stone-200">
                          Committee Workspace not found.
                        </div>
                      );
                    }

                    const commLeads = (currentComm.members || []).filter(m => m.role === 'Lead');
                    const leadCount = commLeads.length;

                    const isProgramComm = activeCommitteeToConfigure.toLowerCase().includes('program');

                    // 2. ENHANCED OPERATIONAL COMMITTEE WORKSPACES
                    const isFinanceComm = activeCommitteeToConfigure.toLowerCase().includes('finance');
                    const isFoodComm = activeCommitteeToConfigure.toLowerCase().includes('food');
                    const isAttendanceComm = activeCommitteeToConfigure.toLowerCase().includes('attendance');

                    return (
                      <div className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm space-y-6 animate-fadeIn">
                        {/* HEADER WITH COLLAPSIBLE LEADS */}
                        {!activeProgForManagement && (
<div className="bg-stone-50 border border-stone-200 rounded-2xl p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-2">
                              <span className="text-base">
                                {isFinanceComm ? '💰' : isFoodComm ? '🍱' : isAttendanceComm ? '🎟️' : isProgramComm ? '🎭' : '👥'}
                              </span>
                              <div>
                                <h4 className="font-extrabold text-[#0f4c2a] text-sm uppercase tracking-wider font-heading">
                                  {activeCommitteeToConfigure} Committee Workspace
                                </h4>
                                <p className="text-[10px] text-stone-500 font-bold">
                                  {isFinanceComm 
                                    ? 'Event registration payment verification, receipts & financial audit reports' 
                                    : isFoodComm 
                                    ? 'Financially approved meal distribution & food coupon management' 
                                    : isAttendanceComm 
                                    ? 'Gate QR entry pass verification & real-time event attendance tracking' 
                                    : isProgramComm
                                    ? 'Operational management of stage programs: create listings, assign coordinators, and manage individual program workspaces.'
                                    : 'Committee leadership assignment & operational expense logging'}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center space-x-2">
                              <span className="px-2.5 py-1 bg-emerald-100 border border-emerald-200 text-[#0f4c2a] text-xs font-black rounded-xl font-mono">
                                {leadCount} Leads
                              </span>
                              <button
                                type="button"
                                onClick={() => setFinanceLeadsExpanded(!financeLeadsExpanded)}
                                className="px-2.5 py-1 bg-white hover:bg-stone-100 border border-stone-250 text-stone-700 text-[10px] font-bold uppercase rounded-xl transition-all flex items-center space-x-1 cursor-pointer"
                              >
                                <span>{financeLeadsExpanded ? 'Hide Leads' : 'Manage Leads'}</span>
                                {financeLeadsExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                          </div>

                          {/* COLLAPSIBLE LEADS MANAGEMENT PANEL */}
                          {financeLeadsExpanded && (
                            <div className="pt-3 border-t border-stone-200 space-y-4 animate-fadeIn">
                              <div className="space-y-2">
                                <h5 className="text-[10px] uppercase font-black text-stone-600 tracking-wider">Assigned Committee Leads</h5>
                                {commLeads.length === 0 ? (
                                  <p className="text-xs text-stone-500 italic font-bold p-3 bg-white border border-dashed border-stone-200 rounded-xl text-center">
                                    No leads assigned yet. Use search below to appoint leads.
                                  </p>
                                ) : (
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                    {commLeads.map(lead => (
                                      <div key={lead.residentId} className="flex items-center justify-between p-2.5 bg-white border border-stone-200 rounded-xl">
                                        <div>
                                          <span className="text-xs font-black text-stone-850 block">{lead.fullName}</span>
                                          <span className="text-[9px] text-stone-500 font-bold block">{lead.email}</span>
                                        </div>
                                        <button
                                          type="button"
                                          disabled={isSubmitting}
                                          onClick={() => handleRemoveCommitteeLead(lead.residentId, lead.email, activeCommitteeToConfigure)}
                                          className="p-1 hover:bg-red-50 text-stone-400 hover:text-red-600 rounded-lg transition-colors cursor-pointer"
                                          title="Remove Lead"
                                        >
                                          <X className="w-4 h-4" />
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>

                              <div className="space-y-2 pt-2 border-t border-dashed border-stone-200">
                                <h5 className="text-[10px] uppercase font-black text-stone-600 tracking-wider">Assign New Committee Lead</h5>
                                <div className="relative">
                                  <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-[#0f4c2a]" />
                                  <input
                                    type="text"
                                    value={workspaceSearchQuery}
                                    onChange={(e) => setWorkspaceSearchQuery(e.target.value)}
                                    placeholder="Search resident name or flat number..."
                                    className="w-full pl-9 pr-3 py-1.5 font-bold bg-white border border-stone-200 rounded-xl text-xs text-stone-900 focus:outline-none focus:border-[#0f4c2a]"
                                  />
                                </div>
                                {workspaceSearchQuery && (
                                  <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto">
                                    {residents.filter(r => {
                                      if (r.status !== 'active') return false;
                                      if (commLeads.some(l => l.residentId === r.gmkId)) return false;
                                      const query = workspaceSearchQuery.toLowerCase().trim();
                                      return r.fullName?.toLowerCase().includes(query) || r.displayUnitNumber?.toLowerCase().includes(query) || r.phone?.toLowerCase().includes(query) || r.email?.toLowerCase().includes(query);
                                    }).map(res => (
                                      <div key={res.gmkId} className="bg-white border border-stone-200 rounded-xl p-2.5 flex items-center justify-between">
                                        <div className="min-w-0">
                                          <span className="font-bold text-stone-900 text-xs block truncate">{res.fullName}</span>
                                          <span className="text-[9px] text-stone-500 font-medium">Flat: {res.displayUnitNumber} • {res.email}</span>
                                        </div>
                                        <button
                                          type="button"
                                          disabled={isSubmitting}
                                          onClick={() => {
                                            handleAssignLeadDirectly(res, activeCommitteeToConfigure);
                                            setWorkspaceSearchQuery('');
                                          }}
                                          className="px-2.5 py-1 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white font-black text-[9px] uppercase tracking-wider rounded-lg transition-all cursor-pointer shrink-0"
                                        >
                                          Assign
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                        )}

                        {/* ----------------- FINANCE COMMITTEE WORKSPACE ENTRY ----------------- */}
                        {isFinanceComm && (
                          <div className="p-8 bg-emerald-50/50 border border-emerald-100 rounded-3xl shadow-sm flex flex-col items-center justify-center space-y-4 text-center animate-fadeIn">
                            <div className="w-16 h-16 bg-emerald-100 rounded-2xl shadow-inner flex items-center justify-center text-[#0f4c2a]">
                              <TrendingUp className="w-8 h-8" />
                            </div>
                            <div>
                              <h3 className="text-xl font-black text-[#0f4c2a] uppercase tracking-wider font-heading">Finance Committee</h3>
                              <p className="text-xs text-stone-600 font-bold mt-2 max-w-md">
                                Event accounting, sponsorship logging, and centralized ledger access are available in the dedicated Finance workspace.
                              </p>
                            </div>
                            <button
                              onClick={() => setActiveTab('finance')}
                              className="mt-4 px-8 py-3.5 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all shadow-md flex items-center space-x-3 cursor-pointer"
                            >
                              <PieChart className="w-4 h-4 text-[#d4af37]" />
                              <span>Open Finance Dashboard</span>
                            </button>
                          </div>
                        )}
                        
                        {/* TAB 3: FOOD COMMITTEE WORKSPACE */}
                        {isFoodComm && (() => {
                          const approvedRegs = registrations.filter(r => {
                            const st = r.paymentStatus || 'pending';
                            return st === 'paid' || st === 'waived' || st === 'overpaid' || st === 'approved';
                          });
                          let totalApprovedMeals = 0;
                          approvedRegs.forEach(r => totalApprovedMeals += (r.totalParticipants || 1));
                          return (
                            <div className="space-y-5 animate-fadeIn">
                              <div className="overflow-x-auto hide-scrollbar border-b border-stone-200">
                                <div className="flex space-x-2 pb-2 min-w-max">
                                  <button
                                    type="button"
                                    onClick={() => setFoodTab('events')}
                                  className={`px-4 py-2 text-[10px] font-black uppercase tracking-wider rounded-t-xl transition-all ${foodTab === 'events' ? 'bg-[#0f4c2a] text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}
                                >
                                  EVENTS
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setFoodTab('expenses')}
                                  className={`px-4 py-2 text-[10px] font-black uppercase tracking-wider rounded-t-xl transition-all ${foodTab === 'expenses' ? 'bg-[#0f4c2a] text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}
                                >
                                  EXPENSES
                                </button>
                              </div>
                              </div>
                              {foodTab === 'events' && (
                                <div className="space-y-5 animate-fadeIn">
                                  <div className="grid grid-cols-2 gap-3">
                                    <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl text-left">
                                      <span className="text-[9px] uppercase font-bold text-emerald-800 block">Approved Households</span>
                                      <span className="text-lg font-black font-mono text-[#0f4c2a] mt-0.5 block">{approvedRegs.length}</span>
                                    </div>
                                    <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl text-left">
                                      <span className="text-[9px] uppercase font-bold text-emerald-800 block">Total Approved Meals</span>
                                      <span className="text-lg font-black font-mono text-[#0f4c2a] mt-0.5 block">{totalApprovedMeals}</span>
                                    </div>
                                  </div>
                                  <div className="space-y-2 text-left">
                                    <div className="flex items-center justify-between">
                                      <h5 className="text-xs font-black uppercase text-[#0f4c2a] tracking-wider font-heading flex items-center space-x-1.5">
                                        <Check className="w-4 h-4 text-emerald-600" />
                                        <span>Finance Approved Food List ({approvedRegs.length})</span>
                                      </h5>
                                    </div>
                                    {approvedRegs.length === 0 ? (
                                      <div className="p-6 text-center text-stone-450 italic font-bold text-xs bg-stone-50 border border-dashed border-stone-200 rounded-2xl">
                                        No registrations have been financially approved for food coupons yet.
                                      </div>
                                    ) : (
                                      <div className="overflow-x-auto border border-stone-200 rounded-2xl bg-white shadow-xs">
                                        <table className="w-full text-left border-collapse">
                                          <thead>
                                            <tr className="bg-stone-50 border-b border-stone-200 text-[10px] uppercase font-black text-stone-500 tracking-wider">
                                              <th className="p-3">Primary Registrant</th>
                                              <th className="p-3">Flat #</th>
                                              <th className="p-3 text-center">Meals</th>
                                              <th className="p-3">Children Information</th>
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-stone-150 text-stone-800 font-bold font-sans text-xs">
                                            {approvedRegs.map(reg => {
                                              const fam = families.find(f => f.id === reg.familyId);
                                              const pName = fam ? fam.fullName : (reg.primaryMemberEmail ? reg.primaryMemberEmail.split('@')[0] : 'Unknown');
                                              const unit = fam ? fam.displayUnitNumber : 'Unknown';
                                              const famMembers = familyMembers.filter(m => m.familyId === reg.familyId);
                                              const childrenList = famMembers.filter(m => m.relationship === 'child' && (reg.participants || []).some(p => p.toLowerCase().trim() === m.name.toLowerCase().trim()));
                                              
                                              return (
                                                <tr key={reg.id} className="hover:bg-emerald-50/20">
                                                  <td className="p-3">
                                                    <span className="text-stone-900 font-black block">{pName}</span>
                                                  </td>
                                                  <td className="p-3 font-mono font-bold text-emerald-800">{unit}</td>
                                                  <td className="p-3 text-center font-mono font-black text-base text-[#0f4c2a]">
                                                    {reg.totalParticipants || 1}
                                                  </td>
                                                  <td className="p-3">
                                                    {childrenList.length > 0 ? (
                                                      <div className="space-y-1">
                                                        <span className="text-[10px] font-black uppercase text-stone-500 block">Children: {childrenList.length}</span>
                                                        <ul className="list-disc pl-4 text-[10px] text-stone-700">
                                                          {childrenList.map((c, i) => {
                                                            const age = c.yearOfBirth ? new Date().getFullYear() - parseInt(c.yearOfBirth, 10) : 'Age Unknown';
                                                            return <li key={i}>{c.name} — {age} years</li>;
                                                          })}
                                                        </ul>
                                                      </div>
                                                    ) : (
                                                      <span className="text-[10px] text-stone-400 italic">No registered children</span>
                                                    )}
                                                  </td>
                                                </tr>
                                              );
                                            })}
                                          </tbody>
                                        </table>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                        {/* ----------------- OTHER OPERATIONAL COMMITTEES (PROGRAM, LOGISTICS, DECOR, ETC.) ----------------- */}
                        {isAttendanceComm && (
                          <div className="pt-4 space-y-4">
                            <div className="overflow-x-auto hide-scrollbar border-b border-stone-200">
                              <div className="flex items-center space-x-1 min-w-max pb-px">
                                <button
                                  type="button"
                                  onClick={() => setAttendanceTab('events')}
                                className={`px-4 py-2 text-[10px] font-black uppercase tracking-wider rounded-t-xl transition-all ${attendanceTab === 'events' ? 'bg-[#0f4c2a] text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}
                              >
                                Events
                              </button>
                              <button
                                type="button"
                                onClick={() => setAttendanceTab('attendance')}
                                className={`px-4 py-2 text-[10px] font-black uppercase tracking-wider rounded-t-xl transition-all ${attendanceTab === 'attendance' ? 'bg-[#0f4c2a] text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}
                              >
                                Attendance
                              </button>
                              <button
                                type="button"
                                onClick={() => setAttendanceTab('expenses')}
                                className={`px-4 py-2 text-[10px] font-black uppercase tracking-wider rounded-t-xl transition-all ${attendanceTab === 'expenses' ? 'bg-[#0f4c2a] text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}
                              >
                                Expenses
                              </button>
                              <button
                                type="button"
                                onClick={() => setAttendanceTab('reports')}
                                className={`px-4 py-2 text-[10px] font-black uppercase tracking-wider rounded-t-xl transition-all ${attendanceTab === 'reports' ? 'bg-[#0f4c2a] text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}
                              >
                                Reports
                              </button>
                            </div>
                            </div>
                            
                            {attendanceTab !== 'expenses' && (
                              <AttendanceWorkspace 
                                activeEvent={activeEvent}
                                registrations={registrations}
                                attendances={activeAttendances}
                                families={families}
                                familyMembers={familyMembers}
                                activeTab={attendanceTab}
                                committeeName={activeCommitteeToConfigure}
                              />
                            )}
                          </div>
                        )}

                        {!isFinanceComm && (!isFoodComm || foodTab === 'expenses') && (!isAttendanceComm || attendanceTab === 'expenses') && (
                          <div className="pt-4 border-t border-stone-100 space-y-4 text-left">
                            <div className="flex items-center justify-between">
                              <div>
                                <h5 className="text-xs uppercase font-black text-[#0f4c2a] tracking-wider font-heading">
                                  {activeCommitteeToConfigure} Operational Expense Log
                                </h5>
                                <p className="text-[10px] text-stone-500 font-bold mt-0.5">
                                  Log committee operational expenses in OMR formatted to 3 decimal places.
                                </p>
                              </div>
                              <span className="text-xs font-mono font-extrabold text-[#0f4c2a] bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-xl">
                                Total Expense: OMR {((currentComm?.expenses || []).reduce((sum, e) => sum + (e.amount || 0), 0)).toFixed(3)}
                              </span>
                            </div>

                            {(currentComm?.expenses || []).length === 0 ? (
                              <p className="text-xs text-stone-500 italic font-bold p-3 bg-stone-50 border border-dashed border-stone-200 rounded-xl text-center">
                                No expenses recorded for this committee yet. Use the form below to log an expense.
                              </p>
                            ) : (
                              <div className="border border-stone-200 rounded-xl overflow-hidden divide-y divide-stone-150 bg-white">
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

                            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end bg-stone-50 p-3 rounded-xl border border-stone-150">
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
                                  <span>Add Expense</span>
                                </button>
                              </div>
                            </div>
                          </div>
                        )}

                        {isProgramComm && (
                          <div className="pt-4 border-t border-stone-100 space-y-4 text-left">
                            <h4 className="font-extrabold text-[#0f4c2a] text-xs uppercase tracking-wider font-heading block border-b border-stone-200 pb-2">
                              Stage Programs ({activePrograms.length})
                            </h4>
                            <p className="text-[10px] text-stone-500 font-bold mb-4">Select a program to manage its participants, volunteers, and expenses.</p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              {activePrograms.map(prog => (
                                <div
                                  key={prog.id}
                                  onClick={() => {
                                    setActiveProgForManagement(prog.id);
                                    setActiveTab('programs');
                                  }}
                                  className="p-4 border rounded-2xl cursor-pointer transition-all flex items-center justify-between gap-3 bg-white border-stone-200 hover:border-[#0f4c2a] hover:shadow-md group"
                                >
                                  <div>
                                    <h5 className="font-extrabold text-stone-900 text-xs">{prog.title}</h5>
                                    <span className="text-[9px] font-black uppercase tracking-wider text-stone-500 mt-1 block">{prog.programType || prog.category || 'Mixed'}</span>
                                  </div>
                                  <ChevronRight className="w-4 h-4 text-stone-400 group-hover:text-[#0f4c2a] transition-colors" />
                                </div>
                              ))}
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setActiveProgForManagement(null);
                                setActiveTab('programs');
                              }}
                              className="w-full mt-2 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 font-extrabold text-[10px] uppercase tracking-wider rounded-xl transition-all cursor-pointer shadow-xs"
                            >
                              Create New Program
                            </button>
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
                    Operational management of stage programs: create listings, assign coordinators & volunteers, log expenses, and manage individual program workspaces.</p></div></div>{selectedEventId && activeEvent ? (<div className="space-y-6">
                  {!activeProgForManagement && (
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
                        <label className="text-[10px] uppercase font-black text-[#0f4c2a] tracking-wider block">Program Type</label>
                        <select
                          value={progType}
                          onChange={(e) => setProgType(e.target.value)}
                          className="w-full px-3 py-1.5 font-bold bg-white border border-stone-250 rounded-xl text-stone-850 text-xs focus:outline-none focus:ring-1 focus:ring-[#0f4c2a]"
                        >
                          <option value="Select">Select Category</option>
                          <option value="ADULTS">ADULTS</option>
                          <option value="KIDS">KIDS</option>
                          <option value="MIXED">MIXED</option>
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
                            className="text-stone-400 hover:text-red-600 font-extrabold uppercase text-[9px] tracking-wider cursor-pointer"
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
                            const matchedCoordResidents = searchProgramCoordinatorCandidates(progCoordinatorSearch);
                            return (
                              <div className="border border-stone-200 rounded-xl bg-white shadow-md max-h-40 overflow-y-auto divide-y divide-stone-100">
                                {matchedCoordResidents.length === 0 ? (
                                  <div className="p-2.5 text-stone-450 italic text-[10px] text-center font-bold">
                                    No matching active residents found.
                                  </div>
                                ) : (
                                  matchedCoordResidents.slice(0, 5).map(res => {
                                    
                                    return (
                                      <div key={res.id} className="p-2 flex items-center justify-between text-[11px] hover:bg-stone-50">
                                        <div>
                                          <span className="font-extrabold text-stone-900 block">{res.fullName}</span>
                                          <span className="text-[9px] text-stone-500 block">Unit: {res.displayUnitNumber} • {res.email}</span>
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setProgCoordinator(res as any);
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
                  )}

                  {/* Programs List & Management Workspace */}
                  {activePrograms.length === 0 ? (
                    <div className="text-center py-12 border border-dashed border-stone-250 rounded-2xl bg-white space-y-2">
                      <Flame className="w-8 h-8 mx-auto text-stone-350" />
                      <h4 className="text-stone-700 font-black text-xs">No Stage Programs Registered</h4>
                      <p className="text-stone-500 text-[10px] max-w-xs mx-auto font-bold">
                        Create a program above to begin configuring coordinators, volunteers, participant enrollments, and expenses.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <h4 className="font-extrabold text-[#0f4c2a] text-xs uppercase tracking-wider font-heading block border-b border-stone-200 pb-2">
                        Programs Registry ({activePrograms.length})
                      </h4>
                      {!activeProgForManagement ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                          {activePrograms.map(prog => {
                            const progId = prog.id;
                            const totalExp = (prog.expenses || []).reduce((sum, e) => sum + (e.amount || 0), 0);
                            return (
                              <div
                                key={progId}
                                onClick={() => {
                                  setActiveProgForManagement(progId);
                                  setProgCoordSearchQuery('');
                                  setProgVolSearchQuery('');
                                  setProgParticipantSearchQuery('');
                                }}
                                className="p-4 border rounded-2xl cursor-pointer transition-all flex items-center justify-between gap-3 bg-white border-stone-200 hover:border-[#0f4c2a] hover:shadow-md group"
                              >
                                <div className="min-w-0 flex-1 space-y-1">
                                  <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
                                    <span className="text-[8px] font-black tracking-wider text-[#d4af37] uppercase bg-[#0f4c2a]/5 border border-[#0f4c2a]/15 px-1.5 py-0.5 rounded font-mono">
                                      {prog.programType || prog.category || 'Adults'}
                                    </span>
                                    {prog.committeeName && (
                                      <span className="text-[8px] font-bold text-stone-600 bg-stone-100 border border-stone-200 px-1.5 py-0.5 rounded">
                                        🏛️ {prog.committeeName}
                                      </span>
                                    )}
                                    <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider border ${
                                      prog.status === 'approved' ? 'bg-emerald-50 text-emerald-800 border-emerald-100' :
                                      prog.status === 'rejected' ? 'bg-rose-50 text-rose-800 border-rose-100' :
                                      'bg-amber-50 text-amber-800 border-amber-100'
                                    }`}>
                                      {prog.status}
                                    </span>
                                  </div>
                                  <h5 className="text-stone-850 font-black text-xs font-heading capitalize truncate">{prog.title}</h5>
                                  <p className="text-stone-500 text-[10px] font-semibold truncate">
                                    Coord: {prog.coordinators?.[0]?.fullName || 'Unassigned'} • Volunteers: {prog.volunteers?.length || 0} • Participants: {prog.participants?.length || 0}
                                  </p>
                                  {totalExp > 0 && (
                                    <p className="text-[9.5px] font-mono text-[#0f4c2a] font-bold">
                                      Expenses: OMR {totalExp.toFixed(3)}
                                    </p>
                                  )}
                                </div>
                                <ChevronRight className="w-4 h-4 shrink-0 transition-transform text-stone-300 group-hover:text-[#0f4c2a] group-hover:translate-x-1" />
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="w-full">
                          {(() => {
                            const prog = workingProgram || activePrograms.find(p => p.id === activeProgForManagement);
                            if (!prog) return null;

                            const localAssignCoordinator = (res: any) => {
                               if (!isEditingProgram) return;
                               const resId = res.id || res.gmkId || res.residentId || '';
                               const newCoord = {
                                  residentId: resId,
                                  fullName: res.fullName || '',
                                  email: (res.email || '').toLowerCase().trim(),
                                  phone: res.phone || '',
                                  unitDisplay: res.displayUnitNumber || res.unitDisplay || 'N/A'
                               };
                               setWorkingProgram((prev: any) => ({ ...prev, coordinators: [...(prev.coordinators || []), newCoord] }));
                               setIsProgramDirty(true);
                            };

                            const localRemoveCoordinator = (resId: string) => {
                               if (!isEditingProgram) return;
                               setWorkingProgram((prev: any) => ({ ...prev, coordinators: (prev.coordinators || []).filter((c: any) => c.residentId !== resId) }));
                               setIsProgramDirty(true);
                            };

                            const localAssignVolunteer = (res: any, role: string) => {
                               if (!isEditingProgram) return;
                               const resId = res.id || res.gmkId || res.residentId || '';
                               const newVol = {
                                  residentId: resId,
                                  fullName: res.fullName || '',
                                  email: (res.email || '').toLowerCase().trim(),
                                  phone: res.phone || '',
                                  unitDisplay: res.displayUnitNumber || res.unitDisplay || 'N/A',
                                  role: role || 'Event Volunteer'
                               };
                               setWorkingProgram((prev: any) => ({ ...prev, volunteers: [...(prev.volunteers || []), newVol] }));
                               setIsProgramDirty(true);
                            };

                            const localRemoveVolunteer = (resId: string) => {
                               if (!isEditingProgram) return;
                               setWorkingProgram((prev: any) => ({ ...prev, volunteers: (prev.volunteers || []).filter((v: any) => v.residentId !== resId) }));
                               setIsProgramDirty(true);
                            };

                            const localAssignParticipant = (res: any) => {
                               if (!isEditingProgram) return;
                               const resId = res.id || res.gmkId || res.residentId || '';
                               const newPart = {
                                  residentId: resId,
                                  fullName: res.fullName || '',
                                  email: res.email || '',
                                  phone: res.phone || '',
                                  unitDisplay: res.unitDisplay || res.displayUnitNumber || 'N/A',
                                  isChild: res.isChild || false,
                                  age: res.age || 0,
                                  gender: res.gender || ''
                               };
                               setWorkingProgram((prev: any) => ({ ...prev, participants: [...(prev.participants || []), newPart] }));
                               setIsProgramDirty(true);
                            };

                            const localRemoveParticipant = (resId: string) => {
                               if (!isEditingProgram) return;
                               setWorkingProgram((prev: any) => ({ ...prev, participants: (prev.participants || []).filter((p: any) => p.residentId !== resId && p.id !== resId) }));
                               setIsProgramDirty(true);
                            };

                            const localAddExpense = () => {
                               if (!isEditingProgram || !expenseTitle.trim() || !expenseAmount.trim()) return;
                               const newExp = {
                                  id: `exp_${Date.now()}`,
                                  date: expenseDate || new Date().toISOString().split('T')[0],
                                  title: expenseTitle.trim(),
                                  amount: parseFloat(expenseAmount),
                                  createdAt: new Date().toISOString()
                               };
                               setWorkingProgram((prev: any) => ({ ...prev, expenses: [...(prev.expenses || []), newExp] }));
                               setExpenseTitle('');
                               setExpenseDate('');
                               setExpenseAmount('');
                               setIsProgramDirty(true);
                            };

                            const localRemoveExpense = (expId: string) => {
                               if (!isEditingProgram) return;
                               setWorkingProgram((prev: any) => ({ ...prev, expenses: (prev.expenses || []).filter((e: any) => e.id !== expId) }));
                               setIsProgramDirty(true);
                            };

                            const coordinators = prog.coordinators || [];
                            const volunteers = prog.volunteers || [];
                            const participants = prog.participants || [];
                            const expenses = prog.expenses || [];
                            const totalExpense = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);

                            return (
                              <div className="border border-stone-200 rounded-3xl bg-white p-5 shadow-xs space-y-6 animate-fadeIn">
                                {/* Program Workspace Header */}
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stone-150 pb-4">
                                  <div className="flex flex-col space-y-2">
                                    <button
                                      type="button"
                                      onClick={() => setActiveProgForManagement(null)}
                                      className="px-6 py-2.5 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white rounded-xl text-xs uppercase tracking-wider font-black cursor-pointer shadow-md transition-all flex items-center space-x-2 self-start active:scale-95"
                                    >
                                      <ArrowLeft className="w-4 h-4" />
                                      <span>Back</span>
                                    </button>
                                    <div className="flex items-center space-x-2 flex-wrap gap-y-1 mt-1">
                                      <span className="text-[9px] font-black tracking-widest text-[#d4af37] uppercase bg-[#0f4c2a]/5 border border-[#0f4c2a]/15 px-2 py-0.5 rounded-lg font-mono">
                                        {prog.programType || prog.category || 'Adults'}
                                      </span>
                                      {prog.committeeName && (
                                        <span className="text-[9px] font-bold text-stone-600 bg-stone-100 border border-stone-200 px-2 py-0.5 rounded-lg">
                                          🏛️ {prog.committeeName}
                                        </span>
                                      )}
                                      <span className="text-[9px] font-mono text-stone-400">ID: {prog.id}</span>
                                    </div>
                                    <h4 className="text-base font-extrabold text-stone-900 mt-1 capitalize font-heading">{prog.title}</h4>
                                    {prog.description && (
                                      <p className="text-stone-500 text-[10px] font-medium mt-0.5">{prog.description}</p>
                                    )}
                                  </div>
                                  <div className="flex flex-col items-end space-y-2 self-start">
                                    <button
                                      type="button"
                                      disabled={isSubmitting}
                                      onClick={() => handleDeleteProgram(prog.id, prog.title)}
                                      className="px-3 py-1.5 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 font-extrabold text-[10px] uppercase tracking-wider transition-all cursor-pointer shadow-xs flex items-center space-x-1"
                                    >
                                      <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                                      <span>Delete Program</span>
                                    </button>
                                    
                                    <div className="flex items-center space-x-2">
                                      {!isEditingProgram ? (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setWorkingProgram(JSON.parse(JSON.stringify(prog)));
                                            setIsEditingProgram(true);
                                          }}
                                          className="px-3 py-1.5 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white rounded-lg text-[10px] uppercase tracking-wider font-black cursor-pointer shadow-xs transition-all flex items-center space-x-1"
                                        >
                                          <Edit2 className="w-3.5 h-3.5" />
                                          <span>Modify Workspace</span>
                                        </button>
                                      ) : (
                                        <>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setIsEditingProgram(false);
                                              setWorkingProgram(JSON.parse(JSON.stringify(activePrograms.find(p => p.id === activeProgForManagement) || {})));
                                              setIsProgramDirty(false);
                                            }}
                                            className="px-3 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-lg text-[10px] uppercase tracking-wider font-bold cursor-pointer transition-all"
                                          >
                                            Cancel
                                          </button>
                                          <button
                                            type="button"
                                            disabled={!isProgramDirty || isSubmitting}
                                            onClick={handleSaveProgramWorkspace}
                                            className="px-3 py-1.5 bg-[#d4af37] hover:bg-[#c4a132] text-stone-900 rounded-lg text-[10px] uppercase tracking-wider font-black cursor-pointer shadow-xs transition-all disabled:opacity-50 flex items-center space-x-1"
                                          >
                                            <Save className="w-3.5 h-3.5" />
                                            <span>Save</span>
                                          </button>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                {/* SECTION 1: PROGRAM COORDINATORS */}
                                <div className="space-y-3">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-black uppercase text-[#0f4c2a] tracking-wider font-heading flex items-center space-x-1.5">
                                      <UserCheck className="w-3.5 h-3.5 text-[#d4af37]" />
                                      <span>Program Coordinators ({coordinators.length})</span>
                                    </span>
                                  </div>

                                  {coordinators.length === 0 ? (
                                    <div className="p-3 bg-stone-50 border border-dashed border-stone-200 rounded-xl text-center text-xs text-stone-500 font-bold">
                                      No coordinators assigned. Search below to add a coordinator.
                                    </div>
                                  ) : (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                      {coordinators.map(coord => (
                                        <div key={coord.residentId || coord.email} className="p-3 bg-emerald-50/40 border border-emerald-100 rounded-xl flex items-center justify-between">
                                          <div>
                                            <span className="text-xs font-black text-stone-900 block">{coord.fullName}</span>
                                            <span className="text-[9px] text-stone-500 font-mono block mt-0.5">{coord.email}</span>
                                          </div>
                                          <button
                                            type="button"
                                            disabled={isSubmitting || !isEditingProgram}
                                            onClick={() => localRemoveCoordinator(coord.residentId)}
                                            className={`p-1 rounded-lg ${isEditingProgram ? 'text-stone-400 hover:text-red-600 cursor-pointer' : 'text-stone-200 cursor-not-allowed'}`}
                                          >
                                            <X className="w-4 h-4" />
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  )}

                                  {/* Search & Add Coordinator */}
                                  {isEditingProgram && (
                                  <div className="space-y-2 pt-1">
                                    <div className="relative">
                                      <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-stone-400" />
                                      <input
                                        type="text"
                                        value={progCoordSearchQuery}
                                        onChange={(e) => setProgCoordSearchQuery(e.target.value)}
                                        placeholder="Search members to add as coordinator..."
                                        className="w-full pl-8 pr-3 py-1.5 font-bold bg-stone-50 border border-stone-200 rounded-xl text-xs text-stone-850 focus:outline-none focus:ring-1 focus:ring-[#0f4c2a]"
                                      />
                                    </div>

                                    {progCoordSearchQuery && (() => {
                                      const matchedCoordResidents = searchProgramCoordinatorCandidates(progCoordSearchQuery).filter(r => 
                                        !coordinators.some(c => c.residentId === r.id || c.email === r.email)
                                      );
                                      return (
                                      <div className="border border-stone-200 rounded-xl bg-white shadow-md max-h-36 overflow-y-auto divide-y divide-stone-100">
                                        {matchedCoordResidents.length === 0 ? (
                                          <div className="p-2.5 text-stone-450 italic text-[10px] text-center font-bold">
                                            No matching active residents found.
                                          </div>
                                        ) : (
                                          matchedCoordResidents.map(res => (
                                          <div key={res.id} className="p-2 flex items-center justify-between text-xs hover:bg-stone-50">
                                            <div>
                                              <span className="font-extrabold text-stone-900 block">{res.fullName}</span>
                                              <span className="text-[9px] text-stone-500 block">Unit {res.displayUnitNumber} • {res.email}</span>
                                            </div>
                                            <button
                                              type="button"
                                              disabled={isSubmitting}
                                              onClick={() => {
                                                localAssignCoordinator(res);
                                                setProgCoordSearchQuery('');
                                              }}
                                              className="px-2.5 py-1 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white rounded-lg text-[9px] uppercase tracking-wider font-black cursor-pointer shadow-xs"
                                            >
                                              Add
                                            </button>
                                          </div>
                                          ))
                                        )}
                                      </div>
                                      );
                                    })()}
                                  </div>
                                  )}
                                </div>

                                {/* SECTION 2: PROGRAM VOLUNTEERS */}
                                <div className="space-y-3 pt-2 border-t border-stone-150">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-black uppercase text-[#0f4c2a] tracking-wider font-heading flex items-center space-x-1.5">
                                      <HeartHandshake className="w-3.5 h-3.5 text-[#d4af37]" />
                                      <span>Program Volunteers ({volunteers.length})</span>
                                    </span>
                                  </div>

                                  {volunteers.length === 0 ? (
                                    <div className="p-3 bg-stone-50 border border-dashed border-stone-200 rounded-xl text-center text-xs text-stone-500 font-bold">
                                      No volunteers assigned yet. Search below to add volunteers.
                                    </div>
                                  ) : (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                      {volunteers.map(vol => (
                                        <div key={vol.residentId || vol.email} className="p-2.5 bg-amber-50/40 border border-amber-150 rounded-xl flex items-center justify-between">
                                          <div>
                                            <span className="text-xs font-black text-stone-900 block">{vol.fullName}</span>
                                            <span className="text-[9px] text-amber-800 font-bold block">{vol.role || 'Volunteer'}</span>
                                          </div>
                                          <button
                                            type="button"
                                            disabled={isSubmitting || !isEditingProgram}
                                            onClick={() => localRemoveVolunteer(vol.residentId)}
                                            className={`p-1 rounded-lg ${isEditingProgram ? 'text-stone-400 hover:text-red-600 cursor-pointer' : 'text-stone-200 cursor-not-allowed'}`}
                                          >
                                            <X className="w-4 h-4" />
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  )}

                                  {/* Search & Add Volunteer */}
                                  {isEditingProgram && (
                                  <div className="space-y-2 pt-1">
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                      <div className="sm:col-span-2 relative">
                                        <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-stone-400" />
                                        <input
                                          type="text"
                                          value={progVolSearchQuery}
                                          onChange={(e) => setProgVolSearchQuery(e.target.value)}
                                          placeholder="Search members to add as volunteer..."
                                          className="w-full pl-8 pr-3 py-1.5 font-bold bg-stone-50 border border-stone-200 rounded-xl text-xs text-stone-850 focus:outline-none focus:ring-1 focus:ring-[#0f4c2a]"
                                        />
                                      </div>
                                      <div>
                                        <input
                                          type="text"
                                          value={progVolRoleInput}
                                          onChange={(e) => setProgVolRoleInput(e.target.value)}
                                          placeholder="Role (e.g. Stage Setup)"
                                          className="w-full px-3 py-1.5 font-bold bg-stone-50 border border-stone-200 rounded-xl text-xs text-stone-850 focus:outline-none focus:ring-1 focus:ring-[#0f4c2a]"
                                        />
                                      </div>
                                    </div>

                                    {progVolSearchQuery && (
                                      <div className="border border-stone-200 rounded-xl bg-white shadow-md max-h-36 overflow-y-auto divide-y divide-stone-100">
                                        {(() => {
                                          const filtered = residents.filter(r => {
                                            if (r.status !== 'active') return false;
                                            if (volunteers.some(v => v.residentId === r.gmkId || v.email === r.email)) return false;
                                            const q = progVolSearchQuery.toLowerCase().trim();
                                            return r.fullName?.toLowerCase().includes(q) || r.displayUnitNumber?.toLowerCase().includes(q) || r.email?.toLowerCase().includes(q);
                                          });
                                          if (filtered.length === 0) {
                                            return (
                                              <div className="p-3 text-center space-y-2">
                                                <p className="text-stone-450 italic text-[10px] font-bold">No matching registered candidates found.</p>
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    const manualVol = {
                                                      gmkId: `manual_vol_${Date.now()}`,
                                                      fullName: progVolSearchQuery.trim(),
                                                      email: 'manual@external.com',
                                                      phone: 'N/A',
                                                      displayUnitNumber: 'External'
                                                    };
                                                    localAssignVolunteer(manualVol, progVolRoleInput);
                                                    setProgVolSearchQuery('');
                                                    setProgVolRoleInput('');
                                                  }}
                                                  className="px-3 py-1.5 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white rounded-lg text-[9px] uppercase tracking-wider font-black shadow-xs cursor-pointer inline-flex items-center space-x-1"
                                                >
                                                  <Plus className="w-3.5 h-3.5" />
                                                  <span>Add Manually: {progVolSearchQuery}</span>
                                                </button>
                                              </div>
                                            );
                                          }
                                          return filtered.map(res => (
                                          <div key={res.gmkId} className="p-2 flex items-center justify-between text-xs hover:bg-stone-50">
                                            <div>
                                              <span className="font-extrabold text-stone-900 block">{res.fullName}</span>
                                              <span className="text-[9px] text-stone-500 block">Unit {res.displayUnitNumber} • {res.email}</span>
                                            </div>
                                            <button
                                              type="button"
                                              disabled={isSubmitting}
                                              onClick={() => {
                                                localAssignVolunteer(res, progVolRoleInput);
                                                setProgVolSearchQuery('');
                                                setProgVolRoleInput('');
                                              }}
                                              className="px-2.5 py-1 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white rounded-lg text-[9px] uppercase tracking-wider font-black cursor-pointer shadow-xs"
                                            >
                                              Add
                                            </button>
                                          </div>
                                        ));
                                        })()}
                                      </div>
                                    )}
                                  </div>
                                  )}
                                </div>

                                {/* SECTION 3: PARTICIPANT ENROLLMENT */}
                                <div className="space-y-3 pt-2 border-t border-stone-150">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-black uppercase text-[#0f4c2a] tracking-wider font-heading flex items-center space-x-1.5">
                                      <Users className="w-3.5 h-3.5 text-[#d4af37]" />
                                      <span>Enrolled Participants ({participants.length})</span>
                                    </span>
                                  </div>

                                  {participants.length === 0 ? (
                                    <div className="p-3 bg-stone-50 border border-dashed border-stone-200 rounded-xl text-center text-xs text-stone-500 font-bold">
                                      No participants enrolled yet. Use search below to enroll community residents or children.
                                    </div>
                                  ) : (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                      {participants.map(part => {
                                        const partId = typeof part === 'string' ? part : (part.residentId || part.id || "");
                                        const partName = typeof part === 'string' ? part : (part.fullName || part.name || "");
                                        const partUnit = typeof part === 'object' ? part.unitDisplay : '';
                                        const partPhone = typeof part === 'object' ? part.phone : '';
                                        return (
                                          <div key={partId} className="p-2.5 bg-emerald-50/30 border border-emerald-100 rounded-xl flex items-center justify-between">
                                            <div>
                                              <span className="text-xs font-black text-stone-900 block">{partName}</span>
                                              {partUnit && <span className="text-[9px] text-stone-500 font-bold block">Unit {partUnit} {partPhone ? `• 📞 ${partPhone}` : ''}</span>}
                                            </div>
                                            <button
                                              type="button"
                                              disabled={isSubmitting || !isEditingProgram}
                                              onClick={() => localRemoveParticipant(partId)}
                                              className={`p-1 rounded-lg ${isEditingProgram ? 'text-stone-400 hover:text-red-600 cursor-pointer' : 'text-stone-200 cursor-not-allowed'}`}
                                            >
                                              <X className="w-4 h-4" />
                                            </button>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}

                                  {/* Search & Enroll Participant */}
                                  {isEditingProgram && (
                                  <div className="space-y-2 pt-1">
                                    {/* Age & Gender Filters for KIDS/MIXED */}
                                    {(() => {
                                      const pType = (prog.programType || prog.category || '').toUpperCase();
                                      if (pType === 'KIDS' || pType === 'MIXED') {
                                        return (
                                          <div className="flex flex-wrap items-center gap-2 pb-1">
                                            <select
                                              value={participantAgeFilter}
                                              onChange={(e) => setParticipantAgeFilter(e.target.value)}
                                              className="px-2.5 py-1.5 font-bold bg-white border border-stone-200 rounded-xl text-[10px] text-stone-850 focus:outline-none focus:ring-1 focus:ring-[#0f4c2a]"
                                            >
                                              <option value="All">All Ages</option>
                                              <option value="0-5">0-5 years</option>
                                              <option value="6-10">6-10 years</option>
                                              <option value="11-14">11-14 years</option>
                                              <option value="15-17">15-17 years</option>
                                              {pType === 'MIXED' && <option value="18+">Adults (18+)</option>}
                                            </select>
                                            <select
                                              value={participantGenderFilter}
                                              onChange={(e) => setParticipantGenderFilter(e.target.value)}
                                              className="px-2.5 py-1.5 font-bold bg-white border border-stone-200 rounded-xl text-[10px] text-stone-850 focus:outline-none focus:ring-1 focus:ring-[#0f4c2a]"
                                            >
                                              <option value="All">Any Gender</option>
                                              <option value="Male">Male</option>
                                              <option value="Female">Female</option>
                                            </select>
                                          </div>
                                        );
                                      }
                                      return null;
                                    })()}
                                    
                                    <div className="relative">
                                      <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-stone-400" />
                                      <input
                                        type="text"
                                        value={progParticipantSearchQuery}
                                        onChange={(e) => setProgParticipantSearchQuery(e.target.value)}
                                        placeholder={`Search residents or children for ${prog.programType || prog.category || 'Adults'} program...`}
                                        className="w-full pl-8 pr-3 py-1.5 font-bold bg-stone-50 border border-stone-200 rounded-xl text-xs text-stone-850 focus:outline-none focus:ring-1 focus:ring-[#0f4c2a]"
                                      />
                                    </div>

                                    {progParticipantSearchQuery && (
                                      <div className="border border-stone-200 rounded-xl bg-white shadow-md max-h-48 overflow-y-auto divide-y divide-stone-100">
                                        {(() => {
                                          const matchedCandidates = searchProgramParticipantCandidates(progParticipantSearchQuery, prog.programType || prog.category || 'Adults', participantAgeFilter, participantGenderFilter);
                                          const enrolledIds = participants.map(p => typeof p === 'string' ? p : (p.residentId || p.id));
                                          const filtered = matchedCandidates.filter(c => !enrolledIds.includes(c.id));

                                          if (filtered.length === 0) {
                                            return (
                                              <div className="p-3 text-center space-y-2">
                                                <p className="text-stone-450 italic text-[10px] font-bold">No matching registered candidates found.</p>
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    const newParticipant = {
                                                      id: `manual_${Date.now()}`,
                                                      fullName: progParticipantSearchQuery.trim(),
                                                      email: 'manual@external.com',
                                                      phone: 'N/A',
                                                      unitDisplay: 'External',
                                                      isChild: false
                                                    };
                                                    localAssignParticipant(newParticipant);
                                                    setProgParticipantSearchQuery('');
                                                  }}
                                                  className="px-3 py-1.5 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white rounded-lg text-[9px] uppercase tracking-wider font-black shadow-xs cursor-pointer inline-flex items-center space-x-1"
                                                >
                                                  <Plus className="w-3.5 h-3.5" />
                                                  <span>Add Manually: {progParticipantSearchQuery}</span>
                                                </button>
                                              </div>
                                            );
                                          }

                                          return filtered.map(candidate => {
                                            const isChild = candidate.relationship?.toLowerCase() === 'child' || candidate.isChild;
                                            return (
                                              <div key={candidate.id} className="p-2.5 flex items-center justify-between text-xs hover:bg-stone-50 gap-2">
                                                <div className="min-w-0 flex-1">
                                                  <div className="flex items-center space-x-1.5">
                                                    <span className="font-extrabold text-stone-900 truncate">{candidate.fullName}</span>
                                                    {candidate.gender && (
                                                      <span className="text-[8px] font-black uppercase tracking-wider px-1.5 py-0.2 rounded bg-stone-100 text-stone-600">
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
                                                    localAssignParticipant(candidate);
                                                    setProgParticipantSearchQuery('');
                                                  }}
                                                  className="px-2.5 py-1 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white rounded-lg text-[9px] uppercase tracking-wider font-black shrink-0 cursor-pointer shadow-xs"
                                                >
                                                  Enroll
                                                </button>
                                              </div>
                                            );
                                          });
                                        })()}
                                      </div>
                                    )}
                                  </div>
                                  )}
                                </div>

                                {/* SECTION 4: PROGRAM EXPENSES */}
                                <div className="space-y-3 pt-2 border-t border-stone-150">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-black uppercase text-[#0f4c2a] tracking-wider font-heading flex items-center space-x-1.5">
                                      <PieChart className="w-3.5 h-3.5 text-[#d4af37]" />
                                      <span>Program Expenses (OMR {totalExpense.toFixed(3)})</span>
                                    </span>
                                  </div>

                                  {expenses.length === 0 ? (
                                    <div className="p-3 bg-stone-50 border border-dashed border-stone-200 rounded-xl text-center text-xs text-stone-500 font-bold">
                                      No expenses recorded for this program yet.
                                    </div>
                                  ) : (
                                    <div className="border border-stone-200 rounded-xl overflow-hidden divide-y divide-stone-150 bg-white">
                                      <div className="bg-stone-50 p-2.5 grid grid-cols-12 text-[10px] uppercase font-black text-stone-600 tracking-wider">
                                        <div className="col-span-3">Date</div>
                                        <div className="col-span-5">Description</div>
                                        <div className="col-span-3 text-right">Amount (OMR)</div>
                                        <div className="col-span-1 text-center">Action</div>
                                      </div>
                                      {expenses.map(exp => (
                                        <div key={exp.id} className="p-2.5 grid grid-cols-12 items-center text-xs font-bold text-stone-850 hover:bg-stone-50/50">
                                          <div className="col-span-3 font-mono text-[11px] text-stone-600">{exp.date || exp.createdAt?.split('T')[0]}</div>
                                          <div className="col-span-5 font-semibold text-stone-900 truncate">{exp.title}</div>
                                          <div className="col-span-3 text-right font-mono font-extrabold text-[#0f4c2a]">
                                            OMR {(exp.amount || 0).toFixed(3)}
                                          </div>
                                          <div className="col-span-1 text-center">
                                            <button
                                              type="button"
                                              disabled={isSubmitting || !isEditingProgram}
                                              onClick={() => localRemoveExpense(exp.id)}
                                              className={`p-1 rounded-lg ${isEditingProgram ? 'text-stone-400 hover:text-red-600 cursor-pointer' : 'text-stone-200 cursor-not-allowed'}`}
                                            >
                                              <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}

                                  {/* Add Program Expense */}
                                  {isEditingProgram && (
                                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end pt-1 bg-stone-50 p-2.5 rounded-xl border border-stone-150">
                                    <div className="sm:col-span-3 space-y-1">
                                      <label className="text-[9px] uppercase font-black text-stone-500 tracking-wider block">Date</label>
                                      <input
                                        type="date"
                                        value={expenseDate}
                                        onChange={(e) => setExpenseDate(e.target.value)}
                                        className="w-full px-2.5 py-1.5 font-bold bg-white border border-stone-200 rounded-lg text-xs text-stone-850 focus:outline-none focus:ring-1 focus:ring-[#0f4c2a]"
                                      />
                                    </div>
                                    <div className="sm:col-span-4 space-y-1">
                                      <label className="text-[9px] uppercase font-black text-stone-500 tracking-wider block">Expense Title</label>
                                      <input
                                        type="text"
                                        value={expenseTitle}
                                        onChange={(e) => setExpenseTitle(e.target.value)}
                                        placeholder="Costume rental, props..."
                                        className="w-full px-2.5 py-1.5 font-bold bg-white border border-stone-200 rounded-lg text-xs text-stone-850 focus:outline-none focus:ring-1 focus:ring-[#0f4c2a]"
                                      />
                                    </div>
                                    <div className="sm:col-span-3 space-y-1">
                                      <label className="text-[9px] uppercase font-black text-stone-500 tracking-wider block">Amount (OMR)</label>
                                      <input
                                        type="number"
                                        step="0.001"
                                        value={expenseAmount}
                                        onChange={(e) => setExpenseAmount(e.target.value)}
                                        placeholder="0.000"
                                        className="w-full px-2.5 py-1.5 font-mono font-bold bg-white border border-stone-200 rounded-lg text-xs text-stone-850 focus:outline-none focus:ring-1 focus:ring-[#0f4c2a]"
                                      />
                                    </div>
                                    <div className="sm:col-span-2">
                                      <button
                                        type="button"
                                        disabled={isSubmitting || !expenseTitle.trim() || !expenseAmount.trim()}
                                        onClick={localAddExpense}
                                        className="w-full py-1.5 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white font-extrabold text-[10px] uppercase tracking-wider rounded-lg transition-all cursor-pointer shadow-xs disabled:opacity-50"
                                      >
                                        Log
                                      </button>
                                    </div>
                                  </div>
                                  )}
                                </div>

                                {/* ACTION BUTTONS */}
                                <div className="pt-4 border-t border-stone-150 flex items-center justify-between space-x-3">
                                  <button
                                    type="button"
                                    onClick={() => setActiveProgForManagement(null)}
                                    className="px-6 py-2.5 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white rounded-xl text-xs uppercase tracking-wider font-black cursor-pointer shadow-md transition-all flex items-center space-x-2 active:scale-95"
                                  >
                                    <ArrowLeft className="w-4 h-4" />
                                    <span>Back</span>
                                  </button>
                                  <div className="flex items-center space-x-3">
                                    {!isEditingProgram ? (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setWorkingProgram(JSON.parse(JSON.stringify(prog)));
                                            setIsEditingProgram(true);
                                          }}
                                          className="px-6 py-2.5 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white rounded-xl text-xs uppercase tracking-wider font-black cursor-pointer shadow-md transition-all flex items-center space-x-2"
                                        >
                                          <Edit2 className="w-4 h-4" />
                                          <span>Modify Workspace</span>
                                        </button>
                                      </>
                                    ) : (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setIsEditingProgram(false);
                                            setWorkingProgram(JSON.parse(JSON.stringify(activePrograms.find(p => p.id === activeProgForManagement) || {})));
                                            setIsProgramDirty(false);
                                          }}
                                          className="px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-xl text-xs uppercase tracking-wider font-bold cursor-pointer transition-all"
                                        >
                                          Cancel Changes
                                        </button>
                                        <button
                                          type="button"
                                          disabled={!isProgramDirty || isSubmitting}
                                          onClick={handleSaveProgramWorkspace}
                                          className="px-6 py-2.5 bg-[#d4af37] hover:bg-[#c4a132] text-stone-900 rounded-xl text-xs uppercase tracking-wider font-black cursor-pointer shadow-md transition-all disabled:opacity-50 flex items-center space-x-2"
                                        >
                                          <Save className="w-4 h-4" />
                                          <span>Save Program Data</span>
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      )}
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

                                    {registrations.length > 0 && (
                    <div className="flex justify-end pt-2 mb-4">
                      <button
                        onClick={handleDeleteAllRegistrations}
                        disabled={isSubmitting}
                        className="px-4 py-2.5 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center space-x-1.5 shadow-xs"
                        title="Delete All Registrations (Bulk Reset)"
                      >
                        <Trash2 className="w-4 h-4 text-red-600" />
                        <span>Delete All Registrations</span>
                      </button>
                    </div>
                  )}
                  <RegistrationReportingWorkspace 
                    events={events}
                    registrations={registrations}
                    families={families}
                    familyMembers={familyMembers}
                    activeEvent={activeEvent}
                    setPaymentModalReg={setPaymentModalReg}
                    isSubmitting={isSubmitting}
                  />
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
                              <div className="overflow-x-auto hide-scrollbar">
                                <div className="flex gap-1 bg-stone-100 p-1 rounded-xl border border-stone-200 text-[10px] font-extrabold font-mono min-w-max pb-px">
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

      {/* RECORD / PROCESS PAYMENT OVERLAY MODAL */}
      {paymentModalReg && (() => {
        const amtDue = paymentModalReg.amountDue ?? paymentModalReg.paymentAmount ?? paymentModalReg.paymentSummary?.totalAmount ?? 0;
        const amtRecNum = parseFloat(paymentModalAmtRec) || 0;
        const diff = amtRecNum - amtDue;

        return (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn">
            <div className="bg-white border border-stone-200 rounded-3xl p-6 max-w-lg w-full space-y-5 shadow-2xl animate-scaleUp text-left">
              <div className="flex justify-between items-start border-b border-stone-150 pb-3">
                <div>
                  <span className="text-[9px] font-mono font-bold text-[#d4af37] uppercase tracking-wider block">Finance Committee Operational Tool</span>
                  <h3 className="text-base font-black text-[#0f4c2a] font-heading">Record / Process Registration Payment</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setPaymentModalReg(null)}
                  className="p-1 hover:bg-stone-100 rounded-lg text-stone-400 hover:text-stone-700 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* HOUSEHOLD DETAILS */}
              <div className="bg-stone-50 border border-stone-200 rounded-2xl p-3.5 space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-stone-500 font-bold uppercase text-[9px]">GMK Household ID</span>
                  <span className="font-mono font-black text-stone-900 bg-stone-200/80 px-2 py-0.5 rounded text-[10px]">
                    {paymentModalReg.primaryMemberGmkId || 'N/A'}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-stone-500 font-bold uppercase text-[9px]">Primary Member Email</span>
                  <span className="font-semibold text-stone-800">{paymentModalReg.primaryMemberEmail}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-stone-500 font-bold uppercase text-[9px]">Total Registered Attendees</span>
                  <span className="font-mono font-black text-[#0f4c2a]">{paymentModalReg.totalParticipants || 1} Persons</span>
                </div>
              </div>

              {/* PAYMENT ENTRY & CALCULATION */}
              <div className="space-y-3">
                <div className="flex justify-between items-center bg-emerald-50 border border-emerald-200 p-3 rounded-2xl">
                  <span className="text-xs font-bold text-emerald-900 uppercase">Total Registration Fee Due</span>
                  <span className="text-base font-mono font-black text-[#0f4c2a]">OMR {amtDue.toFixed(3)}</span>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-black text-stone-600 tracking-wider block">
                    Amount Received from Resident (OMR)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-2.5 font-mono text-stone-400 text-xs font-bold">OMR</span>
                    <input
                      type="number"
                      step="0.001"
                      value={paymentModalAmtRec}
                      onChange={(e) => setPaymentModalAmtRec(e.target.value)}
                      placeholder="0.000"
                      className="w-full pl-12 pr-4 py-2 font-mono font-black bg-stone-50 hover:bg-stone-100 focus:bg-white border border-stone-300 focus:border-[#0f4c2a] rounded-xl text-sm text-stone-900 focus:outline-none"
                    />
                  </div>
                </div>

                {/* STATUS BADGE / CALCULATION PREVIEW */}
                <div className={`p-3 rounded-xl border text-xs font-bold ${
                  (amtRecNum === 0 && amtDue > 0) ? 'bg-stone-50 border-stone-300 text-stone-700' :
                  Math.abs(diff) < 0.0001 ? 'bg-emerald-50 border-emerald-300 text-emerald-900' :
                  diff < 0 ? 'bg-amber-50 border-amber-300 text-amber-950' :
                  'bg-blue-50 border-blue-300 text-blue-950'
                }`}>
                  <div className="flex justify-between items-center">
                    <span className="uppercase text-[9px]">Calculated Payment Status</span>
                    <span className="font-black uppercase">
                      {(amtRecNum === 0 && amtDue > 0) ? 'Pending' : Math.abs(diff) < 0.0001 ? 'Fully Paid' : diff < 0 ? 'Partially Paid' : 'Overpaid / Refund Due'}
                    </span>
                  </div>
                  {diff < 0 && (
                    <p className="text-[10px] mt-1 text-amber-800">
                      Remaining Balance Due: <strong className="font-mono font-black">OMR {Math.abs(diff).toFixed(3)}</strong>
                    </p>
                  )}
                  {diff > 0 && (
                    <p className="text-[10px] mt-1 text-blue-800">
                      Refund Amount Owed to Resident: <strong className="font-mono font-black">OMR {diff.toFixed(3)}</strong>
                    </p>
                  )}
                </div>

                {/* PRESETS */}
                <div className="flex items-center space-x-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setPaymentModalAmtRec(amtDue.toString())}
                    className="flex-1 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-800 text-[10px] font-bold uppercase rounded-lg border border-stone-250 transition-all cursor-pointer"
                  >
                    Set Full Amount
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPaymentModalAmtRec('0');
                      setPaymentModalRemarks('Fee Waived by Finance Committee');
                    }}
                    className="flex-1 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-900 text-[10px] font-bold uppercase rounded-lg border border-blue-200 transition-all cursor-pointer"
                  >
                    Mark Waived
                  </button>
                </div>

                {/* REMARKS */}
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-black text-stone-600 tracking-wider block">
                    Finance Committee Remarks / Payment Ref #
                  </label>
                  <input
                    type="text"
                    value={paymentModalRemarks}
                    onChange={(e) => setPaymentModalRemarks(e.target.value)}
                    placeholder="e.g. Bank Transfer Ref #12345 / Cash collected at desk..."
                    className="w-full px-3 py-2 font-bold bg-stone-50 border border-stone-250 rounded-xl text-xs text-stone-900 focus:outline-none focus:border-[#0f4c2a]"
                  />
                </div>
              </div>

              {/* ACTIONS */}
              <div className="flex items-center space-x-2 pt-2 border-t border-stone-150">
                <button
                  type="button"
                  onClick={() => setPaymentModalReg(null)}
                  className="flex-1 py-2.5 bg-stone-150 hover:bg-stone-200 text-stone-700 font-extrabold text-xs uppercase tracking-wider rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleRecordPaymentSubmit}
                  className="flex-1 py-2.5 bg-[#0f4c2a] hover:bg-[#0c3e22] text-white font-black text-xs uppercase tracking-wider rounded-xl shadow-md cursor-pointer flex items-center justify-center space-x-1.5 disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <Loader2 className="w-4 h-4 animate-spin text-[#d4af37]" />
                  ) : (
                    <>
                      <Check className="w-4 h-4 text-[#d4af37]" />
                      <span>Confirm & Record Payment</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

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
