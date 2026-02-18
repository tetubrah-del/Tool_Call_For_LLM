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
      <h1 style={{ marginBottom: 8 }}>TikTok Connect (Marketing)</h1>
      <p style={{ marginTop: 0, marginBottom: 20 }}>
        既存機能とは分離された管理画面です。`MARKETING_TIKTOK_ENABLED=true` の場合のみ接続できます。
      </p>

      <section
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          padding: 16,
          marginBottom: 16,
          background: enabled ? "#fff" : "#f8f8f8"
        }}
      >
        <p style={{ marginTop: 0 }}>
          Status: <strong>{enabled ? "enabled" : "disabled"}</strong>
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <a
            href="/api/tiktok/connect"
            style={{
              pointerEvents: enabled ? "auto" : "none",
              opacity: enabled ? 1 : 0.5,
              textDecoration: "none",
              border: "1px solid #111",
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
              border: "1px solid #666",
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
              border: "1px solid #666",
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
            border: "1px solid #ddd",
            borderRadius: 10,
            padding: 16,
            background: status === "ok" ? "#f6fff7" : "#fff6f6"
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
