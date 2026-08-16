"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, post } from "@/lib/api";
import type { BoardSnapshot, CardSummary, DirInfo, User } from "@/lib/types";
import { applyBoardEvent, emptyBoardState, useBoardEvents, type BoardEvent, type BoardState } from "@/lib/board-store";
import BoardView from "@/components/BoardView";
import CardDrawer from "@/components/CardDrawer";
import AgentPanel from "@/components/AgentPanel";

const DIR_KEY = "pipipi.dir";

export default function BoardPage() {
	const router = useRouter();
	const [user, setUser] = useState<User | null>(null);
	const [dirs, setDirs] = useState<DirInfo[]>([]);
	const [dirId, setDirId] = useState<string | null>(null);
	const [board, setBoard] = useState<BoardState>(emptyBoardState());
	const [showNewCard, setShowNewCard] = useState(false);
	const [newTitle, setNewTitle] = useState("");
	const [newDesc, setNewDesc] = useState("");
	const [error, setError] = useState("");
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
			setError(err instanceof Error ? err.message : "board load failed");
		}
	}, [dirId]);

	useEffect(() => {
		api<User>("/api/auth/me")
			.then(setUser)
			.catch(() => router.push("/login"));
	}, [router]);

	useEffect(() => {
		api<DirInfo[]>("/api/dirs")
			.then((list) => {
				// 只选当前可用的目录(summary 非空)
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
			.catch(() => setError("dirs load failed"));
	}, []);

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

	const registerDir = async () => {
		const path = window.prompt("Directory path for a new board:");
		if (!path) return;
		try {
			await post("/api/dirs", { path });
			const list = await api<DirInfo[]>("/api/dirs");
			setDirs(list);
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
				columnId,
			});
			setNewTitle("");
			setNewDesc("");
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

	const unread = board.notifications.filter((n) => n.read === 0).length;

	return (
		<div className="flex h-screen flex-col">
			<header className="flex items-center gap-3 border-b border-neutral-800 bg-neutral-900/80 px-4 py-2">
				<h1 className="text-base font-semibold">pipipi</h1>
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
				<button className="text-xs text-neutral-400 hover:text-neutral-200" onClick={registerDir}>
					+ board
				</button>
				<button
					className="rounded bg-blue-600 px-2.5 py-1 text-xs text-white hover:bg-blue-500"
					onClick={() => setShowNewCard((v) => !v)}
				>
					+ card
				</button>
				<span className="ml-auto text-xs text-neutral-500">
					🔔 {unread} · {user?.displayName ?? user?.username}
				</span>
				<button
					className="rounded px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
					onClick={() => router.push("/roles")}
				>
					roles
				</button>
				<button className="text-xs text-neutral-400 hover:text-neutral-200" onClick={() => void logout()}>
					logout
				</button>
			</header>

			{error && (
				<div className="border-b border-red-900 bg-red-950/40 px-4 py-1.5 text-xs text-red-300">{error}</div>
			)}

			{showNewCard && (
				<div className="border-b border-neutral-800 bg-neutral-900/80 p-3">
					<input
						value={newTitle}
						onChange={(e) => setNewTitle(e.target.value)}
						placeholder="Card title"
						className="mb-2 w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm"
					/>
					<textarea
						value={newDesc}
						onChange={(e) => setNewDesc(e.target.value)}
						placeholder="Description"
						rows={2}
						className="mb-2 w-full resize-none rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm"
					/>
					<button
						className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-500 disabled:opacity-50"
						disabled={!newTitle.trim()}
						onClick={() => void createCard()}
					>
						Create
					</button>
				</div>
			)}

			{board.snapshot ? (
				<div className="flex min-h-0 flex-1">
					<div className="min-w-0 flex-1">
						<BoardView board={board.snapshot} onMoveCard={moveCard} onOpenCard={(id) => setBoard((prev) => ({ ...prev, selectedCardId: id }))} />
					</div>
					<AgentPanel board={board.snapshot} onChanged={() => void reloadBoard()} />
				</div>
			) : (
				<div className="flex flex-1 items-center justify-center text-sm text-neutral-600">
					{dirs.length === 0 ? "Register a board directory (+ board)" : "loading…"}
				</div>
			)}

			{board.snapshot && board.selectedCardId != null && dirId && user && (
				<CardDrawer
					dirId={dirId}
					cardId={board.selectedCardId}
					user={user}
					roles={board.snapshot.roles}
					columns={board.snapshot.columns}
					onClose={() => setBoard((prev) => ({ ...prev, selectedCardId: null }))}
					onChanged={() => void reloadBoard()}
				/>
			)}
		</div>
	);
}
