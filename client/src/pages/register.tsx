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
import { AUTH_METHODS, insertUserSchema } from '@shared/schema';
import { apiRequest } from '@/lib/queryClient';
import { Link, useLocation } from 'wouter';
import { MailIcon, Phone, CheckCircle, Loader2 } from 'lucide-react';
import { CountryCodePicker } from '@/components/ui/country-code-picker';

const registerSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  authMethod: z.enum([AUTH_METHODS.EMAIL, AUTH_METHODS.PHONE]),
  email: z.string().optional(),
  password: z.string().optional(),
  phoneNumber: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.authMethod === AUTH_METHODS.EMAIL) {
    if (!data.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid email", path: ["email"] });
    }
    if (!data.password || data.password.length < 6) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Password must be at least 6 characters", path: ["password"] });
    }
  }
  if (data.authMethod === AUTH_METHODS.PHONE) {
    if (!data.phoneNumber || data.phoneNumber.length < 8) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid phone number", path: ["phoneNumber"] });
    }
    if (!data.password || data.password.length < 6) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Password must be at least 6 characters", path: ["password"] });
    }
  }
});

type RegisterFormValues = z.infer<typeof registerSchema>;

export default function RegisterPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<string>(AUTH_METHODS.EMAIL);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [sendingCode, setSendingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [dialCode, setDialCode] = useState('+971');
  const [localNumber, setLocalNumber] = useState('');
  
  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      username: '',
      authMethod: AUTH_METHODS.EMAIL,
      email: '',
      password: '',
      phoneNumber: '',
    },
  });
  
  const handleTabChange = (value: string) => {
    setActiveTab(value);
    form.setValue('authMethod', value as any);
    form.clearErrors();
    setPhoneVerified(false);
    setVerificationSent(false);
    setVerificationCode('');
    setLocalNumber('');
  };
  
  const getFullPhoneNumber = () => {
    const cleaned = localNumber.replace(/\s+/g, '');
    return `${dialCode}${cleaned}`;
  };

  const handleSendCode = async () => {
    if (!localNumber || localNumber.replace(/\s+/g, '').length < 4) {
      toast({ title: "Invalid phone number", description: "Please enter a valid phone number", variant: "destructive" });
      return;
    }
    const phoneNumber = getFullPhoneNumber();
    form.setValue('phoneNumber', phoneNumber);
    setSendingCode(true);
    try {
      await apiRequest('POST', '/api/auth/send-verification', { phoneNumber });
      setVerificationSent(true);
      toast({ title: "Code sent", description: "A verification code has been sent to your phone" });
    } catch (error: any) {
      toast({ title: "Failed to send code", description: error.message || "Please try again", variant: "destructive" });
    } finally {
      setSendingCode(false);
    }
  };

  const handleVerifyCode = async () => {
    const phoneNumber = getFullPhoneNumber();
    if (!verificationCode || verificationCode.length !== 6) {
      toast({ title: "Invalid code", description: "Please enter the 6-digit verification code", variant: "destructive" });
      return;
    }
    setVerifyingCode(true);
    try {
      await apiRequest('POST', '/api/auth/verify-code', { phoneNumber, code: verificationCode });
      setPhoneVerified(true);
      toast({ title: "Phone verified", description: "Your phone number has been verified successfully" });
    } catch (error: any) {
      toast({ title: "Verification failed", description: error.message || "Invalid or expired code", variant: "destructive" });
    } finally {
      setVerifyingCode(false);
    }
  };
  
  const onSubmit = async (data: RegisterFormValues) => {
    try {
      if (data.authMethod === AUTH_METHODS.PHONE && !phoneVerified) {
        toast({ title: "Phone not verified", description: "Please verify your phone number before registering", variant: "destructive" });
        return;
      }

      if (data.authMethod === AUTH_METHODS.EMAIL) {
        await apiRequest('POST', '/api/auth/register', {
          username: data.username,
          email: data.email,
          password: data.password,
          authMethod: AUTH_METHODS.EMAIL,
        });
      } else if (data.authMethod === AUTH_METHODS.PHONE) {
        await apiRequest('POST', '/api/auth/register', {
          username: data.username,
          phoneNumber: getFullPhoneNumber(),
          password: data.password,
          authMethod: AUTH_METHODS.PHONE,
        });
      }
      
      toast({
        title: "Registration successful",
        description: "You can now log in with your credentials",
      });
      setLocation('/login');
    } catch (error: any) {
      toast({
        title: "Registration failed",
        description: error.message || "Please try again later",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="container flex items-center justify-center min-h-screen py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-3xl font-bold text-center bg-gradient-to-r from-[#3bcac4] to-[#005476] bg-clip-text text-transparent">Create Account</CardTitle>
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
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="username"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Username</FormLabel>
                        <FormControl>
                          <Input placeholder="username" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  {activeTab === AUTH_METHODS.EMAIL && (
                    <>
                      <FormField
                        control={form.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Email</FormLabel>
                            <FormControl>
                              <Input type="email" placeholder="email@example.com" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="password"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Password</FormLabel>
                            <FormControl>
                              <Input type="password" placeholder="******" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </>
                  )}
                  
                  {activeTab === AUTH_METHODS.PHONE && (
                    <>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Mobile Number</label>
                        <div className="flex gap-2">
                          <CountryCodePicker
                            value={dialCode}
                            onChange={setDialCode}
                            disabled={phoneVerified}
                          />
                          <Input 
                            type="tel" 
                            placeholder="50 123 4567"
                            value={localNumber}
                            onChange={(e) => {
                              setLocalNumber(e.target.value);
                              form.setValue('phoneNumber', `${dialCode}${e.target.value.replace(/\s+/g, '')}`);
                            }}
                            disabled={phoneVerified}
                            className="flex-1"
                          />
                          {!phoneVerified && (
                            <Button 
                              type="button" 
                              variant="outline"
                              className="shrink-0 border-[#3bcac4] text-[#3bcac4] hover:bg-[#3bcac4] hover:text-white"
                              onClick={handleSendCode}
                              disabled={sendingCode}
                            >
                              {sendingCode ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send Code"}
                            </Button>
                          )}
                          {phoneVerified && (
                            <div className="flex items-center text-green-600 shrink-0">
                              <CheckCircle className="h-5 w-5" />
                            </div>
                          )}
                        </div>
                      </div>

                      {verificationSent && !phoneVerified && (
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Verification Code</label>
                          <div className="flex gap-2">
                            <Input
                              type="text"
                              placeholder="Enter 6-digit code"
                              value={verificationCode}
                              onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                              maxLength={6}
                            />
                            <Button 
                              type="button" 
                              className="shrink-0 bg-gradient-to-r from-[#3bcac4] to-[#005476]"
                              onClick={handleVerifyCode}
                              disabled={verifyingCode}
                            >
                              {verifyingCode ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify"}
                            </Button>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Didn't receive the code?{" "}
                            <button 
                              type="button" 
                              className="text-[#3bcac4] hover:underline"
                              onClick={handleSendCode}
                              disabled={sendingCode}
                            >
                              Resend
                            </button>
                          </p>
                        </div>
                      )}

                      <FormField
                        control={form.control}
                        name="password"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Password</FormLabel>
                            <FormControl>
                              <Input type="password" placeholder="******" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </>
                  )}
                  
                  <Button 
                    type="submit" 
                    className="w-full bg-gradient-to-r from-[#3bcac4] to-[#005476] hover:from-[#005476] hover:to-[#3bcac4]"
                    disabled={activeTab === AUTH_METHODS.PHONE && !phoneVerified}
                  >
                    Sign Up
                  </Button>
                </form>
              </Form>
          </CardContent>
        </Tabs>
        
        <CardFooter className="flex flex-col space-y-2">
          <div className="text-center text-sm">
            Already have an account?{" "}
            <Link href="/login" className="text-[#3bcac4] hover:underline">
              Log in
            </Link>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}