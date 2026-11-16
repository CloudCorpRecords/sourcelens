# BUILD REPORT — sourcelens

Clean-room rebuild of `com.linkorasource/sourcing` v1.0.0
(remote-only MCP server at `https://linkorasource.com/mcp`), built
2026-10-28 as a forwarding client. Package: `@reneturcios/sourcelens`
0.1.0, registry name `io.github.CloudCorpRecords/sourcelens`.

## Surface built

Complete surface: **8 of 8 captured tools built**, no omissions.

| Tool | Required fields as served |
|------|---------------------------|
| `get_company_profile` | — (no required key) |
| `list_services` | — (no required key) |
| `get_pricing` | — (no required key) |
| `estimate_fees` | — (no required key) |
| `list_buyer_types` | — (no required key) |
| `search_guides` | `query` |
| `get_faq` | — (no required key) |
| `prepare_sourcing_brief` | `product_category`, `target_market`, `brief` |

Each served tool carries exactly the keys `name`, `title`,
`description`, `inputSchema`. Unlike some other captures, these
`inputSchema` objects carry **no** `$schema` marker: each is
`{type: "object", properties, additionalProperties: false}` plus a
`required` array on the two tools that have one, exactly as captured.
The tool literals were generated programmatically from
`harness/fixtures/linkorasource-tools-original.json` by the script at
`/tmp/laneb1-sourcelens-scratch/gen.py` (parse + re-serialise,
placeholder substitution into `src/forward.ts`) — never retyped — and
a post-generation check (the registration-integrity test suite, plus
the parity harness) confirmed the served literals deep-equal the
fixture's 8 tool objects, in order. Tools are registered via the MCP
SDK low-level Server API (`ListToolsRequestSchema` /
`CallToolRequestSchema` handlers), not McpServer+zod.

## Fixture conflicts

**None.** The spec and the fixture agree on the tools' names, titles,
descriptions and required fields (`query` for `search_guides`;
`product_category`, `target_market`, `brief` for
`prepare_sourcing_brief`; no required key for the other six) and on
property shapes.

## Labelled reconstructions (from the spec's Wire section)

- Upstream endpoint pinned: `https://linkorasource.com/mcp`.
- Env override `LINKORASOURCE_MCP_URL` — labelled reconstruction.
- The registry record declares NO headers on the remote: no auth
  header is ever sent, under any environment. Tests assert that no
  `Authorization` header (and no `X-API-Key` header) is sent with an
  empty environment, with a `LINKORASOURCE_API_KEY`-style variable
  present, and with `AUTHORIZATION` / `API_KEY` / `LINKORASOURCE_TOKEN`
  variables present.
- Error rendering `sourcelens error:` text for upstream failures —
  labelled reconstruction.
- Upstream results pass through verbatim, including `isError` and
  extra fields. tools/call is forwarded as streamable-HTTP JSON-RPC:
  initialize (protocolVersion `2025-03-26`) →
  notifications/initialized → tools/call, honouring `Mcp-Session-Id`
  when issued; plain-JSON and SSE replies are both parsed. The
  forwarding core takes an injectable fetch; tests stub the
  upstream — no live network calls in tests.

## Deviations

None.

## Lockfile

- Route: generated clean from birth in the build dir with no
  `node_modules` and no pre-existing lockfile:
  `npm install --package-lock-only --ignore-scripts --offline`.
- Parses as JSON; `name` == `@reneturcios/sourcelens`.
- Package entries: **128**.
- sha256: `e0c8a10f598a6c23af9d4943e26c48ce6249db2ea0ce5f8b8ba09a0cc4b141ca`
  (re-verified unchanged after the subsequent offline `npm install`).

## server.json

- Description exactly: "China sourcing, inspection and supplier
  verification: rates, fees, guides." — **74 characters**.
- npm package entry carries `"version": "0.1.0"`; the OCI entry
  (`ghcr.io/cloudcorprecords/sourcelens:0.1.0`) carries **no**
  `version` field. Both entries carry packageArguments
  `[{type: positional, value: mcp}]` and transport stdio. Dockerfile
  (node:20-alpine, both stages) carries the label
  `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/sourcelens"`.
  Container workflow `IMAGE` is `ghcr.io/cloudcorprecords/sourcelens`
  and its smoke test asserts the server name `sourcelens`.

## Verification (all run 2026-10-28)

1. `npx tsc --noEmit` → exit 0.
2. `npm run build` → exit 0; real `dist/` produced (cli, forward,
   index, mcp, types — .js, .d.ts, .js.map each).
3. `node dist/cli.js --version` → `0.1.0`.
4. `npm test` → **63 tests, 63 pass, 0 fail** (registration-integrity
   suite deep-equals the served tools/list against the fixture's 8
   tools, plus session handling/reuse, env override, the
   no-Authorization-header assertions under every environment,
   verbatim argument forwarding and result pass-through including
   upstream isError, SSE parsing, error rendering, MCP-layer
   validation, and CLI behaviour).
5. Parity: `python3 /home/hatch/workspace/mcp-rebuild-100/harness/parity.py --original /home/hatch/workspace/mcp-rebuild-100/harness/fixtures/linkorasource-tools-original.json --rebuild "stdio:node /home/hatch/workspace/mcp-rebuild-100/builds/sourcelens/dist/cli.js mcp" --out /home/hatch/workspace/mcp-rebuild-100/builds/sourcelens/parity-out` → **verdict PASS, parity 100.0**
   (8/8 identical, 0 missing, 0 extra, no schema diffs). Output in
   `parity-out/`.
