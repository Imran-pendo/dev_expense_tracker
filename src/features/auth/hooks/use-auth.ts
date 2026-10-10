import { useCallback, useEffect, useState } from "react";
import { daysSince, identify, track } from "@/lib/analytics";
import { hashPassword, verifyPassword } from "@/lib/crypto";
import { getDB } from "@/lib/db/client";
import { createUser, getUserByUsername } from "@/lib/db/repositories/users.repo";
import { getWorkspacesByUserId } from "@/lib/db/repositories/workspaces.repo";
import { clearSession, getSession, saveSession } from "@/lib/session";
import type { Session, User, Workspace } from "@/types";

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

export const USERNAME_TAKEN_ERROR = "Username is already taken";

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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional session restore on mount
    loadSession();
  }, [loadSession]);

  const signUp = useCallback(async (username: string, displayName: string, password: string) => {
    const existing = await getUserByUsername(username);
    if (existing) throw new Error(USERNAME_TAKEN_ERROR);

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
    // Identify first so the event belongs to the new visitor, not the anonymous one.
    identify(newUser.id);
    track("user_signed_up", { signUpMethod: "local", createdAt: newUser.createdAt });
  }, []);

  const signIn = useCallback(async (username: string, password: string) => {
    const storedUser = await getUserByUsername(username);
    if (!storedUser) throw new Error("Invalid username or password");

    const valid = await verifyPassword(password, storedUser.passwordHash, storedUser.salt);
    if (!valid) throw new Error("Invalid username or password");

    setUser(storedUser);
    const workspaces = await getWorkspacesByUserId(storedUser.id);
    const activeWorkspace = workspaces[0] ?? null;
    setWorkspace(activeWorkspace);

    const session: Session = {
      userId: storedUser.id,
      workspaceId: activeWorkspace?.id ?? "",
    };
    saveSession(session);
    identify(storedUser.id, activeWorkspace?.id);
    // Tracked here rather than in SignInPage, whose hasWorkspace is stale until this resolves.
    track("user_signed_in", {
      hasWorkspace: activeWorkspace !== null,
      workspaceCount: workspaces.length,
      daysSinceSignUp: daysSince(storedUser.createdAt),
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
