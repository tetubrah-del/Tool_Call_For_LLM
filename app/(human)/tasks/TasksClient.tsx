"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { normalizeLang, UI_STRINGS, type UiLang } from "@/lib/i18n";
import { calculateFeeAmount } from "@/lib/payments";
import {
  TASK_LABELS,
  TASK_LABEL_TEXT,
  type TaskLabel
} from "@/lib/task-labels";

type Task = {
  id: string;
  task: string;
  task_display?: string;
  lang?: UiLang;
  location: string | null;
  budget_usd: number;
  task_label: TaskLabel | null;
  acceptance_criteria: string | null;
  not_allowed: string | null;
  is_international_payout?: boolean;
  deliverable: "photo" | "video" | "text" | null;
  status: "open" | "accepted" | "completed" | "failed";
  failure_reason?: string | null;
  human_id: string | null;
  created_at: string;
};

export default function TasksClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialLang = useMemo(() => normalizeLang(searchParams.get("lang")), [searchParams]);
  const initialHumanId = useMemo(() => searchParams.get("human_id") || "", [searchParams]);

  const [humanId, setHumanId] = useState(initialHumanId);
  const [lang, setLang] = useState<UiLang>(initialLang);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [keyword, setKeyword] = useState("");
  const [selectedLabel, setSelectedLabel] = useState<"all" | TaskLabel>("all");
  const [selectedDeliverable, setSelectedDeliverable] = useState<"all" | "photo" | "video" | "text">("all");
  const [selectedStatus, setSelectedStatus] = useState<"all" | Task["status"]>("all");
  const [minBudget, setMinBudget] = useState("");
  const [maxBudget, setMaxBudget] = useState("");
  const [loading, setLoading] = useState(false);
  const [profileLoading, setProfileLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const strings = UI_STRINGS[lang];
  const statusLabels: Record<Task["status"], string> = {
    open: strings.statusOpen,
    accepted: strings.statusAccepted,
    completed: strings.statusCompleted,
    failed: strings.statusFailed
  };

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      const matchesLabel =
        selectedLabel === "all" ? true : task.task_label === selectedLabel;
      const matchesKeyword =
        keyword.trim().length === 0
          ? true
          : `${task.task_display || task.task}`.toLowerCase().includes(keyword.toLowerCase());
      const normalizedDeliverable = task.deliverable || "text";
      const matchesDeliverable =
        selectedDeliverable === "all" ? true : normalizedDeliverable === selectedDeliverable;
      const matchesStatus = selectedStatus === "all" ? true : task.status === selectedStatus;
      const min = Number(minBudget);
      const max = Number(maxBudget);
      const matchesMin =
        minBudget.trim() === "" ? true : Number.isFinite(min) && task.budget_usd >= min;
      const matchesMax =
        maxBudget.trim() === "" ? true : Number.isFinite(max) && task.budget_usd <= max;
      return (
        matchesLabel &&
        matchesKeyword &&
        matchesDeliverable &&
        matchesStatus &&
        matchesMin &&
        matchesMax
      );
    });
  }, [tasks, selectedLabel, keyword, selectedDeliverable, selectedStatus, minBudget, maxBudget]);

  const loadTasks = useCallback(
    async (id: string) => {
      if (!id) {
        setTasks([]);
        return;
      }
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
    let cancelled = false;
    async function resolveProfile() {
      if (humanId) {
        setProfileLoading(false);
        return;
      }

      const saved = localStorage.getItem("human_id") || "";
      if (saved) {
        setHumanId(saved);
        setProfileLoading(false);
        return;
      }

      setProfileLoading(true);
      try {
        const res = await fetch("/api/profile");
        if (!res.ok) {
          setProfileLoading(false);
          return;
        }
        const data = await res.json();
        if (!cancelled && data.profile?.id) {
          setHumanId(data.profile.id);
          localStorage.setItem("human_id", data.profile.id);
        }
      } finally {
        if (!cancelled) {
          setProfileLoading(false);
        }
      }
    }

    resolveProfile();
    return () => {
      cancelled = true;
    };
  }, [humanId]);

  useEffect(() => {
    const savedLang = localStorage.getItem("lang");
    if (!searchParams.get("lang") && savedLang) {
      const next = normalizeLang(savedLang);
      setLang(next);
      router.replace(`/tasks?lang=${next}`);
      return;
    }
    localStorage.setItem("lang", lang);
  }, [lang, router, searchParams]);

  useEffect(() => {
    if (!humanId) return;
    loadTasks(humanId);
  }, [humanId, lang, loadTasks]);

  async function acceptTask(taskId: string) {
    if (!humanId) return;
    await fetch(`/api/tasks/${taskId}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ human_id: humanId })
    });
    loadTasks(humanId);
  }

  async function skipTask(taskId: string) {
    if (!humanId) return;
    await fetch(`/api/tasks/${taskId}/skip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ human_id: humanId })
    });
    loadTasks(humanId);
  }

  return (
    <div className="tasks">
      <div className="page-head">
        <div>
          <p className="eyebrow">{strings.latestTasks}</p>
          <h1>{strings.tasks}</h1>
        </div>
      </div>

      <div className="card filter-card">
        <p className="muted">
          {strings.bestEffort} | {strings.noTimeGuarantee}
        </p>
        <label>
          {strings.searchKeyword}
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={strings.searchKeywordPlaceholder}
          />
        </label>
        <label>
          {strings.taskLabel}
          <select
            value={selectedLabel}
            onChange={(e) => setSelectedLabel(e.target.value as "all" | TaskLabel)}
          >
            <option value="all">{strings.allLabels}</option>
            {TASK_LABELS.map((label) => (
              <option key={label} value={label}>
                {TASK_LABEL_TEXT[label][lang]}
              </option>
            ))}
          </select>
        </label>
        <label>
          {strings.deliverable}
          <select
            value={selectedDeliverable}
            onChange={(e) =>
              setSelectedDeliverable(e.target.value as "all" | "photo" | "video" | "text")
            }
          >
            <option value="all">{strings.allDeliverables}</option>
            <option value="text">text</option>
            <option value="photo">photo</option>
            <option value="video">video</option>
          </select>
        </label>
        <label>
          {strings.status}
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value as "all" | Task["status"])}
          >
            <option value="all">{strings.allStatuses}</option>
            <option value="open">{strings.statusOpen}</option>
            <option value="accepted">{strings.statusAccepted}</option>
            <option value="completed">{strings.statusCompleted}</option>
            <option value="failed">{strings.statusFailed}</option>
          </select>
        </label>
        <label>
          {strings.minBudget}
          <input
            type="number"
            min="0"
            step="0.01"
            value={minBudget}
            onChange={(e) => setMinBudget(e.target.value)}
          />
        </label>
        <label>
          {strings.maxBudget}
          <input
            type="number"
            min="0"
            step="0.01"
            value={maxBudget}
            onChange={(e) => setMaxBudget(e.target.value)}
          />
        </label>
        <div className="row">
          <button onClick={() => loadTasks(humanId)} disabled={!humanId || loading || profileLoading}>
            {loading || profileLoading ? strings.loading : strings.refresh}
          </button>
          <a href={`/auth?lang=${lang}`} className="text-link">
            {strings.needAccount}
          </a>
        </div>
        {error && <p className="muted">{error}</p>}
      </div>

      {filteredTasks.length === 0 && !loading && !profileLoading && (
        <p className="muted">{strings.noTasks}</p>
      )}

      <div className="task-list">
        {filteredTasks.map((task) => {
          const isAssigned = task.human_id === humanId;
          const statusLabel = statusLabels[task.status];
          const showTranslationPending =
            lang === "ja" && task.task_display && task.task_display === task.task;
          const netPayout = Math.max(
            Number((task.budget_usd - calculateFeeAmount(task.budget_usd)).toFixed(2)),
            0
          );
          const showIntlFeeNote = Boolean(task.is_international_payout);
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
                {strings.bestEffort} | {strings.noTimeGuarantee}
              </p>
              {showIntlFeeNote && <p className="muted">{strings.intlFeeNote}</p>}
              <p className="muted">
                {strings.payout}: ${netPayout} | {strings.location}:{" "}
                {task.location || strings.any} | {strings.deliverable}:{" "}
                {task.deliverable || "text"} | {strings.taskLabel}:{" "}
                {task.task_label ? TASK_LABEL_TEXT[task.task_label][lang] : strings.any}
              </p>
              {task.acceptance_criteria && (
                <p className="muted">
                  {strings.acceptanceCriteria}: {task.acceptance_criteria}
                </p>
              )}
              {task.not_allowed && (
                <p className="muted">
                  {strings.notAllowed}: {task.not_allowed}
                </p>
              )}
              {task.status === "failed" && task.failure_reason && (
                <p className="muted">
                  {strings.failureReason}: {task.failure_reason}
                </p>
              )}
              <div className="task-actions">
                <a className="text-link" href={`/tasks/${task.id}?lang=${lang}`}>
                  {strings.details}
                </a>
                <div className="row">
                  {task.status === "open" && (
                    <button onClick={() => acceptTask(task.id)}>{strings.accept}</button>
                  )}
                  {(task.status === "accepted" || isAssigned) && (
                    <a href={`/tasks/${task.id}?lang=${lang}`}>{strings.deliver}</a>
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
