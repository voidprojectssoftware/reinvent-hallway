// drizzle-kit reads only the entities directory (the Drizzle table models).
// Generate with `npm run db:generate -- <name>` from the root, which names the
// migration; drizzle-kit alone picks random words.
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/persistence/d1/entities",
  out: "../../migrations",
});
