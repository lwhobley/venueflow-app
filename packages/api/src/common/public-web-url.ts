export function publicWebOrigin(config: { get: (key: string) => string | undefined }): string {
  return (config.get('WEB_BASE_URL') || config.get('APP_WEB_URL') || 'https://venuewrangler.com').replace(/\/+$/, '');
}
