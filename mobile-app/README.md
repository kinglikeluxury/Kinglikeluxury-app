# Kinglike Luxury Mobile App

A React Native mobile application for browsing luxury real estate properties.

## Project Structure

```
mobile-app/
├── android/              # Android platform-specific code
├── ios/                  # iOS platform-specific code (future implementation)
├── src/                  # Source code
│   ├── assets/           # Images, fonts and other static assets
│   ├── components/       # Reusable UI components
│   ├── hooks/            # Custom React hooks
│   ├── lib/              # Utility functions and API services
│   ├── navigation/       # Navigation setup and routing
│   ├── screens/          # App screen components
│   └── utils/            # Helper functions
├── docs/                 # Documentation
│   └── AR_FEATURES.md    # AR functionality documentation
├── App.tsx               # Main app component
├── app.json              # App configuration
├── babel.config.js       # Babel configuration
├── index.js              # Entry point
├── metro.config.js       # Metro bundler configuration
└── tsconfig.json         # TypeScript configuration
```

## Features

- Browse property listings with various filters
- View detailed property information
- View property images and contact property owners
- Interactive maps to view property locations
- Browse construction projects
- User authentication (login, registration)
- Contact property owners via phone or email
- Favorites system to save preferred properties
- **Augmented Reality (AR) visualization of property layouts**
  - View property floor plans in 3D with AR
  - Interactive model manipulation (scale, rotate, move)
  - Place property models on detected surfaces
  - Immersive property preview before physical visits

## Getting Started

### Prerequisites

- Node.js
- Java Development Kit (JDK) 11 or newer
- Android Studio
- Android SDK

### Installation

1. Install dependencies:
   ```
   npm install
   ```

2. Start the Metro bundler:
   ```
   npx react-native start
   ```

3. Run the app on Android:
   ```
   npx react-native run-android
   ```

## API Integration

The app connects to the Kinglike Luxury backend API to fetch property data, handle authentication, and manage user interactions. The API service is configured in `src/lib/api.ts`.