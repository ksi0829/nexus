"use client";

import type { SupabaseClient } from "@supabase/supabase-js";

export const NEXUS_APPROVAL_SIGNATURE_BUCKET = "approval-signatures";

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

  if (!approverIds.length) return signatures;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, signature_image_path")
    .in("id", approverIds);

  if (error) return signatures;

  await Promise.all(
    ((data || []) as SignatureProfileRow[]).map(async (profile) => {
      if (!profile.signature_image_path) {
        signatures[profile.id] = null;
        return;
      }

      try {
        const { data: file, error: downloadError } = await supabase.storage
          .from(NEXUS_APPROVAL_SIGNATURE_BUCKET)
          .download(profile.signature_image_path);

        if (downloadError || !file) {
          signatures[profile.id] = null;
          return;
        }

        signatures[profile.id] = await blobToDataUrl(file);
      } catch {
        signatures[profile.id] = null;
      }
    })
  );

  return signatures;
}

export function approvalLineSignatureDataUrl(
  signatures: Record<string, string | null>,
  line: ApprovalLineForSignature
) {
  if (line.status !== "approved" || !line.approver_id) return null;
  return signatures[String(line.approver_id)] || null;
}
