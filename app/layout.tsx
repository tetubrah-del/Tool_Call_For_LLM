import "./globals.css";
import GlobalNav from "./GlobalNav";
import AuthSessionProvider from "./SessionProvider";
import { Suspense } from "react";
import TitleSync from "./TitleSync";

export const metadata = {
  title: "Sinkai",
  description: "AI agent calls a human for real-world tasks on Sinkai"
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
          <footer className="site-footer">
            <div className="site-footer-inner">
              <a href="/terms">利用規約</a>
              <a
                href="https://core-logic-studio.onrender.com"
                target="_blank"
                rel="noreferrer noopener"
              >
                運営会社
              </a>
            </div>
          </footer>
        </AuthSessionProvider>
      </body>
    </html>
  );
}
