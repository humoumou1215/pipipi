import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// pipipi 项目根(避免与父目录 pi-mono 的 lockfile 混淆)
const projectRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
	reactStrictMode: true,
	turbopack: { root: projectRoot },
	outputFileTracingRoot: projectRoot,
	// 注:pi-* 包为纯 JS ESM,默认打进 bundle(不 serverExternalPackages,
	// 避免 turbopack 生成 hash 别名导致安装后运行时找不到模块)
};

export default nextConfig;
