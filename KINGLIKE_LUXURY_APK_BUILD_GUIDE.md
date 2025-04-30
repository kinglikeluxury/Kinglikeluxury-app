# Kinglike Luxury App - Complete Build Guide

This document contains all the information about building and distributing the Kinglike Luxury mobile app APK.

## Table of Contents
1. [GitHub Actions Workflow](#github-actions-workflow)
2. [Manual Build Instructions](#manual-build-instructions)
3. [Expo EAS Build Configuration](#expo-eas-build-configuration)
4. [Keystore Generation](#keystore-generation)
5. [Build Scripts](#build-scripts)
6. [Environment Configuration](#environment-configuration)
7. [APK Download Guide](#apk-download-guide)

## GitHub Actions Workflow

The following GitHub workflow file is set up to automatically build the Android APK when you push your code to GitHub.

```yaml
# File: .github/workflows/build-android.yml
name: Build Android APK

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]
  workflow_dispatch:  # Allows manual triggering from GitHub UI

jobs:
  build:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: mobile-app

    steps:
      - uses: actions/checkout@v3

      - name: Set up JDK 11
        uses: actions/setup-java@v3
        with:
          java-version: '11'
          distribution: 'temurin'
          cache: gradle

      - name: Set up Node.js
        uses: actions/setup-node@v3
        with:
          node-version: 16
          cache: 'npm'
          cache-dependency-path: 'mobile-app/package-lock.json'

      - name: Install dependencies
        run: npm ci

      - name: Make Gradle executable
        run: chmod +x ./android/gradlew

      - name: Generate Keystore
        run: |
          mkdir -p ./android/app/keystores
          keytool -genkeypair \
            -dname "CN=Kinglike Luxury, OU=Mobile Development, O=Kinglike Luxury Real Estate, L=Tbilisi, S=Georgia, C=GE" \
            -alias kinglikeluxury \
            -keypass kinglikeluxury123 \
            -keystore ./android/app/keystores/kinglikeluxury-key.keystore \
            -storepass kinglikeluxury123 \
            -validity 10000 \
            -keyalg RSA \
            -keysize 2048 \
            -storetype JKS

      - name: Build APK (debug)
        run: |
          cd android
          ./gradlew assembleDebug

      - name: Build APK (release)
        run: |
          cd android
          ./gradlew assembleRelease

      - name: Upload Debug APK
        uses: actions/upload-artifact@v3
        with:
          name: kinglike-luxury-debug
          path: mobile-app/android/app/build/outputs/apk/debug/app-debug.apk

      - name: Upload Release APK
        uses: actions/upload-artifact@v3
        with:
          name: kinglike-luxury-release
          path: mobile-app/android/app/build/outputs/apk/release/app-release.apk
```

## Manual Build Instructions

### Prerequisites
- Node.js and npm installed
- Android Studio and Android SDK installed
- JDK 11 or newer installed

### Building the APK Locally

1. Navigate to the project directory:
   ```bash
   cd mobile-app
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Generate debug keystore (if not already exists):
   ```bash
   ./generate-keystore.sh
   ```

4. Build the debug APK:
   ```bash
   cd android && ./gradlew assembleDebug
   ```

5. The APK will be generated at:
   ```
   mobile-app/android/app/build/outputs/apk/debug/app-debug.apk
   ```

## Expo EAS Build Configuration

For cloud-based builds using Expo EAS, we've created a configuration file:

```json
// File: mobile-app/eas.json
{
  "cli": {
    "version": ">= 3.13.3"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal",
      "android": {
        "buildType": "apk"
      }
    },
    "production": {
      "android": {
        "buildType": "app-bundle"
      }
    }
  },
  "submit": {
    "production": {}
  }
}
```

### Using Expo EAS

1. Install the EAS CLI:
   ```bash
   npm install -g eas-cli
   ```

2. Log in to your Expo account:
   ```bash
   eas login
   ```

3. Start the build:
   ```bash
   eas build -p android --profile preview
   ```

## Keystore Generation

The keystore generation script creates a signing key for the APK:

```bash
#!/bin/bash
# File: mobile-app/generate-keystore.sh

# Create directory for keystore
mkdir -p android/app/keystores

# Generate the keystore
keytool -genkeypair \
  -dname "CN=Kinglike Luxury, OU=Mobile Development, O=Kinglike Luxury Real Estate, L=Tbilisi, S=Georgia, C=GE" \
  -alias kinglikeluxury \
  -keypass kinglikeluxury123 \
  -keystore android/app/keystores/kinglikeluxury-key.keystore \
  -storepass kinglikeluxury123 \
  -validity 10000 \
  -keyalg RSA \
  -keysize 2048 \
  -storetype JKS

echo "Keystore generated at android/app/keystores/kinglikeluxury-key.keystore"
```

## Build Scripts

The build-apk.sh script is used to build the APK:

```bash
#!/bin/bash
# File: mobile-app/build-apk.sh

# Check if keystore exists, if not generate it
if [ ! -f ./android/app/keystores/kinglikeluxury-key.keystore ]; then
  echo "Keystore not found. Generating..."
  ./generate-keystore.sh
fi

# Change to android directory
cd android

# Clean any previous builds
./gradlew clean

# Build debug APK
echo "Building debug APK..."
./gradlew assembleDebug

# Build release APK
echo "Building release APK..."
./gradlew assembleRelease

echo "Build completed."
echo "Debug APK: ./android/app/build/outputs/apk/debug/app-debug.apk"
echo "Release APK: ./android/app/build/outputs/apk/release/app-release.apk"
```

## Environment Configuration

API configuration for environment switching:

```typescript
// File: mobile-app/src/config/api.config.ts
export const DEV_API_URL = 'http://10.0.2.2:5000/api';
export const STAGING_API_URL = 'https://staging-api.kinglikeluxury.com/api';
export const PROD_API_URL = 'https://api.kinglikeluxury.com/api';

type Environment = 'development' | 'staging' | 'production';
export const ENVIRONMENT: Environment = 'development';

/**
 * Get the appropriate API URL based on the current environment
 */
export const getApiUrl = (): string => {
  switch (ENVIRONMENT) {
    case 'development':
      return DEV_API_URL;
    case 'staging':
      return STAGING_API_URL;
    case 'production':
      return PROD_API_URL;
  }
};

/**
 * Base API URL to use in the app
 */
export const API_URL = getApiUrl();
```

## APK Download Guide

### Option 1: Via GitHub Actions

1. Push your code to GitHub
2. Go to the "Actions" tab
3. Find the completed workflow run
4. Scroll down to "Artifacts" section
5. Download the APK artifact

### Option 2: Via Expo EAS

1. Run the Expo EAS build command
2. Wait for the build to complete
3. You'll receive an email with the download link
4. Or find the build in your Expo dashboard

### Option 3: Via Local Build

1. Run the build-apk.sh script
2. Find the APK at the location indicated in the output
3. Transfer the APK to your device

## Important Files Overview

- `.github/workflows/build-android.yml`: GitHub Actions workflow file
- `mobile-app/eas.json`: Expo EAS configuration
- `mobile-app/generate-keystore.sh`: Script to generate signing keystore
- `mobile-app/build-apk.sh`: Script to build the APK
- `mobile-app/src/config/api.config.ts`: API environment configuration
- `mobile-app/android/app/build.gradle`: Android build configuration
- `mobile-app/android/gradle.properties`: Gradle properties with signing config

## Android Gradle Configuration

Add these lines to `mobile-app/android/gradle.properties`:

```properties
# Signing configuration
KINGLIKELUXURY_UPLOAD_STORE_FILE=keystores/kinglikeluxury-key.keystore
KINGLIKELUXURY_UPLOAD_KEY_ALIAS=kinglikeluxury
KINGLIKELUXURY_UPLOAD_STORE_PASSWORD=kinglikeluxury123
KINGLIKELUXURY_UPLOAD_KEY_PASSWORD=kinglikeluxury123
```

Update the `android/app/build.gradle` to include the signing configuration:

```gradle
...
android {
    ...
    defaultConfig { ... }
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        release {
            if (project.hasProperty('KINGLIKELUXURY_UPLOAD_STORE_FILE')) {
                storeFile file(KINGLIKELUXURY_UPLOAD_STORE_FILE)
                storePassword KINGLIKELUXURY_UPLOAD_STORE_PASSWORD
                keyAlias KINGLIKELUXURY_UPLOAD_KEY_ALIAS
                keyPassword KINGLIKELUXURY_UPLOAD_KEY_PASSWORD
            }
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.release
            minifyEnabled enableProguardInReleaseBuilds
            proguardFiles getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro"
        }
    }
}
```

## Additional Notes

- Remember to keep your keystore file secure. The one generated by these scripts is for development purposes only.
- For production releases, use a more secure keystore and store the credentials safely.
- The APK can be installed on Android devices running Android 5.0 (Lollipop) or newer.
- Make sure your device allows installation from unknown sources if installing the APK directly.