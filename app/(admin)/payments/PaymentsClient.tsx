"use client";

import { useEffect, useMemo, useState } from "react";
import { calculateFeeAmount, MIN_BUDGET_USD } from "@/lib/payments";

type PaymentStatus = "pending" | "approved" | "paid" | "failed";

type Task = {
  id: string;
  task: string;
  budget_usd: number;
  payer_paypal_email?: string | null;
  payee_paypal_email?: string | null;
  status: "open" | "accepted" | "completed" | "failed";
  human_id: string | null;
  created_at: string;
  paid_status?: PaymentStatus | null;
  approved_at?: string | null;
  paid_at?: string | null;
  fee_amount?: number | null;
  payout_amount?: number | null;
  paypal_fee_amount?: number | null;
  payout_batch_id?: string | null;
  payment_error_message?: string | null;
};

export default function PaymentsClient() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paypalFees, setPaypalFees] = useState<Record<string, string>>({});
  const [batchIds, setBatchIds] = useState<Record<string, string>>({});
  const [failureMessages, setFailureMessages] = useState<Record<string, string>>({});
  const [adminToken, setAdminToken] = useState("");
  const [tokenReady, setTokenReady] = useState(false);

  const pendingTasks = useMemo(
    () => tasks.filter((task) => task.status === "completed" && task.paid_status === "pending"),
    [tasks]
  );
  const approvedTasks = useMemo(
    () => tasks.filter((task) => task.status === "completed" && task.paid_status === "approved"),
    [tasks]
  );
  const failedTasks = useMemo(
    () => tasks.filter((task) => task.status === "completed" && task.paid_status === "failed"),
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
      const res = await fetch("/api/admin/tasks", {
        headers: { "x-admin-token": adminToken }
      });
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
    const saved = localStorage.getItem("admin_token") || "";
    if (saved) {
      setAdminToken(saved);
      setTokenReady(true);
    }
  }, []);

  async function approveTask(taskId: string) {
    const res = await fetch(`/api/tasks/${taskId}/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": adminToken },
      body: JSON.stringify({ action: "approve" })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data?.reason || "failed");
      return;
    }
    setError(null);
    await loadTasks();
  }

  async function markFailed(taskId: string) {
    const message = (failureMessages[taskId] || "").trim();
    const res = await fetch(`/api/tasks/${taskId}/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": adminToken },
      body: JSON.stringify({ action: "mark_failed", error_message: message || null })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data?.reason || "failed");
      return;
    }
    setError(null);
    await loadTasks();
  }

  async function markPaid(taskId: string, budgetUsd: number) {
    const feeInput = paypalFees[taskId] || "0";
    const paypalFeeUsd = Number(feeInput);
    if (!Number.isFinite(paypalFeeUsd) || paypalFeeUsd < 0) {
      setError("Invalid PayPal fee");
      return;
    }
    const payoutBatchId = (batchIds[taskId] || "").trim();
    const res = await fetch(`/api/tasks/${taskId}/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": adminToken },
      body: JSON.stringify({
        action: "mark_paid",
        paypal_fee_usd: paypalFeeUsd,
        payout_batch_id: payoutBatchId || null
      })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data?.reason || "failed");
      return;
    }
    setError(null);
    await loadTasks();
  }

  function onSetToken() {
    localStorage.setItem("admin_token", adminToken);
    setTokenReady(true);
    loadTasks();
  }

  return (
    <div>
      <h1>Payments</h1>
      <p className="muted">Minimum budget: ${MIN_BUDGET_USD}</p>
      {!tokenReady && (
        <div className="card">
          <label>
            Admin Token
            <input
              type="password"
              value={adminToken}
              onChange={(e) => setAdminToken(e.target.value)}
              placeholder="Set ADMIN_TOKEN"
            />
          </label>
          <button onClick={onSetToken} disabled={!adminToken}>
            Save Token
          </button>
        </div>
      )}
      <div className="row">
        <button onClick={loadTasks} disabled={loading || !tokenReady}>
          {loading ? "Loading..." : "Refresh"}
        </button>
        <a
          className="secondary"
          href={tokenReady ? `/api/payments/export?token=${encodeURIComponent(adminToken)}` : "#"}
          onClick={(event) => {
            if (!tokenReady) {
              event.preventDefault();
              setError("Admin token required");
            }
          }}
        >
          Export CSV
        </a>
      </div>
      {error && <p className="muted">Error: {error}</p>}

      <h2>Pending Review</h2>
      {pendingTasks.length === 0 && <p className="muted">No pending tasks.</p>}
      {pendingTasks.map((task) => {
        const feeAmount = calculateFeeAmount(task.budget_usd);
        const paypalFeeValue = task.paypal_fee_amount ?? 0;
        const payout = Math.max(Number((task.budget_usd - feeAmount - paypalFeeValue).toFixed(2)), 0);
        return (
          <div key={task.id} className="card">
            <h3>{task.task}</h3>
            <p className="muted">
              Budget: ${task.budget_usd} | Fee(20%): ${feeAmount.toFixed(2)} | Estimated payout: $
              {payout.toFixed(2)}
            </p>
            <p className="muted">
              Receive from: {task.payer_paypal_email || "-"} | Send to:{" "}
              {task.payee_paypal_email || "-"}
            </p>
            <div className="row">
              <button onClick={() => approveTask(task.id)}>Approve</button>
              <label>
                Failure note
                <input
                  value={failureMessages[task.id] ?? ""}
                  onChange={(e) =>
                    setFailureMessages((prev) => ({ ...prev, [task.id]: e.target.value }))
                  }
                />
              </label>
              <button className="secondary" onClick={() => markFailed(task.id)}>
                Mark Failed
              </button>
            </div>
          </div>
        );
      })}

      <h2>Approved (Ready to send)</h2>
      {approvedTasks.length === 0 && <p className="muted">No approved tasks.</p>}
      {approvedTasks.map((task) => {
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
            <p className="muted">
              Receive from: {task.payer_paypal_email || "-"} | Send to:{" "}
              {task.payee_paypal_email || "-"}
            </p>
            <div className="row">
              <label>
                Payout batch id (optional)
                <input
                  value={batchIds[task.id] ?? ""}
                  onChange={(e) => setBatchIds((prev) => ({ ...prev, [task.id]: e.target.value }))}
                />
              </label>
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

      <h2>Failed</h2>
      {failedTasks.length === 0 && <p className="muted">No failed payout tasks.</p>}
      {failedTasks.map((task) => (
        <div key={task.id} className="card">
          <h3>{task.task}</h3>
          <p className="muted">
            Error: {task.payment_error_message || "-"} | Fee: $
            {Number(task.fee_amount || calculateFeeAmount(task.budget_usd)).toFixed(2)} | Payout: $
            {Number(task.payout_amount || 0).toFixed(2)}
          </p>
          <div className="row">
            <button onClick={() => approveTask(task.id)}>Re-Approve</button>
          </div>
        </div>
      ))}

      <h2>Paid</h2>
      {paidTasks.length === 0 && <p className="muted">No paid tasks.</p>}
      {paidTasks.map((task) => (
        <div key={task.id} className="card">
          <h3>{task.task}</h3>
          <p className="muted">
            Paid at: {task.paid_at || "-"} | Fee: ${Number(task.fee_amount || 0).toFixed(2)} |
            PayPal fee: ${Number(task.paypal_fee_amount || 0).toFixed(2)} | Payout: $
            {Number(task.payout_amount || 0).toFixed(2)} | Batch: {task.payout_batch_id || "-"}
          </p>
          <p className="muted">
            Receive from: {task.payer_paypal_email || "-"} | Send to:{" "}
            {task.payee_paypal_email || "-"}
          </p>
        </div>
      ))}
    </div>
  );
}
