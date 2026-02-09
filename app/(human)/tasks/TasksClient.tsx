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
  origin_country: string | null;
  task_label: TaskLabel | null;
  acceptance_criteria: string | null;
  not_allowed: string | null;
  is_international_payout?: boolean;
  deliverable: "photo" | "video" | "text" | null;
  deadline_at?: string | null;
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
  const [selectedOriginCountry, setSelectedOriginCountry] = useState<"all" | string>("all");
  const [selectedDeliverable, setSelectedDeliverable] = useState<"all" | "photo" | "video" | "text">("all");
  const [selectedStatus, setSelectedStatus] = useState<"all" | Task["status"]>("all");
  const [sortKey, setSortKey] = useState<"new" | "popular">("new");
  const [minBudget, setMinBudget] = useState("");
  const [maxBudget, setMaxBudget] = useState("");
  const [loading, setLoading] = useState(false);
  const [profileLoading, setProfileLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const strings = UI_STRINGS[lang];
  const showBestEffort = Boolean(strings.bestEffort && strings.noTimeGuarantee);
  const statusLabels: Record<Task["status"], string> = {
    open: strings.statusOpen,
    accepted: strings.statusAccepted,
    completed: strings.statusCompleted,
    failed: strings.statusFailed
  };

  const originCountryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) {
      if (t.origin_country) set.add(t.origin_country);
    }
    return Array.from(set).sort();
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      const matchesLabel =
        selectedLabel === "all" ? true : task.task_label === selectedLabel;
      const matchesKeyword =
        keyword.trim().length === 0
          ? true
          : `${task.task_display || task.task}`.toLowerCase().includes(keyword.toLowerCase());
      const matchesOrigin =
        selectedOriginCountry === "all"
          ? true
          : task.origin_country === selectedOriginCountry;
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
        matchesOrigin &&
        matchesDeliverable &&
        matchesStatus &&
        matchesMin &&
        matchesMax
      );
    });
  }, [tasks, selectedLabel, keyword, selectedOriginCountry, selectedDeliverable, selectedStatus, minBudget, maxBudget]);

  const sortedTasks = useMemo(() => {
    const next = [...filteredTasks];
    if (sortKey === "popular") {
      // Popularity signal is not available in v0; use budget as a proxy.
      next.sort((a, b) => {
        if (b.budget_usd !== a.budget_usd) return b.budget_usd - a.budget_usd;
        return Date.parse(b.created_at) - Date.parse(a.created_at);
      });
      return next;
    }
    next.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    return next;
  }, [filteredTasks, sortKey]);

  const loadTasks = useCallback(
    async (id?: string) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set("lang", lang);
        if (id) params.set("human_id", id);
        const res = await fetch(`/api/tasks?${params.toString()}`);
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
    if (profileLoading) return;
    loadTasks(humanId || undefined);
  }, [humanId, lang, loadTasks, profileLoading]);

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
        {showBestEffort && (
          <p className="muted">
            {strings.bestEffort} | {strings.noTimeGuarantee}
          </p>
        )}
        <label className="filter-keyword">
          {strings.searchKeyword}
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={strings.searchKeywordPlaceholder}
          />
        </label>
        <label className="filter-label">
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
        <label className="filter-country">
          {strings.originCountry}
          <select
            value={selectedOriginCountry}
            onChange={(e) => setSelectedOriginCountry(e.target.value as "all" | string)}
          >
            <option value="all">{strings.allCountries}</option>
            {originCountryOptions.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-deliverable">
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
        <label className="filter-status">
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
        <label className="filter-minbudget">
          {strings.minBudget}
          <input
            type="number"
            min="0"
            step="0.01"
            value={minBudget}
            onChange={(e) => setMinBudget(e.target.value)}
          />
        </label>
        <label className="filter-maxbudget">
          {strings.maxBudget}
          <input
            type="number"
            min="0"
            step="0.01"
            value={maxBudget}
            onChange={(e) => setMaxBudget(e.target.value)}
          />
        </label>
        <div className="row filter-actions">
          <button onClick={() => loadTasks(humanId || undefined)} disabled={loading || profileLoading}>
            {loading || profileLoading ? strings.loading : strings.refresh}
          </button>
          <a href={`/auth?lang=${lang}`} className="text-link">
            {strings.needAccount}
          </a>
        </div>
        {error && <p className="muted">{error}</p>}
      </div>

      <div className="task-sort">
        <button
          type="button"
          className={sortKey === "new" ? "sort-pill active" : "sort-pill"}
          onClick={() => setSortKey("new")}
        >
          {strings.sortNew}
        </button>
        <button
          type="button"
          className={sortKey === "popular" ? "sort-pill active" : "sort-pill"}
          onClick={() => setSortKey("popular")}
        >
          {strings.sortPopular}
        </button>
      </div>

      {filteredTasks.length === 0 && !loading && !profileLoading && (
        <p className="muted">{strings.noTasks}</p>
      )}

      <div className="task-list">
        {sortedTasks.map((task) => {
          const isAssigned = task.human_id === humanId;
          const statusLabel = statusLabels[task.status];
          const showTranslationPending =
            lang === "ja" && task.task_display && task.task_display === task.task;
          const netPayout = Math.max(
            Number((task.budget_usd - calculateFeeAmount(task.budget_usd)).toFixed(2)),
            0
          );
          const showIntlFeeNote = Boolean(task.is_international_payout);
          const deadlineChip =
            task.deadline_at && Number.isFinite(Date.parse(task.deadline_at))
              ? new Date(task.deadline_at).toLocaleDateString(lang, {
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit"
                })
              : null;
          const primaryChip =
            task.task_label ? TASK_LABEL_TEXT[task.task_label][lang] : strings.any;
          return (
            <div key={task.id} className="task-item">
              <div className="task-main">
                <div className="task-topline">
                  <div className="task-chips">
                    <span className="task-chip">{primaryChip}</span>
                    {deadlineChip && (
                      <span className="task-chip">
                        {strings.deadline} {deadlineChip}
                      </span>
                    )}
                    <span className="task-chip">{task.deliverable || "text"}</span>
                    {task.origin_country && (
                      <span className="task-chip">{task.origin_country}</span>
                    )}
                  </div>
                  <span className="status-pill">{statusLabel}</span>
                </div>

                <h3 className="task-title-lg">{task.task_display || task.task}</h3>

                {(task.acceptance_criteria || showTranslationPending) && (
                  <p className="task-desc">
                    {showTranslationPending
                      ? strings.translationPending
                      : task.acceptance_criteria || ""}
                  </p>
                )}

                <div className="task-meta-row">
                  <span className="task-meta-item">
                    {strings.location}: {task.location || strings.any}
                  </span>
                  {showBestEffort && (
                    <span className="task-meta-item">
                      {strings.bestEffort}
                    </span>
                  )}
                  {showIntlFeeNote && (
                    <span className="task-meta-item">{strings.intlFeeNote}</span>
                  )}
                  {task.status === "failed" && task.failure_reason && (
                    <span className="task-meta-item">
                      {strings.failureReason}: {task.failure_reason}
                    </span>
                  )}
                </div>

                <div className="task-actions-compact">
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

              <aside className="task-price">
                <div className="task-price-amount">
                  ${netPayout}
                </div>
                <div className="task-price-sub">{strings.payout}</div>
                <div className="task-price-raw muted">
                  ${task.budget_usd} gross
                </div>
              </aside>
            </div>
          );
        })}
      </div>
    </div>
  );
}
