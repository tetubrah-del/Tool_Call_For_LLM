"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { normalizeLang, UI_STRINGS, type UiLang } from "@/lib/i18n";

type Task = {
  id: string;
  task: string;
  task_display?: string;
  lang?: UiLang;
  location: string | null;
  budget_usd: number;
  deliverable: "photo" | "video" | "text" | null;
  status: "open" | "accepted" | "completed" | "failed";
  human_id: string | null;
  created_at: string;
};

export default function TasksClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialHumanId = useMemo(() => searchParams.get("human_id") || "", [searchParams]);
  const initialLang = useMemo(() => normalizeLang(searchParams.get("lang")), [searchParams]);

  const [humanId, setHumanId] = useState(initialHumanId);
  const [lang, setLang] = useState<UiLang>(initialLang);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const strings = UI_STRINGS[lang];
  const statusLabels: Record<Task["status"], string> = {
    open: strings.statusOpen,
    accepted: strings.statusAccepted,
    completed: strings.statusCompleted,
    failed: strings.statusFailed
  };

  const loadTasks = useCallback(
    async (id: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/tasks?human_id=${id}&lang=${lang}`);
        if (!res.ok) {
          throw new Error("failed to load");
        }
        const data = await res.json();
        setTasks(data.tasks || []);
      } catch (err: any) {
        setError(err.message || "failed");
      } finally {
        setLoading(false);
      }
    },
    [lang]
  );

  useEffect(() => {
    if (initialHumanId) {
      localStorage.setItem("human_id", initialHumanId);
    }
  }, [initialHumanId]);

  useEffect(() => {
    const savedLang = localStorage.getItem("lang");
    if (!searchParams.get("lang") && savedLang) {
      const next = normalizeLang(savedLang);
      setLang(next);
      const params = new URLSearchParams(searchParams.toString());
      params.set("lang", next);
      if (humanId) {
        params.set("human_id", humanId);
      }
      router.replace(`/tasks?${params.toString()}`);
      return;
    }

    localStorage.setItem("lang", lang);

    if (!humanId) {
      const saved = localStorage.getItem("human_id");
      if (saved) {
        setHumanId(saved);
      }
      return;
    }

    loadTasks(humanId);
  }, [humanId, lang, searchParams, router, loadTasks]);

  async function acceptTask(taskId: string) {
    await fetch(`/api/tasks/${taskId}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ human_id: humanId })
    });
    loadTasks(humanId);
  }

  async function skipTask(taskId: string) {
    await fetch(`/api/tasks/${taskId}/skip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ human_id: humanId })
    });
    loadTasks(humanId);
  }

  function onLangChange(next: UiLang) {
    setLang(next);
    const params = new URLSearchParams(searchParams.toString());
    params.set("lang", next);
    if (humanId) {
      params.set("human_id", humanId);
    }
    router.replace(`/tasks?${params.toString()}`);
  }

  return (
    <div className="tasks">
      <div className="page-head">
        <div>
          <p className="eyebrow">{strings.latestTasks}</p>
          <h1>{strings.tasks}</h1>
        </div>
        <div className="lang">
          <label htmlFor="lang">{strings.langLabel}</label>
          <select
            id="lang"
            value={lang}
            onChange={(e) => onLangChange(normalizeLang(e.target.value))}
          >
            <option value="en">EN</option>
            <option value="ja">JA</option>
          </select>
        </div>
      </div>

      <div className="card filter-card">
        <label>
          {strings.humanId}
          <input
            value={humanId}
            onChange={(e) => setHumanId(e.target.value)}
            placeholder={strings.pasteHumanId}
          />
        </label>
        <div className="row">
          <button onClick={() => loadTasks(humanId)} disabled={!humanId || loading}>
            {loading ? strings.loading : strings.refresh}
          </button>
          <a href="/register" className="text-link">
            {strings.needAccount}
          </a>
        </div>
        {error && <p className="muted">{error}</p>}
      </div>

      {tasks.length === 0 && !loading && <p className="muted">{strings.noTasks}</p>}

      <div className="task-list">
        {tasks.map((task) => {
          const isAssigned = task.human_id === humanId;
          const statusLabel = statusLabels[task.status];
          const showTranslationPending =
            lang === "ja" && task.task_display && task.task_display === task.task;
          return (
            <div key={task.id} className="task-item">
              <div className="task-header">
                <h3>{task.task_display || task.task}</h3>
                <span className="status-pill">{statusLabel}</span>
              </div>
              {showTranslationPending && (
                <p className="muted">{strings.translationPending}</p>
              )}
              <p className="muted">
                {strings.budget}: ${task.budget_usd} | {strings.location}:{" "}
                {task.location || strings.any} | {strings.deliverable}:{" "}
                {task.deliverable || "text"}
              </p>
              <div className="task-actions">
                <a className="text-link" href={`/tasks/${task.id}?human_id=${humanId}&lang=${lang}`}>
                  {strings.details}
                </a>
                <div className="row">
                  {task.status === "open" && (
                    <button onClick={() => acceptTask(task.id)}>{strings.accept}</button>
                  )}
                  {(task.status === "accepted" || isAssigned) && (
                    <a href={`/tasks/${task.id}?human_id=${humanId}&lang=${lang}`}>
                      {strings.deliver}
                    </a>
                  )}
                  {(task.status === "open" || isAssigned) && (
                    <button className="secondary" onClick={() => skipTask(task.id)}>
                      {strings.skip}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
