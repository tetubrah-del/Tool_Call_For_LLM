import { Suspense } from "react";
import { redirect } from "next/navigation";
import { assertAdminPageAccess } from "@/lib/admin-auth";
import ManageClient from "./ManageClient";

export default async function ManagePage() {
  const access = await assertAdminPageAccess();
  if (!access.ok) {
    const qs = new URLSearchParams();
    qs.set("next", "/manage");
    redirect(`/auth?${qs.toString()}`);
  }

  return (
    <Suspense fallback={<div />}>
      <ManageClient />
    </Suspense>
  );
}
