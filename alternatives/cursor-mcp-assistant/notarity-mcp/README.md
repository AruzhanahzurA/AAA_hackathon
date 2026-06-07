# Notarity MCP Server

Unified MCP server for the Notarity hackathon booking assistant. See the [root README](../README.md) for setup and demo instructions.

```bash
npm install
npm start
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Run MCP server |
| `npm run test:mcp:flow` | Spain/NIE flow through pricing |
| `npm run test:e2e` | Full Joshua Timms submit (`mode: debug`) |
| `npm run test:mcp` | MCP smoke test |

Copy `.env.example` to the repo root as `.env` and set `ANTHROPIC_API_KEY` for PDF extraction.
