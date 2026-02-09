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
  origin_country?: string | null;
  deadline_at?: string | null;
  created_at?: string;
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

type TaskComment = {
  id: string;
  task_id: string;
  human_id: string;
  human_name: string | null;
  body: string;
  created_at: string;
};

function formatRelativeTime(iso: string, lang: UiLang): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return iso;
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  if (lang === "ja") {
    if (sec < 60) return `${sec}秒前`;
    if (min < 60) return `${min}分前`;
    if (hr < 24) return `${hr}時間前`;
    return `${day}日前`;
  }
  if (sec < 60) return `${sec}s ago`;
  if (min < 60) return `${min}m ago`;
  if (hr < 24) return `${hr}h ago`;
  return `${day}d ago`;
}

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
  const [isLoggedIn, setIsLoggedIn] = useState(false);
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

  const [comments, setComments] = useState<TaskComment[]>([]);
  const [commentBody, setCommentBody] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);
  const [postingComment, setPostingComment] = useState(false);

  const [applyCoverLetter, setApplyCoverLetter] = useState("");
  const [applyAvailability, setApplyAvailability] = useState("");
  const [applyCounterBudget, setApplyCounterBudget] = useState("");
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function resolveHumanId() {
      const saved = localStorage.getItem("human_id") || "";
      if (!humanId && saved) {
        setHumanId(saved);
      }
      const res = await fetch("/api/profile");
      if (!res.ok) {
        if (!cancelled) setIsLoggedIn(false);
        return;
      }
      const data = await res.json();
      if (!cancelled && data.profile?.id) {
        setIsLoggedIn(true);
        if (!humanId) {
          setHumanId(data.profile.id);
          localStorage.setItem("human_id", data.profile.id);
        }
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

  async function loadComments() {
    setCommentError(null);
    try {
      const res = await fetch(`/api/tasks/${params.taskId}/comments`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.status || "failed");
      setComments(Array.isArray(data.comments) ? data.comments : []);
    } catch (err: any) {
      setCommentError(err.message || "failed");
    }
  }

  useEffect(() => {
    void loadComments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.taskId]);

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

  async function postComment(event: React.FormEvent) {
    event.preventDefault();
    if (!commentBody.trim()) return;
    setPostingComment(true);
    setCommentError(null);
    try {
      const res = await fetch(`/api/tasks/${params.taskId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: commentBody.trim() })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) {
          throw new Error("unauthorized");
        }
        throw new Error(data?.reason || data?.status || "failed");
      }
      setCommentBody("");
      if (data?.comment) {
        setComments((prev) => [...prev, data.comment]);
      } else {
        await loadComments();
      }
    } catch (err: any) {
      setCommentError(err.message || "failed");
    } finally {
      setPostingComment(false);
    }
  }

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
        body: JSON.stringify({
          human_id: humanId,
          ...(humanTestToken ? { human_test_token: humanTestToken } : {})
        })
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

  async function applyToTask(event: React.FormEvent) {
    event.preventDefault();
    if (!task) return;
    if (task.status !== "open") return;
    if (!humanId) return;
    if (!applyCoverLetter.trim() || !applyAvailability.trim()) return;

    setApplying(true);
    setApplyError(null);
    try {
      const payload: any = {
        human_id: humanId,
        cover_letter: applyCoverLetter.trim(),
        availability: applyAvailability.trim()
      };
      if (humanTestToken) payload.human_test_token = humanTestToken;
      if (applyCounterBudget.trim()) payload.counter_budget_usd = Number(applyCounterBudget);

      const res = await fetch(`/api/tasks/${task.id}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.reason || data?.status || "failed");

      // Reload task details
      const qs = new URLSearchParams();
      qs.set("lang", lang);
      if (humanId) qs.set("human_id", humanId);
      const tRes = await fetch(`/api/tasks/${params.taskId}?${qs.toString()}`);
      const tData = await tRes.json();
      setTask(tData.task);

      setApplyCoverLetter("");
      setApplyAvailability("");
      setApplyCounterBudget("");
    } catch (err: any) {
      setApplyError(err.message || "failed");
    } finally {
      setApplying(false);
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
  const isAssignedToMe = Boolean(task.human_id && humanId && task.human_id === humanId);
  const canActAsHuman = isLoggedIn || Boolean(humanId && humanTestToken);
  const canApply = canActAsHuman && task.status === "open" && Boolean(humanId);

  return (
    <div className="task-detail-grid">
      <div className="task-detail-main">
        <div className="card task-detail-hero">
          <div className="task-detail-topline">
            <div className="task-chips">
              <span className="task-chip">
                {task.task_label ? TASK_LABEL_TEXT[task.task_label][lang] : strings.any}
              </span>
              {task.origin_country && <span className="task-chip">{task.origin_country}</span>}
              <span className="task-chip">{deliverable}</span>
              {task.deadline_at && (
                <span className="task-chip">
                  {strings.deadline}{" "}
                  {new Date(task.deadline_at).toLocaleDateString(lang, {
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit"
                  })}
                </span>
              )}
            </div>
            <span className="status-pill">{task.status}</span>
          </div>

          <h1 className="task-detail-title">{task.task_display || task.task}</h1>
          <p className="muted task-detail-submeta">
            {strings.posted}{" "}
            {task.created_at ? formatRelativeTime(task.created_at, lang) : ""}
          </p>
        </div>

        <div className="card task-detail-section">
          <h3>{strings.taskDescription}</h3>
          <p className="muted">
            {showTranslationPending ? strings.translationPending : strings.bestEffort}
          </p>
          {task.acceptance_criteria && (
            <p className="task-detail-body">{task.acceptance_criteria}</p>
          )}
        </div>

        <div className="card task-detail-section">
          <h3>{strings.taskRequirements}</h3>
          <ul className="task-detail-list">
            <li>
              {strings.deliverable}: {deliverable}
            </li>
            <li>
              {strings.location}: {task.location || strings.any}
            </li>
            {task.not_allowed && <li>{strings.notAllowed}: {task.not_allowed}</li>}
          </ul>
          {task.status === "failed" && task.failure_reason && (
            <p className="muted">
              {strings.failureReason}: {task.failure_reason}
            </p>
          )}
        </div>

        <div className="card task-detail-section">
          <h3>{strings.taskComments}</h3>

          {!isLoggedIn && (
            <div className="comment-login-callout">
              <p className="muted">{strings.commentLoginOnly}</p>
              <a className="text-link" href={`/auth?lang=${lang}`}>
                {strings.signIn}
              </a>
            </div>
          )}

          {isLoggedIn && (
            <form className="comment-form" onSubmit={postComment}>
              <textarea
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                placeholder={strings.commentPlaceholder}
                rows={3}
              />
              <div className="row">
                <button type="submit" disabled={postingComment || !commentBody.trim()}>
                  {postingComment ? strings.saving : strings.commentPost}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => loadComments()}
                  disabled={postingComment}
                >
                  {strings.refresh}
                </button>
              </div>
            </form>
          )}

          {commentError && (
            <p className="muted">
              {strings.failed}: {commentError}
            </p>
          )}

          {comments.length === 0 && !commentError && <p className="muted">{strings.noMessages}</p>}
          <div className="comment-list">
            {comments.map((c) => (
              <article key={c.id} className="comment-item">
                <div className="comment-head">
                  <p className="comment-author">{c.human_name || c.human_id}</p>
                  <p className="muted">{new Date(c.created_at).toLocaleString(lang)}</p>
                </div>
                <p className="comment-body">{c.body}</p>
              </article>
            ))}
          </div>
        </div>

        {canActAsHuman && isAssignedToMe && (task.status === "accepted" || task.status === "completed") && (
          <div className="card task-detail-section">
            <h3>{strings.contactChannelsTitle}</h3>
            {contactLoading && <p className="muted">{strings.loading}</p>}
            {contactError && (
              <p className="muted">
                {strings.failed}: {contactError}
              </p>
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
              {messages.length === 0 && !contactLoading && (
                <p className="muted">{strings.noMessages}</p>
              )}
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
                {channelStatus !== "open" && <p className="muted">{strings.channelNotOpenHint}</p>}
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
      </div>

      <aside className="task-detail-side">
        <div className="card task-side-card">
          <div className="task-price-amount">${task.budget_usd}</div>
          <div className="task-price-sub">{strings.payout}</div>
          <p className="muted">net ${netPayout}</p>
        </div>

        <div className="card task-side-card">
          <h3>{strings.location}</h3>
          <p className="muted">{task.location || strings.any}</p>
        </div>

        <div className="card task-side-card">
          <h3>{strings.status}</h3>
          <p className="muted">{task.status}</p>
        </div>

        <div className="card task-side-card">
          <h3>{strings.applyTitle}</h3>

          {task.status !== "open" && <p className="muted">{strings.applyClosed}</p>}

          {task.status === "open" && !canApply && (
            <div className="comment-login-callout">
              <p className="muted">{strings.needAccount}</p>
              <a className="text-link" href={`/auth?lang=${lang}`}>
                {strings.signIn}
              </a>
            </div>
          )}

          {task.status === "open" && canApply && (
            <form className="task-apply-form" onSubmit={applyToTask}>
              <label>
                {strings.coverLetter} *
                <textarea
                  value={applyCoverLetter}
                  onChange={(e) => setApplyCoverLetter(e.target.value)}
                  rows={5}
                  placeholder={strings.commentPlaceholder}
                />
              </label>
              <label>
                {strings.availability} *
                <input
                  value={applyAvailability}
                  onChange={(e) => setApplyAvailability(e.target.value)}
                  placeholder={lang === "ja" ? "例: 平日19-22時 / 週末" : "e.g. Weekdays 7-10pm"}
                />
              </label>
              <label>
                {strings.counterOffer}
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={applyCounterBudget}
                  onChange={(e) => setApplyCounterBudget(e.target.value)}
                  placeholder={`$${task.budget_usd}`}
                />
              </label>
              <div className="row">
                <button
                  type="button"
                  className="button-neutral"
                  onClick={() => {
                    setApplyCoverLetter("");
                    setApplyAvailability("");
                    setApplyCounterBudget("");
                    setApplyError(null);
                  }}
                  disabled={applying}
                >
                  {strings.cancel}
                </button>
                <button
                  type="submit"
                  disabled={applying || !applyCoverLetter.trim() || !applyAvailability.trim()}
                >
                  {applying ? strings.saving : strings.apply}
                </button>
              </div>
              {applyError && (
                <p className="muted">
                  {strings.failed}: {applyError}
                </p>
              )}
            </form>
          )}
        </div>

        {canActAsHuman && isAssignedToMe && task.status === "accepted" && (
          <form className="card task-side-card" onSubmit={onSubmit}>
            <h3>{strings.deliverTask}</h3>
            {deliverable === "text" && (
              <label>
                {strings.text}
                <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} />
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
            <button type="submit" disabled={status === "saving" || !canSubmit}>
              {status === "saving" ? strings.loading : strings.submit}
            </button>
            {validationError && (
              <p className="muted">
                {strings.failed}: {validationError}
              </p>
            )}
            {status === "error" && error && (
              <p className="muted">
                {strings.failed}: {error}
              </p>
            )}
            {status === "done" && <p className="muted">{strings.submitted}</p>}
          </form>
        )}

        <div className="card task-side-card">
          <a href={`/tasks?lang=${lang}`} className="text-link">
            {strings.backToTasks}
          </a>
        </div>
      </aside>
    </div>
  );
}
