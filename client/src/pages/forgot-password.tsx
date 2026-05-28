import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { apiRequest } from '@/lib/queryClient';
import { Link, useLocation } from 'wouter';
import { Loader2, CheckCircle, Eye, EyeOff, ArrowLeft, Phone, Mail } from 'lucide-react';
import { CountryCodePicker } from '@/components/ui/country-code-picker';
import { useTranslation } from 'react-i18next';

type Step = 'choose' | 'verify' | 'newpass' | 'done';
type Method = 'phone' | 'email';

export default function ForgotPasswordPage() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [, setLocation] = useLocation();

  const [step, setStep] = useState<Step>('choose');
  const [method, setMethod] = useState<Method>('phone');
  const [dialCode, setDialCode] = useState('+971');
  const [localNumber, setLocalNumber] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  const fullPhone = () => `${dialCode}${localNumber.replace(/\s+/g, '')}`;

  const handleSendCode = async () => {
    if (method === 'phone' && (!localNumber || localNumber.replace(/\s+/g, '').length < 4)) {
      toast({ title: t('auth.invalidNumber'), description: t('auth.invalidNumberDesc'), variant: 'destructive' });
      return;
    }
    if (method === 'email' && !email.includes('@')) {
      toast({ title: t('auth.emailRequired'), variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      await apiRequest('POST', '/api/auth/send-reset-otp', {
        method,
        ...(method === 'phone' ? { phoneNumber: fullPhone() } : { email: email.trim() }),
      });
      toast({ title: t('auth.ifAccountExists') });
      setStep('verify');
    } catch (e: any) {
      // Never expose provider errors — show generic message
      toast({ title: t('auth.sendFailed'), description: t('auth.ifAccountExists'), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    if (code.length !== 6) {
      toast({ title: t('auth.invalidCode'), description: t('auth.invalidCodeDesc'), variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      await apiRequest('POST', '/api/auth/verify-reset-otp', {
        method,
        ...(method === 'phone' ? { phoneNumber: fullPhone() } : { email: email.trim() }),
        code,
      });
      setStep('newpass');
    } catch (e: any) {
      toast({ title: t('auth.invalidCode'), description: t('auth.invalidCodeDesc'), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    if (newPassword.length < 6) {
      toast({ title: t('auth.passwordTooShort'), variant: 'destructive' });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: t('auth.passwordsNoMatch'), variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      await apiRequest('POST', '/api/auth/reset-password', {
        method,
        ...(method === 'phone' ? { phoneNumber: fullPhone() } : { email: email.trim() }),
        code,
        newPassword,
      });
      setStep('done');
    } catch (e: any) {
      toast({ title: t('auth.invalidCode'), description: e.message || '', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const stepDesc: Record<Step, string> = {
    choose: t('auth.forgotSubtitle'),
    verify:  t('auth.ifAccountExists'),
    newpass: t('auth.changePasswordDesc'),
    done:    t('auth.resetDone'),
  };

  return (
    <div className="container flex items-center justify-center min-h-screen py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl font-bold text-center bg-gradient-to-r from-[#3bcac4] to-[#005476] bg-clip-text text-transparent">
            {t('auth.forgotPassword')}
          </CardTitle>
          <CardDescription className="text-center">
            {stepDesc[step]}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">

          {/* ── STEP 1: Choose method + enter identifier ───────────────────────── */}
          {step === 'choose' && (
            <>
              {/* Method toggle */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMethod('phone')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border-2 text-sm font-medium transition-all ${
                    method === 'phone'
                      ? 'border-[#3bcac4] bg-[#3bcac4]/10 text-[#005476]'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  <Phone className="h-4 w-4" />
                  {t('auth.resetByPhone')}
                </button>
                <button
                  type="button"
                  onClick={() => setMethod('email')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border-2 text-sm font-medium transition-all ${
                    method === 'email'
                      ? 'border-[#3bcac4] bg-[#3bcac4]/10 text-[#005476]'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  <Mail className="h-4 w-4" />
                  {t('auth.resetByEmail')}
                </button>
              </div>

              {/* Phone input */}
              {method === 'phone' && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('auth.phone')}</label>
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
              )}

              {/* Email input */}
              {method === 'email' && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('auth.email')}</label>
                  <Input
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendCode()}
                  />
                </div>
              )}

              <Button
                className="w-full bg-gradient-to-r from-[#3bcac4] to-[#005476] hover:from-[#005476] hover:to-[#3bcac4]"
                onClick={handleSendCode}
                disabled={loading}
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {loading ? t('auth.sending') : t('auth.sendCode')}
              </Button>

              <div className="text-center text-sm">
                <Link href="/login" className="text-[#3bcac4] hover:underline flex items-center justify-center gap-1">
                  <ArrowLeft className="h-3.5 w-3.5" />
                  {t('auth.backToLogin')}
                </Link>
              </div>
            </>
          )}

          {/* ── STEP 2: Enter verification code ────────────────────────────────── */}
          {step === 'verify' && (
            <>
              <div className="rounded-xl border border-[#3bcac4]/30 bg-[#3bcac4]/5 px-4 py-3 text-sm text-[#005476]">
                {t('auth.ifAccountExists')}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">{t('auth.verificationCode')}</label>
                <Input
                  type="text"
                  inputMode="numeric"
                  placeholder="● ● ● ● ● ●"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  maxLength={6}
                  className="text-center text-xl tracking-widest"
                  onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && handleVerify()}
                />
              </div>

              <Button
                className="w-full bg-gradient-to-r from-[#3bcac4] to-[#005476] hover:from-[#005476] hover:to-[#3bcac4]"
                onClick={handleVerify}
                disabled={loading || code.length !== 6}
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {loading ? t('auth.verifying') : t('auth.verifyCode')}
              </Button>

              <p className="text-xs text-center text-muted-foreground">
                <button
                  type="button"
                  className="text-[#3bcac4] hover:underline"
                  onClick={() => { setStep('choose'); setCode(''); }}
                >
                  {t('auth.changeMethod')}
                </button>
                {' · '}
                <button
                  type="button"
                  className="text-[#3bcac4] hover:underline"
                  onClick={handleSendCode}
                  disabled={loading}
                >
                  {t('auth.resend')}
                </button>
              </p>
            </>
          )}

          {/* ── STEP 3: New password ────────────────────────────────────────────── */}
          {step === 'newpass' && (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('auth.newPassword')}</label>
                <div className="relative">
                  <Input
                    type={showPass ? 'text' : 'password'}
                    placeholder="••••••"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    onClick={() => setShowPass(v => !v)}
                  >
                    {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">{t('auth.confirmNewPassword')}</label>
                <div className="relative">
                  <Input
                    type={showConfirm ? 'text' : 'password'}
                    placeholder="••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleReset()}
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    onClick={() => setShowConfirm(v => !v)}
                  >
                    {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <Button
                className="w-full bg-gradient-to-r from-[#3bcac4] to-[#005476] hover:from-[#005476] hover:to-[#3bcac4]"
                onClick={handleReset}
                disabled={loading || newPassword.length < 6 || newPassword !== confirmPassword}
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {loading ? t('auth.saving') : t('auth.savePassword')}
              </Button>
            </>
          )}

          {/* ── STEP 4: Done ────────────────────────────────────────────────────── */}
          {step === 'done' && (
            <div className="flex flex-col items-center gap-4 py-4">
              <CheckCircle className="h-16 w-16 text-[#3bcac4]" />
              <p className="text-center text-sm text-muted-foreground">
                {t('auth.resetDoneDesc')}
              </p>
              <Button
                className="w-full bg-gradient-to-r from-[#3bcac4] to-[#005476]"
                onClick={() => setLocation('/login')}
              >
                {t('auth.useLogin')}
              </Button>
            </div>
          )}

        </CardContent>
      </Card>
    </div>
  );
}
