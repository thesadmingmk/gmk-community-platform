import React, { useState, useEffect } from 'react';
import { 
  collection, 
  doc, 
  onSnapshot, 
  getDocs,
  setDoc,
  deleteDoc,
  query, 
  where 
} from 'firebase/firestore';
import { db } from '../context/AuthContext';
import { ResidentProfile, UserProfile, GovernanceAssignment, CommunityEvent, AuditLog } from '../types';
import { validateGovernanceAssignment } from '../utils/governanceExclusivity';
import { NotificationService } from '../services/NotificationService';
import { GMKCard, GMKBadge, GMKPageHeader } from './gmk/DesignSystem';
import { 
  ShieldCheck, 
  UserCheck, 
  UserMinus, 
  Search, 
  RefreshCw, 
  AlertTriangle, 
  FileText,
  DollarSign,
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle,
  XCircle,
  Clock,
  History,
  TrendingUp,
  LayoutDashboard,
  Users,
  Briefcase,
  Layers,
  Sparkles,
  ChevronRight,
  Calendar,
  Send,
  Ban,
  PlusCircle
} from 'lucide-react';

interface GovernancePanelProps {
  activeEmail: string;
}

const COMMITTEES = [
  "Finance Committee",
  "Program",
  "Food Committee",
  "Sports Committee",
  "Decoration Committee",
  "Sponsorship Committee",
  "Registration Committee",
  "Reception Committee",
  "Logistics Committee",
  "Media Committee",
  "Cultural Committee",
  "Safety Committee"
];

export default function GovernancePanel({ activeEmail }: GovernancePanelProps) {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'executive' | 'committee' | 'finance'>('dashboard');

  // Real-time Lists
  const [residents, setResidents] = useState<ResidentProfile[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [govAssignments, setGovAssignments] = useState<GovernanceAssignment[]>([]);
  const [roleAssignments, setRoleAssignments] = useState<GovernanceAssignment[]>([]);
  const [events, setEvents] = useState<CommunityEvent[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [openingBalance, setOpeningBalance] = useState<number>(0);
  const [financeStatements, setFinanceStatements] = useState<any[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Search filter - Executive Tab
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGmkId, setSelectedGmkId] = useState('');
  const [remarks, setRemarks] = useState('');

  // Search filter - Committee Tab
  const [committeeSearchQuery, setCommitteeSearchQuery] = useState('');
  const [selectedCommitteeGmkId, setSelectedCommitteeGmkId] = useState('');
  const [selectedCommittee, setSelectedCommittee] = useState('');
  const [committeeRemarks, setCommitteeRemarks] = useState('');

  // Finances Submissions State
  const [newStmtTitle, setNewStmtTitle] = useState('');
  const [newStmtAmount, setNewStmtAmount] = useState('');
  const [newStmtType, setNewStmtType] = useState<'income' | 'expense'>('income');
  const [newStmtNotes, setNewStmtNotes] = useState('');

  // Finances Config State
  const [editBalanceVal, setEditBalanceVal] = useState('');
  const [isEditingBalance, setIsEditingBalance] = useState(false);

  // Return for Correction Modal State
  const [returningStmtId, setReturningStmtId] = useState<string | null>(null);
  const [correctionReason, setCorrectionReason] = useState('');

  useEffect(() => {
    setLoading(true);
    setErrorMsg(null);

    const unsubResidents = onSnapshot(
      collection(db, "residents"),
      (snapshot) => {
        const list: ResidentProfile[] = [];
        snapshot.forEach((docSnap) => {
          list.push(docSnap.data() as ResidentProfile);
        });
        setResidents(list);
      },
      (err) => {
        console.error("❌ GovernancePanel Residents Snapshot Error:", err);
        setErrorMsg("Failed to synchronize residents database.");
      }
    );

    const unsubUsers = onSnapshot(
      collection(db, "users"),
      (snapshot) => {
        const list: UserProfile[] = [];
        snapshot.forEach((docSnap) => {
          list.push(docSnap.data() as UserProfile);
        });
        setUsers(list);
      },
      (err) => {
        console.error("❌ GovernancePanel Users Snapshot Error:", err);
      }
    );

    const unsubGov = onSnapshot(
      collection(db, "governanceAssignments"),
      (snapshot) => {
        const list: GovernanceAssignment[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          list.push({
            id: docSnap.id,
            gmkId: data.gmkId,
            email: data.email,
            position: data.position || data.role,
            assignedBy: data.assignedBy,
            assignedAt: data.assignedAt
          } as GovernanceAssignment);
        });
        setGovAssignments(list);
      },
      (err) => {
        console.error("❌ GovernancePanel Gov Assignments Snapshot Error:", err);
      }
    );

    const unsubRoles = onSnapshot(
      collection(db, "roleAssignments"),
      (snapshot) => {
        const list: GovernanceAssignment[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          list.push({
            id: docSnap.id,
            gmkId: data.gmkId,
            email: data.email,
            position: data.position || data.role,
            committee: data.committee,
            assignedBy: data.assignedBy,
            assignedAt: data.assignedAt
          } as GovernanceAssignment);
        });
        setRoleAssignments(list);
        setLoading(false);
      },
      (err) => {
        console.error("❌ GovernancePanel Role Assignments Snapshot Error:", err);
        setLoading(false);
      }
    );

    const unsubEvents = onSnapshot(
      collection(db, "events"),
      (snapshot) => {
        const list: CommunityEvent[] = [];
        snapshot.forEach((docSnap) => {
          list.push(docSnap.data() as CommunityEvent);
        });
        setEvents(list);
      },
      (err) => {
        console.error("❌ GovernancePanel Events Snapshot Error:", err);
      }
    );

    const unsubAudit = onSnapshot(
      collection(db, "auditLogs"),
      (snapshot) => {
        const list: AuditLog[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          list.push(data as AuditLog);
        });
        // Sort descending by timestamp
        list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        setAuditLogs(list);
      },
      (err) => {
        console.error("❌ GovernancePanel Audit Logs Snapshot Error:", err);
      }
    );

    const unsubBalance = onSnapshot(
      doc(db, "finances", "openingBalance"),
      (docSnap) => {
        if (docSnap.exists()) {
          const bal = docSnap.data().balance || 0;
          setOpeningBalance(bal);
          setEditBalanceVal(bal.toString());
        } else {
          setOpeningBalance(0);
          setEditBalanceVal('0');
        }
      },
      (err) => {
        console.error("❌ GovernancePanel Opening Balance Error:", err);
      }
    );

    const unsubStatements = onSnapshot(
      collection(db, "financeStatements"),
      (snapshot) => {
        const list: any[] = [];
        snapshot.forEach((docSnap) => {
          list.push({ id: docSnap.id, ...docSnap.data() });
        });
        // Sort descending by submittedAt
        list.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
        setFinanceStatements(list);
      },
      (err) => {
        console.error("❌ GovernancePanel Finance Statements Snapshot Error:", err);
      }
    );

    return () => {
      unsubResidents();
      unsubUsers();
      unsubGov();
      unsubRoles();
      unsubEvents();
      unsubAudit();
      unsubBalance();
      unsubStatements();
    };
  }, []);

  // Compute Active Actor Authority Type
  const activeUser = users.find(u => u.email.toLowerCase().trim() === activeEmail.toLowerCase().trim());
  const isPresident = activeUser?.roles.includes('president') || activeUser?.positions?.includes('president');
  const authorityType = isPresident ? 'President' : 'Vice President';

  // Eligible Active Registered Residents with portal account activation
  const eligibleResidents = residents.filter(res => {
    // 1. Must be active status in residents database
    if (res.status !== 'active') return false;
    
    // 2. Must have completed portal account activation (present in users collection with isActive status)
    const activeAccount = users.find(u => u.email.toLowerCase().trim() === res.email.toLowerCase().trim());
    if (!activeAccount || !activeAccount.isActive) return false;

    return true;
  });

  const activeEventDirector = govAssignments.find(ra => ra.position === 'event_director');
  const activeCommitteeLeads = roleAssignments.filter(ra => ra.position === 'committee_lead');

  // Finances Totals
  const totalApprovedIncome = financeStatements
    .filter(stmt => stmt.status === 'Approved' && stmt.type === 'income')
    .reduce((sum, stmt) => sum + (stmt.amount || 0), 0);

  const totalApprovedExpense = financeStatements
    .filter(stmt => stmt.status === 'Approved' && stmt.type === 'expense')
    .reduce((sum, stmt) => sum + (stmt.amount || 0), 0);

  const netBalance = openingBalance + totalApprovedIncome - totalApprovedExpense;

  // Filter lists based on search bars
  const filteredResidentsForED = eligibleResidents.filter(res => 
    res.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    res.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
    res.gmkId.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredResidentsForCommittee = eligibleResidents.filter(res => 
    res.fullName.toLowerCase().includes(committeeSearchQuery.toLowerCase()) ||
    res.email.toLowerCase().includes(committeeSearchQuery.toLowerCase()) ||
    res.gmkId.toLowerCase().includes(committeeSearchQuery.toLowerCase())
  );

  // Appoint Event Director Handler
  const handleAppoint = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!selectedGmkId) {
      setErrorMsg("Please select a resident to appoint.");
      return;
    }

    const targetRes = residents.find(r => r.gmkId === selectedGmkId);
    if (!targetRes) {
      setErrorMsg("Selected resident profile not found.");
      return;
    }

    const normEmail = targetRes.email.toLowerCase().trim();

    // Enforce Role Exclusivity with helper
    const validation = validateGovernanceAssignment(
      { gmkId: targetRes.gmkId, email: normEmail, name: targetRes.fullName },
      'event_director',
      govAssignments
    );

    if (!validation.eligible) {
      setErrorMsg(validation.reason || "This resident holds another active governance role.");
      return;
    }

    // Additional safety verification
    const hasAdmin = govAssignments.some(ra => ra.position === 'admin' && (ra.gmkId === targetRes.gmkId || ra.email === normEmail));
    const hasPresident = govAssignments.some(ra => (ra.position === 'president' || ra.position === 'vp') && (ra.gmkId === targetRes.gmkId || ra.email === normEmail));
    
    if (hasAdmin) {
      setErrorMsg(`REJECTED: '${targetRes.fullName}' is currently an Admin. An Admin cannot be appointed as Event Director.`);
      return;
    }

    if (hasPresident) {
      setErrorMsg(`REJECTED: '${targetRes.fullName}' holds an active executive position (President/VP) and cannot assume this operational role.`);
      return;
    }

    if (govAssignments.some(ra => ra.position === 'event_director')) {
      setErrorMsg("REJECTED: The Event Director role is already assigned. Please revoke the current Event Director before appointing a new one.");
      return;
    }

    try {
      const assignmentId = `${targetRes.gmkId}_event_director`;
      const emailAssignmentId = `${normEmail}_event_director`;

      const govDocRef = doc(db, "governanceAssignments", assignmentId);
      const roleDocRef = doc(db, "roleAssignments", assignmentId);
      const govEmailDocRef = doc(db, "governanceAssignments", emailAssignmentId);
      const roleEmailDocRef = doc(db, "roleAssignments", emailAssignmentId);

      const payload = {
        id: assignmentId,
        gmkId: targetRes.gmkId,
        email: normEmail,
        position: 'event_director',
        role: 'event_director',
        status: 'ACTIVE',
        assignedBy: activeEmail,
        assignedAt: new Date().toISOString()
      };

      const emailPayload = {
        ...payload,
        id: emailAssignmentId
      };

      await setDoc(govDocRef, payload);
      await setDoc(roleDocRef, payload);
      await setDoc(govEmailDocRef, emailPayload);
      await setDoc(roleEmailDocRef, emailPayload);

      // Sync to user SSO roles array
      const userQ = query(collection(db, "users"), where("email", "==", normEmail));
      const userSnap = await getDocs(userQ);
      for (const uDoc of userSnap.docs) {
        const currentRoles: string[] = uDoc.data().roles || [];
        const updatedRoles = Array.from(new Set([...currentRoles, 'event_director']));
        await setDoc(doc(db, "users", uDoc.id), { roles: updatedRoles }, { merge: true });
      }

      // Generate Governance Override Audit Entry
      const auditId = `audit_${Date.now()}`;
      await setDoc(doc(db, "auditLogs", auditId), {
        id: auditId,
        timestamp: new Date().toISOString(),
        action: 'APPOINT_EVENT_DIRECTOR',
        actorEmail: activeEmail,
        entityType: 'role_assignment',
        entityId: targetRes.gmkId,
        details: `[${authorityType}] Appointed ${targetRes.fullName} as Event Director. Remarks: ${remarks || 'None'}.`,
        targetName: targetRes.fullName
      });

      await NotificationService.sendEventDirectorAppointment(normEmail, {
        residentName: targetRes.fullName,
        appointedBy: activeEmail
      });

      setSuccessMsg(`✓ Successfully appointed ${targetRes.fullName} as the Event Director!`);
      setSelectedGmkId('');
      setRemarks('');
    } catch (err: any) {
      console.error("❌ Failed to appoint Event Director:", err);
      setErrorMsg(`Appointment failed: ${err.message}`);
    }
  };

  // Revoke Event Director Handler
  const handleRevoke = async (assignment: GovernanceAssignment) => {
    setErrorMsg(null);
    setSuccessMsg(null);

    const targetRes = residents.find(r => r.gmkId === assignment.gmkId || r.email.toLowerCase().trim() === assignment.email.toLowerCase().trim());
    const resName = targetRes ? targetRes.fullName : assignment.email;
    const resEmail = assignment.email.toLowerCase().trim();

    try {
      const assignmentId = `${assignment.gmkId}_event_director`;
      const emailAssignmentId = `${resEmail}_event_director`;

      await deleteDoc(doc(db, "governanceAssignments", assignmentId));
      await deleteDoc(doc(db, "roleAssignments", assignmentId));
      await deleteDoc(doc(db, "governanceAssignments", emailAssignmentId));
      await deleteDoc(doc(db, "roleAssignments", emailAssignmentId));

      const userQ = query(collection(db, "users"), where("email", "==", resEmail));
      const userSnap = await getDocs(userQ);
      for (const uDoc of userSnap.docs) {
        const currentRoles: string[] = uDoc.data().roles || [];
        const updatedRoles = currentRoles.filter((r: string) => r !== 'event_director');
        await setDoc(doc(db, "users", uDoc.id), { roles: updatedRoles }, { merge: true });
      }

      const auditId = `audit_${Date.now()}`;
      await setDoc(doc(db, "auditLogs", auditId), {
        id: auditId,
        timestamp: new Date().toISOString(),
        action: 'REMOVE_ROLE',
        actorEmail: activeEmail,
        entityType: 'role_assignment',
        entityId: assignment.gmkId || 'unknown',
        details: `[${authorityType}] Revoked Event Director appointment for ${resName}.`,
        targetName: resName
      });

      await NotificationService.sendEventDirectorRevocation(resEmail, {
        residentName: resName,
        revokedBy: activeEmail
      });

      setSuccessMsg(`✓ Successfully revoked Event Director role from ${resName}`);
    } catch (err: any) {
      console.error("❌ Failed to revoke Event Director:", err);
      setErrorMsg(`Revocation failed: ${err.message}`);
    }
  };

  // Appoint Committee Lead Handler
  const handleAppointCommitteeLead = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!selectedCommitteeGmkId) {
      setErrorMsg("Please select a resident to appoint as Committee Lead.");
      return;
    }

    if (!selectedCommittee) {
      setErrorMsg("Please select a committee for this appointment.");
      return;
    }

    const targetRes = residents.find(r => r.gmkId === selectedCommitteeGmkId);
    if (!targetRes) {
      setErrorMsg("Selected resident profile not found.");
      return;
    }

    const normEmail = targetRes.email.toLowerCase().trim();

    // Exclusivity Checks: Cannot hold another governance role (Admin, Super Admin, President, VP, Event Director)
    const holdsGovRole = govAssignments.some(ra => (ra.gmkId === targetRes.gmkId || ra.email === normEmail)) ||
                        roleAssignments.some(ra => (ra.gmkId === targetRes.gmkId || ra.email === normEmail));

    if (holdsGovRole) {
      setErrorMsg(`REJECTED: '${targetRes.fullName}' already holds a governance position. Under GOV-01A safeguards, governance stakeholders may hold exactly one governance role simultaneously.`);
      return;
    }

    try {
      let cType = 'general';
      const n = selectedCommittee.toLowerCase();
      if (n.includes('finance')) cType = 'finance';
      else if (n.includes('food')) cType = 'food';
      else if (n.includes('attendance')) cType = 'attendance';
      else if (n.includes('program')) cType = 'program';
      else if (n.includes('sourcing')) cType = 'sourcing';
      else if (n.includes('sponsorship')) cType = 'sponsorship';
      
      let safeCommitteeKey = cType;
      if (safeCommitteeKey === 'events_&_programs' || safeCommitteeKey === 'programs') safeCommitteeKey = 'program';
      const assignmentId = `${targetRes.gmkId}_committee_lead_${safeCommitteeKey}`;
      const emailAssignmentId = `${normEmail}_committee_lead_${safeCommitteeKey}`;

      const roleDocRef = doc(db, "roleAssignments", assignmentId);
      const roleEmailDocRef = doc(db, "roleAssignments", emailAssignmentId);

      const payload = {
        id: assignmentId,
        gmkId: targetRes.gmkId,
        email: normEmail,
        position: 'committee_lead',
        role: 'committee_lead',
        committee: selectedCommittee,
        status: 'ACTIVE',
        assignedBy: activeEmail,
        assignedAt: new Date().toISOString()
      };

      const emailPayload = {
        ...payload,
        id: emailAssignmentId
      };

      await setDoc(roleDocRef, payload);
      await setDoc(roleEmailDocRef, emailPayload);

      // Sync to User roles
      const userQ = query(collection(db, "users"), where("email", "==", normEmail));
      const userSnap = await getDocs(userQ);
      for (const uDoc of userSnap.docs) {
        const currentRoles: string[] = uDoc.data().roles || [];
        const updatedRoles = Array.from(new Set([...currentRoles, 'committee_lead', `committee_lead_${safeCommitteeKey}`]));
        await setDoc(doc(db, "users", uDoc.id), { roles: updatedRoles }, { merge: true });
      }

      // Audit Trail
      const auditId = `audit_${Date.now()}`;
      await setDoc(doc(db, "auditLogs", auditId), {
        id: auditId,
        timestamp: new Date().toISOString(),
        action: 'CREATE_COMMITTEE_LEAD',
        actorEmail: activeEmail,
        entityType: 'role_assignment',
        entityId: targetRes.gmkId,
        details: `[${authorityType}] Appointed Committee Lead: ${targetRes.fullName} (${targetRes.gmkId}) for ${selectedCommittee}. Remarks: ${committeeRemarks || 'None'}.`,
        targetName: targetRes.fullName
      });

      setSuccessMsg(`✓ Successfully appointed ${targetRes.fullName} as Committee Lead for ${selectedCommittee}!`);
      setSelectedCommitteeGmkId('');
      setSelectedCommittee('');
      setCommitteeRemarks('');
    } catch (err: any) {
      console.error("❌ Committee Lead Appointment Failed:", err);
      setErrorMsg(`Appointment failed: ${err.message}`);
    }
  };

  // Revoke Committee Lead Handler
  const handleRevokeCommitteeLead = async (assignment: GovernanceAssignment) => {
    setErrorMsg(null);
    setSuccessMsg(null);

    const targetRes = residents.find(r => r.gmkId === assignment.gmkId || r.email.toLowerCase().trim() === assignment.email.toLowerCase().trim());
    const resName = targetRes ? targetRes.fullName : assignment.email;
    const resEmail = assignment.email.toLowerCase().trim();
    const committeeName = assignment.committee || "Selected Committee";
    let cType = 'general';
    const n = committeeName.toLowerCase();
    if (n.includes('finance')) cType = 'finance';
    else if (n.includes('food')) cType = 'food';
    else if (n.includes('attendance')) cType = 'attendance';
    else if (n.includes('program')) cType = 'program';
    else if (n.includes('sourcing')) cType = 'sourcing';
    else if (n.includes('sponsorship')) cType = 'sponsorship';
    
    let safeCommitteeKey = cType;
    if (safeCommitteeKey === 'events_&_programs' || safeCommitteeKey === 'programs') safeCommitteeKey = 'program';

    try {
      const assignmentId = `${assignment.gmkId}_committee_lead_${safeCommitteeKey}`;
      const emailAssignmentId = `${resEmail}_committee_lead_${safeCommitteeKey}`;

      await deleteDoc(doc(db, "roleAssignments", assignmentId));
      await deleteDoc(doc(db, "roleAssignments", emailAssignmentId));

      const otherRoles = roleAssignments.filter(ra => 
        ra.id !== assignmentId && 
        ra.id !== emailAssignmentId && 
        ra.position === 'committee_lead' && 
        ra.email.toLowerCase().trim() === resEmail
      );

      if (otherRoles.length === 0) {
        const userQ = query(collection(db, "users"), where("email", "==", resEmail));
        const userSnap = await getDocs(userQ);
        for (const uDoc of userSnap.docs) {
          const currentRoles: string[] = uDoc.data().roles || [];
          const updatedRoles = currentRoles.filter((r: string) => r !== 'committee_lead' && r !== `committee_lead_${safeCommitteeKey}`);
          await setDoc(doc(db, "users", uDoc.id), { roles: updatedRoles }, { merge: true });
        }
      }

      // Audit Trail
      const auditId = `audit_${Date.now()}`;
      await setDoc(doc(db, "auditLogs", auditId), {
        id: auditId,
        timestamp: new Date().toISOString(),
        action: 'REVOKE_COMMITTEE_LEAD',
        actorEmail: activeEmail,
        entityType: 'role_assignment',
        entityId: assignment.gmkId || 'unknown',
        details: `[${authorityType}] Revoked Committee Lead role of ${resName} from ${committeeName}.`,
        targetName: resName
      });

      setSuccessMsg(`✓ Successfully revoked Committee Lead role from ${resName} for ${committeeName}`);
    } catch (err: any) {
      console.error("❌ Committee Lead Revocation Failed:", err);
      setErrorMsg(`Revocation failed: ${err.message}`);
    }
  };

  // Set Opening Balance Handler
  const handleSetOpeningBalance = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const numericVal = parseFloat(editBalanceVal);
    if (isNaN(numericVal) || numericVal < 0) {
      setErrorMsg("Please enter a valid, non-negative opening balance amount.");
      return;
    }

    try {
      await setDoc(doc(db, "finances", "openingBalance"), { balance: numericVal });
      setIsEditingBalance(false);

      // Audit Trail
      const auditId = `audit_${Date.now()}`;
      await setDoc(doc(db, "auditLogs", auditId), {
        id: auditId,
        timestamp: new Date().toISOString(),
        action: 'FINANCE_OPENING_BALANCE_UPDATE',
        actorEmail: activeEmail,
        entityType: 'finance',
        entityId: 'openingBalance',
        details: `[${authorityType}] Configured community opening bank balance to ${numericVal} OMR.`,
        targetName: 'Opening Balance'
      });

      setSuccessMsg(`✓ Successfully configured Opening Balance to ${numericVal} OMR`);
    } catch (err: any) {
      console.error("❌ Failed to set Opening Balance:", err);
      setErrorMsg(`Failed to save balance configuration: ${err.message}`);
    }
  };

  // Create Finance Statement Handler (Sandbox support)
  const handleCreateStatement = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!newStmtTitle.trim()) {
      setErrorMsg("Please provide a statement title or purpose.");
      return;
    }

    const amt = parseFloat(newStmtAmount);
    if (isNaN(amt) || amt <= 0) {
      setErrorMsg("Please enter a valid statement amount greater than 0 OMR.");
      return;
    }

    try {
      const stmtId = `stmt_${Date.now()}`;
      const payload = {
        id: stmtId,
        title: newStmtTitle.trim(),
        amount: amt,
        type: newStmtType,
        status: 'Pending',
        submittedBy: activeEmail,
        submittedAt: new Date().toISOString(),
        notes: newStmtNotes.trim(),
        correctionNotes: ''
      };

      await setDoc(doc(db, "financeStatements", stmtId), payload);

      // Audit
      const auditId = `audit_${Date.now()}`;
      await setDoc(doc(db, "auditLogs", auditId), {
        id: auditId,
        timestamp: new Date().toISOString(),
        action: 'FINANCE_STATEMENT_SUBMITTED',
        actorEmail: activeEmail,
        entityType: 'finance_statement',
        entityId: stmtId,
        details: `[${authorityType}] Submitted a new community ${newStmtType} statement: "${newStmtTitle.trim()}" for ${amt} OMR.`,
        targetName: newStmtTitle.trim()
      });

      setSuccessMsg(`✓ Successfully recorded community ${newStmtType} statement: "${newStmtTitle}"!`);
      setNewStmtTitle('');
      setNewStmtAmount('');
      setNewStmtNotes('');
    } catch (err: any) {
      console.error("❌ Statement recording failed:", err);
      setErrorMsg(`Failed to record statement: ${err.message}`);
    }
  };

  // Approve Statement Handler
  const handleApproveStatement = async (stmtId: string) => {
    setErrorMsg(null);
    setSuccessMsg(null);

    const stmt = financeStatements.find(s => s.id === stmtId);
    if (!stmt) return;

    try {
      await setDoc(doc(db, "financeStatements", stmtId), {
        status: 'Approved',
        reviewedBy: activeEmail,
        reviewedAt: new Date().toISOString()
      }, { merge: true });

      // Audit
      const auditId = `audit_${Date.now()}`;
      await setDoc(doc(db, "auditLogs", auditId), {
        id: auditId,
        timestamp: new Date().toISOString(),
        action: 'FINANCE_STATEMENT_APPROVED',
        actorEmail: activeEmail,
        entityType: 'finance_statement',
        entityId: stmtId,
        details: `[${authorityType}] Approved community finance statement: "${stmt.title}" (${stmt.amount} OMR).`,
        targetName: stmt.title
      });

      setSuccessMsg(`✓ Successfully approved statement: "${stmt.title}"`);
    } catch (err: any) {
      console.error("❌ Failed to approve statement:", err);
      setErrorMsg(`Statement approval failed: ${err.message}`);
    }
  };

  // Return Statement for Correction Handler
  const handleReturnStatement = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!returningStmtId) return;
    if (!correctionReason.trim()) {
      setErrorMsg("Please enter the specific correction instructions.");
      return;
    }

    const stmt = financeStatements.find(s => s.id === returningStmtId);
    if (!stmt) return;

    try {
      await setDoc(doc(db, "financeStatements", returningStmtId), {
        status: 'Returned for Correction',
        correctionNotes: correctionReason.trim(),
        reviewedBy: activeEmail,
        reviewedAt: new Date().toISOString()
      }, { merge: true });

      // Audit
      const auditId = `audit_${Date.now()}`;
      await setDoc(doc(db, "auditLogs", auditId), {
        id: auditId,
        timestamp: new Date().toISOString(),
        action: 'FINANCE_STATEMENT_RETURNED',
        actorEmail: activeEmail,
        entityType: 'finance_statement',
        entityId: returningStmtId,
        details: `[${authorityType}] Returned statement "${stmt.title}" for correction with reason: "${correctionReason.trim()}"`,
        targetName: stmt.title
      });

      setSuccessMsg(`✓ Successfully returned statement: "${stmt.title}" for correction.`);
      setReturningStmtId(null);
      setCorrectionReason('');
    } catch (err: any) {
      console.error("❌ Failed to return statement:", err);
      setErrorMsg(`Failed to return statement: ${err.message}`);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-3">
        <RefreshCw className="w-7 h-7 text-[#0f4c2a] animate-spin" />
        <span className="text-xs font-bold text-stone-500 uppercase tracking-widest">Synchronizing Governance Matrix...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 text-xs font-semibold text-stone-600 animate-fadeIn" id="governance-panel-root">
      
      {/* 1. Page Header */}
      <GMKCard className="flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="space-y-1">
          <GMKPageHeader 
            title="Governance Leadership Control Panel" 
            subtitle="As President or Vice President, you hold sovereign executive authority over operational appointments, overriding assignments, and financial configurations."
          />
        </div>
        
        <div className="bg-[#FFFDF6] border border-[#d4af37]/40 p-4 rounded-2xl flex items-center space-x-2 shrink-0 shadow-xs">
          <ShieldCheck className="w-5 h-5 text-[#d4af37]" />
          <div>
            <span className="block text-[#0f4c2a] font-extrabold uppercase tracking-widest text-[8.5px] font-mono">CONSTITUTIONAL REPRESENTATIVE</span>
            <strong className="block text-stone-850 text-[10.5px] font-bold font-serif">{authorityType} ({activeEmail})</strong>
          </div>
        </div>
      </GMKCard>

      {/* 2. Feedback Messages */}
      {errorMsg && (
        <div className="bg-rose-50 border border-rose-200 p-4 rounded-2xl flex items-start space-x-2.5 text-rose-800 font-bold leading-relaxed animate-fadeIn">
          <AlertTriangle className="w-4.5 h-4.5 text-rose-600 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-2xl flex items-start space-x-2.5 text-emerald-800 font-bold leading-relaxed animate-fadeIn">
          <UserCheck className="w-4.5 h-4.5 text-emerald-600 shrink-0 mt-0.5" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* 3. Sub-Navigation Tabs */}
      <div className="overflow-x-auto hide-scrollbar border-b border-stone-200">
        <div className="flex items-center space-x-1.5 min-w-max pb-px">
          <button
            onClick={() => { setActiveTab('dashboard'); setErrorMsg(null); setSuccessMsg(null); }}
          className={`px-4 py-2.5 rounded-t-xl text-[10px] font-mono font-bold uppercase tracking-wider transition-all border-b-2 cursor-pointer flex items-center space-x-1.5 ${
            activeTab === 'dashboard'
              ? 'border-[#0f4c2a] text-[#0f4c2a] bg-emerald-50/40 font-black'
              : 'border-transparent text-stone-550 hover:text-stone-800'
          }`}
        >
          <LayoutDashboard className="w-3.5 h-3.5" />
          <span>Overview Dashboard</span>
        </button>

        <button
          onClick={() => { setActiveTab('executive'); setErrorMsg(null); setSuccessMsg(null); }}
          className={`px-4 py-2.5 rounded-t-xl text-[10px] font-mono font-bold uppercase tracking-wider transition-all border-b-2 cursor-pointer flex items-center space-x-1.5 ${
            activeTab === 'executive'
              ? 'border-[#0f4c2a] text-[#0f4c2a] bg-emerald-50/40 font-black'
              : 'border-transparent text-stone-550 hover:text-stone-800'
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Executive Governance</span>
        </button>

        <button
          onClick={() => { setActiveTab('committee'); setErrorMsg(null); setSuccessMsg(null); }}
          className={`px-4 py-2.5 rounded-t-xl text-[10px] font-mono font-bold uppercase tracking-wider transition-all border-b-2 cursor-pointer flex items-center space-x-1.5 ${
            activeTab === 'committee'
              ? 'border-[#0f4c2a] text-[#0f4c2a] bg-emerald-50/40 font-black'
              : 'border-transparent text-stone-550 hover:text-stone-800'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>Committee Lead Appointments</span>
        </button>

        <button
          onClick={() => { setActiveTab('finance'); setErrorMsg(null); setSuccessMsg(null); }}
          className={`px-4 py-2.5 rounded-t-xl text-[10px] font-mono font-bold uppercase tracking-wider transition-all border-b-2 cursor-pointer flex items-center space-x-1.5 ${
            activeTab === 'finance'
              ? 'border-[#0f4c2a] text-[#0f4c2a] bg-emerald-50/40 font-black'
              : 'border-transparent text-stone-550 hover:text-stone-800'
          }`}
        >
          <DollarSign className="w-3.5 h-3.5" />
          <span>Finance Governance</span>
        </button>
      </div>
      </div>

      {/* Tab Contents */}

      {/* A. OVERVIEW DASHBOARD */}
      {activeTab === 'dashboard' && (
        <div className="space-y-6 animate-fadeIn">
          
          {/* 1. Treasury Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            
            <div className="bg-white border border-stone-200 p-4 rounded-2xl flex items-center justify-between shadow-xs">
              <div>
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-stone-500 block">Opening Balance</span>
                <strong className="text-lg font-serif font-black text-stone-850 block mt-1">{openingBalance.toLocaleString()} OMR</strong>
                <span className="text-[9.5px] text-stone-500 font-semibold block mt-0.5">Community starter bank value</span>
              </div>
              <div className="w-10 h-10 rounded-full bg-stone-50 border border-stone-150 flex items-center justify-center text-stone-600">
                <History className="w-5 h-5" />
              </div>
            </div>

            <div className="bg-emerald-50/50 border border-emerald-150 p-4 rounded-2xl flex items-center justify-between shadow-xs">
              <div>
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-emerald-800 block">Approved Income</span>
                <strong className="text-lg font-serif font-black text-emerald-950 block mt-1">+{totalApprovedIncome.toLocaleString()} OMR</strong>
                <span className="text-[9.5px] text-emerald-700 font-semibold block mt-0.5">Sponsorships, tickets, collections</span>
              </div>
              <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700">
                <ArrowUpRight className="w-5 h-5" />
              </div>
            </div>

            <div className="bg-rose-50/50 border border-rose-150 p-4 rounded-2xl flex items-center justify-between shadow-xs">
              <div>
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-rose-800 block">Approved Expenses</span>
                <strong className="text-lg font-serif font-black text-rose-950 block mt-1">-{totalApprovedExpense.toLocaleString()} OMR</strong>
                <span className="text-[9.5px] text-rose-700 font-semibold block mt-0.5">Catering, stage, logistics</span>
              </div>
              <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center text-rose-700">
                <ArrowDownRight className="w-5 h-5" />
              </div>
            </div>

            <div className="bg-[#0f4c2a] text-white border border-[#11542f] p-4 rounded-2xl flex items-center justify-between shadow-sm">
              <div>
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#d4af37] block">Net Available Balance</span>
                <strong className="text-lg font-serif font-black text-white block mt-1">{netBalance.toLocaleString()} OMR</strong>
                <span className="text-[9.5px] text-emerald-250 font-semibold block mt-0.5">Liquid cash for operations</span>
              </div>
              <div className="w-10 h-10 rounded-full bg-emerald-900 flex items-center justify-center text-[#d4af37]">
                <TrendingUp className="w-5 h-5" />
              </div>
            </div>

          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {/* Left: Active Officials and Events */}
            <div className="space-y-6">
              
              {/* Event Director Status Card */}
              <GMKCard className="space-y-4">
                <h4 className="text-xs font-extrabold text-[#0f4c2a] uppercase tracking-wider flex items-center space-x-1.5 font-heading border-b border-stone-100 pb-3">
                  <ShieldCheck className="w-4 h-4 text-[#d4af37]" />
                  <span>Appointed Event Director</span>
                </h4>

                {activeEventDirector ? (
                  <div className="bg-emerald-50/50 border border-emerald-150 p-4 rounded-2xl flex items-start justify-between animate-fadeIn">
                    <div className="space-y-1">
                      <strong className="text-stone-850 text-[12px] font-bold block">
                        {residents.find(r => r.gmkId === activeEventDirector.gmkId)?.fullName || activeEventDirector.email}
                      </strong>
                      <span className="text-stone-600 font-semibold block text-[10px]">
                        ID: {activeEventDirector.gmkId} • {activeEventDirector.email}
                      </span>
                      <span className="text-[9.5px] font-mono text-stone-550 block">
                        Appointed by: {activeEventDirector.assignedBy} on {new Date(activeEventDirector.assignedAt).toLocaleDateString()}
                      </span>
                    </div>
                    <GMKBadge variant="success">ACTIVE</GMKBadge>
                  </div>
                ) : (
                  <div className="text-center py-6 bg-stone-50 border border-stone-150 rounded-2xl">
                    <p className="text-stone-500 font-semibold text-xs">No appointed Event Director found.</p>
                    <p className="text-[10px] text-stone-400 font-medium">Head to Executive Governance tab to appoint one.</p>
                  </div>
                )}
              </GMKCard>

              {/* Committee Leads Status Card */}
              <GMKCard className="space-y-4">
                <h4 className="text-xs font-extrabold text-[#0f4c2a] uppercase tracking-wider flex items-center space-x-1.5 font-heading border-b border-stone-100 pb-3">
                  <Users className="w-4 h-4 text-[#d4af37]" />
                  <span>Committee Leads Override Registry ({activeCommitteeLeads.length})</span>
                </h4>

                {activeCommitteeLeads.length > 0 ? (
                  <div className="space-y-2 max-h-[220px] overflow-y-auto">
                    {activeCommitteeLeads.map(lead => {
                      const res = residents.find(r => r.gmkId === lead.gmkId || r.email.toLowerCase().trim() === lead.email.toLowerCase().trim());
                      return (
                        <div key={lead.id} className="bg-white border border-stone-200 hover:border-stone-300 p-3 rounded-xl flex items-center justify-between transition-colors">
                          <div>
                            <span className="font-extrabold text-stone-850 block">{res ? res.fullName : lead.email}</span>
                            <span className="text-stone-500 block text-[9.5px]">Unit: {res?.displayUnitNumber || 'Decoupled'} | {lead.email}</span>
                          </div>
                          <div className="text-right">
                            <span className="inline-block text-[9px] font-mono bg-stone-100 border border-stone-200 text-stone-600 px-2 py-0.5 rounded-full font-bold">
                              OVERRIDE ACTIVE
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-center py-6 text-stone-500 bg-stone-50 border border-stone-150 rounded-2xl">
                    No custom Committee Leads overrides currently configured in the community.
                  </p>
                )}
              </GMKCard>

              {/* Active Events Card */}
              <GMKCard className="space-y-4">
                <h4 className="text-xs font-extrabold text-[#0f4c2a] uppercase tracking-wider flex items-center space-x-1.5 font-heading border-b border-stone-100 pb-3">
                  <Calendar className="w-4 h-4 text-[#d4af37]" />
                  <span>Active Community Events ({events.length})</span>
                </h4>

                {events.length > 0 ? (
                  <div className="space-y-2 max-h-[250px] overflow-y-auto">
                    {events.map(ev => (
                      <div key={ev.id} className="bg-stone-50/50 border border-stone-200 p-3.5 rounded-xl flex items-center justify-between">
                        <div className="space-y-1">
                          <strong className="text-stone-850 text-[11px] block">{ev.title}</strong>
                          <span className="text-stone-600 font-semibold block text-[10px]">{ev.date} @ {ev.venue}</span>
                          <span className="text-[9.5px] font-mono text-[#0f4c2a] block">Organizer: {ev.organizerEmail}</span>
                        </div>
                        <GMKBadge variant={ev.status === 'registration_open' ? 'success' : 'info'}>
                          {(ev.status || 'Draft').replace(/_/g, ' ').toUpperCase()}
                        </GMKBadge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-center py-6 text-stone-500 bg-stone-50 border border-stone-150 rounded-2xl">
                    No community events scheduled.
                  </p>
                )}
              </GMKCard>

            </div>

            {/* Right: Governance Audit trail summary */}
            <div>
              <GMKCard className="space-y-4 h-full">
                <h4 className="text-xs font-extrabold text-[#0f4c2a] uppercase tracking-wider flex items-center space-x-1.5 font-heading border-b border-stone-100 pb-3">
                  <History className="w-4 h-4 text-[#d4af37]" />
                  <span>Constitutional Governance Audit Log</span>
                </h4>

                <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
                  {auditLogs.filter(log => 
                    log.action.includes('OVERRIDE') || 
                    log.action.includes('APPOINT') || 
                    log.action.includes('FINANCE') ||
                    log.action.includes('REMOVE')
                  ).length > 0 ? (
                    auditLogs.filter(log => 
                      log.action.includes('OVERRIDE') || 
                      log.action.includes('APPOINT') || 
                      log.action.includes('FINANCE') ||
                      log.action.includes('REMOVE')
                    ).slice(0, 20).map(log => {
                      const isOverride = log.details.includes('Override');
                      const isFinance = log.action.includes('FINANCE');
                      return (
                        <div key={log.id} className="p-3 border border-stone-200 bg-stone-50/40 rounded-xl space-y-1 transition-all hover:bg-stone-50 animate-fadeIn">
                          <div className="flex items-center justify-between">
                            <span className={`text-[9px] font-mono font-bold uppercase px-2 py-0.5 rounded-full ${
                              isOverride 
                                ? 'bg-[#FFFDF6] border border-[#d4af37]/30 text-stone-700' 
                                : isFinance 
                                  ? 'bg-emerald-50 text-[#0f4c2a] border border-emerald-100'
                                  : 'bg-stone-100 text-stone-600 border border-stone-200'
                            }`}>
                              {log.action.replace(/_/g, ' ')}
                            </span>
                            <span className="text-[9px] text-stone-400 font-semibold">
                              {new Date(log.timestamp).toLocaleString()}
                            </span>
                          </div>
                          <p className="text-stone-750 text-[10.5px] font-medium leading-relaxed">
                            {log.details}
                          </p>
                          <div className="text-[9.5px] text-stone-500 font-mono flex items-center space-x-1">
                            <span>Actor:</span>
                            <strong className="text-[#0f4c2a]">{log.actorEmail}</strong>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-center py-20 text-stone-400 font-medium">
                      <FileText className="w-10 h-10 mx-auto mb-2 text-stone-250 animate-pulse" />
                      <p className="text-xs">No governance override or appointment logs detected.</p>
                      <p className="text-[10px]">All major constitutional interventions will appear in this feed.</p>
                    </div>
                  )}
                </div>
              </GMKCard>
            </div>

          </div>

        </div>
      )}

      {/* B. EXECUTIVE GOVERNANCE */}
      {activeTab === 'executive' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-fadeIn">
          
          {/* Active Steward HUD */}
          <div className="space-y-6">
            <GMKCard className="space-y-4">
              <h4 className="text-xs font-extrabold text-[#0f4c2a] uppercase tracking-wider flex items-center space-x-1.5 font-heading border-b border-stone-100 pb-3">
                <ShieldCheck className="w-4 h-4 text-[#d4af37]" />
                <span>Current Event Director</span>
              </h4>

              {activeEventDirector ? (
                <div className="space-y-4 animate-fadeIn">
                  <div className="bg-emerald-50/55 p-4 rounded-2xl border border-emerald-100/60 flex items-center justify-between">
                    <div className="space-y-1">
                      <span className="text-[9px] font-mono font-bold uppercase tracking-widest text-[#0f4c2a] block">Active Governance Appointment</span>
                      <strong className="text-stone-850 text-sm font-extrabold block">
                        {residents.find(r => r.gmkId === activeEventDirector.gmkId)?.fullName || activeEventDirector.email}
                      </strong>
                      <span className="text-stone-600 font-semibold block text-[10px]">
                        {activeEventDirector.email} | ID: {activeEventDirector.gmkId}
                      </span>
                      <span className="text-[10px] font-mono text-stone-500 block">
                        Appointed At: {new Date(activeEventDirector.assignedAt).toLocaleString()} by {activeEventDirector.assignedBy}
                      </span>
                    </div>
                    <GMKBadge variant="success">ACTIVE</GMKBadge>
                  </div>

                  <div className="pt-2">
                    <button
                      id="revoke-event-director-btn"
                      onClick={() => handleRevoke(activeEventDirector)}
                      className="w-full py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-extrabold uppercase tracking-wider rounded-xl cursor-pointer flex items-center justify-center space-x-2 shadow-sm transition-colors"
                    >
                      <UserMinus className="w-4 h-4" />
                      <span>Revoke Event Director Appointment</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-center py-12 space-y-2 bg-stone-50 border border-stone-150 rounded-2xl">
                  <p className="text-stone-500 font-semibold text-xs">There is currently no active Event Director appointed.</p>
                  <p className="text-[10px] text-stone-400 font-medium">Use the appointment form to delegate stewardship of community events.</p>
                </div>
              )}
            </GMKCard>
          </div>

          {/* Appointment Form */}
          <div>
            <GMKCard className="space-y-4">
              <h4 className="text-xs font-extrabold text-[#0f4c2a] uppercase tracking-wider flex items-center space-x-1.5 font-heading border-b border-stone-100 pb-3">
                <UserCheck className="w-4 h-4 text-[#d4af37]" />
                <span>Appoint Event Director</span>
              </h4>

              {activeEventDirector ? (
                <div className="bg-amber-50/50 border border-amber-250/50 p-4 rounded-2xl flex items-start space-x-2 text-amber-800 leading-relaxed font-semibold text-[11px]">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5 animate-pulse" />
                  <span>The Event Director slot is currently filled. To appoint a new resident, you must first revoke the current appointment.</span>
                </div>
              ) : (
                <form onSubmit={handleAppoint} className="space-y-4" id="appoint-form">
                  
                  {/* Search Bar & Dropdown Select */}
                  <div className="space-y-1.5 relative">
                    <label className="text-stone-700 font-extrabold uppercase tracking-wider text-[9px] block">
                      Search Eligible Resident
                    </label>
                    <div className="relative">
                      <Search className="absolute left-3.5 top-3 w-4 h-4 text-stone-400" />
                      <input
                        type="text"
                        placeholder="Search residents by Name, Email, or GMK ID..."
                        value={searchQuery}
                        onChange={(e) => {
                          setSearchQuery(e.target.value);
                          setSelectedGmkId(''); // Clear selected when typing
                        }}
                        className="w-full bg-stone-50 border border-stone-200 hover:border-stone-300 focus:border-[#0f4c2a] focus:bg-white text-xs text-stone-850 font-bold placeholder-stone-400 pl-10 pr-4 py-2.5 rounded-xl outline-none transition-all"
                      />
                      {searchQuery && (
                        <button
                          type="button"
                          onClick={() => {
                            setSearchQuery('');
                            setSelectedGmkId('');
                          }}
                          className="absolute right-3.5 top-3 text-stone-400 hover:text-stone-750 text-xs font-bold"
                        >
                          Clear
                        </button>
                      )}
                    </div>

                    {searchQuery && !selectedGmkId && (() => {
                      const searchLower = searchQuery.toLowerCase().trim();
                      const matched = residents.filter(r => {
                        if (r.status !== 'active') return false;
                        const activeAccount = users.find(u => u.email.toLowerCase().trim() === r.email.toLowerCase().trim());
                        if (!activeAccount || !activeAccount.isActive) return false;

                        return r.fullName?.toLowerCase().includes(searchLower) ||
                               r.gmkId?.toLowerCase().includes(searchLower) ||
                               r.email?.toLowerCase().includes(searchLower);
                      });

                      return (
                        <div className="absolute z-50 left-0 right-0 mt-1 border border-stone-200 bg-white rounded-xl shadow-lg max-h-48 overflow-y-auto">
                          {matched.length === 0 ? (
                            <div className="p-3 text-stone-500 italic text-xs bg-stone-50">
                              No matching active residents found.
                            </div>
                          ) : (
                            matched.slice(0, 10).map(r => {
                              const isCurrentlyGov = govAssignments.some(ra => ra.gmkId === r.gmkId || ra.email === r.email.toLowerCase().trim()) ||
                                                    roleAssignments.some(ra => (ra.gmkId === r.gmkId || ra.email === r.email.toLowerCase().trim()));
                              return (
                                <div
                                  key={r.gmkId}
                                  onClick={() => {
                                    if (isCurrentlyGov) return;
                                    setSelectedGmkId(r.gmkId);
                                    setSearchQuery(r.fullName);
                                  }}
                                  className={`p-2.5 text-left border-b border-stone-100 last:border-b-0 text-xs leading-snug transition-colors ${
                                    isCurrentlyGov
                                      ? 'bg-stone-50 text-stone-400 cursor-not-allowed'
                                      : 'bg-white hover:bg-stone-50 hover:text-[#0F4C2A] cursor-pointer'
                                  }`}
                                >
                                  <div className="font-bold">
                                    {r.fullName}
                                    {isCurrentlyGov && (
                                      <span className="text-[10px] font-normal text-amber-650 italic ml-1.5 bg-amber-50 px-1 py-0.2 rounded border border-amber-100 uppercase">
                                        Assigned to Governance
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[10px] text-stone-500 flex items-center gap-1.5 mt-0.5 font-mono">
                                    <span className="bg-emerald-50 text-[#0F4C2A] px-1 rounded font-bold">{r.gmkId}</span>
                                    <span>Unit: {r.displayUnitNumber}</span>
                                    <span>• Email: {r.email}</span>
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      );
                    })()}

                    {selectedGmkId && (() => {
                      const selectedRes = residents.find(r => r.gmkId === selectedGmkId);
                      if (!selectedRes) return null;
                      return (
                        <div className="bg-emerald-50/40 border border-emerald-100 rounded-xl p-3.5 space-y-2 mt-2 animate-fadeIn text-xs relative z-10">
                          <div className="flex justify-between items-start">
                            <div>
                              <div className="font-bold text-[#0F4C2A] text-xs">{selectedRes.fullName}</div>
                              <div className="text-[9px] text-[#A28114] font-extrabold uppercase mt-0.5 tracking-wider font-mono">SELECTED RESIDENT</div>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedGmkId('');
                                setSearchQuery('');
                              }}
                              className="text-[10px] text-rose-600 font-extrabold uppercase hover:underline cursor-pointer"
                            >
                              Deselect
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[10px] pt-1.5 border-t border-emerald-100/60 text-stone-600 font-semibold">
                            <div>ID: <span className="font-bold text-stone-850">{selectedRes.gmkId}</span></div>
                            <div>Unit: <span className="font-bold text-stone-850">{selectedRes.displayUnitNumber}</span></div>
                            <div>Phone: <span className="font-bold text-stone-850">{selectedRes.phone}</span></div>
                            <div>Email: <span className="font-bold text-stone-850">{selectedRes.email}</span></div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Optional Remarks */}
                  <div className="space-y-1.5">
                    <label className="text-stone-700 font-extrabold uppercase tracking-wider text-[9px] block">
                      Appointment Remarks (Optional)
                    </label>
                    <textarea
                      id="appointment-remarks"
                      placeholder="Enter context, effective dates, or optional notes..."
                      value={remarks}
                      onChange={(e) => setRemarks(e.target.value)}
                      rows={3}
                      className="w-full bg-stone-50 border border-stone-200 hover:border-stone-300 focus:border-[#0f4c2a] focus:bg-white text-xs text-stone-850 font-semibold placeholder-stone-400 p-3 rounded-xl outline-none resize-none transition-all"
                    />
                  </div>

                  <button
                    type="submit"
                    id="appoint-btn"
                    className="w-full py-2.5 bg-[#0f4c2a] hover:bg-[#125831] text-white font-extrabold uppercase tracking-wider rounded-xl cursor-pointer flex items-center justify-center space-x-2 shadow shadow-emerald-900/10 transition-colors"
                  >
                    <UserCheck className="w-4 h-4 text-[#d4af37]" />
                    <span>Execute Governance Appointment</span>
                  </button>

                </form>
              )}
            </GMKCard>
          </div>

        </div>
      )}

      {/* C. COMMITTEE LEADS */}
      {activeTab === 'committee' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-fadeIn">
          
          {/* Active Appointments HUD */}
          <div className="space-y-6">
            <GMKCard className="space-y-4">
              <h4 className="text-xs font-extrabold text-[#0f4c2a] uppercase tracking-wider flex items-center space-x-1.5 font-heading border-b border-stone-100 pb-3">
                <Users className="w-4 h-4 text-[#d4af37]" />
                <span>Committee Lead Appointments Register</span>
              </h4>

              {activeCommitteeLeads.length > 0 ? (
                <div className="space-y-3 max-h-[450px] overflow-y-auto">
                  {activeCommitteeLeads.map(lead => {
                    const res = residents.find(r => r.gmkId === lead.gmkId || r.email.toLowerCase().trim() === lead.email.toLowerCase().trim());
                    return (
                      <div key={lead.id} className="bg-emerald-50/50 border border-emerald-150 p-4 rounded-xl flex items-center justify-between transition-colors animate-fadeIn">
                        <div className="space-y-1.5">
                          <div>
                            <strong className="text-stone-850 text-xs font-bold block">
                              {res ? res.fullName : lead.email}
                            </strong>
                            <span className="text-[#0f4c2a] text-[9.5px] font-extrabold uppercase font-mono tracking-wider bg-emerald-100/60 px-2 py-0.5 rounded border border-emerald-200 mt-1 inline-block">
                              {lead.committee || "Unspecified Committee"}
                            </span>
                          </div>
                          <div className="text-stone-600 font-semibold block text-[10px]">
                            {lead.email} | ID: {lead.gmkId}
                          </div>
                          <span className="text-[9.5px] font-mono text-stone-500 block">
                            Appointed by {lead.assignedBy} on {new Date(lead.assignedAt).toLocaleDateString()}
                          </span>
                        </div>
                        <button
                          onClick={() => handleRevokeCommitteeLead(lead)}
                          className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold uppercase text-[10px] rounded-lg cursor-pointer flex items-center space-x-1"
                        >
                          <UserMinus className="w-3.5 h-3.5" />
                          <span>Revoke Appointment</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-12 space-y-2 bg-stone-50 border border-stone-150 rounded-2xl">
                  <p className="text-stone-500 font-semibold text-xs">There are no active Committee Lead appointments.</p>
                  <p className="text-[10px] text-stone-400 font-medium">Use the appointment form on the right to assign a resident.</p>
                </div>
              )}
            </GMKCard>
          </div>

          {/* Appointment Form */}
          <div>
            <GMKCard className="space-y-4">
              <h4 className="text-xs font-extrabold text-[#0f4c2a] uppercase tracking-wider flex items-center space-x-1.5 font-heading border-b border-stone-100 pb-3">
                <UserCheck className="w-4 h-4 text-[#d4af37]" />
                <span>Appoint Committee Lead</span>
              </h4>

              <form onSubmit={handleAppointCommitteeLead} className="space-y-4">
                
                {/* Search Bar & Dropdown Select */}
                <div className="space-y-1.5 relative">
                  <label className="text-stone-700 font-extrabold uppercase tracking-wider text-[9px] block">
                    Search Eligible Resident
                  </label>
                  <div className="relative">
                    <Search className="absolute left-3.5 top-3 w-4 h-4 text-stone-400" />
                    <input
                      type="text"
                      placeholder="Search residents by Name, Email, or GMK ID..."
                      value={committeeSearchQuery}
                      onChange={(e) => {
                        setCommitteeSearchQuery(e.target.value);
                        setSelectedCommitteeGmkId(''); // Clear selected when typing
                      }}
                      className="w-full bg-stone-50 border border-stone-200 hover:border-stone-300 focus:border-[#0f4c2a] focus:bg-white text-xs text-stone-850 font-bold placeholder-stone-400 pl-10 pr-4 py-2.5 rounded-xl outline-none transition-all"
                    />
                    {committeeSearchQuery && (
                      <button
                        type="button"
                        onClick={() => {
                          setCommitteeSearchQuery('');
                          setSelectedCommitteeGmkId('');
                        }}
                        className="absolute right-3.5 top-3 text-stone-400 hover:text-stone-750 text-xs font-bold"
                      >
                        Clear
                      </button>
                    )}
                  </div>

                  {committeeSearchQuery && !selectedCommitteeGmkId && (() => {
                    const searchLower = committeeSearchQuery.toLowerCase().trim();
                    const matched = residents.filter(r => {
                      if (r.status !== 'active') return false;
                      const activeAccount = users.find(u => u.email.toLowerCase().trim() === r.email.toLowerCase().trim());
                      if (!activeAccount || !activeAccount.isActive) return false;

                      return r.fullName?.toLowerCase().includes(searchLower) ||
                             r.gmkId?.toLowerCase().includes(searchLower) ||
                             r.email?.toLowerCase().includes(searchLower);
                    });

                    return (
                      <div className="absolute z-50 left-0 right-0 mt-1 border border-stone-200 bg-white rounded-xl shadow-lg max-h-48 overflow-y-auto">
                        {matched.length === 0 ? (
                          <div className="p-3 text-stone-500 italic text-xs bg-stone-50">
                            No matching active residents found.
                          </div>
                        ) : (
                          matched.slice(0, 10).map(r => {
                            const isCurrentlyGov = govAssignments.some(ra => ra.gmkId === r.gmkId || ra.email === r.email.toLowerCase().trim()) ||
                                                  roleAssignments.some(ra => (ra.gmkId === r.gmkId || ra.email === r.email.toLowerCase().trim()));
                            return (
                              <div
                                key={r.gmkId}
                                onClick={() => {
                                  if (isCurrentlyGov) return;
                                  setSelectedCommitteeGmkId(r.gmkId);
                                  setCommitteeSearchQuery(r.fullName);
                                }}
                                className={`p-2.5 text-left border-b border-stone-100 last:border-b-0 text-xs leading-snug transition-colors ${
                                  isCurrentlyGov
                                    ? 'bg-stone-50 text-stone-400 cursor-not-allowed'
                                    : 'bg-white hover:bg-stone-50 hover:text-[#0F4C2A] cursor-pointer'
                                }`}
                              >
                                <div className="font-bold">
                                  {r.fullName}
                                  {isCurrentlyGov && (
                                    <span className="text-[10px] font-normal text-amber-650 italic ml-1.5 bg-amber-50 px-1 py-0.2 rounded border border-amber-100 uppercase">
                                      Assigned to Governance
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] text-stone-500 flex items-center gap-1.5 mt-0.5 font-mono">
                                  <span className="bg-emerald-50 text-[#0F4C2A] px-1 rounded font-bold">{r.gmkId}</span>
                                  <span>Unit: {r.displayUnitNumber}</span>
                                  <span>• Email: {r.email}</span>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    );
                  })()}

                  {selectedCommitteeGmkId && (() => {
                    const selectedRes = residents.find(r => r.gmkId === selectedCommitteeGmkId);
                    if (!selectedRes) return null;
                    return (
                      <div className="bg-emerald-50/40 border border-emerald-100 rounded-xl p-3.5 space-y-2 mt-2 animate-fadeIn text-xs relative z-10">
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="font-bold text-[#0F4C2A] text-xs">{selectedRes.fullName}</div>
                            <div className="text-[9px] text-[#A28114] font-extrabold uppercase mt-0.5 tracking-wider font-mono">SELECTED RESIDENT</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedCommitteeGmkId('');
                              setCommitteeSearchQuery('');
                            }}
                            className="text-[10px] text-rose-600 font-extrabold uppercase hover:underline cursor-pointer"
                          >
                            Deselect
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[10px] pt-1.5 border-t border-emerald-100/60 text-stone-600 font-semibold">
                          <div>ID: <span className="font-bold text-stone-850">{selectedRes.gmkId}</span></div>
                          <div>Unit: <span className="font-bold text-stone-850">{selectedRes.displayUnitNumber}</span></div>
                          <div>Phone: <span className="font-bold text-stone-850">{selectedRes.phone}</span></div>
                          <div>Email: <span className="font-bold text-stone-850">{selectedRes.email}</span></div>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Select Committee Dropdown */}
                <div className="space-y-1.5">
                  <label className="text-stone-700 font-extrabold uppercase tracking-wider text-[9px] block">
                    Select Committee
                  </label>
                  <select
                    value={selectedCommittee}
                    onChange={(e) => setSelectedCommittee(e.target.value)}
                    className="w-full bg-stone-50 border border-stone-200 hover:border-stone-300 focus:border-[#0f4c2a] focus:bg-white text-xs text-stone-850 font-bold py-2.5 px-3 rounded-xl outline-none cursor-pointer transition-all"
                  >
                    <option value="">-Select-</option>
                    {COMMITTEES.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>

                {/* Optional Remarks */}
                <div className="space-y-1.5">
                  <label className="text-stone-700 font-extrabold uppercase tracking-wider text-[9px] block">
                    Appointment Purpose / Remarks
                  </label>
                  <textarea
                    placeholder="Provide justification, effective dates, or optional notes..."
                    value={committeeRemarks}
                    onChange={(e) => setCommitteeRemarks(e.target.value)}
                    rows={3}
                    className="w-full bg-stone-50 border border-stone-200 hover:border-stone-300 focus:border-[#0f4c2a] focus:bg-white text-xs text-stone-850 font-semibold placeholder-stone-400 p-3 rounded-xl outline-none resize-none transition-all"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full py-2.5 bg-[#0f4c2a] hover:bg-[#125831] text-white font-extrabold uppercase tracking-wider rounded-xl cursor-pointer flex items-center justify-center space-x-2 shadow transition-colors"
                >
                  <UserCheck className="w-4 h-4 text-[#d4af37]" />
                  <span>Execute Committee Lead Appointment</span>
                </button>

              </form>
            </GMKCard>
          </div>

        </div>
      )}

      {/* D. FINANCE GOVERNANCE */}
      {activeTab === 'finance' && (
        <div className="space-y-6 animate-fadeIn">
          
          {/* Section 1: Sovereign Opening Balance Configurator */}
          <GMKCard className="flex flex-col md:flex-row items-center justify-between gap-4 border-l-4 border-l-[#d4af37]">
            <div className="space-y-1">
              <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#0f4c2a] block">Section 1: Treasury Authority</span>
              <h4 className="text-stone-850 text-base font-extrabold font-serif">Sovereign Opening Balance Configurator</h4>
              <p className="text-stone-600 text-[10.5px] font-semibold">
                Configure the sovereign starting balance anchor for the community general ledger.
              </p>
            </div>

            <div className="flex items-center space-x-3 shrink-0">
              {isEditingBalance ? (
                <form onSubmit={handleSetOpeningBalance} className="flex items-center space-x-2">
                  <input
                    type="number"
                    required
                    value={editBalanceVal}
                    onChange={(e) => setEditBalanceVal(e.target.value)}
                    className="w-28 bg-stone-50 border border-stone-300 focus:border-[#0f4c2a] focus:bg-white text-xs text-stone-850 font-bold p-2 rounded-xl outline-none"
                    placeholder="OMR"
                  />
                  <button
                    type="submit"
                    className="px-3.5 py-2 bg-[#0f4c2a] hover:bg-[#125831] text-white text-[10px] font-bold uppercase tracking-wider rounded-xl cursor-pointer"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => { setIsEditingBalance(false); setEditBalanceVal(openingBalance.toString()); }}
                    className="px-3.5 py-2 bg-stone-100 hover:bg-stone-200 border border-stone-200 text-stone-600 text-[10px] font-bold uppercase tracking-wider rounded-xl cursor-pointer"
                  >
                    Cancel
                  </button>
                </form>
              ) : (
                <div className="flex items-center space-x-3">
                  <div className="bg-emerald-50 border border-emerald-200 px-4 py-2.5 rounded-2xl text-right">
                    <span className="block text-[#0f4c2a] text-[9px] font-mono font-bold uppercase tracking-widest">Active Opening Balance</span>
                    <strong className="block text-stone-850 text-base font-serif font-black">{openingBalance.toLocaleString()} OMR</strong>
                  </div>
                  <button
                    onClick={() => setIsEditingBalance(true)}
                    className="px-4 py-2.5 bg-[#0f4c2a] hover:bg-[#125831] text-white text-[10px] font-bold uppercase tracking-wider rounded-xl cursor-pointer flex items-center space-x-1 shadow-sm transition-colors"
                  >
                    <PlusCircle className="w-3.5 h-3.5" />
                    <span>Set Opening Balance</span>
                  </button>
                </div>
              )}
            </div>
          </GMKCard>

          {/* Operational Input Form & Return Drawer */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Submit New Statement Form */}
            <div className="lg:col-span-1">
              <GMKCard className="space-y-4">
                <h4 className="text-xs font-extrabold text-[#0f4c2a] uppercase tracking-wider flex items-center space-x-1.5 font-heading border-b border-stone-100 pb-3">
                  <PlusCircle className="w-4 h-4 text-[#d4af37]" />
                  <span>Submit Operational Statement</span>
                </h4>

                <form onSubmit={handleCreateStatement} className="space-y-4">
                  
                  <div className="space-y-1.5">
                    <label className="text-stone-700 font-extrabold uppercase tracking-wider text-[9px] block">
                      Statement Title / Purpose
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Traditional Majlis Sound System"
                      value={newStmtTitle}
                      onChange={(e) => setNewStmtTitle(e.target.value)}
                      className="w-full bg-stone-50 border border-stone-200 hover:border-stone-300 focus:border-[#0f4c2a] focus:bg-white text-xs text-stone-850 font-bold p-2.5 rounded-xl outline-none transition-all"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-stone-700 font-extrabold uppercase tracking-wider text-[9px] block">
                        Amount (OMR)
                      </label>
                      <input
                        type="number"
                        required
                        min="1"
                        placeholder="OMR"
                        value={newStmtAmount}
                        onChange={(e) => setNewStmtAmount(e.target.value)}
                        className="w-full bg-stone-50 border border-stone-200 hover:border-stone-300 focus:border-[#0f4c2a] focus:bg-white text-xs text-stone-850 font-bold p-2.5 rounded-xl outline-none transition-all"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-stone-700 font-extrabold uppercase tracking-wider text-[9px] block">
                        Ledger Type
                      </label>
                      <select
                        value={newStmtType}
                        onChange={(e) => setNewStmtType(e.target.value as any)}
                        className="w-full bg-stone-50 border border-stone-200 hover:border-stone-300 focus:border-[#0f4c2a] focus:bg-white text-xs text-stone-850 font-bold py-2.5 px-2 rounded-xl outline-none cursor-pointer transition-all"
                      >
                        <option value="income">🟢 Income</option>
                        <option value="expense">🔴 Expense</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-stone-700 font-extrabold uppercase tracking-wider text-[9px] block">
                      Explanatory Notes
                    </label>
                    <textarea
                      placeholder="Provide additional details or receipt description..."
                      value={newStmtNotes}
                      onChange={(e) => setNewStmtNotes(e.target.value)}
                      rows={3}
                      className="w-full bg-stone-50 border border-stone-200 hover:border-stone-300 focus:border-[#0f4c2a] focus:bg-white text-xs text-stone-850 font-semibold p-3 rounded-xl outline-none resize-none transition-all"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full py-2.5 bg-[#0f4c2a] hover:bg-[#125831] text-white font-extrabold uppercase tracking-wider rounded-xl cursor-pointer flex items-center justify-center space-x-2 shadow transition-colors"
                  >
                    <Send className="w-3.5 h-3.5 text-[#d4af37]" />
                    <span>Record & Submit Statement</span>
                  </button>

                </form>
              </GMKCard>
            </div>

            {/* Tables & Queues (Sections 2, 3, 4) */}
            <div className="lg:col-span-2 space-y-6">
              
              {returningStmtId && (
                <GMKCard className="border-rose-200 bg-rose-50/20 space-y-3 animate-fadeIn">
                  <div className="flex items-center justify-between border-b border-rose-100 pb-2">
                    <h4 className="text-rose-900 font-extrabold text-[11px] uppercase tracking-wider flex items-center space-x-1">
                      <Ban className="w-4 h-4 text-rose-600" />
                      <span>Return Statement for Correction</span>
                    </h4>
                    <button
                      onClick={() => { setReturningStmtId(null); setCorrectionReason(''); }}
                      className="text-stone-500 hover:text-stone-700 text-xs font-bold font-mono cursor-pointer"
                    >
                      ✕ CLOSE
                    </button>
                  </div>

                  <form onSubmit={handleReturnStatement} className="space-y-3">
                    <p className="text-[10px] text-rose-800 font-semibold leading-relaxed">
                      Please enter detailed instructions explaining what needs to be fixed. The submitter will receive these notes instantly.
                    </p>
                    <textarea
                      required
                      placeholder="e.g. Please attach official merchant receipt. Amount exceeds pre-approved budget by 50 OMR."
                      value={correctionReason}
                      onChange={(e) => setCorrectionReason(e.target.value)}
                      rows={3}
                      className="w-full bg-white border border-rose-250 text-xs text-stone-850 font-semibold p-3 rounded-xl outline-none resize-none"
                    />
                    <div className="flex justify-end space-x-2">
                      <button
                        type="button"
                        onClick={() => { setReturningStmtId(null); setCorrectionReason(''); }}
                        className="px-3.5 py-1.5 bg-white border border-stone-250 text-stone-700 font-extrabold uppercase text-[10px] rounded-lg cursor-pointer hover:bg-stone-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-extrabold uppercase text-[10px] rounded-lg cursor-pointer"
                      >
                        Return to Submitter
                      </button>
                    </div>
                  </form>
                </GMKCard>
              )}

              {/* Section 2: Pending Statements */}
              <GMKCard className="space-y-3">
                <h4 className="text-xs font-extrabold text-[#0f4c2a] uppercase tracking-wider flex items-center space-x-1.5 font-heading border-b border-stone-100 pb-2">
                  <FileText className="w-4 h-4 text-[#d4af37]" />
                  <span>Section 2: Pending Statements Review Queue</span>
                </h4>

                {financeStatements.filter(s => s.status === 'Pending').length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[11px] font-semibold text-stone-700">
                      <thead>
                        <tr className="border-b border-stone-200 text-[10px] uppercase font-mono text-stone-500 bg-stone-50/50">
                          <th className="py-2 px-3">Statement / Submitter</th>
                          <th className="py-2 px-3">Type</th>
                          <th className="py-2 px-3">Amount</th>
                          <th className="py-2 px-3 text-right">Review Decisions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100">
                        {financeStatements.filter(s => s.status === 'Pending').map(stmt => (
                          <tr key={stmt.id} className="hover:bg-stone-50/30 transition-colors">
                            <td className="py-2.5 px-3">
                              <div className="font-extrabold text-stone-900">{stmt.title}</div>
                              <div className="text-[9.5px] text-stone-500 font-mono">
                                By: {stmt.submittedBy} on {new Date(stmt.submittedAt).toLocaleDateString()}
                              </div>
                              {stmt.notes && (
                                <div className="text-[9px] text-stone-650 italic mt-0.5">" {stmt.notes} "</div>
                              )}
                            </td>
                            <td className="py-2.5 px-3">
                              <span className={`text-[9px] font-mono font-bold uppercase px-2 py-0.5 rounded-full ${
                                stmt.type === 'income' 
                                  ? 'bg-emerald-50 text-emerald-850 border border-emerald-100' 
                                  : 'bg-rose-50 text-rose-850 border border-rose-100'
                              }`}>
                                {stmt.type}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 font-serif font-extrabold text-stone-850">
                              {stmt.amount} OMR
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <div className="flex items-center justify-end space-x-1.5">
                                <button
                                  onClick={() => handleApproveStatement(stmt.id)}
                                  className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold uppercase text-[9.5px] rounded-md cursor-pointer flex items-center space-x-0.5"
                                >
                                  <CheckCircle className="w-3 h-3" />
                                  <span>Approve</span>
                                </button>
                                <button
                                  onClick={() => { setReturningStmtId(stmt.id); setCorrectionReason(''); }}
                                  className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white font-extrabold uppercase text-[9.5px] rounded-md cursor-pointer flex items-center space-x-0.5"
                                >
                                  <Ban className="w-3 h-3" />
                                  <span>Return</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-center py-6 text-stone-500 bg-stone-50 border border-stone-150 rounded-2xl text-[10.5px]">
                    No statements currently pending governance review.
                  </p>
                )}
              </GMKCard>

              {/* Section 3: Approved Statements */}
              <GMKCard className="space-y-3">
                <h4 className="text-xs font-extrabold text-[#0f4c2a] uppercase tracking-wider flex items-center space-x-1.5 font-heading border-b border-stone-100 pb-2">
                  <CheckCircle className="w-4 h-4 text-emerald-600" />
                  <span>Section 3: Approved Statements Ledger</span>
                </h4>

                {financeStatements.filter(s => s.status === 'Approved').length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[11px] font-semibold text-stone-700">
                      <thead>
                        <tr className="border-b border-stone-200 text-[10px] uppercase font-mono text-stone-500 bg-stone-50/50">
                          <th className="py-2 px-3">Statement / Reviewer</th>
                          <th className="py-2 px-3">Type</th>
                          <th className="py-2 px-3">Amount</th>
                          <th className="py-2 px-3 text-right">Approval Date</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100">
                        {financeStatements.filter(s => s.status === 'Approved').map(stmt => (
                          <tr key={stmt.id} className="hover:bg-stone-50/30 transition-colors bg-emerald-50/10">
                            <td className="py-2.5 px-3">
                              <div className="font-extrabold text-stone-900">{stmt.title}</div>
                              <div className="text-[9.5px] text-stone-500 font-mono">
                                Submitter: {stmt.submittedBy} | Reviewer: {stmt.reviewedBy}
                              </div>
                            </td>
                            <td className="py-2.5 px-3">
                              <span className="text-[9px] font-mono font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-850 border border-emerald-100">
                                {stmt.type}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 font-serif font-extrabold text-[#0f4c2a]">
                              {stmt.type === 'income' ? '+' : '-'}{stmt.amount} OMR
                            </td>
                            <td className="py-2.5 px-3 text-right text-stone-500 font-mono">
                              {stmt.reviewedAt ? new Date(stmt.reviewedAt).toLocaleDateString() : 'N/A'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-center py-6 text-stone-500 bg-stone-50 border border-stone-150 rounded-2xl text-[10.5px]">
                    No approved ledger entries recorded yet.
                  </p>
                )}
              </GMKCard>

              {/* Section 4: Returned Statements */}
              <GMKCard className="space-y-3">
                <h4 className="text-xs font-extrabold text-[#0f4c2a] uppercase tracking-wider flex items-center space-x-1.5 font-heading border-b border-stone-100 pb-2">
                  <Ban className="w-4 h-4 text-rose-600" />
                  <span>Section 4: Returned Statements Ledger</span>
                </h4>

                {financeStatements.filter(s => s.status === 'Returned for Correction').length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[11px] font-semibold text-stone-700">
                      <thead>
                        <tr className="border-b border-stone-200 text-[10px] uppercase font-mono text-stone-500 bg-stone-50/50">
                          <th className="py-2 px-3">Statement / Return Details</th>
                          <th className="py-2 px-3">Type</th>
                          <th className="py-2 px-3">Amount</th>
                          <th className="py-2 px-3 text-right">Return Date</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100">
                        {financeStatements.filter(s => s.status === 'Returned for Correction').map(stmt => (
                          <tr key={stmt.id} className="hover:bg-stone-50/30 transition-colors bg-rose-50/10">
                            <td className="py-2.5 px-3">
                              <div className="font-extrabold text-stone-900">{stmt.title}</div>
                              <div className="text-[9.5px] text-stone-500 font-mono">
                                Submitter: {stmt.submittedBy}
                              </div>
                              <div className="bg-rose-50/60 border border-rose-100 p-2 rounded-lg text-[9px] text-rose-800 font-bold mt-1 max-w-sm">
                                ⚠️ Refusal Reason: {stmt.correctionNotes}
                              </div>
                            </td>
                            <td className="py-2.5 px-3">
                              <span className="text-[9px] font-mono font-bold uppercase px-2 py-0.5 rounded-full bg-rose-50 text-rose-850 border border-rose-100">
                                {stmt.type}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 font-serif font-extrabold text-rose-700">
                              {stmt.amount} OMR
                            </td>
                            <td className="py-2.5 px-3 text-right text-stone-500 font-mono">
                              {stmt.reviewedAt ? new Date(stmt.reviewedAt).toLocaleDateString() : 'N/A'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-center py-6 text-stone-500 bg-stone-50 border border-stone-150 rounded-2xl text-[10.5px]">
                    No statements currently returned for correction.
                  </p>
                )}
              </GMKCard>

            </div>
          </div>

          {/* Section 5: Audit Log */}
          <GMKCard className="space-y-4">
            <h4 className="text-xs font-extrabold text-[#0f4c2a] uppercase tracking-wider flex items-center space-x-1.5 font-heading border-b border-stone-100 pb-3">
              <History className="w-4 h-4 text-[#d4af37]" />
              <span>Section 5: Finance Governance Audit Trail</span>
            </h4>

            <div className="space-y-3 max-h-[300px] overflow-y-auto">
              {auditLogs.filter(log => log.action.includes('FINANCE')).length > 0 ? (
                auditLogs.filter(log => log.action.includes('FINANCE')).map(log => (
                  <div key={log.id} className="p-3 border border-stone-200 bg-stone-50/40 rounded-xl space-y-1 transition-all hover:bg-stone-50 animate-fadeIn text-[11px] font-semibold">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-mono font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-50 text-[#0f4c2a] border border-emerald-100">
                        {log.action.replace(/_/g, ' ')}
                      </span>
                      <span className="text-[9px] text-stone-400 font-mono">
                        {new Date(log.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-stone-750 font-semibold leading-relaxed text-[11px]">
                      {log.details}
                    </p>
                    <div className="text-[9.5px] text-stone-500 font-mono">
                      Actor: <strong className="text-[#0f4c2a]">{log.actorEmail}</strong>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-12 text-stone-400 font-medium">
                  <p className="text-xs">No finance-specific audit entries detected.</p>
                </div>
              )}
            </div>
          </GMKCard>

        </div>
      )}

    </div>
  );
}
