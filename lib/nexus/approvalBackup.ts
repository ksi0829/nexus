"use client";

import type { SupabaseClient } from "@supabase/supabase-js";

export const NEXUS_APPROVAL_BACKUP_ROOT = "D:\\NEXUS_결재문서";
export const NEXUS_DOCUMENT_BUCKET = "nexus-documents";
export const NEXUS_BACKUP_SIGNED_URL_TTL_SECONDS = 5 * 60;

export type ApprovalBackupDocument = {
  id: number;
  document_no: string | null;
  template_key: string;
  title?: string | null;
  status?: string | null;
  completed_at?: string | null;
  approved_pdf_path?: string | null;
  approved_pdf_created_at?: string | null;
  form_data?: Record<string, unknown> | null;
};

export type ApprovalBackupRecord = {
  documentId: number;
  documentNo: string | null;
  storagePath: string | null;
  localPath: string | null;
  status: "completed" | "failed";
  attempts: number;
  lastError: string | null;
  backedUpAt: string | null;
};

export type ApprovalBackupStatus = {
  type: "NEXUS_BACKUP_STATUS";
  supported: boolean;
  rootPath: string;
  fixedPath: boolean;
  documents: ApprovalBackupRecord[];
  lastResult: ApprovalBackupRecord | null;
  error?: string | null;
};

export type ApprovalBackupPayload = {
  type: "NEXUS_BACKUP_DOWNLOAD_PDF";
  documentId: number;
  documentNo: string;
  documentType: string;
  completedAt: string;
  downloadUrl: string;
  storagePath: string;
};

type NexusDesktopWindow = Window & {
  chrome?: {
    webview?: {
      postMessage: (message: string) => void;
    };
  };
};

export function isNexusDesktopBridgeAvailable() {
  return (
    typeof window !== "undefined" &&
    Boolean((window as NexusDesktopWindow).chrome?.webview)
  );
}

export function postNexusDesktopMessage(payload: Record<string, unknown>) {
  if (!isNexusDesktopBridgeAvailable()) return false;
  (window as NexusDesktopWindow).chrome?.webview?.postMessage(
    JSON.stringify(payload)
  );
  return true;
}

export function getApprovalBackupDocumentType(
  templateKey: string,
  formData?: Record<string, unknown> | null
) {
  if (templateKey === "manufacturing_request") return "제조요구서";
  if (templateKey === "work_order") return "작업지시서";
  if (templateKey === "purchase_resolution") return "구매결의서";
  if (templateKey === "purchase_request" || templateKey === "outsourcing_request") {
    return "구매요청";
  }

  const customTitle =
    typeof formData?.documentType === "string" ? formData.documentType.trim() : "";
  return customTitle || "기타 결재문서";
}

export function isApprovalBackupCompleted(
  status: ApprovalBackupStatus | null,
  document: Pick<ApprovalBackupDocument, "id" | "approved_pdf_path">
) {
  if (!status?.documents?.length) return false;
  return status.documents.some(
    (record) =>
      record.documentId === document.id &&
      record.storagePath === document.approved_pdf_path &&
      record.status === "completed"
  );
}

export async function createApprovalBackupPayload(
  supabase: SupabaseClient,
  document: ApprovalBackupDocument
): Promise<ApprovalBackupPayload | null> {
  if (
    document.status !== "approved" ||
    !document.document_no ||
    !document.approved_pdf_path ||
    !document.approved_pdf_created_at
  ) {
    return null;
  }

  const { data, error } = await supabase.storage
    .from(NEXUS_DOCUMENT_BUCKET)
    .createSignedUrl(
      document.approved_pdf_path,
      NEXUS_BACKUP_SIGNED_URL_TTL_SECONDS
    );

  if (error || !data?.signedUrl) {
    throw new Error(error?.message || "승인 PDF 백업 주소를 만들 수 없습니다.");
  }

  return {
    type: "NEXUS_BACKUP_DOWNLOAD_PDF",
    documentId: document.id,
    documentNo: document.document_no,
    documentType: getApprovalBackupDocumentType(
      document.template_key,
      document.form_data
    ),
    completedAt: document.completed_at || document.approved_pdf_created_at,
    downloadUrl: data.signedUrl,
    storagePath: document.approved_pdf_path,
  };
}

export async function requestApprovalPdfBackup(
  supabase: SupabaseClient,
  document: ApprovalBackupDocument
) {
  if (!isNexusDesktopBridgeAvailable()) return false;
  const payload = await createApprovalBackupPayload(supabase, document);
  if (!payload) return false;
  return postNexusDesktopMessage(payload);
}
