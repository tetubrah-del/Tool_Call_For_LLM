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
  status: "open" | "accepted" | "review_pending" | "completed" | "failed";
  failure_reason?: string | null;
  budget_usd: number;
  is_international_payout?: boolean;
  location: string | null;
  human_id?: string | null;
  origin_country?: string | null;
  deadline_at?: string | null;
  review_deadline_at?: string | null;
  created_at?: string;
};

type ContactMessage = {
  id: string;
  task_id: string;
  sender_type: "ai" | "human";
  sender_id: string;
  sender_display?: string;
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

type TaskReviewView = {
  id: string;
  task_id: string;
  reviewer_type: "ai" | "human";
  reviewee_type: "ai" | "human";
  rating_overall: number;
  comment: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
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
  const [status, setStatus] = useState<"idle" | "loading" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

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
  const [applyStatus, setApplyStatus] = useState<"unknown" | "not_applied" | "applied">(
    "unknown"
  );
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [myReview, setMyReview] = useState<TaskReviewView | null>(null);
  const [counterpartyReview, setCounterpartyReview] = useState<TaskReviewView | null>(null);
  const [reviewWindowClosed, setReviewWindowClosed] = useState(false);
  const [reviewRating, setReviewRating] = useState<number>(5);
  const [reviewComment, setReviewComment] = useState("");

  const testHumanHeaders = useMemo(() => {
    if (!humanId || !humanTestToken) return undefined;
    return {
      "x-human-id": humanId,
      "x-human-test-token": humanTestToken
    };
  }, [humanId, humanTestToken]);

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
    if (
      task.status !== "accepted" &&
      task.status !== "review_pending" &&
      task.status !== "completed"
    ) {
      return;
    }
    setContactLoading(true);
    setContactError(null);
    try {
      const res = await fetch(`/api/tasks/${task.id}/contact/messages`, {
        headers: testHumanHeaders
      });
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

  useEffect(() => {
    if (!task) return;
    void loadReviews(task);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id, task?.status, humanId, humanTestToken, isLoggedIn]);

  useEffect(() => {
    let cancelled = false;
    async function loadApplyStatus() {
      const taskId = task?.id || "";
      const taskStatus = task?.status || "";
      if (!taskId || taskStatus !== "open") {
        setApplyStatus("unknown");
        return;
      }

      const canActAsHuman = isLoggedIn || Boolean(humanId && humanTestToken);
      const canApply = canActAsHuman && Boolean(humanId);
      if (!canApply) {
        setApplyStatus("unknown");
        return;
      }

      try {
        const qs = new URLSearchParams();
        qs.set("human_id", humanId);
        const res = await fetch(`/api/tasks/${taskId}/apply?${qs.toString()}`, {
          headers: testHumanHeaders
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return;
        if (cancelled) return;
        if (data?.status === "applied") {
          setApplyStatus("applied");
          return;
        }
        if (data?.status === "not_applied") {
          setApplyStatus("not_applied");
        }
      } catch {
        // Best-effort; POST handles duplicates with 409.
      }
    }
    void loadApplyStatus();
    return () => {
      cancelled = true;
    };
  }, [task?.id, task?.status, isLoggedIn, humanId, humanTestToken, testHumanHeaders]);

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

  async function loadReviews(currentTask: Task) {
    if (!isAssignedToMe || !canActAsHuman || currentTask.status !== "completed") {
      setMyReview(null);
      setCounterpartyReview(null);
      setReviewWindowClosed(false);
      return;
    }
    setReviewLoading(true);
    setReviewError(null);
    try {
      const res = await fetch(`/api/tasks/${currentTask.id}/reviews`, {
        headers: testHumanHeaders
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.reason || data?.status || "failed");
      const nextMyReview = data?.my_review || null;
      setMyReview(nextMyReview);
      setCounterpartyReview(data?.counterparty_review || null);
      setReviewWindowClosed(Boolean(data?.review_window_closed));
      if (nextMyReview?.rating_overall) {
        setReviewRating(Number(nextMyReview.rating_overall));
      }
      setReviewComment(nextMyReview?.comment || "");
    } catch (err: any) {
      setReviewError(err.message || "failed");
    } finally {
      setReviewLoading(false);
    }
  }

  async function applyToTask(event: React.FormEvent) {
    event.preventDefault();
    if (!task) return;
    if (task.status !== "open") return;
    if (!humanId) return;
    if (applyStatus === "applied") return;
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
      if (!res.ok) {
        if (res.status === 409 && data?.reason === "already_applied") {
          setApplyStatus("applied");
          return;
        }
        throw new Error(data?.reason || data?.status || "failed");
      }
      setApplyStatus("applied");

      setApplyCoverLetter("");
      setApplyAvailability("");
      setApplyCounterBudget("");
    } catch (err: any) {
      setApplyError(err.message || "failed");
    } finally {
      setApplying(false);
    }
  }

  async function submitReview(event: React.FormEvent) {
    event.preventDefault();
    if (!task) return;
    if (!isAssignedToMe || !canActAsHuman || task.status !== "completed") return;
    setReviewSubmitting(true);
    setReviewError(null);
    try {
      const payload: any = {
        rating_overall: reviewRating,
        comment: reviewComment.trim()
      };
      if (humanId && humanTestToken) {
        payload.human_id = humanId;
        payload.human_test_token = humanTestToken;
      }
      const res = await fetch(`/api/tasks/${task.id}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.reason || data?.status || "failed");
      setMyReview(data?.my_review || null);
      setCounterpartyReview(data?.counterparty_review || null);
      setReviewWindowClosed(Boolean(data?.review_window_closed));
    } catch (err: any) {
      setReviewError(err.message || "failed");
    } finally {
      setReviewSubmitting(false);
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
  const isAssignedToMe = Boolean(task.human_id && humanId && task.human_id === humanId);
  const canActAsHuman = isLoggedIn || Boolean(humanId && humanTestToken);
  const canApply = canActAsHuman && task.status === "open" && Boolean(humanId);
  const reviewLocked = Boolean(myReview?.published_at || reviewWindowClosed);
  const statusLabel =
    task.status === "open"
      ? strings.statusOpen
      : task.status === "accepted"
        ? strings.statusAccepted
        : task.status === "review_pending"
          ? strings.statusReviewPending
          : task.status === "completed"
            ? strings.statusCompleted
            : strings.statusFailed;

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
            <span className="status-pill">{statusLabel}</span>
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

        {canActAsHuman &&
          isAssignedToMe &&
          (task.status === "accepted" ||
            task.status === "review_pending" ||
            task.status === "completed") && (
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
                    {message.sender_type === "human"
                      ? strings.me
                      : message.sender_display || strings.ai}
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
                    rows={8}
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

        {canActAsHuman && isAssignedToMe && task.status === "completed" && (
          <div className="card task-detail-section">
            <h3>{strings.reviewTitle || (lang === "ja" ? "レビュー" : "Review")}</h3>
            {reviewLoading && <p className="muted">{strings.loading}</p>}
            {reviewError && (
              <p className="muted">
                {strings.failed}: {reviewError}
              </p>
            )}
            {reviewWindowClosed && (
              <p className="muted">
                {strings.reviewWindowClosed || (lang === "ja" ? "レビュー期間は終了しました。" : "Review window is closed.")}
              </p>
            )}
            {!counterpartyReview && !reviewWindowClosed && (
              <p className="muted">
                {strings.reviewCounterpartyHidden ||
                  (lang === "ja"
                    ? "相手のレビューは双方投稿または期限到来まで非表示です。"
                    : "Counterparty review is hidden until both sides submit or deadline passes.")}
              </p>
            )}
            <form className="task-apply-form" onSubmit={submitReview}>
              <label>
                {strings.reviewRating || (lang === "ja" ? "総合評価" : "Overall rating")}
                <select
                  value={reviewRating}
                  onChange={(e) => setReviewRating(Number(e.target.value))}
                  disabled={reviewLocked || reviewSubmitting}
                >
                  <option value={5}>5</option>
                  <option value={4}>4</option>
                  <option value={3}>3</option>
                  <option value={2}>2</option>
                  <option value={1}>1</option>
                </select>
              </label>
              <label>
                {strings.reviewComment || (lang === "ja" ? "コメント（任意）" : "Comment (optional)")}
                <textarea
                  value={reviewComment}
                  onChange={(e) => setReviewComment(e.target.value)}
                  rows={4}
                  maxLength={500}
                  disabled={reviewLocked || reviewSubmitting}
                />
              </label>
              <button type="submit" disabled={reviewLocked || reviewSubmitting}>
                {reviewSubmitting
                  ? strings.saving
                  : strings.reviewSubmit || (lang === "ja" ? "レビューを送信" : "Submit review")}
              </button>
            </form>
            {myReview && (
              <p className="muted">
                {strings.reviewMine || (lang === "ja" ? "あなたのレビュー" : "Your review")}:{" "}
                {myReview.rating_overall}/5
              </p>
            )}
            {counterpartyReview && (
              <p className="muted">
                {strings.reviewCounterparty || (lang === "ja" ? "相手のレビュー" : "Counterparty review")}:{" "}
                {counterpartyReview.rating_overall}/5
                {counterpartyReview.comment ? ` - ${counterpartyReview.comment}` : ""}
              </p>
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
          <p className="muted">{statusLabel}</p>
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

          {task.status === "open" && canApply && applyStatus === "applied" && (
            <div className="comment-login-callout">
              <p className="muted">{strings.appliedMessage}</p>
            </div>
          )}

          {task.status === "open" && canApply && applyStatus !== "applied" && (
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
          <div className="card task-side-card">
            <h3>{strings.deliverTask}</h3>
            <p className="muted">{strings.deliverViaMessagesHint}</p>
            <a
              className="button-link"
              href={`/me?lang=${lang}&tab=messages&task_id=${encodeURIComponent(task.id)}`}
            >
              {strings.openMessages}
            </a>
          </div>
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
