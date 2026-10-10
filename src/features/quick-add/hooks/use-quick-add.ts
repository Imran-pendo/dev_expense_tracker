import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { track } from "@/lib/analytics";
import { createTransaction, getTransactionsByWorkspaceId } from "@/lib/db/repositories/transactions.repo";
import { getCategoriesByWorkspaceId } from "@/lib/db/repositories/categories.repo";
import { notifyBudgetThreshold } from "@/features/transactions/hooks/use-transactions";
import { emitDataChanged } from "@/shared/lib/data-events";
import { parseQuickAdd, type ParsedQuickAdd } from "../lib/parser";
import type { Category, Transaction } from "@/types";

/** How the palette was opened. Pendo can't auto-capture ⌘/Ctrl+K since there's no click. */
export type QuickAddOpenMethod = "keyboard_shortcut" | "button";

/** Context reported with Quick Add track events. */
interface QuickAddTrackingContext {
  openMethod: QuickAddOpenMethod;
  currency: string;
}

export interface UseQuickAddReturn {
  input: string;
  setInput: (value: string) => void;
  parsed: ParsedQuickAdd;
  categories: Category[];
  /** User-selected category override (wins over inference). */
  overrideCategory: Category | null;
  setOverrideCategory: (category: Category | null) => void;
  effectiveCategory: Category | null;
  isSaving: boolean;
  canSave: boolean;
  save: () => Promise<void>;
}

export function useQuickAdd(
  workspaceId: string,
  open: boolean,
  { openMethod, currency }: QuickAddTrackingContext
): UseQuickAddReturn {
  const [input, setInput] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [overrideCategory, setOverrideCategory] = useState<Category | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const wasOpenRef = useRef(open);
  // Entries saved since the palette opened (it stays open for rapid entry).
  const entriesThisSessionRef = useRef(0);

  // Lazy-load history on first open; reset the input each time it opens.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset each time the palette opens
    setInput("");
    setOverrideCategory(null);
    if (hasLoaded) return;
    (async () => {
      const [txs, cats] = await Promise.all([
        getTransactionsByWorkspaceId(workspaceId),
        getCategoriesByWorkspaceId(workspaceId),
      ]);
      setTransactions(txs);
      setCategories(cats);
      setHasLoaded(true);
    })();
  }, [open, hasLoaded, workspaceId]);

  const parsed = useMemo(
    () => parseQuickAdd(input, { categories, transactions }),
    [input, categories, transactions]
  );

  const effectiveCategory = overrideCategory ?? parsed.category;
  const canSave = parsed.amount !== null && effectiveCategory !== null && !isSaving;

  // On open, start a new entry count. On close (Esc, ⌘/Ctrl+K or click outside)
  // with unsaved input, record what the parser understood, never the text itself.
  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = open;
    if (open && !wasOpen) {
      entriesThisSessionRef.current = 0;
    } else if (!open && wasOpen && input.trim() !== "" && !isSaving) {
      track("quick_add_abandoned", {
        hadAmount: parsed.amount !== null,
        hadCategory: effectiveCategory !== null,
        canSave,
        dateExplicit: parsed.dateExplicit,
        typeExplicit: parsed.typeExplicit,
        inputLength: input.trim().length,
        entriesSavedThisSession: entriesThisSessionRef.current,
        openMethod,
      });
    }
  }, [open, input, parsed, effectiveCategory, canSave, isSaving, openMethod]);

  const save = useCallback(async () => {
    if (parsed.amount === null || !effectiveCategory) return;
    setIsSaving(true);
    try {
      const now = new Date().toISOString();
      const type = overrideCategory
        ? overrideCategory.scope === "income"
          ? "income"
          : overrideCategory.scope === "expense"
            ? "expense"
            : parsed.type
        : parsed.type;
      const tx: Transaction = {
        id: crypto.randomUUID(),
        workspaceId,
        type,
        amount: parsed.amount,
        categoryId: effectiveCategory.id,
        description: parsed.description || effectiveCategory.name,
        date: parsed.date,
        isRecurring: false,
        notes: "",
        createdAt: now,
        updatedAt: now,
      };
      await createTransaction(tx);
      await notifyBudgetThreshold(workspaceId, tx, transactions, categories, "quick_add");
      // Keep local history fresh so the next entry's inference sees this one.
      setTransactions((prev) => [tx, ...prev]);
      entriesThisSessionRef.current += 1;
      track("quick_add_transaction_created", {
        transactionId: tx.id,
        source: "quick_add",
        type: tx.type,
        amount: tx.amount,
        currency,
        categoryId: tx.categoryId,
        categoryName: effectiveCategory.name,
        // Inference found no match and fell back to the "Other …" default.
        categoryGuessed: overrideCategory === null && parsed.categoryGuessed,
        categoryOverridden: overrideCategory !== null,
        dateExplicit: parsed.dateExplicit,
        typeExplicit: parsed.typeExplicit,
        openMethod,
        entriesThisSession: entriesThisSessionRef.current,
        historySize: transactions.length,
        isFirstTransaction: transactions.length === 0,
      });
      setInput("");
      setOverrideCategory(null);
      emitDataChanged();
      toast.success(`Added: ${tx.description}`);
    } catch {
      toast.error("Failed to add transaction");
    } finally {
      setIsSaving(false);
    }
  }, [parsed, effectiveCategory, overrideCategory, workspaceId, transactions, categories, currency, openMethod]);

  return {
    input,
    setInput,
    parsed,
    categories,
    overrideCategory,
    setOverrideCategory,
    effectiveCategory,
    isSaving,
    canSave,
    save,
  };
}
