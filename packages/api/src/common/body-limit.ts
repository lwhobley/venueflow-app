const LARGE_JSON_BODY_PATHS = [
  /^\/api\/v1\/chat\/images$/,
  /^\/api\/v1\/bar-inventory\/parse$/,
  /^\/api\/v1\/operations\/checklist\/complete\/[^/]+$/,
  /^\/api\/v1\/documents$/,
];

export function jsonBodyLimitForPath(path: string, largeBodyLimit: string): string {
  return LARGE_JSON_BODY_PATHS.some((pattern) => pattern.test(path)) ? largeBodyLimit : '1mb';
}
