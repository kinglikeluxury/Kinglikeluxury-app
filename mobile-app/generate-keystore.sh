#!/bin/bash

# Kinglike Luxury - Keystore Generation Script
# This script creates a keystore file for signing the Android APK

KEYSTORE_DIR="./android/app/keystores"
KEYSTORE_FILE="$KEYSTORE_DIR/kinglikeluxury-key.keystore"
KEYSTORE_ALIAS="kinglikeluxury"
KEYSTORE_PASSWORD="kinglikeluxury123"
KEY_PASSWORD="kinglikeluxury123"
VALIDITY=10000

echo "===== Kinglike Luxury Keystore Generator ====="
echo "Generating keystore for signing the Android APK"
echo ""

# Check if the keystore directory exists, create if it doesn't
if [ ! -d "$KEYSTORE_DIR" ]; then
  echo "Creating keystores directory..."
  mkdir -p "$KEYSTORE_DIR"
fi

# Check if keystore already exists
if [ -f "$KEYSTORE_FILE" ]; then
  echo "Keystore already exists at $KEYSTORE_FILE"
  echo "Do you want to replace it? (y/n)"
  read answer
  if [ "$answer" != "y" ]; then
    echo "Keystore generation cancelled."
    exit 0
  fi
  echo "Removing existing keystore..."
  rm "$KEYSTORE_FILE"
fi

# Generate the keystore
echo "Generating new keystore..."
keytool -genkeypair \
  -dname "CN=Kinglike Luxury, OU=Mobile Development, O=Kinglike Luxury Real Estate, L=Tbilisi, S=Georgia, C=GE" \
  -alias "$KEYSTORE_ALIAS" \
  -keypass "$KEY_PASSWORD" \
  -keystore "$KEYSTORE_FILE" \
  -storepass "$KEYSTORE_PASSWORD" \
  -validity "$VALIDITY" \
  -keyalg RSA \
  -keysize 2048 \
  -storetype JKS

# Check if keystore was created successfully
if [ -f "$KEYSTORE_FILE" ]; then
  echo ""
  echo "✅ Keystore created successfully at: $KEYSTORE_FILE"
  echo ""
  echo "Keystore details:"
  echo "  - Alias: $KEYSTORE_ALIAS"
  echo "  - Password: $KEYSTORE_PASSWORD (same for key password)"
  echo "  - Validity: $VALIDITY days"
  echo ""
  echo "IMPORTANT: Keep these credentials secure and do not lose them!"
  echo "You will need them for all future app updates."
  echo ""
  echo "Next step: Update gradle.properties with these credentials."
else
  echo ""
  echo "⚠️ Failed to create keystore file."
  echo "Make sure keytool is available in your PATH and try again."
fi