import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { z } from 'zod';
import { AUTH_METHODS } from '@shared/schema';
import { apiRequest } from '@/lib/queryClient';
import { Link, useLocation } from 'wouter';
import { MailIcon, Phone, CheckCircle, Loader2, MessageCircle, Smartphone, Eye, EyeOff } from 'lucide-react';
import { CountryCodePicker } from '@/components/ui/country-code-picker';

const emailSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  email: z.string().email("Enter a valid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

const phoneSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

type EmailFormValues = z.infer<typeof emailSchema>;
type PhoneFormValues = z.infer<typeof phoneSchema>;

export default function RegisterPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<string>(AUTH_METHODS.EMAIL);

  // Phone flow state
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [sendingCode, setSendingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [sentMethod, setSentMethod] = useState<'whatsapp' | 'sms' | null>(null);
  const [dialCode, setDialCode] = useState('+971');
  const [localNumber, setLocalNumber] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordEmail, setShowPasswordEmail] = useState(false);

  const emailForm = useForm<EmailFormValues>({
    resolver: zodResolver(emailSchema),
    defaultValues: { username: '', email: '', password: '' },
  });

  const phoneForm = useForm<PhoneFormValues>({
    resolver: zodResolver(phoneSchema),
    defaultValues: { username: '', password: '' },
  });

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    setPhoneVerified(false);
    setVerificationSent(false);
    setVerificationCode('');
    setLocalNumber('');
    setSentMethod(null);
  };

  const getFullPhoneNumber = () => `${dialCode}${localNumber.replace(/\s+/g, '')}`;

  const handleSendCode = async () => {
    // Validate phone form fields first
    const valid = await phoneForm.trigger(['username', 'password']);
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
      const isWhatsApp = data.method === 'whatsapp';
      toast({
        title: isWhatsApp ? "✅ تم الإرسال عبر WhatsApp" : "✅ تم الإرسال عبر SMS",
        description: isWhatsApp
          ? `افتح WhatsApp على ${phoneNumber} وأدخل الرمز`
          : `تحقق من رسائلك النصية على ${phoneNumber}`,
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
      // Step 1: Verify code
      await apiRequest('POST', '/api/auth/verify-code', { phoneNumber, code: verificationCode });

      // Step 2: Auto-register immediately
      const values = phoneForm.getValues();
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

  const onEmailSubmit = async (data: EmailFormValues) => {
    try {
      await apiRequest('POST', '/api/auth/register', {
        username: data.username,
        email: data.email,
        password: data.password,
        authMethod: AUTH_METHODS.EMAIL,
      });
      toast({ title: "Registration successful", description: "You can now log in" });
      setLocation('/login');
    } catch (error: any) {
      toast({ title: "Registration failed", description: error.message || "Please try again", variant: "destructive" });
    }
  };

  return (
    <div className="container flex items-center justify-center min-h-screen py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-3xl font-bold text-center bg-gradient-to-r from-[#3bcac4] to-[#005476] bg-clip-text text-transparent">
            Create Account
          </CardTitle>
          <CardDescription className="text-center">
            Join Kinglike Luxury and start exploring premium properties
          </CardDescription>
        </CardHeader>

        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList className="grid grid-cols-2 mb-4 mx-4">
            <TabsTrigger value={AUTH_METHODS.EMAIL}>
              <MailIcon className="h-4 w-4 mr-1" />
              Email
            </TabsTrigger>
            <TabsTrigger value={AUTH_METHODS.PHONE}>
              <Phone className="h-4 w-4 mr-1" />
              Mobile
            </TabsTrigger>
          </TabsList>

          <CardContent>
            {/* ── EMAIL TAB ── */}
            <TabsContent value={AUTH_METHODS.EMAIL}>
              <Form {...emailForm}>
                <form onSubmit={emailForm.handleSubmit(onEmailSubmit)} className="space-y-4">
                  <FormField control={emailForm.control} name="username" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Username</FormLabel>
                      <FormControl><Input placeholder="username" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={emailForm.control} name="email" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl><Input type="email" placeholder="email@example.com" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={emailForm.control} name="password" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input type={showPasswordEmail ? "text" : "password"} placeholder="••••••" {...field} />
                          <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setShowPasswordEmail(v => !v)}>
                            {showPasswordEmail ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <Button type="submit" className="w-full bg-gradient-to-r from-[#3bcac4] to-[#005476] hover:from-[#005476] hover:to-[#3bcac4]">
                    Sign Up
                  </Button>
                </form>
              </Form>
            </TabsContent>

            {/* ── PHONE TAB ── */}
            <TabsContent value={AUTH_METHODS.PHONE}>
              <Form {...phoneForm}>
                <div className="space-y-4">
                  {/* Username */}
                  <FormField control={phoneForm.control} name="username" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Username</FormLabel>
                      <FormControl><Input placeholder="username" disabled={verificationSent} {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  {/* Mobile Number */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Mobile Number</label>
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

                  {/* Password — shown before sending code */}
                  <FormField control={phoneForm.control} name="password" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input type={showPassword ? "text" : "password"} placeholder="••••••" disabled={verificationSent} {...field} />
                          <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setShowPassword(v => !v)}>
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
                      {sendingCode ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      {sendingCode ? "جاري الإرسال..." : "إرسال رمز التحقق"}
                    </Button>
                  )}

                  {/* Verification code input */}
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
                        <div className="flex gap-2 mt-1">
                          <Input
                            type="text"
                            inputMode="numeric"
                            placeholder="أدخل الرمز المكون من 6 أرقام"
                            value={verificationCode}
                            onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                            maxLength={6}
                            className="flex-1 text-center text-lg tracking-widest"
                          />
                        </div>
                      </div>

                      <Button
                        type="button"
                        className="w-full bg-gradient-to-r from-[#3bcac4] to-[#005476] hover:from-[#005476] hover:to-[#3bcac4]"
                        onClick={handleVerifyAndRegister}
                        disabled={verifyingCode || verificationCode.length !== 6}
                      >
                        {verifyingCode ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
                        {verifyingCode ? "جاري التحقق والتسجيل..." : "تحقق وأكمل التسجيل"}
                      </Button>

                      <p className="text-xs text-muted-foreground text-center">
                        لم يصلك الرمز؟{" "}
                        <button type="button" className="text-[#3bcac4] hover:underline" onClick={() => { setVerificationSent(false); setVerificationCode(''); }} disabled={sendingCode}>
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
            </TabsContent>
          </CardContent>
        </Tabs>

        <CardFooter className="flex flex-col space-y-2">
          <div className="text-center text-sm">
            Already have an account?{" "}
            <Link href="/login" className="text-[#3bcac4] hover:underline">Log in</Link>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
