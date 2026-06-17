import { createBrowserClient } from "@supabase/ssr";

function serializeSessionCookie(
  name: string,
  value: string,
  options?: { path?: string; sameSite?: string | boolean; maxAge?: number; expires?: Date }
) {
  const path = options?.path || "/";
  const sameSite =
    typeof options?.sameSite === "string" ? options.sameSite : "lax";
  const parts = [`${name}=${value}`, `Path=${path}`, `SameSite=${sameSite}`];

  if (options?.maxAge === 0) {
    parts.push("Max-Age=0");
    parts.push("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  }

  if (typeof window !== "undefined" && window.location.protocol === "https:") {
    parts.push("Secure");
  }

  return parts.join("; ");
}

export function createSupabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          if (typeof document === "undefined" || !document.cookie) {
            return [];
          }

          return document.cookie.split("; ").map((cookie) => {
            const separatorIndex = cookie.indexOf("=");
            const name =
              separatorIndex >= 0 ? cookie.slice(0, separatorIndex) : cookie;
            const value =
              separatorIndex >= 0 ? cookie.slice(separatorIndex + 1) : "";

            return { name, value };
          });
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            const sessionOptions = { ...options };

            if (sessionOptions.maxAge !== 0) {
              delete sessionOptions.maxAge;
              delete sessionOptions.expires;
            }

            document.cookie = serializeSessionCookie(
              name,
              value,
              sessionOptions
            );
          });
        },
      },
    }
  );
}
