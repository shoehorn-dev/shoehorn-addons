/**
 * Jira Sync - Frontend Entry Point
 *
 * ESM module loaded by the Shoehorn addon loader.
 * Exports tabs and widgets with vanilla JS components (no Svelte runtime)
 * to avoid dual-runtime conflicts with the host application.
 *
 * Components follow the Svelte component constructor interface:
 *   new Component({ target: HTMLElement, props: {...} })
 * but are implemented as plain JS with DOM manipulation.
 */

import { wrapVanillaComponent } from '@shoehorn-dev/addon-sdk/frontend';
import { createWidget } from './components/JiraIssuesWidget';

const JiraIssuesWidgetComponent = wrapVanillaComponent(createWidget);

export const widgets = [
	{
		id: 'jira-issues',
		name: 'Jira Issues',
		description: 'Table of synced Jira issues with status, priority, and assignee',
		icon: 'ClipboardList',
		defaultSize: { w: 4, h: 3 },
		minSize: { w: 2, h: 2 },
		maxSize: { w: 6, h: 6 },
		component: JiraIssuesWidgetComponent,
	},
];
