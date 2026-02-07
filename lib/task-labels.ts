export const TASK_LABELS = [
  "real_world_verification",
  "jp_local_research",
  "ai_output_qa",
  "bot_blocker_ops",
  "lead_prep"
] as const;

export type TaskLabel = (typeof TASK_LABELS)[number];

export function normalizeTaskLabel(value: unknown): TaskLabel | null {
  if (typeof value !== "string") return null;
  return TASK_LABELS.includes(value as TaskLabel) ? (value as TaskLabel) : null;
}

export const TASK_LABEL_TEXT: Record<TaskLabel, { en: string; ja: string }> = {
  real_world_verification: {
    en: "Real-world verification",
    ja: "現地確認"
  },
  jp_local_research: {
    en: "JP local research",
    ja: "日本語ローカル調査"
  },
  ai_output_qa: {
    en: "AI output QA",
    ja: "AI出力QA"
  },
  bot_blocker_ops: {
    en: "Bot-blocker ops",
    ja: "bot不可領域補助"
  },
  lead_prep: {
    en: "Lead prep",
    ja: "リード前処理"
  }
};
