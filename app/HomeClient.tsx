"use client";

import { useEffect, useMemo, useState } from "react";
import { normalizeLang, UI_STRINGS, type UiLang } from "@/lib/i18n";

type TaskPreview = {
  id: string;
  task: string;
  task_display?: string;
  lang?: UiLang;
  location: string | null;
  budget_usd: number;
  deliverable: "photo" | "video" | "text" | null;
  created_at: string;
};

export default function HomeClient() {
  const [lang, setLang] = useState<UiLang>("en");
  const [tasks, setTasks] = useState<TaskPreview[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const strings = UI_STRINGS[lang];
  const latestTasks = useMemo(() => tasks.slice(0, 6), [tasks]);

  useEffect(() => {
    const saved = localStorage.getItem("lang");
    if (saved) {
      setLang(normalizeLang(saved));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadTasks() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/tasks?lang=${lang}`);
        if (!res.ok) {
          throw new Error("failed to load");
        }
        const data = await res.json();
        if (!cancelled) {
          setTasks(data.tasks || []);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || "failed");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadTasks();
    return () => {
      cancelled = true;
    };
  }, [lang]);

  function onLangChange(next: UiLang) {
    setLang(next);
    localStorage.setItem("lang", next);
  }

  return (
    <div className="home">
      <header className="hero">
        <div className="hero-top">
          <div>
            <p className="eyebrow">{strings.heroEyebrow}</p>
            <h1>{strings.appTitle}</h1>
            <p className="subtitle">{strings.heroSubtitle}</p>
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
        <p className="note">{strings.humanUiOnly}</p>
      </header>

      <section className="cta-grid">
        <a className="cta" href={`/register?lang=${lang}`}>
          <div>
            <h2>{strings.register}</h2>
            <p>{strings.registerDesc}</p>
          </div>
          <span className="cta-arrow">→</span>
        </a>
        <a className="cta secondary" href={`/tasks?lang=${lang}`}>
          <div>
            <h2>{strings.viewTasks}</h2>
            <p>{strings.viewTasksDesc}</p>
          </div>
          <span className="cta-arrow">→</span>
        </a>
      </section>

      <section className="tasks-preview">
        <div className="section-head">
          <h3>{strings.latestTasks}</h3>
          <a className="text-link" href={`/tasks?lang=${lang}`}>
            {strings.viewAllTasks}
          </a>
        </div>
        {loading && <p className="muted">{strings.loading}</p>}
        {error && !loading && <p className="muted">{error}</p>}
        {!loading && !error && latestTasks.length === 0 && (
          <p className="muted">{strings.noTasks}</p>
        )}
        <div className="task-grid">
          {latestTasks.map((task) => (
            <div key={task.id} className="task-card">
              <div className="task-title">{task.task_display || task.task}</div>
              <div className="task-meta">
                <span>${task.budget_usd}</span>
                <span>{task.location || strings.any}</span>
                <span>{task.deliverable || "text"}</span>
              </div>
              <div className="task-date">
                {strings.posted}: {new Date(task.created_at).toLocaleDateString()}
              </div>
              <a className="text-link" href={`/tasks/${task.id}?lang=${lang}`}>
                {strings.details}
              </a>
            </div>
          ))}
        </div>
      </section>

      <section className="how">
        <div className="card">
          <h3>{strings.howItWorks}</h3>
          <ol>
            <li>{strings.stepOne}</li>
            <li>{strings.stepTwo}</li>
            <li>{strings.stepThree}</li>
          </ol>
        </div>
      </section>
    </div>
  );
}
