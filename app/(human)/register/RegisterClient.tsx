"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { normalizeLang, UI_STRINGS, type UiLang } from "@/lib/i18n";

type RegisterClientProps = {
  title?: string | null;
  formId?: string;
  showSubmit?: boolean;
  submitLabel?: string;
  submitClassName?: string;
};

const COUNTRY_OPTIONS: Array<{ code: string; en: string; ja: string }> = [
  { code: "JP", en: "Japan", ja: "日本" },
  { code: "US", en: "United States", ja: "アメリカ" },
  { code: "GB", en: "United Kingdom", ja: "イギリス" },
  { code: "CA", en: "Canada", ja: "カナダ" },
  { code: "AU", en: "Australia", ja: "オーストラリア" },
  { code: "NZ", en: "New Zealand", ja: "ニュージーランド" },
  { code: "SG", en: "Singapore", ja: "シンガポール" },
  { code: "HK", en: "Hong Kong", ja: "香港" },
  { code: "TW", en: "Taiwan", ja: "台湾" },
  { code: "KR", en: "South Korea", ja: "韓国" },
  { code: "CN", en: "China", ja: "中国" },
  { code: "IN", en: "India", ja: "インド" },
  { code: "TH", en: "Thailand", ja: "タイ" },
  { code: "VN", en: "Vietnam", ja: "ベトナム" },
  { code: "PH", en: "Philippines", ja: "フィリピン" },
  { code: "ID", en: "Indonesia", ja: "インドネシア" },
  { code: "MY", en: "Malaysia", ja: "マレーシア" },
  { code: "DE", en: "Germany", ja: "ドイツ" },
  { code: "FR", en: "France", ja: "フランス" },
  { code: "IT", en: "Italy", ja: "イタリア" },
  { code: "ES", en: "Spain", ja: "スペイン" },
  { code: "NL", en: "Netherlands", ja: "オランダ" },
  { code: "SE", en: "Sweden", ja: "スウェーデン" },
  { code: "CH", en: "Switzerland", ja: "スイス" },
  { code: "AE", en: "United Arab Emirates", ja: "アラブ首長国連邦" },
  { code: "SA", en: "Saudi Arabia", ja: "サウジアラビア" },
  { code: "BR", en: "Brazil", ja: "ブラジル" },
  { code: "MX", en: "Mexico", ja: "メキシコ" },
  { code: "AR", en: "Argentina", ja: "アルゼンチン" },
  { code: "ZA", en: "South Africa", ja: "南アフリカ" }
];

export default function RegisterClient({
  title,
  formId = "profile-form",
  showSubmit = true,
  submitLabel,
  submitClassName
}: RegisterClientProps) {
  const searchParams = useSearchParams();
  const lang = useMemo<UiLang>(() => normalizeLang(searchParams.get("lang")), [searchParams]);
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
  const normalizedCountry = country.trim().toUpperCase();
  const hasCountryInList = COUNTRY_OPTIONS.some((option) => option.code === normalizedCountry);

  async function parseApiResponse(res: Response) {
    const raw = await res.text();
    if (!raw) return {};
    try {
      return JSON.parse(raw) as Record<string, any>;
    } catch {
      return { reason: raw.slice(0, 200) };
    }
  }

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
          setCountry(
            typeof data.profile.country === "string" && data.profile.country.trim()
              ? data.profile.country.trim().toUpperCase()
              : "JP"
          );
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

      const data = await parseApiResponse(res);
      if (!res.ok) {
        throw new Error(data?.reason || `request_failed_${res.status}`);
      }

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
          <select value={normalizedCountry || "JP"} onChange={(e) => setCountry(e.target.value)} required>
            {!hasCountryInList && normalizedCountry && (
              <option value={normalizedCountry}>{normalizedCountry}</option>
            )}
            {COUNTRY_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.code} - {lang === "ja" ? option.ja : option.en}
              </option>
            ))}
          </select>
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
          <button
            type="submit"
            disabled={status === "saving"}
            className={submitClassName}
          >
            {status === "saving" ? strings.saving : submitLabel ?? strings.saveProfile}
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
