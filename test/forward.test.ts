import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import {
  SourcelensClient,
  callTool,
  createClient,
  DEFAULT_ENDPOINT_URL,
  isKnownTool,
  parseRpcBody,
  PROTOCOL_VERSION,
  TOOL_DEFS,
  TOOL_NAMES,
  VERSION,
} from "../src/forward.js";
import { handleCallTool } from "../src/mcp.js";
import type {
  FetchFn,
  FetchResponseLike,
  ToolDef,
  ToolResult,
} from "../src/types.js";

/**
 * Every test runs against a stubbed JSON-RPC upstream that
 * implements the streamable-HTTP session flow
 * (initialize -> notifications/initialized -> tools/call):
 * no live network, and the real Linkora Source endpoint is
 * never contacted.
 */

const FIXTURE_URL = new URL(
  "../../../harness/fixtures/linkorasource-tools-original.json",
  import.meta.url,
);
const FIXTURE_AVAILABLE = existsSync(FIXTURE_URL);
const fixture = (
  FIXTURE_AVAILABLE
    ? JSON.parse(readFileSync(FIXTURE_URL, "utf-8"))
    : { tools: [] }
) as {
  tools: ToolDef[];
};
/**
 * Publish-survival guard (Wave 25 preflight, proven Wave 24 pattern):
 * the parity fixture lives in the build harness, outside the published
 * repo tree, so fixture-dependent tests skip cleanly when it is absent;
 * with the fixture present they run in full, with no skips.
 */
function skipWithoutFixture(t: {
  skip: (message: string) => void;
}): boolean {
  if (FIXTURE_AVAILABLE) return false;
  t.skip("parity fixture lives in the build harness, not the repo tree");
  return true;
}


const PROFILE = "get_company_profile";
const SERVICES = "list_services";
const PRICING = "get_pricing";
const FEES = "estimate_fees";
const BUYERS = "list_buyer_types";
const GUIDES = "search_guides";
const FAQ = "get_faq";
const BRIEF = "prepare_sourcing_brief";
const ALL_TOOLS = [PROFILE, SERVICES, PRICING, FEES, BUYERS, GUIDES, FAQ, BRIEF];

const SAMPLE_RESULT = {
  content: [{ type: "text", text: "{\"profile\":\"Linkora Source, Jinhua\"}" }],
  structuredContent: { profile: "Linkora Source, Jinhua" },
};

const SAMPLE_ARGS = { query: "supplier verification" };

const BRIEF_ARGS = {
  product_category: "Stainless steel kitchenware",
  target_market: "United States, Amazon FBA",
  brief: "Stainless steel kitchenware sets, 500 units, needed by March, verify the factory.",
};

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

interface FakeOptions {
  callResult?: Record<string, unknown>;
  callBodyText?: string;
  callError?: Record<string, unknown>;
  callStatus?: number;
  initError?: Record<string, unknown>;
  throwOn?: "initialize" | "tools/call";
  sessionId?: string | null;
  hangOnCall?: boolean;
  sse?: boolean;
}

function makeResponse(
  status: number,
  bodyText: string,
  headers: Record<string, string> = {},
): FetchResponseLike {
  const lowered = new Map(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => lowered.get(name.toLowerCase()) ?? null },
    text: async () => bodyText,
  };
}

function jsonResponse(
  status: number,
  payload: unknown,
  headers: Record<string, string> = {},
) {
  return makeResponse(status, JSON.stringify(payload), headers);
}

function makeUpstream(options: FakeOptions = {}): {
  fetchFn: FetchFn;
  calls: Captured[];
} {
  const calls: Captured[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    const body = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
    calls.push({ url, headers: init?.headers ?? {}, body });
    const method = body.method as string;
    if (options.throwOn === method) throw new Error("socket hang up");
    if (method === "initialize") {
      if (options.initError !== undefined) {
        return jsonResponse(200, {
          jsonrpc: "2.0",
          id: body.id,
          error: options.initError,
        });
      }
      const headers: Record<string, string> = {};
      const sessionId =
        options.sessionId === undefined ? "sess-abc" : options.sessionId;
      if (sessionId !== null) headers["mcp-session-id"] = sessionId;
      return jsonResponse(
        200,
        {
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {},
            serverInfo: { name: "linkorasource", version: "1.0.0" },
          },
        },
        headers,
      );
    }
    if (method === "notifications/initialized") {
      return makeResponse(202, "");
    }
    if (method === "tools/call") {
      if (options.hangOnCall) {
        return new Promise<FetchResponseLike>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal) {
            if (signal.aborted) {
              reject(new Error("aborted"));
              return;
            }
            signal.addEventListener("abort", () => reject(new Error("aborted")));
          }
        });
      }
      if (options.callBodyText !== undefined) {
        return makeResponse(options.callStatus ?? 200, options.callBodyText);
      }
      if (options.callError !== undefined) {
        return jsonResponse(200, {
          jsonrpc: "2.0",
          id: body.id,
          error: options.callError,
        });
      }
      const result = options.callResult ?? SAMPLE_RESULT;
      const payload = { jsonrpc: "2.0", id: body.id, result };
      if (options.sse) {
        return makeResponse(
          200,
          `event: message\ndata: ${JSON.stringify(payload)}\n\n`,
        );
      }
      return jsonResponse(options.callStatus ?? 200, payload);
    }
    return jsonResponse(200, {});
  };
  return { fetchFn, calls };
}

function stubClient(options: FakeOptions = {}, extra: Record<string, unknown> = {}) {
  const upstream = makeUpstream(options);
  const c = new SourcelensClient({
    fetchFn: upstream.fetchFn,
    env: {},
    ...extra,
  });
  return { client: c, calls: upstream.calls };
}

function textOf(result: ToolResult): string {
  const content = result.content as Array<{ type: string; text: string }>;
  return content[0].text;
}

function methods(calls: Captured[]): string[] {
  return calls.map((c) => c.body.method as string);
}

function schemaOf(tool: ToolDef): Record<string, any> {
  return tool.inputSchema as Record<string, any>;
}

/* ------------------------------------------------------------------ */

describe("registration integrity (captured surface)", () => {
  it("serves exactly the fixture's 8 tools, deep-equal, in order", (t) => {
    if (skipWithoutFixture(t)) return;
    assert.equal(fixture.tools.length, 8);
    assert.deepEqual(TOOL_DEFS, fixture.tools);
  });

  it("serves the 8 tool names in fixture order", () => {
    assert.deepEqual(TOOL_NAMES, ALL_TOOLS);
  });

  it("carries exactly the fixture's keys on every tool", () => {
    for (const tool of TOOL_DEFS) {
      assert.deepEqual(Object.keys(tool).sort(), [
        "description",
        "inputSchema",
        "name",
        "title",
      ]);
    }
  });

  it("carries the fixture's titles verbatim", () => {
    assert.deepEqual(
      TOOL_DEFS.map((t) => t.title),
      [
        "Company profile",
        "Services and scope",
        "Published rates and payment terms",
        "Estimate fees from published rates",
        "Buyer types and fit",
        "Search guides",
        "Frequently asked questions",
        "Prepare a sourcing brief",
      ],
    );
  });

  it("carries the fixture's descriptions verbatim", (t) => {
    if (skipWithoutFixture(t)) return;
    for (let i = 0; i < TOOL_DEFS.length; i++) {
      assert.equal(TOOL_DEFS[i].description, fixture.tools[i].description);
    }
    assert.match(TOOL_DEFS[0].description, /Who Linkora Source is/);
    assert.match(TOOL_DEFS[7].description, /Nothing is submitted/);
  });

  it("search_guides requires exactly query", () => {
    assert.deepEqual(schemaOf(TOOL_DEFS[5]).required, ["query"]);
  });

  it("prepare_sourcing_brief requires product_category, target_market and brief", () => {
    assert.deepEqual(schemaOf(TOOL_DEFS[7]).required, [
      "product_category",
      "target_market",
      "brief",
    ]);
  });

  it("the other six tools carry no required key", () => {
    for (const i of [0, 1, 2, 3, 4, 6]) {
      assert.equal("required" in schemaOf(TOOL_DEFS[i]), false);
    }
  });

  it("every inputSchema is an object schema with additionalProperties false and no $schema marker", () => {
    for (const tool of TOOL_DEFS) {
      assert.equal(schemaOf(tool).type, "object");
      assert.equal(schemaOf(tool).additionalProperties, false);
      assert.equal("$schema" in schemaOf(tool), false);
    }
  });

  it("carries every fixture property, in order, for every tool", (t) => {
    if (skipWithoutFixture(t)) return;
    for (let i = 0; i < TOOL_DEFS.length; i++) {
      const served = Object.keys(schemaOf(TOOL_DEFS[i]).properties);
      const expected = Object.keys(schemaOf(fixture.tools[i]).properties);
      assert.deepEqual(served, expected);
    }
  });

  it("profile, services, pricing and buyer types take no properties", () => {
    for (const i of [0, 1, 2, 4]) {
      assert.deepEqual(schemaOf(TOOL_DEFS[i]).properties, {});
    }
  });

  it("estimate_fees carries its six published-rate inputs", () => {
    assert.deepEqual(Object.keys(schemaOf(TOOL_DEFS[3]).properties), [
      "order_value_usd",
      "supplier_verifications",
      "inspection_man_days",
      "basic_factory_audits",
      "extra_audit_man_days",
      "beyond_100km_of_jinhua",
    ]);
  });

  it("search_guides query is a string of at least 3 chars and limit is 1..10", () => {
    const props = schemaOf(TOOL_DEFS[5]).properties;
    assert.equal(props.query.type, "string");
    assert.equal(props.query.minLength, 3);
    assert.equal(props.limit.type, "integer");
    assert.equal(props.limit.minimum, 1);
    assert.equal(props.limit.maximum, 10);
  });

  it("prepare_sourcing_brief carries the captured enums and length bounds", () => {
    const props = schemaOf(TOOL_DEFS[7]).properties;
    assert.deepEqual(props.primary_need.enum, [
      "sourcing",
      "supplier-verification",
      "factory-audit",
      "quality-inspection",
      "delivery-coordination",
    ]);
    assert.deepEqual(props.order_value_band.enum, [
      "under-5k",
      "5k-25k",
      "25k-100k",
      "over-100k",
      "evaluating",
    ]);
    assert.deepEqual(props.language.enum, ["en", "zh"]);
    assert.equal(props.product_category.minLength, 2);
    assert.equal(props.product_category.maxLength, 160);
    assert.equal(props.brief.minLength, 30);
    assert.equal(props.brief.maxLength, 1500);
  });

  it("isKnownTool recognises the captured tools and rejects others", () => {
    for (const name of ALL_TOOLS) assert.equal(isKnownTool(name), true);
    assert.equal(isKnownTool("get_company"), false);
    assert.equal(isKnownTool("search_guide"), false);
    assert.equal(isKnownTool(""), false);
  });
});

/* ------------------------------------------------------------------ */

describe("session establishment and reuse", () => {
  it("runs initialize, notifications/initialized, then tools/call in order", async () => {
    const { client: c, calls } = stubClient();
    const out = await c.callTool(PROFILE, {});
    assert.equal(out.isError, undefined);
    assert.deepEqual(methods(calls), [
      "initialize",
      "notifications/initialized",
      "tools/call",
    ]);
    assert.ok(calls.every((call) => call.url === DEFAULT_ENDPOINT_URL));
    assert.equal(DEFAULT_ENDPOINT_URL, "https://linkorasource.com/mcp");
    for (const call of calls) {
      assert.equal(call.headers["Content-Type"], "application/json");
      assert.equal(call.headers["Accept"], "application/json, text/event-stream");
    }
    assert.equal(calls[0].headers["Mcp-Session-Id"], undefined);
    assert.equal(calls[1].headers["Mcp-Session-Id"], "sess-abc");
    assert.equal(calls[2].headers["Mcp-Session-Id"], "sess-abc");
  });

  it("sends clientInfo name sourcelens and the pinned protocol version on initialize", async () => {
    const { client: c, calls } = stubClient();
    await c.callTool(PROFILE, {});
    const initParams = calls[0].body.params as Record<string, unknown>;
    assert.equal(initParams.protocolVersion, PROTOCOL_VERSION);
    assert.equal(PROTOCOL_VERSION, "2025-03-26");
    assert.deepEqual(initParams.capabilities, {});
    assert.deepEqual(initParams.clientInfo, { name: "sourcelens", version: VERSION });
  });

  it("establishes the session lazily once and reuses it on later calls", async () => {
    const { client: c, calls } = stubClient();
    await c.callTool(PROFILE, {});
    await c.callTool(FAQ, { query: "NDA" });
    assert.deepEqual(methods(calls), [
      "initialize",
      "notifications/initialized",
      "tools/call",
      "tools/call",
    ]);
    assert.equal(calls[3].headers["Mcp-Session-Id"], "sess-abc");
    assert.notEqual(calls[2].body.id, calls[3].body.id);
  });

  it("sends no session header when the upstream issues none", async () => {
    const { client: c, calls } = stubClient({ sessionId: null });
    const out = await c.callTool(PROFILE, {});
    assert.equal(out.isError, undefined);
    assert.ok(calls.every((call) => call.headers["Mcp-Session-Id"] === undefined));
  });

  it("honours the LINKORASOURCE_MCP_URL env override", async () => {
    const upstream = makeUpstream();
    const c = new SourcelensClient({
      fetchFn: upstream.fetchFn,
      env: { LINKORASOURCE_MCP_URL: "https://staging.example.com/mcp" },
    });
    await c.callTool(PROFILE, {});
    assert.ok(
      upstream.calls.every((call) => call.url === "https://staging.example.com/mcp"),
    );
  });

  it("honours an explicit url override over the default endpoint", async () => {
    const upstream = makeUpstream();
    const c = createClient({
      fetchFn: upstream.fetchFn,
      env: {},
      url: "https://alt.example.com/mcp",
    });
    await c.callTool(PROFILE, {});
    assert.ok(upstream.calls.every((call) => call.url === "https://alt.example.com/mcp"));
  });

  it("prefers an explicit url override over the env override", async () => {
    const upstream = makeUpstream();
    const c = createClient({
      fetchFn: upstream.fetchFn,
      env: { LINKORASOURCE_MCP_URL: "https://env.example.com/mcp" },
      url: "https://explicit.example.com/mcp",
    });
    await c.callTool(PROFILE, {});
    assert.ok(
      upstream.calls.every((call) => call.url === "https://explicit.example.com/mcp"),
    );
  });

  it("falls back to the pinned endpoint when the env override is blank", async () => {
    const upstream = makeUpstream();
    const c = new SourcelensClient({
      fetchFn: upstream.fetchFn,
      env: { LINKORASOURCE_MCP_URL: "   " },
    });
    await c.callTool(PROFILE, {});
    assert.ok(upstream.calls.every((call) => call.url === DEFAULT_ENDPOINT_URL));
  });
});

/* ------------------------------------------------------------------ */

describe("no auth header is ever sent (record declares NO headers)", () => {
  it("sends no Authorization header when the environment is empty", async () => {
    const { client: c, calls } = stubClient();
    await c.callTool(PROFILE, {});
    assert.equal(calls.length, 3);
    assert.ok(calls.every((call) => call.headers["Authorization"] === undefined));
  });

  it("sends no Authorization header even when a LINKORASOURCE_API_KEY-style env var is present", async () => {
    const upstream = makeUpstream();
    const c = new SourcelensClient({
      fetchFn: upstream.fetchFn,
      env: { LINKORASOURCE_API_KEY: "some-key-42" },
    });
    await c.callTool(PROFILE, {});
    assert.ok(
      upstream.calls.every((call) => call.headers["Authorization"] === undefined),
    );
  });

  it("sends no Authorization header even when AUTHORIZATION / API_KEY env vars are present", async () => {
    const upstream = makeUpstream();
    const c = new SourcelensClient({
      fetchFn: upstream.fetchFn,
      env: { AUTHORIZATION: "Bearer x", API_KEY: "y", LINKORASOURCE_TOKEN: "z" },
    });
    await c.callTool(GUIDES, SAMPLE_ARGS);
    assert.ok(
      upstream.calls.every((call) => call.headers["Authorization"] === undefined),
    );
  });

  it("never sends an X-API-Key header either", async () => {
    const upstream = makeUpstream();
    const c = new SourcelensClient({
      fetchFn: upstream.fetchFn,
      env: { LINKORASOURCE_API_KEY: "some-key-42" },
    });
    await c.callTool(PROFILE, {});
    assert.ok(upstream.calls.every((call) => call.headers["X-API-Key"] === undefined));
  });

  it("sends only Content-Type, Accept and (when issued) Mcp-Session-Id headers", async () => {
    const { client: c, calls } = stubClient();
    await c.callTool(PROFILE, {});
    assert.deepEqual(Object.keys(calls[0].headers).sort(), [
      "Accept",
      "Content-Type",
    ]);
    assert.deepEqual(Object.keys(calls[2].headers).sort(), [
      "Accept",
      "Content-Type",
      "Mcp-Session-Id",
    ]);
  });
});

/* ------------------------------------------------------------------ */

describe("tools/call forwarding", () => {
  it("forwards a get_company_profile call verbatim", async () => {
    const { client: c, calls } = stubClient();
    await c.callTool(PROFILE, {});
    const params = calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, PROFILE);
    assert.deepEqual(params.arguments, {});
  });

  it("forwards a search_guides call with every option verbatim", async () => {
    const args = { query: "pre-shipment inspection", limit: 3 };
    const { client: c, calls } = stubClient();
    await c.callTool(GUIDES, args);
    const params = calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, GUIDES);
    assert.deepEqual(params.arguments, args);
  });

  it("forwards prepare_sourcing_brief under its own name", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    await c.callTool(BRIEF, BRIEF_ARGS);
    const params = upstream.calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, BRIEF);
    assert.deepEqual(params.arguments, BRIEF_ARGS);
  });

  it("forwards estimate_fees with its numeric inputs verbatim", async () => {
    const args = {
      order_value_usd: 20000,
      supplier_verifications: 2,
      inspection_man_days: 1,
      beyond_100km_of_jinhua: true,
    };
    const { client: c, calls } = stubClient();
    await c.callTool(FEES, args);
    const params = calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, FEES);
    assert.deepEqual(params.arguments, args);
  });

  it("passes the upstream result through verbatim, including extra fields", async () => {
    const { client: c } = stubClient();
    const out = await c.callTool(PROFILE, {});
    assert.deepEqual(out, SAMPLE_RESULT);
  });

  it("passes an upstream isError result through untouched", async () => {
    const upstreamResult = {
      content: [{ type: "text", text: "no guides found upstream" }],
      isError: true,
    };
    const { client: c } = stubClient({ callResult: upstreamResult });
    const out = await c.callTool(GUIDES, SAMPLE_ARGS);
    assert.deepEqual(out, upstreamResult);
  });

  it("reads an SSE-framed tools/call response", async () => {
    const { client: c } = stubClient({ sse: true });
    const out = await c.callTool(PROFILE, {});
    assert.equal(out.isError, undefined);
    assert.deepEqual(out, SAMPLE_RESULT);
  });

  it("the one-shot callTool helper forwards under the right tool name", async () => {
    const upstream = makeUpstream();
    const out = await callTool(
      FAQ,
      { query: "payment" },
      { fetchFn: upstream.fetchFn, env: {} },
    );
    assert.equal(out.isError, undefined);
    const params = upstream.calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, FAQ);
    assert.deepEqual(params.arguments, { query: "payment" });
  });
});

/* ------------------------------------------------------------------ */

describe("upstream failures surface as sourcelens error text", () => {
  it("maps a JSON-RPC error to `sourcelens error: <message>`", async () => {
    const { client: c } = stubClient({
      callError: { code: -32000, message: "lookup failed upstream" },
    });
    const out = await c.callTool(PROFILE, {});
    assert.equal(out.isError, true);
    assert.equal(textOf(out), "sourcelens error: lookup failed upstream");
  });

  it("maps an initialize JSON-RPC error to sourcelens error text", async () => {
    const { client: c } = stubClient({
      initError: { code: -32600, message: "bad initialize" },
    });
    const out = await c.callTool(PROFILE, {});
    assert.equal(out.isError, true);
    assert.equal(textOf(out), "sourcelens error: bad initialize");
  });

  it("maps an unparseable upstream response to a malformed-response error", async () => {
    const { client: c } = stubClient({ callBodyText: "<html>oops</html>" });
    const out = await c.callTool(PROFILE, {});
    assert.equal(out.isError, true);
    assert.equal(textOf(out), "sourcelens error: malformed response");
  });

  it("maps a response with no result object to a malformed-response error", async () => {
    const { client: c } = stubClient({
      callBodyText: '{"jsonrpc":"2.0","id":3,"result":null}',
    });
    const out = await c.callTool(PROFILE, {});
    assert.equal(out.isError, true);
    assert.equal(textOf(out), "sourcelens error: malformed response");
  });

  it("maps a non-2xx upstream status to sourcelens error text", async () => {
    const { client: c } = stubClient({ callBodyText: "internal error", callStatus: 500 });
    const out = await c.callTool(PROFILE, {});
    assert.equal(out.isError, true);
    assert.equal(textOf(out), "sourcelens error: HTTP 500");
  });

  it("maps a throwing fetch to sourcelens error text", async () => {
    const { client: c } = stubClient({ throwOn: "tools/call" });
    const out = await c.callTool(PROFILE, {});
    assert.equal(out.isError, true);
    assert.match(textOf(out), /^sourcelens error: /);
  });

  it("maps a throwing initialize fetch to sourcelens error text", async () => {
    const { client: c } = stubClient({ throwOn: "initialize" });
    const out = await c.callTool(PROFILE, {});
    assert.equal(out.isError, true);
    assert.equal(textOf(out), "sourcelens error: socket hang up");
  });

  it("maps a timed-out call to sourcelens error text", async () => {
    const { client: c } = stubClient({ hangOnCall: true }, { timeoutMs: 20 });
    const out = await c.callTool(PROFILE, {});
    assert.equal(out.isError, true);
    assert.match(textOf(out), /^sourcelens error: /);
  });
});

/* ------------------------------------------------------------------ */

describe("parseRpcBody", () => {
  it("parses plain JSON and picks the message with the matching id", () => {
    const body = '{"jsonrpc":"2.0","id":7,"result":{"ok":true}}';
    assert.deepEqual(parseRpcBody(body, 7), {
      jsonrpc: "2.0",
      id: 7,
      result: { ok: true },
    });
  });

  it("parses SSE data lines", () => {
    const body =
      'event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"ok":true}}\n\n';
    assert.deepEqual(parseRpcBody(body, 2), {
      jsonrpc: "2.0",
      id: 2,
      result: { ok: true },
    });
  });

  it("picks the matching id among several SSE messages", () => {
    const body =
      'data: {"jsonrpc":"2.0","id":1,"result":{"n":1}}\n\n' +
      'data: {"jsonrpc":"2.0","id":2,"result":{"n":2}}\n\n';
    assert.deepEqual(parseRpcBody(body, 2), {
      jsonrpc: "2.0",
      id: 2,
      result: { n: 2 },
    });
  });

  it("ignores the SSE [DONE] sentinel", () => {
    const body =
      'data: {"jsonrpc":"2.0","id":4,"result":{"ok":true}}\ndata: [DONE]\n';
    assert.deepEqual(parseRpcBody(body, 4), {
      jsonrpc: "2.0",
      id: 4,
      result: { ok: true },
    });
  });

  it("returns null for empty and unparseable bodies", () => {
    assert.equal(parseRpcBody(""), null);
    assert.equal(parseRpcBody("not json at all"), null);
    assert.equal(parseRpcBody("[1,2,3]"), null);
  });
});

/* ------------------------------------------------------------------ */

describe("MCP layer validation", () => {
  it("rejects an unknown tool with MethodNotFound before any network hop", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    await assert.rejects(
      () => handleCallTool(c, "not_a_tool", {}),
      (err: unknown) =>
        err instanceof McpError && err.code === ErrorCode.MethodNotFound,
    );
    assert.equal(upstream.calls.length, 0);
  });

  it("rejects array arguments with InvalidParams before any network hop", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    await assert.rejects(
      () => handleCallTool(c, GUIDES, ["nope"]),
      (err: unknown) =>
        err instanceof McpError && err.code === ErrorCode.InvalidParams,
    );
    assert.equal(upstream.calls.length, 0);
  });

  it("rejects string arguments with InvalidParams before any network hop", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    await assert.rejects(
      () => handleCallTool(c, GUIDES, "query=inspection"),
      (err: unknown) =>
        err instanceof McpError && err.code === ErrorCode.InvalidParams,
    );
    assert.equal(upstream.calls.length, 0);
  });

  it("forwards a valid get_company_profile call through the MCP layer unchanged", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    const out = await handleCallTool(c, PROFILE, {});
    assert.deepEqual(out, SAMPLE_RESULT);
    const params = upstream.calls[2].body.params as Record<string, unknown>;
    assert.deepEqual(params.arguments, {});
  });

  it("forwards a valid search_guides call through the MCP layer unchanged", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    const out = await handleCallTool(c, GUIDES, SAMPLE_ARGS);
    assert.deepEqual(out, SAMPLE_RESULT);
    const params = upstream.calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, GUIDES);
    assert.deepEqual(params.arguments, SAMPLE_ARGS);
  });

  it("treats omitted arguments as an empty object", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    const out = await handleCallTool(c, PROFILE, undefined);
    assert.deepEqual(out, SAMPLE_RESULT);
    const params = upstream.calls[2].body.params as Record<string, unknown>;
    assert.deepEqual(params.arguments, {});
  });
});

/* ------------------------------------------------------------------ */

describe("CLI", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

  function runCli(args: string[]) {
    return spawnSync(process.execPath, ["--import", "tsx", cliPath, ...args], {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
    });
  }

  it("--version prints 0.1.0 and exits 0", () => {
    const res = runCli(["--version"]);
    assert.equal(res.status, 0);
    assert.equal(res.stdout.trim(), "0.1.0");
    assert.equal(res.stdout.trim(), VERSION);
  });

  it("-v prints 0.1.0 and exits 0", () => {
    const res = runCli(["-v"]);
    assert.equal(res.status, 0);
    assert.equal(res.stdout.trim(), "0.1.0");
  });

  it("an unknown command prints usage on stderr and exits 2", () => {
    const res = runCli(["not-a-tool"]);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /Usage:/);
  });

  it("no command at all prints usage on stderr and exits 2", () => {
    const res = runCli([]);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /Usage:/);
  });

  it("a non-JSON argument exits 2", () => {
    const res = runCli([GUIDES, "not json"]);
    assert.equal(res.status, 2);
  });

  it("a JSON array argument exits 2", () => {
    const res = runCli([GUIDES, "[]"]);
    assert.equal(res.status, 2);
  });

  it("extra arguments after a tool exit 2", () => {
    const res = runCli([GUIDES, "{}", "extra"]);
    assert.equal(res.status, 2);
  });

  it("extra arguments after mcp exit 2", () => {
    const res = runCli(["mcp", "extra"]);
    assert.equal(res.status, 2);
  });
});
