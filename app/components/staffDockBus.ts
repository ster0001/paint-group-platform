/**
 * Open the staff chat dock on one estimate's thread from anywhere in the app
 * (payments-merge Step 4: Payments → Message). The dock listens; the caller
 * supplies the drafts. Nothing here sends — a person presses Send in the dock.
 */
export type DockPreset = { key: string; label: string; text: string };
export type OpenEstimateChatDetail = {
  estimateId: string;
  who: string;
  phone: string | null;
  accountId: string | null;
  /** The invoice the message chases — logged against it on send. */
  invoiceId: string | null;
  presets: DockPreset[];
  selected: string;
};

export const OPEN_ESTIMATE_CHAT = "pg:open-estimate-chat";

export function openEstimateChat(detail: OpenEstimateChatDetail): void {
  window.dispatchEvent(new CustomEvent<OpenEstimateChatDetail>(OPEN_ESTIMATE_CHAT, { detail }));
}
