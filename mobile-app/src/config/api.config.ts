/**
 * API Configuration for Kinglike Luxury Mobile App
 * 
 * This file contains environment-specific API configuration.
 * Change the BASE_URL according to your environment.
 */

// Development server URL - change this to your backend server URL during development
export const DEV_API_URL = 'http://10.0.2.2:5000/api';

// Staging server URL (for testing)
export const STAGING_API_URL = 'https://staging-api.kinglikeluxury.com/api';

// Production server URL - change this to your production server when deploying
export const PROD_API_URL = 'https://kinglike-luxury.replit.app/api';

// Environment type for better type safety
type Environment = 'development' | 'staging' | 'production';

// Current environment - set to 'development', 'staging', or 'production'
export const ENVIRONMENT: Environment = 'production';

/**
 * Get the appropriate API URL based on the current environment
 */
export const getApiUrl = (): string => {
  switch (ENVIRONMENT) {
    case 'production':
      return PROD_API_URL;
    case 'staging':
      return STAGING_API_URL;
    case 'development':
    default:
      return DEV_API_URL;
  }
};

/**
 * Base API URL to use in the app
 */
export const API_URL = getApiUrl();

export default API_URL;