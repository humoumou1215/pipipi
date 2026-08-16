"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export interface FileRef {
	path: string;
	name: string;
}

interface DirEntry {
	name: string;
	kind: "dir" | "file";
	size: number;
	mtime: string;
}

interface Props {
	dirId: string | null;
	/** 点击文件时回调(详情在中区显示) */
	onSelectFile: (file: FileRef | null) => void;
	/** 当前选中的文件(用于高亮) */
	selectedFile: FileRef | null;
	/** 折叠状态(父级控制,配合 Resizer 收纳) */
	collapsed: boolean;
	onToggleCollapsed: () => void;
}

/** 树形文件浏览器(UX 对齐 pi-web) */
export default function FileBrowser({ dirId, onSelectFile, selectedFile, collapsed, onToggleCollapsed }: Props) {
	const { t } = useI18n();
	const [children, setChildren] = useState<Record<string, DirEntry[]>>({ "": [] });
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [error, setError] = useState("");

	const loadDir = useCallback(
		async (path: string) => {
			if (!dirId) return;
			setError("");
			try {
				const d = await api<{ kind: string; path: string; entries: DirEntry[] }>(
					`/api/dirs/${dirId}/files?path=${encodeURIComponent(path)}`,
				);
				setChildren((prev) => ({ ...prev, [path]: d.entries }));
			} catch (err) {
				setError(err instanceof Error ? err.message : "load failed");
			}
		},
		[dirId],
	);

	useEffect(() => {
		setChildren({ "": [] });
		setExpanded(new Set());
		if (dirId) void loadDir("");
	}, [dirId, loadDir]);

	const toggleDir = async (path: string) => {
		if (expanded.has(path)) {
			setExpanded((prev) => {
				const next = new Set(prev);
				next.delete(path);
				return next;
			});
		} else {
			if (!(path in children)) await loadDir(path);
			setExpanded((prev) => new Set(prev).add(path));
		}
	};

	const renderEntries = (path: string, depth: number) => {
		const entries = children[path] ?? [];
		return entries.map((e) => {
			const full = path ? `${path}/${e.name}` : e.name;
			if (e.kind === "dir") {
				const isOpen = expanded.has(full);
				return (
					<div key={full}>
						<Row
							selected={false}
							indent={depth}
							onClick={() => void toggleDir(full)}
							icon={
								<>
									<Chevron open={isOpen} />
									<FolderIcon />
								</>
							}
						>
							{e.name}
						</Row>
						{isOpen && renderEntries(full, depth + 1)}
					</div>
				);
			}
			const isSelected = selectedFile?.path === full;
			return (
				<Row
					key={full}
					selected={isSelected}
					indent={depth}
					onClick={() => onSelectFile(isSelected ? null : { path: full, name: e.name })}
					icon={
						<>
							<span style={{ width: 10 }} />
							<FileIcon />
						</>
					}
				>
					{e.name}
				</Row>
			);
		});
	};

	return (
		<div className="flex h-full flex-col">
			<button
				className="flex shrink-0 items-center gap-1 px-3 pt-2.5 pb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500 hover:text-neutral-300"
				onClick={onToggleCollapsed}
			>
				<span className={`inline-block text-[9px] transition-transform ${collapsed ? "" : "rotate-90"}`}>▶</span>
				{t("files")}
			</button>
			{!collapsed && (
				<>
					{error && <p className="shrink-0 px-3 pb-1 text-xs text-red-400">{error}</p>}
					<div className="min-h-0 flex-1 overflow-y-auto px-1 pb-1">
						{children[""].length === 0 && !error && <p className="px-2 py-1 text-xs text-neutral-600">{t("loading")}</p>}
						{renderEntries("", 0)}
					</div>
				</>
			)}
		</div>
	);
}

function Row({
	children,
	indent,
	selected,
	onClick,
	icon,
}: {
	children: React.ReactNode;
	indent: number;
	selected: boolean;
	onClick: () => void;
	icon: React.ReactNode;
}) {
	return (
		<div
			onClick={onClick}
			className={`flex cursor-pointer select-none items-center gap-1 rounded px-2 text-xs transition-colors ${
				selected ? "bg-blue-800/40 text-white" : "text-neutral-300 hover:bg-neutral-800/70"
			}`}
			style={{ height: 24, paddingLeft: 8 + indent * 14, paddingRight: 8 }}
		>
			{icon}
			<span className="min-w-0 flex-1 truncate" title={String(children)}>
				{children}
			</span>
		</div>
	);
}

function Chevron({ open }: { open: boolean }) {
	return (
		<svg
			width="10"
			height="10"
			viewBox="0 0 10 10"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.8"
			strokeLinecap="round"
			strokeLinejoin="round"
			className="shrink-0 text-neutral-500"
			style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 0.1s" }}
		>
			<polyline points="3 2 7 5 3 8" />
		</svg>
	);
}

function FolderIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0 text-neutral-500">
			<path
				d="M1 4.5A1 1 0 0 1 2 3.5H5.5L7 5H14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4.5Z"
				stroke="currentColor"
				strokeWidth="1"
				fill="currentColor"
				fillOpacity="0.15"
			/>
		</svg>
	);
}

function FileIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0 text-neutral-500">
			<path
				d="M3 1.5h6l4 4v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1Z"
				stroke="currentColor"
				strokeWidth="1"
				fill="currentColor"
				fillOpacity="0.1"
			/>
			<path d="M9 1.5V6h4" stroke="currentColor" strokeWidth="1" />
		</svg>
	);
}
