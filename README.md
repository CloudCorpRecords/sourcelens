# sourcelens

Everything one sourcing agency publishes about itself, reachable from your own machine. sourcelens is a local forwarding client for the hosted Linkora Source MCP service: it answers `tools/list` locally from the captured tool definitions and forwards every lookup upstream, returning the published material exactly as the service sends it back.

The surface is published information only: who the agency is and how it operates, the services it offers and what each one includes, its published USD rates and payment terms, fee arithmetic worked out from those rates, the buyer types it serves, a searchable set of guides and comparisons, and its FAQ. One further tool, `prepare_sourcing_brief`, turns a buyer's requirement into a pre-filled brief link for the agency's form — it composes the link and submits nothing; the buyer opens it, adds their own contact details, and sends it themselves. Nothing is bought, booked or paid through this package.

## The tools

- **`get_company_profile`** — Who the agency is, where it operates (Jinhua, Zhejiang, China), how money flows (the buyer pays the factory directly), the buyer types it serves, what it explicitly does not do, and how to contact it. Takes no arguments.
- **`list_services`** — The four services — China sourcing agent, product inspection in China, factory audit in China and China supplier verification — each with what happens, what the buyer provides and receives, cost and timing, and what is not included. Takes no arguments.
- **`get_pricing`** — Published prices in USD: per-job checks, commission bands for a full order engagement, the monthly retainer, worked examples, exclusions, and travel and payment conditions. Takes no arguments.
- **`estimate_fees`** — Arithmetic on the published rates. Optional inputs: `order_value_usd` for the full-engagement commission, plus counts for `supplier_verifications`, `inspection_man_days`, `basic_factory_audits` and `extra_audit_man_days`, and a `beyond_100km_of_jinhua` flag (travel beyond that radius is flagged rather than priced). Returns line items, the commission band, payment timing and exclusions — an estimate, not a quotation.
- **`list_buyer_types`** — The six buyer types served (Amazon sellers, retail brands, DTC brands, wholesale importers, OEM/ODM projects, promotional-product buyers), each with explicit "fits when" and "does not fit when" conditions. Takes no arguments.
- **`search_guides`** — Search the agency's guides and comparisons (supplier verification, pre-shipment inspection, factory audits, Incoterms, samples, moulds, FBA labelling and more). `query` is required (at least 3 characters); `limit` caps the results at 1–10. Returns titles, URLs, a direct answer and the last-updated date.
- **`get_faq`** — Published answers on scope, minimum order, payment, failed inspections, refunds, NDAs, samples and what is not offered. An optional `query` keyword filters the answers.
- **`prepare_sourcing_brief`** — Compose a pre-filled brief link from `product_category`, `target_market` and `brief` (all required), with optional `primary_need`, `order_value_band` and form `language` (`en` or `zh`). Nothing is submitted, and personal details should never be placed in the arguments.

## Install and run

As an MCP server via npm:

```bash
npx -y @reneturcios/sourcelens mcp
```

MCP client configuration:

```json
{
  "mcpServers": {
    "sourcelens": {
      "command": "npx",
      "args": ["-y", "@reneturcios/sourcelens", "mcp"]
    }
  }
}
```

As a container:

```bash
docker run -i ghcr.io/cloudcorprecords/sourcelens
docker run --rm ghcr.io/cloudcorprecords/sourcelens get_pricing '{}'
```

## CLI

One binary serves both the command line and the MCP server. Each tool is a subcommand taking a single JSON string with that tool's arguments:

```bash
sourcelens get_company_profile '{}'
sourcelens estimate_fees '{"order_value_usd":20000,"inspection_man_days":2}'
sourcelens search_guides '{"query":"pre-shipment inspection","limit":3}'
sourcelens prepare_sourcing_brief '{"product_category":"Stainless steel kitchenware","target_market":"United States, Amazon FBA","brief":"Kitchenware sets, 500 units, verify the factory and inspect before shipment."}'
sourcelens --version
```

Exit codes: `0` when the forwarded call succeeds, `1` when the upstream result is an error, and `2` for usage problems such as an unknown subcommand or a malformed JSON argument.

## Configuration

- `LINKORASOURCE_MCP_URL` — Overrides the upstream endpoint. The default is the pinned hosted endpoint, `https://linkorasource.com/mcp`. (The override variable is a reconstruction added by this rebuild.)

The Linkora Source registry record declares no headers on its remote, so sourcelens sends no authentication header of any kind — lookups are keyless.

Upstream failures — a JSON-RPC error from the service, a non-2xx response, an unreadable body, or a request that fails outright — are reported to the caller as an error result whose text starts with `sourcelens error:`.

## How forwarding works

The first forwarded call opens a session: an `initialize` request (protocol version `2025-03-26`), followed by a `notifications/initialized` notification, then the `tools/call` itself. If the service answers the initialize request with an `Mcp-Session-Id` header, that value is carried on every later request, and the open session is reused for the rest of the process. Replies are accepted either as plain JSON or as server-sent events. Successful results pass through verbatim, including any `isError` flag and any extra fields the service includes.

## Development

```bash
npm install
npm run build   # tsc -> dist/ (dist/cli.js is the bin)
npm test        # tsx --test test/*.test.ts — stubbed upstream, no network
npm run dev     # run the CLI from source
```

The test suite checks the served tool list against the captured surface, exercises the session handshake and its reuse, asserts that no `Authorization` header is sent under any environment, and verifies that arguments go upstream untouched and results come back untouched.

## License

MIT — see `LICENSE`. Copyright (c) 2026 Rene Turcios.
