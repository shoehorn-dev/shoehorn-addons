# Shoehorn Addons

Official addons that ship with the Shoehorn platform. Each subdirectory is a self-contained addon with its own `manifest.json`, build config, and source code.

## Addons

| Addon | Description | Tier |
|-------|-------------|------|
| [jira-sync](./jira-sync) | Syncs Jira issues and shows them in a dashboard widget | scripted |

## Publishing

Addons are published to a running Shoehorn instance via the CLI:

```bash
cd jira-sync
npm install
npm run build
shoehorn addon publish --dir .
```

This uploads the `manifest.json`, `dist/addon.js` (backend), and `dist/frontend.js` (frontend) to the platform. Admins then configure secrets (API tokens, URLs) through the Admin UI at `/admin/addons/{slug}`.

### Required API key scopes

Publishing requires an API key with the **Addon Publisher** preset or at minimum these scopes:

| Scope | Why |
|-------|-----|
| `marketplace:admin` | Publish manifests, upload bundles, enable/disable addons |
| `admin:write` | Set addon secrets (API tokens, credentials) |

Create a key with these scopes at **Profile > Security > API Keys** using the "Addon Publisher" preset.

```bash
shoehorn auth login --server https://your-instance.example.com --token shp_svc_...
shoehorn addon publish --dir .
```

## Development

Each addon depends on `@shoehorn/addon-sdk` (linked locally from `../sdk`):

```bash
cd jira-sync
npm install        # Links SDK from ../sdk
npm run build      # Produces dist/addon.js + dist/frontend.js
npm run typecheck  # Verify types
```

## Creating a new addon

1. Create a new directory: `mkdir my-addon && cd my-addon`
2. Follow the Getting Started guide in the [SDK README](https://github.com/shoehorn-dev/shoehorn-sdk)
3. Add it to the table above
