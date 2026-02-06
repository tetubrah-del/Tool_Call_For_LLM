import { Suspense } from "react";
import RegisterClient from "./RegisterClient";

export default function RegisterPage() {
  return (
    <Suspense fallback={<div />}>
      <RegisterClient />
    </Suspense>
  );
}
