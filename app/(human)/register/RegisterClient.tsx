"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { normalizeLang, UI_STRINGS, type UiLang } from "@/lib/i18n";

type RegisterClientProps = {
  title?: string | null;
  formId?: string;
  showSubmit?: boolean;
};

export default function RegisterClient({
  title,
  formId = "profile-form",
  showSubmit = true
}: RegisterClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialLang = useMemo(() => normalizeLang(searchParams.get("lang")), [searchParams]);
  const [lang, setLang] = useState<UiLang>(initialLang);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [country, setCountry] = useState("JP");
  const [paypalEmail, setPaypalEmail] = useState("");
  const [minBudgetUsd, setMinBudgetUsd] = useState("15");
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [humanId, setHumanId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const { status: sessionStatus } = useSession();
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

  useEffect(() => {
    let cancelled = false;
    async function loadProfile() {
      if (sessionStatus === "loading") return;
      if (sessionStatus !== "authenticated") {
        setLoadingProfile(false);
        return;
      }

      setLoadingProfile(true);
      setError(null);
      try {
        const res = await fetch("/api/profile");
        if (res.status === 401) {
          return;
        }
        if (!res.ok) {
          throw new Error("failed");
        }
        const data = await res.json();
        if (!cancelled && data.profile) {
          setName(data.profile.name || "");
          setLocation(data.profile.location || "");
          setCountry(data.profile.country || "JP");
          setPaypalEmail(data.profile.paypal_email || "");
          setMinBudgetUsd(String(data.profile.min_budget_usd ?? 15));
          setHumanId(data.profile.id || null);
          if (data.profile.id) {
            localStorage.setItem("human_id", data.profile.id);
          }
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || "failed");
        }
      } finally {
        if (!cancelled) {
          setLoadingProfile(false);
        }
      }
    }

    loadProfile();
    return () => {
      cancelled = true;
    };
  }, [sessionStatus]);

  function onLangChange(next: UiLang) {
    setLang(next);
    const params = new URLSearchParams(searchParams.toString());
    params.set("lang", next);
    router.replace(`${pathname}?${params.toString()}`);
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("saving");
    setError(null);

    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          location,
          country,
          paypal_email: paypalEmail,
          min_budget_usd: Number(minBudgetUsd)
        })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data?.reason || "failed");
      }

      const data = await res.json();
      setHumanId(data.id);
      localStorage.setItem("human_id", data.id);
      setStatus("done");
    } catch (err: any) {
      setError(err.message || "failed");
      setStatus("error");
    }
  }

  return (
    <div>
      <div className="row">
        <h1>{title || strings.registerTitle}</h1>
        <select value={lang} onChange={(e) => onLangChange(normalizeLang(e.target.value))}>
          <option value="en">EN</option>
          <option value="ja">JA</option>
        </select>
      </div>
      {loadingProfile && <p className="muted">{strings.loading}</p>}
      <form id={formId} className="card" onSubmit={onSubmit}>
        <label>
          {strings.displayName}
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          {strings.locationHint}
          <input value={location} onChange={(e) => setLocation(e.target.value)} />
        </label>
        <label>
          {strings.countryLabel}
          <input
            value={country}
            onChange={(e) => setCountry(e.target.value.toUpperCase())}
            placeholder={strings.countryPlaceholder}
            maxLength={2}
            required
          />
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
        {showSubmit && (
          <button type="submit" disabled={status === "saving"}>
            {status === "saving" ? strings.saving : strings.saveProfile}
          </button>
        )}
      </form>

      {status === "done" && humanId && (
        <div className="card">
          <p>{strings.profileSaved}</p>
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
