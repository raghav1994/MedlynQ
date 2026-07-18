/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config, { isServer }) => {
    // `pg` (Postgres client, server-only) gets pulled into the client
    // bundle's dependency graph via mockData.ts's dynamic import inside
    // hydrateFromSupabase() — reachable from client components that import
    // patientMatch.ts, which imports the `patients` array from mockData.ts.
    // That code path never actually runs in the browser (hydrateFromSupabase
    // is only ever called from server components/API routes), so it's safe
    // to stub `pg` out of the client build rather than restructure the
    // import graph.
    // Disable webpack cache to prevent stale chunk errors on Windows dev servers
    config.cache = false;

    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        pg: false,
        "pg-connection-string": false,
        fs: false,
        dns: false,
        net: false,
        tls: false,
        "util/types": false,
        util: false,
      };
    }
    return config;
  },
};

export default nextConfig;
