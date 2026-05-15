import axios from 'axios';
import { API_URL } from '../config/api.config';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000,
});

export const getProperties = async (filters = {}) => {
  try {
    const response = await api.get('/properties', { params: filters });
    return response.data;
  } catch (error) {
    console.error('Error fetching properties:', error);
    throw error;
  }
};

export const getProperty = async (id: number) => {
  try {
    const response = await api.get(`/properties/${id}`);
    return response.data;
  } catch (error) {
    console.error(`Error fetching property ${id}:`, error);
    throw error;
  }
};

export const getProjects = async () => {
  try {
    const response = await api.get('/projects');
    return response.data;
  } catch (error) {
    console.error('Error fetching projects:', error);
    throw error;
  }
};

export const getProject = async (id: number) => {
  try {
    const response = await api.get(`/projects/${id}`);
    return response.data;
  } catch (error) {
    console.error(`Error fetching project ${id}:`, error);
    throw error;
  }
};

export const login = async (username: string, password: string) => {
  try {
    const response = await api.post('/auth/login', { username, password });
    return response.data;
  } catch (error) {
    console.error('Login error:', error);
    throw error;
  }
};

export const loginWithPhone = async (phoneNumber: string, password: string) => {
  try {
    const response = await api.post('/auth/login', { phoneNumber, password });
    return response.data;
  } catch (error) {
    console.error('Phone login error:', error);
    throw error;
  }
};

export const loginWithFacebook = async () => {
  try {
    const response = await api.get('/auth/facebook');
    return response.data;
  } catch (error) {
    console.error('Facebook login error:', error);
    throw error;
  }
};

export const register = async (userData: {
  username: string;
  password: string;
  email?: string;
  phoneNumber?: string;
  whatsappNumber?: string;
}) => {
  try {
    const response = await api.post('/auth/register', userData);
    return response.data;
  } catch (error) {
    console.error('Registration error:', error);
    throw error;
  }
};

export const logout = async () => {
  try {
    await api.post('/auth/logout');
    return true;
  } catch (error) {
    console.error('Logout error:', error);
    throw error;
  }
};

export const sendVerificationCode = async (phoneNumber: string) => {
  try {
    const response = await api.post('/auth/send-verification', { phoneNumber });
    return response.data;
  } catch (error) {
    console.error('Send verification error:', error);
    throw error;
  }
};

export const verifyPhoneCode = async (phoneNumber: string, code: string) => {
  try {
    const response = await api.post('/auth/verify-code', { phoneNumber, code });
    return response.data;
  } catch (error) {
    console.error('Verify code error:', error);
    throw error;
  }
};

export const getCurrentUser = async () => {
  try {
    const response = await api.get('/auth/me');
    return response.data;
  } catch (error) {
    console.error('Error fetching user:', error);
    throw error;
  }
};

export const getBlogPosts = async (filters = {}) => {
  try {
    const response = await api.get('/blog', { params: filters });
    return response.data;
  } catch (error) {
    console.error('Error fetching blog posts:', error);
    throw error;
  }
};

export const getBlogPost = async (id: number) => {
  try {
    const response = await api.get(`/blog/${id}`);
    return response.data;
  } catch (error) {
    console.error(`Error fetching blog post ${id}:`, error);
    throw error;
  }
};

export const submitProperty = async (propertyData: any) => {
  try {
    const response = await api.post('/properties', propertyData);
    return response.data;
  } catch (error) {
    console.error('Error submitting property:', error);
    throw error;
  }
};

export const updatePropertyStatus = async (id: number, status: string) => {
  try {
    const response = await api.patch(`/properties/${id}/status`, { status });
    return response.data;
  } catch (error) {
    console.error('Error updating property status:', error);
    throw error;
  }
};

export const submitProject = async (projectData: any) => {
  try {
    const response = await api.post('/projects', projectData);
    return response.data;
  } catch (error) {
    console.error('Error submitting project:', error);
    throw error;
  }
};

export const createPaymentIntent = async (paymentData: {
  amount: number;
  listingType: string;
  propertyType: string;
}) => {
  try {
    const response = await api.post('/payments/create-intent', paymentData);
    return response.data;
  } catch (error) {
    console.error('Error creating payment intent:', error);
    throw error;
  }
};

export const getAdminStats = async () => {
  try {
    const response = await api.get('/admin/stats');
    return response.data;
  } catch (error) {
    console.error('Error fetching admin stats:', error);
    throw error;
  }
};

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      console.log('User is not authenticated');
    }
    return Promise.reject(error);
  }
);

export default api;
