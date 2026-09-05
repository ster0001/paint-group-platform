/**
 * Which hosts serve the marketing homepage at `/` (Tom, 5 Sep 2026: the
 * platform address paint-group-platform.vercel.app must keep its login page
 * at `/`; the website lives on new.paintgroup.com.au and, after the flip,
 * paintgroup.com.au). Everything else that hits `/` is sent to /login.
 * Local dev and the C1 test server (localhost) keep the homepage so the e2e
 * suites and Tom's phone walk keep working. Override with MARKETING_HOSTS
 * (comma-separated) in the environment.
 */
export const DEFAULT_MARKETING_HOSTS = ["new.paintgroup.com.au", "paintgroup.com.au", "www.paintgroup.com.au", "localhost", "127.0.0.1"];

export function marketingHosts(env = process.env.MARKETING_HOSTS): string[] {
  const list = (env ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  return list.length ? list : DEFAULT_MARKETING_HOSTS;
}

/** `host` as the browser sent it, with or without a port. */
export function isMarketingHost(host: string | null | undefined, env?: string): boolean {
  const bare = (host ?? "").toLowerCase().split(":")[0];
  return marketingHosts(env).includes(bare);
}
