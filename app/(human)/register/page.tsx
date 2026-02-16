import { Suspense } from "react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import RegisterClient from "./RegisterClient";
import { authOptions } from "@/lib/auth";

export default async function RegisterPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const session = await getServerSession(authOptions);
  if (!session) {
    const lang = typeof resolvedSearchParams?.lang === "string" ? resolvedSearchParams.lang : "en";
    redirect(`/auth?lang=${lang}`);
  }

  return (
    <Suspense fallback={<div />}>
      <RegisterClient />
    </Suspense>
  );
}
