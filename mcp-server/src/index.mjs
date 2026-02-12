import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");

function compact(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined && value !== null && value !== "")
  );
}

function readCredentials(input) {
  const accountId = input?.ai_account_id || process.env.DEFAULT_AI_ACCOUNT_ID;
  const apiKey = input?.ai_api_key || process.env.DEFAULT_AI_API_KEY;

  if (!accountId || !apiKey) {
    throw new Error("Missing ai_account_id/ai_api_key and no defaults are configured.");
  }

  return { ai_account_id: accountId, ai_api_key: apiKey };
}

async function callApi(method, path, { query, body } = {}) {
  const qs = query ? new URLSearchParams(compact(query)).toString() : "";
  const url = `${BASE_URL}${path}${qs ? `?${qs}` : ""}`;

  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = { status: "error", reason: "non_json_response" };
  }

  if (!res.ok) {
    const reason = data?.reason || data?.status || "request_failed";
    const error = new Error(`API ${method} ${path} failed: ${reason}`);
    error.details = data;
    throw error;
  }

  return data;
}

function toToolResult(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data
  };
}

const server = new McpServer({
  name: "call-human-mcp",
  version: "0.1.0"
});

server.tool(
  "connect_agent_account",
  "Create or reuse an agent account and return account_id/api_key.",
  {
    name: z.string().min(1),
    paypal_email: z.string().email()
  },
  async ({ name, paypal_email }) => {
    const data = await callApi("POST", "/api/ai/accounts", {
      body: { name, paypal_email }
    });
    return toToolResult(data);
  }
);

server.tool(
  "create_bounty",
  "Create an open task (bounty) without immediate auto-assignment.",
  {
    task: z.string().min(1),
    origin_country: z.string().min(2),
    task_label: z.enum([
      "real_world_verification",
      "jp_local_research",
      "ai_output_qa",
      "bot_blocker_ops",
      "lead_prep"
    ]),
    acceptance_criteria: z.string().min(1),
    not_allowed: z.string().min(1),
    budget_usd: z.number().positive(),
    location: z.string().optional(),
    deliverable: z.enum(["photo", "video", "text"]).optional(),
    deadline_minutes: z.number().positive().optional(),
    ai_account_id: z.string().optional(),
    ai_api_key: z.string().optional()
  },
  async (input) => {
    const credentials = readCredentials(input);
    const data = await callApi("POST", "/api/tasks", {
      body: compact({ ...input, ...credentials })
    });
    return toToolResult(data);
  }
);

server.tool(
  "call_human_fast",
  "Create a task and auto-assign to one available human when possible.",
  {
    task: z.string().min(1),
    origin_country: z.string().min(2),
    task_label: z.enum([
      "real_world_verification",
      "jp_local_research",
      "ai_output_qa",
      "bot_blocker_ops",
      "lead_prep"
    ]),
    acceptance_criteria: z.string().min(1),
    not_allowed: z.string().min(1),
    budget_usd: z.number().positive(),
    location: z.string().optional(),
    deliverable: z.enum(["photo", "video", "text"]).optional(),
    deadline_minutes: z.number().positive().optional(),
    ai_account_id: z.string().optional(),
    ai_api_key: z.string().optional()
  },
  async (input) => {
    const credentials = readCredentials(input);
    const data = await callApi("POST", "/api/call_human", {
      body: compact({ ...input, ...credentials })
    });
    return toToolResult(data);
  }
);

server.tool(
  "get_bounty",
  "Get a task's current status and submission payload by task_id.",
  {
    task_id: z.string().min(1),
    lang: z.enum(["en", "ja"]).optional()
  },
  async ({ task_id, lang }) => {
    const data = await callApi("GET", "/api/tasks", {
      query: compact({ task_id, lang })
    });
    return toToolResult(data);
  }
);

server.tool(
  "approve_bounty_completion",
  "Finalize a submitted task by requester approval (review_pending -> completed).",
  {
    task_id: z.string().min(1),
    ai_account_id: z.string().optional(),
    ai_api_key: z.string().optional()
  },
  async (input) => {
    const credentials = readCredentials(input);
    const data = await callApi("POST", `/api/tasks/${input.task_id}/approve`, {
      body: credentials
    });
    return toToolResult(data);
  }
);

server.tool(
  "list_bounties",
  "List tasks for monitoring and filtering.",
  {
    task_label: z
      .enum([
        "real_world_verification",
        "jp_local_research",
        "ai_output_qa",
        "bot_blocker_ops",
        "lead_prep"
      ])
      .optional(),
    q: z.string().optional(),
    lang: z.enum(["en", "ja"]).optional()
  },
  async ({ task_label, q, lang }) => {
    const data = await callApi("GET", "/api/tasks", {
      query: compact({ task_label, q, lang })
    });
    return toToolResult(data);
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
