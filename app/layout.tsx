import "./globals.css";

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
        <main>{children}</main>
      </body>
    </html>
  );
}
