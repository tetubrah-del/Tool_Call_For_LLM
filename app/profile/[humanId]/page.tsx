import { normalizeLang, UI_STRINGS } from "@/lib/i18n";
import { getDb } from "@/lib/db";
import PublicInquiryForm from "./PublicInquiryForm";

export default function PublicProfilePage({
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

  const human = db
    .prepare(`SELECT id, name, location, country, status FROM humans WHERE id = ? LIMIT 1`)
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

  const photos = db
    .prepare(
      `SELECT id, photo_url, created_at
       FROM human_photos
       WHERE human_id = ? AND is_public = 1
       ORDER BY created_at DESC`
    )
    .all(human.id) as Array<{ id: string; photo_url: string; created_at: string }>;

  return (
    <section className="public-profile">
      <div className="card public-profile-card">
        <h1>{strings.publicProfileTitle}</h1>
        <p className="public-profile-name">{human.name}</p>
        <p className="muted">
          {human.location || "-"} / {human.country || "-"} / {human.status}
        </p>
      </div>

      <div className="card public-photos-card">
        <h2>{strings.publicPhotos}</h2>
        {photos.length === 0 && <p className="muted">{strings.noPublicPhotos}</p>}
        <div className="photo-grid">
          {photos.map((photo) => (
            <article key={photo.id} className="photo-item">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.photo_url} alt="public profile photo" />
              <div className="photo-item-meta">
                <p className="muted">{new Date(photo.created_at).toLocaleString(lang)}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
      <PublicInquiryForm humanId={human.id} lang={lang} />
    </section>
  );
}
