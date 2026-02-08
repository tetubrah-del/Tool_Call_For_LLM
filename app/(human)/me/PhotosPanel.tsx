"use client";

import { useEffect, useState } from "react";
import { UI_STRINGS, type UiLang } from "@/lib/i18n";

type Photo = {
  id: string;
  photo_url: string;
  is_public: 0 | 1;
  created_at: string;
};

type PhotosPanelProps = {
  lang: UiLang;
};

export default function PhotosPanel({ lang }: PhotosPanelProps) {
  const strings = UI_STRINGS[lang];
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [humanId, setHumanId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [isPublicByDefault, setIsPublicByDefault] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadPhotos() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/me/photos");
      if (!res.ok) {
        throw new Error("failed");
      }
      const data = await res.json();
      setHumanId(data.human_id || null);
      setPhotos(data.photos || []);
    } catch (err: any) {
      setError(err.message || "failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPhotos();
  }, []);

  async function uploadPhoto(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    setSaving(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("is_public", String(isPublicByDefault));
      const res = await fetch("/api/me/photos", {
        method: "POST",
        body: formData
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.reason || "failed");
      }
      setFile(null);
      await loadPhotos();
    } catch (err: any) {
      setError(err.message || "failed");
    } finally {
      setSaving(false);
    }
  }

  async function togglePublic(photoId: string, nextPublic: boolean) {
    setError(null);
    setPhotos((prev) =>
      prev.map((photo) =>
        photo.id === photoId ? { ...photo, is_public: nextPublic ? 1 : 0 } : photo
      )
    );
    const res = await fetch(`/api/me/photos/${photoId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_public: nextPublic })
    });
    if (!res.ok) {
      setError(strings.failed);
      setPhotos((prev) =>
        prev.map((photo) =>
          photo.id === photoId ? { ...photo, is_public: nextPublic ? 0 : 1 } : photo
        )
      );
    }
  }

  async function deletePhoto(photoId: string) {
    setError(null);
    const current = photos;
    setPhotos((prev) => prev.filter((photo) => photo.id !== photoId));
    const res = await fetch(`/api/me/photos/${photoId}`, { method: "DELETE" });
    if (!res.ok) {
      setError(strings.failed);
      setPhotos(current);
    }
  }

  return (
    <div className="photos-panel">
      <form className="card photo-upload-card" onSubmit={uploadPhoto}>
        <h3>{strings.photoUploadTitle}</h3>
        <p className="muted">{strings.photoUploadDesc}</p>
        <label>
          {strings.upload}
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            required
          />
        </label>
        <label className="switch-row">
          <span>{strings.photoPublicByDefault}</span>
          <input
            type="checkbox"
            checked={isPublicByDefault}
            onChange={(e) => setIsPublicByDefault(e.target.checked)}
          />
        </label>
        <button type="submit" disabled={!file || saving}>
          {saving ? strings.saving : strings.photoUploadButton}
        </button>
      </form>

      <div className="card photo-list-card">
        <div className="photo-list-head">
          <h3>{strings.photoListTitle}</h3>
          <div className="photo-list-actions">
            {humanId && (
              <a href={`/profile/${humanId}?lang=${lang}`} className="profile-link-button">
                {strings.publicProfileLink}
              </a>
            )}
            <button type="button" className="secondary" onClick={loadPhotos} disabled={loading}>
              {loading ? strings.loading : strings.refresh}
            </button>
          </div>
        </div>
        {error && (
          <p className="muted">
            {strings.failed}: {error}
          </p>
        )}
        {photos.length === 0 && !loading && <p className="muted">{strings.photoEmpty}</p>}
        <div className="photo-grid">
          {photos.map((photo) => (
            <article className="photo-item" key={photo.id}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.photo_url} alt="uploaded" />
              <div className="photo-item-meta">
                <p className="muted">{new Date(photo.created_at).toLocaleString(lang)}</p>
                <label className="switch-row">
                  <span>{strings.photoPublicToggle}</span>
                  <input
                    type="checkbox"
                    checked={photo.is_public === 1}
                    onChange={(e) => togglePublic(photo.id, e.target.checked)}
                  />
                </label>
                <button
                  type="button"
                  className="danger-text-button"
                  onClick={() => deletePhoto(photo.id)}
                >
                  {strings.deletePhoto}
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
