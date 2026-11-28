import { HttpProblem } from "../../shared/http/problem.js";
import type { SessionIdentity } from "./authentication.schemas.js";

// Public dummy hash of a discarded random value, with the cost of stored password
// hashes. Compared for unknown emails so they cost the same as a wrong password.
const DUMMY_PASSWORD_HASH =
  "$2b$10$uhyW.2ogxKmvww11lP6HeuTKDMUskGCUdxkLsfFmgrGGAuQUAjV8a";

export interface StoredUser extends SessionIdentity {
  passwordHash: string;
}

export interface AuthenticationStore {
  findUserByEmail(email: string): Promise<StoredUser | null>;
  openSession(userId: string, tokenDigest: string, now: Date): Promise<void>;
  // Both act only on a session that is not ended and was last used strictly
  // after idleSince, and never move its last use backwards.
  renewActiveSession(
    tokenDigest: string,
    now: Date,
    idleSince: Date,
  ): Promise<SessionIdentity | null>;
  endActiveSession(
    tokenDigest: string,
    now: Date,
    idleSince: Date,
  ): Promise<boolean>;
}

export type Clock = () => Date;

const IDLE_LIMIT_MS = 8 * 60 * 60 * 1000;

function idleCutoff(now: Date): Date {
  return new Date(now.getTime() - IDLE_LIMIT_MS);
}

export type PasswordVerifier = (
  plainPassword: string,
  passwordHash: string,
) => Promise<boolean>;

export interface SessionTokens {
  generate(): string;
  digest(token: string): string;
}

export function invalidCredentials(): HttpProblem {
  return new HttpProblem(
    401,
    "Unauthorized",
    "Email or password is incorrect.",
  );
}

export function authenticationRequired(): HttpProblem {
  return new HttpProblem(401, "Unauthorized", "Authentication is required.");
}

export class AuthenticationService {
  constructor(
    private readonly store: AuthenticationStore,
    private readonly verifyPassword: PasswordVerifier,
    private readonly tokens: SessionTokens,
    private readonly clock: Clock,
  ) {}

  async signIn(email: string, password: string) {
    const user = await this.store.findUserByEmail(email);
    const passwordMatches = await this.verifyPassword(
      password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );
    // An absent user is always rejected, whatever the comparison returned.
    if (!user || !passwordMatches) {
      throw invalidCredentials();
    }
    const accessToken = this.tokens.generate();
    await this.store.openSession(
      user.id,
      this.tokens.digest(accessToken),
      this.clock(),
    );
    const identity: SessionIdentity = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      erpSellerName: user.erpSellerName,
    };
    return { user: identity, accessToken };
  }

  async identify(token: string): Promise<SessionIdentity> {
    const now = this.clock();
    const user = await this.store.renewActiveSession(
      this.tokens.digest(token),
      now,
      idleCutoff(now),
    );
    if (!user) throw authenticationRequired();
    return user;
  }

  async signOut(token: string): Promise<void> {
    const now = this.clock();
    const ended = await this.store.endActiveSession(
      this.tokens.digest(token),
      now,
      idleCutoff(now),
    );
    if (!ended) throw authenticationRequired();
  }
}
