/**
 * Jira Sync - Shoehorn Addon (scripted)
 *
 * Syncs Jira issues into the Shoehorn catalog as entities.
 * Uses ctx.http for Jira REST API, ctx.entities for catalog CRUD.
 *
 * Runtime contract:
 * - Functions receive JS objects as arguments (not JSON strings)
 * - Functions return JS objects (runtime wraps in JSON.stringify automatically)
 * - Host functions available: ctx.log, ctx.config, ctx.http, ctx.entities
 */

import type { RouteRequest, RouteResponse } from '@shoehorn/addon-sdk/backend';

interface JiraIssue {
  key: string;
  fields: {
    summary: string;
    description?: string;
    status?: { name: string };
    priority?: { name: string };
    issuetype?: { name: string };
    assignee?: { displayName: string };
    updated?: string;
  };
}

interface JiraSearchResponse {
  issues: JiraIssue[];
  total: number;
  maxResults: number;
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

function getAuthHeaders(config: JiraConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  };
  if (config.email && config.token) {
    const encoded = btoa(config.email + ':' + config.token);
    ctx.log.info('Auth: email=' + config.email + ' tokenLen=' + config.token.length + ' b64Len=' + encoded.length);
    headers['Authorization'] = 'Basic ' + encoded;
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
  // Fetch directly from Jira API (ctx.entities not yet wired in addon runtime)
  const config = getJiraConfig();
  if (!config.baseUrl) {
    return { status: 200, body: { issues: [], total: 0, error: 'jira_base_url not configured' } };
  }

  try {
    const jql = 'project=' + config.project + ' ORDER BY updated DESC';
    const fields = 'summary,status,issuetype,priority,assignee,updated';
    const url = config.baseUrl + '/rest/api/3/search/jql?jql=' + encodeURIComponent(jql) + '&maxResults=50&fields=' + fields;
    const headers = getAuthHeaders(config);

    const resp = ctx.http.request('GET', url, { headers });
    if (resp.status !== 200) {
      return { status: 200, body: { issues: [], total: 0, error: 'Jira API returned ' + resp.status } };
    }

    const data = resp.body;
    const jiraIssues = data.issues || [];
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
  const config = getJiraConfig();
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

  const config = getJiraConfig();
  if (!config.baseUrl) {
    ctx.log.error('jira_base_url not configured');
    return { synced: 0, error: 'jira_base_url not configured' };
  }

  try {
    const jql = 'project=' + config.project + ' ORDER BY updated DESC';
    const fields = 'summary,status,issuetype,priority,assignee,updated,description';
    const url = config.baseUrl + '/rest/api/3/search/jql?jql=' + encodeURIComponent(jql) + '&maxResults=50&fields=' + fields;
    const headers = getAuthHeaders(config);

    const resp = ctx.http.request('GET', url, { headers });

    ctx.log.info('URL=' + url);
    ctx.log.info('Jira status=' + resp.status + ' bodyType=' + typeof resp.body + ' bodyKeys=' + Object.keys(resp.body || {}).join(','));

    if (resp.status !== 200) {
      ctx.log.error('Jira API returned ' + resp.status);
      return { synced: 0, error: 'Jira API returned ' + resp.status };
    }

    const data = resp.body;
    const issues = data.issues || [];
    ctx.log.info('Issues found: ' + issues.length + ', isLast: ' + (data as any).isLast);
    ctx.log.info('Jira sync complete: ' + issues.length + ' issues fetched');
    return { synced: issues.length, total: issues.length };
  } catch (e) {
    ctx.log.error('Jira sync failed: ' + String(e));
    return { synced: 0, error: 'Sync failed: ' + String(e) };
  }
}

