import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Writer worktrees live under worktrees/ and hold a full copy of this suite.
    // Without this they would be collected as well: once as ours, once as theirs.
    exclude: ["**/node_modules/**", "worktrees/**"],
  },
});
