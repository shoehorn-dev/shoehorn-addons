/**
 * JiraIssuesWidget - Dashboard widget using Shoehorn addon SDK styles
 */

import { injectStyles, esc, timeAgo, badge, link, skeletons, type BadgeVariant } from '@shoehorn-dev/addon-sdk/frontend';

interface JiraIssue {
	key: string;
	summary: string;
	issueType: string;
	priority: string;
	status: string;
	assignee: string;
	updated: string;
	jiraUrl: string;
}

interface WidgetProps {
	target: HTMLElement;
	props: {
		teamId?: string;
		addonSlug: string;
		config?: Record<string, unknown>;
		size?: { w: number; h: number };
	};
}

const PRIORITY_VARIANTS: Record<string, BadgeVariant> = {
	highest: 'red', critical: 'red',
	high: 'orange', medium: 'yellow',
	low: 'green', lowest: 'green',
};

const STATUS_VARIANTS: Record<string, BadgeVariant> = {
	done: 'green', closed: 'green',
	'in progress': 'blue', 'in review': 'blue',
};

function priorityBadge(p: string): string {
	return badge(p, PRIORITY_VARIANTS[p] ?? 'gray');
}

function statusBadge(s: string): string {
	return badge(s, STATUS_VARIANTS[s] ?? 'gray');
}

function typeSpan(t: string): string {
	const cls: Record<string, string> = {
		bug: 'sh-type-bug', story: 'sh-type-story', epic: 'sh-type-epic', task: 'sh-type-task',
	};
	return `<span class="sh-font-medium ${cls[t] || ''}" style="text-transform:capitalize;">${esc(t)}</span>`;
}

export function createWidget({ target, props }: WidgetProps): { destroy: () => void } {
	injectStyles();

	let issues: JiraIssue[] = [];
	let fetchError: string | null = null;
	let sortField = 'updated';
	let sortDir: 'asc' | 'desc' = 'desc';

	function renderError(message: string): void {
		target.innerHTML = `<div class="sh-widget"><div class="sh-error">
			<p class="sh-error-title">Couldn't load issues</p>
			<p class="sh-error-desc">${esc(message)}</p>
			<button class="sh-btn" data-retry style="margin-top:8px;">Retry</button>
		</div></div>`;
		target.querySelector('[data-retry]')?.addEventListener('click', loadIssues);
	}

	async function loadIssues(): Promise<void> {
		target.innerHTML = `<div class="sh-widget"><div style="padding:16px;">${skeletons(6)}</div></div>`;
		try {
			const res = await fetch(`/api/v1/addons/${props.addonSlug}/issues`, { credentials: 'include' });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = await res.json();
			issues = data.issues ?? [];
			// The route returns 200 even for a Jira-side failure (bad credentials,
			// unreachable API), with the reason in `error` -- read() alone would
			// show this as "no issues" with no indication anything is wrong.
			fetchError = typeof data.error === 'string' ? data.error : null;
			render();
		} catch (err) {
			renderError(err instanceof Error ? err.message : String(err));
		}
	}

	function sortIssues(): JiraIssue[] {
		const pOrder: Record<string, number> = { highest: 0, critical: 0, high: 1, medium: 2, low: 3, lowest: 4 };
		const sOrder: Record<string, number> = { 'to do': 0, open: 0, 'in progress': 1, 'in review': 2, done: 3, closed: 3 };
		return [...issues].sort((a, b) => {
			let cmp = 0;
			if (sortField === 'key') cmp = a.key.localeCompare(b.key);
			else if (sortField === 'priority') cmp = (pOrder[a.priority] ?? 99) - (pOrder[b.priority] ?? 99);
			else if (sortField === 'status') cmp = (sOrder[a.status] ?? 99) - (sOrder[b.status] ?? 99);
			else if (sortField === 'updated') cmp = a.updated.localeCompare(b.updated);
			return sortDir === 'asc' ? cmp : -cmp;
		});
	}

	function toggleSort(field: string): void {
		if (sortField === field) { sortDir = sortDir === 'asc' ? 'desc' : 'asc'; }
		else { sortField = field; sortDir = field === 'updated' ? 'desc' : 'asc'; }
		render();
	}

	function render(): void {
		if (fetchError) {
			renderError(fetchError);
			return;
		}

		if (issues.length === 0) {
			target.innerHTML = `<div class="sh-widget"><div class="sh-empty">
				<p class="sh-empty-title">No Jira issues</p>
				<p class="sh-empty-desc">No matching issues found in this project.</p>
			</div></div>`;
			return;
		}

		const sorted = sortIssues();
		const arrow = (f: string) => sortField === f ? (sortDir === 'asc' ? ' \u2191' : ' \u2193') : '';

		target.innerHTML = `<div class="sh-widget">
			<div class="sh-header">
				<div class="sh-header-left">
					<div class="sh-header-icon" style="background:#2563eb;">
						<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M15 2H9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1Z"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/></svg>
					</div>
					<div>
						<div class="sh-header-title">Jira Issues</div>
						<div class="sh-header-subtitle">${issues.length} issue${issues.length !== 1 ? 's' : ''}</div>
					</div>
				</div>
				<button class="sh-btn-ghost" data-refresh title="Refresh">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>
				</button>
			</div>
			<div class="sh-body">
				<table class="sh-table">
					<thead><tr>
						<th data-sort="key">Key${arrow('key')}</th>
						<th>Summary</th>
						<th>Type</th>
						<th data-sort="priority">Priority${arrow('priority')}</th>
						<th data-sort="status">Status${arrow('status')}</th>
						<th>Assignee</th>
						<th data-sort="updated">Updated${arrow('updated')}</th>
					</tr></thead>
					<tbody>${sorted.map(i => `<tr>
						<td>${i.jiraUrl ? link(i.key, i.jiraUrl, { external: true }) : `<span class="sh-font-medium">${esc(i.key)}</span>`}</td>
						<td class="sh-truncate" title="${esc(i.summary)}">${esc(i.summary)}</td>
						<td>${i.issueType ? typeSpan(i.issueType) : ''}</td>
						<td>${i.priority ? priorityBadge(i.priority) : ''}</td>
						<td>${i.status ? statusBadge(i.status) : ''}</td>
						<td class="sh-text-muted">${esc(i.assignee || '\u2014')}</td>
						<td class="sh-text-muted" title="${esc(i.updated)}">${timeAgo(i.updated)}</td>
					</tr>`).join('')}</tbody>
				</table>
			</div>
		</div>`;

		target.querySelector('[data-refresh]')?.addEventListener('click', loadIssues);
		target.querySelectorAll('[data-sort]').forEach(th => {
			th.addEventListener('click', () => toggleSort((th as HTMLElement).dataset.sort!));
		});
	}

	loadIssues();
	return { destroy() { target.innerHTML = ''; } };
}
