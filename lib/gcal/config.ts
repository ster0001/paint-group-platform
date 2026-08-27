// Client-safe shapes for the Google Calendar sync — deliberately secret-free,
// same split as lib/myob/config.ts. Server code lives in oauth.ts / sync.ts.

/** What the portal Calendar card needs to render — never includes the token. */
export type GcalStatus =
  | { kind: "unconfigured" }
  | { kind: "not_connected" }
  | { kind: "connected"; email: string | null; connectedAt: string }
  | { kind: "error"; email: string | null; message: string };
