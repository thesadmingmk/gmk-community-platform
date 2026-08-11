import React, { useState, useEffect } from 'react';
import { Download, X, Share, Smartphone } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    // Check if already running in standalone mode (installed app)
    const isApp = window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;
    
    if (isApp) {
      setIsStandalone(true);
      return;
    }

    // Detect iOS
    const userAgent = window.navigator.userAgent.toLowerCase();
    const iosDevice = /iphone|ipad|ipod/.test(userAgent);
    setIsIOS(iosDevice);

    // Check if user previously dismissed
    const isDismissed = localStorage.getItem('gmk_pwa_prompt_dismissed');

    // Handler for PWA install prompt
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      if (!isDismissed) {
        setShowPrompt(true);
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // Show prompt for iOS if not dismissed and not standalone
    if (iosDevice && !isDismissed && !isApp) {
      setShowPrompt(true);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setShowPrompt(false);
      }
      setDeferredPrompt(null);
    }
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    localStorage.setItem('gmk_pwa_prompt_dismissed', 'true');
  };

  if (isStandalone || !showPrompt) {
    return null;
  }

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-6 md:max-w-sm z-[9999] bg-[#0F4C2A] text-white p-4 rounded-2xl shadow-2xl border border-[#D4AF37]/40 backdrop-blur-md animate-fade-in transition-all">
      <div className="flex items-start justify-between gap-3">
        <div className="p-2.5 bg-[#D4AF37]/20 border border-[#D4AF37]/30 rounded-xl text-[#D4AF37] shrink-0 mt-0.5">
          <Smartphone className="w-6 h-6" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-bold font-serif text-[#FFFDF6] tracking-wide">
              Install GMK App
            </h4>
            <span className="bg-[#D4AF37] text-[#0F4C2A] text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider">
              PWA
            </span>
          </div>
          <p className="text-xs text-stone-200 mt-1 leading-relaxed">
            Install the GMK Portal on your home screen for quick offline access & instant updates.
          </p>

          {isIOS ? (
            <div className="mt-2.5 p-2 bg-[#072414] rounded-lg border border-white/10 text-[11px] text-stone-300 flex items-center gap-1.5">
              <Share className="w-3.5 h-3.5 text-[#D4AF37] shrink-0" />
              <span>Tap <strong className="text-white">Share</strong> then <strong className="text-white">Add to Home Screen</strong></span>
            </div>
          ) : (
            deferredPrompt && (
              <button
                onClick={handleInstallClick}
                className="mt-3 w-full py-2 px-3 bg-[#D4AF37] hover:bg-[#c29f2f] text-[#0F4C2A] font-bold text-xs rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md"
              >
                <Download className="w-4 h-4" />
                <span>Install Application</span>
              </button>
            )
          )}
        </div>

        <button
          onClick={handleDismiss}
          className="text-stone-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors cursor-pointer shrink-0"
          title="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
