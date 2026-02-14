"use client";

import { useEffect, useState } from "react";
import { UI_STRINGS, type UiLang } from "@/lib/i18n";

type ApiPanelProps = {
  lang: UiLang;
};

type UsageData = {
  status: "active" | "disabled";
  period_key: string;
  used: number;
  limit: number;
  remaining: number;
  reset_at: string;
  warning: { threshold_percent: number } | null;
};

type KeyRow = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  status: string;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
};

export default function ApiPanel({ lang }: ApiPanelProps) {
  const strings = UI_STRINGS[lang];
  const [loading, setLoading] = useState(true);
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [name, setName] = useState("main");
  const [expiryDays, setExpiryDays] = useState("90");
  const [error, setError] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<string>("");
  const [createdPrefix, setCreatedPrefix] = useState<string>("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [usageRes, keysRes] = await Promise.all([
        fetch("/api/me/api-usage"),
        fetch("/api/me/api-keys")
      ]);
      const usageData = await usageRes.json().catch(() => ({}));
      const keysData = await keysRes.json().catch(() => ({}));
      if (!usageRes.ok) throw new Error(usageData?.reason || "failed_usage");
      if (!keysRes.ok) throw new Error(keysData?.reason || "failed_keys");
      setUsage((usageData?.usage as UsageData) || null);
      setKeys(Array.isArray(keysData?.keys) ? keysData.keys : []);
    } catch (err: any) {
      setError(err?.message || "failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function createKey() {
    setCreating(true);
    setError(null);
    setCreatedKey("");
    setCreatedPrefix("");
    try {
      const res = await fetch("/api/me/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          expires_in_days: Number(expiryDays || "90")
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.reason || "failed");
      setCreatedKey(data?.key?.api_key || "");
      setCreatedPrefix(data?.key?.prefix || "");
      await load();
    } catch (err: any) {
      setError(err?.message || "failed");
    } finally {
      setCreating(false);
    }
  }

  async function rotateKey(keyId: string) {
    setBusyId(keyId);
    setError(null);
    setCreatedKey("");
    setCreatedPrefix("");
    try {
      const res = await fetch(`/api/me/api-keys/${keyId}/rotate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expires_in_days: Number(expiryDays || "90") })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.reason || "failed");
      setCreatedKey(data?.key?.api_key || "");
      setCreatedPrefix(data?.key?.prefix || "");
      await load();
    } catch (err: any) {
      setError(err?.message || "failed");
    } finally {
      setBusyId(null);
    }
  }

  async function revokeKey(keyId: string) {
    setBusyId(keyId);
    setError(null);
    try {
      const res = await fetch(`/api/me/api-keys/${keyId}`, {
        method: "DELETE"
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.reason || "failed");
      await load();
    } catch (err: any) {
      setError(err?.message || "failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="panel" style={{ gap: 16 }}>
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>{strings.tabApi}</h2>
          <button type="button" className="secondary" onClick={load} disabled={loading}>
            {loading ? strings.loading : strings.refresh}
          </button>
        </div>
        <p className="muted">{strings.apiPanelDesc}</p>
        {error && <p className="muted">{strings.failed}: {error}</p>}
        {usage && (
          <>
            <p className="muted">
              {strings.apiUsage}: {usage.used} / {usage.limit} ({strings.apiRemaining}: {usage.remaining})
            </p>
            <p className="muted">{strings.apiResetsAt}: {new Date(usage.reset_at).toLocaleString()}</p>
            {usage.warning?.threshold_percent === 5 && (
              <p style={{ color: "#ffcd86", marginBottom: 0 }}>{strings.apiWarnFivePercent}</p>
            )}
            {usage.warning?.threshold_percent === 1 && (
              <p style={{ color: "#ff8f8f", marginBottom: 0 }}>{strings.apiWarnOnePercent}</p>
            )}
          </>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>{strings.apiCreateKeyTitle}</h3>
        <div className="row">
          <label>
            {strings.apiKeyName}
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            {strings.apiKeyExpiryDays}
            <input
              type="number"
              min={1}
              max={365}
              value={expiryDays}
              onChange={(e) => setExpiryDays(e.target.value)}
            />
          </label>
        </div>
        <button type="button" onClick={createKey} disabled={creating}>
          {creating ? strings.loading : strings.apiCreateKey}
        </button>
        {createdKey && (
          <div className="card" style={{ marginTop: 12 }}>
            <p style={{ marginTop: 0 }}><strong>{strings.apiNewKeyOneTime}</strong></p>
            <p className="muted">{createdPrefix}</p>
            <code style={{ wordBreak: "break-all" }}>{createdKey}</code>
          </div>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>{strings.apiKeysTitle}</h3>
        {keys.length === 0 && <p className="muted">{strings.apiNoKeys}</p>}
        {keys.map((key) => (
          <div key={key.id} style={{ borderTop: "1px solid var(--border)", paddingTop: 10, marginTop: 10 }}>
            <p style={{ margin: 0 }}><strong>{key.name}</strong> <span className="muted">({key.prefix})</span></p>
            <p className="muted" style={{ margin: "6px 0" }}>
              scopes: {key.scopes.join(", ")}
              {" | "}expires: {key.expires_at ? new Date(key.expires_at).toLocaleDateString() : "-"}
              {" | "}last used: {key.last_used_at ? new Date(key.last_used_at).toLocaleString() : "-"}
            </p>
            <div className="row">
              <button
                type="button"
                className="secondary"
                onClick={() => rotateKey(key.id)}
                disabled={busyId === key.id}
              >
                {strings.apiRotateKey}
              </button>
              <button
                type="button"
                onClick={() => revokeKey(key.id)}
                disabled={busyId === key.id}
              >
                {strings.apiRevokeKey}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
