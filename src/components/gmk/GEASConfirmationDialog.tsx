import React, { useState, useEffect, useRef, createContext, useContext, useCallback } from 'react';
import { AlertTriangle, Info, Trash2, X, ShieldAlert } from 'lucide-react';
import { GMKButton, GMKInput } from './DesignSystem';

export interface GEASConfirmationOptions {
  title: string;
  message: string;
  severity?: 'danger' | 'warning' | 'info';
  confirmText?: string;
  cancelText?: string;
  requiredInputText?: string;
  inputLabel?: string;
  inputPlaceholder?: string;
}

export interface GEASConfirmationContextType {
  confirm: (options: GEASConfirmationOptions) => Promise<boolean>;
}

const GEASConfirmationContext = createContext<GEASConfirmationContextType | null>(null);

export function useGEASConfirmation() {
  const context = useContext(GEASConfirmationContext);
  if (!context) {
    // Standalone fallback using local state hook if used outside provider
    throw new Error('useGEASConfirmation must be used within GEASConfirmationProvider');
  }
  return context;
}

// Standalone hook for components that manage their own dialog instance
export function useLocalGEASConfirmation() {
  const [dialogState, setDialogState] = useState<{
    isOpen: boolean;
    options: GEASConfirmationOptions | null;
    resolve: ((value: boolean) => void) | null;
  }>({
    isOpen: false,
    options: null,
    resolve: null,
  });

  const confirm = useCallback((options: GEASConfirmationOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      console.log("[CONFIRM 1] Dialog Opened", { title: options.title, severity: options.severity || 'danger' });
      setDialogState({
        isOpen: true,
        options,
        resolve,
      });
    });
  }, []);

  const handleCancel = useCallback(() => {
    console.log("[CONFIRM 2] Cancel Selected");
    console.log("[CONFIRM 4] Promise Returned FALSE");
    if (dialogState.resolve) {
      dialogState.resolve(false);
    }
    setDialogState({ isOpen: false, options: null, resolve: null });
  }, [dialogState.resolve]);

  const handleConfirm = useCallback(() => {
    console.log("[CONFIRM 3] Confirm Selected");
    console.log("[CONFIRM 4] Promise Returned TRUE");
    console.log("[CONFIRM 5] Workflow Continued");
    if (dialogState.resolve) {
      dialogState.resolve(true);
    }
    setDialogState({ isOpen: false, options: null, resolve: null });
  }, [dialogState.resolve]);

  return {
    confirm,
    isOpen: dialogState.isOpen,
    options: dialogState.options,
    handleCancel,
    handleConfirm,
  };
}

export function GEASConfirmationProvider({ children }: { children: React.ReactNode }) {
  const { confirm, isOpen, options, handleCancel, handleConfirm } = useLocalGEASConfirmation();

  return (
    <GEASConfirmationContext.Provider value={{ confirm }}>
      {children}
      {isOpen && options && (
        <GEASConfirmationDialogUI
          options={options}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
    </GEASConfirmationContext.Provider>
  );
}

interface GEASConfirmationDialogUIProps {
  options: GEASConfirmationOptions;
  onConfirm: () => void;
  onCancel: () => void;
}

export function GEASConfirmationDialogUI({ options, onConfirm, onCancel }: GEASConfirmationDialogUIProps) {
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const severity = options.severity || 'danger';
  const requiresInput = Boolean(options.requiredInputText);
  const isInputValid = !requiresInput || inputValue.trim() === options.requiredInputText?.trim();

  useEffect(() => {
    // Focus input if present
    if (requiresInput && inputRef.current) {
      inputRef.current.focus();
    }
  }, [requiresInput]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter') {
        if (isInputValid) {
          e.preventDefault();
          onConfirm();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isInputValid, onCancel, onConfirm]);

  const getSeverityBadge = () => {
    switch (severity) {
      case 'danger':
        return (
          <div className="w-12 h-12 rounded-2xl bg-red-100 border border-red-200 text-red-600 flex items-center justify-center shrink-0">
            <ShieldAlert className="w-6 h-6" />
          </div>
        );
      case 'warning':
        return (
          <div className="w-12 h-12 rounded-2xl bg-amber-100 border border-amber-200 text-amber-600 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-6 h-6" />
          </div>
        );
      case 'info':
      default:
        return (
          <div className="w-12 h-12 rounded-2xl bg-emerald-100 border border-emerald-200 text-[#0f4c2a] flex items-center justify-center shrink-0">
            <Info className="w-6 h-6" />
          </div>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div 
        className="bg-white border border-stone-200 rounded-3xl shadow-2xl max-w-lg w-full p-6 space-y-5 animate-in zoom-in-95 duration-150 relative overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="geas-dialog-title"
      >
        {/* Top Header Bar Accent */}
        <div 
          className={`absolute top-0 left-0 right-0 h-1.5 ${
            severity === 'danger' ? 'bg-red-600' : severity === 'warning' ? 'bg-amber-500' : 'bg-[#0f4c2a]'
          }`} 
        />

        <div className="flex items-start justify-between gap-4 pt-1">
          <div className="flex items-center space-x-3.5">
            {getSeverityBadge()}
            <div>
              <span className="text-[10px] font-black uppercase tracking-widest text-stone-400 block">
                GEAS Confirmation Framework
              </span>
              <h3 id="geas-dialog-title" className="text-lg font-extrabold text-stone-900 font-heading leading-tight">
                {options.title}
              </h3>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="text-stone-400 hover:text-stone-600 p-1.5 rounded-xl hover:bg-stone-100 transition-all cursor-pointer"
            title="Close dialog (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="text-sm font-medium text-stone-600 whitespace-pre-line leading-relaxed pl-1">
          {options.message}
        </div>

        {requiresInput && (
          <div className="space-y-2 pt-1 bg-stone-50 p-4 rounded-2xl border border-stone-200">
            <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider">
              {options.inputLabel || `Type "${options.requiredInputText}" to confirm:`}
            </label>
            <GMKInput
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={options.inputPlaceholder || options.requiredInputText}
              className="bg-white font-mono text-xs border-stone-300 focus:border-red-500 focus:ring-1 focus:ring-red-500"
            />
            {options.requiredInputText && (
              <p className="text-[11px] text-stone-500">
                To proceed, enter exact match: <span className="font-mono font-bold text-stone-900 bg-stone-200 px-1.5 py-0.5 rounded">{options.requiredInputText}</span>
              </p>
            )}
          </div>
        )}

        <div className="flex items-center justify-end space-x-3 pt-2 border-t border-stone-150">
          <GMKButton
            type="button"
            variant="secondary"
            size="md"
            onClick={onCancel}
            className="border-stone-300 hover:bg-stone-100"
          >
            {options.cancelText || 'Cancel'}
          </GMKButton>

          <GMKButton
            type="button"
            variant={severity === 'danger' ? 'danger' : 'primary'}
            size="md"
            disabled={!isInputValid}
            onClick={onConfirm}
            className={severity === 'danger' ? 'bg-red-600 hover:bg-red-700 text-white font-bold' : ''}
          >
            {options.confirmText || 'Confirm Action'}
          </GMKButton>
        </div>
      </div>
    </div>
  );
}
