import type { NextConfig } from 'next';
const config: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ['archiver'],
  async headers() {
    return [{ source: '/:path*', headers: [
      {key: 'X-Content-Type-Options', value: 'nosniff'},
      {key: 'Referrer-Policy', value: 'same-origin'},
      {key: 'X-Frame-Options', value: 'DENY'},
      {key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()'},
      {key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: https://*.r2.cloudflarestorage.com; font-src 'self'; connect-src 'self' https://*.r2.cloudflarestorage.com; frame-src 'self' blob: https://*.r2.cloudflarestorage.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"},
    ]}];
  },
};
export default config;
