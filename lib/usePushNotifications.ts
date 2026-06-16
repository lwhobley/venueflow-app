import { useEffect } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { useMutation } from './railway-hooks';
import { api } from './railway-api';
import { useAuthStore, type AuthState } from './auth-store';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function platformName() {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  if (Platform.OS === 'web') return 'web';
  return 'unknown';
}

export function usePushNotifications() {
  const user = useAuthStore((state: AuthState) => state.user);
  const venue = useAuthStore((state: AuthState) => state.venue);
  const registerPushToken = useMutation(api.push.registerPushToken);

  useEffect(() => {
    let cancelled = false;

    async function register() {
      if (!user || !venue || Platform.OS === 'web') return;
      const permission = await Notifications.getPermissionsAsync();
      const finalPermission = permission.status === 'granted' ? permission : await Notifications.requestPermissionsAsync();
      if (cancelled || finalPermission.status !== 'granted') return;
      // Expo push token (ExponentPushToken[...]) — required by the server's
      // Expo push delivery. The raw device token is not usable by exp.host.
      const projectId =
        Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
      const token = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
      if (cancelled || !token.data) return;
      await registerPushToken({ token: token.data, platform: platformName() });
    }

    void register().catch((error) => {
      if (typeof __DEV__ !== 'undefined' && __DEV__) console.warn('Unable to register push notifications', error);
    });

    return () => {
      cancelled = true;
    };
  }, [registerPushToken, user, venue]);
}
