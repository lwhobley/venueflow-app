// Strips CR/LF and other control characters from a user-controlled value
// (e.g. a venue name, set at signup with no format restriction) before it's
// interpolated into an email subject or body — closes off header-injection
// and reduces how convincing it could be as a phishing lure.
export function sanitizeForEmail(value: string): string {
  return value.replace(/[\r\n\t\x00-\x1f\x7f]+/g, ' ').trim();
}
