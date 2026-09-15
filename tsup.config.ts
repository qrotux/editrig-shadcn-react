import { copyFile } from "node:fs/promises";

import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "react-router": "src/react-router.ts",
  },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  // The consumer's Tailwind scans dist for utility classes; minification would
  // still keep class strings intact, but readable output is easier to debug.
  minify: false,
  // The optional default theme is a hand-written CSS file, not a bundler entry;
  // copy it into dist so it publishes and resolves as ./theme.css. Runs after
  // both `build` and `prepare` (install-from-git), which is why it lives here
  // rather than in a shell step only `build` would run.
  onSuccess: async () => {
    await copyFile("src/theme.css", "dist/theme.css");
  },
});
