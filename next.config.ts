import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// pipipi 项目根(避免与父目录 pi-mono 的 lockfile 混淆)
const projectRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
	reactStrictMode: true,
	turbopack: { root: projectRoot },
	outputFileTracingRoot: projectRoot,
	serverExternalPackages: [
		"@earendil-works/pi-agent-core",
		"@earendil-works/pi-agent-core/node",
		"@earendil-works/pi-ai",
		"@earendil-works/pi-coding-agent",
	],
};

export default nextConfig;
