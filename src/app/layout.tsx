import type { Metadata } from "next";
import "./globals.css";

// 注: Next 16 静态生成 _global-error 时 metadata/viewport 渲染存在已知问题,
// 先不导出 metadata,避免构建失败。

// export const metadata: Metadata = {
// 	title: "pipipi — kanban agents",
// 	description: "User-agent collaboration kanban board",
// };

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="zh-CN">
			<body>{children}</body>
		</html>
	);
}
