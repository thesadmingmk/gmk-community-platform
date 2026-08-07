/**
 * Governance Exclusivity Foundation (GOV-01A Safeguard)
 * 
 * Enforces role exclusivity:
 * A resident may only hold one governance role at a time, and residents
 * holding any governance role are not eligible for subordinate positions or roles
 * (Committee Head, Program Committee Head, Program Coordinator, Volunteer, Participant)
 * until that governance role is removed.
 * 
 * This architecture is compatible with the hierarchical authority enforcement
 * planned for ADM-03. Future committee and event modules shall inherit these
 * rules and helpers automatically.
 */

import { GovernanceAssignment } from '../types';

export const GOVERNANCE_ROLES = ['admin', 'president', 'vp', 'event_director'] as const;
export type GovernanceRole = typeof GOVERNANCE_ROLES[number];

export const SUBORDINATE_ROLES = [
  'committee_head',
  'program_committee_head',
  'program_coordinator',
  'volunteer',
  'participant'
] as const;
export type SubordinateRole = typeof SUBORDINATE_ROLES[number];

/**
 * Checks if a specific role name is a top-level governance role.
 */
export function isGovernanceRole(role: string): boolean {
  return GOVERNANCE_ROLES.includes(role as any);
}

/**
 * Checks if a specific role is a subordinate role restricted by governance exclusivity.
 */
export function isSubordinateRole(role: string): boolean {
  return SUBORDINATE_ROLES.includes(role as any);
}

/**
 * Returns the active governance role of a resident, if any.
 * Works with either email or gmkId identification.
 */
export function getActiveGovernanceRole(
  identifier: { gmkId?: string; email?: string },
  activeAssignments: GovernanceAssignment[]
): GovernanceAssignment | null {
  const normalizedEmail = identifier.email?.trim().toLowerCase();
  const resGmkId = identifier.gmkId?.trim();

  return activeAssignments.find(ra => {
    const roleMatches = GOVERNANCE_ROLES.includes(ra.position as any);
    if (!roleMatches) return false;

    if (resGmkId && ra.gmkId === resGmkId) return true;
    if (normalizedEmail && ra.email.trim().toLowerCase() === normalizedEmail) return true;

    return false;
  }) || null;
}

interface EligibilityResult {
  eligible: boolean;
  reason?: string;
  activeGovernanceRole?: string;
}

/**
 * Validates whether a resident is eligible to assume a subordinate role/responsibility 
 * (Committee Head, Program Coordinator, Volunteer, Participant, etc.).
 * 
 * Enforces key GOV-01A requirements:
 * "Residents holding any governance role shall not be eligible for:
 *  - Committee Head
 *  - Program Committee Head
 *  - Program Coordinator
 *  - Volunteer
 *  - Participant
 * until the governance role is removed."
 */
export function validateRoleEligibility(
  resident: { gmkId?: string; email?: string; name: string },
  targetRole: SubordinateRole | string,
  activeAssignments: GovernanceAssignment[]
): EligibilityResult {
  const activeGov = getActiveGovernanceRole(resident, activeAssignments);

  if (activeGov) {
    const roleNameFormatted = targetRole.replace(/_/g, ' ').toUpperCase();
    return {
      eligible: false,
      reason: `EXCLUSIVITY VIOLATION: '${resident.name}' holds the active top-level governance role '${activeGov.position.toUpperCase()}'. They are not eligible to be assigned as '${roleNameFormatted}' until their governance role is removed.`,
      activeGovernanceRole: activeGov.position
    };
  }

  return { eligible: true };
}

/**
 * Ensures a resident cannot be assigned a brand new governance role if they already hold another one.
 * (Double-governance role check).
 */
export function validateGovernanceAssignment(
  resident: { gmkId?: string; email?: string; name: string },
  newGovRole: GovernanceRole,
  activeAssignments: GovernanceAssignment[]
): EligibilityResult {
  const activeGov = getActiveGovernanceRole(resident, activeAssignments);

  if (activeGov) {
    if (activeGov.position === newGovRole) {
      return {
        eligible: false,
        reason: `'${resident.name}' already has the '${newGovRole.toUpperCase()}' governance role assigned.`,
        activeGovernanceRole: activeGov.position
      };
    }

    return {
      eligible: false,
      reason: `GOVERNANCE EXCLUSIVITY VIOLATION: '${resident.name}' already holds the governance role '${activeGov.position.toUpperCase()}'. A resident may hold only one governance role at a time. Please remove their current role before assigning '${newGovRole.toUpperCase()}'.`,
      activeGovernanceRole: activeGov.position
    };
  }

  return { eligible: true };
}
