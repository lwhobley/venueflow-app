import { Platform } from 'react-native';
import { Redirect, useLocalSearchParams } from 'expo-router';

function hashInvite(): string | undefined {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;
  return new URLSearchParams(window.location.hash.replace(/^#/, '')).get('invite')?.trim() || undefined;
}

export default function JoinRedirect() {
  const { invite } = useLocalSearchParams<{ invite?: string }>();
  const token = (typeof invite === 'string' ? invite : invite?.[0])?.trim() || hashInvite();
  if (token) {
    return <Redirect href={{ pathname: '/(auth)/sign-in', params: { invite: token } }} />;
  }
  return <Redirect href="/(auth)/welcome" />;
}
