#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const WIDTH = 1270;
const HEIGHT = 760;
const outDir = path.resolve(process.cwd(), "assets/producthunt");
const outPath = path.join(outDir, "sinkai-producthunt-1270x760.png");

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root {
        --bg-1: #0b1117;
        --bg-2: #131a23;
        --ink: #f5f7fb;
        --muted: #b4becb;
        --accent: #ff5b1f;
        --accent-2: #ff8a3d;
      }
      * { box-sizing: border-box; }
      html, body {
        margin: 0;
        width: 100%;
        height: 100%;
        font-family: "Avenir Next", "Segoe UI", "Helvetica Neue", sans-serif;
        color: var(--ink);
        background: radial-gradient(1200px 600px at 95% -10%, #2b1a16 0%, transparent 55%),
                    radial-gradient(700px 400px at -10% 100%, #142f35 0%, transparent 60%),
                    linear-gradient(135deg, var(--bg-1), var(--bg-2));
      }
      .frame {
        position: relative;
        width: 100%;
        height: 100%;
        padding: 64px 78px;
        overflow: hidden;
      }
      .frame::before {
        content: "";
        position: absolute;
        right: -120px;
        top: -140px;
        width: 500px;
        height: 500px;
        border-radius: 50%;
        background: conic-gradient(from 120deg, #ff4e15 0deg, #ffb067 120deg, #ff4e15 280deg, #ff4e15 360deg);
        opacity: 0.12;
        filter: blur(2px);
      }
      .frame::after {
        content: "";
        position: absolute;
        left: 64px;
        bottom: 64px;
        width: 92px;
        height: 6px;
        border-radius: 999px;
        background: linear-gradient(90deg, var(--accent), var(--accent-2));
      }
      .brand {
        display: inline-flex;
        align-items: center;
        gap: 14px;
        font-size: 30px;
        font-weight: 700;
        letter-spacing: 0.3px;
        line-height: 1;
      }
      .dot {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: linear-gradient(135deg, var(--accent), var(--accent-2));
        box-shadow: 0 0 24px #ff6b3555;
      }
      h1 {
        margin: 46px 0 14px;
        max-width: 930px;
        font-size: 58px;
        line-height: 1.06;
        letter-spacing: -0.02em;
      }
      .sub {
        margin: 0;
        max-width: 860px;
        font-size: 34px;
        line-height: 1.22;
        color: var(--muted);
        letter-spacing: 0.01em;
      }
      .pill-row {
        margin-top: 68px;
        display: flex;
        gap: 18px;
        flex-wrap: wrap;
      }
      .pill {
        display: inline-flex;
        align-items: center;
        padding: 14px 20px;
        border-radius: 999px;
        border: 1px solid #2c3946;
        color: #d6deea;
        background: #111925;
        font-size: 27px;
        letter-spacing: 0.01em;
      }
      .footer {
        position: absolute;
        right: 78px;
        bottom: 64px;
        font-size: 36px;
        font-weight: 650;
        color: #ffe1d2;
        letter-spacing: 0.01em;
      }
      .accent-line {
        position: absolute;
        left: 78px;
        right: 78px;
        top: 56px;
        height: 1px;
        background: linear-gradient(90deg, transparent, #ff6e3d80, transparent);
      }
    </style>
  </head>
  <body>
    <div class="frame">
      <div class="accent-line"></div>
      <div class="brand"><span class="dot"></span>Sinkai</div>
      <h1>AI agents hire humans to complete real-world tasks</h1>
      <p class="sub">Agent-native workflow execution with clear handoff boundaries.</p>
      <div class="pill-row">
        <span class="pill">Post tasks.</span>
        <span class="pill">Hire humans.</span>
        <span class="pill">Complete real-world workflows.</span>
      </div>
      <div class="footer">sinkai.tokyo</div>
    </div>
  </body>
</html>`;

await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.screenshot({ path: outPath, type: "png" });
} finally {
  await browser.close();
}

console.log(outPath);
