"use client";

import type { SupabaseClient } from "@supabase/supabase-js";

export const NEXUS_APPROVAL_SIGNATURE_BUCKET = "approval-signatures";
const SIGNATURE_DEBUG_PREFIX = "[Approval signatures]";

export type ApprovalLineForSignature = {
  approver_id?: string | null;
  status?: string | null;
};

type SignatureProfileRow = {
  id: string;
  signature_image_path: string | null;
};

function uniqueApprovedApproverIds(lines: ApprovalLineForSignature[]) {
  return Array.from(
    new Set(
      lines
        .filter((line) => line.status === "approved" && line.approver_id)
        .map((line) => String(line.approver_id))
    )
  );
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () =>
      reject(reader.error || new Error("Failed to read signature image."));
    reader.readAsDataURL(blob);
  });
}

export async function loadApprovalSignatureDataUrls(
  supabase: SupabaseClient,
  lines: ApprovalLineForSignature[]
) {
  const approverIds = uniqueApprovedApproverIds(lines);
  const signatures: Record<string, string | null> = {};

  console.info(SIGNATURE_DEBUG_PREFIX, "load:start", {
    lineCount: lines.length,
    approvedLineCount: lines.filter((line) => line.status === "approved").length,
    approverIds,
  });

  if (!approverIds.length) {
    console.info(SIGNATURE_DEBUG_PREFIX, "load:skip_no_approved_approver");
    return signatures;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, signature_image_path")
    .in("id", approverIds);

  if (error) {
    console.warn(SIGNATURE_DEBUG_PREFIX, "profiles:error", {
      message: error.message,
      approverIds,
    });
    return signatures;
  }

  console.info(SIGNATURE_DEBUG_PREFIX, "profiles:loaded", {
    requested: approverIds.length,
    returned: data?.length || 0,
    rows: ((data || []) as SignatureProfileRow[]).map((profile) => ({
      id: profile.id,
      hasPath: Boolean(profile.signature_image_path),
      path: profile.signature_image_path,
    })),
  });

  await Promise.all(
    ((data || []) as SignatureProfileRow[]).map(async (profile) => {
      if (!profile.signature_image_path) {
        signatures[profile.id] = null;
        console.info(SIGNATURE_DEBUG_PREFIX, "profile:missing_path", {
          userId: profile.id,
        });
        return;
      }

      try {
        console.info(SIGNATURE_DEBUG_PREFIX, "storage:download_start", {
          userId: profile.id,
          path: profile.signature_image_path,
        });
        const { data: file, error: downloadError } = await supabase.storage
          .from(NEXUS_APPROVAL_SIGNATURE_BUCKET)
          .download(profile.signature_image_path);

        if (downloadError || !file) {
          signatures[profile.id] = null;
          console.warn(SIGNATURE_DEBUG_PREFIX, "storage:download_failed", {
            userId: profile.id,
            path: profile.signature_image_path,
            message: downloadError?.message || "No file returned",
          });
          return;
        }

        signatures[profile.id] = await blobToDataUrl(file);
        console.info(SIGNATURE_DEBUG_PREFIX, "data_url:ready", {
          userId: profile.id,
          path: profile.signature_image_path,
          blobSize: file.size,
          blobType: file.type,
          dataUrlLength: signatures[profile.id]?.length || 0,
        });
      } catch {
        signatures[profile.id] = null;
        console.warn(SIGNATURE_DEBUG_PREFIX, "data_url:failed", {
          userId: profile.id,
          path: profile.signature_image_path,
        });
      }
    })
  );

  console.info(SIGNATURE_DEBUG_PREFIX, "load:complete", {
    resolved: Object.entries(signatures).map(([userId, dataUrl]) => ({
      userId,
      hasSignature: Boolean(dataUrl),
      dataUrlLength: dataUrl?.length || 0,
    })),
  });

  return signatures;
}

export function approvalLineSignatureDataUrl(
  signatures: Record<string, string | null>,
  line: ApprovalLineForSignature
) {
  if (line.status !== "approved" || !line.approver_id) {
    console.info(SIGNATURE_DEBUG_PREFIX, "line:fallback_not_approved", {
      approverId: line.approver_id || null,
      status: line.status || null,
    });
    return null;
  }

  const dataUrl = signatures[String(line.approver_id)] || null;
  console.info(SIGNATURE_DEBUG_PREFIX, "line:resolved", {
    approverId: line.approver_id,
    hasSignature: Boolean(dataUrl),
    dataUrlLength: dataUrl?.length || 0,
  });
  return dataUrl;
}
