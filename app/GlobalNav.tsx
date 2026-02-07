"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { normalizeLang, UI_STRINGS, type UiLang } from "@/lib/i18n";

export default function GlobalNav() {
  const searchParams = useSearchParams();
  const [lang, setLang] = useState<UiLang>("en");
  const { data: session } = useSession();

  useEffect(() => {
    const savedLang = localStorage.getItem("lang");
    const nextLang = normalizeLang(searchParams.get("lang") || savedLang);
    setLang(nextLang);
  }, [searchParams]);

  const strings = UI_STRINGS[lang];
  const query = useMemo(() => {
    const params = new URLSearchParams();
    params.set("lang", lang);
    return params.toString();
  }, [lang]);

  return (
    <nav className="global-nav">
      <div className="nav-inner">
        <a className="brand" href={`/?${query}`}>
          {strings.appTitle}
        </a>
        <div className="nav-links">
          <a href={`/?${query}`}>{strings.home}</a>
          <a href={`/tasks?${query}`}>{strings.tasks}</a>
          <a href={`/ai/connect?lang=${lang}`}>{strings.aiConnect}</a>
          {session?.user ? (
            <a href={`/me?lang=${lang}`}>{strings.myPage}</a>
          ) : (
            <a href={`/auth?lang=${lang}`}>{strings.register}</a>
          )}
        </div>
        {session?.user && (
          <div className="nav-user">
            <span className="user-pill">
              {strings.signedInAs}: {session.user.name || session.user.email || "User"}
            </span>
            <button className="secondary" type="button" onClick={() => signOut()}>
              {strings.signOut}
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}
