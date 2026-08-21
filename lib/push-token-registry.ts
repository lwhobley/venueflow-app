// Last Expo push token registered for this device/process. Set by
// usePushNotifications on successful registration, read by railway-hooks'
// signOut() so logout can ask the server to unregister only this device's
// token instead of every token the profile has ever registered (which would
// also silence push on the user's other signed-in devices). Kept in its own
// module so usePushNotifications and railway-hooks don't import each other.
let lastRegisteredPushToken: string | null = null;

export function setLastRegisteredPushToken(token: string | null): void {
  lastRegisteredPushToken = token;
}

export function getLastRegisteredPushToken(): string | null {
  return lastRegisteredPushToken;
}
