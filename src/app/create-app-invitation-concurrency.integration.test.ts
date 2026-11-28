import { createHash, randomBytes } from "node:crypto";

import request from "supertest";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { userData } from "../../tests/support/data-factories.js";
import {
  startTestDatabase,
  type TestDatabase,
} from "../../tests/support/test-database.js";
import { createTestEnvironment } from "../../tests/support/test-environment.js";
import type { ErpSyncService } from "../modules/erp-sync/erp-sync.service.js";
import {
  createInvitationToken,
  digestInvitationToken,
} from "../modules/user-administration/invitation-token.js";
import { UserAdministrationRepository } from "../modules/user-administration/user-administration.repository.js";
import { UserAdministrationService } from "../modules/user-administration/user-administration.service.js";
import { createApp } from "./create-app.js";

// A race does not show on every attempt, so each one is repeated.
const ROUNDS = 20;
const PARALLEL_ISSUES = 5;

let testDatabase: TestDatabase;
let adminId: string;

beforeAll(async () => {
  testDatabase = await startTestDatabase();
});

afterAll(async () => {
  await testDatabase?.stop();
});

beforeEach(async () => {
  const { database } = testDatabase;
  await database.$executeRawUnsafe('TRUNCATE TABLE "users" CASCADE');
  const admin = await database.user.create({
    data: userData({ role: "ADMIN" as const }),
  });
  adminId = admin.id;
});

// A new app per round keeps each round under the global rate limit.
function buildApp() {
  return createApp({
    database: testDatabase.database,
    environment: createTestEnvironment({
      DATABASE_URL: testDatabase.databaseUrl,
    }),
    // The ERP service is an external boundary and is never called here.
    erpSyncService: { startRun: vi.fn() } as unknown as ErpSyncService,
  });
}

async function adminToken(): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await testDatabase.database.session.create({
    data: {
      userId: adminId,
      tokenDigest: createHash("sha256").update(token).digest("hex"),
      lastUsedAt: new Date(),
    },
  });
  return token;
}

// The real service and repository on PostgreSQL. Only password hashing is
// instant: with bcrypt the acceptance always reaches the database after a
// concurrent issue has finished, so the two transactions never overlap.
function buildService() {
  return new UserAdministrationService(
    new UserAdministrationRepository(testDatabase.database),
    { generate: createInvitationToken, digest: digestInvitationToken },
    () => new Date(),
    () => Promise.resolve("instant-test-hash"),
  );
}

function usableInvitationCount(userId: string) {
  return testDatabase.database.userInvitation.count({
    where: {
      userId,
      usedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
}

describe("concurrent invitation requests with PostgreSQL", () => {
  it("leaves exactly one usable invitation after concurrent new invitations", async () => {
    const usablePerRound: number[] = [];

    for (let round = 0; round < ROUNDS; round += 1) {
      const app = buildApp();
      const user = await testDatabase.database.user.create({
        data: userData({ passwordHash: null }),
      });
      const tokens = [];
      for (let index = 0; index < PARALLEL_ISSUES; index += 1) {
        tokens.push(await adminToken());
      }

      const responses = await Promise.all(
        tokens.map((token) =>
          request(app)
            .post(`/api/v1/users/${user.id}/invitations`)
            .set("Authorization", `Bearer ${token}`),
        ),
      );

      expect(responses.map(({ status }) => status)).toEqual(
        tokens.map(() => 201),
      );
      usablePerRound.push(await usableInvitationCount(user.id));
    }

    expect(usablePerRound).toEqual(Array.from({ length: ROUNDS }, () => 1));
  });

  it("never leaves a usable invitation when a new one races an acceptance", async () => {
    const service = buildService();
    const violations: string[] = [];

    for (let round = 0; round < ROUNDS; round += 1) {
      const registered = await service.registerUser({
        name: `Invited ${String(round)}`,
        email: `race-${String(round)}@example.test`,
        role: "MANAGER",
      });
      const userId = registered.user.id;

      const [acceptance, issue] = await Promise.allSettled([
        service.acceptInvitation(registered.invitation.token, "password-123"),
        service.issueInvitation(userId),
      ]);

      const { passwordHash } =
        await testDatabase.database.user.findUniqueOrThrow({
          where: { id: userId },
        });
      const usable = await usableInvitationCount(userId);
      const acceptanceWon =
        acceptance.status === "fulfilled" &&
        issue.status === "rejected" &&
        (issue.reason as { status?: number }).status === 409 &&
        passwordHash !== null &&
        usable === 0;
      const issueWon =
        issue.status === "fulfilled" &&
        acceptance.status === "rejected" &&
        (acceptance.reason as { status?: number }).status === 404 &&
        passwordHash === null &&
        usable === 1;
      if (!acceptanceWon && !issueWon) {
        violations.push(
          `round ${String(round)}: acceptance ${acceptance.status}, issue ${issue.status}, password ${passwordHash === null ? "unset" : "set"}, usable ${String(usable)}`,
        );
      }
    }

    expect(violations).toEqual([]);
  });
});
