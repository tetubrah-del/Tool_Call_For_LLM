"use client";

import Link from "next/link";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { normalizeLang, type UiLang } from "@/lib/i18n";

const FOOTER_STRINGS: Record<
  UiLang,
  {
    blog: string;
    terms: string;
    legal: string;
    privacy: string;
    company: string;
  }
> = {
  ja: {
    blog: "ブログ",
    terms: "利用規約",
    legal: "特商法",
    privacy: "プライバシーポリシー",
    company: "運営会社"
  },
  en: {
    blog: "Blog",
    terms: "Terms",
    legal: "Legal Notice",
    privacy: "Privacy",
    company: "Company"
  }
};

export default function SiteFooter() {
  const searchParams = useSearchParams();
  const [initialLang] = useState<UiLang>(() => {
    if (typeof window === "undefined") {
      return "en";
    }
    return normalizeLang(localStorage.getItem("lang"));
  });
  const lang = normalizeLang(searchParams.get("lang") || initialLang);
  const strings = FOOTER_STRINGS[lang];

  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <Link href={`/blog?lang=${lang}`}>{strings.blog}</Link>
        <a href={`/terms?lang=${lang}`}>{strings.terms}</a>
        <a
          href="https://core-logic-studio.onrender.com/tokusho"
          target="_blank"
          rel="noreferrer noopener"
        >
          {strings.legal}
        </a>
        <a href={`/privacy?lang=${lang}`}>{strings.privacy}</a>
        <a
          href="https://core-logic-studio.onrender.com"
          target="_blank"
          rel="noreferrer noopener"
        >
          {strings.company}
        </a>
      </div>
    </footer>
  );
}
