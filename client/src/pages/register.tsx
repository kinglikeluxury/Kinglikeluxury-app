import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { z } from 'zod';
import { AUTH_METHODS, insertUserSchema } from '@shared/schema';
import { apiRequest } from '@/lib/queryClient';
import { Link, useLocation } from 'wouter';
import { FacebookIcon, MailIcon, Phone, MessageCircle } from 'lucide-react';

// Create a simplified version of the schema for the client-side
const registerSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  authMethod: z.enum([AUTH_METHODS.EMAIL, AUTH_METHODS.PHONE, AUTH_METHODS.WHATSAPP, AUTH_METHODS.FACEBOOK]),
  email: z.string().email().optional(),
  password: z.string().min(6, "Password must be at least 6 characters").optional(),
  phoneNumber: z.string().optional(),
  whatsappNumber: z.string().optional(),
  confirmationCode: z.string().optional(),
});

type RegisterFormValues = z.infer<typeof registerSchema>;

export default function RegisterPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<string>(AUTH_METHODS.EMAIL);
  const [showVerificationInput, setShowVerificationInput] = useState(false);
  
  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      username: '',
      authMethod: AUTH_METHODS.EMAIL,
      email: '',
      password: '',
      phoneNumber: '',
      whatsappNumber: '',
    },
  });
  
  // When tab changes, update the auth method
  const handleTabChange = (value: string) => {
    setActiveTab(value);
    form.setValue('authMethod', value as any);
    setShowVerificationInput(false);
  };
  
  const sendVerificationCode = async () => {
    const authMethod = form.getValues('authMethod');
    
    try {
      // This would normally make an API request to send a verification code
      // Since we don't have the actual APIs set up, we'll mock this for now
      
      if (authMethod === AUTH_METHODS.PHONE) {
        const phoneNumber = form.getValues('phoneNumber');
        if (!phoneNumber) {
          toast({ 
            title: "Phone number required",
            description: "Please enter your phone number to receive the verification code",
            variant: "destructive" 
          });
          return;
        }
        
        toast({
          title: "Verification code sent",
          description: "We've sent a verification code to your phone number",
        });
      } else if (authMethod === AUTH_METHODS.WHATSAPP) {
        const whatsappNumber = form.getValues('whatsappNumber');
        if (!whatsappNumber) {
          toast({ 
            title: "WhatsApp number required",
            description: "Please enter your WhatsApp number to receive the verification code",
            variant: "destructive" 
          });
          return;
        }
        
        toast({
          title: "Verification code sent",
          description: "We've sent a verification code to your WhatsApp",
        });
      }
      
      setShowVerificationInput(true);
    } catch (error) {
      toast({
        title: "Failed to send verification code",
        description: "Please try again later",
        variant: "destructive",
      });
    }
  };
  
  const onSubmit = async (data: RegisterFormValues) => {
    try {
      // For email registration
      if (data.authMethod === AUTH_METHODS.EMAIL) {
        await apiRequest('POST', '/api/register', {
          username: data.username,
          email: data.email,
          password: data.password,
          authMethod: AUTH_METHODS.EMAIL,
        });
        
        toast({
          title: "Registration successful",
          description: "You can now log in with your email and password",
        });
        
        setLocation('/login');
      } 
      // For phone registration
      else if (data.authMethod === AUTH_METHODS.PHONE) {
        // In a real app, we would verify the confirmation code here
        // And then register the user if the code is valid
        
        await apiRequest('POST', '/api/register', {
          username: data.username,
          phoneNumber: data.phoneNumber,
          authMethod: AUTH_METHODS.PHONE,
        });
        
        toast({
          title: "Registration successful",
          description: "You can now log in with your phone number",
        });
        
        setLocation('/login');
      }
      // For WhatsApp registration
      else if (data.authMethod === AUTH_METHODS.WHATSAPP) {
        // In a real app, we would verify the confirmation code here
        // And then register the user if the code is valid
        
        await apiRequest('POST', '/api/register', {
          username: data.username,
          whatsappNumber: data.whatsappNumber,
          authMethod: AUTH_METHODS.WHATSAPP,
        });
        
        toast({
          title: "Registration successful",
          description: "You can now log in with your WhatsApp number",
        });
        
        setLocation('/login');
      }
      // For Facebook registration
      else if (data.authMethod === AUTH_METHODS.FACEBOOK) {
        // In a real app, this would redirect to Facebook OAuth
        // Instead, we'll just show a message about it being a demo
        
        toast({
          title: "Facebook login demo",
          description: "In a production app, this would connect to Facebook OAuth",
        });
      }
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
          <TabsList className="grid grid-cols-4 mb-4 mx-4">
            <TabsTrigger value={AUTH_METHODS.EMAIL}>
              <MailIcon className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Email</span>
            </TabsTrigger>
            <TabsTrigger value={AUTH_METHODS.PHONE}>
              <Phone className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">SMS</span>
            </TabsTrigger>
            <TabsTrigger value={AUTH_METHODS.WHATSAPP}>
              <MessageCircle className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">WhatsApp</span>
            </TabsTrigger>
            <TabsTrigger value={AUTH_METHODS.FACEBOOK}>
              <FacebookIcon className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Facebook</span>
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
                
                {/* Email Tab Content */}
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
                
                {/* Phone Tab Content */}
                {activeTab === AUTH_METHODS.PHONE && (
                  <>
                    <FormField
                      control={form.control}
                      name="phoneNumber"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Phone Number</FormLabel>
                          <FormControl>
                            <Input type="tel" placeholder="+1234567890" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    
                    {!showVerificationInput ? (
                      <Button 
                        type="button" 
                        variant="outline" 
                        className="w-full"
                        onClick={sendVerificationCode}
                      >
                        Send Verification Code
                      </Button>
                    ) : (
                      <FormField
                        control={form.control}
                        name="confirmationCode"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Verification Code</FormLabel>
                            <FormControl>
                              <Input placeholder="Enter code" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}
                  </>
                )}
                
                {/* WhatsApp Tab Content */}
                {activeTab === AUTH_METHODS.WHATSAPP && (
                  <>
                    <FormField
                      control={form.control}
                      name="whatsappNumber"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>WhatsApp Number</FormLabel>
                          <FormControl>
                            <Input type="tel" placeholder="+1234567890" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    
                    {!showVerificationInput ? (
                      <Button 
                        type="button" 
                        variant="outline" 
                        className="w-full"
                        onClick={sendVerificationCode}
                      >
                        Send WhatsApp Code
                      </Button>
                    ) : (
                      <FormField
                        control={form.control}
                        name="confirmationCode"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Verification Code</FormLabel>
                            <FormControl>
                              <Input placeholder="Enter code" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}
                  </>
                )}
                
                {/* Facebook Tab Content */}
                {activeTab === AUTH_METHODS.FACEBOOK && (
                  <div className="flex flex-col items-center py-4 space-y-4">
                    <p className="text-center text-sm text-muted-foreground">
                      Click the button below to sign up with your Facebook account
                    </p>
                    <Button 
                      type="button" 
                      className="w-full bg-[#1877F2] hover:bg-[#166FE5]"
                      onClick={() => form.handleSubmit(onSubmit)()}
                    >
                      <FacebookIcon className="h-5 w-5 mr-2" />
                      Continue with Facebook
                    </Button>
                  </div>
                )}
                
                {(activeTab === AUTH_METHODS.EMAIL || 
                 (activeTab === AUTH_METHODS.PHONE && showVerificationInput) || 
                 (activeTab === AUTH_METHODS.WHATSAPP && showVerificationInput)) && (
                  <Button type="submit" className="w-full bg-gradient-to-r from-[#3bcac4] to-[#005476] hover:from-[#005476] hover:to-[#3bcac4]">
                    Sign Up
                  </Button>
                )}
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