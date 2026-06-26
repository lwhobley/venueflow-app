// Dynamic Expo config that extends app.json. The web build is served from a
// sub-path on the marketing origin (venuewrangler.com/app), so at export time
// CI sets EXPO_WEB_BASE_URL=/app and every asset/route URL resolves there.
// Local dev (`npm run web`) and native builds leave it unset and serve from "/".
const baseUrl = process.env.EXPO_WEB_BASE_URL;

module.exports = ({ config }) => ({
  ...config,
  web: {
    ...config.web,
    // Static output: prerender each route to its own HTML file so deep links
    // like /app/sign-in resolve to a real file. (Single-page output relied on
    // an SPA fallback, but the Pages project's root catch-all intercepts
    // unmatched /app/* paths and serves the marketing page instead.)
    output: 'static',
  },
  experiments: {
    ...config.experiments,
    ...(baseUrl ? { baseUrl } : {}),
  },
});
