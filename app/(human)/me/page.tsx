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
    redirect(`/auth?lang=${lang}`);
  }

  return (
    <Suspense fallback={<div />}>
      <MyPageClient />
    </Suspense>
  );
}
