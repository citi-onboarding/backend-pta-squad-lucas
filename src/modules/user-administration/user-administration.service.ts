import { HttpProblem } from "../../shared/http/problem.js";

export type Role = "SELLER" | "MANAGER" | "FINANCE" | "ADMIN";
export type AccountStatus = "ACTIVE" | "INVITED" | "INVITATION_EXPIRED";

export interface StoredAccount {
  id: string;
  name: string;
  email: string;
  role: Role;
  erpSellerName: string | null;
  lastLoginAt: Date | null;
  hasPassword: boolean;
  // Expiry of the invitation that can still be accepted, if any.
  openInvitationExpiresAt: Date | null;
}

export interface NewInvitation {
  tokenDigest: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface NewUser {
  name: string;
  email: string;
  role: Role;
  erpSellerName: string | null;
}

export type RegisterOutcome =
  | { kind: "created"; account: StoredAccount }
  | { kind: "conflict"; field: "email" | "erpSellerName" };

export type IssueOutcome = "issued" | "not-found" | "has-password";

export interface UserAdministrationStore {
  listAccounts(now: Date): Promise<StoredAccount[]>;
  customerCarriesErpSellerName(name: string): Promise<boolean>;
  registerUser(
    user: NewUser,
    invitation: NewInvitation,
    now: Date,
  ): Promise<RegisterOutcome>;
  issueInvitation(
    userId: string,
    invitation: NewInvitation,
  ): Promise<IssueOutcome>;
  listAvailableErpSellerNames(): Promise<string[]>;
  findUsableInvitation(
    tokenDigest: string,
    now: Date,
  ): Promise<{ name: string; email: string; expiresAt: Date } | null>;
  // Consumes the invitation and sets the password in one transaction; false
  // when the invitation is not usable at `now`.
  acceptInvitation(
    tokenDigest: string,
    passwordHash: string,
    now: Date,
  ): Promise<boolean>;
}

export type PasswordHasher = (plainPassword: string) => Promise<string>;

export interface InvitationTokens {
  generate(): string;
  digest(token: string): string;
}

export type Clock = () => Date;

export const INVITATION_LIFETIME_MS = 48 * 60 * 60 * 1000;

export function statusOf(account: StoredAccount): AccountStatus {
  if (account.hasPassword) {
    return "ACTIVE";
  }
  return account.openInvitationExpiresAt ? "INVITED" : "INVITATION_EXPIRED";
}

export class UserAdministrationService {
  constructor(
    private readonly store: UserAdministrationStore,
    private readonly tokens: InvitationTokens,
    private readonly clock: Clock,
    private readonly hashPassword: PasswordHasher,
  ) {}

  async listUsers() {
    return (await this.store.listAccounts(this.clock())).map(toListItem);
  }

  async registerUser(input: {
    name: string;
    email: string;
    role: Role;
    erpSellerName?: string | undefined;
  }) {
    const erpSellerName = input.erpSellerName ?? null;
    if (
      erpSellerName !== null &&
      !(await this.store.customerCarriesErpSellerName(erpSellerName))
    ) {
      throw new HttpProblem(
        400,
        "Validation Error",
        "No synchronized customer carries this ERP seller name.",
      );
    }
    const { invitation, token } = this.newInvitation();
    const outcome = await this.store.registerUser(
      { name: input.name, email: input.email, role: input.role, erpSellerName },
      invitation,
      invitation.createdAt,
    );
    if (outcome.kind === "conflict") {
      throw new HttpProblem(
        409,
        "Conflict",
        outcome.field === "email"
          ? "A user with this email already exists."
          : "This ERP seller name is already linked to a user.",
        "about:blank",
        { conflictField: outcome.field },
      );
    }
    return {
      user: toListItem(outcome.account),
      invitation: { token, expiresAt: invitation.expiresAt.toISOString() },
    };
  }

  async issueInvitation(userId: string) {
    const { invitation, token } = this.newInvitation();
    const outcome = await this.store.issueInvitation(userId, invitation);
    if (outcome === "not-found") {
      throw new HttpProblem(404, "Not Found", "User was not found.");
    }
    if (outcome === "has-password") {
      throw new HttpProblem(
        409,
        "Conflict",
        "This user already has a password.",
      );
    }
    return { token, expiresAt: invitation.expiresAt.toISOString() };
  }

  listAvailableErpSellerNames() {
    return this.store.listAvailableErpSellerNames();
  }

  async lookupInvitation(token: string) {
    const invitation = await this.store.findUsableInvitation(
      this.tokens.digest(token),
      this.clock(),
    );
    if (!invitation) {
      throw unusableInvitation();
    }
    return {
      name: invitation.name,
      email: invitation.email,
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }

  // The password is already validated: a refused request never reaches here.
  async acceptInvitation(token: string, password: string) {
    const passwordHash = await this.hashPassword(password);
    const accepted = await this.store.acceptInvitation(
      this.tokens.digest(token),
      passwordHash,
      this.clock(),
    );
    if (!accepted) {
      throw unusableInvitation();
    }
  }

  private newInvitation() {
    const createdAt = this.clock();
    const token = this.tokens.generate();
    return {
      token,
      invitation: {
        tokenDigest: this.tokens.digest(token),
        createdAt,
        expiresAt: new Date(createdAt.getTime() + INVITATION_LIFETIME_MS),
      },
    };
  }
}

function unusableInvitation() {
  return new HttpProblem(
    404,
    "Not Found",
    "Invitation link is invalid or expired.",
  );
}

function toListItem(account: StoredAccount) {
  const status = statusOf(account);
  return {
    id: account.id,
    name: account.name,
    email: account.email,
    role: account.role,
    erpSellerName: account.erpSellerName,
    lastLoginAt: account.lastLoginAt?.toISOString() ?? null,
    status,
    invitationExpiresAt:
      status === "INVITED"
        ? (account.openInvitationExpiresAt?.toISOString() ?? null)
        : null,
  };
}
