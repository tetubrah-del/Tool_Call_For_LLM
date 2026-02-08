"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { normalizeLang, UI_STRINGS } from "@/lib/i18n";
import RegisterClient from "../register/RegisterClient";
import PhotosPanel from "./PhotosPanel";
import MessagesPanel from "./MessagesPanel";

type TabKey = "profile" | "photos" | "payments" | "messages" | "api";

export default function MyPageClient() {
  const searchParams = useSearchParams();
  const lang = useMemo(() => normalizeLang(searchParams.get("lang")), [searchParams]);
  const strings = UI_STRINGS[lang];
  const [activeTab, setActiveTab] = useState<TabKey>("profile");
  const formId = "profile-form";

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: "profile", label: strings.tabProfile },
    { key: "photos", label: strings.tabPhotos },
    { key: "payments", label: strings.tabPayments },
    { key: "messages", label: strings.tabMessages },
    { key: "api", label: strings.tabApi }
  ];

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
          <div className="stat-value">-</div>
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
        {activeTab === "photos" && <PhotosPanel lang={lang} />}
        {activeTab === "messages" && <MessagesPanel lang={lang} />}
        {activeTab !== "profile" && activeTab !== "photos" && activeTab !== "messages" && (
          <div className="card empty-state">{strings.comingSoon}</div>
        )}
      </section>
    </div>
  );
}
