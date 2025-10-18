import axios from 'axios';
import { API_URL } from '../config/api.config';

// Create an axios instance
const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000, // 10 seconds
});

// Get properties with optional filters
export const getProperties = async (filters = {}) => {
  try {
    const response = await api.get('/properties', { params: filters });
    return response.data;
  } catch (error) {
    console.error('Error fetching properties:', error);
    throw error;
  }
};

// Get a single property by ID
export const getProperty = async (id: number) => {
  try {
    const response = await api.get(`/properties/${id}`);
    return response.data;
  } catch (error) {
    console.error(`Error fetching property ${id}:`, error);
    throw error;
  }
};

// Get projects
export const getProjects = async () => {
  try {
    const response = await api.get('/projects');
    return response.data;
  } catch (error) {
    console.error('Error fetching projects:', error);
    throw error;
  }
};

// Get a single project by ID
export const getProject = async (id: number) => {
  try {
    const response = await api.get(`/projects/${id}`);
    return response.data;
  } catch (error) {
    console.error(`Error fetching project ${id}:`, error);
    throw error;
  }
};

// Authentication functions
export const login = async (username: string, password: string) => {
  try {
    const response = await api.post('/auth/login', { username, password });
    return response.data;
  } catch (error) {
    console.error('Login error:', error);
    throw error;
  }
};

export const register = async (userData: {
  username: string;
  password: string;
  email: string;
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

export const getCurrentUser = async () => {
  try {
    const response = await api.get('/auth/me');
    return response.data;
  } catch (error) {
    console.error('Error fetching user:', error);
    throw error;
  }
};

// Blog posts
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

// Submit property
export const submitProperty = async (propertyData: any) => {
  try {
    const response = await api.post('/properties', propertyData);
    return response.data;
  } catch (error) {
    console.error('Error submitting property:', error);
    throw error;
  }
};

// Update property status (admin only)
export const updatePropertyStatus = async (id: number, status: string) => {
  try {
    const response = await api.patch(`/properties/${id}/status`, { status });
    return response.data;
  } catch (error) {
    console.error('Error updating property status:', error);
    throw error;
  }
};

// Submit project (admin only)
export const submitProject = async (projectData: any) => {
  try {
    const response = await api.post('/projects', projectData);
    return response.data;
  } catch (error) {
    console.error('Error submitting project:', error);
    throw error;
  }
};

// Add request interceptor to handle authentication
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Handle 401 errors (unauthorized)
    if (error.response && error.response.status === 401) {
      // You might want to redirect to login or refresh token
      console.log('User is not authenticated');
    }
    return Promise.reject(error);
  }
);

export default api;