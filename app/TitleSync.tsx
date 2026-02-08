"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { normalizeLang, UI_STRINGS } from "@/lib/i18n";

export default function TitleSync() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const saved = localStorage.getItem("lang");
    const lang = normalizeLang(searchParams.get("lang") || saved);
    const title = UI_STRINGS[lang].appTitle;
    if (title && document.title !== title) {
      document.title = title;
    }
  }, [searchParams]);

  return null;
}
