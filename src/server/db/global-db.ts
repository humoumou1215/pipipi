import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { GLOBAL_SCHEMA } from "./schema";

export interface UserRow {
	id: number;
	username: string;
	displayName: string;
	passwordHash: string;
	isAdmin: number;
	createdAt: string;
}

export interface NotificationRow {
	id: number;
	userId: number;
	type: string;
	dir: string;
	cardId: number | null;
	activityId: number | null;
	read: number;
	createdAt: string;
}

export interface DirRow {
	id: string;
	path: string;
	name: string;
	registeredAt: string;
}

/** 全局数据库:users / notifications / dirs */
export class GlobalDb {
	private db: DatabaseSync;

	private constructor(db: DatabaseSync) {
		this.db = db;
	}

	static open(dataDir: string): GlobalDb {
		mkdirSync(dataDir, { recursive: true });
		const db = new DatabaseSync(join(dataDir, "users.db"));
		db.exec("PRAGMA journal_mode=WAL");
		db.exec("PRAGMA foreign_keys=ON");
		db.exec(GLOBAL_SCHEMA);
		return new GlobalDb(db);
	}

	close(): void {
		this.db.close();
	}

	// ---- users ----

	createUser(input: {
		username: string;
		displayName: string;
		passwordHash: string;
		isAdmin: boolean;
	}): UserRow {
		const now = new Date().toISOString();
		this.db
			.prepare("INSERT INTO users (username, display_name, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?)")
			.run(input.username, input.displayName, input.passwordHash, input.isAdmin ? 1 : 0, now);
		const row = this.db.prepare("SELECT * FROM users WHERE username = ?").get(input.username) as
			| Record<string, unknown>
			| undefined;
		if (!row) throw new Error("user create failed");
		return mapUser(row);
	}

	getUserById(id: number): UserRow | undefined {
		const row = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as Record<string, unknown> | undefined;
		return row ? mapUser(row) : undefined;
	}

	getUserByUsername(username: string): UserRow | undefined {
		const row = this.db.prepare("SELECT * FROM users WHERE username = ?").get(username) as
			| Record<string, unknown>
			| undefined;
		return row ? mapUser(row) : undefined;
	}

	listUsers(): UserRow[] {
		const rows = this.db.prepare("SELECT * FROM users ORDER BY id").all() as Record<string, unknown>[];
		return rows.map(mapUser);
	}

	deleteUser(id: number): void {
		this.db.prepare("DELETE FROM users WHERE id = ?").run(id);
	}

	countUsers(): number {
		const row = this.db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
		return Number(row.n);
	}

	// ---- notifications ----

	createNotification(input: {
		userId: number;
		type: string;
		dir: string;
		cardId?: number;
		activityId?: number;
	}): NotificationRow {
		const now = new Date().toISOString();
		this.db
			.prepare(
				"INSERT INTO notifications (user_id, type, dir, card_id, activity_id, read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)",
			)
			.run(input.userId, input.type, input.dir, input.cardId ?? null, input.activityId ?? null, now);
		const row = this.db.prepare("SELECT * FROM notifications WHERE id = last_insert_rowid()").get() as
			| Record<string, unknown>
			| undefined;
		if (!row) throw new Error("notification create failed");
		return mapNotification(row);
	}

	listNotifications(userId: number, unreadOnly: boolean): NotificationRow[] {
		const sql = unreadOnly
			? "SELECT * FROM notifications WHERE user_id = ? AND read = 0 ORDER BY id DESC LIMIT 100"
			: "SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 100";
		const rows = this.db.prepare(sql).all(userId) as Record<string, unknown>[];
		return rows.map(mapNotification);
	}

	markNotificationRead(id: number, userId: number): void {
		this.db.prepare("UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?").run(id, userId);
	}

	markAllNotificationsRead(userId: number): void {
		this.db.prepare("UPDATE notifications SET read = 1 WHERE user_id = ?").run(userId);
	}

	unreadCount(userId: number): number {
		const row = this.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0").get(userId) as {
			n: number;
		};
		return Number(row.n);
	}

	// ---- dirs ----

	registerDir(id: string, path: string, name: string): void {
		const now = new Date().toISOString();
		this.db
			.prepare("INSERT OR REPLACE INTO dirs (id, path, name, registered_at) VALUES (?, ?, ?, ?)")
			.run(id, path, name, now);
	}

	listDirs(): DirRow[] {
		const rows = this.db.prepare("SELECT * FROM dirs ORDER BY registered_at").all() as Record<string, unknown>[];
		return rows.map(mapDir);
	}

	getDir(id: string): DirRow | undefined {
		const row = this.db.prepare("SELECT * FROM dirs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
		return row ? mapDir(row) : undefined;
	}
}

function mapUser(row: Record<string, unknown>): UserRow {
	return {
		id: Number(row.id),
		username: String(row.username),
		displayName: String(row.display_name),
		passwordHash: String(row.password_hash),
		isAdmin: Number(row.is_admin),
		createdAt: String(row.created_at),
	};
}

function mapNotification(row: Record<string, unknown>): NotificationRow {
	return {
		id: Number(row.id),
		userId: Number(row.user_id),
		type: String(row.type),
		dir: String(row.dir),
		cardId: row.card_id === null ? null : Number(row.card_id),
		activityId: row.activity_id === null ? null : Number(row.activity_id),
		read: Number(row.read),
		createdAt: String(row.created_at),
	};
}

function mapDir(row: Record<string, unknown>): DirRow {
	return {
		id: String(row.id),
		path: String(row.path),
		name: String(row.name),
		registeredAt: String(row.registered_at),
	};
}
