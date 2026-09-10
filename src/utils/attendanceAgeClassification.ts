import { EventRegistration, Family, FamilyMember } from '../types';

export type AuthoritativeFoodCategory = 'Kids 0-3' | 'Kids 4-9' | 'Kids 10+' | 'Adult';

export interface ParticipantAgeClassification {
  age?: number;
  category: AuthoritativeFoodCategory;
  isAdult: boolean;
  isChild: boolean;
  source: string;
}

/**
 * Authoritative Age Classification Helper
 * 
 * Rules:
 * Use authoritative age information in this priority:
 * 1. reg.participantDetails.age
 * 2. reg.participantDetails.yearOfBirth
 * 3. familyMembers.yearOfBirth
 * 4. familyMembers.dateOfBirth
 * 
 * Calculate age using the current year (new Date().getFullYear()).
 * 
 * Classification:
 * - Age 0–3 -> Kids 0-3
 * - Age 4–9 -> Kids 4-9
 * - Age 10–17 -> Kids 10+
 * - Age 18 or older -> Adult
 * 
 * Relationship = "Child" must NOT override the actual age.
 * 
 * If a participant has no authoritative age information:
 * - GMK Member -> Adult
 * - Spouse -> Adult
 * - Parent -> Adult
 * - Other -> Adult
 * - Guest -> Adult
 * 
 * Do NOT guess a person's age.
 */
export function classifyParticipantAge({
  name,
  reg,
  familyMembers = [],
  families = [],
  currentYear = new Date().getFullYear()
}: {
  name: string;
  reg?: EventRegistration | null;
  familyMembers?: FamilyMember[];
  families?: Family[];
  currentYear?: number;
}): ParticipantAgeClassification {
  const norm = (name || '').trim().toLowerCase();
  let calculatedAge: number | undefined = undefined;
  let source = 'none';

  // 1. reg.participantDetails.age
  if (reg?.participantDetails && Array.isArray(reg.participantDetails)) {
    const pd = reg.participantDetails.find(d => (d.name || '').trim().toLowerCase() === norm);
    if (pd) {
      if (typeof pd.age === 'number' && !isNaN(pd.age) && pd.age >= 0) {
        calculatedAge = pd.age;
        source = 'reg.participantDetails.age';
      } else if (pd.age !== undefined && String(pd.age).trim() !== '' && !isNaN(Number(pd.age))) {
        const num = Number(pd.age);
        if (num >= 0) {
          calculatedAge = num;
          source = 'reg.participantDetails.age';
        }
      }

      // 2. reg.participantDetails.yearOfBirth
      if (calculatedAge === undefined && pd.yearOfBirth) {
        const yob = parseInt(String(pd.yearOfBirth).trim(), 10);
        if (!isNaN(yob) && yob > 1900 && yob <= currentYear) {
          calculatedAge = currentYear - yob;
          source = 'reg.participantDetails.yearOfBirth';
        }
      }
    }
  }

  // Find relevant family members for this registration if not yet resolved
  if (calculatedAge === undefined && reg) {
    const gmkId = reg.primaryMemberGmkId || reg.publicReference || reg.id.split('_')?.[1] || '';
    const fam = families.find(f => 
      f.id === reg.familyId || 
      f.id === `fam_${gmkId}` || 
      (gmkId && f.primaryMemberGmkId === gmkId) ||
      (reg.primaryMemberEmail && f.primaryMemberEmail?.toLowerCase() === reg.primaryMemberEmail.toLowerCase())
    );

    const relevantFamilyMembers = familyMembers.filter(m => 
      m.familyId === reg.familyId || 
      (fam && m.familyId === fam.id) || 
      (fam && m.familyId === `fam_${fam.primaryMemberGmkId}`) ||
      (gmkId && m.familyId === `fam_${gmkId}`)
    );

    const mem = relevantFamilyMembers.find(m => (m.name || '').trim().toLowerCase() === norm)
      || familyMembers.find(m => (m.name || '').trim().toLowerCase() === norm);

    if (mem) {
      // 3. familyMembers.yearOfBirth
      if (mem.yearOfBirth) {
        const yob = parseInt(String(mem.yearOfBirth).trim(), 10);
        if (!isNaN(yob) && yob > 1900 && yob <= currentYear) {
          calculatedAge = currentYear - yob;
          source = 'familyMembers.yearOfBirth';
        }
      }

      // 4. familyMembers.dateOfBirth
      if (calculatedAge === undefined && (mem as any).dateOfBirth) {
        const parsed = new Date((mem as any).dateOfBirth);
        if (!isNaN(parsed.getTime())) {
          calculatedAge = currentYear - parsed.getFullYear();
          source = 'familyMembers.dateOfBirth';
        }
      }
    }
  }

  // If age is determined:
  if (calculatedAge !== undefined) {
    if (calculatedAge <= 3) {
      return { age: calculatedAge, category: 'Kids 0-3', isAdult: false, isChild: true, source };
    }
    if (calculatedAge <= 9) {
      return { age: calculatedAge, category: 'Kids 4-9', isAdult: false, isChild: true, source };
    }
    if (calculatedAge < 18) {
      return { age: calculatedAge, category: 'Kids 10+', isAdult: false, isChild: true, source };
    }
    return { age: calculatedAge, category: 'Adult', isAdult: true, isChild: false, source };
  }

  // If a participant has no authoritative age information:
  // - GMK Member -> Adult
  // - Spouse -> Adult
  // - Parent -> Adult
  // - Other -> Adult
  // - Guest -> Adult
  // Do NOT guess a person's age.
  return {
    age: undefined,
    category: 'Adult',
    isAdult: true,
    isChild: false,
    source: 'default_adult'
  };
}
