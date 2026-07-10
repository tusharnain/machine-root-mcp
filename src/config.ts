import { z } from "zod";

const EnvSchema = z.object({
  PORT:        z.coerce.number().int().positive().default(3100),
  BASE_URL:    z.string().optional(),
  MCP_DB_PATH: z.string().default("./data/local-mcp.db"),
  LOG_LEVEL:   z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  NODE_ENV:    z.enum(["development", "production", "test"]).default("development"),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment variables:\n", parsed.error.issues);
  process.exit(1);
}

export const env = parsed.data;
export const BASE_URL = env.BASE_URL ?? `http://localhost:${env.PORT}`;
