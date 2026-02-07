"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { normalizeLang, UI_STRINGS } from "@/lib/i18n";

export default function AIConnectClient() {
  const searchParams = useSearchParams();
  const lang = useMemo(() => normalizeLang(searchParams.get("lang")), [searchParams]);
  const strings = UI_STRINGS[lang];

  const [name, setName] = useState("");
  const [paypalEmail, setPaypalEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [accountId, setAccountId] = useState("");
  const [apiKey, setApiKey] = useState("");

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
      setAccountId(data.account_id || "");
      setApiKey(data.api_key || "");
      setStatus("done");
    } catch (err: any) {
      setError(err.message || "failed");
      setStatus("error");
    }
  }

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
          <p>{strings.aiConnectDone}</p>
          <p className="muted">{strings.aiAccountId}: {accountId}</p>
          <p className="muted">{strings.aiApiKey}: {apiKey}</p>
          <p className="muted">{strings.aiKeyWarning}</p>
        </div>
      )}

      {status === "error" && error && (
        <div className="card">
          <p>
            {strings.failed}: {error}
          </p>
        </div>
      )}
    </div>
  );
}
