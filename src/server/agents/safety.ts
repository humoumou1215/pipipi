import { createBashTool } from "@earendil-works/pi-agent-core";

/** bash 硬性超时上限(秒) */
export const BASH_TIMEOUT_LIMIT = 120;

/** 危险命令模式(命中即拦截) */
const DANGEROUS_PATTERNS: RegExp[] = [
	/\brm\s+(-[a-z]*r[a-z]*f?|-f[a-z]*r?)\s+(\/|\/\*|~|\$HOME)(\s|$)/i, // rm -rf / 或家目录
	/\brm\s+-rf\s+(\/etc|\/usr|\/var|\/boot|\/root|\/dev|\/proc|\/sys)(\s|\/|$)/i,
	/\bmkfs(\.|\s)/i,
	/\bfdisk\s+/,
	/\bdd\s+.*of=\/dev\/(sd|hd|nvme|mmcblk)/i,
	/\bshutdown\b|\breboot\b|\bhalt\b|\bpoweroff\b|\bsystemctl\s+(poweroff|halt|reboot)/i,
	/\binit\s+[06]\b/,
	/\bchmod\s+(-R\s+)?777\s+\//i,
	/\bchown\s+(-R\s+)?[^ ]+\s+\//i,
	/:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;:/, // fork 炸弹
	/\bcurl[^|]*\|\s*(ba)?sh\b|\bwget[^|]*\|\s*(ba)?sh\b/i, // 管道到 shell
	/\bgit\s+push\s+(-f|--force)/i, // 强制推送
	/\bsudo\s+(rm|mkfs|dd|shutdown|reboot)/i,
];

function isDangerous(command: string): string | null {
	for (const pattern of DANGEROUS_PATTERNS) {
		if (pattern.test(command)) {
			return `command blocked by pipipi safety policy: ${pattern}`;
		}
	}
	return null;
}

/**
 * 安全的 bash 工具:commandPrefix 硬性超时上限 + 危险命令拦截。
 * worker 与直聊的 harness 都使用它(替换裸 createBashTool)。
 */
export function createSafeBashTool() {
	return createBashTool({
		commandPrefix: `timeout ${BASH_TIMEOUT_LIMIT}s `,
		prepare: (execution) => {
			const blocked = isDangerous(execution.command);
			if (blocked) throw new Error(blocked);
		},
	});
}
