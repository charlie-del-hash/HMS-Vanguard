/* Who is asking, and are they allowed.
 *
 * ── the admin acts as the user, never as the service role ─────────────
 * Every write the admin makes goes through the signed-in user's own session,
 * so the database decides what they may do. 0004 and 0006 already state that
 * in policies — `with check (private.is_staff())` on every insert, update and
 * delete — and 0005 keeps is_staff() out of PostgREST's reach while leaving it
 * callable from a policy.
 *
 * The alternative was the service role plus an authorization check in the
 * endpoint. That bypasses RLS entirely, which means a mistake in one route
 * handler is a mistake with unlimited write access, and the database's own
 * rules become decoration. This way an authorization bug in this file can at
 * worst show somebody a page; it cannot grant them a write the database would
 * have refused.
 *
 * ── it fails closed ───────────────────────────────────────────────────
 * If Supabase cannot be reached, `getUser()` does not return "no user" — it
 * throws or errors. A guard that treats "I could not ask" as "not staff" is
 * correct; one that treats it as "carry on" opens the admin whenever the
 * database has a bad minute, which on a free-tier project that pauses after a
 * week idle is not hypothetical.
 *
 * That path is testable here, and only here: this sandbox has no egress to the
 * Supabase host, so `checks/site-admin.js` exercises exactly the unreachable
 * case and asserts the door stays shut.
 */
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { AstroCookies } from "astro";
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY } from "astro:env/client";
import type { Database } from "./database.types";

/** Cookies Supabase sets for the session. Never readable from JavaScript. */
const COOKIE_DEFAULTS: CookieOptions = {
  path: "/",
  sameSite: "lax",
  httpOnly: true,
  secure: true,
  maxAge: 60 * 60 * 24 * 7,
};

export interface RequestLike {
  cookies: AstroCookies;
  url: URL;
  request: Request;
}

/**
 * A Supabase client bound to this request's cookies, so a session survives a
 * navigation and a refreshed token is written back.
 */
export function serverClient(ctx: RequestLike) {
  /* `secure` must be off over plain http or the browser silently drops the
     cookie and the login loop never completes — which looks exactly like a
     wrong password and is not. */
  const secure = ctx.url.protocol === "https:";

  return createServerClient<Database>(PUBLIC_SUPABASE_URL ?? "", PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "", {
    cookies: {
      /* The INCOMING cookies, off the request. `AstroCookies.headers()` looks
         like the right call and is not — it yields the Set-Cookie headers this
         response will send, so reading it returns nothing on the first request
         and the session never resolves. A session that silently never resolves
         reads exactly like a wrong password. */
      getAll: () => {
        const header = ctx.request.headers.get("cookie") ?? "";
        const out: { name: string; value: string }[] = [];
        for (const part of header.split(";")) {
          const c = part.trim();
          if (!c) continue;
          const eq = c.indexOf("=");
          if (eq < 1) continue;
          out.push({ name: c.slice(0, eq), value: decodeURIComponent(c.slice(eq + 1)) });
        }
        return out;
      },
      setAll: (list: { name: string; value: string; options?: CookieOptions }[]) => {
        for (const { name, value, options } of list) {
          ctx.cookies.set(name, value, { ...COOKIE_DEFAULTS, ...options, secure });
        }
      },
    },
  });
}

export type Staff = { userId: string; email: string | null; role: string };

export type Access =
  | { state: "anon" }
  | { state: "signed-in-not-staff"; email: string | null }
  | { state: "staff"; staff: Staff }
  /** Could not ask. Treated exactly like anon by every caller. */
  | { state: "unavailable"; why: string };

/**
 * Who is making this request.
 *
 * Never throws: the caller has to handle four states and all four are real.
 * `unavailable` exists so a page can say "the database is unreachable" rather
 * than "your login is wrong", which are very different things to be told.
 */
export async function access(ctx: RequestLike): Promise<Access> {
  if (!PUBLIC_SUPABASE_URL || !PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    return { state: "unavailable", why: "PUBLIC_SUPABASE_* are not set on this deployment" };
  }

  const db = serverClient(ctx);

  let user;
  try {
    /* getUser, not getSession: getSession trusts the cookie's own contents,
       which the browser can edit. getUser verifies the token with the auth
       server, which is the difference between a check and a formality. */
    const { data, error } = await db.auth.getUser();
    if (error) {
      /* A missing or expired session is a normal anonymous visit, not a
         failure — telling those apart is why this reads the message rather
         than treating every error the same. */
      if (/session|jwt|token|missing|not authenticated/i.test(error.message)) {
        return { state: "anon" };
      }
      return { state: "unavailable", why: error.message };
    }
    user = data.user;
  } catch (e) {
    return { state: "unavailable", why: e instanceof Error ? e.message : String(e) };
  }

  if (!user) return { state: "anon" };

  /* Staff membership is a row, read as the user. A non-staff user cannot see
     the table at all (policy staff_read_self), so "no row" and "not allowed to
     look" are the same answer here, which is the answer we want. */
  try {
    const { data, error } = await db
      .from("staff")
      .select("user_id, role")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) return { state: "unavailable", why: error.message };
    if (!data) return { state: "signed-in-not-staff", email: user.email ?? null };
    return {
      state: "staff",
      staff: { userId: data.user_id, email: user.email ?? null, role: data.role },
    };
  } catch (e) {
    return { state: "unavailable", why: e instanceof Error ? e.message : String(e) };
  }
}

/** True only for the one state that may write. */
export function isStaff(a: Access): a is Extract<Access, { state: "staff" }> {
  return a.state === "staff";
}
