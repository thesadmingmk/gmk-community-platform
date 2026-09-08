import React from 'react';
import { Download, FileText, FileSpreadsheet, Loader2, Check, AlertCircle } from 'lucide-react';
import { useReportExport, ExportType } from '../../hooks/useReportExport';

export interface ReportExportButtonProps {
  exportType: ExportType;
  onExport: () => void | Promise<void>;
  label?: string;
  generatingLabel?: string;
  downloadedLabel?: string;
  failedLabel?: string;
  reportName?: string;
  successMessage?: string;
  errorMessage?: string;
  variant?: 'primary' | 'secondary' | 'pdf-light' | 'excel-light' | 'dark' | 'outline' | 'ghost' | 'custom';
  size?: 'sm' | 'md' | 'lg' | 'compact';
  fullWidth?: boolean;
  disabled?: boolean;
  className?: string;
  title?: string;
  id?: string;
  icon?: React.ReactNode;
  hideTextOnMobile?: boolean;
}

export function ReportExportButton({
  exportType,
  onExport,
  label,
  generatingLabel,
  downloadedLabel,
  failedLabel,
  reportName,
  successMessage,
  errorMessage,
  variant,
  size = 'md',
  fullWidth = false,
  disabled = false,
  className = '',
  title,
  id,
  icon,
  hideTextOnMobile = false,
}: ReportExportButtonProps) {
  const { status, isGenerating, isSuccess, isError, triggerExport } = useReportExport({
    exportType,
    onExport,
    reportName,
    successMessage,
    errorMessage,
  });

  // Default labels
  const isPDF = exportType === 'pdf';
  const defaultNormalLabel = label || (isPDF ? 'Download PDF' : 'Download Excel');

  let defaultGenerating = generatingLabel;
  if (!defaultGenerating) {
    if (defaultNormalLabel === 'PDF' || defaultNormalLabel === 'Excel') {
      defaultGenerating = 'Generating...';
    } else {
      defaultGenerating = isPDF ? 'Generating PDF...' : 'Generating Excel...';
    }
  }

  let defaultDownloaded = downloadedLabel;
  if (!defaultDownloaded) {
    if (defaultNormalLabel === 'PDF' || defaultNormalLabel === 'Excel') {
      defaultDownloaded = 'Downloaded';
    } else {
      defaultDownloaded = isPDF ? 'PDF Downloaded' : 'Excel Downloaded';
    }
  }

  let defaultFailed = failedLabel;
  if (!defaultFailed) {
    if (defaultNormalLabel === 'PDF' || defaultNormalLabel === 'Excel') {
      defaultFailed = 'Failed';
    } else {
      defaultFailed = isPDF ? 'PDF Failed' : 'Excel Failed';
    }
  }

  // Determine current label and icon
  let currentLabel = defaultNormalLabel;
  let currentIcon: React.ReactNode = icon || (isPDF ? <FileText className="w-3.5 h-3.5 shrink-0" /> : <FileSpreadsheet className="w-3.5 h-3.5 shrink-0" />);

  if (isGenerating) {
    currentLabel = defaultGenerating;
    currentIcon = <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 text-current" />;
  } else if (isSuccess) {
    currentLabel = defaultDownloaded;
    currentIcon = <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0 stroke-[2.5]" />;
  } else if (isError) {
    currentLabel = defaultFailed;
    currentIcon = <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0 stroke-[2.5]" />;
  }

  // Pre-configured variant styles if className is not providing full styling
  const sizeClasses = {
    compact: 'px-2.5 py-1.5 text-xs',
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-xs',
    lg: 'px-5 py-2.5 text-sm',
  }[size];

  const variantClasses = {
    primary: 'bg-[#0f4c2a] hover:bg-[#0c3e22] text-white shadow-xs',
    secondary: 'bg-white hover:bg-stone-50 border border-stone-200 text-stone-700 shadow-2xs',
    'pdf-light': 'bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 shadow-2xs',
    'excel-light': 'bg-emerald-50 hover:bg-emerald-100 text-[#0f4c2a] border border-emerald-200 shadow-2xs',
    dark: 'bg-stone-800 hover:bg-stone-900 text-white shadow-xs',
    outline: 'bg-transparent border border-stone-300 text-stone-700 hover:bg-stone-50',
    ghost: 'bg-transparent hover:bg-stone-100 text-stone-700',
    custom: '',
  }[variant || 'custom'];

  // State-specific classes
  const stateClasses = isGenerating
    ? 'opacity-80 cursor-wait pointer-events-none'
    : isSuccess
    ? 'border-emerald-400/80 ring-1 ring-emerald-400/30'
    : isError
    ? 'border-rose-400/80 ring-1 ring-rose-400/30'
    : '';

  const finalDisabled = disabled || isGenerating;

  return (
    <button
      id={id}
      type="button"
      onClick={triggerExport}
      disabled={finalDisabled}
      aria-busy={isGenerating}
      aria-live="polite"
      title={title || defaultNormalLabel}
      className={`
        inline-flex items-center justify-center space-x-1.5 font-bold uppercase tracking-wider rounded-xl transition-all duration-150 select-none
        active:scale-[0.98]
        disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none
        ${fullWidth ? 'w-full' : ''}
        ${variantClasses}
        ${!className ? sizeClasses : ''}
        ${stateClasses}
        ${className}
      `.trim()}
    >
      {currentIcon}
      <span className={hideTextOnMobile ? 'hidden sm:inline' : undefined}>
        {currentLabel}
      </span>
    </button>
  );
}

export default ReportExportButton;
