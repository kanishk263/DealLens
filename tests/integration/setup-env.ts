import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env.test", override: true });

// Integration tests create and delete users and data. Refuse to run against anything but a local stack.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url) && process.env.ALLOW_NON_LOCAL_TESTS !== "true") {
  throw new Error(`Integration tests only run against a local Supabase stack (got ${url ? "a non-local URL" : "no URL"}).`);
}
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
