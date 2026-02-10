import { Suspense } from "react";
import { redirect } from "next/navigation";
import { assertAdminPageAccess } from "@/lib/admin-auth";
import PaymentsClient from "./PaymentsClient";

export default async function PaymentsPage() {
  const access = await assertAdminPageAccess();
  if (!access.ok) {
    redirect("/auth");
  }
  return (
    <Suspense fallback={<div />}>
      <PaymentsClient />
    </Suspense>
  );
}
