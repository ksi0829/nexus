import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type NotificationRow = {
  id: number;
  user_id: string;
  room_id: number;
  message_id: number;
  title: string;
  body: string;
};

type SubscriptionRow = {
  id: number;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT || "mailto:admin@zeta.co.kr";

  if (
    !supabaseUrl ||
    !anonKey ||
    !serviceRoleKey ||
    !vapidPublicKey ||
    !vapidPrivateKey
  ) {
    return NextResponse.json(
      { error: "Push server environment variables are not configured." },
      { status: 503 }
    );
  }

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error: userError,
  } = await authClient.auth.getUser(token);
  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    roomId?: number;
  } | null;
  const roomId = Number(body?.roomId);
  if (!Number.isSafeInteger(roomId) || roomId <= 0) {
    return NextResponse.json({ error: "Invalid room id." }, { status: 400 });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const pendingSince = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const { data: pendingRows, error: pendingError } = await admin
    .from("worktalk_notifications")
    .select("id,user_id,room_id,message_id,title,body")
    .eq("sender_id", user.id)
    .neq("user_id", user.id)
    .eq("room_id", roomId)
    .is("push_sent_at", null)
    .gte("created_at", pendingSince)
    .order("created_at", { ascending: true });

  if (pendingError) {
    return NextResponse.json({ error: pendingError.message }, { status: 500 });
  }

  const pendingNotifications = (pendingRows || []) as NotificationRow[];
  if (pendingNotifications.length === 0) {
    return NextResponse.json({ sent: 0, removed: 0 });
  }

  const pendingNotificationIds = pendingNotifications.map(
    (notification) => notification.id
  );
  const claimTime = new Date().toISOString();
  const { data: claimedRows, error: claimError } = await admin
    .from("worktalk_notifications")
    .update({ push_sent_at: claimTime })
    .in("id", pendingNotificationIds)
    .is("push_sent_at", null)
    .select("id,user_id,room_id,message_id,title,body");

  if (claimError) {
    return NextResponse.json({ error: claimError.message }, { status: 500 });
  }

  const notifications = (claimedRows || []) as NotificationRow[];
  if (notifications.length === 0) {
    return NextResponse.json({ sent: 0, removed: 0, claimed: 0 });
  }

  const deliveryNotifications = [
    ...new Map(
      notifications.map((notification) => [
        `${notification.user_id}:${notification.room_id}:${notification.message_id}`,
        notification,
      ])
    ).values(),
  ];
  const recipientIds = [
    ...new Set(deliveryNotifications.map((item) => item.user_id)),
  ];
  const { data: subscriptionRows, error: subscriptionError } = await admin
    .from("worktalk_push_subscriptions")
    .select("id,user_id,endpoint,p256dh,auth")
    .in("user_id", recipientIds);

  if (subscriptionError) {
    return NextResponse.json(
      { error: subscriptionError.message },
      { status: 500 }
    );
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  const subscriptions = [
    ...new Map(
      ((subscriptionRows || []) as SubscriptionRow[]).map((subscription) => [
        subscription.endpoint,
        subscription,
      ])
    ).values(),
  ];
  const subscriptionsByUser = new Map<string, SubscriptionRow[]>();
  subscriptions.forEach((subscription) => {
    const rows = subscriptionsByUser.get(subscription.user_id) || [];
    rows.push(subscription);
    subscriptionsByUser.set(subscription.user_id, rows);
  });

  let sent = 0;
  const expiredSubscriptionIds = new Set<number>();

  await Promise.all(
    deliveryNotifications.flatMap((notification) =>
      (subscriptionsByUser.get(notification.user_id) || []).map(
        async (subscription) => {
          try {
            const notificationTag = `worktalk-${notification.room_id}-${notification.message_id}`;
            await webpush.sendNotification(
              {
                endpoint: subscription.endpoint,
                keys: {
                  p256dh: subscription.p256dh,
                  auth: subscription.auth,
                },
              },
              JSON.stringify({
                title: notification.title,
                body: notification.body || "새 메시지가 도착했습니다.",
                tag: notificationTag,
                roomId: notification.room_id,
                room: notification.room_id,
                messageId: notification.message_id,
                message: notification.message_id,
                url: `/worktalk?room=${notification.room_id}&message=${notification.message_id}`,
              }),
              {
                TTL: 60,
                urgency: "high",
                topic: `wt-${notification.room_id}-${notification.message_id}`,
              }
            );
            sent += 1;
          } catch (error) {
            const statusCode =
              error &&
              typeof error === "object" &&
              "statusCode" in error &&
              typeof error.statusCode === "number"
                ? error.statusCode
                : null;
            if (
              statusCode === 404 ||
              statusCode === 410
            ) {
              expiredSubscriptionIds.add(subscription.id);
              return;
            }
            console.error("WorkTalk push delivery failed", error);
          }
        }
      )
    )
  );

  if (expiredSubscriptionIds.size > 0) {
    await admin
      .from("worktalk_push_subscriptions")
      .delete()
      .in("id", [...expiredSubscriptionIds]);
  }

  return NextResponse.json({
    sent,
    claimed: notifications.length,
    removed: expiredSubscriptionIds.size,
  });
}
