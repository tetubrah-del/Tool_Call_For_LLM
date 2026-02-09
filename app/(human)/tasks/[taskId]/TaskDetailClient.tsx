"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { normalizeLang, UI_STRINGS, type UiLang } from "@/lib/i18n";
import { calculateFeeAmount } from "@/lib/payments";
import { TASK_LABEL_TEXT, type TaskLabel } from "@/lib/task-labels";

type Task = {
  id: string;
  task: string;
  task_display?: string;
  lang?: UiLang;
  task_label: TaskLabel | null;
  acceptance_criteria: string | null;
  not_allowed: string | null;
  deliverable: "photo" | "video" | "text" | null;
  status: "open" | "accepted" | "completed" | "failed";
  failure_reason?: string | null;
  budget_usd: number;
  is_international_payout?: boolean;
  location: string | null;
  human_id?: string | null;
};

type ContactMessage = {
  id: string;
  task_id: string;
  sender_type: "ai" | "human";
  sender_id: string;
  body: string;
  attachment_url: string | null;
  created_at: string;
};

export default function TaskDetailClient() {
  const params = useParams<{ taskId: string }>();
  const searchParams = useSearchParams();
  const lang = useMemo(() => normalizeLang(searchParams.get("lang")), [searchParams]);
  const strings = UI_STRINGS[lang];

  const [humanId, setHumanId] = useState(searchParams.get("human_id") || "");
  const humanTestToken = useMemo(
    () => (searchParams.get("human_test_token") || "").trim(),
    [searchParams]
  );
  const [task, setTask] = useState<Task | null>(null);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "saving" | "done" | "error">(
    "loading"
  );
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const [contactLoading, setContactLoading] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);
  const [channelStatus, setChannelStatus] = useState<"pending" | "open" | "closed" | null>(null);
  const [messages, setMessages] = useState<ContactMessage[]>([]);
  const [composeBody, setComposeBody] = useState("");
  const [composeFile, setComposeFile] = useState<File | null>(null);
  const [sendingMessage, setSendingMessage] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function resolveHumanId() {
      if (humanId) return;
      const saved = localStorage.getItem("human_id") || "";
      if (saved) {
        setHumanId(saved);
        return;
      }
      const res = await fetch("/api/profile");
      if (!res.ok) return;
      const data = await res.json();
      if (!cancelled && data.profile?.id) {
        setHumanId(data.profile.id);
        localStorage.setItem("human_id", data.profile.id);
      }
    }
    resolveHumanId();
    return () => {
      cancelled = true;
    };
  }, [humanId]);

  useEffect(() => {
    async function load() {
      try {
        const qs = new URLSearchParams();
        qs.set("lang", lang);
        if (humanId) {
          qs.set("human_id", humanId);
        }
        const res = await fetch(`/api/tasks/${params.taskId}?${qs.toString()}`);
        if (!res.ok) throw new Error("failed");
        const data = await res.json();
        setTask(data.task);
        setStatus("idle");
      } catch (err: any) {
        setError(err.message || "failed");
        setStatus("error");
      }
    }
    load();
  }, [params.taskId, lang, humanId]);

  async function loadContact() {
    if (!task) return;
    if (task.status !== "accepted" && task.status !== "completed") return;
    setContactLoading(true);
    setContactError(null);
    try {
      const qs = new URLSearchParams();
      if (humanId && humanTestToken) {
        qs.set("human_id", humanId);
        qs.set("human_test_token", humanTestToken);
      }
      const url = qs.toString().length
        ? `/api/tasks/${task.id}/contact/messages?${qs.toString()}`
        : `/api/tasks/${task.id}/contact/messages`;
      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.reason || data?.status || "failed");
      }
      setChannelStatus(data?.channel?.status || null);
      setMessages(Array.isArray(data?.messages) ? data.messages : []);
    } catch (err: any) {
      setContactError(err.message || "failed");
    } finally {
      setContactLoading(false);
    }
  }

  useEffect(() => {
    if (!task) return;
    void loadContact();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id, task?.status, humanId, humanTestToken]);

  async function sendContactMessage(event: React.FormEvent) {
    event.preventDefault();
    if (!task) return;
    if (task.status !== "accepted") return;
    if (channelStatus !== "open") return;
    if (!composeBody.trim() && !composeFile) return;

    setSendingMessage(true);
    setContactError(null);
    try {
      const formData = new FormData();
      if (composeBody.trim()) formData.append("body", composeBody.trim());
      if (composeFile) formData.append("file", composeFile);
      if (humanId && humanTestToken) {
        formData.append("human_id", humanId);
        formData.append("human_test_token", humanTestToken);
      }
      const res = await fetch(`/api/tasks/${task.id}/contact/messages`, {
        method: "POST",
        body: formData
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.reason || data?.status || "failed");
      }
      setComposeBody("");
      setComposeFile(null);
      if (data?.message) {
        setMessages((prev) => [...prev, data.message]);
      } else {
        await loadContact();
      }
    } catch (err: any) {
      setContactError(err.message || "failed");
    } finally {
      setSendingMessage(false);
    }
  }

  async function acceptTask() {
    if (!task) return;
    if (task.status !== "open") return;
    if (!humanId) return;
    setStatus("saving");
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${task.id}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ human_id: humanId })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.reason || "failed");
      // Reload task details
      const qs = new URLSearchParams();
      qs.set("lang", lang);
      if (humanId) qs.set("human_id", humanId);
      const tRes = await fetch(`/api/tasks/${params.taskId}?${qs.toString()}`);
      const tData = await tRes.json();
      setTask(tData.task);
      setStatus("idle");
    } catch (err: any) {
      setError(err.message || "failed");
      setStatus("error");
    }
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!task) return;

    setStatus("saving");
    setError(null);
    setValidationError(null);

    try {
      const formData = new FormData();
      formData.append("task_id", task.id);
      const type = task.deliverable || "text";
      formData.append("type", type);
      if (humanId && humanTestToken) {
        formData.append("human_id", humanId);
        formData.append("human_test_token", humanTestToken);
      }
      if (type === "text") {
        if (!text.trim()) {
          setValidationError(strings.missingText);
          setStatus("idle");
          return;
        }
        formData.append("text", text);
      } else if (file) {
        formData.append("file", file);
      } else {
        setValidationError(strings.missingFile);
        setStatus("idle");
        return;
      }

      const res = await fetch("/api/submissions", {
        method: "POST",
        body: formData
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data?.reason || "failed");
      }

      setStatus("done");
    } catch (err: any) {
      setError(err.message || "failed");
      setStatus("error");
    }
  }

  if (status === "loading") {
    return <p>{strings.loading}</p>;
  }

  if (!task) {
    return <p>{strings.taskNotFound}</p>;
  }

  const deliverable = task.deliverable || "text";
  const showTranslationPending =
    lang === "ja" && task.task_display && task.task_display === task.task;
  const netPayout = Math.max(
    Number((task.budget_usd - calculateFeeAmount(task.budget_usd)).toFixed(2)),
    0
  );
  const showIntlFeeNote = Boolean(task.is_international_payout);
  const showBestEffort = Boolean(strings.bestEffort && strings.noTimeGuarantee);
  const canSubmit =
    deliverable === "text" ? text.trim().length > 0 : Boolean(file);

  return (
    <div>
      <h1>{strings.deliverTask}</h1>
      <div className="card">
        <h3>{task.task_display || task.task}</h3>
        {showTranslationPending && (
          <p className="muted">{strings.translationPending}</p>
        )}
        {showBestEffort && (
          <p className="muted">
            {strings.bestEffort} | {strings.noTimeGuarantee}
          </p>
        )}
        {showIntlFeeNote && <p className="muted">{strings.intlFeeNote}</p>}
        <p className="muted">
          {strings.deliverable}: {deliverable} | {strings.payout}: ${netPayout} |{" "}
          {strings.location}: {task.location || strings.any} | {strings.taskLabel}:{" "}
          {task.task_label ? TASK_LABEL_TEXT[task.task_label][lang] : strings.any}
        </p>
        {task.acceptance_criteria && (
          <p className="muted">
            {strings.acceptanceCriteria}: {task.acceptance_criteria}
          </p>
        )}
        {task.not_allowed && (
          <p className="muted">
            {strings.notAllowed}: {task.not_allowed}
          </p>
        )}
        {task.status === "failed" && task.failure_reason && (
          <p className="muted">
            {strings.failureReason}: {task.failure_reason}
          </p>
        )}

        {task.status === "open" && (
          <div className="row">
            <button type="button" onClick={acceptTask} disabled={!humanId || status === "saving"}>
              {strings.accept}
            </button>
            {!humanId && <p className="muted">{strings.needAccount}</p>}
          </div>
        )}
      </div>

      {(task.status === "accepted" || task.status === "completed") && (
        <div className="card thread-panel">
          <h3>{strings.contactChannelsTitle}</h3>
          {contactLoading && <p className="muted">{strings.loading}</p>}
          {!contactLoading && channelStatus && (
            <p className="muted">
              {strings.channelStatus}: {channelStatus}
            </p>
          )}
          {contactError && (
            <p className="muted">
              {strings.failed}: {contactError}
            </p>
          )}
          {!contactLoading && !contactError && messages.length === 0 && (
            <p className="muted">{strings.noMessages}</p>
          )}
          <div className="thread-messages">
            {messages.map((message) => (
              <article
                key={message.id}
                className={
                  message.sender_type === "human"
                    ? "thread-message human-message"
                    : "thread-message ai-message"
                }
              >
                <p className="muted">
                  {message.sender_type === "human" ? strings.me : strings.ai}
                </p>
                <p>{message.body}</p>
                {message.attachment_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={message.attachment_url}
                    alt="message attachment"
                    className="thread-image"
                  />
                )}
                <p className="muted">{new Date(message.created_at).toLocaleString(lang)}</p>
              </article>
            ))}
          </div>

          {task.status === "accepted" && (
            <form className="thread-compose" onSubmit={sendContactMessage}>
              <label>
                {strings.inquiryBody}
                <textarea
                  value={composeBody}
                  onChange={(e) => setComposeBody(e.target.value)}
                  rows={3}
                />
              </label>
              <label>
                {strings.attachmentImage}
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setComposeFile(e.target.files?.[0] || null)}
                />
              </label>
              {composeFile && <p className="muted">{composeFile.name}</p>}
              {channelStatus !== "open" && (
                <p className="muted">
                  {strings.channelNotOpenHint}
                </p>
              )}
              <button
                type="submit"
                disabled={
                  sendingMessage ||
                  channelStatus !== "open" ||
                  (!composeBody.trim() && !composeFile)
                }
              >
                {sendingMessage ? strings.saving : strings.sendMessage}
              </button>
            </form>
          )}
        </div>
      )}

      <form className="card" onSubmit={onSubmit}>
        {deliverable === "text" && (
          <label>
            {strings.text}
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} />
          </label>
        )}
        {deliverable !== "text" && (
          <label>
            {strings.upload} {deliverable}
            <input
              type="file"
              accept={deliverable === "photo" ? "image/*" : "video/*"}
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </label>
        )}
        <div className="row">
          <button type="submit" disabled={status === "saving" || !canSubmit}>
            {status === "saving" ? strings.loading : strings.submit}
          </button>
          <a href={`/tasks?lang=${lang}`} className="secondary">
            {strings.backToTasks}
          </a>
        </div>
      </form>

      {status === "done" && (
        <div className="card">
          <p>{strings.submitted}</p>
        </div>
      )}

      {status === "error" && error && (
        <div className="card">
          <p>
            {strings.failed}: {error}
          </p>
        </div>
      )}

      {validationError && (
        <div className="card">
          <p>
            {strings.failed}: {validationError}
          </p>
        </div>
      )}
    </div>
  );
}
