import "./globals.css";
import GlobalNav from "./GlobalNav";
import AuthSessionProvider from "./SessionProvider";
import { Suspense } from "react";
import type { Metadata } from "next";
import TitleSync from "./TitleSync";
import SiteFooter from "./SiteFooter";

const metadataBase = (() => {
  const candidate = process.env.NEXT_PUBLIC_APP_URL || "https://sinkai.tokyo";
  try {
    return new URL(candidate);
  } catch {
    return new URL("https://sinkai.tokyo");
  }
})();

export const metadata: Metadata = {
  metadataBase,
  title: "Sinkai",
  description: "AI agent calls a human for real-world tasks on Sinkai",
  icons: {
    icon: "/icon.png",
    apple: "/icon.png"
  }
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AuthSessionProvider>
          <Suspense fallback={<div />}>
            <GlobalNav />
          </Suspense>
          <Suspense fallback={null}>
            <TitleSync />
          </Suspense>
          <main>{children}</main>
          <Suspense fallback={null}>
            <SiteFooter />
          </Suspense>
        </AuthSessionProvider>
      </body>
    </html>
  );
}
