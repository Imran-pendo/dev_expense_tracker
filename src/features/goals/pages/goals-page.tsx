import { useState } from "react";
import { format } from "date-fns";
import { Plus, Target } from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/shared/components/app-layout";
import { BpBox } from "@/shared/components/bp-box";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthContext } from "@/features/auth/hooks/auth-context";
import { changedFields, daysSince, daysUntil, round2, track, trackOnce } from "@/lib/analytics";
import { useGoals } from "../hooks/use-goals";
import { projectGoal } from "../lib/goal-projection";
import { GoalCard } from "../components/goal-card";
import { GoalFormDialog } from "../components/goal-form";
import { ContributionFormDialog } from "../components/contribution-form";
import { DeleteGoalDialog } from "../components/delete-goal-dialog";
import type { GoalFormValues, ContributionFormValues } from "../schemas/goal.schema";
import type { Goal } from "@/types";

// Matches the "% saved" shown on the goal card.
function progressPercent(goal: Goal): number {
  return Math.min(Math.round(projectGoal(goal).ratio * 100), 100);
}

export function GoalsPage() {
  const { workspace } = useAuthContext();
  const { goals, isLoading, addGoal, editGoal, removeGoal, contribute } = useGoals(workspace!.id);

  const [showForm, setShowForm] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [contributingGoal, setContributingGoal] = useState<Goal | null>(null);
  const [deletingGoal, setDeletingGoal] = useState<Goal | null>(null);

  const currency = workspace?.currency ?? "USD";
  const locale = workspace?.locale ?? "en-US";

  // Milestone: fires once per goal, the first time it reaches its target.
  function trackIfCompleted(before: Goal, after: Goal, completionTrigger: "contribution" | "target_lowered") {
    const projection = projectGoal(after);
    if (projectGoal(before).isComplete || !projection.isComplete) return;
    trackOnce(after.id, "savings_goal_completed", {
      goalId: after.id,
      targetAmount: after.targetAmount,
      totalSaved: round2(projection.saved),
      contributionCount: after.contributions.length,
      daysToComplete: daysSince(after.createdAt),
      hadDeadline: !!after.deadline,
      completedBeforeDeadline: after.deadline ? daysUntil(after.deadline) >= 0 : undefined,
      completionTrigger,
      currency,
    });
  }

  async function handleAdd(values: GoalFormValues) {
    try {
      const goal = await addGoal({
        workspaceId: workspace!.id,
        name: values.name,
        targetAmount: values.targetAmount,
        deadline: values.deadline || undefined,
        color: values.color,
      });
      // The goal name is free text, so it isn't sent.
      track("savings_goal_created", {
        goalId: goal.id,
        targetAmount: goal.targetAmount,
        currency,
        hasDeadline: !!goal.deadline,
        daysUntilDeadline: goal.deadline ? daysUntil(goal.deadline) : undefined,
        color: goal.color,
        existingGoalCount: goals.length,
      });
      setShowForm(false);
      toast.success("Goal created");
    } catch {
      toast.error("Failed to create goal");
    }
  }

  async function handleEdit(values: GoalFormValues) {
    if (!editingGoal) return;
    try {
      const updated: Goal = {
        ...editingGoal,
        name: values.name,
        targetAmount: values.targetAmount,
        deadline: values.deadline || undefined,
        color: values.color,
      };
      await editGoal(updated);
      // Diff against the deadline the form was initialized with (it reformats the stored value).
      const before: Goal = {
        ...editingGoal,
        deadline: editingGoal.deadline ? format(new Date(editingGoal.deadline), "yyyy-MM-dd") : undefined,
      };
      track("savings_goal_updated", {
        goalId: updated.id,
        changedFields: changedFields(before, updated, ["name", "targetAmount", "deadline", "color"]),
        previousTargetAmount: editingGoal.targetAmount,
        targetAmount: updated.targetAmount,
        hasDeadline: !!updated.deadline,
        progressPercent: progressPercent(updated),
      });
      trackIfCompleted(editingGoal, updated, "target_lowered");
      setEditingGoal(null);
      toast.success("Goal updated");
    } catch {
      toast.error("Failed to update goal");
    }
  }

  async function handleContribute(values: ContributionFormValues) {
    if (!contributingGoal) return;
    try {
      const updated = await contribute(contributingGoal.id, {
        amount: values.amount,
        date: values.date,
        note: values.note || undefined,
      });
      track("savings_goal_contribution_added", {
        goalId: updated.id,
        contributionAmount: values.amount,
        currency,
        hasNote: !!values.note?.trim(),
        isBackdated: daysUntil(values.date) < 0,
        contributionCount: updated.contributions.length,
        totalSaved: round2(projectGoal(updated).saved),
        targetAmount: updated.targetAmount,
        progressPercent: progressPercent(updated),
      });
      trackIfCompleted(contributingGoal, updated, "contribution");
      setContributingGoal(null);
      toast.success("Contribution added");
    } catch {
      toast.error("Failed to add contribution");
    }
  }

  async function handleDelete() {
    if (!deletingGoal) return;
    try {
      await removeGoal(deletingGoal.id);
      // Progress at deletion: incomplete means abandoned, complete means clean-up.
      const projection = projectGoal(deletingGoal);
      track("savings_goal_deleted", {
        goalId: deletingGoal.id,
        targetAmount: deletingGoal.targetAmount,
        totalSaved: round2(projection.saved),
        progressPercent: progressPercent(deletingGoal),
        contributionCount: deletingGoal.contributions.length,
        wasCompleted: projection.isComplete,
        goalAgeDays: daysSince(deletingGoal.createdAt),
      });
      setDeletingGoal(null);
      toast.success("Goal deleted");
    } catch {
      toast.error("Failed to delete goal");
    }
  }

  return (
    <AppLayout
      title="Goals"
      actions={
        <Button onClick={() => setShowForm(true)} size="sm">
          <Plus data-icon="inline-start" />
          New Goal
        </Button>
      }
    >
      {isLoading ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-64 w-full" />
          ))}
        </div>
      ) : goals.length === 0 ? (
        <BpBox className="stagger-item">
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
            <Target className="size-6 text-muted-foreground/40" />
            <p className="font-mono text-[11px] tracking-wider uppercase text-muted-foreground/60">
              No savings goals yet
            </p>
            <p className="text-sm text-muted-foreground max-w-sm">
              Create a goal like &ldquo;Vacation: $2,000&rdquo;, add money toward it, and track your
              projected completion date.
            </p>
            <Button size="sm" className="mt-2" onClick={() => setShowForm(true)}>
              <Plus data-icon="inline-start" />
              Create your first goal
            </Button>
          </div>
        </BpBox>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {goals.map((goal, idx) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              currency={currency}
              locale={locale}
              index={idx}
              onContribute={setContributingGoal}
              onEdit={setEditingGoal}
              onDelete={setDeletingGoal}
            />
          ))}
        </div>
      )}

      {showForm && (
        <GoalFormDialog open={showForm} onSubmit={handleAdd} onCancel={() => setShowForm(false)} />
      )}
      {editingGoal && (
        <GoalFormDialog
          open={!!editingGoal}
          defaultValues={editingGoal}
          onSubmit={handleEdit}
          onCancel={() => setEditingGoal(null)}
        />
      )}
      {contributingGoal && (
        <ContributionFormDialog
          goal={contributingGoal}
          onSubmit={handleContribute}
          onCancel={() => setContributingGoal(null)}
        />
      )}

      <DeleteGoalDialog
        open={!!deletingGoal}
        name={deletingGoal?.name ?? ""}
        onConfirm={handleDelete}
        onCancel={() => setDeletingGoal(null)}
      />
    </AppLayout>
  );
}
