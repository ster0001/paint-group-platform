/**
 * The decision `scripts/import/release-to-tray.ts check` prints for each
 * imported work order — the same one the RPC `import_release_to_tray`
 * (migration 20270185) makes, so `check` shows exactly what `run` will do.
 */
export const LIVE_OFFER_STATES = ["offered", "proposed", "accepted"] as const;

export type ReleaseFacts = {
  stage: string;
  contractor_id: string | null;
  start_date: string | null;
  hasLiveOffer: boolean;
};

export type ReleasePlan = "release" | `skip:${string}`;

export function planRelease(f: ReleaseFacts): ReleasePlan {
  if (f.stage !== "pre_start") return `skip:${f.stage}`;
  if (f.contractor_id !== null || f.start_date !== null || f.hasLiveOffer) return "skip:booked";
  return "release";
}
