import { Suspense } from "react";
import AIConnectClient from "./AIConnectClient";

export default function AIConnectPage() {
  return (
    <Suspense fallback={<div />}>
      <AIConnectClient />
    </Suspense>
  );
}
