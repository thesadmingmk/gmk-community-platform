import React, { createContext, useContext, useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, User } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)'
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);
export const functions = getFunctions(app);
export const storage = getStorage(app);
storage.maxUploadRetryTime = 6000;
storage.maxOperationRetryTime = 6000;

export interface UserProfile {
  uid: string;
  email: string;
  roles: string[];
  isActive: boolean;
  createdAt: string;
  positions?: string[];
  fullName?: string;
  gmkId?: string;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  error: string | null;
  refreshProfile?: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({ 
  user: null, 
  profile: null, 
  loading: true, 
  error: null,
  refreshProfile: async () => {}
});

async function seedDefaultTemplates() {
  try {
    const approvedTemplateRef = doc(db, "emailTemplates", "registration_approved");
    await setDoc(approvedTemplateRef, {
      subject: "GMK Registration Approved - Activate Your Account",
      enabled: true,
      text: `Dear {{residentName}},\n\nWe are pleased to inform you that your registration for {{unit}} has been reviewed and approved by the GMK Administration.\n\nTo securely access the GMK Resident Portal, you must first activate your account and set up your login password.\n\nPlease set up your password by visiting the following activation link:\nhttps://mygmk.me?setup=true\n\nResidential Details:\n- Resident ID: {{gmkId}}\n- Property Unit: {{unit}}\n- Gated Community: Al Hail Greens\n\nOnce you have configured your password, you will be able to securely sign in using your registered email and participate in community events, search professional services, and manage your household profile.\n\nWelcome to our community!\n\nGMK Resident Administration Portal • Al Hail Greens\ntheadmingmk@gmail.com`,
      html: `<div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 12px; background-color: #ffffff;">\n  <div style="text-align: center; padding-bottom: 20px; border-bottom: 2px solid #0F4C2A;">\n    <h1 style="color: #0F4C2A; font-size: 24px; margin: 0; font-family: Georgia, serif;">Al Hail Greens</h1>\n    <p style="color: #D4AF37; font-size: 12px; font-weight: bold; text-transform: uppercase; margin: 5px 0 0 0; letter-spacing: 1px;">GMK Resident Portal</p>\n  </div>\n  <div style="padding: 30px 20px; color: #374151; line-height: 1.6;">\n    <h2 style="color: #0F4C2A; font-size: 20px; margin-top: 0; font-family: Georgia, serif;">Registration Approved!</h2>\n    <p>Dear <strong>{{residentName}}</strong>,</p>\n    <p>We are pleased to inform you that your registration for <strong>{{unit}}</strong> has been reviewed and approved by the GMK Administration.</p>\n    <p>To securely access the GMK Resident Portal, you must first activate your account and set up your login password.</p>\n    <div style="text-align: center; margin: 30px 0;">\n      <a href="https://mygmk.me?setup=true" style="display: inline-block; padding: 12px 28px; background-color: #0F4C2A; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 14px; box-shadow: 0 4px 6px -1px rgba(15, 76, 42, 0.2); transition: background-color 0.2s;">Set Up My Password</a>\n    </div>\n    <div style="background-color: #fefcf3; border-left: 4px solid #D4AF37; padding: 15px; margin: 25px 0; border-radius: 0 8px 8px 0; font-size: 13px;">\n      <p style="margin: 0; font-weight: bold; color: #0F4C2A;">Residential Details:</p>\n      <ul style="margin: 5px 0 0 0; padding-left: 20px; color: #4b5563;">\n        <li><strong>Resident ID:</strong> {{gmkId}}</li>\n        <li><strong>Property Unit:</strong> {{unit}}</li>\n        <li><strong>Gated Community:</strong> Al Hail Greens</li>\n      </ul>\n    </div>\n    <p>Once you have configured your password, you will be able to securely sign in using your registered email and participate in community events, search professional services, and manage your household profile.</p>\n    <p style="margin-bottom: 0;">Welcome to our community!</p>\n  </div>\n  <div style="text-align: center; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #9ca3af; line-height: 1.5;">\n    <p style="margin: 0;">GMK Resident Administration Portal • Al Hail Greens</p>\n    <p style="margin: 5px 0 0 0;">For any support or questions, contact us at <a href="mailto:theadmingmk@gmail.com" style="color: #0F4C2A; text-decoration: underline;">theadmingmk@gmail.com</a></p>\n  </div>\n</div>`
    }, { merge: true });
    console.log("🌱 Default approved email template seeded/updated successfully.");

    const resetTemplateRef = doc(db, "emailTemplates", "password_reset");
    await setDoc(resetTemplateRef, {
      subject: "Reset Your GMK Resident Portal Password",
      enabled: true,
      text: `Dear {{residentName}},\n\nWe received a request to reset the password for your GMK Resident Portal account.\n\nIf you made this request, copy and paste the following link into your browser to reset your password:\n{{resetLink}}\n\nFor your security, this link will expire automatically after the configured Firebase Authentication validity period.\n\nIf you did not request a password reset, no further action is required.\n\nRegards,\nGreens Malayalee Kootayama\nGMK Resident Portal`,
      html: `<div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 12px; background-color: #ffffff;">\n  <div style="text-align: center; padding-bottom: 20px; border-bottom: 2px solid #0F4C2A;">\n    <h1 style="color: #0F4C2A; font-size: 24px; margin: 0; font-family: Georgia, serif;">Al Hail Greens</h1>\n    <p style="color: #D4AF37; font-size: 12px; font-weight: bold; text-transform: uppercase; margin: 5px 0 0 0; letter-spacing: 1px;">GMK Resident Portal</p>\n  </div>\n  <div style="padding: 30px 20px; color: #374151; line-height: 1.6;">\n    <h2 style="color: #0F4C2A; font-size: 20px; margin-top: 0; font-family: Georgia, serif;">Reset Your Password</h2>\n    <p>Dear <strong>{{residentName}}</strong>,</p>\n    <p>We received a request to reset the password for your GMK Resident Portal account.</p>\n    <p>If you made this request, click the button below.</p>\n    <div style="text-align: center; margin: 30px 0;">\n      <a href="{{resetLink}}" style="display: inline-block; padding: 12px 28px; background-color: #0F4C2A; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 14px; box-shadow: 0 4px 6px -1px rgba(15, 76, 42, 0.2); transition: background-color 0.2s;">Reset My Password</a>\n    </div>\n    <p>For your security, this link will expire automatically after the configured Firebase Authentication validity period.</p>\n    <p>If you did not request a password reset, no further action is required.</p>\n    <p style="margin-bottom: 0;">Regards,<br><strong>Greens Malayalee Kootayama</strong><br>GMK Resident Portal</p>\n  </div>\n  <div style="text-align: center; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #9ca3af; line-height: 1.5;">\n    <p style="margin: 0;">GMK Resident Administration Portal • Al Hail Greens</p>\n    <p style="margin: 5px 0 0 0;">For any support or questions, contact us at <a href="mailto:theadmingmk@gmail.com" style="color: #0F4C2A; text-decoration: underline;">theadmingmk@gmail.com</a></p>\n  </div>\n</div>`
    }, { merge: true });
    console.log("🌱 Default password reset email template seeded/updated successfully.");
  } catch (err: any) {
    console.warn("⚠️ Non-blocking warning: failed to seed default email template", err.message);
  }
}

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);  

  const loadProfile = async (firebaseUser: User) => {
    const normalizedEmail = firebaseUser.email?.toLowerCase().trim();
    const userDocRef = doc(db, "users", firebaseUser.uid);

    try {
      console.log(`🔍 Direct Firestore lookup on path: users/${firebaseUser.uid}`);
      const userDocSnap = await getDoc(userDocRef);
      let userProfile: UserProfile | null = null;

      if (userDocSnap.exists()) {
        console.log("✅ Live profile match located in Firestore collection:", userDocSnap.data());
        userProfile = userDocSnap.data() as UserProfile;

        // Self-healing check for Super Admin and Admin emails to guarantee correct roles
        if (normalizedEmail === "thesadmingmk@gmail.com" && (!userProfile.roles || !userProfile.roles.includes("super_admin"))) {
          console.log("🚀 Self-healing Super Admin roles in Firestore...");
          userProfile.roles = ["super_admin"];
          userProfile.isActive = true;
          await setDoc(userDocRef, userProfile, { merge: true });
        } else if (normalizedEmail === "theadmingmk@gmail.com" && (!userProfile.roles || !userProfile.roles.includes("admin"))) {
          console.log("🚀 Self-healing Admin roles in Firestore...");
          userProfile.roles = ["admin"];
          userProfile.isActive = true;
          await setDoc(userDocRef, userProfile, { merge: true });
        }
      } else {
        console.warn("⚠️ Firestore tracking document is empty for this authenticated UID.");
        
        if (normalizedEmail === "thesadmingmk@gmail.com") {
          console.log("🚀 Executing Self-Healing Bootstrapping for Super Admin record...");
          const superAdminPayload: UserProfile = {
            uid: firebaseUser.uid,
            email: normalizedEmail,
            roles: ["super_admin"],
            isActive: true,
            createdAt: new Date().toISOString()
          };
          await setDoc(userDocRef, superAdminPayload);
          console.log("🎯 Super Admin successfully provisioned inside Firestore root!");
          userProfile = superAdminPayload;
        } else if (normalizedEmail === "theadmingmk@gmail.com") {
          console.log("🚀 Executing Self-Healing Bootstrapping for Admin record...");
          const adminPayload: UserProfile = {
            uid: firebaseUser.uid,
            email: normalizedEmail,
            roles: ["admin"],
            isActive: true,
            createdAt: new Date().toISOString()
          };
          await setDoc(userDocRef, adminPayload);
          console.log("🎯 Admin successfully provisioned inside Firestore root!");
          userProfile = adminPayload;
        } else {
          console.log("Creating default user profile mapping during authentication...");
          const defaultResidentPayload: UserProfile = {
            uid: firebaseUser.uid,
            email: normalizedEmail || '',
            roles: ["pending"],
            isActive: false,
            createdAt: new Date().toISOString()
          };
          await setDoc(userDocRef, defaultResidentPayload);
          userProfile = defaultResidentPayload;
        }
      }

      // POLYMORPHIC USER AUTHENTICATION HIERARCHY
      if (normalizedEmail) {
        const assignedRoles: string[] = [];
        const positions: string[] = [];
        try {
          // 1. Query governanceAssignments collection
          const govQuery = query(collection(db, "governanceAssignments"), where("email", "==", normalizedEmail));
          const govSnap = await getDocs(govQuery);
          govSnap.forEach((govDoc) => {
            const data = govDoc.data();
            if (data) {
              const pos = (data.position || data.role || '').toLowerCase();
              if (pos === 'admin') {
                assignedRoles.push('admin');
              } else if (pos) {
                positions.push(pos);
              }
            }
          });

          // 2. Query legacy roleAssignments for perfect backward-compatible fallback
          const rolesQuery = query(collection(db, "roleAssignments"), where("email", "==", normalizedEmail));
          const rolesSnap = await getDocs(rolesQuery);
          rolesSnap.forEach((roleDoc) => {
            const data = roleDoc.data();
            if (data) {
              const pos = (data.position || data.role || '').toLowerCase();
              if (pos === 'admin') {
                assignedRoles.push('admin');
              } else if (pos) {
                positions.push(pos);
              }
            }
          });
        } catch (err: any) {
          console.warn("⚠️ Non-blocking warning: governance role/position query failed", err.message);
        }

        // Check if there is an active resident profile
        let hasResidentDoc = false;
        let residentData: any = null;
        try {
          const resQuery = query(collection(db, "residents"), where("email", "==", normalizedEmail));
          const resSnap = await getDocs(resQuery);
          hasResidentDoc = !resSnap.empty;
          if (hasResidentDoc) {
            residentData = resSnap.docs[0].data();
          }
        } catch (err: any) {
          console.warn("⚠️ Non-blocking warning: residents query failed", err.message);
        }

        // Check if there is a pending registration
        let isPending = false;
        try {
          const pendingQuery = query(collection(db, "pending_registrations"), where("email", "==", normalizedEmail));
          const pendingSnap = await getDocs(pendingQuery);
          isPending = !pendingSnap.empty;
        } catch (err: any) {
          console.warn("⚠️ Non-blocking warning: pending_registrations query failed", err.message);
        }

        if (userProfile) {
          let finalRoles = [...userProfile.roles];
          // If the user matches a pending registration, force 'pending' state
          if (isPending) {
            console.log("⏳ User email matches a pending registration. Blocking active session authorization.");
            userProfile = {
              ...userProfile,
              roles: ["pending"],
              isActive: false,
              positions: []
            };
          } else {
            // Otherwise, compile their roles
            if (hasResidentDoc && residentData && residentData.status === 'active') {
              finalRoles.push('resident');
            }
            
            finalRoles = [...finalRoles, ...assignedRoles, ...positions];
            if (positions.includes('vp')) {
              finalRoles.push('vice_president');
            }
            
            const resolvedGmkId = (hasResidentDoc && residentData && residentData.gmkId) ? residentData.gmkId : (userProfile.gmkId || '');

            userProfile = {
              ...userProfile,
              gmkId: resolvedGmkId,
              email: normalizedEmail,
              roles: Array.from(new Set(finalRoles)),
              positions: Array.from(new Set(positions)),
              isActive: hasResidentDoc ? (residentData.status === 'active') : userProfile.isActive,
              fullName: hasResidentDoc && residentData ? residentData.fullName : userProfile.fullName
            };

            // Sync gmkId & email to users document in Firestore
            try {
              await setDoc(userDocRef, {
                gmkId: resolvedGmkId,
                email: normalizedEmail,
                roles: userProfile.roles,
                isActive: userProfile.isActive
              }, { merge: true });
            } catch (syncErr) {
              console.warn("[AUTH SYNC] Non-blocking user profile sync warning:", syncErr);
            }
          }
        }
      }

      setProfile(userProfile);
      if (userProfile && (userProfile.roles.includes("super_admin") || userProfile.roles.includes("admin"))) {
        seedDefaultTemplates();
      }
    } catch (err: any) {
      console.error("❌ CRITICAL DATABASE TRANS-LOG EXCEPTION:", err);
      console.error(`Error Code: ${err.code} | Message string: ${err.message}`);
      setError(`${err.code}: ${err.message}`);
      setProfile(null);
    }
  };

  const refreshProfile = async () => {
    if (auth.currentUser) {
      await loadProfile(auth.currentUser);
    }
  };

  useEffect(() => {
    console.log("📡 Initializing Live Core Firebase Connection Engine...");
    console.log(`🎯 Active Target Project ID Reference: ${firebaseConfig.projectId}`);  

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setLoading(true);
      setError(null);
      
      if (firebaseUser) {
        console.log("🔑 Authentication event detected. User email:", firebaseUser.email);
        setUser(firebaseUser);
        await loadProfile(firebaseUser);
        setLoading(false);
      } else {
        setUser(null);
        setProfile(null);
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ user, profile, loading, error, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
