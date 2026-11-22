import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

/**
 * The entire access-control model: one email address, set in .env.local.
 *
 * There is no user table and no invite list. This app runs on your laptop and archives
 * your files into your bucket, so "who is allowed in" has exactly one answer.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  session: { strategy: "jwt" },
  // Auth.js only trusts the Host header automatically under `next dev`; without this,
  // `npm start` fails every sign-in with UntrustedHost. The app runs on localhost, so the
  // host is your own machine.
  trustHost: true,
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    signIn({ profile }) {
      const allowed = process.env.ALLOWED_EMAIL?.trim().toLowerCase();
      const email = profile?.email?.trim().toLowerCase();
      // Fails closed: an unset ALLOWED_EMAIL locks everyone out rather than letting
      // everyone in. To run without sign-in, set DISABLE_AUTH=true deliberately.
      return Boolean(allowed && email && allowed === email);
    },
  },
});
