# Kinglike Luxury Mobile App - Direct APK Link

Due to Replit environment limitations (limited disk space, memory, and processing power), building the Android APK directly here is challenging. Here's a better solution for getting a direct APK link:

## Option 1: Use Expo EAS Build (Recommended)

Expo EAS Build is a cloud service that builds your React Native app without requiring local Android SDK setup.

1. Install the EAS CLI:
   ```
   npm install -g eas-cli
   ```

2. Log in to your Expo account:
   ```
   eas login
   ```

3. Initialize EAS Build in your project:
   ```
   cd mobile-app
   eas build:configure
   ```

4. Create an `eas.json` file:
   ```json
   {
     "build": {
       "preview": {
         "android": {
           "buildType": "apk"
         }
       },
       "production": {}
     }
   }
   ```

5. Start the build:
   ```
   eas build -p android --profile preview
   ```

6. After the build completes (usually takes 10-15 minutes), you'll get a direct download link to the APK.

## Option 2: Use a Local Android Development Environment

If you have Android Studio installed on your computer:

1. Clone the repository to your local machine
2. Open the `mobile-app/android` folder in Android Studio
3. Run `./gradlew assembleDebug` in the terminal
4. The APK will be generated at `mobile-app/android/app/build/outputs/apk/debug/app-debug.apk`

## Option 3: Use the GitHub Actions Workflow

We've already set up the GitHub Actions workflow:

1. Push the code to GitHub
2. Go to the Actions tab
3. The workflow will automatically run, building the APK
4. Download the APK artifact from the completed workflow

## Option 4: Use Appetize.io for Testing Without APK

If you just want to test the app without building an APK:

1. Use [Appetize.io](https://appetize.io/) to run the app in a browser
2. Upload your app code and it will provide an interactive demo

## Need help?

Contact our development team if you encounter any issues with these approaches.