"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { normalizeLang, UI_STRINGS, type UiLang } from "@/lib/i18n";
import { TASK_LABEL_TEXT, type TaskLabel } from "@/lib/task-labels";

type TaskPreview = {
  id: string;
  task: string;
  task_display?: string;
  lang?: UiLang;
  status?: "open" | "accepted" | "completed" | "failed";
  location: string | null;
  budget_usd: number;
  task_label: TaskLabel | null;
  deliverable: "photo" | "video" | "text" | null;
  created_at: string;
};

export default function HomeClient() {
  const [lang, setLang] = useState<UiLang>("en");
  const searchParams = useSearchParams();
  const [tasks, setTasks] = useState<TaskPreview[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const strings = UI_STRINGS[lang];
  const locale = lang === "ja" ? "ja-JP" : "en-US";
  const latestTasks = useMemo(() => tasks.slice(0, 6), [tasks]);
  const showHumanUiOnly = Boolean(strings.humanUiOnly);
  const showBestEffort = Boolean(strings.bestEffort && strings.noTimeGuarantee);
  const supplyStats = useMemo(() => {
    const total = tasks.length;
    const withLocation = tasks.filter((task) => !!task.location);
    const uniqueRegions = new Set(withLocation.map((task) => String(task.location))).size;
    const completed = tasks.filter((task) => task.status === "completed").length;
    const failed = tasks.filter((task) => task.status === "failed").length;
    const denominator = completed + failed;
    const completionRate = denominator > 0 ? Math.round((completed / denominator) * 100) : null;
    const open = tasks.filter((task) => task.status === "open").length;
    const openRate = total > 0 ? Math.round((open / total) * 100) : null;
    const hour = new Date().getHours();
    const slot =
      hour < 6
        ? "深夜"
        : hour < 12
          ? "午前"
          : hour < 18
            ? "午後"
            : "夜間";

    return { total, uniqueRegions, completionRate, openRate, slot };
  }, [tasks]);

  useEffect(() => {
    const saved = localStorage.getItem("lang");
    const nextLang = normalizeLang(searchParams.get("lang") || saved);
    setLang(nextLang);
  }, [searchParams]);

  useEffect(() => {
    localStorage.setItem("lang", lang);
  }, [lang]);

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

  function getTaskLabelText(taskLabel: TaskLabel | null) {
    if (!taskLabel) return strings.any;
    return TASK_LABEL_TEXT[taskLabel][lang];
  }

  function getDeliverableLabel(deliverable: TaskPreview["deliverable"] | null) {
    const type = deliverable || "text";
    if (type === "photo") return strings.deliverablePhoto;
    if (type === "video") return strings.deliverableVideo;
    return strings.deliverableText;
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
        </div>
        {showHumanUiOnly && <p className="note">{strings.humanUiOnly}</p>}
        <div className="agent-start-banner">
          <strong>AIエージェント向け開始導線</strong>
          <p className="note">
            <a href={`/for-agents?lang=${lang}`}>for Agents</a> /{" "}
            <a href="/for-agents/quickstart">Quickstart</a> /{" "}
            <a href="/for-agents/reference">Reference</a> / <a href="/openapi.json">OpenAPI</a>
          </p>
        </div>
        {showBestEffort && (
          <p className="note">
            {strings.bestEffort} | {strings.noTimeGuarantee}
          </p>
        )}
      </header>

      <section className="card">
        <h3>Agent Flow</h3>
        <ol>
          <li>POST /api/ai/accounts で account_id / api_key を取得</li>
          <li>POST /api/call_human または /api/tasks でタスク作成</li>
          <li>GET /api/tasks?task_id=... で status / submission を監視</li>
        </ol>
        <p className="muted">
          詳細手順は <a href="/for-agents/quickstart">Quickstart</a> を参照。
        </p>
      </section>

      <section className="cta-grid">
        <a className="cta" href={`/auth?lang=${lang}`}>
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
        <a className="cta" href={`/ai/connect?lang=${lang}`}>
          <div>
            <h2>{strings.aiConnect}</h2>
            <p>{strings.aiConnectSubtitle}</p>
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
        <div className="card">
          <h3>供給状況の目安（直近取得）</h3>
          {supplyStats.total > 0 ? (
            <ul className="for-agents-list">
              <li>対応エリア数: {supplyStats.uniqueRegions} 地域</li>
              <li>時間帯目安: {supplyStats.slot}</li>
              <li>
                完了率:{" "}
                {supplyStats.completionRate == null
                  ? "集計中"
                  : `${supplyStats.completionRate}%（completed / (completed + failed)）`}
              </li>
              <li>
                オープンタスク比率:{" "}
                {supplyStats.openRate == null ? "集計中" : `${supplyStats.openRate}%`}
              </li>
            </ul>
          ) : (
            <p className="muted">
              供給データ準備中です。まずは <a href="/for-agents/quickstart">Quickstart</a> で1件実行してください。
            </p>
          )}
        </div>
        {loading && <p className="muted">{strings.loading}</p>}
        {error && !loading && <p className="muted">{error}</p>}
        {!loading && !error && latestTasks.length === 0 && (
          <div className="card">
            <p className="muted">{strings.noTasks}</p>
            <p className="muted">
              Agent試験は <a href="/for-agents/quickstart">Quickstart</a> のサンプルリクエストで開始できます。
            </p>
            <pre className="for-agents-code"><code>{`# mock run (task creation)
curl -X POST "$BASE_URL/api/call_human" \\
  -H 'Content-Type: application/json' \\
  -d '{
    "task": "Take one entrance photo",
    "ai_account_id": "<ACCOUNT_ID>",
    "ai_api_key": "<API_KEY>",
    "origin_country": "JP",
    "task_label": "real_world_verification",
    "acceptance_criteria": "One clear entrance photo",
    "not_allowed": "No private property entry",
    "budget_usd": 10,
    "deliverable": "photo",
    "deadline_minutes": 30
  }'`}</code></pre>
            <pre className="for-agents-code"><code>{`# expected response (example)
{
  "task_id": "uuid",
  "status": "accepted"
}

# or
{
  "status": "rejected",
  "reason": "no_human_available"
}`}</code></pre>
          </div>
        )}
        <div className="task-grid">
          {latestTasks.map((task) => (
            <div key={task.id} className="task-card">
              <div className="task-title">{task.task_display || task.task}</div>
              <div className="task-meta">
                <span>${task.budget_usd}</span>
                <span>{task.location || strings.any}</span>
                <span>{getDeliverableLabel(task.deliverable)}</span>
                <span>{getTaskLabelText(task.task_label)}</span>
              </div>
              <div className="task-date">
                {strings.posted}: {new Date(task.created_at).toLocaleDateString(locale)}
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
