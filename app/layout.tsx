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
        </AuthSessionProvider>
      </body>
    </html>
  );
}
