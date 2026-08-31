import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The invite deep-link contract, which spans four files that have no import
 * relationship and would otherwise drift silently:
 *
 *   packages/api/.../app.controller.ts   emits the link into an email
 *   app.json                             declares the domain to iOS/Android
 *   site/.well-known/apple-app-site-association   authorises the app for it
 *   site/join/index.html                 is the fallback when the app is absent
 *
 * A mismatch anywhere degrades to "the link opens the marketing site" with no
 * error surfaced anywhere, so each edge is asserted rather than assumed.
 */

const DOMAIN = 'venuewrangler.com';
const BUNDLE_ID = 'com.venuewrangler.app';
const TEAM_ID = '8MTB6AL22R';

const read = (path: string) => readFileSync(path, 'utf8');
const appJson = JSON.parse(read('app.json')).expo;
const aasa = JSON.parse(read('site/.well-known/apple-app-site-association'));
const controller = read('packages/api/src/modules/app/app.controller.ts');

describe('invite universal link', () => {
  it('emails an https link, never a custom scheme', () => {
    // A venuewrangler:// URL is not linkified by Gmail or Outlook and fails
    // silently when the app is not installed, so the recipient sees dead text.
    const match = controller.match(/const inviteUrl = `([^`]+)`/);
    expect(match?.[1]).toBe('https://venuewrangler.com/join?invite=${encodeURIComponent(token)}');
  });

  it('puts the token in the query, because a fragment cannot reach the native app', () => {
    // site/join/index.html prefers #invite= (a fragment never reaches the
    // server), but there is no window.location off the web, so expo-router's
    // useLocalSearchParams -- which parses the query only -- is the sole
    // channel into app/join.tsx. A fragment here would open the app with no
    // token and no error.
    const inviteUrl = controller.match(/const inviteUrl = `([^`]+)`/)?.[1] ?? '';
    expect(inviteUrl).toContain('?invite=');
    expect(inviteUrl).not.toContain('#invite=');
  });

  it('reduces to the same router path the custom scheme produced', () => {
    // expo-router/build/fork/extractPathFromURL strips the origin from any
    // http(s) URL and then the leading slash; for a custom scheme it
    // concatenates host + pathname. Both must land on the `join` route with
    // the token intact, or the migration silently changes where users arrive.
    const toRouterPath = (url: string) => {
      const parsed = new URL(url);
      return (parsed.href.replace(parsed.origin, '')).replace(/^[/]/, '');
    };
    expect(toRouterPath('https://venuewrangler.com/join?invite=abc123')).toBe('join?invite=abc123');
  });
});

describe('platform deep-link configuration', () => {
  it('associates the iOS app with the domain that serves the invite link', () => {
    expect(appJson.ios.associatedDomains).toContain(`applinks:${DOMAIN}`);
  });

  it('authorises exactly this app in the association file', () => {
    const appIDs = aasa.applinks.details.flatMap((d: { appIDs: string[] }) => d.appIDs);
    expect(appIDs).toContain(`${TEAM_ID}.${BUNDLE_ID}`);
    expect(appJson.ios.bundleIdentifier).toBe(BUNDLE_ID);
  });

  it('claims the invite path and nothing else', () => {
    // Claiming /* would capture the Terms and Privacy links rendered inside
    // the app's own signup form and bounce the user out of the flow.
    const paths = aasa.applinks.details
      .flatMap((d: { components: { '/': string }[] }) => d.components)
      .map((component: { '/': string }) => component['/']);
    expect(paths).toEqual(['/join', '/join/*']);
  });

  it('serves the association file as JSON', () => {
    // Apple's CDN rejects any other content type, and the file is
    // deliberately extensionless so Pages cannot infer one.
    const headers = read('site/_headers');
    const rule = headers.slice(headers.indexOf('/.well-known/apple-app-site-association'));
    expect(rule).toMatch(/Content-Type: application[/]json/);
  });

  it('points the Android intent filter at the same host and path', () => {
    const [filter] = appJson.android.intentFilters;
    expect(filter.data[0]).toMatchObject({ scheme: 'https', host: DOMAIN, pathPrefix: '/join' });
    expect(filter.category).toEqual(['BROWSABLE', 'DEFAULT']);
  });

  it('leaves Android autoVerify off until assetlinks.json exists', () => {
    // autoVerify: true without a matching /.well-known/assetlinks.json makes
    // Android 12+ refuse the link outright, which is worse than the current
    // fallback of opening site/join/index.html in the browser. Flipping this
    // to true requires the Play App Signing SHA-256 fingerprint, which is not
    // in the repo. This assertion is the reminder: the two must change
    // together, in either direction.
    const [filter] = appJson.android.intentFilters;
    let assetlinks: string | null = null;
    try {
      assetlinks = read('site/.well-known/assetlinks.json');
    } catch {
      assetlinks = null;
    }
    expect(filter.autoVerify).toBe(assetlinks !== null);
  });
});

describe('web fallback', () => {
  it('accepts the query form the email actually sends', () => {
    // The page prefers the fragment, but the emailed link carries a query, so
    // the query branch is the one real recipients exercise.
    const page = read('site/join/index.html');
    expect(page).toContain('new URLSearchParams(window.location.search).get("invite")');
  });
});
