"use client";

import { useEffect, useState } from "react";
import { UI_STRINGS, type UiLang } from "@/lib/i18n";

type NotificationsPanelProps = {
  lang: UiLang;
};

type NotificationSettings = {
  human_id: string;
  email_enabled: boolean;
  notify_task_accepted: boolean;
  notify_ai_message: boolean;
};

export default function NotificationsPanel({ lang }: NotificationsPanelProps) {
  const strings = UI_STRINGS[lang];
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<NotificationSettings | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/me/notifications");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.reason || data?.status || "failed");
      setSettings(data?.settings || null);
    } catch (err: any) {
      setError(err?.message || "failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save(patch: Partial<NotificationSettings>) {
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/me/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.reason || data?.status || "failed");
      setSettings(data?.settings || settings);
    } catch (err: any) {
      setError(err?.message || "failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="panel" style={{ gap: 16 }}>
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>{strings.tabNotifications}</h2>
          <button type="button" className="secondary" onClick={load} disabled={loading || saving}>
            {loading ? strings.loading : strings.refresh}
          </button>
        </div>
        <p className="muted">{strings.notificationsDesc}</p>
        {error && (
          <p className="muted">
            {strings.failed}: {error}
          </p>
        )}
        {settings && (
          <div style={{ display: "grid", gap: 10 }}>
            <label className="row" style={{ justifyContent: "space-between" }}>
              <span>{strings.notificationsEmailEnabled}</span>
              <input
                type="checkbox"
                checked={settings.email_enabled}
                disabled={saving}
                onChange={(e) => save({ email_enabled: e.target.checked })}
              />
            </label>
            <label className="row" style={{ justifyContent: "space-between" }}>
              <span>{strings.notificationsTaskAccepted}</span>
              <input
                type="checkbox"
                checked={settings.notify_task_accepted}
                disabled={saving || !settings.email_enabled}
                onChange={(e) => save({ notify_task_accepted: e.target.checked })}
              />
            </label>
            <label className="row" style={{ justifyContent: "space-between" }}>
              <span>{strings.notificationsAiMessage}</span>
              <input
                type="checkbox"
                checked={settings.notify_ai_message}
                disabled={saving || !settings.email_enabled}
                onChange={(e) => save({ notify_ai_message: e.target.checked })}
              />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
