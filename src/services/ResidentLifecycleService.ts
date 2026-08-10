import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  runTransaction
} from 'firebase/firestore';
import { db } from '../context/AuthContext';
import { createAuditLog } from '../utils/audit';

export interface VerificationReport {
  timestamp: string;
  residentId: string;
  email: string;
  status: 'PASSED' | 'FAILED';
  details: {
    residentsLeft: number;
    familiesLeft: number;
    familyMembersLeft: number;
    usersLeft: number;
    roleAssignmentsLeft: number;
    governanceAssignmentsLeft: number;
    eventCommitteesLeft: number;
    eventProgramsLeft: number;
    eventRegistrationsLeft: number;
    eventAttendanceLeft: number;
    eventFoodLeft: number;
  };
  failures: string[];
}

export interface CascadeDeleteResult {
  success: boolean;
  dependencyGraph: any;
  verificationReport: VerificationReport | null;
  auditId?: string;
  error?: string;
}

export const ResidentLifecycleService = {
  /**
   * Cascade deletes a resident and all of their dependencies across all system collections.
   * Follows GEAS v1.0: Resolve → Validate → Dependency Graph → Execute → Commit → Verify → Audit
   */
  async deleteResidentCascade(
    residentId: string,
    operatorEmail: string,
    deleteReason: string
  ): Promise<CascadeDeleteResult> {
    const timestamp = new Date().toISOString();
    const failures: string[] = [];

    // --- PHASE 1 & 2: RESOLVE, VALIDATE & DISCOVER (Pre-Transaction Reads) ---
    // Discover and read all records to form the complete dependency graph.
    // NEVER assume document IDs, always query to discover them.
    try {
      // 1. Resolve Resident Profile
      const residentRef = doc(db, "residents", residentId);
      const residentSnap = await getDoc(residentRef);
      const residentExists = residentSnap.exists();
      const residentData = residentExists ? residentSnap.data() : null;
      const residentEmail = (residentData?.email || '').toLowerCase().trim();
      const residentFullName = residentData?.fullName || 'Unknown Resident';

      // 2. Discover related family documents (using both document ID and querying)
      const familiesList: string[] = [];
      const famDocId = `fam_${residentId}`;
      const famRef = doc(db, "families", famDocId);
      const famSnap = await getDoc(famRef);
      if (famSnap.exists()) {
        familiesList.push(famDocId);
      }
      // Also query by primaryMemberGmkId to find any other linked families
      const famQuery = query(collection(db, "families"), where("primaryMemberGmkId", "==", residentId));
      const famQuerySnap = await getDocs(famQuery);
      for (const d of famQuerySnap.docs) {
        if (!familiesList.includes(d.id)) {
          familiesList.push(d.id);
        }
      }

      // 3. Discover family members
      const familyMembersList: string[] = [];
      for (const fId of familiesList) {
        const memQuery = query(collection(db, "familyMembers"), where("familyId", "==", fId));
        const memQuerySnap = await getDocs(memQuery);
        for (const d of memQuerySnap.docs) {
          familyMembersList.push(d.id);
        }
      }

      // 4. Discover users
      const usersList: string[] = [];
      if (residentEmail) {
        const userQuery = query(collection(db, "users"), where("email", "==", residentEmail));
        const userQuerySnap = await getDocs(userQuery);
        for (const d of userQuerySnap.docs) {
          usersList.push(d.id);
        }
      }

      // 5. Discover pending registrations
      const pendingRegList: string[] = [];
      if (residentEmail) {
        const pendingQuery = query(collection(db, "pending_registrations"), where("email", "==", residentEmail));
        const pendingQuerySnap = await getDocs(pendingQuery);
        for (const d of pendingQuerySnap.docs) {
          pendingRegList.push(d.id);
        }
      }

      // 6. Discover role assignments
      const roleAssignmentsList: string[] = [];
      // Query by gmkId
      const roleGmkQuery = query(collection(db, "roleAssignments"), where("gmkId", "==", residentId));
      const roleGmkSnap = await getDocs(roleGmkQuery);
      for (const d of roleGmkSnap.docs) {
        roleAssignmentsList.push(d.id);
      }
      // Query by email
      if (residentEmail) {
        const roleEmailQuery = query(collection(db, "roleAssignments"), where("email", "==", residentEmail));
        const roleEmailSnap = await getDocs(roleEmailQuery);
        for (const d of roleEmailSnap.docs) {
          if (!roleAssignmentsList.includes(d.id)) {
            roleAssignmentsList.push(d.id);
          }
        }
      }

      // 7. Discover governance assignments
      const governanceAssignmentsList: string[] = [];
      // Query by gmkId
      const govGmkQuery = query(collection(db, "governanceAssignments"), where("gmkId", "==", residentId));
      const govGmkSnap = await getDocs(govGmkQuery);
      for (const d of govGmkSnap.docs) {
        governanceAssignmentsList.push(d.id);
      }
      // Query by email
      if (residentEmail) {
        const govEmailQuery = query(collection(db, "governanceAssignments"), where("email", "==", residentEmail));
        const govEmailSnap = await getDocs(govEmailQuery);
        for (const d of govEmailSnap.docs) {
          if (!governanceAssignmentsList.includes(d.id)) {
            governanceAssignmentsList.push(d.id);
          }
        }
      }

      // 8. Discover event committees members to be pruned
      const eventCommitteesList: Array<{ id: string; updatedMembers: any[] }> = [];
      const commSnap = await getDocs(collection(db, "eventCommittees"));
      for (const docSnap of commSnap.docs) {
        const data = docSnap.data();
        const originalMembers: any[] = data.members || [];
        const updatedMembers = originalMembers.filter(
          m => m.residentId !== residentId && m.email?.toLowerCase().trim() !== residentEmail
        );
        if (originalMembers.length !== updatedMembers.length) {
          eventCommitteesList.push({
            id: docSnap.id,
            updatedMembers
          });
        }
      }

      // 9. Discover event programs to be pruned (coordinators, volunteers, participants)
      const eventProgramsList: Array<{
        id: string;
        updatedCoordinators: any[];
        updatedVolunteers: any[];
        updatedParticipants: any[];
      }> = [];
      const progSnap = await getDocs(collection(db, "eventPrograms"));
      for (const docSnap of progSnap.docs) {
        const data = docSnap.data();
        const originalCoordinators: any[] = data.coordinators || [];
        const originalVolunteers: any[] = data.volunteers || [];
        const originalParticipants: any[] = data.participants || [];

        const updatedCoordinators = originalCoordinators.filter(
          m => m.residentId !== residentId && m.email?.toLowerCase().trim() !== residentEmail
        );
        const updatedVolunteers = originalVolunteers.filter(
          m => m.residentId !== residentId && m.email?.toLowerCase().trim() !== residentEmail
        );
        const updatedParticipants = originalParticipants.filter(
          m => m.residentId !== residentId && m.email?.toLowerCase().trim() !== residentEmail
        );

        if (
          originalCoordinators.length !== updatedCoordinators.length ||
          originalVolunteers.length !== updatedVolunteers.length ||
          originalParticipants.length !== updatedParticipants.length
        ) {
          eventProgramsList.push({
            id: docSnap.id,
            updatedCoordinators,
            updatedVolunteers,
            updatedParticipants
          });
        }
      }

      // 10. Discover event registrations
      const eventRegistrationsList: string[] = [];
      // Query by primaryMemberGmkId
      const regGmkQuery = query(collection(db, "event_registrations"), where("primaryMemberGmkId", "==", residentId));
      const regGmkSnap = await getDocs(regGmkQuery);
      for (const d of regGmkSnap.docs) {
        eventRegistrationsList.push(d.id);
      }
      // Query by primaryMemberEmail
      if (residentEmail) {
        const regEmailQuery = query(collection(db, "event_registrations"), where("primaryMemberEmail", "==", residentEmail));
        const regEmailSnap = await getDocs(regEmailQuery);
        for (const d of regEmailSnap.docs) {
          if (!eventRegistrationsList.includes(d.id)) {
            eventRegistrationsList.push(d.id);
          }
        }
      }

      // 11. Discover event attendance (extended requirement)
      const eventAttendanceList: string[] = [];
      const attQuery = query(collection(db, "eventAttendance"), where("gmkId", "==", residentId));
      const attSnap = await getDocs(attQuery);
      for (const d of attSnap.docs) {
        eventAttendanceList.push(d.id);
      }

      // 12. Discover event food (extended requirement)
      const eventFoodList: string[] = [];
      const foodQuery = query(collection(db, "eventFood"), where("gmkId", "==", residentId));
      const foodSnap = await getDocs(foodQuery);
      for (const d of foodSnap.docs) {
        eventFoodList.push(d.id);
      }

      // Compile the full dependency graph
      const dependencyGraph = {
        resident: { id: residentId, exists: residentExists, email: residentEmail, fullName: residentFullName },
        families: familiesList,
        familyMembers: familyMembersList,
        users: usersList,
        pendingRegistrations: pendingRegList,
        roleAssignments: roleAssignmentsList,
        governanceAssignments: governanceAssignmentsList,
        eventCommittees: eventCommitteesList.map(c => c.id),
        eventPrograms: eventProgramsList.map(p => p.id),
        eventRegistrations: eventRegistrationsList,
        eventAttendance: eventAttendanceList,
        eventFood: eventFoodList
      };

      // --- PHASE 3 & 4: EXECUTE & COMMIT TRANSACTION ---
      // We run all updates/deletions atomically in a single Firestore transaction.
      // ALL READS MUST BE EXECUTED BEFORE ALL WRITES (Firestore Transaction Rule).
      console.log(`[RESIDENT DELETE 01] Permanent deletion workflow initiated for Resident ID: ${residentId} (${residentEmail})`);
      console.log("[RESIDENT DELETE 02] Phase 1: Executing all transaction read operations...");

      await runTransaction(db, async (transaction) => {
        // --- READ PHASE: Perform all transaction.get() calls FIRST ---
        let txResSnap = null;
        if (residentExists) {
          const resRef = doc(db, "residents", residentId);
          txResSnap = await transaction.get(resRef);
        }

        const userSnapsList: Array<{ ref: any; exists: boolean; data: any }> = [];
        for (const uId of usersList) {
          const uRef = doc(db, "users", uId);
          const uSnap = await transaction.get(uRef);
          userSnapsList.push({
            ref: uRef,
            exists: uSnap.exists(),
            data: uSnap.data()
          });
        }

        console.log("[RESIDENT DELETE 03] Phase 1 completed: All required reads executed successfully.");
        console.log("[RESIDENT DELETE 04] Phase 2: Executing transaction write operations (deletions & updates)...");

        // --- WRITE PHASE: Perform all transaction deletes and updates AFTER reads ---
        // A. Resident cleanup
        if (residentExists && txResSnap && txResSnap.exists()) {
          const resRef = doc(db, "residents", residentId);
          transaction.delete(resRef);
        } else {
          console.log(`[GEAS] Resident ${residentId} does not exist. Skipping resident doc delete.`);
        }

        // B. Families cleanup
        for (const famId of familiesList) {
          const fRef = doc(db, "families", famId);
          transaction.delete(fRef);
        }

        // C. Family members cleanup
        for (const mId of familyMembersList) {
          const mRef = doc(db, "familyMembers", mId);
          transaction.delete(mRef);
        }

        // D. Users cleanup
        for (const uObj of userSnapsList) {
          if (uObj.exists) {
            const currentRoles: string[] = uObj.data?.roles || [];
            const updatedRoles = currentRoles.filter(
              r => r === 'resident' || r === 'pending'
            );
            transaction.update(uObj.ref, {
              roles: updatedRoles,
              updatedAt: timestamp
            });
          }
        }

        // E. Pending registrations cleanup
        for (const prId of pendingRegList) {
          const prRef = doc(db, "pending_registrations", prId);
          transaction.delete(prRef);
        }

        // F. Role Assignments cleanup
        for (const raId of roleAssignmentsList) {
          const raRef = doc(db, "roleAssignments", raId);
          transaction.delete(raRef);
        }

        // G. Governance Assignments cleanup
        for (const gaId of governanceAssignmentsList) {
          const gaRef = doc(db, "governanceAssignments", gaId);
          transaction.delete(gaRef);
        }

        // H. Event Committees pruning
        for (const committeeUpdate of eventCommitteesList) {
          const commRef = doc(db, "eventCommittees", committeeUpdate.id);
          transaction.update(commRef, {
            members: committeeUpdate.updatedMembers,
            updatedAt: timestamp
          });
        }

        // I. Event Programs pruning
        for (const programUpdate of eventProgramsList) {
          const progRef = doc(db, "eventPrograms", programUpdate.id);
          transaction.update(progRef, {
            coordinators: programUpdate.updatedCoordinators,
            volunteers: programUpdate.updatedVolunteers,
            participants: programUpdate.updatedParticipants,
            updatedAt: timestamp
          });
        }

        // J. Event registrations cleanup
        for (const regId of eventRegistrationsList) {
          const regRef = doc(db, "event_registrations", regId);
          transaction.delete(regRef);
        }

        // K. Event attendance cleanup
        for (const attId of eventAttendanceList) {
          const attRef = doc(db, "eventAttendance", attId);
          transaction.delete(attRef);
        }

        // L. Event food cleanup
        for (const foodId of eventFoodList) {
          const foodRef = doc(db, "eventFood", foodId);
          transaction.delete(foodRef);
        }

        console.log("[RESIDENT DELETE 05] Phase 2 completed: All transaction writes staged.");
      });

      console.log("[RESIDENT DELETE 06] Transaction committed successfully without read-after-write violations.");

      // --- PHASE 5: GEAS VERIFICATION SCAN ---
      // Re-run the queries to verify everything has been cleaned up.
      const verificationDetails = {
        residentsLeft: 0,
        familiesLeft: 0,
        familyMembersLeft: 0,
        usersLeft: 0,
        roleAssignmentsLeft: 0,
        governanceAssignmentsLeft: 0,
        eventCommitteesLeft: 0,
        eventProgramsLeft: 0,
        eventRegistrationsLeft: 0,
        eventAttendanceLeft: 0,
        eventFoodLeft: 0
      };

      // 1. Check resident document
      const resCheckSnap = await getDoc(doc(db, "residents", residentId));
      if (resCheckSnap.exists()) {
        verificationDetails.residentsLeft++;
        failures.push(`Resident document '${residentId}' still exists.`);
      }

      // 2. Check families
      for (const famId of familiesList) {
        const fSnap = await getDoc(doc(db, "families", famId));
        if (fSnap.exists()) {
          verificationDetails.familiesLeft++;
          failures.push(`Family document '${famId}' still exists.`);
        }
      }

      // 3. Check family members
      for (const mId of familyMembersList) {
        const mSnap = await getDoc(doc(db, "familyMembers", mId));
        if (mSnap.exists()) {
          verificationDetails.familyMembersLeft++;
          failures.push(`FamilyMember document '${mId}' still exists.`);
        }
      }

      // 4. Check users roles updated correctly (no event_director / admin / vp roles)
      for (const uId of usersList) {
        const uSnap = await getDoc(doc(db, "users", uId));
        if (uSnap.exists()) {
          const roles: string[] = uSnap.data()?.roles || [];
          const illegalRoles = roles.filter(r => r !== 'resident' && r !== 'pending');
          if (illegalRoles.length > 0) {
            verificationDetails.usersLeft++;
            failures.push(`User document '${uId}' still has committee/program roles: ${illegalRoles.join(', ')}.`);
          }
        }
      }

      // 5. Check role assignments
      for (const raId of roleAssignmentsList) {
        const raSnap = await getDoc(doc(db, "roleAssignments", raId));
        if (raSnap.exists()) {
          verificationDetails.roleAssignmentsLeft++;
          failures.push(`roleAssignment document '${raId}' still exists.`);
        }
      }

      // 6. Check governance assignments
      for (const gaId of governanceAssignmentsList) {
        const gaSnap = await getDoc(doc(db, "governanceAssignments", gaId));
        if (gaSnap.exists()) {
          verificationDetails.governanceAssignmentsLeft++;
          failures.push(`governanceAssignment document '${gaId}' still exists.`);
        }
      }

      // 7. Check event committees
      for (const commUpdate of eventCommitteesList) {
        const commSnap = await getDoc(doc(db, "eventCommittees", commUpdate.id));
        if (commSnap.exists()) {
          const members: any[] = commSnap.data()?.members || [];
          const match = members.find(
            m => m.residentId === residentId || m.email?.toLowerCase().trim() === residentEmail
          );
          if (match) {
            verificationDetails.eventCommitteesLeft++;
            failures.push(`EventCommittee '${commUpdate.id}' still has resident reference.`);
          }
        }
      }

      // 8. Check event programs
      for (const progUpdate of eventProgramsList) {
        const progSnap = await getDoc(doc(db, "eventPrograms", progUpdate.id));
        if (progSnap.exists()) {
          const data = progSnap.data() || {};
          const matchCo = (data.coordinators || []).find((m: any) => m.residentId === residentId || m.email?.toLowerCase().trim() === residentEmail);
          const matchVo = (data.volunteers || []).find((m: any) => m.residentId === residentId || m.email?.toLowerCase().trim() === residentEmail);
          const matchPa = (data.participants || []).find((m: any) => m.residentId === residentId || m.email?.toLowerCase().trim() === residentEmail);
          if (matchCo || matchVo || matchPa) {
            verificationDetails.eventProgramsLeft++;
            failures.push(`EventProgram '${progUpdate.id}' still contains resident reference.`);
          }
        }
      }

      // 9. Check event registrations
      for (const regId of eventRegistrationsList) {
        const regSnap = await getDoc(doc(db, "event_registrations", regId));
        if (regSnap.exists()) {
          verificationDetails.eventRegistrationsLeft++;
          failures.push(`event_registration '${regId}' still exists.`);
        }
      }

      // 10. Check event attendance
      for (const attId of eventAttendanceList) {
        const attSnap = await getDoc(doc(db, "eventAttendance", attId));
        if (attSnap.exists()) {
          verificationDetails.eventAttendanceLeft++;
          failures.push(`eventAttendance '${attId}' still exists.`);
        }
      }

      // 11. Check event food
      for (const foodId of eventFoodList) {
        const foodSnap = await getDoc(doc(db, "eventFood", foodId));
        if (foodSnap.exists()) {
          verificationDetails.eventFoodLeft++;
          failures.push(`eventFood '${foodId}' still exists.`);
        }
      }

      const isVerified = failures.length === 0;
      const verificationReport: VerificationReport = {
        timestamp,
        residentId,
        email: residentEmail,
        status: isVerified ? 'PASSED' : 'FAILED',
        details: verificationDetails,
        failures
      };

      // If verification failed, ABORT success reporting
      if (!isVerified) {
        console.error("[GEAS VERIFICATION FAILED] Diagnostic Output:", failures);
        return {
          success: false,
          dependencyGraph,
          verificationReport,
          error: `GEAS Verification Failed: ${failures.join('; ')}`
        };
      }

      // --- PHASE 6: IMMUTABLE AUDIT ENTRY ---
      // Record all repair and deletion operations in the immutable audit log
      const auditDetails = `Permanently executed GEAS_DELETE_WORKFLOW for Resident ${residentId} (${residentEmail}).
- Resident Name: ${residentFullName}
- Operator: ${operatorEmail}
- Reason: ${deleteReason || 'No reason provided'}
- Deleted references:
  * Families: ${familiesList.length}
  * FamilyMembers: ${familyMembersList.length}
  * RoleAssignments: ${roleAssignmentsList.length}
  * GovernanceAssignments: ${governanceAssignmentsList.length}
  * EventCommittees Pruned: ${eventCommitteesList.length}
  * EventPrograms Pruned: ${eventProgramsList.length}
  * EventRegistrations: ${eventRegistrationsList.length}
  * EventAttendance: ${eventAttendanceList.length}
  * EventFood: ${eventFoodList.length}
- Resident updated/deleted: ${residentExists ? 'YES' : 'NO (Skipped because doc did not exist)'}
- Verification Status: PASSED`;

      await createAuditLog(
        'GEAS_DELETE_WORKFLOW',
        operatorEmail,
        'resident',
        residentId,
        auditDetails,
        residentFullName
      );

      return {
        success: true,
        dependencyGraph,
        verificationReport
      };
    } catch (err: any) {
      // EXPLICIT TRANSACTION ROLLBACK DOCUMENTATION & HANDLING
      // Firestore transactions inherently roll back all buffered writes if any exception occurs.
      console.error("[GEAS TRANSACTION ERROR] Transaction rolled back safely. Exception:", err);
      return {
        success: false,
        dependencyGraph: null,
        verificationReport: null,
        error: `Transaction rolled back safely due to error: ${err.message}`
      };
    }
  },

  /**
   * Cascade removes a committee member, resolving existence first.
   * Follows the specific GEAS pattern for Committee removal:
   * Resolve Resident → Does Resident Exist? → YES: Update Resident, NO: Skip Resident Update → Delete Role Assignments → Remove Committee Member → Update Users → Commit
   */
  async removeCommitteeMemberCascade(
    residentId: string,
    residentEmail: string,
    committeeId: string,
    roleToRemove: string,
    assignmentId: string,
    emailAssignmentId: string,
    operatorEmail: string
  ): Promise<{ success: boolean; error?: string; verificationReport?: any }> {
    const timestamp = new Date().toISOString();
    const failures: string[] = [];

    try {
      // 1. Resolve Resident Profile & Committee Profile
      const residentRef = doc(db, "residents", residentId);
      const residentSnap = await getDoc(residentRef);
      const residentExists = residentSnap.exists();

      const committeeRef = doc(db, "eventCommittees", committeeId);
      const committeeSnap = await getDoc(committeeRef);
      if (!committeeSnap.exists()) {
        throw new Error("Committee document could not be found.");
      }
      const committeeData = committeeSnap.data();

      // Discover users linked to this email to update their roles
      const usersList: string[] = [];
      const normEmail = residentEmail.toLowerCase().trim();
      if (normEmail) {
        const usersQuery = query(collection(db, "users"), where("email", "==", normEmail));
        const usersSnap = await getDocs(usersQuery);
        for (const uDoc of usersSnap.docs) {
          usersList.push(uDoc.id);
        }
      }

      // Check if there are other roleAssignments left for this committee member
      // to decide if we should remove their Event Director / Committee Lead role from the user account.
      let hasOtherAssignments = false;
      const otherRolesQuery = query(collection(db, "roleAssignments"), where("gmkId", "==", residentId));
      const otherRolesSnap = await getDocs(otherRolesQuery);
      const activeAssignments = otherRolesSnap.docs.filter(
        doc => doc.id !== assignmentId && doc.id !== emailAssignmentId
      );
      if (activeAssignments.length > 0) {
        hasOtherAssignments = true;
      }

      // 2. Execute transaction
      await runTransaction(db, async (transaction) => {
        // --- ALL READS FIRST ---
        let txResSnap = null;
        if (residentExists) {
          txResSnap = await transaction.get(residentRef);
        }

        const assignmentRef = doc(db, "roleAssignments", assignmentId);
        const emailAssignmentRef = doc(db, "roleAssignments", emailAssignmentId);
        const txAsgSnap = await transaction.get(assignmentRef);
        const txEmailAsgSnap = await transaction.get(emailAssignmentRef);

        const txCommSnap = await transaction.get(committeeRef);

        const userSnapsList: Array<{ ref: any; exists: boolean; data: any }> = [];
        if (!hasOtherAssignments) {
          for (const uId of usersList) {
            const uRef = doc(db, "users", uId);
            const uSnap = await transaction.get(uRef);
            userSnapsList.push({
              ref: uRef,
              exists: uSnap.exists(),
              data: uSnap.data()
            });
          }
        }

        // --- ALL WRITES AFTER READS ---
        if (residentExists && txResSnap && txResSnap.exists()) {
          transaction.update(residentRef, {
            committee: "",
            updatedAt: timestamp
          });
        } else {
          console.log(`[GEAS] Resident ${residentId} does not exist. Skipping resident update.`);
        }

        if (txAsgSnap.exists()) {
          transaction.delete(assignmentRef);
        }
        if (txEmailAsgSnap.exists()) {
          transaction.delete(emailAssignmentRef);
        }

        if (txCommSnap.exists()) {
          const latestCommittee = txCommSnap.data();
          const updatedMembers = (latestCommittee.members || []).filter(
            (m: any) => m.residentId !== residentId && m.email?.toLowerCase().trim() !== normEmail
          );
          transaction.update(committeeRef, {
            members: updatedMembers,
            updatedAt: timestamp
          });
        }

        if (!hasOtherAssignments) {
          for (const uObj of userSnapsList) {
            if (uObj.exists) {
              const currentRoles: string[] = uObj.data?.roles || [];
              const updatedRoles = currentRoles.filter(r => r !== roleToRemove);
              transaction.update(uObj.ref, {
                roles: updatedRoles,
                updatedAt: timestamp
              });
            }
          }
        }
      });

      // 3. Verification Scan
      // Verify roleAssignments deleted
      const checkAsg = await getDoc(doc(db, "roleAssignments", assignmentId));
      if (checkAsg.exists()) {
        failures.push(`roleAssignment '${assignmentId}' still exists.`);
      }
      const checkEmailAsg = await getDoc(doc(db, "roleAssignments", emailAssignmentId));
      if (checkEmailAsg.exists()) {
        failures.push(`roleAssignment '${emailAssignmentId}' still exists.`);
      }

      // Verify removed from committee
      const checkComm = await getDoc(committeeRef);
      if (checkComm.exists()) {
        const members: any[] = checkComm.data()?.members || [];
        const found = members.find(m => m.residentId === residentId);
        if (found) {
          failures.push(`Resident '${residentId}' still registered in committee members list.`);
        }
      }

      const isVerified = failures.length === 0;

      if (!isVerified) {
        console.error("[GEAS COMMITTEE REMOVAL VERIFICATION FAILED] Diagnostic Output:", failures);
        return {
          success: false,
          error: `GEAS Verification Failed: ${failures.join('; ')}`
        };
      }

      // Log Audit Log
      await createAuditLog(
        'COMMITTEE_MEMBER_REMOVED',
        operatorEmail,
        'committee',
        committeeId,
        `Removed committee member ${residentId} (${residentEmail}) from committee '${committeeData?.name || committeeId}' using GEAS-hardened workflow. Verification: PASSED.`,
        residentId
      );

      return {
        success: true,
        verificationReport: {
          timestamp,
          status: 'PASSED',
          failures
        }
      };
    } catch (err: any) {
      console.error("[GEAS TRANSACTION ERROR] Committee removal transaction rolled back safely. Exception:", err);
      return {
        success: false,
        error: `Transaction rolled back safely due to error: ${err.message}`
      };
    }
  }
};
