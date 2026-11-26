import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "./password.js";

const plainPassword = "test-password";

describe("password hashing", () => {
  it("never returns the plain password as the hash", async () => {
    const passwordHash = await hashPassword(plainPassword);

    expect(passwordHash).not.toBe(plainPassword);
  });

  it("verifies the plain password against its hash", async () => {
    const passwordHash = await hashPassword(plainPassword);

    expect(await verifyPassword(plainPassword, passwordHash)).toBe(true);
  });

  it("rejects a different password against the hash", async () => {
    const passwordHash = await hashPassword(plainPassword);

    expect(await verifyPassword("wrong-password", passwordHash)).toBe(false);
  });
});
