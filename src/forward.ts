/**
 * sourcelens core: a forwarding client for the hosted
 * Linkora Source MCP server.
 *
 * No sourcing catalogue lives on this machine. tools/list
 * is answered from the literal definitions below, which
 * reproduce a live capture of the upstream server word
 * for word (name, title, description and inputSchema
 * exactly as captured). A tools/call travels upstream
 * over a streamable-HTTP JSON-RPC session: an initialize
 * POST, a notifications/initialized POST, then the
 * tools/call POST, carrying the Mcp-Session-Id response
 * header on later requests when the upstream issues one.
 * The session opens lazily on the first forwarded call
 * and is reused for the client's lifetime.
 *
 * The endpoint is pinned to https://linkorasource.com/mcp
 * and may be replaced with the LINKORASOURCE_MCP_URL
 * environment variable (that override is a labelled
 * reconstruction). The registry record declares NO
 * headers on the remote: no auth header is ever sent,
 * under any environment.
 *
 * A successful upstream result is returned exactly as
 * received, isError flag and extra fields included.
 * Failures — an upstream JSON-RPC error, a non-2xx
 * status, a body that cannot be parsed, or a fetch
 * that throws or times out — become an isError result
 * whose text begins with `sourcelens error:` (that
 * rendering is a labelled reconstruction). Replies may
 * be plain JSON or SSE (`data:` lines); the JSON-RPC
 * message whose id matches the request wins.
 */
import type {
  FetchFn,
  FetchResponseLike,
  ForwardDeps,
  ToolArgs,
  ToolDef,
  ToolResult,
} from "./types.js";

export const VERSION = "0.1.0";

export const DEFAULT_ENDPOINT_URL = "https://linkorasource.com/mcp";

export const DEFAULT_TIMEOUT_MS = 30000;

export const PROTOCOL_VERSION = "2025-03-26";

/* ------------------------------------------------------------------ */
/* Tool definitions (tools/list literals, verbatim from the live       */
/* capture in harness/fixtures/linkorasource-tools-original.json;      */
/* generated programmatically by parsing and re-serialising the        */
/* fixture JSON, never retyped)                                        */
/* ------------------------------------------------------------------ */

export const TOOL_DEFS: ToolDef[] = [
  {
    "name": "get_company_profile",
    "title": "Company profile",
    "description": "Who Linkora Source is, where it operates (Jinhua, Zhejiang, China), how money flows (buyer pays the factory directly), the buyer types it serves, what it explicitly does not do, and how to contact it. Start here to decide whether a buyer's need is in scope.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "list_services",
    "title": "Services and scope",
    "description": "The four services — China sourcing agent, product inspection in China, factory audit in China and China supplier verification — each with what happens, what the buyer provides, what the buyer receives, cost and timing, and what is not included.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "get_pricing",
    "title": "Published rates and payment terms",
    "description": "Published prices in USD: per-job checks (supplier verification, inspection per man-day, basic factory audit), commission bands for a full order engagement, the monthly retainer, worked examples, exclusions, travel and payment conditions.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "estimate_fees",
    "title": "Estimate fees from published rates",
    "description": "Arithmetic on the published rates: per-job checks and/or the commission for a given order value. Returns line items, the commission band, payment timing and exclusions. An estimate, not a quotation; travel beyond 100 km of Jinhua is flagged rather than priced.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "order_value_usd": {
          "type": "number",
          "minimum": 0,
          "description": "Order value in USD, for the full-engagement commission."
        },
        "supplier_verifications": {
          "type": "number",
          "minimum": 0,
          "description": "Number of suppliers to verify."
        },
        "inspection_man_days": {
          "type": "number",
          "minimum": 0,
          "description": "Inspection man-days. One SKU with standard sampling is typically one man-day; three SKUs on one order is one to two."
        },
        "basic_factory_audits": {
          "type": "number",
          "minimum": 0,
          "description": "Number of basic factory audits (one day on site each)."
        },
        "extra_audit_man_days": {
          "type": "number",
          "minimum": 0,
          "description": "Additional audit man-days beyond the basic scope."
        },
        "beyond_100km_of_jinhua": {
          "type": "boolean",
          "description": "True if the factory is more than 100 km from Jinhua, Zhejiang (for example in Guangdong)."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "list_buyer_types",
    "title": "Buyer types and fit",
    "description": "The six buyer types served (Amazon sellers, retail brands, DTC brands, wholesale importers, OEM/ODM projects, promotional-product buyers), each with explicit 'fits when' and 'does not fit when' conditions and the page URL. Use it to match a buyer's situation without inference.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "search_guides",
    "title": "Search guides",
    "description": "Search Linkora Source's guides and comparisons (supplier verification, pre-shipment inspection, factory audits, Incoterms, samples, moulds, FBA labelling and more). Returns titles, URLs, a direct answer and the last-updated date, for citing.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "minLength": 3,
          "description": "What the buyer is asking about, in English."
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 10,
          "description": "Maximum results (default 5)."
        }
      },
      "required": [
        "query"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "get_faq",
    "title": "Frequently asked questions",
    "description": "Published answers on scope, minimum order, payment, failed inspections, refunds, NDAs, samples, cover when the founder is away, and what is not offered (freight, customs, warehousing, design). Optionally filter by a keyword.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "Optional keyword, e.g. 'NDA', 'payment', 'failed inspection'."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "prepare_sourcing_brief",
    "title": "Prepare a sourcing brief",
    "description": "When a buyer wants a quotation, turn their requirement into a pre-filled brief link for the Linkora Source form, plus WhatsApp and email alternatives. Nothing is submitted: the buyer opens the link, adds their own name, company and email, and sends it. Never include personal details in the arguments.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "product_category": {
          "type": "string",
          "minLength": 2,
          "maxLength": 160,
          "description": "e.g. 'Stainless steel kitchenware'."
        },
        "target_market": {
          "type": "string",
          "minLength": 2,
          "maxLength": 120,
          "description": "Where the goods will be sold, e.g. 'United States, Amazon FBA'."
        },
        "brief": {
          "type": "string",
          "minLength": 30,
          "maxLength": 1500,
          "description": "Product, specifications, quantity, timing, known suppliers and what needs to be verified or decided. No personal contact details."
        },
        "primary_need": {
          "type": "string",
          "enum": [
            "sourcing",
            "supplier-verification",
            "factory-audit",
            "quality-inspection",
            "delivery-coordination"
          ]
        },
        "order_value_band": {
          "type": "string",
          "enum": [
            "under-5k",
            "5k-25k",
            "25k-100k",
            "over-100k",
            "evaluating"
          ],
          "description": "Optional; only used to work out the commission band."
        },
        "language": {
          "type": "string",
          "enum": [
            "en",
            "zh"
          ],
          "description": "Form language (default en)."
        }
      },
      "required": [
        "product_category",
        "target_market",
        "brief"
      ],
      "additionalProperties": false
    }
  }
];

export const TOOL_NAMES = TOOL_DEFS.map((t) => t.name);

/** Whether `name` belongs to the captured surface. */
export function isKnownTool(name: string): boolean {
  return TOOL_NAMES.includes(name);
}

/* ------------------------------------------------------------------ */
/* Forwarding client                                                   */
/* ------------------------------------------------------------------ */

function errorResult(detail: string): ToolResult {
  return {
    content: [{ type: "text", text: `sourcelens error: ${detail}` }],
    isError: true,
  };
}

function rpcErrorMessage(error: unknown): string {
  if (error !== null && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message !== "") return message;
    return JSON.stringify(error);
  }
  return String(error);
}

/**
 * Read a JSON-RPC response body, tolerating SSE framing.
 * Returns the message whose id matches `expectedId` when
 * present, otherwise the last parseable message, otherwise
 * null when nothing in the body parses.
 */
export function parseRpcBody(
  text: string,
  expectedId?: number,
): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const candidates: Record<string, unknown>[] = [];
  const tryPush = (payload: string): void => {
    try {
      const parsed: unknown = JSON.parse(payload);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        candidates.push(parsed as Record<string, unknown>);
      }
    } catch {
      // Not a JSON payload; skip this candidate.
    }
  };
  if (trimmed.includes("data:")) {
    for (const line of trimmed.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice("data:".length).trim();
      if (payload !== "" && payload !== "[DONE]") tryPush(payload);
    }
  } else {
    tryPush(trimmed);
  }
  if (candidates.length === 0) return null;
  if (expectedId !== undefined) {
    const match = candidates.find((c) => c.id === expectedId);
    if (match !== undefined) return match;
  }
  return candidates[candidates.length - 1];
}

async function defaultFetch(
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
): Promise<FetchResponseLike> {
  return fetch(url, init) as unknown as FetchResponseLike;
}

/**
 * A forwarding client holding a single upstream session,
 * opened lazily on first use and reused from then on
 * (for the process lifetime in the MCP server, or for a
 * single invocation in the CLI).
 */
export class SourcelensClient {
  private readonly deps: ForwardDeps;
  private sessionId: string | null = null;
  private ready = false;
  private sessionPromise: Promise<void> | null = null;
  private idCounter = 0;

  constructor(deps: ForwardDeps = {}) {
    this.deps = deps;
  }

  private fetchFn(): FetchFn {
    return this.deps.fetchFn ?? defaultFetch;
  }

  private endpointUrl(): string {
    if (this.deps.url && this.deps.url.trim() !== "") return this.deps.url.trim();
    const raw = (this.deps.env ?? process.env).LINKORASOURCE_MCP_URL;
    if (raw && raw.trim() !== "") return raw.trim();
    return DEFAULT_ENDPOINT_URL;
  }

  private timeoutMs(): number {
    if (typeof this.deps.timeoutMs === "number" && this.deps.timeoutMs > 0) {
      return this.deps.timeoutMs;
    }
    return DEFAULT_TIMEOUT_MS;
  }

  private nextId(): number {
    this.idCounter += 1;
    return this.idCounter;
  }

  private async post(
    body: unknown,
    withSession: boolean,
  ): Promise<FetchResponseLike> {
    // The registry record declares NO headers on the remote:
    // no Authorization (or any other auth) header is ever sent.
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (withSession && this.sessionId !== null) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs());
    try {
      return await this.fetchFn()(this.endpointUrl(), {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async ensureSession(): Promise<void> {
    if (this.ready) return;
    if (this.sessionPromise === null) {
      this.sessionPromise = (async () => {
        const initId = this.nextId();
        const initRes = await this.post(
          {
            jsonrpc: "2.0",
            id: initId,
            method: "initialize",
            params: {
              protocolVersion: PROTOCOL_VERSION,
              capabilities: {},
              clientInfo: { name: "sourcelens", version: VERSION },
            },
          },
          false,
        );
        const sessionId = initRes.headers.get("mcp-session-id");
        if (sessionId) this.sessionId = sessionId;
        const initText = await initRes.text();
        const initParsed = parseRpcBody(initText, initId);
        if (initParsed !== null && initParsed.error) {
          throw new Error(rpcErrorMessage(initParsed.error));
        }
        if (initRes.status < 200 || initRes.status >= 300) {
          throw new Error(`HTTP ${initRes.status}`);
        }
        if (initParsed === null && initText.trim() !== "") {
          throw new Error("malformed response");
        }
        const initializedRes = await this.post(
          { jsonrpc: "2.0", method: "notifications/initialized" },
          true,
        );
        try {
          await initializedRes.text();
        } catch {
          // Nothing needed from the notification response body.
        }
        this.ready = true;
      })();
    }
    try {
      await this.sessionPromise;
    } catch (err) {
      this.sessionPromise = null;
      this.sessionId = null;
      throw err;
    }
  }

  /** Forward one tool call; upstream failures come back as isError results. */
  async callTool(name: string, args: ToolArgs): Promise<ToolResult> {
    try {
      await this.ensureSession();
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err));
    }

    const callId = this.nextId();
    let callRes: FetchResponseLike;
    try {
      callRes = await this.post(
        {
          jsonrpc: "2.0",
          id: callId,
          method: "tools/call",
          params: { name, arguments: args ?? {} },
        },
        true,
      );
    } catch (err) {
      return errorResult(
        `request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const parsed = parseRpcBody(await callRes.text(), callId);
    if (parsed !== null && parsed.error) {
      return errorResult(rpcErrorMessage(parsed.error));
    }
    if (callRes.status < 200 || callRes.status >= 300) {
      return errorResult(`HTTP ${callRes.status}`);
    }
    if (parsed === null) return errorResult("malformed response");
    const result = parsed.result as ToolResult | undefined;
    if (result === undefined || result === null || typeof result !== "object") {
      return errorResult("malformed response");
    }
    // Hand the upstream result back exactly as received.
    return result;
  }
}

/** Build a forwarding client; tests inject a fake fetch and env through deps. */
export function createClient(deps: ForwardDeps = {}): SourcelensClient {
  return new SourcelensClient(deps);
}

/** One-shot helper: a fresh client for a single call (the CLI path). */
export async function callTool(
  name: string,
  args: ToolArgs,
  deps: ForwardDeps = {},
): Promise<ToolResult> {
  return new SourcelensClient(deps).callTool(name, args);
}
