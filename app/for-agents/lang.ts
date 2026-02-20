import { normalizeLang, type UiLang } from "@/lib/i18n";

type SearchParamsRecord = Record<string, string | string[] | undefined>;

export async function resolveForAgentsLang(
  searchParams?: Promise<SearchParamsRecord>
): Promise<UiLang> {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const langParam =
    typeof resolvedSearchParams?.lang === "string" ? resolvedSearchParams.lang : undefined;
  return normalizeLang(langParam);
}

export function withLang(path: string, lang: UiLang): string {
  const [withoutHash, hash] = path.split("#", 2);
  const [pathname, query] = withoutHash.split("?", 2);
  const params = new URLSearchParams(query ?? "");
  params.set("lang", lang);
  const qs = params.toString();
  return `${pathname}${qs ? `?${qs}` : ""}${hash ? `#${hash}` : ""}`;
}
