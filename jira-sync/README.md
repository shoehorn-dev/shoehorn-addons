# Jira Sync

Shoehorn addon that fetches Jira issues and displays them in a dashboard widget.

**Tier**: scripted | **Runtime**: quickjs

## What it does

- **Backend**: Fetches issues from Jira REST API via `ctx.http`, syncs on a cron schedule
- **Frontend**: Dashboard widget showing issues table with sorting, status badges, priority badges
- **Routes**: `/ping`, `/sync` (POST), `/issues`, `/config`

## Configuration

Set in the Shoehorn Admin UI (`/admin/addons/jira-sync`):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `jira_base_url` | text | yes | e.g. `https://yourorg.atlassian.net` |
| `jira_email` | text | yes | Jira account email |
| `jira_api_token` | secret | yes | Jira API token (stored encrypted) |
| `jira_project` | text | no | Project key (default: `PROJ`) |

## Development

```bash
npm install
npm run build       # dist/addon.js + dist/frontend.js
npm run typecheck   # Verify types
```

## Structure

```
src/
  index.ts                      # Backend: sync + route handlers
  frontend.ts                   # Frontend: widget exports
  components/
    JiraIssuesWidget.ts         # Dashboard widget (vanilla JS)
manifest.json                   # Addon manifest
esbuild.config.mjs              # Dual-bundle build config
```

## Publishing

```bash
shoehorn addon publish --dir .
# Or from the repo root:
# shoehorn addon publish --dir addons/jira-sync
```
