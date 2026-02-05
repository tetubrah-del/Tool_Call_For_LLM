"use client";

import { useState } from "react";

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [minBudgetUsd, setMinBudgetUsd] = useState("15");
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [humanId, setHumanId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("saving");
    setError(null);

    try {
      const res = await fetch("/api/humans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          location,
          min_budget_usd: Number(minBudgetUsd)
        })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data?.reason || "failed");
      }

      const data = await res.json();
      setHumanId(data.id);
      setStatus("done");
    } catch (err: any) {
      setError(err.message || "failed");
      setStatus("error");
    }
  }

  return (
    <div>
      <h1>Register as Human</h1>
      <form className="card" onSubmit={onSubmit}>
        <label>
          Display Name
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Location (city/ward)
          <input value={location} onChange={(e) => setLocation(e.target.value)} />
        </label>
        <label>
          Minimum Budget (USD)
          <input
            type="number"
            step="1"
            min="1"
            value={minBudgetUsd}
            onChange={(e) => setMinBudgetUsd(e.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={status === "saving"}>
          {status === "saving" ? "Saving..." : "Register"}
        </button>
      </form>

      {status === "done" && humanId && (
        <div className="card">
          <p>Registered.</p>
          <p className="muted">Human ID: {humanId}</p>
          <p>
            <a href={`/tasks?human_id=${humanId}`}>Go to Tasks</a>
          </p>
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
