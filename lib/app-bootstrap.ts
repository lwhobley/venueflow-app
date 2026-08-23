export function fontsReadyForPlatform(
  platform: string,
  fontsLoaded: boolean,
  fontError: unknown,
): boolean {
  return platform !== 'web' || fontsLoaded || Boolean(fontError);
}
