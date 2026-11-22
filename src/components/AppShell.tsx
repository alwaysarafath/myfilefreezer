import type { ReactNode } from "react";
import { signOut } from "@/auth";
import { AUTH_DISABLED, requireUser } from "@/lib/session";
import Nav from "./Nav";

/**
 * Wraps every signed-in page. Calling requireUser() here is what gates the page -- each
 * page renders through this shell, so protection is not something a new page can forget
 * by omitting a middleware matcher.
 */
export default async function AppShell({ children }: { children: ReactNode }) {
  const user = await requireUser();

  async function doSignOut() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <>
      <Nav email={user.email} signOutAction={AUTH_DISABLED ? undefined : doSignOut} />
      {children}
    </>
  );
}
