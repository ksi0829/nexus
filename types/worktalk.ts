export type WorkTalkRoomType =
  | "direct"
  | "group"
  | "team"
  | "idea"
  | "approval";

export type WorkTalkProfile = {
  id: string;
  name: string;
  team: string;
  role: string;
};

export type WorkTalkRoomMember = {
  room_id: number;
  user_id: string;
  member_role: "owner" | "member" | "viewer";
  notifications_enabled: boolean;
  is_pinned: boolean;
  sort_order: number;
  joined_at: string;
  left_at: string | null;
  last_read_message_id: number | null;
  last_read_at: string | null;
  profile?: WorkTalkProfile;
};

export type WorkTalkMessage = {
  id: number;
  room_id: number;
  sender_id: string | null;
  sender_name: string;
  sender_team: string | null;
  message_type: "text" | "file" | "system" | "document";
  body: string;
  metadata: Record<string, unknown>;
  reply_to_message_id: number | null;
  replyTo?: {
    id: number;
    sender_name: string;
    body: string;
  } | null;
  created_at: string;
  files: WorkTalkFile[];
  client_temp_id?: string;
  server_message_id?: number | null;
  optimistic_status?: "sending" | "sent_pending_realtime" | "sent" | "failed";
  error_message?: string | null;
};

export type WorkTalkFile = {
  id: number;
  room_id: number;
  message_id: number;
  storage_path: string;
  storage_bucket: string;
  original_name: string;
  mime_type: string | null;
  size_bytes: number;
  uploaded_by: string | null;
  created_at: string;
};

export type WorkTalkSearchScope = "message" | "file";

export type WorkTalkSearchResult = {
  id: string;
  scope: WorkTalkSearchScope;
  room_id: number;
  message_id: number;
  title: string;
  subtitle: string;
  sender_name: string;
  created_at: string;
};

export type WorkTalkNotification = {
  id: number;
  user_id: string;
  room_id: number;
  message_id: number;
  sender_id: string | null;
  sender_name: string;
  title: string;
  body: string;
  notification_type: "message" | "file" | "system" | "document";
  read_at: string | null;
  created_at: string;
};

export type WorkTalkRoomNotice = {
  room_id: number;
  message_id: number;
  pinned_by: string | null;
  pinned_at: string;
  message?: {
    id: number;
    sender_name: string;
    body: string;
  } | null;
};

export type WorkTalkRoom = {
  id: number;
  room_type: WorkTalkRoomType;
  title: string;
  team_key: string | null;
  created_by: string | null;
  is_fixed: boolean;
  is_archived: boolean;
  last_message_at: string;
  created_at: string;
  members: WorkTalkRoomMember[];
  latestMessage: WorkTalkMessage | null;
  unreadCount: number;
};

export type WorkTalkSetupState =
  | "loading"
  | "ready"
  | "migration-required"
  | "signed-out"
  | "error";
