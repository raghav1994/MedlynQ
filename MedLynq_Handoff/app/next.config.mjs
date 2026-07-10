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
    // import graph. `resolve.fallback` only polyfills/no-ops Node CORE
    // modules (fs, tls, net, ...) — it doesn't apply to real npm packages
    // like `pg`, so it silently did nothing and `pg` (and its `tls`
    // requirement) still got traced into the client bundle. `resolve.alias`
    // is the correct mechanism for excluding an actual package.
    if (!isServer) {
      config.resolve.alias = { ...config.resolve.alias, pg: false };
    }
    return config;
  },
};

export default nextConfig;
