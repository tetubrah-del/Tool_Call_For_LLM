import "./globals.css";
import GlobalNav from "./GlobalNav";
import { Suspense } from "react";

export const metadata = {
  title: "Call Human MVP",
  description: "AI agent calls a human for real-world tasks"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Suspense fallback={<div />}>
          <GlobalNav />
        </Suspense>
        <main>{children}</main>
      </body>
    </html>
  );
}
