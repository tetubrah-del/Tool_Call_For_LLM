import Link from "next/link";

export default function BestBuyPage() {
  return (
    <main style={{ maxWidth: 960, margin: "48px auto", padding: "0 16px" }}>
      <h1 style={{ fontSize: 36, marginBottom: 12 }}>bestbuy</h1>
      <p style={{ color: "#475569", marginBottom: 28 }}>
        比較LPの一覧ページです。今後このページに導線を追加していきます。
      </p>

      <section
        style={{
          border: "1px solid #e2e8f0",
          borderRadius: 16,
          padding: 20,
          background: "#fff"
        }}
      >
        <h2 style={{ fontSize: 22, marginBottom: 8 }}>スマートウォッチ比較LP</h2>
        <p style={{ color: "#64748b", marginBottom: 16 }}>
          2026年最新スマートウォッチの比較LPです。
        </p>
        <Link
          href="/bestbuy/smartwatch"
          style={{
            display: "inline-block",
            background: "#0f172a",
            color: "#fff",
            textDecoration: "none",
            borderRadius: 9999,
            padding: "10px 18px",
            fontWeight: 700
          }}
        >
          スマートウォッチ比較LPを見る
        </Link>
      </section>
    </main>
  );
}
