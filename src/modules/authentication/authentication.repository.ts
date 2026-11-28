import type { Database } from "../../shared/database/create-database.js";
import type {
  AuthenticationStore,
  StoredUser,
} from "./authentication.service.js";
import type { SessionIdentity } from "./authentication.schemas.js";

const identitySelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  erpSellerName: true,
} as const;

export class AuthenticationRepository implements AuthenticationStore {
  constructor(private readonly database: Database) {}

  findUserByEmail(email: string): Promise<StoredUser | null> {
    return this.database.user.findUnique({
      where: { email },
      select: { ...identitySelect, passwordHash: true },
    });
  }

  async openSession(
    userId: string,
    tokenDigest: string,
    now: Date,
  ): Promise<void> {
    await this.database.$transaction([
      this.database.session.create({
        data: { userId, tokenDigest, createdAt: now, lastUsedAt: now },
      }),
      // Only moves forward: a concurrent, older sign-in that commits last
      // must not overwrite a newer last login date.
      this.database.user.updateMany({
        where: {
          id: userId,
          OR: [{ lastLoginAt: null }, { lastLoginAt: { lt: now } }],
        },
        data: { lastLoginAt: now },
      }),
    ]);
  }

  // Raw SQL because Prisma cannot express GREATEST. A single statement checks,
  // renews and reads; under a concurrent update PostgreSQL reevaluates it on the
  // newest row. The columns hold UTC without a time zone, hence the conversion.
  async renewActiveSession(
    tokenDigest: string,
    now: Date,
    idleSince: Date,
  ): Promise<SessionIdentity | null> {
    const rows = await this.database.$queryRaw<SessionIdentity[]>`
      UPDATE "sessions" AS s
      SET "last_used_at" = GREATEST(
        s."last_used_at",
        ${now.toISOString()}::timestamptz AT TIME ZONE 'UTC'
      )
      FROM "users" AS u
      WHERE u."id" = s."user_id"
        AND s."token_digest" = ${tokenDigest}
        AND s."ended_at" IS NULL
        AND s."last_used_at" >
          ${idleSince.toISOString()}::timestamptz AT TIME ZONE 'UTC'
      RETURNING u."id", u."name", u."email", u."role"::text AS "role",
        u."erp_seller_name" AS "erpSellerName"
    `;
    return rows[0] ?? null;
  }

  async endActiveSession(
    tokenDigest: string,
    now: Date,
    idleSince: Date,
  ): Promise<boolean> {
    const count = await this.database.$executeRaw`
      UPDATE "sessions"
      SET "last_used_at" = GREATEST(
          "last_used_at",
          ${now.toISOString()}::timestamptz AT TIME ZONE 'UTC'
        ),
        "ended_at" = ${now.toISOString()}::timestamptz AT TIME ZONE 'UTC'
      WHERE "token_digest" = ${tokenDigest}
        AND "ended_at" IS NULL
        AND "last_used_at" >
          ${idleSince.toISOString()}::timestamptz AT TIME ZONE 'UTC'
    `;
    return count > 0;
  }
}
