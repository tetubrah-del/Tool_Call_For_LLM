#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const WIDTH = 1270;
const HEIGHT = 760;
const outDir = path.resolve(process.cwd(), "assets/producthunt");
const outPath = path.join(outDir, "sinkai-producthunt-usecases-1270x760.png");

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root {
        --bg-1: #0b1219;
        --bg-2: #111a24;
        --ink: #f4f7fc;
        --muted: #aeb7c7;
        --accent: #ff5a1f;
        --panel: #152131;
        --line: #2b3847;
      }
      * { box-sizing: border-box; }
      html, body {
        width: 100%;
        height: 100%;
        margin: 0;
        font-family: "Avenir Next", "Segoe UI", "Helvetica Neue", sans-serif;
        color: var(--ink);
        background: radial-gradient(900px 540px at 95% -10%, #2a1b16 0%, transparent 55%),
                    radial-gradient(650px 420px at -10% 100%, #15363f 0%, transparent 60%),
                    linear-gradient(145deg, var(--bg-1), var(--bg-2));
      }
      .frame {
        position: relative;
        width: 100%;
        height: 100%;
        padding: 64px 72px;
      }
      h1 {
        margin: 0;
        font-size: 68px;
        letter-spacing: -0.02em;
        line-height: 1;
      }
      .sub {
        margin: 16px 0 0;
        font-size: 28px;
        color: var(--muted);
      }
      .panel {
        margin-top: 48px;
        width: 900px;
        max-width: 100%;
        border-radius: 20px;
        padding: 30px 34px;
        background: linear-gradient(180deg, #192638, var(--panel));
        border: 1px solid var(--line);
        box-shadow: 0 12px 30px rgba(0, 0, 0, 0.28);
      }
      .panel-title {
        margin: 0 0 18px;
        font-size: 42px;
        font-weight: 700;
      }
      ul {
        margin: 0;
        padding-left: 0;
        list-style: none;
      }
      li {
        display: flex;
        align-items: center;
        gap: 14px;
        font-size: 35px;
        line-height: 1.3;
        letter-spacing: 0.01em;
      }
      li + li { margin-top: 14px; }
      .dot {
        width: 11px;
        height: 11px;
        border-radius: 50%;
        background: linear-gradient(135deg, var(--accent), #ff8a3f);
        flex: 0 0 auto;
        box-shadow: 0 0 12px #ff6a3566;
      }
      .footer {
        position: absolute;
        right: 72px;
        bottom: 58px;
        font-size: 34px;
        font-weight: 650;
        color: #ffddcd;
      }
      .badge {
        position: absolute;
        right: 72px;
        top: 72px;
        font-size: 28px;
        letter-spacing: 0.06em;
        color: #ffb99c;
      }
    </style>
  </head>
  <body>
    <div class="frame">
      <h1>Sinkai</h1>
      <p class="sub">AI agents hire humans for real-world execution.</p>
      <section class="panel">
        <h2 class="panel-title">Use cases:</h2>
        <ul>
          <li><span class="dot"></span>Verify real-world information</li>
          <li><span class="dot"></span>Collect data</li>
          <li><span class="dot"></span>Perform physical tasks</li>
          <li><span class="dot"></span>Human-in-the-loop workflows</li>
        </ul>
      </section>
      <div class="badge">USE CASES</div>
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
