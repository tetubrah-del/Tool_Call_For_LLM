"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { normalizeLang, UI_STRINGS } from "@/lib/i18n";

type StripeCardElement = {
  mount: (element: HTMLElement) => void;
  destroy: () => void;
  on: (
    event: "change",
    handler: (event: { complete: boolean; error?: { message?: string } }) => void
  ) => void;
};

type StripeElements = {
  create: (type: "card", options?: Record<string, unknown>) => StripeCardElement;
};

type StripeClient = {
  elements: () => StripeElements;
  confirmCardSetup: (
    clientSecret: string,
    data: Record<string, unknown>
  ) => Promise<{
    error?: { message?: string };
    setupIntent?: { payment_method?: string | { id?: string | null } | null };
  }>;
};

declare global {
  interface Window {
    Stripe?: (publishableKey: string) => StripeClient;
  }
}

let stripeScriptPromise: Promise<void> | null = null;

function ensureStripeJsLoaded() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("browser_only"));
  }
  if (window.Stripe) {
    return Promise.resolve();
  }
  if (stripeScriptPromise) {
    return stripeScriptPromise;
  }
  stripeScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://js.stripe.com/v3/"]'
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("stripe_js_load_failed")), {
        once: true
      });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://js.stripe.com/v3/";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("stripe_js_load_failed"));
    document.head.appendChild(script);
  });
  return stripeScriptPromise;
}

function errorReason(data: any, fallback: string) {
  return String(data?.message || data?.reason || fallback);
}

export default function AIConnectClient() {
  const searchParams = useSearchParams();
  const lang = useMemo(() => normalizeLang(searchParams.get("lang")), [searchParams]);
  const strings = UI_STRINGS[lang];
  const billingStrings = lang === "ja"
    ? {
        title: "カード決済の有効化（AI発注者）",
        subtitle:
          "未払い抑止のため、発注前にStripeへカードを登録してください。カード情報はStripe側でトークン化され、当社サーバーは生カード情報を保持しません。",
        accountId: "AI Account ID",
        apiKey: "AI API Key",
        apiKeyPlaceholder: "api key を貼り付け",
        createSetupIntent: "カード入力を開始",
        creatingSetupIntent: "準備中...",
        cardTitle: "カード情報",
        cardHint: "以下のカード入力欄はStripeが提供します。",
        savePaymentMethod: "このカードを保存",
        savingPaymentMethod: "保存中...",
        saved: "カード保存が完了しました。",
        savedPm: "デフォルト決済手段",
        setupIntentId: "SetupIntent",
        missingPublishableKey:
          "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY が未設定です。運用環境変数を設定してください。",
        missingCredentials: "AI Account ID と AI API Key を入力してください。",
        cardIncomplete: "カード情報の入力が完了していません。",
        cardLoadFailed: "カード入力欄の読み込みに失敗しました。再度お試しください。"
      }
    : {
        title: "Enable card payment (AI requester)",
        subtitle:
          "To reduce non-payment risk, register a card with Stripe before creating tasks. Raw card details are tokenized by Stripe and are not stored on our server.",
        accountId: "AI Account ID",
        apiKey: "AI API Key",
        apiKeyPlaceholder: "Paste your api key",
        createSetupIntent: "Start card setup",
        creatingSetupIntent: "Preparing...",
        cardTitle: "Card details",
        cardHint: "The card input below is rendered by Stripe.",
        savePaymentMethod: "Save this card",
        savingPaymentMethod: "Saving...",
        saved: "Card has been saved successfully.",
        savedPm: "Default payment method",
        setupIntentId: "SetupIntent",
        missingPublishableKey:
          "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is missing. Please set it in environment variables.",
        missingCredentials: "Enter both AI Account ID and AI API Key.",
        cardIncomplete: "Card details are incomplete.",
        cardLoadFailed: "Failed to load Stripe card element. Please try again."
      };
  const existingAccountMessage =
    lang === "ja"
      ? "既存アカウントが見つかりました。既存APIキーは再表示できません。"
      : "Account already exists. Existing API keys cannot be re-displayed.";
  const apiKeyOneTimeMessage =
    lang === "ja"
      ? "セキュリティのため、APIキーは新規発行時のみ表示されます。"
      : "For security, API keys are shown only when newly issued.";

  const [name, setName] = useState("");
  const [paypalEmail, setPaypalEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [alreadyConnected, setAlreadyConnected] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [billingAccountId, setBillingAccountId] = useState("");
  const [billingApiKey, setBillingApiKey] = useState("");
  const [billingStatus, setBillingStatus] = useState<
    "idle" | "creating_setup" | "ready" | "saving" | "done" | "error"
  >("idle");
  const [billingError, setBillingError] = useState<string | null>(null);
  const [setupIntentId, setSetupIntentId] = useState("");
  const [setupClientSecret, setSetupClientSecret] = useState("");
  const [cardReady, setCardReady] = useState(false);
  const [cardComplete, setCardComplete] = useState(false);
  const [defaultPaymentMethodId, setDefaultPaymentMethodId] = useState("");
  const stripeRef = useRef<StripeClient | null>(null);
  const cardRef = useRef<StripeCardElement | null>(null);
  const cardHostRef = useRef<HTMLDivElement | null>(null);
  const publishableKey = (process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "").trim();

  function destroyCardElement({ resetState = true }: { resetState?: boolean } = {}) {
    if (cardRef.current) {
      cardRef.current.destroy();
      cardRef.current = null;
    }
    stripeRef.current = null;
    if (resetState) {
      setCardReady(false);
      setCardComplete(false);
    }
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("saving");
    setError(null);

    try {
      const res = await fetch("/api/ai/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, paypal_email: paypalEmail })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.reason || "failed");
      }

      const data = await res.json();
      setAlreadyConnected(data.status === "already_connected");
      setAccountId(data.account_id || "");
      setApiKey(data.api_key || "");
      setBillingAccountId(data.account_id || "");
      if (data.api_key) {
        setBillingApiKey(data.api_key);
      }
      setStatus("done");
    } catch (err: any) {
      setError(err.message || "failed");
      setStatus("error");
    }
  }

  async function createSetupIntent() {
    const normalizedAccountId = billingAccountId.trim();
    const normalizedApiKey = billingApiKey.trim();
    if (!normalizedAccountId || !normalizedApiKey) {
      setBillingStatus("error");
      setBillingError(billingStrings.missingCredentials);
      return;
    }
    if (!publishableKey) {
      setBillingStatus("error");
      setBillingError(billingStrings.missingPublishableKey);
      return;
    }

    setBillingStatus("creating_setup");
    setBillingError(null);
    setDefaultPaymentMethodId("");
    setSetupIntentId("");
    setSetupClientSecret("");
    destroyCardElement({ resetState: true });

    try {
      const res = await fetch("/api/ai/billing/setup-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ai_account_id: normalizedAccountId,
          ai_api_key: normalizedApiKey
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(errorReason(data, "setup_intent_create_failed"));
      }
      setSetupIntentId(String(data?.setup_intent_id || ""));
      setSetupClientSecret(String(data?.client_secret || ""));
      setBillingStatus("ready");
    } catch (err: any) {
      setBillingStatus("error");
      setBillingError(err?.message || "setup_intent_create_failed");
    }
  }

  async function savePaymentMethod() {
    if (!setupClientSecret || !stripeRef.current || !cardRef.current) {
      setBillingStatus("error");
      setBillingError(billingStrings.cardLoadFailed);
      return;
    }
    if (!cardComplete) {
      setBillingStatus("error");
      setBillingError(billingStrings.cardIncomplete);
      return;
    }

    setBillingStatus("saving");
    setBillingError(null);
    try {
      const confirmed = await stripeRef.current.confirmCardSetup(setupClientSecret, {
        payment_method: {
          card: cardRef.current,
          billing_details: {
            name: name.trim() || undefined,
            email: paypalEmail.trim() || undefined
          }
        }
      });
      if (confirmed.error?.message) {
        throw new Error(confirmed.error.message);
      }

      const paymentMethodRaw = confirmed.setupIntent?.payment_method;
      const paymentMethodId =
        typeof paymentMethodRaw === "string"
          ? paymentMethodRaw
          : String(paymentMethodRaw?.id || "");
      if (!paymentMethodId.startsWith("pm_")) {
        throw new Error("invalid_payment_method_id");
      }

      const res = await fetch("/api/ai/billing/payment-method", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ai_account_id: billingAccountId.trim(),
          ai_api_key: billingApiKey.trim(),
          payment_method_id: paymentMethodId
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(errorReason(data, "set_default_payment_method_failed"));
      }

      setDefaultPaymentMethodId(String(data?.default_payment_method_id || paymentMethodId));
      setSetupIntentId("");
      setSetupClientSecret("");
      destroyCardElement({ resetState: true });
      setBillingStatus("done");
    } catch (err: any) {
      setBillingStatus("ready");
      setBillingError(err?.message || "set_default_payment_method_failed");
    }
  }

  useEffect(() => {
    let cancelled = false;
    if (!setupClientSecret) {
      destroyCardElement({ resetState: true });
      return () => {
        cancelled = true;
      };
    }
    async function mountCard() {
      try {
        await ensureStripeJsLoaded();
        if (cancelled) return;
        const factory = window.Stripe;
        if (!factory || !publishableKey) {
          throw new Error(billingStrings.cardLoadFailed);
        }
        const host = cardHostRef.current;
        if (!host) throw new Error(billingStrings.cardLoadFailed);
        const stripe = factory(publishableKey);
        const elements = stripe.elements();
        const card = elements.create("card", { hidePostalCode: true });
        card.on("change", (event) => {
          if (cancelled) return;
          setCardComplete(Boolean(event.complete));
          if (event.error?.message) {
            setBillingError(event.error.message);
            return;
          }
          setBillingError((prev) => (prev === billingStrings.cardIncomplete ? null : prev));
        });
        card.mount(host);
        stripeRef.current = stripe;
        cardRef.current = card;
        setCardReady(true);
      } catch (err: any) {
        if (cancelled) return;
        setCardReady(false);
        setBillingStatus("error");
        setBillingError(err?.message || billingStrings.cardLoadFailed);
      }
    }
    mountCard();
    return () => {
      cancelled = true;
      destroyCardElement({ resetState: false });
    };
  }, [setupClientSecret, publishableKey, billingStrings.cardLoadFailed, billingStrings.cardIncomplete]);

  return (
    <div>
      <h1>{strings.aiConnectTitle}</h1>
      <p className="muted">{strings.aiConnectSubtitle}</p>

      <form className="card" onSubmit={onSubmit}>
        <label>
          {strings.aiName}
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          {strings.paypalEmail}
          <input
            type="email"
            value={paypalEmail}
            onChange={(e) => setPaypalEmail(e.target.value)}
            placeholder={strings.paypalEmailPlaceholder}
            required
          />
        </label>
        <button type="submit" disabled={status === "saving"}>
          {status === "saving" ? strings.loading : strings.connectPaypal}
        </button>
      </form>

      {status === "done" && (
        <div className="card">
          <p>{alreadyConnected ? existingAccountMessage : strings.aiConnectDone}</p>
          <p className="muted">{strings.aiAccountId}: {accountId}</p>
          {apiKey ? (
            <>
              <p className="muted">{strings.aiApiKey}: {apiKey}</p>
              <p className="muted">{strings.aiKeyWarning}</p>
            </>
          ) : (
            <p className="muted">{apiKeyOneTimeMessage}</p>
          )}
        </div>
      )}

      {status === "error" && error && (
        <div className="card">
          <p>
            {strings.failed}: {error}
          </p>
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <h2 style={{ marginTop: 0, marginBottom: 8 }}>{billingStrings.title}</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {billingStrings.subtitle}
        </p>
        <label>
          {billingStrings.accountId}
          <input
            value={billingAccountId}
            onChange={(event) => setBillingAccountId(event.target.value)}
            placeholder="ai_xxx"
            required
          />
        </label>
        <label>
          {billingStrings.apiKey}
          <input
            type="password"
            value={billingApiKey}
            onChange={(event) => setBillingApiKey(event.target.value)}
            placeholder={billingStrings.apiKeyPlaceholder}
            required
          />
        </label>
        <button
          type="button"
          onClick={createSetupIntent}
          disabled={billingStatus === "creating_setup" || billingStatus === "saving"}
          style={{ marginTop: 12 }}
        >
          {billingStatus === "creating_setup"
            ? billingStrings.creatingSetupIntent
            : billingStrings.createSetupIntent}
        </button>

        {setupIntentId && (
          <p className="muted" style={{ marginTop: 10 }}>
            {billingStrings.setupIntentId}: {setupIntentId}
          </p>
        )}

        {setupClientSecret && (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              border: "1px solid rgba(148, 163, 184, 0.35)",
              borderRadius: 10
            }}
          >
            <p style={{ marginTop: 0, marginBottom: 8 }}>{billingStrings.cardTitle}</p>
            <p className="muted" style={{ marginTop: 0, marginBottom: 12 }}>
              {billingStrings.cardHint}
            </p>
            <div
              ref={cardHostRef}
              style={{
                padding: "10px 12px",
                border: "1px solid rgba(148, 163, 184, 0.45)",
                borderRadius: 8,
                background: "rgba(15, 23, 42, 0.04)"
              }}
            />
            <button
              type="button"
              onClick={savePaymentMethod}
              disabled={
                billingStatus === "saving" || !cardReady || !cardComplete
              }
              style={{ marginTop: 12 }}
            >
              {billingStatus === "saving"
                ? billingStrings.savingPaymentMethod
                : billingStrings.savePaymentMethod}
            </button>
          </div>
        )}

        {billingStatus === "done" && (
          <div style={{ marginTop: 12 }}>
            <p style={{ margin: 0 }}>{billingStrings.saved}</p>
            {defaultPaymentMethodId && (
              <p className="muted" style={{ marginTop: 6, marginBottom: 0 }}>
                {billingStrings.savedPm}: {defaultPaymentMethodId}
              </p>
            )}
          </div>
        )}

        {billingError && (
          <p className="muted" style={{ marginTop: 12 }}>
            {strings.failed}: {billingError}
          </p>
        )}
      </div>
    </div>
  );
}
