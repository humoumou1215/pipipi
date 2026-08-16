import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateSummary, type AgentMessage } from "@earendil-works/pi-agent-core";
import type { Model, Models } from "@earendil-works/pi-ai";

/** memory.md 超此字符数触发压缩 */
export const MEMORY_MAX_CHARS = 4096;

/** 追加一条记忆到角色的 memory.md(同步,低频) */
export function appendMemoryFile(roleDir: string, content: string): void {
	const file = join(roleDir, "memory.md");
	const today = new Date().toISOString().slice(0, 10);
	const line = `- (${today}) ${content.replace(/\n/g, " ").trim()}`;
	const existing = existsSync(file) ? readFileSync(file, "utf-8") : "";
	const next = existing.trimEnd() ? `${existing.trimEnd()}\n${line}\n` : `${line}\n`;
	writeFileSync(file, next);
}

export function memoryFileSize(roleDir: string): number {
	const file = join(roleDir, "memory.md");
	if (!existsSync(file)) return 0;
	return statSync(file).size;
}

/**
 * memory.md 超过阈值时,用角色模型压缩旧内容为要点列表。
 * 返回是否发生了压缩。失败不抛(内存压缩是尽力而为)。
 */
export async function compactMemoryFile(
	roleDir: string,
	models: Models,
	model: Model<any>,
	signal?: AbortSignal,
): Promise<boolean> {
	const file = join(roleDir, "memory.md");
	if (!existsSync(file)) return false;
	const content = readFileSync(file, "utf-8");
	if (content.length <= MEMORY_MAX_CHARS) return false;
	const messages: AgentMessage[] = [
		{
			role: "user",
			content: [{ type: "text", text: content }],
			timestamp: Date.now(),
		},
	];
	const result = await generateSummary(
		messages,
		models,
		model,
		0,
		signal,
		"Summarize the role's accumulated memory into concise durable lessons. Keep concrete facts, decisions, and conventions. Output a compact markdown bullet list.",
	);
	if (!result.ok) return false;
	writeFileSync(
		file,
		`# memory (compacted ${new Date().toISOString().slice(0, 10)})\n\n${result.value.trim()}\n`,
	);
	return true;
}
