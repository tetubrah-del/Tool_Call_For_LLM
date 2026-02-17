import type { MetadataRoute } from "next";

function getBaseUrl(): string {
  const candidate = process.env.NEXT_PUBLIC_APP_URL || "https://sinkai.tokyo";
  return candidate.endsWith("/") ? candidate.slice(0, -1) : candidate;
}

export default function robots(): MetadataRoute.Robots {
  const baseUrl = getBaseUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/"
      }
    ],
    sitemap: `${baseUrl}/sitemap.xml`
  };
}

