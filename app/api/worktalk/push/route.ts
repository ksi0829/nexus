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
    .eq("room_id", roomId)
    .is("push_sent_at", null)
    .gte("created_at", pendingSince)
    .order("created_at", { ascending: true });

  if (pendingError) {
    return NextResponse.json({ error: pendingError.message }, { status: 500 });
  }

  const notifications = (pendingRows || []) as NotificationRow[];
  if (notifications.length === 0) {
    return NextResponse.json({ sent: 0, removed: 0 });
  }

  const recipientIds = [...new Set(notifications.map((item) => item.user_id))];
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
  const subscriptions = (subscriptionRows || []) as SubscriptionRow[];
  const subscriptionsByUser = new Map<string, SubscriptionRow[]>();
  subscriptions.forEach((subscription) => {
    const rows = subscriptionsByUser.get(subscription.user_id) || [];
    rows.push(subscription);
    subscriptionsByUser.set(subscription.user_id, rows);
  });

  let sent = 0;
  const expiredSubscriptionIds = new Set<number>();

  await Promise.all(
    notifications.flatMap((notification) =>
      (subscriptionsByUser.get(notification.user_id) || []).map(
        async (subscription) => {
          try {
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
                tag: `worktalk-${notification.id}`,
                url: `/worktalk?room=${notification.room_id}&message=${notification.message_id}`,
              }),
              {
                TTL: 60,
                urgency: "high",
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

  const notificationIds = notifications.map((notification) => notification.id);
  await admin
    .from("worktalk_notifications")
    .update({ push_sent_at: new Date().toISOString() })
    .in("id", notificationIds);

  if (expiredSubscriptionIds.size > 0) {
    await admin
      .from("worktalk_push_subscriptions")
      .delete()
      .in("id", [...expiredSubscriptionIds]);
  }

  return NextResponse.json({
    sent,
    removed: expiredSubscriptionIds.size,
  });
}
