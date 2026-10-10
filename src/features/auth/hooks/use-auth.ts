import { useCallback, useEffect, useState } from "react";
import { differenceInDays } from "date-fns";
import { hashPassword, verifyPassword } from "@/lib/crypto";
import { getDB } from "@/lib/db/client";
import { createUser, getUserByUsername } from "@/lib/db/repositories/users.repo";
import { getWorkspacesByUserId } from "@/lib/db/repositories/workspaces.repo";
import { clearSession, getSession, saveSession } from "@/lib/session";
import { pendo } from "@/shared/lib/pendo";
import type { Session, User, Workspace } from "@/types";

export type AuthFailureReason = "username_taken" | "user_not_found" | "invalid_password";

// Carries a machine-readable reason for analytics; the message shown in the UI
// stays deliberately generic (sign-in never reveals whether a username exists).
export class AuthError extends Error {
  readonly reason: AuthFailureReason;

  constructor(message: string, reason: AuthFailureReason) {
    super(message);
    this.name = "AuthError";
    this.reason = reason;
  }
}

interface AuthState {
  user: User | null;
  workspace: Workspace | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  hasWorkspace: boolean;
}

interface AuthActions {
  signUp: (username: string, displayName: string, password: string) => Promise<void>;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => void;
  setActiveWorkspace: (workspace: Workspace) => void;
  refreshUser: () => Promise<void>;
}

export function useAuth(): AuthState & AuthActions {
  const [user, setUser] = useState<User | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadSession = useCallback(async () => {
    const session = getSession();
    if (!session) {
      setIsLoading(false);
      return;
    }

    try {
      const db = await getDB();
      const storedUser = await db.get("users", session.userId);
      if (!storedUser) {
        clearSession();
        setIsLoading(false);
        return;
      }
      setUser(storedUser);

      if (session.workspaceId) {
        const storedWorkspace = await db.get("workspaces", session.workspaceId);
        if (storedWorkspace) setWorkspace(storedWorkspace);
      }
    } catch {
      clearSession();
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- existing session-restore-on-mount pattern
    loadSession();
  }, [loadSession]);

  const signUp = useCallback(async (username: string, displayName: string, password: string) => {
    const existing = await getUserByUsername(username);
    if (existing) throw new AuthError("Username is already taken", "username_taken");

    const { hash, salt } = await hashPassword(password);
    const initials = displayName
      .split(" ")
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);

    const newUser: User = {
      id: crypto.randomUUID(),
      username,
      displayName,
      avatarInitials: initials,
      passwordHash: hash,
      salt,
      createdAt: new Date().toISOString(),
    };

    await createUser(newUser);
    setUser(newUser);
    const session: Session = { userId: newUser.id, workspaceId: "" };
    saveSession(session);

    // Activation funnel step 1. Username/display name are PII and not sent.
    pendo.track("user_signed_up", {
      userId: newUser.id,
      createdAt: newUser.createdAt,
    });
  }, []);

  const signIn = useCallback(async (username: string, password: string) => {
    const storedUser = await getUserByUsername(username);
    if (!storedUser) throw new AuthError("Invalid username or password", "user_not_found");

    const valid = await verifyPassword(password, storedUser.passwordHash, storedUser.salt);
    if (!valid) throw new AuthError("Invalid username or password", "invalid_password");

    setUser(storedUser);
    const workspaces = await getWorkspacesByUserId(storedUser.id);
    const activeWorkspace = workspaces[0] ?? null;
    setWorkspace(activeWorkspace);

    const session: Session = {
      userId: storedUser.id,
      workspaceId: activeWorkspace?.id ?? "",
    };
    saveSession(session);

    // Explicit sign-ins only; the session restore in loadSession is not tracked.
    pendo.track("user_signed_in", {
      userId: storedUser.id,
      workspaceId: activeWorkspace?.id ?? "",
      hasWorkspace: activeWorkspace !== null,
      workspaceCount: workspaces.length,
      daysSinceSignUp: differenceInDays(new Date(), new Date(storedUser.createdAt)),
    });
  }, []);

  const signOut = useCallback(() => {
    clearSession();
    setUser(null);
    setWorkspace(null);
  }, []);

  const setActiveWorkspace = useCallback((ws: Workspace) => {
    setWorkspace(ws);
    const session = getSession();
    if (session) {
      saveSession({ ...session, workspaceId: ws.id });
    }
  }, []);

  const refreshUser = useCallback(async () => {
    if (!user) return;
    const db = await getDB();
    const updated = await db.get("users", user.id);
    if (updated) setUser(updated);
  }, [user]);

  return {
    user,
    workspace,
    isLoading,
    isAuthenticated: !!user,
    hasWorkspace: !!workspace,
    signUp,
    signIn,
    signOut,
    setActiveWorkspace,
    refreshUser,
  };
}
