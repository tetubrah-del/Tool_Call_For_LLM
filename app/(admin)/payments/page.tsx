import { Suspense } from "react";
import PaymentsClient from "./PaymentsClient";

export default function PaymentsPage() {
  return (
    <Suspense fallback={<div />}>
      <PaymentsClient />
    </Suspense>
  );
}
