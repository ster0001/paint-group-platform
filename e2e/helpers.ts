import { expect, type Page } from "@playwright/test";

export type Credentials = { email: string; password: string };

/** Reads a login from the environment. Null when it isn't configured. */
export type Who = "CONTRACTOR" | "STAFF" | "CUSTOMER";

export function credentials(who: Who): Credentials | null {
  const email = process.env[`E2E_${who}_EMAIL`];
  const password = process.env[`E2E_${who}_PASSWORD`];
  return email && password ? { email, password } : null;
}

export const missingCreds = (who: Who) =>
  `set E2E_${who}_EMAIL and E2E_${who}_PASSWORD to run this`;

/**
 * Sign in through the real form. Deliberately not a cookie-injection shortcut:
 * login and role routing are themselves part of what these tests cover.
 */
export async function signIn(page: Page, creds: Credentials, expectPath: RegExp) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(creds.email);
  await page.getByLabel("Password").fill(creds.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(expectPath, { timeout: 20_000 });
}

export async function signOutIfPossible(page: Page) {
  const button = page.getByRole("button", { name: /sign out/i });
  if (await button.count()) await button.first().click();
}
