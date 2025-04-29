#!/bin/bash

# Kinglike Luxury APK build script
# This script builds both debug and release APKs for the Kinglike Luxury app

echo "===== Kinglike Luxury Mobile APK Builder ====="
echo "Building both debug and release APKs..."
echo ""

# Make sure the script is run from the mobile-app directory
if [ ! -f "./package.json" ]; then
  echo "Error: This script must be run from the mobile-app directory"
  exit 1
fi

# Install dependencies first
echo "Step 1: Installing dependencies..."
npm install

# Creating output directory
mkdir -p ./build
rm -f ./build/*.apk

# Build the debug APK
echo ""
echo "Step 2: Building debug APK..."
cd android && ./gradlew clean assembleDebug && cd ..

# Check if debug build was successful
if [ ! -f "./android/app/build/outputs/apk/debug/app-debug.apk" ]; then
  echo "Error: Debug APK build failed"
  exit 1
fi

# Copy the debug APK to build directory
cp ./android/app/build/outputs/apk/debug/app-debug.apk ./build/kinglike-luxury-debug.apk
echo "Debug APK saved as ./build/kinglike-luxury-debug.apk"

# Build the release APK
echo ""
echo "Step 3: Building release APK..."
cd android && ./gradlew assembleRelease && cd ..

# Check if release build was successful
if [ ! -f "./android/app/build/outputs/apk/release/app-release.apk" ]; then
  echo "Error: Release APK build failed"
  exit 1
fi

# Copy the release APK to build directory
cp ./android/app/build/outputs/apk/release/app-release.apk ./build/kinglike-luxury-release.apk
echo "Release APK saved as ./build/kinglike-luxury-release.apk"

# Build successful
echo ""
echo "===== Build completed successfully! ====="
echo "APK files are available in the ./build directory:"
echo "- Debug APK: ./build/kinglike-luxury-debug.apk"
echo "- Release APK: ./build/kinglike-luxury-release.apk"
echo ""
echo "To install on a device:"
echo "adb install ./build/kinglike-luxury-release.apk"
echo ""
echo "For app store submission, use the release APK."