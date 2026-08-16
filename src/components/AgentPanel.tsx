"use client";

import { useEffect, useRef, useState } from "react";
import type { BoardSnapshot, InstanceInfo, RoleInfo } from "@/lib/types";
import { post } from "@/lib/api";

interface Props {
	board: BoardSnapshot;
	onChanged: () => void;
}

const STATUS_LABELS: Record<string, string> = {
	idle: "idle",
	working: "working",
	chat: "chat",
	error: "error",
	stopped: "stopped",
};

export default function AgentPanel({ board, onChanged }: Props) {
	const [logInstance, setLogInstance] = useState<InstanceInfo | null>(null);
	const [chatInstance, setChatInstance] = useState<InstanceInfo | null>(null);

	const wakeInstance = async (instanceId: string) => {
		const cardId = window.prompt("Card id to wake for:");
		if (!cardId) return;
		const message = window.prompt("Wake message (optional):") ?? undefined;
		try {
			await post(`/api/dirs/${board.dirId}/instances/${instanceId}/wake`, {
				cardId: Number(cardId),
				message,
			});
			onChanged();
		} catch (err) {
			window.alert(err instanceof Error ? err.message : "wake failed");
		}
	};

	const abort = async (instanceId: string) => {
		try {
			await post(`/api/dirs/${board.dirId}/instances/${instanceId}/abort`, {});
		} catch (err) {
			window.alert(err instanceof Error ? err.message : "abort failed");
		}
	};

	const byRole = new Map<string, InstanceInfo[]>();
	for (const instance of board.instances) {
		const list = byRole.get(instance.roleId) ?? [];
		list.push(instance);
		byRole.set(instance.roleId, list);
	}

	return (
		<div className="w-72 shrink-0 overflow-y-auto border-l border-neutral-800 bg-neutral-900/60 p-3">
			<h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Agents</h2>
			{board.roles.length === 0 && <p className="text-xs text-neutral-600">No roles configured.</p>}
			{board.roles.map((role) => (
				<RoleGroup
					key={role.id}
					role={role}
					instances={byRole.get(role.id) ?? []}
					onWake={wakeInstance}
					onAbort={abort}
					onLog={(instance) => setLogInstance(instance)}
					onChat={(instance) => setChatInstance(instance)}
				/>
			))}
			{logInstance && <InstanceLog dirId={board.dirId} instance={logInstance} onClose={() => setLogInstance(null)} />}
			{chatInstance && <ChatModal dirId={board.dirId} instance={chatInstance} onClose={() => setChatInstance(null)} onChanged={onChanged} />}
		</div>
	);
}

function RoleGroup({
	role,
	instances,
	onWake,
	onAbort,
	onLog,
	onChat,
}: {
	role: RoleInfo;
	instances: InstanceInfo[];
	onWake: (instanceId: string) => void;
	onAbort: (instanceId: string) => void;
	onLog: (instance: InstanceInfo) => void;
	onChat: (instance: InstanceInfo) => void;
}) {
	return (
		<div className="mb-3">
			<div className="mb-1 flex items-center justify-between">
				<span className="text-sm font-medium text-neutral-200">{role.name}</span>
				<span className="text-[10px] text-neutral-500">
					{role.model ?? "no model"} · {role.instanceCount}
				</span>
			</div>
			{instances.map((instance) => (
				<div
					key={instance.id}
					className="mb-1 flex items-center gap-2 rounded border border-neutral-800 bg-neutral-950/50 px-2 py-1.5 text-xs"
				>
					<span
						className={`h-2 w-2 shrink-0 rounded-full ${
							instance.status === "working"
								? "bg-blue-500"
								: instance.status === "error"
									? "bg-red-500"
									: "bg-neutral-600"
						}`}
					/>
					<span className="font-mono text-neutral-300">{instance.id}</span>
					<span className="text-neutral-500">{STATUS_LABELS[instance.status] ?? instance.status}</span>
					{instance.currentCardId != null && <span className="text-neutral-400">#{instance.currentCardId}</span>}
					<span className="ml-auto flex gap-1">
						<button
							className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-300 hover:bg-neutral-700"
							onClick={() => void onChat(instance)}
						>
							chat
						</button>
						<button
							className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-300 hover:bg-neutral-700"
							onClick={() => void onLog(instance)}
						>
							log
						</button>
						<button
							className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-300 hover:bg-neutral-700"
							onClick={() => void onWake(instance.id)}
						>
							wake
						</button>
						<button
							className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-red-300 hover:bg-neutral-700"
							onClick={() => void onAbort(instance.id)}
						>
							abort
						</button>
					</span>
				</div>
			))}
			{instances.length === 0 && <p className="text-[10px] text-neutral-600">no instances</p>}
		</div>
	);
}

/** 直聊弹窗:fork 会话,不进入看板主流程 */
function ChatModal({
	dirId,
	instance,
	onClose,
	onChanged,
}: {
	dirId: string;
	instance: InstanceInfo;
	onClose: () => void;
	onChanged: () => void;
}) {
	const [chatId, setChatId] = useState<string | null>(null);
	const [messages, setMessages] = useState<Array<{ role: string; text: string }>>([]);
	const [input, setInput] = useState("");
	const [error, setError] = useState("");
	const [sending, setSending] = useState(false);
	const bodyRef = useRef<HTMLDivElement>(null);

	// 开始直聊(fork 空白会话)
	const start = async () => {
		try {
			const r = await post<{ chatId: string }>(`/api/dirs/${dirId}/instances/${instance.id}/chat`, {
				source: { kind: "blank" },
			});
			setChatId(r.chatId);
			onChanged();
		} catch (err) {
			setError(err instanceof Error ? err.message : "chat start failed");
		}
	};

	// SSE 订阅流式消息
	useEffect(() => {
		if (!chatId) return;
		const es = new EventSource(`/api/dirs/${dirId}/instances/${instance.id}/chat/${chatId}/events`);
		es.onmessage = (e) => {
			try {
				const data = JSON.parse(e.data) as { type?: string; message?: { role?: string; content?: unknown } };
				if (data.type === "chat.message" && data.message?.role === "assistant") {
					const text = extractText(data.message.content);
					if (text) {
						setMessages((prev) => {
							const next = [...prev];
							const last = next[next.length - 1];
							if (last && last.role === "assistant") {
								// message_update.content 是全量文本(非增量),assistant 消息直接替换
								next[next.length - 1] = { role: "assistant", text };
							} else {
								next.push({ role: "assistant", text });
							}
							return next.slice(-200);
						});
					}
				}
			} catch {
				// ignore
			}
		};
		return () => es.close();
	}, [dirId, instance.id, chatId]);

	useEffect(() => {
		bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
	}, [messages]);

	const send = async () => {
		const text = input.trim();
		if (!text || !chatId) return;
		setMessages((prev) => [...prev, { role: "user", text }]);
		setInput("");
		setSending(true);
		try {
			await post(`/api/dirs/${dirId}/instances/${instance.id}/chat/${chatId}`, { text });
		} catch (err) {
			setError(err instanceof Error ? err.message : "send failed");
		} finally {
			setSending(false);
		}
	};

	const end = async () => {
		if (chatId) {
			await fetch(`/api/dirs/${dirId}/instances/${instance.id}/chat/${chatId}`, { method: "DELETE" }).catch(() => {});
		}
		onChanged();
		onClose();
	};

	return (
		<div className="fixed inset-0 z-20 flex items-center justify-center bg-black/50">
			<div className="flex h-[32rem] w-[44rem] flex-col rounded-lg border border-neutral-700 bg-neutral-900">
				<div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2 text-sm">
					<span className="font-mono">{instance.id}</span>
					<span className="text-neutral-500">direct chat</span>
					{error && <span className="text-red-400">{error}</span>}
					<span className="ml-auto flex gap-2">
						{!chatId && (
							<button className="rounded bg-blue-600 px-2 py-0.5 text-xs text-white" onClick={() => void start()}>
								start
							</button>
						)}
						<button className="text-neutral-400 hover:text-neutral-200" onClick={() => void end()}>
							✕
						</button>
					</span>
				</div>
				<div ref={bodyRef} className="flex-1 overflow-y-auto p-3 text-sm">
					{!chatId && <p className="text-neutral-600">Start a direct chat (forked session, won&apos;t affect the board).</p>}
					{messages.map((m, i) => (
						<div key={i} className={`mb-2 flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
							<div
								className={`max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-2 ${
									m.role === "user" ? "bg-blue-900/60 text-blue-100" : "bg-neutral-800 text-neutral-200"
								}`}
							>
								{m.text}
							</div>
						</div>
					))}
				</div>
				{chatId && (
					<div className="flex gap-2 border-t border-neutral-800 p-3">
						<input
							value={input}
							onChange={(e) => setInput(e.target.value)}
							onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && void send()}
							placeholder="Message the agent…"
							className="flex-1 rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm"
						/>
						<button
							disabled={sending || !input.trim()}
							className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500 disabled:opacity-50"
							onClick={() => void send()}
						>
							Send
						</button>
					</div>
				)}
			</div>
		</div>
	);
}

/** 实例实时日志:订阅实例级 SSE,流式显示助手消息 */
function InstanceLog({ dirId, instance, onClose }: { dirId: string; instance: InstanceInfo; onClose: () => void }) {
	const [lines, setLines] = useState<Array<{ t: string; text: string }>>([]);
	const [status, setStatus] = useState(instance.status);
	const bodyRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const es = new EventSource(`/api/dirs/${dirId}/instances/${instance.id}/events`);
		es.onmessage = (e) => {
			try {
				const data = JSON.parse(e.data) as {
					type: string;
					instanceId?: string;
					event?: { type: string; message?: { role?: string; content?: unknown } };
					instance?: { status?: string; currentCardId?: number | null };
				};
				if (data.type === "agent.stream") {
					const msg = data.event?.message;
					const text = extractText(msg?.content);
					if (text) {
						setLines((prev) => {
							const next = [...prev];
							const last = next[next.length - 1];
							if (last && last.t === "stream") {
								// message_update.content 是全量文本,直接替换
							next[next.length - 1] = { t: "stream", text };
							} else {
								next.push({ t: "stream", text });
							}
							return next.slice(-200);
						});
					}
				} else if (data.type === "agent.retry") {
					const ev = (data.event ?? {}) as {
						type?: string;
						operation?: string;
						attempt?: number;
						maxAttempts?: number;
						errorMessage?: string;
					};
					if (ev.type === "retry_scheduled") {
						setLines((prev) => [
							...prev.slice(-199),
							{ t: "retry", text: `⚠ retry ${ev.operation} attempt ${ev.attempt}/${ev.maxAttempts}: ${ev.errorMessage ?? ""}` },
						]);
					} else if (ev.type === "retry_attempt_start") {
						setLines((prev) => [...prev.slice(-199), { t: "retry", text: `↻ retry ${ev.operation}…` }]);
					} else if (ev.type === "retry_finished") {
						setLines((prev) => [...prev.slice(-199), { t: "retry", text: `✓ retry ${ev.operation} finished` }]);
					}
				} else if (data.type === "instance.updated") {
					setStatus(data.instance?.status ?? status);
				}
			} catch {
				// ignore
			}
		};
		return () => es.close();
	}, [dirId, instance.id, status]);

	useEffect(() => {
		bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
	}, [lines]);

	return (
		<div className="fixed inset-0 z-20 flex items-center justify-center bg-black/50">
			<div className="flex h-96 w-[42rem] flex-col rounded-lg border border-neutral-700 bg-neutral-900">
				<div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2 text-sm">
					<span className="font-mono">{instance.id}</span>
					<span className="text-neutral-500">live log · {status}</span>
					<button className="ml-auto text-neutral-400 hover:text-neutral-200" onClick={onClose}>
						✕
					</button>
				</div>
				<div ref={bodyRef} className="flex-1 overflow-y-auto p-3 font-mono text-xs text-neutral-300">
					{lines.length === 0 && <p className="text-neutral-600">waiting for events…</p>}
					{lines.map((line, i) => (
						<p key={i} className="mb-1 whitespace-pre-wrap">
							{line.text}
						</p>
					))}
				</div>
			</div>
		</div>
	);
}

function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((b) => (b && typeof b === "object" && "text" in (b as object) ? String((b as { text?: unknown }).text) : ""))
		.join("");
}
