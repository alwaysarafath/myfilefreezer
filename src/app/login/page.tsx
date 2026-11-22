import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { AUTH_DISABLED, currentUser } from "@/lib/session";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (AUTH_DISABLED) redirect("/");
  if (await currentUser()) redirect("/");

  const { error } = await searchParams;

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-2xl font-semibold">MyFileFreezer</h1>
        <p className="mt-2 text-sm opacity-70">
          Your own cold storage. Your bucket, your bill.
        </p>

        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/" });
          }}
        >
          <button
            type="submit"
            className="mt-8 w-full rounded-md border border-current/20 px-4 py-2.5 text-sm font-medium hover:bg-current/5"
          >
            Sign in with Google
          </button>
        </form>

        {error && (
          <p className="mt-4 text-sm text-red-500">
            {error === "AccessDenied"
              ? "That account is not the one set in ALLOWED_EMAIL."
              : "Sign-in failed. Check AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET and AUTH_SECRET."}
          </p>
        )}

        <p className="mt-8 text-xs opacity-40">
          Running only on your own machine? Set DISABLE_AUTH=true and skip this entirely.
        </p>
      </div>
    </main>
  );
}
