import type { BrowserContext } from "@playwright/test";
import { sessionCookies } from "../support/session-cookies";
import type { TestUser } from "../integration/helpers";

/** Gives a browser context the genuine Supabase session cookies of a local test user. */
export async function signIn(context: BrowserContext, user: TestUser, baseURL: string) {
  await context.clearCookies();
  const host = new URL(baseURL).hostname;
  await context.addCookies((await sessionCookies(user.email, user.password)).map((c) => ({ ...c, domain: host, path: "/", sameSite: "Lax" as const })));
}
