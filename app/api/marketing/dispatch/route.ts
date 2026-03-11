import crypto from "crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireMarketingApiKey } from "@/lib/marketing-api-auth";
import { normalizeText, parseCsvList, readMarketingIdentityPolicy } from "@/lib/marketing-topic";

const DEFAULT_SLOTS = "07:30,09:00,10:30,12:00,13:30,15:00,16:30,18:00,20:00,22:00";

function getTimeZone() {
  return normalizeText(process.env.MARKETING_AUTONOMOUS_TIMEZONE, 120) || "Asia/Tokyo";
}

function getDispatchWindowMinutes() {
  const raw = Number(process.env.MARKETING_AUTONOMOUS_SLOT_WINDOW_MINUTES || 5);
  if (!Number.isFinite(raw)) return 5;
  return Math.max(1, Math.min(30, Math.trunc(raw)));
}

function getDailyLimit() {
  const raw = Number(process.env.MARKETING_AUTONOMOUS_DAILY_POST_LIMIT || 10);
  if (!Number.isFinite(raw)) return 10;
  return Math.max(1, Math.min(50, Math.trunc(raw)));
}

function getMinIntervalMinutes() {
  const raw = Number(process.env.MARKETING_AUTONOMOUS_MIN_INTERVAL_MINUTES || 45);
  if (!Number.isFinite(raw)) return 45;
  return Math.max(1, Math.min(720, Math.trunc(raw)));
}

function getLocalParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  const parts = formatter.formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${lookup.year}-${lookup.month}-${lookup.day}`,
    hour: Number(lookup.hour || 0),
    minute: Number(lookup.minute || 0),
    second: Number(lookup.second || 0)
  };
}

function parseSlots() {
  const slots = parseCsvList(process.env.MARKETING_AUTONOMOUS_SLOTS || DEFAULT_SLOTS)
    .map((slot) => {
      const match = slot.match(/^(\d{1,2}):(\d{2})$/);
      if (!match) return null;
      const hour = Number(match[1]);
      const minute = Number(match[2]);
      if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        return null;
      }
      return {
        slot,
        key: `${String(hour).padStart(2, "0")}${String(minute).padStart(2, "0")}`,
        minuteOfDay: hour * 60 + minute
      };
    })
    .filter((value): value is { slot: string; key: string; minuteOfDay: number } => Boolean(value));
  return slots.length ? slots : parseSlotsFromDefault();
}

function parseSlotsFromDefault() {
  return DEFAULT_SLOTS.split(",").map((slot) => {
    const [hourRaw, minuteRaw] = slot.split(":");
    const hour = Number(hourRaw);
    const minute = Number(minuteRaw);
    return {
      slot,
      key: `${String(hour).padStart(2, "0")}${String(minute).padStart(2, "0")}`,
      minuteOfDay: hour * 60 + minute
    };
  });
}

function pickActiveSlot(now: Date, timeZone: string) {
  const parts = getLocalParts(now, timeZone);
  const nowMinuteOfDay = parts.hour * 60 + parts.minute;
  const windowMinutes = getDispatchWindowMinutes();
  const slots = parseSlots();
  for (const slot of slots) {
    if (Math.abs(slot.minuteOfDay - nowMinuteOfDay) <= windowMinutes) {
      return {
        ...slot,
        localDate: parts.date
      };
    }
  }
  return null;
}

function hydrateRowsWithLocalDate(rows: any[], timeZone: string) {
  return rows.map((row) => {
    const publishedAt = normalizeText(row.published_at, 100);
    const localDate = publishedAt ? getLocalParts(new Date(publishedAt), timeZone).date : "";
    return {
      ...row,
      localDate
    };
  });
}

export async function POST(request: Request) {
  const authError = requireMarketingApiKey(request);
  if (authError) return authError;

  const policy = readMarketingIdentityPolicy();
  if (!policy.campaignId || !policy.personaId) {
    return NextResponse.json(
      { status: "error", reason: "identity_env_not_configured" },
      { status: 503 }
    );
  }

  const now = new Date();
  const timeZone = getTimeZone();
  const activeSlot = pickActiveSlot(now, timeZone);
  if (!activeSlot) {
    return NextResponse.json({
      status: "skipped",
      reason: "no_active_slot",
      now: now.toISOString(),
      time_zone: timeZone
    });
  }

  const db = getDb();
  const recentPostsRaw = await db
    .prepare(
      `SELECT p.id, p.published_at
       FROM marketing_posts p
       INNER JOIN marketing_contents c ON c.id = p.content_id
       WHERE p.channel = 'x'
         AND c.campaign_id = ?
         AND c.persona_id = ?
       ORDER BY p.published_at DESC
       LIMIT 50`
    )
    .all(policy.campaignId, policy.personaId);
  const recentPosts = hydrateRowsWithLocalDate(recentPostsRaw, timeZone);
  const todaysPosts = recentPosts.filter((row) => row.localDate === activeSlot.localDate);

  if (todaysPosts.length >= getDailyLimit()) {
    return NextResponse.json({
      status: "skipped",
      reason: "daily_cap_reached",
      local_date: activeSlot.localDate,
      published_count: todaysPosts.length
    });
  }

  const latestPublishedAt = normalizeText(todaysPosts[0]?.published_at, 100);
  if (latestPublishedAt) {
    const elapsedMs = now.getTime() - new Date(latestPublishedAt).getTime();
    const minIntervalMs = getMinIntervalMinutes() * 60 * 1000;
    if (elapsedMs < minIntervalMs) {
      return NextResponse.json({
        status: "skipped",
        reason: "min_interval_not_reached",
        local_date: activeSlot.localDate,
        slot_key: activeSlot.key,
        latest_published_at: latestPublishedAt
      });
    }
  }

  const slotRows = await db
    .prepare(
      `SELECT c.id, c.title, c.content_type, c.slot_key, c.planned_for,
              p.id AS post_id,
              j.id AS publish_job_id,
              j.status AS publish_job_status
       FROM marketing_contents c
       LEFT JOIN marketing_posts p
         ON p.content_id = c.id
        AND p.channel = 'x'
       LEFT JOIN marketing_publish_jobs j
         ON j.content_id = c.id
        AND j.channel = 'x'
        AND j.status IN ('queued', 'processing', 'retry')
       WHERE c.channel = 'x'
         AND c.campaign_id = ?
         AND c.persona_id = ?
         AND c.planned_for = ?
         AND c.slot_key = ?
       ORDER BY c.created_at ASC
       LIMIT 20`
    )
    .all(policy.campaignId, policy.personaId, activeSlot.localDate, activeSlot.key);

  if (slotRows.some((row: any) => row.post_id || row.publish_job_id)) {
    return NextResponse.json({
      status: "skipped",
      reason: "slot_already_handled",
      local_date: activeSlot.localDate,
      slot_key: activeSlot.key
    });
  }

  const candidate = slotRows.find((row: any) => !row.post_id && !row.publish_job_id);
  if (!candidate) {
    return NextResponse.json({
      status: "skipped",
      reason: "no_slot_content_ready",
      local_date: activeSlot.localDate,
      slot_key: activeSlot.key
    });
  }

  const jobId = crypto.randomUUID();
  const scheduledAt = now.toISOString();
  await db
    .prepare(
      `INSERT INTO marketing_publish_jobs (
         id, content_id, channel, scheduled_at, status,
         attempt_count, next_attempt_at, last_error, created_at, updated_at
       ) VALUES (?, ?, 'x', ?, 'queued', 0, NULL, NULL, ?, ?)`
    )
    .run(jobId, candidate.id, scheduledAt, scheduledAt, scheduledAt);

  await db
    .prepare(
      `UPDATE marketing_contents
       SET status = 'publish_queued',
           updated_at = ?
       WHERE id = ?`
    )
    .run(scheduledAt, candidate.id);

  return NextResponse.json(
    {
      status: "queued",
      job: {
        id: jobId,
        content_id: candidate.id,
        title: candidate.title || null,
        content_type: candidate.content_type || null,
        slot_key: activeSlot.key,
        slot_time: activeSlot.slot,
        local_date: activeSlot.localDate,
        scheduled_at: scheduledAt
      }
    },
    { status: 201 }
  );
}
