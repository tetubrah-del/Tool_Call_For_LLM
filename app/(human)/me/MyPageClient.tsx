"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { normalizeLang, UI_STRINGS } from "@/lib/i18n";
import RegisterClient from "../register/RegisterClient";
import ApiPanel from "./ApiPanel";
import MessagesPanel from "./MessagesPanel";
import NotificationsPanel from "./NotificationsPanel";
import PaymentsPanel from "./PaymentsPanel";

type TabKey = "profile" | "payments" | "messages" | "notifications" | "api";

export default function MyPageClient() {
  const searchParams = useSearchParams();
  const lang = useMemo(() => normalizeLang(searchParams.get("lang")), [searchParams]);
  const strings = UI_STRINGS[lang];
  const initialTab = useMemo((): TabKey => {
    const raw = (searchParams.get("tab") || "").toLowerCase();
    if (
      raw === "payments" ||
      raw === "messages" ||
      raw === "profile" ||
      raw === "notifications" ||
      raw === "api"
    ) {
      return raw as TabKey;
    }
    return "profile";
  }, [searchParams]);
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);
  const [reviewSummary, setReviewSummary] = useState<{ avg: number | null; count: number }>({
    avg: null,
    count: 0
  });
  const formId = "profile-form";

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: "profile", label: strings.tabProfile },
    { key: "payments", label: strings.tabPayments },
    { key: "messages", label: strings.tabMessages },
    { key: "notifications", label: strings.tabNotifications },
    { key: "api", label: strings.tabApi }
  ];

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    let cancelled = false;
    async function loadReviewSummary() {
      try {
        const res = await fetch("/api/me/reviews/summary");
        const data = await res.json().catch(() => ({}));
        if (!res.ok || cancelled) return;
        const avg = Number(data?.avg_rating);
        const count = Number(data?.review_count ?? 0);
        setReviewSummary({
          avg: Number.isFinite(avg) ? avg : null,
          count: Number.isFinite(count) ? count : 0
        });
      } catch {
        // Best effort only.
      }
    }
    void loadReviewSummary();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mypage">
      <section className="stat-grid">
        <div className="stat-card">
          <div className="stat-value">2</div>
          <div className="stat-label">{strings.statsViews}</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">0</div>
          <div className="stat-label">{strings.statsAiInquiries}</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">
            {reviewSummary.count > 0 && reviewSummary.avg != null
              ? `${reviewSummary.avg.toFixed(1)} (${reviewSummary.count})`
              : "-"}
          </div>
          <div className="stat-label">{strings.statsRating}</div>
        </div>
      </section>

      <section className="dashboard-head">
        <div>
          <p className="eyebrow">{strings.dashboardEyebrow}</p>
          <h1>{strings.dashboardTitle}</h1>
        </div>
      </section>

      <nav className="tabs">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={tab.key === activeTab ? "tab tab-active" : "tab"}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <section className="panel">
        {activeTab === "profile" && (
          <div className="profile-panel">
            <RegisterClient
              title={strings.myPageTitle}
              formId={formId}
              showSubmit
              submitLabel={strings.save}
            />
          </div>
        )}
        {activeTab === "payments" && <PaymentsPanel lang={lang} />}
        {activeTab === "messages" && <MessagesPanel lang={lang} />}
        {activeTab === "notifications" && <NotificationsPanel lang={lang} />}
        {activeTab === "api" && <ApiPanel lang={lang} />}
      </section>
    </div>
  );
}
