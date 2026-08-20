import React, { useState } from 'react';
import { 
  getAuth, 
  updatePassword, 
  reauthenticateWithCredential, 
  EmailAuthProvider 
} from 'firebase/auth';
import { Lock, Check, X, RefreshCw, AlertCircle } from 'lucide-react';

interface ChangePasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  userEmail: string;
}

export default function ChangePasswordModal({ isOpen, onClose, userEmail }: ChangePasswordModalProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!currentPassword) {
      setErrorMsg('Current password is required.');
      return;
    }
    if (!newPassword) {
      setErrorMsg('New password is required.');
      return;
    }
    if (newPassword.length < 6) {
      setErrorMsg('New password must be at least 6 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMsg('New password and confirmation do not match.');
      return;
    }

    setLoading(true);

    try {
      const auth = getAuth();
      const user = auth.currentUser;
      
      if (!user || user.email?.toLowerCase() !== userEmail.toLowerCase()) {
        throw new Error('Authentication session mismatch. Please log out and log in again.');
      }

      // Re-authenticate first to satisfy Firebase "recent login" requirement
      const credential = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, credential);

      // Now update the password
      await updatePassword(user, newPassword);

      setSuccessMsg('Password changed successfully.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');

    } catch (err: any) {
      console.error('Password change error:', err);
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setErrorMsg('The current password provided is incorrect.');
      } else if (err.code === 'auth/too-many-requests') {
        setErrorMsg('Too many failed attempts. Please try again later.');
      } else {
        setErrorMsg(err.message || 'An error occurred while changing your password.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setErrorMsg(null);
    setSuccessMsg(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
      <div className="bg-white border border-stone-250 w-full max-w-md rounded-3xl overflow-hidden shadow-2xl flex flex-col animate-scaleUp">
        
        <div className="p-6 border-b border-stone-150 flex items-center justify-between bg-stone-50">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-100 flex items-center justify-center">
              <Lock className="w-5 h-5 text-[#0f4c2a]" />
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-stone-900 font-heading uppercase tracking-wider">
                Change Password
              </h3>
              <p className="text-[10px] text-stone-500 font-bold uppercase tracking-wider mt-0.5">
                {userEmail}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-stone-200 rounded-full transition-colors cursor-pointer"
          >
            <X className="w-5 h-5 text-stone-500" />
          </button>
        </div>

        <div className="p-6">
          {successMsg ? (
            <div className="text-center py-6 space-y-4">
              <div className="mx-auto w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mb-4">
                <Check className="w-8 h-8 text-emerald-700" />
              </div>
              <h4 className="text-base font-extrabold text-emerald-900 font-heading">Success!</h4>
              <p className="text-xs font-semibold text-emerald-700">{successMsg}</p>
              <button
                type="button"
                onClick={handleClose}
                className="mt-6 w-full py-3 bg-stone-850 hover:bg-stone-900 text-white font-extrabold text-xs uppercase tracking-wider rounded-xl transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {errorMsg && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start space-x-2">
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <p className="text-xs font-bold text-red-800 leading-relaxed">{errorMsg}</p>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="block text-[10px] font-extrabold text-stone-600 uppercase tracking-wider">
                  Current Password
                </label>
                <input
                  type="password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full px-4 py-3 bg-white border border-stone-250 rounded-xl text-xs font-bold focus:ring-2 focus:ring-[#0f4c2a] focus:border-transparent transition-all outline-none"
                  placeholder="Enter current password"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-[10px] font-extrabold text-stone-600 uppercase tracking-wider">
                  New Password
                </label>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-4 py-3 bg-white border border-stone-250 rounded-xl text-xs font-bold focus:ring-2 focus:ring-[#0f4c2a] focus:border-transparent transition-all outline-none"
                  placeholder="Enter new password (min. 6 characters)"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-[10px] font-extrabold text-stone-600 uppercase tracking-wider">
                  Confirm New Password
                </label>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-4 py-3 bg-white border border-stone-250 rounded-xl text-xs font-bold focus:ring-2 focus:ring-[#0f4c2a] focus:border-transparent transition-all outline-none"
                  placeholder="Confirm new password"
                />
              </div>

              <div className="pt-4 flex items-center justify-end space-x-3">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={loading}
                  className="px-5 py-2.5 border border-stone-250 text-stone-700 bg-white hover:bg-stone-50 rounded-xl text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex items-center space-x-2 px-6 py-2.5 bg-[#0f4c2a] text-white hover:bg-[#125831] rounded-xl text-xs font-extrabold uppercase tracking-wide transition-all cursor-pointer shadow-md disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Processing...</span>
                    </>
                  ) : (
                    <span>CHANGE PASSWORD</span>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>

      </div>
    </div>
  );
}
