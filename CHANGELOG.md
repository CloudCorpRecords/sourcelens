# Changelog

## 0.1.0 (2026-10-28)

- First release: a forwarding client for the hosted Linkora Source MCP server. All eight captured tools are answered locally for tools/list, and every tools/call is forwarded upstream over a streamable-HTTP JSON-RPC session (initialize, notifications/initialized, tools/call, honouring the Mcp-Session-Id header when the upstream issues one).
- Tools: `get_company_profile`, `list_services`, `get_pricing`, `estimate_fees`, `list_buyer_types`, `search_guides`, `get_faq`, `prepare_sourcing_brief` — the complete captured 8-tool surface, no omissions.
- Upstream results pass through verbatim, including the isError flag; upstream failures surface as `sourcelens error:` text results.
- One bin serves the CLI (one subcommand per tool, plus `--version`) and the stdio MCP server (`mcp` subcommand). The upstream endpoint can be overridden via `LINKORASOURCE_MCP_URL`. The registry record declares no headers on the remote, so no auth header is ever sent.
