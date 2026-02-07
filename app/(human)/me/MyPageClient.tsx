"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { normalizeLang, UI_STRINGS } from "@/lib/i18n";
import RegisterClient from "../register/RegisterClient";

export default function MyPageClient() {
  const searchParams = useSearchParams();
  const lang = useMemo(() => normalizeLang(searchParams.get("lang")), [searchParams]);
  const strings = UI_STRINGS[lang];
  return <RegisterClient title={strings.myPageTitle} />;
}
