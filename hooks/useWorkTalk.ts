"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import type {
  WorkTalkFile,
  WorkTalkMessage,
  WorkTalkNotification,
  WorkTalkProfile,
  WorkTalkRoom,
  WorkTalkRoomMember,
  WorkTalkRoomNotice,
  WorkTalkSearchResult,
  WorkTalkSearchScope,
  WorkTalkSetupState,
} from "@/types/worktalk";

const supabase = createSupabaseBrowser();
const MESSAGE_LIMIT = 100;
const WORKTALK_FILE_BUCKET = "worktalk-files";

type RoomRow = Omit<WorkTalkRoom, "members" | "latestMessage" | "unreadCount">;
type MemberRow = Omit<WorkTalkRoomMember, "profile">;
type RoomSummaryMember = MemberRow & { profile?: WorkTalkProfile | null };
type RoomSummaryMessage = Omit<WorkTalkMessage, "files">;
type RoomSummaryRow = RoomRow & {
  members: RoomSummaryMember[] | string | null;
  latest_message: RoomSummaryMessage | string | null;
  unread_count: number | string | null;
};
type RoomReadGuardContext = {
  roomId: number;
  targetMessageId: number | null;
  reason: string;
  selectedRoomId: number | null;
  documentVisibilityState: DocumentVisibilityState | "unknown";
};
type RoomReadGuardDecision = {
  allowed: boolean;
  reason: string;
  viewMode?: string;
  mobileView?: string;
  readAllowed?: boolean;
  fromPushDeepLink?: boolean;
  pendingDeepLinkRoomId?: number | null;
  mobileConversationOpen?: boolean;
};
type RoomReadGuard = (
  context: RoomReadGuardContext
) => RoomReadGuardDecision;

const defaultRoomReadGuard: RoomReadGuard = () => ({
  allowed: false,
  reason: "read guard not installed",
});

function isMissingWorkTalkTable(message?: string) {
  return Boolean(
    message &&
      (message.includes("worktalk_rooms") ||
        message.includes("worktalk_room_members") ||
        message.includes("schema cache"))
  );
}

function formatWorkTalkError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const parts = ["message", "details", "hint", "code"]
      .map((key) => {
        const value = record[key];
        return typeof value === "string" && value.trim() ? value : null;
      })
      .filter(Boolean);
    if (parts.length > 0) return parts.join(" ");
    try {
      return JSON.stringify(record);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

function parseJsonValue<T>(value: T | string | null | undefined, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function isMissingRoomSummaryFunction(message?: string) {
  return Boolean(
    message &&
      (message.includes("worktalk_get_room_summaries") ||
        message.includes("schema cache") ||
        message.includes("Could not find the function"))
  );
}

function isActiveRoomForUser(room: Pick<WorkTalkRoom, "room_type"> & { members: WorkTalkRoomMember[] }, userId?: string) {
  if (!userId) return false;
  const ownMember = room.members.find((member) => member.user_id === userId);
  if (!ownMember) return false;
  return room.room_type === "direct" || ownMember.left_at === null;
}

function sortRoomMembersByName(members: WorkTalkRoomMember[]) {
  return [...members].sort((left, right) => {
    const leftName = left.profile?.name || "";
    const rightName = right.profile?.name || "";
    const nameOrder = leftName.localeCompare(rightName, "ko");
    if (nameOrder !== 0) return nameOrder;
    return left.user_id.localeCompare(right.user_id);
  });
}

async function requestPushDelivery(roomId: number) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) return;

  await fetch("/api/worktalk/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ roomId }),
  });
}

export function useWorkTalk() {
  const [setupState, setSetupState] = useState<WorkTalkSetupState>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [currentProfile, setCurrentProfile] = useState<WorkTalkProfile | null>(null);
  const [profiles, setProfiles] = useState<WorkTalkProfile[]>([]);
  const [rooms, setRooms] = useState<WorkTalkRoom[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);
  const [messages, setMessages] = useState<WorkTalkMessage[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [focusedMessageId, setFocusedMessageId] = useState<number | null>(null);
  const [roomNotice, setRoomNoticeState] = useState<WorkTalkRoomNotice | null>(null);
  const [notifications, setNotifications] = useState<WorkTalkNotification[]>([]);
  const [notificationsReady, setNotificationsReady] = useState(false);
  const [latestNotification, setLatestNotification] =
    useState<WorkTalkNotification | null>(null);
  const selectedRoomIdRef = useRef<number | null>(null);
  const messageRequestIdRef = useRef(0);
  const roomRequestIdRef = useRef(0);
  const roomRefreshTimerRef = useRef<number | null>(null);
  const messageRefreshTimerRef = useRef<number | null>(null);
  const pendingFocusMessageIdRef = useRef<number | null>(null);
  const allowAutomaticRoomSelectionRef = useRef(false);
  const blockRoomSelectionRestoreRef = useRef(false);
  const lastDeliveredNotificationIdRef = useRef<number | null>(null);
  const roomReadGuardRef = useRef<RoomReadGuard>(defaultRoomReadGuard);

  const selectedRoom = useMemo(
    () => rooms.find((room) => room.id === selectedRoomId) || null,
    [rooms, selectedRoomId]
  );

  const loadProfiles = useCallback(async () => {
    const { data, error } = await supabase
      .from("profiles")
      .select("id,name,team,role")
      .order("name", { ascending: true });

    if (error) throw error;

    const nextProfiles = (data || [])
      .filter((profile) => profile.id && profile.name)
      .map((profile) => ({
        id: profile.id,
        name: profile.name || "",
        team: profile.team || "",
        role: profile.role || "",
      }));

    setProfiles(nextProfiles);
    return nextProfiles;
  }, []);

  const loadNotifications = useCallback(async () => {
    const { data, error } = await supabase
      .from("worktalk_notifications")
      .select(
        "id,user_id,room_id,message_id,sender_id,sender_name,title,body,notification_type,read_at,created_at"
      )
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      if (
        error.message.includes("worktalk_notifications") ||
        error.message.includes("schema cache")
      ) {
        setNotificationsReady(false);
        return;
      }
      setErrorMessage(error.message);
      return;
    }

    const nextNotifications = (data || []) as WorkTalkNotification[];
    setNotifications(nextNotifications);
    if (lastDeliveredNotificationIdRef.current === null) {
      lastDeliveredNotificationIdRef.current = nextNotifications[0]?.id || 0;
    }
    setNotificationsReady(true);
  }, []);

  const pollDesktopNotifications = useCallback(async () => {
    const { data, error } = await supabase
      .from("worktalk_notifications")
      .select(
        "id,user_id,room_id,message_id,sender_id,sender_name,title,body,notification_type,read_at,created_at"
      )
      .order("id", { ascending: false })
      .limit(20);

    if (error) return;
    const rows = (data || []) as WorkTalkNotification[];
    const lastId = lastDeliveredNotificationIdRef.current;

    if (lastId === null) {
      lastDeliveredNotificationIdRef.current = rows[0]?.id || 0;
      setNotifications(rows);
      setNotificationsReady(true);
      return;
    }

    const newRows = rows
      .filter((notification) => notification.id > lastId)
      .sort((left, right) => left.id - right.id);
    if (newRows.length === 0) return;

    lastDeliveredNotificationIdRef.current = newRows.at(-1)?.id || lastId;
    setNotifications((current) => {
      const next = [...newRows.reverse(), ...current];
      return next.filter(
        (notification, index) =>
          next.findIndex((item) => item.id === notification.id) === index
      ).slice(0, 100);
    });
    setNotificationsReady(true);
    setLatestNotification(newRows[0] || null);
  }, []);

  const loadRooms = useCallback(async (preferredRoomId?: number | null) => {
    const requestId = ++roomRequestIdRef.current;
    setLoadingRooms(true);

    try {
      const { data: summaryRows, error: summaryError } = await supabase.rpc(
        "worktalk_get_room_summaries"
      );

      if (!summaryError) {
        if (requestId !== roomRequestIdRef.current) return;

        const nextRooms = ((summaryRows || []) as RoomSummaryRow[])
          .map((row) => {
            const members = sortRoomMembersByName(
              parseJsonValue<RoomSummaryMember[]>(row.members, []).map((member) => ({
                ...member,
                profile: member.profile || undefined,
              }))
            );
            const latestMessage = parseJsonValue<RoomSummaryMessage | null>(
              row.latest_message,
              null
            );

            return {
              id: Number(row.id),
              room_type: row.room_type,
              title: row.title,
              team_key: row.team_key,
              created_by: row.created_by,
              is_fixed: row.is_fixed,
              is_archived: row.is_archived,
              last_message_at: row.last_message_at,
              created_at: row.created_at,
              members,
              latestMessage: latestMessage
                ? {
                    ...latestMessage,
                    id: Number(latestMessage.id),
                    room_id: Number(latestMessage.room_id),
                    files: [],
                  }
                : null,
              unreadCount: Number(row.unread_count || 0),
            } satisfies WorkTalkRoom;
          })
          .filter((room) => isActiveRoomForUser(room, currentProfile?.id));

        const currentSelectedId = selectedRoomIdRef.current;
        const roomRestoreBlocked = blockRoomSelectionRestoreRef.current;
        if (roomRestoreBlocked) {
          if (currentSelectedId) {
            console.warn("[WorkTalk read guard] loadRooms selected restore blocked", {
              currentSelectedId,
            });
          }
          if (preferredRoomId) {
            console.warn("[WorkTalk read guard] loadRooms preferredRoom blocked", {
              preferredRoomId,
            });
          }
          if (allowAutomaticRoomSelectionRef.current) {
            console.warn("[WorkTalk read guard] loadRooms auto select blocked", {
              firstRoomId: nextRooms[0]?.id || null,
            });
          }
          allowAutomaticRoomSelectionRef.current = false;
        }
        const nextSelectedId = roomRestoreBlocked
          ? null
          : currentSelectedId &&
              nextRooms.some((room) => room.id === currentSelectedId)
            ? currentSelectedId
            : preferredRoomId &&
                nextRooms.some((room) => room.id === preferredRoomId)
              ? preferredRoomId
              : allowAutomaticRoomSelectionRef.current
                ? nextRooms[0]?.id || null
                : null;

        selectedRoomIdRef.current = nextSelectedId;
        setRooms(nextRooms);
        setSelectedRoomId(nextSelectedId);
        if (roomRestoreBlocked) {
          setMessages([]);
          setRoomNoticeState(null);
          setLoadingMessages(false);
        }
        setSetupState("ready");
        return;
      }

      if (!isMissingRoomSummaryFunction(summaryError.message)) {
        throw summaryError;
      }

      const { data: roomRows, error: roomError } = await supabase
        .from("worktalk_rooms")
        .select(
          "id,room_type,title,team_key,created_by,is_fixed,is_archived,last_message_at,created_at"
        )
        .eq("is_archived", false)
        .order("last_message_at", { ascending: false });

      if (roomError) throw roomError;
      if (requestId !== roomRequestIdRef.current) return;

      const roomIds = (roomRows || []).map((room) => room.id);

      if (roomIds.length === 0) {
        selectedRoomIdRef.current = null;
        setRooms([]);
        setSelectedRoomId(null);
        setSetupState("ready");
        return;
      }

      const [
        { data: memberRows, error: memberError },
        { data: messageRows, error: messageError },
        { data: unreadRows, error: unreadError },
      ] =
        await Promise.all([
          supabase
            .from("worktalk_room_members")
            .select(
              "room_id,user_id,member_role,notifications_enabled,is_pinned,sort_order,joined_at,left_at,last_read_message_id,last_read_at"
            )
            .in("room_id", roomIds),
          supabase
            .from("worktalk_messages")
            .select(
              "id,room_id,sender_id,sender_name,sender_team,message_type,body,metadata,created_at"
            )
            .in("room_id", roomIds)
            .order("created_at", { ascending: false })
            .limit(500),
          supabase.rpc("worktalk_get_unread_counts"),
        ]);

      if (memberError) throw memberError;
      if (messageError) throw messageError;
      if (
        unreadError &&
        !unreadError.message.includes("worktalk_get_unread_counts") &&
        !unreadError.message.includes("schema cache")
      ) {
        throw unreadError;
      }
      if (requestId !== roomRequestIdRef.current) return;

      const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
      const membersByRoom = new Map<number, WorkTalkRoomMember[]>();
      const roomTypeById = new Map(
        ((roomRows || []) as RoomRow[]).map((room) => [room.id, room.room_type])
      );

      ((memberRows || []) as MemberRow[]).forEach((member) => {
        if (member.left_at && roomTypeById.get(member.room_id) !== "direct") {
          return;
        }
        const roomMembers = membersByRoom.get(member.room_id) || [];
        roomMembers.push({ ...member, profile: profileMap.get(member.user_id) });
        membersByRoom.set(member.room_id, roomMembers);
      });

      const messagesByRoom = new Map<number, WorkTalkMessage[]>();
      ((messageRows || []) as Omit<WorkTalkMessage, "files">[]).forEach((message) => {
        const roomMessages = messagesByRoom.get(message.room_id) || [];
        roomMessages.push({ ...message, files: [] });
        messagesByRoom.set(message.room_id, roomMessages);
      });
      const unreadByRoom = new Map<number, number>();
      (
        (unreadRows || []) as Array<{
          room_id: number;
          unread_count: number | string;
        }>
      ).forEach((row) => {
        unreadByRoom.set(Number(row.room_id), Number(row.unread_count));
      });

      const nextRooms = ((roomRows || []) as RoomRow[])
        .map((room) => {
            const roomMembers = sortRoomMembersByName(membersByRoom.get(room.id) || []);
          const roomMessages = messagesByRoom.get(room.id) || [];
          const ownMember = roomMembers.find(
            (member) => member.user_id === currentProfile?.id
          );
          const fallbackUnreadCount = roomMessages.filter(
            (message) =>
              message.sender_id !== currentProfile?.id &&
              new Date(message.created_at).getTime() >=
                new Date(ownMember?.joined_at || 0).getTime() &&
              (!ownMember?.last_read_message_id ||
                message.id > ownMember.last_read_message_id)
          ).length;

          return {
            ...room,
            members: roomMembers,
            latestMessage: roomMessages[0] || null,
            unreadCount:
              unreadByRoom.get(room.id) ?? fallbackUnreadCount,
          };
        })
        .filter((room) => isActiveRoomForUser(room, currentProfile?.id))
        .sort((left, right) => {
          const leftMember = left.members.find(
            (member) => member.user_id === currentProfile?.id
          );
          const rightMember = right.members.find(
            (member) => member.user_id === currentProfile?.id
          );
          if (Boolean(leftMember?.is_pinned) !== Boolean(rightMember?.is_pinned)) {
            return leftMember?.is_pinned ? -1 : 1;
          }
          const orderDifference =
            (leftMember?.sort_order || 0) - (rightMember?.sort_order || 0);
          if (orderDifference !== 0) return orderDifference;
          return (
            new Date(right.last_message_at).getTime() -
            new Date(left.last_message_at).getTime()
          );
        });

      const currentSelectedId = selectedRoomIdRef.current;
      const roomRestoreBlocked = blockRoomSelectionRestoreRef.current;
      if (roomRestoreBlocked) {
        if (currentSelectedId) {
          console.warn("[WorkTalk read guard] loadRooms selected restore blocked", {
            currentSelectedId,
          });
        }
        if (preferredRoomId) {
          console.warn("[WorkTalk read guard] loadRooms preferredRoom blocked", {
            preferredRoomId,
          });
        }
        if (allowAutomaticRoomSelectionRef.current) {
          console.warn("[WorkTalk read guard] loadRooms auto select blocked", {
            firstRoomId: nextRooms[0]?.id || null,
          });
        }
        allowAutomaticRoomSelectionRef.current = false;
      }
      const nextSelectedId = roomRestoreBlocked
        ? null
        : currentSelectedId &&
            nextRooms.some((room) => room.id === currentSelectedId)
          ? currentSelectedId
          : preferredRoomId &&
              nextRooms.some((room) => room.id === preferredRoomId)
            ? preferredRoomId
            : allowAutomaticRoomSelectionRef.current
              ? nextRooms[0]?.id || null
              : null;
      selectedRoomIdRef.current = nextSelectedId;
      setRooms(nextRooms);
      setSelectedRoomId(nextSelectedId);
      if (roomRestoreBlocked) {
        setMessages([]);
        setRoomNoticeState(null);
        setLoadingMessages(false);
      }
      setSetupState("ready");
    } catch (error) {
      if (requestId !== roomRequestIdRef.current) return;
      const message = formatWorkTalkError(error);
      if (isMissingWorkTalkTable(message)) {
        setSetupState("migration-required");
      } else {
        setSetupState("error");
        setErrorMessage(message);
      }
    } finally {
      if (requestId === roomRequestIdRef.current) {
        setLoadingRooms(false);
      }
    }
  }, [currentProfile?.id, profiles]);

  const setRoomReadGuard = useCallback((guard: RoomReadGuard | null) => {
    roomReadGuardRef.current = guard || defaultRoomReadGuard;
  }, []);

  const markRoomRead = useCallback(
    async (roomId: number, targetMessageId: number | null, reason: string) => {
      const documentVisibilityState =
        typeof document === "undefined"
          ? "unknown"
          : document.visibilityState;
      const selectedRoomId = selectedRoomIdRef.current;
      const guardDecision = roomReadGuardRef.current({
        roomId,
        targetMessageId,
        reason,
        selectedRoomId,
        documentVisibilityState,
      });

      const logPayload = {
        callReason: reason,
        roomId,
        targetMessageId,
        selectedRoomId,
        documentVisibilityState,
        ...guardDecision,
      };

      console.log("[WorkTalk read guard] markAsRead called", logPayload);

      if (!guardDecision.allowed) {
        console.warn("[WorkTalk read guard] markAsRead blocked", logPayload);
        return false;
      }

      console.log("[WorkTalk read guard] markAsRead updating DB", logPayload);

      await supabase.rpc("worktalk_mark_room_read", {
        target_room_id: roomId,
        target_message_id: targetMessageId,
      });

      const readAt = new Date().toISOString();
      setRooms((current) =>
        current.map((room) =>
          room.id === roomId
            ? {
                ...room,
                unreadCount: 0,
                members: room.members.map((member) =>
                  member.user_id === currentProfile?.id
                    ? {
                        ...member,
                        last_read_message_id:
                          targetMessageId ?? member.last_read_message_id,
                        last_read_at: readAt,
                      }
                    : member
                ),
              }
            : room
        )
      );
      setNotifications((current) =>
        current.map((notification) =>
          notification.room_id === roomId &&
          (!targetMessageId || notification.message_id <= targetMessageId)
            ? {
                ...notification,
                read_at: notification.read_at || readAt,
              }
            : notification
        )
      );

      return true;
    },
    [currentProfile?.id]
  );

  const loadMessages = useCallback(async (
    roomId: number,
    focusMessageId?: number | null
  ) => {
    const requestId = ++messageRequestIdRef.current;
    console.log("[WorkTalk realtime debug] loadMessages:start", {
      roomId,
      focusMessageId: focusMessageId || null,
      requestId,
      selectedRoomId: selectedRoomIdRef.current,
    });
    setLoadingMessages(true);

    try {
      const messageColumns =
        "id,room_id,sender_id,sender_name,sender_team,message_type,body,metadata,reply_to_message_id,created_at";
      let plainMessages: Omit<WorkTalkMessage, "files">[] = [];

      if (focusMessageId) {
        const [
          { data: previousRows, error: previousError },
          { data: followingRows, error: followingError },
        ] = await Promise.all([
          supabase
            .from("worktalk_messages")
            .select(messageColumns)
            .eq("room_id", roomId)
            .lte("id", focusMessageId)
            .order("id", { ascending: false })
            .limit(50),
          supabase
            .from("worktalk_messages")
            .select(messageColumns)
            .eq("room_id", roomId)
            .gt("id", focusMessageId)
            .order("id", { ascending: true })
            .limit(50),
        ]);

        if (previousError) throw previousError;
        if (followingError) throw followingError;
        plainMessages = [
          ...((previousRows || []) as Omit<WorkTalkMessage, "files">[]).reverse(),
          ...((followingRows || []) as Omit<WorkTalkMessage, "files">[]),
        ];
      } else {
        const { data, error } = await supabase
          .from("worktalk_messages")
          .select(messageColumns)
          .eq("room_id", roomId)
          .order("created_at", { ascending: false })
          .limit(MESSAGE_LIMIT);

        if (error) throw error;
        plainMessages = (
          (data || []) as Omit<WorkTalkMessage, "files">[]
        ).reverse();
      }

      const messageIds = plainMessages.map((message) => message.id);
      let files: WorkTalkFile[] = [];

      if (messageIds.length > 0) {
        const { data: fileRows, error: fileError } = await supabase
          .from("worktalk_files")
          .select(
            "id,room_id,message_id,storage_path,storage_bucket,original_name,mime_type,size_bytes,uploaded_by,created_at"
          )
          .in("message_id", messageIds)
          .order("created_at", { ascending: true });

        if (fileError) throw fileError;
        files = (fileRows || []) as WorkTalkFile[];
      }

      const filesByMessage = new Map<number, WorkTalkFile[]>();
      files.forEach((file) => {
        const messageFiles = filesByMessage.get(file.message_id) || [];
        messageFiles.push(file);
        filesByMessage.set(file.message_id, messageFiles);
      });

      const replyIds = Array.from(
        new Set(
          plainMessages
            .map((message) => message.reply_to_message_id)
            .filter((id): id is number => typeof id === "number" && id > 0)
        )
      );
      const repliesById = new Map<
        number,
        { id: number; sender_name: string; body: string }
      >();

      if (replyIds.length > 0) {
        const { data: replyRows, error: replyError } = await supabase
          .from("worktalk_messages")
          .select("id,sender_name,body")
          .in("id", replyIds);
        if (replyError) throw replyError;
        (replyRows || []).forEach((reply) => repliesById.set(reply.id, reply));
      }

      const nextMessages = plainMessages.map((message) => ({
        ...message,
        replyTo: message.reply_to_message_id
          ? repliesById.get(message.reply_to_message_id) || null
          : null,
        files: filesByMessage.get(message.id) || [],
      }));
      if (
        requestId !== messageRequestIdRef.current ||
        selectedRoomIdRef.current !== roomId
      ) {
        console.log("[WorkTalk realtime debug] loadMessages:ignored", {
          roomId,
          requestId,
          latestRequestId: messageRequestIdRef.current,
          selectedRoomId: selectedRoomIdRef.current,
          messageCount: nextMessages.length,
        });
        return;
      }
      setMessages(nextMessages);
      console.log("[WorkTalk realtime debug] loadMessages:applied", {
        roomId,
        requestId,
        messageCount: nextMessages.length,
        lastMessageId: nextMessages.at(-1)?.id || null,
        fileCount: files.length,
      });
      setFocusedMessageId(focusMessageId || null);
      pendingFocusMessageIdRef.current = null;
    } catch (error) {
      if (requestId !== messageRequestIdRef.current) return;
      console.log("[WorkTalk realtime debug] loadMessages:error", {
        roomId,
        requestId,
        error,
      });
      setErrorMessage(formatWorkTalkError(error));
    } finally {
      if (requestId === messageRequestIdRef.current) {
        setLoadingMessages(false);
      }
    }
  }, []);

  const loadRoomNotice = useCallback(async (roomId: number | null) => {
    if (!roomId) {
      setRoomNoticeState(null);
      return;
    }

    const { data, error } = await supabase
      .from("worktalk_room_notices")
      .select("room_id,message_id,pinned_by,pinned_at")
      .eq("room_id", roomId)
      .maybeSingle();

    if (error) {
      if (
        error.message.includes("worktalk_room_notices") ||
        error.message.includes("schema cache")
      ) {
        setRoomNoticeState(null);
        return;
      }
      setErrorMessage(error.message);
      return;
    }

    if (!data) {
      setRoomNoticeState(null);
      return;
    }

    const { data: message, error: messageError } = await supabase
      .from("worktalk_messages")
      .select("id,sender_name,body")
      .eq("id", data.message_id)
      .maybeSingle();

    if (messageError) {
      setErrorMessage(messageError.message);
      return;
    }

    setRoomNoticeState({
      ...(data as WorkTalkRoomNotice),
      message: message || null,
    });
  }, []);

  const scheduleRoomRefresh = useCallback(
    (preferredRoomId?: number | null) => {
      if (roomRefreshTimerRef.current) {
        window.clearTimeout(roomRefreshTimerRef.current);
      }

      roomRefreshTimerRef.current = window.setTimeout(() => {
        roomRefreshTimerRef.current = null;
        if (blockRoomSelectionRestoreRef.current) {
          if (preferredRoomId ?? selectedRoomIdRef.current) {
            console.warn(
              "[WorkTalk read guard] scheduleRoomRefresh preferredRoom blocked",
              {
                preferredRoomId,
                selectedRoomId: selectedRoomIdRef.current,
              }
            );
          }
          void loadRooms(null);
          return;
        }
        void loadRooms(preferredRoomId ?? selectedRoomIdRef.current);
      }, 800);
    },
    [loadRooms]
  );

  const scheduleMessageRefresh = useCallback(
    (roomId: number, delay = 180) => {
      console.log("[WorkTalk realtime debug] scheduleMessageRefresh", {
        roomId,
        delay,
        selectedRoomId: selectedRoomIdRef.current,
      });
      if (messageRefreshTimerRef.current) {
        window.clearTimeout(messageRefreshTimerRef.current);
      }

      messageRefreshTimerRef.current = window.setTimeout(() => {
        messageRefreshTimerRef.current = null;
        console.log("[WorkTalk realtime debug] scheduleMessageRefresh:fire", {
          roomId,
          selectedRoomId: selectedRoomIdRef.current,
          willLoad: selectedRoomIdRef.current === roomId,
        });
        if (selectedRoomIdRef.current === roomId) {
          void loadMessages(roomId);
        }
      }, delay);
    },
    [loadMessages]
  );

  const selectRoom = useCallback((roomId: number, focusMessageId?: number) => {
    blockRoomSelectionRestoreRef.current = false;
    allowAutomaticRoomSelectionRef.current = true;
    pendingFocusMessageIdRef.current = focusMessageId || null;
    if (selectedRoomIdRef.current === roomId) {
      if (focusMessageId) void loadMessages(roomId, focusMessageId);
      return;
    }
    selectedRoomIdRef.current = roomId;
    messageRequestIdRef.current += 1;
    setMessages([]);
    setFocusedMessageId(null);
    setLoadingMessages(true);
    setSelectedRoomId(roomId);
  }, [loadMessages]);

  const clearSelectedRoom = useCallback((reason = "manual") => {
    console.warn("[WorkTalk read guard] clearSelectedRoom", {
      reason,
      selectedRoomId: selectedRoomIdRef.current,
    });
    allowAutomaticRoomSelectionRef.current = false;
    selectedRoomIdRef.current = null;
    pendingFocusMessageIdRef.current = null;
    messageRequestIdRef.current += 1;
    setSelectedRoomId(null);
    setMessages([]);
    setFocusedMessageId(null);
    setRoomNoticeState(null);
    setLoadingMessages(false);
  }, []);

  const setRoomSelectionRestoreBlocked = useCallback(
    (blocked: boolean, reason = "unknown") => {
      if (blockRoomSelectionRestoreRef.current === blocked) return;

      console.warn("[WorkTalk read guard] room selection restore block changed", {
        blocked,
        reason,
        selectedRoomId: selectedRoomIdRef.current,
      });
      blockRoomSelectionRestoreRef.current = blocked;

      if (blocked) {
        allowAutomaticRoomSelectionRef.current = false;
        selectedRoomIdRef.current = null;
        pendingFocusMessageIdRef.current = null;
        messageRequestIdRef.current += 1;
        setSelectedRoomId(null);
        setMessages([]);
        setFocusedMessageId(null);
        setRoomNoticeState(null);
        setLoadingMessages(false);
      }
    },
    []
  );

  const searchWorkTalk = useCallback(
    async (
      query: string,
      scope: WorkTalkSearchScope
    ): Promise<WorkTalkSearchResult[]> => {
      const keyword = query.trim();
      const activeRoomIds = rooms.map((room) => room.id);
      if (keyword.length < 2 || activeRoomIds.length === 0) return [];

      if (scope === "message") {
        const { data, error } = await supabase
          .from("worktalk_messages")
          .select("id,room_id,sender_name,body,created_at")
          .in("room_id", activeRoomIds)
          .ilike("body", `%${keyword}%`)
          .order("created_at", { ascending: false })
          .limit(50);

        if (error) {
          setErrorMessage(error.message);
          return [];
        }

        return (data || []).map((message) => ({
          id: `message-${message.id}`,
          scope,
          room_id: message.room_id,
          message_id: message.id,
          title: message.body,
          subtitle: message.sender_name,
          sender_name: message.sender_name,
          created_at: message.created_at,
        }));
      }

      const { data: fileRows, error: fileError } = await supabase
        .from("worktalk_files")
        .select("id,room_id,message_id,original_name,size_bytes,created_at")
        .in("room_id", activeRoomIds)
        .ilike("original_name", `%${keyword}%`)
        .order("created_at", { ascending: false })
        .limit(50);

      if (fileError) {
        setErrorMessage(fileError.message);
        return [];
      }

      const messageIds = (fileRows || []).map((file) => file.message_id);
      const messageMap = new Map<
        number,
        { sender_name: string; body: string }
      >();

      if (messageIds.length > 0) {
        const { data: messageRows, error: messageError } = await supabase
          .from("worktalk_messages")
          .select("id,sender_name,body")
          .in("id", messageIds);

        if (messageError) {
          setErrorMessage(messageError.message);
          return [];
        }
        (messageRows || []).forEach((message) =>
          messageMap.set(message.id, message)
        );
      }

      return (fileRows || []).map((file) => {
        const message = messageMap.get(file.message_id);
        return {
          id: `file-${file.id}`,
          scope,
          room_id: file.room_id,
          message_id: file.message_id,
          title: file.original_name,
          subtitle: message?.body || "파일을 공유했습니다.",
          sender_name: message?.sender_name || "",
          created_at: file.created_at,
        };
      });
    },
    [rooms]
  );

  const sendMessage = useCallback(
    async (body: string) => {
      const targetRoomId = selectedRoomIdRef.current;
      if (!targetRoomId || !body.trim() || sending) return false;

      setSending(true);
      const { error } = await supabase.rpc("worktalk_send_message", {
        target_room_id: targetRoomId,
        message_body: body.trim(),
      });
      setSending(false);

      if (error) {
        setErrorMessage(error.message);
        return false;
      }

      void requestPushDelivery(targetRoomId);
      if (selectedRoomIdRef.current === targetRoomId) {
        await loadMessages(targetRoomId);
      }
      await loadRooms(selectedRoomIdRef.current);
      return true;
    },
    [loadMessages, loadRooms, sending]
  );

  const sendReplyMessage = useCallback(
    async (body: string, replyToMessageId: number) => {
      const targetRoomId = selectedRoomIdRef.current;
      if (!targetRoomId || !body.trim() || !replyToMessageId || sending) return false;

      setSending(true);
      const { error } = await supabase.rpc("worktalk_send_reply_message", {
        target_room_id: targetRoomId,
        message_body: body.trim(),
        target_reply_to_message_id: replyToMessageId,
      });
      setSending(false);

      if (error) {
        setErrorMessage(error.message);
        return false;
      }

      void requestPushDelivery(targetRoomId);
      await Promise.all([loadMessages(targetRoomId), loadRooms(targetRoomId)]);
      return true;
    },
    [loadMessages, loadRooms, sending]
  );

  const processApprovalCommand = useCallback(
    async (commandText: string) => {
      const targetRoomId = selectedRoomIdRef.current;
      if (!targetRoomId || sending) return false;

      setSending(true);
      const { data, error } = await supabase.rpc(
        "nexus_process_chat_approval_command",
        {
          target_room_id: targetRoomId,
          command_text: commandText.trim(),
        }
      );
      setSending(false);

      if (error) {
        setErrorMessage(error.message);
        return false;
      }

      void requestPushDelivery(targetRoomId);
      await Promise.all([
        loadMessages(targetRoomId),
        loadRooms(targetRoomId),
        loadNotifications(),
      ]);
      return data as {
        handled: boolean;
        document_id: number;
        document_no: string | null;
        template_key: string;
        result: "approved" | "rejected";
        completed: boolean;
        message_id: number;
      };
    },
    [loadMessages, loadNotifications, loadRooms, sending]
  );

  const sendFiles = useCallback(
    async (files: File[], body = "") => {
      const targetRoomId = selectedRoomIdRef.current;
      if (!targetRoomId || files.length === 0 || sending) return false;
      setSending(true);
      const uploadedPaths: string[] = [];

      try {
        const attachmentRows = [];

        for (const file of files) {
          const extension = file.name
            .split(".")
            .pop()
            ?.toLocaleLowerCase()
            .replace(/[^a-z0-9]/g, "");
          const storageFileName = extension
            ? `${crypto.randomUUID()}.${extension}`
            : crypto.randomUUID();
          const storagePath = `${targetRoomId}/${currentProfile?.id}/${storageFileName}`;
          const { error: uploadError } = await supabase.storage
            .from(WORKTALK_FILE_BUCKET)
            .upload(storagePath, file, {
              contentType: file.type || "application/octet-stream",
              upsert: false,
            });

          if (uploadError) throw uploadError;
          uploadedPaths.push(storagePath);
          attachmentRows.push({
            storage_path: storagePath,
            original_name: file.name,
            mime_type: file.type || null,
            size_bytes: file.size,
          });
        }

        const { error } = await supabase.rpc("worktalk_send_files", {
          target_room_id: targetRoomId,
          message_body: body.trim(),
          attachment_rows: attachmentRows,
        });

        if (error) throw error;
        void requestPushDelivery(targetRoomId);
        if (selectedRoomIdRef.current === targetRoomId) {
          await loadMessages(targetRoomId);
        }
        await loadRooms(selectedRoomIdRef.current);
        return true;
      } catch (error) {
        await Promise.all(
          uploadedPaths.map((path) =>
            supabase.storage.from(WORKTALK_FILE_BUCKET).remove([path])
          )
        );
        setErrorMessage(formatWorkTalkError(error));
        return false;
      } finally {
        setSending(false);
      }
    },
    [
      currentProfile?.id,
      loadMessages,
      loadRooms,
      sending,
    ]
  );

  const downloadFile = useCallback(async (file: WorkTalkFile) => {
    const { data, error } = await supabase.storage
      .from(file.storage_bucket || WORKTALK_FILE_BUCKET)
      .createSignedUrl(file.storage_path, 60);

    if (error || !data?.signedUrl) {
      setErrorMessage(error?.message || "파일 다운로드 주소를 만들 수 없습니다.");
      return;
    }

    const anchor = document.createElement("a");
    anchor.href = data.signedUrl;
    anchor.download = file.original_name;
    anchor.target = "_blank";
    anchor.rel = "noopener";
    anchor.click();
  }, []);

  const getFileUrl = useCallback(async (file: WorkTalkFile) => {
    const { data, error } = await supabase.storage
      .from(file.storage_bucket || WORKTALK_FILE_BUCKET)
      .createSignedUrl(file.storage_path, 60 * 60);

    if (error || !data?.signedUrl) {
      setErrorMessage(error?.message || "파일 미리보기 주소를 만들 수 없습니다.");
      return null;
    }

    return data.signedUrl;
  }, []);

  const createDirectRoom = useCallback(
    async (targetUserId: string) => {
      const { data, error } = await supabase.rpc("worktalk_create_direct_room", {
        target_user_id: targetUserId,
      });

      if (error) {
        setErrorMessage(error.message);
        return null;
      }

      const roomId = Number(data);
      await loadRooms(roomId);
      selectRoom(roomId);
      return roomId;
    },
    [loadRooms, selectRoom]
  );

  const createGroupRoom = useCallback(
    async (title: string, memberIds: string[]) => {
      const { data, error } = await supabase.rpc("worktalk_create_group_room", {
        room_title: title,
        member_ids: memberIds,
      });

      if (error) {
        setErrorMessage(error.message);
        return null;
      }

      const roomId = Number(data);
      await loadRooms(roomId);
      selectRoom(roomId);
      return roomId;
    },
    [loadRooms, selectRoom]
  );

  const setRoomNotifications = useCallback(
    async (roomId: number, enabled: boolean) => {
      const { error } = await supabase.rpc("worktalk_set_room_notifications", {
        target_room_id: roomId,
        enabled,
      });

      if (error) {
        setErrorMessage(error.message);
        return;
      }

      setRooms((current) =>
        current.map((room) =>
          room.id === roomId
            ? {
                ...room,
                members: room.members.map((member) =>
                  member.user_id === currentProfile?.id
                    ? { ...member, notifications_enabled: enabled }
                    : member
                ),
              }
            : room
        )
      );
    },
    [currentProfile?.id]
  );

  const markNotificationRead = useCallback(
    async (notificationId: number) => {
      const { error } = await supabase.rpc(
        "worktalk_mark_notification_read",
        {
          target_notification_id: notificationId,
        }
      );
      if (error) {
        setErrorMessage(error.message);
        return false;
      }
      setNotifications((current) =>
        current.map((notification) =>
          notification.id === notificationId
            ? {
                ...notification,
                read_at: notification.read_at || new Date().toISOString(),
              }
            : notification
        )
      );
      return true;
    },
    []
  );

  const markAllNotificationsRead = useCallback(async () => {
    const { error } = await supabase.rpc(
      "worktalk_mark_all_notifications_read"
    );
    if (error) {
      setErrorMessage(error.message);
      return false;
    }
    const readAt = new Date().toISOString();
    setNotifications((current) =>
      current.map((notification) => ({
        ...notification,
        read_at: notification.read_at || readAt,
      }))
    );
    return true;
  }, []);

  const clearLatestNotification = useCallback(() => {
    setLatestNotification(null);
  }, []);

  const setRoomPinned = useCallback(
    async (roomId: number, pinned: boolean) => {
      const { error } = await supabase.rpc("worktalk_set_room_pinned", {
        target_room_id: roomId,
        pinned,
      });

      if (error) {
        setErrorMessage(error.message);
        return false;
      }

      await loadRooms(selectedRoomIdRef.current);
      return true;
    },
    [loadRooms]
  );

  const setRoomOrder = useCallback(
    async (orderedRoomIds: number[]) => {
      const { error } = await supabase.rpc("worktalk_set_room_order", {
        ordered_room_ids: orderedRoomIds,
      });

      if (error) {
        setErrorMessage(error.message);
        return false;
      }

      await loadRooms(selectedRoomIdRef.current);
      return true;
    },
    [loadRooms]
  );

  const deleteGroupRoom = useCallback(
    async (roomId: number) => {
      const { data: fileRows, error: fileListError } = await supabase
        .from("worktalk_files")
        .select("storage_path")
        .eq("room_id", roomId);

      if (fileListError) {
        setErrorMessage(fileListError.message);
        return false;
      }

      const storagePaths = (fileRows || []).map((file) => file.storage_path);
      for (let index = 0; index < storagePaths.length; index += 100) {
        const { error: storageError } = await supabase.storage
          .from(WORKTALK_FILE_BUCKET)
          .remove(storagePaths.slice(index, index + 100));

        if (storageError) {
          setErrorMessage(storageError.message);
          return false;
        }
      }

      const { error } = await supabase.rpc("worktalk_delete_group_room", {
        target_room_id: roomId,
      });

      if (error) {
        setErrorMessage(error.message);
        return false;
      }

      selectedRoomIdRef.current = null;
      allowAutomaticRoomSelectionRef.current = false;
      setSelectedRoomId(null);
      setMessages([]);
      await loadRooms();
      return true;
    },
    [loadRooms]
  );

  const leaveGroupRoom = useCallback(
    async (roomId: number) => {
      const { error } = await supabase.rpc("worktalk_leave_group_room", {
        target_room_id: roomId,
      });

      if (error) {
        setErrorMessage(error.message);
        return false;
      }

      selectedRoomIdRef.current = null;
      allowAutomaticRoomSelectionRef.current = false;
      setSelectedRoomId(null);
      setMessages([]);
      await loadRooms();
      return true;
    },
    [loadRooms]
  );

  const leaveDirectRoom = useCallback(
    async (roomId: number, deleteStoredFiles: boolean) => {
      if (deleteStoredFiles) {
        const { data: fileRows, error: fileListError } = await supabase
          .from("worktalk_files")
          .select("storage_path")
          .eq("room_id", roomId);

        if (fileListError) {
          setErrorMessage(fileListError.message);
          return false;
        }

        const storagePaths = (fileRows || []).map((file) => file.storage_path);
        for (let index = 0; index < storagePaths.length; index += 100) {
          const { error: storageError } = await supabase.storage
            .from(WORKTALK_FILE_BUCKET)
            .remove(storagePaths.slice(index, index + 100));
          if (storageError) {
            setErrorMessage(storageError.message);
            return false;
          }
        }
      }

      const { error } = await supabase.rpc("worktalk_leave_direct_room", {
        target_room_id: roomId,
      });

      if (error) {
        setErrorMessage(error.message);
        return false;
      }

      selectedRoomIdRef.current = null;
      allowAutomaticRoomSelectionRef.current = false;
      setSelectedRoomId(null);
      setMessages([]);
      await loadRooms();
      return true;
    },
    [loadRooms]
  );

  const inviteMembers = useCallback(
    async (roomId: number, memberIds: string[]) => {
      if (memberIds.length === 0) return false;

      const { error } = await supabase.rpc("worktalk_invite_group_members", {
        target_room_id: roomId,
        member_ids: memberIds,
      });

      if (error) {
        setErrorMessage(error.message);
        return false;
      }

      await Promise.all([loadRooms(roomId), loadMessages(roomId)]);
      return true;
    },
    [loadMessages, loadRooms]
  );

  const setRoomNotice = useCallback(
    async (roomId: number, messageId: number) => {
      const { error } = await supabase.rpc("worktalk_set_room_notice", {
        target_room_id: roomId,
        target_message_id: messageId,
      });

      if (error) {
        setErrorMessage(error.message);
        return false;
      }

      await loadRoomNotice(roomId);
      return true;
    },
    [loadRoomNotice]
  );

  const clearRoomNotice = useCallback(
    async (roomId: number) => {
      const { error } = await supabase.rpc("worktalk_clear_room_notice", {
        target_room_id: roomId,
      });

      if (error) {
        setErrorMessage(error.message);
        return false;
      }

      setRoomNoticeState(null);
      return true;
    },
    []
  );

  const transferOwnerAndLeave = useCallback(
    async (roomId: number, newOwnerId: string) => {
      const { error } = await supabase.rpc(
        "worktalk_transfer_owner_and_leave",
        {
          target_room_id: roomId,
          new_owner_id: newOwnerId,
        }
      );

      if (error) {
        setErrorMessage(error.message);
        return false;
      }

      selectedRoomIdRef.current = null;
      setSelectedRoomId(null);
      setMessages([]);
      await loadRooms();
      return true;
    },
    [loadRooms]
  );

  useEffect(() => {
    let active = true;

    async function initialize() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!active) return;

      if (!user) {
        setSetupState("signed-out");
        return;
      }

      const { data: profile, error } = await supabase
        .from("profiles")
        .select("id,name,team,role")
        .eq("id", user.id)
        .single();

      if (!active) return;

      if (error || !profile) {
        setSetupState("error");
        setErrorMessage(error?.message || "프로필 정보를 찾을 수 없습니다.");
        return;
      }

      const nextProfile: WorkTalkProfile = {
        id: profile.id,
        name: profile.name || "",
        team: profile.team || "",
        role: profile.role || "",
      };
      setCurrentProfile(nextProfile);

      try {
        const nextProfiles = await loadProfiles();
        if (!active) return;
        setProfiles(nextProfiles);
      } catch (profileError) {
        setSetupState("error");
        setErrorMessage(formatWorkTalkError(profileError));
      }
    }

    void initialize();
    return () => {
      active = false;
    };
  }, [loadProfiles]);

  useEffect(() => {
    if (!currentProfile || profiles.length === 0) return;
    void loadRooms();
    void loadNotifications();
  }, [currentProfile, loadNotifications, loadRooms, profiles.length]);

  useEffect(() => {
    selectedRoomIdRef.current = selectedRoomId;
    if (selectedRoomId) {
      void loadMessages(selectedRoomId, pendingFocusMessageIdRef.current);
      void loadRoomNotice(selectedRoomId);
    } else {
      setMessages([]);
      setRoomNoticeState(null);
    }
  }, [loadMessages, loadRoomNotice, selectedRoomId]);

  useEffect(() => {
    if (!currentProfile || setupState !== "ready") return;

    const profileId = currentProfile.id;
    const baseChannelName = `worktalk-${profileId}`;
    const messagesChannelName = `${baseChannelName}-messages`;
    const filesChannelName = `${baseChannelName}-files`;
    const notificationsChannelName = `${baseChannelName}-notifications`;
    const metaChannelName = `${baseChannelName}-meta`;
    type RealtimeDebugSnapshot = {
      endPoint?: string;
      endpointURL?: () => string;
      connectionState?: () => string;
      isConnected?: () => boolean;
      logger?: (...args: unknown[]) => void;
      stateChangeCallbacks?: {
        open?: Array<(event?: unknown) => void>;
        close?: Array<(event?: unknown) => void>;
        error?: Array<(event?: unknown) => void>;
        message?: Array<(event?: unknown) => void>;
      };
      conn?: {
        readyState?: number;
        url?: string;
      } | null;
      setAuth?: (token?: string | null) => Promise<void>;
    };
    const getRealtimeDebugState = (realtimeClient: unknown) => {
      const snapshot = realtimeClient as RealtimeDebugSnapshot;
      return {
        realtimeEndPoint: snapshot.endPoint ?? null,
        realtimeEndpointURL:
          typeof snapshot.endpointURL === "function"
            ? snapshot.endpointURL()
            : null,
        realtimeConnectionState:
          typeof snapshot.connectionState === "function"
            ? snapshot.connectionState()
            : null,
        realtimeIsConnected:
          typeof snapshot.isConnected === "function" ? snapshot.isConnected() : null,
        realtimeConnReadyState: snapshot.conn?.readyState ?? null,
        realtimeConnUrl: snapshot.conn?.url ?? null,
      };
    };
    const getRealtimeEventDebugState = (event?: unknown) => {
      const candidate = event as
        | {
            type?: string;
            code?: number;
            reason?: string;
            wasClean?: boolean;
            message?: string;
            target?: {
              readyState?: number;
              url?: string;
            };
            currentTarget?: {
              readyState?: number;
              url?: string;
            };
          }
        | undefined;
      return {
        eventType: candidate?.type ?? null,
        closeCode: candidate?.code ?? null,
        closeReason: candidate?.reason ?? null,
        closeWasClean: candidate?.wasClean ?? null,
        errorMessage: candidate?.message ?? null,
        eventTargetReadyState: candidate?.target?.readyState ?? null,
        eventTargetUrl: candidate?.target?.url ?? null,
        eventCurrentTargetReadyState: candidate?.currentTarget?.readyState ?? null,
        eventCurrentTargetUrl: candidate?.currentTarget?.url ?? null,
      };
    };
    const logChannelStatus = (
      scope: "messages" | "files" | "notifications" | "meta",
      channelName: string,
      channel: unknown,
      status: string,
      error?: unknown
    ) => {
      const channelSnapshot = channel as {
        topic?: string;
        state?: string;
        joinedOnce?: boolean;
        joinRef?: () => string;
        socket?: {
          endPoint?: string;
          endpointURL?: () => string;
          isConnected?: () => boolean;
          connectionState?: () => string;
          conn?: {
            readyState?: number;
            url?: string;
          } | null;
        };
      };
      const debugPayload = {
        scope,
        channel: channelName,
        status,
        error,
        selectedRoomId: selectedRoomIdRef.current,
        topic: channelSnapshot.topic,
        channelState: channelSnapshot.state,
        joinedOnce: channelSnapshot.joinedOnce,
        joinRef:
          typeof channelSnapshot.joinRef === "function"
            ? channelSnapshot.joinRef()
            : null,
        socketConnected:
          typeof channelSnapshot.socket?.isConnected === "function"
            ? channelSnapshot.socket.isConnected()
            : null,
        socketState:
          typeof channelSnapshot.socket?.connectionState === "function"
            ? channelSnapshot.socket.connectionState()
            : null,
        socketEndPoint: channelSnapshot.socket?.endPoint ?? null,
        socketEndpointURL:
          typeof channelSnapshot.socket?.endpointURL === "function"
            ? channelSnapshot.socket.endpointURL()
            : null,
        socketConnReadyState: channelSnapshot.socket?.conn?.readyState ?? null,
        socketConnUrl: channelSnapshot.socket?.conn?.url ?? null,
      };
      console.log("[WorkTalk realtime debug] channel:status", {
        ...debugPayload,
        json: JSON.stringify(debugPayload),
      });
    };
    const channels: Array<ReturnType<typeof supabase.channel>> = [];
    let isCancelled = false;
    let authSubscription: { unsubscribe: () => void } | null = null;
    let realtimeDiagnosticsCleanup: (() => void) | null = null;

    async function startRealtimeChannels() {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();
      if (isCancelled) return;

      const realtimeSnapshot = supabase.realtime as unknown as RealtimeDebugSnapshot;
      if (!realtimeDiagnosticsCleanup) {
        const originalLogger = realtimeSnapshot.logger;
        const closeCallback = (event?: unknown) => {
          console.log("[WorkTalk realtime debug] realtime:close", {
            ...getRealtimeEventDebugState(event),
            ...getRealtimeDebugState(supabase.realtime),
          });
        };
        const errorCallback = (event?: unknown) => {
          console.log("[WorkTalk realtime debug] realtime:error", {
            ...getRealtimeEventDebugState(event),
            ...getRealtimeDebugState(supabase.realtime),
          });
        };
        const openCallback = (event?: unknown) => {
          console.log("[WorkTalk realtime debug] realtime:open", {
            ...getRealtimeEventDebugState(event),
            ...getRealtimeDebugState(supabase.realtime),
          });
        };
        realtimeSnapshot.logger = (...args: unknown[]) => {
          const [kind, message, data] = args;
          console.log("[WorkTalk realtime debug] realtime:logger", {
            kind,
            message,
            data,
            event: getRealtimeEventDebugState(data),
            ...getRealtimeDebugState(supabase.realtime),
          });
          if (typeof originalLogger === "function") {
            originalLogger(...args);
          }
        };
        realtimeSnapshot.stateChangeCallbacks?.close?.push(closeCallback);
        realtimeSnapshot.stateChangeCallbacks?.error?.push(errorCallback);
        realtimeSnapshot.stateChangeCallbacks?.open?.push(openCallback);
        realtimeDiagnosticsCleanup = () => {
          realtimeSnapshot.logger = originalLogger;
          const removeCallback = (
            list: Array<(event?: unknown) => void> | undefined,
            callback: (event?: unknown) => void
          ) => {
            const index = list?.indexOf(callback) ?? -1;
            if (list && index >= 0) {
              list.splice(index, 1);
            }
          };
          removeCallback(realtimeSnapshot.stateChangeCallbacks?.close, closeCallback);
          removeCallback(realtimeSnapshot.stateChangeCallbacks?.error, errorCallback);
          removeCallback(realtimeSnapshot.stateChangeCallbacks?.open, openCallback);
        };
      }

      const accessToken = session?.access_token;
      console.log("[WorkTalk realtime debug] realtime:preflight:beforeAuth", {
        hasSession: Boolean(session),
        sessionUserId: session?.user?.id ?? null,
        sessionError: sessionError?.message ?? null,
        expiresAt: session?.expires_at ?? null,
        accessTokenLength: accessToken?.length ?? 0,
        ...getRealtimeDebugState(supabase.realtime),
      });
      console.log("[WorkTalk realtime debug] realtime:network-hint", {
        websocketUrl: getRealtimeDebugState(supabase.realtime).realtimeEndpointURL,
        note:
          "브라우저 Network 탭에서 이 websocket URL의 handshake status, close code, failed reason을 확인하세요.",
      });

      if (accessToken && typeof realtimeSnapshot.setAuth === "function") {
        await realtimeSnapshot.setAuth(accessToken);
        if (isCancelled) return;
      }

      console.log("[WorkTalk realtime debug] realtime:preflight:afterAuth", {
        hasSession: Boolean(session),
        sessionUserId: session?.user?.id ?? null,
        sessionError: sessionError?.message ?? null,
        expiresAt: session?.expires_at ?? null,
        accessTokenLength: accessToken?.length ?? 0,
        ...getRealtimeDebugState(supabase.realtime),
      });

      authSubscription = supabase.auth.onAuthStateChange((_event, nextSession) => {
        const nextToken = nextSession?.access_token;
        if (nextToken && typeof realtimeSnapshot.setAuth === "function") {
          void realtimeSnapshot.setAuth(nextToken);
        }
        console.log("[WorkTalk realtime debug] realtime:auth-state", {
          event: _event,
          hasSession: Boolean(nextSession),
          sessionUserId: nextSession?.user?.id ?? null,
          accessTokenLength: nextToken?.length ?? 0,
          ...getRealtimeDebugState(supabase.realtime),
        });
      }).data.subscription;

      console.log("[WorkTalk realtime debug] channel:create", {
        scope: "messages",
        channelName: messagesChannelName,
        currentProfileId: profileId,
        selectedRoomId: selectedRoomIdRef.current,
        setupState,
      });
      console.log("[WorkTalk realtime debug] channel:create", {
        scope: "files",
        channelName: filesChannelName,
        currentProfileId: profileId,
        selectedRoomId: selectedRoomIdRef.current,
        setupState,
      });
      console.log("[WorkTalk realtime debug] channel:create", {
        scope: "notifications",
        channelName: notificationsChannelName,
        currentProfileId: profileId,
        selectedRoomId: selectedRoomIdRef.current,
        setupState,
      });
      console.log("[WorkTalk realtime debug] channel:create", {
        scope: "meta",
        channelName: metaChannelName,
        currentProfileId: profileId,
        selectedRoomId: selectedRoomIdRef.current,
        setupState,
      });

      const messagesChannel = supabase
        .channel(messagesChannelName)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "worktalk_messages" },
          (payload) => {
            const message = {
              ...(payload.new as Omit<WorkTalkMessage, "files">),
              files: [],
            };
            const activeRoomId = selectedRoomIdRef.current;
            console.log("[WorkTalk realtime debug] messages:INSERT", {
              messageId: message.id,
              roomId: message.room_id,
              activeRoomId,
              messageType: message.message_type,
              senderId: message.sender_id,
              matchesActiveRoom: message.room_id === activeRoomId,
            });

            if (message.room_id === activeRoomId) {
              scheduleMessageRefresh(message.room_id, 80);
            }

            scheduleRoomRefresh(activeRoomId);
          }
        )
        .subscribe((status, error) => {
          logChannelStatus(
            "messages",
            messagesChannelName,
            messagesChannel,
            status,
            error
          );
        });

      const filesChannel = supabase
        .channel(filesChannelName)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "worktalk_files" },
          (payload) => {
            const roomId = Number((payload.new as { room_id?: number }).room_id);
            console.log("[WorkTalk realtime debug] files:INSERT", {
              fileId: (payload.new as { id?: number }).id,
              roomId,
              messageId: (payload.new as { message_id?: number }).message_id,
              activeRoomId: selectedRoomIdRef.current,
              matchesActiveRoom: roomId === selectedRoomIdRef.current,
            });
            if (roomId && roomId === selectedRoomIdRef.current) {
              scheduleMessageRefresh(roomId, 120);
            }
          }
        )
        .subscribe((status, error) => {
          logChannelStatus("files", filesChannelName, filesChannel, status, error);
        });

      const notificationsChannel = supabase
        .channel(notificationsChannelName)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "worktalk_notifications",
            filter: `user_id=eq.${profileId}`,
          },
          (payload) => {
            const notification = payload.new as WorkTalkNotification;
            console.log("[WorkTalk realtime debug] notifications:INSERT", {
              notificationId: notification.id,
              roomId: notification.room_id,
              messageId: notification.message_id,
              type: notification.notification_type,
              activeRoomId: selectedRoomIdRef.current,
              matchesActiveRoom: notification.room_id === selectedRoomIdRef.current,
            });
            setNotifications((current) =>
              current.some((item) => item.id === notification.id)
                ? current
                : [notification, ...current].slice(0, 100)
            );
            setNotificationsReady(true);
            lastDeliveredNotificationIdRef.current = Math.max(
              lastDeliveredNotificationIdRef.current || 0,
              notification.id
            );
            setLatestNotification(notification);
            if (notification.room_id === selectedRoomIdRef.current) {
              scheduleMessageRefresh(notification.room_id, 250);
            }
          }
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "worktalk_notifications",
            filter: `user_id=eq.${profileId}`,
          },
          (payload) => {
            const notification = payload.new as WorkTalkNotification;
            setNotifications((current) =>
              current.map((item) =>
                item.id === notification.id ? notification : item
              )
            );
          }
        )
        .subscribe((status, error) => {
          logChannelStatus(
            "notifications",
            notificationsChannelName,
            notificationsChannel,
            status,
            error
          );
        });

      const metaChannel = supabase
        .channel(metaChannelName)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "worktalk_room_notices" },
          (payload) => {
            const roomId = Number(
              ((payload.new || payload.old) as { room_id?: number }).room_id
            );
            if (roomId && roomId === selectedRoomIdRef.current) {
              void loadRoomNotice(roomId);
            }
          }
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "worktalk_room_members",
          },
          () => {
            scheduleRoomRefresh(selectedRoomIdRef.current);
          }
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "worktalk_rooms" },
          () => {
            scheduleRoomRefresh(selectedRoomIdRef.current);
          }
        )
        .subscribe((status, error) => {
          logChannelStatus("meta", metaChannelName, metaChannel, status, error);
        });

      channels.push(messagesChannel, filesChannel, notificationsChannel, metaChannel);
    }

    void startRealtimeChannels();

    return () => {
      console.log("[WorkTalk realtime debug] channel:cleanup", {
        scope: "messages",
        channelName: messagesChannelName,
        selectedRoomId: selectedRoomIdRef.current,
      });
      console.log("[WorkTalk realtime debug] channel:cleanup", {
        scope: "files",
        channelName: filesChannelName,
        selectedRoomId: selectedRoomIdRef.current,
      });
      console.log("[WorkTalk realtime debug] channel:cleanup", {
        scope: "notifications",
        channelName: notificationsChannelName,
        selectedRoomId: selectedRoomIdRef.current,
      });
      console.log("[WorkTalk realtime debug] channel:cleanup", {
        scope: "meta",
        channelName: metaChannelName,
        selectedRoomId: selectedRoomIdRef.current,
      });
      if (roomRefreshTimerRef.current) {
        window.clearTimeout(roomRefreshTimerRef.current);
        roomRefreshTimerRef.current = null;
      }
      if (messageRefreshTimerRef.current) {
        window.clearTimeout(messageRefreshTimerRef.current);
        messageRefreshTimerRef.current = null;
      }
      isCancelled = true;
      authSubscription?.unsubscribe();
      realtimeDiagnosticsCleanup?.();
      channels.forEach((channel) => {
        void supabase.removeChannel(channel);
      });
    };
  }, [
    currentProfile,
    loadMessages,
    loadRoomNotice,
    scheduleMessageRefresh,
    scheduleRoomRefresh,
    setupState,
  ]);

  useEffect(() => {
    if (!currentProfile || setupState !== "ready") return;

    const refresh = () => {
      if (document.visibilityState === "visible") {
        void loadRooms(selectedRoomIdRef.current);
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const intervalId = window.setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [currentProfile, loadRooms, setupState]);

  return {
    setupState,
    errorMessage,
    clearError: () => setErrorMessage(""),
    currentProfile,
    profiles,
    rooms,
    selectedRoom,
    selectedRoomId,
    messages,
    roomNotice,
    loadingRooms,
    loadingMessages,
    sending,
    focusedMessageId,
    notifications,
    notificationsReady,
    latestNotification,
    clearLatestNotification,
    selectRoom,
    clearSelectedRoom,
    clearFocusedMessage: () => setFocusedMessageId(null),
    markRoomRead,
    searchWorkTalk,
    sendMessage,
    sendReplyMessage,
    processApprovalCommand,
    sendFiles,
    downloadFile,
    getFileUrl,
    pollDesktopNotifications,
    createDirectRoom,
    createGroupRoom,
    setRoomNotifications,
    markNotificationRead,
    markAllNotificationsRead,
    setRoomPinned,
    setRoomOrder,
    deleteGroupRoom,
    leaveGroupRoom,
    leaveDirectRoom,
    inviteMembers,
    setRoomNotice,
    clearRoomNotice,
    transferOwnerAndLeave,
    setRoomReadGuard,
    setRoomSelectionRestoreBlocked,
    reload: () => loadRooms(selectedRoomIdRef.current),
  };
}
