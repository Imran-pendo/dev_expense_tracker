import { useState } from "react";
import { differenceInCalendarDays, differenceInDays, format, parseISO } from "date-fns";
import { Plus, Target } from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/shared/components/app-layout";
import { BpBox } from "@/shared/components/bp-box";
import { pendo } from "@/shared/lib/pendo";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthContext } from "@/features/auth/hooks/auth-context";
import { useGoals } from "../hooks/use-goals";
import { projectGoal } from "../lib/goal-projection";
import { GoalCard } from "../components/goal-card";
import { GoalFormDialog } from "../components/goal-form";
import { ContributionFormDialog } from "../components/contribution-form";
import { DeleteGoalDialog } from "../components/delete-goal-dialog";
import type { GoalFormValues, ContributionFormValues } from "../schemas/goal.schema";
import type { Goal } from "@/types";

// Same rounding and cap as the "N% saved" figure on GoalCard.
function toProgressPercent(ratio: number): number {
  return Math.min(Math.round(ratio * 100), 100);
}

// Fields compared to build savings_goal_updated's changedFields.
const EDITABLE_GOAL_FIELDS = ["name", "targetAmount", "deadline", "color"] as const;

export function GoalsPage() {
  const { workspace } = useAuthContext();
  const { goals, isLoading, addGoal, editGoal, removeGoal, contribute } = useGoals(workspace!.id);

  const [showForm, setShowForm] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [contributingGoal, setContributingGoal] = useState<Goal | null>(null);
  const [deletingGoal, setDeletingGoal] = useState<Goal | null>(null);

  const currency = workspace?.currency ?? "USD";
  const locale = workspace?.locale ?? "en-US";

  async function handleAdd(values: GoalFormValues) {
    const existingGoalCount = goals.length;
    try {
      const goal = await addGoal({
        workspaceId: workspace!.id,
        name: values.name,
        targetAmount: values.targetAmount,
        deadline: values.deadline || undefined,
        color: values.color,
      });
      // The goal name is free text and is not sent.
      pendo.track("savings_goal_created", {
        goalId: goal.id,
        targetAmount: goal.targetAmount,
        currency,
        hasDeadline: !!goal.deadline,
        // parseISO keeps the yyyy-MM-dd deadline in local time.
        daysUntilDeadline: goal.deadline
          ? differenceInCalendarDays(parseISO(goal.deadline), new Date())
          : null,
        color: goal.color,
        isFirstGoal: existingGoalCount === 0,
        goalCount: existingGoalCount + 1,
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
      const changedFields = EDITABLE_GOAL_FIELDS.filter((field) => editingGoal[field] !== updated[field]);
      pendo.track("savings_goal_updated", {
        goalId: editingGoal.id,
        changedFields: changedFields.join(","),
        previousTargetAmount: editingGoal.targetAmount,
        targetAmount: updated.targetAmount,
        hasDeadline: !!updated.deadline,
        deadlineChanged: changedFields.includes("deadline"),
        progressPercent: toProgressPercent(projectGoal(updated).ratio),
      });
      setEditingGoal(null);
      toast.success("Goal updated");
    } catch {
      toast.error("Failed to update goal");
    }
  }

  async function handleContribute(values: ContributionFormValues) {
    if (!contributingGoal) return;
    try {
      const before = projectGoal(contributingGoal);
      const updatedGoal = await contribute(contributingGoal.id, {
        amount: values.amount,
        date: values.date,
        note: values.note || undefined,
      });
      const after = projectGoal(updatedGoal);
      pendo.track("goal_contribution_added", {
        goalId: updatedGoal.id,
        contributionAmount: values.amount,
        currency,
        contributionCount: updatedGoal.contributions.length,
        savedAmount: after.saved,
        targetAmount: updatedGoal.targetAmount,
        progressPercent: toProgressPercent(after.ratio),
        hasNote: !!values.note,
        isBackdated: values.date < format(new Date(), "yyyy-MM-dd"),
        // GoalCard needs 2+ contributions before it can project a completion date.
        projectionAvailable: after.projectedDate !== undefined,
        onTrack: after.onTrack ?? null,
      });
      // Milestone: only the contribution that crosses the target fires this,
      // not later contributions to a goal that is already complete.
      if (!before.isComplete && after.isComplete) {
        pendo.track("savings_goal_reached", {
          goalId: updatedGoal.id,
          targetAmount: updatedGoal.targetAmount,
          contributionCount: updatedGoal.contributions.length,
          daysToComplete: differenceInDays(new Date(), new Date(updatedGoal.createdAt)),
          hadDeadline: !!updatedGoal.deadline,
          metDeadline: updatedGoal.deadline ? values.date <= updatedGoal.deadline : null,
        });
      }
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
      // wasCompleted separates cleaning up a finished goal from abandoning one.
      const projection = projectGoal(deletingGoal);
      pendo.track("savings_goal_deleted", {
        goalId: deletingGoal.id,
        targetAmount: deletingGoal.targetAmount,
        savedAmount: projection.saved,
        progressPercent: toProgressPercent(projection.ratio),
        contributionCount: deletingGoal.contributions.length,
        wasCompleted: projection.isComplete,
        hadDeadline: !!deletingGoal.deadline,
        goalAgeDays: differenceInDays(new Date(), new Date(deletingGoal.createdAt)),
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
