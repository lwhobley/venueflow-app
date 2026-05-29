import { Redirect, useLocalSearchParams } from 'expo-router';

export default function JoinRedirect() {
  const { invite } = useLocalSearchParams<{ invite?: string }>();
  if (invite) {
    return <Redirect href={{ pathname: '/(auth)/sign-in', params: { invite } }} />;
  }
  return <Redirect href="/(auth)/sign-in" />;
}
