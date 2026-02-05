"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type Task = {
  id: string;
  task: string;
  location: string | null;
  budget_usd: number;
  deliverable: "photo" | "video" | "text" | null;
  status: "open" | "accepted" | "completed" | "failed";
  human_id: string | null;
  created_at: string;
};

export default function TasksPage() {
  const searchParams = useSearchParams();
  const initialHumanId = useMemo(() => searchParams.get("human_id") || "", [searchParams]);

  const [humanId, setHumanId] = useState(initialHumanId);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialHumanId) {
      localStorage.setItem("human_id", initialHumanId);
    }
  }, [initialHumanId]);

  useEffect(() => {
    if (!humanId) {
      const saved = localStorage.getItem("human_id");
      if (saved) {
        setHumanId(saved);
      }
      return;
    }

    loadTasks(humanId);
  }, [humanId]);

  async function loadTasks(id: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks?human_id=${id}`);
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
  }

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

  return (
    <div>
      <h1>Tasks</h1>

      <div className="card">
        <label>
          Human ID
          <input
            value={humanId}
            onChange={(e) => setHumanId(e.target.value)}
            placeholder="Paste your human id"
          />
        </label>
        <div className="row">
          <button onClick={() => loadTasks(humanId)} disabled={!humanId || loading}>
            {loading ? "Loading..." : "Refresh"}
          </button>
          <a href="/register" className="muted">
            Need an account?
          </a>
        </div>
        {error && <p className="muted">{error}</p>}
      </div>

      {tasks.length === 0 && !loading && (
        <p className="muted">No tasks available.</p>
      )}

      {tasks.map((task) => {
        const isAssigned = task.human_id === humanId;
        return (
          <div key={task.id} className="card">
            <h3>{task.task}</h3>
            <p className="muted">
              Status: {task.status} | Budget: ${task.budget_usd} | Location:{" "}
              {task.location || "Any"} | Deliverable: {task.deliverable || "text"}
            </p>
            <div className="row">
              {task.status === "open" && (
                <button onClick={() => acceptTask(task.id)}>Accept</button>
              )}
              {(task.status === "accepted" || isAssigned) && (
                <a href={`/tasks/${task.id}?human_id=${humanId}`}>
                  Deliver
                </a>
              )}
              {(task.status === "open" || isAssigned) && (
                <button className="secondary" onClick={() => skipTask(task.id)}>
                  Skip
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
