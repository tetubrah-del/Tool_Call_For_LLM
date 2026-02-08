"use client";

import { useEffect, useState } from "react";
import { UI_STRINGS, type UiLang } from "@/lib/i18n";

type Inquiry = {
  id: string;
  from_name: string | null;
  from_email: string | null;
  subject: string;
  body: string;
  is_read: 0 | 1;
  created_at: string;
};

type Template = {
  id: string;
  title: string;
  body: string;
  updated_at: string;
};

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

type ContactMessage = {
  id: string;
  task_id: string;
  sender_type: "ai" | "human";
  sender_id: string;
  body: string;
  attachment_url: string | null;
  created_at: string;
  read_by_ai: 0 | 1;
  read_by_human: 0 | 1;
};

type MessagesPanelProps = {
  lang: UiLang;
};

export default function MessagesPanel({ lang }: MessagesPanelProps) {
  const strings = UI_STRINGS[lang];
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [threadMessages, setThreadMessages] = useState<ContactMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [composeBody, setComposeBody] = useState("");
  const [composeFile, setComposeFile] = useState<File | null>(null);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateTitle, setTemplateTitle] = useState("");
  const [templateBody, setTemplateBody] = useState("");
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copiedTemplateId, setCopiedTemplateId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadMessages() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/me/messages");
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      setInquiries(data.inquiries || []);
      setTemplates(data.templates || []);
      const nextChannels = data.channels || [];
      setChannels(nextChannels);
      setSelectedTaskId((current) => {
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
  }, []);

  useEffect(() => {
    async function loadThread() {
      if (!selectedTaskId) {
        setThreadMessages([]);
        return;
      }
      setThreadLoading(true);
      try {
        const res = await fetch(`/api/tasks/${selectedTaskId}/contact/messages`);
        if (!res.ok) throw new Error("failed");
        const data = await res.json();
        setThreadMessages(data.messages || []);
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

  function startEdit(template: Template) {
    setEditingTemplateId(template.id);
    setTemplateTitle(template.title);
    setTemplateBody(template.body);
  }

  function resetEditor() {
    setEditingTemplateId(null);
    setTemplateTitle("");
    setTemplateBody("");
  }

  async function saveTemplate(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const url = editingTemplateId
        ? `/api/me/message-templates/${editingTemplateId}`
        : "/api/me/message-templates";
      const method = editingTemplateId ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: templateTitle, body: templateBody })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.reason || "failed");
      }
      resetEditor();
      await loadMessages();
    } catch (err: any) {
      setError(err.message || "failed");
    } finally {
      setSaving(false);
    }
  }

  async function deleteTemplate(templateId: string) {
    setError(null);
    const current = templates;
    setTemplates((prev) => prev.filter((template) => template.id !== templateId));
    const res = await fetch(`/api/me/message-templates/${templateId}`, { method: "DELETE" });
    if (!res.ok) {
      setError(strings.failed);
      setTemplates(current);
    }
  }

  async function toggleInquiryRead(inquiryId: string, nextRead: boolean) {
    setError(null);
    const current = inquiries;
    setInquiries((prev) =>
      prev.map((inquiry) =>
        inquiry.id === inquiryId ? { ...inquiry, is_read: nextRead ? 1 : 0 } : inquiry
      )
    );
    const res = await fetch(`/api/me/messages/${inquiryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_read: nextRead })
    });
    if (!res.ok) {
      setError(strings.failed);
      setInquiries(current);
    }
  }

  async function copyTemplateBody(templateId: string, body: string) {
    try {
      await navigator.clipboard.writeText(body);
      setCopiedTemplateId(templateId);
      setTimeout(() => {
        setCopiedTemplateId((current) => (current === templateId ? null : current));
      }, 1200);
    } catch {
      setError(strings.failed);
    }
  }

  async function sendThreadMessage(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedTaskId || (!composeBody.trim() && !composeFile)) return;
    setError(null);
    setSendingMessage(true);
    try {
      const formData = new FormData();
      formData.append("body", composeBody);
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
      setComposeBody("");
      setComposeFile(null);
      const data = await res.json();
      setThreadMessages((prev) => [...prev, data.message]);
      setChannels((prev) =>
        prev.map((channel) =>
          channel.task_id === selectedTaskId
            ? { ...channel, message_count: channel.message_count + 1 }
            : channel
        )
      );
    } catch (err: any) {
      setError(err.message || "failed");
    } finally {
      setSendingMessage(false);
    }
  }

  function applyTemplateToCompose(body: string) {
    setComposeBody(body);
  }

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
                        {message.sender_type === "human" ? strings.me : strings.ai}
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
                <form className="thread-compose" onSubmit={sendThreadMessage}>
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
                    disabled={sendingMessage || (!composeBody.trim() && !composeFile)}
                  >
                    {sendingMessage ? strings.saving : strings.sendMessage}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="card messages-history-card">
        <div className="photo-list-head">
          <h3>{strings.inquiriesTitle}</h3>
          <button type="button" className="secondary" onClick={loadMessages} disabled={loading}>
            {loading ? strings.loading : strings.refresh}
          </button>
        </div>
        {error && (
          <p className="muted">
            {strings.failed}: {error}
          </p>
        )}
        {inquiries.length === 0 && !loading && <p className="muted">{strings.noInquiries}</p>}
        <div className="inquiry-list">
          {inquiries.map((inquiry) => (
            <article key={inquiry.id} className="inquiry-item">
              <div className="inquiry-head">
                <p className="inquiry-subject">{inquiry.subject}</p>
                <span className={inquiry.is_read === 1 ? "read-chip" : "unread-chip"}>
                  {inquiry.is_read === 1 ? strings.read : strings.unread}
                </span>
              </div>
              <p className="muted">
                {inquiry.from_name || "-"} / {inquiry.from_email || "-"}
              </p>
              <p>{inquiry.body}</p>
              <p className="muted">{new Date(inquiry.created_at).toLocaleString(lang)}</p>
              <div className="template-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => toggleInquiryRead(inquiry.id, inquiry.is_read !== 1)}
                >
                  {inquiry.is_read === 1 ? strings.markUnread : strings.markRead}
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="card message-template-card">
        <h3>{strings.templatesTitle}</h3>
        <form onSubmit={saveTemplate}>
          <label>
            {strings.templateTitle}
            <input
              value={templateTitle}
              onChange={(e) => setTemplateTitle(e.target.value)}
              required
            />
          </label>
          <label>
            {strings.templateBody}
            <textarea
              value={templateBody}
              onChange={(e) => setTemplateBody(e.target.value)}
              rows={5}
              required
            />
          </label>
          <div className="template-form-actions">
            <button type="submit" disabled={saving}>
              {saving
                ? strings.saving
                : editingTemplateId
                  ? strings.templateUpdate
                  : strings.templateSave}
            </button>
            {editingTemplateId && (
              <button type="button" className="secondary" onClick={resetEditor}>
                {strings.cancel}
              </button>
            )}
          </div>
        </form>

        {templates.length === 0 && !loading && <p className="muted">{strings.noTemplates}</p>}
        <div className="template-list">
          {templates.map((template) => (
            <article key={template.id} className="template-item">
              <p className="inquiry-subject">{template.title}</p>
              <p>{template.body}</p>
              <p className="muted">{new Date(template.updated_at).toLocaleString(lang)}</p>
              <div className="template-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => copyTemplateBody(template.id, template.body)}
                >
                  {copiedTemplateId === template.id ? strings.copied : strings.templateCopy}
                </button>
                <button type="button" className="secondary" onClick={() => startEdit(template)}>
                  {strings.templateEdit}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => applyTemplateToCompose(template.body)}
                  disabled={!selectedTaskId}
                >
                  {strings.templateUse}
                </button>
                <button
                  type="button"
                  className="danger-text-button"
                  onClick={() => deleteTemplate(template.id)}
                >
                  {strings.templateDelete}
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
