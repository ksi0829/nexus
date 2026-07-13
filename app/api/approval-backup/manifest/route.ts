import { createHash, timingSafeEqual } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const NEXUS_DOCUMENT_BUCKET = "nexus-documents";
const SIGNED_URL_TTL_SECONDS = 5 * 60;
const PAGE_SIZE = 100;

type CompletedMarker = {
  documentId?: number;
  storagePath?: string | null;
};

type ManifestRequest = {
  completed?: CompletedMarker[];
};

type ApprovalDocumentRow = {
  id: number;
  document_no: string | null;
  template_key: string | null;
  title: string | null;
  status: string | null;
  completed_at: string | null;
  approved_pdf_path: string | null;
  approved_pdf_created_at: string | null;
  form_data: Record<string, unknown> | null;
};

function sha256Hex(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeTimingEqual(left: string, right: string) {
  const normalizedLeft = left.trim().toLowerCase();
  const normalizedRight = right.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalizedLeft)) return false;
  if (!/^[a-f0-9]{64}$/.test(normalizedRight)) return false;

  return timingSafeEqual(
    Buffer.from(normalizedLeft, "hex"),
    Buffer.from(normalizedRight, "hex")
  );
}

function getCompletedKey(documentId: unknown, storagePath: unknown) {
  const id = Number(documentId);
  const path = typeof storagePath === "string" ? storagePath : "";
  if (!Number.isSafeInteger(id) || id <= 0 || !path) return null;
  return `${id}:${path}`;
}

function getDocumentType(
  templateKey: string | null,
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

function getRequiredEnv() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const allowedDeviceId = process.env.NEXUS_BACKUP_DEVICE_ID;
  const allowedTokenHash = process.env.NEXUS_BACKUP_TOKEN_HASH;

  if (!supabaseUrl || !serviceRoleKey || !allowedDeviceId || !allowedTokenHash) {
    return null;
  }

  return {
    supabaseUrl,
    serviceRoleKey,
    allowedDeviceId: allowedDeviceId.trim(),
    allowedTokenHash: allowedTokenHash.trim().toLowerCase(),
  };
}

function isAuthorizedDevice(request: NextRequest, allowedDeviceId: string, tokenHash: string) {
  const deviceId = request.headers.get("x-nexus-backup-device-id")?.trim();
  const token = request.headers.get("x-nexus-backup-token") || "";

  if (!deviceId || !token) return false;
  if (deviceId !== allowedDeviceId) return false;

  return safeTimingEqual(sha256Hex(token), tokenHash);
}

async function loadApprovedDocuments(admin: SupabaseClient) {
  const documents: ApprovalDocumentRow[] = [];
  let from = 0;

  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await admin
      .from("approval_documents")
      .select(
        "id,document_no,template_key,title,status,completed_at,approved_pdf_path,approved_pdf_created_at,form_data"
      )
      .eq("status", "approved")
      .not("approved_pdf_path", "is", null)
      .not("approved_pdf_created_at", "is", null)
      .order("approved_pdf_created_at", { ascending: true })
      .range(from, to);

    if (error) throw new Error(error.message);

    const rows = (data || []) as ApprovalDocumentRow[];
    documents.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return documents;
}

export async function POST(request: NextRequest) {
  const env = getRequiredEnv();
  if (!env) {
    return NextResponse.json(
      { error: "Approval backup device allowlist is not configured." },
      { status: 503 }
    );
  }

  if (!isAuthorizedDevice(request, env.allowedDeviceId, env.allowedTokenHash)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as ManifestRequest;
  const completedKeys = new Set(
    (body.completed || [])
      .map((marker) => getCompletedKey(marker.documentId, marker.storagePath))
      .filter((key): key is string => Boolean(key))
  );

  const admin = createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const documents = await loadApprovedDocuments(admin);
  const pendingDocuments = documents.filter((document) => {
    const key = getCompletedKey(document.id, document.approved_pdf_path);
    return key ? !completedKeys.has(key) : false;
  });

  const manifest = [];
  for (const document of pendingDocuments) {
    if (!document.approved_pdf_path || !document.document_no || !document.template_key) {
      continue;
    }

    const { data, error } = await admin.storage
      .from(NEXUS_DOCUMENT_BUCKET)
      .createSignedUrl(document.approved_pdf_path, SIGNED_URL_TTL_SECONDS);

    if (error || !data?.signedUrl) {
      manifest.push({
        id: document.id,
        documentNo: document.document_no,
        storagePath: document.approved_pdf_path,
        status: "failed",
        error: error?.message || "Signed URL creation failed.",
      });
      continue;
    }

    manifest.push({
      id: document.id,
      documentNo: document.document_no,
      templateKey: document.template_key,
      title: document.title,
      documentType: getDocumentType(document.template_key, document.form_data),
      completedAt: document.completed_at || document.approved_pdf_created_at,
      approvedPdfCreatedAt: document.approved_pdf_created_at,
      storagePath: document.approved_pdf_path,
      downloadUrl: data.signedUrl,
      status: "ready",
    });
  }

  return NextResponse.json({
    ok: true,
    scanned: documents.length,
    pending: pendingDocuments.length,
    returned: manifest.length,
    pageSize: PAGE_SIZE,
    signedUrlTtlSeconds: SIGNED_URL_TTL_SECONDS,
    generatedAt: new Date().toISOString(),
    documents: manifest,
  });
}
