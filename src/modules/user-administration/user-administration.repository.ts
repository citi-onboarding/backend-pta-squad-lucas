import type { Database } from "../../shared/database/create-database.js";
import type {
  IssueOutcome,
  NewInvitation,
  NewUser,
  RegisterOutcome,
  StoredAccount,
  UserAdministrationStore,
} from "./user-administration.service.js";

const accountSelect = (now: Date) =>
  ({
    id: true,
    name: true,
    email: true,
    role: true,
    erpSellerName: true,
    lastLoginAt: true,
    passwordHash: true,
    invitations: {
      where: { usedAt: null, revokedAt: null, expiresAt: { gt: now } },
      orderBy: { expiresAt: "desc" },
      take: 1,
      select: { expiresAt: true },
    },
  }) as const;

interface AccountRow {
  id: string;
  name: string;
  email: string;
  role: StoredAccount["role"];
  erpSellerName: string | null;
  lastLoginAt: Date | null;
  passwordHash: string | null;
  invitations: { expiresAt: Date }[];
}

function toAccount(row: AccountRow): StoredAccount {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    erpSellerName: row.erpSellerName,
    lastLoginAt: row.lastLoginAt,
    hasPassword: row.passwordHash !== null,
    openInvitationExpiresAt: row.invitations[0]?.expiresAt ?? null,
  };
}

function uniqueViolationField(
  error: unknown,
): "email" | "erpSellerName" | null {
  if (
    !(error instanceof Error) ||
    !("code" in error) ||
    error.code !== "P2002"
  ) {
    return null;
  }
  const meta = JSON.stringify("meta" in error ? error.meta : {});
  return meta.includes("erp_seller_name") || meta.includes("erpSellerName")
    ? "erpSellerName"
    : "email";
}

type Transaction = Parameters<Parameters<Database["$transaction"]>[0]>[0];

// Issuing and accepting an invitation both take this lock before touching
// invitations, so they run one at a time per user and cannot deadlock.
async function lockUser(transaction: Transaction, userId: string) {
  await transaction.$queryRaw`
    SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE`;
}

class AlreadyActivated extends Error {}

export class UserAdministrationRepository implements UserAdministrationStore {
  constructor(private readonly database: Database) {}

  async listAccounts(now: Date): Promise<StoredAccount[]> {
    const rows = await this.database.user.findMany({
      select: accountSelect(now),
      orderBy: [{ name: "asc" }, { email: "asc" }],
    });
    return rows.map(toAccount);
  }

  async customerCarriesErpSellerName(name: string): Promise<boolean> {
    const customer = await this.database.customer.findFirst({
      where: { erpSellerName: name },
      select: { id: true },
    });
    return customer !== null;
  }

  async registerUser(
    user: NewUser,
    invitation: NewInvitation,
    now: Date,
  ): Promise<RegisterOutcome> {
    try {
      const row = await this.database.user.create({
        data: { ...user, invitations: { create: invitation } },
        select: accountSelect(now),
      });
      return { kind: "created", account: toAccount(row) };
    } catch (error) {
      const field = uniqueViolationField(error);
      if (field) {
        return { kind: "conflict", field };
      }
      throw error;
    }
  }

  issueInvitation(
    userId: string,
    invitation: NewInvitation,
  ): Promise<IssueOutcome> {
    return this.database.$transaction(async (transaction) => {
      await lockUser(transaction, userId);
      const user = await transaction.user.findUnique({
        where: { id: userId },
        select: { passwordHash: true },
      });
      if (!user) {
        return "not-found";
      }
      if (user.passwordHash !== null) {
        return "has-password";
      }
      await transaction.userInvitation.updateMany({
        where: { userId, usedAt: null, revokedAt: null },
        data: { revokedAt: invitation.createdAt },
      });
      await transaction.userInvitation.create({
        data: { ...invitation, userId },
      });
      return "issued";
    });
  }

  async findUsableInvitation(tokenDigest: string, now: Date) {
    const invitation = await this.database.userInvitation.findFirst({
      where: {
        tokenDigest,
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      select: {
        expiresAt: true,
        user: { select: { name: true, email: true } },
      },
    });
    return invitation
      ? {
          name: invitation.user.name,
          email: invitation.user.email,
          expiresAt: invitation.expiresAt,
        }
      : null;
  }

  async acceptInvitation(
    tokenDigest: string,
    passwordHash: string,
    now: Date,
  ): Promise<boolean> {
    return this.database
      .$transaction(async (transaction) => {
        const invitation = await transaction.userInvitation.findUnique({
          where: { tokenDigest },
          select: { userId: true },
        });
        if (!invitation) {
          return false;
        }
        await lockUser(transaction, invitation.userId);
        // Evaluated after the lock, so an invitation revoked meanwhile is refused.
        // One conditional update decides which concurrent request wins.
        const consumed = await transaction.$queryRaw<{ user_id: string }[]>`
        UPDATE "user_invitations" SET "used_at" = ${now}
        WHERE "token_digest" = ${tokenDigest}
          AND "used_at" IS NULL AND "revoked_at" IS NULL AND "expires_at" > ${now}
        RETURNING "user_id"`;
        const userId = consumed[0]?.user_id;
        if (!userId) {
          return false;
        }
        const updated = await transaction.user.updateMany({
          where: { id: userId, passwordHash: null },
          data: { passwordHash },
        });
        if (updated.count === 0) {
          // The user already has a password: undo the consumption.
          throw new AlreadyActivated();
        }
        return true;
      })
      .catch((error: unknown) => {
        if (error instanceof AlreadyActivated) {
          return false;
        }
        throw error;
      });
  }

  async listAvailableErpSellerNames(): Promise<string[]> {
    const rows = await this.database.$queryRaw<{ name: string }[]>`
      SELECT DISTINCT c."erp_seller_name" AS name
      FROM "customers" c
      WHERE c."erp_seller_name" ~ '[^[:space:]]'
        AND NOT EXISTS (
          SELECT 1 FROM "users" u WHERE u."erp_seller_name" = c."erp_seller_name"
        )
      ORDER BY 1`;
    return rows.map((row) => row.name);
  }
}
