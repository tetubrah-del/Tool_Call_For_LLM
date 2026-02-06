"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { normalizeLang, UI_STRINGS, type UiLang } from "@/lib/i18n";

type Task = {
  id: string;
  task: string;
  task_display?: string;
  lang?: UiLang;
  deliverable: "photo" | "video" | "text" | null;
  status: string;
  budget_usd: number;
  location: string | null;
};

export default function TaskDetailClient() {
  const params = useParams<{ taskId: string }>();
  const searchParams = useSearchParams();
  const humanId = searchParams.get("human_id") || "";
  const lang = useMemo(() => normalizeLang(searchParams.get("lang")), [searchParams]);
  const strings = UI_STRINGS[lang];

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
        const res = await fetch(`/api/tasks/${params.taskId}?lang=${lang}`);
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
  }, [params.taskId, lang]);

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
    return <p>{strings.loading}</p>;
  }

  if (!task) {
    return <p>{strings.taskNotFound}</p>;
  }

  const deliverable = task.deliverable || "text";

  return (
    <div>
      <h1>{strings.deliverTask}</h1>
      <div className="card">
        <h3>{task.task_display || task.task}</h3>
        <p className="muted">
          {strings.deliverable}: {deliverable} | {strings.budget}: ${task.budget_usd} |{" "}
          {strings.location}: {task.location || strings.any}
        </p>
      </div>

      <form className="card" onSubmit={onSubmit}>
        {deliverable === "text" && (
          <label>
            {strings.text}
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} />
          </label>
        )}
        {deliverable !== "text" && (
          <label>
            {strings.upload} {deliverable}
            <input
              type="file"
              accept={deliverable === "photo" ? "image/*" : "video/*"}
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </label>
        )}
        <div className="row">
          <button type="submit" disabled={status === "saving"}>
            {status === "saving" ? strings.loading : strings.submit}
          </button>
          <a href={`/tasks?human_id=${humanId}&lang=${lang}`} className="secondary">
            {strings.backToTasks}
          </a>
        </div>
      </form>

      {status === "done" && (
        <div className="card">
          <p>{strings.submitted}</p>
        </div>
      )}

      {status === "error" && error && (
        <div className="card">
          <p>
            {strings.failed}: {error}
          </p>
        </div>
      )}
    </div>
  );
}
