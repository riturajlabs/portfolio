// Resolve lazy chunks at build time, then config modulePreload
// to skip them.
const lazyChunks = ["markdown"];
module.exports = {
  build: {
    modulePreload: {
      polyfill: false,
      // Resolve all dynamic imports eagerly so the auto-injected
      // modulepreload tags cover them. But for known-lazy chunks
      // (loaded only on user interaction), we want to exclude them
      // from the critical-path preload list.
      resolveDependencies: async (_, deps) => {
        // Only preload the direct dependencies of the entry, not
        // their transitive chunks.
        const entryDeps = new Set();
        for (const dep of deps) {
          // Skip lazy chunks; their `import()` calls handle loading
          // separately and on-demand.
          if (lazyChunks.some((name) => dep.includes(`/${name}-`))) {
            continue;
          }
          entryDeps.add(dep);
        }
        return entryDeps;
      },
    },
  },
};