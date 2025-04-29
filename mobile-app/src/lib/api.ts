import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Replace with your actual API URL when in production
const API_URL = 'https://kinglike-luxury.replit.app/api';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add a request interceptor to include auth token in requests
api.interceptors.request.use(
  async (config) => {
    const token = await AsyncStorage.getItem('auth_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Authentication API calls
export const login = async (username: string, password: string) => {
  const response = await api.post('/login', { username, password });
  return response.data;
};

export const register = async (userData: {
  username: string;
  password: string;
  email: string;
}) => {
  const response = await api.post('/register', userData);
  return response.data;
};

export const logout = async () => {
  await api.post('/logout');
  await AsyncStorage.removeItem('auth_token');
};

export const getCurrentUser = async () => {
  try {
    const response = await api.get('/user');
    return response.data;
  } catch (error) {
    return null;
  }
};

// Properties API calls
export const getProperties = async (filters = {}) => {
  const response = await api.get('/properties', { params: filters });
  return response.data;
};

export const getProperty = async (id: number) => {
  const response = await api.get(`/properties/${id}`);
  return response.data;
};

export const createProperty = async (propertyData: any) => {
  const response = await api.post('/properties', propertyData);
  return response.data;
};

// Projects API calls
export const getProjects = async () => {
  const response = await api.get('/projects');
  return response.data;
};

export const getProject = async (id: number) => {
  const response = await api.get(`/projects/${id}`);
  return response.data;
};

// Blog API calls
export const getBlogPosts = async (filters = {}) => {
  const response = await api.get('/blog', { params: filters });
  return response.data;
};

export default api;