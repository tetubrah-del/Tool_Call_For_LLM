"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { normalizeLang, UI_STRINGS, type UiLang } from "@/lib/i18n";
import BrandLogo from "./BrandLogo";

export default function GlobalNav() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
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
  const navItems = useMemo(
    () => [
      {
        key: "for-agents",
        label: strings.forAgents,
        href: `/for-agents?${query}`,
        isActive: pathname.startsWith("/for-agents")
      },
      {
        key: "tasks",
        label: strings.tasks,
        href: `/tasks?${query}`,
        isActive: pathname.startsWith("/tasks")
      },
      {
        key: "ai-connect",
        label: strings.aiConnect,
        href: `/ai/connect?${query}`,
        isActive: pathname.startsWith("/ai/connect")
      },
      {
        key: "account",
        label: session?.user ? strings.myPage : strings.register,
        href: session?.user ? `/me?${query}` : `/auth?${query}`,
        isActive: session?.user ? pathname.startsWith("/me") : pathname.startsWith("/auth")
      }
    ],
    [pathname, query, session?.user, strings.aiConnect, strings.forAgents, strings.myPage, strings.register, strings.tasks]
  );

  function onLangChange(next: UiLang) {
    setLang(next);
    localStorage.setItem("lang", next);
    const params = new URLSearchParams(searchParams.toString());
    params.set("lang", next);
    router.replace(`${pathname}?${params.toString()}`);
  }

  return (
    <nav className="global-nav">
      <div className="nav-inner">
        <a className="brand" href={`/?${query}`}>
          <BrandLogo lang={lang} size="nav" />
        </a>
        <div className="nav-links">
          {navItems.map((item) => (
            <a key={item.key} href={item.href} className={item.isActive ? "active" : undefined}>
              {item.label}
            </a>
          ))}
        </div>
        <div className="nav-actions">
          <div className="nav-lang">
            <label htmlFor="nav-lang">{strings.langLabel}</label>
            <select
              id="nav-lang"
              value={lang}
              onChange={(e) => onLangChange(normalizeLang(e.target.value))}
            >
              <option value="en">EN</option>
              <option value="ja">JA</option>
            </select>
          </div>
          {session?.user && (
            <button
              className="secondary nav-signout"
              type="button"
              onClick={() => signOut()}
            >
              {strings.signOut}
            </button>
          )}
        </div>
      </div>
      <div className="mobile-bottom-nav" role="navigation" aria-label="Global navigation">
        {navItems.map((item) => (
          <a key={`mobile-${item.key}`} href={item.href} className={item.isActive ? "active" : undefined}>
            {item.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
