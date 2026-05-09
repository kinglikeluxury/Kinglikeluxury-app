import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { z } from 'zod';
import { AUTH_METHODS } from '@shared/schema';
import { apiRequest } from '@/lib/queryClient';
import { Link, useLocation } from 'wouter';
import { CheckCircle, Loader2, MessageCircle, Smartphone, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { CountryCodePicker } from '@/components/ui/country-code-picker';
import { useAuth } from '@/lib/auth';
import { useTranslation } from 'react-i18next';

const phoneSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

type PhoneFormValues = z.infer<typeof phoneSchema>;

export default function RegisterPage() {
  const { toast } = useToast();
  const { setUser } = useAuth();
  const { t } = useTranslation();
  const [currentLocation, setLocation] = useLocation();
  const redirectTo = new URLSearchParams(currentLocation.split("?")[1] || "").get("redirect") || "/";

  const [phoneVerified, setPhoneVerified] = useState(false);
  const [phoneAlreadyRegistered, setPhoneAlreadyRegistered] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [sendingCode, setSendingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [sentMethod, setSentMethod] = useState<'whatsapp' | 'sms' | null>(null);
  const [dialCode, setDialCode] = useState('+971');
  const [localNumber, setLocalNumber] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);

  const form = useForm<PhoneFormValues>({
    resolver: zodResolver(phoneSchema),
    defaultValues: { username: '', password: '' },
  });

  const getFullPhoneNumber = () => `${dialCode}${localNumber.replace(/\s+/g, '')}`;

  const handleSendCode = async () => {
    if (!privacyAccepted) {
      toast({ title: t('auth.privacyRequired'), description: t('auth.privacyRequiredDesc'), variant: "destructive" });
      return;
    }
    const valid = await form.trigger(['username', 'password']);
    if (!valid) return;

    if (!localNumber || localNumber.replace(/\s+/g, '').length < 4) {
      toast({ title: t('auth.invalidNumber'), description: t('auth.invalidNumberDesc'), variant: "destructive" });
      return;
    }

    const phoneNumber = getFullPhoneNumber();
    setSendingCode(true);
    try {
      const result = await apiRequest('POST', '/api/auth/send-verification', { phoneNumber });
      const data = await result.json();
      setVerificationSent(true);
      setSentMethod(data.method || 'sms');
      toast({
        title: data.method === 'whatsapp' ? `✅ ${t('auth.sentViaWhatsapp')}` : `✅ ${t('auth.sentViaSms')}`,
        description: phoneNumber,
      });
    } catch (error: any) {
      toast({ title: t('auth.sendFailed'), description: error.message || "", variant: "destructive" });
    } finally {
      setSendingCode(false);
    }
  };

  const handleVerifyAndRegister = async () => {
    const phoneNumber = getFullPhoneNumber();
    if (!verificationCode || verificationCode.length !== 6) {
      toast({ title: t('auth.invalidCode'), description: t('auth.invalidCodeDesc'), variant: "destructive" });
      return;
    }
    setVerifyingCode(true);
    try {
      await apiRequest('POST', '/api/auth/verify-code', { phoneNumber, code: verificationCode });

      const values = form.getValues();
      await apiRequest('POST', '/api/auth/register', {
        username: values.username,
        phoneNumber,
        password: values.password,
        authMethod: AUTH_METHODS.PHONE,
      });

      const meRes = await fetch('/api/auth/me', { credentials: 'include' });
      if (meRes.ok) {
        const userData = await meRes.json();
        setUser(userData);
      }

      setPhoneVerified(true);
      toast({ title: `✅ ${t('auth.successMsg')}` });
      setLocation(redirectTo);
    } catch (error: any) {
      if (error.message?.includes("already registered") || error.message?.includes("already exists")) {
        setPhoneAlreadyRegistered(true);
      } else {
        toast({ title: t('auth.sendFailed'), description: error.message || "", variant: "destructive" });
      }
    } finally {
      setVerifyingCode(false);
    }
  };

  return (
    <div className="container flex items-center justify-center min-h-screen py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-3xl font-bold text-center bg-gradient-to-r from-[#3bcac4] to-[#005476] bg-clip-text text-transparent">
            {t('auth.registerTitle')}
          </CardTitle>
          <CardDescription className="text-center">
            {t('auth.registerSubtitle')}
          </CardDescription>
        </CardHeader>

        <CardContent>
          <Form {...form}>
            <div className="space-y-4">

              {/* Username */}
              <FormField control={form.control} name="username" render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('auth.username')}</FormLabel>
                  <FormControl>
                    <Input placeholder="username" disabled={verificationSent} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              {/* Password */}
              <FormField control={form.control} name="password" render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('auth.password')}</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Input
                        type={showPassword ? "text" : "password"}
                        placeholder="••••••"
                        disabled={verificationSent}
                        {...field}
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                        onClick={() => setShowPassword(v => !v)}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              {/* Mobile Number */}
              <div className="space-y-2">
                <label className={`text-sm font-medium ${form.watch('password').length < 6 ? 'text-muted-foreground' : ''}`}>
                  {t('auth.phone')}
                </label>
                <div className="flex gap-2">
                  <CountryCodePicker
                    value={dialCode}
                    onChange={setDialCode}
                    disabled={verificationSent || form.watch('password').length < 6}
                  />
                  <Input
                    type="tel"
                    placeholder={form.watch('password').length < 6 ? t('auth.enterPasswordFirst') : "50 123 4567"}
                    value={localNumber}
                    onChange={(e) => setLocalNumber(e.target.value)}
                    disabled={verificationSent || form.watch('password').length < 6}
                    className="flex-1"
                  />
                </div>
              </div>

              {/* Privacy Policy Acceptance */}
              {!verificationSent && (
                <div
                  onClick={() => setPrivacyAccepted(v => !v)}
                  className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all select-none ${
                    privacyAccepted
                      ? 'border-[#3bcac4] bg-[#3bcac4]/5'
                      : 'border-gray-200 bg-gray-50 hover:border-gray-300'
                  }`}
                >
                  <div className={`mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                    privacyAccepted ? 'bg-[#3bcac4] border-[#3bcac4]' : 'bg-white border-gray-300'
                  }`}>
                    {privacyAccepted && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <div className="text-sm leading-relaxed">
                    <span className="font-medium text-gray-800 flex items-center gap-1.5 mb-0.5">
                      <ShieldCheck className="h-3.5 w-3.5 text-[#3bcac4]" />
                      {t('auth.privacyTitle')}
                    </span>
                    <span className="text-gray-500">
                      {t('auth.privacyText').split(t('auth.privacyPolicy'))[0]}
                      <a
                        href="/privacy-policy"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#005476] underline font-medium hover:text-[#3bcac4]"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {t('auth.privacyPolicy')}
                      </a>
                      {" "}{t('auth.privacyText').split(t('auth.privacyPolicy'))[1]?.split(t('auth.termsOfUse'))[0]}
                      <a
                        href="/terms"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#005476] underline font-medium hover:text-[#3bcac4]"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {t('auth.termsOfUse')}
                      </a>
                      {t('auth.privacyText').split(t('auth.termsOfUse'))[1] || ""}
                    </span>
                  </div>
                </div>
              )}

              {/* Send Code button */}
              {!verificationSent && (
                <Button
                  type="button"
                  className={`w-full transition-all ${
                    privacyAccepted
                      ? 'bg-gradient-to-r from-[#3bcac4] to-[#005476] hover:from-[#005476] hover:to-[#3bcac4]'
                      : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  }`}
                  onClick={handleSendCode}
                  disabled={sendingCode || !privacyAccepted}
                >
                  {sendingCode && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  {sendingCode ? t('auth.sending') : t('auth.sendCode')}
                </Button>
              )}

              {/* OTP input */}
              {verificationSent && !phoneVerified && (
                <div className="space-y-3">
                  <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${sentMethod === 'whatsapp' ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-700'}`}>
                    {sentMethod === 'whatsapp'
                      ? <><MessageCircle className="h-3.5 w-3.5 shrink-0" /> {t('auth.sentViaWhatsapp')}</>
                      : <><Smartphone className="h-3.5 w-3.5 shrink-0" /> {t('auth.sentViaSms')}</>
                    }
                  </div>

                  <div>
                    <label className="text-sm font-medium">{t('auth.verificationCode')}</label>
                    <Input
                      type="text"
                      inputMode="numeric"
                      placeholder="● ● ● ● ● ●"
                      value={verificationCode}
                      onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      maxLength={6}
                      className="mt-1 text-center text-xl tracking-widest"
                    />
                  </div>

                  <Button
                    type="button"
                    className="w-full bg-gradient-to-r from-[#3bcac4] to-[#005476] hover:from-[#005476] hover:to-[#3bcac4]"
                    onClick={handleVerifyAndRegister}
                    disabled={verifyingCode || verificationCode.length !== 6}
                  >
                    {verifyingCode && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                    {!verifyingCode && <CheckCircle className="h-4 w-4 mr-2" />}
                    {verifyingCode ? t('auth.verifying') : t('auth.verifyAndRegister')}
                  </Button>

                  <p className="text-xs text-muted-foreground text-center">
                    {t('auth.noCode')}{" "}
                    <button type="button" className="text-[#3bcac4] hover:underline" onClick={() => { setVerificationSent(false); setVerificationCode(''); }}>
                      {t('auth.changeData')}
                    </button>
                    {" · "}
                    <button type="button" className="text-[#3bcac4] hover:underline" onClick={handleSendCode} disabled={sendingCode}>
                      {t('auth.resend')}
                    </button>
                  </p>
                </div>
              )}

              {/* Phone already registered banner */}
              {phoneAlreadyRegistered && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3">
                  <p className="text-sm font-medium text-amber-800 text-center">
                    ⚠️ {t('auth.phoneAlreadyRegistered')}
                  </p>
                  <div className="flex flex-col gap-2">
                    <Button
                      type="button"
                      className="w-full bg-gradient-to-r from-[#3bcac4] to-[#005476]"
                      onClick={() => setLocation('/login')}
                    >
                      {t('auth.useLogin')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full border-[#3bcac4] text-[#3bcac4]"
                      onClick={() => setLocation('/forgot-password')}
                    >
                      {t('auth.forgotPassword')}
                    </Button>
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:underline text-center"
                      onClick={() => {
                        setPhoneAlreadyRegistered(false);
                        setVerificationSent(false);
                        setVerificationCode('');
                        setLocalNumber('');
                      }}
                    >
                      {t('auth.useDifferentNumber')}
                    </button>
                  </div>
                </div>
              )}

              {phoneVerified && (
                <div className="flex items-center justify-center gap-2 text-green-600 py-2">
                  <CheckCircle className="h-5 w-5" />
                  <span className="text-sm font-medium">{t('auth.successMsg')}</span>
                </div>
              )}

            </div>
          </Form>
        </CardContent>

        <CardFooter className="flex flex-col space-y-2">
          <div className="text-center text-sm">
            {t('auth.hasAccount')}{" "}
            <Link href="/login" className="text-[#3bcac4] hover:underline">{t('auth.login')}</Link>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
