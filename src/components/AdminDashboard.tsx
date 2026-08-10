import React, { useState, useEffect } from 'react';
import { db, auth, useAuth } from '../context/AuthContext';
import { 
  collection, 
  doc, 
  setDoc, 
  onSnapshot, 
  deleteDoc,
  query,
  where,
  getDocs,
  getDoc,
  updateDoc
} from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { ResidentProfile, PendingRegistration, Family, FamilyMember, UserProfile } from '../types';
import { GMKCard, GMKButton, GMKBadge, GMKPageHeader, GMKInput, GMKSelect } from './gmk/DesignSystem';
import { useLocalGEASConfirmation, GEASConfirmationDialogUI } from './gmk/GEASConfirmationDialog';
import { createAuditLog } from '../utils/audit';
import { NotificationService } from '../services/NotificationService';
import { sanitizeFirestorePayload } from '../utils/sanitize';
import { normalizeUnit, normalizeGatedCommunity } from '../utils/unitNormalization';
import { normalizeName } from '../utils/nameNormalization';
import { formatPhoneWithCountryCode } from '../utils/phoneValidation';
import { ResidentLifecycleService, VerificationReport } from '../services/ResidentLifecycleService';
import LogCenter from './LogCenter';
import ReleaseNotesModal from './ReleaseNotesModal';
import { 
  Users, 
  UserCheck, 
  Search, 
  LogOut, 
  Check, 
  X, 
  Building2, 
  Archive, 
  Clock, 
  RefreshCw, 
  ShieldCheck, 
  Mail, 
  PhoneCall, 
  Info,
  Layers,
  Edit2,
  Lock,
  Briefcase,
  Sliders,
  UserX,
  Plus,
  Trash2,
  Wrench,
  ShieldAlert
} from 'lucide-react';

interface AdminDashboardProps {
  activeEmail: string;
  isEmergency?: boolean;
  hideHeaderAndTabs?: boolean;
}

export default function AdminDashboard({ activeEmail, isEmergency = false, hideHeaderAndTabs = false }: AdminDashboardProps) {
  const { profile } = useAuth();
  const { confirm: showConfirm, isOpen: isConfirmOpen, options: confirmOptions, handleCancel: handleConfirmCancel, handleConfirm: handleConfirmSubmit } = useLocalGEASConfirmation();
  const [mainTab, setMainTab] = useState<'administration' | 'log_center' | 'system'>('administration');
  const [activeTab, setActiveTab] = useState<'approvals' | 'residents' | 'archived' | 'add_resident' | 'log_center'>('approvals');

  useEffect(() => {
    if (hideHeaderAndTabs) {
      setMainTab('administration');
    }
  }, [hideHeaderAndTabs]);
  
  // Real-time Lists
  const [residents, setResidents] = useState<ResidentProfile[]>([]);
  const [pendingRegs, setPendingRegs] = useState<PendingRegistration[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  
  // UI Loading States
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isReleaseModalOpen, setIsReleaseModalOpen] = useState(false);

  // Search filter
  const [searchTerm, setSearchTerm] = useState('');
  const [residentFilter, setResidentFilter] = useState<'all' | 'registered' | 'pending'>('all');

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

      // 7. Look for references in Role Assignments
      const referencedInRoles: any[] = [];
      const rolesSnap = await getDocs(collection(db, "roleAssignments"));
      rolesSnap.forEach(d => {
        const data = d.data();
        const rEmail = (data.email || '').toLowerCase().trim();
        const rGmkId = (data.gmkId || '').toUpperCase().trim();
        const rName = (data.fullName || data.name || '').toLowerCase().trim();

        if (matchesFootprint(rGmkId, rEmail, rName)) {
          referencedInRoles.push({ docId: d.id, position: data.position || data.role, email: rEmail });
        }
      });

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
        const key = `${anomaly.collection}_${anomaly.docId}_${anomaly.field.replace(/[\[\]\.]/g, '_')}`;
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

  // Predictive Search States
  const [predictiveQuery, setPredictiveQuery] = useState('');
  const [showPredictiveDropdown, setShowPredictiveDropdown] = useState(false);
  const [highlightedPendingUid, setHighlightedPendingUid] = useState<string | null>(null);

  // Filter suggestions across active, archived, and pending
  const getPredictiveSuggestions = () => {
    if (!predictiveQuery.trim()) return [];
    const query = predictiveQuery.toLowerCase().trim();
    const matches: Array<{
      type: 'active' | 'archived' | 'pending';
      id: string;
      name: string;
      email: string;
      unit: string;
      original: any;
    }> = [];

    // 1. Pending Approvals
    pendingRegs.forEach(p => {
      if (
        p.fullName.toLowerCase().includes(query) ||
        p.email.toLowerCase().includes(query) ||
        p.displayUnitNumber.toLowerCase().includes(query)
      ) {
        matches.push({
          type: 'pending',
          id: p.uid,
          name: p.fullName,
          email: p.email,
          unit: p.displayUnitNumber,
          original: p
        });
      }
    });

    // 2. Active & Archived Residents
    residents.forEach(r => {
      if (r.status === 'active' || r.status === 'archived') {
        if (
          r.fullName.toLowerCase().includes(query) ||
          r.email.toLowerCase().includes(query) ||
          r.displayUnitNumber.toLowerCase().includes(query) ||
          (r.gmkId && r.gmkId.toLowerCase().includes(query))
        ) {
          matches.push({
            type: r.status as 'active' | 'archived',
            id: r.gmkId,
            name: r.fullName,
            email: r.email,
            unit: r.displayUnitNumber,
            original: r
          });
        }
      }
    });

    return matches.slice(0, 8);
  };

  // Selected resident details
  const [selectedResident, setSelectedResident] = useState<ResidentProfile | null>(null);
  const [selectedFamily, setSelectedFamily] = useState<Family | null>(null);
  const [householdMembers, setHouseholdMembers] = useState<FamilyMember[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Edit Mode states
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editSalutation, setEditSalutation] = useState<'Mr' | 'Mrs' | 'Ms' | 'Mstr' | 'Dr'>('Mr');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editStatus, setEditStatus] = useState<'active' | 'archived'>('active');
  
  // Unit assignment edit
  const [editUnitType, setEditUnitType] = useState<'Apartment' | 'Villa' | 'Townhouse'>('Apartment');
  const [editFlatNo, setEditFlatNo] = useState('');
  const [editAptBuilding, setEditAptBuilding] = useState('');
  const [editAptSection, setEditAptSection] = useState('');
  const [editAptFlat, setEditAptFlat] = useState('');

  // Create Resident Mode states
  const [isCreating, setIsCreating] = useState(false);
  const [createSalutation, setCreateSalutation] = useState<'Mr' | 'Mrs' | 'Ms' | 'Mstr' | 'Dr'>('Mr');
  const [createUnitType, setCreateUnitType] = useState<'Apartment' | 'Villa' | 'Townhouse'>('Apartment');
  const [createFlatNo, setCreateFlatNo] = useState('');
  const [createGmkId, setCreateGmkId] = useState('');
  const [createFullName, setCreateFullName] = useState('');
  const [createEmail, setCreateEmail] = useState('');
  const [createPhone, setCreatePhone] = useState('');
  const [createStatus, setCreateStatus] = useState<'active' | 'archived' | 'pending'>('active');
  const [createRemarks, setCreateRemarks] = useState('');

  // Profession edit
  const [editProfessionCategory, setEditProfessionCategory] = useState('');
  const [editProfessionTitle, setEditProfessionTitle] = useState('');
  const [editCompany, setEditCompany] = useState('');

  // Rejection modal state
  const [rejectionPending, setRejectionPending] = useState<PendingRegistration | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [customRejection, setCustomRejection] = useState('');
  const [isApproving, setIsApproving] = useState(false);
  const [confirmDeleteResident, setConfirmDeleteResident] = useState<ResidentProfile | null>(null);
  const [deleteReason, setDeleteReason] = useState('');

  const buildingRef = React.useRef<HTMLInputElement>(null);
  const sectionRef = React.useRef<HTMLInputElement>(null);
  const flatRef = React.useRef<HTMLInputElement>(null);

  // Handle segmented inputs for Apartment edit
  const handleBuildingChange = (val: string) => {
    const normalized = val.toUpperCase().replace(/[^A-Z0-9]/g, '');
    setEditAptBuilding(normalized);
  };

  const handleSectionChange = (val: string) => {
    const cleaned = val.replace(/\D/g, '').slice(0, 2);
    setEditAptSection(cleaned);
  };

  const handleFlatChange = (val: string) => {
    const cleaned = val.replace(/\D/g, '').slice(0, 2);
    setEditAptFlat(cleaned);
  };

  // Synchronize editFlatNo whenever sub-segments change
  useEffect(() => {
    if (editUnitType === 'Apartment') {
      if (editAptBuilding || editAptSection || editAptFlat) {
        setEditFlatNo(`${editAptBuilding}-${editAptSection}-${editAptFlat}`);
      } else {
        setEditFlatNo('');
      }
    }
  }, [editAptBuilding, editAptSection, editAptFlat, editUnitType]);

  // Synchronize next sequential GMK ID when residents database updates
  useEffect(() => {
    if (residents.length > 0) {
      const numericIds = residents
        .map(r => {
          const match = r.gmkId.match(/GMK-(\d+)/);
          return match ? parseInt(match[1], 10) : null;
        })
        .filter((id): id is number => id !== null);
      const maxId = numericIds.length > 0 ? Math.max(...numericIds) : 1000;
      const nextId = String(maxId + 1).padStart(4, '0');
      setCreateGmkId(`GMK-${nextId}`);
    } else {
      setCreateGmkId('GMK-001001');
    }
  }, [residents]);

  // Real-time Firestore listeners for active/archived residents and approvals
  useEffect(() => {
    setLoading(true);
    setErrorMsg(null);

    const unsubResidents = onSnapshot(collection(db, "residents"), (snapshot) => {
      const list: ResidentProfile[] = [];
      snapshot.forEach(docSnap => {
        const r = docSnap.data() as ResidentProfile;
        const currentGC = r.gatedCommunity || '';
        if (
          currentGC.toLowerCase().includes("al mouj") ||
          currentGC.toLowerCase().includes("muscat hills") ||
          currentGC.toLowerCase().includes("gmk heights")
        ) {
          const cleaned = { ...r, gatedCommunity: "Al Hail Greens" };
          setDoc(doc(db, "residents", docSnap.id), { gatedCommunity: "Al Hail Greens" }, { merge: true }).catch(err => {
            console.warn("⚠️ Silent cleanup of resident gatedCommunity in AdminDashboard failed:", err);
          });
          list.push(cleaned);
        } else {
          list.push(r);
        }
      });
      setResidents(list);
      setLoading(false);
    }, (err) => {
      console.error("Residents collection subscriber locked:", err);
      setErrorMsg("Unable to synchronize active residents listing due to database permission restrictions.");
      setLoading(false);
    });

    const unsubPending = onSnapshot(
      query(collection(db, "pending_registrations"), where("status", "==", "pending")),
      (snapshot) => {
        const list: PendingRegistration[] = [];
        snapshot.forEach(docSnap => {
          const p = docSnap.data() as PendingRegistration;
          const currentGC = p.gatedCommunity || '';
          if (
            currentGC.toLowerCase().includes("al mouj") ||
            currentGC.toLowerCase().includes("muscat hills") ||
            currentGC.toLowerCase().includes("gmk heights")
          ) {
            const cleaned = { ...p, gatedCommunity: "Al Hail Greens" };
            setDoc(doc(db, "pending_registrations", docSnap.id), { gatedCommunity: "Al Hail Greens" }, { merge: true }).catch(err => {
              console.warn("⚠️ Silent cleanup of pending registration gatedCommunity in AdminDashboard failed:", err);
            });
            list.push(cleaned);
          } else {
            list.push(p);
          }
        });
        setPendingRegs(list);
      }, (err) => {
        console.warn("Approvals listener blocked:", err.message);
      }
    );

    const unsubUsers = onSnapshot(
      collection(db, "users"),
      (snapshot) => {
        const list: UserProfile[] = [];
        snapshot.forEach(docSnap => {
          list.push(docSnap.data() as UserProfile);
        });
        setUsers(list);
      }, (err) => {
        console.warn("Users subscription blocked in AdminDashboard:", err.message);
      }
    );

    return () => {
      unsubResidents();
      unsubPending();
      unsubUsers();
    };
  }, []);

  // Sync selected resident's details, decoupled family profile, and family members listing
  useEffect(() => {
    if (!selectedResident) {
      setSelectedFamily(null);
      setHouseholdMembers([]);
      return;
    }

    setLoadingDetails(true);
    
    // 1. Fetch decoupled Family Profile
    const familyDocId = `fam_${selectedResident.gmkId}`;
    const familyDocRef = doc(db, "families", familyDocId);
    
    const unsubFamily = onSnapshot(familyDocRef, (docSnap) => {
      if (docSnap.exists()) {
        setSelectedFamily(docSnap.data() as Family);
      } else {
        setSelectedFamily(null);
      }
    }, (err) => {
      console.warn("⚠️ [AdminDashboard] Family document snapshot permission-denied or blocked:", err);
    });

    // 2. Subscribe to Family Members (Household list) - SINGLE SOURCE OF TRUTH (familyMembers)
    const membersQuery = query(collection(db, "familyMembers"), where("familyId", "==", familyDocId));
    const unsubMembers = onSnapshot(membersQuery, (snapshot) => {
      const list: FamilyMember[] = [];
      snapshot.forEach(memberDoc => {
        list.push({ id: memberDoc.id, ...memberDoc.data() } as FamilyMember);
      });
      setHouseholdMembers(list);
      setLoadingDetails(false);
    }, (err) => {
      console.warn("Family members querying locked down:", err);
      setHouseholdMembers([]);
      setLoadingDetails(false);
    });

    return () => {
      unsubFamily();
      unsubMembers();
    };
  }, [selectedResident]);

  // Handle emergency sign out
  const handleExitEmergency = async () => {
    localStorage.removeItem('gmk_emergency_admin_mode');
    await signOut(auth);
    window.location.reload();
  };

  // Administratively create resident profile from scratch
  const handleCreateResidentFromScratch = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const normResult = normalizeUnit(createUnitType, createFlatNo);
    if (!normResult.isValid) {
      setErrorMsg(`VALIDATION ERROR: ${normResult.error}`);
      return;
    }

    const sanitizedEmail = createEmail.toLowerCase().trim();

    if (!/^\d{8}$/.test(createPhone.trim())) {
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

      const payload: ResidentProfile = {
        gmkId: createGmkId.trim(),
        displayUnitNumber: normResult.displayUnitNumber,
        phone: createPhone.trim(),
        email: sanitizedEmail,
        unitKey: normResult.unitKey,
        fullName: createFullName.trim(),
        salutation: createSalutation,
        unitType: createUnitType,
        status: createStatus,
        gatedCommunity: 'Al Hail Greens',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        remarks: createRemarks.trim()
      };

      await setDoc(doc(db, "residents", payload.gmkId), sanitizeFirestorePayload(payload));

      // Create decoupled family profile frame synchronously for the resident
      const familyPayload: Family = {
        id: `fam_${payload.gmkId}`,
        primaryMemberGmkId: payload.gmkId,
        primaryMemberEmail: payload.email,
        salutation: payload.salutation as any,
        fullName: payload.fullName,
        phone: payload.phone,
        whatsAppNumber: payload.phone,
        whatsAppSameAsMobile: true,
        unitKey: payload.unitKey,
        displayUnitNumber: payload.displayUnitNumber,
        unitType: payload.unitType,
        professionCategory: 'None Specified',
        professionTitle: 'Not disclosed',
        company: 'Not disclosed',
        onboardingCompleted: false,
        directoryConsent: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await setDoc(doc(db, "families", `fam_${payload.gmkId}`), sanitizeFirestorePayload(familyPayload));

      await createAuditLog(
        'ACTIVATE_RESIDENT',
        activeEmail,
        'resident',
        payload.gmkId,
        `Administratively created resident profile for ${payload.fullName} (Unit: ${payload.displayUnitNumber}, Status: ${payload.status.toUpperCase()})`,
        payload.fullName
      );

      setSuccessMsg(`✓ Created resident profile ${payload.gmkId} successfully.`);
      
      // Reset form fields
      setCreateFlatNo('');
      setCreatePhone('');
      setCreateEmail('');
      setCreateFullName('');
      setCreateRemarks('');
      setIsCreating(false);
      setActiveTab('residents');
    } catch (err: any) {
      console.error("❌ Resident Creation Error:", err);
      setErrorMsg(`CREATION FAILURE: ${err.message}`);
    }
  };

  // 1. Approvals handler
  const handleApproveRegistration = async (pending: PendingRegistration) => {
    if (isApproving) return;
    setIsApproving(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    const targetEmail = pending.email.toLowerCase().trim();
    const targetUnitKey = pending.unitKey;

    try {
      // 1. Check if email is already approved inside the residents database
      const emailDupCheck = query(collection(db, "residents"), where("email", "==", targetEmail), where("status", "==", "active"));
      const emailDupSnap = await getDocs(emailDupCheck);
      if (!emailDupSnap.empty) {
        throw new Error(`Profile '${pending.fullName}' is already registered or approved inside the community database with email '${targetEmail}'.`);
      }

      // 2. Check if unitKey is already assigned to an approved resident account
      const unitDupCheck = query(collection(db, "residents"), where("unitKey", "==", targetUnitKey), where("status", "==", "active"));
      const unitDupSnap = await getDocs(unitDupCheck);
      if (!unitDupSnap.empty) {
        const approvedRes = unitDupSnap.docs[0].data() as ResidentProfile;
        throw new Error(`Residential Unit '${pending.displayUnitNumber}' is already registered under active resident '${approvedRes.fullName}' (${approvedRes.gmkId}).`);
      }

      // Find maximum numeric index across all residents to generate a sequential unique code
      const numericIds = residents
        .map(r => {
          const match = r.gmkId.match(/GMK-(\d+)/);
          return match ? parseInt(match[1], 10) : null;
        })
        .filter((id): id is number => id !== null);
      
      const maxId = numericIds.length > 0 ? Math.max(...numericIds) : 1000;
      const generatedGmkId = `GMK-${String(maxId + 1).padStart(4, '0')}`;

      const timestamp = new Date().toISOString();

      // Create Active Resident Profile
      const residentPayload: ResidentProfile = {
        gmkId: generatedGmkId,
        displayUnitNumber: pending.displayUnitNumber,
        unitKey: pending.unitKey,
        phone: pending.phone,
        email: pending.email.toLowerCase().trim(),
        fullName: pending.fullName,
        salutation: pending.salutation,
        unitType: pending.unitType,
        status: 'active',
        gatedCommunity: normalizeGatedCommunity(pending.gatedCommunity),
        createdAt: timestamp,
        updatedAt: timestamp,
        remarks: 'Approved and verified from the registration queue.'
      };

      // Create Decoupled Family Profile Frame
      const familyPayload: Family = {
        id: `fam_${generatedGmkId}`,
        primaryMemberGmkId: generatedGmkId,
        primaryMemberEmail: pending.email.toLowerCase().trim(),
        salutation: pending.salutation as any,
        fullName: pending.fullName,
        phone: pending.phone,
        whatsAppNumber: pending.phone,
        whatsAppSameAsMobile: true,
        unitKey: pending.unitKey,
        displayUnitNumber: pending.displayUnitNumber,
        unitType: pending.unitType,
        professionCategory: 'None Specified',
        professionTitle: 'Not disclosed',
        company: 'Not disclosed',
        onboardingCompleted: false,
        directoryConsent: false,
        createdAt: timestamp,
        updatedAt: timestamp
      };

      // Write to residents
      await setDoc(doc(db, "residents", generatedGmkId), sanitizeFirestorePayload(residentPayload));
      
      // Write to families
      await setDoc(doc(db, "families", `fam_${generatedGmkId}`), sanitizeFirestorePayload(familyPayload));
 
      // Trigger notification using NotificationService BEFORE removing pending registration to avoid real-time snapshot/lifecycle race conditions
      try {
        await NotificationService.sendRegistrationApproved(pending.email, {
          residentName: pending.fullName,
          gmkId: generatedGmkId,
          unit: pending.displayUnitNumber
        });
      } catch (notifErr) {
        console.warn("⚠️ Notification could not be queued during resident approval:", notifErr);
      }

      // Remove from pending registrations
      await deleteDoc(doc(db, "pending_registrations", pending.uid));
 
      await createAuditLog(
        'APPROVE_RESIDENT',
        activeEmail,
        'resident',
        generatedGmkId,
        `Approved registration for ${pending.fullName} (Unit: ${pending.displayUnitNumber})`,
        pending.fullName
      );
 
      setSuccessMsg(`✓ Approved Successfully. '${pending.fullName}' is active under community ID: ${generatedGmkId}`);
    } catch (err: any) {
      console.error("Approve registration error:", err);
      setErrorMsg(`Failed to complete verification: ${err.message}`);
    } finally {
      setIsApproving(false);
    }
  };

  // Rejection logic open
  const handleTriggerRejectionModal = (pending: PendingRegistration) => {
    setRejectionPending(pending);
    setRejectionReason('Incomplete Registration Details');
    setCustomRejection('');
  };

  const handleConfirmRejection = async () => {
    if (!rejectionPending) return;
    setErrorMsg(null);
    setSuccessMsg(null);

    const finalReason = rejectionReason === 'Custom' ? customRejection.trim() : rejectionReason;
    if (!finalReason) {
      setErrorMsg("A rejection reason is mandatory.");
      return;
    }

    try {
      await deleteDoc(doc(db, "pending_registrations", rejectionPending.uid));

      await createAuditLog(
        'REJECT_REGISTRATION',
        activeEmail,
        'pending_registrations',
        rejectionPending.uid,
        `Rejected registration for ${rejectionPending.fullName}. Reason: ${finalReason}`,
        rejectionPending.fullName
      );

      // Trigger notification using NotificationService
      try {
        await NotificationService.sendRegistrationRejected(rejectionPending.email, {
          residentName: rejectionPending.fullName,
          reason: finalReason
        });
      } catch (notifErr) {
        console.warn("⚠️ Notification could not be queued during registration rejection:", notifErr);
      }

      setSuccessMsg(`✓ Registration submission for ${rejectionPending.fullName} rejected.`);
      setRejectionPending(null);
    } catch (err: any) {
      console.error("Failed to reject registration:", err);
      setErrorMsg(`Rejection error: ${err.message}`);
    }
  };

  // 2. Active Resident editing and archiving
  const handleStartEditing = (res: ResidentProfile) => {
    setIsEditing(true);
    setEditName(res.fullName);
    setEditSalutation(res.salutation || 'Mr');
    setEditEmail(res.email);
    setEditPhone(res.phone);
    setEditStatus((res.status === 'active' || res.status === 'archived') ? res.status : 'active');
    
    setEditUnitType(res.unitType || 'Apartment');
    const displayNum = res.displayUnitNumber;
    
    if (res.unitType === 'Apartment') {
      const parts = displayNum.split('-');
      if (parts.length === 3) {
        setEditAptBuilding(parts[0]);
        setEditAptSection(parts[1]);
        setEditAptFlat(parts[2]);
        setEditFlatNo(displayNum);
      } else {
        setEditAptBuilding('');
        setEditAptSection('');
        setEditAptFlat('');
        setEditFlatNo(displayNum);
      }
    } else {
      // Villa/Townhouse - strip prefix
      const strippedNumber = displayNum.replace(/^(VILLA\-|TH\-)/i, '');
      setEditFlatNo(strippedNumber);
    }

    // Set professional info from selectedFamily
    if (selectedFamily) {
      setEditProfessionCategory(selectedFamily.professionCategory || '');
      setEditProfessionTitle(selectedFamily.professionTitle || '');
      setEditCompany(selectedFamily.company || '');
    } else {
      setEditProfessionCategory('');
      setEditProfessionTitle('');
      setEditCompany('');
    }
  };

  const handleSaveResidentEdits = async () => {
    if (!selectedResident) return;
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!editName.trim()) {
      setErrorMsg("Full name is required.");
      return;
    }
    
    try {
      // Validate Unit Allocation using norm utils
      const normResult = normalizeUnit(editUnitType, editFlatNo);
      if (!normResult.isValid) {
        throw new Error(normResult.error || "Residential Unit layout has typing format errors.");
      }

      const timestamp = new Date().toISOString();

      // Ensure that edit email is not taken by another resident
      const normalizedEmail = editEmail.toLowerCase().trim();
      const duplicateRes = residents.find(r => r.email === normalizedEmail && r.gmkId !== selectedResident.gmkId);
      if (duplicateRes) {
        throw new Error(`Email address ${normalizedEmail} is already bound to another community resident profile (${duplicateRes.gmkId}).`);
      }

      // Check duplicate unit allocation
      const duplicateUnit = residents.find(r => r.unitKey === normResult.unitKey && r.status !== 'archived' && r.gmkId !== selectedResident.gmkId);
      if (duplicateUnit) {
        throw new Error(`Residential Unit '${normResult.displayUnitNumber}' is already occupied by active resident (${duplicateUnit.fullName} - ${duplicateUnit.gmkId}).`);
      }

      // Update basic resident details
      const residentPayload = {
        fullName: editName.trim(),
        salutation: editSalutation,
        email: normalizedEmail,
        phone: editPhone.trim(),
        status: editStatus,
        unitType: editUnitType,
        displayUnitNumber: normResult.displayUnitNumber,
        unitKey: normResult.unitKey,
        updatedAt: timestamp
      };

      const residentRef = doc(db, "residents", selectedResident.gmkId);
      await setDoc(residentRef, sanitizeFirestorePayload(residentPayload), { merge: true });

      // Update associated accounts isActive attributes
      const usersQuery = query(collection(db, "users"), where("email", "==", (selectedResident.email || '').toLowerCase().trim()));
      const usersSnapshot = await getDocs(usersQuery);
      if (!usersSnapshot.empty) {
        const userDocId = usersSnapshot.docs[0].id;
        await setDoc(doc(db, "users", userDocId), sanitizeFirestorePayload({
          isActive: editStatus === 'active'
        }), { merge: true });
      }

      // Sync the profession details to family profile
      const familyRef = doc(db, "families", `fam_${selectedResident.gmkId}`);
      const familyPayload = {
        fullName: editName.trim(),
        salutation: editSalutation as any,
        phone: editPhone.trim(),
        primaryMemberEmail: normalizedEmail,
        unitKey: normResult.unitKey,
        displayUnitNumber: normResult.displayUnitNumber,
        unitType: editUnitType,
        professionCategory: editProfessionCategory.trim() || 'None Specified',
        professionTitle: editProfessionTitle.trim() || 'Not disclosed',
        company: editCompany.trim() || 'Not disclosed',
        updatedAt: timestamp
      };

      await setDoc(familyRef, sanitizeFirestorePayload(familyPayload), { merge: true });

      await createAuditLog(
        'ACTIVATE_RESIDENT',
        activeEmail,
        'resident',
        selectedResident.gmkId,
        `Admin edited details & profession information for ${selectedResident.gmkId}`,
        editName.trim()
      );

      // Close Edit Mode and refresh local state
      setIsEditing(false);
      setSelectedResident({
        ...selectedResident,
        ...residentPayload
      });
      setSuccessMsg(`✓ Profile for ${selectedResident.gmkId} successfully updated.`);
    } catch (err: any) {
      console.error("Error saving resident profile editing:", err);
      setErrorMsg(`Save failed: ${err.message}`);
    }
  };

  const handleArchiveResident = async (res: ResidentProfile) => {
    const confirmed = await showConfirm({
      title: "ARCHIVE RESIDENT PROFILE",
      message: `Are you absolutely certain you want to archive resident ${res.fullName}? Doing so will immediately vacate the unit '${res.displayUnitNumber}' and disable system log-in credentials.`,
      severity: "warning",
      confirmText: "Archive Resident",
      cancelText: "Cancel"
    });
    if (!confirmed) {
      return;
    }

    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const timestamp = new Date().toISOString();
      const residentRef = doc(db, "residents", res.gmkId);
      
      // Update status to 'archived'
      await setDoc(residentRef, sanitizeFirestorePayload({
        status: 'archived',
        updatedAt: timestamp,
        remarks: `Archived by administrative operation requested by ${activeEmail}`
      }), { merge: true });

      // Disable login credentials
      const usersQuery = query(collection(db, "users"), where("email", "==", (res.email || '').toLowerCase().trim()));
      const usersSnapshot = await getDocs(usersQuery);
      if (!usersSnapshot.empty) {
        const userDocId = usersSnapshot.docs[0].id;
        await setDoc(doc(db, "users", userDocId), sanitizeFirestorePayload({
          isActive: false
        }), { merge: true });
      }

      await createAuditLog(
        'ARCHIVE_RESIDENT',
        activeEmail,
        'resident',
        res.gmkId,
        `Archived resident profile. Unit '${res.displayUnitNumber}' was vacated.`,
        res.fullName
      );

      setSuccessMsg(`✓ Resident ${res.fullName} was archived and unit cleared.`);
      setSelectedResident(null);
    } catch (err: any) {
      console.error("Archiving failed:", err);
      setErrorMsg(`Failed to archive profile: ${err.message}`);
    }
  };

  // 4. Unarchive / Restore handler
  const handleRestoreResident = async (res: ResidentProfile) => {
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      // Ensure unit is not currently occupied
      const occupiedUnitCheck = residents.find(r => r.unitKey === res.unitKey && r.status !== 'archived');
      if (occupiedUnitCheck) {
        throw new Error(`Cannot restore. Unit code '${res.displayUnitNumber}' is currently occupied by active resident '${occupiedUnitCheck.fullName}' (${occupiedUnitCheck.gmkId}).`);
      }

      const timestamp = new Date().toISOString();
      const residentRef = doc(db, "residents", res.gmkId);
      
      await setDoc(residentRef, sanitizeFirestorePayload({
        status: 'active',
        updatedAt: timestamp,
        remarks: `Restored back to active list by admin ${activeEmail}`
      }), { merge: true });

      // Enable login credentials back
      const usersQuery = query(collection(db, "users"), where("email", "==", (res.email || '').toLowerCase().trim()));
      const usersSnapshot = await getDocs(usersQuery);
      if (!usersSnapshot.empty) {
        const userDocId = usersSnapshot.docs[0].id;
        await setDoc(doc(db, "users", userDocId), sanitizeFirestorePayload({
          isActive: true
        }), { merge: true });
      }

      await createAuditLog(
        'ACTIVATE_RESIDENT',
        activeEmail,
        'resident',
        res.gmkId,
        `Restored archived resident back to active status in unit '${res.displayUnitNumber}'`,
        res.fullName
      );

      setSuccessMsg(`✓ Resident ${res.fullName} successfully restored to active status.`);
    } catch (err: any) {
      console.error("Restoring failed:", err);
      setErrorMsg(`Failed to restore resident profile: ${err.message}`);
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
        deleteReason
      );

      if (result.success) {
        setDeletionReport(result.verificationReport);
        setSuccessMsg(`✓ Resident ${res.fullName} (GMK ID: ${res.gmkId}) and all associated dependencies have been permanently and safely deleted under GEAS v1.0.`);
        setSelectedResident(null);
        setDeleteReason('');
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

  const handleDeleteResident = async (res: ResidentProfile) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const normEmail = (res.email || '').toLowerCase().trim();
      const dependencies: string[] = [];

      // A. Check eventCommittees memberships
      const committeesSnap = await getDocs(collection(db, "eventCommittees"));
      committeesSnap.forEach(docSnap => {
        const data = docSnap.data();
        const members = data.members || [];
        const hasMember = members.some((m: any) => m.residentId === res.gmkId || (m.email && m.email.toLowerCase().trim() === normEmail));
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
        const hasCoord = coords.some((m: any) => m.residentId === res.gmkId || (m.email && m.email.toLowerCase().trim() === normEmail));
        const hasVol = vols.some((m: any) => m.residentId === res.gmkId || (m.email && m.email.toLowerCase().trim() === normEmail));
        const hasPart = parts.some((m: any) => m.residentId === res.gmkId || (m.email && m.email.toLowerCase().trim() === normEmail));
        if (hasCoord) dependencies.push(`Coordinator of Program: "${data.title}"`);
        if (hasVol) dependencies.push(`Volunteer of Program: "${data.title}"`);
        if (hasPart) dependencies.push(`Participant of Program: "${data.title}"`);
      });

      // C. Check event_registrations
      const regsSnap1 = await getDocs(query(collection(db, "event_registrations"), where("primaryMemberGmkId", "==", res.gmkId)));
      const regsSnap2 = await getDocs(query(collection(db, "event_registrations"), where("primaryMemberEmail", "==", normEmail)));
      if (!regsSnap1.empty || !regsSnap2.empty) {
        dependencies.push(`Has active Event Registration(s)`);
      }

      // D. Check roleAssignments or governanceAssignments
      const rolesSnap = await getDocs(collection(db, "roleAssignments"));
      rolesSnap.forEach(docSnap => {
        const data = docSnap.data();
        if (data.gmkId === res.gmkId || (data.email && data.email.toLowerCase().trim() === normEmail)) {
          dependencies.push(`Role Assignment: "${data.role || data.position}"`);
        }
      });

      const govSnap = await getDocs(collection(db, "governanceAssignments"));
      govSnap.forEach(docSnap => {
        const data = docSnap.data();
        if (data.gmkId === res.gmkId || (data.email && data.email.toLowerCase().trim() === normEmail)) {
          dependencies.push(`Governance Assignment: "${data.role || data.position}"`);
        }
      });

      if (dependencies.length > 0) {
        setErrorMsg(`PURGE BLOCKED BY GOVERNANCE: Resident ${res.fullName} cannot be purged due to active dependencies:\n` + dependencies.map(d => `• ${d}`).join('\n') + `\n\nPlease prune or reassign these dependencies before attempting to purge.`);
        return;
      }

      setConfirmDeleteResident(res);
      setDeleteReason('');
    } catch (err: any) {
      console.error("Dependency validation failed:", err);
      setErrorMsg("Failed to validate resident dependencies: " + err.message);
    }
  };

  // Helper selectors and lists
  const activeResidents = residents.filter(r => r.status === 'active');
  const archivedResidents = residents.filter(r => r.status === 'archived');

  const registeredCount = activeResidents.filter(res => users.some(u => u.email.toLowerCase().trim() === res.email.toLowerCase().trim() && u.isActive)).length;
  const notRegisteredCount = activeResidents.length - registeredCount;

  const filteredActiveResidents = activeResidents.filter(r => {
    // Apply summary card filter
    if (residentFilter === 'registered') {
      const isRegistered = users.some(u => u.email.toLowerCase().trim() === r.email.toLowerCase().trim() && u.isActive);
      if (!isRegistered) return false;
    } else if (residentFilter === 'pending') {
      const isRegistered = users.some(u => u.email.toLowerCase().trim() === r.email.toLowerCase().trim() && u.isActive);
      if (isRegistered) return false;
    }

    const term = searchTerm.toLowerCase().trim();
    if (!term) return true;
    return (
      (r.fullName || '').toLowerCase().includes(term) ||
      (r.email || '').toLowerCase().includes(term) ||
      (r.displayUnitNumber || '').toLowerCase().includes(term) ||
      (r.gmkId || '').toLowerCase().includes(term)
    );
  });

  const filteredArchivedResidents = archivedResidents.filter(r => {
    const term = searchTerm.toLowerCase().trim();
    if (!term) return true;
    return (
      (r.fullName || '').toLowerCase().includes(term) ||
      (r.email || '').toLowerCase().includes(term) ||
      (r.displayUnitNumber || '').toLowerCase().includes(term) ||
      (r.gmkId || '').toLowerCase().includes(term)
    );
  });

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Central Design GMK Page Header */}
      {!hideHeaderAndTabs && (
        <div className="relative space-y-4">
          <GMKPageHeader
            title="Resident Administration Portal"
            subtitle={`Signed in as: ${activeEmail}`}
            badge={
              isEmergency ? (
                <GMKBadge variant="danger">Emergency View Mode</GMKBadge>
              ) : (
                <GMKBadge variant="primary">
                  {(profile?.roles?.includes('super_admin') || activeEmail === 'thesadmingmk@gmail.com') ? 'GMK SUPER ADMINISTRATOR' : 'GMK ADMINISTRATOR'}
                </GMKBadge>
              )
            }
          />
          
          {/* Prominent, Large Navigation Buttons above the green accent bar */}
          <div className="flex flex-wrap items-center gap-2 md:gap-3">
            <button
              onClick={() => {
                setMainTab('administration');
                if (activeTab === 'log_center') {
                  setActiveTab('approvals');
                }
                setIsCreating(false);
              }}
              className={`flex-1 sm:flex-initial px-5 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all cursor-pointer border text-center shadow-xs font-sans ${
                mainTab === 'administration' 
                  ? 'bg-[#0f4c2a] text-white border-[#0f4c2a] shadow-md shadow-emerald-950/15' 
                  : 'bg-white text-stone-700 border-stone-250 hover:bg-stone-50 hover:text-stone-900'
              }`}
            >
              Administration
            </button>
            <button
              onClick={() => {
                setMainTab('log_center');
                setActiveTab('log_center');
                setIsCreating(false);
              }}
              className={`flex-1 sm:flex-initial px-5 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all cursor-pointer border text-center shadow-xs font-sans ${
                mainTab === 'log_center' 
                  ? 'bg-[#0f4c2a] text-white border-[#0f4c2a] shadow-md shadow-emerald-950/15' 
                  : 'bg-white text-stone-700 border-stone-250 hover:bg-stone-50 hover:text-stone-900'
              }`}
            >
              Log Center
            </button>
            <button
              onClick={() => {
                setMainTab('system');
                setIsCreating(false);
              }}
              className={`flex-1 sm:flex-initial px-5 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all cursor-pointer border text-center shadow-xs font-sans ${
                mainTab === 'system' 
                  ? 'bg-[#0f4c2a] text-white border-[#0f4c2a] shadow-md shadow-emerald-950/15' 
                  : 'bg-white text-stone-700 border-stone-250 hover:bg-stone-50 hover:text-stone-900'
              }`}
            >
              System Settings
            </button>

            {isEmergency && (
              <button
                onClick={handleExitEmergency}
                className="flex-1 sm:flex-initial px-5 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all cursor-pointer bg-amber-700 hover:bg-amber-800 text-white flex items-center justify-center space-x-1.5 shadow-md font-sans sm:ml-auto"
                title="Terminate Emergency Admin Mode"
              >
                <LogOut className="w-4 h-4" />
                <span>Exit Emergency</span>
              </button>
            )}
          </div>

          {/* Admin Colored Accent Line */}
          <div className="h-1.5 w-full bg-gradient-to-r from-[#0F4C2A] via-emerald-400 to-[#0F4C2A] rounded-full shadow-[0_1px_4px_rgba(16,185,129,0.2)]" />
        </div>
      )}

      {/* Info notification lines */}
      {errorMsg && (
        <div className="bg-red-50 border-b border-red-200 px-6 py-3 text-red-800 text-xs font-bold text-center flex items-center justify-center space-x-2">
          <X className="w-4 h-4 text-red-600 cursor-pointer shrink-0" onClick={() => setErrorMsg(null)} />
          <span>{errorMsg}</span>
        </div>
      )}
      {successMsg && (
        <div className="bg-emerald-50 border-b border-emerald-200 px-6 py-3 text-emerald-800 text-xs font-bold text-center flex items-center justify-center space-x-2">
          <Check className="w-4 h-4 text-emerald-600 cursor-pointer shrink-0" onClick={() => setSuccessMsg(null)} />
          <span>{successMsg}</span>
        </div>
      )}

      {deletionReport && (
        <div className="max-w-7xl mx-auto mx-4 mt-4 bg-stone-50 border border-stone-200 rounded-lg p-4 font-mono text-xs text-stone-700 shadow-xs">
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

      {/* Main content grid area */}
      <div className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 space-y-6">

        {/* Administration Sub-navigation */}
        {mainTab === 'administration' && (
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 border-b border-stone-200 pb-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => {
                  setActiveTab('approvals');
                  setIsCreating(false);
                  setHighlightedPendingUid(null);
                }}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold tracking-wide transition-all cursor-pointer ${
                  activeTab === 'approvals'
                    ? 'bg-emerald-50 text-[#0f4c2a] border border-emerald-250 shadow-2xs'
                    : 'bg-stone-50 hover:bg-stone-100 text-stone-600 border border-stone-200'
                }`}
              >
                Approvals ({pendingRegs.length})
              </button>
              <button
                onClick={() => {
                  setActiveTab('residents');
                  setIsCreating(false);
                  setHighlightedPendingUid(null);
                }}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold tracking-wide transition-all cursor-pointer ${
                  activeTab === 'residents'
                    ? 'bg-emerald-50 text-[#0f4c2a] border border-emerald-250 shadow-2xs'
                    : 'bg-stone-50 hover:bg-stone-100 text-stone-600 border border-stone-200'
                }`}
              >
                Residents ({activeResidents.length})
              </button>
              <button
                onClick={() => {
                  setActiveTab('archived');
                  setIsCreating(false);
                  setHighlightedPendingUid(null);
                }}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold tracking-wide transition-all cursor-pointer ${
                  activeTab === 'archived'
                    ? 'bg-emerald-50 text-[#0f4c2a] border border-emerald-250 shadow-2xs'
                    : 'bg-stone-50 hover:bg-stone-100 text-stone-600 border border-stone-200'
                }`}
              >
                Archived ({archivedResidents.length})
              </button>
              <button
                onClick={() => {
                  setActiveTab('add_resident');
                  setIsCreating(true);
                  setHighlightedPendingUid(null);
                }}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold tracking-wide transition-all cursor-pointer ${
                  activeTab === 'add_resident'
                    ? 'bg-emerald-50 text-[#0f4c2a] border border-emerald-250 shadow-2xs'
                    : 'bg-stone-50 hover:bg-stone-100 text-stone-600 border border-stone-200'
                }`}
              >
                Add Resident
              </button>
            </div>

            {/* Compact Autocomplete/Autosuggest Predictive Search */}
            <div className="relative w-full md:w-80">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-stone-500 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={predictiveQuery}
                  onChange={(e) => {
                    setPredictiveQuery(e.target.value);
                    setShowPredictiveDropdown(true);
                  }}
                  onFocus={() => setShowPredictiveDropdown(true)}
                  placeholder="Predictive Search (Name, Unit, Email, GMK ID)..."
                  className="w-full bg-stone-50 text-stone-900 pl-9 pr-8 py-1.5 text-xs font-semibold border border-stone-250 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0f4c2a] focus:border-[#0f4c2a]"
                />
                {predictiveQuery && (
                  <button
                    onClick={() => {
                      setPredictiveQuery('');
                      setShowPredictiveDropdown(false);
                    }}
                    className="absolute right-2.5 top-2 hover:text-stone-900 text-stone-400 p-0.5"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Autocomplete / Autosuggest Suggestions Dropdown */}
              {showPredictiveDropdown && getPredictiveSuggestions().length > 0 && (
                <>
                  <div 
                    className="fixed inset-0 z-30" 
                    onClick={() => setShowPredictiveDropdown(false)} 
                  />
                  <div className="absolute top-full right-0 left-0 mt-1 bg-white border border-stone-250 rounded-xl shadow-lg z-40 max-h-64 overflow-y-auto py-1 divide-y divide-stone-100">
                    {getPredictiveSuggestions().map((suggestion) => (
                      <button
                        key={`${suggestion.type}-${suggestion.id}`}
                        onClick={() => {
                          setSearchTerm(''); // reset manual search filters to avoid state collision
                          if (suggestion.type === 'pending') {
                            setActiveTab('approvals');
                            setHighlightedPendingUid(suggestion.id);
                            setIsCreating(false);
                          } else {
                            setActiveTab(suggestion.type === 'active' ? 'residents' : 'archived');
                            setSelectedResident(suggestion.original);
                            setIsCreating(false);
                            setIsEditing(false);
                          }
                          setPredictiveQuery('');
                          setShowPredictiveDropdown(false);
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-stone-50 flex items-start gap-2 transition-colors cursor-pointer"
                      >
                        <div className="mt-0.5 shrink-0">
                          {suggestion.type === 'pending' ? (
                            <Clock className="w-3.5 h-3.5 text-amber-500" />
                          ) : suggestion.type === 'archived' ? (
                            <Archive className="w-3.5 h-3.5 text-stone-400" />
                          ) : (
                            <UserCheck className="w-3.5 h-3.5 text-[#0f4c2a]" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1.5">
                            <span className="text-xs font-extrabold text-stone-900 truncate">
                              {suggestion.name}
                            </span>
                            <span className={`text-[8px] font-extrabold uppercase px-1 rounded shrink-0 ${
                              suggestion.type === 'pending' ? 'bg-amber-50 text-amber-800 border border-amber-200' :
                              suggestion.type === 'archived' ? 'bg-stone-100 text-stone-600 font-bold' :
                              'bg-emerald-50 text-emerald-800 border border-emerald-150 font-bold'
                            }`}>
                              {suggestion.type === 'pending' ? 'Pending' : suggestion.type}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-[10px] text-stone-500 font-mono mt-0.5">
                            <span className="truncate">{suggestion.unit}</span>
                            {suggestion.type !== 'pending' && (
                              <span className="shrink-0 font-bold">{suggestion.id}</span>
                            )}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Global Tab Search Header */}
        {mainTab === 'administration' && activeTab !== 'approvals' && activeTab !== 'add_resident' && (
          <div className="bg-white border border-stone-250 p-4 rounded-3xl flex items-center justify-between gap-4">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-stone-600 absolute left-3.5 top-3" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={
                  activeTab === 'residents' ? "Search Active Residents database by Name, Email, Unit, GMK ID..." :
                  activeTab === 'units' ? "Filter Units by Unit Number, Unit Type, Status, or Assigned Owner Name..." :
                  "Search Archived Residents historical register by Name, Unit, GMK ID..."
                }
                className="w-full bg-stone-50/50 pl-10 pr-4 py-2 text-stone-900 border border-stone-250 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0f4c2a] focus:border-[#0f4c2a] text-xs font-medium"
              />
            </div>
            {searchTerm && (
              <button 
                onClick={() => setSearchTerm('')}
                className="text-stone-600 hover:text-stone-900 font-bold text-xs"
              >
                Clear
              </button>
            )}
          </div>
        )}

        {/* LOADING INDICATOR */}
        {loading && (
          <div className="py-24 text-center">
            <RefreshCw className="w-8 h-8 text-[#0f4c2a] animate-spin mx-auto opacity-75" />
            <p className="text-xs font-semibold text-stone-600 mt-2 font-mono">Synchronizing databases...</p>
          </div>
        )}

        {/* A. APPROVALS TAB CONTAINER */}
        {!loading && mainTab === 'administration' && activeTab === 'approvals' && (
          <div className="space-y-6">
            <div className="bg-white border border-stone-200 shadow-sm p-6 rounded-3xl">
              <div className="flex items-center space-x-2 pb-4 border-b border-stone-150 mb-4">
                <Clock className="w-5 h-5 text-[#d4af37]" />
                <h3 className="text-base font-extrabold text-[#0f4c2a] font-heading">Onboarding verification Queue</h3>
              </div>

              {pendingRegs.length === 0 ? (
                <div className="py-12 text-center bg-stone-50 rounded-2xl border border-stone-200 border-dashed">
                  <UserCheck className="w-10 h-10 text-stone-300 mx-auto mb-2" />
                  <h4 className="text-sm font-extrabold text-stone-750">Registration Queue Clear</h4>
                  <p className="text-[11px] text-stone-600 font-medium mt-0.5">No pending resident profiles are waiting for review at this time.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {pendingRegs.map((pending) => {
                    const isHighlighted = pending.uid === highlightedPendingUid;
                    return (
                      <div 
                        key={pending.uid} 
                        className={`p-5 rounded-3xl flex flex-col justify-between space-y-4 transition-all relative ${
                          isHighlighted 
                            ? 'bg-emerald-50/40 border-2 border-[#0f4c2a] shadow-md shadow-emerald-950/10' 
                            : 'bg-stone-50/50 border border-stone-250/80 hover:border-emerald-600/35'
                        }`}
                      >
                        {isHighlighted && (
                          <div className="absolute -top-2.5 -right-2 bg-[#0f4c2a] text-white font-extrabold text-[8px] uppercase tracking-widest px-2 py-0.5 rounded-full shadow-xs animate-pulse">
                            Selected Target
                          </div>
                        )}
                        <div className="space-y-2">
                        <div className="flex items-start justify-between">
                          <div>
                            <span className="text-[10px] font-extrabold uppercase bg-[#0f4c2a]/10 text-[#0f4c2a] px-2 py-0.5 rounded-md">
                              {pending.unitType}
                            </span>
                            <h4 className="text-sm font-extrabold text-stone-900 font-heading mt-1">
                              {pending.salutation}. {pending.fullName}
                            </h4>
                          </div>
                          <span className="text-[10px] font-mono text-stone-600 font-extrabold">
                            {new Date(pending.createdAt).toLocaleDateString()}
                          </span>
                        </div>

                        <div className="text-[11px] font-semibold text-stone-700 space-y-1 bg-white p-3 rounded-2xl border border-stone-200 border-dashed">
                          <div><span className="text-stone-600">Primary Unit:</span> <span className="text-stone-900 font-extrabold font-serif">{pending.displayUnitNumber}</span></div>
                          <div><span className="text-stone-600">Email:</span> <span className="text-stone-900 font-mono font-bold select-all">{pending.email}</span></div>
                          <div><span className="text-stone-600">Mobile:</span> <span className="text-stone-900 select-all font-bold">{formatPhoneWithCountryCode(pending.phone)}</span></div>
                          {pending.gatedCommunity && (
                            <div><span className="text-stone-600">Location:</span> <span className="text-[#0f4c2a] font-bold font-serif">{normalizeGatedCommunity(pending.gatedCommunity)}</span></div>
                          )}
                        </div>
                      </div>

                      <div className="flex gap-2 pt-2 border-t border-stone-200">
                        <button
                          onClick={() => handleApproveRegistration(pending)}
                          disabled={isApproving}
                          className="flex-1 inline-flex items-center justify-center space-x-1.5 py-2 px-3 border border-emerald-600 bg-[#0f4c2a] hover:bg-[#125831] text-white rounded-xl text-xs font-bold cursor-pointer transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Check className="w-3.5 h-3.5 text-[#d4af37]" />
                          <span>{isApproving ? 'Verifying...' : 'Verify & Approve'}</span>
                        </button>
                        <button
                          onClick={() => handleTriggerRejectionModal(pending)}
                          disabled={isApproving}
                          className="inline-flex items-center justify-center py-2 px-3 border border-red-200 bg-red-50 hover:bg-red-100 hover:border-red-300 text-red-700 rounded-xl text-xs font-bold cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <X className="w-3.5 h-3.5 shrink-0" />
                          <span className="hidden sm:inline ml-1">Reject</span>
                        </button>
                      </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* B. ACTIVE RESIDENTS TAB */}
        {!loading && mainTab === 'administration' && activeTab === 'residents' && (
          <div className="space-y-4">
            {/* Onboarding / Registration Summary HUD */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div 
                onClick={() => setResidentFilter('all')}
                className={`p-4 rounded-2xl flex items-center justify-between shadow-xs cursor-pointer border transition-all ${
                  residentFilter === 'all'
                    ? 'bg-emerald-50 border-emerald-300 ring-2 ring-emerald-200/20'
                    : 'bg-white border-stone-200 hover:border-stone-300'
                }`}
              >
                <div>
                  <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#0f4c2a] block">All Residents</span>
                  <strong className="text-xl font-extrabold text-stone-850 block mt-0.5">{activeResidents.length}</strong>
                  <span className="text-[9.5px] text-stone-600 font-semibold block">Total active community profiles</span>
                </div>
                <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-[#0f4c2a] shrink-0">
                  <Users className="w-5 h-5" />
                </div>
              </div>

              <div 
                onClick={() => setResidentFilter('registered')}
                className={`p-4 rounded-2xl flex items-center justify-between shadow-xs cursor-pointer border transition-all ${
                  residentFilter === 'registered'
                    ? 'bg-emerald-50 border-emerald-300 ring-2 ring-emerald-200/20'
                    : 'bg-white border-stone-200 hover:border-stone-300'
                }`}
              >
                <div>
                  <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#0f4c2a] block">Registered Residents</span>
                  <strong className="text-xl font-extrabold text-stone-850 block mt-0.5">{registeredCount}</strong>
                  <span className="text-[9.5px] text-stone-600 font-semibold block">Onboarding complete & active portal login</span>
                </div>
                <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-[#0f4c2a] shrink-0">
                  <UserCheck className="w-5 h-5" />
                </div>
              </div>

              <div 
                onClick={() => setResidentFilter('pending')}
                className={`p-4 rounded-2xl flex items-center justify-between shadow-xs cursor-pointer border transition-all ${
                  residentFilter === 'pending'
                    ? 'bg-amber-50 border-amber-300 ring-2 ring-amber-200/20'
                    : 'bg-white border-stone-200 hover:border-stone-300'
                }`}
              >
                <div>
                  <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-amber-850 block">Activation Pending</span>
                  <strong className="text-xl font-extrabold text-stone-850 block mt-0.5">{notRegisteredCount}</strong>
                  <span className="text-[9.5px] text-stone-600 font-semibold block">Approved, awaiting password setup</span>
                </div>
                <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 shrink-0">
                  <Clock className="w-5 h-5" />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Left list of Residents */}
              <div className="lg:col-span-1 bg-white border border-stone-250 p-4 rounded-3xl space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-extrabold text-[#0f4c2a] font-heading uppercase tracking-wide">Active Residents Registry ({filteredActiveResidents.length})</h3>
                </div>
                
                {filteredActiveResidents.length === 0 ? (
                  <p className="text-[11px] text-stone-600 font-medium py-12 text-center">No residents match search criteria.</p>
                ) : (
                  <div className="space-y-2 overflow-y-auto max-h-[500px]">
                    {filteredActiveResidents.map(res => {
                      const isRegistered = users.some(u => u.email.toLowerCase().trim() === res.email.toLowerCase().trim() && u.isActive);
                      return (
                        <button
                          key={res.gmkId}
                          onClick={() => {
                            setSelectedResident(res);
                            setIsEditing(false); // reset edit state
                            setIsCreating(false); // reset creation state
                          }}
                          className={`w-full text-left p-3 rounded-2xl border text-xs flex items-center justify-between transition-all font-semibold ${
                            selectedResident?.gmkId === res.gmkId 
                              ? 'bg-[#0f4c2a] text-white border-[#0f4c2a] shadow-sm' 
                              : 'bg-stone-50 hover:bg-stone-100/70 border-stone-200 text-stone-750'
                          }`}
                        >
                          <div className="space-y-0.5 truncate pr-2">
                            <div className="font-extrabold truncate font-heading">{res.salutation}. {res.fullName}</div>
                            <div className="flex items-center space-x-1.5 flex-wrap gap-y-0.5">
                              <span className={`font-mono text-[9.5px] ${selectedResident?.gmkId === res.gmkId ? 'text-emerald-100' : 'text-stone-600'}`}>{res.gmkId}</span>
                              <span className={`${selectedResident?.gmkId === res.gmkId ? 'text-emerald-200' : 'text-stone-400'} text-[9px]`}>•</span>
                              <span className={`text-[9.5px] font-bold ${
                                isRegistered 
                                  ? (selectedResident?.gmkId === res.gmkId ? 'text-emerald-200' : 'text-emerald-700') 
                                  : (selectedResident?.gmkId === res.gmkId ? 'text-amber-200' : 'text-amber-600')
                              }`}>
                                {isRegistered ? '🟢 Registered' : '🟠 Not Registered'}
                              </span>
                            </div>
                          </div>
                          <span className={`text-[10px] shrink-0 font-extrabold px-2 py-0.5 rounded-full ${
                            selectedResident?.gmkId === res.gmkId 
                              ? 'bg-white/20 text-white font-serif' 
                              : 'bg-emerald-50 text-[#0f4c2a] border border-emerald-100 font-serif'
                          }`}>
                            {res.displayUnitNumber}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

            {/* Right details of Selected Resident */}
            <div className="lg:col-span-2 space-y-6">
              {!selectedResident ? (
                <div className="bg-white border border-stone-250 p-12 rounded-3xl text-center flex flex-col justify-center items-center h-full min-h-[350px]">
                  <Users className="w-12 h-12 text-stone-300 mb-2" />
                  <h4 className="text-sm font-extrabold text-stone-750">No Resident Selected</h4>
                  <p className="text-[11px] text-stone-600 font-medium mt-1">Select a resident from the directory on the left to review or edit details, track profession categories, view unit information, or update archive records.</p>
                </div>
              ) : (
                <div className="bg-white border border-stone-250 p-6 rounded-3xl space-y-6 animate-fadeIn">
                  
                  {/* Header info bar */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-stone-150 pb-4 gap-4">
                    <div>
                      <div className="flex items-center space-x-2.5">
                        <span className="text-[10px] font-mono font-extrabold px-2 py-0.5 bg-stone-100 border border-stone-200 rounded-md text-stone-600">
                          {selectedResident.gmkId}
                        </span>
                        <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full leading-none ${
                          selectedResident.status === 'active' 
                            ? 'bg-emerald-50 text-[#0f4c2a] border border-emerald-100' 
                            : 'bg-amber-50 text-amber-850 border border-amber-200'
                        }`}>
                          {selectedResident.status}
                        </span>
                        <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full leading-none border ${
                          users.some(u => u.email.toLowerCase().trim() === selectedResident.email.toLowerCase().trim() && u.isActive)
                            ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                            : 'bg-amber-100 text-amber-800 border-amber-200'
                        }`}>
                          {users.some(u => u.email.toLowerCase().trim() === selectedResident.email.toLowerCase().trim() && u.isActive) 
                            ? '🟢 Registered' 
                            : '🟠 Not Registered'}
                        </span>
                      </div>
                      <h3 className="text-lg font-extrabold text-[#0f4c2a] font-heading mt-2">
                        {selectedResident.salutation}. {selectedResident.fullName}
                      </h3>
                      <p className="text-[11px] text-stone-600 font-semibold mt-0.5">
                        Profile created: {new Date(selectedResident.createdAt).toLocaleDateString()}
                      </p>
                    </div>

                    {!isEditing && (
                      <div className="flex items-center space-x-2 shrink-0">
                        <button
                          onClick={() => handleStartEditing(selectedResident)}
                          className="inline-flex items-center space-x-1.5 py-1.5 px-3 border border-stone-300 bg-white hover:bg-stone-50 text-stone-700 hover:text-stone-900 rounded-lg text-xs font-bold cursor-pointer transition-all shadow-sm"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                          <span>Edit Details</span>
                        </button>
                        <button
                          onClick={() => handleArchiveResident(selectedResident)}
                          className="inline-flex items-center space-x-1.5 py-1.5 px-3 border border-red-200 bg-red-50 hover:bg-red-100 hover:border-red-300 text-red-700 rounded-lg text-xs font-bold cursor-pointer transition-all"
                        >
                          <Archive className="w-3.5 h-3.5" />
                          <span>Archive Resident</span>
                        </button>
                        {activeEmail === 'thesadmingmk@gmail.com' && (
                          <button
                            onClick={() => handleDeleteResident(selectedResident)}
                            className="inline-flex items-center space-x-1.5 py-1.5 px-3 border border-rose-200 bg-rose-50 hover:bg-rose-100 hover:border-rose-300 text-rose-700 rounded-lg text-xs font-bold cursor-pointer transition-all"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Purge Resident</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* LOADING DETAILS INDICATOR */}
                  {loadingDetails ? (
                    <div className="py-12 text-center">
                      <RefreshCw className="w-6 h-6 text-[#0f4c2a] animate-spin mx-auto opacity-75" />
                      <p className="text-[10px] font-semibold text-stone-600 mt-1 font-mono">Fetching household sync...</p>
                    </div>
                  ) : (
                    <>
                      {/* VIEW MODE DETAILS PANEL */}
                      {!isEditing && (
                        <div className="space-y-6">
                          
                          {/* Part 1: Residential Unit assignment & Contact information */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="bg-stone-50 border border-stone-250 p-4 rounded-2xl space-y-2">
                              <h4 className="text-[10px] font-extrabold uppercase text-stone-600 tracking-wider flex items-center gap-1.5">
                                <Building2 className="w-3.5 h-3.5 text-[#d4af37]" />
                                <span>Unit Assignment</span>
                              </h4>
                              <div className="space-y-1.5 text-xs font-semibold text-stone-700">
                                <div>Unit Type: <span className="text-stone-900 font-extrabold">{selectedResident.unitType || 'Apartment'}</span></div>
                                <div>Unit Code: <span className="text-[#0f4c2a] font-extrabold font-serif text-sm">{selectedResident.displayUnitNumber}</span></div>
                                <div>Normal Key: <span className="text-stone-900 font-mono text-[10px] font-bold">{selectedResident.unitKey}</span></div>
                              </div>
                            </div>
                            
                            <div className="bg-stone-50 border border-stone-250 p-4 rounded-2xl space-y-2">
                              <h4 className="text-[10px] font-extrabold uppercase text-stone-600 tracking-wider flex items-center gap-1.5">
                                <Mail className="w-3.5 h-3.5 text-stone-500" />
                                <span>Contact Details</span>
                              </h4>
                              <div className="space-y-1.5 text-xs font-semibold text-stone-700">
                                <div className="flex items-center gap-1">
                                  <span>Email:</span>
                                  <span className="text-stone-950 font-mono text-[11px] font-bold select-all truncate">{selectedResident.email}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <span>Mobile:</span>
                                  <span className="text-stone-950 font-bold select-all">{formatPhoneWithCountryCode(selectedResident.phone)}</span>
                                </div>
                                <p className="text-[10px] italic text-[#0f4c2a] font-semibold mt-1">Credentials verification managed via Firebase Authentication engine only.</p>
                                
                                {!users.some(u => u.email.toLowerCase().trim() === selectedResident.email.toLowerCase().trim() && u.isActive) && (
                                  <div className="mt-2.5 p-2 bg-amber-50 border border-amber-200/60 rounded-xl text-[10px] text-amber-850 font-bold flex items-center gap-1.5 animate-fadeIn">
                                    <Clock className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                                    <span>Awaiting account activation. Send reminder to {selectedResident.email}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Part 2: Profession Info from split decoupled profile */}
                          <div className="bg-stone-50 border border-stone-250 p-4 rounded-2xl space-y-2">
                            <h4 className="text-[10px] font-extrabold uppercase text-stone-600 tracking-wider flex items-center gap-1.5">
                              <Briefcase className="w-3.5 h-3.5 text-[#d4af37]" />
                              <span>Profession Information</span>
                            </h4>
                            {selectedFamily ? (
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs font-semibold text-stone-700 pt-1">
                                <div className="p-2.5 bg-white border border-stone-200 rounded-xl">
                                  <div className="text-[9.5px] uppercase font-bold text-stone-600 mb-0.5">Category</div>
                                  <div className="text-stone-950 font-extrabold">{selectedFamily.professionCategory || 'None Specified'}</div>
                                </div>
                                <div className="p-2.5 bg-white border border-stone-200 rounded-xl">
                                  <div className="text-[9.5px] uppercase font-bold text-stone-600 mb-0.5">Role Title</div>
                                  <div className="text-stone-950 font-extrabold">{selectedFamily.professionTitle || 'Not disclosed'}</div>
                                </div>
                                <div className="p-2.5 bg-white border border-stone-200 rounded-xl">
                                  <div className="text-[9.5px] uppercase font-bold text-stone-600 mb-0.5">Company</div>
                                  <div className="text-stone-950 font-extrabold">{selectedFamily.company || 'Not disclosed'}</div>
                                </div>
                              </div>
                            ) : (
                              <p className="text-[10px] text-stone-600 italic">No associated decoupled family profile registered yet. It will synchronize automatically upon first onboarding wizard step.</p>
                            )}
                          </div>

                          {/* Part 3: Decoupled Family composition listing - strictly read only */}
                          <div className="bg-amber-50/40 border border-amber-200/80 p-4 rounded-2xl space-y-3">
                            <h4 className="text-[10px] font-extrabold uppercase text-amber-900 tracking-wider flex items-center gap-1.5 h-4">
                              <Users className="w-3.5 h-3.5 text-amber-700" />
                              <span>Household Members List (Read Only)</span>
                            </h4>
                            
                            {householdMembers.length === 0 ? (
                              <p className="text-[10.5px] text-stone-650 font-semibold italic">There are no spouse, children, or parent records registered in this household profile yet.</p>
                            ) : (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {householdMembers.map(member => (
                                  <div key={member.id} className="bg-white p-2.5 border border-stone-200 rounded-xl text-[11px] font-semibold flex items-center justify-between">
                                    <div>
                                      <div className="text-stone-900 font-extrabold">{member.name}</div>
                                      <div className="text-[9.5px] text-stone-600 font-semibold uppercase">{member.relationship}</div>
                                    </div>
                                    {member.yearOfBirth && (
                                      <span className="text-[9.5px] px-2 py-0.5 bg-stone-100 rounded text-stone-600 font-extrabold">YoB: {member.yearOfBirth}</span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}

                            <div className="flex items-start space-x-1.5 text-[9.5px] text-amber-800 font-semibold bg-white p-3 rounded-xl border border-amber-200/50 mt-2">
                              <Info className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                              <p className="leading-relaxed">
                                Household family details are personal residential assets and remain strictly under resident control through the Family Profile Builder. direct Admin creation or mutation is disabled.
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* EDIT MODE FORM COMPONENT */}
                      {isEditing && (
                        <div className="space-y-4 border border-stone-150 p-4 rounded-2xl bg-stone-50/30 animate-fadeIn text-xs">
                          <h4 className="text-xs font-bold text-[#0f4c2a] uppercase tracking-wider pb-2 border-b border-stone-250 mb-3 flex items-center space-x-1">
                            <Sliders className="w-4 h-4 text-[#d4af37]" />
                            <span>Modify Resident Profile</span>
                          </h4>

                          {/* Section A: Resident details */}
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div>
                              <label className="block text-[9.5px] uppercase font-bold tracking-wider text-stone-705 mb-1">Salutation</label>
                              <select
                                value={editSalutation}
                                onChange={(e) => setEditSalutation(e.target.value as any)}
                                className="block w-full px-2.5 py-1.5 border border-stone-200 rounded-lg text-xs bg-white focus:outline-none"
                              >
                                <option value="Mr">Mr</option>
                                <option value="Mrs">Mrs</option>
                                <option value="Ms">Ms</option>
                                <option value="Mstr">Mstr</option>
                                <option value="Dr">Dr</option>
                              </select>
                            </div>
                            <div className="sm:col-span-2">
                              <label className="block text-[9.5px] uppercase font-bold tracking-wider text-stone-705 mb-1">Full Name</label>
                              <input
                                type="text"
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                className="block w-full px-2.5 py-1.5 border border-stone-200 rounded-lg text-xs bg-white focus:outline-none"
                              />
                            </div>
                          </div>

                          {/* Section B: Contact & status details */}
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div className="sm:col-span-2">
                              <label className="block text-[9.5px] uppercase font-bold tracking-wider text-stone-705 mb-1">Email Address</label>
                              <input
                                type="email"
                                value={editEmail}
                                onChange={(e) => setEditEmail(e.target.value)}
                                className="block w-full px-2.5 py-1.5 border border-stone-200 rounded-lg text-xs bg-white focus:outline-none placeholder-stone-400 font-mono"
                              />
                            </div>
                            <div>
                              <label className="block text-[9.5px] uppercase font-bold tracking-wider text-stone-705 mb-1">Mobile (+968)</label>
                              <input
                                type="text"
                                maxLength={8}
                                value={editPhone}
                                onChange={(e) => setEditPhone(e.target.value.replace(/\D/g, ''))}
                                className="block w-full px-2.5 py-1.5 border border-stone-200 rounded-lg text-xs bg-white focus:outline-none font-bold"
                              />
                            </div>
                          </div>

                          {/* Section C: Unit allocation & Normalization inputs */}
                          <div className="bg-white border border-stone-200 p-3.5 rounded-xl space-y-3">
                            <div className="flex items-center justify-between">
                              <label className="block text-[9.5px] uppercase font-extrabold text-stone-600 tracking-wider">Unit Assignment Setup</label>
                              <select
                                value={editUnitType}
                                onChange={(e) => {
                                  setEditUnitType(e.target.value as any);
                                  setEditFlatNo('');
                                  setEditAptBuilding('');
                                  setEditAptSection('');
                                  setEditAptFlat('');
                                }}
                                className="px-2 py-0.5 border border-stone-200 rounded bg-stone-50 text-[10px] font-bold"
                              >
                                <option value="Apartment">Apartment</option>
                                <option value="Villa">Villa</option>
                                <option value="Townhouse">Townhouse</option>
                              </select>
                            </div>

                            {editUnitType === 'Apartment' ? (
                              <div className="flex items-center space-x-2">
                                <div className="flex-1">
                                  <span className="text-[9.5px] text-stone-600 block mb-0.5">Building</span>
                                  <input
                                    ref={buildingRef}
                                    type="text"
                                    value={editAptBuilding}
                                    onChange={(e) => handleBuildingChange(e.target.value)}
                                    className="block w-full px-2 py-1.5 text-center border border-stone-200 rounded-lg text-xs font-bold"
                                  />
                                </div>
                                <span className="text-stone-550 font-extrabold self-end pb-1.5">-</span>
                                <div className="flex-1">
                                  <span className="text-[9.5px] text-stone-600 block mb-0.5">Section</span>
                                  <input
                                    ref={sectionRef}
                                    type="text"
                                    value={editAptSection}
                                    onChange={(e) => handleSectionChange(e.target.value)}
                                    className="block w-full px-2 py-1.5 text-center border border-stone-200 rounded-lg text-xs font-bold"
                                  />
                                </div>
                                <span className="text-stone-550 font-extrabold self-end pb-1.5">-</span>
                                <div className="flex-1">
                                  <span className="text-[9.5px] text-stone-600 block mb-0.5">Flat</span>
                                  <input
                                    ref={flatRef}
                                    type="text"
                                    value={editAptFlat}
                                    onChange={(e) => handleFlatChange(e.target.value)}
                                    className="block w-full px-2 py-1.5 text-center border border-stone-200 rounded-lg text-xs font-bold"
                                  />
                                </div>
                              </div>
                            ) : (
                              <div>
                                <span className="text-[9.5px] text-stone-600 block mb-0.5">{editUnitType === 'Villa' ? 'Villa Number' : 'Townhouse Number'}</span>
                                <input
                                  type="text"
                                  value={editFlatNo}
                                  onChange={(e) => setEditFlatNo(e.target.value.replace(/\D/g, ''))}
                                  className="block w-full px-2.5 py-1.5 border border-stone-200 rounded-lg text-xs font-bold"
                                />
                              </div>
                            )}

                            {/* Verify Preview Normalized Unit */}
                            {editFlatNo && (() => {
                              const norm = normalizeUnit(editUnitType, editFlatNo);
                              return norm.isValid ? (
                                <div className="bg-emerald-50 text-[#0f4c2a] rounded-lg p-2 text-[10px] font-semibold text-center border border-emerald-100">
                                  <strong>Normalized preview:</strong> {norm.displayUnitNumber}
                                </div>
                              ) : (
                                <div className="bg-rose-50 text-rose-800 rounded-lg p-2 text-[10px] font-semibold text-center border border-rose-100">
                                  <strong>⚠️ Format error:</strong> {norm.error}
                                </div>
                              );
                            })()}
                          </div>

                          {/* Section D: Profession updates */}
                          <div className="bg-white border border-stone-200 p-3.5 rounded-xl space-y-3">
                            <label className="block text-[9.5px] uppercase font-extrabold text-stone-600 tracking-wider">Profession details</label>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                              <div>
                                <span className="text-[9.5px] text-stone-600 block mb-0.5">Category</span>
                                <input
                                  type="text"
                                  value={editProfessionCategory}
                                  onChange={(e) => setEditProfessionCategory(e.target.value)}
                                  placeholder="Engineer/Doctor/etc."
                                  className="block w-full px-2.5 py-1.5 border border-[#ced4da] rounded-lg text-xs"
                                />
                              </div>
                              <div>
                                <span className="text-[9.5px] text-stone-600 block mb-0.5">Title</span>
                                <input
                                  type="text"
                                  value={editProfessionTitle}
                                  onChange={(e) => setEditProfessionTitle(e.target.value)}
                                  placeholder="Senior Consultant"
                                  className="block w-full px-2.5 py-1.5 border border-[#ced4da] rounded-lg text-xs"
                                />
                              </div>
                              <div>
                                <span className="text-[9.5px] text-stone-600 block mb-0.5">Company</span>
                                <input
                                  type="text"
                                  value={editCompany}
                                  onChange={(e) => setEditCompany(e.target.value)}
                                  placeholder="Ministry/PDO/etc."
                                  className="block w-full px-2.5 py-1.5 border border-[#ced4da] rounded-lg text-xs"
                                />
                              </div>
                            </div>
                          </div>

                          {/* Section E: Status edit */}
                          <div>
                            <label className="block text-[9.5px] uppercase font-bold tracking-wider text-stone-705 mb-1">Status Mode</label>
                            <select
                              value={editStatus}
                              onChange={(e) => setEditStatus(e.target.value as any)}
                              className="block w-full px-2.5 py-1.5 border border-stone-200 rounded-lg text-xs bg-white focus:outline-none"
                            >
                              <option value="active">Active (Access Enabled)</option>
                              <option value="inactive">Inactive (Access Blocked temporarily)</option>
                            </select>
                          </div>

                          {/* Submit buttons */}
                          <div className="flex gap-2 pt-2 border-t border-stone-200">
                            <button
                              onClick={handleSaveResidentEdits}
                              className="flex-1 inline-flex items-center justify-center space-x-1.5 py-2 px-4 bg-[#0f4c2a] hover:bg-[#125831] text-white rounded-xl text-xs font-bold font-heading shadow-md cursor-pointer transition-colors"
                            >
                              <Check className="w-3.5 h-3.5 text-[#d4af37]" />
                              <span>Save Changes</span>
                            </button>
                            <button
                              onClick={() => setIsEditing(false)}
                              className="inline-flex items-center justify-center py-2 px-4 border border-stone-300 bg-white hover:bg-stone-50 text-stone-700 rounded-xl text-xs font-bold cursor-pointer transition-colors"
                            >
                              <span>Cancel</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

        {/* D. ARCHIVED HISTORICAL REFERENCE WORKSPACE */}
        {!loading && mainTab === 'administration' && activeTab === 'archived' && (
          <div className="bg-white border border-stone-200 shadow-sm p-6 rounded-3xl space-y-4">
            <div className="flex items-center space-x-2 pb-4 border-b border-stone-150 mb-2">
              <Archive className="w-5 h-5 text-stone-600" />
              <h3 className="text-base font-extrabold text-[#0f4c2a] font-heading">Historical Archive register</h3>
            </div>

            <p className="text-stone-700 text-xs font-semibold leading-relaxed">
              Archived records are strictly decoupled from community directories and active onboarding queues. They remain logged here for reference, tracking, and restoration.
            </p>

            {filteredArchivedResidents.length === 0 ? (
              <div className="py-16 text-center bg-stone-50 border border-stone-200 border-dashed rounded-2xl">
                <Users className="w-8 h-8 text-stone-300 mx-auto mb-2" />
                <h4 className="text-xs font-bold text-stone-750 uppercase">Archive Register Empty</h4>
                <p className="text-[11px] text-stone-600 font-semibold mt-0.5">No archived resident profiles were detected matching search requests.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredArchivedResidents.map((res) => (
                  <div key={res.gmkId} className="bg-stone-50/60 border border-stone-250 p-4 rounded-3xl flex flex-col justify-between space-y-4">
                    <div className="space-y-2">
                      <div className="flex items-start justify-between">
                        <div>
                          <span className="text-[10px] uppercase font-mono font-bold text-stone-600 bg-stone-200/50 px-2 py-0.5 rounded">
                            {res.gmkId}
                          </span>
                          <h4 className="text-sm font-extrabold text-stone-900 font-heading mt-1">{res.salutation}. {res.fullName}</h4>
                        </div>
                        <span className="text-[10.5px] font-extrabold text-stone-800 font-serif bg-white border border-stone-250 px-2.5 py-0.5 rounded-lg">
                          Unit: {res.displayUnitNumber}
                        </span>
                      </div>

                      <div className="text-[10.5px] bg-white border border-stone-150 p-3 rounded-2xl text-stone-705 space-y-1">
                        <div><span className="font-semibold text-stone-600">Email:</span> <span className="font-mono text-stone-900">{res.email}</span></div>
                        <div><span className="font-semibold text-stone-600">Phone:</span> <span className="text-stone-900 font-bold">{formatPhoneWithCountryCode(res.phone)}</span></div>
                        {res.remarks && (
                          <div className="text-[10px] text-amber-850 italic border-t border-stone-150 pt-1 mt-1 font-bold">
                            Reason: {res.remarks}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="pt-2 border-t border-stone-200 flex flex-col sm:flex-row gap-2">
                      <button
                        onClick={() => handleRestoreResident(res)}
                        className="flex-1 inline-flex items-center justify-center space-x-1.5 py-2 px-3 border border-emerald-600 bg-[#0f4c2a] hover:bg-[#125831] text-white rounded-xl text-xs font-bold cursor-pointer transition-colors shadow-sm"
                      >
                        <UserCheck className="w-3.5 h-3.5 text-[#d4af37]" />
                        <span>Restore / Unarchive Resident</span>
                      </button>
                      <button
                        onClick={() => handleDeleteResident(res)}
                        className="inline-flex items-center justify-center space-x-1.5 py-2 px-3 border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-xl text-xs font-bold cursor-pointer transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete Permanently</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* F. ADD RESIDENT WORKSPACE */}
        {!loading && mainTab === 'administration' && activeTab === 'add_resident' && (
          <div className="bg-white border border-stone-250 p-6 rounded-3xl max-w-3xl mx-auto space-y-4 animate-fadeIn">
            <div className="flex justify-between items-center pb-3 border-b border-stone-150">
              <h3 className="text-base font-extrabold text-[#0f4c2a] font-heading uppercase tracking-wide">Add New Verified Resident</h3>
              <button 
                onClick={() => {
                  setActiveTab('residents');
                  setIsCreating(false);
                }}
                className="text-stone-500 hover:text-stone-850 text-xs font-bold font-mono transition-colors"
              >
                [Cancel]
              </button>
            </div>

            <form onSubmit={handleCreateResidentFromScratch} className="space-y-4 text-xs font-semibold">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-stone-600 mb-1">Salutation</label>
                  <GMKSelect
                    value={createSalutation}
                    onChange={(e) => setCreateSalutation(e.target.value as any)}
                  >
                    <option value="Mr">Mr</option>
                    <option value="Mrs">Mrs</option>
                    <option value="Ms">Ms</option>
                    <option value="Mstr">Mstr</option>
                    <option value="Dr">Dr</option>
                  </GMKSelect>
                </div>

                <div>
                  <label className="block text-[10px] uppercase font-bold text-stone-600 mb-1">Unit Type</label>
                  <GMKSelect
                    value={createUnitType}
                    onChange={(e) => setCreateUnitType(e.target.value as any)}
                  >
                    <option value="Apartment">Apartment</option>
                    <option value="Villa">Villa</option>
                    <option value="Townhouse">Townhouse</option>
                  </GMKSelect>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-stone-600 mb-1">
                    {createUnitType === 'Apartment' ? 'Apartment (Building-Section-Flat)' : createUnitType === 'Villa' ? 'Villa Number' : 'Townhouse Number'}
                  </label>
                  <GMKInput
                    type="text"
                    required
                    value={createFlatNo}
                    onChange={(e) => setCreateFlatNo(e.target.value)}
                    placeholder=""
                  />
                </div>

                <div>
                  <label className="block text-[10px] uppercase font-bold text-stone-600 mb-1">Permanent ID (Sequential)</label>
                  <GMKInput
                    type="text"
                    required
                    value={createGmkId}
                    onChange={(e) => setCreateGmkId(e.target.value)}
                  />
                </div>
              </div>

              {createFlatNo && (() => {
                const norm = normalizeUnit(createUnitType, createFlatNo);
                return norm.isValid ? (
                  <div className="bg-emerald-50 text-[#0f4c2a] border border-emerald-100 p-2.5 rounded-xl text-xs flex justify-between">
                    <span>✨ <strong>Normalized Code:</strong> {norm.displayUnitNumber}</span>
                    <span className="font-mono text-[10px]">Key: {norm.unitKey}</span>
                  </div>
                ) : (
                  <div className="bg-red-50 text-red-700 border border-red-100 p-2.5 rounded-xl text-xs">
                    ⚠️ <strong>Validation Reject:</strong> {norm.error}
                  </div>
                );
              })()}

              <div>
                <label className="block text-[10px] uppercase font-bold text-stone-600 mb-1">Legal Resident Name</label>
                <GMKInput
                  type="text"
                  required
                  value={createFullName}
                  onChange={(e) => setCreateFullName(e.target.value)}
                  placeholder="Enter legal name"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-stone-600 mb-1">Email Address</label>
                  <GMKInput
                    type="email"
                    required
                    value={createEmail}
                    onChange={(e) => setCreateEmail(e.target.value)}
                    placeholder="resident@example.com"
                  />
                </div>

                <div>
                  <label className="block text-[10px] uppercase font-bold text-stone-600 mb-1">Primary Phone Number (Oman)</label>
                  <GMKInput
                    type="text"
                    required
                    maxLength={8}
                    value={createPhone}
                    onChange={(e) => setCreatePhone(e.target.value.replace(/\D/g, '').slice(0, 8))}
                    placeholder="e.g. 91234567"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold text-stone-600 mb-1">Remarks</label>
                <textarea
                  value={createRemarks}
                  onChange={(e) => setCreateRemarks(e.target.value)}
                  rows={2}
                  className="w-full border border-stone-250 hover:border-stone-400 focus:border-[#0f4c2a] rounded-2xl p-3 bg-white text-stone-900 focus:outline-none transition-all placeholder:text-stone-400 font-sans text-xs font-semibold"
                  placeholder="Additional remarks or notes..."
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <GMKButton
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setActiveTab('residents');
                    setIsCreating(false);
                  }}
                >
                  Cancel
                </GMKButton>
                <GMKButton
                  type="submit"
                  variant="primary"
                >
                  Create Resident
                </GMKButton>
              </div>
            </form>
          </div>
        )}

        {/* E. LOG CENTER WORKSPACE */}
        {!loading && mainTab === 'log_center' && (
          <div className="bg-white border border-stone-200 p-6 rounded-3xl animate-fadeIn shadow-sm">
            <LogCenter />
          </div>
        )}

        {/* F. SYSTEM SETTINGS WORKSPACE */}
        {!loading && mainTab === 'system' && (
          <div className="bg-white border border-stone-200 p-6 rounded-3xl animate-fadeIn shadow-sm space-y-6">
            <div className="border-b border-[#0F4C2A]/10 pb-4">
              <h2 className="text-xl font-serif text-[#0F4C2A] font-bold">SYSTEM SETTINGS & INFORMATION</h2>
              <p className="text-xs text-stone-500 font-sans">Platform indicators and secure environment telemetry</p>
            </div>

            {/* Platform Indicators Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-stone-50 border border-stone-200 p-4 rounded-xl space-y-1">
                <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-stone-500 block">Platform Version</span>
                <strong className="text-sm font-sans font-bold text-[#0F4C2A] block">v1.12.0 (Stable)</strong>
              </div>

              <div className="bg-stone-50 border border-stone-200 p-4 rounded-xl space-y-1">
                <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-stone-500 block">Firebase Status</span>
                <strong className="text-sm font-sans font-bold text-[#0F4C2A] block">Active / Connected</strong>
              </div>

              <div className="bg-stone-50 border border-stone-200 p-4 rounded-xl space-y-1">
                <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-stone-500 block">Firestore Status</span>
                <strong className="text-sm font-sans font-bold text-[#0F4C2A] block">Active / Operational</strong>
              </div>

              <div className="bg-stone-50 border border-stone-200 p-4 rounded-xl space-y-1">
                <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-stone-500 block">Total Residents</span>
                <strong className="text-sm font-sans font-bold text-stone-900 block">{residents.length}</strong>
              </div>
            </div>

            {/* Support Information */}
            <div className="bg-emerald-50/50 border border-emerald-150 rounded-2xl p-4 flex items-center gap-3">
              <ShieldCheck className="w-5 h-5 text-[#0f4c2a] shrink-0" />
              <div>
                <div className="text-xs font-bold text-[#0F4C2A]">Admin Security Access: VERIFIED</div>
                <p className="text-[10.5px] text-stone-650 mt-0.5 leading-snug">
                  You are authorized with Greens Malayalee Koottayma (GMK) administrator access. Credentials and role restrictions are governed by the association board.
                </p>
              </div>
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
                          <Check className="w-4 h-4 text-emerald-600" />
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
                          {diagResult.referencedInRoles.map((item: any, idx: number) => (
                            <div key={`ref-role-${idx}`} className="text-purple-700">
                              [Role Assignment] Active as position '{item.position}' (Email: {item.email}).
                            </div>
                          ))}
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
        )}

      </div>

      {/* REJECTION DEDUCTION DIALOG MODAL */}
      {rejectionPending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-950/40 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white border border-stone-300 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-5">
            <div className="flex items-center space-x-2 pb-2 border-b border-stone-150">
              <UserX className="w-5 h-5 text-red-600" />
              <h3 className="text-sm font-extrabold text-stone-900 uppercase">Reject Registration Inquiry</h3>
            </div>

            <p className="text-stone-600 text-xs font-semibold leading-relaxed">
              Verify the grounds for rejecting the registration request of <strong>{rejectionPending.fullName}</strong> for unit <strong>{rejectionPending.displayUnitNumber}</strong>:
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-[9.5px] uppercase font-bold tracking-wider text-stone-705 mb-1">Standard rejection reason</label>
                <select
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  className="block w-full px-3 py-2 border border-stone-200 rounded-xl text-xs bg-stone-50 focus:outline-none focus:ring-1 focus:ring-[#0f4c2a]"
                >
                  <option value="">-Select-</option>
                  <option value="Incomplete Registration Details">Incomplete Registration Details</option>
                  <option value="Incorrect Residential Unit Code">Incorrect Residential Unit Code</option>
                  <option value="Duplicate Request Submitted">Duplicate Request Submitted</option>
                  <option value="Custom">Custom / Other grounds</option>
                </select>
              </div>

              {rejectionReason === 'Custom' && (
                <div className="animate-fadeIn">
                  <label className="block text-[9.5px] uppercase font-bold tracking-wider text-stone-705 mb-1">Detailed rejection description</label>
                  <textarea
                    required
                    rows={3}
                    value={customRejection}
                    onChange={(e) => setCustomRejection(e.target.value)}
                    placeholder="Provide specific notes why registration was refused..."
                    className="block w-full px-3 py-2 border border-[#ced4da] rounded-xl text-xs bg-stone-50 placeholder-stone-400 focus:outline-none"
                  />
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-2 border-t border-stone-200">
              <button
                onClick={handleConfirmRejection}
                className="flex-1 inline-flex items-center justify-center py-2 px-4 bg-red-700 hover:bg-red-800 text-white rounded-xl text-xs font-bold cursor-pointer transition-colors shadow"
              >
                Reject Request
              </button>
              <button
                onClick={() => setRejectionPending(null)}
                className="inline-flex items-center justify-center py-2 px-4 border border-stone-300 bg-white text-stone-700 rounded-xl text-xs font-bold cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DELETE RESIDENT WORKFLOW MODAL */}
      {confirmDeleteResident && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-950/40 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white border border-stone-300 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-5">
            <div className="flex items-center space-x-2 pb-2 border-b border-stone-150">
              <Trash2 className="w-5 h-5 text-red-600" />
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

            <div className="space-y-1">
              <label className="block text-[9.5px] uppercase font-bold tracking-wider text-stone-705 mb-1">Reason for Deletion (Optional)</label>
              <input
                type="text"
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                placeholder="e.g. Moved out, lease expired, incorrect profile..."
                className="block w-full px-3 py-2 border border-stone-200 rounded-xl text-xs bg-stone-50 placeholder-stone-400 focus:outline-none focus:ring-1 focus:ring-[#0f4c2a]"
              />
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
                onClick={() => {
                  setConfirmDeleteResident(null);
                  setDeleteReason('');
                }}
                className="inline-flex items-center justify-center py-2 px-4 border border-stone-300 bg-white text-stone-700 rounded-xl text-xs font-bold cursor-pointer hover:bg-stone-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unified Platform Version Footer */}
      <footer className="py-6 border-t border-stone-250 text-center text-xs font-sans text-stone-500 shrink-0 space-y-1">
        <div>
          Resident Administration Portal • Developed by Elite IT
        </div>
        <div>
          Platform Version: <button type="button" onClick={() => setIsReleaseModalOpen(true)} className="font-extrabold text-[#0f4c2a] hover:text-[#125831] underline cursor-pointer">v1.4.2 (Release Notes)</button>
        </div>
      </footer>

      <ReleaseNotesModal isOpen={isReleaseModalOpen} onClose={() => setIsReleaseModalOpen(false)} />

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
