import { useCallback, useEffect, useState } from "react";
import {
  addContribution,
  createGoal,
  deleteGoal,
  getGoalsByWorkspaceId,
  updateGoal,
} from "@/lib/db/repositories/goals.repo";
import { useDataChanged } from "@/shared/lib/data-events";
import type { Goal, GoalContribution } from "@/types";

export interface UseGoalsReturn {
  goals: Goal[];
  isLoading: boolean;
  addGoal: (goal: Omit<Goal, "id" | "contributions" | "createdAt" | "updatedAt">) => Promise<Goal>;
  editGoal: (goal: Goal) => Promise<void>;
  removeGoal: (id: string) => Promise<void>;
  /** Resolves with the goal as saved, including the new contribution. */
  contribute: (goalId: string, contribution: Omit<GoalContribution, "id">) => Promise<Goal>;
  reload: () => Promise<void>;
}

export function useGoals(workspaceId: string): UseGoalsReturn {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const reload = useCallback(async () => {
    setIsLoading(true);
    try {
      setGoals(await getGoalsByWorkspaceId(workspaceId));
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional load on mount
    reload();
  }, [reload]);

  useDataChanged(reload);

  const addGoal = useCallback(
    async (goal: Omit<Goal, "id" | "contributions" | "createdAt" | "updatedAt">) => {
      const now = new Date().toISOString();
      const created: Goal = {
        ...goal,
        id: crypto.randomUUID(),
        contributions: [],
        createdAt: now,
        updatedAt: now,
      };
      await createGoal(created);
      await reload();
      return created;
    },
    [reload]
  );

  const editGoal = useCallback(
    async (goal: Goal) => {
      await updateGoal(goal);
      await reload();
    },
    [reload]
  );

  const removeGoal = useCallback(
    async (id: string) => {
      await deleteGoal(id);
      await reload();
    },
    [reload]
  );

  const contribute = useCallback(
    async (goalId: string, contribution: Omit<GoalContribution, "id">) => {
      const updated = await addContribution(goalId, { ...contribution, id: crypto.randomUUID() });
      await reload();
      return updated;
    },
    [reload]
  );

  return { goals, isLoading, addGoal, editGoal, removeGoal, contribute, reload };
}
