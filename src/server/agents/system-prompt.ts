import { formatSkillsForSystemPrompt, type Skill } from "@earendil-works/pi-agent-core";
import type { RoleRow } from "../db/board-db";

export interface SystemPromptInput {
	role: RoleRow;
	agentMd: string;
	memoryMd: string;
	appendMd: string;
	skills: Skill[];
	boardToolDescriptions: string;
	workCwd: string;
	boardName: string;
}

/**
 * 角色 system prompt 组装。
 * 缓存规则(design §7.3):agent.md/工具说明/append 为稳定块;memory.md 低频更新;
 * 卡片动态内容一律走 user message,绝不进入 system prompt。
 */
export function buildRoleSystemPrompt(input: SystemPromptInput): string {
	const sections: string[] = [];

	if (input.agentMd.trim()) {
		sections.push(
			`<role_instructions>\n${input.agentMd.trim()}\n</role_instructions>`,
		);
	}

	if (input.memoryMd.trim()) {
		sections.push(
			`<role_memory>\n${input.memoryMd.trim()}\n</role_memory>`,
		);
	}

	sections.push(
		`<board>\nYou are an agent working on the kanban board "${input.boardName}" at working directory: ${input.workCwd}.\nYour role: ${input.role.name} (${input.role.id}).\nYou claim cards, perform the work, and report back to the board. Always read the card before acting and keep the card's activity timeline updated via comments.\n</board>`,
	);

	if (input.boardToolDescriptions.trim()) {
		sections.push(
			`<board_tools>\nAvailable board tools (use them to interact with the kanban):\n${input.boardToolDescriptions.trim()}\n</board_tools>`,
		);
	}

	if (input.skills.length > 0) {
		sections.push(formatSkillsForSystemPrompt(input.skills));
	}

	if (input.appendMd.trim()) {
		sections.push(input.appendMd.trim());
	}

	sections.push(`Current working directory: ${input.workCwd}`);

	return sections.join("\n\n");
}

/** 由工具定义生成描述块 */
export function describeTools(tools: Array<{ name: string; description: string }>): string {
	return tools
		.map((t) => `- ${t.name}: ${t.description}`)
		.join("\n");
}
