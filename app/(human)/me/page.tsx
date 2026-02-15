import { Suspense } from "react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import MyPageClient from "./MyPageClient";
import { authOptions } from "@/lib/auth";

export default async function MyPage({
  searchParams
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const session = await getServerSession(authOptions);
  if (!session) {
    const lang = typeof searchParams?.lang === "string" ? searchParams.lang : "en";
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams || {})) {
      if (typeof value === "string") qs.set(key, value);
      else if (Array.isArray(value)) {
        for (const v of value) {
          if (typeof v === "string") qs.append(key, v);
        }
      }
    }
    const nextPath = `/me${qs.toString() ? `?${qs.toString()}` : ""}`;
    const authQs = new URLSearchParams();
    authQs.set("lang", lang);
    authQs.set("next", nextPath);
    redirect(`/auth?${authQs.toString()}`);
  }

  return (
    <Suspense fallback={<div />}>
      <MyPageClient />
    </Suspense>
  );
}
