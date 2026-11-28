import { describe, expect, it, vi } from "vitest";

import {
  AuthenticationService,
  type AuthenticationStore,
  type PasswordVerifier,
  type StoredUser,
} from "./authentication.service.js";

const PASSWORD = "unit-test-password";

const seller: StoredUser = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Unit Seller",
  email: "seller@example.test",
  role: "SELLER",
  erpSellerName: "Unit Seller",
  passwordHash: `hashed:${PASSWORD}`,
};

const identity = {
  id: seller.id,
  name: seller.name,
  email: seller.email,
  role: seller.role,
  erpSellerName: seller.erpSellerName,
};

// In-memory stand-ins for the external dependencies of the service.
function createService(
  verifyPassword: PasswordVerifier = (password, passwordHash) =>
    Promise.resolve(passwordHash === `hashed:${password}`),
) {
  const openSessions = new Map<string, string>();
  let openedSessions = 0;
  let issuedTokens = 0;

  const store: AuthenticationStore = {
    findUserByEmail: (email) =>
      Promise.resolve(email === seller.email ? seller : null),
    openSession: (userId, tokenDigest) => {
      openedSessions += 1;
      openSessions.set(tokenDigest, userId);
      return Promise.resolve();
    },
    renewActiveSession: (tokenDigest) =>
      Promise.resolve(openSessions.has(tokenDigest) ? identity : null),
    endActiveSession: (tokenDigest) =>
      Promise.resolve(openSessions.delete(tokenDigest)),
  };
  const service = new AuthenticationService(
    store,
    verifyPassword,
    {
      generate: () => `token-${String((issuedTokens += 1))}`,
      digest: (token) => `digest-of-${token}`,
    },
    () => new Date("2026-02-01T08:00:00.000Z"),
  );

  return {
    service,
    openSessions,
    openedSessions: () => openedSessions,
    issuedTokens: () => issuedTokens,
  };
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("Expected the promise to be rejected.");
    },
    (error: unknown) => error,
  );
}

describe("authentication service sign-in", () => {
  it("returns the identity without secrets and stores only the token digest", async () => {
    const { service, openSessions } = createService();

    const result = await service.signIn(seller.email, PASSWORD);

    expect(result).toEqual({ user: identity, accessToken: "token-1" });
    expect([...openSessions]).toEqual([["digest-of-token-1", seller.id]]);
  });

  it("keeps the second session active after signing out of the first", async () => {
    const { service, openedSessions } = createService();
    const first = await service.signIn(seller.email, PASSWORD);
    const second = await service.signIn(seller.email, PASSWORD);

    await service.signOut(first.accessToken);

    expect(openedSessions()).toBe(2);
    expect(second.accessToken).not.toBe(first.accessToken);
    await expect(service.identify(second.accessToken)).resolves.toEqual(
      identity,
    );
    await expect(service.identify(first.accessToken)).rejects.toMatchObject({
      status: 401,
    });
  });

  it("rejects an unknown email and a wrong password identically, opening no session", async () => {
    const { service, openedSessions, issuedTokens } = createService();

    const unknownEmail = await rejectionOf(
      service.signIn("nobody@example.test", PASSWORD),
    );
    const wrongPassword = await rejectionOf(
      service.signIn(seller.email, "wrong-password"),
    );

    const expected = {
      status: 401,
      title: "Unauthorized",
      message: "Email or password is incorrect.",
      type: "about:blank",
    };
    expect(unknownEmail).toMatchObject(expected);
    expect(wrongPassword).toMatchObject(expected);
    expect(openedSessions()).toBe(0);
    expect(issuedTokens()).toBe(0);
  });

  it("still compares the password against a bcrypt hash for an unknown email", async () => {
    const comparedHashes: string[] = [];
    let receivedSubmittedPassword = false;
    const verifyPassword = vi.fn((password: string, passwordHash: string) => {
      receivedSubmittedPassword = password === PASSWORD;
      comparedHashes.push(passwordHash);
      return Promise.resolve(false);
    });
    const { service, openedSessions } = createService(verifyPassword);

    await expect(
      service.signIn("nobody@example.test", PASSWORD),
    ).rejects.toMatchObject({ status: 401 });

    expect(verifyPassword).toHaveBeenCalledTimes(1);
    expect(receivedSubmittedPassword).toBe(true);
    // Cost 10 is the cost of the stored password hashes.
    expect(comparedHashes[0]).toMatch(/^\$2[aby]\$10\$[./A-Za-z0-9]{53}$/);
    expect(comparedHashes[0]).not.toBe(seller.passwordHash);
    expect(openedSessions()).toBe(0);
  });
});
