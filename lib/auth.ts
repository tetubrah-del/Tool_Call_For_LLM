import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { getDb } from "@/lib/db";

async function upsertOauthUser(params: {
  email: string;
  name: string | null;
  image: string | null;
  provider: string;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  await db.query(
    `INSERT INTO oauth_users (email, name, image, provider, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       name = excluded.name,
       image = excluded.image,
       provider = excluded.provider,
       last_seen_at = excluded.last_seen_at`,
    [params.email, params.name, params.image, params.provider, now, now]
  );
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? ""
    })
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async signIn({ user, account }) {
      const email = normalizeEmail(user?.email);
      if (!email) return true;
      try {
        await upsertOauthUser({
          email,
          name: typeof user?.name === "string" ? user.name : null,
          image: typeof user?.image === "string" ? user.image : null,
          provider: typeof account?.provider === "string" ? account.provider : "google"
        });
      } catch (error) {
        console.error("oauth_user_upsert_failed", error);
      }
      return true;
    },
    async jwt({ token, user, account }) {
      const alreadyTracked = token.oauth_user_tracked === true;
      const shouldTrack = Boolean(account?.provider) || !alreadyTracked;
      if (!shouldTrack) return token;

      const email = normalizeEmail(user?.email || token?.email);
      if (!email) return token;
      try {
        await upsertOauthUser({
          email,
          name:
            typeof user?.name === "string"
              ? user.name
              : typeof token?.name === "string"
                ? token.name
                : null,
          image:
            typeof user?.image === "string"
              ? user.image
              : typeof token?.picture === "string"
                ? token.picture
                : null,
          provider:
            typeof account?.provider === "string"
              ? account.provider
              : typeof token?.provider === "string"
                ? token.provider
                : "google"
        });
        token.provider =
          typeof account?.provider === "string"
            ? account.provider
            : typeof token?.provider === "string"
              ? token.provider
              : "google";
        token.oauth_user_tracked = true;
      } catch (error) {
        console.error("oauth_user_upsert_jwt_failed", error);
      }
      return token;
    }
  },
  pages: {
    signIn: "/auth"
  }
};
