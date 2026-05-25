import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle 
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  Eye, 
  Crown, 
  Plus, 
  Share2, 
  Settings, 
  QrCode,
  CheckCircle
} from "lucide-react";

interface PostPaymentChoicesPopupProps {
  open: boolean;
  onClose: () => void;
  propertyId: string;
  propertyTitle: string;
  durationDays: number;
  amount: number;
}

export function PostPaymentChoicesPopup({ 
  open, 
  onClose, 
  propertyId, 
  propertyTitle, 
  durationDays, 
  amount 
}: PostPaymentChoicesPopupProps) {
  
  const handleViewProperty = () => {
    window.location.href = `/property/${propertyId}`;
  };

  const handleUpgradeToSuperVIP = () => {
    // Future: Open Super VIP upgrade flow
    alert('Super VIP upgrade coming soon! Contact our team for premium features.');
  };

  const handleAddMoreProperties = () => {
    window.location.href = '/submit-property';
  };

  const handleShareListing = () => {
    const shareUrl = `${window.location.origin}/property/${propertyId}`;
    if (navigator.share) {
      navigator.share({
        title: propertyTitle,
        text: `Check out this featured property: ${propertyTitle}`,
        url: shareUrl,
      });
    } else {
      navigator.clipboard.writeText(shareUrl);
      alert('Property link copied to clipboard!');
    }
  };

  const handleManageListings = () => {
    window.location.href = '/dashboard';
  };

  const handleDownloadQR = () => {
    // Future: Generate QR code for property
    alert('QR code generation coming soon!');
  };

  const choices = [
    {
      id: 'view',
      title: 'View Your Property',
      description: 'See how your featured listing looks',
      icon: Eye,
      action: handleViewProperty,
      primary: true
    },
    {
      id: 'upgrade',
      title: 'Upgrade to Super VIP',
      description: 'Get maximum visibility and premium features',
      icon: Crown,
      action: handleUpgradeToSuperVIP,
      badge: 'PREMIUM'
    },
    {
      id: 'add',
      title: 'Add Another Property',
      description: 'List more properties to grow your portfolio',
      icon: Plus,
      action: handleAddMoreProperties
    },
    {
      id: 'share',
      title: 'Share Your Listing',
      description: 'Spread the word on social media',
      icon: Share2,
      action: handleShareListing
    },
    {
      id: 'manage',
      title: 'Manage All Listings',
      description: 'View and edit your property portfolio',
      icon: Settings,
      action: handleManageListings
    },
    {
      id: 'qr',
      title: 'Download QR Code',
      description: 'For offline marketing and sharing',
      icon: QrCode,
      action: handleDownloadQR
    }
  ];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" data-testid="dialog-post-payment-choices">
        <DialogHeader>
          <div className="flex items-center justify-center mb-4">
            <div className="w-16 h-16 bg-gradient-to-br from-primary to-secondary rounded-full flex items-center justify-center">
              <CheckCircle className="w-8 h-8 text-white" />
            </div>
          </div>
          <DialogTitle className="text-2xl font-bold text-center">
            Payment Successful!
          </DialogTitle>
          <div className="text-center space-y-2">
            <p className="text-lg text-gray-600">
              Your property "{propertyTitle}" is now featured for {durationDays} days
            </p>
            <p className="text-sm text-gray-500">
              Payment of ${amount} processed successfully
            </p>
          </div>
        </DialogHeader>

        <div className="mt-6">
          <h3 className="text-lg font-semibold mb-4 text-center">What would you like to do next?</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {choices.map((choice) => (
              <Card 
                key={choice.id}
                className={`cursor-pointer transition-all hover:shadow-lg hover:scale-105 relative ${
                  choice.primary ? 'border-primary ring-2 ring-primary/20' : 'hover:border-primary/50'
                }`}
                onClick={choice.action}
                data-testid={`card-choice-${choice.id}`}
              >
                {choice.badge && (
                  <div className="absolute -top-2 right-2">
                    <span className="bg-primary text-white text-xs font-bold px-2 py-1 rounded-full">
                      {choice.badge}
                    </span>
                  </div>
                )}
                
                <CardHeader className="text-center pb-2">
                  <div className="mx-auto w-12 h-12 bg-gradient-to-br from-primary/10 to-secondary/10 rounded-full flex items-center justify-center mb-2">
                    <choice.icon className="w-6 h-6 text-primary" />
                  </div>
                  <CardTitle className="text-lg">{choice.title}</CardTitle>
                </CardHeader>
                
                <CardContent className="text-center">
                  <p className="text-sm text-gray-600">{choice.description}</p>
                  
                  <Button 
                    className={`mt-3 w-full ${
                      choice.primary 
                        ? 'bg-gradient-to-r from-primary to-secondary hover:from-primary/90 hover:to-secondary/90' 
                        : 'variant-outline hover:bg-primary/5'
                    }`}
                    variant={choice.primary ? "default" : "outline"}
                    onClick={(e) => {
                      e.stopPropagation();
                      choice.action();
                    }}
                    data-testid={`button-choice-${choice.id}`}
                  >
                    {choice.title}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
        
        <div className="mt-8 text-center">
          <Button 
            variant="ghost" 
            onClick={onClose}
            data-testid="button-close-choices"
            className="text-gray-500 hover:text-gray-700"
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}