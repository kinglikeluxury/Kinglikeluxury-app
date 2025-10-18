// Define colors using the Kinglike Luxury brand palette
export const COLORS = {
  // Brand colors
  primary: '#3bcac4', // Teal
  secondary: '#005476', // Dark blue
  
  // Base colors
  white: '#FFFFFF',
  black: '#000000',
  
  // Grays
  gray: '#868e96',
  grayShades: {
    50: '#f8f9fa',
    100: '#f1f3f5',
    200: '#e9ecef',
    300: '#dee2e6',
    400: '#ced4da',
    500: '#adb5bd',
    600: '#868e96',
    700: '#495057',
    800: '#343a40',
    900: '#212529',
  },
  
  // UI colors
  text: '#1A202C',
  textLight: '#718096',
  error: '#E53E3E',
  success: '#38A169',
  warning: '#F6AD55',
  background: '#F7FAFC',
  lightGray: '#F0F2F5',
  border: '#E2E8F0',
  transparent: 'transparent',
};

// Font families
export const FONTS = {
  regular: 'System',
  medium: 'System-Medium',
  bold: 'System-Bold',
  sizes: {
    xsmall: 12,
    small: 14,
    medium: 16,
    large: 18,
    xlarge: 22,
    xxlarge: 28,
  },
};

// Spacing scale
export const SPACING = {
  xsmall: 4,
  small: 8,
  medium: 16,
  large: 24,
  xlarge: 32,
  xxlarge: 48,
  // Add shorter aliases for convenience
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

// Border radius
export const BORDER_RADIUS = {
  small: 4,
  medium: 8,
  large: 12,
  full: 9999,
};

// Shadows
export const SHADOWS = {
  small: {
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  medium: {
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  large: {
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 8,
  },
};

// Export as a default theme object
export default {
  COLORS,
  FONTS,
  SPACING,
  BORDER_RADIUS,
  SHADOWS,
};