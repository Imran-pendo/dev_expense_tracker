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
  const { isLoading, user, workspace, signOut } = auth;

  // Identify the signed-in user to Pendo once the stored session has loaded,
  // and again whenever their profile or active workspace changes. This covers
  // sign-in, sign-up, session restore and workspace setup or edits.
  useEffect(() => {
    if (isLoading || !user) return;

    const visitor = {
      id: user.id,
      full_name: user.displayName,
      username: user.username,
      createdAt: user.createdAt,
    };

    // The active workspace is the Pendo account. A new user has none until
    // they finish workspace setup, so it is attached once it exists.
    if (!workspace) {
      pendo.identify({ visitor });
      return;
    }

    pendo.identify({
      visitor: { ...visitor, workspaceId: workspace.id },
      account: {
        id: workspace.id,
        name: workspace.name,
        currency: workspace.currency,
        locale: workspace.locale,
        createdAt: workspace.createdAt,
      },
    });
  }, [isLoading, user, workspace]);

  // Every sign-out goes through this context value. Reset Pendo to a fresh
  // anonymous visitor so the next person to sign in on this device is not
  // tracked as the previous user. clearSession only exists once the agent
  // script has loaded, so a blocked agent can never break signing out.
  const handleSignOut = useCallback(() => {
    signOut();
    pendo.clearSession?.();
  }, [signOut]);

  return (
    <AuthContext.Provider value={{ ...auth, signOut: handleSignOut }}>
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
