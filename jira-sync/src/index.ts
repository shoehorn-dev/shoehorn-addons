/**
 * Jira Sync - Shoehorn Addon (scripted)
 *
 * Syncs Jira issues into the Shoehorn catalog as entities.
 * Uses ctx.http for Jira REST API, ctx.entities for catalog CRUD.
 *
 * Runtime contract:
 * - Functions receive JS objects as arguments (not JSON strings)
 * - Functions return JS objects (runtime wraps in JSON.stringify automatically)
 * - Host functions available: ctx.log, ctx.config, ctx.http, ctx.entities, ctx.secrets
 */

import type { RouteRequest, RouteResponse, EntityType } from '@shoehorn-dev/addon-sdk/backend';

interface JiraIssue {
  key: string;
  fields: {
    summary: string;
    // Jira Cloud's v3 API returns this as Atlassian Document Format, not a plain string.
    description?: string | AdfNode;
    status?: { name: string };
    priority?: { name: string };
    issuetype?: { name: string };
    assignee?: { displayName: string };
    updated?: string;
  };
}

// Minimal Atlassian Document Format node shape -- just enough to walk the
// tree and pull out the `text` leaves. Full ADF has many node types; this
// only needs the plain-text content, not formatting.
interface AdfNode {
  text?: string;
  content?: AdfNode[];
}

interface JiraSearchResponse {
  issues: JiraIssue[];
  total: number;
  maxResults: number;
}

interface EntityUpsert {
  serviceId: string;
  name: string;
  type: EntityType;
  description?: string;
  tags?: string[];
  links?: { name: string; url: string; icon?: string }[];
}

interface JiraConfig {
  baseUrl: string;
  email: string;
  token: string;
  project: string;
}

// --- Config ---

function getJiraConfig(): JiraConfig {
  return {
    baseUrl: ctx.config.get('jira_base_url'),
    email: ctx.config.get('jira_email'),
    token: ctx.secrets.get('jira_api_token'),
    project: ctx.config.get('jira_project') || 'PROJ',
  };
}

// ctx.secrets.get() can throw; callers rely on config always returning.
function safeGetJiraConfig(): JiraConfig {
  try {
    return getJiraConfig();
  } catch (e) {
    ctx.log.error('Failed to read Jira configuration: ' + String(e));
    return { baseUrl: '', email: '', token: '', project: 'PROJ' };
  }
}

function getAuthHeaders(config: JiraConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  };
  if (config.email && config.token) {
    headers['Authorization'] = 'Basic ' + btoa(config.email + ':' + config.token);
  }
  return headers;
}

// --- Route Handler ---

export function handleRoute(request: RouteRequest): RouteResponse {
  ctx.log.info('Request: ' + request.method + ' ' + request.path);

  if (request.path === '/ping') {
    return { status: 200, body: { message: 'pong', addon: 'jira-sync' } };
  }

  if (request.path === '/sync' && request.method === 'POST') {
    const result = sync();
    return { status: 200, body: result };
  }

  if (request.path === '/issues') {
    return handleListIssues();
  }

  if (request.path === '/config') {
    return handleConfigStatus();
  }

  return { status: 404, body: { error: 'not found', path: request.path } };
}

function handleListIssues(): RouteResponse {
  const config = safeGetJiraConfig();
  if (!config.baseUrl) {
    return { status: 200, body: { issues: [], total: 0, error: 'jira_base_url not configured' } };
  }

  try {
    const jql = 'project=' + config.project + ' ORDER BY updated DESC';
    const fields = 'summary,status,issuetype,priority,assignee,updated';
    const url = config.baseUrl + '/rest/api/3/search/jql?jql=' + encodeURIComponent(jql) + '&maxResults=50&fields=' + fields;
    const headers = getAuthHeaders(config);

    const resp = ctx.http.request<JiraSearchResponse>('GET', url, { headers });
    if (resp.status !== 200) {
      return { status: 200, body: { issues: [], total: 0, error: 'Jira API returned ' + resp.status } };
    }

    const data = resp.body;
    if (!data || !Array.isArray(data.issues)) {
      return { status: 200, body: { issues: [], total: 0, error: 'Unexpected Jira response shape' } };
    }
    const jiraIssues = data.issues;
    const issues = jiraIssues.map((issue: JiraIssue) => ({
      key: issue.key,
      summary: issue.fields.summary || 'Untitled',
      issueType: (issue.fields.issuetype?.name || '').toLowerCase(),
      priority: (issue.fields.priority?.name || '').toLowerCase(),
      status: (issue.fields.status?.name || '').toLowerCase(),
      assignee: issue.fields.assignee?.displayName || '',
      updated: issue.fields.updated || '',
      jiraUrl: config.baseUrl + '/browse/' + issue.key,
    }));

    return { status: 200, body: { issues, total: data.total || issues.length } };
  } catch (e) {
    ctx.log.error('Failed to fetch issues from Jira: ' + String(e));
    return { status: 500, body: { error: 'Failed to fetch issues from Jira' } };
  }
}

function handleConfigStatus(): RouteResponse {
  const config = safeGetJiraConfig();
  return {
    status: 200,
    body: {
      configured: !!config.baseUrl,
      project: config.project,
      hasCredentials: !!(config.email && config.token),
    },
  };
}

// --- Sync ---

export function sync(): { synced: number; total?: number; error?: string } {
  ctx.log.info('Starting Jira sync...');

  const config = safeGetJiraConfig();
  if (!config.baseUrl) {
    // Expected steady state for an installed-but-not-yet-configured addon,
    // not an actionable failure -- logged at warn, not error, so it doesn't
    // spam the log at error level every 5 minutes.
    ctx.log.warn('jira_base_url not configured');
    return { synced: 0, error: 'jira_base_url not configured' };
  }

  try {
    const jql = 'project=' + config.project + ' ORDER BY updated DESC';
    const fields = 'summary,status,issuetype,priority,assignee,updated,description';
    const url = config.baseUrl + '/rest/api/3/search/jql?jql=' + encodeURIComponent(jql) + '&maxResults=50&fields=' + fields;
    const headers = getAuthHeaders(config);

    const resp = ctx.http.request<JiraSearchResponse>('GET', url, { headers });

    if (resp.status !== 200) {
      ctx.log.error('Jira API returned ' + resp.status);
      return { synced: 0, error: 'Jira API returned ' + resp.status };
    }

    const data = resp.body;
    if (!data || !Array.isArray(data.issues)) {
      ctx.log.error('Unexpected Jira response shape: bodyType=' + typeof data);
      return { synced: 0, error: 'Unexpected Jira response shape' };
    }
    const issues = data.issues;
    ctx.log.debug('Issues found: ' + issues.length);
    let synced = 0;

    for (let i = 0; i < issues.length; i++) {
      const issue = issues[i];
      // Entity construction is inside the try so one malformed issue can't abort the rest of the loop.
      try {
        const entity: EntityUpsert = {
          serviceId: 'jira-' + issue.key,
          name: truncateUtf8Bytes(issue.key + ': ' + (issue.fields.summary || 'Untitled'), 255),
          type: 'component',
          description: truncateUtf8Bytes(asText(issue.fields.description), 4096),
          tags: buildTags(config.project, issue),
          links: [{
            name: 'Jira',
            url: config.baseUrl + '/browse/' + issue.key,
            icon: 'Jira',
          }],
        };
        ctx.entities.upsert(entity);
        synced = synced + 1;
      } catch (e) {
        ctx.log.error('Failed to upsert ' + (issue && issue.key) + ': ' + String(e));
      }
    }

    ctx.log.info('Jira sync complete: ' + synced + '/' + issues.length + ' issues synced');
    return { synced, total: issues.length };
  } catch (e) {
    ctx.log.error('Jira sync failed: ' + String(e));
    return { synced: 0, error: 'Sync failed: ' + String(e) };
  }
}

// --- Helpers ---

// asText flattens a Jira field that may be either a plain string (Jira
// Server) or an Atlassian Document Format object (Jira Cloud's REST v3,
// which is what this addon calls) into plain text. A non-string, non-ADF
// value (or none at all) becomes ''.
function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    return adfToText(value as AdfNode).trim();
  }
  return '';
}

function adfToText(node: AdfNode): string {
  let out = typeof node.text === 'string' ? node.text : '';
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      if (child && typeof child === 'object') {
        out += adfToText(child) + ' ';
      }
    }
  }
  return out;
}

// Truncates to maxBytes of UTF-8, not of JS string length -- the platform's
// limits are byte-based, and the sandbox has no TextEncoder to lean on.
function truncateUtf8Bytes(s: string, maxBytes: number): string {
  if (typeof s !== 'string' || !s) return '';
  let bytes = 0;
  let i = 0;
  for (; i < s.length; i++) {
    const code = s.codePointAt(i) ?? 0;
    const charBytes = code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    if (bytes + charBytes > maxBytes) break;
    bytes += charBytes;
    if (code > 0xffff) i++; // surrogate pair: codePointAt already consumed 2 UTF-16 units
  }
  return s.substring(0, i);
}

// The platform stores tags comma-joined and splits them back apart on
// read, so no tag may contain a comma. Applied once over the whole array
// so no call site can accidentally skip it.
function sanitizeTags(tags: string[]): string[] {
  return tags.map(t => t.replace(/\s*,\s*/g, ' ').trim());
}

function buildTags(project: string, issue: JiraIssue): string[] {
  const tags = ['jira', project.toLowerCase()];
  if (issue.fields.issuetype?.name) {
    tags.push('type:' + issue.fields.issuetype.name.toLowerCase());
  }
  if (issue.fields.priority?.name) {
    tags.push('priority:' + issue.fields.priority.name.toLowerCase());
  }
  if (issue.fields.status?.name) {
    tags.push('status:' + issue.fields.status.name.toLowerCase());
  }
  if (issue.fields.assignee?.displayName) {
    tags.push('assignee:' + issue.fields.assignee.displayName);
  }
  if (issue.fields.updated) {
    tags.push('updated:' + issue.fields.updated);
  }
  return sanitizeTags(tags);
}
