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
  ...(serverUrl
    ? {
        server: {
          url: serverUrl,
          cleartext: true,
          androidScheme: 'http',
          // Keep OAuth flow inside the WebView. Without this, the WebView
          // punts off-origin navigations (the PDS authorize page) to Chrome,
          // which sets the session cookie in the wrong jar and the app stays
          // logged out. '*' is fine for dev; production should narrow this.
          allowNavigation: ['*'],
        },
      }
    : {}),
};

export default config;
