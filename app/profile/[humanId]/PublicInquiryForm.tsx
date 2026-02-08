"use client";

import { useState } from "react";
import { UI_STRINGS, type UiLang } from "@/lib/i18n";

type PublicInquiryFormProps = {
  humanId: string;
  lang: UiLang;
};

export default function PublicInquiryForm({ humanId, lang }: PublicInquiryFormProps) {
  const strings = UI_STRINGS[lang];
  const [fromName, setFromName] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("saving");
    setError(null);
    try {
      const res = await fetch("/api/inquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          human_id: humanId,
          from_name: fromName,
          from_email: fromEmail,
          subject,
          body
        })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.reason || "failed");
      }
      setFromName("");
      setFromEmail("");
      setSubject("");
      setBody("");
      setStatus("done");
    } catch (err: any) {
      setError(err.message || "failed");
      setStatus("error");
    }
  }

  return (
    <form className="card inquiry-form-card" onSubmit={onSubmit}>
      <h2>{strings.inquiryTitle}</h2>
      <p className="muted">{strings.inquiryDesc}</p>
      <label>
        {strings.inquiryFromName}
        <input value={fromName} onChange={(e) => setFromName(e.target.value)} />
      </label>
      <label>
        {strings.inquiryFromEmail}
        <input
          type="email"
          value={fromEmail}
          onChange={(e) => setFromEmail(e.target.value)}
          placeholder="you@example.com"
        />
      </label>
      <label>
        {strings.inquirySubject}
        <input value={subject} onChange={(e) => setSubject(e.target.value)} required />
      </label>
      <label>
        {strings.inquiryBody}
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} required />
      </label>
      <button type="submit" disabled={status === "saving"}>
        {status === "saving" ? strings.saving : strings.inquirySend}
      </button>
      {status === "done" && <p className="muted">{strings.inquirySent}</p>}
      {status === "error" && error && (
        <p className="muted">
          {strings.failed}: {error}
        </p>
      )}
    </form>
  );
}
