import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  outDir: "dist",
  target: "node18",
  platform: "node",
  external: [],
  onSuccess: async () => {
    // Copy drizzle migration files to dist
    const { execSync } = await import("node:child_process");
    execSync("cp -r src/drizzle dist/drizzle", { stdio: "inherit" });
  },
});
