import React from 'react';
import { useAuth } from './context/AuthContext';
import { signOut } from 'firebase/auth';
import { auth } from './context/AuthContext';
import IdentityGateway from './components/IdentityGateway';
import SuperAdminDashboard from './components/SuperAdminDashboard';
import AdminDashboard from './components/AdminDashboard';
import ResidentDashboard from './components/ResidentDashboard';
import { GEASConfirmationProvider } from './components/gmk/GEASConfirmationDialog';
import { RefreshCw, AlertTriangle, UserCheck, Clock } from 'lucide-react';

export default function App() {
  const { user, profile, loading, error } = useAuth();

  const handleForceExit = async () => {
    console.log("🔄 Clearing authentication session...");
    await signOut(auth);
    window.location.reload();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FFFDF6] flex flex-col justify-center items-center py-12 px-4 sm:px-6 lg:px-8 font-sans">
        <div className="text-center space-y-3">
          <RefreshCw className="w-7 h-7 text-[#0F4C2A] animate-spin mx-auto opacity-75" />
          <p className="text-sm font-medium text-stone-600 font-sans tracking-wide">
            Loading...
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#FFFDF6] flex flex-col justify-center items-center py-12 px-4 sm:px-6 lg:px-8 font-sans">
        <div className="bg-white p-8 max-w-md w-full border border-stone-200 rounded-2xl shadow-xl space-y-6 text-center">
          <div className="flex justify-center">
            <AlertTriangle className="w-12 h-12 text-red-600" />
          </div>
          
          <h2 className="text-xl font-serif font-bold text-[#0F4C2A]">
            System Connection Error
          </h2>
          
          <p className="text-xs text-stone-600 font-mono leading-relaxed">
            The platform encountered an issue synchronizing with the database request gates. Please verify your connection or check platform rules.
          </p>

          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-[10px] font-mono break-all text-left">
            Error details: {error}
          </div>

          <button 
            onClick={handleForceExit} 
            className="w-full py-2 px-4 bg-[#851414] hover:bg-[#6b0f0f] text-white text-xs font-mono uppercase tracking-wider font-bold rounded-lg transition-all cursor-pointer"
          >
            Reset Session State
          </button>
        </div>
      </div>
    );
  }

  if (user && !profile) {
    return (
      <div className="min-h-screen bg-[#FFFDF6] flex flex-col justify-center items-center py-12 px-4 sm:px-6 lg:px-8 font-sans">
        <div className="bg-white p-8 max-w-md w-full border border-stone-200 rounded-2xl shadow-xl space-y-6 text-center font-mono text-xs">
          <div className="flex justify-center">
            <UserCheck className="w-12 h-12 text-[#D4AF37]" />
          </div>

          <h2 className="text-xl font-serif font-bold text-[#0F4C2A]">
            Setting Up Profile
          </h2>

          <p className="text-xs text-stone-600 leading-relaxed">
            Successfully authenticated via email: <strong>{user.email}</strong>. Setting up your user session profile.
          </p>

          <button 
            onClick={handleForceExit} 
            className="w-full py-2.5 px-4 bg-[#0F4C2A] hover:bg-[#072414] text-white font-bold uppercase tracking-wider text-xs rounded-lg transition-all cursor-pointer"
          >
            Return to Sign In
          </button>
        </div>
      </div>
    );
  }

  const isActivationFlow = typeof window !== 'undefined' && (
    new URLSearchParams(window.location.search).get('setup') === 'true' ||
    window.location.hash === '#setup-password' ||
    localStorage.getItem('gmk_activation_success') === 'true'
  );

  if (!user || isActivationFlow) {
    return <IdentityGateway />;
  }

  // Check if user is pending or inactive (and not a system admin or authorized admin/super_admin)
  const isSystemAdmin = (user.email?.toLowerCase().trim() === "thesadmingmk@gmail.com" || user.email?.toLowerCase().trim() === "theadmingmk@gmail.com" || profile?.roles.includes('super_admin') || profile?.roles.includes('admin'));
  if (profile && (!profile.isActive || profile.roles.includes('pending') || profile.roles.length === 0) && !isSystemAdmin) {
    return (
      <div className="min-h-screen bg-[#FFFDF6] flex flex-col justify-center items-center py-12 px-4 sm:px-6 lg:px-8 font-sans">
        <div className="bg-white p-8 max-w-md w-full border border-stone-200 rounded-2xl shadow-xl space-y-6 text-center animate-fadeIn">
          <div className="flex justify-center">
            <Clock className="w-12 h-12 text-[#D4AF37] animate-pulse" />
          </div>
          
          <h2 className="text-2xl font-serif text-[#0F4C2A] font-bold">
            Registration Under Review
          </h2>
          
          <div className="text-sm text-stone-850 font-semibold leading-relaxed space-y-4">
            <p>
              Thank you for registering with the GMK Community. Your residential details have been submitted and are currently in the verification queue.
            </p>
            <div className="text-xs bg-[#FFFDF6] border border-stone-250 p-4 rounded-xl font-mono text-left space-y-1">
              <div><span className="text-stone-705 font-bold font-sans">Account:</span> <span className="text-stone-900 font-extrabold">{user.email}</span></div>
              <div><span className="text-stone-705 font-bold font-sans">Status:</span> <span className="text-red-750 font-extrabold">Pending Admin Approval</span></div>
              <div><span className="text-stone-705 font-bold font-sans">Gated Community:</span> <span className="text-stone-900 font-extrabold font-heading">Al Hail Greens</span></div>
            </div>
            <div className="bg-[#FFFDF6] border border-[#D4AF37]/35 p-4 rounded-xl text-left space-y-1">
              <h4 className="text-[11px] font-bold text-[#0F4C2A] uppercase font-mono tracking-wider flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#D4AF37]"></span>
                Registration Review Process
              </h4>
              <p className="text-[11px] text-stone-600 leading-relaxed font-medium">
                Your registration will be reviewed by the GMK Administration to verify your residency details.
                Once approved, you will receive an email with instructions to activate your account by creating your password.
                After creating your password, you can securely sign in to the GMK Resident Portal.
              </p>
            </div>
          </div>

          <button 
            onClick={handleForceExit} 
            className="w-full py-2.5 px-4 bg-[#0F4C2A] hover:bg-[#072414] text-white font-bold uppercase tracking-wider text-xs rounded-xl transition-all cursor-pointer shadow-sm"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  // Resolve dashboard context based on polymorphic privileges
  // If the user has a 'resident' role, route them to ResidentDashboard which provides tabbed access to both their resident details and their assigned admin workspace.
  // Otherwise, if they are purely a system administrator without a resident profile, route them directly to SuperAdminDashboard.
  const isResident = profile?.roles.includes('resident');
  if (!isResident && (profile?.roles.includes('super_admin') || profile?.roles.includes('admin'))) {
    return (
      <GEASConfirmationProvider>
        <div className="bg-[#FFFDF6] min-h-screen w-full text-stone-800">
          <SuperAdminDashboard activeEmail={profile?.email || user.email || ''} />
        </div>
      </GEASConfirmationProvider>
    );
  }

  // All other authenticated and approved residents route through ResidentDashboard
  return (
    <GEASConfirmationProvider>
      <div className="bg-[#FFFDF6] min-h-screen w-full">
        <ResidentDashboard activeEmail={profile?.email || user.email || ''} />
      </div>
    </GEASConfirmationProvider>
  );
}
