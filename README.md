# Kinglike Luxury Real Estate Platform

A comprehensive real estate platform for browsing luxury properties, with both web and mobile applications.

## Project Structure

The project consists of two main parts:

1. **Web Application**: A React-based web application for browsing and managing properties
2. **Mobile Application**: A React Native app for Android that provides mobile access to the platform

### Web App Tech Stack

- **Frontend**: React, TypeScript, TailwindCSS, Shadcn UI
- **Backend**: Express.js with PostgreSQL database
- **Authentication**: Custom JWT-based authentication
- **Maps**: Leaflet.js for interactive property maps
- **Internationalization**: Support for 9 languages with i18next

### Mobile App Tech Stack

- **Framework**: React Native
- **Navigation**: React Navigation
- **API Communication**: Axios
- **Maps**: React Native Maps
- **UI Components**: Native components with custom styling

## Features

- Browse property listings (apartments, villas, lands, commercial areas)
- Advanced filtering and search capabilities
- Detailed property information with photos and specifications
- Interactive maps for property locations
- Admin dashboard for property management and approval
- User authentication with multiple methods
- Multilingual support
- Construction project listings
- Blog section
- Contact and social media integration

## Getting Started

### Web Application

1. Install dependencies:
   ```
   npm install
   ```

2. Start the development server:
   ```
   npm run dev
   ```

### Mobile Application

See the [mobile app README](./mobile-app/README.md) for detailed setup instructions.

## Project Structure

```
.
├── client/                # Web frontend
├── mobile-app/            # Android mobile app
├── server/                # Backend API
└── shared/                # Shared code between client and server
```

## Deployment

The web application is designed to be easily deployed on platforms like Vercel, Netlify, or any Node.js hosting service.

The mobile application can be built as an APK file for distribution on the Google Play Store or for direct installation.