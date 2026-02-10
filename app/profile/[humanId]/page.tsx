import { normalizeLang, UI_STRINGS } from "@/lib/i18n";
import { getDb } from "@/lib/db";
import PublicInquiryForm from "./PublicInquiryForm";

export default async function PublicProfilePage({
  params,
  searchParams
}: {
  params: { humanId: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const langParam =
    typeof searchParams?.lang === "string" ? searchParams.lang : undefined;
  const lang = normalizeLang(langParam);
  const strings = UI_STRINGS[lang];
  const db = getDb();

  const human = await db
    .prepare(
      `SELECT id, name, location, country, status
       FROM humans
       WHERE id = ? AND deleted_at IS NULL
       LIMIT 1`
    )
    .get(params.humanId) as
    | { id: string; name: string; location: string | null; country: string | null; status: string }
    | undefined;

  if (!human) {
    return (
      <section className="card public-profile-card">
        <h1>{strings.publicProfileTitle}</h1>
        <p>{strings.profileNotFound}</p>
      </section>
    );
  }

  return (
    <section className="public-profile">
      <div className="card public-profile-card">
        <h1>{strings.publicProfileTitle}</h1>
        <p className="public-profile-name">{human.name}</p>
        <p className="muted">
          {human.location || "-"} / {human.country || "-"} / {human.status}
        </p>
      </div>
      <PublicInquiryForm humanId={human.id} lang={lang} />
    </section>
  );
}
