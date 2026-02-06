import { Suspense } from "react";
import TaskDetailClient from "./TaskDetailClient";

export default function DeliverPage() {
  return (
    <Suspense fallback={<div />}>
      <TaskDetailClient />
    </Suspense>
  );
}
