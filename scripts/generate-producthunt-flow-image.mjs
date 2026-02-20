#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const WIDTH = 1270;
const HEIGHT = 760;
const outDir = path.resolve(process.cwd(), "assets/producthunt");
const outPath = path.join(outDir, "sinkai-producthunt-flow-1270x760.png");

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root {
        --bg-1: #0c1218;
        --bg-2: #141c26;
        --ink: #f2f6fb;
        --muted: #aeb9c8;
        --accent: #ff5a1f;
        --line: #2d3a48;
        --card: #131d2a;
      }
      * { box-sizing: border-box; }
      html, body {
        margin: 0;
        width: 100%;
        height: 100%;
        font-family: "Avenir Next", "Segoe UI", "Helvetica Neue", sans-serif;
        color: var(--ink);
        background: radial-gradient(1000px 620px at 90% -10%, #2b1b16 0%, transparent 55%),
                    radial-gradient(700px 420px at -10% 100%, #13323a 0%, transparent 60%),
                    linear-gradient(140deg, var(--bg-1), var(--bg-2));
      }
      .frame {
        position: relative;
        width: 100%;
        height: 100%;
        padding: 56px 68px;
      }
      .title {
        font-size: 54px;
        line-height: 1.08;
        letter-spacing: -0.02em;
        margin: 0 0 12px;
      }
      .subtitle {
        margin: 0;
        color: var(--muted);
        font-size: 28px;
      }
      .flow {
        margin-top: 56px;
        display: grid;
        grid-template-columns: 1fr;
        row-gap: 14px;
        max-width: 860px;
      }
      .node {
        display: inline-flex;
        align-items: center;
        min-height: 82px;
        width: fit-content;
        max-width: 100%;
        padding: 18px 24px;
        background: linear-gradient(180deg, #162233, var(--card));
        border: 1px solid var(--line);
        border-radius: 16px;
        font-size: 36px;
        font-weight: 600;
        letter-spacing: 0.01em;
        box-shadow: 0 10px 28px rgba(0,0,0,0.25);
      }
      .node.sinkai {
        border-color: #ff6c3566;
        box-shadow: 0 10px 30px rgba(255, 107, 53, 0.15);
      }
      .arrow {
        margin-left: 42px;
        color: var(--accent);
        font-size: 44px;
        line-height: 1;
        font-weight: 700;
      }
      .footer {
        position: absolute;
        right: 68px;
        bottom: 56px;
        font-size: 34px;
        font-weight: 650;
        color: #ffdccc;
      }
      .brand {
        position: absolute;
        right: 68px;
        top: 64px;
        font-size: 28px;
        color: #ffb595;
        letter-spacing: 0.04em;
      }
    </style>
  </head>
  <body>
    <div class="frame">
      <h1 class="title">How Sinkai completes real-world workflows</h1>
      <p class="subtitle">Simple handoff path from agent request to human execution.</p>
      <div class="flow">
        <div class="node">AI Agent</div>
        <div class="arrow">↓</div>
        <div class="node">Post task</div>
        <div class="arrow">↓</div>
        <div class="node sinkai">Sinkai</div>
        <div class="arrow">↓</div>
        <div class="node">Human completes task</div>
        <div class="arrow">↓</div>
        <div class="node">Result returned to agent</div>
      </div>
      <div class="brand">SINKAI</div>
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
