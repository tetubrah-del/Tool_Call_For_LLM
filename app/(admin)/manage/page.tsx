import { Suspense } from "react";
import ManageClient from "./ManageClient";

export default function ManagePage() {
  return (
    <Suspense fallback={<div />}>
      <ManageClient />
    </Suspense>
  );
}

