// Dynamic Expo config that extends app.json. The web build is served from a
// sub-path on the marketing origin (venuewrangler.com/app), so at export time
// CI sets EXPO_WEB_BASE_URL=/app and every asset/route URL resolves there.
// Local dev (`npm run web`) and native builds leave it unset and serve from "/".
const baseUrl = process.env.EXPO_WEB_BASE_URL;

module.exports = ({ config }) => ({
  ...config,
  web: {
    ...config.web,
    // Single-page output: one index.html that client-side routes. The Pages
    // deploy adds a /app/* -> /app/index.html fallback (see site/_redirects).
    output: 'single',
  },
  experiments: {
    ...config.experiments,
    ...(baseUrl ? { baseUrl } : {}),
  },
});
