export default {
  name: 'Kinglike Luxury Real Estate',
  slug: 'kinglike-realestate-app',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './src/assets/LUXURY_20230822_234540_0000-removebg.png',
  userInterfaceStyle: 'light',
  splash: {
    image: './src/assets/LUXURY_20230822_234540_0000-removebg.png',
    resizeMode: 'contain',
    backgroundColor: '#005476'
  },
  assetBundlePatterns: ['**/*'],
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.kinglikeluxury.realestate'
  },
  android: {
    adaptiveIcon: {
      foregroundImage: './src/assets/LUXURY_20230822_234540_0000-removebg.png',
      backgroundColor: '#005476'
    },
    package: 'com.kinglikeluxury.realestate',
    permissions: [
      'CAMERA',
      'ACCESS_FINE_LOCATION',
      'ACCESS_COARSE_LOCATION',
      'READ_EXTERNAL_STORAGE',
      'WRITE_EXTERNAL_STORAGE'
    ]
  },
  web: {
    favicon: './src/assets/LUXURY_20230822_234540_0000-removebg.png'
  },
  plugins: [
    [
      'expo-camera',
      {
        cameraPermission: 'Allow Kinglike Luxury to access your camera for AR features.'
      }
    ],
    [
      'expo-location',
      {
        locationAlwaysAndWhenInUsePermission: 'Allow Kinglike Luxury to use your location to show nearby properties.'
      }
    ],
    [
      'expo-image-picker',
      {
        photosPermission: 'Allow Kinglike Luxury to access your photos to upload property images.'
      }
    ]
  ],
  extra: {
    eas: {
      projectId: '8aea3515-d17f-4ed0-8d82-a87df61ccfa8'
    }
  }
};
