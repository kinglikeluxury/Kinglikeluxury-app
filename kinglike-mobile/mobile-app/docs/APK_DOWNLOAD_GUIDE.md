# Kinglike Luxury Mobile App - APK Download Guide

This guide explains how to get a downloadable APK link for the Kinglike Luxury mobile app using GitHub Actions.

## Getting the APK Download Link

1. **Push your code to GitHub**
   - Create a GitHub repository (if you haven't already)
   - Push the Kinglike Luxury code to the repository

2. **Run the GitHub Actions workflow**
   - Navigate to the "Actions" tab in your GitHub repository
   - You should see the "Build Android APK" workflow
   - The workflow will run automatically on every push to the `main` branch
   - You can also trigger it manually by clicking "Run workflow" on the right side

3. **Download the APK**
   - Once the workflow completes (takes about 5-10 minutes), click on the completed run
   - Scroll down to the "Artifacts" section
   - You'll see two artifacts:
     - `kinglike-luxury-debug`: Debug version (easier to install, has debugging enabled)
     - `kinglike-luxury-release`: Release version (optimized, signed with the generated keystore)
   - Click on either artifact to download a zip file containing the APK
   - Extract the zip file to get the APK

4. **Share the APK**
   - The easiest way to share is to provide a link to the completed GitHub Actions run
   - Alternatively, upload the APK to a file sharing service like Google Drive or Dropbox

## Troubleshooting

If the workflow fails, check the logs for error messages. Common issues include:

- **Build failures**: Check if the React Native configuration is correct
- **Missing dependencies**: Ensure all necessary dependencies are defined in package.json
- **Java version mismatch**: The workflow uses Java 11; ensure your app is compatible

## Modifying the Build Process

If you need to customize the build process:

1. Edit the `.github/workflows/build-android.yml` file
2. Commit and push the changes
3. The updated workflow will be used for future builds

## Releasing to Google Play

To release to Google Play, you'll need to:

1. Create a more secure keystore and keep it safe
2. Configure signing with the production keystore
3. Set up GitHub repository secrets for your keystore credentials
4. Modify the workflow to use these secrets

Refer to the React Native documentation for detailed instructions on releasing to Google Play.