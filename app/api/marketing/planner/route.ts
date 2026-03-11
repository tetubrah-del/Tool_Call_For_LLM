import crypto from "crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireMarketingApiKey } from "@/lib/marketing-api-auth";
import { normalizeText, readMarketingIdentityPolicy } from "@/lib/marketing-topic";

const DEFAULT_SLOTS = [
  "07:30",
  "09:00",
  "10:30",
  "12:00",
  "13:30",
  "15:00",
  "16:30",
  "18:00",
  "20:00",
  "22:00"
];
const DEFAULT_MIX = [
  "race_prediction",
  "race_prediction",
  "race_prediction",
  "race_prediction",
  "race_review",
  "race_review",
  "race_review",
  "famous_horse_story",
  "famous_horse_story",
  "history_trivia"
] as const;

const XAI_API_KEY = (process.env.XAI_API_KEY || "").trim();
const XAI_BASE_URL = (process.env.XAI_BASE_URL || "https://api.x.ai/v1").trim().replace(/\/$/, "");
const XAI_MODEL = (process.env.XAI_MODEL || "grok-3-mini").trim();
const XAI_TIMEOUT_MS = Number(process.env.XAI_TIMEOUT_MS || 30000);

function nowIso() {
  return new Date().toISOString();
}

function getTimeZone() {
  return normalizeText(process.env.MARKETING_AUTONOMOUS_TIMEZONE, 120) || "Asia/Tokyo";
}

function parseCsv(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getPlannerSlots() {
  const parsed = parseCsv(process.env.MARKETING_AUTONOMOUS_SLOTS || DEFAULT_SLOTS.join(","));
  return parsed.length ? parsed : DEFAULT_SLOTS.slice();
}

function getLocalDateString(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return formatter.format(date);
}

function addDays(date: Date, days: number) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function normalizeHashtags(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeText(item, 30))
    .filter(Boolean)
    .map((item) => (item.startsWith("#") ? item : `#${item}`))
    .slice(0, 4);
}

function ensureBodyLength(value: string, fallback: string) {
  const text = normalizeText(value, 5000);
  if (text.length >= 90 && text.length <= 260) return text;
  const fallbackText = normalizeText(fallback, 5000);
  return fallbackText;
}

function safeJsonStringify(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function parseJsonObjectFromText(raw: string): any | null {
  const text = normalizeText(raw, 30000);
  if (!text) return null;
  const tryParse = (value: string) => {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  };
  const direct = tryParse(text);
  if (direct && typeof direct === "object") return direct;
  const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const parsed = tryParse(stripped);
  if (parsed && typeof parsed === "object") return parsed;
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return tryParse(stripped.slice(start, end + 1));
  }
  return null;
}

function buildPersonaSpec() {
  return [
    "名前: 小雪 / Koyuki",
    "役割: 競馬アイドル兼、競馬史が好きな案内役",
    "一人称: 小雪",
    "呼びかけ: みんな / みなさん",
    "口調: 明るく親しみやすいが、情報は断定しすぎず落ち着いて述べる",
    "文体: 1投稿 2-4文、短め、読みやすさ優先。運営マニュアル調は禁止",
    "感情表現: うれしい、気になる、楽しみ、どきどき程度まで",
    "絵文字: 0-2個まで",
    "強み: 馬場傾向、脚質、追い切り、レース史、名馬エピソードをやさしく噛み砕く",
    "禁止: 未確認のオッズ、着順、時計、関係者コメントを断定しない",
    "禁止: 煽り、対立、過度な勝負師キャラ、過激な射幸心訴求",
    "初心者にも分かる言い換えを優先する"
  ].join("\n");
}

function sourceForType(contentType: string) {
  if (contentType === "race_prediction" || contentType === "race_review") {
    return {
      source_url: "https://race.netkeiba.com/top/",
      source_domain: "netkeiba.com"
    };
  }
  if (contentType === "famous_horse_story") {
    return {
      source_url: "https://www.jra.go.jp/",
      source_domain: "jra.go.jp"
    };
  }
  return {
    source_url: "https://www.keibalab.jp/",
    source_domain: "keibalab.jp"
  };
}

function fallbackDrafts(plannedFor: string, slots: string[]) {
  return slots.map((slot, index) => {
    const contentType = DEFAULT_MIX[index] || "history_trivia";
    const slotKey = slot.replace(":", "");
    const source = sourceForType(contentType);
    const titleMap: Record<string, string> = {
      race_prediction: `朝の注目メモ ${slot}`,
      race_review: `レース回顧メモ ${slot}`,
      famous_horse_story: `名馬こぼれ話 ${slot}`,
      history_trivia: `競馬史ミニ豆知識 ${slot}`
    };
    const bodyMap: Record<string, string> = {
      race_prediction:
        "小雪は、脚質の並びと馬場の通り道を先に見たいです。人気だけで決めずに、前走でどこから脚を使ったか、追い切りで反応が鈍っていないかまで合わせて見たいですね。初心者のみなさんは、まず先行できそうかどうかから確認すると流れがつかみやすいです。",
      race_review:
        "小雪は、着順だけでなく展開と位置取りの噛み合わせを振り返りたいです。早めに動いた馬が苦しくなったのか、それとも内外の通り道で差が出たのかを分けて見ると、次走で見直せる馬が見つかりやすいです。",
      famous_horse_story:
        "名馬の強さは数字だけでなく、どう勝ったかの記憶にも残ります。小雪は、その時代の勝ち方や愛された理由を、今のレースを見るヒントにつながる形でやさしく拾っていきたいです。",
      history_trivia:
        "昔の競馬を知ると、今のレースの見え方も少し変わります。小雪は、歴史の話を豆知識で終わらせず、今のコースやレースの見どころにつながる形で届けたいです。"
    };

    return {
      slot,
      slot_key: slotKey,
      planned_for: plannedFor,
      content_type: contentType,
      title: titleMap[contentType] || `小雪メモ ${slot}`,
      body_text: bodyMap[contentType] || "小雪の競馬メモです。",
      hashtags: ["#競馬", "#小雪競馬メモ"],
      source_url: source.source_url,
      source_domain: source.source_domain
    };
  });
}

function buildPlannerPrompt(params: { plannedFor: string; slots: string[] }) {
  return [
    "あなたは日本語のSNSプランナー兼コピーライターです。",
    "翌日分の競馬X投稿下書きを10本、JSONのみで返してください。",
    "",
    "キャラ仕様:",
    buildPersonaSpec(),
    "",
    `対象日: ${params.plannedFor}`,
    `投稿スロット: ${params.slots.join(", ")}`,
    "投稿配分:",
    "- race_prediction x4",
    "- race_review x3",
    "- famous_horse_story x2",
    "- history_trivia x1",
    "",
    "制約:",
    "- 各要素は slot, slot_key, planned_for, content_type, title, body_text, hashtags, source_url, source_domain を持つ",
    "- slot_key は HHMM",
    "- body_text は日本語で 90-220 文字程度",
    "- race_prediction は脚質 / 馬場 / 追い切り / 前走内容のどれか1つを根拠として必ず含める",
    "- race_review は展開 / 位置取り / 馬場差のどれか1つを根拠として必ず含める",
    "- famous_horse_story と history_trivia は今の競馬の見方につながる一文を必ず入れる",
    "- 幼すぎる語り口は禁止。\"ワクワク\" \"どきどき\" の多用は禁止",
    "- 初心者にも分かる短い言い換えを入れる",
    "- 未確認のオッズ、着順、時計は断定しない",
    "- source_url は必ず実在しそうな詳細パスではなく、安定したトップ/案内ページURLを使う",
    "- race_prediction / race_review は netkeiba.com or jra.go.jp を source に使う",
    "- famous_horse_story は jra.go.jp を source に使う",
    "- history_trivia は keibalab.jp or jra.go.jp を source に使う",
    "- hashtags は 0-3 個",
    "- 説明文は禁止。必ず有効なJSONのみ返す",
    "",
    "出力スキーマ:",
    "{",
    '  "drafts": [',
    "    {",
    '      "slot": "07:30",',
    '      "slot_key": "0730",',
    `      "planned_for": "${params.plannedFor}",`,
    '      "content_type": "race_prediction",',
    '      "title": "string",',
    '      "body_text": "string",',
    '      "hashtags": ["#競馬"],',
    '      "source_url": "https://...",',
    '      "source_domain": "netkeiba.com"',
    "    }",
    "  ]",
    "}"
  ].join("\n");
}

async function generateDraftsWithXai(plannedFor: string, slots: string[]) {
  if (!XAI_API_KEY || !XAI_MODEL) {
    return {
      provider: "template",
      status: "disabled",
      drafts: fallbackDrafts(plannedFor, slots),
      raw_response_json: null
    };
  }

  const requestBody = {
    model: XAI_MODEL,
    temperature: 0.7,
    messages: [
      {
        role: "system",
        content: "You are a careful Japanese social media planner. Reply with valid JSON only."
      },
      {
        role: "user",
        content: buildPlannerPrompt({ plannedFor, slots })
      }
    ]
  };

  try {
    const response = await fetch(`${XAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${XAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(XAI_TIMEOUT_MS)
    });
    const rawText = await response.text();
    const rawJson = parseJsonObjectFromText(rawText);
    if (!response.ok) {
      return {
        provider: "template",
        status: `xai_http_${response.status}`,
        drafts: fallbackDrafts(plannedFor, slots),
        raw_response_json: safeJsonStringify(rawJson || { raw: rawText })
      };
    }

    const completionText = normalizeText(
      rawJson?.choices?.[0]?.message?.content ||
        (Array.isArray(rawJson?.choices?.[0]?.message?.content)
          ? rawJson.choices[0].message.content.map((item: any) => item?.text || item?.content || "").join("\n")
          : ""),
      30000
    );
    const output = parseJsonObjectFromText(completionText);
    const drafts = Array.isArray(output?.drafts) ? output.drafts : [];
    if (!drafts.length) {
      return {
        provider: "template",
        status: "xai_invalid_json",
        drafts: fallbackDrafts(plannedFor, slots),
        raw_response_json: safeJsonStringify(rawJson || { raw: rawText })
      };
    }

    return {
      provider: "xai_grok",
      status: "ok",
      drafts,
      raw_response_json: safeJsonStringify(rawJson || { raw: rawText })
    };
  } catch (error: any) {
    return {
      provider: "template",
      status: normalizeText(error?.message || error?.name || "xai_request_failed", 120),
      drafts: fallbackDrafts(plannedFor, slots),
      raw_response_json: null
    };
  }
}

function normalizeDraft(raw: any, fallback: any, plannedFor: string) {
  const contentType = normalizeText(raw?.content_type, 80) || fallback.content_type;
  const source = sourceForType(contentType);
  const fallbackBody = fallback.body_text;
  return {
    slot: normalizeText(raw?.slot, 10) || fallback.slot,
    slot_key: normalizeText(raw?.slot_key, 10) || fallback.slot_key,
    planned_for: normalizeText(raw?.planned_for, 40) || plannedFor,
    content_type: contentType,
    title: normalizeText(raw?.title, 300) || fallback.title,
    body_text: ensureBodyLength(normalizeText(raw?.body_text, 5000), fallbackBody),
    hashtags: normalizeHashtags(raw?.hashtags),
    source_url: source.source_url,
    source_domain: source.source_domain
  };
}

export async function POST(request: Request) {
  const authError = requireMarketingApiKey(request);
  if (authError) return authError;

  const policy = readMarketingIdentityPolicy();
  if (!policy.campaignId || !policy.personaId) {
    return NextResponse.json({ status: "error", reason: "identity_env_not_configured" }, { status: 503 });
  }

  const payload: any = await request.json().catch(() => ({}));
  const timeZone = getTimeZone();
  const targetDate =
    normalizeText(payload?.planned_for, 40) ||
    getLocalDateString(addDays(new Date(), 1), timeZone);
  const slots = getPlannerSlots();

  const db = getDb();
  const existingRows = await db
    .prepare(
      `SELECT id, slot_key, content_type
       FROM marketing_contents
       WHERE campaign_id = ?
         AND persona_id = ?
         AND planned_for = ?
       ORDER BY slot_key ASC, created_at ASC`
    )
    .all(policy.campaignId, policy.personaId, targetDate);

  if (existingRows.length >= slots.length) {
    return NextResponse.json({
      status: "skipped",
      reason: "planner_already_seeded",
      planned_for: targetDate,
      existing_count: existingRows.length
    });
  }

  const generated = await generateDraftsWithXai(targetDate, slots);
  const fallbackDraftList = fallbackDrafts(targetDate, slots);
  const existingSlotSet = new Set(existingRows.map((row: any) => normalizeText(row.slot_key, 10)));
  const now = nowIso();
  const created: any[] = [];

  for (let index = 0; index < slots.length; index += 1) {
    const fallback = fallbackDraftList[index];
    if (existingSlotSet.has(fallback.slot_key)) continue;
    const rawDraft = Array.isArray(generated.drafts) ? generated.drafts[index] : null;
    const draft = normalizeDraft(rawDraft, fallback, targetDate);
    const contentId = crypto.randomUUID();
    const metadata = {
      campaign_id: policy.campaignId,
      persona_id: policy.personaId,
      content_type: draft.content_type,
      slot_key: draft.slot_key,
      planned_for: draft.planned_for,
      planner_provider: generated.provider,
      planner_status: generated.status
    };
    await db
      .prepare(
        `INSERT INTO marketing_contents (
           id, brief_id, channel, format, title, body_text, asset_manifest_json,
           hashtags_json, metadata_json, version, status, campaign_id, persona_id,
           content_type, slot_key, planned_for, product_url, source_context_json,
           created_at, updated_at
         ) VALUES (?, 'koyuki-keiba-planner', 'x', 'text', ?, ?, NULL, ?, ?, 1, 'approved', ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
      )
      .run(
        contentId,
        draft.title,
        draft.body_text,
        JSON.stringify(draft.hashtags),
        JSON.stringify(metadata),
        policy.campaignId,
        policy.personaId,
        draft.content_type,
        draft.slot_key,
        draft.planned_for,
        JSON.stringify({
          source_url: draft.source_url,
          source_domain: draft.source_domain,
          planned_by: "koyuki_keiba_planner",
          planner_provider: generated.provider
        }),
        now,
        now
      );

    created.push({
      id: contentId,
      slot_key: draft.slot_key,
      slot: draft.slot,
      planned_for: draft.planned_for,
      content_type: draft.content_type,
      title: draft.title,
      source_domain: draft.source_domain
    });
  }

  return NextResponse.json(
    {
      status: "ok",
      planned_for: targetDate,
      provider: generated.provider,
      provider_status: generated.status,
      created_count: created.length,
      existing_count: existingRows.length,
      contents: created
    },
    { status: 201 }
  );
}
