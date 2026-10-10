import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { differenceInSeconds, parseISO } from "date-fns";
import { BpBox } from "@/shared/components/bp-box";
import { identify, track } from "@/lib/analytics";
import { createWorkspace } from "@/lib/db/repositories/workspaces.repo";
import { seedDefaultCategories } from "@/lib/db/repositories/categories.repo";
import { useAuthContext } from "@/features/auth/hooks/auth-context";
import {
  DEFAULT_CURRENCY,
  DEFAULT_LOCALE,
  WorkspaceSetupForm,
  type WorkspaceFormValues,
} from "../components/workspace-setup-form";
import type { Workspace } from "@/types";

export function WorkspaceSetupPage() {
  const { user, workspace: existingWorkspace, setActiveWorkspace } = useAuthContext();
  const navigate = useNavigate();

  async function handleSubmit(values: WorkspaceFormValues) {
    if (!user) return;
    try {
      const workspace: Workspace = {
        id: crypto.randomUUID(),
        userId: user.id,
        name: values.name,
        currency: values.currency,
        locale: values.locale,
        createdAt: new Date().toISOString(),
      };
      await createWorkspace(workspace);
      const defaultCategoryCount = await seedDefaultCategories(workspace.id);
      setActiveWorkspace(workspace);
      // The new workspace is the Pendo account for this and later events.
      identify(user.id, workspace.id);
      track("workspace_setup_completed", {
        currency: workspace.currency,
        locale: workspace.locale,
        usedDefaultCurrency: workspace.currency === DEFAULT_CURRENCY,
        usedDefaultLocale: workspace.locale === DEFAULT_LOCALE,
        defaultCategoryCount,
        secondsSinceSignUp: differenceInSeconds(new Date(), parseISO(user.createdAt)),
        // Returning users can be routed here again after sign-in; flag their extra
        // workspaces so they don't inflate onboarding completions.
        hadExistingWorkspace: existingWorkspace !== null,
      });
      navigate("/", { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create workspace");
    }
  }

  return (
    <div className="min-h-svh bg-background flex flex-col items-center justify-center p-12">
      <div className="mb-10 flex flex-col items-center gap-1 section-enter">
        <span className="font-mono text-[11px] tracking-[0.35em] uppercase text-muted-foreground">
          — Ledger —
        </span>
        <p className="font-mono text-[10px] text-muted-foreground/60 tracking-wider">
          One more step
        </p>
      </div>

      <BpBox className="w-full max-w-[380px] section-enter" style={{ animationDelay: "40ms" }}>
        <div className="border-b border-foreground px-5 py-3 flex items-center justify-between">
          <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
            Workspace Setup
          </span>
          <span className="font-mono text-[10px] text-muted-foreground/40">step 2/2</span>
        </div>

        <div className="p-5">
          <WorkspaceSetupForm onSubmit={handleSubmit} />
        </div>
      </BpBox>
    </div>
  );
}
