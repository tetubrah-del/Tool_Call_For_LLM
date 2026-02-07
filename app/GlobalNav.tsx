"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { normalizeLang, UI_STRINGS, type UiLang } from "@/lib/i18n";

export default function GlobalNav() {
  const searchParams = useSearchParams();
  const [lang, setLang] = useState<UiLang>("en");
  const [humanId, setHumanId] = useState("");

  useEffect(() => {
    const savedLang = localStorage.getItem("lang");
    const nextLang = normalizeLang(searchParams.get("lang") || savedLang);
    setLang(nextLang);
  }, [searchParams]);

  useEffect(() => {
    const fromQuery = searchParams.get("human_id") || "";
    const saved = localStorage.getItem("human_id") || "";
    setHumanId(fromQuery || saved);
  }, [searchParams]);

  const strings = UI_STRINGS[lang];
  const query = useMemo(() => {
    const params = new URLSearchParams();
    params.set("lang", lang);
    if (humanId) {
      params.set("human_id", humanId);
    }
    return params.toString();
  }, [lang, humanId]);

  return (
    <nav className="global-nav">
      <div className="nav-inner">
        <a className="brand" href={`/?${query}`}>
          {strings.appTitle}
        </a>
        <div className="nav-links">
          <a href={`/?${query}`}>{strings.home}</a>
          <a href={`/register?lang=${lang}`}>{strings.register}</a>
          <a href={`/tasks?${query}`}>{strings.tasks}</a>
        </div>
      </div>
    </nav>
  );
}
