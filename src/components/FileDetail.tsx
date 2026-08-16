"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface Props {
	dirId: string;
	path: string;
	name: string;
}

interface FileContent {
	kind: "file";
	path: string;
	name: string;
	size: number;
	content: string;
	truncated: boolean;
}

/** 文件详情(中区显示) */
export default function FileDetail({ dirId, path, name }: Props) {
	const { t } = useI18n();
	const [data, setData] = useState<FileContent | null>(null);
	const [error, setError] = useState("");

	useEffect(() => {
		setData(null);
		setError("");
		api<FileContent>(`/api/dirs/${dirId}/files?path=${encodeURIComponent(path)}`)
			.then(setData)
			.catch((err) => setError(err instanceof Error ? err.message : "load failed"));
	}, [dirId, path]);

	return (
		<div className="flex h-full flex-col">
			<div className="flex shrink-0 items-center gap-2 border-b border-neutral-800 px-4 py-2 text-sm">
				<span className="text-neutral-300">{name}</span>
				<span className="text-xs text-neutral-600">{path}</span>
				{data && (
					<span className="ml-auto text-xs text-neutral-600">
						{formatSize(data.size)}
						{data.truncated ? t("fileTruncated") : ""}
					</span>
				)}
			</div>
			{error && <p className="shrink-0 px-4 py-2 text-xs text-red-400">{error}</p>}
			{!data && !error && <p className="px-4 py-2 text-xs text-neutral-600">{t("loading")}</p>}
			<pre className="min-h-0 flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed text-neutral-300">
				{data?.content}
			</pre>
		</div>
	);
}

function formatSize(size: number): string {
	if (size < 1024) return `${size}B`;
	if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)}KB`;
	return `${(size / 1024 / 1024).toFixed(1)}MB`;
}
