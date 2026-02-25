import Link from "next/link";

export default function BestBuyPage() {
  return (
    <main
      style={{
        maxWidth: 960,
        margin: "48px auto",
        padding: "0 16px 64px",
        color: "#e2e8f0"
      }}
    >
      <h1 style={{ fontSize: 36, marginBottom: 12, color: "#f8fafc" }}>bestbuy</h1>
      <p style={{ color: "#64748b", marginBottom: 28 }}>
        比較LPの一覧ページです。今後このページに導線を追加していきます。
      </p>

      <section
        style={{
          border: "1px solid rgba(148, 163, 184, 0.25)",
          borderRadius: 16,
          padding: 20,
          background:
            "linear-gradient(135deg, rgba(15, 23, 42, 0.86) 0%, rgba(30, 41, 59, 0.84) 100%)",
          boxShadow: "0 14px 40px rgba(2, 6, 23, 0.35)"
        }}
      >
        <h2 style={{ fontSize: 22, marginBottom: 8, color: "#e2e8f0" }}>スマートウォッチ比較LP</h2>
        <p style={{ color: "#94a3b8", marginBottom: 16 }}>
          2026年最新スマートウォッチの比較LPです。
        </p>
        <Link
          href="/bestbuy/smartwatch"
          style={{
            display: "inline-block",
            background: "linear-gradient(135deg, #1d4ed8 0%, #06b6d4 100%)",
            color: "#fff",
            textDecoration: "none",
            borderRadius: 9999,
            padding: "10px 18px",
            fontWeight: 700,
            boxShadow: "0 10px 24px rgba(14, 116, 144, 0.35)"
          }}
        >
          スマートウォッチ比較LPを見る
        </Link>
      </section>
    </main>
  );
}
