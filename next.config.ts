import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    // This deployment is the stakeholder demo (D-008, D-067): the demo layer is on unless a build
    // sets NEXT_PUBLIC_DEMO_MODE=false (a real rollout, or `npm run check:demo`). The default lives
    // here, not only in .env.production, so a Vercel build from git (where no .env file is committed)
    // still ships the demo. Inlined at build time, so a `false` build still tree-shakes src/demo.
    NEXT_PUBLIC_DEMO_MODE: process.env.NEXT_PUBLIC_DEMO_MODE ?? 'true',
  },
  poweredByHeader: false,
  // Lets scripts/check-demo-stripped.mjs build a second variant without touching .next.
  distDir: process.env.KSK_DIST_DIR || '.next',
  images: { formats: ['image/avif', 'image/webp'] },
  async headers() {
    return [
      {
        // Camera (face check), location (geo-fence) and microphone (Voice Agent, D-078) are used by this origin only;
        // nothing else is.
        source: '/:path*',
        headers: [{ key: 'Permissions-Policy', value: 'camera=(self), geolocation=(self), microphone=(self)' }],
      },
      {
        // Versioned paths (public/vendor/mediapipe/<version>/, public/models/<name>): safe to cache for a year.
        source: '/vendor/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/models/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ];
  },
  async redirects() {
    return [
      // Offline data moved under Reports (D-056); old links keep working.
      { source: '/profile/offline', destination: '/reports/offline', permanent: false },
      { source: '/profile/offline/download', destination: '/reports/offline/download', permanent: false },
      // Profile is no longer a page: it opens from the header avatar on every screen (D-046).
      { source: '/profile', destination: '/home', permanent: false },
    ];
  },
};

export default nextConfig;
