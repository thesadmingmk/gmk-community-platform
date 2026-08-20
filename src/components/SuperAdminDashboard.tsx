import React, { useState, useEffect } from 'react';
import { db, auth, useAuth } from '../context/AuthContext';
import { 
  collection, 
  doc, 
  getDocs, 
  setDoc, 
  deleteDoc, 
  query, 
  orderBy, 
  onSnapshot,
  where,
  getDoc,
  updateDoc,
  limit
} from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { ResidentProfile, UserProfile, CommunityEvent, GovernanceAssignment, AuditLog, PendingRegistration } from '../types';
import { createAuditLog } from '../utils/audit';
import { NotificationService } from '../services/NotificationService';
import { sanitizeFirestorePayload } from '../utils/sanitize';
import { normalizeUnit, normalizeGatedCommunity } from '../utils/unitNormalization';
import { validateGovernanceAssignment } from '../utils/governanceExclusivity';
import { classifyResidentRoleAssignments, normalizeCommitteeName, ClassifiedRoleDoc } from '../utils/governanceLifecycle';
import { formatPhoneWithCountryCode } from '../utils/phoneValidation';
import { ResidentLifecycleService, VerificationReport } from '../services/ResidentLifecycleService';
import ReleaseNotesModal from './ReleaseNotesModal';
import LogCenter from './LogCenter';
import AdminDashboard from './AdminDashboard';
import { GMKCard, GMKButton, GMKBadge, GMKPageHeader, GMKTable } from './gmk/DesignSystem';
import { useLocalGEASConfirmation, GEASConfirmationDialogUI } from './gmk/GEASConfirmationDialog';
import { 
  Users, 
  ShieldCheck, 
  Calendar, 
  Trash2, 
  Edit3, 
  Search, 
  LogOut, 
  PlusCircle, 
  CheckCircle, 
  AlertTriangle, 
  RefreshCw, 
  Sliders, 
  Database,
  UserCheck,
  MapPin,
  Mail,
  PhoneCall,
  Activity,
  Wrench,
  ShieldAlert
} from 'lucide-react';

export default function SuperAdminDashboard({ activeEmail }: { activeEmail: string }) {
  const { refreshProfile } = useAuth();
  const { confirm: showConfirm, isOpen: isConfirmOpen, options: confirmOptions, handleCancel: handleConfirmCancel, handleConfirm: handleConfirmSubmit } = useLocalGEASConfirmation();
  const isSadMin = activeEmail === 'thesadmingmk@gmail.com';
  const [activeTab, setActiveTab] = useState<'governance' | 'administration' | 'log_center' | 'system'>(
    isSadMin ? 'governance' : 'administration'
  );
  
  // Governance role assignment choice state
  const [govTargetGmkId, setGovTargetGmkId] = useState('');
  const [govTargetRole, setGovTargetRole] = useState<'admin' | 'president' | 'vp' | 'event_director' | ''>('');
  const [govSearchQuery, setGovSearchQuery] = useState('');

  // Real-time Collections Data
  const [residents, setResidents] = useState<ResidentProfile[]>([]);
  const [pendingRegs, setPendingRegs] = useState<PendingRegistration[]>([]);
  const [cleaningId, setCleaningId] = useState<string | null>(null);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [events, setEvents] = useState<CommunityEvent[]>([]);
  const [roleAssignments, setRoleAssignments] = useState<GovernanceAssignment[]>([]);
  const [govAssignments, setGovAssignments] = useState<GovernanceAssignment[]>([]);
  const [legacyRoleAssignments, setLegacyRoleAssignments] = useState<GovernanceAssignment[]>([]);
  const [revokingKeys, setRevokingKeys] = useState<Set<string>>(new Set());
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  
  // UI Loading/Feedback
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isReleaseModalOpen, setIsReleaseModalOpen] = useState(false);
  const [confirmDeleteResident, setConfirmDeleteResident] = useState<ResidentProfile | null>(null);

  // Database Integrity Scan States
  const [dbScanStatus, setDbScanStatus] = useState<'idle' | 'scanning' | 'success' | 'error'>('idle');
  const [orphanedCommittees, setOrphanedCommittees] = useState<Array<{ docId: string; committeeName: string; eventId: string; member: any }>>([]);
  const [orphanedPrograms, setOrphanedPrograms] = useState<Array<{ docId: string; programTitle: string; eventId: string; coord: any; type: 'coordinator' | 'volunteer' | 'participant' }>>([]);
  const [orphanedRegistrations, setOrphanedRegistrations] = useState<Array<{ docId: string; eventId: string; primaryEmail: string; name: string }>>([]);
  const [orphanedRoles, setOrphanedRoles] = useState<Array<{ docId: string; type: 'role' | 'gov'; gmkId: string; email: string; role: string }>>([]);
  const [repairMsg, setRepairMsg] = useState<string | null>(null);
  const [isRepairing, setIsRepairing] = useState(false);

  // Targeted Resident ID & Email Mapping Doctor (Diagnostics & Re-mapping)
  const [diagGmkId, setDiagGmkId] = useState('');
  const [diagEmail, setDiagEmail] = useState('');
  const [diagName, setDiagName] = useState('');
  const [diagPhone, setDiagPhone] = useState('');
  const [diagUnit, setDiagUnit] = useState('');
  const [isDiagChecking, setIsDiagChecking] = useState(false);
  const [diagResult, setDiagResult] = useState<any | null>(null);
  const [diagRepairMsg, setDiagRepairMsg] = useState<string | null>(null);
  const [isDiagRepairing, setIsDiagRepairing] = useState(false);
  const [deletionReport, setDeletionReport] = useState<VerificationReport | null>(null);

  const handleResetDiagMapping = () => {
    setDiagGmkId('');
    setDiagEmail('');
    setDiagName('');
    setDiagPhone('');
    setDiagUnit('');
    setDiagResult(null);
    setDiagRepairMsg(null);
    setErrorMsg(null);
  };

  const handleCheckDiagMapping = async () => {
    const searchId = diagGmkId.trim().toUpperCase();
    const searchEmail = diagEmail.trim().toLowerCase();
    const searchName = diagName.trim().toLowerCase();
    const searchPhone = diagPhone.trim();
    const searchUnit = diagUnit.trim().toLowerCase();

    setIsDiagChecking(true);
    setDiagResult(null);
    setDiagRepairMsg(null);
    setErrorMsg(null);

    try {
      // Collect target footprints to scan all traces
      const targetEmails = new Set<string>();
      const targetIds = new Set<string>();
      const targetNames = new Set<string>();
      const targetPhones = new Set<string>();

      if (searchEmail) targetEmails.add(searchEmail);
      if (searchId) targetIds.add(searchId);
      if (searchPhone) targetPhones.add(searchPhone);
      if (searchName) targetNames.add(searchName);

      const hasInputs = !!(searchId || searchEmail || searchName || searchPhone || searchUnit);

      // 1. Scan Residents
      const residentsSnap = await getDocs(collection(db, "residents"));
      const matchingResidents: any[] = [];
      residentsSnap.forEach(d => {
        const data = d.data();
        const rId = d.id.toUpperCase();
        const rGmkId = (data.gmkId || '').toUpperCase();
        const rEmail = (data.email || '').toLowerCase().trim();
        const rName = (data.fullName || '').toLowerCase().trim();
        const rPhone = (data.phone || '').trim();
        const rUnit = (data.displayUnitNumber || data.unitNumber || '').toLowerCase().trim();

        let isMatch = !hasInputs;
        if (searchId && (rId.includes(searchId) || rGmkId.includes(searchId))) isMatch = true;
        if (searchEmail && rEmail.includes(searchEmail)) isMatch = true;
        if (searchName && rName.includes(searchName)) isMatch = true;
        if (searchPhone && rPhone.includes(searchPhone)) isMatch = true;
        if (searchUnit && rUnit.includes(searchUnit)) isMatch = true;

        if (isMatch) {
          const item = { id: d.id, ...data };
          matchingResidents.push(item);
          if (data.email) targetEmails.add(data.email.toLowerCase().trim());
          if (d.id) targetIds.add(d.id.toUpperCase());
          if (data.fullName) targetNames.add(data.fullName.toLowerCase().trim());
          if (data.phone) targetPhones.add(data.phone.trim());
        }
      });

      // 2. Scan Users
      const usersSnap = await getDocs(collection(db, "users"));
      const matchingUsers: any[] = [];
      usersSnap.forEach(d => {
        const data = d.data();
        const uId = d.id.toUpperCase();
        const uEmail = (data.email || '').toLowerCase().trim();
        const uName = (data.fullName || data.name || '').toLowerCase().trim();
        const uPhone = (data.phone || '').trim();
        const uGmkId = (data.gmkId || '').toUpperCase();

        let isMatch = !hasInputs;
        if (searchId && (uId.includes(searchId) || uGmkId.includes(searchId))) isMatch = true;
        if (searchEmail && uEmail.includes(searchEmail)) isMatch = true;
        if (searchName && uName.includes(searchName)) isMatch = true;
        if (searchPhone && uPhone.includes(searchPhone)) isMatch = true;

        if (isMatch) {
          matchingUsers.push({ id: d.id, ...data });
          if (data.email) targetEmails.add(data.email.toLowerCase().trim());
          if (data.gmkId) targetIds.add(data.gmkId.toUpperCase());
        }
      });

      // 3. Scan Pending Registrations
      const pendingSnap = await getDocs(collection(db, "pending_registrations"));
      const matchingPending: any[] = [];
      pendingSnap.forEach(d => {
        const data = d.data();
        const pEmail = (data.email || '').toLowerCase().trim();
        const pName = (data.fullName || data.name || '').toLowerCase().trim();
        const pPhone = (data.phone || '').trim();
        const pUnit = (data.displayUnitNumber || data.unitNumber || '').toLowerCase().trim();

        let isMatch = !hasInputs;
        if (searchEmail && pEmail.includes(searchEmail)) isMatch = true;
        if (searchName && pName.includes(searchName)) isMatch = true;
        if (searchPhone && pPhone.includes(searchPhone)) isMatch = true;
        if (searchUnit && pUnit.includes(searchUnit)) isMatch = true;

        if (isMatch) {
          matchingPending.push({ id: d.id, ...data });
          if (data.email) targetEmails.add(data.email.toLowerCase().trim());
          if (data.fullName || data.name) targetNames.add((data.fullName || data.name).toLowerCase().trim());
        }
      });

      // Helper footprint checker
      const matchesFootprint = (id: string, email: string, name?: string, phone?: string) => {
        if (!hasInputs) return false;
        if (id && targetIds.has(id.toUpperCase())) return true;
        if (email && targetEmails.has(email.toLowerCase().trim())) return true;
        if (name && Array.from(targetNames).some(n => name.toLowerCase().includes(n))) return true;
        if (phone && Array.from(targetPhones).some(p => phone.includes(p))) return true;
        return false;
      };

      // 4. Look for references in Event Committees
      const referencedInCommittees: any[] = [];
      const commSnap = await getDocs(collection(db, "eventCommittees"));
      commSnap.forEach(d => {
        const data = d.data();
        const members = data.members || [];
        members.forEach((m: any) => {
          if (matchesFootprint(m.residentId, m.email, m.fullName || m.name, m.phone)) {
            referencedInCommittees.push({ docId: d.id, committeeName: data.name, eventId: data.eventId, member: m });
          }
        });
      });

      // 5. Look for references in Stage Programs
      const referencedInPrograms: any[] = [];
      const progSnap = await getDocs(collection(db, "eventPrograms"));
      progSnap.forEach(d => {
        const data = d.data();
        const coordinators = data.coordinators || [];
        const volunteers = data.volunteers || [];
        const participants = data.participants || [];

        coordinators.forEach((c: any) => {
          if (matchesFootprint(c.residentId, c.email, c.fullName || c.name, c.phone)) {
            referencedInPrograms.push({ docId: d.id, title: data.title, eventId: data.eventId, person: c, role: 'coordinator' });
          }
        });
        volunteers.forEach((v: any) => {
          if (matchesFootprint(v.residentId, v.email, v.fullName || v.name, v.phone)) {
            referencedInPrograms.push({ docId: d.id, title: data.title, eventId: data.eventId, person: v, role: 'volunteer' });
          }
        });
        participants.forEach((p: any) => {
          if (matchesFootprint(p.residentId, p.email, p.fullName || p.name, p.phone)) {
            referencedInPrograms.push({ docId: d.id, title: data.title, eventId: data.eventId, person: p, role: 'participant' });
          }
        });
      });

      // 6. Look for references in Event Registrations (RSVP)
      const referencedInRegistrations: any[] = [];
      const regSnap = await getDocs(collection(db, "event_registrations"));
      regSnap.forEach(d => {
        const data = d.data();
        const rEmail = (data.primaryMemberEmail || '').toLowerCase().trim();
        const rGmkId = (data.primaryMemberGmkId || '').toUpperCase().trim();
        const rName = (data.primaryMemberName || '').toLowerCase().trim();
        const rPhone = (data.primaryMemberPhone || '').trim();

        if (matchesFootprint(rGmkId, rEmail, rName, rPhone)) {
          referencedInRegistrations.push({ docId: d.id, eventId: data.eventId, email: rEmail, name: data.primaryMemberName });
        }
      });

      // 7. Look for references in Role & Governance Assignments with GEAS Lifecycle Classification
      const referencedInRoles: ClassifiedRoleDoc[] = [];
      const rolesSnap = await getDocs(collection(db, "roleAssignments"));
      const govSnap = await getDocs(collection(db, "governanceAssignments"));

      const allRoleDocs = [
        ...rolesSnap.docs.map(d => ({ id: d.id, data: d.data() })),
        ...govSnap.docs.map(d => ({ id: d.id, data: d.data() }))
      ];
      const allCommittees = commSnap.docs.map(d => ({ id: d.id, data: d.data() }));
      const allPrograms = progSnap.docs.map(d => ({ id: d.id, data: d.data() }));

      const footprintRoleDocs = allRoleDocs.filter(d => {
        const rEmail = (d.data.email || '').toLowerCase().trim();
        const rGmkId = (d.data.gmkId || '').toUpperCase().trim();
        const rName = (d.data.fullName || d.data.name || '').toLowerCase().trim();
        return matchesFootprint(rGmkId, rEmail, rName);
      });

      const targetResIdents = matchingResidents.length > 0
        ? matchingResidents.map(r => ({ gmkId: r.gmkId, email: r.email }))
        : Array.from(targetEmails).map(e => ({ email: e }));

      for (const resIdent of targetResIdents) {
        const classified = classifyResidentRoleAssignments(
          resIdent,
          footprintRoleDocs,
          allCommittees,
          allPrograms
        );
        classified.forEach(item => {
          if (!referencedInRoles.some(r => r.docId === item.docId)) {
            referencedInRoles.push(item);
          }
        });
      }

      // Identify anomalies and orphans by aligning on email
      const emailMap = new Map<string, { resident?: any; user?: any; pending?: any }>();
      matchingResidents.forEach(r => {
        const e = (r.email || '').toLowerCase().trim();
        if (e) {
          if (!emailMap.has(e)) emailMap.set(e, {});
          emailMap.get(e)!.resident = r;
        }
      });
      matchingUsers.forEach(u => {
        const e = (u.email || '').toLowerCase().trim();
        if (e) {
          if (!emailMap.has(e)) emailMap.set(e, {});
          emailMap.get(e)!.user = u;
        }
      });
      matchingPending.forEach(p => {
        const e = (p.email || '').toLowerCase().trim();
        if (e) {
          if (!emailMap.has(e)) emailMap.set(e, {});
          emailMap.get(e)!.pending = p;
        }
      });

      const detectedAnomalies: any[] = [];
      const healthyMappings: any[] = [];

      for (const [email, refs] of emailMap.entries()) {
        const { resident, user, pending } = refs;
        if (user && !resident) {
          detectedAnomalies.push({
            type: 'orphaned_user',
            email,
            title: 'Orphaned User Account',
            description: 'This registered login account is active, but there is no corresponding Resident Profile document in Firestore.',
            user,
            pending,
            actionLabel: 'Merge & Create Resident Profile'
          });
        } else if (pending && !resident) {
          detectedAnomalies.push({
            type: 'orphaned_rsvp',
            email,
            title: 'Orphaned Pending Registration (RSVP)',
            description: 'A pending registration exists for this email, but no Resident Profile has been created yet.',
            pending,
            user,
            actionLabel: 'Merge & Create Resident Profile'
          });
        } else if (user && resident && user.gmkId !== resident.gmkId) {
          detectedAnomalies.push({
            type: 'id_drift',
            email,
            title: 'Resident ID Mapping Drift',
            description: `Authentication lists ID '${user.gmkId || 'None'}' but Resident Profile lists ID '${resident.gmkId || resident.id}'.`,
            user,
            resident,
            actionLabel: 'Align & Map Resident ID'
          });
        } else if (resident) {
          healthyMappings.push({
            email,
            resident,
            user,
            pending
          });
        }
      }

      setDiagResult({
        searchedId: searchId,
        searchedEmail: searchEmail,
        searchedName: searchName,
        searchedPhone: searchPhone,
        searchedUnit: searchUnit,
        matchingResidents,
        matchingUsers,
        matchingPending,
        detectedAnomalies,
        healthyMappings,
        referencedInCommittees,
        referencedInPrograms,
        referencedInRegistrations,
        referencedInRoles
      });

    } catch (err: any) {
      console.error("Diagnostic check failed:", err);
      setErrorMsg(`Diagnostic check failed: ${err.message}`);
    } finally {
      setIsDiagChecking(false);
    }
  };

  const handleHealDiagMapping = async (matchSource: any, sourceCollectionOptional?: string) => {
    setIsDiagRepairing(true);
    setDiagRepairMsg("Executing automatic mapping repair & merge operation... Please wait.");
    setErrorMsg(null);

    try {
      // Check if it's our new structured anomaly object
      if (matchSource && matchSource.type) {
        const anomaly = matchSource;
        if (anomaly.type === 'id_drift') {
          const correctId = anomaly.resident.gmkId || anomaly.resident.id;
          console.log(`💾 Re-aligning user document with correct Resident ID: ${correctId}`);
          await updateDoc(doc(db, "users", anomaly.user.id), {
            gmkId: correctId,
            updatedAt: new Date().toISOString()
          });
          setSuccessMsg(`SUCCESS: Safely aligned Resident ID '${correctId}' mapped to '${anomaly.email}'!`);
          setDiagRepairMsg(`Successfully aligned User ID '${anomaly.user.gmkId}' with correct Resident ID '${correctId}'!`);
          await handleCheckDiagMapping();
          return;
        }

        if (anomaly.user && anomaly.user.id) {
          console.log(`💾 Repairing dangling reference: Clearing missing Resident ID reference from user: ${anomaly.user.id}`);
          await updateDoc(doc(db, "users", anomaly.user.id), {
            gmkId: "",
            updatedAt: new Date().toISOString()
          });
          setSuccessMsg(`SUCCESS: Cleared dangling Resident ID reference on User '${anomaly.user.id}'!`);
          setDiagRepairMsg(`Successfully repaired! Dangling Resident ID reference on User '${anomaly.user.id}' has been cleared.`);
          await handleCheckDiagMapping();
          return;
        }

        setSuccessMsg(`Checked: Anomaly has no repairable user reference.`);
        setDiagRepairMsg(`Checked: Reference could not be repaired because it is not associated with an existing User.`);
        await handleCheckDiagMapping();
        return;

      } else {
        // Traditional fallback signature
        const sourceCollection = sourceCollectionOptional || 'users';
        if (sourceCollection === 'users' && matchSource.id) {
          console.log(`💾 Repairing dangling reference: Clearing missing Resident ID reference from user: ${matchSource.id}`);
          await updateDoc(doc(db, "users", matchSource.id), {
            gmkId: "",
            updatedAt: new Date().toISOString()
          });
          setSuccessMsg(`SUCCESS: Cleared dangling Resident ID reference on User '${matchSource.id}'!`);
          setDiagRepairMsg(`Successfully repaired! Dangling Resident ID reference on User '${matchSource.id}' has been cleared.`);
          await handleCheckDiagMapping();
          return;
        }
        setSuccessMsg(`Checked: Traditional source ${sourceCollection} is not a repairable user reference.`);
        setDiagRepairMsg(`Checked: Traditional reference could not be repaired.`);
        await handleCheckDiagMapping();
        return;
      }

    } catch (err: any) {
      console.error("Mapping healing failed:", err);
      setErrorMsg(`Mapping healing failed: ${err.message}`);
      setDiagRepairMsg(`Failed to repair: ${err.message}`);
    } finally {
      setIsDiagRepairing(false);
    }
  };

  const [geasReport, setGeasReport] = useState<{
    collectionsScanned: number;
    totalCollections: number;
    scannedCollectionsList: string[];
    totalReferences: number;
    healthyCount: number;
    brokenCount: number;
    warningsCount: number;
    criticalCount: number;
    anomalies: Array<{
      id: string;
      collection: string;
      docId: string;
      field: string;
      value: string;
      correctValue?: string;
      reason: string;
      severity: 'Critical' | 'Warning';
      actionType: 'prune' | 'heal_drift' | 'delete_doc';
      metadata?: any;
    }>;
    dependencyGraph: Record<string, string[]>;
    certified: boolean;
  } | null>(null);

  const handleScanDatabaseIntegrity = async () => {
    setDbScanStatus('scanning');
    setRepairMsg(null);
    setGeasReport(null);
    try {
      // 1. Fetch fresh list of residents and build lookups
      const resSnap = await getDocs(collection(db, "residents"));
      const residentsById: Record<string, any> = {};
      const residentsByEmail: Record<string, any> = {};
      const activeIds = new Set<string>();
      const activeEmails = new Set<string>();

      resSnap.forEach(docSnap => {
        const data = docSnap.data();
        const id = data.gmkId || docSnap.id;
        residentsById[id] = { ...data, gmkId: id };
        if (data.status === 'active' || data.isActive === true) {
          activeIds.add(id);
        }
        if (data.email) {
          const emailKey = data.email.toLowerCase().trim();
          residentsByEmail[emailKey] = { ...data, gmkId: id };
          if (data.status === 'active' || data.isActive === true) {
            activeEmails.add(emailKey);
          }
        }
      });

      // 2. Fetch fresh list of user registrations for cross-referencing
      const userSnap = await getDocs(collection(db, "users"));
      const usersByUid: Record<string, any> = {};
      const usersByEmail: Record<string, any> = {};
      userSnap.forEach(uDoc => {
        const uData = uDoc.data();
        const uid = uData.uid || uDoc.id;
        usersByUid[uid] = { ...uData, id: uid };
        if (uData.email) {
          usersByEmail[uData.email.toLowerCase().trim()] = { ...uData, id: uid };
        }
      });

      // Define target collections to scan for GEAS Rule compliance
      const collectionsToScan = [
        "residents",
        "users",
        "pending_registrations",
        "eventCommittees",
        "eventPrograms",
        "event_registrations",
        "eventAttendance",
        "eventFood",
        "eventFinance",
        "eventReports",
        "roleAssignments",
        "governanceAssignments",
        "auditLogs",
        "emailQueue",
        "families",
        "familyMembers",
        "events",
        "announcements",
        "financeStatements"
      ];

      // Safe document reader
      const fetchedCollections: Record<string, any[]> = {};
      const scannedList: string[] = [];

      for (const colName of collectionsToScan) {
        try {
          const colSnap = await getDocs(collection(db, colName));
          fetchedCollections[colName] = colSnap.docs.map(docSnap => ({
            id: docSnap.id,
            data: docSnap.data()
          }));
          scannedList.push(colName);
        } catch (colErr) {
          console.warn(`GEAS Scanner: Collection '${colName}' failed or empty:`, colErr);
          fetchedCollections[colName] = [];
        }
      }

      // Initialize results variables
      let totalReferences = 0;
      let healthyCount = 0;
      let brokenCount = 0;
      let warningsCount = 0;
      let criticalCount = 0;
      const anomaliesList: any[] = [];
      const dependencyGraph: Record<string, string[]> = {};

      const addAnomaly = (anomaly: {
        collection: string;
        docId: string;
        field: string;
        value: string;
        correctValue?: string;
        reason: string;
        severity: 'Critical' | 'Warning';
        actionType: 'prune' | 'heal_drift' | 'delete_doc';
        metadata?: any;
      }) => {
        const fieldKey = anomaly.field ? anomaly.field.replace(/[\[\]\.]/g, '_') : 'field';
        const key = `${anomaly.collection}_${anomaly.docId}_${fieldKey}`;
        anomaliesList.push({ id: key, ...anomaly });
        
        if (anomaly.severity === 'Critical') {
          criticalCount++;
          brokenCount++;
        } else {
          warningsCount++;
          healthyCount++; // Counts as flagged warning reference
        }

        // Add to dependency graph
        if (anomaly.value && anomaly.value.startsWith('GMK-')) {
          const gId = anomaly.value;
          if (!dependencyGraph[gId]) dependencyGraph[gId] = [];
          const link = `${anomaly.collection} → ${anomaly.docId} (${anomaly.field})`;
          if (!dependencyGraph[gId].includes(link)) {
            dependencyGraph[gId].push(link);
          }
        }
      };

      // 3. Deep recursive scanner
      const scanObjectRecursive = (data: any, path: string, colName: string, docId: string, fullDoc: any) => {
        if (data === null || data === undefined) return;

        if (typeof data === 'object') {
          if (Array.isArray(data)) {
            data.forEach((item, idx) => {
              scanObjectRecursive(item, `${path}[${idx}]`, colName, docId, fullDoc);
            });
          } else {
            for (const [key, val] of Object.entries(data)) {
              scanObjectRecursive(val, path ? `${path}.${key}` : key, colName, docId, fullDoc);
            }
          }
        } else if (typeof data === 'string') {
          const valStr = data.trim();
          
          // Pattern A: Value is a Resident GMK ID
          if (/^GMK-\d+$/i.test(valStr)) {
            totalReferences++;
            const normGmkId = valStr.toUpperCase();
            
            if (!activeIds.has(normGmkId)) {
              // Critical: reference to non-existent resident
              addAnomaly({
                collection: colName,
                docId,
                field: path,
                value: valStr,
                reason: `GEAS Rule #005 Violation: Resident profile '${normGmkId}' does not exist or is inactive.`,
                severity: 'Critical',
                actionType: colName === 'event_registrations' || colName === 'roleAssignments' || colName === 'governanceAssignments' || colName === 'eventAttendance' || colName === 'eventFood' ? 'delete_doc' : 'prune',
                metadata: { colName, docId, path, normGmkId }
              });
            } else {
              healthyCount++;
              
              // Validate email & name drift inside same document
              const master = residentsById[normGmkId];
              if (master) {
                // Check if sibling fields in the same object drift
                if (fullDoc.email && typeof fullDoc.email === 'string' && fullDoc.email.toLowerCase().trim() !== master.email?.toLowerCase().trim()) {
                  addAnomaly({
                    collection: colName,
                    docId,
                    field: 'email',
                    value: fullDoc.email,
                    correctValue: master.email,
                    reason: `GEAS Rule #007: Identity drift detected. Document email '${fullDoc.email}' does not match authoritative profile email '${master.email}'.`,
                    severity: 'Warning',
                    actionType: 'heal_drift',
                    metadata: { colName, docId, path: 'email', correctValue: master.email }
                  });
                }
              }
            }
          }

          // Pattern B: Key contains email indicators and value contains '@'
          else if (valStr.includes('@') && /(email|primaryMemberEmail|userEmail|coord\.email)/i.test(path)) {
            totalReferences++;
            const normEmail = valStr.toLowerCase();
            const master = residentsByEmail[normEmail];

            if (!master) {
              // Warning or Critical depending on role assignment relevance
              const isGovOrRole = colName === 'roleAssignments' || colName === 'governanceAssignments';
              addAnomaly({
                collection: colName,
                docId,
                field: path,
                value: valStr,
                reason: `Orphaned Email Reference: Email '${normEmail}' is not associated with any active resident.`,
                severity: isGovOrRole ? 'Critical' : 'Warning',
                actionType: isGovOrRole ? 'delete_doc' : 'prune',
                metadata: { colName, docId, path, normEmail }
              });
            } else {
              healthyCount++;
            }
          }

          // Pattern C: Key contains UID indicators and length corresponds to Firestore UIDs
          else if (valStr.length >= 27 && valStr.length <= 36 && /(uid|userId|owner|createdBy|approvedBy|assignedTo)/i.test(path)) {
            totalReferences++;
            const userRef = usersByUid[valStr];
            if (!userRef) {
              addAnomaly({
                collection: colName,
                docId,
                field: path,
                value: valStr,
                reason: `GEAS Rule #006: User account reference '${valStr}' is missing or inactive.`,
                severity: 'Warning',
                actionType: 'prune',
                metadata: { colName, docId, path }
              });
            } else {
              healthyCount++;
            }
          }
        }
      };

      // 4. Run scanner across all loaded documents
      for (const [colName, docs] of Object.entries(fetchedCollections)) {
        docs.forEach(docItem => {
          scanObjectRecursive(docItem.data, '', colName, docItem.id, docItem.data);
        });
      }

      // 5. Explicitly look for Orphaned User Accounts (users exists but no residents matches email)
      for (const [email, userObj] of Object.entries(usersByEmail)) {
        if (!residentsByEmail[email]) {
          addAnomaly({
            collection: 'users',
            docId: userObj.id,
            field: 'email',
            value: email,
            reason: `Orphaned User Account: Firebase user email '${email}' exists but there is no corresponding Resident Profile document.`,
            severity: 'Warning',
            actionType: 'heal_drift',
            metadata: { colName: 'users', docId: userObj.id, userObj }
          });
        }
      }

      // Populate older array states for complete backwards compatibility
      const tempCommittees: any[] = [];
      const tempPrograms: any[] = [];
      const tempRegistrations: any[] = [];
      const tempRoles: any[] = [];

      anomaliesList.forEach(an => {
        if (an.collection === 'eventCommittees') {
          tempCommittees.push({
            docId: an.docId,
            committeeName: an.metadata?.committeeName || 'Event Committee',
            eventId: an.metadata?.eventId || '',
            member: { residentId: an.value, email: an.correctValue || '' },
            reason: an.reason,
            actionType: an.actionType
          });
        } else if (an.collection === 'eventPrograms') {
          tempPrograms.push({
            docId: an.docId,
            programTitle: an.metadata?.programTitle || 'Program',
            eventId: an.metadata?.eventId || '',
            coord: { residentId: an.value },
            type: 'coordinator',
            reason: an.reason,
            actionType: an.actionType
          });
        } else if (an.collection === 'event_registrations') {
          tempRegistrations.push({
            docId: an.docId,
            eventId: an.metadata?.eventId || '',
            primaryEmail: an.value,
            name: an.reason
          });
        } else if (an.collection === 'roleAssignments' || an.collection === 'governanceAssignments') {
          tempRoles.push({
            docId: an.docId,
            type: an.collection === 'roleAssignments' ? 'role' : 'gov',
            gmkId: an.value,
            email: an.correctValue || '',
            role: an.reason
          });
        }
      });

      setOrphanedCommittees(tempCommittees);
      setOrphanedPrograms(tempPrograms);
      setOrphanedRegistrations(tempRegistrations);
      setOrphanedRoles(tempRoles);

      const hasCriticals = criticalCount > 0;
      setGeasReport({
        collectionsScanned: scannedList.length,
        totalCollections: collectionsToScan.length,
        scannedCollectionsList: scannedList,
        totalReferences,
        healthyCount,
        brokenCount: brokenCount,
        warningsCount,
        criticalCount,
        anomalies: anomaliesList,
        dependencyGraph,
        certified: !hasCriticals
      });

      setDbScanStatus('success');
    } catch (err: any) {
      console.error("GEAS Compliance Scan Failed:", err);
      setDbScanStatus('error');
      setErrorMsg(`GEAS Scan failed: ${err.message}`);
    }
  };

  const handleHealDatabaseIntegrity = async () => {
    if (!geasReport || geasReport.anomalies.length === 0) return;

    setIsRepairing(true);
    setRepairMsg("GEAS Compliance Engine: Initiating safe self-healing transactional repair... Please do not close this browser.");
    try {
      let repairCount = 0;
      let deleteCount = 0;
      let healCount = 0;

      for (const anomaly of geasReport.anomalies) {
        const { collection: colName, docId, field, actionType, value, correctValue } = anomaly;
        const docRef = doc(db, colName, docId);

        try {
          if (actionType === 'delete_doc') {
            await deleteDoc(docRef);
            deleteCount++;
            repairCount++;
          } else if (actionType === 'heal_drift' && correctValue) {
            // Drift corrections or orphaned user merges
            if (colName === 'users') {
              // Clear dangling resident ID reference on the orphaned user account instead of recreating the resident profile
              await updateDoc(docRef, {
                gmkId: "",
                updatedAt: new Date().toISOString()
              });
            } else {
              // Standard field updates
              const updatePayload: Record<string, any> = {};
              updatePayload[field] = correctValue;
              updatePayload.updatedAt = new Date().toISOString();
              await updateDoc(docRef, updatePayload);
            }
            healCount++;
            repairCount++;
          } else if (actionType === 'prune') {
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
              const currentData = docSnap.data();
              
              // Handle nested arrays like members in eventCommittees or coordinators/volunteers/participants in eventPrograms
              if (field.includes('[') && field.includes(']')) {
                const arrayName = field.split('[')[0];
                const originalArray = currentData[arrayName] || [];
                
                // Filter out the item matching the value/name
                const updatedArray = originalArray.filter((item: any) => {
                  const itemVal = item.residentId || item.gmkId || item.email || '';
                  return itemVal !== value;
                });

                await updateDoc(docRef, {
                  [arrayName]: updatedArray,
                  updatedAt: new Date().toISOString()
                });
              } else {
                // Sibling or standard field pruning
                await updateDoc(docRef, {
                  [field]: "",
                  updatedAt: new Date().toISOString()
                });
              }
              healCount++;
              repairCount++;
            }
          }
        } catch (itemErr) {
          console.error(`GEAS Repair failed on ${colName}/${docId}:`, itemErr);
        }
      }

      // Add audit log
      await createAuditLog(
        'GEAS_REPAIR_RUN',
        activeEmail,
        'system',
        'geas_compliance_engine',
        `GEAS v1.0 compliance self-healing repaired ${repairCount} references successfully.
- Pruned/updated ${healCount} fields and mappings
- Purged ${deleteCount} dangling documents`,
        'GEAS Compliance Self-Healing'
      );

      setRepairMsg(`✓ SUCCESS: GEAS Compliance self-healing complete! Repaired ${repairCount} references (${healCount} pruned, ${deleteCount} purged).`);
      
      // Auto-rescan to verify green certified state
      await handleScanDatabaseIntegrity();
    } catch (err: any) {
      console.error("GEAS Compliance Repair Failed:", err);
      setRepairMsg(`❌ REPAIR FAILED: ${err.message}`);
    } finally {
      setIsRepairing(false);
    }
  };

  // Form State - Resident Creator
  const [gmkId, setGmkId] = useState('');
  const [flatNo, setFlatNo] = useState('');
  const [phone, setPhone] = useState('');
  const [residentEmail, setResidentEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [salutation, setSalutation] = useState<'Mr' | 'Mrs' | 'Ms' | 'Mstr' | 'Dr'>('Mr');
  const [unitType, setUnitType] = useState<'Apartment' | 'Villa' | 'Townhouse'>('Apartment');
  const [status, setStatus] = useState<'active' | 'inactive' | 'pending'>('active');
  const [gatedCommunity, setGatedCommunity] = useState('Al Hail Greens');
  const [remarks, setRemarks] = useState('');

  // Form State - Event Creator
  const [eventTitle, setEventTitle] = useState('');
  const [eventDesc, setEventDesc] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [eventVenue, setEventVenue] = useState('');

  // Form State - User Editor
  const [editingUserUid, setEditingUserUid] = useState<string | null>(null);
  const [editingUserRoles, setEditingUserRoles] = useState<string[]>([]);
  const [editingUserActive, setEditingUserActive] = useState(true);

  // Filtering Residents
  const [residentSearch, setResidentSearch] = useState('');

  // Auto-generate next GMK sequential code based on current residents count
  useEffect(() => {
    if (residents.length > 0) {
      const numericIds = residents
        .map(r => {
          const rawId = r?.gmkId || (r as any)?.id || '';
          const match = String(rawId).match(/GMK-(\d+)/);
          if (match) return parseInt(match[1], 10);
          const num = parseInt(String(rawId).replace('GMK-', ''), 10);
          return !isNaN(num) ? num : null;
        })
        .filter((id): id is number => id !== null && !isNaN(id));
      const maxId = numericIds.length > 0 ? Math.max(...numericIds) : 1000;
      const nextId = String(maxId + 1).padStart(4, '0');
      setGmkId(`GMK-${nextId}`);
    } else {
      setGmkId('GMK-001001');
    }
  }, [residents]);

  // Real-time Firestore Listeners
  useEffect(() => {
    setLoading(true);
    setErrorMsg(null);

    console.log("📡 Initializing real-time Firestore synchronization for Super Admin...");

    const unsubResidents = onSnapshot(
      collection(db, "residents"),
      (snapshot) => {
        const list: ResidentProfile[] = [];
        snapshot.forEach((docSnap) => {
          const r = docSnap.data() as ResidentProfile;
          const currentGC = r.gatedCommunity || '';
          if (
            currentGC.toLowerCase().includes("al mouj") ||
            currentGC.toLowerCase().includes("muscat hills") ||
            currentGC.toLowerCase().includes("gmk heights")
          ) {
            const cleaned = { ...r, gatedCommunity: "Al Hail Greens" };
            setDoc(doc(db, "residents", docSnap.id), { gatedCommunity: "Al Hail Greens" }, { merge: true }).catch(err => {
              console.warn("⚠️ Silent cleanup of resident gatedCommunity failed:", err);
            });
            list.push(cleaned);
          } else {
            list.push(r);
          }
        });
        setResidents(list);
      },
      (err: any) => {
        console.error("❌ Residents Snapshot Error:", err);
        setErrorMsg(`Firestore Blocked (residents): ${err.code} - ${err.message}`);
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
      (err: any) => {
        console.error("❌ Users Snapshot Error:", err);
        setErrorMsg(`Firestore Blocked (users): ${err.code} - ${err.message}`);
      }
    );

    const unsubEvents = onSnapshot(
      collection(db, "events"),
      (snapshot) => {
        const list: CommunityEvent[] = [];
        snapshot.forEach((doc) => {
          list.push({ id: doc.id, ...doc.data() } as CommunityEvent);
        });
        setEvents(list);
        setLoading(false);
      },
      (err: any) => {
        console.error("❌ Events Snapshot Error:", err);
        setErrorMsg(`Firestore Blocked (events): ${err.code} - ${err.message}`);
        setLoading(false);
      }
    );

    const unsubRoles = onSnapshot(
      collection(db, "governanceAssignments"),
      (snapshot) => {
        const list: GovernanceAssignment[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          list.push({
            id: doc.id,
            gmkId: data.gmkId,
            email: data.email,
            position: data.position || data.role,
            assignedBy: data.assignedBy,
            assignedAt: data.assignedAt
          } as GovernanceAssignment);
        });
        setGovAssignments(list);
      },
      (err: any) => {
        console.error("❌ GovernanceAssignments Snapshot Error:", err);
      }
    );

    const unsubLegacyRoles = onSnapshot(
      collection(db, "roleAssignments"),
      (snapshot) => {
        const list: GovernanceAssignment[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          list.push({
            id: doc.id,
            gmkId: data.gmkId,
            email: data.email,
            position: data.position || data.role,
            assignedBy: data.assignedBy,
            assignedAt: data.assignedAt
          } as GovernanceAssignment);
        });
        setLegacyRoleAssignments(list);
      },
      (err: any) => {
        console.error("❌ RoleAssignments Snapshot Error:", err);
      }
    );

    const unsubLogs = onSnapshot(
      query(collection(db, "auditLogs"), orderBy("timestamp", "desc"), limit(100)),
      (snapshot) => {
        const list: AuditLog[] = [];
        snapshot.forEach((doc) => {
          list.push(doc.data() as AuditLog);
        });
        setAuditLogs(list);
      },
      (err: any) => {
        console.error("❌ AuditLogs Snapshot Error:", err);
      }
    );

    // Synchronize pending registrations for unified accurate count indicator
    const unsubPending = onSnapshot(
      query(collection(db, "pending_registrations"), where("status", "==", "pending")),
      (snapshot) => {
        const list: PendingRegistration[] = [];
        snapshot.forEach((docSnap) => {
          const p = docSnap.data() as PendingRegistration;
          const currentGC = p.gatedCommunity || '';
          if (
            currentGC.toLowerCase().includes("al mouj") ||
            currentGC.toLowerCase().includes("muscat hills") ||
            currentGC.toLowerCase().includes("gmk heights")
          ) {
            const cleaned = { ...p, gatedCommunity: "Al Hail Greens" };
            setDoc(doc(db, "pending_registrations", docSnap.id), { gatedCommunity: "Al Hail Greens" }, { merge: true }).catch(err => {
              console.warn("⚠️ Silent cleanup of pending registration gatedCommunity failed:", err);
            });
            list.push(cleaned);
          } else {
            list.push(p);
          }
        });
        setPendingRegs(list);
      },
      (err: any) => {
        console.error("❌ pending_registrations snapshot error:", err);
      }
    );

    return () => {
      unsubResidents();
      unsubUsers();
      unsubEvents();
      unsubRoles();
      unsubLegacyRoles();
      unsubLogs();
      unsubPending();
    };
  }, []);

  // Merge real-time snapshot arrays of standard and legacy collections
  useEffect(() => {
    const list = [...govAssignments];
    legacyRoleAssignments.forEach(item => {
      if (!list.some(g => g.id === item.id)) {
        list.push(item);
      }
    });
    
    // Deduplicate by normalized identifier and position
    const uniqueList: GovernanceAssignment[] = [];
    const seenKeys = new Set<string>();
    list.forEach((item) => {
      const ident = item.gmkId ? item.gmkId.toUpperCase().trim() : item.email.toLowerCase().trim();
      const key = `${ident}_${item.position}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        uniqueList.push(item);
      }
    });

    // Filter out any assignments that are in the process of being revoked (prevents flicker back to active)
    const filteredList = uniqueList.filter(item => {
      const gmkKey = item.gmkId ? `${item.gmkId.toUpperCase().trim()}_${item.position}` : '';
      const emailKey = item.email ? `${item.email.toLowerCase().trim()}_${item.position}` : '';
      if (revokingKeys.has(gmkKey) || revokingKeys.has(emailKey)) {
        return false;
      }
      return true;
    });

    setRoleAssignments(filteredList);

    // Clean up key from revokingKeys once it's completely absent from both standard and legacy collections
    if (revokingKeys.size > 0) {
      setRevokingKeys(prev => {
        const next = new Set(prev);
        let changed = false;
        prev.forEach(key => {
          const stillExists = list.some(item => {
            const gmkKey = item.gmkId ? `${item.gmkId.toUpperCase().trim()}_${item.position}` : '';
            const emailKey = item.email ? `${item.email.toLowerCase().trim()}_${item.position}` : '';
            return gmkKey === key || emailKey === key;
          });
          if (!stillExists) {
            next.delete(key);
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    }
  }, [govAssignments, legacyRoleAssignments, revokingKeys]);

  // Exit Enclave Session
  const handleExit = async () => {
    await signOut(auth);
  };

  // Find duplicate pairs in loaded residents (grouped by unitKey or email)
  const getDuplicateResidentSets = () => {
    const duplicates: {
      unitKey: string;
      displayUnitNumber: string;
      email: string;
      records: ResidentProfile[];
    }[] = [];

    // Group active residents by unitKey
    const groupedByUnit: Record<string, ResidentProfile[]> = {};
    residents.forEach(r => {
      if (r.status === 'active') {
        const key = r.unitKey;
        if (!key) return;
        if (!groupedByUnit[key]) {
          groupedByUnit[key] = [];
        }
        groupedByUnit[key].push(r);
      }
    });

    Object.keys(groupedByUnit).forEach(key => {
      const records = groupedByUnit[key];
      if (records.length > 1) {
        duplicates.push({
          unitKey: key,
          displayUnitNumber: records[0].displayUnitNumber,
          email: records[0].email,
          records: records.sort((a, b) => a.gmkId.localeCompare(b.gmkId)) // sort old to new (e.g. GMK-1002, GMK-1003)
        });
      }
    });

    return duplicates;
  };

  const handleDeduplicate = async (set: { unitKey: string; displayUnitNumber: string; records: ResidentProfile[] }) => {
    if (set.records.length < 2) return;
    const original = set.records[0];
    const duplicatesToDelete = set.records.slice(1);

    const dupDetailsStr = duplicatesToDelete.map(r => `${r.fullName} (${r.gmkId})`).join(', ');
    const confirmed = await showConfirm({
      title: "DEDUPLICATE RESIDENT PROFILES",
      message: `⚠️ WARNING: This will permanently delete the duplicate profile(s) [${dupDetailsStr}] for unit ${set.displayUnitNumber} from the community database.\n\nThe original profile for ${original.fullName} (${original.gmkId}) and its family registration frame will remain fully preserved and active.\n\nProceed with deduplication?`,
      severity: "danger",
      confirmText: "Proceed with Deduplication",
      cancelText: "Cancel"
    });
    if (!confirmed) {
      return;
    }

    setCleaningId(set.unitKey);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      for (const dup of duplicatesToDelete) {
        // 1. Delete Resident document
        await deleteDoc(doc(db, "residents", dup.gmkId));
        
        // 2. Delete Decoupled Family Profile frame
        await deleteDoc(doc(db, "families", `fam_${dup.gmkId}`));

        // 3. Delete corresponding user role record from users directory to keep SSO references healthy
        const userQ = query(collection(db, "users"), where("email", "==", dup.email.toLowerCase().trim()));
        const userSnap = await getDocs(userQ);
        for (const uDoc of userSnap.docs) {
          if (uDoc.id !== original.gmkId) {
            await deleteDoc(doc(db, "users", uDoc.id));
          }
        }

        // 4. Create Audit Log Entry
        await createAuditLog(
          'DEDUPLICATE_RESIDENT_CLEANUP',
          activeEmail,
          'resident',
          dup.gmkId,
          `Permanently cleaned up duplicate resident record ${dup.fullName} (${dup.gmkId}) for unit ${set.displayUnitNumber}, preserving original record ${original.gmkId}.`,
          dup.fullName
        );
      }

      setSuccessMsg(`✓ Successfully resolved data integrity for Unit ${set.displayUnitNumber}. Deleted ${duplicatesToDelete.length} duplicate record(s) from database.`);
    } catch (err: any) {
      console.error("Deduplication utility error:", err);
      setErrorMsg(`Failed to complete deduplication routine: ${err.message}`);
    } finally {
      setCleaningId(null);
    }
  };

  // Form validation
  const validatePhone = (p: string) => {
    return /^\d{8}$/.test(p.trim());
  };

  const handleCreateResident = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const normResult = normalizeUnit(unitType, flatNo);
    if (!normResult.isValid) {
      setErrorMsg(`VALIDATION ERROR: ${normResult.error}`);
      return;
    }

    const sanitizedEmail = residentEmail.toLowerCase().trim();

    if (!validatePhone(phone)) {
      setErrorMsg("VALIDATION ERROR: Primary Phone Number must be exactly 8 digits (Oman number).");
      return;
    }

    try {
      // 1. Cross-check email in residents
      const resEmailQ = query(collection(db, "residents"), where("email", "==", sanitizedEmail));
      const resEmailSnap = await getDocs(resEmailQ);
      if (!resEmailSnap.empty) {
        throw new Error("A resident with this Email Address is already registered in the community database.");
      }

      // 2. Cross-check unitKey in residents
      const resKeyQ = query(collection(db, "residents"), where("unitKey", "==", normResult.unitKey));
      const resKeySnap = await getDocs(resKeyQ);
      if (!resKeySnap.empty) {
        throw new Error(`Unit Identifier Code '${normResult.displayUnitNumber}' (${normResult.unitKey}) is already bound to another verified resident.`);
      }

      // 3. Cross-check email in pending_registrations
      const pendEmailQ = query(collection(db, "pending_registrations"), where("email", "==", sanitizedEmail));
      const pendEmailSnap = await getDocs(pendEmailQ);
      if (!pendEmailSnap.empty) {
        throw new Error("This Email is currently awaiting admin verification in the pending queue.");
      }

      // 4. Cross-check unitKey in pending_registrations
      const pendUnitQ = query(collection(db, "pending_registrations"), where("unitKey", "==", normResult.unitKey));
      const pendUnitSnap = await getDocs(pendUnitQ);
      if (!pendUnitSnap.empty) {
        throw new Error(`Unit Identifier Code '${normResult.displayUnitNumber}' is currently awaiting admin approval in the pending queue.`);
      }

      const payload: ResidentProfile = {
        gmkId: gmkId.trim(),
        displayUnitNumber: normResult.displayUnitNumber,
        phone: phone.trim(),
        email: sanitizedEmail,
        unitKey: normResult.unitKey,
        fullName: fullName.trim(),
        salutation,
        unitType,
        status,
        gatedCommunity,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        remarks: remarks.trim()
      };

      console.log(`💾 Executing Firestore setDoc query on residents/${payload.gmkId}`);
      await setDoc(doc(db, "residents", payload.gmkId), sanitizeFirestorePayload(payload));

      await createAuditLog(
        'ACTIVATE_RESIDENT',
        activeEmail,
        'resident',
        payload.gmkId,
        `Administratively created resident profile for ${payload.fullName} (Unit: ${payload.displayUnitNumber}, Status: ${payload.status.toUpperCase()})`,
        payload.fullName
      );

      // Trigger notification using NotificationService if status is active
      if (payload.status === 'active') {
        try {
          await NotificationService.sendRegistrationApproved(payload.email, {
            residentName: payload.fullName,
            gmkId: payload.gmkId,
            unit: payload.displayUnitNumber
          });
        } catch (notifErr) {
          console.warn("⚠️ Notification could not be queued during administrative resident activation:", notifErr);
        }
      }

      setSuccessMsg(`Resident document ${payload.gmkId} successfully bounded to ${payload.unitKey}`);
      
      // Reset fields
      setFlatNo('');
      setPhone('');
      setResidentEmail('');
      setFullName('');
      setRemarks('');
    } catch (err: any) {
      console.error("❌ Firestore Write Crash:", err);
      setErrorMsg(`Could not save resident record. Please try again. (${err.message})`);
    }
  };

  const handleToggleResidentRole = async (gmkId: string, email: string, roleKey: 'admin' | 'president' | 'vp' | 'event_director', isAssigned: boolean) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const targetRes = residents.find(r => r.gmkId === gmkId);
      const resName = targetRes ? targetRes.fullName : gmkId;
      const resEmail = targetRes ? targetRes.email : email;
      const normEmail = (resEmail || email || '').toLowerCase().trim();

      const assignmentId = `${gmkId}_${roleKey}`;
      const emailAssignmentId = `${normEmail}_${roleKey}`;
      const govDocRef = doc(db, "governanceAssignments", assignmentId);
      const roleDocRef = doc(db, "roleAssignments", assignmentId);
      const govEmailDocRef = doc(db, "governanceAssignments", emailAssignmentId);
      const roleEmailDocRef = doc(db, "roleAssignments", emailAssignmentId);

      if (isAssigned) {
        // Track the keys being revoked to prevent flash/flicker from real-time listener updates
        const gmkKey = `${gmkId.toUpperCase().trim()}_${roleKey}`;
        const emailKey = normEmail ? `${normEmail.toLowerCase().trim()}_${roleKey}` : '';
        setRevokingKeys(prev => {
          const next = new Set(prev);
          next.add(gmkKey);
          if (emailKey) next.add(emailKey);
          return next;
        });

        // Optimistic UI update to instantly clear role selection from the lists and HUD
        const filterFn = (prev: GovernanceAssignment[]) => prev.filter(ra => !(ra.position === roleKey && (ra.gmkId === gmkId || ra.email === normEmail)));
        setGovAssignments(filterFn);
        setLegacyRoleAssignments(filterFn);
        setRoleAssignments(filterFn);

        console.log(`🗑️ Querying and removing ALL role assignments for: ${gmkId} and ${normEmail} with position ${roleKey}`);
        
        const refsToDelete: any[] = [govDocRef, roleDocRef];
        if (normEmail) {
          refsToDelete.push(govEmailDocRef, roleEmailDocRef);
        }

        // Query collections dynamically to catch all variants
        try {
          const govSnapGmk = await getDocs(query(collection(db, "governanceAssignments"), where("gmkId", "==", gmkId)));
          govSnapGmk.forEach(doc => refsToDelete.push(doc.ref));

          const roleSnapGmk = await getDocs(query(collection(db, "roleAssignments"), where("gmkId", "==", gmkId)));
          roleSnapGmk.forEach(doc => refsToDelete.push(doc.ref));

          if (normEmail) {
            const govSnapEmail = await getDocs(query(collection(db, "governanceAssignments"), where("email", "==", normEmail)));
            govSnapEmail.forEach(doc => refsToDelete.push(doc.ref));

            const roleSnapEmail = await getDocs(query(collection(db, "roleAssignments"), where("email", "==", normEmail)));
            roleSnapEmail.forEach(doc => refsToDelete.push(doc.ref));
          }
        } catch (queryErr) {
          console.warn("Non-blocking query-based role fetch error:", queryErr);
        }

        // Filter and deduplicate references by their document path
        const pathsSeen = new Set<string>();
        const uniqueRefs = refsToDelete.filter(ref => {
          if (!ref || !ref.path) return false;
          if (pathsSeen.has(ref.path)) return false;
          pathsSeen.add(ref.path);
          return true;
        });

        // Delete all matches
        for (const ref of uniqueRefs) {
          try {
            await deleteDoc(ref);
            console.log(`Successfully deleted: ${ref.path}`);
          } catch (deleteErr) {
            console.warn(`Non-blocking deletion failure on ${ref.path}:`, deleteErr);
          }
        }
        
        // Sync role removal to user SSO document if it exists in system
        if (normEmail) {
          try {
            const userQ = query(collection(db, "users"), where("email", "==", normEmail));
            const userSnap = await getDocs(userQ);
            for (const uDoc of userSnap.docs) {
              const currentRoles: string[] = uDoc.data().roles || [];
              const updatedRoles = currentRoles.filter((r: string) => r !== roleKey);
              await setDoc(doc(db, "users", uDoc.id), { roles: updatedRoles }, { merge: true });
              console.log(`Synced '${roleKey}' role removal to users/${uDoc.id}`);
            }
          } catch (syncErr) {
            console.warn("Non-blocking SSO sync error on unassign:", syncErr);
          }
        }
        
        await createAuditLog(
          'role_assignment_removed',
          activeEmail,
          gmkId,
          resName,
          `Removed role/position assignment: ${roleKey.toUpperCase()} for resident ${resName}`
        );

        setGovSearchQuery('');
        setGovTargetGmkId('');
        setSuccessMsg(`✓ Unassigned ${roleKey.toUpperCase()} position from ${resName}`);
      } else {
        // Enforce Role/Position Exclusivity Principle
        const validation = validateGovernanceAssignment(
          { gmkId, email: normEmail, name: resName },
          roleKey,
          roleAssignments
        );

        if (!validation.eligible) {
          setErrorMsg(validation.reason || 'Governance Exclusivity Violation');
          return;
        }

        // Additional Exclusivity Enforcer: Prevent assigning a role already held by someone else
        if (roleAssignments.some(ra => ra.position === roleKey)) {
          setErrorMsg(`EXCLUSIVITY VIOLATION: The '${roleKey.toUpperCase()}' position is already assigned to another resident. You must revoke the current assignment first.`);
          return;
        }

        console.log(`💾 Adding governance assignments: ${assignmentId} and ${emailAssignmentId}`);
        const payload = {
          id: assignmentId,
          gmkId,
          email: normEmail,
          position: roleKey,
          role: roleKey, // backward compatibility
          status: 'ACTIVE',
          assignedBy: activeEmail,
          assignedAt: new Date().toISOString()
        };

        const emailPayload = {
          ...payload,
          id: emailAssignmentId
        };

        // Optimistic UI update to instantly show role assignment in the lists and HUD
        const newAssignment: GovernanceAssignment = {
          id: assignmentId,
          gmkId,
          email: normEmail,
          position: roleKey,
          assignedBy: activeEmail,
          assignedAt: new Date().toISOString()
        };
        setGovAssignments(prev => [...prev.filter(ra => ra.position !== roleKey), newAssignment]);
        setLegacyRoleAssignments(prev => [...prev.filter(ra => ra.position !== roleKey), newAssignment]);
        setRoleAssignments(prev => [...prev.filter(ra => ra.position !== roleKey), newAssignment]);

        await setDoc(govDocRef, payload);
        await setDoc(roleDocRef, payload);
        await setDoc(govEmailDocRef, emailPayload);
        await setDoc(roleEmailDocRef, emailPayload);

        // Sync elevated role to user SSO document if it exists in system
        try {
          const userQ = query(collection(db, "users"), where("email", "==", normEmail));
          const userSnap = await getDocs(userQ);
          for (const uDoc of userSnap.docs) {
            if (roleKey === 'admin') {
              // Write 2: Update users/{uid} roles: ["resident","admin"]
              await setDoc(doc(db, "users", uDoc.id), { roles: ["resident", "admin"] }, { merge: true });
              console.log(`Synced elevated 'admin' role exactly as ["resident","admin"] to users/${uDoc.id}`);
            } else {
              const currentRoles: string[] = uDoc.data().roles || [];
              const updatedRoles = Array.from(new Set([...currentRoles, roleKey]));
              await setDoc(doc(db, "users", uDoc.id), { roles: updatedRoles }, { merge: true });
            }
          }
        } catch (syncErr) {
          console.warn("Non-blocking SSO sync error on assign:", syncErr);
        }

        // Write 3: Create audit log action: ADMIN_ASSIGNED if roleKey === 'admin'
        const auditAction = roleKey === 'admin' ? 'ADMIN_ASSIGNED' : 'role_assignment_created';
        await createAuditLog(
          auditAction,
          activeEmail,
          'governanceAssignments',
          emailAssignmentId,
          `Assigned position: ${roleKey.toUpperCase()} to resident ${resName}`,
          resName
        );

        // Write 4: Refresh authorization state immediately
        if (refreshProfile) {
          await refreshProfile();
        }

        setSuccessMsg(`✓ Assigned ${roleKey.toUpperCase()} position to ${resName}`);
      }
    } catch (err: any) {
      console.error("❌ Position toggle failed:", err);
      setErrorMsg(`POSITION TOGGLE ERROR: ${err.code} - ${err.message}`);
    }
  };

  const handleDeleteResidentExecute = async (res: ResidentProfile) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setDeletionReport(null);

    try {
      const result = await ResidentLifecycleService.deleteResidentCascade(
        res.gmkId,
        activeEmail,
        "Super Administrator manual deletion"
      );

      if (result.success) {
        setDeletionReport(result.verificationReport);
        setSuccessMsg(`✓ Resident ${res.fullName} (GMK ID: ${res.gmkId}) and all associated dependencies have been permanently and safely deleted under GEAS v1.0.`);
      } else {
        setErrorMsg(`GEAS Cascade Delete Failed: ${result.error}`);
        if (result.verificationReport) {
          setDeletionReport(result.verificationReport);
        }
      }
    } catch (err: any) {
      console.error("Deleting failed:", err);
      setErrorMsg(`Failed to delete resident profile: ${err.message}`);
    }
  };

  const handleDeleteResident = async (targetGmkId: string) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const targetRes = residents.find(r => r.gmkId === targetGmkId);
      const activeRes = targetRes || {
        gmkId: targetGmkId,
        fullName: targetGmkId,
        email: '',
        status: 'deleted'
      };

      const normEmail = (activeRes.email || '').toLowerCase().trim();
      const dependencies: string[] = [];

      // A. Check eventCommittees memberships
      const committeesSnap = await getDocs(collection(db, "eventCommittees"));
      committeesSnap.forEach(docSnap => {
        const data = docSnap.data();
        const members = data.members || [];
        const hasMember = members.some((m: any) => m.residentId === activeRes.gmkId || (m.email && m.email.toLowerCase().trim() === normEmail));
        if (hasMember) {
          dependencies.push(`Member of Committee: "${data.name}" in Event ID "${data.eventId}"`);
        }
      });

      // B. Check eventPrograms assignments
      const programsSnap = await getDocs(collection(db, "eventPrograms"));
      programsSnap.forEach(docSnap => {
        const data = docSnap.data();
        const coords = data.coordinators || [];
        const vols = data.volunteers || [];
        const parts = data.participants || [];
        const hasCoord = coords.some((m: any) => m.residentId === activeRes.gmkId || (m.email && m.email.toLowerCase().trim() === normEmail));
        const hasVol = vols.some((m: any) => m.residentId === activeRes.gmkId || (m.email && m.email.toLowerCase().trim() === normEmail));
        const hasPart = parts.some((m: any) => m.residentId === activeRes.gmkId || (m.email && m.email.toLowerCase().trim() === normEmail));
        if (hasCoord) dependencies.push(`Coordinator of Program: "${data.title}"`);
        if (hasVol) dependencies.push(`Volunteer of Program: "${data.title}"`);
        if (hasPart) dependencies.push(`Participant of Program: "${data.title}"`);
      });

      // C. Check event_registrations
      const regsSnap1 = await getDocs(query(collection(db, "event_registrations"), where("primaryMemberGmkId", "==", activeRes.gmkId)));
      const regsSnap2 = await getDocs(query(collection(db, "event_registrations"), where("primaryMemberEmail", "==", normEmail)));
      if (!regsSnap1.empty || !regsSnap2.empty) {
        dependencies.push(`Has active Event Registration(s)`);
      }

      // D. Check roleAssignments & governanceAssignments using GEAS Lifecycle Classification (RTCO-010)
      const rolesSnap = await getDocs(collection(db, "roleAssignments"));
      const govSnap = await getDocs(collection(db, "governanceAssignments"));

      const rawRoleDocs = [
        ...rolesSnap.docs.map(d => ({ id: d.id, data: d.data() })),
        ...govSnap.docs.map(d => ({ id: d.id, data: d.data() }))
      ];
      const rawCommittees = committeesSnap.docs.map(d => ({ id: d.id, data: d.data() }));
      const rawPrograms = programsSnap.docs.map(d => ({ id: d.id, data: d.data() }));

      const classifiedRoles = classifyResidentRoleAssignments(
        { gmkId: activeRes.gmkId, email: normEmail },
        rawRoleDocs,
        rawCommittees,
        rawPrograms
      );

      // ONLY ACTIVE governance assignments block resident purge!
      const activeBlockingRoles = classifiedRoles.filter(r => r.lifecycleStatus === 'ACTIVE');
      const nonActiveRoles = classifiedRoles.filter(r => r.lifecycleStatus !== 'ACTIVE');

      activeBlockingRoles.forEach(r => {
        dependencies.push(`Active Governance/Role Assignment: "${r.position}${r.committeeNormalized ? ` — ${r.committeeNormalized}` : ''}"`);
      });

      if (nonActiveRoles.length > 0) {
        console.log(`[PURGE PRE-CHECK] Safely ignored ${nonActiveRoles.length} historical/orphaned/duplicate/revoked role assignment(s) for resident ${activeRes.gmkId}:`,
          nonActiveRoles.map(r => `• ${r.position} / ${r.committeeStored || 'N/A'} [Status: ${r.lifecycleStatus}] (${r.reason})`)
        );
      }

      if (dependencies.length > 0) {
        setErrorMsg(`PURGE BLOCKED BY GOVERNANCE: Resident ${activeRes.fullName} cannot be purged due to active dependencies:\n` + dependencies.map(d => `• ${d}`).join('\n') + `\n\nPlease prune or reassign these dependencies before attempting to purge.`);
        return;
      }

      setConfirmDeleteResident(activeRes as ResidentProfile);
    } catch (err: any) {
      console.error("Dependency validation failed:", err);
      setErrorMsg("Failed to validate resident dependencies: " + err.message);
    }
  };

  const handleUpdateUserRole = async (targetUser: UserProfile, newRoles: string[]) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      console.log(`🛡️ Elevating roles for users/${targetUser.uid} to ${newRoles}`);
      await setDoc(doc(db, "users", targetUser.uid), {
        ...targetUser,
        roles: newRoles,
      }, { merge: true });
      setSuccessMsg(`User roles successfully elevated for ${targetUser.email}`);
      setEditingUserUid(null);
    } catch (err: any) {
      setErrorMsg(`ROLE ADJUSTMENT FAILURE: ${err.code} - ${err.message}`);
    }
  };

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!eventTitle || !eventDate || !eventVenue) {
      setErrorMsg("VALIDATION ERROR: Title, Date, and Venue are required for all community gatherings.");
      return;
    }

    try {
      const newEventId = `EVENT-${Date.now()}`;
      const year = eventDate ? new Date(eventDate).getFullYear() : new Date().getFullYear();
      const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
      let randomCode = "";
      for (let i = 0; i < 6; i++) {
        randomCode += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      const eventCode = `EVT-${year}-${randomCode}`;

      const payload: CommunityEvent = {
        id: newEventId,
        eventCode: eventCode,
        title: eventTitle.trim(),
        description: eventDesc.trim(),
        date: eventDate,
        venue: eventVenue.trim(),
        organizerEmail: activeEmail,
        attendees: [],
        createdAt: new Date().toISOString()
      };

      await setDoc(doc(db, "events", newEventId), payload);
      setSuccessMsg(`Gathering "${payload.title}" created successfully and synced to Muscat residents.`);
      setEventTitle('');
      setEventDesc('');
      setEventDate('');
      setEventVenue('');
    } catch (err: any) {
      setErrorMsg(`EVENT WRITE CRASH: ${err.code} - ${err.message}`);
    }
  };

  return (
    <div id="super-admin-root" className="min-h-screen bg-[#FAF9F6] text-stone-850 relative">
      {/* Subtle Background Watermark */}
      <div className="fixed inset-0 pointer-events-none z-0 flex items-center justify-center opacity-[0.035] select-none">
        <h1 className="text-9xl font-serif font-black tracking-widest text-[#0F4C2A]">GMK</h1>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 relative z-10 space-y-8">
        
        {/* GMK Master Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between pb-4 gap-4">
          <div className="space-y-1">
            <div className="flex items-center space-x-2.5">
              <span className="text-xs bg-[#FFFDF6] border border-[#D4AF37] text-[#0F4C2A] font-extrabold px-3 py-1 rounded font-sans tracking-wider shadow-xs animate-fadeIn">
                {activeEmail === 'thesadmingmk@gmail.com' ? 'GMK SUPER ADMINISTRATOR' : 'GMK ADMINISTRATOR'}
              </span>
              <span className="text-stone-300">|</span>
              <span className="text-xs text-stone-500 font-sans tracking-tight">{activeEmail}</span>
            </div>
            <h1 className="text-3xl font-serif font-black tracking-tight text-[#0F4C2A] sm:text-4xl">
              GMK GOVERNANCE CONSOLE
            </h1>
            <p className="text-xs text-[#A28114] font-sans leading-none">
              GMK Resident Registry and Governance Assignments
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleExit}
              className="px-4 py-2 bg-[#8C1D18] hover:bg-[#B3261E] text-white text-xs font-extrabold tracking-widest uppercase rounded-md transition-all shadow-md cursor-pointer flex items-center space-x-1 font-sans"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>

        {/* Dynamic Navigation Tabs */}
        <div className="flex flex-wrap items-center gap-2 md:gap-3">
          {(['governance', 'administration', 'log_center', 'system'] as const)
            .filter((tab) => {
              if (tab === 'governance') {
                return activeEmail === 'thesadmingmk@gmail.com';
              }
              return true;
            })
            .map((tab) => {
              const isActive = activeTab === tab;
              return (
                <button
                  key={tab}
                  onClick={() => {
                    setActiveTab(tab);
                    setErrorMsg(null);
                    setSuccessMsg(null);
                  }}
                  className={`flex-1 sm:flex-initial px-5 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all cursor-pointer border text-center shadow-xs font-sans ${
                    isActive
                      ? 'bg-[#0f4c2a] text-white border-[#0f4c2a] shadow-md shadow-emerald-950/15'
                      : 'bg-white text-stone-700 border-stone-200 hover:bg-stone-50 hover:text-stone-900'
                  }`}
                >
                  {tab === 'governance' && "Governance"}
                  {tab === 'administration' && "Administration"}
                  {tab === 'log_center' && "Log Center"}
                  {tab === 'system' && "System Settings"}
                </button>
              );
            })}
        </div>

        {/* Elegant Accent Colored Line */}
        <div className={`h-1.5 w-full rounded-full shadow-sm ${
          activeEmail === 'thesadmingmk@gmail.com'
            ? 'bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-500 shadow-[0_1px_4px_rgba(245,158,11,0.25)]'
            : 'bg-gradient-to-r from-[#0F4C2A] via-emerald-400 to-[#0F4C2A] shadow-[0_1px_4px_rgba(16,185,129,0.25)]'
        }`} />

        {/* Global Success / Warning Alerts */}
        {successMsg && (
          <div className="p-4 bg-emerald-50 border-l-4 border-emerald-500 rounded text-xs font-sans text-[#0F4C2A] flex items-start gap-2.5 animate-fadeIn">
            <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">SUCCESS:</span> {successMsg}
            </div>
          </div>
        )}

        {deletionReport && (
          <div className="bg-stone-50 border border-stone-200 rounded-lg p-4 font-mono text-xs text-stone-700 shadow-xs">
            <div className="flex items-center justify-between border-b border-stone-200 pb-2 mb-2">
              <span className="font-bold text-stone-900">🛡️ GEAS v1.0 VERIFICATION REPORT</span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                deletionReport.status === 'PASSED' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
              }`}>
                STATUS: {deletionReport.status}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-2 text-[11px]">
              <div>Resident ID: <span className="font-bold text-stone-900">{deletionReport.residentId}</span></div>
              <div>Email: <span className="font-bold text-stone-900">{deletionReport.email || 'N/A'}</span></div>
              <div>Timestamp: <span className="text-stone-500">{deletionReport.timestamp}</span></div>
            </div>
            <div className="border-t border-stone-150 pt-2 grid grid-cols-1 md:grid-cols-3 gap-x-4 gap-y-1 text-[11px]">
              <div>Residents Remaining: <span className="font-bold">{deletionReport.details.residentsLeft}</span></div>
              <div>Families Remaining: <span className="font-bold">{deletionReport.details.familiesLeft}</span></div>
              <div>Family Members Remaining: <span className="font-bold">{deletionReport.details.familyMembersLeft}</span></div>
              <div>Role Assignments Remaining: <span className="font-bold">{deletionReport.details.roleAssignmentsLeft}</span></div>
              <div>Governance Assignments Remaining: <span className="font-bold">{deletionReport.details.governanceAssignmentsLeft}</span></div>
              <div>Event Committees Remaining: <span className="font-bold">{deletionReport.details.eventCommitteesLeft}</span></div>
              <div>Event Programs Remaining: <span className="font-bold">{deletionReport.details.eventProgramsLeft}</span></div>
              <div>Event Registrations Remaining: <span className="font-bold">{deletionReport.details.eventRegistrationsLeft}</span></div>
              <div>Event Attendance Remaining: <span className="font-bold">{deletionReport.details.eventAttendanceLeft}</span></div>
              <div>Event Food Remaining: <span className="font-bold">{deletionReport.details.eventFoodLeft}</span></div>
            </div>
            {deletionReport.failures.length > 0 && (
              <div className="mt-2 pt-2 border-t border-red-150 text-red-700 text-[11px]">
                <div className="font-bold">FAILURES DETECTED:</div>
                <ul className="list-disc pl-4 mt-1">
                  {deletionReport.failures.map((f: string, i: number) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {errorMsg && (
          <div className="p-4 bg-red-50 border-l-4 border-red-500 rounded text-xs font-sans text-red-700 flex items-start gap-2.5 animate-fadeIn">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">ERROR:</span> {errorMsg}
            </div>
          </div>
        )}

        {/* Dynamic Tab Renderings */}
        {activeTab === 'home' && (
          <div className="space-y-6">
            <div className="border-b border-stone-200 pb-4">
              <h2 className="text-2xl font-serif text-[#0F4C2A] font-bold">GMK Governance Console</h2>
              <p className="text-xs text-stone-500 font-mono">Community governance dashboard & audit logs</p>
            </div>

            {/* Statistics Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">


              <GMKCard className="p-5 border border-stone-200/85 bg-white">
                <div className="space-y-1">
                  <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-emerald-600">Active Residents</span>
                  <div className="text-3xl font-serif font-bold text-[#0F4C2A]">
                    {residents.filter(r => r.status === 'active').length}
                  </div>
                  <p className="text-[10px] text-stone-400 font-sans">Approved verified residents</p>
                </div>
              </GMKCard>

              <GMKCard className="p-5 border border-stone-200/85 bg-white">
                <div className="space-y-1">
                  <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-stone-500">Archived Residents</span>
                  <div className="text-3xl font-serif font-bold text-stone-600">
                    {residents.filter(r => r.status === 'archived').length}
                  </div>
                  <p className="text-[10px] text-stone-400 font-sans">Historic/expired profiles</p>
                </div>
              </GMKCard>

              <GMKCard className="p-5 border border-[#D4AF37]/35 bg-[#FFFDF6]">
                <div className="space-y-1">
                  <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-[#D4AF37]">Active Admins</span>
                  <div className="text-3xl font-serif font-bold text-[#0F4C2A]">
                    {roleAssignments.filter(ra => ra.position === 'admin').length}
                  </div>
                  <p className="text-[9.5px] text-stone-500 font-sans leading-snug">
                    Holders: {roleAssignments.filter(ra => ra.position === 'admin').map(ra => {
                      const r = residents.find(res => res.gmkId === ra.gmkId);
                      return r ? r.fullName : ra.email;
                    }).join(', ') || 'None'}
                  </p>
                </div>
              </GMKCard>

              <GMKCard className="p-5 border border-[#D4AF37]/35 bg-white">
                <div className="space-y-1">
                  <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-[#D4AF37]">Active President</span>
                  <div className="text-3xl font-serif font-bold text-[#0F4C2A]">
                    {roleAssignments.filter(ra => ra.position === 'president').length}
                  </div>
                  <p className="text-[9.5px] text-stone-500 font-sans">
                    Holder: <strong className="text-stone-850">
                      {(() => {
                        const ra = roleAssignments.find(ra => ra.position === 'president');
                        if (!ra) return 'None';
                        const r = residents.find(res => res.gmkId === ra.gmkId);
                        return r ? r.fullName : ra.email;
                      })()}
                    </strong>
                  </p>
                </div>
              </GMKCard>

              <GMKCard className="p-5 border border-[#D4AF37]/35 bg-white">
                <div className="space-y-1">
                  <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-[#D4AF37]">Active Vice President</span>
                  <div className="text-3xl font-serif font-bold text-[#0F4C2A]">
                    {roleAssignments.filter(ra => ra.position === 'vp').length}
                  </div>
                  <p className="text-[9.5px] text-stone-500 font-sans">
                    Holder: <strong className="text-stone-850">
                      {(() => {
                        const ra = roleAssignments.find(ra => ra.position === 'vp');
                        if (!ra) return 'None';
                        const r = residents.find(res => res.gmkId === ra.gmkId);
                        return r ? r.fullName : ra.email;
                      })()}
                    </strong>
                  </p>
                </div>
              </GMKCard>

              <GMKCard className="p-5 border border-[#D4AF37]/35 bg-white">
                <div className="space-y-1">
                  <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-[#D4AF37]">Verified Residents</span>
                  <div className="text-3xl font-serif font-bold text-[#0F4C2A]">
                    {residents.filter(r => r.status === 'active').length}
                  </div>
                  <p className="text-[9.5px] text-stone-500 font-sans">
                    Active Household Registry Count
                  </p>
                </div>
              </GMKCard>
            </div>
          </div>
        )}

        {/* 2. GOVERNANCE TAB */}
        {activeTab === 'governance' && activeEmail === 'thesadmingmk@gmail.com' && (
          <div className="space-y-6">
            <div className="border-b border-stone-200 pb-4">
              <h2 className="text-2xl font-serif text-[#0F4C2A] font-bold">Governance Management</h2>
              <p className="text-xs text-stone-500 font-sans mt-1">Assign and revoke leadership and administrative privileges</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Assign Governance Role Component */}
              <div className="bg-white border border-stone-200 rounded-lg p-5 shadow-sm space-y-4">
                <div className="flex items-center space-x-2 pb-2 border-b border-stone-100">
                  <UserCheck className="w-5 h-5 text-[#0F4C2A]" />
                  <h3 className="text-sm font-bold uppercase tracking-wider font-sans text-[#0F4C2A]">Assign Governance Role</h3>
                </div>

                <div className="space-y-4 font-sans text-xs">
                  <div className="relative">
                    <label className="block text-[10px] uppercase text-stone-500 tracking-wider font-bold mb-1">Search Resident</label>
                    <div className="relative">
                      <input
                        type="text"
                        value={govSearchQuery}
                        onChange={(e) => {
                          setGovSearchQuery(e.target.value);
                          if (govTargetGmkId) {
                            setGovTargetGmkId('');
                          }
                        }}
                        placeholder="Search by Name, GMK-ID, Mobile Number, or Unit..."
                        className="w-full border border-stone-200 rounded px-2.5 py-2 bg-white text-stone-900 font-sans text-xs focus:ring-1 focus:ring-[#0F4C2A] focus:outline-none"
                      />
                      {govSearchQuery && (
                        <button
                          type="button"
                          onClick={() => {
                            setGovSearchQuery('');
                            setGovTargetGmkId('');
                          }}
                          className="absolute right-2 top-2 text-stone-400 hover:text-stone-700 text-xs font-bold font-sans"
                        >
                          Clear
                        </button>
                      )}
                    </div>

                    {/* Search Results Dropdown Selector */}
                    {govSearchQuery && !govTargetGmkId && (() => {
                      const searchLower = govSearchQuery.toLowerCase().trim();
                      const matchedResidents = searchLower ? residents.filter(r => {
                        if (r.status !== 'active') return false;
                        const matchesName = r.fullName?.toLowerCase().includes(searchLower);
                        const matchesGmk = r.gmkId?.toLowerCase().includes(searchLower);
                        const matchesPhone = r.phone?.toLowerCase().includes(searchLower);
                        const matchesUnit = r.displayUnitNumber?.toLowerCase().includes(searchLower);
                        return matchesName || matchesGmk || matchesPhone || matchesUnit;
                      }) : [];

                      return (
                        <div className="mt-1 border border-stone-200 bg-white rounded shadow-lg max-h-48 overflow-y-auto absolute z-50 left-0 right-0 w-full animate-fadeIn">
                          {matchedResidents.length === 0 ? (
                            <div className="p-3 text-stone-500 italic text-[11px] bg-stone-50 font-sans">
                              No matching active residents found.
                            </div>
                          ) : (
                            matchedResidents.slice(0, 10).map(r => {
                              const existingAssignment = govAssignments.find(ga => ga.gmkId === r.gmkId);
                              const isAssigned = !!existingAssignment;
                              return (
                                <div
                                  key={r.gmkId}
                                  onClick={() => {
                                    if (isAssigned) return; // Inactive to select
                                    setGovTargetGmkId(r.gmkId);
                                    setGovSearchQuery(r.fullName);
                                  }}
                                  className={`p-2.5 text-left border-b border-stone-100 last:border-b-0 font-sans text-[11px] leading-snug animate-fadeIn transition-colors ${
                                    isAssigned
                                      ? 'bg-stone-50 text-stone-400 cursor-not-allowed'
                                      : 'bg-white hover:bg-stone-50 hover:text-[#0F4C2A] cursor-pointer'
                                  }`}
                                >
                                  <div className={`font-bold ${isAssigned ? 'text-stone-400' : 'text-stone-850'}`}>
                                    {r.fullName}
                                    {isAssigned && (
                                      <span className="text-[10px] font-normal text-amber-650 italic ml-1.5 bg-amber-50 px-1 py-0.2 rounded border border-amber-100 font-sans uppercase">
                                        {existingAssignment.position === 'admin' ? 'Admin' : existingAssignment.position === 'president' ? 'President' : existingAssignment.position === 'vp' ? 'Vice President' : existingAssignment.position === 'event_director' ? 'Event Director' : existingAssignment.position} Assigned
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[10px] text-stone-500 font-sans flex items-center gap-1.5 mt-0.5">
                                    <span className={`font-bold px-1 rounded text-[9px] ${isAssigned ? 'bg-stone-200 text-stone-500' : 'bg-emerald-50 text-[#0F4C2A]'}`}>{r.gmkId}</span>
                                    <span>Unit: {r.displayUnitNumber}</span>
                                    <span>• Phone: {formatPhoneWithCountryCode(r.phone)}</span>
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      );
                    })()}

                    {/* Selected Resident Card */}
                    {govTargetGmkId && (() => {
                      const selectedRes = residents.find(r => r.gmkId === govTargetGmkId);
                      if (!selectedRes) return null;
                      return (
                        <div className="bg-emerald-55/40 border border-emerald-100 rounded-lg p-3 space-y-2 mt-2.5 animate-fadeIn font-sans text-xs">
                          <div className="flex justify-between items-start">
                            <div>
                              <div className="font-bold text-[#0F4C2A] text-xs leading-none">{selectedRes.fullName}</div>
                              <div className="text-[10px] text-[#A28114] font-semibold mt-1 font-sans">ACTIVE HOUSEHOLD ASSIGNED</div>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                  setGovTargetGmkId('');
                                  setGovSearchQuery('');
                              }}
                              className="text-[10px] text-red-650 font-bold uppercase hover:underline cursor-pointer"
                            >
                              Deselect
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[10px] pt-1.5 border-t border-emerald-100/60 font-sans text-stone-600">
                            <div>ID: <span className="font-bold text-stone-800">{selectedRes.gmkId}</span></div>
                            <div>Unit: <span className="font-bold text-stone-800">{selectedRes.displayUnitNumber}</span></div>
                            <div>Phone: <span className="font-bold text-stone-800">{formatPhoneWithCountryCode(selectedRes.phone)}</span></div>
                            <div>Development: <span className="font-bold text-stone-800">{normalizeGatedCommunity(selectedRes.gatedCommunity)}</span></div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase text-stone-500 tracking-wider font-bold mb-1">Select Role</label>
                    <select
                      value={govTargetRole}
                      onChange={(e) => setGovTargetRole(e.target.value as any)}
                      className="w-full border border-stone-200 rounded px-2.5 py-1.5 bg-white text-stone-900 focus:ring-1 focus:ring-[#0F4C2A] focus:outline-none font-sans text-xs"
                    >
                      <option value="">-Select Role-</option>
                      <option value="admin" disabled={roleAssignments.some(ra => ra.position === 'admin')}>
                        Administrator
                      </option>
                      <option value="president" disabled={roleAssignments.some(ra => ra.position === 'president')}>
                        President
                      </option>
                      <option value="vp" disabled={roleAssignments.some(ra => ra.position === 'vp')}>
                        Vice President
                      </option>
                      <option value="event_director" disabled={roleAssignments.some(ra => ra.position === 'event_director')}>
                        Event Director
                      </option>
                    </select>
                  </div>


                  <button
                    onClick={async () => {
                      if (!govTargetGmkId) {
                        setErrorMsg('Please select an active resident holder first.');
                        return;
                      }
                      if (!govTargetRole) {
                        setErrorMsg('Please select a valid governance role.');
                        return;
                      }
                      const res = residents.find(r => r.gmkId === govTargetGmkId);
                      if (!res) return;
                      await handleToggleResidentRole(res.gmkId, res.email, govTargetRole, false);
                      setGovTargetRole('');
                      setGovTargetGmkId('');
                      setGovSearchQuery('');
                    }}
                    className="w-full py-2 bg-[#0F4C2A] hover:bg-[#082917] text-white font-bold uppercase tracking-widest text-[11px] rounded transition-all cursor-pointer shadow-sm font-sans"
                  >
                    AUTHORIZE GOVERNANCE ROLE
                  </button>
                </div>
              </div>

              {/* Active Positions Status */}
              <div className="lg:col-span-2 space-y-4 font-sans">
                <span className="text-xs font-sans font-bold text-stone-500 uppercase tracking-widest">Current Governance Assignments</span>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {(['admin', 'president', 'vp', 'event_director'] as const).map(roleKey => {
                    const assigned = roleAssignments.filter(ra => ra.position === roleKey);
                    
                    return (
                      <div key={roleKey} className="bg-white border border-stone-200 rounded-lg p-4 shadow-sm space-y-3">
                        <div className="flex justify-between items-center border-b border-stone-100 pb-1.5 font-sans">
                          <span className="text-xs font-sans font-bold text-[#0F4C2A] uppercase">
                            {roleKey === 'admin' ? 'Administrator' : roleKey === 'president' ? 'President' : roleKey === 'vp' ? 'Vice President' : 'Event Director'}
                          </span>
                          <span className="text-[9px] font-sans bg-stone-100 border border-stone-250 text-stone-600 px-1.5 py-0.5 rounded uppercase font-bold">
                            {roleKey === 'event_director' ? 'Level-2' : 'Level-1'}
                          </span>
                        </div>

                        <div className="space-y-2 font-sans">
                          {assigned.length === 0 ? (
                            <p className="text-xs italic text-stone-400 font-sans py-1">Unassigned Position</p>
                          ) : (
                            assigned.map(ra => {
                              const r = residents.find(res => res.gmkId === ra.gmkId);
                              return (
                                <div key={ra.id} className="flex justify-between items-center gap-1 text-xs font-sans bg-stone-50/60 p-2 border border-stone-150 rounded">
                                  <div>
                                    <p className="font-bold text-stone-900 font-sans text-xs">{r ? r.fullName : 'System Resident'}</p>
                                    <p className="text-[10px] text-stone-400 font-sans">GMK-ID: {ra.gmkId} • {r ? r.displayUnitNumber : ''}</p>
                                  </div>
                                  <button
                                    onClick={() => handleToggleResidentRole(ra.gmkId, ra.email, roleKey, true)}
                                    className="p-1 px-2 text-[9px] font-extrabold uppercase bg-red-50 text-red-600 hover:bg-red-600 hover:text-white border border-red-200 rounded cursor-pointer transition-all animate-fadeIn font-sans"
                                    title="Revoke / Dismiss assignment"
                                  >
                                    Revoke
                                  </button>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 3. ADMINISTRATION TAB */}
        {activeTab === 'administration' && (
          <div className="space-y-4">
            <div className="bg-emerald-50 border border-emerald-100 p-3.5 rounded-lg">
              <span className="text-xs font-sans font-extrabold text-[#0F4C2A] uppercase tracking-wider flex items-center gap-1.5 font-bold">
                <ShieldCheck className="w-4 h-4 text-[#0F4C2A]" />
                Resident Administration Portal
              </span>
              <p className="text-[11px] text-[#0f4c2a]/80 mt-1 font-sans leading-relaxed">
                You are currently accessing the Resident Administration Portal with an Active Administration Session.
              </p>
            </div>
            
            {/* Direct injection of AdminDashboard */}
            <AdminDashboard activeEmail={activeEmail} isEmergency={false} hideHeaderAndTabs={true} />
          </div>
        )}

        {/* 4. SYSTEM TAB */}
        {activeTab === 'system' && (
          <div className="space-y-6">
            <div className="border-b border-[#0F4C2A]/10 pb-4">
              <h2 className="text-2xl font-serif text-[#0F4C2A] font-bold">SYSTEM INFORMATION</h2>
              <p className="text-xs text-stone-500 font-sans">Platform and database service indicators</p>
            </div>

            <div className="space-y-6" id="system-settings-workspace">
              {/* Platform Indicators Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white border border-stone-200 p-4 rounded-lg shadow-sm space-y-1.5 animate-fadeIn">
                  <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-stone-500">Platform Version</span>
                  <div className="text-sm font-sans font-bold text-[#0F4C2A]">v1.12.0 (Stable)</div>
                </div>

                <div className="bg-white border border-stone-200 p-4 rounded-lg shadow-sm space-y-1.5 animate-fadeIn">
                  <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-stone-500">Firebase Authentication Status</span>
                  <div className="text-sm font-sans font-bold text-[#0F4C2A]">Active / Connected</div>
                </div>

                <div className="bg-white border border-stone-200 p-4 rounded-lg shadow-sm space-y-1.5 animate-fadeIn">
                  <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-stone-500">Firestore Status</span>
                  <div className="text-sm font-sans font-bold text-[#0F4C2A]">Active / Operational</div>
                </div>

                <div className="bg-white border border-stone-200 p-4 rounded-lg shadow-sm space-y-1.5 animate-fadeIn">
                  <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-stone-500">Last Deployment Date</span>
                  <div className="text-sm font-sans font-bold text-stone-900">2026-06-24</div>
                </div>

                <div className="bg-white border border-stone-200 p-4 rounded-lg shadow-sm space-y-1.5 animate-fadeIn">
                  <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-stone-500">Total Residents</span>
                  <div className="text-sm font-sans font-bold text-[#0F4C2A]">{residents.length}</div>
                </div>

                <div className="bg-white border border-stone-200 p-4 rounded-lg shadow-sm space-y-1.5 animate-fadeIn">
                  <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-stone-500">Total Administrators</span>
                  <div className="text-sm font-sans font-bold text-[#0F4C2A]">{roleAssignments.filter(ra => ra.position === 'admin').length}</div>
                </div>

                <div className="bg-white border border-stone-200 p-4 rounded-lg shadow-sm space-y-1.5 animate-fadeIn">
                  <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-stone-500">President Assigned</span>
                  <div className="text-sm font-sans font-bold text-[#0F4C2A]">
                    {roleAssignments.find(ra => ra.position === 'president')
                      ? (residents.find(res => res.gmkId === roleAssignments.find(ra => ra.position === 'president')?.gmkId)?.fullName || roleAssignments.find(ra => ra.position === 'president')?.email)
                      : 'None Assigned'}
                  </div>
                </div>

                <div className="bg-white border border-stone-200 p-4 rounded-lg shadow-sm space-y-1.5 animate-fadeIn">
                  <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-stone-500">Vice President Assigned</span>
                  <div className="text-sm font-sans font-bold text-[#0F4C2A]">
                    {roleAssignments.find(ra => ra.position === 'vp')
                      ? (residents.find(res => res.gmkId === roleAssignments.find(ra => ra.position === 'vp')?.gmkId)?.fullName || roleAssignments.find(ra => ra.position === 'vp')?.email)
                      : 'None Assigned'}
                  </div>
                </div>
              </div>

              {/* Database Integrity & Duplicate Resolution Panel */}
              <div className="bg-white border border-stone-200 p-5 rounded-lg shadow-sm space-y-4 animate-fadeIn">
                <div className="border-b border-stone-100 pb-3 flex justify-between items-center text-xs font-mono font-bold text-stone-600 uppercase tracking-wider">
                  <span className="flex items-center gap-1.5 font-sans">
                    <Activity className="w-4 h-4 text-[#0f4c2a]" />
                    <span>Database Integrity & Repair Unit</span>
                  </span>
                  <span className="text-stone-400 font-sans font-normal text-[11px] hidden sm:inline">
                    Scans active resident records for duplicate flats or identities
                  </span>
                </div>

                {getDuplicateResidentSets().length === 0 ? (
                  <div className="bg-emerald-50/50 border border-emerald-150 rounded-2xl p-4 flex items-center gap-3 animate-fadeIn">
                    <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />
                    <div>
                      <div className="text-xs font-bold text-[#0F4C2A]">Database Integrity: HEALTHY</div>
                      <p className="text-[10.5px] text-stone-500 mt-0.5 leading-snug">No duplicate resident identities or multiple assignments detected for the same residential unit.</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="bg-amber-50/70 border border-amber-200/80 rounded-2xl p-4 flex items-start gap-3 animate-fadeIn">
                      <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5 animate-pulse" />
                      <div>
                        <div className="text-xs font-bold text-amber-800">DATA ANOMALY: MULTIPLE RESIDENT IDENTITIES DETECTED</div>
                        <p className="text-[10.5px] text-amber-900 mt-0.5 leading-snug">
                          The system has identified active flats mapped to more than one active GMK Resident Code. You can safely delete the erroneous duplicates below without disrupting the primary registration.
                        </p>
                      </div>
                    </div>

                    <div className="border border-stone-150 rounded-2xl overflow-hidden divide-y divide-stone-100 text-xs">
                      {getDuplicateResidentSets().map((set) => (
                        <div key={set.unitKey} className="p-4 bg-stone-50/45 hover:bg-stone-50/80 transition-colors flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                          <div className="space-y-1.5">
                            <div className="font-extrabold text-[#0F4C2A] font-serif flex items-center gap-2">
                              <span>Unit {set.displayUnitNumber}</span>
                              <span className="text-[9.5px] font-mono font-normal bg-stone-100 text-stone-500 border border-stone-200 rounded-md px-1.5 py-0.2 shrink-0">
                                {set.unitKey}
                              </span>
                            </div>
                            <div className="text-[11px] text-stone-600">
                              Primary Email: <span className="font-mono font-bold text-stone-800">{set.email}</span>
                            </div>
                            <div className="flex flex-wrap gap-2 pt-1">
                              {set.records.map((rec, idx) => (
                                <div key={rec.gmkId} className={`px-2 py-1 rounded-lg border text-[10.5px] flex items-center gap-1.5 ${idx === 0 ? 'bg-emerald-50/60 border-emerald-250 text-[#0F4C2A]' : 'bg-rose-50/50 border-rose-150 text-rose-700'}`}>
                                  <span className="font-bold">{rec.gmkId}</span>
                                  <span className="opacity-90">{rec.fullName}</span>
                                  {idx === 0 ? (
                                    <span className="text-[8px] bg-emerald-600 text-white rounded px-1 font-bold uppercase tracking-wider scale-90 text-[7.5px]">Original/Keep</span>
                                  ) : (
                                    <span className="text-[8px] bg-rose-600 text-white rounded px-1 font-bold uppercase tracking-wider scale-90 text-[7.5px]">Duplicate/Delete</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="flex items-center shrink-0">
                            <button
                              disabled={cleaningId !== null}
                              onClick={() => handleDeduplicate(set)}
                              className="w-full md:w-auto inline-flex items-center justify-center space-x-1.5 py-2 px-3 border border-red-200 bg-red-50 hover:bg-red-100 hover:border-red-300 text-red-700 text-xs font-bold rounded-xl cursor-pointer shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>{cleaningId === set.unitKey ? 'Deleting in progress...' : 'Delete Duplicates'}</span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Database Cascade Integrity & GEAS v1.0 Compliance & Certification Tool */}
              <div className="bg-white border border-stone-200 p-6 rounded-3xl shadow-sm space-y-5 animate-fadeIn">
                <div className="border-b border-stone-150 pb-4 flex flex-wrap justify-between items-center gap-3">
                  <div>
                    <h3 className="text-sm font-black text-stone-900 uppercase tracking-wider flex items-center gap-2">
                      <ShieldCheck className="w-5 h-5 text-emerald-600" />
                      <span>GEAS v1.0 Compliance & Identity Audit Center</span>
                    </h3>
                    <p className="text-[11px] text-stone-500 font-medium font-sans mt-0.5">
                      Ensuring GMK Rule #001: Operational modules shall never permanently own Resident Identity.
                    </p>
                  </div>
                  {geasReport && (
                    <div className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border shadow-sm ${
                      geasReport.certified 
                        ? 'bg-emerald-50 border-emerald-250 text-emerald-800 animate-pulse' 
                        : 'bg-rose-50 border-rose-250 text-rose-800 animate-bounce'
                    }`}>
                      {geasReport.certified ? '🛡️ Platform Integrity: PASS' : '⚠️ GEAS Drift Warning'}
                    </div>
                  )}
                </div>

                <p className="text-stone-600 text-[11px] leading-relaxed font-semibold">
                  This engine performs a multi-dimensional recursive integrity scan across every operational collection, document, nested map, and array within the Firestore database to detect identity drift, broken relationships, or orphaned registration states.
                </p>

                {/* Status and Actions */}
                <div className="flex flex-wrap items-center gap-3.5 pt-1">
                  <button
                    type="button"
                    disabled={dbScanStatus === 'scanning' || isRepairing}
                    onClick={handleScanDatabaseIntegrity}
                    className="inline-flex items-center gap-2 py-2.5 px-5 bg-[#0F4C2A] hover:bg-[#0c3d21] disabled:bg-stone-300 text-white rounded-xl text-xs font-black shadow-sm transition-all cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${dbScanStatus === 'scanning' ? 'animate-spin' : ''}`} />
                    <span>{dbScanStatus === 'scanning' ? 'Running GEAS Audit...' : 'Run Enterprise GEAS Audit'}</span>
                  </button>

                  {geasReport && geasReport.anomalies.length > 0 && (
                    <button
                      type="button"
                      disabled={isRepairing}
                      onClick={handleHealDatabaseIntegrity}
                      className="inline-flex items-center gap-2 py-2.5 px-5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-black shadow-sm transition-all cursor-pointer"
                    >
                      <Wrench className="w-3.5 h-3.5" />
                      <span>{isRepairing ? 'Healing Database...' : 'Run One-Click Self-Healing'}</span>
                    </button>
                  )}
                </div>

                {/* Scan Results Panel */}
                {geasReport && (
                  <div className="space-y-5 animate-fadeIn">
                    {/* Metrics Bento Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3.5">
                      <div className="p-3.5 bg-stone-50 border border-stone-200 rounded-2xl flex flex-col justify-between">
                        <span className="text-[9px] text-stone-500 font-extrabold uppercase tracking-widest block">Collections</span>
                        <div>
                          <strong className="text-base font-black text-stone-900">{geasReport.collectionsScanned}</strong>
                          <span className="text-[10px] text-stone-400 font-bold ml-1">/ {geasReport.totalCollections}</span>
                        </div>
                      </div>
                      <div className="p-3.5 bg-stone-50 border border-stone-200 rounded-2xl flex flex-col justify-between">
                        <span className="text-[9px] text-stone-500 font-extrabold uppercase tracking-widest block">Traced Refs</span>
                        <strong className="text-base font-black text-stone-900">{geasReport.totalReferences}</strong>
                      </div>
                      <div className="p-3.5 bg-emerald-50/40 border border-emerald-150 rounded-2xl flex flex-col justify-between">
                        <span className="text-[9px] text-emerald-700 font-extrabold uppercase tracking-widest block">Compliant</span>
                        <strong className="text-base font-black text-emerald-800">{geasReport.healthyCount}</strong>
                      </div>
                      <div className="p-3.5 bg-amber-50/50 border border-amber-150 rounded-2xl flex flex-col justify-between">
                        <span className="text-[9px] text-amber-700 font-extrabold uppercase tracking-widest block">Identity Drift</span>
                        <strong className="text-base font-black text-amber-800">{geasReport.warningsCount}</strong>
                      </div>
                      <div className="p-3.5 bg-red-50/50 border border-red-150 rounded-2xl flex flex-col justify-between">
                        <span className="text-[9px] text-red-700 font-extrabold uppercase tracking-widest block">Critical Orphans</span>
                        <strong className={`text-base font-black ${geasReport.criticalCount > 0 ? 'text-red-700 animate-pulse' : 'text-stone-900'}`}>{geasReport.criticalCount}</strong>
                      </div>
                    </div>

                    {/* Certifier Stamp */}
                    {geasReport.certified && geasReport.criticalCount === 0 && (
                      <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-2xl flex items-start gap-3.5">
                        <div className="p-2 bg-emerald-100 rounded-xl text-[#0F4C2A]">
                          <ShieldCheck className="w-5 h-5" />
                        </div>
                        <div>
                          <h4 className="text-xs font-black text-[#0f4c2a] uppercase tracking-wide">Pristine Zero-Drift Certified</h4>
                          <p className="text-[11px] text-[#0f4c2a] mt-0.5 leading-relaxed font-semibold">
                            All database collections fully comply with Greens Malayalee Koottayma (GMK) Enterprise Architecture Standards (GEAS) v1.0. No unauthorized, orphaned, or unmapped identity drift is present in active operational collections.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Detailed Diagnostics Table */}
                    {geasReport.anomalies.length > 0 && (
                      <div className="space-y-2">
                        <h4 className="text-[10px] font-black text-stone-500 uppercase tracking-widest">Active Database Anomaly Diagnostic Feed</h4>
                        <div className="border border-stone-200 rounded-2xl overflow-hidden bg-white shadow-sm max-h-72 overflow-y-auto">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="bg-stone-50 border-b border-stone-150 text-[9.5px] font-bold text-stone-500 uppercase font-mono">
                                <th className="p-3">Severity</th>
                                <th className="p-3">Collection</th>
                                <th className="p-3">Document ID</th>
                                <th className="p-3">Field Reference</th>
                                <th className="p-3">Value</th>
                                <th className="p-3">Diagnostic Reason</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-stone-100 text-[11px] font-medium text-stone-600">
                              {geasReport.anomalies.map((an, index) => (
                                <tr key={an.id || index} className="hover:bg-stone-50/60 font-sans">
                                  <td className="p-3">
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${
                                      an.severity === 'Critical' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-amber-50 text-amber-700 border border-amber-200'
                                    }`}>
                                      {an.severity}
                                    </span>
                                  </td>
                                  <td className="p-3 font-mono text-[10px] font-bold">{an.collection}</td>
                                  <td className="p-3 font-mono text-[10px] text-stone-500">{an.docId}</td>
                                  <td className="p-3 font-mono text-[10px] text-stone-500">{an.field}</td>
                                  <td className="p-3 font-mono text-[10px] text-stone-800">{an.value}</td>
                                  <td className="p-3 text-stone-600 leading-snug">{an.reason}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Dynamic Dependency Graph Section */}
                    {Object.keys(geasReport.dependencyGraph).length > 0 && (
                      <div className="bg-stone-50/50 border border-stone-200 rounded-2xl p-4 space-y-2">
                        <span className="text-[9.5px] font-black uppercase tracking-widest text-stone-500 block">
                          🕸️ Automated Identity Dependency Graph (Trace Chain)
                        </span>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {Object.entries(geasReport.dependencyGraph).map(([gmkId, references]) => (
                            <div key={gmkId} className="bg-white border border-stone-150 p-3 rounded-xl space-y-1.5 shadow-sm">
                              <span className="text-[10px] font-mono font-bold text-red-700 flex items-center gap-1">
                                <span className="inline-block w-2 h-2 rounded-full bg-red-600 animate-ping" />
                                Orphan Resident ID: {gmkId}
                              </span>
                              <div className="space-y-1 pl-3 border-l-2 border-stone-200 text-[10px] font-mono text-stone-500">
                                {(references as string[]).map((ref, idx) => (
                                  <div key={idx} className="truncate">
                                    ↳ {ref}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {repairMsg && (
                  <div className={`p-3.5 border rounded-2xl text-xs font-bold leading-relaxed ${repairMsg.includes('❌') ? 'bg-red-50 border-red-150 text-red-700' : 'bg-emerald-50 border-emerald-150 text-[#0f4c2a]'}`}>
                    {repairMsg}
                  </div>
                )}
              </div>

              {/* Targeted Resident ID & Email Mapping Doctor */}
              <div className="bg-white border border-stone-200 p-5 rounded-3xl shadow-sm space-y-4 animate-fadeIn">
                <div className="border-b border-stone-100 pb-3 flex justify-between items-center text-xs font-mono font-bold text-stone-600 uppercase tracking-wider">
                  <span className="flex items-center gap-1.5 font-sans">
                    <UserCheck className="w-4 h-4 text-emerald-600" />
                    <span>Targeted Resident ID & Email Mapping Doctor</span>
                  </span>
                  <span className="text-emerald-600 font-sans font-normal text-[11px] hidden sm:inline">
                    Interactive identity matcher and re-mapping clinic
                  </span>
                </div>

                <div className="bg-amber-50/50 border border-amber-150 rounded-2xl p-3.5 space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800 block">💡 Tester Quick Start</span>
                  <p className="text-stone-600 text-[11px] font-semibold leading-relaxed">
                    You do <strong>not</strong> need a Resident ID. You can diagnose mappings with just a partial email address, phone number, name, or unit number. The Mapping Doctor will automatically query Firestore and check if any duplicate entries or matching user/registration records exist!
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3 pb-2">
                  <div className="space-y-1">
                    <label className="text-[10px] font-extrabold text-stone-500 uppercase tracking-wider block">Full/Partial Name</label>
                    <input
                      type="text"
                      value={diagName}
                      onChange={(e) => setDiagName(e.target.value)}
                      placeholder="e.g. Anand"
                      className="w-full text-xs font-semibold px-3 py-2 border border-stone-200 rounded-xl focus:ring-1 focus:ring-[#0f4c2a] focus:border-[#0f4c2a] outline-none bg-stone-50/40"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-extrabold text-stone-500 uppercase tracking-wider block">Email Address</label>
                    <input
                      type="text"
                      value={diagEmail}
                      onChange={(e) => setDiagEmail(e.target.value)}
                      placeholder="e.g. way2anand"
                      className="w-full text-xs font-semibold px-3 py-2 border border-stone-200 rounded-xl focus:ring-1 focus:ring-[#0f4c2a] focus:border-[#0f4c2a] outline-none bg-stone-50/40"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-extrabold text-stone-500 uppercase tracking-wider block">Phone Number</label>
                    <input
                      type="text"
                      value={diagPhone}
                      onChange={(e) => setDiagPhone(e.target.value)}
                      placeholder="e.g. 966"
                      className="w-full text-xs font-semibold px-3 py-2 border border-stone-200 rounded-xl focus:ring-1 focus:ring-[#0f4c2a] focus:border-[#0f4c2a] outline-none bg-stone-50/40"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-extrabold text-stone-500 uppercase tracking-wider block">Unit Number</label>
                    <input
                      type="text"
                      value={diagUnit}
                      onChange={(e) => setDiagUnit(e.target.value)}
                      placeholder="e.g. 1010"
                      className="w-full text-xs font-semibold px-3 py-2 border border-stone-200 rounded-xl focus:ring-1 focus:ring-[#0f4c2a] focus:border-[#0f4c2a] outline-none bg-stone-50/40"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-extrabold text-stone-500 uppercase tracking-wider block">Resident ID (Optional)</label>
                    <input
                      type="text"
                      value={diagGmkId}
                      onChange={(e) => setDiagGmkId(e.target.value)}
                      placeholder="e.g. GMK-1005"
                      className="w-full text-xs font-semibold px-3 py-2 border border-stone-200 rounded-xl focus:ring-1 focus:ring-[#0f4c2a] focus:border-[#0f4c2a] outline-none bg-stone-50/40"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    disabled={isDiagChecking || isDiagRepairing}
                    onClick={handleCheckDiagMapping}
                    className="inline-flex items-center gap-2 py-2 px-5 bg-[#0f4c2a] hover:bg-[#0a331c] text-white rounded-xl text-xs font-extrabold shadow-sm hover:shadow transition-all cursor-pointer disabled:opacity-50"
                  >
                    <Search className={`w-3.5 h-3.5 ${isDiagChecking ? 'animate-spin' : ''}`} />
                    <span>{isDiagChecking ? 'Running Integrity Check...' : 'Scan & Diagnose All Mappings'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleResetDiagMapping}
                    className="inline-flex items-center gap-2 py-2 px-5 bg-stone-200 hover:bg-stone-300 text-stone-800 rounded-xl text-xs font-bold transition-all cursor-pointer"
                  >
                    Reset Clinic & Filters
                  </button>
                </div>

                {/* Diagnostics Results */}
                {diagResult && (
                  <div className="border border-stone-200 bg-stone-50/40 rounded-2xl p-4 space-y-4 animate-fadeIn text-xs">
                    <div className="flex justify-between items-center border-b border-stone-150 pb-2">
                      <h4 className="text-xs font-extrabold text-stone-900 uppercase tracking-wide">Diagnostic Scan Findings</h4>
                      <span className="text-[10px] bg-[#0f4c2a]/10 text-[#0f4c2a] px-2.5 py-0.5 rounded-full font-bold">
                        {diagResult.detectedAnomalies.length} Anomalies Found
                      </span>
                    </div>
                    
                    {/* Actionable Mapping Anomalies / Orphans */}
                    <div>
                      <span className="font-extrabold text-stone-800 block mb-2 uppercase tracking-wide text-[10px]">Actionable Mapping Anomalies & Orphans:</span>
                      <div className="space-y-2.5">
                        {diagResult.detectedAnomalies.map((anomaly: any, idx: number) => (
                          <div key={`anomaly-${idx}`} className="p-3.5 bg-amber-50/60 border border-amber-200 rounded-2xl flex flex-wrap justify-between items-center gap-3">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[9px] font-extrabold bg-amber-100 text-amber-800 uppercase tracking-wide">
                                  {anomaly.title}
                                </span>
                                <span className="font-bold text-stone-800 font-mono text-xs">{anomaly.email}</span>
                              </div>
                              <p className="text-stone-600 text-[11px] leading-relaxed font-semibold">
                                {anomaly.description}
                              </p>
                              {anomaly.user && (
                                <div className="text-[10px] text-stone-500 font-mono">
                                  [Auth User] Name: {anomaly.user.fullName || anomaly.user.name || 'N/A'} | Roles: {JSON.stringify(anomaly.user.roles || [])}
                                </div>
                              )}
                              {anomaly.pending && (
                                <div className="text-[10px] text-stone-500 font-mono">
                                  [Pending RSVP] Name: {anomaly.pending.fullName || anomaly.pending.name} | Unit: {anomaly.pending.displayUnitNumber}
                                </div>
                              )}
                            </div>
                            
                            <button
                              type="button"
                              disabled={isDiagRepairing}
                              onClick={() => handleHealDiagMapping(anomaly)}
                              className="inline-flex items-center gap-1.5 py-1.5 px-3.5 bg-[#0f4c2a] hover:bg-[#0a331c] text-white rounded-xl text-[10px] font-extrabold shadow transition-all cursor-pointer disabled:opacity-50"
                            >
                              <span>{anomaly.actionLabel}</span>
                            </button>
                          </div>
                        ))}

                        {diagResult.detectedAnomalies.length === 0 && (
                          <div className="text-emerald-800 font-bold p-4 bg-emerald-50/50 border border-emerald-200 rounded-2xl text-center flex items-center justify-center gap-2">
                            <CheckCircle className="w-4 h-4 text-emerald-600" />
                            <span>Pristine State! No orphaned profiles or mapping drifts detected in database.</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Healthy Mappings */}
                    {diagResult.healthyMappings.length > 0 && (
                      <div className="pt-2">
                        <span className="font-extrabold text-stone-700 block mb-2 uppercase tracking-wide text-[10px]">Healthy Profiles ({diagResult.healthyMappings.length}):</span>
                        <div className="max-h-44 overflow-y-auto border border-stone-150 rounded-2xl p-2 bg-white space-y-1">
                          {diagResult.healthyMappings.map((healthy: any, idx: number) => (
                            <div key={`healthy-${idx}`} className="p-2 hover:bg-stone-50 rounded-xl flex justify-between items-center text-[11px] font-semibold border-b border-stone-50 last:border-b-0">
                              <div>
                                <span className="text-stone-800 font-bold">{healthy.resident.fullName || healthy.email}</span>
                                <span className="text-stone-400 font-mono text-[10px] ml-2">[{healthy.resident.gmkId || healthy.resident.id}]</span>
                              </div>
                              <span className="text-[10px] text-emerald-600 font-extrabold uppercase tracking-wider">● Fully Aligned</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Referenced items block */}
                    <div className="pt-2 border-t border-stone-150">
                      <span className="font-bold text-stone-800 block mb-1 uppercase tracking-wide text-[10px]">Reference Footprint (Historical Database Traces):</span>
                      <div className="font-semibold text-stone-600 space-y-1 max-h-32 overflow-y-auto p-2 bg-white border border-stone-150 rounded-xl font-mono text-[10px]">
                        {diagResult.referencedInCommittees.length === 0 && diagResult.referencedInPrograms.length === 0 && diagResult.referencedInRegistrations.length === 0 && diagResult.referencedInRoles.length === 0 ? (
                          <div className="text-stone-400">No active system footprint / references located.</div>
                        ) : (
                          <>
                            {diagResult.referencedInCommittees.map((item: any, idx: number) => (
                              <div key={`ref-comm-${idx}`} className="text-red-700">
                                [Committee] Referenced in Event {item.eventId} / Committee '{item.committeeName}' (Role: {item.member.role || 'Member'}).
                              </div>
                            ))}
                            {diagResult.referencedInPrograms.map((item: any, idx: number) => (
                              <div key={`ref-prog-${idx}`} className="text-orange-700">
                                [Stage Program] Referenced in Event {item.eventId} / Program '{item.title}' (Role: {item.role}).
                              </div>
                            ))}
                            {diagResult.referencedInRegistrations.map((item: any, idx: number) => (
                              <div key={`ref-reg-${idx}`} className="text-amber-700">
                                [Event RSVP] Referenced in Event {item.eventId} (Email: {item.email}, Name: {item.name}).
                              </div>
                            ))}
                              {diagResult.referencedInRoles.map((item: ClassifiedRoleDoc, idx: number) => {
                                let badgeStyle = "text-stone-700 bg-stone-50 border-stone-200";
                                if (item.lifecycleStatus === 'ACTIVE') badgeStyle = "text-[#0f4c2a] bg-emerald-50 border-emerald-200 font-bold";
                                else if (item.lifecycleStatus === 'HISTORICAL') badgeStyle = "text-stone-700 bg-stone-100 border-stone-250";
                                else if (item.lifecycleStatus === 'ORPHANED') badgeStyle = "text-orange-800 bg-orange-50 border-orange-200";
                                else if (item.lifecycleStatus === 'DUPLICATE') badgeStyle = "text-purple-800 bg-purple-50 border-purple-200";
                                else if (item.lifecycleStatus === 'REVOKED') badgeStyle = "text-red-800 bg-red-50 border-red-200";

                                return (
                                  <div key={`ref-role-${idx}`} className={`p-2 rounded-xl border my-1 text-[11px] font-sans ${badgeStyle}`}>
                                    <div className="flex items-center justify-between font-bold">
                                      <span>[{item.lifecycleStatus}] Position: <strong className="font-extrabold">{item.position}</strong> {item.committeeStored ? `(Committee: ${item.committeeStored})` : ''}</span>
                                      <span className="font-mono text-[9px] opacity-70">{item.docId}</span>
                                    </div>
                                    <div className="text-[10px] opacity-80 font-normal mt-0.5">{item.reason}</div>
                                  </div>
                                );
                              })}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {diagRepairMsg && (
                  <div className={`p-3.5 border rounded-2xl text-xs font-bold leading-relaxed ${diagRepairMsg.includes('Failed') ? 'bg-red-50 border-red-150 text-red-700' : 'bg-emerald-50 border-emerald-150 text-[#0f4c2a]'}`}>
                    {diagRepairMsg}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 5. LOG CENTER TAB */}
        {activeTab === 'log_center' && (
          <div className="bg-white border border-stone-200 p-6 rounded-3xl animate-fadeIn shadow-sm">
            <LogCenter />
          </div>
        )}
        
        {/* Unified Platform Version Footer */}
        <div className="pt-8 border-t border-stone-200 text-center text-xs font-sans text-stone-500 mt-8 space-y-1">
          <div>
            GMK Governance Console • Developed by Elite IT
          </div>
          <div>
            Platform Version: <button type="button" onClick={() => setIsReleaseModalOpen(true)} className="font-extrabold text-[#0f4c2a] hover:text-[#125831] underline cursor-pointer">v1.5.3 (Release Notes)</button>
          </div>
        </div>
      </div>

      <ReleaseNotesModal isOpen={isReleaseModalOpen} onClose={() => setIsReleaseModalOpen(false)} />

      {/* DELETE RESIDENT WORKFLOW MODAL */}
      {confirmDeleteResident && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-950/40 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white border border-stone-300 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-5">
            <div className="flex items-center space-x-2 pb-2 border-b border-stone-150">
              <Trash2 className="w-5 h-5 text-red-650" />
              <h3 className="text-sm font-extrabold text-stone-900 uppercase">Delete Resident</h3>
            </div>

            <div className="text-stone-705 text-xs font-semibold leading-relaxed space-y-4">
              <p>
                This will permanently remove the resident record,
                family profile, household members,
                and portal access.
              </p>
              <p className="font-extrabold text-red-750">
                This action cannot be undone.
              </p>
            </div>

            <div className="flex gap-2 pt-2 border-t border-stone-200">
              <button
                onClick={() => {
                  handleDeleteResidentExecute(confirmDeleteResident);
                  setConfirmDeleteResident(null);
                }}
                className="flex-1 inline-flex items-center justify-center py-2 px-4 bg-red-700 hover:bg-red-800 text-white rounded-xl text-xs font-bold cursor-pointer transition-colors shadow"
              >
                Delete
              </button>
              <button
                onClick={() => setConfirmDeleteResident(null)}
                className="inline-flex items-center justify-center py-2 px-4 border border-stone-300 bg-white text-stone-700 rounded-xl text-xs font-bold cursor-pointer hover:bg-stone-50"
              >
                Cancel
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
