import { RESET_PASSWORD_PATH } from "@/lib/auth/adminPassword";

/**
 * The Team invite's email (Tom, 11 Oct 2026: "no prompt to set a password
 * when they click the link"). A login the invite CREATED has a random
 * password nobody knows, so its link lands on "Choose a new password" and
 * the person can sign in with a password from then on. A login that already
 * existed keeps its password: its link just signs them in to the workspace.
 */
export function inviteEmail(madeTheLogin: boolean): { subject: string; intro: string; buttonLabel: string; next?: string } {
  if (madeTheLogin) {
    return {
      subject: "You've been added to your team's Paint Group workspace",
      intro: "Your organisation set you up with access — properties, colours and progress, all in one place.\n\nOpen the link, choose a password, and you're in. Next time, sign in with your email and that password.",
      buttonLabel: "Choose a password",
      next: RESET_PASSWORD_PATH,
    };
  }
  return {
    subject: "You've been added to your team's Paint Group workspace",
    intro: "Your organisation added you to its workspace — properties, colours and progress, all in one place. Sign in as you always do; this link opens it now.",
    buttonLabel: "Open your workspace",
  };
}
