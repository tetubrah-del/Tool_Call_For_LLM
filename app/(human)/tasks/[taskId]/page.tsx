"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";

type Task = {
  id: string;
  task: string;
  deliverable: "photo" | "video" | "text" | null;
  status: string;
  budget_usd: number;
  location: string | null;
};

export default function DeliverPage() {
  const params = useParams<{ taskId: string }>();
  const searchParams = useSearchParams();
  const humanId = searchParams.get("human_id") || "";

  const [task, setTask] = useState<Task | null>(null);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "saving" | "done" | "error">(
    "loading"
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/tasks/${params.taskId}`);
        if (!res.ok) throw new Error("failed");
        const data = await res.json();
        setTask(data.task);
        setStatus("idle");
      } catch (err: any) {
        setError(err.message || "failed");
        setStatus("error");
      }
    }
    load();
  }, [params.taskId]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!task) return;

    setStatus("saving");
    setError(null);

    try {
      const formData = new FormData();
      formData.append("task_id", task.id);
      const type = task.deliverable || "text";
      formData.append("type", type);
      if (type === "text") {
        formData.append("text", text);
      } else if (file) {
        formData.append("file", file);
      }

      const res = await fetch("/api/submissions", {
        method: "POST",
        body: formData
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data?.reason || "failed");
      }

      setStatus("done");
    } catch (err: any) {
      setError(err.message || "failed");
      setStatus("error");
    }
  }

  if (status === "loading") {
    return <p>Loading...</p>;
  }

  if (!task) {
    return <p>Task not found.</p>;
  }

  const deliverable = task.deliverable || "text";

  return (
    <div>
      <h1>Deliver Task</h1>
      <div className="card">
        <h3>{task.task}</h3>
        <p className="muted">
          Deliverable: {deliverable} | Budget: ${task.budget_usd} | Location:{" "}
          {task.location || "Any"}
        </p>
      </div>

      <form className="card" onSubmit={onSubmit}>
        {deliverable === "text" && (
          <label>
            Text
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} />
          </label>
        )}
        {deliverable !== "text" && (
          <label>
            Upload {deliverable}
            <input
              type="file"
              accept={deliverable === "photo" ? "image/*" : "video/*"}
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </label>
        )}
        <div className="row">
          <button type="submit" disabled={status === "saving"}>
            {status === "saving" ? "Uploading..." : "Submit"}
          </button>
          <a href={`/tasks?human_id=${humanId}`} className="secondary">
            Back to Tasks
          </a>
        </div>
      </form>

      {status === "done" && (
        <div className="card">
          <p>Submitted.</p>
        </div>
      )}

      {status === "error" && error && (
        <div className="card">
          <p>Failed: {error}</p>
        </div>
      )}
    </div>
  );
}
