import { Suspense } from "react";
import { redirect } from "next/navigation";
import { assertAdminPageAccess } from "@/lib/admin-auth";
import ManageClient from "./ManageClient";

export default async function ManagePage() {
  const access = await assertAdminPageAccess();
  if (!access.ok) {
    redirect("/auth");
  }

  return (
    <Suspense fallback={<div />}>
      <ManageClient />
    </Suspense>
  );
}

