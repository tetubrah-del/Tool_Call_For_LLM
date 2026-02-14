import { UI_STRINGS, type UiLang } from "@/lib/i18n";

type ApiPanelProps = {
  lang: UiLang;
};

export default function ApiPanel({ lang }: ApiPanelProps) {
  const strings = UI_STRINGS[lang];

  return (
    <div className="card empty-state">
      <h2>{strings.tabApi}</h2>
      <p>{strings.apiComingSoon}</p>
    </div>
  );
}
