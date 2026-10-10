import { useRef, useState } from "react";
import { Download, Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getTransactionsByWorkspaceId, createTransaction } from "@/lib/db/repositories/transactions.repo";
import { getCategoriesByWorkspaceId } from "@/lib/db/repositories/categories.repo";
import { getGoalsByWorkspaceId, createGoal } from "@/lib/db/repositories/goals.repo";
import { getBudgetsByWorkspaceId, upsertBudget } from "@/lib/db/repositories/budgets.repo";
import { pendo } from "@/shared/lib/pendo";
import { useAuthContext } from "@/features/auth/hooks/auth-context";
import type { Budget, Goal, Transaction, Workspace } from "@/types";

export function DataExportImport() {
  const { workspace } = useAuthContext();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  async function handleExportJSON() {
    if (!workspace) return;
    setIsExporting(true);
    try {
      const [transactions, categories, goals, budgets] = await Promise.all([
        getTransactionsByWorkspaceId(workspace.id),
        getCategoriesByWorkspaceId(workspace.id),
        getGoalsByWorkspaceId(workspace.id),
        getBudgetsByWorkspaceId(workspace.id),
      ]);
      // Receipt attachments (binary blobs) are intentionally not included.
      const data = { workspace, transactions, categories, goals, budgets, exportedAt: new Date().toISOString() };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      downloadBlob(blob, `expense-tracker-export-${new Date().toISOString().slice(0, 10)}.json`);
      // Export is the only way to back up this browser-local data.
      pendo.track("data_exported", {
        exportFormat: "json",
        transactionCount: transactions.length,
        categoryCount: categories.length,
        goalCount: goals.length,
        budgetCount: budgets.length,
        fileSizeBytes: blob.size,
      });
      toast.success("Exported successfully");
    } catch {
      toast.error("Export failed");
    } finally {
      setIsExporting(false);
    }
  }

  async function handleExportCSV() {
    if (!workspace) return;
    setIsExporting(true);
    try {
      const [transactions, categories] = await Promise.all([
        getTransactionsByWorkspaceId(workspace.id),
        getCategoriesByWorkspaceId(workspace.id),
      ]);
      const catMap = new Map(categories.map((c) => [c.id, c.name]));
      const header = ["ID", "Type", "Amount", "Category", "Description", "Date", "Recurring", "Notes"];
      const rows = transactions.map((t) => [
        t.id,
        t.type,
        t.amount.toFixed(2),
        catMap.get(t.categoryId) ?? "",
        `"${t.description.replace(/"/g, '""')}"`,
        t.date,
        t.isRecurring ? "Yes" : "No",
        `"${t.notes.replace(/"/g, '""')}"`,
      ]);
      const csv = [header.join(","), ...rows.map((r) => r.join(","))].join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      downloadBlob(blob, `transactions-${new Date().toISOString().slice(0, 10)}.csv`);
      // CSV holds transactions only, so goal/budget counts don't apply.
      pendo.track("data_exported", {
        exportFormat: "csv",
        transactionCount: transactions.length,
        categoryCount: categories.length,
        fileSizeBytes: blob.size,
      });
      toast.success("CSV exported successfully");
    } catch {
      toast.error("CSV export failed");
    } finally {
      setIsExporting(false);
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !workspace) return;
    setIsImporting(true);

    // Declared outside the try so a failure can report how far a (non-atomic)
    // import got before it stopped.
    let imported = 0;
    try {
      const text = await file.text();
      const data = JSON.parse(text) as {
        workspace?: Pick<Workspace, "id">;
        transactions: Transaction[];
        goals?: Goal[];
        budgets?: Budget[];
      };

      if (!Array.isArray(data.transactions)) throw new Error("Invalid format: missing transactions array");

      for (const tx of data.transactions) {
        const fresh: Transaction = {
          ...tx,
          id: crypto.randomUUID(),
          workspaceId: workspace.id,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await createTransaction(fresh);
        imported++;
      }

      // Optional sections from newer exports; older files simply lack them.
      let goalsImported = 0;
      if (Array.isArray(data.goals)) {
        for (const goal of data.goals) {
          await createGoal({
            ...goal,
            id: crypto.randomUUID(),
            workspaceId: workspace.id,
            contributions: (goal.contributions ?? []).map((c) => ({ ...c, id: crypto.randomUUID() })),
          });
          goalsImported++;
        }
      }
      let budgetsImported = 0;
      if (Array.isArray(data.budgets)) {
        for (const budget of data.budgets) {
          await upsertBudget({ ...budget, id: crypto.randomUUID(), workspaceId: workspace.id });
          budgetsImported++;
        }
      }
      const extras = goalsImported + budgetsImported;

      // Every record gets a new id, so re-importing a file duplicates data;
      // sameSourceWorkspace helps spot re-imports.
      pendo.track("data_import_completed", {
        transactionsImported: imported,
        goalsImported,
        budgetsImported,
        hasGoalsSection: Array.isArray(data.goals),
        hasBudgetsSection: Array.isArray(data.budgets),
        fileSizeBytes: file.size,
        sameSourceWorkspace: data.workspace?.id === workspace.id,
      });

      toast.success(
        `Imported ${imported} transaction${imported !== 1 ? "s" : ""}${
          extras > 0 ? ` and ${extras} goal${extras !== 1 ? "s" : ""}/budget${extras !== 1 ? "s" : ""}` : ""
        }`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Import failed — check the file format";
      pendo.track("data_import_failed", {
        // JSON.parse errors can quote the file's contents, so those aren't sent verbatim.
        errorMessage: err instanceof SyntaxError ? "Invalid JSON" : message,
        fileSizeBytes: file.size,
        fileType: file.type,
        transactionsImported: imported,
      });
      toast.error(message);
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <AlertDescription>
          Your data is stored locally in your browser. Export regularly to keep a backup.
        </AlertDescription>
      </Alert>

      <div className="flex flex-col gap-3">
        <div>
          <h4 className="text-sm font-medium mb-1">Export</h4>
          <p className="text-sm text-muted-foreground mb-3">
            Download your transactions, categories, goals, and budgets. Receipt attachments are not
            included in backups.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={handleExportJSON} disabled={isExporting}>
              {isExporting ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : (
                <Download data-icon="inline-start" />
              )}
              Export JSON
            </Button>
            <Button variant="outline" onClick={handleExportCSV} disabled={isExporting}>
              {isExporting ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : (
                <Download data-icon="inline-start" />
              )}
              Export CSV
            </Button>
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium mb-1">Import</h4>
          <p className="text-sm text-muted-foreground mb-3">
            Import transactions from a JSON file previously exported from this app.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleImport}
            className="hidden"
            id="import-file"
          />
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
          >
            {isImporting ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <Upload data-icon="inline-start" />
            )}
            Import JSON
          </Button>
        </div>
      </div>
    </div>
  );
}
