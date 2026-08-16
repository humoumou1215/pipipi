"use client";

import { useCallback, useEffect, useState } from "react";
import { api, post, put } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface RoleDetailData {
	id: string;
	name: string;
	kind: string;
	model: string | null;
	thinkingLevel: string;
	instanceCount: number;
	roleDir: string;
	files: Record<string, string>;
}

interface Props {
	dirId: string;
	roleId: string;
	onChanged: () => void;
}

/** 角色配置(原 /roles 页的编辑面板,迁入详情区) */
export default function RoleDetail({ dirId, roleId, onChanged }: Props) {
	const { t } = useI18n();
	const [detail, setDetail] = useState<RoleDetailData | null>(null);
	const [scope, setScope] = useState<"project" | "global">("project");
	const [message, setMessage] = useState("");
	const [busy, setBusy] = useState(false);

	const load = useCallback(async () => {
		try {
			const d = await api<RoleDetailData>(`/api/dirs/${dirId}/roles/${roleId}`);
			setDetail(d);
			setMessage("");
		} catch (err) {
			setMessage(err instanceof Error ? err.message : "load failed");
		}
	}, [dirId, roleId]);

	useEffect(() => {
		setDetail(null);
		void load();
	}, [load, roleId]);

	if (!detail) {
		return <div className="p-4 text-sm text-neutral-400">{message || t("loading")}</div>;
	}

	const save = async () => {
		setBusy(true);
		try {
			await put(`/api/dirs/${dirId}/roles/${detail.id}`, {
				role: {
					name: detail.name,
					model: detail.model,
					thinkingLevel: detail.thinkingLevel,
					instanceCount: Number(detail.instanceCount),
				},
				files: {
					"agent.md": detail.files["agent.md"] ?? "",
					"memory.md": detail.files["memory.md"] ?? "",
					"append_system.md": detail.files["append_system.md"] ?? "",
				},
			});
			setMessage(t("saved"));
			onChanged();
		} catch (err) {
			setMessage(err instanceof Error ? err.message : "save failed");
		} finally {
			setBusy(false);
		}
	};

	const scaffold = async () => {
		const id = window.prompt(t("role.newPrompt"));
		if (!id) return;
		try {
			await post(`/api/dirs/${dirId}/roles/${id}`, {
				scope,
				name: id,
				model: "opencode-go/deepseek-v4-flash",
				instanceCount: 1,
			});
			onChanged();
		} catch (err) {
			setMessage(err instanceof Error ? err.message : "scaffold failed");
		}
	};

	return (
		<div className="h-full overflow-y-auto p-4">
			{message && <p className="mb-3 rounded bg-neutral-900 px-3 py-2 text-xs text-neutral-400">{message}</p>}
			<div className="mb-4 flex items-center gap-2">
				<h2 className="min-w-0 flex-1 truncate text-base font-semibold">{t("role.title")}</h2>
				<span className="font-mono text-xs text-neutral-500">{detail.id}</span>
				<select
					className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs"
					value={scope}
					onChange={(e) => setScope(e.target.value as "project" | "global")}
					title={t("role.scope")}
				>
					<option value="project">{t("role.scope.project")}</option>
					<option value="global">{t("role.scope.global")}</option>
				</select>
				<button
					className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
					onClick={() => void scaffold()}
				>
					+ {t("newRole")}
				</button>
			</div>

			<div className="mb-4 grid grid-cols-2 gap-3">
				<label className="text-xs text-neutral-500">
					{t("role.name")}
					<input
						className="mt-1 w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-sm"
						value={detail.name}
						onChange={(e) => setDetail({ ...detail, name: e.target.value })}
					/>
				</label>
				<label className="text-xs text-neutral-500">
					{t("role.instances")}
					<input
						type="number"
						min={1}
						className="mt-1 w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-sm"
						value={detail.instanceCount}
						onChange={(e) => setDetail({ ...detail, instanceCount: Number(e.target.value) })}
					/>
				</label>
				<label className="text-xs text-neutral-500">
					{t("role.model")}
					<input
						className="mt-1 w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1.5 font-mono text-sm"
						value={detail.model ?? ""}
						onChange={(e) => setDetail({ ...detail, model: e.target.value || null })}
					/>
				</label>
				<label className="text-xs text-neutral-500">
					{t("role.thinking")}
					<select
						className="mt-1 w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-sm"
						value={detail.thinkingLevel}
						onChange={(e) => setDetail({ ...detail, thinkingLevel: e.target.value })}
					>
						{(["off", "low", "medium", "high"] as const).map((l) => (
							<option key={l} value={l}>
								{t(`thinking.${l}`)}
							</option>
						))}
					</select>
				</label>
			</div>

			<p className="mb-2 text-[10px] text-neutral-500">
				{t("role.dir")}: {detail.roleDir}
			</p>
			{(["agent.md", "memory.md", "append_system.md"] as const).map((file) => (
				<div key={file} className="mb-3">
					<label className="text-xs text-neutral-500">
						{t(`role.files.${file === "agent.md" ? "agent" : file === "memory.md" ? "memory" : "append"}`)}
						<textarea
							rows={file === "agent.md" ? 10 : 5}
							className="mt-1 w-full resize-y rounded border border-neutral-700 bg-neutral-800 px-2 py-1.5 font-mono text-xs"
							value={detail.files[file] ?? ""}
							onChange={(e) => setDetail({ ...detail, files: { ...detail.files, [file]: e.target.value } })}
						/>
					</label>
				</div>
			))}

			<button
				disabled={busy}
				className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-500 disabled:opacity-50"
				onClick={() => void save()}
			>
				{t("save")}
			</button>
		</div>
	);
}
