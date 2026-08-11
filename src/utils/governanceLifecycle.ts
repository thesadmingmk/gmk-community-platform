/**
 * Governance Lifecycle & Canonical Normalization Utility (RTCO-COMMITTEE-GOVERNANCE-FIX-010)
 */

export type RoleLifecycleStatus = 'ACTIVE' | 'HISTORICAL' | 'ORPHANED' | 'DUPLICATE' | 'REVOKED';

export interface ClassifiedRoleDoc {
  docId: string;
  gmkId: string;
  email: string;
  position: string;
  committeeStored?: string;
  committeeNormalized: string;
  eventId?: string;
  lifecycleStatus: RoleLifecycleStatus;
  reason: string;
  rawDoc: any;
}

/**
 * Normalizes committee names to their canonical representation at runtime.
 */
export function normalizeCommitteeName(name?: string | null): string {
  if (!name) return '';
  const trimmed = name.trim().toLowerCase();
  if (['event&program', 'event & program', 'program committee', 'programs', 'program'].includes(trimmed)) {
    return 'Program';
  }
  return name.trim();
}

/**
 * Classifies a set of roleAssignment / governanceAssignment raw documents for a target resident,
 * distinguishing ACTIVE governance authority from HISTORICAL, ORPHANED, DUPLICATE, and REVOKED documents.
 */
export function classifyResidentRoleAssignments(
  targetRes: { gmkId?: string; email?: string },
  rawRoleDocs: Array<{ id: string; data: any }>,
  allCommittees: Array<{ id: string; data: any }>,
  allPrograms: Array<{ id: string; data: any }>
): ClassifiedRoleDoc[] {
  const normTargetEmail = (targetRes.email || '').toLowerCase().trim();
  const targetGmkId = (targetRes.gmkId || '').toUpperCase().trim();

  // Step 1: Filter raw docs relevant to target resident
  const relevantDocs = rawRoleDocs.filter(d => {
    const rGmkId = (d.data.gmkId || '').toUpperCase().trim();
    const rEmail = (d.data.email || '').toLowerCase().trim();
    return (targetGmkId && rGmkId === targetGmkId) || (normTargetEmail && rEmail === normTargetEmail);
  });

  const primaryKeysSeen = new Set<string>();
  const classified: ClassifiedRoleDoc[] = [];

  for (const docObj of relevantDocs) {
    const docId = docObj.id;
    const data = docObj.data;
    const position = data.position || data.role || 'member';
    const rawCommittee = data.committee || data.committeeName || '';
    const normCommittee = normalizeCommitteeName(rawCommittee);
    const eventId = data.eventId || '';
    const docStatus = (data.status || '').toUpperCase().trim();

    const gmkId = (data.gmkId || targetGmkId).toUpperCase().trim();
    const email = (data.email || normTargetEmail).toLowerCase().trim();

    // Logical signature to group duplicate / email index entries
    const logicalSignature = `${gmkId}_${position}_${normCommittee}_${eventId}`;

    // A. Check REVOKED state
    if (docStatus === 'REVOKED' || docStatus === 'SUPERSEDED' || data.revokedAt) {
      classified.push({
        docId,
        gmkId,
        email,
        position,
        committeeStored: rawCommittee,
        committeeNormalized: normCommittee,
        eventId,
        lifecycleStatus: 'REVOKED',
        reason: 'Explicitly marked as REVOKED or SUPERSEDED',
        rawDoc: data
      });
      continue;
    }

    // B. Check DUPLICATE state
    const isEmailIndexDoc = docId.startsWith('asg_email_') || docId.includes('_email_');
    if (isEmailIndexDoc || primaryKeysSeen.has(logicalSignature)) {
      classified.push({
        docId,
        gmkId,
        email,
        position,
        committeeStored: rawCommittee,
        committeeNormalized: normCommittee,
        eventId,
        lifecycleStatus: 'DUPLICATE',
        reason: 'Secondary email-key index or duplicate assignment entry',
        rawDoc: data
      });
      primaryKeysSeen.add(logicalSignature);
      continue;
    }

    primaryKeysSeen.add(logicalSignature);

    // C. Verify ACTIVE committee or program authority
    let hasActiveCommitteeMember = false;
    let committeeExists = false;

    for (const cDoc of allCommittees) {
      const cData = cDoc.data;
      const cNormName = normalizeCommitteeName(cData.name || cData.committeeName);

      const eventMatches = !eventId || cData.eventId === eventId;
      if (cNormName && cNormName === normCommittee && eventMatches) {
        committeeExists = true;
        const members: any[] = cData.members || [];
        const isMem = members.some((m: any) => 
          (targetGmkId && (m.residentId === targetGmkId || m.gmkId === targetGmkId)) ||
          (normTargetEmail && m.email && m.email.toLowerCase().trim() === normTargetEmail)
        );
        if (isMem) {
          hasActiveCommitteeMember = true;
          break;
        }
      }
    }

    let hasActiveProgramCoord = false;
    if (position === 'program_coordinator' || normCommittee === 'Program') {
      for (const pDoc of allPrograms) {
        const pData = pDoc.data;
        const coords: any[] = pData.coordinators || [];
        if (coords.some((c: any) => 
          (targetGmkId && (c.residentId === targetGmkId || c.gmkId === targetGmkId)) ||
          (normTargetEmail && c.email && c.email.toLowerCase().trim() === normTargetEmail)
        )) {
          hasActiveProgramCoord = true;
          break;
        }
      }
    }

    const isExplicitActiveFlag = docStatus === 'ACTIVE';
    const isGlobalGovernanceRole = ['admin', 'president', 'vp', 'event_director'].includes(position);

    if (hasActiveCommitteeMember || hasActiveProgramCoord) {
      classified.push({
        docId,
        gmkId,
        email,
        position,
        committeeStored: rawCommittee,
        committeeNormalized: normCommittee,
        eventId,
        lifecycleStatus: 'ACTIVE',
        reason: `Active authority verified in event committee '${normCommittee}'`,
        rawDoc: data
      });
    } else if (isGlobalGovernanceRole && (isExplicitActiveFlag || !docStatus)) {
      classified.push({
        docId,
        gmkId,
        email,
        position,
        committeeStored: rawCommittee,
        committeeNormalized: normCommittee,
        eventId,
        lifecycleStatus: 'ACTIVE',
        reason: `Active global governance role '${position}'`,
        rawDoc: data
      });
    } else if (!committeeExists && (rawCommittee || eventId)) {
      classified.push({
        docId,
        gmkId,
        email,
        position,
        committeeStored: rawCommittee,
        committeeNormalized: normCommittee,
        eventId,
        lifecycleStatus: 'ORPHANED',
        reason: `References committee '${rawCommittee}' or event '${eventId}' that is dormant or no longer exists`,
        rawDoc: data
      });
    } else {
      classified.push({
        docId,
        gmkId,
        email,
        position,
        committeeStored: rawCommittee,
        committeeNormalized: normCommittee,
        eventId,
        lifecycleStatus: 'HISTORICAL',
        reason: `Legacy role assignment with no active membership in committee '${normCommittee || position}'`,
        rawDoc: data
      });
    }
  }

  return classified;
}
