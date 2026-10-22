import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // DB test files share one database (and the engine tests truncate it), so run files sequentially.
  test: { environment: "node", fileParallelism: false, env: { DATABASE_URL: "postgres://postgres:dev@localhost:5433/sales_test" } },
});
