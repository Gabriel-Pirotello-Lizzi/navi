import vinext from "vinext";
import { defineConfig, loadEnv } from "vite";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

export default defineConfig(async ({ mode }) => {
  const publicEnv = loadEnv(mode, process.cwd(), "VITE_");
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    // Vinext's Cloudflare runtime reads `.env.local` on the server, but its
    // client bundle needs these two safe, public Supabase values at build time.
    // Keeping the values in the ignored env file means they never enter Git.
    define: {
      "import.meta.env.VITE_NAVI_SUPABASE_URL": JSON.stringify(
        publicEnv.VITE_NAVI_SUPABASE_URL ?? "",
      ),
      "import.meta.env.VITE_NAVI_SUPABASE_ANON_KEY": JSON.stringify(
        publicEnv.VITE_NAVI_SUPABASE_ANON_KEY ?? "",
      ),
    },
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: { main: "./worker/index.ts", compatibility_flags: ["nodejs_compat"] },
      }),
    ],
  };
});
