import { describe, expect, it } from "vitest";
import { inviteEmail } from "./teamInvite";
import { RESET_PASSWORD_PATH } from "@/lib/auth/adminPassword";

describe("Team invite email", () => {
  it("a login the invite made lands on Choose a password", () => {
    const e = inviteEmail(true);
    expect(e.next).toBe(RESET_PASSWORD_PATH);
    expect(e.buttonLabel).toBe("Choose a password");
  });

  it("an existing login keeps its password: the link just opens the workspace", () => {
    const e = inviteEmail(false);
    expect(e.next).toBeUndefined();
    expect(e.buttonLabel).toBe("Open your workspace");
  });
});
