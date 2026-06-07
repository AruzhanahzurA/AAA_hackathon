# Cursor MCP Booking Assistant (draft alternative)

Document-first notary booking in Cursor: upload a PDF, the assistant extracts fields, asks for what's missing, prices the selection, and submits to Notarity staging.

Built for the [START Hackathon Vienna '26 notarity track](samples/notarity-case.pdf).

**Open this folder** (`alternatives/cursor-mcp-assistant`) as your Cursor workspace to use the MCP config in `.cursor/`.

## What works

- Unified MCP server with booking API tools + PDF extraction + conditional form evaluation
- Live integration with `https://staging-api.notarity.com` (form, products, timeslots, price, submit)
- Condition-aware product/tag/timeslot resolution via `resolve_form_state`
- Safe testing via `mode: "debug"` and the no-email draft form (`vfniS9nfoq8nMpRqQj7Z`)
- End-to-end Joshua Timms / Spain NIE flow tested against staging

## What is mocked / manual

- No standalone web UI — demo runs in Cursor with MCP enabled
- PDF field extraction requires your own `ANTHROPIC_API_KEY` (Claude reads the document)
- Robert Stevens (POA) and Elizabeth Midgley (FlexCo) personas are supported in principle but not yet covered by automated e2e tests

## Prerequisites

- Node.js 18+
- `ANTHROPIC_API_KEY` in a `.env` file in this folder (only needed for `extract_pdf_fields`)

```bash
cp notarity-mcp/.env.example .env
# edit .env and set ANTHROPIC_API_KEY=...
```

## Install & run

From this folder:

```bash
npm install
npm start
```

Or directly in the MCP server:

```bash
cd notarity-mcp
npm install
npm start
```

### Cursor MCP

Config lives in `.cursor/mcp.json` (relative to this folder):

```json
{
  "mcpServers": {
    "notarity": {
      "command": "node",
      "args": ["notarity-mcp/server.js"],
      "cwd": "${workspaceFolder}"
    }
  }
}
```

Set `ANTHROPIC_API_KEY` in your shell or IDE environment before using PDF extraction.

### Auto-run MCP tools (no Run/Allow clicks)

1. **Open this folder as the workspace** in Cursor
2. **Reload the window** (`Cmd + Shift + P` → *Developer: Reload Window*)
3. **Cursor Settings → Agents → Run Mode** → **Auto-review** or **Allowlist**
4. Confirm `.cursor/permissions.json` allowlists the notarity MCP tools

For zero prompts during a demo, use **Run Everything** (less safe; fine on your own machine).

### Clean demo chat

- `.cursor/rules/notarity-booking-assistant.mdc` — MCP only, no repo exploration, user-facing tone
- MCP tool cards still appear in Cursor UI; collapse them when recording

## Demo prompt

> I need to book a notary appointment for Spain. Here is my NIE application: `samples/nie-application-demo-joshua_timms.pdf`

Sample persona PDFs (`samples/`):

| Persona | File |
|---------|------|
| Joshua Timms (NIE / Spain) | `samples/nie-application-demo-joshua_timms.pdf`, `samples/nie_personal_details.pdf` |
| Robert Stevens (Power of Attorney) | `samples/Robert_Stevens_sample_case.pdf` |
| Elizabeth Midgley (FlexCo / Austria) | `samples/Gesellschaftsvertrag_Midgley_Tech_EU_FlexCo.pdf` |

## MCP tools

| Tool | Purpose |
|------|---------|
| `fetch_booking_form` | Load form schema and conditions |
| `resolve_form_state` | Evaluate conditions → tags, auto-products, timeslot label, missing fields |
| `extract_pdf_fields` | Extract booking fields from a PDF |
| `fetch_products` | Resolve product definitions by tag |
| `fetch_timeslots` | Raw timeslot API (advanced) |
| `list_timeslot_options` | Next 3 days of slots, grouped, with note if more dates exist |
| `get_price` | Server-side pricing |
| `compute_confirmed_price` | Sum price lines → euros |
| `submit_appointment` | Multipart submit (payload + PDFs as base64) |

## Tests

```bash
npm test              # Spain/NIE flow through price
npm run test:e2e      # full Joshua Timms submit (mode: debug)
npm run test:mcp      # MCP smoke test
```

## Project layout

```
alternatives/cursor-mcp-assistant/
├── README.md
├── package.json
├── .cursor/                  # MCP config + booking assistant rules
├── notarity-mcp/             # MCP server + services + tests
├── sample-code/              # official Notarity reference scripts
└── samples/                  # hackathon brief + persona PDFs
```

## References

- [Hackathon challenge info](https://notarity.notion.site/PUBLIC-Hackathon-Challenge-infos-3765b831355780e7b831ccda7817c3c6)
- [Technical documentation](https://notarity.notion.site/Technical-documentation-3765b831355780608052f9999a682bff)
- Testing form (no emails): `https://staging.notarity.com/#/share/vfniS9nfoq8nMpRqQj7Z`
