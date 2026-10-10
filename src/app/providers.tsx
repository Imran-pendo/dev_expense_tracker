import { useCallback, useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthContext } from "@/features/auth/hooks/auth-context";
import { useAuth } from "@/features/auth/hooks/use-auth";

interface ProvidersProps {
  children: React.ReactNode;
}

function AuthProvider({ children }: ProvidersProps) {
  const auth = useAuth();
  const { user, workspace, isLoading, signOut } = auth;

  // Identify the signed-in user with Pendo, and their active workspace as the
  // account. Re-runs on sign-in, sign-up, session restore, workspace setup and
  // profile/workspace edits, so the metadata stays current.
  useEffect(() => {
    if (isLoading || !user) return;

    pendo.identify({
      visitor: {
        id: user.id,
        full_name: user.displayName,
        username: user.username,
        createdAt: user.createdAt,
        workspaceId: workspace?.id ?? "",
      },
      // A new user has no workspace until onboarding step 2, so the account is
      // only sent once one exists.
      ...(workspace && {
        account: {
          id: workspace.id,
          name: workspace.name,
          currency: workspace.currency,
          locale: workspace.locale,
          createdAt: workspace.createdAt,
        },
      }),
    });
  }, [isLoading, user, workspace]);

  // Reset Pendo to a fresh anonymous visitor on sign-out so the next user on
  // this device is not tracked under the previous user's identity.
  const signOutAndResetPendo = useCallback(() => {
    signOut();
    pendo.clearSession?.();
  }, [signOut]);

  return (
    <AuthContext.Provider value={{ ...auth, signOut: signOutAndResetPendo }}>
      {children}
    </AuthContext.Provider>
  );
}

export function Providers({ children }: ProvidersProps) {
  return (
    <TooltipProvider>
      <AuthProvider>
        {children}
        <Toaster richColors position="top-right" />
      </AuthProvider>
    </TooltipProvider>
  );
}
