"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { normalizeLang, UI_STRINGS, type UiLang } from "@/lib/i18n";

export default function RegisterClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialLang = useMemo(() => normalizeLang(searchParams.get("lang")), [searchParams]);
  const [lang, setLang] = useState<UiLang>(initialLang);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [minBudgetUsd, setMinBudgetUsd] = useState("15");
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [humanId, setHumanId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const strings = UI_STRINGS[lang];

  useEffect(() => {
    const savedLang = localStorage.getItem("lang");
    if (!searchParams.get("lang") && savedLang) {
      const next = normalizeLang(savedLang);
      setLang(next);
      const params = new URLSearchParams(searchParams.toString());
      params.set("lang", next);
      router.replace(`/register?${params.toString()}`);
      return;
    }
    localStorage.setItem("lang", lang);
  }, [lang, router, searchParams]);

  function onLangChange(next: UiLang) {
    setLang(next);
    const params = new URLSearchParams(searchParams.toString());
    params.set("lang", next);
    router.replace(`/register?${params.toString()}`);
  }

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
      <div className="row">
        <h1>{strings.registerTitle}</h1>
        <select value={lang} onChange={(e) => onLangChange(normalizeLang(e.target.value))}>
          <option value="en">EN</option>
          <option value="ja">JA</option>
        </select>
      </div>
      <form className="card" onSubmit={onSubmit}>
        <label>
          {strings.displayName}
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          {strings.locationHint}
          <input value={location} onChange={(e) => setLocation(e.target.value)} />
        </label>
        <label>
          {strings.minBudget}
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
          {status === "saving" ? strings.saving : strings.register}
        </button>
      </form>

      {status === "done" && humanId && (
        <div className="card">
          <p>{strings.registered}</p>
          <p className="muted">
            {strings.humanId}: {humanId}
          </p>
          <p>
            <a href={`/tasks?human_id=${humanId}&lang=${lang}`}>{strings.goToTasks}</a>
          </p>
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
