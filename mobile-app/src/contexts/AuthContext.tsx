import { createContext, useState, useContext, useEffect, ReactNode } from 'react';
import { login as apiLogin, register as apiRegister, logout as apiLogout, getCurrentUser, loginWithPhone as apiLoginWithPhone, loginWithFacebook as apiLoginWithFacebook } from '../lib/api';

export interface User {
  id: number;
  username: string;
  email?: string;
  phoneNumber?: string;
  whatsappNumber?: string;
  facebookId?: string;
  authMethod: string;
  isAdmin: boolean;
  isVerified: boolean;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  loginWithPhone: (phoneNumber: string, password: string) => Promise<void>;
  loginWithFacebook: () => Promise<void>;
  register: (userData: {
    username: string;
    password: string;
    email?: string;
    phoneNumber?: string;
    whatsappNumber?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      setLoading(true);
      const currentUser = await getCurrentUser();
      setUser(currentUser);
    } catch (error) {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const login = async (username: string, password: string) => {
    const userData = await apiLogin(username, password);
    setUser(userData);
  };

  const loginWithPhone = async (phoneNumber: string, password: string) => {
    const userData = await apiLoginWithPhone(phoneNumber, password);
    setUser(userData);
  };

  const loginWithFacebook = async () => {
    const userData = await apiLoginWithFacebook();
    setUser(userData);
  };

  const register = async (userData: {
    username: string;
    password: string;
    email?: string;
    phoneNumber?: string;
    whatsappNumber?: string;
  }) => {
    const newUser = await apiRegister(userData);
    setUser(newUser);
  };

  const logout = async () => {
    try {
      await apiLogout();
      setUser(null);
    } catch (error) {
      console.error('Logout error:', error);
      setUser(null);
    }
  };

  const refreshUser = async () => {
    try {
      const currentUser = await getCurrentUser();
      setUser(currentUser);
    } catch (error) {
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        loginWithPhone,
        loginWithFacebook,
        register,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
