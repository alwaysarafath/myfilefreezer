import { redirect } from "next/navigation";
import { auth } from "@/auth";

/**
 * The single auth boundary for the whole app.
 *
 * Every page and route handler goes through here, which is deliberate: sign-in exists only
 * to stop a stray browser on your network from reaching an app that can spend your AWS
 * money. If you run this purely on localhost and decide the Google round-trip is not worth
 * it, set DISABLE_AUTH=true and the Google setup step disappears -- nothing else in the
 * codebase needs to change.
 *
 * There is no middleware doing this. Gating is explicit at each entry point so that adding
 * a new page cannot silently inherit, or silently miss, protection.
 */

export const AUTH_DISABLED = process.env.DISABLE_AUTH === "true";

export type Viewer = { email: string };

const LOCAL_OWNER: Viewer = { email: "local" };

export async function currentUser(): Promise<Viewer | null> {
  if (AUTH_DISABLED) return LOCAL_OWNER;
  const session = await auth();
  const email = session?.user?.email;
  return email ? { email } : null;
}

/** For pages: redirects to the sign-in screen when signed out. */
export async function requireUser(): Promise<Viewer> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}
