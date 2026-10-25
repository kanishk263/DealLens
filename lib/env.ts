import "server-only";
import { z } from "zod";

/**
 * Server-side environment validation. Values are validated lazily at the integration boundary that
 * needs them so a missing optional secret (e.g. the service-role key) does not break unrelated pages.
 * Error messages name the variable but never print its value.
 */
const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
});

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
  SUPERADMIN_BOOTSTRAP_EMAIL: z.string().email().optional().or(z.literal("")),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
});

function describe(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
}

export function publicEnv() {
  const parsed = publicSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
  if (!parsed.success) {
    throw new Error(`Invalid Supabase configuration (${describe(parsed.error)}). See .env.example.`);
  }
  return parsed.data;
}

export function serverEnv() {
  const parsed = serverSchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || undefined,
    SUPERADMIN_BOOTSTRAP_EMAIL: process.env.SUPERADMIN_BOOTSTRAP_EMAIL || undefined,
    APP_BASE_URL: process.env.APP_BASE_URL || undefined,
  });
  if (!parsed.success) {
    throw new Error(`Invalid server configuration (${describe(parsed.error)}). See .env.example.`);
  }
  return parsed.data;
}

export function requireServiceRoleKey(): string {
  const key = serverEnv().SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured on the server.");
  return key;
}
