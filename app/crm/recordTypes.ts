/** Shared vocab for the record's writes — importable from client and server. */
export const LOG_KINDS = ["call_no_answer", "voicemail", "call_connected", "email_logged", "sms_logged", "note_added"] as const;
export type LogKind = (typeof LOG_KINDS)[number];

export const CONTACT_ROLES = ["partner", "tenant", "agent", "site", "accounts", "other"] as const;
