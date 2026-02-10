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
  // `location` is used for task matching (exact match). Keep it as the "city/ward" field.
  const [location, setLocation] = useState("");
  const [country, setCountry] = useState("JP");
  const [minBudgetUsd, setMinBudgetUsd] = useState("15");
  const [headline, setHeadline] = useState("");
  const [gender, setGender] = useState("unspecified");
  const [bio, setBio] = useState("");
  const [region, setRegion] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [skills, setSkills] = useState<string[]>([]);
  const [skillInput, setSkillInput] = useState("");
  const [twitterUrl, setTwitterUrl] = useState("");
  const [githubUrl, setGithubUrl] = useState("");
  const [instagramUrl, setInstagramUrl] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [humanId, setHumanId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const { status: sessionStatus } = useSession();
  const strings = UI_STRINGS[lang];
  const normalizedCountry = country.trim().toUpperCase();
  const hasCountryInList = COUNTRY_OPTIONS.some((option) => option.code === normalizedCountry);
  const MAX_BIO_LENGTH = 4000;
  const MAX_SKILLS = 5;
  const TIMEZONE_OPTIONS = [
    "UTC",
    "Asia/Tokyo",
    "Asia/Seoul",
    "Asia/Singapore",
    "Asia/Hong_Kong",
    "America/Los_Angeles",
    "America/New_York",
    "Europe/London",
    "Europe/Berlin",
    "Australia/Sydney"
  ];

  function parseSkillsJson(value: unknown): string[] {
    if (typeof value !== "string" || !value.trim()) return [];
    try {
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((v) => (typeof v === "string" ? v.trim() : ""))
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  function normalizeSkill(value: string): string {
    return value.trim().replace(/\s+/g, " ").slice(0, 40);
  }

  function addSkill(raw: string) {
    const next = normalizeSkill(raw);
    if (!next) return;
    setSkills((prev) => {
      if (prev.includes(next)) return prev;
      if (prev.length >= MAX_SKILLS) return prev;
      return [...prev, next];
    });
  }

  function removeSkill(skill: string) {
    setSkills((prev) => prev.filter((v) => v !== skill));
  }

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
          const city = data.profile.city || data.profile.location || "";
          setLocation(city);
          setCountry(
            typeof data.profile.country === "string" && data.profile.country.trim()
              ? data.profile.country.trim().toUpperCase()
              : "JP"
          );
          setMinBudgetUsd(String(data.profile.min_budget_usd ?? 15));
          setHeadline(data.profile.headline || "");
          setGender(typeof data.profile.gender === "string" ? data.profile.gender : "unspecified");
          setBio(data.profile.bio || "");
          setRegion(data.profile.region || "");
          setTimezone(data.profile.timezone || "UTC");
          setSkills(parseSkillsJson(data.profile.skills_json));
          setTwitterUrl(data.profile.twitter_url || "");
          setGithubUrl(data.profile.github_url || "");
          setInstagramUrl(data.profile.instagram_url || "");
          setLinkedinUrl(data.profile.linkedin_url || "");
          setWebsiteUrl(data.profile.website_url || "");
          setYoutubeUrl(data.profile.youtube_url || "");
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
          min_budget_usd: Number(minBudgetUsd),
          headline,
          gender,
          bio,
          city: location,
          region,
          timezone,
          skills,
          twitter_url: twitterUrl,
          github_url: githubUrl,
          instagram_url: instagramUrl,
          linkedin_url: linkedinUrl,
          website_url: websiteUrl,
          youtube_url: youtubeUrl
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
      <form id={formId} className="profile-form" onSubmit={onSubmit}>
        <div className="card profile-section">
          <div className="profile-grid profile-grid-3">
            <label>
              {strings.displayName}
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
            <label>
              {strings.headlineLabel}
              <input
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                placeholder={strings.headlinePlaceholder}
              />
            </label>
            <label>
              {strings.genderLabel}
              <select value={gender} onChange={(e) => setGender(e.target.value)}>
                <option value="unspecified">{strings.genderPlaceholder}</option>
                <option value="male">{strings.genderMale}</option>
                <option value="female">{strings.genderFemale}</option>
                <option value="nonbinary">{strings.genderNonbinary}</option>
                <option value="other">{strings.genderOther}</option>
                <option value="prefer_not_to_say">{strings.genderPreferNot}</option>
              </select>
            </label>
          </div>

          <div className="label-row">
            <label className="label-inline">{strings.bioLabel}</label>
            <span className="muted">
              {Math.min(bio.length, MAX_BIO_LENGTH)}/{MAX_BIO_LENGTH}
            </span>
          </div>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value.slice(0, MAX_BIO_LENGTH))}
            rows={6}
            placeholder={strings.bioPlaceholder}
          />
        </div>

        <div className="card profile-section">
          <h3 className="profile-section-title">{strings.locationSectionTitle}</h3>
          <div className="profile-grid profile-grid-3">
            <label>
              {strings.cityLabel}
              <input value={location} onChange={(e) => setLocation(e.target.value)} />
            </label>
            <label>
              {strings.regionLabel}
              <input value={region} onChange={(e) => setRegion(e.target.value)} />
            </label>
            <label>
              {strings.countryLabel}
              <select
                value={normalizedCountry || "JP"}
                onChange={(e) => setCountry(e.target.value)}
                required
              >
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
          </div>
        </div>

        <div className="card profile-section">
          <div className="profile-section-head">
            <h3 className="profile-section-title">{strings.skillsLabel}</h3>
            <span className="muted">
              {skills.length} / {MAX_SKILLS}
            </span>
          </div>
          <div className="row profile-skill-row">
            <input
              value={skillInput}
              onChange={(e) => setSkillInput(e.target.value)}
              placeholder={strings.skillsPlaceholder}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addSkill(skillInput);
                  setSkillInput("");
                }
              }}
            />
            <button
              type="button"
              className="secondary inline-button"
              onClick={() => {
                addSkill(skillInput);
                setSkillInput("");
              }}
              disabled={!skillInput.trim() || skills.length >= MAX_SKILLS}
            >
              {strings.skillsAdd}
            </button>
          </div>
          {skills.length > 0 && (
            <div className="tag-list">
              {skills.map((skill) => (
                <button
                  key={skill}
                  type="button"
                  className="tag"
                  onClick={() => removeSkill(skill)}
                  title="Remove"
                >
                  {skill} <span className="tag-x">×</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="card profile-section">
          <h3 className="profile-section-title">{strings.socialLinksTitle}</h3>
          <div className="profile-grid profile-grid-2">
            <label>
              {strings.twitterLabel}
              <input
                value={twitterUrl}
                onChange={(e) => setTwitterUrl(e.target.value)}
                placeholder="twitter.com/username"
              />
            </label>
            <label>
              {strings.linkedinLabel}
              <input
                value={linkedinUrl}
                onChange={(e) => setLinkedinUrl(e.target.value)}
                placeholder="linkedin.com/in/username"
              />
            </label>
            <label>
              {strings.githubLabel}
              <input
                value={githubUrl}
                onChange={(e) => setGithubUrl(e.target.value)}
                placeholder="github.com/username"
              />
            </label>
            <label>
              {strings.websiteLabel}
              <input
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                placeholder="yoursite.com"
              />
            </label>
            <label>
              {strings.instagramLabel}
              <input
                value={instagramUrl}
                onChange={(e) => setInstagramUrl(e.target.value)}
                placeholder="instagram.com/username"
              />
            </label>
            <label>
              {strings.youtubeLabel}
              <input
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                placeholder="youtube.com/@channel"
              />
            </label>
          </div>

          <div className="profile-grid profile-grid-2">
            <label>
              {strings.timezoneLabel}
              <select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                {TIMEZONE_OPTIONS.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="card profile-section">
          <h3 className="profile-section-title">{strings.tabPayments}</h3>
          <div className="profile-grid profile-grid-2">
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
          </div>
        </div>

        {showSubmit && (
          <button type="submit" disabled={status === "saving"} className={submitClassName}>
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
