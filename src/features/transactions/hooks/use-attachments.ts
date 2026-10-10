import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { track } from "@/lib/analytics";
import {
  createAttachment,
  deleteAttachment,
  getAttachmentsByTransactionId,
} from "@/lib/db/repositories/attachments.repo";
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional load on mount
    reload();
  }, [reload]);

  const totalCount = attachments.length + stagedFiles.length;

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      let count = totalCount;
      for (const file of Array.from(files)) {
        const rejection = validateFile(file, count);
        if (rejection) {
          toast.error(rejection.message);
          track("receipt_upload_rejected", {
            rejectionReason: rejection.reason,
            mimeType: file.type || "unknown",
            fileSizeBytes: file.size,
            currentAttachmentCount: count,
            maxFileSizeBytes: MAX_FILE_SIZE,
            maxFilesPerTransaction: MAX_FILES_PER_TRANSACTION,
            attachmentFlow: transactionId ? "existing_transaction" : "new_transaction",
          });
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
          track("receipt_attached", {
            transactionId,
            mimeType: file.type,
            fileSizeBytes: file.size,
            attachmentFlow: "existing_transaction",
            attachmentCountAfter: count,
          });
        } else {
          setStagedFiles((prev) => [...prev, { id: crypto.randomUUID(), file }]);
        }
      }
      if (transactionId) await reload();
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
      for (const [index, staged] of stagedFiles.entries()) {
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
        track("receipt_attached", {
          transactionId: newTransactionId,
          mimeType: staged.file.type,
          fileSizeBytes: staged.file.size,
          attachmentFlow: "new_transaction",
          attachmentCountAfter: index + 1,
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
