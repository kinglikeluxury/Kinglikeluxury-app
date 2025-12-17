import { useState, useEffect } from 'react';
import { Download, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function InstallPWA() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
      setShowBanner(true);
    };

    window.addEventListener('beforeinstallprompt', handler);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  const handleInstall = async () => {
    if (!installPrompt) return;

    await installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;

    if (outcome === 'accepted') {
      setShowBanner(false);
    }
    setInstallPrompt(null);
  };

  const handleDismiss = () => {
    setShowBanner(false);
  };

  if (!showBanner) return null;

  return (
    <div 
      className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-80 bg-gradient-to-r from-[#3bcac4] to-[#005476] text-white p-4 rounded-xl shadow-2xl z-50 animate-in slide-in-from-bottom"
      data-testid="install-pwa-banner"
    >
      <button 
        onClick={handleDismiss}
        className="absolute top-2 right-2 p-1 hover:bg-white/20 rounded-full"
        data-testid="dismiss-install-banner"
      >
        <X size={18} />
      </button>
      
      <div className="flex items-center gap-3 mb-3">
        <div className="bg-white/20 p-2 rounded-lg">
          <Download size={24} />
        </div>
        <div>
          <h3 className="font-bold text-lg">Install Kinglike App</h3>
          <p className="text-sm text-white/80">Fast access from your home screen</p>
        </div>
      </div>
      
      <Button
        onClick={handleInstall}
        className="w-full bg-white text-[#005476] hover:bg-white/90 font-semibold"
        data-testid="install-pwa-button"
      >
        <Download className="mr-2" size={18} />
        Install Now
      </Button>
    </div>
  );
}
