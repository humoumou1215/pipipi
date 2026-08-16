"use client";

import { useCallback, useEffect, useState } from "react";
import type { Activity, CardDetail, User } from "@/lib/types";
import { api, post } from "@/lib/api";

interface Props {
	dirId: string;
	cardId: number;
	user: User;
	roles: Array<{ id: string; name: string }>;
	columns: Array<{ id: number; name: string; done: boolean }>;
	onClose: () => void;
	onChanged: () => void;
}

const ACTIVITY_LABELS: Record<string, string> = {
	created: "created",
	claimed: "claimed",
	comment: "commented",
	moved: "moved",
	assigned: "assigned",
	stage_done: "stage done",
	blocked: "blocked",
	unblocked: "unblocked",
	review_requested: "requested review",
	review_approved: "approved",
	rejected: "rejected",
	manual_wake: "woke",
	error: "error",
	claim_reaped: "claim reaped",
};

export default function CardDrawer({ dirId, cardId, user, roles, columns, onClose, onChanged }: Props) {
	const [detail, setDetail] = useState<CardDetail | null>(null);
	const [activities, setActivities] = useState<Activity[]>([]);
	const [comment, setComment] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");

	const load = useCallback(async () => {
		try {
			const data = await api<{ card: CardDetail; activities: Activity[] }>(`/api/dirs/${dirId}/cards/${cardId}`);
			setDetail(data.card);
			setActivities(data.activities);
		} catch (err) {
			setError(err instanceof Error ? err.message : "load failed");
		}
	}, [dirId, cardId]);

	useEffect(() => {
		void load();
	}, [load]);

	if (!detail) {
		return (
			<div className="fixed inset-y-0 right-0 w-96 border-l border-neutral-800 bg-neutral-900 p-4 text-sm text-neutral-400">
				{error || "loading…"}
			</div>
		);
	}

	const canReview = user.isAdmin || detail.reviewApprover === user.id;

	const submitComment = async () => {
		if (!comment.trim()) return;
		setBusy(true);
		try {
			await post(`/api/dirs/${dirId}/cards/${cardId}/comment`, { text: comment });
			setComment("");
			await load();
			onChanged();
		} catch (err) {
			setError(err instanceof Error ? err.message : "comment failed");
		} finally {
			setBusy(false);
		}
	};

	const review = async (action: "approve" | "reject") => {
		setBusy(true);
		try {
			await post(`/api/dirs/${dirId}/cards/${cardId}/review`, { action });
			await load();
			onChanged();
		} catch (err) {
			setError(err instanceof Error ? err.message : "review failed");
		} finally {
			setBusy(false);
		}
	};

	const assign = async (roleId: string) => {
		setBusy(true);
		try {
			await post(`/api/dirs/${dirId}/cards/${cardId}/assign`, { roleId });
			await load();
			onChanged();
		} catch (err) {
			setError(err instanceof Error ? err.message : "assign failed");
		} finally {
			setBusy(false);
		}
	};

	const wake = async (roleId: string | null) => {
		const message = window.prompt("Wake message (optional):") ?? "";
		setBusy(true);
		try {
			await post(`/api/dirs/${dirId}/cards/${cardId}/wake`, { roleId, message });
		} catch (err) {
			setError(err instanceof Error ? err.message : "wake failed");
		} finally {
			setBusy(false);
		}
	};

	const move = async (columnId: number) => {
		setBusy(true);
		try {
			await post(`/api/dirs/${dirId}/cards/${cardId}/move`, { columnId });
			await load();
			onChanged();
		} catch (err) {
			setError(err instanceof Error ? err.message : "move failed");
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="fixed inset-y-0 right-0 z-10 flex w-[26rem] flex-col border-l border-neutral-800 bg-neutral-900">
			<div className="flex items-center gap-2 border-b border-neutral-800 px-4 py-3">
				<h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{detail.title}</h2>
				<span className="text-xs text-neutral-500">#{detail.id}</span>
				<button onClick={onClose} className="rounded px-2 py-1 text-neutral-400 hover:bg-neutral-800">
					✕
				</button>
			</div>

			<div className="flex-1 overflow-y-auto p-4">
				{error && <p className="mb-3 rounded bg-red-950/60 px-3 py-2 text-xs text-red-300">{error}</p>}

				{detail.description && (
					<p className="mb-4 whitespace-pre-wrap text-sm text-neutral-300">{detail.description}</p>
				)}

				{detail.stages.length > 0 && (
					<div className="mb-4">
						<h3 className="mb-1 text-xs font-medium uppercase text-neutral-500">Stages</h3>
						{detail.stages.map((stage, idx) => (
							<div key={stage.id} className="mb-1 flex items-center gap-2 text-xs">
								<span
									className={`h-1.5 w-1.5 shrink-0 rounded-full ${
										stage.status === "done" ? "bg-green-500" : idx === detail.stageIdx ? "bg-blue-500" : "bg-neutral-600"
									}`}
								/>
								<span className="text-neutral-300">{stage.roleId}</span>
								<span className="text-neutral-500">
									{stage.status === "done" ? "done" : idx === detail.stageIdx ? "current" : "pending"}
								</span>
							</div>
						))}
					</div>
				)}

				<div className="mb-4">
					<h3 className="mb-1 text-xs font-medium uppercase text-neutral-500">Actions</h3>
					<div className="flex flex-wrap gap-2">
						<select
							className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs"
							value=""
							onChange={(e) => {
								if (e.target.value) void assign(e.target.value);
							}}
						>
							<option value="" disabled>
								Assign to…
							</option>
							{roles.map((r) => (
								<option key={r.id} value={r.id}>
									{r.name}
								</option>
							))}
						</select>
						<select
							className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs"
							value=""
							onChange={(e) => {
								if (e.target.value) void move(Number(e.target.value));
							}}
						>
							<option value="" disabled>
								Move to…
							</option>
							{columns.map((c) => (
								<option key={c.id} value={c.id}>
									{c.name}
								</option>
							))}
						</select>
						<button
							className="rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800"
							onClick={() => void wake(detail.assigneeRole)}
						>
							Wake
						</button>
						{canReview && detail.status === "review" && (
							<>
								<button
									className="rounded bg-green-700 px-2 py-1 text-xs text-white hover:bg-green-600"
									onClick={() => void review("approve")}
								>
									Approve
								</button>
								<button
									className="rounded bg-red-700 px-2 py-1 text-xs text-white hover:bg-red-600"
									onClick={() => void review("reject")}
								>
									Reject
								</button>
							</>
						)}
					</div>
				</div>

				<h3 className="mb-2 text-xs font-medium uppercase text-neutral-500">Activity</h3>
				<div className="space-y-2">
					{activities.map((a) => (
						<div key={a.id} className="rounded border border-neutral-800 bg-neutral-950/50 p-2 text-xs">
							<div className="mb-1 flex items-center gap-2 text-neutral-500">
								<span className="font-medium text-neutral-300">
									{a.actorKind === "user" ? "👤" : "🤖"} {a.actorId}
								</span>
								<span>{ACTIVITY_LABELS[a.type] ?? a.type}</span>
								<span className="ml-auto">{new Date(a.createdAt).toLocaleString()}</span>
							</div>
							{a.type === "comment" && typeof a.payload.text === "string" && (
								<p className="whitespace-pre-wrap text-neutral-300">{a.payload.text}</p>
							)}
							{(a.type === "blocked" || a.type === "rejected") && typeof a.payload.reason === "string" && (
								<p className="text-neutral-400">{a.payload.reason}</p>
							)}
						</div>
					))}
					{activities.length === 0 && <p className="text-xs text-neutral-600">No activity yet.</p>}
				</div>
			</div>

			<div className="border-t border-neutral-800 p-3">
				<textarea
					value={comment}
					onChange={(e) => setComment(e.target.value)}
					placeholder="Comment… use @role / @user to mention"
					className="mb-2 w-full resize-none rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm"
					rows={2}
				/>
				<button
					disabled={busy || !comment.trim()}
					onClick={() => void submitComment()}
					className="w-full rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500 disabled:opacity-50"
				>
					{busy ? "…" : "Comment"}
				</button>
			</div>
		</div>
	);
}
