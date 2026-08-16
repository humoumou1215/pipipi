export interface User {
	id: number;
	username: string;
	displayName: string;
	isAdmin: boolean;
}

export interface Column {
	id: number;
	name: string;
	position: number;
	claimable: boolean;
	done: boolean;
	workflowRole: string | null;
}

export interface CardSummary {
	id: number;
	title: string;
	type: string;
	priority: number;
	tags: string[];
	columnId: number;
	status: string;
	holderId: string | null;
	assigneeRole: string | null;
	reviewApprover: number | null;
	dueAt: string | null;
	updatedAt: string;
}

export interface RoleInfo {
	id: string;
	name: string;
	kind: string;
	model: string | null;
	instanceCount: number;
}

export interface InstanceInfo {
	id: string;
	roleId: string;
	status: string;
	currentCardId: number | null;
	queueLen: number;
}

export interface BoardSnapshot {
	dirId: string;
	name: string;
	path: string;
	columns: Column[];
	cards: CardSummary[];
	roles: RoleInfo[];
	instances: InstanceInfo[];
}

export interface Activity {
	id: number;
	cardId: number;
	actorKind: string;
	actorId: string;
	type: string;
	payload: Record<string, unknown>;
	createdAt: string;
}

export interface Stage {
	id: number;
	cardId: number;
	roleId: string;
	title: string;
	description: string;
	status: string;
	doneBy: string | null;
	position: number;
}

export interface CardDetail extends CardSummary {
	description: string;
	version: number;
	createdAt: string;
	stageIdx: number;
	stages: Stage[];
	checklist: Array<{ id: number; text: string; done: number; position: number }>;
}

export interface DirInfo {
	id: string;
	path: string;
	name: string;
	summary: { boards: number; instances: number; active: number } | null;
}

export interface Notification {
	id: number;
	type: string;
	dir: string;
	cardId: number | null;
	read: number;
	createdAt: string;
}
