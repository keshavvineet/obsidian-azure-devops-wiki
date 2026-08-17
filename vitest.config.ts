import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      // Plugin modules import 'obsidian', which only exists inside the Obsidian runtime.
      obsidian: path.resolve(__dirname, "tests/stubs/obsidian.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
