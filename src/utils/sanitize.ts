/**
 * Global Firestore payload sanitizer to prevent "WriteBatch.set() called with invalid data. Unsupported field value: undefined" errors.
 * 
 * Rules:
 * - Text fields: undefined -> ""
 * - Boolean fields: undefined -> false
 * - Arrays: undefined -> []
 * - Objects: undefined -> null or omit field entirely.
 */
export function sanitizeFirestorePayload<T extends Record<string, any>>(obj: T): T {
  if (obj === null || obj === undefined) {
    return {} as T;
  }

  const textFields = [
    'id', 'familyId', 'relationship', 'gender', 'name', 'notes', 
    'whatsAppNumber', 'whatsApp', 'yearOfBirth', 'primaryMemberGmkId', 
    'primaryMemberEmail', 'fullName', 'salutation', 'phone', 'unitKey', 
    'displayUnitNumber', 'unitType', 'createdAt', 'updatedAt', 'email', 'gmkId', 
    'gatedCommunity', 'status', 'remarks', 'professionCategory', 'professionTitle', 
    'spouseProfessionCategory', 'spouseProfessionTitle', 'spouseCompany', 'spouseContactPreference', 'spouseName', 'spousePhone', 'directoryOption',
    'uid', 'assignedBy', 'assignedAt', 'role', 'eventId', 'title', 'description', 
    'coordinatorEmail', 'coordinatorName', 'timestamp', 'action', 'actorEmail'
  ];

  const booleanFields = [
    'whatsAppSameAsMobile', 'directoryConsent', 'doctorConsent', 'spouseDoctorConsent', 'onboardingCompleted', 'isActive'
  ];

  const arrayFields = [
    'participants', 'attendees', 'roles', 'members', 'volunteers', 'pricingRules', 'expertiseCategories', 'spouseExpertiseCategories'
  ];

  // For arrays
  if (Array.isArray(obj)) {
    return (obj as any[]).map(item => {
      if (item !== null && typeof item === 'object') {
        return sanitizeFirestorePayload(item);
      }
      return item;
    }) as unknown as T;
  }

  const result: Record<string, any> = {};

  // Check if we are working with high-probability models to populate fields that are completely missing
  const isFamilyMember = 'relationship' in obj || ('familyId' in obj && !('onboardingCompleted' in obj));
  const isFamily = 'onboardingCompleted' in obj;

  const workingObj = { ...obj };

  if (isFamilyMember) {
    const optionalMemberFields = ['yearOfBirth', 'notes', 'whatsAppNumber'];
    optionalMemberFields.forEach(field => {
      if (!(field in workingObj) || workingObj[field] === undefined) {
        (workingObj as any)[field] = "";
      }
    });
  }

  if (isFamily) {
    const optionalFamilyFields = ['professionCategory', 'professionTitle', 'company', 'whatsAppNumber', 'directoryConsent', 'doctorConsent'];
    optionalFamilyFields.forEach(field => {
      if (!(field in workingObj) || workingObj[field] === undefined) {
        if (field === 'directoryConsent' || field === 'doctorConsent') {
          (workingObj as any)[field] = false;
        } else {
          (workingObj as any)[field] = "";
        }
      }
    });
  }

  for (const [key, value] of Object.entries(workingObj)) {
    if (value === undefined) {
      if (textFields.includes(key)) {
        result[key] = "";
      } else if (booleanFields.includes(key)) {
        result[key] = false;
      } else if (arrayFields.includes(key)) {
        result[key] = [];
      } else {
        // Objects: undefined -> null or omit field entirely
        // Let's omit or set to null if preferred.
        // Rule: "Objects: undefined -> null or omit field entirely." Let's omit it.
      }
    } else if (value === null) {
      result[key] = null;
    } else if (Array.isArray(value)) {
      result[key] = value.map(item => {
        if (item !== null && typeof item === 'object') {
          return sanitizeFirestorePayload(item);
        }
        return item;
      });
    } else if (value instanceof Date) {
      result[key] = value.toISOString();
    } else if (typeof value === 'object') {
      result[key] = sanitizeFirestorePayload(value);
    } else {
      result[key] = value;
    }
  }

  return result as T;
}
