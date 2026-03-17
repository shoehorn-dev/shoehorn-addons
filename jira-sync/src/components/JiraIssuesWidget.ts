/**
 * JiraIssuesWidget - Dashboard widget using Shoehorn addon SDK styles
 */

import { injectStyles } from '@shoehorn/addon-sdk/frontend';

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

function esc(s: string): string {
	const el = document.createElement('span');
	el.textContent = s;
	return el.innerHTML;
}

function formatUpdated(iso: string): string {
	if (!iso) return '';
	try {
		const d = new Date(iso);
		const mins = Math.floor((Date.now() - d.getTime()) / 60000);
		if (mins < 60) return `${mins}m ago`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		if (days < 30) return `${days}d ago`;
		return d.toLocaleDateString();
	} catch {
		return iso;
	}
}

function priorityBadge(p: string): string {
	const cls: Record<string, string> = {
		highest: 'sh-badge-red', critical: 'sh-badge-red',
		high: 'sh-badge-orange', medium: 'sh-badge-yellow',
		low: 'sh-badge-green', lowest: 'sh-badge-green',
	};
	return `<span class="sh-badge ${cls[p] || 'sh-badge-gray'}">${esc(p)}</span>`;
}

function statusBadge(s: string): string {
	const cls: Record<string, string> = {
		done: 'sh-badge-green', closed: 'sh-badge-green',
		'in progress': 'sh-badge-blue', 'in review': 'sh-badge-blue',
	};
	return `<span class="sh-badge ${cls[s] || 'sh-badge-gray'}">${esc(s)}</span>`;
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
	let sortField = 'updated';
	let sortDir: 'asc' | 'desc' = 'desc';

	async function loadIssues(): Promise<void> {
		target.innerHTML = `<div class="sh-widget"><div style="padding:16px;">${
			Array(6).fill('<div class="sh-skeleton"></div>').join('')
		}</div></div>`;
		try {
			const res = await fetch(`/api/v1/addons/${props.addonSlug}/issues`, { credentials: 'include' });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = await res.json();
			issues = data.issues ?? [];
			render();
		} catch (err) {
			target.innerHTML = `<div class="sh-widget"><div class="sh-error">
				<p class="sh-error-title">Failed to load issues</p>
				<p class="sh-error-desc">${esc(err instanceof Error ? err.message : String(err))}</p>
				<button class="sh-btn" data-retry style="margin-top:8px;">Retry</button>
			</div></div>`;
			target.querySelector('[data-retry]')?.addEventListener('click', loadIssues);
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
		if (issues.length === 0) {
			target.innerHTML = `<div class="sh-widget"><div class="sh-empty">
				<p class="sh-empty-title">No Jira issues</p>
				<p class="sh-empty-desc">Run a sync from the addon admin page.</p>
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
						<td>${i.jiraUrl ? `<a class="sh-link" href="${esc(i.jiraUrl)}" target="_blank" rel="noopener noreferrer">${esc(i.key)}</a>` : `<span class="sh-font-medium">${esc(i.key)}</span>`}</td>
						<td class="sh-truncate" title="${esc(i.summary)}">${esc(i.summary)}</td>
						<td>${i.issueType ? typeSpan(i.issueType) : ''}</td>
						<td>${i.priority ? priorityBadge(i.priority) : ''}</td>
						<td>${i.status ? statusBadge(i.status) : ''}</td>
						<td class="sh-text-muted">${esc(i.assignee || '\u2014')}</td>
						<td class="sh-text-muted" title="${esc(i.updated)}">${formatUpdated(i.updated)}</td>
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
