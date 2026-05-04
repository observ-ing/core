import type { CapacitorConfig } from '@capacitor/cli';

// Optional dev-time override: when CAPACITOR_SERVER_URL is set at build time
// (e.g. in CI for emulator + local appview, or locally pointing at vite dev),
// the WebView loads from that URL instead of the bundled web assets. The
// bundled assets remain in the APK as a fallback.
const serverUrl = process.env['CAPACITOR_SERVER_URL'];

const config: CapacitorConfig = {
  appId: 'ing.observ.app',
  appName: 'Observ.ing',
  webDir: 'dist/public',
  server: {
    // Keep OAuth flow inside the WebView regardless of build mode. Without
    // this, off-origin navigations (the PDS authorize page) get punted to
    // Chrome, which sets the session cookie in the wrong jar. AT Protocol
    // PDSes can live on user-controlled domains (e.g. self-hosted), so we
    // can't enumerate hosts ahead of time — using '*' here. Narrowing is
    // tracked as a hardening follow-up once the auth surface is settled.
    allowNavigation: ['*'],
    ...(serverUrl ? { url: serverUrl, cleartext: true, androidScheme: 'http' } : {}),
  },
};

export default config;
