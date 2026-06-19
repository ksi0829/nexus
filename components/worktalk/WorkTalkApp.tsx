"use client";

import {
  DragEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  CURRENT_ORG,
  EXECUTIVE_NAMES,
  ORG_MEMBER_MAP,
  getCurrentOrgTeam,
} from "@/app/_lib/currentOrg";
import { useWorkTalk } from "@/hooks/useWorkTalk";
import { useWorkTalkPush } from "@/hooks/useWorkTalkPush";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { createManufacturingPdf } from "@/app/_lib/nexusManufacturingPdf";
import { createPurchasePdf } from "@/app/_lib/nexusPurchasePdf";
import { createPurchaseResolutionPdf } from "@/app/_lib/nexusPurchaseResolutionPdf";
import { restoreDocumentWindowPlacement } from "@/app/_lib/windowPlacement";
import type {
  WorkTalkMessage,
  WorkTalkNotification,
  WorkTalkFile,
  WorkTalkProfile,
  WorkTalkRoom,
  WorkTalkSearchResult,
  WorkTalkSearchScope,
} from "@/types/worktalk";
import { WorkTalkIcon } from "./WorkTalkIcon";
import styles from "./WorkTalkApp.module.css";

type CreateMode = "direct" | "group" | null;
type RoomFilter = "all" | "unread" | "team" | "direct";
type SearchMode = "room" | WorkTalkSearchScope;
type WorkTalkSection = "chat" | "people" | "notifications";
type ReadReceiptDebugEvent = {
  roomId: number | null;
  selectedRoomId: number | null;
  callReason: string;
  userOpenedRoomRef: boolean | null;
  confirmedDeepLinkOpenedRef: boolean | null;
  isMobileListView: boolean | null;
  mobileConversationOpen: boolean | null;
  readAllowed: boolean | null;
  timestamp: string;
  source?: string;
  stack?: string;
};
type NexusDesktopWindow = Window & {
  chrome?: {
    webview?: {
      postMessage: (message: string) => void;
    };
  };
};
type PresenceRow = {
  user_id: string;
  visible: boolean;
  last_seen_at: string;
};
type ApprovalMemberRoleRow = {
  requester_id: string | null;
  approval_lines?: {
    approver_id: string | null;
    role_label: string | null;
    step_order: number | null;
  }[];
  approval_references?: {
    user_id: string | null;
  }[];
};
const workTalkSupabase = createSupabaseBrowser();
const NEXUS_DOCUMENT_BUCKET = "nexus-documents";
const READ_RECEIPT_DEBUG_EVENT = "worktalk:read-receipt-firing";
const ORG_GROUP_ORDER = [
  "경영진",
  ...CURRENT_ORG.map((group) => group.team),
];
const MAX_FILE_COUNT = 5;
const MAX_FILE_BYTES = 30 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "xlsx",
  "xls",
  "csv",
  "docx",
  "doc",
  "pptx",
  "ppt",
  "dwg",
  "dxf",
  "zip",
]);
const FILE_ACCEPT =
  ".pdf,.png,.jpg,.jpeg,.gif,.webp,.bmp,.xlsx,.xls,.csv,.docx,.doc,.pptx,.ppt,.dwg,.dxf,.zip";

type WorkTalkDeepLink = {
  roomId: number;
  messageId?: number;
  sourceUrl: string;
  rawRoom: string | null;
  rawMessage: string | null;
};

function parsePositiveInt(value: string | null) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function readWorkTalkDeepLinkFromParams(
  params: URLSearchParams,
  sourceUrl: string
): WorkTalkDeepLink | null {
  const rawRoom = params.get("room") ?? params.get("roomId");
  const rawMessage = params.get("message") ?? params.get("messageId");
  const roomId = parsePositiveInt(rawRoom);
  if (!roomId) return null;
  const messageId = parsePositiveInt(rawMessage);
  return {
    roomId,
    messageId: messageId ?? undefined,
    sourceUrl,
    rawRoom,
    rawMessage,
  };
}

function readWorkTalkDeepLinkFromUrl(targetUrl: string | null) {
  if (typeof window === "undefined" || !targetUrl) return null;
  try {
    const url = new URL(targetUrl, window.location.origin);
    return readWorkTalkDeepLinkFromParams(
      url.searchParams,
      `${url.pathname}${url.search}`
    );
  } catch {
    return null;
  }
}

function readWorkTalkDeepLink(): WorkTalkDeepLink | null {
  if (typeof window === "undefined") return null;
  return readWorkTalkDeepLinkFromParams(
    new URLSearchParams(window.location.search),
    `${window.location.pathname}${window.location.search}`
  );
}

function logWorkTalkDeepLink(event: string, payload: Record<string, unknown>) {
  console.log("[WorkTalk deep link]", event, payload);
}

function hasWorkTalkRoomParam() {
  return Boolean(readWorkTalkDeepLink());
}

function getCurrentWorkTalkPath() {
  if (typeof window === "undefined") return "/worktalk";
  return `${window.location.pathname}${window.location.search}`;
}

function buildWorkTalkLoginUrl(nextPath = "/worktalk") {
  const params = new URLSearchParams({ next: nextPath });
  return `/login?${params.toString()}`;
}

function roomColor(room: WorkTalkRoom) {
  if (room.room_type === "team") return "team";
  if (room.room_type === "idea") return "idea";
  if (room.room_type === "approval") return "approval";
  if (room.room_type === "group") return "group";
  return "direct";
}

function roomIconName(room: WorkTalkRoom) {
  if (room.room_type === "team") return "team" as const;
  if (room.room_type === "idea") return "idea" as const;
  if (room.room_type === "approval") return "document" as const;
  if (room.room_type === "group") return "group" as const;
  return "person" as const;
}

function RoomAvatar({
  room,
  compact = false,
}: {
  room: WorkTalkRoom;
  compact?: boolean;
}) {
  return (
    <span
      className={`${compact ? styles.headerAvatar : styles.roomAvatar} ${
        styles[roomColor(room)]
      }`}
    >
      <WorkTalkIcon name={roomIconName(room)} />
    </span>
  );
}

function getRoomTitle(room: WorkTalkRoom, currentUserId?: string) {
  if (room.room_type !== "direct") return room.title || "대화방";
  return (
    room.members.find((member) => member.user_id !== currentUserId)?.profile
      ?.name || "1:1 대화"
  );
}

function getRoomSubtitle(room: WorkTalkRoom, currentUserId?: string) {
  if (room.latestMessage) return room.latestMessage.body;
  if (room.room_type === "direct") {
    return (
      room.members.find((member) => member.user_id !== currentUserId)?.profile
        ?.team || "대화를 시작해 보세요"
    );
  }
  if (room.room_type === "team") return "팀 업무 공유방";
  if (room.room_type === "idea") return "전사 아이디어 소통방";
  return `${room.members.length}명 참여`;
}

function getRoomMemberRole(
  room: WorkTalkRoom,
  member: WorkTalkRoom["members"][number],
  approvalRoleByUser?: Record<string, string>
) {
  if (room.room_type === "approval") {
    const approvalRole = approvalRoleByUser?.[member.user_id];
    if (approvalRole) return approvalRole;
    if (member.user_id === room.created_by) return "작성자";
    if (member.member_role === "viewer") return "참조";
    return "결재자";
  }
  if (member.user_id === room.created_by) return "방장";
  if (member.member_role === "viewer") return "조회";
  return "참여자";
}

function formatRoomTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
}

function formatMessageTime(value: string) {
  return new Date(value).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

function formatFileSize(size: number) {
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function fileExtension(name: string) {
  return name.split(".").pop()?.toLocaleLowerCase() || "";
}

function isImageFile(file: WorkTalkFile) {
  return (
    file.mime_type?.startsWith("image/") ||
    ["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(
      fileExtension(file.original_name)
    )
  );
}

function validateFiles(files: File[]) {
  if (files.length > MAX_FILE_COUNT) {
    return `파일은 한 번에 최대 ${MAX_FILE_COUNT}개까지 첨부할 수 있습니다.`;
  }

  for (const file of files) {
    if (!ALLOWED_EXTENSIONS.has(fileExtension(file.name))) {
      return `${file.name}: 지원하지 않는 파일 형식입니다.`;
    }
    if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
      return `${file.name}: 파일 크기는 30MB 이하여야 합니다.`;
    }
  }

  return "";
}

function roomMatchesFilter(room: WorkTalkRoom, filter: RoomFilter) {
  if (filter === "unread") return room.unreadCount > 0;
  if (filter === "team")
    return room.room_type === "team" || room.room_type === "idea";
  if (filter === "direct")
    return room.room_type === "direct" || room.room_type === "group";
  return true;
}

function getRemainingReaderCount(
  room: WorkTalkRoom,
  message: WorkTalkMessage,
  currentUserId?: string
) {
  if (!currentUserId || message.sender_id !== currentUserId) return null;
  const messageCreatedAt = new Date(message.created_at).getTime();

  return room.members.filter((member) => {
    if (member.user_id === currentUserId) return false;
    if (member.left_at) return false;
    if (new Date(member.joined_at).getTime() > messageCreatedAt) return false;
    return (
      member.last_read_message_id === null ||
      member.last_read_message_id < message.id
    );
  }).length;
}

function getProfileOrgTeam(profile: WorkTalkProfile) {
  return EXECUTIVE_NAMES.includes(profile.name)
    ? "경영진"
    : getCurrentOrgTeam(profile.name, profile.team);
}

function isCurrentOrgProfile(profile: WorkTalkProfile) {
  return (
    EXECUTIVE_NAMES.includes(profile.name) ||
    ORG_MEMBER_MAP.has(profile.name)
  );
}

function isOnlinePresence(presence: PresenceRow) {
  return (
    presence.visible &&
    Date.now() - new Date(presence.last_seen_at).getTime() < 45_000
  );
}

export function WorkTalkApp() {
  const router = useRouter();
  useEffect(() => {
    restoreDocumentWindowPlacement();
  }, []);

  const {
    setupState,
    errorMessage,
    clearError,
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
    clearFocusedMessage,
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
    reload,
  } = useWorkTalk();
  const [activeSection, setActiveSection] = useState<WorkTalkSection>(() => {
    if (typeof window === "undefined") return "people";
    return hasWorkTalkRoomParam() ? "chat" : "people";
  });
  const [peopleSearch, setPeopleSearch] = useState("");
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(
    null
  );
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const [startingDirectChat, setStartingDirectChat] = useState(false);
  const [notificationFilter, setNotificationFilter] = useState<
    "unread" | "all"
  >("unread");
  const [browserNotificationPermission, setBrowserNotificationPermission] =
    useState<NotificationPermission | "unsupported" | "loading">("loading");
  const [isNexusDesktopApp] = useState(
    () =>
      typeof window !== "undefined" &&
      Boolean((window as NexusDesktopWindow).chrome?.webview)
  );
  const [roomSearch, setRoomSearch] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("room");
  const [searchResults, setSearchResults] = useState<WorkTalkSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [messageSearch, setMessageSearch] = useState("");
  const [filter, setFilter] = useState<RoomFilter>("all");
  const [draft, setDraft] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState("");
  const [imageUrls, setImageUrls] = useState<Record<number, string>>({});
  const [previewImage, setPreviewImage] = useState<{
    file: WorkTalkFile;
    url: string;
  } | null>(null);
  const [previewPdf, setPreviewPdf] = useState<{
    file: WorkTalkFile;
    url: string;
  } | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [mobileConversationOpen, setMobileConversationOpen] = useState(
    () => hasWorkTalkRoomParam()
  );
  const [pendingDeepLinkRoomId, setPendingDeepLinkRoomId] = useState(
    () => readWorkTalkDeepLink()?.roomId ?? null
  );
  const [serviceWorkerDeepLink, setServiceWorkerDeepLink] =
    useState<WorkTalkDeepLink | null>(null);
  const [popupMode, setPopupMode] = useState(false);
  const [highlightedRoomId, setHighlightedRoomId] = useState<number | null>(null);
  const [createMode, setCreateMode] = useState<CreateMode>(null);
  const [groupTitle, setGroupTitle] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [draggedRoomId, setDraggedRoomId] = useState<number | null>(null);
  const [roomMenuOpen, setRoomMenuOpen] = useState(false);
  const [roomAction, setRoomAction] = useState<
    "delete" | "leave" | "direct-leave" | null
  >(null);
  const [roomActionBusy, setRoomActionBusy] = useState(false);
  const [memberManagerOpen, setMemberManagerOpen] = useState(false);
  const [memberListOpen, setMemberListOpen] = useState(false);
  const [selectedRoomApprovalRoles, setSelectedRoomApprovalRoles] = useState<{
    roomId: number | null;
    roles: Record<string, string>;
  }>({ roomId: null, roles: {} });
  const [inviteMemberIds, setInviteMemberIds] = useState<string[]>([]);
  const [invitingMembers, setInvitingMembers] = useState(false);
  const [transferOwnerOpen, setTransferOwnerOpen] = useState(false);
  const [newOwnerId, setNewOwnerId] = useState("");
  const [transferringOwner, setTransferringOwner] = useState(false);
  const [replyTarget, setReplyTarget] = useState<WorkTalkMessage | null>(null);
  const [messageMenu, setMessageMenu] = useState<{
    message: WorkTalkMessage;
    x: number;
    y: number;
  } | null>(null);
  const [readReceiptDebugEvents, setReadReceiptDebugEvents] = useState<
    ReadReceiptDebugEvent[]
  >([]);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfPreviewRef = useRef<HTMLElement>(null);
  const deepLinkHandledRef = useRef(false);
  const userOpenedRoomRef = useRef(false);
  const confirmedDeepLinkOpenedRef = useRef(false);
  const lastVisibleReadKeyRef = useRef("");
  const activeSectionRef = useRef<WorkTalkSection>(activeSection);
  const selectedRoomIdUiRef = useRef<number | null>(selectedRoomId);
  const mobileConversationOpenRef = useRef(mobileConversationOpen);
  const pendingDeepLinkRoomIdRef = useRef<number | null>(pendingDeepLinkRoomId);
  const serviceWorkerDeepLinkRef = useRef<WorkTalkDeepLink | null>(
    serviceWorkerDeepLink
  );
  const isMobileListViewRef = useRef(false);
  const readAllowedRef = useRef(false);
  const bottomScrollRafRef = useRef<number | null>(null);
  const bottomScrollTimersRef = useRef<number[]>([]);
  const {
    status: pushStatus,
    errorMessage: pushErrorMessage,
    isIOS,
    isStandalone,
    canInstall,
    install,
    subscribe: subscribeToPush,
    unsubscribe: unsubscribeFromPush,
  } = useWorkTalkPush(Boolean(currentProfile) && !isNexusDesktopApp);

  const isNarrowLayoutNow =
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 760px)").matches;
  const isActualMobileListView =
    isNarrowLayoutNow && activeSection === "chat" && !mobileConversationOpen;
  const isActualConversationView =
    activeSection === "chat" &&
    Boolean(selectedRoomId && selectedRoom) &&
    !pendingDeepLinkRoomId &&
    !serviceWorkerDeepLink &&
    (!isNarrowLayoutNow || mobileConversationOpen);
  const showReadReceiptDebugPanel =
    process.env.NODE_ENV === "development" || currentProfile?.role === "admin";

  const appendReadReceiptDebugEvent = useCallback(
    (event: Omit<ReadReceiptDebugEvent, "timestamp"> & { timestamp?: string }) => {
      const timestamp =
        event.timestamp ||
        new Date().toLocaleTimeString("ko-KR", {
          hour12: false,
        });

      setReadReceiptDebugEvents((current) =>
        [{ ...event, timestamp }, ...current].slice(0, 10)
      );
    },
    []
  );

  const forceMobileListModeReset = useCallback(
    (reason: string) => {
      console.warn("[WorkTalk read guard] forceMobileListModeReset called", {
        resetReason: reason,
        activeSection: activeSectionRef.current,
        selectedRoomRef: selectedRoomIdUiRef.current,
        pendingDeepLinkRoomId: pendingDeepLinkRoomIdRef.current,
        isMobileListViewRef: isMobileListViewRef.current,
        readAllowedRef: readAllowedRef.current,
      });
      readAllowedRef.current = false;
      isMobileListViewRef.current = true;
      userOpenedRoomRef.current = false;
      confirmedDeepLinkOpenedRef.current = false;
      lastVisibleReadKeyRef.current = "";
      setRoomSelectionRestoreBlocked(true, reason);
      clearSelectedRoom(reason);
      setPendingDeepLinkRoomId(null);
      setServiceWorkerDeepLink(null);
      deepLinkHandledRef.current = false;
    },
    [clearSelectedRoom, setRoomSelectionRestoreBlocked]
  );

  useEffect(() => {
    if (isActualMobileListView) {
      console.warn(
        "[WorkTalk read guard] forceMobileListModeReset called before loadRooms",
        {
          activeSection,
          selectedRoomId,
          pendingDeepLinkRoomId,
          mobileConversationOpen,
        }
      );
      setRoomSelectionRestoreBlocked(true, "mobile_list_before_loadRooms");
      return;
    }

    setRoomSelectionRestoreBlocked(false, "conversation_or_non_mobile_list");
  }, [
    activeSection,
    isActualMobileListView,
    mobileConversationOpen,
    pendingDeepLinkRoomId,
    selectedRoomId,
    setRoomSelectionRestoreBlocked,
  ]);

  useEffect(() => {
    activeSectionRef.current = activeSection;
    selectedRoomIdUiRef.current = selectedRoomId;
    mobileConversationOpenRef.current = mobileConversationOpen;
    pendingDeepLinkRoomIdRef.current = pendingDeepLinkRoomId;
    serviceWorkerDeepLinkRef.current = serviceWorkerDeepLink;
    isMobileListViewRef.current = isActualMobileListView;
    readAllowedRef.current = isActualConversationView;
    if (isActualMobileListView) {
      userOpenedRoomRef.current = false;
      confirmedDeepLinkOpenedRef.current = false;
    }
  }, [
    activeSection,
    isActualConversationView,
    isActualMobileListView,
    mobileConversationOpen,
    pendingDeepLinkRoomId,
    selectedRoomId,
    serviceWorkerDeepLink,
  ]);

  useEffect(() => {
    if (!showReadReceiptDebugPanel) return;

    const handleReadReceiptDebugEvent = (event: Event) => {
      const detail = (event as CustomEvent<Partial<ReadReceiptDebugEvent>>)
        .detail;
      if (!detail) return;

      appendReadReceiptDebugEvent({
        roomId: detail.roomId ?? null,
        selectedRoomId: detail.selectedRoomId ?? null,
        readAllowed: detail.readAllowed ?? null,
        mobileConversationOpen: detail.mobileConversationOpen ?? null,
        isMobileListView: detail.isMobileListView ?? null,
        userOpenedRoomRef: detail.userOpenedRoomRef ?? null,
        confirmedDeepLinkOpenedRef: detail.confirmedDeepLinkOpenedRef ?? null,
        callReason: detail.callReason || "unknown",
        source: detail.source || "unknown",
        stack: detail.stack,
      });
    };

    window.addEventListener(
      READ_RECEIPT_DEBUG_EVENT,
      handleReadReceiptDebugEvent
    );

    return () => {
      window.removeEventListener(
        READ_RECEIPT_DEBUG_EVENT,
        handleReadReceiptDebugEvent
      );
    };
  }, [appendReadReceiptDebugEvent, showReadReceiptDebugPanel]);

  useEffect(() => {
    setRoomReadGuard((context) => {
      const isMobileListView = isMobileListViewRef.current;
      const readAllowed = readAllowedRef.current;
      const fromPushDeepLink = Boolean(
        pendingDeepLinkRoomIdRef.current || serviceWorkerDeepLinkRef.current
      );
      const isConversationView =
        activeSectionRef.current === "chat" &&
        selectedRoomIdUiRef.current === context.roomId &&
        !isMobileListView &&
        readAllowed;
      const isMessageListMounted = Boolean(messageEndRef.current);
      const isDocumentVisible =
        context.documentVisibilityState === "visible" ||
        context.documentVisibilityState === "unknown";

      let reason = "message view visible";
      if (!isDocumentVisible) reason = "document not visible";
      else if (isMobileListView) reason = "mobile chat list view";
      else if (fromPushDeepLink) reason = "pending push deep link";
      else if (selectedRoomIdUiRef.current !== context.roomId) {
        reason = "room mismatch";
      } else if (activeSectionRef.current !== "chat") reason = "not chat section";
      else if (!readAllowed) reason = "readAllowedRef false";
      else if (!isMessageListMounted) {
        reason = "message list not mounted";
      }

      return {
        allowed:
          isDocumentVisible &&
          !isMobileListView &&
          !fromPushDeepLink &&
          isConversationView &&
          isMessageListMounted &&
          readAllowed,
        reason,
        viewMode: activeSectionRef.current,
        fromPushDeepLink,
        pendingDeepLinkRoomId: pendingDeepLinkRoomIdRef.current,
        mobileConversationOpen: mobileConversationOpenRef.current,
        mobileView: isMobileListView ? "list" : "detail",
        readAllowed,
      };
    });

    return () => setRoomReadGuard(null);
  }, [setRoomReadGuard]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    console.log("[WorkTalk read guard] rendered view mode", {
      activeSection,
      selectedRoomId,
      mobileConversationOpen,
      pendingDeepLinkRoomId,
      messagePanelMounted: Boolean(messageEndRef.current),
      mobileView: isActualMobileListView ? "list" : "detail",
      isMobileListViewRef: isMobileListViewRef.current,
      readAllowedRef: readAllowedRef.current,
    });

    if (
      !isActualMobileListView ||
      (!selectedRoomId && !pendingDeepLinkRoomId && !readAllowedRef.current)
    ) {
      return;
    }

    console.warn("[WorkTalk read guard] push fallback reset called", {
      selectedRoomId,
      pendingDeepLinkRoomId,
      activeSection,
      mobileConversationOpen,
    });
    const resetTimer = window.setTimeout(() => {
      forceMobileListModeReset(
        pendingDeepLinkRoomId ? "push_open_list_fallback" : "normal_list"
      );
    }, 0);
    return () => window.clearTimeout(resetTimer);
  }, [
    activeSection,
    forceMobileListModeReset,
    isActualMobileListView,
    mobileConversationOpen,
    pendingDeepLinkRoomId,
    selectedRoomId,
  ]);

  useEffect(() => {
    const imageFiles = messages
      .flatMap((message) => message.files)
      .filter((file) => isImageFile(file) && !imageUrls[file.id]);

    if (imageFiles.length === 0) return;
    let cancelled = false;

    void Promise.all(
      imageFiles.map(async (file) => ({
        id: file.id,
        url: await getFileUrl(file),
      }))
    ).then((results) => {
      if (cancelled) return;
      if (!results.some((result) => result.url)) return;
      setImageUrls((current) => {
        const next = { ...current };
        results.forEach(({ id, url }) => {
          if (url) next[id] = url;
        });
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [getFileUrl, imageUrls, messages]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const section = params.get("section");
    const isPopup = params.get("popup") === "1";
    if (isPopup) {
      const popupTimeoutId = window.setTimeout(() => setPopupMode(true), 0);
      return () => window.clearTimeout(popupTimeoutId);
    }
    if (
      section === "chat" ||
      section === "people" ||
      section === "notifications"
    ) {
      const timeoutId = window.setTimeout(() => {
        setActiveSection(section);
        setMobileConversationOpen(false);
        window.history.replaceState({}, "", "/worktalk");
      }, 0);
      return () => window.clearTimeout(timeoutId);
    }
  }, []);

  function goToNexusHome() {
    setActiveSection("people");
    setPeopleSearch("");
    setSelectedProfileId(null);
    setMobileConversationOpen(false);
    setCreateMode(null);
    setRoomMenuOpen(false);
    setMemberManagerOpen(false);
    setMemberListOpen(false);
  }

  async function handleLogout() {
    await createSupabaseBrowser().auth.signOut();
    localStorage.removeItem("role");
    localStorage.removeItem("team");
    localStorage.removeItem("name");
    router.replace("/login");
  }

  const filteredRooms = useMemo(() => {
    const query = roomSearch.trim().toLocaleLowerCase("ko");
    return rooms.filter((room) => {
      if (!roomMatchesFilter(room, filter)) return false;
      if (!query) return true;
      const title = getRoomTitle(room, currentProfile?.id);
      const memberText = room.members
        .map((member) => member.profile?.name || "")
        .join(" ");
      return `${title} ${memberText} ${room.latestMessage?.body || ""}`
        .toLocaleLowerCase("ko")
        .includes(query);
    });
  }, [currentProfile?.id, filter, roomSearch, rooms]);

  const filteredMessages = useMemo(() => {
    const query = messageSearch.trim().toLocaleLowerCase("ko");
    if (!query) return messages;
    return messages.filter((message) =>
      `${message.sender_name} ${message.body}`
        .toLocaleLowerCase("ko")
        .includes(query)
    );
  }, [messageSearch, messages]);
  const messageTailKey = useMemo(() => {
    const lastMessage = filteredMessages.at(-1);
    if (!lastMessage) return "";
    return `${lastMessage.id}:${lastMessage.files.length}`;
  }, [filteredMessages]);

  const availableProfiles = useMemo(
    () => profiles.filter((profile) => profile.id !== currentProfile?.id),
    [currentProfile?.id, profiles]
  );
  const orgProfiles = useMemo(
    () =>
      profiles
        .filter(isCurrentOrgProfile)
        .sort((left, right) => {
          const leftTeam = getProfileOrgTeam(left);
          const rightTeam = getProfileOrgTeam(right);
          const leftIndex = ORG_GROUP_ORDER.indexOf(leftTeam);
          const rightIndex = ORG_GROUP_ORDER.indexOf(rightTeam);
          if (leftIndex !== rightIndex) {
            return (leftIndex < 0 ? 999 : leftIndex) -
              (rightIndex < 0 ? 999 : rightIndex);
          }
          return left.name.localeCompare(right.name, "ko");
        }),
    [profiles]
  );
  const groupedOrgProfiles = useMemo(() => {
    const query = peopleSearch.trim().toLocaleLowerCase("ko");
    const groups = new Map<string, WorkTalkProfile[]>();

    orgProfiles.forEach((profile) => {
      const team = getProfileOrgTeam(profile) || "소속 미지정";
      if (
        query &&
        !`${profile.name} ${team} ${profile.role}`
          .toLocaleLowerCase("ko")
          .includes(query)
      ) {
        return;
      }
      groups.set(team, [...(groups.get(team) || []), profile]);
    });

    return Array.from(groups.entries()).sort(([left], [right]) => {
      const leftIndex = ORG_GROUP_ORDER.indexOf(left);
      const rightIndex = ORG_GROUP_ORDER.indexOf(right);
      return (leftIndex < 0 ? 999 : leftIndex) -
        (rightIndex < 0 ? 999 : rightIndex);
    });
  }, [orgProfiles, peopleSearch]);
  const onlineOrgCount = orgProfiles.filter((profile) =>
    onlineUserIds.has(profile.id)
  ).length;
  const selectedProfile =
    orgProfiles.find((profile) => profile.id === selectedProfileId) ||
    currentProfile;

  const ownMembership = selectedRoom?.members.find(
    (member) => member.user_id === currentProfile?.id
  );
  const notificationsEnabled =
    ownMembership?.notifications_enabled ?? true;
  const selectedRoomPinned = ownMembership?.is_pinned ?? false;
  const isSelectedRoomOwner =
    selectedRoom?.room_type === "group" &&
    selectedRoom.created_by === currentProfile?.id;
  const canLeaveSelectedRoom =
    selectedRoom?.room_type === "group" &&
    !selectedRoom.is_fixed &&
    !isSelectedRoomOwner;
  const canLeaveDirectRoom =
    selectedRoom?.room_type === "direct" && !selectedRoom.is_fixed;
  const activeDirectMemberCount =
    selectedRoom?.room_type === "direct"
      ? selectedRoom.members.filter((member) => !member.left_at).length
      : 0;
  const selectedRoomMembers = useMemo(
    () =>
      selectedRoom
        ? [...selectedRoom.members].sort((left, right) =>
            (left.profile?.name || "").localeCompare(
              right.profile?.name || "",
              "ko"
            )
          )
        : [],
    [selectedRoom]
  );

  useEffect(() => {
    if (!selectedRoomId || !selectedRoom || messages.length === 0) return;

    const latestMessage = messages.at(-1);
    if (!latestMessage) return;

    const isNarrowLayout =
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 760px)").matches;
    const isMobileListView = isMobileListViewRef.current;
    const fromPushDeepLink = Boolean(
      pendingDeepLinkRoomId || serviceWorkerDeepLink
    );
    const isDocumentVisible =
      typeof document === "undefined" || document.visibilityState === "visible";
    const isMessageListMounted = Boolean(messageEndRef.current);
    const hasConfirmedOpen =
      userOpenedRoomRef.current || confirmedDeepLinkOpenedRef.current;
    const isConversationVisible =
      activeSection === "chat" &&
      selectedRoom.id === selectedRoomId &&
      !isMobileListView &&
      readAllowedRef.current &&
      (!isNarrowLayout || mobileConversationOpen) &&
      isMessageListMounted &&
      !fromPushDeepLink &&
      isDocumentVisible &&
      hasConfirmedOpen;

    const logPayload = {
      roomId: selectedRoomId,
      latestMessageId: latestMessage.id,
      activeSection,
      mobileConversationOpen,
      pendingDeepLinkRoomId,
      fromPushDeepLink,
      documentVisibilityState:
        typeof document === "undefined" ? "unknown" : document.visibilityState,
      isNarrowLayout,
      isMobileListView,
      isMessageListMounted,
      isConversationVisible,
      isMobileListViewRef: isMobileListViewRef.current,
      readAllowedRef: readAllowedRef.current,
      userOpenedRoomRef: userOpenedRoomRef.current,
      confirmedDeepLinkOpenedRef: confirmedDeepLinkOpenedRef.current,
      hasConfirmedOpen,
    };

    console.log(
      "[WorkTalk read guard] conversation visible effect decision",
      logPayload
    );

    if (!hasConfirmedOpen) {
      console.warn("[WorkTalk read guard] auto read blocked: no user open", logPayload);
      return;
    }

    if (!isConversationVisible) {
      console.warn(
        "[WorkTalk read guard] visible message panel not ready",
        logPayload
      );
      return;
    }

    const readKey = `${selectedRoomId}:${latestMessage.id}`;
    if (lastVisibleReadKeyRef.current === readKey) return;
    lastVisibleReadKeyRef.current = readKey;

    const readReceiptDebugEvent = {
      roomId: selectedRoomId,
      selectedRoomId,
      readAllowed: readAllowedRef.current,
      mobileConversationOpen,
      isMobileListView,
      userOpenedRoomRef: userOpenedRoomRef.current,
      confirmedDeepLinkOpenedRef: confirmedDeepLinkOpenedRef.current,
      callReason: "conversation:visible-message-panel",
      stack: new Error().stack,
    };

    console.error("READ RECEIPT FIRING", readReceiptDebugEvent);
    appendReadReceiptDebugEvent({
      ...readReceiptDebugEvent,
      source: "WorkTalkApp:auto-read-effect",
    });

    void markRoomRead(
      selectedRoomId,
      latestMessage.id,
      "conversation:visible-message-panel"
    ).then((marked) => {
      if (!marked && lastVisibleReadKeyRef.current === readKey) {
        lastVisibleReadKeyRef.current = "";
      }
    });
  }, [
    activeSection,
    appendReadReceiptDebugEvent,
    markRoomRead,
    messageTailKey,
    messages,
    mobileConversationOpen,
    pendingDeepLinkRoomId,
    selectedRoom,
    selectedRoomId,
    serviceWorkerDeepLink,
  ]);

  useEffect(() => {
    if (!memberListOpen || selectedRoom?.room_type !== "approval") {
      return;
    }

    let cancelled = false;
    void workTalkSupabase
      .from("approval_documents")
      .select(
        "requester_id,approval_lines(step_order,role_label,approver_id),approval_references(user_id)"
      )
      .eq("worktalk_room_id", selectedRoom.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;

        const document = data as ApprovalMemberRoleRow | null;
        const roleByUser: Record<string, string> = {};
        if (document?.requester_id) {
          roleByUser[document.requester_id] = "작성자";
        }
        [...(document?.approval_lines || [])]
          .sort((left, right) => (left.step_order || 0) - (right.step_order || 0))
          .forEach((line, index, lines) => {
            if (!line.approver_id) return;
            roleByUser[line.approver_id] =
              line.role_label?.trim() ||
              (lines.length === 1
                ? "1차 최종 결재"
                : index === lines.length - 1
                  ? `${index + 1}차 최종 결재`
                  : `${index + 1}차 결재`);
          });
        (document?.approval_references || []).forEach((reference) => {
          if (reference.user_id && !roleByUser[reference.user_id]) {
            roleByUser[reference.user_id] = "참조";
          }
        });
        setSelectedRoomApprovalRoles({
          roomId: selectedRoom.id,
          roles: roleByUser,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [memberListOpen, selectedRoom?.id, selectedRoom?.room_type]);

  const activeMemberIds = useMemo(
    () => new Set(selectedRoom?.members.map((member) => member.user_id) || []),
    [selectedRoom?.members]
  );
  const inviteCandidates = useMemo(
    () => profiles.filter((profile) => !activeMemberIds.has(profile.id)),
    [activeMemberIds, profiles]
  );
  const ownershipCandidates = useMemo(
    () =>
      selectedRoom?.members.filter(
        (member) => member.user_id !== currentProfile?.id
      ) || [],
    [currentProfile?.id, selectedRoom?.members]
  );
  const totalUnread = rooms.reduce((sum, room) => sum + room.unreadCount, 0);
  const unreadNotificationCount = notifications.filter(
    (notification) => !notification.read_at
  ).length;
  const visibleNotifications =
    notificationFilter === "unread"
      ? notifications.filter((notification) => !notification.read_at)
      : notifications;
  const canReorderRooms = filter === "all" && !roomSearch.trim();
  const clearBottomScrollTimers = useCallback(() => {
    if (bottomScrollRafRef.current !== null) {
      window.cancelAnimationFrame(bottomScrollRafRef.current);
      bottomScrollRafRef.current = null;
    }
    bottomScrollTimersRef.current.forEach((timerId) =>
      window.clearTimeout(timerId)
    );
    bottomScrollTimersRef.current = [];
  }, []);
  const scrollConversationToBottom = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      messageEndRef.current?.scrollIntoView({
        behavior,
        block: "end",
      });
    },
    []
  );
  const scheduleBottomScroll = useCallback(
    (
      behavior: ScrollBehavior = "auto",
      options: { extraSettle?: boolean } = {}
    ) => {
      clearBottomScrollTimers();
      bottomScrollRafRef.current = window.requestAnimationFrame(() => {
        bottomScrollRafRef.current = null;
        scrollConversationToBottom(behavior);
      });
      [140, ...(options.extraSettle ? [420] : [])].forEach((delay) => {
        const timerId = window.setTimeout(
          () => scrollConversationToBottom("auto"),
          delay
        );
        bottomScrollTimersRef.current.push(timerId);
      });
    },
    [clearBottomScrollTimers, scrollConversationToBottom]
  );
  const openNotification = useCallback(
    async (notification: WorkTalkNotification) => {
      await markNotificationRead(notification.id);
      setActiveSection("chat");
      userOpenedRoomRef.current = true;
      console.warn("[WorkTalk read guard] userOpenedRoomRef set true", {
        roomId: notification.room_id,
        source: "notification_click",
      });
      selectRoom(notification.room_id, notification.message_id);
      setMobileConversationOpen(true);
      scheduleBottomScroll("auto", { extraSettle: true });
    },
    [markNotificationRead, scheduleBottomScroll, selectRoom]
  );

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    const handleServiceWorkerMessage = (event: MessageEvent) => {
      const data = event.data as
        | {
            type?: string;
            targetUrl?: string;
            url?: string;
            roomId?: string | number | null;
            room?: string | number | null;
            messageId?: string | number | null;
            message?: string | number | null;
          }
        | null;

      if (!data || data.type !== "WORKTALK_DEEP_LINK") return;

      const targetUrl = data.targetUrl || data.url || null;
      let deepLink = readWorkTalkDeepLinkFromUrl(targetUrl);

      if (!deepLink) {
        const rawRoom =
          data.roomId !== undefined && data.roomId !== null
            ? String(data.roomId)
            : data.room !== undefined && data.room !== null
              ? String(data.room)
              : null;
        const rawMessage =
          data.messageId !== undefined && data.messageId !== null
            ? String(data.messageId)
            : data.message !== undefined && data.message !== null
              ? String(data.message)
              : null;
        const roomId = parsePositiveInt(rawRoom);
        const messageId = parsePositiveInt(rawMessage);

        if (roomId) {
          deepLink = {
            roomId,
            messageId: messageId ?? undefined,
            sourceUrl: targetUrl || "/worktalk",
            rawRoom,
            rawMessage,
          };
        }
      }

      logWorkTalkDeepLink("postMessage deep link", {
        targetUrl,
        roomId: deepLink?.roomId ?? null,
        messageId: deepLink?.messageId ?? null,
        rawData: data,
      });

      if (!deepLink) {
        logWorkTalkDeepLink("fallback reason", {
          reason: "invalid service worker deep link",
          targetUrl,
        });
        return;
      }

      deepLinkHandledRef.current = false;
      setServiceWorkerDeepLink(deepLink);
      setPendingDeepLinkRoomId(deepLink.roomId);
      setActiveSection("chat");
      setMobileConversationOpen(true);
    };

    navigator.serviceWorker.addEventListener(
      "message",
      handleServiceWorkerMessage
    );
    return () => {
      navigator.serviceWorker.removeEventListener(
        "message",
        handleServiceWorkerMessage
      );
    };
  }, []);

  useEffect(() => {
    const deepLink = serviceWorkerDeepLink ?? readWorkTalkDeepLink();

    if (!deepLink) {
      return;
    }

    logWorkTalkDeepLink("push deep link url", {
      url: deepLink.sourceUrl,
    });
    logWorkTalkDeepLink("query roomId", {
      roomId: deepLink.roomId,
      messageId: deepLink.messageId ?? null,
      rawRoom: deepLink.rawRoom,
      rawMessage: deepLink.rawMessage,
    });

    if (pendingDeepLinkRoomId !== deepLink.roomId) {
      const pendingTimeoutId = window.setTimeout(() => {
        setPendingDeepLinkRoomId(deepLink.roomId);
        setActiveSection("chat");
        setMobileConversationOpen(true);
      }, 0);
      return () => window.clearTimeout(pendingTimeoutId);
    }

    if (deepLinkHandledRef.current) {
      logWorkTalkDeepLink("fallback reason", {
        reason: "already handled",
        roomId: deepLink.roomId,
      });
      return;
    }

    if (!currentProfile) {
      logWorkTalkDeepLink("fallback reason", {
        reason: "waiting currentProfile",
        roomId: deepLink.roomId,
      });
      return;
    }

    if (setupState !== "ready") {
      logWorkTalkDeepLink("fallback reason", {
        reason: "waiting setup ready",
        setupState,
        roomId: deepLink.roomId,
      });
      return;
    }

    const targetRoom = rooms.find((room) => room.id === deepLink.roomId);
    logWorkTalkDeepLink("rooms loaded count", {
      count: rooms.length,
      roomId: deepLink.roomId,
    });
    logWorkTalkDeepLink("target room found", {
      found: Boolean(targetRoom),
      roomId: deepLink.roomId,
      title: targetRoom ? getRoomTitle(targetRoom, currentProfile.id) : null,
    });

    if (!targetRoom) {
      logWorkTalkDeepLink("fallback reason", {
        reason: rooms.length === 0 ? "waiting rooms" : "target room not in rooms",
        roomId: deepLink.roomId,
        roomsCount: rooms.length,
      });
      return;
    }

    deepLinkHandledRef.current = true;

    const timeoutId = window.setTimeout(() => {
      setPendingDeepLinkRoomId(null);
      setActiveSection("chat");
      setMobileConversationOpen(true);
      confirmedDeepLinkOpenedRef.current = true;
      console.warn("[WorkTalk read guard] confirmedDeepLinkOpened set true", {
        roomId: deepLink.roomId,
        messageId: deepLink.messageId ?? null,
      });
      logWorkTalkDeepLink("selectRoom called", {
        roomId: deepLink.roomId,
        messageId: deepLink.messageId ?? null,
      });
      selectRoom(
        deepLink.roomId,
        deepLink.messageId
      );
      setServiceWorkerDeepLink(null);
      window.history.replaceState({}, "", "/worktalk");
      if (!deepLink.messageId) {
        scheduleBottomScroll("auto", { extraSettle: true });
      }
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [
    currentProfile,
    pendingDeepLinkRoomId,
    rooms,
    scheduleBottomScroll,
    selectRoom,
    serviceWorkerDeepLink,
    setupState,
  ]);

  useEffect(() => {
    logWorkTalkDeepLink("selectedRoom id", {
      selectedRoomId,
      pendingDeepLinkRoomId,
    });
  }, [pendingDeepLinkRoomId, selectedRoomId]);

  useEffect(() => {
    if (searchMode === "room") return;

    const query = roomSearch.trim();
    if (query.length < 2) return;

    let active = true;
    const timeoutId = window.setTimeout(async () => {
      const results = await searchWorkTalk(query, searchMode);
      if (!active) return;
      setSearchResults(results);
      setSearching(false);
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [roomSearch, searchMode, searchWorkTalk]);

  useEffect(() => {
    if (!focusedMessageId) return;
    const timeoutId = window.setTimeout(() => {
      document
        .querySelector(`[data-message-id="${focusedMessageId}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (focusedMessageId === filteredMessages.at(-1)?.id) {
        scheduleBottomScroll();
      }
    }, 80);
    const clearTimeoutId = window.setTimeout(() => {
      clearFocusedMessage();
    }, 3600);
    return () => {
      window.clearTimeout(timeoutId);
      window.clearTimeout(clearTimeoutId);
    };
  }, [
    clearFocusedMessage,
    filteredMessages,
    focusedMessageId,
    messages,
    scheduleBottomScroll,
  ]);

  useEffect(() => {
    if (!selectedRoomId || focusedMessageId || !messageTailKey) return;
    scheduleBottomScroll("smooth");
  }, [focusedMessageId, messageTailKey, scheduleBottomScroll, selectedRoomId]);

  useEffect(
    () => () => {
      clearBottomScrollTimers();
    },
    [clearBottomScrollTimers]
  );

  useEffect(() => {
    if (!isNexusDesktopApp) return;
    const handleDesktopPoll = () => {
      void pollDesktopNotifications();
    };
    window.addEventListener("nexus-desktop-poll", handleDesktopPoll);
    return () =>
      window.removeEventListener("nexus-desktop-poll", handleDesktopPoll);
  }, [isNexusDesktopApp, pollDesktopNotifications]);

  useEffect(() => {
    if (!currentProfile) return;

    const syncPresence = async () => {
      const visible =
        document.visibilityState === "visible" && document.hasFocus();
      await workTalkSupabase.from("chat_presence").upsert(
        {
          user_id: currentProfile.id,
          visible,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
    };
    const loadPresence = async () => {
      const { data, error } = await workTalkSupabase
        .from("chat_presence")
        .select("user_id,visible,last_seen_at");
      if (error) return;
      setOnlineUserIds(
        new Set(
          ((data || []) as PresenceRow[])
            .filter(isOnlinePresence)
            .map((presence) => presence.user_id)
        )
      );
    };

    void syncPresence();
    void loadPresence();
    const heartbeatId = window.setInterval(() => void syncPresence(), 30_000);
    const refreshId = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadPresence();
    }, 60_000);
    const handleVisibility = () => {
      void syncPresence();
      void loadPresence();
      if (
        document.visibilityState === "visible" &&
        activeSection === "chat" &&
        selectedRoomId
      ) {
        scheduleBottomScroll();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleVisibility);
    window.addEventListener("blur", handleVisibility);

    return () => {
      window.clearInterval(heartbeatId);
      window.clearInterval(refreshId);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleVisibility);
      window.removeEventListener("blur", handleVisibility);
      void workTalkSupabase.from("chat_presence").upsert(
        {
          user_id: currentProfile.id,
          visible: false,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
    };
  }, [activeSection, currentProfile, scheduleBottomScroll, selectedRoomId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setBrowserNotificationPermission(
        "Notification" in window ? Notification.permission : "unsupported"
      );
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    if (!latestNotification) return;

    if (isNexusDesktopApp) {
      (window as NexusDesktopWindow).chrome?.webview?.postMessage(
        JSON.stringify({
          type: "notification",
          title: latestNotification.title,
          body: latestNotification.body,
          roomId: latestNotification.room_id,
        })
      );
      clearLatestNotification();
      return;
    }

    const shouldShowBrowserNotification =
      browserNotificationPermission === "granted" &&
      "Notification" in window &&
      (document.visibilityState !== "visible" ||
        !document.hasFocus() ||
        activeSection !== "chat" ||
        selectedRoomId !== latestNotification.room_id);

    if (shouldShowBrowserNotification) {
      try {
        const browserNotification = new Notification(latestNotification.title, {
          body:
            latestNotification.body.length > 90
              ? `${latestNotification.body.slice(0, 90)}...`
              : latestNotification.body,
          icon: "/icon.png",
          tag: `worktalk-notification-${latestNotification.id}`,
        });
        browserNotification.onclick = () => {
          window.focus();
          void openNotification(latestNotification);
          browserNotification.close();
        };
      } catch {
        // The in-app notification remains available if the browser rejects this alert.
      }
    }

    clearLatestNotification();
  }, [
    activeSection,
    browserNotificationPermission,
    clearLatestNotification,
    isNexusDesktopApp,
    latestNotification,
    openNotification,
    selectedRoomId,
  ]);

  function openRoom(roomId: number, focusMessageId?: number | null) {
    if (!popupMode) {
      const popupWidth = 520;
      const popupHeight = 780;
      const popupLeft = Math.max(
        0,
        Math.round(window.screenX + (window.outerWidth - popupWidth) / 2)
      );
      const popupTop = Math.max(
        0,
        Math.round(window.screenY + (window.outerHeight - popupHeight) / 2)
      );
      const focusParam = focusMessageId ? `&message=${focusMessageId}` : "";
      const popup = window.open(
        `/worktalk?room=${roomId}${focusParam}&popup=1`,
        "_blank",
        `popup=yes,width=${popupWidth},height=${popupHeight},left=${popupLeft},top=${popupTop},resizable=yes,scrollbars=no`
      );
      if (popup) {
        popup.resizeTo(popupWidth, popupHeight);
        popup.moveTo(popupLeft, popupTop);
        popup.focus();
        return;
      }
    }

    userOpenedRoomRef.current = true;
    console.warn("[WorkTalk read guard] userOpenedRoomRef set true", {
      roomId,
      focusMessageId: focusMessageId ?? null,
      source: "openRoom",
    });

    if (roomId === selectedRoomId) {
      if (focusMessageId) {
        selectRoom(roomId, focusMessageId);
      }
      setMobileConversationOpen(true);
      return;
    }
    selectRoom(roomId, focusMessageId || undefined);
    setDraft("");
    setReplyTarget(null);
    setMessageMenu(null);
    setPendingFiles([]);
    setFileError("");
    setMessageSearch("");
    setRoomMenuOpen(false);
    setMobileConversationOpen(true);
    scheduleBottomScroll();
  }

  function openSearchResult(result: WorkTalkSearchResult) {
    if (!popupMode) {
      openRoom(result.room_id, result.message_id);
      return;
    }

    setActiveSection("chat");
    setMessageSearch("");
    setRoomMenuOpen(false);
    setMobileConversationOpen(true);
    userOpenedRoomRef.current = true;
    console.warn("[WorkTalk read guard] userOpenedRoomRef set true", {
      roomId: result.room_id,
      focusMessageId: result.message_id ?? null,
      source: "search_result",
    });
    selectRoom(result.room_id, result.message_id || undefined);
    window.setTimeout(() => {
      const target = result.message_id
        ? document.querySelector(`[data-message-id="${result.message_id}"]`)
        : null;
      if (target instanceof HTMLElement) {
        target.scrollIntoView({ block: "center", behavior: "smooth" });
        return;
      }
      messageEndRef.current?.scrollIntoView({ block: "end" });
    }, 250);
  }

  async function requestBrowserNotifications() {
    await subscribeToPush();
    setBrowserNotificationPermission(
      "Notification" in window ? Notification.permission : "unsupported"
    );
  }

  async function openPdfPreview(file: WorkTalkFile) {
    const url = await getFileUrl(file);
    if (url) setPreviewPdf({ file, url });
  }

  async function togglePdfFullscreen() {
    const preview = pdfPreviewRef.current;
    if (!preview) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await preview.requestFullscreen();
    }
  }

  async function createFinalApprovalPdf(result: {
    document_id: number;
    document_no: string | null;
    template_key: string;
    completed: boolean;
    result: "approved" | "rejected";
  }) {
    if (result.result !== "approved") return;

    const { data: document, error } = await workTalkSupabase
      .from("approval_documents")
      .select(
        "id,status,approved_pdf_path,document_no,template_key,title,requester_name,requester_team,form_data,approval_lines(step_order,role_label,approver_name,status,acted_at)"
      )
      .eq("id", result.document_id)
      .single();
    if (error || !document?.document_no) {
      throw new Error(error?.message || "최종 승인 문서를 불러오지 못했습니다.");
    }
    if (document.status !== "approved") return;
    if (document.approved_pdf_path) return;

    const approvalLines = [...(document.approval_lines || [])].sort(
      (left, right) => left.step_order - right.step_order
    );
    let pdfBlob: Blob;
    let storagePath: string;
    let originalName: string;
    let attachFunction: string;

    if (document.template_key === "manufacturing_request") {
      pdfBlob = await createManufacturingPdf({
        documentNo: document.document_no,
        title: document.title,
        requesterName: document.requester_name,
        requesterTeam: document.requester_team || "",
        formData: document.form_data,
        inputMode:
          document.form_data?._inputMode === "legacy" ? "legacy" : "modern",
        version: "approved",
        approvals: approvalLines.map((line) => ({
          role: line.role_label,
          name: line.approver_name,
          status: line.status === "approved" ? "승인" : "대기",
          actedAt: line.acted_at,
        })),
      });
      const datePart = document.document_no.slice(3, 11);
      storagePath = `manufacturing/${datePart.slice(0, 4)}/${datePart.slice(4, 6)}/${datePart.slice(6, 8)}/${document.document_no}/approved.pdf`;
      originalName = `${document.document_no}_${document.title}_승인완료.pdf`;
      attachFunction = "nexus_attach_approved_manufacturing_pdf";
    } else if (
      document.template_key === "purchase_request" ||
      document.template_key === "outsourcing_request"
    ) {
      pdfBlob = await createPurchasePdf({
        documentNo: document.document_no,
        requesterName: document.requester_name,
        formData: document.form_data,
        version: "approved",
        approvals: [
          { role: "담당", name: document.requester_name, status: "작성" },
          ...approvalLines.map((line) => ({
            role: line.role_label,
            name: line.approver_name,
            status: line.status === "approved" ? "승인" : "대기",
            actedAt: line.acted_at,
          })),
        ],
      });
      const datePart = document.document_no.slice(1, 9);
      storagePath = `purchase/${datePart.slice(0, 4)}/${datePart.slice(4, 6)}/${datePart.slice(6, 8)}/${document.document_no}/approved.pdf`;
      originalName = `${document.document_no}_${document.title}_승인완료.pdf`;
      attachFunction = "nexus_attach_approved_purchase_pdf";
    } else if (document.template_key === "purchase_resolution") {
      pdfBlob = await createPurchaseResolutionPdf({
        requesterName: document.requester_name,
        formData: document.form_data,
        version: "approved",
        approvals: [
          { role: "담당", name: document.requester_name, status: "작성" },
          ...approvalLines.map((line) => ({
            role:
              line.role_label === "팀장"
                ? "이사"
                : line.role_label === "대표이사"
                  ? "사장"
                  : line.role_label,
            name: line.approver_name,
            status: line.status === "approved" ? "승인" : "대기",
          })),
        ],
      });
      const now = new Date();
      storagePath = `purchase-resolution/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}/${document.document_no}/approved.pdf`;
      originalName = `${document.document_no}_구매결의서_${document.title}_승인완료.pdf`;
      attachFunction = "nexus_attach_approved_purchase_resolution_pdf";
    } else {
      return;
    }

    const { error: uploadError } = await workTalkSupabase.storage
      .from(NEXUS_DOCUMENT_BUCKET)
      .upload(storagePath, pdfBlob, {
        contentType: "application/pdf",
        upsert: true,
      });
    if (uploadError) throw uploadError;

    const { error: attachError } = await workTalkSupabase.rpc(attachFunction, {
      target_document_id: document.id,
      target_storage_path: storagePath,
      target_original_name: originalName,
      target_size_bytes: pdfBlob.size,
    });
    if (attachError) throw attachError;
  }

  async function startDirectChat(profile: WorkTalkProfile) {
    if (profile.id === currentProfile?.id || startingDirectChat) return;
    setStartingDirectChat(true);
    const roomId = await createDirectRoom(profile.id);
    setStartingDirectChat(false);
    if (!roomId) return;
    openRoom(roomId);
  }

  async function submitMessage(event: FormEvent) {
    event.preventDefault();
    let nextBody = draft.trim();
    if (!nextBody && pendingFiles.length === 0) return;

    const isApprovalCommand =
      selectedRoom?.room_type === "approval" &&
      pendingFiles.length === 0 &&
      (nextBody === "승인" ||
        nextBody === "반려" ||
        /^반려\s*[:：]\s*.+/.test(nextBody) ||
        /^반려\s+.+/.test(nextBody));

    if (isApprovalCommand && nextBody === "반려") {
      const reason = window.prompt("반려 사유를 입력해 주세요.");
      if (reason === null) return;
      if (!reason.trim()) {
        setFileError("반려 사유는 반드시 입력해야 합니다.");
        return;
      }
      nextBody = `반려: ${reason.trim()}`;
    }

    const approvalResult = isApprovalCommand
      ? await processApprovalCommand(nextBody)
      : null;
    if (approvalResult && typeof approvalResult !== "boolean") {
      try {
        await createFinalApprovalPdf(approvalResult);
        if (selectedRoomId) {
          await reload();
          selectRoom(selectedRoomId, approvalResult.message_id);
        }
      } catch (error) {
        setFileError(
          `결재 처리는 완료됐지만 최종 PDF 저장에 실패했습니다: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
    const sent =
      isApprovalCommand
        ? Boolean(approvalResult)
        : pendingFiles.length > 0
        ? await sendFiles(pendingFiles, nextBody)
        : replyTarget
          ? await sendReplyMessage(nextBody, replyTarget.id)
          : await sendMessage(nextBody);
    if (sent) {
      setDraft("");
      setReplyTarget(null);
      setPendingFiles([]);
      setFileError("");
      scheduleBottomScroll();
    }
  }

  function addFiles(nextFiles: File[]) {
    const merged = [...pendingFiles, ...nextFiles];
    const validationError = validateFiles(merged);
    if (validationError) {
      setFileError(validationError);
      return;
    }
    setFileError("");
    setPendingFiles(merged);
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragActive(false);
    addFiles(Array.from(event.dataTransfer.files));
  }

  function openCreator(mode: Exclude<CreateMode, null>) {
    setCreateMode(mode);
    setGroupTitle("");
    setSelectedMemberIds([]);
  }

  async function createRoom() {
    if (!createMode || creating) return;
    setCreating(true);
    const roomId =
      createMode === "direct"
        ? await createDirectRoom(selectedMemberIds[0])
        : await createGroupRoom(groupTitle.trim(), selectedMemberIds);
    setCreating(false);
    if (roomId) {
      setCreateMode(null);
      setMobileConversationOpen(true);
    }
  }

  async function moveRoomBefore(targetRoomId: number) {
    if (!draggedRoomId || draggedRoomId === targetRoomId || !canReorderRooms) {
      setDraggedRoomId(null);
      return;
    }

    const nextIds = rooms.map((room) => room.id);
    const fromIndex = nextIds.indexOf(draggedRoomId);
    const targetIndex = nextIds.indexOf(targetRoomId);
    if (fromIndex < 0 || targetIndex < 0) return;
    nextIds.splice(fromIndex, 1);
    nextIds.splice(targetIndex, 0, draggedRoomId);
    setDraggedRoomId(null);
    await setRoomOrder(nextIds);
  }

  async function confirmRoomAction() {
    if (!selectedRoom || !roomAction || roomActionBusy) return;
    setRoomActionBusy(true);
    const completed =
      roomAction === "delete"
        ? await deleteGroupRoom(selectedRoom.id)
        : roomAction === "direct-leave"
          ? await leaveDirectRoom(
              selectedRoom.id,
              activeDirectMemberCount <= 1
            )
          : await leaveGroupRoom(selectedRoom.id);
    setRoomActionBusy(false);

    if (completed) {
      setRoomAction(null);
      setRoomMenuOpen(false);
      setMobileConversationOpen(false);
    }
  }

  async function submitInvitations() {
    if (!selectedRoom || inviteMemberIds.length === 0 || invitingMembers) return;
    setInvitingMembers(true);
    const completed = await inviteMembers(selectedRoom.id, inviteMemberIds);
    setInvitingMembers(false);
    if (completed) {
      setInviteMemberIds([]);
      setMemberManagerOpen(false);
    }
  }

  async function submitOwnerTransfer() {
    if (!selectedRoom || !newOwnerId || transferringOwner) return;
    setTransferringOwner(true);
    const completed = await transferOwnerAndLeave(selectedRoom.id, newOwnerId);
    setTransferringOwner(false);
    if (completed) {
      setNewOwnerId("");
      setTransferOwnerOpen(false);
      setMobileConversationOpen(false);
    }
  }

  function focusMessage(messageId?: number | null) {
    if (!messageId || !selectedRoomId) return;
    selectRoom(selectedRoomId, messageId);
    window.setTimeout(() => {
      document
        .querySelector(`[data-message-id="${messageId}"]`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 80);
  }

  async function pinMessageAsNotice(message: WorkTalkMessage) {
    if (!selectedRoom || selectedRoom.room_type !== "group") return;
    setMessageMenu(null);
    await setRoomNotice(selectedRoom.id, message.id);
  }

  function startReply(message: WorkTalkMessage) {
    setMessageMenu(null);
    setReplyTarget(message);
  }

  if (setupState === "loading") {
    return (
      <main className={styles.centerState}>
        <div className={styles.loader} />
        <strong>NEXUS를 준비하고 있습니다</strong>
        <span>계정과 대화 공간을 확인하는 중입니다.</span>
      </main>
    );
  }

  if (setupState === "signed-out") {
    return (
      <main className={styles.centerState}>
        <div className={styles.stateLogo}>Z</div>
        <strong>로그인이 필요합니다</strong>
        <span>NEXUS 계정으로 로그인한 뒤 이용해 주세요.</span>
        <button
          type="button"
          onClick={() => router.push(buildWorkTalkLoginUrl(getCurrentWorkTalkPath()))}
        >
          로그인으로 이동
        </button>
      </main>
    );
  }

  if (setupState === "migration-required") {
    return (
      <main className={styles.centerState}>
        <div className={styles.stateLogo}>W</div>
        <strong>NEXUS 데이터베이스 준비가 필요합니다</strong>
        <span>
          `project-docs/supabase-worktalk-foundation.sql`을 검토한 뒤 Supabase에
          적용하면 메신저가 활성화됩니다.
        </span>
        <button
          type="button"
          onClick={() => router.push(buildWorkTalkLoginUrl(getCurrentWorkTalkPath()))}
        >
          로그인으로 돌아가기
        </button>
      </main>
    );
  }

  return (
    <main className={`${styles.app} ${popupMode ? styles.popupApp : ""}`}>
      <aside className={styles.serviceRail}>
        <button
          type="button"
          className={styles.brandButton}
          onClick={goToNexusHome}
          aria-label="NEXUS 홈으로 이동"
          title="NEXUS 홈"
        >
          <Image src="/nexus-icon-v2-192.png" alt="" width={42} height={42} priority />
        </button>
        <nav className={styles.serviceNav} aria-label="NEXUS 메뉴">
          <button
            type="button"
            className={activeSection === "people" ? styles.serviceNavActive : ""}
            title="직원·조직"
            onClick={() => {
              setActiveSection("people");
              setMobileConversationOpen(false);
              setSelectedProfileId(null);
            }}
          >
            <WorkTalkIcon name="people" />
          </button>
          <button
            type="button"
            className={activeSection === "chat" ? styles.serviceNavActive : ""}
            title="채팅"
            onClick={() => {
              setActiveSection("chat");
              setMobileConversationOpen(false);
              forceMobileListModeReset("menu_switch");
            }}
          >
            <WorkTalkIcon name="chat" />
            {totalUnread > 0 && <em>{Math.min(totalUnread, 99)}</em>}
          </button>
          <button
            type="button"
            title="NEXUS 문서"
            onClick={() => router.push("/nexus")}
          >
            <WorkTalkIcon name="document" />
          </button>
          <button
            type="button"
            className={
              activeSection === "notifications" ? styles.serviceNavActive : ""
            }
            title="알림"
            onClick={() => {
              setActiveSection("notifications");
              setMobileConversationOpen(false);
            }}
          >
            <WorkTalkIcon name="bell" />
            {unreadNotificationCount > 0 && (
              <em>{Math.min(unreadNotificationCount, 99)}</em>
            )}
          </button>
        </nav>
        <div className={styles.serviceFooter}>
          <button type="button" title="로그아웃" onClick={() => void handleLogout()}>
            <WorkTalkIcon name="logout" />
          </button>
          <span className={styles.myAvatar}>
            <WorkTalkIcon name="person" />
          </span>
        </div>
      </aside>

      <section
        className={`${styles.roomPane} ${
          mobileConversationOpen ? styles.mobileHidden : ""
        }`}
      >
        {activeSection === "chat" ? (
          <>
        <header className={styles.roomPaneHeader}>
          <div>
            <span>ZETA</span>
            <h1>NEXUS</h1>
          </div>
          <button
            type="button"
            className={styles.newRoomButton}
            onClick={() => openCreator("group")}
            aria-label="그룹채팅 만들기"
          >
            <WorkTalkIcon name="plus" />
          </button>
        </header>

        <label className={styles.searchBox}>
          <WorkTalkIcon name="search" />
          <input
            type="search"
            value={roomSearch}
            onChange={(event) => {
              const value = event.target.value;
              setRoomSearch(value);
              if (searchMode !== "room") {
                setSearchResults([]);
                setSearching(value.trim().length >= 2);
              }
            }}
            placeholder={
              searchMode === "room"
                ? "대화방 또는 사람 검색"
                : searchMode === "message"
                  ? "메시지 내용 검색"
                  : "파일 이름 검색"
            }
          />
        </label>

        <div className={styles.searchScopes}>
          {(
            [
              ["room", "대화방"],
              ["message", "메시지"],
              ["file", "파일"],
            ] as [SearchMode, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={searchMode === value ? styles.searchScopeActive : ""}
              onClick={() => {
                setSearchMode(value);
                setSearchResults([]);
                setSearching(
                  value !== "room" && roomSearch.trim().length >= 2
                );
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {searchMode === "room" && (
          <>
            <div className={styles.quickActions}>
              <button type="button" onClick={() => openCreator("direct")}>
                <WorkTalkIcon name="people" />
                <span>1:1 대화</span>
              </button>
              <button type="button" onClick={() => openCreator("group")}>
                <WorkTalkIcon name="plus" />
                <span>그룹채팅</span>
              </button>
            </div>

            <div className={styles.filterTabs}>
              {(
                [
                  ["all", "전체"],
                  ["unread", "안 읽음"],
                  ["team", "팀"],
                  ["direct", "대화"],
                ] as [RoomFilter, string][]
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={filter === value ? styles.filterActive : ""}
                  onClick={() => setFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </>
        )}

        <div className={styles.roomList}>
          {searchMode !== "room" ? (
            roomSearch.trim().length < 2 ? (
              <div className={styles.searchEmpty}>
                <WorkTalkIcon name={searchMode === "file" ? "attach" : "search"} />
                <strong>두 글자 이상 입력하세요</strong>
                <span>
                  {searchMode === "file"
                    ? "접근 가능한 대화방의 파일 이름을 검색합니다."
                    : "접근 가능한 대화방의 메시지 내용을 검색합니다."}
                </span>
              </div>
            ) : searching ? (
              <p className={styles.emptyText}>검색 중입니다.</p>
            ) : searchResults.length === 0 ? (
              <div className={styles.searchEmpty}>
                <WorkTalkIcon name="search" />
                <strong>검색 결과가 없습니다</strong>
                <span>다른 검색어로 다시 찾아보세요.</span>
              </div>
            ) : (
              <div className={styles.searchResultList}>
                {searchResults.map((result) => {
                  const resultRoom = rooms.find(
                    (room) => room.id === result.room_id
                  );
                  return (
                    <button
                      key={result.id}
                      type="button"
                      title="더블클릭하여 해당 대화방 열기"
                      onDoubleClick={() => openSearchResult(result)}
                    >
                      <span className={styles.searchResultIcon}>
                        <WorkTalkIcon
                          name={result.scope === "file" ? "attach" : "chat"}
                        />
                      </span>
                      <span className={styles.searchResultBody}>
                        <strong>{result.title}</strong>
                        <small>{result.subtitle}</small>
                        <em>
                          {resultRoom
                            ? getRoomTitle(resultRoom, currentProfile?.id)
                            : "대화방"}{" "}
                          · {result.sender_name || "WorkTalk"}
                        </em>
                      </span>
                      <time>{formatRoomTime(result.created_at)}</time>
                    </button>
                  );
                })}
              </div>
            )
          ) : loadingRooms && rooms.length === 0 ? (
            <p className={styles.emptyText}>대화방을 불러오는 중입니다.</p>
          ) : filteredRooms.length === 0 ? (
            <div className={styles.emptyRooms}>
              <span>대화방이 없습니다</span>
              <p>1:1 대화나 그룹채팅을 시작할 수 있습니다.</p>
            </div>
          ) : (
            filteredRooms.map((room) => {
              const title = getRoomTitle(room, currentProfile?.id);
              return (
                <div
                  key={room.id}
                  className={`${styles.roomItem} ${
                    highlightedRoomId === room.id ? styles.roomItemActive : ""
                  } ${draggedRoomId === room.id ? styles.roomDragging : ""}`}
                  draggable={canReorderRooms}
                  onDragStart={() => setDraggedRoomId(room.id)}
                  onDragOver={(event) => {
                    if (canReorderRooms) event.preventDefault();
                  }}
                  onDrop={() => void moveRoomBefore(room.id)}
                  onDragEnd={() => setDraggedRoomId(null)}
                >
                  <button
                    type="button"
                    className={styles.roomOpenButton}
                    onClick={() => {
                      setHighlightedRoomId(room.id);
                    }}
                    onDoubleClick={() => openRoom(room.id)}
                    title="더블클릭하여 대화방 열기"
                  >
                    <RoomAvatar room={room} />
                    <span className={styles.roomSummary}>
                      <span className={styles.roomTitleRow}>
                        <strong>{title}</strong>
                        {room.is_fixed && <i>기본</i>}
                      </span>
                      <small>{getRoomSubtitle(room, currentProfile?.id)}</small>
                    </span>
                    <span className={styles.roomMeta}>
                      <time>
                        {formatRoomTime(
                          room.latestMessage?.created_at || room.last_message_at
                        )}
                      </time>
                      {room.unreadCount > 0 && (
                        <em>{room.unreadCount > 99 ? "99+" : room.unreadCount}</em>
                      )}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`${styles.roomPinButton} ${
                      room.members.find(
                        (member) => member.user_id === currentProfile?.id
                      )?.is_pinned
                        ? styles.roomPinActive
                        : ""
                    }`}
                    onClick={() => {
                      const member = room.members.find(
                        (item) => item.user_id === currentProfile?.id
                      );
                      void setRoomPinned(room.id, !member?.is_pinned);
                    }}
                    title="이 방을 위에 고정"
                  >
                    <WorkTalkIcon name="pin" />
                  </button>
                </div>
              );
            })
          )}
        </div>

        <footer className={styles.profileStrip}>
          <span className={styles.myAvatar}>
            <WorkTalkIcon name="person" />
          </span>
          <span>
            <strong>{currentProfile?.name}</strong>
            <small>{currentProfile?.team || "소속 미지정"}</small>
          </span>
          <button type="button" onClick={() => router.push("/nexus")}>
            문서
          </button>
        </footer>
          </>
        ) : activeSection === "people" ? (
          <>
            <header className={styles.roomPaneHeader}>
              <div>
                <span>ZETA</span>
                <h1>직원·조직</h1>
              </div>
              <button
                type="button"
                className={styles.newRoomButton}
                onClick={() => setActiveSection("chat")}
                aria-label="채팅으로 돌아가기"
              >
                <WorkTalkIcon name="chat" />
              </button>
            </header>
            <label className={styles.searchBox}>
              <WorkTalkIcon name="search" />
              <input
                type="search"
                value={peopleSearch}
                onChange={(event) => setPeopleSearch(event.target.value)}
                placeholder="이름, 부서, 직급 검색"
              />
            </label>
            <div className={styles.peopleSummary}>
              <span>재직자 {orgProfiles.length}명</span>
              <span>온라인 {onlineOrgCount}명</span>
            </div>
            <div className={styles.peopleList}>
              {groupedOrgProfiles.length === 0 ? (
                <div className={styles.searchEmpty}>
                  <WorkTalkIcon name="people" />
                  <strong>검색 결과가 없습니다</strong>
                  <span>다른 이름이나 부서로 검색해 보세요.</span>
                </div>
              ) : (
                groupedOrgProfiles.map(([team, members]) => (
                  <details
                    key={team}
                    className={styles.peopleTeam}
                    open={peopleSearch.trim() ? true : undefined}
                  >
                    <summary>
                      <strong>{team}</strong>
                      <span>{members.length}명</span>
                    </summary>
                    <div>
                      {members.map((profile) => {
                        const online = onlineUserIds.has(profile.id);
                        const selected = selectedProfile?.id === profile.id;
                        return (
                          <div key={profile.id} className={styles.personEntry}>
                            <button
                              type="button"
                              className={selected ? styles.personSelected : ""}
                              onClick={() => setSelectedProfileId(profile.id)}
                              onDoubleClick={() => void startDirectChat(profile)}
                              title={
                                profile.id === currentProfile?.id
                                  ? "본인 계정"
                                  : "더블클릭하여 1:1 대화 열기"
                              }
                            >
                              <span className={styles.personAvatar}>
                                <WorkTalkIcon name="person" />
                                <i
                                  className={
                                    online
                                      ? styles.onlineStatus
                                      : styles.offlineStatus
                                  }
                                />
                              </span>
                              <span>
                                <strong>{profile.name}</strong>
                                <small>
                                  {profile.role || "직급 미지정"}
                                  {profile.id === currentProfile?.id ? " · 나" : ""}
                                </small>
                              </span>
                            </button>
                            {selected && profile.id !== currentProfile?.id ? (
                              <button
                                type="button"
                                className={styles.personQuickChat}
                                disabled={startingDirectChat}
                                onClick={() => void startDirectChat(profile)}
                              >
                                <WorkTalkIcon name="chat" />
                                {startingDirectChat
                                  ? "대화방 여는 중..."
                                  : "1:1 대화 열기"}
                              </button>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </details>
                ))
              )}
            </div>
            <footer className={styles.profileStrip}>
              <span className={styles.myAvatar}>
                <WorkTalkIcon name="person" />
              </span>
              <span>
                <strong>{currentProfile?.name}</strong>
                <small>{currentProfile?.team || "소속 미지정"}</small>
              </span>
              <button type="button" onClick={() => setActiveSection("chat")}>
                채팅
              </button>
            </footer>
          </>
        ) : (
          <>
            <header className={styles.roomPaneHeader}>
              <div>
                <span>ZETA</span>
                <h1>알림</h1>
              </div>
              {unreadNotificationCount > 0 && (
                <button
                  type="button"
                  className={styles.readAllButton}
                  onClick={() => void markAllNotificationsRead()}
                >
                  모두 읽음
                </button>
              )}
            </header>
            <div className={styles.notificationPermission}>
              <span>
                <WorkTalkIcon name="bell" />
                {isNexusDesktopApp ? "Windows 앱 알림" : "백그라운드 푸시"}
              </span>
              {isNexusDesktopApp ? (
                <em className={styles.desktopNotificationOn}>켜짐</em>
              ) : pushStatus === "subscribed" ? (
                <button
                  type="button"
                  className={styles.pushDisableButton}
                  onClick={() => void unsubscribeFromPush()}
                >
                  이 기기 끄기
                </button>
              ) : pushStatus === "available" ||
                pushStatus === "denied" ||
                pushStatus === "error" ? (
                <button
                  type="button"
                  onClick={() => void requestBrowserNotifications()}
                  disabled={isIOS && !isStandalone}
                >
                  푸시 켜기
                </button>
              ) : (
                <em
                  className={styles.permissionBlocked}
                >
                  {pushStatus === "loading"
                      ? "확인 중"
                      : pushStatus === "unsupported"
                        ? "지원 안 함"
                        : pushStatus === "unconfigured"
                          ? "서버 설정 필요"
                          : "꺼짐"}
                </em>
              )}
            </div>
            {isNexusDesktopApp && (
              <p className={styles.pushHint}>
                NEXUS를 닫아 트레이에 두어도 Windows 알림이 표시됩니다.
              </p>
            )}
            {!isNexusDesktopApp && pushStatus === "subscribed" && (
              <p className={styles.pushHint}>
                앱을 닫거나 백그라운드에 두어도 이 기기로 알림이 옵니다.
              </p>
            )}
            {!isNexusDesktopApp && isIOS && !isStandalone && (
              <p className={styles.pushHint}>
                iPhone은 Safari 공유 메뉴에서 ‘홈 화면에 추가’한 뒤 설치된
                NEXUS에서 푸시를 켜주세요.
              </p>
            )}
            {!isNexusDesktopApp && !isIOS && !isStandalone && canInstall && (
              <div className={styles.installPrompt}>
                <span>NEXUS를 앱처럼 홈 화면에 설치할 수 있습니다.</span>
                <button type="button" onClick={() => void install()}>
                  홈 화면 설치
                </button>
              </div>
            )}
            {!isNexusDesktopApp && pushStatus === "denied" && (
              <p className={styles.pushError}>
                브라우저 설정에서 NEXUS 알림 권한을 허용해야 합니다.
              </p>
            )}
            {!isNexusDesktopApp && pushErrorMessage && (
              <p className={styles.pushError}>{pushErrorMessage}</p>
            )}
            <div className={styles.notificationTabs}>
              <button
                type="button"
                className={
                  notificationFilter === "unread"
                    ? styles.notificationTabActive
                    : ""
                }
                onClick={() => setNotificationFilter("unread")}
              >
                안 읽음 {unreadNotificationCount}
              </button>
              <button
                type="button"
                className={
                  notificationFilter === "all"
                    ? styles.notificationTabActive
                    : ""
                }
                onClick={() => setNotificationFilter("all")}
              >
                전체
              </button>
            </div>
            <div className={styles.notificationList}>
              {!notificationsReady ? (
                <div className={styles.searchEmpty}>
                  <WorkTalkIcon name="bell" />
                  <strong>알림 데이터 준비가 필요합니다</strong>
                  <span>알림 SQL 적용 후 메시지 알림이 이곳에 표시됩니다.</span>
                </div>
              ) : visibleNotifications.length === 0 ? (
                <div className={styles.searchEmpty}>
                  <WorkTalkIcon name="bell" />
                  <strong>
                    {notificationFilter === "unread"
                      ? "새 알림이 없습니다"
                      : "알림 내역이 없습니다"}
                  </strong>
                  <span>새 메시지와 파일 알림이 이곳에 쌓입니다.</span>
                </div>
              ) : (
                visibleNotifications.map((notification) => {
                  const notificationRoom = rooms.find(
                    (room) => room.id === notification.room_id
                  );
                  return (
                    <button
                      key={notification.id}
                      type="button"
                      className={
                        notification.read_at ? styles.notificationRead : ""
                      }
                      onClick={() => void openNotification(notification)}
                    >
                      <span className={styles.notificationIcon}>
                        <WorkTalkIcon
                          name={
                            notification.notification_type === "file"
                              ? "attach"
                              : notification.notification_type === "document"
                                ? "document"
                                : "chat"
                          }
                        />
                        {!notification.read_at && <i />}
                      </span>
                      <span>
                        <strong>{notification.title}</strong>
                        <small>{notification.body}</small>
                        <em>
                          {notificationRoom
                            ? getRoomTitle(
                                notificationRoom,
                                currentProfile?.id
                              )
                            : "대화방"}{" "}
                          · {formatRoomTime(notification.created_at)}
                        </em>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            <footer className={styles.profileStrip}>
              <span className={styles.myAvatar}>
                <WorkTalkIcon name="person" />
              </span>
              <span>
                <strong>{currentProfile?.name}</strong>
                <small>미확인 알림 {unreadNotificationCount}건</small>
              </span>
              <button type="button" onClick={() => setActiveSection("chat")}>
                채팅
              </button>
            </footer>
          </>
        )}
      </section>

      <section
        className={`${styles.conversationPane} ${
          mobileConversationOpen ? styles.mobileVisible : ""
        } ${dragActive ? styles.dragActive : ""}`}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) {
            setDragActive(false);
          }
        }}
        onDrop={handleDrop}
      >
        {activeSection === "notifications" ? (
          <div className={styles.notificationOverview}>
            <div className={styles.notificationOverviewIcon}>
              <WorkTalkIcon name="bell" />
            </div>
            <span>WORKTALK NOTIFICATIONS</span>
            <h2>업무 메시지를 놓치지 마세요</h2>
            <p>
              새 메시지와 파일 알림을 확인하고 클릭하면 해당 대화 위치로
              바로 이동합니다.
            </p>
            <div>
              <article>
                <strong>{unreadNotificationCount}</strong>
                <span>확인할 알림</span>
              </article>
              <article>
                <strong>
                  {browserNotificationPermission === "granted" ? "ON" : "OFF"}
                </strong>
                <span>브라우저 알림</span>
              </article>
            </div>
          </div>
        ) : activeSection === "people" ? (
          selectedProfile ? (
            <div className={styles.personDetail}>
              <button
                type="button"
                className={styles.mobileBack}
                onClick={() => setMobileConversationOpen(false)}
                aria-label="직원 목록으로 돌아가기"
              >
                <WorkTalkIcon name="back" />
              </button>
              <div className={styles.personDetailAvatar}>
                <WorkTalkIcon name="person" />
                <i
                  className={
                    onlineUserIds.has(selectedProfile.id)
                      ? styles.onlineStatus
                      : styles.offlineStatus
                  }
                />
              </div>
              <span className={styles.personDetailKicker}>ZETA MEMBER</span>
              <h2>{selectedProfile.name}</h2>
              <p>{getProfileOrgTeam(selectedProfile) || "소속 미지정"}</p>
              <dl>
                <div>
                  <dt>소속</dt>
                  <dd>{getProfileOrgTeam(selectedProfile) || "-"}</dd>
                </div>
                <div>
                  <dt>역할</dt>
                  <dd>{selectedProfile.role || "미지정"}</dd>
                </div>
                <div>
                  <dt>상태</dt>
                  <dd>
                    {onlineUserIds.has(selectedProfile.id)
                      ? "현재 온라인"
                      : "오프라인"}
                  </dd>
                </div>
              </dl>
              <button
                type="button"
                className={styles.startDirectButton}
                disabled={
                  selectedProfile.id === currentProfile?.id ||
                  startingDirectChat
                }
                onClick={() => void startDirectChat(selectedProfile)}
              >
                <WorkTalkIcon name="chat" />
                {selectedProfile.id === currentProfile?.id
                  ? "본인 계정"
                  : startingDirectChat
                    ? "대화방 여는 중..."
                    : "1:1 대화 시작"}
              </button>
            </div>
          ) : (
            <div className={styles.welcomePane}>
              <WorkTalkIcon name="people" />
              <strong>직원을 선택하세요</strong>
              <p>조직 목록에서 직원을 선택하면 상세 정보를 확인할 수 있습니다.</p>
            </div>
          )
        ) : activeSection === "chat" && pendingDeepLinkRoomId ? (
          <div className={styles.welcomePane}>
            <WorkTalkIcon name="chat" />
            <strong>대화방을 여는 중입니다</strong>
            <p>푸시 알림으로 요청한 대화방을 불러오고 있습니다.</p>
          </div>
        ) : selectedRoom ? (
          <>
            <header className={styles.conversationHeader}>
              <button
                type="button"
                className={styles.mobileBack}
                onClick={() =>
                  popupMode ? window.close() : setMobileConversationOpen(false)
                }
                aria-label="대화방 목록으로 돌아가기"
              >
                <WorkTalkIcon name="back" />
              </button>
              <RoomAvatar room={selectedRoom} compact />
              <div className={styles.conversationIdentity}>
                <strong>{getRoomTitle(selectedRoom, currentProfile?.id)}</strong>
                {selectedRoom.room_type === "direct" ? (
                  <span>{getRoomSubtitle(selectedRoom, currentProfile?.id)}</span>
                ) : (
                  <button
                    type="button"
                    className={styles.memberCountButton}
                    onClick={() => setMemberListOpen(true)}
                  >
                    {selectedRoom.members.length}명 참여
                  </button>
                )}
              </div>
              <label className={styles.messageSearch}>
                <WorkTalkIcon name="search" />
                <input
                  type="search"
                  value={messageSearch}
                  onChange={(event) => setMessageSearch(event.target.value)}
                  placeholder="이 대화에서 검색"
                />
              </label>
              <button
                type="button"
                className={`${styles.headerAction} ${
                  !notificationsEnabled ? styles.headerActionOff : ""
                }`}
                onClick={() =>
                  void setRoomNotifications(
                    selectedRoom.id,
                    !notificationsEnabled
                  )
                }
                title={
                  notificationsEnabled ? "이 방 알림 끄기" : "이 방 알림 켜기"
                }
              >
                <WorkTalkIcon name={notificationsEnabled ? "bell" : "mute"} />
              </button>
              <button
                type="button"
                className={`${styles.headerAction} ${
                  selectedRoomPinned ? styles.roomPinActive : ""
                }`}
                onClick={() =>
                  void setRoomPinned(selectedRoom.id, !selectedRoomPinned)
                }
                title={selectedRoomPinned ? "방 고정 해제" : "방 위에 고정"}
              >
                <WorkTalkIcon name="pin" />
              </button>
              <button
                type="button"
                className={styles.headerAction}
                onClick={() => setRoomMenuOpen((current) => !current)}
                aria-label="대화방 메뉴"
              >
                <WorkTalkIcon name="more" />
              </button>
              {roomMenuOpen && (
                <div className={styles.roomMenu}>
                  <button
                    type="button"
                    onClick={() =>
                      void setRoomNotifications(
                        selectedRoom.id,
                        !notificationsEnabled
                      )
                    }
                  >
                    <WorkTalkIcon
                      name={notificationsEnabled ? "mute" : "bell"}
                    />
                    {notificationsEnabled ? "알림 끄기" : "알림 켜기"}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void setRoomPinned(
                        selectedRoom.id,
                        !selectedRoomPinned
                      )
                    }
                  >
                    <WorkTalkIcon name="pin" />
                    {selectedRoomPinned ? "고정 해제" : "위에 고정"}
                  </button>
                  {isSelectedRoomOwner && !selectedRoom.is_fixed && (
                    <button
                      type="button"
                      onClick={() => {
                        setRoomMenuOpen(false);
                        setInviteMemberIds([]);
                        setMemberManagerOpen(true);
                      }}
                    >
                      <WorkTalkIcon name="people" />
                      참여자 관리
                    </button>
                  )}
                  {isSelectedRoomOwner &&
                    !selectedRoom.is_fixed &&
                    ownershipCandidates.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setRoomMenuOpen(false);
                          setNewOwnerId("");
                          setTransferOwnerOpen(true);
                        }}
                      >
                        <WorkTalkIcon name="back" />
                        방장 양도 후 나가기
                      </button>
                    )}
                  {isSelectedRoomOwner && !selectedRoom.is_fixed && (
                    <button
                      type="button"
                      className={styles.dangerMenuItem}
                      onClick={() => {
                        setRoomMenuOpen(false);
                        setRoomAction("delete");
                      }}
                    >
                      <WorkTalkIcon name="close" />
                      방 삭제
                    </button>
                  )}
                  {canLeaveSelectedRoom && (
                    <button
                      type="button"
                      className={styles.dangerMenuItem}
                      onClick={() => {
                        setRoomMenuOpen(false);
                        setRoomAction("leave");
                      }}
                    >
                      <WorkTalkIcon name="back" />
                      방 나가기
                    </button>
                  )}
                  {canLeaveDirectRoom && (
                    <button
                      type="button"
                      className={styles.dangerMenuItem}
                      onClick={() => {
                        setRoomMenuOpen(false);
                        setRoomAction("direct-leave");
                      }}
                    >
                      <WorkTalkIcon name="back" />
                      1:1 대화 나가기
                    </button>
                  )}
                </div>
              )}
            </header>

            {roomNotice && selectedRoom.room_type === "group" && (
              <div className={styles.noticeBar}>
                <button
                  type="button"
                  onClick={() => focusMessage(roomNotice.message_id)}
                  title="공지 원문으로 이동"
                >
                  <WorkTalkIcon name="pin" />
                  <span>
                    <strong>공지</strong>
                    <em>
                      {roomNotice.message?.body || "공지 메시지를 불러올 수 없습니다."}
                    </em>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void clearRoomNotice(selectedRoom.id)}
                  aria-label="공지 해제"
                >
                  <WorkTalkIcon name="close" />
                </button>
              </div>
            )}

            <div className={styles.messageList} onClick={() => setMessageMenu(null)}>
              {loadingMessages && messages.length === 0 ? (
                <p className={styles.emptyText}>메시지를 불러오는 중입니다.</p>
              ) : filteredMessages.length === 0 ? (
                <div className={styles.emptyConversation}>
                  <RoomAvatar room={selectedRoom} />
                  <strong>
                    {messageSearch
                      ? "검색 결과가 없습니다"
                      : "첫 메시지를 남겨보세요"}
                  </strong>
                  <p>
                    {messageSearch
                      ? "다른 검색어로 다시 찾아보세요."
                      : "업무 이야기와 파일이 이곳에 차곡차곡 쌓입니다."}
                  </p>
                </div>
              ) : (
                filteredMessages.map((message, index) => {
                  const mine = message.sender_id === currentProfile?.id;
                  const isSystem = message.message_type === "system";
                  const remainingReaderCount = getRemainingReaderCount(
                    selectedRoom,
                    message,
                    currentProfile?.id
                  );
                  const previous = filteredMessages[index - 1];
                  const showDate =
                    !previous ||
                    new Date(previous.created_at).toDateString() !==
                      new Date(message.created_at).toDateString();
                  const showSender =
                    !mine &&
                    (!previous ||
                      previous.sender_id !== message.sender_id ||
                      showDate);

                  return (
                    <div
                      key={message.id}
                      data-message-id={message.id}
                      className={
                        focusedMessageId === message.id
                          ? styles.focusedMessage
                          : ""
                      }
                    >
                      {showDate && (
                        <div className={styles.dateDivider}>
                          <span>{formatDate(message.created_at)}</span>
                        </div>
                      )}
                      {isSystem ? (
                        <div className={styles.systemMessage}>
                          <span>{message.body}</span>
                        </div>
                      ) : (
                        <article
                          className={`${styles.messageRow} ${
                            mine ? styles.messageMine : ""
                          }`}
                          onContextMenu={(event) => {
                            if (selectedRoom.room_type !== "group" || isSystem) return;
                            event.preventDefault();
                            setMessageMenu({
                              message,
                              x: event.clientX,
                              y: event.clientY,
                            });
                          }}
                        >
                        {!mine && showSender ? (
                          <span className={styles.messageAvatar}>
                            <WorkTalkIcon name="person" />
                          </span>
                        ) : (
                          !mine && <span className={styles.avatarSpacer} />
                        )}
                        <div className={styles.messageContent}>
                          {!mine && showSender && (
                            <strong>{message.sender_name}</strong>
                          )}
                          <div className={styles.bubbleLine}>
                            {mine && (
                              <span className={styles.mineMessageMeta}>
                                <em>
                                  {remainingReaderCount === 0
                                    ? "읽음"
                                    : remainingReaderCount}
                                </em>
                                <time>
                                  {formatMessageTime(message.created_at)}
                                </time>
                              </span>
                            )}
                            {message.replyTo && (
                              <button
                                type="button"
                                className={styles.replyQuote}
                                onClick={() => focusMessage(message.reply_to_message_id)}
                              >
                                <strong>{message.replyTo.sender_name}</strong>
                                <span>{message.replyTo.body}</span>
                              </button>
                            )}
                            <p>{message.body}</p>
                            {!mine && (
                              <time>{formatMessageTime(message.created_at)}</time>
                            )}
                          </div>
                          {message.files.length > 0 && (
                            <div className={styles.fileCards}>
                              {message.files.map((file) =>
                                isImageFile(file) && imageUrls[file.id] ? (
                                  <article key={file.id} className={styles.imageFileCard}>
                                    <button
                                      type="button"
                                      className={styles.imageThumbnail}
                                      onClick={() =>
                                        setPreviewImage({
                                          file,
                                          url: imageUrls[file.id],
                                        })
                                      }
                                      aria-label={`${file.original_name} 크게 보기`}
                                    >
                                      <img
                                        src={imageUrls[file.id]}
                                        alt={file.original_name}
                                      />
                                    </button>
                                    <div className={styles.imageFileMeta}>
                                      <span>
                                        <strong>{file.original_name}</strong>
                                        <small>{formatFileSize(file.size_bytes)}</small>
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => void downloadFile(file)}
                                      >
                                        받기
                                      </button>
                                    </div>
                                  </article>
                                ) : fileExtension(file.original_name) === "pdf" ? (
                                  <article key={file.id} className={styles.pdfFileCard}>
                                    <button
                                      type="button"
                                      className={styles.pdfPreviewButton}
                                      onClick={() => void openPdfPreview(file)}
                                    >
                                      <span className={styles.fileType}>PDF</span>
                                      <span>
                                        <strong>{file.original_name}</strong>
                                        <small>{formatFileSize(file.size_bytes)}</small>
                                      </span>
                                      <em>크게 보기</em>
                                    </button>
                                    <button
                                      type="button"
                                      className={styles.pdfDownloadButton}
                                      onClick={() => void downloadFile(file)}
                                    >
                                      받기
                                    </button>
                                  </article>
                                ) : (
                                  <button
                                    key={file.id}
                                    type="button"
                                    className={styles.fileCard}
                                    onClick={() => void downloadFile(file)}
                                  >
                                    <span className={styles.fileType}>
                                      {fileExtension(file.original_name).slice(0, 4) ||
                                        "FILE"}
                                    </span>
                                    <span>
                                      <strong>{file.original_name}</strong>
                                      <small>{formatFileSize(file.size_bytes)}</small>
                                    </span>
                                    <em>받기</em>
                                  </button>
                                )
                              )}
                            </div>
                          )}
                        </div>
                        </article>
                      )}
                    </div>
                  );
                })
              )}
              <div ref={messageEndRef} />
            </div>

            <form className={styles.composer} onSubmit={submitMessage}>
              {selectedRoom.room_type === "approval" && (
                <p className={styles.approvalCommandHint}>
                  현재 결재자는 채팅에 <b>승인</b> 또는 <b>반려: 사유</b>를
                  입력해 결재할 수 있습니다.
                </p>
              )}
              {pendingFiles.length > 0 && (
                <div className={styles.pendingFiles}>
                  {pendingFiles.map((file, index) => (
                    <span key={`${file.name}-${file.size}-${index}`}>
                      <i>{fileExtension(file.name).slice(0, 4) || "FILE"}</i>
                      <span>
                        <strong>{file.name}</strong>
                        <small>{formatFileSize(file.size)}</small>
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setPendingFiles((current) =>
                            current.filter((_, fileIndex) => fileIndex !== index)
                          )
                        }
                        aria-label={`${file.name} 첨부 취소`}
                      >
                        <WorkTalkIcon name="close" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {replyTarget && (
                <div className={styles.replyComposer}>
                  <button
                    type="button"
                    onClick={() => focusMessage(replyTarget.id)}
                    title="원문으로 이동"
                  >
                    <strong>{replyTarget.sender_name}</strong>
                    <span>{replyTarget.body}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setReplyTarget(null)}
                    aria-label="답글 취소"
                  >
                    <WorkTalkIcon name="close" />
                  </button>
                </div>
              )}
              {fileError && <p className={styles.fileError}>{fileError}</p>}
              <div className={styles.composerTools}>
                <button
                  type="button"
                  title="파일 첨부"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <WorkTalkIcon name="attach" />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={FILE_ACCEPT}
                  multiple
                  hidden
                  onChange={(event) => {
                    addFiles(Array.from(event.target.files || []));
                    event.target.value = "";
                  }}
                />
                <span>Enter 전송 · Shift+Enter 줄바꿈</span>
              </div>
              <div className={styles.composerInput}>
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  placeholder="메시지를 입력하세요"
                  rows={1}
                />
                <button
                  type="submit"
                  disabled={
                    (!draft.trim() && pendingFiles.length === 0) || sending
                  }
                  aria-label="메시지 전송"
                >
                  <WorkTalkIcon name="send" />
                </button>
              </div>
            </form>
            {dragActive && (
              <div className={styles.dropOverlay}>
                <WorkTalkIcon name="attach" />
                <strong>파일을 여기에 놓으세요</strong>
                <span>최대 5개 · 파일당 30MB</span>
              </div>
            )}
          </>
        ) : (
          <div className={styles.welcomePane}>
            <div className={styles.welcomeMark}>W</div>
            <strong>일과 대화가 한곳에</strong>
            <p>왼쪽에서 대화방을 선택하거나 새 채팅을 시작하세요.</p>
          </div>
        )}
      </section>

      {messageMenu && selectedRoom?.room_type === "group" && (
        <div
          className={styles.messageContextMenu}
          style={{
            left: Math.min(messageMenu.x, window.innerWidth - 190),
            top: Math.min(messageMenu.y, window.innerHeight - 120),
          }}
        >
          <button type="button" onClick={() => startReply(messageMenu.message)}>
            <WorkTalkIcon name="chat" />
            답글
          </button>
          <button
            type="button"
            onClick={() => void pinMessageAsNotice(messageMenu.message)}
          >
            <WorkTalkIcon name="pin" />
            공지로 지정
          </button>
        </div>
      )}

      {createMode && (
        <div className={styles.modalBackdrop} onClick={() => setCreateMode(null)}>
          <section
            className={styles.createModal}
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span>
                  {createMode === "direct" ? "1:1 대화" : "그룹채팅"}
                </span>
                <h2>
                  {createMode === "direct"
                    ? "대화 상대를 선택하세요"
                    : "그룹채팅 참여자를 선택하세요"}
                </h2>
              </div>
              <button type="button" onClick={() => setCreateMode(null)}>
                <WorkTalkIcon name="close" />
              </button>
            </header>
            {createMode === "group" && (
              <label className={styles.groupTitleInput}>
                <span>방 이름</span>
                <input
                  value={groupTitle}
                  onChange={(event) => setGroupTitle(event.target.value)}
                  placeholder="예: 신제품 출시 준비"
                  autoFocus
                />
              </label>
            )}
            <div className={styles.memberList}>
              {availableProfiles.map((profile: WorkTalkProfile) => {
                const checked = selectedMemberIds.includes(profile.id);
                return (
                  <label
                    key={profile.id}
                    className={checked ? styles.memberSelected : ""}
                  >
                    <input
                      type={createMode === "direct" ? "radio" : "checkbox"}
                      name="worktalk-member"
                      checked={checked}
                      onChange={(event) =>
                        setSelectedMemberIds((current) =>
                          createMode === "direct"
                            ? [profile.id]
                            : event.target.checked
                              ? [...current, profile.id]
                              : current.filter((id) => id !== profile.id)
                        )
                      }
                    />
                    <span className={styles.memberAvatar}>
                      <WorkTalkIcon name="person" />
                    </span>
                    <span>
                      <strong>{profile.name}</strong>
                      <small>{profile.team || "소속 미지정"}</small>
                    </span>
                  </label>
                );
              })}
            </div>
            <footer>
              <span>{selectedMemberIds.length}명 선택</span>
              <button
                type="button"
                disabled={
                  selectedMemberIds.length === 0 ||
                  (createMode === "group" && !groupTitle.trim()) ||
                  creating
                }
                onClick={() => void createRoom()}
              >
                {creating
                  ? "만드는 중..."
                  : createMode === "direct"
                    ? "1:1 대화 시작"
                    : "그룹채팅 만들기"}
              </button>
            </footer>
          </section>
        </div>
      )}

      {memberListOpen && selectedRoom && (
        <div
          className={styles.modalBackdrop}
          onClick={() => setMemberListOpen(false)}
        >
          <section
            className={`${styles.createModal} ${styles.memberViewModal}`}
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span>대화방 참여자</span>
                <h2>{getRoomTitle(selectedRoom, currentProfile?.id)}</h2>
              </div>
              <button type="button" onClick={() => setMemberListOpen(false)}>
                <WorkTalkIcon name="close" />
              </button>
            </header>
            <div className={styles.memberViewList}>
              {selectedRoomMembers.map((member) => (
                <article key={member.user_id}>
                  <span className={styles.memberAvatar}>
                    <WorkTalkIcon name="person" />
                  </span>
                  <div>
                    <strong>{member.profile?.name || "사용자"}</strong>
                    <small>{member.profile?.team || "소속 미지정"}</small>
                  </div>
                  <em>
                    {getRoomMemberRole(
                      selectedRoom,
                      member,
                      selectedRoomApprovalRoles.roomId === selectedRoom.id
                        ? selectedRoomApprovalRoles.roles
                        : undefined
                    )}
                  </em>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}

      {memberManagerOpen && selectedRoom && (
        <div
          className={styles.modalBackdrop}
          onClick={() => setMemberManagerOpen(false)}
        >
          <section
            className={styles.createModal}
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span>참여자 관리</span>
                <h2>{getRoomTitle(selectedRoom, currentProfile?.id)}</h2>
              </div>
              <button type="button" onClick={() => setMemberManagerOpen(false)}>
                <WorkTalkIcon name="close" />
              </button>
            </header>
            <div className={styles.currentMembers}>
              <strong>현재 참여자 {selectedRoomMembers.length}명</strong>
              <div>
                {selectedRoomMembers.map((member) => (
                  <span key={member.user_id}>
                    <WorkTalkIcon name="person" />
                    {member.profile?.name || "사용자"}
                    {member.user_id === selectedRoom.created_by && <em>방장</em>}
                  </span>
                ))}
              </div>
            </div>
            <div className={styles.memberSectionTitle}>
              초대할 사람
            </div>
            <div className={styles.memberList}>
              {inviteCandidates.length === 0 ? (
                <p className={styles.emptyMemberList}>
                  초대할 수 있는 다른 사용자가 없습니다.
                </p>
              ) : (
                inviteCandidates.map((profile) => {
                  const checked = inviteMemberIds.includes(profile.id);
                  return (
                    <label
                      key={profile.id}
                      className={checked ? styles.memberSelected : ""}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) =>
                          setInviteMemberIds((current) =>
                            event.target.checked
                              ? [...current, profile.id]
                              : current.filter((id) => id !== profile.id)
                          )
                        }
                      />
                      <span className={styles.memberAvatar}>
                        <WorkTalkIcon name="person" />
                      </span>
                      <span>
                        <strong>{profile.name}</strong>
                        <small>{profile.team || "소속 미지정"}</small>
                      </span>
                    </label>
                  );
                })
              )}
            </div>
            <footer>
              <span>{inviteMemberIds.length}명 선택</span>
              <button
                type="button"
                disabled={inviteMemberIds.length === 0 || invitingMembers}
                onClick={() => void submitInvitations()}
              >
                {invitingMembers ? "초대 중..." : "초대하기"}
              </button>
            </footer>
          </section>
        </div>
      )}

      {transferOwnerOpen && selectedRoom && (
        <div
          className={styles.modalBackdrop}
          onClick={() => setTransferOwnerOpen(false)}
        >
          <section
            className={styles.createModal}
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span>방장 양도</span>
                <h2>새 방장을 선택하세요</h2>
              </div>
              <button type="button" onClick={() => setTransferOwnerOpen(false)}>
                <WorkTalkIcon name="close" />
              </button>
            </header>
            <p className={styles.transferNotice}>
              선택한 사람에게 방장 권한을 넘긴 뒤 이 대화방에서 나갑니다.
            </p>
            <div className={styles.memberList}>
              {ownershipCandidates.map((member) => (
                <label
                  key={member.user_id}
                  className={
                    newOwnerId === member.user_id ? styles.memberSelected : ""
                  }
                >
                  <input
                    type="radio"
                    name="new-worktalk-owner"
                    checked={newOwnerId === member.user_id}
                    onChange={() => setNewOwnerId(member.user_id)}
                  />
                  <span className={styles.memberAvatar}>
                    <WorkTalkIcon name="person" />
                  </span>
                  <span>
                    <strong>{member.profile?.name || "사용자"}</strong>
                    <small>{member.profile?.team || "소속 미지정"}</small>
                  </span>
                </label>
              ))}
            </div>
            <footer>
              <span>양도 후 내 방 목록에서 사라집니다.</span>
              <button
                type="button"
                disabled={!newOwnerId || transferringOwner}
                onClick={() => void submitOwnerTransfer()}
              >
                {transferringOwner ? "처리 중..." : "양도하고 나가기"}
              </button>
            </footer>
          </section>
        </div>
      )}

      {roomAction && selectedRoom && (
        <div
          className={styles.modalBackdrop}
          onClick={() => setRoomAction(null)}
        >
          <section
            className={styles.confirmModal}
            onClick={(event) => event.stopPropagation()}
          >
            <span className={styles.confirmIcon}>
              <WorkTalkIcon name={roomAction === "delete" ? "close" : "back"} />
            </span>
            <h2>
              {roomAction === "delete"
                ? "이 대화방을 삭제할까요?"
                : roomAction === "direct-leave"
                  ? "1:1 대화에서 나갈까요?"
                  : "이 대화방에서 나갈까요?"}
            </h2>
            <p>
              <strong>{getRoomTitle(selectedRoom, currentProfile?.id)}</strong>
              {roomAction === "delete"
                ? "의 모든 메시지와 첨부파일이 함께 삭제되며 복구할 수 없습니다."
                : roomAction === "direct-leave"
                  ? activeDirectMemberCount <= 1
                    ? "에서 나가면 양쪽 모두 나간 상태가 되어 대화와 첨부파일이 자동 삭제됩니다."
                    : "에서 나가면 내 방 목록에서는 사라지고 상대방에게는 기존 대화가 유지됩니다."
                  : "에서 나가면 방 목록과 이전 대화를 더 이상 볼 수 없습니다."}
            </p>
            <div>
              <button
                type="button"
                onClick={() => setRoomAction(null)}
                disabled={roomActionBusy}
              >
                취소
              </button>
              <button
                type="button"
                className={styles.confirmDanger}
                onClick={() => void confirmRoomAction()}
                disabled={roomActionBusy}
              >
                {roomActionBusy
                  ? "처리 중..."
                  : roomAction === "delete"
                    ? "삭제"
                    : "나가기"}
              </button>
            </div>
          </section>
        </div>
      )}

      {previewImage && (
        <div
          className={styles.imagePreviewBackdrop}
          onClick={() => setPreviewImage(null)}
        >
          <section
            className={styles.imagePreviewModal}
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <strong>{previewImage.file.original_name}</strong>
              <button
                type="button"
                onClick={() => setPreviewImage(null)}
                aria-label="이미지 미리보기 닫기"
              >
                <WorkTalkIcon name="close" />
              </button>
            </header>
            <div>
              <img src={previewImage.url} alt={previewImage.file.original_name} />
            </div>
            <footer>
              <span>{formatFileSize(previewImage.file.size_bytes)}</span>
              <button
                type="button"
                onClick={() => void downloadFile(previewImage.file)}
              >
                원본 받기
              </button>
            </footer>
          </section>
        </div>
      )}

      {previewPdf && (
        <div
          className={styles.pdfPreviewBackdrop}
          onClick={() => setPreviewPdf(null)}
        >
          <section
            ref={pdfPreviewRef}
            className={styles.pdfPreviewModal}
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <strong>{previewPdf.file.original_name}</strong>
              <div>
                <button type="button" onClick={() => void togglePdfFullscreen()}>
                  전체화면
                </button>
                <button
                  type="button"
                  onClick={() => void downloadFile(previewPdf.file)}
                >
                  받기
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewPdf(null)}
                  aria-label="PDF 닫기"
                >
                  <WorkTalkIcon name="close" />
                </button>
              </div>
            </header>
            <iframe src={previewPdf.url} title={previewPdf.file.original_name} />
          </section>
        </div>
      )}

      {showReadReceiptDebugPanel && (
        <section
          aria-label="READ RECEIPT DEBUG"
          style={{
            position: "fixed",
            left: isNarrowLayoutNow ? 76 : 88,
            right: 12,
            bottom: 12,
            zIndex: 10000,
            maxHeight: "38vh",
            overflowY: "auto",
            padding: "10px 12px",
            border: "1px solid rgba(96, 239, 203, 0.45)",
            borderRadius: 14,
            background: "rgba(5, 17, 25, 0.92)",
            boxShadow: "0 16px 40px rgba(0, 0, 0, 0.28)",
            color: "#dffcf5",
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            fontSize: 11,
            lineHeight: 1.45,
            pointerEvents: "auto",
          }}
        >
          <strong style={{ display: "block", marginBottom: 6 }}>
            READ RECEIPT DEBUG · last read receipt event
          </strong>
          {readReceiptDebugEvents.length === 0 ? (
            <div style={{ color: "rgba(223, 252, 245, 0.68)" }}>
              waiting for READ RECEIPT FIRING...
            </div>
          ) : (
            readReceiptDebugEvents.map((event, index) => (
              <div
                key={`${event.timestamp}-${index}`}
                style={{
                  paddingTop: index === 0 ? 0 : 8,
                  marginTop: index === 0 ? 0 : 8,
                  borderTop:
                    index === 0
                      ? "none"
                      : "1px solid rgba(223, 252, 245, 0.18)",
                }}
              >
                <div>
                  <b>#{index + 1}</b> {event.timestamp} ·{" "}
                  {event.source || "unknown"}
                </div>
                <div>roomId: {event.roomId ?? "null"}</div>
                <div>selectedRoomId: {event.selectedRoomId ?? "null"}</div>
                <div>callReason: {event.callReason}</div>
                <div>
                  userOpenedRoomRef: {String(event.userOpenedRoomRef)}
                </div>
                <div>
                  confirmedDeepLinkOpenedRef:{" "}
                  {String(event.confirmedDeepLinkOpenedRef)}
                </div>
                <div>isMobileListView: {String(event.isMobileListView)}</div>
                <div>readAllowed: {String(event.readAllowed)}</div>
              </div>
            ))
          )}
        </section>
      )}

      {errorMessage && (
        <div className={styles.errorToast} role="alert">
          <span>{errorMessage}</span>
          <button type="button" onClick={clearError}>
            <WorkTalkIcon name="close" />
          </button>
        </div>
      )}

      {setupState === "error" && (
        <div className={styles.fatalOverlay}>
          <strong>WorkTalk을 불러오지 못했습니다</strong>
          <span>{errorMessage}</span>
          <button type="button" onClick={reload}>
            다시 시도
          </button>
        </div>
      )}
    </main>
  );
}
