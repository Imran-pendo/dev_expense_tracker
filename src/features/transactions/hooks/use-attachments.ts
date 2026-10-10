import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  createAttachment,
  deleteAttachment,
  getAttachmentsByTransactionId,
} from "@/lib/db/repositories/attachments.repo";
import { pendo } from "@/shared/lib/pendo";
import type { Attachment } from "@/types";

export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB per file
export const MAX_FILES_PER_TRANSACTION = 5;

export interface StagedFile {
  id: string;
  file: File;
}

export interface UseAttachmentsReturn {
  /** Persisted attachments (existing transaction). */
  attachments: Attachment[];
  /** Files held in memory until the transaction is created. */
  stagedFiles: StagedFile[];
  totalCount: number;
  addFiles: (files: FileList | File[]) => Promise<void>;
  removeAttachment: (id: string) => Promise<void>;
  removeStagedFile: (id: string) => void;
  /** Persist staged files once the new transaction has an id. */
  flushStaged: (transactionId: string) => Promise<void>;
  /** Drop staged files (e.g. the add dialog was cancelled). */
  reset: () => void;
  reload: () => Promise<void>;
}

interface FileRejection {
  reason: "max_files_reached" | "unsupported_type" | "file_too_large";
  message: string;
}

function validateFile(file: File, currentCount: number): FileRejection | null {
  if (currentCount >= MAX_FILES_PER_TRANSACTION) {
    return {
      reason: "max_files_reached",
      message: `Maximum ${MAX_FILES_PER_TRANSACTION} attachments per transaction`,
    };
  }
  if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
    return { reason: "unsupported_type", message: `${file.name}: only images and PDFs are supported` };
  }
  if (file.size > MAX_FILE_SIZE) {
    return { reason: "file_too_large", message: `${file.name}: file is larger than 5 MB` };
  }
  return null;
}

// Aggregate analytics for a batch of saved receipts. File names may contain
// PII, so only types and sizes are reported.
function receiptBatchStats(files: File[]) {
  return {
    fileCount: files.length,
    imageCount: files.filter((f) => f.type.startsWith("image/")).length,
    pdfCount: files.filter((f) => f.type === "application/pdf").length,
    totalSizeBytes: files.reduce((sum, f) => sum + f.size, 0),
  };
}

export function useAttachments(workspaceId: string, transactionId: string | null): UseAttachmentsReturn {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);

  const reload = useCallback(async () => {
    if (!transactionId) {
      setAttachments([]);
      return;
    }
    setAttachments(await getAttachmentsByTransactionId(transactionId));
  }, [transactionId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- existing load-on-mount pattern
    reload();
  }, [reload]);

  const totalCount = attachments.length + stagedFiles.length;

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const flow = transactionId ? "existing_transaction" : "new_transaction";
      const written: File[] = [];
      let count = totalCount;
      for (const file of Array.from(files)) {
        const rejection = validateFile(file, count);
        if (rejection) {
          pendo.track("receipt_upload_rejected", {
            rejectionReason: rejection.reason,
            mimeType: file.type,
            fileSizeBytes: file.size,
            currentCount: count,
            flow,
          });
          toast.error(rejection.message);
          continue;
        }
        count++;
        if (transactionId) {
          await createAttachment({
            id: crypto.randomUUID(),
            workspaceId,
            transactionId,
            name: file.name,
            mimeType: file.type,
            size: file.size,
            blob: file,
            createdAt: new Date().toISOString(),
          });
          written.push(file);
        } else {
          setStagedFiles((prev) => [...prev, { id: crypto.randomUUID(), file }]);
        }
      }
      if (transactionId) await reload();
      // Staged files (new transaction) are tracked when flushStaged writes them.
      if (transactionId && written.length > 0) {
        pendo.track("receipts_attached", {
          transactionId,
          flow,
          ...receiptBatchStats(written),
          totalAttachmentCount: count,
        });
      }
    },
    [workspaceId, transactionId, totalCount, reload]
  );

  const removeAttachment = useCallback(
    async (id: string) => {
      await deleteAttachment(id);
      await reload();
    },
    [reload]
  );

  const removeStagedFile = useCallback((id: string) => {
    setStagedFiles((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const flushStaged = useCallback(
    async (newTransactionId: string) => {
      for (const staged of stagedFiles) {
        await createAttachment({
          id: staged.id,
          workspaceId,
          transactionId: newTransactionId,
          name: staged.file.name,
          mimeType: staged.file.type,
          size: staged.file.size,
          blob: staged.file,
          createdAt: new Date().toISOString(),
        });
      }
      if (stagedFiles.length > 0) {
        pendo.track("receipts_attached", {
          transactionId: newTransactionId,
          flow: "new_transaction",
          ...receiptBatchStats(stagedFiles.map((s) => s.file)),
          totalAttachmentCount: stagedFiles.length,
        });
      }
      setStagedFiles([]);
    },
    [workspaceId, stagedFiles]
  );

  const reset = useCallback(() => setStagedFiles([]), []);

  return {
    attachments,
    stagedFiles,
    totalCount,
    addFiles,
    removeAttachment,
    removeStagedFile,
    flushStaged,
    reset,
    reload,
  };
}
