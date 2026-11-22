"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Nav({
  email,
  signOutAction,
}: {
  email: string;
  /** Omitted when DISABLE_AUTH is on -- there is no session to end. */
  signOutAction?: () => Promise<void>;
}) {
  const pathname = usePathname();

  const link = (href: string, label: string) => (
    <Link
      href={href}
      className={`rounded px-2.5 py-1 text-sm ${
        pathname === href ? "bg-current/10 font-medium" : "opacity-70 hover:opacity-100"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <header className="flex items-center gap-4 border-b border-current/10 px-5 py-3">
      <span className="text-sm font-semibold">MyFileFreezer</span>
      <nav className="flex gap-1">
        {link("/", "Upload")}
        {link("/files", "Files")}
        {link("/thaw", "Thaw cost")}
      </nav>
      <div className="ml-auto flex items-center gap-3">
        <span className="hidden text-xs opacity-50 sm:inline">{email}</span>
        {signOutAction && (
          <form action={signOutAction}>
            <button
              type="submit"
              className="text-xs opacity-70 hover:opacity-100 hover:underline"
            >
              Sign out
            </button>
          </form>
        )}
      </div>
    </header>
  );
}
