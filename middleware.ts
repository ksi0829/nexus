import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(req: NextRequest) {

  const response = NextResponse.next();
  const pathname = req.nextUrl.pathname;

  if (pathname.startsWith("/api")) {
    return response;
  }

  const isPwaAsset =
    pathname === "/manifest.webmanifest" ||
    pathname === "/worktalk-sw.js" ||
    pathname === "/icon.png" ||
    pathname === "/apple-icon.png" ||
    pathname === "/maskable-icon.png" ||
    pathname === "/nexus.ico" ||
    pathname === "/nexus-talk-splash.png" ||
    pathname === "/nexus-symbol.png" ||
    pathname.startsWith("/favicon-") ||
    pathname.startsWith("/notification-") ||
    pathname.startsWith("/nexus-talk-icon-") ||
    pathname.startsWith("/worktalk-icon-") ||
    pathname.startsWith("/nexus-icon-");

  if (isPwaAsset) {
    return response;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {

        getAll() {
          return req.cookies.getAll();
        },

        setAll(cookiesToSet) {

          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });

        },

      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 공개 페이지
  const isPublicPage =
    pathname.startsWith("/login") ||
    pathname.startsWith("/brand") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon.ico");

  // 로그인 안 된 경우
  if (!user && !isPublicPage) {

    const url = req.nextUrl.clone();

    url.pathname = "/login";
    if (pathname.startsWith("/worktalk") || pathname.startsWith("/nexus")) {
      url.searchParams.set("next", `${pathname}${req.nextUrl.search}`);
    }

    return NextResponse.redirect(url);

  }

  // 로그인 상태
  if (user) {

    // 로그인 사용자가 login 접근 시 홈 이동
    if (pathname.startsWith("/login")) {

      const url = req.nextUrl.clone();

      const nextPath = req.nextUrl.searchParams.get("next");
      if (nextPath?.startsWith("/")) {
        try {
          const nextUrl = new URL(nextPath, req.nextUrl.origin);
          url.pathname = nextUrl.pathname;
          url.search = nextUrl.search;
        } catch {
          url.pathname = "/worktalk";
          url.search = "";
        }
      } else {
        url.pathname = "/worktalk";
        url.search = "";
      }

      return NextResponse.redirect(url);

    }

    // 비밀번호 변경 여부 체크
    const { data: profile } = await supabase
      .from("profiles")
      .select("must_change_password")
      .eq("id", user.id)
      .maybeSingle();

    const mustChange =
      profile?.must_change_password === true;

    // 최초 비밀번호 변경 강제
    if (
      mustChange &&
      !pathname.startsWith("/change-password")
    ) {

      const url = req.nextUrl.clone();

      url.pathname = "/change-password";

      return NextResponse.redirect(url);

    }

  }

  return response;

}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|brand|favicon.ico).*)",
  ],
};
