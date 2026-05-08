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
import { CheckCircle, Loader2, MessageCircle, Smartphone, Eye, EyeOff } from 'lucide-react';
import { CountryCodePicker } from '@/components/ui/country-code-picker';

const phoneSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

type PhoneFormValues = z.infer<typeof phoneSchema>;

export default function RegisterPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [phoneVerified, setPhoneVerified] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [sendingCode, setSendingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [sentMethod, setSentMethod] = useState<'whatsapp' | 'sms' | null>(null);
  const [dialCode, setDialCode] = useState('+971');
  const [localNumber, setLocalNumber] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm<PhoneFormValues>({
    resolver: zodResolver(phoneSchema),
    defaultValues: { username: '', password: '' },
  });

  const getFullPhoneNumber = () => `${dialCode}${localNumber.replace(/\s+/g, '')}`;

  const handleSendCode = async () => {
    const valid = await form.trigger(['username', 'password']);
    if (!valid) return;

    if (!localNumber || localNumber.replace(/\s+/g, '').length < 4) {
      toast({ title: "رقم غير صحيح", description: "أدخل رقم هاتف صحيح", variant: "destructive" });
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
        title: data.method === 'whatsapp' ? "✅ تم الإرسال عبر WhatsApp" : "✅ تم الإرسال عبر SMS",
        description: `أدخل الرمز المرسل إلى ${phoneNumber}`,
      });
    } catch (error: any) {
      toast({ title: "فشل الإرسال", description: error.message || "حاول مجدداً", variant: "destructive" });
    } finally {
      setSendingCode(false);
    }
  };

  const handleVerifyAndRegister = async () => {
    const phoneNumber = getFullPhoneNumber();
    if (!verificationCode || verificationCode.length !== 6) {
      toast({ title: "رمز غير صحيح", description: "أدخل الرمز المكون من 6 أرقام", variant: "destructive" });
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

      setPhoneVerified(true);
      toast({ title: "✅ تم التسجيل بنجاح", description: "يمكنك الآن تسجيل الدخول" });
      setLocation('/login');
    } catch (error: any) {
      toast({ title: "فشل التحقق أو التسجيل", description: error.message || "حاول مجدداً", variant: "destructive" });
    } finally {
      setVerifyingCode(false);
    }
  };

  return (
    <div className="container flex items-center justify-center min-h-screen py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-3xl font-bold text-center bg-gradient-to-r from-[#3bcac4] to-[#005476] bg-clip-text text-transparent">
            إنشاء حساب
          </CardTitle>
          <CardDescription className="text-center">
            انضم إلى Kinglike Luxury واكتشف أفضل العقارات الفاخرة
          </CardDescription>
        </CardHeader>

        <CardContent>
          <Form {...form}>
            <div className="space-y-4">

              {/* Username */}
              <FormField control={form.control} name="username" render={({ field }) => (
                <FormItem>
                  <FormLabel>اسم المستخدم</FormLabel>
                  <FormControl>
                    <Input placeholder="username" disabled={verificationSent} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              {/* Mobile Number */}
              <div className="space-y-2">
                <label className="text-sm font-medium">رقم الهاتف</label>
                <div className="flex gap-2">
                  <CountryCodePicker value={dialCode} onChange={setDialCode} disabled={verificationSent} />
                  <Input
                    type="tel"
                    placeholder="50 123 4567"
                    value={localNumber}
                    onChange={(e) => setLocalNumber(e.target.value)}
                    disabled={verificationSent}
                    className="flex-1"
                  />
                </div>
              </div>

              {/* Password */}
              <FormField control={form.control} name="password" render={({ field }) => (
                <FormItem>
                  <FormLabel>كلمة السر</FormLabel>
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

              {/* Send Code button */}
              {!verificationSent && (
                <Button
                  type="button"
                  className="w-full bg-gradient-to-r from-[#3bcac4] to-[#005476] hover:from-[#005476] hover:to-[#3bcac4]"
                  onClick={handleSendCode}
                  disabled={sendingCode}
                >
                  {sendingCode && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  {sendingCode ? "جاري الإرسال..." : "إرسال رمز التحقق"}
                </Button>
              )}

              {/* OTP input */}
              {verificationSent && !phoneVerified && (
                <div className="space-y-3">
                  <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${sentMethod === 'whatsapp' ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-700'}`}>
                    {sentMethod === 'whatsapp'
                      ? <><MessageCircle className="h-3.5 w-3.5 shrink-0" /> تم إرسال الرمز عبر <strong>WhatsApp</strong></>
                      : <><Smartphone className="h-3.5 w-3.5 shrink-0" /> تم إرسال الرمز عبر <strong>SMS</strong></>
                    }
                  </div>

                  <div>
                    <label className="text-sm font-medium">رمز التحقق</label>
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
                    {verifyingCode ? "جاري التحقق والتسجيل..." : "تحقق وأكمل التسجيل"}
                  </Button>

                  <p className="text-xs text-muted-foreground text-center">
                    لم يصلك الرمز؟{" "}
                    <button type="button" className="text-[#3bcac4] hover:underline" onClick={() => { setVerificationSent(false); setVerificationCode(''); }}>
                      تغيير البيانات
                    </button>
                    {" · "}
                    <button type="button" className="text-[#3bcac4] hover:underline" onClick={handleSendCode} disabled={sendingCode}>
                      إعادة الإرسال
                    </button>
                  </p>
                </div>
              )}

              {phoneVerified && (
                <div className="flex items-center justify-center gap-2 text-green-600 py-2">
                  <CheckCircle className="h-5 w-5" />
                  <span className="text-sm font-medium">تم التسجيل بنجاح!</span>
                </div>
              )}

            </div>
          </Form>
        </CardContent>

        <CardFooter className="flex flex-col space-y-2">
          <div className="text-center text-sm">
            لديك حساب بالفعل؟{" "}
            <Link href="/login" className="text-[#3bcac4] hover:underline">تسجيل الدخول</Link>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
