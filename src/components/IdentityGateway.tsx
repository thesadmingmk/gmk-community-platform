import React, { useState } from 'react';
import { initializeApp, getApps } from 'firebase/app';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  getAuth,
  signOut,
  sendPasswordResetEmail,
  sendEmailVerification
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { auth, db, functions } from '../context/AuthContext';
import { httpsCallable } from 'firebase/functions';
import { doc, setDoc, query, collection, where, getDocs, getDoc } from 'firebase/firestore';
import { Mail, Lock, User, Phone, Home, RefreshCw, Sparkles, Compass, Users, Heart, Check, ArrowRight } from 'lucide-react';
import { createAuditLog } from '../utils/audit';
import { sanitizeFirestorePayload } from '../utils/sanitize';
import { normalizeUnit } from '../utils/unitNormalization';
import { normalizeName } from '../utils/nameNormalization';
import ReleaseNotesModal from './ReleaseNotesModal';
import firebaseConfig from '../firebase-applet-config.json';

// Initialize secondary isolated validation app to perform unauthenticated uniqueness checks securely in the background
const getValidationApp = () => {
  const apps = getApps();
  const existing = apps.find(app => app.name === 'validationApp');
  if (existing) return existing;
  return initializeApp(firebaseConfig, 'validationApp');
};

const validationApp = getValidationApp();
const validationAuth = getAuth(validationApp);
const validationDb = firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)'
  ? getFirestore(validationApp, firebaseConfig.firestoreDatabaseId)
  : getFirestore(validationApp);

export default function IdentityGateway() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [isSetupPassword, setIsSetupPassword] = useState(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('setup') === 'true' || window.location.hash === '#setup-password';
    }
    return false;
  });
  
  const [email, setEmail] = useState(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('email') || '';
    }
    return '';
  });
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  
  // Registration and Normalization state
  const [salutation, setSalutation] = useState<string>('');
  const [unitType, setUnitType] = useState<'Apartment' | 'Villa' | 'Townhouse' | ''>('');
  const [flatNo, setFlatNo] = useState('');
  
  // Segmented apartment inputs
  const [aptBuilding, setAptBuilding] = useState('');
  const [aptSection, setAptSection] = useState('');
  const [aptFlat, setAptFlat] = useState('');

  // Segment references for auto-focus transition
  const buildingRef = React.useRef<HTMLInputElement>(null);
  const sectionRef = React.useRef<HTMLInputElement>(null);
  const flatRef = React.useRef<HTMLInputElement>(null);

  // Show password toggle
  const [showPassword, setShowPassword] = useState(false);

  const [phone, setPhone] = useState('');
  const gatedCommunity = 'Al Hail Greens';

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [authSuccess, setAuthSuccess] = useState<string | null>(null);
  
  // Real-time duplicate check state
  const [duplicateEmailError, setDuplicateEmailError] = useState<string | null>(null);
  const [duplicatePhoneError, setDuplicatePhoneError] = useState<string | null>(null);
  const [duplicateUnitError, setDuplicateUnitError] = useState<string | null>(null);
  const [generalValidationMsg, setGeneralValidationMsg] = useState<string | null>(null);
  const [registrationSubmitted, setRegistrationSubmitted] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('gmk_registration_submitted') === 'true';
    }
    return false;
  });
  const [activationSuccess, setActivationSuccess] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('gmk_activation_success') === 'true';
    }
    return false;
  });
  const [submittedDisplayUnit, setSubmittedDisplayUnit] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('gmk_registration_display_unit') || '';
    }
    return '';
  });
  const [submittedFullName, setSubmittedFullName] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('gmk_registration_full_name') || '';
    }
    return '';
  });
  const [submittedGmkId, setSubmittedGmkId] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('gmk_registration_gmk_id') || '';
    }
    return '';
  });
  const [unverifiedEmailUser, setUnverifiedEmailUser] = useState<any>(null);

  // Platform Version state
  const [isReleaseModalOpen, setIsReleaseModalOpen] = useState(false);

  // Real-time unique constraints validation
  React.useEffect(() => {
    if (!isSignUp || isSetupPassword || loading || registrationSubmitted || activationSuccess) {
      setDuplicateEmailError(null);
      setDuplicatePhoneError(null);
      setDuplicateUnitError(null);
      setGeneralValidationMsg(null);
      return;
    }

    const runRealTimeValidation = async () => {
      // 0. SILENTLY AUTHENTICATE THE ISOLATED VALIDATION APP IF NOT LOGGED IN
      if (!validationAuth.currentUser) {
        try {
          await signInWithEmailAndPassword(validationAuth, "gmk_registrations@gmail.com", "gmkCommunityRules321");
        } catch (signInErr: any) {
          if (signInErr.code === "auth/user-not-found" || signInErr.code === "auth/invalid-credential" || signInErr.code === "auth/wrong-password") {
            try {
              const guestUserCred = await createUserWithEmailAndPassword(validationAuth, "gmk_registrations@gmail.com", "gmkCommunityRules321");
              const registrationAuthUser = guestUserCred.user;
              const userDocRef = doc(validationDb, "users", registrationAuthUser.uid);
              await setDoc(userDocRef, {
                uid: registrationAuthUser.uid,
                email: "gmk_registrations@gmail.com",
                roles: ["admin"],
                isActive: true,
                createdAt: new Date().toISOString()
              }, { merge: true });
            } catch (createErr: any) {
              if (createErr.code === "auth/email-already-in-use") {
                try {
                  await signInWithEmailAndPassword(validationAuth, "gmk_registrations@gmail.com", "gmkCommunityRules321");
                } catch (retryErr) {
                  console.error("Silent authentication retry failed:", retryErr);
                }
              } else {
                console.error("Silent authentication creation failed:", createErr);
              }
            }
          } else {
            console.error("Silent authentication sign-in failed:", signInErr);
          }
        }
      }

      const sanitizedEmail = email.toLowerCase().trim();
      const normResult = normalizeUnit(unitType, flatNo);
      const cleanPhone = phone.trim();

      let hasEmailDup = false;
      let hasPhoneDup = false;
      let hasUnitDup = false;

      // 1. EMAIL DUPLICATE CHECK
      if (sanitizedEmail && sanitizedEmail.includes('@') && sanitizedEmail.includes('.')) {
        try {
          const resQ = query(collection(validationDb, "residents"), where("email", "==", sanitizedEmail));
          const resSnap = await getDocs(resQ);
          const pendQ = query(collection(validationDb, "pending_registrations"), where("email", "==", sanitizedEmail));
          const pendSnap = await getDocs(pendQ);
          const userQ = query(collection(validationDb, "users"), where("email", "==", sanitizedEmail));
          const userSnap = await getDocs(userQ);
          const famQ = query(collection(validationDb, "families"), where("primaryMemberEmail", "==", sanitizedEmail));
          const famSnap = await getDocs(famQ);

          if (!resSnap.empty || !pendSnap.empty || !userSnap.empty || !famSnap.empty) {
            hasEmailDup = true;
            setDuplicateEmailError("An account already exists with this email address.");
          } else {
            setDuplicateEmailError(null);
          }
        } catch (e) {
          console.error("Email validate error:", e);
        }
      } else {
        setDuplicateEmailError(null);
      }

      // 2. PHONE DUPLICATE CHECK
      if (cleanPhone.length === 8) {
        try {
          const resQ = query(collection(validationDb, "residents"), where("phone", "==", cleanPhone));
          const resSnap = await getDocs(resQ);
          const pendQ = query(collection(validationDb, "pending_registrations"), where("phone", "==", cleanPhone));
          const pendSnap = await getDocs(pendQ);
          const famQ = query(collection(validationDb, "families"), where("phone", "==", cleanPhone));
          const famSnap = await getDocs(famQ);

          if (!resSnap.empty || !pendSnap.empty || !famSnap.empty) {
            hasPhoneDup = true;
            setDuplicatePhoneError("This mobile number is already associated with a registered resident.");
          } else {
            setDuplicatePhoneError(null);
          }
        } catch (e) {
          console.error("Phone validate error:", e);
        }
      } else {
        setDuplicatePhoneError(null);
      }

      // 3. UNIT DUPLICATE CHECK
      if (normResult.isValid) {
        try {
          const uKey = normResult.unitKey;
          const resQ = query(collection(validationDb, "residents"), where("unitKey", "==", uKey));
          const resSnap = await getDocs(resQ);
          const pendQ = query(collection(validationDb, "pending_registrations"), where("unitKey", "==", uKey));
          const pendSnap = await getDocs(pendQ);
          const famQ = query(collection(validationDb, "families"), where("unitKey", "==", uKey));
          const famSnap = await getDocs(famQ);

          if (!resSnap.empty || !pendSnap.empty || !famSnap.empty) {
            hasUnitDup = true;
            setDuplicateUnitError(
              "This unit is already registered under an existing household profile. If you are a spouse, child, or parent belonging to this household, please ask the Primary Resident to add you through the My Family section. For assistance contact: theadmingmk@gmail.com"
            );
          } else {
            setDuplicateUnitError(null);
          }
        } catch (e) {
          console.error("Unit validate error:", e);
        }
      } else {
        setDuplicateUnitError(null);
      }

      // 4. GENERAL SUMMARY BANNER TRIGGER
      if (hasEmailDup || hasPhoneDup || hasUnitDup) {
        setGeneralValidationMsg(
          "Resident already exists. A resident profile or pending registration already exists with this Email, Mobile Number or Unit Number. Please contact the administrator."
        );
      } else {
        setGeneralValidationMsg(null);
      }
    };

    const delayDebounceFn = setTimeout(() => {
      runRealTimeValidation();
    }, 400);

    return () => clearTimeout(delayDebounceFn);
  }, [email, phone, flatNo, unitType, isSignUp, isSetupPassword, loading, registrationSubmitted, activationSuccess]);

  const handleBuildingChange = (val: string) => {
    const normalized = val.toUpperCase().replace(/[^A-Z0-9]/g, '');
    setAptBuilding(normalized);
  };

  const handleSectionChange = (val: string) => {
    const cleaned = val.replace(/\D/g, '').slice(0, 2);
    setAptSection(cleaned);
  };

  const handleFlatChange = (val: string) => {
    const cleaned = val.replace(/\D/g, '').slice(0, 2);
    setAptFlat(cleaned);
  };

  // Synchronize flatNo state whenever any segmented fields change
  React.useEffect(() => {
    if (unitType === 'Apartment') {
      if (aptBuilding || aptSection || aptFlat) {
        setFlatNo(`${aptBuilding}-${aptSection}-${aptFlat}`);
      } else {
        setFlatNo('');
      }
    }
  }, [aptBuilding, aptSection, aptFlat, unitType]);

  const handlePhoneChange = (val: string) => {
    const cleaned = val.replace(/\D/g, '').slice(0, 8);
    setPhone(cleaned);
  };

  const handleNameNormalization = (val: string) => {
    setName(val);
  };

  const handleNameBlur = () => {
    setName(normalizeName(name));
  };

  const handleForgotPassword = async () => {
    setErrorMsg(null);
    setAuthSuccess(null);
    const sanitizedEmail = email.trim().toLowerCase();
    if (!sanitizedEmail) {
      setErrorMsg("Please enter your email address first so we can send you a password reset link.");
      return;
    }

    // Simple email regex validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(sanitizedEmail)) {
      setErrorMsg("Please enter a valid email address.");
      return;
    }

    setLoading(true);
    console.log("[RTCO-PASSWORD-RESET] START");
    console.log(`[RTCO-PASSWORD-RESET] EMAIL: ${sanitizedEmail}`);
    console.log(`[RTCO-PASSWORD-RESET] AUTH PROJECT: ${firebaseConfig.projectId}`);

    try {
      await sendPasswordResetEmail(auth, sanitizedEmail);
      console.log("[RTCO-PASSWORD-RESET] SUCCESS");
      setAuthSuccess("Password reset email sent. Please check your inbox and Spam/Junk folder.");
    } catch (err: any) {
      console.log("[RTCO-PASSWORD-RESET] FAILED");
      console.log(`[RTCO-PASSWORD-RESET] ERROR CODE: ${err.code}`);
      console.log(`[RTCO-PASSWORD-RESET] ERROR MESSAGE: ${err.message}`);
      console.error("❌ Forgot Password error:", err);

      let userFacingMessage = "Failed to send password reset email. Please try again.";
      if (err.code === "auth/user-not-found") {
        userFacingMessage = "No account was found with this email address.";
      } else if (err.code === "auth/invalid-email") {
        userFacingMessage = "Please enter a valid email address.";
      } else if (err.code === "auth/too-many-requests") {
        userFacingMessage = "Too many reset attempts. Please try again later.";
      } else if (err.message) {
        userFacingMessage = err.message;
      }
      setErrorMsg(userFacingMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    if (!unverifiedEmailUser) return;
    try {
      setLoading(true);
      setErrorMsg(null);
      await sendEmailVerification(unverifiedEmailUser);
      setAuthSuccess("Verification email resent successfully! Please check your inbox and spam folder.");
    } catch (err: any) {
      console.error("Resend verification error:", err);
      setErrorMsg(err.message || "Failed to resend verification email.");
    } finally {
      setLoading(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    setAuthSuccess(null);
    const sanitizedEmail = email.toLowerCase().trim();

    try {
      if (isSignUp) {
        if (!salutation) {
          throw new Error("Salutation selection is required first. Please select a salutation.");
        }
        if (!unitType) {
          throw new Error("Unit type selection is required first. Please select a unit type.");
        }
        if (!name.trim()) throw new Error("Full name is required.");
        if (phone.length !== 8) {
          throw new Error("Phone number must contain exactly 8 digits.");
        }
        if (!sanitizedEmail || !sanitizedEmail.includes('@')) {
          throw new Error("Please enter a valid email address.");
        }
        if (password.length < 6) {
          throw new Error("Password must be at least 6 characters long.");
        }
        if (password !== confirmPassword) {
          throw new Error("Passwords do not match.");
        }

        const normResult = normalizeUnit(unitType, flatNo);
        if (!normResult.isValid) {
          throw new Error(normResult.error || "Invalid unit number validation.");
        }

        const normalizedUnit = normResult.unitKey;
        const displayUnit = normResult.displayUnitNumber;

        // Ensure validationAuth is logged in silently on the isolated app (preventing main auth triggers)
        if (!validationAuth.currentUser) {
          try {
            await signInWithEmailAndPassword(validationAuth, "gmk_registrations@gmail.com", "gmkCommunityRules321");
          } catch (signInErr: any) {
            if (signInErr.code === "auth/user-not-found" || signInErr.code === "auth/invalid-credential" || signInErr.code === "auth/wrong-password") {
              try {
                const guestUserCred = await createUserWithEmailAndPassword(validationAuth, "gmk_registrations@gmail.com", "gmkCommunityRules321");
                const registrationAuthUser = guestUserCred.user;
                const userDocRef = doc(validationDb, "users", registrationAuthUser.uid);
                await setDoc(userDocRef, {
                  uid: registrationAuthUser.uid,
                  email: "gmk_registrations@gmail.com",
                  roles: ["admin"],
                  isActive: true,
                  createdAt: new Date().toISOString()
                }, { merge: true });
              } catch (createErr: any) {
                if (createErr.code === "auth/email-already-in-use") {
                  try {
                    await signInWithEmailAndPassword(validationAuth, "gmk_registrations@gmail.com", "gmkCommunityRules321");
                  } catch (retryErr) {
                    console.error("Silent authentication retry failed:", retryErr);
                  }
                } else {
                  console.error("Silent authentication creation failed:", createErr);
                }
              }
            } else {
              console.error("Silent authentication sign-in failed:", signInErr);
            }
          }
        }

        // Duplicate checks
        const resEmailQ = query(collection(validationDb, "residents"), where("email", "==", sanitizedEmail));
        const resEmailSnap = await getDocs(resEmailQ);
        if (!resEmailSnap.empty) {
          throw new Error("This email address is already registered inside our community database.");
        }

        const resUnitQ = query(collection(validationDb, "residents"), where("unitKey", "==", normalizedUnit));
        const resUnitSnap = await getDocs(resUnitQ);
        if (!resUnitSnap.empty) {
          throw new Error(`Unit '${displayUnit}' is already bound to an active resident account.`);
        }

        const resPhoneQ = query(collection(validationDb, "residents"), where("phone", "==", phone.trim()));
        const resPhoneSnap = await getDocs(resPhoneQ);
        if (!resPhoneSnap.empty) {
          throw new Error("This mobile number is already associated with a registered resident.");
        }

        let userCreated = false;
        let createdUser: any = null;

        try {
          // 1. Create Firebase Authentication account
          const userCred = await createUserWithEmailAndPassword(auth, sanitizedEmail, password);
          createdUser = userCred.user;
          userCreated = true;

          // 2. Send Firebase email verification
          try {
            await sendEmailVerification(createdUser);
          } catch (notifErr: any) {
            console.warn("⚠️ Email verification sending warning:", notifErr);
          }

          // 3. Generate sequential GMK ID (GMK-XXXX)
          const resSnap = await getDocs(collection(validationDb, "residents"));
          const numericIds = resSnap.docs
            .map(d => {
              const data = d.data();
              const match = (data.gmkId || d.id).match(/GMK-(\d+)/);
              return match ? parseInt(match[1], 10) : null;
            })
            .filter((id): id is number => id !== null);
          const maxId = numericIds.length > 0 ? Math.max(...numericIds) : 1000;
          const generatedGmkId = `GMK-${String(maxId + 1).padStart(4, '0')}`;
          const timestamp = new Date().toISOString();

          // 4. Create user profile immediately with role 'resident'
          const userPayload = {
            uid: createdUser.uid,
            email: sanitizedEmail,
            gmkId: generatedGmkId,
            fullName: name.trim(),
            roles: ["resident"],
            isActive: true,
            createdAt: timestamp
          };
          await setDoc(doc(db, "users", createdUser.uid), sanitizeFirestorePayload(userPayload));

          // 5. Create active resident record
          const residentPayload = {
            gmkId: generatedGmkId,
            uid: createdUser.uid,
            displayUnitNumber: displayUnit,
            unitKey: normalizedUnit,
            phone: phone.trim(),
            email: sanitizedEmail,
            fullName: name.trim(),
            salutation: salutation,
            unitType: unitType,
            status: 'active',
            gatedCommunity: gatedCommunity,
            createdAt: timestamp,
            updatedAt: timestamp,
            remarks: 'Self-registered resident profile.'
          };
          await setDoc(doc(db, "residents", generatedGmkId), sanitizeFirestorePayload(residentPayload));

          // 6. Create/link family record using existing GMK data model
          const familyPayload = {
            id: `fam_${generatedGmkId}`,
            primaryMemberGmkId: generatedGmkId,
            primaryMemberEmail: sanitizedEmail,
            salutation: salutation as any,
            fullName: name.trim(),
            phone: phone.trim(),
            whatsAppNumber: phone.trim(),
            whatsAppSameAsMobile: true,
            unitKey: normalizedUnit,
            displayUnitNumber: displayUnit,
            unitType: unitType,
            professionCategory: 'None Specified',
            professionTitle: 'Not disclosed',
            company: 'Not disclosed',
            onboardingCompleted: false,
            directoryConsent: false,
            createdAt: timestamp,
            updatedAt: timestamp
          };
          await setDoc(doc(db, "families", `fam_${generatedGmkId}`), sanitizeFirestorePayload(familyPayload));

          // 7. Write audit log
          await createAuditLog(
            'RESIDENT_REGISTERED',
            sanitizedEmail,
            'resident',
            generatedGmkId,
            `Self-registered resident profile for ${name.trim()} (Unit: ${displayUnit}, ID: ${generatedGmkId})`,
            name.trim()
          );

          // 8. Persist non-sensitive display values in localStorage so registration success screen survives auth state unmount/remount
          const formattedFullName = `${salutation}. ${name.trim()}`;
          if (typeof window !== 'undefined') {
            localStorage.setItem('gmk_registration_submitted', 'true');
            localStorage.setItem('gmk_registration_display_unit', displayUnit);
            localStorage.setItem('gmk_registration_full_name', formattedFullName);
            localStorage.setItem('gmk_registration_gmk_id', generatedGmkId);
          }

          setSubmittedDisplayUnit(displayUnit);
          setSubmittedFullName(formattedFullName);
          setSubmittedGmkId(generatedGmkId);
          setRegistrationSubmitted(true);
          setAuthSuccess(null);
          setUnverifiedEmailUser(createdUser);

          // 9. Sign out unverified session so user must verify email before logging in
          await signOut(auth);

          // Reset inputs
          setFlatNo('');
          setAptBuilding('');
          setAptSection('');
          setAptFlat('');
          setPhone('');
          setPassword('');
          setConfirmPassword('');
        } catch (err: any) {
          if (userCreated && createdUser) {
            try {
              await createdUser.delete();
            } catch (deleteErr) {
              console.error("Cleanup deletion failed during registration rollback:", deleteErr);
            }
          }
          throw err;
        }
      } else if (isSetupPassword) {
        if (password.length < 6) {
          throw new Error("Password must be at least 6 characters long.");
        }
        if (password !== confirmPassword) {
          throw new Error("Passwords do not match.");
        }

        let userCreated = false;
        let createdUser: any = null;

        try {
          const userCred = await createUserWithEmailAndPassword(auth, sanitizedEmail, password);
          createdUser = userCred.user;
          userCreated = true;

          const resQuery = query(
            collection(db, "residents"), 
            where("email", "==", sanitizedEmail), 
            where("status", "==", "active")
          );
          const resSnap = await getDocs(resQuery);

          if (resSnap.empty) {
            throw new Error("Your email address was not found in our approved residents registry. Please register first or await admin approval.");
          }

          const residentData = resSnap.docs[0].data();

          await setDoc(doc(db, "users", createdUser.uid), {
            uid: createdUser.uid,
            email: sanitizedEmail,
            roles: ["resident"],
            isActive: true,
            createdAt: new Date().toISOString()
          });

          await createAuditLog(
            'PASSWORD_SETUP_COMPLETED',
            sanitizedEmail,
            'resident',
            createdUser.uid,
            `Configured login credentials for approved resident ${residentData.fullName}`,
            residentData.fullName
          );

          // Clean up local auth session and transition to activation success state
          await signOut(auth);
          localStorage.setItem('gmk_activation_success', 'true');
          setActivationSuccess(true);
          setIsSetupPassword(false);
          setPassword('');
          setConfirmPassword('');
          setAuthSuccess(null);
        } catch (err: any) {
          if (userCreated && createdUser) {
            try {
              await createdUser.delete();
            } catch (deleteErr) {
              console.error("Cleanup deletion failed during password setup rollback:", deleteErr);
            }
          }
          throw err;
        }
      } else {
        localStorage.removeItem('gmk_emergency_admin_mode');
        localStorage.removeItem('gmk_activation_success');
        const userCred = await signInWithEmailAndPassword(auth, sanitizedEmail, password);
        const signedInUser = userCred.user;

        const isSysAdmin = (sanitizedEmail === "thesadmingmk@gmail.com" || sanitizedEmail === "theadmingmk@gmail.com");
        if (!signedInUser.emailVerified && !isSysAdmin) {
          setUnverifiedEmailUser(signedInUser);
          await signOut(auth);
          throw new Error("Please verify your email address first.\n\nCheck your email inbox and click the verification link. After your email has been verified, return here and log in using your email address and password.");
        } else {
          setUnverifiedEmailUser(null);
          setAuthSuccess(`Welcome back! Logged in successfully.`);
        }
      }
    } catch (err: any) {
      console.error("❌ Authentication error:", err);
      let displayError = err.message || "An unexpected validation exception occurred.";
      if (err.code === "auth/invalid-credential" || err.code === "auth/wrong-password" || err.code === "auth/user-not-found") {
        displayError = "Invalid email address or secure password combination. Please try again.";
      } else if (err.code === "auth/email-already-in-use") {
        displayError = "This email address is already registered. Try logging in instead.";
      }
      setErrorMsg(displayError);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col justify-between font-sans">
      
      {/* Decorative Warm Banner */}
      <div className="bg-[#0f4c2a] text-emerald-100 py-3 text-center text-xs font-semibold uppercase tracking-wider px-4 flex items-center justify-center space-x-2">
        <Sparkles className="w-4 h-4 text-[#d4af37] animate-pulse" />
        <span>Greens Malayalee Koottayma • Community • Culture • Connection</span>
      </div>

      <div className="flex-1 flex flex-col-reverse md:flex-row items-center justify-center p-6 md:p-12 max-w-7xl mx-auto w-full gap-8">
        
        {/* Editorial Left Branding Column */}
        <div className="w-full md:w-1/2 space-y-6 text-center md:text-left md:pr-8 animate-fadeIn">
          
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-[#0f4c2a] font-heading leading-tight">
            Greens Malayalee Koottayma
          </h1>
          
          <p className="text-stone-850 text-sm md:text-base leading-relaxed font-sans font-medium">
            Welcome to the secure community portal of GMK residents. Discover upcoming celebrations, coordinate event participations, access professional directories, and foster meaningful community bonds right in the heart of Al Hail Greens.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4">
            <div className="p-4 bg-white border border-stone-250 rounded-2xl flex flex-col items-center md:items-start text-center md:text-left space-y-1">
              <Users className="w-6 h-6 text-[#d4af37]" />
              <h4 className="text-xs font-bold text-stone-900 font-heading">Active Families</h4>
              <p className="text-[11px] text-stone-600 font-medium">Decoupled collaborative membership</p>
            </div>
            <div className="p-4 bg-white border border-stone-250 rounded-2xl flex flex-col items-center md:items-start text-center md:text-left space-y-1">
              <Compass className="w-6 h-6 text-[#d4af37]" />
              <h4 className="text-xs font-bold text-stone-900 font-heading">GMK Events</h4>
              <p className="text-[11px] text-stone-600 font-medium">Direct registration for cultural programs</p>
            </div>
            <div className="p-4 bg-white border border-stone-250 rounded-2xl flex flex-col items-center md:items-start text-center md:text-left space-y-1">
              <Heart className="w-6 h-6 text-[#d4af37]" />
              <h4 className="text-xs font-bold text-stone-900 font-heading">Expertise Search</h4>
              <p className="text-[11px] text-stone-600 font-medium">Consented community profession finder</p>
            </div>
          </div>
        </div>

        {/* Auth Interface Card Right Column */}
        <div className="w-full md:w-1/2 max-w-md bg-white border border-stone-200 rounded-3xl shadow-xl shadow-stone-200/40 p-6 md:p-8 space-y-6 animate-fadeIn">
          
          {activationSuccess ? (
            <div className="space-y-6 text-center animate-fadeIn py-4">
              <div className="mx-auto w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center text-[#0f4c2a] mb-2 shadow-inner animate-pulse">
                <Check className="w-8 h-8 stroke-[3]" />
              </div>
              <div className="space-y-2">
                <h2 className="text-xl font-extrabold text-[#0f4c2a] tracking-tight font-heading">
                  Account Active & Verified
                </h2>
                <div className="h-0.5 w-12 bg-[#d4af37] mx-auto rounded-full"></div>
              </div>
              
              <div className="text-xs text-stone-750 leading-relaxed text-left bg-emerald-50/70 border border-emerald-150 p-5 rounded-2xl space-y-3">
                <p className="font-extrabold text-center text-emerald-900 text-sm">
                  Welcome to Greens Malayalee Koottayma
                </p>
                <p className="font-medium text-center text-stone-600">
                  Your account has been successfully activated. You may now sign in using your registered email address and the password you just created.
                </p>
                <p className="font-semibold text-center text-stone-500">
                  Thank you for joining the GMK Community!
                </p>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  id="go-to-login-btn"
                  onClick={() => {
                    localStorage.removeItem('gmk_activation_success');
                    if (typeof window !== 'undefined') {
                      window.history.replaceState({}, document.title, window.location.pathname);
                    }
                    setActivationSuccess(false);
                    setIsSignUp(false); // Go to login page
                    setIsSetupPassword(false);
                    setName('');
                    setFlatNo('');
                    setAptBuilding('');
                    setAptSection('');
                    setAptFlat('');
                    setPhone('');
                    setEmail('');
                    setPassword('');
                    setConfirmPassword('');
                    setAuthSuccess("Your account is active. Please sign in with your email and password.");
                    setErrorMsg(null);
                  }}
                  className="w-full py-3 bg-[#0f4c2a] hover:bg-[#125831] text-white text-xs font-bold uppercase tracking-widest rounded-xl transition-all cursor-pointer shadow-md shadow-emerald-950/10 flex items-center justify-center space-x-1.5"
                >
                  <span>Go to Login</span>
                </button>
              </div>
            </div>
          ) : registrationSubmitted ? (
            <div className="space-y-6 text-center animate-fadeIn py-4">
              <div className="mx-auto w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600 mb-2 shadow-inner">
                <Check className="w-8 h-8 stroke-[3]" />
              </div>
              <div className="space-y-2">
                <h2 className="text-xl font-extrabold text-[#0f4c2a] tracking-tight">
                  Registration successful.
                </h2>
                <div className="h-0.5 w-12 bg-[#d4af37] mx-auto rounded-full"></div>
              </div>
              <div className="text-xs text-stone-750 leading-relaxed text-left bg-emerald-50/70 border border-emerald-150 p-4 rounded-2xl space-y-2">
                <p className="font-bold text-emerald-900 text-sm text-center">
                  Email Verification Sent
                </p>
                <p className="font-semibold text-stone-700 text-center">
                  Please check your email and verify your email address before logging in. If you don't see it, <strong>check your spam folder too for the email from theadmingmk@gmail.com</strong>.
                </p>
                <p className="text-stone-700 text-center text-xs pt-1">
                  For registration assistance, please <a href="https://wa.me/96898101240" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-bold text-[#0f4c2a] hover:text-[#125831] underline">WhatsApp 98101240</a>.
                </p>
              </div>
              <div className="bg-stone-50 border border-stone-150 rounded-2xl p-4 text-left space-y-2 text-xs">
                <div className="flex justify-between border-b border-stone-100 pb-1">
                  <span className="text-stone-450 font-mono text-[10px]">RESIDENT:</span>
                  <span className="font-bold text-stone-850">{submittedFullName}</span>
                </div>
                <div className="flex justify-between border-b border-stone-100 pb-1">
                  <span className="text-stone-450 font-mono text-[10px]">UNIT NUMBER:</span>
                  <span className="font-bold text-stone-850">{submittedDisplayUnit}</span>
                </div>
                {submittedGmkId && (
                  <div className="flex justify-between border-b border-stone-100 pb-1">
                    <span className="text-stone-450 font-mono text-[10px]">RESIDENT ID:</span>
                    <span className="font-bold text-stone-850">{submittedGmkId}</span>
                  </div>
                )}
                <div className="flex justify-between font-sans">
                  <span className="text-stone-450 font-mono text-[10px]">STATUS:</span>
                  <span className="font-extrabold text-amber-800 bg-amber-50 px-2 rounded border border-amber-200 text-[10.5px]">
                    VERIFICATION PENDING
                  </span>
                </div>
              </div>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => {
                    if (typeof window !== 'undefined') {
                      localStorage.removeItem('gmk_registration_submitted');
                      localStorage.removeItem('gmk_registration_display_unit');
                      localStorage.removeItem('gmk_registration_full_name');
                      localStorage.removeItem('gmk_registration_gmk_id');
                    }
                    setRegistrationSubmitted(false);
                    setSubmittedDisplayUnit('');
                    setSubmittedFullName('');
                    setSubmittedGmkId('');
                    setIsSignUp(false); // Switch to Sign In page
                    setName('');
                    setFlatNo('');
                    setAptBuilding('');
                    setAptSection('');
                    setAptFlat('');
                    setPhone('');
                    setEmail('');
                    setPassword('');
                    setConfirmPassword('');
                    setAuthSuccess("Registration completed. Please check your email to confirm your account, then log in using your email address and password.");
                    setErrorMsg(null);
                  }}
                  className="w-full py-3 bg-[#0f4c2a] hover:bg-[#125831] text-white text-xs font-bold uppercase tracking-widest rounded-xl transition-all cursor-pointer shadow-md shadow-emerald-950/10 flex items-center justify-center space-x-1.5"
                >
                  <span>Proceed to Login</span>
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Main Action Toggles */}
              {!isSetupPassword ? (
                <div className="grid grid-cols-2 gap-1 bg-stone-100 rounded-xl p-1 border border-stone-200/50">
                  <button
                    onClick={() => { setIsSignUp(false); setErrorMsg(null); setAuthSuccess(null); }}
                    type="button"
                    className={`py-2 text-xs font-semibold tracking-wider rounded-lg transition-all duration-200 cursor-pointer ${
                      !isSignUp 
                        ? 'bg-[#0f4c2a] text-white shadow font-bold' 
                        : 'text-stone-750 hover:text-[#0f4c2a] hover:bg-white/50 font-bold'
                    }`}
                  >
                    Sign In
                  </button>
                  <button
                    onClick={() => { setIsSignUp(true); setErrorMsg(null); setAuthSuccess(null); }}
                    type="button"
                    className={`py-2 text-xs font-semibold tracking-wider rounded-lg transition-all duration-200 cursor-pointer ${
                      isSignUp 
                        ? 'bg-[#0f4c2a] text-white shadow font-bold' 
                        : 'text-stone-750 hover:text-[#0f4c2a] hover:bg-white/50 font-bold'
                    }`}
                  >
                    Register Account
                  </button>
                </div>
              ) : (
                <div className="text-center pb-2 border-b border-stone-100">
                  <h2 className="text-lg font-bold text-[#0f4c2a] font-heading">
                    Setup Account Password
                  </h2>
                  <p className="text-xs text-stone-750 font-semibold mt-1">
                    Configure login credentials for approved community profiles
                  </p>
                </div>
              )}

          <form onSubmit={handleEmailAuth} className="space-y-4">
            
            {/* Registration Fields */}
            {isSignUp && !isSetupPassword && (
              <div className="space-y-4 animate-fadeIn">
                
                {/* Registration Info Box */}
                <div className="bg-[#FFFDF6] border border-[#D4AF37]/35 p-3.5 rounded-2xl text-left space-y-1">
                  <h4 className="text-[11px] font-bold text-[#0F4C2A] uppercase font-mono tracking-wider flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#D4AF37]"></span>
                    Self-Service Registration
                  </h4>
                  <p className="text-[10.5px] text-stone-600 leading-relaxed">
                    Fill in your residency details and set your account password below. Upon registration, a verification link will be sent to your email address. Please verify your email address before signing in (<strong>check your spam folder too for the email from theadmingmk@gmail.com</strong>).
                  </p>
                  <p className="text-[10.5px] text-stone-700 leading-relaxed pt-0.5">
                    For registration assistance, please <a href="https://wa.me/96898101240" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-bold text-[#0f4c2a] hover:text-[#125831] underline">WhatsApp 98101240</a>.
                  </p>
                </div>
                
                {/* Salutation selection */}
                <div>
                  <label className="block text-[10px] uppercase font-bold tracking-wider text-stone-800 mb-1 font-heading">
                    Salutation
                  </label>
                  <select
                    required
                    value={salutation}
                    onChange={(e) => setSalutation(e.target.value)}
                    className="block w-full px-3 py-2.5 border border-stone-200 rounded-xl bg-stone-50/50 text-stone-900 text-xs focus:ring-1 focus:ring-[#0f4c2a] focus:border-[#0f4c2a] cursor-pointer"
                  >
                    <option value="">-Select-</option>
                    <option value="Mr">Mr</option>
                    <option value="Mrs">Mrs</option>
                    <option value="Ms">Ms</option>
                    <option value="Dr">Dr</option>
                  </select>
                </div>

                {/* Full name input without placeholders */}
                <div>
                  <label className="block text-[10px] uppercase font-bold tracking-wider text-stone-800 mb-1 font-heading">
                    Full Name
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-stone-600">
                      <User className="h-4 w-4" />
                    </div>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => handleNameNormalization(e.target.value)}
                      onBlur={handleNameBlur}
                      className="block w-full pl-9 pr-3 py-2.5 border border-stone-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0f4c2a] focus:border-[#0f4c2a] text-xs text-stone-900 bg-stone-50/55"
                    />
                  </div>
                </div>

                {/* Oman-only Phone */}
                <div>
                  <label className="block text-[10px] uppercase font-bold tracking-wider text-[#0f4c2a] mb-1 font-heading">
                    Mobile Number (Oman)
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-stone-750 font-bold text-xs">
                      +968
                    </div>
                    <input
                      type="text"
                      required
                      maxLength={8}
                      value={phone}
                      onChange={(e) => handlePhoneChange(e.target.value)}
                      className="block w-full pl-14 pr-3 py-2.5 border border-stone-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0f4c2a] focus:border-[#0f4c2a] text-xs text-stone-900 bg-stone-50/55 font-semibold"
                    />
                  </div>
                  <p className="text-[10px] text-stone-650 font-semibold mt-1">Oman mobile number containing exactly 8 digits</p>
                  {phone.length > 0 && phone.length < 8 && (
                    <p className="text-[10px] text-red-600 font-bold mt-1">Oman Phone Number must be exactly 8 digits.</p>
                  )}
                  {duplicatePhoneError && (
                    <p className="text-[10px] text-red-650 font-bold mt-1 bg-red-50/50 border border-red-150 p-1.5 rounded">{duplicatePhoneError}</p>
                  )}
                </div>

                {/* Unit Type Choice */}
                <div>
                  <label className="block text-[10px] uppercase font-bold tracking-wider text-stone-800 mb-1 font-heading">
                    Unit Type
                  </label>
                  <select
                    value={unitType}
                    onChange={(e) => {
                      setUnitType(e.target.value as any);
                      setFlatNo('');
                      setAptBuilding('');
                      setAptSection('');
                      setAptFlat('');
                    }}
                    className="block w-full px-3 py-2.5 border border-stone-200 rounded-xl bg-stone-50/50 text-stone-900 text-xs focus:ring-1 focus:ring-[#0f4c2a] focus:border-[#0f4c2a] cursor-pointer font-semibold"
                  >
                    <option value="">-Select-</option>
                    <option value="Apartment">Apartment</option>
                    <option value="Villa">Villa</option>
                    <option value="Townhouse">Townhouse</option>
                  </select>
                </div>

                {/* Unit Number Input Segmented for Building & Floor Autocomplete */}
                {unitType && (
                  <div>
                    <label className="block text-[10px] uppercase font-bold tracking-wider text-stone-800 mb-1 font-heading">
                      {unitType === 'Apartment' && "Unit Segment Codes (Building - Section - Flat)"}
                      {unitType === 'Villa' && "Villa Number"}
                      {unitType === 'Townhouse' && "Townhouse Number"}
                    </label>
                    
                    {unitType === 'Apartment' ? (
                      <div className="flex items-center space-x-2">
                        <div className="relative flex-1">
                          <input
                            ref={buildingRef}
                            type="text"
                            required
                            placeholder="Building"
                            value={aptBuilding}
                            onChange={(e) => handleBuildingChange(e.target.value)}
                            className="block w-full px-3 py-2.5 text-center border border-stone-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0f4c2a] focus:border-[#0f4c2a] text-xs text-stone-900 bg-stone-50/50 font-bold"
                          />
                        </div>
                        <span className="text-stone-600 font-bold">-</span>
                        <div className="relative flex-1">
                          <input
                            ref={sectionRef}
                            type="text"
                            required
                            placeholder="Section"
                            value={aptSection}
                            onChange={(e) => handleSectionChange(e.target.value)}
                            className="block w-full px-3 py-2.5 text-center border border-stone-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0f4c2a] focus:border-[#0f4c2a] text-xs text-stone-900 bg-stone-50/50 font-bold"
                          />
                        </div>
                        <span className="text-stone-600 font-bold">-</span>
                        <div className="relative flex-1">
                          <input
                            ref={flatRef}
                            type="text"
                            required
                            placeholder="Flat"
                            value={aptFlat}
                            onChange={(e) => handleFlatChange(e.target.value)}
                            className="block w-full px-3 py-2.5 text-center border border-stone-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0f4c2a] focus:border-[#0f4c2a] text-xs text-stone-900 bg-stone-50/50 font-bold"
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-stone-750 font-bold text-xs">
                          {unitType === 'Villa' ? "Villa -" : "TH -"}
                        </div>
                        <input
                          type="text"
                          required
                          value={flatNo}
                          onChange={(e) => setFlatNo(e.target.value.replace(/\D/g, ''))}
                          className="block w-full p-2.5 pl-16 border border-stone-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0f4c2a] focus:border-[#0f4c2a] text-xs text-stone-900 bg-stone-50/55 font-bold"
                        />
                      </div>
                    )}

                    <p className="text-[10px] text-stone-655 font-semibold mt-1.5">
                      {unitType === 'Apartment' && "Provide building name, section code, and flat number."}
                      {unitType === 'Villa' && "Provide villa number."}
                      {unitType === 'Townhouse' && "Provide townhouse numeric index."}
                    </p>
                  </div>
                )}

                {/* Validation Info */}
                {flatNo && (() => {
                  const norm = normalizeUnit(unitType, flatNo);
                  return norm.isValid ? (
                    <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-2.5 text-[10px] text-[#0f4c2a]">
                      <strong>✓ Normalized Format:</strong> {norm.displayUnitNumber}
                    </div>
                  ) : (
                    <div className="bg-amber-50 border border-amber-100 rounded-xl p-2.5 text-[10px] text-amber-850">
                      <strong>⚠️ Attention:</strong> {norm.error}
                    </div>
                  );
                })()}

                {/* Duplicate Unit Error */}
                {duplicateUnitError && (
                  <div className="bg-red-50 border border-red-250 rounded-xl p-3 text-red-700 text-[11px] font-semibold leading-relaxed animate-fadeIn">
                    <p>{duplicateUnitError}</p>
                  </div>
                )}
              </div>
            )}

            {/* Email Address */}
            <div>
              <label className="block text-[10px] uppercase font-bold tracking-wider text-stone-800 mb-1 font-heading">
                Email Address
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-stone-600">
                  <Mail className="h-4 w-4" />
                </div>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="block w-full pl-9 pr-3 py-2.5 border border-stone-250 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0f4c2a] focus:border-[#0f4c2a] text-xs text-stone-900 bg-stone-50/55"
                />
              </div>
              {isSignUp && duplicateEmailError && (
                <p className="text-[10px] text-red-655 font-bold mt-1 bg-red-50/50 border border-red-150 p-1.5 rounded">{duplicateEmailError}</p>
              )}
            </div>

            {/* Password Fields */}
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] uppercase font-bold tracking-wider text-stone-800 mb-1 font-heading">
                  {isSetupPassword ? "New Password" : "Password"}
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-stone-600">
                    <Lock className="h-4 w-4" />
                  </div>
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="block w-full pl-9 pr-3 py-2.5 border border-stone-250 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0f4c2a] focus:border-[#0f4c2a] text-xs text-stone-900 bg-stone-50/55"
                  />
                </div>
              </div>

              {(isSignUp || isSetupPassword) && (
                <div>
                  <label className="block text-[10px] uppercase font-bold tracking-wider text-stone-800 mb-1 font-heading">
                    Confirm Password
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-stone-600">
                      <Lock className="h-4 w-4" />
                    </div>
                    <input
                      type={showPassword ? "text" : "password"}
                      required
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="block w-full pl-9 pr-3 py-2.5 border border-stone-250 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#0f4c2a] focus:border-[#0f4c2a] text-xs text-stone-900 bg-stone-50/55"
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="show_password_checkbox"
                    checked={showPassword}
                    onChange={(e) => setShowPassword(e.target.checked)}
                    className="h-4 w-4 text-[#0f4c2a] focus:ring-[#0f4c2a] border-stone-300 rounded cursor-pointer"
                  />
                  <label htmlFor="show_password_checkbox" className="text-xs text-stone-600 cursor-pointer select-none font-medium">
                    Show Password
                  </label>
                </div>
                {!isSignUp && !isSetupPassword && (
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    className="text-xs text-[#0f4c2a] hover:text-[#d4af37] transition-colors cursor-pointer font-extrabold hover:underline"
                  >
                    Forgot Password?
                  </button>
                )}
              </div>
            </div>

            {/* Error and Success Alerts */}
            {errorMsg && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs leading-relaxed font-medium space-y-2">
                {errorMsg.split('\n\n').map((msg, i) => (
                  <p key={i} className={i === 0 && errorMsg.includes("Please verify") ? "font-extrabold text-sm text-red-900" : ""}>{msg}</p>
                ))}
                {unverifiedEmailUser && (
                  <button
                    type="button"
                    onClick={handleResendVerification}
                    disabled={loading}
                    className="mt-1 px-3 py-1.5 bg-[#0f4c2a] hover:bg-[#125831] text-white text-[11px] font-bold rounded-lg transition-all cursor-pointer shadow-sm flex items-center gap-1"
                  >
                    <Mail className="w-3.5 h-3.5" />
                    <span>Resend Verification Email</span>
                  </button>
                )}
              </div>
            )}

            {authSuccess && (
              <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-xl text-emerald-800 text-xs leading-relaxed font-medium">
                <p>{authSuccess}</p>
              </div>
            )}

            {/* Unified Duplicate Values list to guide of why button is deactivated */}
            {isSignUp && !isSetupPassword && !loading && !registrationSubmitted && (duplicateEmailError || duplicatePhoneError || duplicateUnitError || generalValidationMsg) && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl space-y-1.5 text-xs text-red-755 font-semibold leading-relaxed animate-fadeIn">
                <p className="font-extrabold text-[10.5px] uppercase tracking-wider text-red-800">⚠️ Registration Blocked due to Duplicate Record:</p>
                {duplicateEmailError && <p className="flex items-start gap-1">• <span className="font-extrabold text-red-800">Duplicate Email:</span> {duplicateEmailError}</p>}
                {duplicatePhoneError && <p className="flex items-start gap-1">• <span className="font-extrabold text-red-800">Duplicate Mobile Phone:</span> {duplicatePhoneError}</p>}
                {duplicateUnitError && <p className="flex items-start gap-1">• <span className="font-extrabold text-red-800">Duplicate Residential Unit:</span> {duplicateUnitError}</p>}
                {!duplicateEmailError && !duplicatePhoneError && !duplicateUnitError && generalValidationMsg && <p className="flex items-start gap-1">• {generalValidationMsg}</p>}
              </div>
            )}

            {/* Submit Action Block */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={loading || (isSignUp && !isSetupPassword && (!!duplicateEmailError || !!duplicatePhoneError || !!duplicateUnitError || !!generalValidationMsg))}
                className="w-full flex justify-center py-3 px-4 rounded-xl shadow uppercase tracking-wider text-xs font-bold text-white bg-gradient-to-r from-[#0f4c2a] to-[#125831] hover:from-[#125831] hover:to-[#082b17] focus:outline-none focus:ring-2 focus:ring-[#0f4c2a] focus:ring-offset-2 transition-all cursor-pointer text-center disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <span className="flex items-center justify-center">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin mr-2" />
                    Processing...
                  </span>
                ) : isSetupPassword ? (
                  "Setup Password & Sign In"
                ) : isSignUp ? (
                  "Submit Registration"
                ) : (
                  "Sign In"
                )}
              </button>
            </div>
          </form>

          {isSetupPassword && (
            <div className="text-center pt-2">
              <button
                type="button"
                onClick={() => { setIsSetupPassword(false); setErrorMsg(null); setAuthSuccess(null); }}
                className="text-xs text-stone-750 hover:text-stone-950 transition-colors cursor-pointer font-bold"
              >
                ← Back to Sign In
              </button>
            </div>
          )}
            </>
          )}

        </div>
      </div>

      {/* Modern Centered Footer */}
      <footer className="w-full max-w-lg mx-auto text-center font-sans text-xs space-y-1 py-6 border-t border-stone-250 mb-4 shrink-0 text-stone-500">
        <div>
          GMK Community Platform • Developed by Elite IT
        </div>
        <div>
          Platform Version: <button type="button" onClick={() => setIsReleaseModalOpen(true)} className="font-extrabold text-[#0f4c2a] hover:text-[#125831] underline cursor-pointer">v1.5.5 (Release Notes)</button>
        </div>
      </footer>

      {/* Release Notes Modal */}
      <ReleaseNotesModal isOpen={isReleaseModalOpen} onClose={() => setIsReleaseModalOpen(false)} />
    </div>
  );
}
