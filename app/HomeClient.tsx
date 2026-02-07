"use client";

import { useEffect, useState } from "react";
import { normalizeLang, UI_STRINGS, type UiLang } from "@/lib/i18n";

export default function HomeClient() {
  const [lang, setLang] = useState<UiLang>("en");
  const strings = UI_STRINGS[lang];

  useEffect(() => {
    const saved = localStorage.getItem("lang");
    if (saved) {
      setLang(normalizeLang(saved));
    }
  }, []);

  function onLangChange(next: UiLang) {
    setLang(next);
    localStorage.setItem("lang", next);
  }

  return (
    <div>
      <div className="row">
        <h1>{strings.appTitle}</h1>
        <select value={lang} onChange={(e) => onLangChange(normalizeLang(e.target.value))}>
          <option value="en">EN</option>
          <option value="ja">JA</option>
        </select>
      </div>
      <p className="muted">{strings.humanUiOnly}</p>
      <div className="card">
        <p>
          <a href={`/register?lang=${lang}`}>{strings.register}</a>
        </p>
        <p>
          <a href={`/tasks?lang=${lang}`}>{strings.viewTasks}</a>
        </p>
        <p>
          <a href="/payments">Payments (admin)</a>
        </p>
      </div>
    </div>
  );
}
