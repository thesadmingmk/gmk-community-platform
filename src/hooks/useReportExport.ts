import { useState, useRef, useCallback, useEffect } from 'react';
import { showReportExportToast } from '../utils/reportExportToast';

export type ExportStatus = 'idle' | 'generating' | 'success' | 'error';
export type ExportType = 'pdf' | 'excel';

export interface UseReportExportOptions {
  exportType: ExportType;
  onExport: () => void | Promise<void>;
  reportName?: string;
  successMessage?: string;
  errorMessage?: string;
  onSuccess?: () => void;
  onError?: (err: unknown) => void;
}

export function useReportExport({
  exportType,
  onExport,
  reportName,
  successMessage,
  errorMessage,
  onSuccess,
  onError,
}: UseReportExportOptions) {
  const [status, setStatus] = useState<ExportStatus>('idle');
  const isExecutingRef = useRef(false);
  const resetTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  const triggerExport = useCallback(async () => {
    // 1. Double-click protection & active generation guard
    if (isExecutingRef.current || status === 'generating') {
      return;
    }

    isExecutingRef.current = true;
    setStatus('generating');

    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }

    // 2. Schedule actual export after a short tick (60ms) to allow React to paint the loading state
    setTimeout(async () => {
      try {
        await onExport();

        // 3. Mark success
        setStatus('success');
        isExecutingRef.current = false;

        const defaultSuccess = successMessage || (
          exportType === 'pdf' 
            ? '✓ PDF downloaded successfully' 
            : '✓ Excel report downloaded successfully'
        );
        showReportExportToast(defaultSuccess, 'success');

        if (onSuccess) {
          onSuccess();
        }

        // Return to normal state after 2.5 seconds
        resetTimerRef.current = setTimeout(() => {
          setStatus('idle');
        }, 2500);
      } catch (err) {
        console.error(`Error generating ${exportType.toUpperCase()} report:`, err);

        // 4. Mark error
        setStatus('error');
        isExecutingRef.current = false;

        const defaultError = errorMessage || (
          exportType === 'pdf'
            ? 'PDF download failed. Please try again.'
            : 'Excel download failed. Please try again.'
        );
        showReportExportToast(defaultError, 'error');

        if (onError) {
          onError(err);
        }

        // Return to normal state after 3 seconds so user can retry
        resetTimerRef.current = setTimeout(() => {
          setStatus('idle');
        }, 3000);
      }
    }, 60);
  }, [exportType, onExport, reportName, successMessage, errorMessage, onSuccess, onError, status]);

  return {
    status,
    isGenerating: status === 'generating',
    isSuccess: status === 'success',
    isError: status === 'error',
    triggerExport,
  };
}
