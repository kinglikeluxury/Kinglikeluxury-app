import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { apiRequest } from '@/lib/queryClient';
import { Link, useLocation } from 'wouter';
import { Loader2, CheckCircle, Smartphone, MessageCircle, Eye, EyeOff, ArrowLeft } from 'lucide-react';
import { CountryCodePicker } from '@/components/ui/country-code-picker';

type Step = 'phone' | 'verify' | 'newpass' | 'done';

export default function ForgotPasswordPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [step, setStep] = useState<Step>('phone');
  const [dialCode, setDialCode] = useState('+971');
  const [localNumber, setLocalNumber] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [sentMethod, setSentMethod] = useState<'whatsapp' | 'sms' | null>(null);
  const [loading, setLoading] = useState(false);

  const fullPhone = () => `${dialCode}${localNumber.replace(/\s+/g, '')}`;

  const handleSendCode = async () => {
    if (!localNumber || localNumber.replace(/\s+/g, '').length < 4) {
      toast({ title: "رقم غير صحيح", description: "أدخل رقم هاتف صحيح", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const res = await apiRequest('POST', '/api/auth/send-verification', { phoneNumber: fullPhone() });
      const data = await res.json();
      setSentMethod(data.method || 'sms');
      setStep('verify');
      toast({
        title: data.method === 'whatsapp' ? "✅ تم الإرسال عبر WhatsApp" : "✅ تم الإرسال عبر SMS",
        description: `أدخل الرمز المرسل إلى ${fullPhone()}`,
      });
    } catch (e: any) {
      toast({ title: "فشل الإرسال", description: e.message || "حاول مجدداً", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    if (code.length !== 6) {
      toast({ title: "رمز غير صحيح", description: "أدخل الرمز المكون من 6 أرقام", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      await apiRequest('POST', '/api/auth/verify-code', { phoneNumber: fullPhone(), code });
      setStep('newpass');
    } catch (e: any) {
      toast({ title: "رمز خاطئ", description: e.message || "الرمز غير صحيح أو منتهي الصلاحية", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    if (newPassword.length < 6) {
      toast({ title: "كلمة سر قصيرة", description: "يجب أن تكون 6 أحرف على الأقل", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "كلمتا السر لا تتطابقان", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      await apiRequest('POST', '/api/auth/reset-password', {
        phoneNumber: fullPhone(),
        code,
        newPassword,
      });
      setStep('done');
      toast({ title: "✅ تم تغيير كلمة السر بنجاح" });
    } catch (e: any) {
      toast({ title: "فشل إعادة التعيين", description: e.message || "حاول مجدداً", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container flex items-center justify-center min-h-screen py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl font-bold text-center bg-gradient-to-r from-[#3bcac4] to-[#005476] bg-clip-text text-transparent">
            نسيت كلمة السر؟
          </CardTitle>
          <CardDescription className="text-center">
            {step === 'phone' && 'أدخل رقم هاتفك لاستلام رمز التحقق'}
            {step === 'verify' && 'أدخل الرمز الذي وصلك'}
            {step === 'newpass' && 'اختر كلمة سر جديدة'}
            {step === 'done' && 'تم تغيير كلمة السر بنجاح'}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">

          {/* STEP 1 — Phone */}
          {step === 'phone' && (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">رقم الهاتف</label>
                <div className="flex gap-2">
                  <CountryCodePicker value={dialCode} onChange={setDialCode} />
                  <Input
                    type="tel"
                    placeholder="50 123 4567"
                    value={localNumber}
                    onChange={(e) => setLocalNumber(e.target.value)}
                    className="flex-1"
                  />
                </div>
              </div>
              <Button
                className="w-full bg-gradient-to-r from-[#3bcac4] to-[#005476] hover:from-[#005476] hover:to-[#3bcac4]"
                onClick={handleSendCode}
                disabled={loading}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {loading ? 'جاري الإرسال...' : 'إرسال رمز التحقق'}
              </Button>
              <div className="text-center text-sm">
                <Link href="/login" className="text-[#3bcac4] hover:underline flex items-center justify-center gap-1">
                  <ArrowLeft className="h-3.5 w-3.5" /> العودة إلى تسجيل الدخول
                </Link>
              </div>
            </>
          )}

          {/* STEP 2 — Verify */}
          {step === 'verify' && (
            <>
              <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${sentMethod === 'whatsapp' ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-700'}`}>
                {sentMethod === 'whatsapp'
                  ? <><MessageCircle className="h-3.5 w-3.5 shrink-0" /> تم إرسال الرمز عبر <strong>WhatsApp</strong> إلى {fullPhone()}</>
                  : <><Smartphone className="h-3.5 w-3.5 shrink-0" /> تم إرسال الرمز عبر <strong>SMS</strong> إلى {fullPhone()}</>
                }
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">رمز التحقق</label>
                <Input
                  type="text"
                  inputMode="numeric"
                  placeholder="● ● ● ● ● ●"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  maxLength={6}
                  className="text-center text-xl tracking-widest"
                />
              </div>
              <Button
                className="w-full bg-gradient-to-r from-[#3bcac4] to-[#005476] hover:from-[#005476] hover:to-[#3bcac4]"
                onClick={handleVerify}
                disabled={loading || code.length !== 6}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {loading ? 'جاري التحقق...' : 'تحقق من الرمز'}
              </Button>
              <p className="text-xs text-center text-muted-foreground">
                لم يصلك الرمز؟{' '}
                <button type="button" className="text-[#3bcac4] hover:underline" onClick={() => { setStep('phone'); setCode(''); }}>
                  تغيير الرقم
                </button>
                {' · '}
                <button type="button" className="text-[#3bcac4] hover:underline" onClick={handleSendCode} disabled={loading}>
                  إعادة الإرسال
                </button>
              </p>
            </>
          )}

          {/* STEP 3 — New password */}
          {step === 'newpass' && (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">كلمة السر الجديدة</label>
                <div className="relative">
                  <Input
                    type={showPass ? 'text' : 'password'}
                    placeholder="••••••"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                  <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setShowPass(v => !v)}>
                    {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">تأكيد كلمة السر</label>
                <div className="relative">
                  <Input
                    type={showConfirm ? 'text' : 'password'}
                    placeholder="••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                  <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setShowConfirm(v => !v)}>
                    {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <Button
                className="w-full bg-gradient-to-r from-[#3bcac4] to-[#005476] hover:from-[#005476] hover:to-[#3bcac4]"
                onClick={handleReset}
                disabled={loading || newPassword.length < 6 || newPassword !== confirmPassword}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {loading ? 'جاري الحفظ...' : 'حفظ كلمة السر الجديدة'}
              </Button>
            </>
          )}

          {/* STEP 4 — Done */}
          {step === 'done' && (
            <div className="flex flex-col items-center gap-4 py-4">
              <CheckCircle className="h-16 w-16 text-[#3bcac4]" />
              <p className="text-center text-sm text-muted-foreground">تم تحديث كلمة السر بنجاح. يمكنك الآن تسجيل الدخول.</p>
              <Button
                className="w-full bg-gradient-to-r from-[#3bcac4] to-[#005476]"
                onClick={() => setLocation('/login')}
              >
                تسجيل الدخول
              </Button>
            </div>
          )}

        </CardContent>
      </Card>
    </div>
  );
}
