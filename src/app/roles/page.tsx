"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { DirInfo, User } from "@/lib/types";
import { api, post, put } from "@/lib/api";

interface RoleDetail {
	id: string;
	name: string;
	kind: string;
	model: string | null;
	thinkingLevel: string;
	instanceCount: number;
	roleDir: string;
	files: Record<string, string>;
}

const DIR_KEY = "pipipi.dir";

export default function RolesPage() {
	const router = useRouter();
	const [user, setUser] = useState<User | null>(null);
	const [dirs, setDirs] = useState<DirInfo[]>([]);
	const [dirId, setDirId] = useState<string | null>(null);
	const [roles, setRoles] = useState<Array<{ id: string; name: string; kind: string; model: string | null; instanceCount: number }>>([]);
	const [editing, setEditing] = useState<RoleDetail | null>(null);
	const [message, setMessage] = useState("");

	useEffect(() => {
		api<User>("/api/auth/me")
			.then(setUser)
			.catch(() => router.push("/login"));
	}, [router]);

	useEffect(() => {
		api<DirInfo[]>("/api/dirs")
			.then((list) => {
				setDirs(list);
				const saved = localStorage.getItem(DIR_KEY);
				const preferred = list.find((d) => d.id === saved) ?? list[0];
				if (preferred) setDirId(preferred.id);
			})
			.catch(() => setMessage("dirs load failed"));
	}, []);

	const loadRoles = useCallback(async () => {
		if (!dirId) return;
		try {
			const list = await api<Array<{ id: string; name: string; kind: string; model: string | null; instanceCount: number }>>(
				`/api/dirs/${dirId}/roles`,
			);
			setRoles(list);
		} catch (err) {
			setMessage(err instanceof Error ? err.message : "load failed");
		}
	}, [dirId]);

	useEffect(() => {
		void loadRoles();
	}, [loadRoles]);

	const openRole = async (roleId: string) => {
		try {
			const detail = await api<RoleDetail>(`/api/dirs/${dirId}/roles/${roleId}`);
			setEditing(detail);
			setMessage("");
		} catch (err) {
			setMessage(err instanceof Error ? err.message : "load failed");
		}
	};

	const scaffold = async () => {
		const id = window.prompt("New role id (lowercase, e.g. qa):");
		if (!id) return;
		try {
			await post(`/api/dirs/${dirId}/roles/${id}`, {
				scope: "project",
				name: id,
				model: "opencode-go/deepseek-v4-flash",
				instanceCount: 1,
			});
			await loadRoles();
			await openRole(id);
		} catch (err) {
			setMessage(err instanceof Error ? err.message : "scaffold failed");
		}
	};

	const save = async () => {
		if (!editing) return;
		try {
			await put(`/api/dirs/${dirId}/roles/${editing.id}`, {
				role: {
					name: editing.name,
					model: editing.model,
					thinkingLevel: editing.thinkingLevel,
					instanceCount: Number(editing.instanceCount),
				},
				files: {
					"agent.md": editing.files["agent.md"] ?? "",
					"memory.md": editing.files["memory.md"] ?? "",
					"append_system.md": editing.files["append_system.md"] ?? "",
				},
			});
			setMessage("saved");
			await loadRoles();
		} catch (err) {
			setMessage(err instanceof Error ? err.message : "save failed");
		}
	};

	return (
		<div className="flex h-screen flex-col">
			<header className="flex items-center gap-3 border-b border-neutral-800 bg-neutral-900/80 px-4 py-2">
				<h1 className="text-base font-semibold">pipipi · Roles</h1>
				<select
					className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm"
					value={dirId ?? ""}
					onChange={(e) => {
						setDirId(e.target.value);
						localStorage.setItem(DIR_KEY, e.target.value);
						setEditing(null);
					}}
				>
					{dirs.map((d) => (
						<option key={d.id} value={d.id}>
							{d.name}
						</option>
					))}
				</select>
				<button className="rounded bg-blue-600 px-2.5 py-1 text-xs text-white hover:bg-blue-500" onClick={() => void scaffold()}>
					+ role
				</button>
				<span className="ml-auto text-xs text-neutral-500">{user?.username}</span>
				<button className="text-xs text-neutral-400 hover:text-neutral-200" onClick={() => router.push("/")}>
					← board
				</button>
			</header>

			{message && <div className="border-b border-neutral-800 bg-neutral-900 px-4 py-1.5 text-xs text-neutral-400">{message}</div>}

			<div className="flex min-h-0 flex-1">
				{/* 角色列表 */}
				<div className="w-64 shrink-0 overflow-y-auto border-r border-neutral-800 p-3">
					{roles.map((r) => (
						<button
							key={r.id}
							onClick={() => void openRole(r.id)}
							className={`mb-1 w-full rounded border px-3 py-2 text-left text-sm hover:bg-neutral-800 ${
								editing?.id === r.id ? "border-blue-600 bg-neutral-800" : "border-neutral-800 bg-neutral-900"
							}`}
						>
							<div className="font-medium text-neutral-200">{r.name}</div>
							<div className="text-[10px] text-neutral-500">
								{r.model ?? "no model"} · {r.instanceCount} inst
							</div>
						</button>
					))}
					{roles.length === 0 && <p className="text-xs text-neutral-600">No roles. Create one with + role.</p>}
				</div>

				{/* 编辑面板 */}
				<div className="min-w-0 flex-1 overflow-y-auto p-4">
					{!editing && <p className="text-sm text-neutral-600">Select a role to edit its configuration and files.</p>}
					{editing && (
						<div className="max-w-3xl">
							<div className="mb-4 grid grid-cols-2 gap-3">
								<label className="text-xs text-neutral-500">
									Name
									<input
										className="mt-1 w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-sm"
										value={editing.name}
										onChange={(e) => setEditing({ ...editing, name: e.target.value })}
									/>
								</label>
								<label className="text-xs text-neutral-500">
									Instances
									<input
										type="number"
										min={1}
										className="mt-1 w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-sm"
										value={editing.instanceCount}
										onChange={(e) => setEditing({ ...editing, instanceCount: Number(e.target.value) })}
									/>
								</label>
								<label className="text-xs text-neutral-500">
									Model (provider/id)
									<input
										className="mt-1 w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-sm font-mono"
										value={editing.model ?? ""}
										onChange={(e) => setEditing({ ...editing, model: e.target.value || null })}
									/>
								</label>
								<label className="text-xs text-neutral-500">
									Thinking level
									<select
										className="mt-1 w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-sm"
										value={editing.thinkingLevel}
										onChange={(e) => setEditing({ ...editing, thinkingLevel: e.target.value })}
									>
										{["off", "low", "medium", "high"].map((l) => (
											<option key={l} value={l}>
												{l}
											</option>
										))}
									</select>
								</label>
							</div>

							{(["agent.md", "memory.md", "append_system.md"] as const).map((file) => (
								<div key={file} className="mb-3">
									<label className="text-xs text-neutral-500">
										{file}
										<textarea
											rows={file === "agent.md" ? 10 : 5}
											className="mt-1 w-full resize-y rounded border border-neutral-700 bg-neutral-800 px-2 py-1.5 font-mono text-xs"
											value={editing.files[file] ?? ""}
											onChange={(e) =>
												setEditing({ ...editing, files: { ...editing.files, [file]: e.target.value } })
											}
										/>
									</label>
								</div>
							))}

							<button
								className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-500"
								onClick={() => void save()}
							>
								Save
							</button>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
