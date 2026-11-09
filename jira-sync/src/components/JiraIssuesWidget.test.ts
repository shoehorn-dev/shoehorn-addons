// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createWidget } from './JiraIssuesWidget.js';

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

let target: HTMLElement;

beforeEach(() => {
  target = document.createElement('div');
  document.body.appendChild(target);
});

afterEach(() => {
  target.remove();
  vi.unstubAllGlobals();
});

describe('JiraIssuesWidget', () => {
  it('shows the error state, not the empty state, when the route reports a Jira-side error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      issues: [],
      total: 0,
      error: 'Jira API returned 401',
    })));

    const widget = createWidget({ target, props: { addonSlug: 'jira-sync' } });
    await vi.waitFor(() => expect(target.textContent).toContain('401'));

    expect(target.textContent).toContain("Couldn't load issues");
    expect(target.textContent).not.toContain('No matching issues');
    widget.destroy();
  });

  it('escapes attacker-controlled Jira text instead of rendering it as markup', async () => {
    const payload = '<img src=x onerror=alert(1)>';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      issues: [{
        key: payload,
        summary: payload,
        issueType: 'bug',
        priority: 'high',
        status: 'open',
        assignee: payload,
        updated: '2026-11-01T00:00:00Z',
        jiraUrl: 'https://acme.atlassian.net/browse/PROJ-1',
      }],
      total: 1,
    })));

    const widget = createWidget({ target, props: { addonSlug: 'jira-sync' } });
    await vi.waitFor(() => expect(target.querySelector('table')).not.toBeNull());

    expect(target.querySelector('img')).toBeNull();
    expect(target.querySelector('script')).toBeNull();
    expect(target.innerHTML).toContain('&lt;img');
    widget.destroy();
  });

  it('destroy() clears the rendered content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ issues: [], total: 0 })));
    const widget = createWidget({ target, props: { addonSlug: 'jira-sync' } });
    await vi.waitFor(() => expect(target.textContent).toContain('No matching issues'));

    widget.destroy();

    expect(target.innerHTML).toBe('');
  });
});
