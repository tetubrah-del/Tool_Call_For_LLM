"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import type { UiLang } from "@/lib/i18n";

type BrandLogoProps = {
  lang: UiLang;
  size?: "nav" | "hero";
};

export default function BrandLogo({ lang, size = "nav" }: BrandLogoProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = useMemo(() => (lang === "ja" ? "/branding/logo-ja.png" : "/branding/logo-en.png"), [lang]);
  const loadFailed = failedSrc === src;
  const fallbackText = lang === "ja" ? "シンカイ" : "Sinkai";
  const imageSize = size === "hero" ? { width: 420, height: 120 } : { width: 220, height: 60 };

  if (loadFailed) {
    return <span className={`brand-logo-fallback brand-logo-fallback-${size}`}>{fallbackText}</span>;
  }

  return (
    <Image
      src={src}
      alt={`${fallbackText} logo`}
      className={`brand-logo brand-logo-${size}`}
      width={imageSize.width}
      height={imageSize.height}
      unoptimized
      onError={() => setFailedSrc(src)}
    />
  );
}
