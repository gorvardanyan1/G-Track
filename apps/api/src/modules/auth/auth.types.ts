import type { UserRole } from '@tempo/shared';

export interface AuthContext {
  userId: string;
  role: UserRole;
  /** Session family of the access token; null for a 2FA setup token. */
  sessionId: string | null;
  /** True when authenticated with a 2FA setup token: only the 2FA setup routes accept it. */
  setupOnly: boolean;
}
