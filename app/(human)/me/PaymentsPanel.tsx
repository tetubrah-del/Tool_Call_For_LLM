"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { UiLang } from "@/lib/i18n";
import { UI_STRINGS } from "@/lib/i18n";

type PaymentStatus = "pending" | "approved" | "paid" | "failed";

type StripeConnectStatusResponse =
  | {
      status: "ok";
      human_id: string;
      stripe_account_id: string | null;
      connect_ready: boolean;
      reason: string | null;
      account?: {
        id: string;
        country: string | null;
        charges_enabled: boolean;
        payouts_enabled: boolean;
      };
    }
  | { status: "unauthorized" }
  | { status: "error"; reason: string; message?: string };

type StripeConnectOnboardingStartResponse =
  | {
      status: "ok";
      human_id: string;
      stripe_account_id: string;
      onboarding_url: string;
    }
  | { status: "unauthorized" }
  | { status: "error"; reason: string; message?: string };

type PaymentItem = {
  task_id: string;
  task: string;
  gross_amount: number;
  platform_fee: number;
  paypal_fee: number;
  net_amount: number;
  status: PaymentStatus;
  approved_at: string | null;
  paid_at: string | null;
  payout_batch_id: string | null;
  error_message: string | null;
  updated_at: string;
};

type PaymentResponse = {
  summary: {
    pending_total: number;
    approved_total: number;
    paid_total: number;
  };
  payments: PaymentItem[];
};

function formatUsd(amount: number) {
  return `$${Number(amount || 0).toFixed(2)}`;
}

function formatDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export default function PaymentsPanel({ lang }: { lang: UiLang }) {
  const searchParams = useSearchParams();
  const strings = UI_STRINGS[lang];
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stripeLoading, setStripeLoading] = useState(true);
  const [stripeError, setStripeError] = useState<string | null>(null);
  const [stripeAccountId, setStripeAccountId] = useState<string | null>(null);
  const [stripeReady, setStripeReady] = useState<boolean>(false);
  const [stripeReason, setStripeReason] = useState<string | null>(null);
  const [stripeStarting, setStripeStarting] = useState(false);
  const [summary, setSummary] = useState({
    pending_total: 0,
    approved_total: 0,
    paid_total: 0
  });
  const [payments, setPayments] = useState<PaymentItem[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/me/payments", { cache: "no-store" });
        if (!res.ok) {
          throw new Error("load_failed");
        }
        const data = (await res.json()) as PaymentResponse;
        if (!alive) return;
        setSummary(data.summary || { pending_total: 0, approved_total: 0, paid_total: 0 });
        setPayments(data.payments || []);
      } catch {
        if (!alive) return;
        setError(strings.paymentsError);
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, [strings.paymentsError]);

  useEffect(() => {
    let alive = true;
    async function loadStripe() {
      setStripeLoading(true);
      setStripeError(null);
      try {
        const res = await fetch("/api/connect/status", { cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as StripeConnectStatusResponse;
        if (!alive) return;
        if (!res.ok || (data as any)?.status === "error") {
          throw new Error((data as any)?.message || (data as any)?.reason || "stripe_status_failed");
        }
        if ("status" in (data as any) && (data as any).status === "unauthorized") {
          // MyPage itself requires auth; treat this as error to avoid hiding issues.
          throw new Error("unauthorized");
        }
        if ("status" in (data as any) && (data as any).status === "ok") {
          const ok = data as Extract<StripeConnectStatusResponse, { status: "ok" }>;
          setStripeAccountId(ok.stripe_account_id || null);
          setStripeReady(Boolean(ok.connect_ready));
          setStripeReason(ok.reason || null);
        }
      } catch {
        if (!alive) return;
        setStripeError(strings.stripeConnectStatusError);
      } finally {
        if (alive) setStripeLoading(false);
      }
    }
    loadStripe();
    return () => {
      alive = false;
    };
  }, [strings.stripeConnectStatusError]);

  async function startStripeOnboarding(event?: React.MouseEvent<HTMLButtonElement>) {
    event?.preventDefault();
    event?.stopPropagation();
    if (stripeStarting) return;
    setStripeStarting(true);
    setStripeError(null);
    const url = `/api/connect/onboarding/redirect?lang=${lang}`;
    window.location.assign(url);
  }

  useEffect(() => {
    const connectError = (searchParams.get("connect_error") || "").trim();
    if (!connectError) return;
    setStripeError(connectError);
    setStripeStarting(false);
  }, [searchParams]);

  const selected = useMemo(
    () => payments.find((item) => item.task_id === selectedTaskId) || null,
    [payments, selectedTaskId]
  );

  function statusLabel(status: PaymentStatus) {
    if (status === "approved") return strings.paymentsStatusApproved;
    if (status === "paid") return strings.paymentsStatusPaid;
    if (status === "failed") return strings.paymentsStatusFailed;
    return strings.paymentsStatusPending;
  }

  return (
    <div className="payments-panel">
      <div className="card payments-list-card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h3 style={{ margin: 0 }}>{strings.stripeConnectTitle}</h3>
            <p className="muted" style={{ marginTop: 6, marginBottom: 0 }}>
              {strings.stripeConnectDesc}
            </p>
          </div>
          <div className="row" style={{ gap: 10 }}>
            {stripeAccountId ? (
              <span className={`payment-chip ${stripeReady ? "payment-chip-paid" : "payment-chip-approved"}`}>
                {stripeReady ? strings.stripeConnectStatusReady : strings.stripeConnectStatusNotReady}
              </span>
            ) : (
              <span className="payment-chip payment-chip-pending">
                {strings.stripeConnectStatusNotConnected}
              </span>
            )}
            <button
              type="button"
              className="secondary"
              onClick={startStripeOnboarding}
              disabled={stripeStarting}
            >
              {stripeStarting
                ? strings.stripeConnectStarting
                : stripeAccountId
                  ? strings.stripeConnectCtaContinue
                  : strings.stripeConnectCta}
            </button>
          </div>
        </div>
        {stripeLoading && <p className="muted" style={{ marginTop: 10 }}>{strings.stripeConnectStatusLoading}</p>}
        {stripeStarting && <p className="muted" style={{ marginTop: 10 }}>{strings.stripeConnectStarting}</p>}
        {stripeError && <p className="muted" style={{ marginTop: 10 }}>{stripeError}</p>}
        {!stripeLoading && !stripeError && stripeAccountId && (
          <p className="muted" style={{ marginTop: 10 }}>
            {strings.stripeConnectStatusConnected}: {stripeAccountId}
            {stripeReason ? ` | ${stripeReason}` : ""}
          </p>
        )}
      </div>

      <div className="payments-summary-grid">
        <div className="stat-card">
          <div className="stat-value">{formatUsd(summary.pending_total)}</div>
          <div className="stat-label">{strings.paymentsSummaryPending}</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{formatUsd(summary.approved_total)}</div>
          <div className="stat-label">{strings.paymentsSummaryApproved}</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{formatUsd(summary.paid_total)}</div>
          <div className="stat-label">{strings.paymentsSummaryPaid}</div>
        </div>
      </div>

      <div className="card payments-list-card">
        {loading && <p className="muted">{strings.loading}</p>}
        {error && <p className="muted">{error}</p>}
        {!loading && !error && payments.length === 0 && (
          <p className="muted">{strings.paymentsNoRows}</p>
        )}
        {!loading && !error && payments.length > 0 && (
          <div className="payments-table-wrap">
            <table className="payments-table">
              <thead>
                <tr>
                  <th>{strings.paymentsTableTask}</th>
                  <th>{strings.paymentsTableGross}</th>
                  <th>{strings.paymentsTableFee}</th>
                  <th>{strings.paymentsTablePaypalFee}</th>
                  <th>{strings.paymentsTableNet}</th>
                  <th>{strings.paymentsTableStatus}</th>
                  <th>{strings.paymentsTableUpdated}</th>
                  <th>{strings.paymentsTableDetails}</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((item) => (
                  <tr key={item.task_id}>
                    <td>{item.task}</td>
                    <td>{formatUsd(item.gross_amount)}</td>
                    <td>{formatUsd(item.platform_fee)}</td>
                    <td>{formatUsd(item.paypal_fee)}</td>
                    <td className="payments-net">{formatUsd(item.net_amount)}</td>
                    <td>
                      <span className={`payment-chip payment-chip-${item.status}`}>
                        {statusLabel(item.status)}
                      </span>
                    </td>
                    <td>{formatDate(item.updated_at)}</td>
                    <td>
                      <button
                        type="button"
                        className="secondary payments-detail-button"
                        onClick={() => setSelectedTaskId(item.task_id)}
                      >
                        {strings.paymentsTableDetails}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <div className="card payments-detail-card">
          <div className="row payments-detail-head">
            <h3>{strings.paymentsDetailTitle}</h3>
            <button
              type="button"
              className="secondary payments-detail-close"
              onClick={() => setSelectedTaskId(null)}
            >
              {strings.paymentsDetailClose}
            </button>
          </div>
          <p className="muted">{selected.task}</p>
          <p className="muted">
            {strings.paymentsTableGross}: {formatUsd(selected.gross_amount)} |{" "}
            {strings.paymentsTableFee}: {formatUsd(selected.platform_fee)} |{" "}
            {strings.paymentsTablePaypalFee}: {formatUsd(selected.paypal_fee)} |{" "}
            {strings.paymentsTableNet}: {formatUsd(selected.net_amount)}
          </p>
          <p className="muted">
            {strings.paymentsTableStatus}: {statusLabel(selected.status)} |{" "}
            {strings.paymentsTableUpdated}: {formatDate(selected.updated_at)}
          </p>
          {selected.payout_batch_id && (
            <p className="muted">
              {strings.paymentsDetailBatchId}: {selected.payout_batch_id}
            </p>
          )}
          {selected.error_message && (
            <p className="muted">
              {strings.paymentsDetailError}: {selected.error_message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
