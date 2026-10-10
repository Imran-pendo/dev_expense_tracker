import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { differenceInDays, format } from "date-fns";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/shared/components/app-layout";
import { pendo } from "@/shared/lib/pendo";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuthContext } from "@/features/auth/hooks/auth-context";
import { useTransactions } from "../hooks/use-transactions";
import { TransactionTable } from "../components/transaction-table";
import { TransactionForm } from "../components/transaction-form";
import { TransactionFiltersBar, type TransactionFilters } from "../components/transaction-filters";
import { DeleteTransactionDialog } from "../components/delete-transaction-dialog";
import { useAttachments } from "../hooks/use-attachments";
import { getAttachmentCounts } from "@/lib/db/repositories/attachments.repo";
import type { TransactionWithCategory } from "../hooks/use-transactions";
import type { TransactionFormValues } from "../schemas/transaction.schema";
import type { Transaction } from "@/types";

// Search updates on every keystroke; only report the filter state the user settles on.
const FILTER_TRACKING_DEBOUNCE_MS = 750;

// Fields compared to build transaction_updated's changedFields.
const EDITABLE_TRANSACTION_FIELDS = [
  "type",
  "amount",
  "categoryId",
  "description",
  "date",
  "isRecurring",
  "notes",
] as const;

export function TransactionsPage() {
  const { workspace } = useAuthContext();
  const { transactions, categories, isLoading, addTransaction, editTransaction, removeTransaction } =
    useTransactions(workspace!.id);

  const [showForm, setShowForm] = useState(false);
  const [editingTx, setEditingTx] = useState<TransactionWithCategory | null>(null);
  const [deletingTx, setDeletingTx] = useState<TransactionWithCategory | null>(null);
  const [attachmentCounts, setAttachmentCounts] = useState<Map<string, number>>(new Map());

  // Staged receipts for the add flow (no transaction id yet) and live
  // receipts for the edit flow.
  const addAttachments = useAttachments(workspace!.id, null);
  const editAttachments = useAttachments(workspace!.id, editingTx?.id ?? null);

  // Keyed on a stable string: `transactions` is a fresh array each render,
  // and depending on it directly would re-run this effect forever.
  const transactionIdsKey = transactions.map((t) => t.id).join(",");
  const refreshAttachmentCounts = useCallback(async () => {
    if (!transactionIdsKey) {
      setAttachmentCounts(new Map());
      return;
    }
    setAttachmentCounts(await getAttachmentCounts(transactionIdsKey.split(",")));
  }, [transactionIdsKey]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- existing load-on-mount pattern
    refreshAttachmentCounts();
  }, [refreshAttachmentCounts]);
  const [filters, setFilters] = useState<TransactionFilters>({
    search: "",
    type: "all",
    categoryId: "",
    month: "",
  });

  const currency = workspace?.currency ?? "USD";
  const locale = workspace?.locale ?? "en-US";

  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      if (filters.search && !tx.description.toLowerCase().includes(filters.search.toLowerCase())) return false;
      if (filters.type !== "all" && tx.type !== filters.type) return false;
      if (filters.categoryId && tx.categoryId !== filters.categoryId) return false;
      if (filters.month) {
        const txMonth = tx.date.slice(0, 7);
        if (txMonth !== filters.month) return false;
      }
      return true;
    });
  }, [transactions, filters]);

  // Debounced, and only for filter states that haven't been reported yet:
  // reloads that change the counts (e.g. after adding a transaction) must not
  // re-fire for a filter the user already applied.
  const resultsCount = filteredTransactions.length;
  const totalCount = transactions.length;
  const lastTrackedFiltersRef = useRef<TransactionFilters | null>(null);
  useEffect(() => {
    const activeFilterCount = [
      filters.search !== "",
      filters.type !== "all",
      filters.categoryId !== "",
      filters.month !== "",
    ].filter(Boolean).length;
    if (activeFilterCount === 0 || lastTrackedFiltersRef.current === filters) return;

    const timer = setTimeout(() => {
      lastTrackedFiltersRef.current = filters;
      // Query length only; the raw search text can contain PII.
      pendo.track("transactions_filtered", {
        hasSearchQuery: filters.search !== "",
        searchQueryLength: filters.search.length,
        typeFilter: filters.type,
        categoryFilterId: filters.categoryId,
        monthFilter: filters.month,
        activeFilterCount,
        resultsCount,
        totalCount,
      });
    }, FILTER_TRACKING_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [filters, resultsCount, totalCount]);

  async function handleAdd(values: TransactionFormValues) {
    const isFirstTransaction = transactions.length === 0;
    const attachmentCount = addAttachments.stagedFiles.length;
    try {
      const created = await addTransaction({ ...values, workspaceId: workspace!.id, notes: values.notes ?? "" });
      await addAttachments.flushStaged(created.id);
      // Free-text description/notes are not sent, only whether notes exist.
      pendo.track("transaction_created", {
        transactionId: created.id,
        type: created.type,
        amount: created.amount,
        currency,
        categoryId: created.categoryId,
        categoryName: categories.find((c) => c.id === created.categoryId)?.name ?? null,
        isRecurring: created.isRecurring,
        hasNotes: created.notes.trim().length > 0,
        attachmentCount,
        isBackdated: created.date < format(new Date(), "yyyy-MM-dd"),
        isFirstTransaction,
      });
      setShowForm(false);
      toast.success("Transaction added");
    } catch {
      toast.error("Failed to add transaction");
    }
  }

  async function handleEdit(values: TransactionFormValues) {
    if (!editingTx) return;
    try {
      const updated: Transaction = {
        ...editingTx,
        ...values,
        notes: values.notes ?? "",
        date: values.date,
      };
      await editTransaction(updated);
      const changedFields = EDITABLE_TRANSACTION_FIELDS.filter((field) => editingTx[field] !== updated[field]);
      pendo.track("transaction_updated", {
        transactionId: updated.id,
        type: updated.type,
        amount: updated.amount,
        currency,
        categoryId: updated.categoryId,
        changedFields: changedFields.join(","),
        typeChanged: editingTx.type !== updated.type,
        categoryChanged: editingTx.categoryId !== updated.categoryId,
        amountChanged: editingTx.amount !== updated.amount,
        isRecurring: updated.isRecurring,
        attachmentCount: editAttachments.totalCount,
      });
      setEditingTx(null);
      await refreshAttachmentCounts();
      toast.success("Transaction updated");
    } catch {
      toast.error("Failed to update transaction");
    }
  }

  async function handleDelete() {
    if (!deletingTx) return;
    try {
      await removeTransaction(deletingTx.id);
      // Deleting a transaction also deletes its receipts.
      pendo.track("transaction_deleted", {
        transactionId: deletingTx.id,
        type: deletingTx.type,
        amount: deletingTx.amount,
        categoryId: deletingTx.categoryId,
        categoryName: deletingTx.categoryName,
        isRecurring: deletingTx.isRecurring,
        attachmentsDeleted: attachmentCounts.get(deletingTx.id) ?? 0,
        transactionAgeDays: differenceInDays(new Date(), new Date(deletingTx.createdAt)),
      });
      setDeletingTx(null);
      toast.success("Transaction deleted");
    } catch {
      toast.error("Failed to delete transaction");
    }
  }

  return (
    <AppLayout
      title="Transactions"
      actions={
        <Button onClick={() => setShowForm(true)} size="sm">
          <Plus data-icon="inline-start" />
          Add Transaction
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <TransactionFiltersBar
          filters={filters}
          categories={categories}
          onChange={setFilters}
        />

        <TransactionTable
          transactions={filteredTransactions}
          currency={currency}
          locale={locale}
          isLoading={isLoading}
          attachmentCounts={attachmentCounts}
          onEdit={setEditingTx}
          onDelete={setDeletingTx}
        />
      </div>

      <Dialog
        open={showForm}
        onOpenChange={(o) => {
          if (!o) {
            setShowForm(false);
            addAttachments.reset();
          }
        }}
      >
        <DialogContent className="sm:max-w-md max-h-[90svh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Transaction</DialogTitle>
          </DialogHeader>
          <TransactionForm
            categories={categories}
            attachments={addAttachments}
            onSubmit={handleAdd}
            onCancel={() => {
              setShowForm(false);
              addAttachments.reset();
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!editingTx}
        onOpenChange={(o) => {
          if (!o) {
            setEditingTx(null);
            refreshAttachmentCounts();
          }
        }}
      >
        <DialogContent className="sm:max-w-md max-h-[90svh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Transaction</DialogTitle>
          </DialogHeader>
          {editingTx && (
            <TransactionForm
              categories={categories}
              defaultValues={editingTx}
              attachments={editAttachments}
              onSubmit={handleEdit}
              onCancel={() => setEditingTx(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      <DeleteTransactionDialog
        open={!!deletingTx}
        description={deletingTx?.description ?? ""}
        onConfirm={handleDelete}
        onCancel={() => setDeletingTx(null)}
      />
    </AppLayout>
  );
}
