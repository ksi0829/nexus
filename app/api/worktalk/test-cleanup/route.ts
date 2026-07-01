import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type CleanupMode = "preview" | "delete";

type CleanupRequest = {
  mode?: CleanupMode;
  roomIds?: number[];
};

type RoomRow = {
  id: number;
  room_type: string;
  title: string | null;
  is_fixed: boolean;
  created_at: string | null;
  last_message_at: string | null;
};

type DocumentRow = {
  id: number;
  worktalk_room_id: number | null;
  document_no: string | null;
  title: string | null;
  status: string | null;
  submitted_pdf_path?: string | null;
  approved_pdf_path?: string | null;
};

type WorkTalkFileRow = {
  storage_bucket: string | null;
  storage_path: string | null;
};

type ApprovalAttachmentRow = {
  storage_path: string | null;
};

type CleanupCandidate = {
  roomId: number;
  title: string;
  roomType: string;
  createdAt: string | null;
  lastMessageAt: string | null;
  messageCount: number;
  memberCount: number;
  documentCount: number;
  documentIds: number[];
  reasons: string[];
};

const WORKTALK_FILE_BUCKET = "worktalk-files";
const NEXUS_DOCUMENT_BUCKET = "nexus-documents";
const APPROVAL_ATTACHMENT_BUCKET = "approval-attachments";
const TEST_MARKER_PATTERN = /(테스트|test|dummy|sample|샘플|연습)/i;

function hasTestMarker(value: unknown) {
  return typeof value === "string" && TEST_MARKER_PATTERN.test(value);
}

async function countByRoom(
  admin: SupabaseClient,
  table: string,
  roomIds: number[]
) {
  const entries = await Promise.all(
    roomIds.map(async (roomId) => {
      const { count } = await admin
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("room_id", roomId);
      return [roomId, count || 0] as const;
    })
  );

  return new Map(entries);
}

async function requireAdmin(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return {
      error: NextResponse.json(
        { error: "Supabase environment variables are not configured." },
        { status: 503 }
      ),
    };
  }

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error: userError,
  } = await authClient.auth.getUser(token);

  if (userError || !user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id,role,name")
    .eq("id", user.id)
    .maybeSingle();

  const isAdmin =
    !profileError &&
    profile &&
    (profile.role === "admin" || user.email === "admin@zetacorporation.com");

  if (!isAdmin) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { admin, user };
}

async function buildCleanupCandidates(admin: SupabaseClient) {
  const { data: rooms, error: roomsError } = await admin
    .from("worktalk_rooms")
    .select("id,room_type,title,is_fixed,created_at,last_message_at")
    .order("id", { ascending: true });

  if (roomsError) throw new Error(roomsError.message);

  const roomRows = (rooms || []) as RoomRow[];
  const roomIds = roomRows.map((room) => room.id);

  const { data: documents, error: documentsError } = await admin
    .from("approval_documents")
    .select(
      "id,worktalk_room_id,document_no,title,status,submitted_pdf_path,approved_pdf_path"
    )
    .in("worktalk_room_id", roomIds);

  if (documentsError) throw new Error(documentsError.message);

  const documentRows = (documents || []) as DocumentRow[];
  const documentsByRoom = new Map<number, DocumentRow[]>();
  documentRows.forEach((document) => {
    if (!document.worktalk_room_id) return;
    const list = documentsByRoom.get(document.worktalk_room_id) || [];
    list.push(document);
    documentsByRoom.set(document.worktalk_room_id, list);
  });

  const [messageCounts, memberCounts] = await Promise.all([
    countByRoom(admin, "worktalk_messages", roomIds),
    countByRoom(admin, "worktalk_room_members", roomIds),
  ]);

  const candidates: CleanupCandidate[] = [];
  for (const room of roomRows) {
    if (room.is_fixed) continue;

    const roomDocuments = documentsByRoom.get(room.id) || [];
    const messageCount = messageCounts.get(room.id) || 0;
    const reasons: string[] = [];
    const testMarkedDocument = roomDocuments.some(
      (document) =>
        hasTestMarker(document.title) || hasTestMarker(document.document_no)
    );

    if (hasTestMarker(room.title)) {
      reasons.push("room_title_test_marker");
    }
    if (testMarkedDocument) {
      reasons.push("document_test_marker");
    }
    if (
      roomDocuments.length === 0 &&
      (room.room_type === "approval" || room.room_type === "group")
    ) {
      reasons.push("no_linked_approval_document");
    }
    if (room.room_type === "direct" && messageCount === 0) {
      reasons.push("empty_direct_room");
    }

    if (reasons.length === 0) continue;

    candidates.push({
      roomId: room.id,
      title: room.title || `방 ${room.id}`,
      roomType: room.room_type,
      createdAt: room.created_at,
      lastMessageAt: room.last_message_at,
      messageCount,
      memberCount: memberCounts.get(room.id) || 0,
      documentCount: roomDocuments.length,
      documentIds: roomDocuments.map((document) => document.id),
      reasons,
    });
  }

  return candidates;
}

async function removeStorageObjects(
  admin: SupabaseClient,
  bucket: string,
  paths: string[]
) {
  const uniquePaths = Array.from(new Set(paths.filter(Boolean)));
  if (uniquePaths.length === 0) return { bucket, removed: 0, error: null };

  const { error } = await admin.storage.from(bucket).remove(uniquePaths);
  return {
    bucket,
    removed: error ? 0 : uniquePaths.length,
    error: error?.message || null,
  };
}

async function deleteCandidates(
  admin: SupabaseClient,
  candidates: CleanupCandidate[],
  selectedRoomIds: number[]
) {
  const candidateByRoom = new Map(candidates.map((candidate) => [candidate.roomId, candidate]));
  const roomIds = selectedRoomIds.filter((roomId) => candidateByRoom.has(roomId));
  if (roomIds.length === 0) {
    return { deletedRooms: 0, deletedDocuments: 0, storage: [] };
  }

  const documentIds = roomIds.flatMap(
    (roomId) => candidateByRoom.get(roomId)?.documentIds || []
  );

  const { data: worktalkFiles } = await admin
    .from("worktalk_files")
    .select("storage_bucket,storage_path")
    .in("room_id", roomIds);

  const worktalkStorageByBucket = new Map<string, string[]>();
  ((worktalkFiles || []) as WorkTalkFileRow[]).forEach((file) => {
    if (!file.storage_path) return;
    const bucket = file.storage_bucket || WORKTALK_FILE_BUCKET;
    worktalkStorageByBucket.set(bucket, [
      ...(worktalkStorageByBucket.get(bucket) || []),
      file.storage_path,
    ]);
  });

  const nexusDocumentPaths: string[] = [];
  const approvalAttachmentPaths: string[] = [];

  if (documentIds.length > 0) {
    const { data: documents } = await admin
      .from("approval_documents")
      .select("submitted_pdf_path,approved_pdf_path")
      .in("id", documentIds);

    ((documents || []) as DocumentRow[]).forEach((document) => {
      if (document.submitted_pdf_path) nexusDocumentPaths.push(document.submitted_pdf_path);
      if (document.approved_pdf_path) nexusDocumentPaths.push(document.approved_pdf_path);
    });

    const { data: attachments } = await admin
      .from("approval_attachments")
      .select("storage_path")
      .in("document_id", documentIds);

    ((attachments || []) as ApprovalAttachmentRow[]).forEach((attachment) => {
      if (attachment.storage_path) approvalAttachmentPaths.push(attachment.storage_path);
    });
  }

  const storageResults = [];
  for (const [bucket, paths] of worktalkStorageByBucket.entries()) {
    storageResults.push(await removeStorageObjects(admin, bucket, paths));
  }
  storageResults.push(
    await removeStorageObjects(admin, NEXUS_DOCUMENT_BUCKET, nexusDocumentPaths)
  );
  storageResults.push(
    await removeStorageObjects(admin, APPROVAL_ATTACHMENT_BUCKET, approvalAttachmentPaths)
  );

  if (documentIds.length > 0) {
    const { error: documentError } = await admin
      .from("approval_documents")
      .delete()
      .in("id", documentIds);
    if (documentError) throw new Error(documentError.message);
  }

  const { error: roomError } = await admin
    .from("worktalk_rooms")
    .delete()
    .in("id", roomIds);
  if (roomError) throw new Error(roomError.message);

  return {
    deletedRooms: roomIds.length,
    deletedDocuments: documentIds.length,
    storage: storageResults,
  };
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;

  const body = (await request.json().catch(() => null)) as CleanupRequest | null;
  const mode = body?.mode === "delete" ? "delete" : "preview";

  try {
    const candidates = await buildCleanupCandidates(auth.admin);

    if (mode === "preview") {
      return NextResponse.json({ candidates, count: candidates.length });
    }

    const selectedRoomIds = Array.isArray(body?.roomIds)
      ? body.roomIds
          .map((roomId) => Number(roomId))
          .filter((roomId) => Number.isSafeInteger(roomId) && roomId > 0)
      : [];

    const result = await deleteCandidates(auth.admin, candidates, selectedRoomIds);
    const refreshedCandidates = await buildCleanupCandidates(auth.admin);

    return NextResponse.json({
      ...result,
      candidates: refreshedCandidates,
      count: refreshedCandidates.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
