import React from 'react';

// Central Design System Configuration constants
export const GMK_THEME = {
  colors: {
    primary: '#0f4c2a',      // Master deep green
    primaryHover: '#125831',
    primaryDark: '#072414',
    accent: '#d4af37',       // Gold accent
    accentHover: '#c59e2a',
    bgLight: '#FFFDF6',      // Warm off-white
    textDark: '#1c1917',     // Deep stone
    textMuted: '#57534e',    // Secondary stone
    borderLight: '#e7e5e4',  // Stone-200
  },
  radius: {
    lg: 'rounded-xl',
    xl: 'rounded-2xl',
    '3xl': 'rounded-3xl',
  },
  shadow: {
    sm: 'shadow-sm',
    md: 'shadow-md',
    lg: 'shadow-lg hover:shadow-xl transition-all',
  }
};

// 1. GMK Card
interface GMKCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  id?: string;
}
export function GMKCard({ children, className = '', id, ...props }: GMKCardProps) {
  return (
    <div 
      id={id}
      className={`bg-white border border-[#e7e5e4] shadow-sm p-6 rounded-3xl ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

// 2. GMK Button
interface GMKButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'accent' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
  className?: string;
  onClick?: any;
  type?: any;
  disabled?: boolean;
}
export function GMKButton({ 
  variant = 'primary', 
  size = 'md', 
  children, 
  className = '', 
  ...props 
}: GMKButtonProps) {
  const baseStyle = "inline-flex items-center justify-center font-bold tracking-wide uppercase transition-all duration-150 rounded-xl cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";
  
  const variants = {
    primary: "bg-[#0f4c2a] text-white hover:bg-[#125831] border border-transparent shadow-sm shadow-emerald-900/10",
    secondary: "bg-white text-stone-700 border border-[#e7e5e4] hover:bg-stone-50 hover:text-[#0f4c2a]",
    danger: "bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 hover:border-red-300",
    accent: "bg-[#d4af37] text-white hover:bg-[#c59e2a] border border-transparent shadow-sm",
    outline: "border border-[#0f4c2a] text-[#0f4c2a] hover:bg-[#0f4c2a]/5 bg-transparent"
  };

  const sizes = {
    sm: "px-3 py-1.5 text-[10px] rounded-lg",
    md: "px-4 py-2.5 text-xs",
    lg: "px-6 py-3 text-sm rounded-2xl"
  };

  return (
    <button 
      className={`${baseStyle} ${variants[variant]} ${sizes[size]} ${className}`} 
      {...props}
    >
      {children}
    </button>
  );
}

// 3. GMK Input
interface GMKInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}
export const GMKInput = React.forwardRef<HTMLInputElement, GMKInputProps>(
  ({ label, error, className = '', ...props }, ref) => {
    return (
      <div className="w-full space-y-1.5">
        {label && (
          <label className="block text-[10px] font-extrabold uppercase text-[#57534e] tracking-wider">
            {label}
          </label>
        )}
        <input
          ref={ref}
          className={`w-full bg-stone-50 border border-[#e7e5e4] rounded-xl px-4 py-2.5 text-stone-900 focus:outline-none focus:ring-1 focus:ring-[#0f4c2a] focus:border-[#0f4c2a] text-xs font-semibold placeholder-stone-400 ${
            error ? 'border-red-400 focus:ring-red-500 focus:border-red-500' : ''
          } ${className}`}
          {...props}
        />
        {error && <p className="text-[10px] text-red-655 font-bold mt-0.5">{error}</p>}
      </div>
    );
  }
);
GMKInput.displayName = 'GMKInput';

// 4. GMK Select
interface GMKSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  children: React.ReactNode;
}
export const GMKSelect = React.forwardRef<HTMLSelectElement, GMKSelectProps>(
  ({ label, error, children, className = '', ...props }, ref) => {
    return (
      <div className="w-full space-y-1.5">
        {label && (
          <label className="block text-[10px] font-extrabold uppercase text-[#57534e] tracking-wider">
            {label}
          </label>
        )}
        <select
          ref={ref}
          className={`w-full bg-stone-50 border border-[#e7e5e4] rounded-xl px-3 py-2.5 text-stone-900 focus:outline-none focus:ring-1 focus:ring-[#0f4c2a] focus:border-[#0f4c2a] text-xs font-semibold ${
            error ? 'border-red-400 focus:ring-red-500 focus:border-red-500' : ''
          } ${className}`}
          {...props}
        >
          {children}
        </select>
        {error && <p className="text-[10px] text-red-655 font-bold mt-0.5">{error}</p>}
      </div>
    );
  }
);
GMKSelect.displayName = 'GMKSelect';

// 5. GMK Badge
interface GMKBadgeProps {
  variant?: 'active' | 'success' | 'archived' | 'danger' | 'pending' | 'warning' | 'info' | 'primary' | 'role';
  children: React.ReactNode;
  className?: string;
}
export function GMKBadge({ variant = 'info', children, className = '' }: GMKBadgeProps) {
  const variants = {
    active: "bg-emerald-50 text-[#0f4c2a] border border-emerald-100",
    success: "bg-emerald-50 text-[#0f4c2a] border border-emerald-100",
    archived: "bg-stone-100 text-stone-600 border border-stone-200",
    danger: "bg-red-50 text-red-750 border border-red-200",
    pending: "bg-amber-50 text-amber-850 border border-amber-200",
    warning: "bg-amber-50 text-amber-850 border border-amber-200",
    info: "bg-blue-50 text-blue-750 border border-blue-200",
    primary: "bg-[#0f4c2a]/10 text-[#0f4c2a] border border-transparent",
    role: "bg-amber-700/15 text-amber-900 border border-amber-200/50"
  };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9.5px] font-extrabold uppercase tracking-wider ${variants[variant]} ${className}`}>
      {children}
    </span>
  );
}

// 6. GMK Table
interface GMKTableProps {
  headers: string[];
  children: React.ReactNode;
  className?: string;
}
export function GMKTable({ headers, children, className = '' }: GMKTableProps) {
  return (
    <div className={`overflow-x-auto border border-[#e7e5e4] rounded-2xl ${className}`}>
      <table className="w-full text-left border-collapse text-xs">
        <thead>
          <tr className="bg-stone-50 border-b border-[#e7e5e4]">
            {headers.map((h, i) => (
              <th key={i} className="px-4 py-3 font-extrabold uppercase text-stone-600 tracking-wider text-[9.5px]">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100 bg-white font-semibold text-stone-800">
          {children}
        </tbody>
      </table>
    </div>
  );
}

// 7. GMK Modal
interface GMKModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}
export function GMKModal({ isOpen, onClose, title, children, footer }: GMKModalProps) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop overlay */}
      <div className="absolute inset-0 bg-stone-900/60 backdrop-blur-sm" onClick={onClose} />
      
      {/* Modal dialog box */}
      <div className="relative bg-white border border-[#e7e5e4] rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between bg-stone-50">
          <h3 className="text-xs font-extrabold text-[#0f4c2a] uppercase tracking-wide font-heading">
            {title}
          </h3>
          <button 
            onClick={onClose}
            className="text-stone-400 hover:text-stone-600 font-bold p-1 rounded-lg hover:bg-stone-100 cursor-pointer text-xs"
          >
            ✕
          </button>
        </div>
        
        {/* Scrollable contents */}
        <div className="p-6 overflow-y-auto flex-1 text-xs text-stone-800 leading-relaxed font-semibold">
          {children}
        </div>
        
        {/* Footer actions */}
        {footer && (
          <div className="px-6 py-4 border-t border-stone-200 bg-stone-50/50 flex items-center justify-end gap-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// 8. GMK Page Header
interface GMKPageHeaderProps {
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  action?: React.ReactNode;
}
export function GMKPageHeader({ title, subtitle, badge, action }: GMKPageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-[#e7e5e4] pb-4 mb-6 gap-4">
      <div className="space-y-1">
        <div className="flex items-center space-x-2.5 flex-wrap gap-y-1">
          <h2 className="text-lg font-extrabold text-[#0f4c2a] tracking-tight font-heading">
            {title}
          </h2>
          {badge}
        </div>
        {subtitle && (
          <p className="text-[10.5px] text-stone-500 font-extrabold uppercase tracking-wider">
            {subtitle}
          </p>
        )}
      </div>
      {action && <div className="flex items-center gap-2 shrink-0">{action}</div>}
    </div>
  );
}
