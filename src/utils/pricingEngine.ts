import { EventPricingConfig } from '../types';

export interface PricingEngineParams {
  pricing?: EventPricingConfig;
  hasPrimary: boolean;
  hasSpouse: boolean;
  children: Array<{ name?: string; yearOfBirth?: string; age?: number }>;
  parentsCount: number;
  othersCount: number;
  externalGuestsCount?: number;
}

export interface PricingEngineResult {
  registrationType: 'individual' | 'couple' | 'family' | 'single';
  totalAmount: number;
  baseRate: number;
  details: string;
  breakdown: {
    adults: number; // spousesCount (primary + spouse)
    halfPriceChildren: number; // children at or above freeChildAge
    freeChildren: number; // children below freeChildAge
  };
  parentsCount: number;
  parentRate: number;
  parentsSubtotal: number;
  othersCount: number;
  otherRate: number;
  othersSubtotal: number;
  externalCount: number;
  externalRate: number;
  externalSubtotal: number;
  freeChildAge: number;
}

/**
 * RTCO-088: Centralized GMK Event Pricing Engine
 * Consistently calculates registration fees for both GMK Residents and External Family Registrations.
 */
export function calculateEventPricing(params: PricingEngineParams): PricingEngineResult {
  const {
    pricing,
    hasPrimary,
    hasSpouse,
    children = [],
    parentsCount = 0,
    othersCount = 0,
    externalGuestsCount = 0
  } = params;

  const currentYear = new Date().getFullYear();
  const freeChildAge = pricing?.freeChildAge ?? 5;
  const parentRate = pricing?.parentRate ?? 5;
  const otherRate = pricing?.otherRate ?? 5;
  const singleRate = pricing?.singleRate ?? 10;
  const coupleRate = pricing?.coupleRate ?? 20;
  const familyRate = pricing?.familyRate ?? 25;

  let kidsBelowFreeAge = 0;
  let kidsAboveFreeAge = 0;

  children.forEach(child => {
    let age = child.age;
    if (age === undefined && child.yearOfBirth) {
      const yob = parseInt(child.yearOfBirth);
      if (!isNaN(yob)) {
        age = currentYear - yob;
      }
    }

    if (age !== undefined && age < freeChildAge) {
      kidsBelowFreeAge++;
    } else {
      kidsAboveFreeAge++;
    }
  });

  const spousesCount = (hasPrimary ? 1 : 0) + (hasSpouse ? 1 : 0);
  const coreHeads = spousesCount + kidsAboveFreeAge;

  let registrationType: 'individual' | 'couple' | 'family' = 'individual';
  let baseRate = 0;

  if (coreHeads >= 3) {
    registrationType = 'family';
    baseRate = familyRate;
  } else if (coreHeads === 2) {
    registrationType = 'couple';
    baseRate = coupleRate;
  } else if (coreHeads === 1) {
    registrationType = 'individual';
    baseRate = singleRate;
  } else {
    registrationType = 'individual';
    baseRate = 0;
  }

  const parentsSubtotal = parentsCount * parentRate;
  const othersSubtotal = othersCount * otherRate;

  const allowExternal = pricing?.allowExternal ?? false;
  const externalRate = allowExternal ? (pricing?.externalRate ?? 10) : 0;
  const externalSubtotal = externalGuestsCount * externalRate;

  const totalAmount = baseRate + parentsSubtotal + othersSubtotal + externalSubtotal;

  const detailsParts: string[] = [];

  if (coreHeads > 0) {
    if (registrationType === 'individual') {
      detailsParts.push(`Core Registration (Single): OMR ${baseRate}`);
    } else if (registrationType === 'couple') {
      detailsParts.push(`Core Registration (Couple): OMR ${baseRate}`);
    } else {
      detailsParts.push(`Core Registration (Family): OMR ${baseRate}`);
    }
  }

  if (parentsCount > 0) {
    detailsParts.push(`Extra Adults (Parents): ${parentsCount} × OMR ${parentRate} = OMR ${parentsSubtotal}`);
  }

  if (othersCount > 0) {
    detailsParts.push(`Extra Adults (Others): ${othersCount} × OMR ${otherRate} = OMR ${othersSubtotal}`);
  }

  if (externalGuestsCount > 0 && allowExternal) {
    detailsParts.push(`Guests: ${externalGuestsCount} × OMR ${externalRate} = OMR ${externalSubtotal}`);
  }

  if (kidsBelowFreeAge > 0) {
    detailsParts.push(`Children below ${freeChildAge} years: FREE`);
  }

  const detailsStr = detailsParts.length > 0 ? detailsParts.join(' | ') : 'No participants selected';

  return {
    registrationType,
    totalAmount,
    baseRate,
    details: detailsStr,
    breakdown: {
      adults: spousesCount,
      halfPriceChildren: kidsAboveFreeAge,
      freeChildren: kidsBelowFreeAge
    },
    parentsCount,
    parentRate,
    parentsSubtotal,
    othersCount,
    otherRate,
    othersSubtotal,
    externalCount: externalGuestsCount,
    externalRate,
    externalSubtotal,
    freeChildAge
  };
}

/**
 * Calculate single fixed pricing for external single registrations
 */
export function calculateSingleFixedPricing(fixedAmount: number = 0): PricingEngineResult {
  return {
    registrationType: 'single',
    totalAmount: fixedAmount,
    baseRate: fixedAmount,
    details: `Fixed Single Registration: OMR ${fixedAmount.toFixed(3)}`,
    breakdown: {
      adults: 1,
      halfPriceChildren: 0,
      freeChildren: 0
    },
    parentsCount: 0,
    parentRate: 0,
    parentsSubtotal: 0,
    othersCount: 0,
    otherRate: 0,
    othersSubtotal: 0,
    externalCount: 0,
    externalRate: 0,
    externalSubtotal: 0,
    freeChildAge: 5
  };
}
