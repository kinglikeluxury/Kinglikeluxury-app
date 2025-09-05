# Overview

Kinglike Luxury Real Estate Platform is a comprehensive property marketplace that consists of both web and mobile applications. The platform focuses on luxury real estate listings including apartments, villas, lands, and construction projects. It features a React-based web application with a PostgreSQL backend and a React Native mobile app with advanced AR capabilities for property visualization.

The system supports multiple authentication methods, multilingual content (9 languages), property management with admin approval workflow, and includes unique features like AR property visualization and premium listing tiers (VIP/Super VIP).

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
**Web Application**: Built with React and TypeScript, utilizing TailwindCSS for styling and Shadcn UI for component library. The frontend uses Vite as the build tool and implements client-side routing with Wouter. Internationalization is handled through react-i18next supporting 9 languages with RTL support for Arabic and Hebrew.

**Mobile Application**: React Native app with TypeScript, featuring native navigation and AR capabilities through ViroReact. The mobile app includes camera permissions management and 3D model rendering for property visualization.

## Backend Architecture
**Express.js Server**: RESTful API server handling authentication, property management, and file processing. The server implements session-based authentication with PostgreSQL session store and includes image watermarking capabilities using Canvas.

**Database Layer**: Uses Drizzle ORM for type-safe database operations with PostgreSQL. The schema supports multiple authentication methods, property types, and user roles with admin approval workflows.

## Authentication System
Supports multiple authentication methods including email/password, phone number, WhatsApp, and Facebook login. The system uses JWT-based sessions stored in PostgreSQL with role-based access control for admin functions.

## Property Management
Implements a three-tier listing system (Regular, VIP, Super VIP) with admin approval workflow. Properties can be filtered by type, location, price range, and status. The system supports image uploads with automatic watermarking.

## Mobile AR Features
The mobile application includes augmented reality functionality for property visualization using ViroReact. Users can view 3D property models, floor plans, and interact with them through touch gestures (scale, rotate, move). The AR system includes surface detection for placing models in real environments.

## Multilingual Support
Complete internationalization with support for English, Arabic, Hebrew, Russian, Georgian, Azerbaijani, Turkish, Chinese, and Polish. The system automatically handles text direction (LTR/RTL) and provides language-specific formatting.

# External Dependencies

## Database
- **Neon PostgreSQL**: Cloud-hosted PostgreSQL database for production data storage
- **Drizzle ORM**: Type-safe database toolkit for schema management and queries

## UI and Styling
- **Radix UI**: Headless UI components for accessibility and consistency
- **TailwindCSS**: Utility-first CSS framework for styling
- **Shadcn UI**: Pre-built component library based on Radix UI

## Maps and Location
- **Leaflet.js**: Interactive mapping for property locations on web
- **React Native Maps**: Native mapping solution for mobile application

## Mobile AR Framework
- **ViroReact**: AR/VR development platform for React Native
- **Three.js**: 3D graphics library for model rendering

## Authentication and Sessions
- **Express Session**: Server-side session management
- **Connect-PG-Simple**: PostgreSQL session store adapter

## Image Processing
- **Canvas**: Server-side image manipulation for watermarking
- **Image Upload**: File handling with automatic processing

## Development Tools
- **TypeScript**: Static type checking across the stack
- **Vite**: Fast development server and build tool
- **ESBuild**: JavaScript bundler for production builds
- **React Query**: Data fetching and caching for the frontend

## Mobile Development
- **Expo EAS**: Cloud build service for React Native applications
- **Metro**: React Native JavaScript bundler
- **React Navigation**: Navigation library for mobile app

## Internationalization
- **react-i18next**: React integration for i18next
- **i18next-browser-languagedetector**: Automatic language detection
- **i18next-http-backend**: Translation file loading

## Build and Deployment
- **GitHub Actions**: CI/CD pipeline for automated APK builds
- **Gradle**: Android build system for mobile app compilation