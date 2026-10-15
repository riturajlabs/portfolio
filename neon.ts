import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  // Declare your Neon services here
  auth: false,
  buckets: {
    // Project cover images are public assets of the site: they are baked into
    // the static build as stable <img src> URLs, so the bucket must allow
    // anonymous reads. `public_read` is that switch; the object key (not the
    // bytes) is what Postgres stores.
    //
    // NOTE: a bucket's access level is fixed at creation. The policy engine
    // reconciles existence, not visibility, so a bucket created private (the
    // default `uploads` bucket from `neon init`) cannot be flipped here — a new
    // bucket is declared instead.
    media: { access: "public_read" },
  },
  // Branch policy: per-branch tuning
  branch: (branch) => {
    if (branch.isDefault) {
      // Default branch: no overrides, uses project defaults
      return {};
    }
    if (!branch.exists) {
      // New non-default branches: auto-expire
      // Run `neon checkout <name>` to create a new branch with these settings
      return { ttl: "7d" };
    }
    // Existing branch: no changes
    return {};
  },
});
