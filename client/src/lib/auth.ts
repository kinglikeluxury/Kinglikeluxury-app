import { apiRequest } from "./queryClient";
import React, { useState, useEffect, createContext, useContext } from "react";
import { useToast } from "@/hooks/use-toast";

export type User = {
  id: number;
  username: string;
  email: string;
  isAdmin: boolean;
};

type AuthContextType = {
  user: User | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<User>;
  register: (username: string, password: string, email: string) => Promise<User>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  // Check if user is already logged in
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await fetch("/api/auth/me", {
          credentials: "include",
        });
        
        if (response.ok) {
          const user = await response.json();
          setUser(user);
        }
      } catch (error) {
        console.error("Authentication check failed:", error);
      } finally {
        setIsLoading(false);
      }
    };
    
    checkAuth();
  }, []);

  const login = async (username: string, password: string): Promise<User> => {
    setIsLoading(true);
    try {
      const response = await apiRequest("POST", "/api/auth/login", { username, password });
      const userData = await response.json();
      setUser(userData);
      toast({
        title: "Login successful",
        description: `Welcome back, ${userData.username}!`,
      });
      return userData;
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Login failed",
        description: error instanceof Error ? error.message : "Please check your credentials",
      });
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (username: string, password: string, email: string): Promise<User> => {
    setIsLoading(true);
    try {
      const response = await apiRequest("POST", "/api/auth/register", { 
        username, 
        password, 
        email 
      });
      const userData = await response.json();
      setUser(userData);
      toast({
        title: "Registration successful",
        description: `Welcome, ${userData.username}!`,
      });
      return userData;
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Registration failed",
        description: error instanceof Error ? error.message : "Please try again with different credentials",
      });
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async (): Promise<void> => {
    try {
      await apiRequest("POST", "/api/auth/logout");
      setUser(null);
      toast({
        title: "Logged out successfully",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Logout failed",
        description: "Please try again",
      });
      throw error;
    }
  };

  const value = {
    user,
    isLoading,
    login,
    register,
    logout,
  };

  // Fix the JSX syntax
  return React.createElement(AuthContext.Provider, { value }, children);
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
