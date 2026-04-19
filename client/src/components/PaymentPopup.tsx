import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Crown, Calendar, DollarSign, Building2, Loader2 } from 'lucide-react';
import { SiPaypal } from 'react-icons/si';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

interface PaymentPopupProps {
  open: boolean;
  onClose: () => void;
  onPayment: (amount: number, days: number, method: string) => void;
  propertyType: string;
  propertyId?: number | string;
}

interface PricingOption {
  amount: number;
  days: number;
  popular?: boolean;
}

const pricingOptions: PricingOption[] = [
  { amount: 5, days: 7 },
  { amount: 10, days: 14, popular: true },
  { amount: 20, days: 30 }
];

export default function PaymentPopup({ 
  open, 
  onClose, 
  onPayment,
  propertyType,
  propertyId
}: PaymentPopupProps) {
  const [selectedOption, setSelectedOption] = useState<PricingOption | null>(null);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>('');
  const [bogLoading, setBogLoading] = useState(false);
  const { toast } = useToast();
  
  const handlePayment = async () => {
    if (!selectedOption || !selectedPaymentMethod) return;

    if (selectedPaymentMethod === 'bog') {
      await handleBOGPayment();
      return;
    }

    if (selectedPaymentMethod === 'paypal') {
      onPayment(selectedOption.amount, selectedOption.days, selectedPaymentMethod);
      return;
    }
  };

  const handleBOGPayment = async () => {
    if (!selectedOption) return;
    setBogLoading(true);
    try {
      const res = await apiRequest('POST', '/api/bog/create-order', {
        amount: selectedOption.amount,
        currency: 'USD',
        propertyId: propertyId || 0,
        days: selectedOption.days,
      });
      const data = await res.json();
      if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
      } else {
        throw new Error(data.message || 'Failed to get redirect URL');
      }
    } catch (err: any) {
      toast({
        title: 'خطأ في الدفع',
        description: err.message || 'تعذّر الاتصال ببوابة بنك جورجيا',
        variant: 'destructive',
      });
    } finally {
      setBogLoading(false);
    }
  };
  
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="dialog-payment">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-center">
            <Crown className="w-6 h-6 inline mr-2 text-primary" />
            Featured Listing Payment
          </DialogTitle>
          <p className="text-center text-gray-600">
            Choose your featured listing duration for your {propertyType.toLowerCase()}
          </p>
        </DialogHeader>
        
        {/* Pricing Options */}
        <div className="mt-6">
          <h3 className="text-lg font-semibold mb-4 text-center">Select Duration</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {pricingOptions.map((option) => (
              <Card 
                key={option.days}
                className={`border-2 cursor-pointer transition-all hover:shadow-lg relative ${
                  selectedOption?.days === option.days 
                    ? 'border-primary bg-primary/5' 
                    : 'border-gray-200 hover:border-gray-300'
                } ${option.popular ? 'ring-2 ring-primary/30' : ''}`}
                onClick={() => setSelectedOption(option)}
                data-testid={`card-pricing-${option.days}days`}
              >
                {option.popular && (
                  <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                    <Badge className="bg-primary text-white font-bold px-3 py-1">
                      MOST POPULAR
                    </Badge>
                  </div>
                )}
                
                <CardHeader className="text-center pb-2">
                  <div className="mx-auto w-12 h-12 bg-gradient-to-br from-primary to-secondary rounded-full flex items-center justify-center mb-2">
                    <Calendar className="w-6 h-6 text-white" />
                  </div>
                  <CardTitle className="text-2xl font-bold text-primary">
                    ${option.amount}
                  </CardTitle>
                  <CardDescription className="font-medium">
                    {option.days} Days Featured
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-2">
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center">
                      <span className="text-green-500 mr-2">✓</span>
                      Top listing position
                    </div>
                    <div className="flex items-center">
                      <span className="text-green-500 mr-2">✓</span>
                      Highlighted display
                    </div>
                    <div className="flex items-center">
                      <span className="text-green-500 mr-2">✓</span>
                      Premium badge
                    </div>
                    <div className="flex items-center">
                      <span className="text-primary mr-2">⭐</span>
                      <strong>3x more views</strong>
                    </div>
                  </div>
                  
                  <div className="mt-4 text-center">
                    <div className="text-xs text-gray-500">
                      ${(option.amount / option.days).toFixed(2)} per day
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
        
        {/* Payment Methods */}
        {selectedOption && (
          <div className="mt-8">
            <h3 className="text-lg font-semibold mb-4 text-center">Choose Payment Method</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* PayPal */}
              <Card 
                className={`border-2 cursor-pointer transition-all hover:shadow-lg ${
                  selectedPaymentMethod === 'paypal' 
                    ? 'border-primary bg-primary/5' 
                    : 'border-gray-200 hover:border-gray-300'
                }`}
                onClick={() => setSelectedPaymentMethod('paypal')}
                data-testid="card-payment-paypal"
              >
                <CardContent className="flex items-center justify-center p-6">
                  <div className="text-center">
                    <SiPaypal className="w-12 h-12 mx-auto mb-2 text-blue-600" />
                    <div className="font-semibold">PayPal</div>
                    <div className="text-sm text-gray-500">Secure PayPal payment</div>
                    <div className="flex items-center justify-center mt-2 space-x-2">
                      <DollarSign className="w-4 h-4 text-gray-500" />
                      <span className="text-xs text-gray-500">PayPal Balance, Bank</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* BOG — Bank of Georgia */}
              <Card 
                className={`border-2 cursor-pointer transition-all hover:shadow-lg ${
                  selectedPaymentMethod === 'bog' 
                    ? 'border-[#3bcac4] bg-[#3bcac4]/5' 
                    : 'border-gray-200 hover:border-gray-300'
                }`}
                onClick={() => setSelectedPaymentMethod('bog')}
                data-testid="card-payment-bog"
              >
                <CardContent className="flex items-center justify-center p-6">
                  <div className="text-center">
                    <div className="w-12 h-12 mx-auto mb-2 rounded-full bg-gradient-to-br from-[#e8000d] to-[#c00009] flex items-center justify-center">
                      <Building2 className="w-7 h-7 text-white" />
                    </div>
                    <div className="font-semibold">Bank of Georgia</div>
                    <div className="text-sm text-gray-500">BOG Online Payment</div>
                    <div className="flex items-center justify-center mt-2">
                      <span className="text-xs text-gray-500">🇬🇪 Visa, Mastercard</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
        
        {/* Payment Summary & Action */}
        {selectedOption && selectedPaymentMethod && (
          <div className="mt-8 bg-gradient-to-r from-primary/5 to-secondary/5 rounded-lg p-6 border border-primary/20">
            <h3 className="text-lg font-semibold mb-4 text-center">Payment Summary</h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-gray-600">Featured listing duration:</span>
                <span className="font-semibold">{selectedOption.days} days</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-600">Payment method:</span>
                <span className="font-semibold capitalize">
                  {selectedPaymentMethod === 'bog' ? '🇬🇪 Bank of Georgia' : selectedPaymentMethod}
                </span>
              </div>
              <div className="border-t border-primary/20 pt-3">
                <div className="flex justify-between items-center text-lg">
                  <span className="font-bold">Total:</span>
                  <span className="font-bold text-primary">${selectedOption.amount}</span>
                </div>
              </div>
            </div>
            
            <div className="mt-6 flex flex-col sm:flex-row gap-3">
              <Button 
                variant="outline" 
                onClick={onClose}
                className="flex-1"
                data-testid="button-cancel-payment"
                disabled={bogLoading}
              >
                Cancel
              </Button>
              <Button 
                onClick={handlePayment}
                className="flex-1 bg-gradient-to-r from-primary to-secondary hover:from-primary/90 hover:to-secondary/90"
                data-testid="button-proceed-payment"
                disabled={bogLoading}
              >
                {bogLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Redirecting to Bank...
                  </>
                ) : (
                  'Proceed to Payment'
                )}
              </Button>
            </div>
          </div>
        )}
        
        {/* Security Notice */}
        <div className="mt-6 text-center text-xs text-gray-500 bg-gray-50 p-3 rounded">
          🔒 Your payment information is secure and encrypted. 
          We use industry-standard security measures to protect your data.
        </div>
      </DialogContent>
    </Dialog>
  );
}
