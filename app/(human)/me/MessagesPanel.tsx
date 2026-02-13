"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { UI_STRINGS, type UiLang } from "@/lib/i18n";

type Channel = {
  task_id: string;
  status: "pending" | "open" | "closed";
  opened_at: string | null;
  closed_at: string | null;
  task: string;
  task_en: string | null;
  task_status: string;
  created_at: string;
  unread_count: number;
  message_count: number;
};

type TaskDetail = {
  id: string;
  status: "open" | "accepted" | "review_pending" | "completed" | "failed";
  deliverable: "photo" | "video" | "text" | null;
  created_at: string;
  approved_at: string | null;
  submission: {
    id: string;
    type: string;
    content_url: string | null;
    text: string | null;
    created_at: string;
  } | null;
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
  read_by_ai: 0 | 1;
  read_by_human: 0 | 1;
};

type ProgressEvent = {
  key: string;
  created_at: string;
  title: string;
  detail?: string;
};

type MessagesPanelProps = {
  lang: UiLang;
};

export default function MessagesPanel({ lang }: MessagesPanelProps) {
  const strings = UI_STRINGS[lang];
  const searchParams = useSearchParams();
  const preferredTaskId = (searchParams.get("task_id") || "").trim() || null;

  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<TaskDetail | null>(null);
  const [threadMessages, setThreadMessages] = useState<ContactMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [composeBody, setComposeBody] = useState("");
  const [composeFile, setComposeFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadMessages() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/me/messages");
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      const nextChannels = data.channels || [];
      setChannels(nextChannels);
      setSelectedTaskId((current) => {
        if (preferredTaskId && nextChannels.some((ch: Channel) => ch.task_id === preferredTaskId)) {
          return preferredTaskId;
        }
        if (current && nextChannels.some((ch: Channel) => ch.task_id === current)) {
          return current;
        }
        return nextChannels[0]?.task_id || null;
      });
    } catch (err: any) {
      setError(err.message || "failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferredTaskId]);

  useEffect(() => {
    async function loadThread() {
      if (!selectedTaskId) {
        setThreadMessages([]);
        setSelectedTask(null);
        return;
      }
      setThreadLoading(true);
      try {
        const [messagesRes, taskRes] = await Promise.all([
          fetch(`/api/tasks/${selectedTaskId}/contact/messages`),
          fetch(`/api/tasks?task_id=${encodeURIComponent(selectedTaskId)}`)
        ]);

        if (!messagesRes.ok) throw new Error("failed");
        const messagesData = await messagesRes.json();
        setThreadMessages(messagesData.messages || []);

        if (taskRes.ok) {
          const taskData = await taskRes.json();
          setSelectedTask(taskData.task || null);
        } else {
          setSelectedTask(null);
        }

        await fetch(`/api/tasks/${selectedTaskId}/contact/read`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({})
        });
        setChannels((prev) =>
          prev.map((channel) =>
            channel.task_id === selectedTaskId ? { ...channel, unread_count: 0 } : channel
          )
        );
      } catch (err: any) {
        setError(err.message || "failed");
      } finally {
        setThreadLoading(false);
      }
    }
    loadThread();
  }, [selectedTaskId]);

  useEffect(() => {
    setSendSuccess(null);
    setComposeBody("");
    setComposeFile(null);
  }, [selectedTaskId]);

  async function sendUnified(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedTaskId) return;
    if (!selectedTask) return;
    if (!composeBody.trim() && !composeFile) return;

    const selectedChannel = channels.find((channel) => channel.task_id === selectedTaskId) || null;
    const canSendMessage =
      Boolean(selectedChannel) &&
      selectedChannel?.status === "open" &&
      selectedTask.status === "accepted";

    setError(null);
    setSendSuccess(null);
    setSending(true);
    try {
      if (!canSendMessage) {
        throw new Error(strings.channelNotOpenHint);
      }
      const formData = new FormData();
      if (composeBody.trim()) {
        formData.append("body", composeBody.trim());
      }
      if (composeFile) {
        formData.append("file", composeFile);
      }
      const res = await fetch(`/api/tasks/${selectedTaskId}/contact/messages`, {
        method: "POST",
        body: formData
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.reason || "failed");
      }
      const data = await res.json();
      setComposeBody("");
      setComposeFile(null);
      setThreadMessages((prev) => [...prev, data.message]);
      setChannels((prev) =>
        prev.map((channel) =>
          channel.task_id === selectedTaskId
            ? { ...channel, message_count: channel.message_count + 1 }
            : channel
        )
      );
      setSendSuccess(strings.sendChannelMessage);
    } catch (err: any) {
      setError(err.message || "failed");
    } finally {
      setSending(false);
    }
  }

  const selectedChannel = channels.find((channel) => channel.task_id === selectedTaskId) || null;
  const canSendMessage =
    Boolean(selectedChannel) && selectedChannel?.status === "open" && selectedTask?.status === "accepted";
  const deliverable = selectedTask?.deliverable || "text";
  const fileAccept = "image/*";

  const progressEvents = useMemo<ProgressEvent[]>(() => {
    if (!selectedTaskId) return [];
    const events: ProgressEvent[] = [];

    if (selectedTask?.created_at) {
      events.push({
        key: `task-created-${selectedTask.id}`,
        created_at: selectedTask.created_at,
        title: strings.progressTaskCreated,
        detail: `${strings.status}: ${selectedTask.status}`
      });
    }

    if (selectedChannel?.opened_at) {
      events.push({
        key: `channel-opened-${selectedTaskId}`,
        created_at: selectedChannel.opened_at,
        title: strings.progressChannelOpened
      });
    }

    if (selectedTask?.submission?.created_at) {
      events.push({
        key: `submission-${selectedTask.submission.id}`,
        created_at: selectedTask.submission.created_at,
        title: strings.progressSubmissionStored,
        detail: selectedTask.submission.content_url
          ? strings.progressWithAttachment
          : selectedTask.submission.text || undefined
      });
    }

    for (const message of threadMessages) {
      events.push({
        key: `msg-${message.id}`,
        created_at: message.created_at,
        title:
          message.sender_type === "human"
            ? strings.progressMessageHuman
            : strings.progressMessageAi,
        detail: message.attachment_url
          ? `${message.body ? `${message.body} / ` : ""}${strings.progressWithAttachment}`
          : message.body || undefined
      });
    }

    if (selectedTask?.approved_at) {
      events.push({
        key: `approved-${selectedTask.id}`,
        created_at: selectedTask.approved_at,
        title: strings.progressTaskApproved,
        detail: `${strings.status}: ${selectedTask.status}`
      });
    }

    if (selectedChannel?.closed_at) {
      events.push({
        key: `channel-closed-${selectedTaskId}`,
        created_at: selectedChannel.closed_at,
        title: strings.progressChannelClosed
      });
    }

    return events
      .filter((event) => Boolean(event.created_at))
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }, [selectedTaskId, selectedTask, selectedChannel, threadMessages, strings]);

  return (
    <div className="messages-panel">
      <div className="card contact-channel-card">
        <h3>{strings.contactChannelsTitle}</h3>
        {channels.length === 0 && !loading && <p className="muted">{strings.noChannels}</p>}
        <div className="channel-grid">
          <div className="channel-list">
            {channels.map((channel) => (
              <button
                key={channel.task_id}
                type="button"
                className={
                  channel.task_id === selectedTaskId ? "channel-item active-channel" : "channel-item"
                }
                onClick={() => setSelectedTaskId(channel.task_id)}
              >
                <p className="inquiry-subject">{channel.task}</p>
                <p className="muted">
                  {strings.channelStatus}: {channel.status} / {strings.status}: {channel.task_status}
                </p>
                <p className="muted">
                  {strings.unread}: {channel.unread_count} / {strings.messagesCount}: {channel.message_count}
                </p>
              </button>
            ))}
          </div>
          <div className="thread-panel">
            {!selectedTaskId && <p className="muted">{strings.selectChannel}</p>}
            {selectedTaskId && (
              <>
                <div className="thread-messages">
                  {threadLoading && <p className="muted">{strings.loading}</p>}
                  {!threadLoading && threadMessages.length === 0 && (
                    <p className="muted">{strings.noMessages}</p>
                  )}
                  {threadMessages.map((message) => (
                    <article
                      key={message.id}
                      className={
                        message.sender_type === "human" ? "thread-message human-message" : "thread-message ai-message"
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
                        <img src={message.attachment_url} alt="message attachment" className="thread-image" />
                      )}
                      <p className="muted">
                        {new Date(message.created_at).toLocaleString(lang)}
                      </p>
                    </article>
                  ))}
                </div>
                {selectedTask && (
                  <div className="card">
                    <h4>{strings.unifiedSendTitle}</h4>
                    <p className="muted">
                      {strings.status}: {selectedTask.status} / {strings.deliverable}: {deliverable}
                    </p>
                    <p className="muted">{strings.aiMarksSubmissionHint}</p>

                    <form className="thread-compose" onSubmit={sendUnified}>
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
                          accept={fileAccept}
                          onChange={(e) => setComposeFile(e.target.files?.[0] || null)}
                        />
                      </label>
                      {composeFile && (
                        <div className="template-actions">
                          <p className="muted">{composeFile.name}</p>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => setComposeFile(null)}
                          >
                            {strings.removeAttachment}
                          </button>
                        </div>
                      )}
                      <button
                        type="submit"
                        disabled={
                          sending ||
                          !canSendMessage ||
                          (!composeBody.trim() && !composeFile)
                        }
                      >
                        {sending ? strings.saving : strings.sendChannelMessage}
                      </button>
                      {sendSuccess && <p className="muted">{sendSuccess}</p>}
                      {!canSendMessage && (
                        <p className="muted">{strings.channelNotOpenHint}</p>
                      )}
                    </form>
                  </div>
                )}

                <div className="card messages-history-card">
                  <div className="photo-list-head">
                    <h3>{strings.progressTitle}</h3>
                    <button type="button" className="secondary" onClick={loadMessages} disabled={loading}>
                      {loading ? strings.loading : strings.refresh}
                    </button>
                  </div>
                  {error && (
                    <p className="muted">
                      {strings.failed}: {error}
                    </p>
                  )}
                  {progressEvents.length === 0 && !loading && (
                    <p className="muted">{strings.noProgressYet}</p>
                  )}
                  <div className="inquiry-list">
                    {progressEvents.map((event) => (
                      <article key={event.key} className="inquiry-item">
                        <div className="inquiry-head">
                          <p className="inquiry-subject">{event.title}</p>
                        </div>
                        {event.detail && <p>{event.detail}</p>}
                        <p className="muted">{new Date(event.created_at).toLocaleString(lang)}</p>
                      </article>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
