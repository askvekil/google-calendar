import { describe, expect, it } from "vitest";
import { RuntimeVault } from "../runtime-vault";

describe("Google Calendar Runtime vault", () => {
  it("encrypts purpose-bound payloads without leaving plaintext in the envelope", () => {
    const vault = new RuntimeVault(Buffer.alloc(32, 9));
    const encrypted = vault.encrypt(
      {
        accessToken: "sensitive-access-token",
        refreshToken: "sensitive-refresh-token"
      },
      "google-calendar:credential:installation-1"
    );

    expect(encrypted).not.toContain("sensitive-access-token");
    expect(encrypted).not.toContain("sensitive-refresh-token");
    expect(vault.decrypt(encrypted, "google-calendar:credential:installation-1")).toEqual({
      accessToken: "sensitive-access-token",
      refreshToken: "sensitive-refresh-token"
    });
    expect(() => vault.decrypt(encrypted, "google-calendar:credential:installation-2")).toThrow();
  });
});
