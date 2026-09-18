import type { ExpoConfig } from 'expo/config';

const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://writeoff-production-testing.web.app';

const config: ExpoConfig = {
  name: 'WriteOff',
  slug: 'writeoff',
  version: '0.1.0',
  orientation: 'portrait',
  scheme: 'writeoff',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  ios: {
    bundleIdentifier: 'com.writeoffapp.mobile',
    supportsTablet: false,
    infoPlist: {
      // Apple reviews these strings; each must describe a user-visible benefit.
      NSLocationWhenInUseUsageDescription:
        'WriteOff uses your location while a trip is running to measure business mileage you choose to log.',
      NSLocationAlwaysAndWhenInUseUsageDescription:
        'With automatic trip detection on, WriteOff records drives in the background so you can classify them as business or personal later. Location is never sold or used for advertising.',
      NSMotionUsageDescription:
        'Motion activity helps WriteOff tell driving apart from walking so trips start and stop accurately.',
      NSCameraUsageDescription: 'Photograph receipts to attach them to your expenses.',
      NSPhotoLibraryUsageDescription: 'Choose existing receipt photos to attach to your expenses.',
      NSFaceIDUsageDescription: 'Unlock WriteOff quickly and keep your financial records private.',
      UIBackgroundModes: ['location', 'fetch', 'remote-notification'],
      ITSAppUsesNonExemptEncryption: false,
    },
    config: { usesNonExemptEncryption: false },
  },
  android: {
    package: 'com.writeoffapp.mobile',
    permissions: [
      'ACCESS_COARSE_LOCATION',
      'ACCESS_FINE_LOCATION',
      'ACCESS_BACKGROUND_LOCATION',
      'ACTIVITY_RECOGNITION',
      'CAMERA',
      'POST_NOTIFICATIONS',
    ],
  },
  plugins: [
    ['expo-location', {
      locationAlwaysAndWhenInUsePermission:
        'With automatic trip detection on, WriteOff records drives in the background so you can classify them later.',
      isIosBackgroundLocationEnabled: true,
      isAndroidBackgroundLocationEnabled: true,
    }],
    ['expo-camera', { cameraPermission: 'Photograph receipts to attach them to your expenses.' }],
    ['expo-image-picker', { photosPermission: 'Choose existing receipt photos to attach to your expenses.' }],
    'expo-task-manager',
    'expo-notifications',
    'expo-secure-store',
  ],
  extra: {
    apiBaseUrl,
    eas: { projectId: process.env.EAS_PROJECT_ID ?? '' },
  },
};

export default config;
