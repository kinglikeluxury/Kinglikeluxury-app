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
import { MailIcon, Phone } from 'lucide-react';

const registerSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  authMethod: z.enum([AUTH_METHODS.EMAIL, AUTH_METHODS.PHONE]),
  email: z.string().email().optional(),
  password: z.string().min(6, "Password must be at least 6 characters").optional(),
  phoneNumber: z.string().min(8, "Enter a valid phone number").optional(),
});

type RegisterFormValues = z.infer<typeof registerSchema>;

export default function RegisterPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<string>(AUTH_METHODS.EMAIL);
  
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
  };
  
  
  const onSubmit = async (data: RegisterFormValues) => {
    try {
      if (data.authMethod === AUTH_METHODS.EMAIL) {
        await apiRequest('POST', '/api/auth/register', {
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
      else if (data.authMethod === AUTH_METHODS.PHONE) {
        await apiRequest('POST', '/api/auth/register', {
          username: data.username,
          phoneNumber: data.phoneNumber,
          password: data.password,
          authMethod: AUTH_METHODS.PHONE,
        });
        
        toast({
          title: "Registration successful",
          description: "You can now log in with your phone number and password",
        });
        
        setLocation('/login');
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
          <TabsList className="grid grid-cols-2 mb-4 mx-4">
            <TabsTrigger value={AUTH_METHODS.EMAIL}>
              <MailIcon className="h-4 w-4 mr-2" />
              Email
            </TabsTrigger>
            <TabsTrigger value={AUTH_METHODS.PHONE}>
              <Phone className="h-4 w-4 mr-2" />
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
                    <FormField
                      control={form.control}
                      name="phoneNumber"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Mobile Number</FormLabel>
                          <FormControl>
                            <Input type="tel" placeholder="+971 50 123 4567" {...field} />
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
                
                <Button type="submit" className="w-full bg-gradient-to-r from-[#3bcac4] to-[#005476] hover:from-[#005476] hover:to-[#3bcac4]">
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