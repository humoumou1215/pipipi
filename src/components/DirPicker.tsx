"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface BrowseData {
	path: string;
	parentPath: string | null;
	directories: Array<{ name: string; path: string }>;
}

interface Props {
	onPick: (path: string) => void;
	onClose: () => void;
}

/** 服务器目录选择(对齐 pi-web cwd 选择器:面包屑 + 目录列表 + 确认) */
export default function DirPicker({ onPick, onClose }: Props) {
	const { t } = useI18n();
	const [path, setPath] = useState("/");
	const [data, setData] = useState<BrowseData | null>(null);
	const [error, setError] = useState("");

	const load = useCallback(async (p: string) => {
		setError("");
		try {
			const d = await api<BrowseData>(`/api/fs/browse?path=${encodeURIComponent(p)}`);
			setData(d);
			setPath(d.path);
		} catch (err) {
			setError(err instanceof Error ? err.message : "load failed");
		}
	}, []);

	useEffect(() => {
		void load("/");
	}, [load]);

	const crumbs = path.split("/").filter(Boolean);

	return (
		<div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60" onClick={onClose}>
			<div
				className="flex h-96 w-[34rem] flex-col rounded-lg border border-neutral-700 bg-neutral-900 shadow-xl"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2 text-sm">
					<span className="text-neutral-300">{t("dirPicker.title")}</span>
					<button className="ml-auto text-neutral-400 hover:text-neutral-200" onClick={onClose}>
						×
					</button>
				</div>

				{/* 面包屑 */}
				<div className="flex flex-wrap items-center gap-1 border-b border-neutral-800 px-3 py-1.5 text-xs">
					<button className="text-neutral-400 hover:text-neutral-200" onClick={() => void load("/")}>
						/
					</button>
					{crumbs.map((c, i) => {
						const target = `/${crumbs.slice(0, i + 1).join("/")}`;
						return (
							<span key={i} className="flex items-center gap-1">
								<span className="text-neutral-600">/</span>
								<button className="text-neutral-300 hover:text-neutral-100" onClick={() => void load(target)}>
									{c}
								</button>
							</span>
						);
					})}
					{data?.parentPath && (
						<button
							className="ml-auto text-neutral-500 hover:text-neutral-300"
							onClick={() => void load(data.parentPath!)}
							title={t("dirPicker.up")}
						>
							↑
						</button>
					)}
				</div>

				{error && <p className="px-3 py-1.5 text-xs text-red-400">{error}</p>}

				{/* 目录列表 */}
				<div className="min-h-0 flex-1 overflow-y-auto p-1">
					{(data?.directories ?? []).map((d) => (
						<div
							key={d.path}
							onClick={() => void load(d.path)}
							className="flex cursor-pointer select-none items-center gap-2 rounded px-2 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800/70"
						>
							<svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0 text-neutral-500">
								<path
									d="M1 4.5A1 1 0 0 1 2 3.5H5.5L7 5H14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4.5Z"
									stroke="currentColor"
									strokeWidth="1"
									fill="currentColor"
									fillOpacity="0.15"
								/>
							</svg>
							<span className="truncate">{d.name}</span>
						</div>
					))}
					{(data?.directories ?? []).length === 0 && !error && (
						<p className="px-2 py-2 text-xs text-neutral-600">{t("dirPicker.empty")}</p>
					)}
				</div>

				{/* 底部:当前路径 + 确认 */}
				<div className="flex items-center gap-2 border-t border-neutral-800 p-2">
					<input
						value={path}
						onChange={(e) => setPath(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && void load(path)}
						className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-800 px-2 py-1 font-mono text-xs"
					/>
					<button
						className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-500"
						onClick={() => onPick(path)}
					>
						{t("dirPicker.use")}
					</button>
				</div>
			</div>
		</div>
	);
}
