"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, post } from "@/lib/api";
import type { BoardSnapshot, CardSummary, DirInfo, User } from "@/lib/types";
import { applyBoardEvent, emptyBoardState, useBoardEvents, type BoardEvent, type BoardState } from "@/lib/board-store";
import { I18nProvider, useI18n } from "@/lib/i18n";
import BoardView from "@/components/BoardView";
import CardDetail from "@/components/CardDetail";
import AgentDetail from "@/components/AgentDetail";
import AgentBrowser from "@/components/AgentBrowser";
import FileDetail from "@/components/FileDetail";
import FileBrowser from "@/components/FileBrowser";
import NotificationBell from "@/components/NotificationBell";
import Resizer from "@/components/Resizer";
import DirPicker from "@/components/DirPicker";
import RoleDetail from "@/components/RoleDetail";

const DIR_KEY = "pipipi.dir";
const HEADER_H = 32;

function BoardPageInner() {
	const router = useRouter();
	const { t, toggle } = useI18n();
	const [user, setUser] = useState<User | null>(null);
	const [dirs, setDirs] = useState<DirInfo[]>([]);
	const [dirId, setDirId] = useState<string | null>(null);
	const [board, setBoard] = useState<BoardState>(emptyBoardState());
	const [showNewCard, setShowNewCard] = useState(false);
	const [showDirPicker, setShowDirPicker] = useState(false);
	const [newTitle, setNewTitle] = useState("");
	const [newDesc, setNewDesc] = useState("");
	const [newPriority, setNewPriority] = useState(0);
	const [newTags, setNewTags] = useState("");
	const [newAssignee, setNewAssignee] = useState("");
	const [newApprover, setNewApprover] = useState<number | "">("");
	const [newStages, setNewStages] = useState("");
	const [error, setError] = useState("");
	const [approvers, setApprovers] = useState<Array<{ id: number; username: string; displayName: string }>>([]);
	const [leftW, setLeftW] = useState(280);
	const [rightW, setRightW] = useState(340);
	const [treeH, setTreeH] = useState(220);
	const [fileOpen, setFileOpen] = useState(true);
	const [agentOpen, setAgentOpen] = useState(true);
	const boardRef = useRef(board);
	boardRef.current = board;

	const onEvent = useCallback((event: BoardEvent) => {
		setBoard((prev) => applyBoardEvent(prev, event));
	}, []);
	useBoardEvents(dirId, onEvent);

	const reloadBoard = useCallback(async () => {
		if (!dirId) return;
		try {
			const snapshot = await api<BoardSnapshot>(`/api/dirs/${dirId}/board`);
			setBoard((prev) => ({ ...prev, snapshot }));
		} catch (err) {
			setError(err instanceof Error ? err.message : t("internalError"));
		}
	}, [dirId, t]);

	useEffect(() => {
		api<User>("/api/auth/me")
			.then(setUser)
			.catch(() => router.push("/login"));
		api<Array<{ id: number; username: string; displayName: string }>>("/api/users")
			.then(setApprovers)
			.catch(() => {});
	}, [router]);

	useEffect(() => {
		api<DirInfo[]>("/api/dirs")
			.then((list) => {
				const valid = list.filter((d) => d.summary !== null);
				setDirs(valid.length > 0 ? valid : list);
				if (valid.length > 0) {
					const saved = localStorage.getItem(DIR_KEY);
					const preferred = valid.find((d) => d.id === saved) ?? valid[0];
					if (preferred) {
						setDirId(preferred.id);
						localStorage.setItem(DIR_KEY, preferred.id);
					}
				}
			})
			.catch(() => setError(t("dirsLoadFailed")));
	}, [t]);

	useEffect(() => {
		if (dirId) void reloadBoard();
	}, [dirId, reloadBoard]);

	const switchDir = (id: string) => {
		setDirId(id);
		localStorage.setItem(DIR_KEY, id);
		setBoard(emptyBoardState());
	};

	const logout = async () => {
		await post("/api/auth/logout", {});
		router.push("/login");
	};

	const registerDir = async (path: string) => {
		try {
			await post("/api/dirs", { path });
			const list = await api<DirInfo[]>("/api/dirs");
			const valid = list.filter((d) => d.summary !== null);
			setDirs(valid);
			setShowDirPicker(false);
			const picked = valid.find((d) => d.path === path);
			if (picked) switchDir(picked.id);
		} catch (err) {
			window.alert(err instanceof Error ? err.message : "register failed");
		}
	};

	const createCard = async () => {
		if (!newTitle.trim() || !board.snapshot) return;
		try {
			const columnId = board.snapshot.columns[0]?.id;
			const card = await post<CardSummary>(`/api/dirs/${dirId}/cards`, {
				title: newTitle,
				description: newDesc,
				priority: newPriority,
				tags: newTags.split(",").map((x) => x.trim()).filter(Boolean),
				assigneeRole: newAssignee || null,
				reviewApprover: newApprover === "" ? undefined : Number(newApprover),
				stages: newStages
					.split(",")
					.map((r) => r.trim())
					.filter(Boolean)
					.map((roleId) => ({ roleId, title: roleId })),
				columnId,
			});
			setNewTitle("");
			setNewDesc("");
			setNewPriority(0);
			setNewTags("");
			setNewAssignee("");
			setNewApprover("");
			setNewStages("");
			setShowNewCard(false);
			setBoard((prev) =>
				prev.snapshot ? { ...prev, snapshot: { ...prev.snapshot, cards: [...prev.snapshot.cards, card] } } : prev,
			);
		} catch (err) {
			setError(err instanceof Error ? err.message : "create failed");
		}
	};

	const moveCard = async (cardId: number, columnId: number) => {
		try {
			const card = await post<CardSummary>(`/api/dirs/${dirId}/cards/${cardId}/move`, { columnId });
			setBoard((prev) => applyBoardEvent(prev, { type: "card.moved", card }));
		} catch (err) {
			window.alert(err instanceof Error ? err.message : "move failed");
		}
	};

	const openCard = (cardId: number) => {
		setBoard((prev) => ({ ...prev, selectedCardId: cardId, selectedInstanceId: null, selectedRoleId: null, selectedFile: null }));
	};

	const selectInstance = (instanceId: string | null) => {
		setBoard((prev) => ({ ...prev, selectedInstanceId: instanceId, selectedCardId: null, selectedRoleId: null, selectedFile: null }));
	};

	const selectRole = (roleId: string) => {
		setBoard((prev) => ({ ...prev, selectedRoleId: roleId, selectedCardId: null, selectedInstanceId: null, selectedFile: null }));
	};

	const selectFile = (file: { path: string; name: string } | null) => {
		setBoard((prev) => ({ ...prev, selectedFile: file, selectedCardId: null, selectedInstanceId: null, selectedRoleId: null }));
	};

	const createRole = async () => {
		if (!dirId) return;
		const id = window.prompt(t("role.newPrompt"));
		if (!id) return;
		try {
			await post(`/api/dirs/${dirId}/roles/${id}`, {
				scope: "project",
				name: id,
				model: "opencode-go/deepseek-v4-flash",
				instanceCount: 1,
			});
			await reloadBoard();
			selectRole(id);
		} catch (err) {
			setError(err instanceof Error ? err.message : "create failed");
		}
	};

	const snapshot = board.snapshot;
	const selectedCard = snapshot?.cards.find((c) => c.id === board.selectedCardId) ?? null;
	const selectedInstance = snapshot?.instances.find((i) => i.id === board.selectedInstanceId) ?? null;
	const selectedRole = snapshot?.roles.find((r) => r.id === board.selectedRoleId) ?? null;

	return (
		<div className="flex h-screen flex-col">
			<header className="flex items-center gap-3 border-b border-neutral-800 bg-neutral-900/80 px-4 py-2">
				<h1 className="text-base font-semibold">{t("appName")}</h1>
				<select
					className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm"
					value={dirId ?? ""}
					onChange={(e) => switchDir(e.target.value)}
				>
					{dirs.map((d) => (
						<option key={d.id} value={d.id}>
							{d.name} ({d.path})
						</option>
					))}
				</select>
				<button
					className="rounded px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
					onClick={() => setShowDirPicker(true)}
				>
					{t("browse")}
				</button>
				<button className="text-xs text-neutral-400 hover:text-neutral-200" onClick={() => setShowDirPicker(true)}>
					{t("addBoard")}
				</button>
				<button
					className="rounded bg-blue-600 px-2.5 py-1 text-xs text-white hover:bg-blue-500"
					onClick={() => setShowNewCard((v) => !v)}
				>
					{t("addCard")}
				</button>
				<button
					className="rounded px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
					onClick={toggle}
					title="Switch language"
				>
					{t("language")}
				</button>
				<span className="ml-auto flex items-center gap-2 text-xs text-neutral-500">
					<NotificationBell dirId={dirId} onOpenCard={(cardId) => openCard(cardId)} />
					{user?.displayName ?? user?.username}
				</span>
				<button className="text-xs text-neutral-400 hover:text-neutral-200" onClick={() => void logout()}>
					{t("logout")}
				</button>
			</header>

			{error && (
				<div className="border-b border-red-900 bg-red-950/40 px-4 py-1.5 text-xs text-red-300">{error}</div>
			)}

			{showDirPicker && (
				<DirPicker onPick={(path) => void registerDir(path)} onClose={() => setShowDirPicker(false)} />
			)}

			{showNewCard && snapshot && (
				<div className="border-b border-neutral-800 bg-neutral-900/80 p-3">
					<input
						value={newTitle}
						onChange={(e) => setNewTitle(e.target.value)}
						placeholder={t("cardTitle")}
						className="mb-2 w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm"
					/>
					<textarea
						value={newDesc}
						onChange={(e) => setNewDesc(e.target.value)}
						placeholder={t("description")}
						rows={2}
						className="mb-2 w-full resize-none rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm"
					/>
					<div className="mb-2 grid grid-cols-2 gap-2">
						<input
							type="number"
							min={0}
							max={4}
							value={newPriority}
							onChange={(e) => setNewPriority(Number(e.target.value))}
							placeholder={t("priority")}
							className="rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm"
						/>
						<input
							value={newTags}
							onChange={(e) => setNewTags(e.target.value)}
							placeholder={t("tags")}
							className="rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm"
						/>
					</div>
					<div className="mb-2 grid grid-cols-2 gap-2">
						<select
							value={newAssignee}
							onChange={(e) => setNewAssignee(e.target.value)}
							className="rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm"
						>
							<option value="">{t("assigneeRole")}</option>
							{snapshot.roles.map((r) => (
								<option key={r.id} value={r.id}>
									{r.name}
								</option>
							))}
						</select>
						<select
							value={newApprover}
							onChange={(e) => setNewApprover(e.target.value === "" ? "" : Number(e.target.value))}
							className="rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm"
						>
							<option value="">{t("approver")}</option>
							{approvers.map((u) => (
								<option key={u.id} value={u.id}>
									{u.displayName ?? u.username}
								</option>
							))}
						</select>
					</div>
					<input
						value={newStages}
						onChange={(e) => setNewStages(e.target.value)}
						placeholder={t("stages")}
						className="mb-2 w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm"
					/>
					<button
						className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-500 disabled:opacity-50"
						disabled={!newTitle.trim()}
						onClick={() => void createCard()}
					>
						{t("createCard")}
					</button>
				</div>
			)}

			{snapshot ? (
				<div className="flex min-h-0 flex-1">
					{/* 最左:文件浏览器(上) + Agent 浏览器(下),可折叠 */}
					<div
						data-panel="browse"
						style={{ width: leftW }}
						className="flex shrink-0 flex-col overflow-hidden border-r border-neutral-800"
					>
						<div
							style={{ height: fileOpen ? treeH : HEADER_H }}
							className="min-h-0 overflow-hidden"
						>
							<FileBrowser
								dirId={dirId}
								onSelectFile={selectFile}
								selectedFile={board.selectedFile}
								collapsed={!fileOpen}
								onToggleCollapsed={() => setFileOpen((v) => !v)}
							/>
						</div>
						{fileOpen && <Resizer orientation="horizontal" onDelta={(dy) => setTreeH((h) => Math.max(0, h + dy))} />}
						<div className="min-h-0 flex-1 overflow-hidden">
							<AgentBrowser
								board={snapshot}
								selectedInstanceId={board.selectedInstanceId}
								onSelectInstance={selectInstance}
								onSelectRole={selectRole}
								onNewRole={() => void createRole()}
								collapsed={!agentOpen}
								onToggleCollapsed={() => setAgentOpen((v) => !v)}
							/>
						</div>
					</div>
					<Resizer onDelta={(dx) => setLeftW((w) => Math.max(80, w + dx))} />

					{/* 中:看板 */}
					<div className="min-w-0 flex-1 overflow-hidden">
						<BoardView board={snapshot} onMoveCard={moveCard} onOpenCard={openCard} />
					</div>

					{/* 右:详情区(卡片 / 角色 / Agent / 文件 共用) */}
					<Resizer onDelta={(dx) => setRightW((w) => Math.max(200, w - dx))} />
					<div data-panel="detail" style={{ width: rightW }} className="shrink-0 overflow-hidden border-l border-neutral-800">
						{board.selectedFile && dirId ? (
							<FileDetail dirId={dirId} path={board.selectedFile.path} name={board.selectedFile.name} />
						) : selectedCard && user && dirId ? (
							<CardDetail
								dirId={dirId}
								cardId={selectedCard.id}
								user={user}
								roles={snapshot.roles}
								columns={snapshot.columns}
								onChanged={() => void reloadBoard()}
							/>
						) : selectedRole && dirId ? (
							<RoleDetail dirId={dirId} roleId={selectedRole.id} onChanged={() => void reloadBoard()} />
						) : selectedInstance && dirId ? (
							<AgentDetail dirId={dirId} instance={selectedInstance} onChanged={() => void reloadBoard()} />
						) : (
							<div className="flex h-full items-center justify-center text-sm text-neutral-600">
								{board.selectedCardId != null || board.selectedInstanceId != null || board.selectedFile != null
									? t("loading")
									: t("board")}
							</div>
						)}
					</div>
				</div>
			) : (
				<div className="flex flex-1 items-center justify-center text-sm text-neutral-600">
					{dirs.length === 0 ? t("noDirs") : t("loading")}
				</div>
			)}
		</div>
	);
}

export default function BoardPage() {
	return (
		<I18nProvider>
			<BoardPageInner />
		</I18nProvider>
	);
}
