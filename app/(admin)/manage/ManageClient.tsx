"use client";

import { useEffect, useMemo, useState } from "react";

type HumanRow = {
  id: string;
  name: string;
  email: string | null;
  country: string | null;
  location: string | null;
  status: string;
  created_at: string;
  deleted_at: string | null;
  is_provisional?: boolean;
};

type AiAccountRow = {
  id: string;
  name: string;
  paypal_email: string;
  status: string;
  created_at: string;
  deleted_at: string | null;
};

type TaskRow = {
  id: string;
  task: string;
  task_display?: string;
  status: string;
  human_id: string | null;
  ai_account_id: string | null;
  created_at: string;
  deleted_at: string | null;
};

type TabKey = "humans" | "ai" | "tasks";

export default function ManageClient() {
  const [authReady, setAuthReady] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("humans");
  const [q, setQ] = useState("");
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [humans, setHumans] = useState<HumanRow[]>([]);
  const [accounts, setAccounts] = useState<AiAccountRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);

  const canLoad = authReady;

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (includeDeleted) params.set("include_deleted", "1");
    return params.toString();
  }, [q, includeDeleted]);

  async function load() {
    if (!canLoad) return;
    setLoading(true);
    setError(null);
    try {
      if (activeTab === "humans") {
        const res = await fetch(`/api/admin/humans?${queryString}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.reason || "failed");
        setHumans(Array.isArray(data.humans) ? data.humans : []);
      } else if (activeTab === "ai") {
        const res = await fetch(`/api/admin/ai-accounts?${queryString}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.reason || "failed");
        setAccounts(Array.isArray(data.accounts) ? data.accounts : []);
      } else {
        const res = await fetch(`/api/admin/tasks?${queryString}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.reason || "failed");
        setTasks(Array.isArray(data.tasks) ? data.tasks : []);
      }
    } catch (err: any) {
      setError(err.message || "failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setAuthReady(true);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, queryString, authReady]);

  async function deleteHuman(human: HumanRow) {
    if (human.is_provisional) return;
    if (!confirm(`Soft-delete human ${human.email || human.id}?`)) return;
    const res = await fetch("/api/admin/humans", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: human.id })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data?.reason || "failed");
      return;
    }
    setError(null);
    await load();
  }

  async function restoreHuman(human: HumanRow) {
    if (human.is_provisional) return;
    const res = await fetch("/api/admin/humans", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: human.id })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data?.reason || "failed");
      return;
    }
    setError(null);
    await load();
  }

  async function deleteAccount(account: AiAccountRow) {
    if (!confirm(`Soft-delete AI account ${account.id}?`)) return;
    const res = await fetch("/api/admin/ai-accounts", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: account.id })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data?.reason || "failed");
      return;
    }
    setError(null);
    await load();
  }

  async function restoreAccount(account: AiAccountRow) {
    const res = await fetch("/api/admin/ai-accounts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: account.id })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data?.reason || "failed");
      return;
    }
    setError(null);
    await load();
  }

  async function deleteTask(task: TaskRow) {
    if (!confirm(`Soft-delete task ${task.id}?`)) return;
    const res = await fetch("/api/admin/tasks", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: task.id })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data?.reason || "failed");
      return;
    }
    setError(null);
    await load();
  }

  async function restoreTask(task: TaskRow) {
    const res = await fetch("/api/admin/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: task.id })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data?.reason || "failed");
      return;
    }
    setError(null);
    await load();
  }

  return (
    <div>
      <h1>Admin: Manage</h1>

      <div className="row">
        <button type="button" className={activeTab === "humans" ? "" : "button-neutral"} onClick={() => setActiveTab("humans")}>
          Humans
        </button>
        <button type="button" className={activeTab === "ai" ? "" : "button-neutral"} onClick={() => setActiveTab("ai")}>
          AI accounts
        </button>
        <button type="button" className={activeTab === "tasks" ? "" : "button-neutral"} onClick={() => setActiveTab("tasks")}>
          Tasks
        </button>
      </div>

      <div className="card">
        <div className="row">
          <label>
            Search
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="email / name / id" />
          </label>
          <label>
            Include deleted
            <select value={includeDeleted ? "1" : "0"} onChange={(e) => setIncludeDeleted(e.target.value === "1")}>
              <option value="0">No</option>
              <option value="1">Yes</option>
            </select>
          </label>
          <button type="button" onClick={load} disabled={!canLoad || loading}>
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
        {error && <p className="muted">Error: {error}</p>}
      </div>

      {activeTab === "humans" && (
        <>
          {humans.length === 0 && <p className="muted">No humans.</p>}
          {humans.map((h) => (
            <div key={h.id} className="card">
              <p><strong>{h.name}</strong></p>
              <p className="muted">
                {h.email || "-"} | {h.country || "-"} | {h.location || "-"} | {h.status}
                {h.is_provisional ? " (oauth-only)" : ""}
              </p>
              <p className="muted">id: {h.id} | created: {h.created_at} | deleted: {h.deleted_at || "-"}</p>
              <div className="row">
                <button
                  type="button"
                  onClick={() => deleteHuman(h)}
                  disabled={Boolean(h.deleted_at) || Boolean(h.is_provisional)}
                >
                  Delete
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => restoreHuman(h)}
                  disabled={!h.deleted_at || Boolean(h.is_provisional)}
                >
                  Restore
                </button>
              </div>
            </div>
          ))}
        </>
      )}

      {activeTab === "ai" && (
        <>
          {accounts.length === 0 && <p className="muted">No AI accounts.</p>}
          {accounts.map((a) => (
            <div key={a.id} className="card">
              <p><strong>{a.name}</strong></p>
              <p className="muted">{a.paypal_email} | {a.status}</p>
              <p className="muted">id: {a.id} | created: {a.created_at} | deleted: {a.deleted_at || "-"}</p>
              <div className="row">
                <button type="button" onClick={() => deleteAccount(a)} disabled={Boolean(a.deleted_at)}>
                  Delete
                </button>
                <button type="button" className="secondary" onClick={() => restoreAccount(a)} disabled={!a.deleted_at}>
                  Restore
                </button>
              </div>
            </div>
          ))}
        </>
      )}

      {activeTab === "tasks" && (
        <>
          {tasks.length === 0 && <p className="muted">No tasks.</p>}
          {tasks.map((t) => (
            <div key={t.id} className="card">
              <p><strong>{t.task_display || t.task}</strong></p>
              <p className="muted">status: {t.status} | human: {t.human_id || "-"} | ai: {t.ai_account_id || "-"}</p>
              <p className="muted">id: {t.id} | created: {t.created_at} | deleted: {t.deleted_at || "-"}</p>
              <div className="row">
                <button type="button" onClick={() => deleteTask(t)} disabled={Boolean(t.deleted_at)}>
                  Delete
                </button>
                <button type="button" className="secondary" onClick={() => restoreTask(t)} disabled={!t.deleted_at}>
                  Restore
                </button>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
