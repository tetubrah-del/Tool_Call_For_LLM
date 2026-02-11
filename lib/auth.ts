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
      const email = typeof user?.email === "string" ? user.email.trim().toLowerCase() : "";
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
    }
  },
  pages: {
    signIn: "/auth"
  }
};
