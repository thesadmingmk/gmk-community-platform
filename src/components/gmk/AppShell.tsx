import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { signOut } from 'firebase/auth';
import { auth } from '../../context/AuthContext';
import { normalizeName } from '../../utils/nameNormalization';
import { 
  Home, 
  Calendar, 
  Award, 
  ShieldCheck, 
  Sliders, 
  LogOut, 
  Sparkles,
  Menu,
  X
} from 'lucide-react';
import { GMKBadge } from './DesignSystem';

interface AppShellProps {
  activeTab: string;
  setActiveTab: (tab: any) => void;
  children: React.ReactNode;
  unitNumber?: string;
}

export default function AppShell({ activeTab, setActiveTab, children, unitNumber }: AppShellProps) {
  const { user, profile } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLogout = async () => {
    await signOut(auth);
  };

  // Sidebar item configuration
  const navItems = [
    {
      id: 'home',
      label: 'Home',
      icon: Home,
      roles: ['resident', 'admin', 'super_admin'],
    },
    {
      id: 'events',
      label: 'Events Hub',
      icon: Calendar,
      roles: ['resident', 'admin', 'super_admin'],
      accentColor: 'text-[#d4af37]',
    },
    {
      id: 'expertise_search',
      label: 'Expertise Search',
      icon: Award,
      roles: ['resident', 'admin', 'super_admin'],
      accentColor: 'text-[#d4af37]',
    },
    {
      id: 'admin_workspace',
      label: 'Admin Workspace',
      icon: ShieldCheck,
      roles: ['admin', 'super_admin'],
      accentColor: 'text-amber-500',
    },
    {
      id: 'super_admin_workspace',
      label: 'Super Admin',
      icon: Sliders,
      roles: ['super_admin'],
      accentColor: 'text-rose-500',
    },
    {
      id: 'governance',
      label: 'Governance Panel',
      icon: Sliders,
      roles: ['president', 'vp', 'vice_president'],
      accentColor: 'text-[#d4af37]',
    },
    {
      id: 'event_director',
      label: 'Event Operations',
      icon: Award,
      roles: ['event_director', 'president', 'vp', 'vice_president', 'admin', 'super_admin', 'program_lead', 'committee_lead'],
      accentColor: 'text-[#d4af37]',
    },
  ];

  // Resolve active user roles
  const userRoles = profile?.roles || ['resident'];

  // Filter navigation items based on current subscriber's authentic security privileges
  const visibleNavItems = navItems.filter(item => 
    item.roles.some(role => userRoles.includes(role))
  );

  // Helper to determine role description badge
  const renderRoleBadge = () => {
    if (userRoles.includes('super_admin')) {
      return <GMKBadge variant="danger">GMK SUPER ADMINISTRATOR</GMKBadge>;
    }
    if (userRoles.includes('admin')) {
      return <GMKBadge variant="role">GMK ADMINISTRATOR</GMKBadge>;
    }
    if (userRoles.includes('president')) {
      return <GMKBadge variant="role">GMK President</GMKBadge>;
    }
    if (userRoles.includes('vice_president')) {
      return <GMKBadge variant="role">GMK Vice President</GMKBadge>;
    }
    if (userRoles.includes('event_director')) {
      return <GMKBadge variant="role">Event Director</GMKBadge>;
    }
    return <GMKBadge variant="success">Verified Resident</GMKBadge>;
  };

  return (
    <div className="min-h-screen bg-[#FFFDF6] text-stone-850 flex flex-col font-sans">
      
      {/* 1. Global Responsive Header */}
      <header className="bg-white border-b border-stone-200 sticky top-0 z-45 px-6 py-4 flex items-center justify-between shrink-0 shadow-sm">
        
        {/* Left branding */}
        <div className="flex items-center space-x-3">
          {/* Mobile sidebar toggle trigger */}
          <button 
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-1 bg-stone-50 border border-stone-200 rounded-lg text-[#0f4c2a] hover:bg-stone-100 cursor-pointer mr-1"
            title="Toggle Navigation Menu"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>

          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#0f4c2a] to-[#125831] flex items-center justify-center text-[#d4af37] shadow">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <span className="font-extrabold text-[#0f4c2a] text-sm tracking-tight font-heading block">GMK PLATFORM</span>
            <span className="text-[10px] text-stone-500 block font-bold uppercase tracking-wider font-mono">
              {unitNumber ? `Unit: ${unitNumber}` : 'Community Portal'}
            </span>
          </div>
        </div>

        {/* Right user context status & controls */}
        <div className="flex items-center space-x-4">
          <div className="text-right hidden sm:block">
            <span className="text-stone-800 text-xs font-extrabold block">
              {normalizeName(profile?.fullName || user?.displayName || user?.email?.split('@')[0] || 'Community Resident')}
            </span>
            <span className="text-emerald-700 font-semibold uppercase tracking-wider text-[9px] flex items-center justify-end space-x-1 mt-0.5">
              {renderRoleBadge()}
            </span>
          </div>

          <button
            onClick={handleLogout}
            className="inline-flex items-center space-x-1.5 py-2 px-3 border border-stone-250 hover:bg-red-50 hover:border-red-200 text-stone-600 hover:text-red-750 rounded-xl text-xs font-semibold cursor-pointer transition-all bg-white"
            title="Sign out of current secure session"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Sign Out</span>
          </button>
        </div>
      </header>

      {/* 2. Main Content & Left Sidebar Layout Framework */}
      <div className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-8 flex flex-col md:flex-row gap-6 relative">
        
        {/* Persistent left sidebar (hidden on mobile, shown on desktop) */}
        <aside className="hidden md:flex w-60 flex-col shrink-0 space-y-2">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const isSelected = activeTab === item.id;
            
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full py-2.5 px-4 rounded-xl text-xs font-extrabold uppercase tracking-wider transition-all duration-150 text-left flex items-center space-x-2.5 cursor-pointer border ${
                  isSelected
                    ? 'bg-[#0f4c2a] text-white border-[#0f4c2a] shadow-md shadow-emerald-950/10'
                    : 'bg-white text-stone-750 border-stone-200/80 hover:bg-stone-50 hover:text-[#0f4c2a]'
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${isSelected ? '' : item.accentColor || ''}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </aside>

        {/* Mobile Slide-out Menu Overlay (overlay elements) */}
        {mobileMenuOpen && (
          <div className="md:hidden fixed inset-0 z-40 flex">
            {/* Backdrop */}
            <div 
              className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm"
              onClick={() => setMobileMenuOpen(false)}
            />
            {/* Sidebar drawer body */}
            <div className="relative flex-1 flex flex-col max-w-xs w-full bg-white border-r border-stone-200 p-6 z-50">
              <div className="flex items-center justify-between pb-6 mb-4 border-b border-stone-150">
                <div className="flex items-center space-x-2">
                  <Sparkles className="w-5 h-5 text-[#0f4c2a]" />
                  <span className="font-extrabold text-stone-900 text-xs">GMK Workspace</span>
                </div>
                <button 
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-1 rounded-lg hover:bg-stone-100 cursor-pointer"
                >
                  <X className="w-5 h-5 text-stone-650" />
                </button>
              </div>

              <nav className="flex-1 space-y-2">
                {visibleNavItems.map((item) => {
                  const Icon = item.icon;
                  const isSelected = activeTab === item.id;
                  
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        setActiveTab(item.id);
                        setMobileMenuOpen(false);
                      }}
                      className={`w-full py-3 px-4 rounded-xl text-xs font-extrabold uppercase tracking-wider transition-all text-left flex items-center space-x-3 cursor-pointer border ${
                        isSelected
                          ? 'bg-[#0f4c2a] text-white border-[#0f4c2a]'
                          : 'bg-stone-50 text-stone-700 border-stone-150 hover:bg-stone-100'
                      }`}
                    >
                      <Icon className={`w-4.5 h-4.5 shrink-0 ${isSelected ? '' : item.accentColor || ''}`} />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </nav>

              <div className="pt-4 border-t border-stone-200 mt-auto text-center">
                <span className="text-[10px] text-stone-550 font-extrabold block uppercase tracking-wider">
                  Oman Gated Communities
                </span>
                <span className="text-[9px] text-stone-400 font-mono block mt-1">
                  GMK Community Platform by Elite IT
                </span>
              </div>
            </div>
          </div>
        )}

        {/* 3. Central Content Panel Container */}
        <main className="flex-1 min-w-0">
          {children}
        </main>

      </div>
    </div>
  );
}
