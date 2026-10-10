import { useCallback, useEffect, useState } from "react";
import {
  createTransaction,
  deleteTransaction,
  getTransactionsByWorkspaceId,
  updateTransaction,
} from "@/lib/db/repositories/transactions.repo";
import { toast } from "sonner";
import { getCategoriesByWorkspaceId } from "@/lib/db/repositories/categories.repo";
import { getBudgetsByWorkspaceId } from "@/lib/db/repositories/budgets.repo";
import { checkBudgetThresholds } from "@/features/budgets/lib/budget-alerts";
import { useDataChanged } from "@/shared/lib/data-events";
import { pendo } from "@/shared/lib/pendo";
import type { Category, Transaction } from "@/types";

export type BudgetAlertTriggerSource = "transaction_form_add" | "transaction_form_edit" | "quick_add";

export async function notifyBudgetThreshold(
  workspaceId: string,
  tx: Pick<Transaction, "type" | "categoryId" | "amount" | "date">,
  priorTransactions: Transaction[],
  categories: Category[],
  triggerSource: BudgetAlertTriggerSource
): Promise<void> {
  if (tx.type !== "expense") return;
  const budgets = await getBudgetsByWorkspaceId(workspaceId);
  const alert = checkBudgetThresholds(tx, budgets, priorTransactions);
  if (!alert) return;
  const categoryName = categories.find((c) => c.id === alert.categoryId)?.name ?? "Category";
  const percent = Math.round((alert.spent / alert.monthlyLimit) * 100);
  // checkBudgetThresholds only returns an alert when this transaction crosses
  // a threshold, so later expenses already past it don't fire again.
  pendo.track("budget_threshold_alert_triggered", {
    alertLevel: alert.level,
    categoryId: alert.categoryId,
    categoryName,
    percentUsed: percent,
    spent: alert.spent,
    monthlyLimit: alert.monthlyLimit,
    triggerSource,
  });
  if (alert.level === "over") {
    toast.error(`Budget exceeded: ${categoryName} is at ${percent}% of its monthly limit`);
  } else {
    toast.warning(`Heads up: ${categoryName} is at ${percent}% of its monthly budget`);
  }
}

export interface TransactionWithCategory extends Transaction {
  categoryName: string;
  categoryColor: string;
}

export interface UseTransactionsReturn {
  transactions: TransactionWithCategory[];
  categories: Category[];
  isLoading: boolean;
  addTransaction: (tx: Omit<Transaction, "id" | "createdAt" | "updatedAt">) => Promise<Transaction>;
  editTransaction: (tx: Transaction) => Promise<void>;
  removeTransaction: (id: string) => Promise<void>;
  reload: () => Promise<void>;
}

export function useTransactions(workspaceId: string): UseTransactionsReturn {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const reload = useCallback(async () => {
    setIsLoading(true);
    try {
      const [txs, cats] = await Promise.all([
        getTransactionsByWorkspaceId(workspaceId),
        getCategoriesByWorkspaceId(workspaceId),
      ]);
      setTransactions(txs);
      setCategories(cats);
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- existing load-on-mount pattern
    reload();
  }, [reload]);

  useDataChanged(reload);

  const categoryMap = new Map(categories.map((c) => [c.id, c]));

  const transactionsWithCategory: TransactionWithCategory[] = transactions.map((t) => {
    const cat = categoryMap.get(t.categoryId);
    return {
      ...t,
      categoryName: cat?.name ?? "Uncategorized",
      categoryColor: cat?.color ?? "#6b7280",
    };
  });

  const addTransaction = useCallback(
    async (tx: Omit<Transaction, "id" | "createdAt" | "updatedAt">) => {
      const now = new Date().toISOString();
      const full: Transaction = { ...tx, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
      await createTransaction(full);
      await notifyBudgetThreshold(workspaceId, full, transactions, categories, "transaction_form_add");
      await reload();
      return full;
    },
    [workspaceId, transactions, categories, reload]
  );

  const editTransaction = useCallback(
    async (tx: Transaction) => {
      const updated: Transaction = { ...tx, updatedAt: new Date().toISOString() };
      await updateTransaction(updated);
      // Exclude the pre-edit version so the threshold check sees the change.
      const priorWithoutTx = transactions.filter((t) => t.id !== tx.id);
      await notifyBudgetThreshold(workspaceId, updated, priorWithoutTx, categories, "transaction_form_edit");
      await reload();
    },
    [workspaceId, transactions, categories, reload]
  );

  const removeTransaction = useCallback(
    async (id: string) => {
      await deleteTransaction(id);
      await reload();
    },
    [reload]
  );

  return {
    transactions: transactionsWithCategory,
    categories,
    isLoading,
    addTransaction,
    editTransaction,
    removeTransaction,
    reload,
  };
}
