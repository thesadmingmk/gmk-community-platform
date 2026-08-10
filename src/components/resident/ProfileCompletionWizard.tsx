import React, { useState, useEffect } from 'react';
import { db, auth } from '../../context/AuthContext';
import { signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, collection, query, where, getDocs, writeBatch } from 'firebase/firestore';
import { Family, FamilyMember, ResidentProfile } from '../../types';
import { createAuditLog } from '../../utils/audit';
import { sanitizeFirestorePayload } from '../../utils/sanitize';
import { validateAndNormalizePhoneNumber } from '../../utils/phoneValidation';
import { normalizeName } from '../../utils/nameNormalization';
import { Check, ClipboardList, Shield, Briefcase, Users, User, ArrowRight, ArrowLeft, Heart, RefreshCw, AlertCircle, LogOut, Edit2 } from 'lucide-react';

interface ProfileCompletionWizardProps {
  residentProfile: ResidentProfile;
  onComplete: () => void;
}

// Search categories
const PROFESSION_CATEGORIES = [
  "Healthcare", "Automotive", "Logistics", "Construction", "Interior Design",
  "Education", "Finance", "Legal", "Technology", "Hospitality", "Retail",
  "Government", "Business Owner", "Other"
];

// Popular expertise keywords for suggestions and spelling assist
const POPULAR_EXPERTISE_SUGGESTIONS = [
  "Tyres", "Battery", "Building Materials", "Construction", 
  "Tax Planning", "Interior Design", "Web Development", "Yoga Instruction",
  "Plumbing", "Electrical Work", "Legal Consulting", "Catering", 
  "Financial Advisory", "Hardware", "Air Conditioning", "Pest Control", 
  "Painting", "Carpentry", "Appliance Repair", "Physiotherapy",
  "Event Planning", "Photography", "Gardening", "Real Estate"
];

// Capitalize first letter of each word in a comma-separated list
export function normalizeExpertiseKeywords(val: string): string {
  if (!val) return '';
  return val
    .split(',')
    .map(term => {
      const trimmed = term.trim();
      if (!trimmed) return '';
      return trimmed
        .split(/\s+/)
        .map(word => {
          if (!word) return '';
          return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        })
        .join(' ');
    })
    .filter(Boolean)
    .join(', ');
}

// Country codes helper
const RAW_COUNTRY_CODES = [
  // Top prioritised countries as requested: Oman and India
  { code: "+968", name: "Oman" },
  { code: "+91", name: "India" },

  // Rest of the countries sorted alphabetically
  { code: "+93", name: "Afghanistan" },
  { code: "+355", name: "Albania" },
  { code: "+213", name: "Algeria" },
  { code: "+1-684", name: "American Samoa" },
  { code: "+376", name: "Andorra" },
  { code: "+244", name: "Angola" },
  { code: "+1-264", name: "Anguilla" },
  { code: "+672", name: "Antarctica" },
  { code: "+1-268", name: "Antigua and Barbuda" },
  { code: "+54", name: "Argentina" },
  { code: "+374", name: "Armenia" },
  { code: "+297", name: "Aruba" },
  { code: "+61", name: "Australia" },
  { code: "+43", name: "Austria" },
  { code: "+994", name: "Azerbaijan" },
  { code: "+1-242", name: "Bahamas" },
  { code: "+973", name: "Bahrain" },
  { code: "+880", name: "Bangladesh" },
  { code: "+1-246", name: "Barbados" },
  { code: "+375", name: "Belarus" },
  { code: "+32", name: "Belgium" },
  { code: "+501", name: "Belize" },
  { code: "+229", name: "Benin" },
  { code: "+1-441", name: "Bermuda" },
  { code: "+975", name: "Bhutan" },
  { code: "+591", name: "Bolivia" },
  { code: "+387", name: "Bosnia and Herzegovina" },
  { code: "+267", name: "Botswana" },
  { code: "+55", name: "Brazil" },
  { code: "+246", name: "British Indian Ocean Territory" },
  { code: "+1-284", name: "British Virgin Islands" },
  { code: "+673", name: "Brunei" },
  { code: "+359", name: "Bulgaria" },
  { code: "+226", name: "Burkina Faso" },
  { code: "+257", name: "Burundi" },
  { code: "+855", name: "Cambodia" },
  { code: "+237", name: "Cameroon" },
  { code: "+1", name: "Canada" },
  { code: "+238", name: "Cape Verde" },
  { code: "+1-345", name: "Cayman Islands" },
  { code: "+236", name: "Central African Republic" },
  { code: "+235", name: "Chad" },
  { code: "+56", name: "Chile" },
  { code: "+86", name: "China" },
  { code: "+61", name: "Christmas Island" },
  { code: "+61", name: "Cocos Islands" },
  { code: "+57", name: "Colombia" },
  { code: "+269", name: "Comoros" },
  { code: "+682", name: "Cook Islands" },
  { code: "+506", name: "Costa Rica" },
  { code: "+385", name: "Croatia" },
  { code: "+53", name: "Cuba" },
  { code: "+599", name: "Curaçao" },
  { code: "+357", name: "Cyprus" },
  { code: "+420", name: "Czech Republic" },
  { code: "+45", name: "Denmark" },
  { code: "+253", name: "Djibouti" },
  { code: "+1-767", name: "Dominica" },
  { code: "+1-809", name: "Dominican Republic" },
  { code: "+593", name: "Ecuador" },
  { code: "+20", name: "Egypt" },
  { code: "+503", name: "El Salvador" },
  { code: "+240", name: "Equatorial Guinea" },
  { code: "+291", name: "Eritrea" },
  { code: "+372", name: "Estonia" },
  { code: "+251", name: "Ethiopia" },
  { code: "+500", name: "Falkland Islands" },
  { code: "+298", name: "Faroe Islands" },
  { code: "+679", name: "Fiji" },
  { code: "+358", name: "Finland" },
  { code: "+33", name: "France" },
  { code: "+594", name: "French Guiana" },
  { code: "+689", name: "French Polynesia" },
  { code: "+241", name: "Gabon" },
  { code: "+220", name: "Gambia" },
  { code: "+995", name: "Georgia" },
  { code: "+49", name: "Germany" },
  { code: "+233", name: "Ghana" },
  { code: "+350", name: "Gibraltar" },
  { code: "+30", name: "Greece" },
  { code: "+299", name: "Greenland" },
  { code: "+1-473", name: "Grenada" },
  { code: "+590", name: "Guadeloupe" },
  { code: "+1-671", name: "Guam" },
  { code: "+502", name: "Guatemala" },
  { code: "+44", name: "Guernsey" },
  { code: "+224", name: "Guinea" },
  { code: "+245", name: "Guinea-Bissau" },
  { code: "+592", name: "Guyana" },
  { code: "+509", name: "Haiti" },
  { code: "+504", name: "Honduras" },
  { code: "+852", name: "Hong Kong" },
  { code: "+36", name: "Hungary" },
  { code: "+354", name: "Iceland" },
  { code: "+62", name: "Indonesia" },
  { code: "+98", name: "Iran" },
  { code: "+964", name: "Iraq" },
  { code: "+353", name: "Ireland" },
  { code: "+44", name: "Isle of Man" },
  { code: "+972", name: "Israel" },
  { code: "+39", name: "Italy" },
  { code: "+225", name: "Ivory Coast" },
  { code: "+1-876", name: "Jamaica" },
  { code: "+81", name: "Japan" },
  { code: "+44", name: "Jersey" },
  { code: "+962", name: "Jordan" },
  { code: "+7", name: "Kazakhstan" },
  { code: "+254", name: "Kenya" },
  { code: "+686", name: "Kiribati" },
  { code: "+383", name: "Kosovo" },
  { code: "+965", name: "Kuwait" },
  { code: "+996", name: "Kyrgyzstan" },
  { code: "+856", name: "Laos" },
  { code: "+371", name: "Latvia" },
  { code: "+961", name: "Lebanon" },
  { code: "+266", name: "Lesotho" },
  { code: "+231", name: "Liberia" },
  { code: "+218", name: "Libya" },
  { code: "+423", name: "Liechtenstein" },
  { code: "+370", name: "Lithuania" },
  { code: "+352", name: "Luxembourg" },
  { code: "+853", name: "Macau" },
  { code: "+389", name: "Macedonia" },
  { code: "+261", name: "Madagascar" },
  { code: "+265", name: "Malawi" },
  { code: "+60", name: "Malaysia" },
  { code: "+960", name: "Maldives" },
  { code: "+223", name: "Mali" },
  { code: "+356", name: "Malta" },
  { code: "+692", name: "Marshall Islands" },
  { code: "+596", name: "Martinique" },
  { code: "+222", name: "Mauritania" },
  { code: "+230", name: "Mauritius" },
  { code: "+262", name: "Mayotte" },
  { code: "+52", name: "Mexico" },
  { code: "+691", name: "Micronesia" },
  { code: "+373", name: "Moldova" },
  { code: "+377", name: "Monaco" },
  { code: "+976", name: "Mongolia" },
  { code: "+382", name: "Montenegro" },
  { code: "+1-664", name: "Montserrat" },
  { code: "+212", name: "Morocco" },
  { code: "+258", name: "Mozambique" },
  { code: "+95", name: "Myanmar" },
  { code: "+264", name: "Namibia" },
  { code: "+674", name: "Nauru" },
  { code: "+977", name: "Nepal" },
  { code: "+31", name: "Netherlands" },
  { code: "+687", name: "New Caledonia" },
  { code: "+64", name: "New Zealand" },
  { code: "+505", name: "Nicaragua" },
  { code: "+227", name: "Niger" },
  { code: "+234", name: "Nigeria" },
  { code: "+683", name: "Niue" },
  { code: "+850", name: "North Korea" },
  { code: "+1-670", name: "Northern Mariana Islands" },
  { code: "+47", name: "Norway" },
  { code: "+92", name: "Pakistan" },
  { code: "+680", name: "Palau" },
  { code: "+970", name: "Palestine" },
  { code: "+507", name: "Panama" },
  { code: "+675", name: "Papua New Guinea" },
  { code: "+595", name: "Paraguay" },
  { code: "+51", name: "Peru" },
  { code: "+63", name: "Philippines" },
  { code: "+48", name: "Poland" },
  { code: "+351", name: "Portugal" },
  { code: "+1-787", name: "Puerto Rico" },
  { code: "+262", name: "Réunion" },
  { code: "+40", name: "Romania" },
  { code: "+7", name: "Russia" },
  { code: "+250", name: "Rwanda" },
  { code: "+590", name: "Saint Barthélemy" },
  { code: "+290", name: "Saint Helena" },
  { code: "+1-869", name: "Saint Kitts and Nevis" },
  { code: "+1-758", name: "Saint Lucia" },
  { code: "+590", name: "Saint Martin" },
  { code: "+508", name: "Saint Pierre and Miquelon" },
  { code: "+1-784", name: "Saint Vincent and the Grenadines" },
  { code: "+685", name: "Samoa" },
  { code: "+378", name: "San Marino" },
  { code: "+239", name: "São Tomé and Príncipe" },
  { code: "+221", name: "Senegal" },
  { code: "+381", name: "Serbia" },
  { code: "+248", name: "Seychelles" },
  { code: "+232", name: "Sierra Leone" },
  { code: "+65", name: "Singapore" },
  { code: "+1-721", name: "Sint Maarten" },
  { code: "+421", name: "Slovakia" },
  { code: "+386", name: "Slovenia" },
  { code: "+677", name: "Solomon Islands" },
  { code: "+252", name: "Somalia" },
  { code: "+27", name: "South Africa" },
  { code: "+82", name: "South Korea" },
  { code: "+211", name: "South Sudan" },
  { code: "+34", name: "Spain" },
  { code: "+94", name: "Sri Lanka" },
  { code: "+249", name: "Sudan" },
  { code: "+597", name: "Suriname" },
  { code: "+268", name: "Swaziland" },
  { code: "+46", name: "Sweden" },
  { code: "+41", name: "Switzerland" },
  { code: "+963", name: "Syria" },
  { code: "+886", name: "Taiwan" },
  { code: "+992", name: "Tajikistan" },
  { code: "+255", name: "Tanzania" },
  { code: "+66", name: "Thailand" },
  { code: "+670", name: "Timor-Leste" },
  { code: "+228", name: "Togo" },
  { code: "+690", name: "Tokelau" },
  { code: "+676", name: "Tonga" },
  { code: "+1-868", name: "Trinidad and Tobago" },
  { code: "+216", name: "Tunisia" },
  { code: "+90", name: "Turkey" },
  { code: "+993", name: "Turkmenistan" },
  { code: "+1-649", name: "Turks and Caicos Islands" },
  { code: "+688", name: "Tuvalu" },
  { code: "+1-340", name: "U.S. Virgin Islands" },
  { code: "+256", name: "Uganda" },
  { code: "+380", name: "Ukraine" },
  { code: "+598", name: "Uruguay" },
  { code: "+998", name: "Uzbekistan" },
  { code: "+678", name: "Vanuatu" },
  { code: "+39", name: "Vatican City" },
  { code: "+58", name: "Venezuela" },
  { code: "+84", name: "Vietnam" },
  { code: "+681", name: "Wallis and Futuna" },
  { code: "+967", name: "Yemen" },
  { code: "+260", name: "Zambia" },
  { code: "+263", name: "Zimbabwe" }
];

const METADATA_MAP: Record<string, number[]> = {
  "+968": [8],    // Oman
  "+91": [10],    // India
  "+971": [9],    // UAE
  "+966": [9],    // Saudi Arabia
  "+965": [8],    // Kuwait
  "+974": [8],    // Qatar
  "+973": [8],    // Bahrain
};

// Build the complete country codes array with metadata dynamically
const RAW_WITH_UAE_UPDATED = [
  ...RAW_COUNTRY_CODES.filter(c => c.code !== "+971" && c.code !== "+968" && c.code !== "+91")
];

// Combine and put Oman, India, UAE at absolute top
export const COUNTRY_CODES: { code: string; name: string; lengths: number[] }[] = [
  { code: "+968", name: "Oman", lengths: [8] },
  { code: "+91", name: "India", lengths: [10] },
  { code: "+971", name: "UAE", lengths: [9] },
  ...RAW_WITH_UAE_UPDATED.map(c => ({
    code: c.code,
    name: c.name,
    lengths: METADATA_MAP[c.code] || [8, 9, 10, 11, 12, 13, 14, 15]
  }))
];

// Dynamic country-aware phone validation helper function
export function validatePhoneNumber(code: string, number: string, isOptional = false): string | null {
  const result = validateAndNormalizePhoneNumber(code, number, isOptional);
  return result.error;
}

export default function ProfileCompletionWizard({ residentProfile, onComplete }: ProfileCompletionWizardProps) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // --- STEP 1: Primary Member Information ---
  const [salutation, setSalutation] = useState<'Mr' | 'Mrs' | 'Ms' | 'Dr' | ''>(residentProfile.salutation as any || '');
  const [fullName, setFullName] = useState(residentProfile.fullName || '');
  const [phoneCode, setPhoneCode] = useState('');
  const [phoneMain, setPhoneMain] = useState('');
  const [whatsAppSameAsMobile, setWhatsAppSameAsMobile] = useState(true);
  const [whatsAppCode, setWhatsAppCode] = useState('');
  const [whatsAppMain, setWhatsAppMain] = useState('');

  // --- STEP 2: Family Information ---
  const [familyMembersList, setFamilyMembersList] = useState<Omit<FamilyMember, 'id' | 'familyId' | 'createdAt'>[]>([]);
  
  // Applicability section controls for step 2
  const [childrenApplicable, setChildrenApplicable] = useState(false);
  const [parentsApplicable, setParentsApplicable] = useState(false);
  const [dependentsApplicable, setDependentsApplicable] = useState(false);
  
  // Check if this household has completed onboarding previously
  const [onboardingCompletedAlready, setOnboardingCompletedAlready] = useState(false);

  // Intermediary member addition forms
  const [spouseEnabled, setSpouseEnabled] = useState(false);
  const [spouseName, setSpouseName] = useState('');
  const [spouseGender, setSpouseGender] = useState<'male' | 'female' | ''>('');
  const [spouseWhatsApp, setSpouseWhatsApp] = useState('');
  const [spouseWhatsAppCode, setSpouseWhatsAppCode] = useState('+968');
  const [spousePhoneCode, setSpousePhoneCode] = useState('+968');
  const [spousePhone, setSpousePhone] = useState('');
  const [spousePhoneSameAsWhatsApp, setSpousePhoneSameAsWhatsApp] = useState(true);
  const [spouseEmail, setSpouseEmail] = useState('');
  const [spouseExistedInDb, setSpouseExistedInDb] = useState(false);

  // Children list accumulator
  const [childFormName, setChildFormName] = useState('');
  const [childGender, setChildGender] = useState<'male' | 'female' | ''>('');
  const [childYob, setChildYob] = useState('');

  // Parents list accumulator
  const [parentFormName, setParentFormName] = useState('');
  const [parentGender, setParentGender] = useState<'male' | 'female' | ''>('');
  const [parentNotes, setParentNotes] = useState('');

  // Dependents list accumulator
  const [depFormName, setDepFormName] = useState('');
  const [depGender, setDepGender] = useState<'male' | 'female' | ''>('');
  const [depNotes, setDepNotes] = useState('');

  // --- STEP 3: Directory Consent & Professional Info ---
  const [directoryOption, setDirectoryOption] = useState<'me' | 'spouse' | 'both' | 'none'>('none');
  const [directoryConsent, setDirectoryConsent] = useState(false);

  // Primary Resident Profession
  const [professionCategory, setProfessionCategory] = useState('');
  const [customProfessionCategory, setCustomProfessionCategory] = useState('');
  const [professionTitle, setProfessionTitle] = useState('');
  const [company, setCompany] = useState('');
  const [expertiseCategories, setExpertiseCategories] = useState<string[]>([]);
  const [expertiseKeywords, setExpertiseKeywords] = useState('');
  const [contactPreference, setContactPreference] = useState<'Phone' | 'Email' | 'WhatsApp' | 'Any' | ''>('');
  const [doctorConsent, setDoctorConsent] = useState(false);

  // Spouse Profession
  const [spouseProfessionCategory, setSpouseProfessionCategory] = useState('');
  const [customSpouseProfessionCategory, setCustomSpouseProfessionCategory] = useState('');
  const [spouseProfessionTitle, setSpouseProfessionTitle] = useState('');
  const [spouseCompany, setSpouseCompany] = useState('');
  const [spouseExpertiseCategories, setSpouseExpertiseCategories] = useState<string[]>([]);
  const [spouseExpertiseKeywords, setSpouseExpertiseKeywords] = useState('');
  const [spouseContactPreference, setSpouseContactPreference] = useState<'Phone' | 'Email' | 'WhatsApp' | 'Any' | ''>('');
  const [spouseDoctorConsent, setSpouseDoctorConsent] = useState(false);

  // Prepopulate from existing families and familyMembers if they exist
  useEffect(() => {
    const fetchExistingOnboardingData = async () => {
      try {
        const familyId = `fam_${residentProfile.gmkId}`;
        const famSnap = await getDoc(doc(db, "families", familyId));
        if (famSnap.exists()) {
          const famData = famSnap.data() as Family;
          if (famData.salutation) setSalutation(famData.salutation as any);
          if (famData.fullName) setFullName(famData.fullName);
          if (famData.onboardingCompleted) {
            setOnboardingCompletedAlready(true);
          }
          
          if (famData.phone) {
            const raw = famData.phone.trim();
            let matched = false;
            for (const c of COUNTRY_CODES) {
              if (raw.startsWith(c.code)) {
                setPhoneMain(raw.slice(c.code.length));
                setPhoneCode(c.code);
                matched = true;
                break;
              }
            }
            if (!matched) {
              setPhoneMain(raw);
            }
          }
          if (famData.whatsAppNumber) {
            const raw = famData.whatsAppNumber.trim();
            let matched = false;
            for (const c of COUNTRY_CODES) {
              if (raw.startsWith(c.code)) {
                setWhatsAppMain(raw.slice(c.code.length));
                setWhatsAppCode(c.code);
                matched = true;
                break;
              }
            }
            if (!matched) {
              setWhatsAppMain(raw);
            }
          }
          if (famData.whatsAppSameAsMobile !== undefined) {
            setWhatsAppSameAsMobile(famData.whatsAppSameAsMobile);
          }
          if (famData.directoryOption) {
            setDirectoryOption(famData.directoryOption);
            setDirectoryConsent(famData.directoryOption !== 'none');
          } else if (famData.directoryConsent !== undefined) {
            setDirectoryConsent(famData.directoryConsent);
            setDirectoryOption(famData.directoryConsent ? 'me' : 'none');
          }

          if (famData.professionCategory) {
            if (PROFESSION_CATEGORIES.includes(famData.professionCategory)) {
              setProfessionCategory(famData.professionCategory);
              setCustomProfessionCategory('');
            } else {
              setProfessionCategory('Other');
              setCustomProfessionCategory(famData.professionCategory);
            }
          }
          if (famData.professionTitle) {
            setProfessionTitle(famData.professionTitle);
          }
          if (famData.company) {
            setCompany(famData.company);
          }
          if (famData.expertiseCategories) {
            setExpertiseCategories(famData.expertiseCategories);
            setExpertiseKeywords(famData.expertiseCategories.join(', '));
          } else if (famData.professionCategory) {
            setExpertiseCategories([famData.professionCategory]);
            setExpertiseKeywords(famData.professionCategory);
          }
          if (famData.contactPreference) {
            setContactPreference(famData.contactPreference);
          }
          if (famData.doctorConsent !== undefined) {
            setDoctorConsent(famData.doctorConsent);
          }

          // Spouse profession fields prepopulate
          if (famData.spouseProfessionCategory) {
            if (PROFESSION_CATEGORIES.includes(famData.spouseProfessionCategory)) {
              setSpouseProfessionCategory(famData.spouseProfessionCategory);
              setCustomSpouseProfessionCategory('');
            } else {
              setSpouseProfessionCategory('Other');
              setCustomSpouseProfessionCategory(famData.spouseProfessionCategory);
            }
          }
          if (famData.spouseProfessionTitle) {
            setSpouseProfessionTitle(famData.spouseProfessionTitle);
          }
          if (famData.spouseCompany) {
            setSpouseCompany(famData.spouseCompany);
          }
          if (famData.spouseExpertiseCategories) {
            setSpouseExpertiseCategories(famData.spouseExpertiseCategories);
            setSpouseExpertiseKeywords(famData.spouseExpertiseCategories.join(', '));
          }
          if (famData.spouseContactPreference) {
            setSpouseContactPreference(famData.spouseContactPreference);
          }
          if (famData.spouseDoctorConsent !== undefined) {
            setSpouseDoctorConsent(famData.spouseDoctorConsent);
          }
        }

        const memSnap = await getDocs(query(collection(db, "familyMembers"), where("familyId", "==", familyId)));
        if (!memSnap.empty) {
          const loadedMembers: any[] = [];
          let hasChild = false;
          let hasParent = false;
          let hasDependent = false;
          memSnap.docs.forEach((doc) => {
            const mem = doc.data();
            if (mem.relationship === 'spouse') {
              setSpouseEnabled(true);
              setSpouseName(mem.name || '');
              setSpouseGender(mem.gender || '');
              const rawWa = mem.whatsAppNumber || '';
              let waCodeMatched = false;
              for (const c of COUNTRY_CODES) {
                if (rawWa.startsWith(c.code)) {
                  setSpouseWhatsApp(rawWa.slice(c.code.length));
                  setSpouseWhatsAppCode(c.code);
                  waCodeMatched = true;
                  break;
                }
              }
              if (!waCodeMatched) {
                setSpouseWhatsApp(rawWa);
                setSpouseWhatsAppCode('+968');
              }
              setSpouseExistedInDb(true);
            } else {
              if (mem.relationship === 'child') hasChild = true;
              if (mem.relationship === 'parent') hasParent = true;
              if (mem.relationship === 'dependent') hasDependent = true;
              
              loadedMembers.push({
                name: mem.name || '',
                relationship: mem.relationship || 'child',
                gender: mem.gender || '',
                yearOfBirth: mem.yearOfBirth || '',
                notes: mem.notes || mem.profession || ''
              });
            }
          });
          if (hasChild) setChildrenApplicable(true);
          if (hasParent) setParentsApplicable(true);
          if (hasDependent) setDependentsApplicable(true);
          if (loadedMembers.length > 0) {
            setFamilyMembersList(loadedMembers);
          }
        }
      } catch (err) {
        console.warn("⚠️ Failed to pre-populate preceding onboarding status:", err);
      }
    };
    fetchExistingOnboardingData();
  }, [residentProfile]);

  // Initialize phone main
  useEffect(() => {
    if (residentProfile.phone) {
      const raw = residentProfile.phone.trim();
      let matched = false;
      for (const c of COUNTRY_CODES) {
        if (raw.startsWith(c.code)) {
          setPhoneMain(raw.slice(c.code.length));
          setPhoneCode(c.code);
          matched = true;
          break;
        }
      }
      if (!matched) {
        setPhoneMain(raw);
        setPhoneCode('+968');
      }
    }
  }, [residentProfile]);

  // Synchronize whatsapp main
  useEffect(() => {
    if (whatsAppSameAsMobile) {
      setWhatsAppCode(phoneCode);
      setWhatsAppMain(phoneMain);
    }
  }, [whatsAppSameAsMobile, phoneCode, phoneMain]);

  const handleNameNormalization = (val: string) => {
    setFullName(val);
  };

  const handleNameBlur = () => {
    setFullName(normalizeName(fullName));
  };

  const handleAddChild = () => {
    if (!childFormName.trim()) {
      setErrorMsg("Please provide the child's name.");
      return;
    }
    if (!childGender) {
      setErrorMsg("Please select the child's gender.");
      return;
    }
    if (!childYob || childYob.length !== 4 || isNaN(Number(childYob))) {
      setErrorMsg("Please provide a valid 4-digit Year of Birth.");
      return;
    }
    setErrorMsg(null);
    setFamilyMembersList([
      ...familyMembersList,
      {
        name: normalizeName(childFormName),
        relationship: 'child',
        gender: childGender,
        yearOfBirth: childYob.trim()
      }
    ]);
    setChildFormName('');
    setChildYob('');
    setChildGender('');
  };

  const handleAddParent = () => {
    if (!parentFormName.trim()) {
      setErrorMsg("Please provide the parent's name.");
      return;
    }
    if (!parentGender) {
      setErrorMsg("Please select the parent's gender.");
      return;
    }
    setErrorMsg(null);
    setFamilyMembersList([
      ...familyMembersList,
      {
        name: normalizeName(parentFormName),
        relationship: 'parent',
        gender: parentGender,
        notes: parentNotes.trim() || undefined
      }
    ]);
    setParentFormName('');
    setParentNotes('');
    setParentGender('');
  };

  const handleAddDependent = () => {
    if (!depFormName.trim()) {
      setErrorMsg("Please provide the household member's name.");
      return;
    }
    if (!depGender) {
      setErrorMsg("Please select the household member's gender.");
      return;
    }
    setErrorMsg(null);
    setFamilyMembersList([
      ...familyMembersList,
      {
        name: normalizeName(depFormName),
        relationship: 'dependent',
        gender: depGender,
        notes: depNotes.trim() || undefined
      }
    ]);
    setDepFormName('');
    setDepNotes('');
    setDepGender('');
  };

  const handleRemoveMemberAt = (idx: number) => {
    setFamilyMembersList(familyMembersList.filter((_, i) => i !== idx));
  };

  const validateStep1 = () => {
    if (!salutation) return "Salutation is required.";
    if (!fullName.trim()) return "Full Name is required.";
    if (!phoneCode) return "Primary Mobile Country Code is required.";
    const phoneErr = validatePhoneNumber(phoneCode, phoneMain);
    if (phoneErr) return phoneErr;
    if (!whatsAppSameAsMobile) {
      if (!whatsAppCode) return "WhatsApp Country Code is required.";
      const waErr = validatePhoneNumber(whatsAppCode, whatsAppMain);
      if (waErr) return waErr;
    }
    return null;
  };

  const validateStep3 = () => {
    if (directoryOption === 'none' || !directoryConsent) return null;

    // Validate Primary Resident if 'me' or 'both'
    if (directoryOption === 'me' || directoryOption === 'both') {
      if (!professionCategory) return "Primary Resident profession category is required.";
      if (professionCategory === 'Other' && !customProfessionCategory.trim()) {
        return "Please specify Primary Resident custom profession category.";
      }
      if (!professionTitle.trim()) return "Primary Resident profession title is required.";
      if (!company.trim()) return "Primary Resident company / organization is required.";
      if (!contactPreference) return "Please choose Primary Resident contact preference.";
    }

    // Validate Spouse if 'spouse' or 'both'
    if (directoryOption === 'spouse' || directoryOption === 'both') {
      if (!spouseName.trim()) {
        return "Spouse full name is required when listing spouse in directory.";
      }
      if (!spouseProfessionCategory) return "Spouse profession category is required.";
      if (spouseProfessionCategory === 'Other' && !customSpouseProfessionCategory.trim()) {
        return "Please specify Spouse custom profession category.";
      }
      if (!spouseProfessionTitle.trim()) return "Spouse profession title is required.";
      if (!spouseCompany.trim()) return "Spouse company / organization is required.";
      if (!spouseContactPreference) return "Please choose Spouse contact preference.";

      // Validate contact phone formats if entered
      if (spouseWhatsApp.trim()) {
        const waErr = validatePhoneNumber(spouseWhatsAppCode, spouseWhatsApp);
        if (waErr) return `Spouse WhatsApp: ${waErr}`;
      }
      if (!spousePhoneSameAsWhatsApp && spousePhone.trim()) {
        const phErr = validatePhoneNumber(spousePhoneCode, spousePhone);
        if (phErr) return `Spouse Phone: ${phErr}`;
      }

      // Check contact preference vs supplied fields
      if (spouseContactPreference === 'WhatsApp' && !spouseWhatsApp.trim()) {
        return "Spouse WhatsApp Number is required when contact preference is WhatsApp.";
      }
      if (spouseContactPreference === 'Email' && !spouseEmail.trim()) {
        return "Spouse Email Address is required when contact preference is Email.";
      }
      if (spouseContactPreference === 'Phone' && !spousePhoneSameAsWhatsApp && !spousePhone.trim() && !spouseWhatsApp.trim()) {
        return "Spouse Voice Phone Number is required when contact preference is Voice Call.";
      }
      if (spouseContactPreference === 'Any' && !spouseWhatsApp.trim() && !spouseEmail.trim() && (!spousePhoneSameAsWhatsApp ? !spousePhone.trim() : !spouseWhatsApp.trim())) {
        return "Please provide at least one contact detail (WhatsApp, Phone number, or Email) for Spouse.";
      }
    }

    return null;
  };

  const isStep1Valid = () => {
    return validateStep1() === null;
  };

  const autoCommitDrafts = (currentList: typeof familyMembersList) => {
    let list = [...currentList];
    if (childrenApplicable && childFormName.trim()) {
      if (childYob && childYob.length === 4 && !isNaN(Number(childYob)) && childGender) {
        // Only auto-add if it has a valid year of birth and gender
        const normalized = normalizeName(childFormName);
        const exists = list.some(m => m.relationship === 'child' && m.name.toLowerCase() === normalized.toLowerCase());
        if (!exists) {
          list.push({
            name: normalized,
            relationship: 'child',
            gender: childGender,
            yearOfBirth: childYob.trim()
          });
        }
      }
    }
    if (parentsApplicable && parentFormName.trim()) {
      if (parentGender) {
        const normalized = normalizeName(parentFormName);
        const exists = list.some(m => m.relationship === 'parent' && m.name.toLowerCase() === normalized.toLowerCase());
        if (!exists) {
          list.push({
            name: normalized,
            relationship: 'parent',
            gender: parentGender,
            notes: parentNotes.trim() || undefined
          });
        }
      }
    }
    if (dependentsApplicable && depFormName.trim()) {
      if (depGender) {
        const normalized = normalizeName(depFormName);
        const exists = list.some(m => m.relationship === 'dependent' && m.name.toLowerCase() === normalized.toLowerCase());
        if (!exists) {
          list.push({
            name: normalized,
            relationship: 'dependent',
            gender: depGender,
            notes: depNotes.trim() || undefined
          });
        }
      }
    }
    return list;
  };

  const isStep2Valid = () => {
    // 1. If spouse enabled, spouseName and spouseGender are mandatory
    if (spouseEnabled) {
      if (!spouseName.trim()) return false;
      if (!spouseGender) return false;
      if (spouseWhatsApp.trim()) {
        if (!spouseWhatsAppCode) return false;
        if (validatePhoneNumber(spouseWhatsAppCode, spouseWhatsApp)) {
          return false;
        }
      }
    }

    // 2. If children are marked applicable (Yes), they must have added at least one child, OR there must be a valid child typed in the form inputs (with gender and birth year)
    if (childrenApplicable) {
      const addedChildren = familyMembersList.filter(m => m.relationship === 'child');
      const hasDraftChild = childFormName.trim().length > 0 && childGender && childYob.trim().length === 4 && !isNaN(Number(childYob.trim()));
      if (addedChildren.length === 0 && !hasDraftChild) return false;
    }

    // 3. If parents are marked applicable (Yes), they must have added at least one parent, OR there must be a valid parent typed in the form inputs (with gender)
    if (parentsApplicable) {
      const addedParents = familyMembersList.filter(m => m.relationship === 'parent');
      const hasDraftParent = parentFormName.trim().length > 0 && parentGender;
      if (addedParents.length === 0 && !hasDraftParent) return false;
    }

    // 4. If others are marked applicable (Yes), they must have added at least one other relative, OR there must be a valid other typed in the form inputs (with gender)
    if (dependentsApplicable) {
      const addedDeps = familyMembersList.filter(m => m.relationship === 'dependent');
      const hasDraftDep = depFormName.trim().length > 0 && depGender;
      if (addedDeps.length === 0 && !hasDraftDep) return false;
    }

    return true;
  };

  const isStep3Valid = () => {
    return validateStep3() === null;
  };

  const isCurrentStepValid = () => {
    if (step === 1) return isStep1Valid();
    if (step === 2) return isStep2Valid();
    if (step === 3) {
      if (!directoryConsent) return true;
      return isStep3Valid();
    }
    return true;
  };

  const handleNextStep = () => {
    setErrorMsg(null);
    if (step === 1) {
      const err = validateStep1();
      if (err) { setErrorMsg(err); return; }
    }
    if (step === 3) {
      if (directoryConsent) {
        const err = validateStep3();
        if (err) { setErrorMsg(err); return; }
      }
    }
    setStep(step + 1);
  };

  const handlePrevStep = () => {
    setErrorMsg(null);
    setStep(step - 1);
  };

  const handleSaveAndLogoff = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const phoneNorm = phoneMain ? validateAndNormalizePhoneNumber(phoneCode, phoneMain).normalized : '';
      const waNorm = whatsAppSameAsMobile 
        ? phoneNorm 
        : (whatsAppMain ? validateAndNormalizePhoneNumber(whatsAppCode, whatsAppMain).normalized : '');
      const finalPhone = phoneNorm ? `${phoneCode}${phoneNorm}` : '';
      const finalWhatsApp = waNorm ? (whatsAppSameAsMobile ? `${phoneCode}${phoneNorm}` : `${whatsAppCode}${waNorm}`) : '';
      const familyId = `fam_${residentProfile.gmkId}`;

      const normalizedResidentName = normalizeName(fullName);

      const dbDirectoryConsent = directoryOption !== 'none';

      const dbProfessionCategory = (directoryOption === 'me' || directoryOption === 'both') 
        ? (professionCategory === 'Other' ? (customProfessionCategory.trim() || 'Other') : professionCategory)
        : '';
      const dbProfessionTitle = (directoryOption === 'me' || directoryOption === 'both') ? professionTitle.trim() : '';
      const dbCompany = (directoryOption === 'me' || directoryOption === 'both') ? company.trim() : '';
      const dbExpertiseCategories = (directoryOption === 'me' || directoryOption === 'both') 
        ? expertiseKeywords.split(',').map(s => s.trim()).filter(Boolean)
        : [];
      const dbDoctorConsent = (directoryOption === 'me' || directoryOption === 'both') 
        ? ((dbProfessionTitle.toLowerCase().includes('doctor') || dbProfessionCategory === 'Healthcare' || salutation === 'Dr') ? doctorConsent : false)
        : false;

      const dbSpouseProfessionCategory = (directoryOption === 'spouse' || directoryOption === 'both') 
        ? (spouseProfessionCategory === 'Other' ? (customSpouseProfessionCategory.trim() || 'Other') : spouseProfessionCategory)
        : '';
      const dbSpouseProfessionTitle = (directoryOption === 'spouse' || directoryOption === 'both') ? spouseProfessionTitle.trim() : '';
      const dbSpouseCompany = (directoryOption === 'spouse' || directoryOption === 'both') ? spouseCompany.trim() : '';
      const dbSpouseExpertiseCategories = (directoryOption === 'spouse' || directoryOption === 'both') 
        ? spouseExpertiseKeywords.split(',').map(s => s.trim()).filter(Boolean)
        : [];
      const dbSpouseDoctorConsent = (directoryOption === 'spouse' || directoryOption === 'both') 
        ? ((dbSpouseProfessionTitle.toLowerCase().includes('doctor') || dbSpouseProfessionCategory === 'Healthcare') ? spouseDoctorConsent : false)
        : false;

      const spouseWaNorm = spouseWhatsApp.trim() ? validateAndNormalizePhoneNumber(spouseWhatsAppCode, spouseWhatsApp).normalized : '';
      const dbSpouseWhatsApp = spouseWaNorm ? `${spouseWhatsAppCode}${spouseWaNorm}` : '';
      const spousePhNorm = (!spousePhoneSameAsWhatsApp && spousePhone.trim()) ? validateAndNormalizePhoneNumber(spousePhoneCode, spousePhone).normalized : '';
      const dbSpousePhone = spousePhoneSameAsWhatsApp ? dbSpouseWhatsApp : (spousePhNorm ? `${spousePhoneCode}${spousePhNorm}` : '');
      const dbSpouseEmail = spouseEmail.trim();

      const partialFamilyModel: Partial<Family> = {
        id: familyId,
        primaryMemberGmkId: residentProfile.gmkId,
        primaryMemberEmail: residentProfile.email,
        salutation,
        fullName: normalizedResidentName,
        phone: finalPhone,
        whatsAppNumber: finalWhatsApp,
        whatsAppSameAsMobile,
        unitKey: residentProfile.unitKey,
        displayUnitNumber: residentProfile.displayUnitNumber,
        unitType: residentProfile.unitType || 'Apartment',
        professionCategory: dbProfessionCategory,
        professionTitle: dbProfessionTitle,
        company: dbCompany,
        expertiseCategories: dbExpertiseCategories,
        contactPreference: (directoryOption === 'me' || directoryOption === 'both') ? contactPreference : undefined,
        directoryConsent: dbDirectoryConsent,
        directoryOption,
        doctorConsent: dbDoctorConsent,
        spouseProfessionCategory: dbSpouseProfessionCategory,
        spouseProfessionTitle: dbSpouseProfessionTitle,
        spouseCompany: dbSpouseCompany,
        spouseExpertiseCategories: dbSpouseExpertiseCategories,
        spouseContactPreference: (directoryOption === 'spouse' || directoryOption === 'both') ? spouseContactPreference : undefined,
        spouseDoctorConsent: dbSpouseDoctorConsent,
        spouseName: spouseName.trim(),
        spousePhone: dbSpousePhone,
        spouseWhatsApp: dbSpouseWhatsApp,
        spouseEmail: dbSpouseEmail,
        onboardingCompleted: false, // NOT finished yet
        updatedAt: new Date().toISOString()
      };

      const batchNum = writeBatch(db);

      // Save families doc with merge: true so we don't wipe out other fields
      batchNum.set(doc(db, "families", familyId), sanitizeFirestorePayload(partialFamilyModel), { merge: true });

      // Save residents document with merge: true
      batchNum.set(doc(db, "residents", residentProfile.gmkId), sanitizeFirestorePayload({
        fullName: normalizedResidentName,
        salutation,
        phone: finalPhone,
        updatedAt: new Date().toISOString(),
        professionCategory: dbProfessionCategory,
        professionTitle: dbProfessionTitle,
        company: dbCompany,
        expertiseCategories: dbExpertiseCategories,
        contactPreference,
        directoryConsent,
        doctorConsent: dbDoctorConsent
      }), { merge: true });

      // Construct family members list of what has been added so far
      const finalMembers: FamilyMember[] = [];
      if (spouseEnabled && spouseName.trim()) {
        const spouseWaNorm = spouseWhatsApp.trim() ? validateAndNormalizePhoneNumber(spouseWhatsAppCode, spouseWhatsApp).normalized : '';
        finalMembers.push({
          id: `mem_${residentProfile.gmkId}_spouse`,
          familyId,
          name: normalizeName(spouseName),
          relationship: 'spouse',
          gender: spouseGender,
          whatsAppNumber: spouseWaNorm ? `${spouseWhatsAppCode}${spouseWaNorm}` : undefined,
          createdAt: new Date().toISOString()
        });
      }

      const committedList = autoCommitDrafts(familyMembersList);
      let childCount = 0;
      let parentCount = 0;
      let depCount = 0;
      committedList.forEach((mem) => {
        let memId = '';
        if (mem.relationship === 'child') {
          childCount++;
          memId = `mem_${residentProfile.gmkId}_child_${childCount}`;
        } else if (mem.relationship === 'parent') {
          parentCount++;
          memId = `mem_${residentProfile.gmkId}_parent_${parentCount}`;
        } else if (mem.relationship === 'dependent') {
          depCount++;
          memId = `mem_${residentProfile.gmkId}_dependent_${depCount}`;
        }

        const memberPayload: FamilyMember = {
          id: memId,
          familyId,
          name: normalizeName(mem.name),
          relationship: mem.relationship,
          gender: mem.gender,
          createdAt: new Date().toISOString()
        };

        if (mem.relationship === 'child' && mem.yearOfBirth) {
          memberPayload.yearOfBirth = mem.yearOfBirth.trim();
        } else if ((mem.relationship === 'parent' || mem.relationship === 'dependent') && mem.notes) {
          memberPayload.notes = mem.notes.trim();
        }

        finalMembers.push(memberPayload);
      });

      // Find existing family members and delete them, then insert new ones
      const existingMembersQuery = query(collection(db, "familyMembers"), where("familyId", "==", familyId));
      const existingSnap = await getDocs(existingMembersQuery);
      existingSnap.forEach((d) => {
        batchNum.delete(doc(db, "familyMembers", d.id));
      });

      finalMembers.forEach((member) => {
        batchNum.set(doc(db, "familyMembers", member.id), sanitizeFirestorePayload(member));
      });

      await batchNum.commit();

      await createAuditLog(
        'ONBOARDING_PAUSED',
        residentProfile.email,
        'resident',
        residentProfile.gmkId,
        `Resident ${normalizedResidentName} paused onboarding at step ${step} and logged out. Progress saved.`
      );

      // Call firebase signOut
      await signOut(auth);
    } catch (err: any) {
      console.error("❌ Save and logoff failed:", err);
      setErrorMsg(`Save and logoff error: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  const handleFinalSubmit = async () => {
    setLoading(true);
    setErrorMsg(null);
    
    try {
      const phoneNorm = phoneMain ? validateAndNormalizePhoneNumber(phoneCode, phoneMain).normalized : '';
      const waNorm = whatsAppSameAsMobile 
        ? phoneNorm 
        : (whatsAppMain ? validateAndNormalizePhoneNumber(whatsAppCode, whatsAppMain).normalized : '');
      const finalPhone = phoneNorm ? `${phoneCode}${phoneNorm}` : '';
      const finalWhatsApp = waNorm ? (whatsAppSameAsMobile ? `${phoneCode}${phoneNorm}` : `${whatsAppCode}${waNorm}`) : '';
      const familyId = `fam_${residentProfile.gmkId}`;

      const normalizedResidentName = normalizeName(fullName);

      const dbDirectoryConsent = directoryOption !== 'none';

      const dbProfessionCategory = (directoryOption === 'me' || directoryOption === 'both') 
        ? (professionCategory === 'Other' ? (customProfessionCategory.trim() || 'Other') : professionCategory)
        : '';
      const dbProfessionTitle = (directoryOption === 'me' || directoryOption === 'both') ? professionTitle.trim() : '';
      const dbCompany = (directoryOption === 'me' || directoryOption === 'both') ? company.trim() : '';
      const dbExpertiseCategories = (directoryOption === 'me' || directoryOption === 'both') 
        ? expertiseKeywords.split(',').map(s => s.trim()).filter(Boolean)
        : [];
      const dbDoctorConsent = (directoryOption === 'me' || directoryOption === 'both') 
        ? ((dbProfessionTitle.toLowerCase().includes('doctor') || dbProfessionCategory === 'Healthcare' || salutation === 'Dr') ? doctorConsent : false)
        : false;

      const dbSpouseProfessionCategory = (directoryOption === 'spouse' || directoryOption === 'both') 
        ? (spouseProfessionCategory === 'Other' ? (customSpouseProfessionCategory.trim() || 'Other') : spouseProfessionCategory)
        : '';
      const dbSpouseProfessionTitle = (directoryOption === 'spouse' || directoryOption === 'both') ? spouseProfessionTitle.trim() : '';
      const dbSpouseCompany = (directoryOption === 'spouse' || directoryOption === 'both') ? spouseCompany.trim() : '';
      const dbSpouseExpertiseCategories = (directoryOption === 'spouse' || directoryOption === 'both') 
        ? spouseExpertiseKeywords.split(',').map(s => s.trim()).filter(Boolean)
        : [];
      const dbSpouseDoctorConsent = (directoryOption === 'spouse' || directoryOption === 'both') 
        ? ((dbSpouseProfessionTitle.toLowerCase().includes('doctor') || dbSpouseProfessionCategory === 'Healthcare') ? spouseDoctorConsent : false)
        : false;

      const spouseWaNorm = spouseWhatsApp.trim() ? validateAndNormalizePhoneNumber(spouseWhatsAppCode, spouseWhatsApp).normalized : '';
      const dbSpouseWhatsApp = spouseWaNorm ? `${spouseWhatsAppCode}${spouseWaNorm}` : '';
      const spousePhNorm = (!spousePhoneSameAsWhatsApp && spousePhone.trim()) ? validateAndNormalizePhoneNumber(spousePhoneCode, spousePhone).normalized : '';
      const dbSpousePhone = spousePhoneSameAsWhatsApp ? dbSpouseWhatsApp : (spousePhNorm ? `${spousePhoneCode}${spousePhNorm}` : '');
      const dbSpouseEmail = spouseEmail.trim();

      // 1. Prepare decoupled family payloads
      const finalFamilyModel: Family = {
        id: familyId,
        primaryMemberGmkId: residentProfile.gmkId,
        primaryMemberEmail: residentProfile.email,
        salutation,
        fullName: normalizedResidentName,
        phone: finalPhone,
        whatsAppNumber: finalWhatsApp,
        whatsAppSameAsMobile,
        unitKey: residentProfile.unitKey,
        displayUnitNumber: residentProfile.displayUnitNumber,
        unitType: residentProfile.unitType || 'Apartment',
        professionCategory: dbProfessionCategory,
        professionTitle: dbProfessionTitle,
        company: dbCompany,
        expertiseCategories: dbExpertiseCategories,
        contactPreference: (directoryOption === 'me' || directoryOption === 'both') ? contactPreference : undefined,
        directoryConsent: dbDirectoryConsent,
        directoryOption,
        doctorConsent: dbDoctorConsent,
        spouseProfessionCategory: dbSpouseProfessionCategory,
        spouseProfessionTitle: dbSpouseProfessionTitle,
        spouseCompany: dbSpouseCompany,
        spouseExpertiseCategories: dbSpouseExpertiseCategories,
        spouseContactPreference: (directoryOption === 'spouse' || directoryOption === 'both') ? spouseContactPreference : undefined,
        spouseDoctorConsent: dbSpouseDoctorConsent,
        spouseName: spouseName.trim(),
        spousePhone: dbSpousePhone,
        spouseWhatsApp: dbSpouseWhatsApp,
        spouseEmail: dbSpouseEmail,
        onboardingCompleted: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // Construct family members list
      const finalMembers: FamilyMember[] = [];
      
      // Add spouse if field contains a name
      if (spouseEnabled && spouseName.trim()) {
        finalMembers.push({
          id: `mem_${residentProfile.gmkId}_spouse`,
          familyId,
          name: normalizeName(spouseName),
          relationship: 'spouse',
          gender: spouseGender,
          whatsAppNumber: dbSpouseWhatsApp || undefined,
          phone: dbSpousePhone || undefined,
          email: dbSpouseEmail || undefined,
          createdAt: new Date().toISOString()
        });
      }

      const committedList = autoCommitDrafts(familyMembersList);
      let childCount = 0;
      let parentCount = 0;
      let depCount = 0;
      committedList.forEach((mem) => {
        let memId = '';
        if (mem.relationship === 'child') {
          childCount++;
          memId = `mem_${residentProfile.gmkId}_child_${childCount}`;
        } else if (mem.relationship === 'parent') {
          parentCount++;
          memId = `mem_${residentProfile.gmkId}_parent_${parentCount}`;
        } else if (mem.relationship === 'dependent') {
          depCount++;
          memId = `mem_${residentProfile.gmkId}_dependent_${depCount}`;
        }

        const memberPayload: FamilyMember = {
          id: memId,
          familyId,
          name: normalizeName(mem.name),
          relationship: mem.relationship,
          gender: mem.gender,
          createdAt: new Date().toISOString()
        };

        if (mem.relationship === 'child' && mem.yearOfBirth) {
          memberPayload.yearOfBirth = mem.yearOfBirth.trim();
        } else if ((mem.relationship === 'parent' || mem.relationship === 'dependent') && mem.notes) {
          memberPayload.notes = mem.notes.trim();
        }

        finalMembers.push(memberPayload);
      });

      // 2. Transact to Firestore inside Batch for database integrity and performance
      const batchNum = writeBatch(db);

      // A. Write standard families record
      batchNum.set(doc(db, "families", familyId), sanitizeFirestorePayload(finalFamilyModel), { merge: true });

      // B. Update primary resident status metadata and mobile numbers
      batchNum.set(doc(db, "residents", residentProfile.gmkId), sanitizeFirestorePayload({
        fullName,
        salutation,
        phone: finalPhone,
        updatedAt: new Date().toISOString(),
        // Store searchable professional tags on main resident index natively for direct querying
        professionCategory: dbProfessionCategory,
        professionTitle: dbProfessionTitle,
        company: dbCompany,
        expertiseCategories: dbExpertiseCategories,
        contactPreference,
        directoryConsent,
        doctorConsent: dbDoctorConsent
      }), { merge: true });

      // C. Clear any preceding family members documents and write brand new records
      const existingMembersQuery = query(collection(db, "familyMembers"), where("familyId", "==", familyId));
      const existingSnap = await getDocs(existingMembersQuery);
      existingSnap.forEach((d) => {
        batchNum.delete(doc(db, "familyMembers", d.id));
      });

      // Write new members list
      finalMembers.forEach((member) => {
        batchNum.set(doc(db, "familyMembers", member.id), sanitizeFirestorePayload(member));
      });

      await batchNum.commit();

      await createAuditLog(
        'PROFILE_COMPLETED',
        residentProfile.email,
        'resident',
        residentProfile.gmkId,
        `Resident ${fullName} completed five-stage profile compilation wizard and set up family directory permissions.`
      );

      onComplete();
    } catch (err: any) {
      console.error("❌ Profile onboarding failed:", err);
      setErrorMsg(`Database connection anomaly: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-[#FFFDF6] min-h-screen py-8 px-4 sm:px-6 lg:px-8 font-sans">
      <div className="max-w-3xl mx-auto">
        
        {/* Global Navigation Consistency Dashboard Home Button */}
        <div className="mb-4 flex justify-between items-center">
          <button
            type="button"
            onClick={onComplete}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-white border border-stone-250 rounded-xl text-stone-750 hover:bg-stone-50 hover:text-[#0f4c2a] text-xs font-extrabold transition-all cursor-pointer shadow-sm"
          >
            <ArrowLeft className="w-3.5 h-3.5 text-[#d4af37]" />
            <span>Home</span>
          </button>
        </div>

        {/* Top Header Strip - Decluttered and prominent */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8 bg-white border border-stone-200/80 rounded-2xl p-4 shadow-sm animate-fadeIn">
          <div className="space-y-1 text-left">
            <h2 className="text-xl font-extrabold text-[#0f4c2a] tracking-tight font-heading">
              Family Profile Management
            </h2>
            <p className="text-[#0f4c2a]/80 text-[11px] leading-tight">
              Manage your household information for events, communication and community services.
            </p>
          </div>
          
          {!onboardingCompletedAlready && (
            <button
              type="button"
              disabled={loading}
              onClick={handleSaveAndLogoff}
              className="inline-flex items-center justify-center space-x-1.5 px-3 py-2 border border-red-200 text-red-700 bg-red-50/50 hover:bg-red-50 rounded-xl text-xs font-bold transition-all cursor-pointer disabled:opacity-50 shrink-0"
              title="Save progress and log off community workspace"
            >
              <LogOut className="w-4 h-4 text-red-500" />
              <span>Save & Logoff</span>
            </button>
          )}
        </div>

        {/* Progress Timeline Tracker Indicator Cards */}
        <div className="grid grid-cols-4 gap-1 mb-8">
          {[
            { nr: 1, name: "Resident Information" },
            { nr: 2, name: "Family Members" },
            { nr: 3, name: "Profession" },
            { nr: 4, name: "Review & Confirm" }
          ].map((s) => (
            <div key={s.nr} className="flex flex-col items-center space-y-1">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs border transition-all ${
                step === s.nr 
                  ? 'bg-[#0f4c2a] text-white border-[#0f4c2a] shadow-md shadow-emerald-900/10 scale-105' 
                  : step > s.nr 
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-white text-stone-650 border-stone-250 font-extrabold'
              }`}>
                {step > s.nr ? <Check className="w-4 h-4" /> : s.nr}
              </div>
              <span className={`hidden sm:inline text-[9px] font-bold uppercase tracking-wider text-center ${
                step === s.nr ? 'text-[#0f4c2a]' : 'text-stone-650 font-bold'
              }`}>{s.name}</span>
            </div>
          ))}
        </div>

        {/* Error Alert Box */}
        {errorMsg && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-2xl flex items-start space-x-3 text-red-700 text-xs font-semibold shadow-sm">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-500" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Dynamic Card Area */}
        <div className="bg-white border border-stone-200 shadow-xl shadow-stone-200/30 rounded-3xl p-6 md:p-8">
          
          {/* STEP 1: PRIMARY RESIDENT DETAILS */}
          {step === 1 && (
            <div className="space-y-6 animate-fadeIn">
              <div className="border-b border-stone-100 pb-3 flex items-center space-x-2">
                <User className="w-5 h-5 text-[#d4af37]" />
                <h3 className="text-base font-bold text-stone-800 font-heading">Resident Information</h3>
              </div>

              {/* Compact Information Card Above The Form */}
              <div className="bg-stone-50 border border-stone-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 text-xs font-sans shadow-sm">
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-emerald-50 text-[#0f4c2a] rounded-xl border border-emerald-100 shrink-0">
                    <Shield className="w-4.5 h-4.5 text-[#d4af37]" />
                  </div>
                  <div>
                    <span className="text-[10px] text-stone-500 uppercase tracking-wider font-extrabold block leading-tight">Gmk Resident ID</span>
                    <strong className="text-stone-800 text-xs font-sans font-extrabold">{residentProfile.gmkId}</strong>
                  </div>
                </div>
                
                <div className="hidden sm:block h-8 w-px bg-stone-200"></div>
                
                <div className="space-y-0.5">
                  <span className="text-[10px] text-stone-500 uppercase tracking-wider font-extrabold block leading-tight">Registered Email</span>
                  <strong className="text-stone-800 text-xs font-semibold block break-all">{residentProfile.email}</strong>
                </div>
                
                <div className="hidden sm:block h-8 w-px bg-stone-200"></div>
                
                <div className="space-y-0.5">
                  <span className="text-[10px] text-stone-500 uppercase tracking-wider font-extrabold block leading-tight">Unit Location</span>
                  <strong className="text-[#0f4c2a] text-xs font-extrabold block">{residentProfile.displayUnitNumber}</strong>
                </div>
              </div>

              {/* Editable Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold tracking-wider text-stone-850 font-black mb-1.5 font-heading text-xs">
                    Salutation *
                  </label>
                  <select
                    value={salutation}
                    onChange={(e) => setSalutation(e.target.value as any)}
                    className="block w-full px-3 py-2.5 border border-stone-250 rounded-xl bg-stone-50/50 text-stone-900 text-xs focus:ring-1 focus:ring-[#0f4c2a] focus:border-[#0f4c2a] cursor-pointer font-semibold"
                  >
                    <option value="">-Select-</option>
                    <option value="Mr">Mr</option>
                    <option value="Mrs">Mrs</option>
                    <option value="Ms">Ms</option>
                    <option value="Dr">Dr</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] uppercase font-bold tracking-wider text-stone-850 font-black mb-1.5 font-heading text-xs">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => handleNameNormalization(e.target.value)}
                    onBlur={handleNameBlur}
                    className="block w-full px-3 py-2.5 border border-stone-250 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0f4c2a] focus:border-[#0f4c2a] text-xs text-stone-900 bg-stone-50/50 font-semibold"
                  />
                </div>
              </div>

              {/* Phone Contacts */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold tracking-wider text-stone-850 font-black mb-1.5 font-heading text-xs">
                    Primary Mobile *
                  </label>
                  <div className="flex space-x-2">
                    <select
                      value={phoneCode}
                      disabled={residentProfile.status === 'active' || residentProfile.status === 'archived'}
                      onChange={(e) => setPhoneCode(e.target.value)}
                      className="w-auto max-w-[150px] sm:max-w-[200px] px-3 py-2.5 border border-stone-250 rounded-xl bg-stone-50/50 text-stone-900 text-xs focus:ring-1 focus:ring-[#0f4c2a] focus:border-[#0f4c2a] cursor-pointer font-bold shrink-0 disabled:opacity-55 disabled:cursor-not-allowed"
                    >
                      <option value="">-Select-</option>
                      {COUNTRY_CODES.map(c => <option key={`${c.name}-${c.code}`} value={c.code}>{c.code} {c.name}</option>)}
                    </select>
                    <input
                      type="text"
                      required
                      value={phoneMain}
                      disabled={residentProfile.status === 'active' || residentProfile.status === 'archived'}
                      onChange={(e) => setPhoneMain(e.target.value.replace(/\D/g, ''))}
                      className="block flex-1 min-w-0 px-3 py-2.5 border border-stone-250 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0f4c2a] focus:border-[#0f4c2a] text-xs text-stone-900 bg-stone-50/50 font-bold disabled:opacity-55 disabled:cursor-not-allowed"
                    />
                  </div>
                </div>

                {/* WhatsApp configuration */}
                <div className="space-y-3">
                  <div className="flex items-center space-x-2 pt-6">
                    <input
                      type="checkbox"
                      id="whats_same_checkbox"
                      checked={whatsAppSameAsMobile}
                      onChange={(e) => setWhatsAppSameAsMobile(e.target.checked)}
                      className="h-4 w-4 text-[#0f4c2a] focus:ring-[#0f4c2a] border-stone-350 rounded cursor-pointer"
                    />
                    <label htmlFor="whats_same_checkbox" className="text-xs text-stone-800 cursor-pointer select-none font-extrabold">
                      WhatsApp Number same as Mobile Number
                    </label>
                  </div>

                  {!whatsAppSameAsMobile && (
                    <div className="animate-fadeIn">
                      <label className="block text-[10px] uppercase font-bold tracking-wider text-stone-850 font-black mb-1.5 font-heading text-xs">
                        WhatsApp Number *
                      </label>
                      <div className="flex space-x-2">
                        <select
                          value={whatsAppCode}
                          onChange={(e) => setWhatsAppCode(e.target.value)}
                          className="w-auto max-w-[150px] sm:max-w-[200px] px-3 py-2.5 border border-stone-250 rounded-xl bg-stone-50/50 text-stone-900 text-xs focus:ring-1 focus:ring-[#0f4c2a] focus:border-[#0f4c2a] cursor-pointer font-bold shrink-0"
                        >
                          <option value="">-Select-</option>
                          {COUNTRY_CODES.map(c => <option key={`${c.name}-${c.code}`} value={c.code}>{c.code} {c.name}</option>)}
                        </select>
                        <input
                          type="text"
                          required
                          value={whatsAppMain}
                          onChange={(e) => setWhatsAppMain(e.target.value.replace(/\D/g, ''))}
                          className="block flex-1 min-w-0 px-3 py-2.5 border border-stone-250 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0f4c2a] focus:border-[#0f4c2a] text-xs text-stone-900 bg-stone-50/50 font-bold"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Step 1 Real-time Validation Warns */}
              {!isStep1Valid() && (
                <div className="mt-4 p-3 bg-red-50/50 border border-red-100 rounded-xl text-red-600 text-[10px] font-bold flex items-center space-x-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse shrink-0"></span>
                  <span>{validateStep1() || "Mandatory fields: Salutation, Full Name, and valid mobile numbers are required."}</span>
                </div>
              )}
            </div>
          )}

          {/* STEP 2: FAMILY LIST (DECOUPLED FAMILY MEMBERS) */}
          {step === 2 && (
            <div className="space-y-6 animate-fadeIn">
              <div className="border-b border-stone-100 pb-3 flex items-center space-x-2">
                <Users className="w-5 h-5 text-[#d4af37]" />
                <h3 className="text-base font-bold text-stone-800 font-heading">Family Members</h3>
              </div>

              <p className="text-xs text-stone-800 font-semibold">
                Building a complete household list. Add immediate family members (spouse, children, parents, others) residing under this unit.
              </p>

              {/* Added Members Table or List */}
              <div className="space-y-3">
                <h4 className="text-[11px] font-extrabold text-[#0f4c2a] uppercase tracking-widest">Current Household Members</h4>
                <div className="border border-stone-250 rounded-2xl overflow-hidden bg-stone-50">
                  {familyMembersList.length === 0 && !spouseEnabled ? (
                    <div className="p-4 text-center text-xs text-stone-750 italic font-semibold whitespace-pre-line">
                      Your family profile is currently empty.

                      Add your spouse, children, parents, or other household members below.
                    </div>
                  ) : (
                    <table className="min-w-full divide-y divide-stone-200 text-xs">
                      <thead className="bg-[#0f4c2a]/5 font-heading text-stone-900 font-bold">
                        <tr>
                          <th className="px-4 py-2 text-left">Name</th>
                          <th className="px-4 py-2 text-left">Relationship</th>
                          <th className="px-4 py-2 text-left">Gender</th>
                          <th className="px-4 py-2 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-150 bg-white shadow-inner">
                        {spouseEnabled && spouseName.trim() && (
                          <tr>
                            <td className="px-4 py-3 font-extrabold text-stone-850">{spouseName}</td>
                            <td className="px-4 py-3"><span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 border border-emerald-200 font-extrabold uppercase text-[9px]">Spouse</span></td>
                            <td className="px-4 py-3 font-semibold text-stone-800 capitalize">{spouseGender}</td>
                            <td className="px-4 py-3 text-right">
                              <button
                                type="button"
                                onClick={() => {
                                  setSpouseEnabled(false);
                                  setSpouseName('');
                                  setSpouseGender('');
                                  setSpouseWhatsApp('');
                                }}
                                className="text-red-650 font-black hover:underline cursor-pointer text-xs"
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        )}
                        {[...familyMembersList]
                          .sort((a, b) => {
                            const order = { 'spouse': 0, 'child': 1, 'parent': 2, 'dependent': 3 };
                            return (order[a.relationship as keyof typeof order] ?? 4) - (order[b.relationship as keyof typeof order] ?? 4);
                          })
                          .map((m, idx) => (
                            <tr key={idx}>
                              <td className="px-4 py-3 font-semibold text-stone-800">{m.name}</td>
                              <td className="px-4 py-3">
                                <span className="px-2 py-0.5 rounded-full bg-stone-150 text-stone-750 border border-stone-250 font-extrabold uppercase text-[9px]">
                                  {m.relationship === 'dependent' ? 'Other' : m.relationship}
                                </span>
                              </td>
                              <td className="px-4 py-3 capitalize font-bold text-stone-800">{m.gender}</td>
                              <td className="px-4 py-3 text-right">
                                <button
                                  type="button"
                                  onClick={() => handleRemoveMemberAt(idx)}
                                  className="text-red-650 font-black hover:underline cursor-pointer"
                                >
                                  Remove
                                </button>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              {/* Dynamic Add Spouse Form */}
              <div className="p-4 border border-[#d4af37]/25 bg-[#FFFDF6] rounded-2xl space-y-4 shadow-sm">
                <div className="flex items-center space-x-2 w-full">
                  <input
                    type="checkbox"
                    id="spouse_enabled_check"
                    checked={spouseEnabled}
                    onChange={(e) => {
                      const enabled = e.target.checked;
                      setSpouseEnabled(enabled);
                      if (!enabled) {
                        setSpouseName('');
                        setSpouseGender('');
                        setSpouseWhatsApp('');
                      }
                    }}
                    className="h-4 w-4 text-[#0f4c2a] focus:ring-[#0f4c2a] border-stone-300 rounded cursor-pointer"
                  />
                  <label htmlFor="spouse_enabled_check" className="text-xs font-black text-stone-900 cursor-pointer select-none flex items-center space-x-1.5 flex-1">
                    <span>Add Spouse Details</span>
                    {spouseExistedInDb && (
                      <span className="text-[8px] px-1.5 py-0.5 bg-emerald-50 text-emerald-800 rounded font-bold border border-emerald-100 uppercase tracking-wider">
                        Pre-populated
                      </span>
                    )}
                  </label>
                  {spouseEnabled && (
                    <button
                      type="button"
                      onClick={() => {
                        setSpouseEnabled(false);
                        setSpouseName('');
                        setSpouseGender('');
                        setSpouseWhatsApp('');
                      }}
                      className="text-red-650 hover:text-red-800 hover:underline font-black text-xs cursor-pointer"
                    >
                      Remove Spouse
                    </button>
                  )}
                </div>

                {spouseEnabled && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 animate-fadeIn">
                    <div className="sm:col-span-2">
                      <label className="block text-[10px] uppercase font-bold text-stone-800 font-extrabold mb-1">Spouse Name *</label>
                      <input
                        type="text"
                        value={spouseName}
                        onChange={(e) => setSpouseName(e.target.value)}
                        className="block w-full px-2.5 py-1.5 border border-stone-250 rounded-lg text-xs text-stone-900 font-semibold focus:ring-1 focus:ring-[#0f4c2a]"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase font-bold text-stone-800 font-extrabold mb-1">Gender *</label>
                      <select
                        value={spouseGender}
                        onChange={(e) => setSpouseGender(e.target.value as any)}
                        className="block w-full px-2 py-1.5 border border-stone-250 rounded-lg text-xs text-stone-900 font-bold focus:ring-1 focus:ring-[#0f4c2a] cursor-pointer"
                      >
                        <option value="">-Select-</option>
                        <option value="female">Female</option>
                        <option value="male">Male</option>
                      </select>
                    </div>
                    <div className="sm:col-span-3">
                      <label className="block text-[10px] uppercase font-bold text-stone-800 font-extrabold mb-1">Spouse WhatsApp No (Optional)</label>
                      <div className="flex space-x-2">
                        <select
                          value={spouseWhatsAppCode}
                          onChange={(e) => setSpouseWhatsAppCode(e.target.value)}
                          className="w-auto max-w-[150px] sm:max-w-[200px] px-2 py-1.5 border border-stone-250 rounded-lg bg-stone-50 text-stone-900 text-xs focus:ring-1 focus:ring-[#0f4c2a] focus:border-[#0f4c2a] cursor-pointer font-bold shrink-0"
                        >
                          <option value="">-Select-</option>
                          {COUNTRY_CODES.map(c => <option key={`spouse-wa-${c.name}-${c.code}`} value={c.code}>{c.code} {c.name}</option>)}
                        </select>
                        <input
                          type="text"
                          value={spouseWhatsApp}
                          placeholder="Optional"
                          onChange={(e) => setSpouseWhatsApp(e.target.value.replace(/\D/g, ''))}
                          className="block flex-1 min-w-0 px-2.5 py-1.5 border border-[#ced4da] rounded-lg text-xs text-stone-900 font-semibold focus:ring-1 focus:ring-[#0f4c2a]"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
              {/* Staggered blocks for child / parent / relative insertion */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                
                {/* Child Accumulator */}
                <div className="p-4 border border-stone-200 rounded-2xl bg-stone-50/50 space-y-3">
                  <div className="flex items-center justify-between border-b border-stone-200 pb-1.5">
                    <span className="text-[10px] font-bold text-[#0f4c2a] uppercase tracking-wider block">Add Child?</span>
                    <div className="flex items-center space-x-3">
                      <label className={`inline-flex items-center text-[10px] cursor-pointer select-none transition-all ${
                        childrenApplicable ? 'text-[#0f4c2a] font-black' : 'text-stone-400 font-medium'
                      }`}>
                        <input
                          type="radio"
                          name="children_applicable_radio"
                          checked={childrenApplicable}
                          onChange={() => setChildrenApplicable(true)}
                          className="h-3 w-3 text-[#0f4c2a] focus:ring-[#0f4c2a] border-stone-300 mr-1 cursor-pointer"
                        />
                        <span>Yes</span>
                      </label>
                      <label className={`inline-flex items-center text-[10px] cursor-pointer select-none transition-all ${
                        !childrenApplicable ? 'text-stone-800 font-black' : 'text-stone-400 font-medium'
                      }`}>
                        <input
                          type="radio"
                          name="children_applicable_radio"
                          checked={!childrenApplicable}
                          onChange={() => setChildrenApplicable(false)}
                          className="h-3 w-3 text-[#0f4c2a] focus:ring-[#0f4c2a] border-stone-300 mr-1 cursor-pointer"
                        />
                        <span>No</span>
                      </label>
                    </div>
                  </div>
                  
                  {childrenApplicable && (
                    <div className="space-y-3 animate-fadeIn">
                      <div>
                        <label className="block text-[9px] uppercase font-bold text-stone-855 font-black mb-1">Name</label>
                        <input 
                          type="text" 
                          value={childFormName} 
                          onChange={e => setChildFormName(e.target.value)} 
                          className="block w-full px-2 py-1 border border-stone-250 rounded text-xs bg-white text-stone-900 font-semibold focus:ring-1 focus:ring-[#0f4c2a]" 
                        />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-heading">
                        <div>
                          <label className="block text-[9px] uppercase font-bold text-stone-855 font-black mb-1">Gender</label>
                          <select 
                            value={childGender} 
                            onChange={e => setChildGender(e.target.value as any)} 
                            className="block w-full h-[30px] py-1 px-2 border border-stone-250 rounded text-xs bg-white text-stone-900 font-bold focus:ring-1 focus:ring-[#0f4c2a] cursor-pointer"
                          >
                            <option value="">-Select-</option>
                            <option value="male">Male</option>
                            <option value="female">Female</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[9px] uppercase font-bold text-stone-855 font-black mb-1">Year of Birth *</label>
                          <input 
                            type="text" 
                            maxLength={4} 
                            value={childYob} 
                            onChange={e => setChildYob(e.target.value.replace(/\D/g,''))} 
                            className="block w-full px-2 py-1 border border-stone-250 rounded text-xs bg-white text-stone-900 font-semibold focus:ring-1 focus:ring-[#0f4c2a]" 
                          />
                        </div>
                      </div>
                      <button 
                        type="button" 
                        disabled={!childFormName.trim() || !childGender || childYob.trim().length !== 4}
                        onClick={handleAddChild} 
                        className="w-full py-1 px-3 bg-[#0f4c2a] text-white text-[10px] uppercase tracking-wider font-bold rounded hover:bg-[#125831] cursor-pointer disabled:bg-stone-300 disabled:text-stone-500 disabled:cursor-not-allowed shadow-sm"
                      >
                        {familyMembersList.filter(m => m.relationship === 'child').length === 0 ? "Add Child" : `Add Child ${familyMembersList.filter(m => m.relationship === 'child').length + 1}`}
                      </button>
                    </div>
                  )}
                </div>

                {/* Parent Accumulator */}
                <div className="p-4 border border-stone-200 rounded-2xl bg-stone-50/50 space-y-3">
                  <div className="flex items-center justify-between border-b border-stone-200 pb-1.5">
                    <span className="text-[10px] font-bold text-[#0f4c2a] uppercase tracking-wider block font-heading">Add Parents?</span>
                    <div className="flex items-center space-x-3">
                      <label className={`inline-flex items-center text-[10px] cursor-pointer select-none transition-all ${
                        parentsApplicable ? 'text-[#0f4c2a] font-black' : 'text-stone-400 font-medium'
                      }`}>
                        <input
                          type="radio"
                          name="parents_applicable_radio"
                          checked={parentsApplicable}
                          onChange={() => setParentsApplicable(true)}
                          className="h-3 w-3 text-[#0f4c2a] focus:ring-[#0f4c2a] border-stone-300 mr-1 cursor-pointer"
                        />
                        <span>Yes</span>
                      </label>
                      <label className={`inline-flex items-center text-[10px] cursor-pointer select-none transition-all ${
                        !parentsApplicable ? 'text-stone-800 font-black' : 'text-stone-400 font-medium'
                      }`}>
                        <input
                          type="radio"
                          name="parents_applicable_radio"
                          checked={!parentsApplicable}
                          onChange={() => setParentsApplicable(false)}
                          className="h-3 w-3 text-[#0f4c2a] focus:ring-[#0f4c2a] border-stone-300 mr-1 cursor-pointer"
                        />
                        <span>No</span>
                      </label>
                    </div>
                  </div>

                  {parentsApplicable && (
                    <div className="space-y-3 animate-fadeIn">
                      <div>
                        <label className="block text-[9px] uppercase font-bold text-stone-855 font-black mb-1">Name</label>
                        <input 
                          type="text" 
                          value={parentFormName} 
                          onChange={e => setParentFormName(e.target.value)} 
                          className="block w-full px-2 py-1 border border-stone-250 rounded text-xs bg-white text-stone-900 font-semibold focus:ring-1 focus:ring-[#0f4c2a]" 
                        />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-heading">
                        <div>
                          <label className="block text-[9px] uppercase font-bold text-stone-855 font-black mb-1">Gender</label>
                          <select 
                            value={parentGender} 
                            onChange={e => setParentGender(e.target.value as any)} 
                            className="block w-full h-[30px] py-1 px-2 border border-stone-250 rounded text-xs bg-white text-stone-900 font-bold focus:ring-1 focus:ring-[#0f4c2a] cursor-pointer"
                          >
                            <option value="">-Select-</option>
                            <option value="male">Male</option>
                            <option value="female">Female</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[9px] uppercase font-bold text-stone-855 font-black mb-1">Optional notes</label>
                          <input 
                            type="text" 
                            placeholder="Add optional notes..."
                            value={parentNotes} 
                            onChange={e => setParentNotes(e.target.value)} 
                            className="block w-full px-2 py-1 border border-stone-250 rounded text-xs bg-white text-stone-900 font-semibold focus:ring-1 focus:ring-[#0f4c2a]" 
                          />
                        </div>
                      </div>
                      <button 
                        type="button" 
                        disabled={!parentFormName.trim() || !parentGender} 
                        onClick={handleAddParent} 
                        className="w-full py-1 px-3 bg-[#0f4c2a] text-white text-[10px] uppercase tracking-wider font-bold rounded hover:bg-[#125831] cursor-pointer disabled:bg-stone-300 disabled:text-stone-500 disabled:cursor-not-allowed shadow-sm"
                      >
                        Add Parent
                      </button>
                    </div>
                  )}
                </div>

                {/* Dependent/Others Accumulator */}
                <div className="p-4 border border-stone-200 rounded-2xl bg-stone-50/50 space-y-3">
                  <div className="flex items-center justify-between border-b border-stone-200 pb-1.5 font-heading">
                    <span className="text-[10px] font-bold text-[#0f4c2a] uppercase tracking-wider block">Add Others?</span>
                    <div className="flex items-center space-x-3">
                      <label className={`inline-flex items-center text-[10px] cursor-pointer select-none transition-all ${
                        dependentsApplicable ? 'text-[#0f4c2a] font-black' : 'text-stone-400 font-medium'
                      }`}>
                        <input
                          type="radio"
                          name="dependents_applicable_radio"
                          checked={dependentsApplicable}
                          onChange={() => setDependentsApplicable(true)}
                          className="h-3 w-3 text-[#0f4c2a] focus:ring-[#0f4c2a] border-stone-300 mr-1 cursor-pointer"
                        />
                        <span>Yes</span>
                      </label>
                      <label className={`inline-flex items-center text-[10px] cursor-pointer select-none transition-all ${
                        !dependentsApplicable ? 'text-stone-800 font-black' : 'text-stone-400 font-medium'
                      }`}>
                        <input
                          type="radio"
                          name="dependents_applicable_radio"
                          checked={!dependentsApplicable}
                          onChange={() => setDependentsApplicable(false)}
                          className="h-3 w-3 text-[#0f4c2a] focus:ring-[#0f4c2a] border-stone-300 mr-1 cursor-pointer"
                        />
                        <span>No</span>
                      </label>
                    </div>
                  </div>

                  {dependentsApplicable && (
                    <div className="space-y-3 animate-fadeIn">
                      <div>
                        <label className="block text-[9px] uppercase font-bold text-stone-855 font-black mb-1">Name</label>
                        <input 
                          type="text" 
                          value={depFormName} 
                          onChange={e => setDepFormName(e.target.value)} 
                          className="block w-full px-2 py-1 border border-stone-250 rounded text-xs bg-white text-stone-900 font-semibold focus:ring-1 focus:ring-[#0f4c2a]" 
                        />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-heading">
                        <div>
                          <label className="block text-[9px] uppercase font-bold text-stone-855 font-black mb-1">Gender</label>
                          <select 
                            value={depGender} 
                            onChange={e => setDepGender(e.target.value as any)} 
                            className="block w-full h-[30px] py-1 px-2 border border-stone-250 rounded text-xs bg-white text-stone-900 font-bold focus:ring-1 focus:ring-[#0f4c2a] cursor-pointer"
                          >
                            <option value="">-Select-</option>
                            <option value="male">Male</option>
                            <option value="female">Female</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[9px] uppercase font-bold text-stone-855 font-black mb-1">Optional notes</label>
                          <input 
                            type="text" 
                            placeholder="Add optional notes..."
                            value={depNotes} 
                            onChange={e => setDepNotes(e.target.value)} 
                            className="block w-full px-2 py-1 border border-stone-250 rounded text-xs bg-white text-stone-900 font-semibold focus:ring-1 focus:ring-[#0f4c2a]" 
                          />
                        </div>
                      </div>
                      <button 
                        type="button" 
                        disabled={!depFormName.trim() || !depGender}
                        onClick={handleAddDependent} 
                        className="w-full py-1 px-3 bg-[#0f4c2a] text-white text-[10px] uppercase tracking-wider font-bold rounded hover:bg-[#125831] cursor-pointer disabled:bg-stone-300 disabled:text-stone-500 disabled:cursor-not-allowed shadow-sm"
                      >
                        Add Other
                      </button>
                    </div>
                  )}
                </div>

              </div>

              {/* Step 2 Real-time Validation Warns */}
              {!isStep2Valid() && (
                <div className="mt-4 p-3 bg-red-50/50 border border-red-100 rounded-xl text-red-700 text-[10px] font-bold flex flex-col space-y-1 shadow-sm font-sans">
                  <div className="flex items-center space-x-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse shrink-0"></span>
                    <span>To continue, complete the mandatory fields:</span>
                  </div>
                  <ul className="list-disc pl-5 space-y-0.5 text-stone-855 font-bold leading-none select-none text-[10px]">
                    {spouseEnabled && (!spouseName.trim() || !spouseGender) && <li>Spouse Name and Gender are required when Spouse Details are checked.</li>}
                    {childrenApplicable && familyMembersList.filter(m => m.relationship === 'child').length === 0 && !(childFormName.trim() && childGender && childYob.trim().length === 4) && <li>At least one Child details (Name, Gender, and 4-digit Birth Year) must be added.</li>}
                    {parentsApplicable && familyMembersList.filter(m => m.relationship === 'parent').length === 0 && !(parentFormName.trim() && parentGender) && <li>At least one Parent details (Name and Gender) must be added.</li>}
                    {dependentsApplicable && familyMembersList.filter(m => m.relationship === 'dependent').length === 0 && !(depFormName.trim() && depGender) && <li>At least one Other relative details (Name and Gender) must be added.</li>}
                  </ul>
                </div>
              )}
            </div>
          )}
          {/* STEP 3: PROFESSIONAL INFO */}
          {step === 3 && (
            <div className="space-y-6 animate-fadeIn">
              <div className="border-b border-stone-100 pb-3 flex items-center space-x-2">
                <Briefcase className="w-5 h-5 text-[#d4af37]" />
                <h3 className="text-base font-bold text-stone-800 font-heading">Community Directory Listing</h3>
              </div>

              {/* Directory Listing Consent Question */}
              <div className="p-5 bg-stone-50 border border-stone-200 rounded-2xl space-y-3 shadow-sm">
                <p className="text-xs text-stone-900 font-extrabold block mb-1">
                  Community Directory Listing Options *
                </p>

                <div className="space-y-2.5 pl-1">
                  <label className="flex items-center space-x-3 cursor-pointer select-none">
                    <input
                      type="radio"
                      name="community_directory_listed_option"
                      checked={directoryOption === 'me'}
                      onChange={() => {
                        setDirectoryOption('me');
                        setDirectoryConsent(true);
                      }}
                      className="h-4 w-4 text-[#0f4c2a] focus:ring-[#0f4c2a] border-stone-300 cursor-pointer"
                    />
                    <span className="text-xs font-bold text-stone-800">Yes list me</span>
                  </label>

                  <label className="flex items-center space-x-3 cursor-pointer select-none">
                    <input
                      type="radio"
                      name="community_directory_listed_option"
                      checked={directoryOption === 'spouse'}
                      onChange={() => {
                        setDirectoryOption('spouse');
                        setDirectoryConsent(true);
                        setSpouseEnabled(true);
                      }}
                      className="h-4 w-4 text-[#0f4c2a] focus:ring-[#0f4c2a] border-stone-300 cursor-pointer"
                    />
                    <span className="text-xs font-bold text-stone-800">Yes list my spouse only</span>
                  </label>

                  <label className="flex items-center space-x-3 cursor-pointer select-none">
                    <input
                      type="radio"
                      name="community_directory_listed_option"
                      checked={directoryOption === 'both'}
                      onChange={() => {
                        setDirectoryOption('both');
                        setDirectoryConsent(true);
                        setSpouseEnabled(true);
                      }}
                      className="h-4 w-4 text-[#0f4c2a] focus:ring-[#0f4c2a] border-stone-300 cursor-pointer"
                    />
                    <span className="text-xs font-bold text-stone-800">Yes list me and Spouse</span>
                  </label>

                  <label className="flex items-center space-x-3 cursor-pointer select-none">
                    <input
                      type="radio"
                      name="community_directory_listed_option"
                      checked={directoryOption === 'none'}
                      onChange={() => {
                        setDirectoryOption('none');
                        setDirectoryConsent(false);
                      }}
                      className="h-4 w-4 text-[#0f4c2a] focus:ring-[#0f4c2a] border-stone-300 cursor-pointer"
                    />
                    <span className="text-xs font-bold text-stone-800">No do not list us</span>
                  </label>
                </div>
              </div>

              {directoryOption !== 'none' ? (
                <div className="space-y-6 animate-fadeIn">
                  {/* Primary Resident Section */}
                  {(directoryOption === 'me' || directoryOption === 'both') && (
                    <div className="p-5 bg-stone-50/80 border border-stone-200 rounded-2xl space-y-4 shadow-xs">
                      <div className="border-b border-stone-200 pb-2 flex items-center justify-between">
                        <h4 className="text-xs font-black text-[#0f4c2a] uppercase tracking-wider font-heading flex items-center space-x-1.5">
                          <span className="w-2 h-2 rounded-full bg-[#d4af37]"></span>
                          <span>Primary Resident: {salutation} {fullName}</span>
                        </h4>
                        <span className="text-[10px] font-extrabold text-stone-600 bg-white px-2 py-0.5 border border-stone-200 rounded-md">
                          Primary Member
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-[10px] uppercase font-bold tracking-wider text-stone-850 font-black mb-1.5 font-heading text-xs">
                            Primary Profession Category *
                          </label>
                          <select
                            value={professionCategory}
                            onChange={(e) => setProfessionCategory(e.target.value)}
                            className="block w-full px-3 py-2.5 border border-stone-250 rounded-xl bg-white text-stone-900 text-xs focus:ring-1 focus:ring-[#0f4c2a] focus:border-[#0f4c2a] cursor-pointer font-semibold"
                          >
                            <option value="">-Select-</option>
                            {PROFESSION_CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                          </select>

                          {professionCategory === 'Other' && (
                            <div className="mt-3 animate-fadeIn">
                              <label className="block text-[10px] uppercase font-bold tracking-wider text-[#0f4c2a] font-black mb-1.5 font-heading text-xs">
                                Please specify Profession Category *
                              </label>
                              <input
                                type="text"
                                required
                                placeholder="e.g. Writer, Fitness Trainer, Chef..."
                                value={customProfessionCategory}
                                onChange={(e) => setCustomProfessionCategory(e.target.value)}
                                className="block w-full px-3 py-2.5 border border-[#ced4da] rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0f4c2a] focus:border-[#0f4c2a] text-xs text-stone-900 bg-white font-semibold"
                              />
                            </div>
                          )}
                        </div>

                        <div>
                          <label className="block text-[10px] uppercase font-bold tracking-wider text-stone-850 font-black mb-1.5 font-heading text-xs">
                            Profession Title *
                          </label>
                          <input
                            type="text"
                            required
                            placeholder="Software Architect, Surgeon, Senior Accountant..."
                            value={professionTitle}
                            onChange={(e) => setProfessionTitle(e.target.value)}
                            className="block w-full px-3 py-2.5 border border-stone-250 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0f4c2a] focus:border-[#0f4c2a] text-xs text-stone-900 bg-white font-semibold"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] uppercase font-bold tracking-wider text-stone-855 font-black mb-1.5 font-heading text-xs">
                          Company / Organization *
                        </label>
                        <input
                          type="text"
                          required
                          placeholder="Type company name or Self Employed / Retired"
                          value={company}
                          onChange={(e) => setCompany(e.target.value)}
                          className="block w-full px-3 py-2.5 border border-stone-250 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0f4c2a] focus:border-[#0f4c2a] text-xs text-stone-900 bg-white font-bold"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] uppercase font-bold tracking-wider text-stone-855 font-black mb-1.5 font-heading text-xs">
                          Additional Expertise Keywords (Optional)
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. Tax Planning, Interior Design, Web Development..."
                          value={expertiseKeywords}
                          onChange={(e) => setExpertiseKeywords(e.target.value)}
                          onBlur={() => {
                            if (expertiseKeywords.trim()) {
                              setExpertiseKeywords(normalizeExpertiseKeywords(expertiseKeywords));
                            }
                          }}
                          className="block w-full px-3 py-2.5 border border-stone-250 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0f4c2a] focus:border-[#0f4c2a] text-xs text-stone-900 bg-white font-semibold"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] uppercase font-bold tracking-wider text-stone-850 font-black mb-1.5 font-heading text-xs">
                          Contact Preference *
                        </label>
                        <select
                          value={contactPreference}
                          onChange={(e) => setContactPreference(e.target.value as any)}
                          className="block w-full px-3 py-2.5 border border-stone-250 rounded-xl bg-white text-stone-900 text-xs focus:ring-1 focus:ring-[#0f4c2a] focus:border-[#0f4c2a] cursor-pointer font-bold"
                        >
                          <option value="">-Select-</option>
                          <option value="Any">Any Contact Method (Email, Phone, WhatsApp)</option>
                          <option value="WhatsApp">WhatsApp Only</option>
                          <option value="Email">Email Only</option>
                          <option value="Phone">Voice Call Only</option>
                        </select>
                      </div>

                      {(professionCategory === 'Healthcare' || professionTitle.toLowerCase().includes('doctor') || salutation === 'Dr') && (
                        <div className="p-4 bg-amber-50/60 border border-[#d4af37]/30 rounded-2xl space-y-3 animate-fadeIn">
                          <div className="flex items-start space-x-2.5">
                            <input
                              type="checkbox"
                              id="doc_consent_check"
                              checked={doctorConsent}
                              onChange={(e) => setDoctorConsent(e.target.checked)}
                              className="h-5 w-5 text-[#0f4c2a] focus:ring-[#0f4c2a] border-stone-300 rounded cursor-pointer mt-0.5"
                            />
                            <div>
                              <label htmlFor="doc_consent_check" className="text-xs uppercase font-extrabold text-[#0f4c2a] cursor-pointer select-none font-heading flex items-center space-x-1">
                                <Heart className="w-4 h-4 text-[#d4af37] animate-pulse" />
                                <span>Medical Assistance Consent</span>
                              </label>
                              <p className="text-[11px] text-stone-700 leading-relaxed mt-1">
                                Would you be willing to assist fellow community members during medical emergencies or provide health-related guidance?
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Spouse Section */}
                  {(directoryOption === 'spouse' || directoryOption === 'both') && (
                    <div className="p-5 bg-stone-50/80 border border-stone-200 rounded-2xl space-y-4 shadow-xs">
                      <div className="border-b border-stone-200 pb-2 flex items-center justify-between">
                        <h4 className="text-xs font-black text-[#0f4c2a] uppercase tracking-wider font-heading flex items-center space-x-1.5">
                          <span className="w-2 h-2 rounded-full bg-[#d4af37]"></span>
                          <span>Spouse Details</span>
                        </h4>
                        <span className="text-[10px] font-extrabold text-stone-600 bg-white px-2 py-0.5 border border-stone-200 rounded-md">
                          Spouse Member
                        </span>
                      </div>

                      <div>
                        <label className="block text-[10px] uppercase font-bold tracking-wider text-stone-850 font-black mb-1.5 font-heading text-xs">
                          Spouse Full Name *
                        </label>
                        <input
                          type="text"
                          required
                          placeholder="Enter spouse full name"
                          value={spouseName}
                          onChange={(e) => {
                            setSpouseName(e.target.value);
                            setSpouseEnabled(true);
                          }}
                          className="block w-full px-3 py-2.5 border border-stone-250 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0f4c2a] focus:border-[#0f4c2a] text-xs text-stone-900 bg-white font-semibold"
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-[10px] uppercase font-bold tracking-wider text-stone-850 font-black mb-1.5 font-heading text-xs">
                            Spouse Profession Category *
                          </label>
                          <select
                            value={spouseProfessionCategory}
                            onChange={(e) => setSpouseProfessionCategory(e.target.value)}
                            className="block w-full px-3 py-2.5 border border-stone-250 rounded-xl bg-white text-stone-900 text-xs focus:ring-1 focus:ring-[#0f4c2a] focus:border-[#0f4c2a] cursor-pointer font-semibold"
                          >
                            <option value="">-Select-</option>
                            {PROFESSION_CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                          </select>

                          {spouseProfessionCategory === 'Other' && (
                            <div className="mt-3 animate-fadeIn">
                              <label className="block text-[10px] uppercase font-bold tracking-wider text-[#0f4c2a] font-black mb-1.5 font-heading text-xs">
                                Please specify Spouse Profession Category *
                              </label>
                              <input
                                type="text"
                                required
                                placeholder="e.g. Writer, Fitness Trainer, Chef..."
                                value={customSpouseProfessionCategory}
                                onChange={(e) => setCustomSpouseProfessionCategory(e.target.value)}
                                className="block w-full px-3 py-2.5 border border-[#ced4da] rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0f4c2a] focus:border-[#0f4c2a] text-xs text-stone-900 bg-white font-semibold"
                              />
                            </div>
                          )}
                        </div>

                        <div>
                          <label className="block text-[10px] uppercase font-bold tracking-wider text-stone-850 font-black mb-1.5 font-heading text-xs">
                            Spouse Profession Title *
                          </label>
                          <input
                            type="text"
                            required
                            placeholder="Architect, Surgeon, Senior Accountant..."
                            value={spouseProfessionTitle}
                            onChange={(e) => setSpouseProfessionTitle(e.target.value)}
                            className="block w-full px-3 py-2.5 border border-stone-250 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0f4c2a] focus:border-[#0f4c2a] text-xs text-stone-900 bg-white font-semibold"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] uppercase font-bold tracking-wider text-stone-855 font-black mb-1.5 font-heading text-xs">
                          Spouse Company / Organization *
                        </label>
                        <input
                          type="text"
                          required
                          placeholder="Type company name or Self Employed / Retired"
                          value={spouseCompany}
                          onChange={(e) => setSpouseCompany(e.target.value)}
                          className="block w-full px-3 py-2.5 border border-stone-250 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0f4c2a] focus:border-[#0f4c2a] text-xs text-stone-900 bg-white font-bold"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] uppercase font-bold tracking-wider text-stone-855 font-black mb-1.5 font-heading text-xs">
                          Spouse Additional Expertise Keywords (Optional)
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. Tax Planning, Interior Design, Web Development..."
                          value={spouseExpertiseKeywords}
                          onChange={(e) => setSpouseExpertiseKeywords(e.target.value)}
                          onBlur={() => {
                            if (spouseExpertiseKeywords.trim()) {
                              setSpouseExpertiseKeywords(normalizeExpertiseKeywords(spouseExpertiseKeywords));
                            }
                          }}
                          className="block w-full px-3 py-2.5 border border-stone-250 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0f4c2a] focus:border-[#0f4c2a] text-xs text-stone-900 bg-white font-semibold"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] uppercase font-bold tracking-wider text-stone-850 font-black mb-1.5 font-heading text-xs">
                          Spouse Contact Preference *
                        </label>
                        <select
                          value={spouseContactPreference}
                          onChange={(e) => setSpouseContactPreference(e.target.value as any)}
                          className="block w-full px-3 py-2.5 border border-stone-250 rounded-xl bg-white text-stone-900 text-xs focus:ring-1 focus:ring-[#0f4c2a] focus:border-[#0f4c2a] cursor-pointer font-bold"
                        >
                          <option value="">-Select-</option>
                          <option value="Any">Any Contact Method (Email, Phone, WhatsApp)</option>
                          <option value="WhatsApp">WhatsApp Only</option>
                          <option value="Email">Email Only</option>
                          <option value="Phone">Voice Call Only</option>
                        </select>
                      </div>

                      {/* Spouse Contact Details Inputs */}
                      <div className="p-4 bg-white border border-stone-200 rounded-xl space-y-3">
                        <div className="border-b border-stone-100 pb-1.5">
                          <label className="block text-[10px] uppercase font-extrabold tracking-wider text-[#0f4c2a] font-heading">
                            Spouse Contact Information
                          </label>
                          <p className="text-[10px] text-stone-500">Provide direct contact details so residents can contact your spouse regarding professional expertise.</p>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {/* Spouse WhatsApp */}
                          <div>
                            <label className="block text-[10px] uppercase font-bold text-stone-800 mb-1">
                              Spouse WhatsApp Number {spouseContactPreference === 'WhatsApp' ? '*' : ''}
                            </label>
                            <div className="flex space-x-1.5">
                              <select
                                value={spouseWhatsAppCode}
                                onChange={(e) => setSpouseWhatsAppCode(e.target.value)}
                                className="w-auto max-w-[110px] px-2 py-2 border border-stone-250 rounded-xl bg-stone-50 text-stone-900 text-xs focus:ring-1 focus:ring-[#0f4c2a] cursor-pointer font-bold shrink-0"
                              >
                                {COUNTRY_CODES.map(c => <option key={`spouse-wa-${c.name}-${c.code}`} value={c.code}>{c.code} {c.name}</option>)}
                              </select>
                              <input
                                type="text"
                                value={spouseWhatsApp}
                                placeholder="WhatsApp number"
                                onChange={(e) => setSpouseWhatsApp(e.target.value.replace(/\D/g, ''))}
                                className="block flex-1 min-w-0 px-3 py-2 border border-stone-250 rounded-xl text-xs text-stone-900 font-semibold focus:ring-1 focus:ring-[#0f4c2a] bg-white"
                              />
                            </div>
                          </div>

                          {/* Spouse Email */}
                          <div>
                            <label className="block text-[10px] uppercase font-bold text-stone-800 mb-1">
                              Spouse Email Address {spouseContactPreference === 'Email' ? '*' : ''}
                            </label>
                            <input
                              type="email"
                              value={spouseEmail}
                              placeholder="spouse@example.com"
                              onChange={(e) => setSpouseEmail(e.target.value)}
                              className="block w-full px-3 py-2 border border-stone-250 rounded-xl text-xs text-stone-900 font-semibold focus:ring-1 focus:ring-[#0f4c2a] bg-white"
                            />
                          </div>
                        </div>

                        {/* Spouse Phone Option */}
                        <div className="space-y-2 pt-1">
                          <label className="flex items-center space-x-2 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={spousePhoneSameAsWhatsApp}
                              onChange={(e) => setSpousePhoneSameAsWhatsApp(e.target.checked)}
                              className="h-4 w-4 text-[#0f4c2a] focus:ring-[#0f4c2a] border-stone-300 rounded cursor-pointer"
                            />
                            <span className="text-xs text-stone-800 font-medium">Spouse voice phone number is same as WhatsApp number</span>
                          </label>

                          {!spousePhoneSameAsWhatsApp && (
                            <div className="animate-fadeIn pl-6 pt-1">
                              <label className="block text-[10px] uppercase font-bold text-stone-800 mb-1">
                                Spouse Voice Phone Number {spouseContactPreference === 'Phone' ? '*' : ''}
                              </label>
                              <div className="flex space-x-1.5 max-w-sm">
                                <select
                                  value={spousePhoneCode}
                                  onChange={(e) => setSpousePhoneCode(e.target.value)}
                                  className="w-auto max-w-[110px] px-2 py-2 border border-stone-250 rounded-xl bg-stone-50 text-stone-900 text-xs focus:ring-1 focus:ring-[#0f4c2a] cursor-pointer font-bold shrink-0"
                                >
                                  {COUNTRY_CODES.map(c => <option key={`spouse-ph-${c.name}-${c.code}`} value={c.code}>{c.code} {c.name}</option>)}
                                </select>
                                <input
                                  type="text"
                                  value={spousePhone}
                                  placeholder="Voice phone number"
                                  onChange={(e) => setSpousePhone(e.target.value.replace(/\D/g, ''))}
                                  className="block flex-1 min-w-0 px-3 py-2 border border-stone-250 rounded-xl text-xs text-stone-900 font-semibold focus:ring-1 focus:ring-[#0f4c2a] bg-white"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {(spouseProfessionCategory === 'Healthcare' || spouseProfessionTitle.toLowerCase().includes('doctor')) && (
                        <div className="p-4 bg-amber-50/60 border border-[#d4af37]/30 rounded-2xl space-y-3 animate-fadeIn">
                          <div className="flex items-start space-x-2.5">
                            <input
                              type="checkbox"
                              id="spouse_doc_consent_check"
                              checked={spouseDoctorConsent}
                              onChange={(e) => setSpouseDoctorConsent(e.target.checked)}
                              className="h-5 w-5 text-[#0f4c2a] focus:ring-[#0f4c2a] border-stone-300 rounded cursor-pointer mt-0.5"
                            />
                            <div>
                              <label htmlFor="spouse_doc_consent_check" className="text-xs uppercase font-extrabold text-[#0f4c2a] cursor-pointer select-none font-heading flex items-center space-x-1">
                                <Heart className="w-4 h-4 text-[#d4af37] animate-pulse" />
                                <span>Spouse Medical Assistance Consent</span>
                              </label>
                              <p className="text-[11px] text-stone-700 leading-relaxed mt-1">
                                Willing to assist fellow community members during medical emergencies or provide health guidance?
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Step 3 Real-time Validation Warns */}
                  {!isStep3Valid() && (
                    <div className="mt-4 p-3 bg-red-50/50 border border-red-100 rounded-xl text-red-750 text-[10px] font-bold flex items-center space-x-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse shrink-0"></span>
                      <span>Required fields: Category, Title, Company Name, and Contact Preference must be filled/selected for all listed individuals.</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-6 bg-stone-50/60 border border-dashed border-stone-250 rounded-2xl text-center space-y-2 animate-fadeIn">
                  <p className="text-xs text-stone-700 font-bold">
                    You have opted out of being listed in the Community Directory.
                  </p>
                  <p className="text-[11px] text-stone-500 font-medium">
                    No details will be asked. Click <strong className="text-[#0f4c2a]">Next</strong> to continue to the review page and complete your verification.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* STEP 4: REVIEW & SUBMIT */}
          {step === 4 && (
            <div className="space-y-6 animate-fadeIn">
              <div className="border-b border-stone-100 pb-3 flex items-center space-x-2">
                <ClipboardList className="w-5 h-5 text-[#d4af37]" />
                <h3 className="text-base font-bold text-stone-800 font-heading">Review & Confirm</h3>
              </div>

              <div className="space-y-4">
                <p className="text-xs text-stone-800 font-semibold leading-relaxed">
                  Please review your family profile details carefully. Click "Finalize Submission" to complete updating your household information.
                </p>

                {/* Summarized View */}
                <div className="space-y-3 bg-stone-50 border border-stone-200 rounded-2xl p-5 text-xs font-sans leading-relaxed shadow-sm">
                  <div className="grid grid-cols-2 gap-y-2 border-b border-stone-200 pb-3">
                    <div>
                      <span className="text-stone-650 block font-extrabold text-[9px] uppercase tracking-wider">Resident Title</span>
                      <span className="text-stone-900 font-bold">{salutation} {fullName}</span>
                    </div>
                    <div>
                      <span className="text-stone-655 block font-extrabold text-[9px] uppercase tracking-wider">Gmk Resident ID</span>
                      <span className="text-stone-900 font-sans font-extrabold pb-0.5">{residentProfile.gmkId}</span>
                    </div>
                    <div>
                      <span className="text-stone-655 block font-extrabold text-[9px] uppercase tracking-wider">Mobile Number</span>
                      <span className="text-stone-900 font-bold">{phoneCode} {phoneMain}</span>
                    </div>
                    <div>
                      <span className="text-stone-655 block font-extrabold text-[9px] uppercase tracking-wider">WhatsApp Number</span>
                      <span className="text-stone-900 font-bold">
                        {whatsAppSameAsMobile ? "Same as Mobile" : `${whatsAppCode} ${whatsAppMain}`}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-y-2 border-b border-stone-200 pb-3">
                    <div>
                      <span className="text-stone-655 block font-extrabold text-[9px] uppercase tracking-wider">Profession / Company</span>
                      <span className="text-stone-900 font-bold">{professionTitle} at {company}</span>
                    </div>
                    <div>
                      <span className="text-stone-655 block font-extrabold text-[9px] uppercase tracking-wider">Professional Category</span>
                      <span className="text-stone-900 font-bold">{professionCategory}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-y-2 pb-1">
                    <div>
                      <span className="text-stone-655 block font-extrabold text-[9px] uppercase tracking-wider">Directory Discoverability</span>
                      <span className="font-extrabold uppercase text-[10px] tracking-wider text-emerald-800">
                        {directoryOption === 'me' && "✓ Listed (Primary Only)"}
                        {directoryOption === 'spouse' && "✓ Listed (Spouse Only)"}
                        {directoryOption === 'both' && "✓ Listed (Primary & Spouse)"}
                        {directoryOption === 'none' && "✗ Hidden (Do not list us)"}
                      </span>
                    </div>
                    <div>
                      <span className="text-stone-655 block font-extrabold text-[9px] uppercase tracking-wider">Emergency Medical Helper</span>
                      <span className="font-extrabold uppercase text-[10px] tracking-wider text-emerald-800">
                        {(doctorConsent || spouseDoctorConsent) ? "✓ Emergency Helper Approved" : "✗ Disabled / Non-Doctor"}
                      </span>
                    </div>
                    <div className="col-span-2 pt-2">
                      <span className="text-stone-655 block font-extrabold text-[9px] uppercase tracking-wider">Secondary Family Members ({familyMembersList.filter(m => m.name.trim()).length + (spouseEnabled && spouseName.trim() ? 1 : 0)})</span>
                      <p className="text-stone-850 text-[11px] mt-1 font-bold italic">
                        {[
                          spouseEnabled && spouseName.trim() ? `Spouse (${spouseName})` : null,
                          ...familyMembersList.filter(m => m.name.trim()).map(m => `${m.relationship === 'dependent' ? 'Other' : m.relationship === 'parent' ? 'Parent' : m.relationship === 'child' ? 'Child' : m.relationship} (${m.name})`)
                        ].filter(Boolean).join(', ') || "No immediate secondary household members registered"}
                      </p>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          )}

          {/* Action Footer Toggles */}
          <div className="mt-8 pt-4 border-t border-stone-150 flex items-center justify-between">
            <div className="flex items-center space-x-3">
              {step > 1 && (
                <button
                  type="button"
                  onClick={handlePrevStep}
                  className="inline-flex items-center space-x-1.5 px-4 py-2 border border-stone-300 text-stone-600 bg-white hover:bg-stone-50 rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Back</span>
                </button>
              )}
            </div>

            {step < 4 ? (
              <button
                type="button"
                disabled={!isCurrentStepValid()}
                onClick={handleNextStep}
                className={`inline-flex items-center space-x-1.5 px-5 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md ${
                  isCurrentStepValid()
                    ? "bg-[#0f4c2a] text-white hover:bg-[#125831] cursor-pointer shadow-emerald-900/10"
                    : "bg-stone-150 text-stone-400 cursor-not-allowed shadow-none"
                }`}
              >
                <span>Continue</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <div className="flex items-center space-x-3">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="inline-flex items-center space-x-1.5 px-4 py-2 border border-[#0f4c2a] text-[#0f4c2a] bg-emerald-50/50 hover:bg-emerald-50 rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  <span>Edit Family Profile</span>
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={handleFinalSubmit}
                  className="inline-flex items-center space-x-1.5 px-6 py-3 bg-gradient-to-r from-[#0f4c2a] to-[#125831] text-white hover:from-[#125831] hover:to-[#082b17] rounded-xl text-xs font-extrabold uppercase tracking-wide transition-all cursor-pointer shadow-lg shadow-emerald-950/20 disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin mr-1" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-4.5 h-4.5 mr-1" />
                      <span>Finalize Submission</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>

        </div>

      </div>
    </div>
  );
}
