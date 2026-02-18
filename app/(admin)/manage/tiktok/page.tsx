import Link from "next/link";
import { redirect } from "next/navigation";
import { assertAdminPageAccess } from "@/lib/admin-auth";
import { isTikTokMarketingEnabled } from "@/lib/tiktok-auth";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function pickFirst(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}

export default async function ManageTikTokPage(props: { searchParams: SearchParams }) {
  const access = await assertAdminPageAccess();
  if (!access.ok) {
    const qs = new URLSearchParams();
    qs.set("next", "/manage/tiktok");
    redirect(`/auth?${qs.toString()}`);
  }

  const searchParams = await props.searchParams;
  const status = pickFirst(searchParams.status);
  const reason = pickFirst(searchParams.reason);
  const openId = pickFirst(searchParams.open_id);
  const scope = pickFirst(searchParams.scope);
  const expiresIn = pickFirst(searchParams.expires_in);
  const enabled = isTikTokMarketingEnabled();

  return (
    <main style={{ maxWidth: 820, margin: "24px auto", padding: "0 16px 48px" }}>
      <h1 style={{ marginBottom: 8, color: "#f3f6ff" }}>TikTok Connect (Marketing)</h1>
      <p style={{ marginTop: 0, marginBottom: 20, color: "#d2d8e8" }}>
        既存機能とは分離された管理画面です。`MARKETING_TIKTOK_ENABLED=true` の場合のみ接続できます。
      </p>

      <section
        style={{
          border: "1px solid rgba(163, 181, 216, 0.35)",
          borderRadius: 12,
          padding: 18,
          marginBottom: 16,
          background: "rgba(10, 20, 40, 0.72)",
          color: "#eef3ff"
        }}
      >
        <p style={{ marginTop: 0 }}>
          Status: <strong style={{ color: enabled ? "#3ddc97" : "#ffb366" }}>{enabled ? "enabled" : "disabled"}</strong>
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <a
            href="/api/tiktok/connect"
            style={{
              pointerEvents: enabled ? "auto" : "none",
              opacity: enabled ? 1 : 0.5,
              textDecoration: "none",
              color: "#eaf2ff",
              background: "rgba(59, 130, 246, 0.25)",
              border: "1px solid rgba(96, 165, 250, 0.9)",
              borderRadius: 8,
              padding: "8px 12px"
            }}
          >
            Connect TikTok (OAuth)
          </a>
          <a
            href="/api/tiktok/auth-url"
            style={{
              textDecoration: "none",
              color: "#f7d6a5",
              background: "rgba(249, 115, 22, 0.15)",
              border: "1px solid rgba(249, 115, 22, 0.8)",
              borderRadius: 8,
              padding: "8px 12px"
            }}
          >
            Get Auth URL (JSON)
          </a>
          <Link
            href="/manage"
            style={{
              textDecoration: "none",
              color: "#dbe7ff",
              background: "rgba(148, 163, 184, 0.16)",
              border: "1px solid rgba(148, 163, 184, 0.8)",
              borderRadius: 8,
              padding: "8px 12px"
            }}
          >
            Back to Manage
          </Link>
        </div>
      </section>

      {(status || reason) && (
        <section
          style={{
            border: "1px solid rgba(163, 181, 216, 0.35)",
            borderRadius: 12,
            padding: 16,
            color: "#eef3ff",
            background: status === "ok" ? "rgba(18, 75, 46, 0.55)" : "rgba(117, 34, 34, 0.55)"
          }}
        >
          <h2 style={{ marginTop: 0, marginBottom: 10 }}>Last Callback</h2>
          <p style={{ margin: "6px 0" }}>
            status: <strong>{status || "-"}</strong>
          </p>
          <p style={{ margin: "6px 0" }}>reason: {reason || "-"}</p>
          <p style={{ margin: "6px 0" }}>open_id: {openId || "-"}</p>
          <p style={{ margin: "6px 0" }}>scope: {scope || "-"}</p>
          <p style={{ margin: "6px 0" }}>expires_in: {expiresIn || "-"}</p>
        </section>
      )}
    </main>
  );
}
