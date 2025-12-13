# Kinglike Luxury Android APK Build Guide

This guide explains how to build the Android APK for the Kinglike Luxury mobile application.

## Prerequisites

Before building the APK, ensure you have the following tools installed:
- Node.js and npm
- Java Development Kit (JDK) 11 or newer
- Android SDK and build tools
- Gradle

## Building the APK

We have provided several methods to build the APK:

### Method 1: Using the Build Script (Recommended)

1. Navigate to the mobile-app directory:
   ```
   cd mobile-app
   ```

2. Make the build script executable (if needed):
   ```
   chmod +x build-apk.sh
   ```

3. Run the build script:
   ```
   ./build-apk.sh
   ```

4. After the build completes, you'll find the APK files in the `./build` directory:
   - `kinglike-luxury-debug.apk` - Debug version for testing
   - `kinglike-luxury-release.apk` - Release version for distribution

### Method 2: Using npm Scripts

1. Navigate to the mobile-app directory:
   ```
   cd mobile-app
   ```

2. To build the debug APK:
   ```
   npm run build-android-debug
   ```

3. To build the release APK:
   ```
   npm run build-android-release
   ```

4. After the build completes, you'll find the APK files in:
   - Debug: `./android/app/build/outputs/apk/debug/app-debug.apk`
   - Release: `./android/app/build/outputs/apk/release/app-release.apk`

### Method 3: Using Gradle Directly

1. Navigate to the android directory:
   ```
   cd mobile-app/android
   ```

2. To build the debug APK:
   ```
   ./gradlew assembleDebug
   ```

3. To build the release APK:
   ```
   ./gradlew assembleRelease
   ```

## Installing the APK on a Device

To install the APK on a connected Android device:

1. Connect your Android device to your computer via USB.
2. Make sure USB debugging is enabled on your device.
3. Run the following command:
   ```
   adb install path/to/kinglike-luxury-release.apk
   ```

## Notes on App Signing

The APK is signed using the following keystore configuration:

- Keystore file: `app/keystores/kinglikeluxury-key.keystore`
- Alias: `kinglikeluxury`
- Password: Stored in gradle.properties for security

For production deployment, please consider creating a more secure keystore and updating the signing configuration.

## App Features

The Kinglike Luxury mobile app includes:

1. Property browsing with detailed information
2. Advanced property search and filtering
3. Augmented Reality (AR) visualization of properties
4. Property score visualization
5. Location-based property search with maps
6. User authentication

## Troubleshooting

If you encounter any issues during the build process:

1. Make sure all dependencies are installed correctly
2. Check the Android section in `package.json` for required versions
3. Verify that the keystore file exists and is correctly configured
4. Clear the build cache and try again:
   ```
   cd android && ./gradlew clean && cd ..
   ```

For additional support, please contact the development team.