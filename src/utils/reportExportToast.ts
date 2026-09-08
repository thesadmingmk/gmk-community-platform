// Utility for showing non-intrusive toast notifications for report exports
export type ToastType = 'success' | 'error' | 'info';

export function showReportExportToast(message: string, type: ToastType = 'success', durationMs = 3500): void {
  if (typeof document === 'undefined') return;

  const containerId = 'gmk-report-export-toast-container';
  let container = document.getElementById(containerId);

  if (!container) {
    container = document.createElement('div');
    container.id = containerId;
    container.className = 'fixed bottom-6 right-6 z-[99999] flex flex-col gap-2 max-w-sm pointer-events-none select-none';
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('role', 'status');
    document.body.appendChild(container);
  }

  const toastEl = document.createElement('div');
  const isSuccess = type === 'success';
  const isError = type === 'error';

  toastEl.className = [
    'pointer-events-auto flex items-center space-x-2.5 px-4 py-3 rounded-2xl shadow-2xl text-xs font-bold font-heading border transition-all duration-200 transform translate-y-3 opacity-0 cursor-pointer',
    isError 
      ? 'bg-stone-900 text-red-100 border-red-800/80 shadow-red-950/40' 
      : 'bg-stone-900 text-white border-stone-800 shadow-stone-950/50'
  ].join(' ');

  const iconSvg = isSuccess
    ? `<svg class="w-4 h-4 text-emerald-400 shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>`
    : isError
    ? `<svg class="w-4 h-4 text-rose-400 shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
    : `<svg class="w-4 h-4 text-blue-400 shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;

  toastEl.innerHTML = `
    ${iconSvg}
    <span class="flex-1 leading-snug tracking-wide">${escapeHtml(message)}</span>
    <button type="button" class="text-stone-400 hover:text-stone-200 ml-1.5 text-xs font-black p-0.5 cursor-pointer leading-none" aria-label="Dismiss">&times;</button>
  `;

  // Dismiss on click
  toastEl.onclick = () => removeToast(toastEl);

  container.appendChild(toastEl);

  // Trigger entering animation
  requestAnimationFrame(() => {
    toastEl.classList.remove('translate-y-3', 'opacity-0');
    toastEl.classList.add('translate-y-0', 'opacity-100');
  });

  // Auto-remove after durationMs
  const timer = setTimeout(() => {
    removeToast(toastEl);
  }, durationMs);

  function removeToast(el: HTMLElement) {
    clearTimeout(timer);
    el.classList.remove('translate-y-0', 'opacity-100');
    el.classList.add('translate-y-2', 'opacity-0');
    setTimeout(() => {
      if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
      if (container && container.children.length === 0) {
        container.remove();
      }
    }, 200);
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
