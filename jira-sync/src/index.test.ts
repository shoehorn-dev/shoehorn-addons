import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createMockCtx, type MockCtxResult } from '@shoehorn-dev/addon-sdk/testing';
import type { AddonContext } from '@shoehorn-dev/addon-sdk/backend';
import { handleRoute, sync } from './index.js';

const JQL_URL = /\/rest\/api\/3\/search\/jql\?/;

function searchResponse(issues: unknown[], total = issues.length): {
  status: number;
  body: { issues: unknown[]; total: number; maxResults: number };
  headers: Record<string, string>;
} {
  return { status: 200, body: { issues, total, maxResults: 50 }, headers: {} };
}

let mock: MockCtxResult;

function installCtx(options?: Parameters<typeof createMockCtx>[0]): MockCtxResult {
  mock = createMockCtx(options);
  (globalThis as { ctx?: AddonContext }).ctx = mock.ctx;
  return mock;
}

beforeEach(() => {
  installCtx({
    config: {
      jira_base_url: 'https://acme.atlassian.net',
      jira_project: 'PROJ',
      jira_email: 'bot@acme.test',
    },
    secrets: { jira_api_token: 'token-123' },
  });
});

afterEach(() => {
  delete (globalThis as { ctx?: AddonContext }).ctx;
});

describe('sync', () => {
  it('upserts one entity per issue and reports the synced count', () => {
    mock.mockHttpResponse((m, u) => m === 'GET' && JQL_URL.test(u), searchResponse([
      { key: 'PROJ-101', fields: { summary: 'Fix login timeout' } },
      { key: 'PROJ-102', fields: { summary: 'Add dark mode support' } },
    ]));

    const result = sync();

    expect(result).toEqual({ synced: 2, total: 2 });
    expect(mock.entityOps.filter(op => op.op === 'upsert')).toHaveLength(2);
  });

  it('reads the API token from ctx.secrets, not ctx.config', () => {
    mock.mockHttpResponse((m, u) => m === 'GET' && JQL_URL.test(u), searchResponse([]));

    sync();

    const req = mock.httpRequests[0];
    const expectedAuth = 'Basic ' + btoa('bot@acme.test:token-123');
    expect(req.options?.headers?.Authorization).toBe(expectedAuth);
  });

  it('requests the configured project and includes description in the field list', () => {
    mock.mockHttpResponse((m, u) => m === 'GET' && JQL_URL.test(u), searchResponse([]));

    sync();

    const url = mock.httpRequests[0].url;
    expect(url).toContain(encodeURIComponent('project=PROJ ORDER BY updated DESC'));
    expect(url).toContain('fields=summary,status,issuetype,priority,assignee,updated,description');
  });

  it('builds the exact tag set for a fully-populated issue', () => {
    mock.mockHttpResponse((m, u) => m === 'GET' && JQL_URL.test(u), searchResponse([
      {
        key: 'PROJ-7',
        fields: {
          summary: 'Fully populated',
          issuetype: { name: 'Bug' },
          priority: { name: 'High' },
          status: { name: 'In Progress' },
          assignee: { displayName: 'Jane Doe' },
          updated: '2026-11-01T00:00:00Z',
        },
      },
    ]));

    sync();

    const upsert = mock.entityOps.find(op => op.op === 'upsert')!;
    const tags = (upsert.args as { tags: string[] }).tags;
    expect(tags).toEqual([
      'jira',
      'proj',
      'type:bug',
      'priority:high',
      'status:in progress',
      'assignee:Jane Doe',
      'updated:2026-11-01T00:00:00Z',
    ]);
  });

  it('strips a comma from an assignee display name so no tag reader splits it apart', () => {
    // The platform has two readers that disagree on where tags split: one on
    // ", " and one on a bare ",". No comma survives at all, from either input shape.
    mock.mockHttpResponse((m, u) => m === 'GET' && JQL_URL.test(u), searchResponse([
      {
        key: 'PROJ-200',
        fields: { summary: 'Investigate flaky test', assignee: { displayName: 'Smith, John' } },
      },
      {
        key: 'PROJ-201',
        fields: { summary: 'Another one', assignee: { displayName: 'Doe,Jane' } },
      },
    ]));

    sync();

    const upserts = mock.entityOps.filter(op => op.op === 'upsert');
    const tagsFor = (serviceId: string): string[] =>
      (upserts.find(op => (op.args as { serviceId: string }).serviceId === serviceId)!.args as { tags: string[] }).tags;

    expect(tagsFor('jira-PROJ-200')).toContain('assignee:Smith John');
    expect(tagsFor('jira-PROJ-201')).toContain('assignee:Doe Jane');
    for (const tags of [tagsFor('jira-PROJ-200'), tagsFor('jira-PROJ-201')]) {
      for (const tag of tags) expect(tag).not.toContain(',');
    }
  });

  it('flattens an Atlassian Document Format description into plain text', () => {
    mock.mockHttpResponse((m, u) => m === 'GET' && JQL_URL.test(u), searchResponse([
      {
        key: 'PROJ-300',
        fields: {
          summary: 'ADF description',
          description: {
            type: 'doc',
            version: 1,
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Users report' }] },
              { type: 'paragraph', content: [{ type: 'text', text: 'a timeout.' }] },
            ],
          },
        },
      },
    ]));

    const result = sync();

    expect(result.synced).toBe(1);
    const upsert = mock.entityOps.find(op => op.op === 'upsert')!;
    const description = (upsert.args as { description: string }).description;
    expect(description).toContain('Users report');
    expect(description).toContain('a timeout.');
  });

  it('reports an error and syncs nothing when jira_base_url is not configured', () => {
    installCtx({ config: {} });

    const result = sync();

    expect(result.synced).toBe(0);
    expect(result.error).toBeTruthy();
    expect(mock.entityOps).toHaveLength(0);
  });

  it('reports an error and syncs nothing when Jira returns a non-200 status', () => {
    mock.mockHttpResponse((m, u) => m === 'GET' && JQL_URL.test(u), {
      status: 401,
      body: { errorMessages: ['Unauthorized'] },
      headers: {},
    });

    const result = sync();

    expect(result).toEqual({ synced: 0, error: 'Jira API returned 401' });
    expect(mock.entityOps).toHaveLength(0);
  });

  it('reports an error without throwing when the HTTP request itself fails', () => {
    mock.mockHttpError((m, u) => m === 'GET' && JQL_URL.test(u), new Error('request blocked by network policy'));

    const result = sync();

    expect(result.synced).toBe(0);
    expect(result.error).toContain('request blocked by network policy');
  });

  it('reports an error when the response body has no issues array', () => {
    mock.mockHttpResponse((m, u) => m === 'GET' && JQL_URL.test(u), { status: 200, body: '<html>not json</html>', headers: {} });

    const result = sync();

    expect(result).toEqual({ synced: 0, error: 'Unexpected Jira response shape' });
  });

  it('continues past a single failed upsert and still counts the rest', () => {
    mock.mockHttpResponse((m, u) => m === 'GET' && JQL_URL.test(u), searchResponse([
      { key: 'PROJ-1', fields: { summary: 'One' } },
      { key: 'PROJ-2', fields: { summary: 'Two' } },
    ]));
    const originalUpsert = mock.ctx.entities.upsert;
    let calls = 0;
    mock.ctx.entities.upsert = (entity) => {
      calls += 1;
      if (calls === 1) throw new Error('simulated upsert failure');
      return originalUpsert(entity);
    };

    const result = sync();

    expect(result.synced).toBe(1);
    expect(result.total).toBe(2);
    const upsert = mock.entityOps.find(op => op.op === 'upsert')!;
    expect((upsert.args as { serviceId: string }).serviceId).toBe('jira-PROJ-2');
  });

  it('truncates an overlong ASCII description to 4096 bytes', () => {
    const longDescription = 'x'.repeat(5000);
    mock.mockHttpResponse((m, u) => m === 'GET' && JQL_URL.test(u), searchResponse([
      { key: 'PROJ-301', fields: { summary: 'Long one', description: longDescription } },
    ]));

    sync();

    const upsert = mock.entityOps.find(op => op.op === 'upsert')!;
    const description = (upsert.args as { description: string }).description;
    expect(description.length).toBe(4096);
  });

  it('truncates a non-ASCII description by UTF-8 bytes, not characters', () => {
    // Each 'ä' is 2 bytes in UTF-8; 4000 of them is 8000 bytes, double the 4096 limit.
    const longDescription = 'ä'.repeat(4000);
    mock.mockHttpResponse((m, u) => m === 'GET' && JQL_URL.test(u), searchResponse([
      { key: 'PROJ-302', fields: { summary: 'Non-ASCII', description: longDescription } },
    ]));

    sync();

    const upsert = mock.entityOps.find(op => op.op === 'upsert')!;
    const description = (upsert.args as { description: string }).description;
    expect(new TextEncoder().encode(description).length).toBeLessThanOrEqual(4096);
  });

  it('truncates an overlong name by UTF-8 bytes to stay within the platform limit', () => {
    const longSummary = 'x'.repeat(250); // "PROJ-2: " + 250 chars = 258 bytes, over the 255 limit
    mock.mockHttpResponse((m, u) => m === 'GET' && JQL_URL.test(u), searchResponse([
      { key: 'PROJ-2', fields: { summary: longSummary } },
    ]));

    sync();

    const upsert = mock.entityOps.find(op => op.op === 'upsert')!;
    const name = (upsert.args as { name: string }).name;
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(255);
  });
});

describe('handleRoute', () => {
  it('GET /ping returns the addon identity', () => {
    const resp = handleRoute({ method: 'GET', path: '/ping', query: {}, headers: {} });
    expect(resp.status).toBe(200);
    expect(resp.body).toEqual({ message: 'pong', addon: 'jira-sync' });
  });

  it('POST /sync triggers a sync run and returns its result', () => {
    mock.mockHttpResponse((m, u) => m === 'GET' && JQL_URL.test(u), searchResponse([]));
    const resp = handleRoute({ method: 'POST', path: '/sync', query: {}, headers: {} });
    expect(resp.status).toBe(200);
    expect(resp.body).toEqual({ synced: 0, total: 0 });
  });

  it('GET /sync is not a valid route (only POST triggers a sync)', () => {
    const resp = handleRoute({ method: 'GET', path: '/sync', query: {}, headers: {} });
    expect(resp.status).toBe(404);
    expect(mock.httpRequests).toHaveLength(0);
  });

  it('GET /issues fetches live from Jira and shapes the response for the widget', () => {
    mock.mockHttpResponse((m, u) => m === 'GET' && u.includes('/rest/api/3/search/jql'), searchResponse([
      {
        key: 'PROJ-9',
        fields: {
          summary: 'Widget data shape',
          status: { name: 'In Progress' },
          priority: { name: 'High' },
          issuetype: { name: 'Bug' },
          assignee: { displayName: 'Jane Doe' },
          updated: '2026-11-01T00:00:00Z',
        },
      },
    ]));

    const resp = handleRoute({ method: 'GET', path: '/issues', query: {}, headers: {} });

    expect(resp.status).toBe(200);
    const body = resp.body as { issues: Array<Record<string, unknown>>; total: number };
    expect(body.total).toBe(1);
    expect(body.issues[0]).toEqual({
      key: 'PROJ-9',
      summary: 'Widget data shape',
      issueType: 'bug',
      priority: 'high',
      status: 'in progress',
      assignee: 'Jane Doe',
      updated: '2026-11-01T00:00:00Z',
      jiraUrl: 'https://acme.atlassian.net/browse/PROJ-9',
    });
  });

  it('GET /issues reports a config error without calling Jira when unconfigured', () => {
    installCtx({ config: {} });
    const resp = handleRoute({ method: 'GET', path: '/issues', query: {}, headers: {} });
    expect(resp.status).toBe(200);
    expect((resp.body as { error?: string }).error).toContain('jira_base_url');
    expect(mock.httpRequests).toHaveLength(0);
  });

  it('GET /issues reports the Jira error status instead of an empty success', () => {
    mock.mockHttpResponse((m, u) => m === 'GET' && JQL_URL.test(u), { status: 401, body: {}, headers: {} });
    const resp = handleRoute({ method: 'GET', path: '/issues', query: {}, headers: {} });
    expect(resp.status).toBe(200);
    const body = resp.body as { issues: unknown[]; total: number; error?: string };
    expect(body.issues).toEqual([]);
    expect(body.error).toBe('Jira API returned 401');
  });

  it.each([
    ['neither credential set', {}, {}, false],
    ['only email set', { jira_email: 'bot@acme.test' }, {}, false],
    ['only token set', {}, { jira_api_token: 'token-123' }, false],
    ['both set', { jira_email: 'bot@acme.test' }, { jira_api_token: 'token-123' }, true],
  ] as const)('GET /config: %s -> hasCredentials=%s', (_label, config, secrets, expected) => {
    installCtx({ config: { jira_base_url: 'https://acme.atlassian.net', ...config }, secrets });
    const resp = handleRoute({ method: 'GET', path: '/config', query: {}, headers: {} });
    expect((resp.body as { hasCredentials: boolean }).hasCredentials).toBe(expected);
  });

  it('GET /config reports configuration status without leaking the token', () => {
    const resp = handleRoute({ method: 'GET', path: '/config', query: {}, headers: {} });
    expect(resp.status).toBe(200);
    expect(resp.body).toMatchObject({ configured: true, project: 'PROJ', hasCredentials: true });
    expect(JSON.stringify(resp.body)).not.toContain('token-123');
  });

  it('GET /config reports configured=false when jira_base_url is unset', () => {
    installCtx({ config: {} });
    const resp = handleRoute({ method: 'GET', path: '/config', query: {}, headers: {} });
    expect((resp.body as { configured: boolean }).configured).toBe(false);
  });

  it('unknown routes return 404 with the requested path in the body', () => {
    const resp = handleRoute({ method: 'GET', path: '/nope', query: {}, headers: {} });
    expect(resp.status).toBe(404);
    expect(resp.body).toEqual({ error: 'not found', path: '/nope' });
  });
});
