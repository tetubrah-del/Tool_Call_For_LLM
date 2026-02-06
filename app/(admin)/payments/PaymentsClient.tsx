"use client";

import { useEffect, useMemo, useState } from "react";
import { calculateFeeAmount, MIN_BUDGET_USD } from "@/lib/payments";

type Task = {
  id: string;
  task: string;
  budget_usd: number;
  status: "open" | "accepted" | "completed" | "failed";
  human_id: string | null;
  created_at: string;
  paid_status?: "unpaid" | "paid" | null;
  paid_at?: string | null;
  fee_amount?: number | null;
  payout_amount?: number | null;
  paypal_fee_amount?: number | null;
};

export default function PaymentsClient() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paypalFees, setPaypalFees] = useState<Record<string, string>>({});

  const unpaidTasks = useMemo(
    () => tasks.filter((task) => task.status === "completed" && task.paid_status !== "paid"),
    [tasks]
  );
  const paidTasks = useMemo(
    () => tasks.filter((task) => task.paid_status === "paid"),
    [tasks]
  );

  async function loadTasks() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/tasks");
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

  useEffect(() => {
    loadTasks();
  }, []);

  async function markPaid(taskId: string, budgetUsd: number) {
    const feeInput = paypalFees[taskId] || "0";
    const paypalFeeUsd = Number(feeInput);
    if (!Number.isFinite(paypalFeeUsd) || paypalFeeUsd < 0) {
      setError("Invalid PayPal fee");
      return;
    }
    const res = await fetch(`/api/tasks/${taskId}/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paypal_fee_usd: paypalFeeUsd })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data?.reason || "failed");
      return;
    }
    setError(null);
    await loadTasks();
  }

  return (
    <div>
      <h1>Payments</h1>
      <p className="muted">Minimum budget: ${MIN_BUDGET_USD}</p>
      <div className="row">
        <button onClick={loadTasks} disabled={loading}>
          {loading ? "Loading..." : "Refresh"}
        </button>
        <a className="secondary" href="/api/payments/export">
          Export CSV
        </a>
      </div>
      {error && <p className="muted">Error: {error}</p>}

      <h2>Unpaid (Completed)</h2>
      {unpaidTasks.length === 0 && <p className="muted">No unpaid tasks.</p>}
      {unpaidTasks.map((task) => {
        const feeAmount = calculateFeeAmount(task.budget_usd);
        const paypalFeeValue = paypalFees[task.id] ?? "0";
        const payout = Math.max(
          Number((task.budget_usd - feeAmount - Number(paypalFeeValue || 0)).toFixed(2)),
          0
        );
        return (
          <div key={task.id} className="card">
            <h3>{task.task}</h3>
            <p className="muted">
              Budget: ${task.budget_usd} | Fee(20%): ${feeAmount.toFixed(2)} | PayPal
              fee: ${Number(paypalFeeValue || 0).toFixed(2)} | Payout: ${payout.toFixed(2)}
            </p>
            <div className="row">
              <label>
                PayPal fee (USD)
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={paypalFeeValue}
                  onChange={(e) =>
                    setPaypalFees((prev) => ({ ...prev, [task.id]: e.target.value }))
                  }
                />
              </label>
              <button onClick={() => markPaid(task.id, task.budget_usd)}>Mark Paid</button>
            </div>
          </div>
        );
      })}

      <h2>Paid</h2>
      {paidTasks.length === 0 && <p className="muted">No paid tasks.</p>}
      {paidTasks.map((task) => (
        <div key={task.id} className="card">
          <h3>{task.task}</h3>
          <p className="muted">
            Paid at: {task.paid_at || "-"} | Fee: ${Number(task.fee_amount || 0).toFixed(2)} |
            PayPal fee: ${Number(task.paypal_fee_amount || 0).toFixed(2)} | Payout: $
            {Number(task.payout_amount || 0).toFixed(2)}
          </p>
        </div>
      ))}
    </div>
  );
}
