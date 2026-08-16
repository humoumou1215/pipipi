"use client";

import { useEffect, useRef, useState } from "react";
import type { InstanceInfo } from "@/lib/types";
import { post } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface Props {
	dirId: string;
	instance: InstanceInfo;
	onChanged: () => void;
}

function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((b) => (b && typeof b === "object" && "text" in (b as object) ? String((b as { text?: unknown }).text) : ""))
		.join("");
}

export default function AgentDetail({ dirId, instance, onChanged }: Props) {
	const { t } = useI18n();
	const [chatId, setChatId] = useState<string | null>(null);
	const [messages, setMessages] = useState<Array<{ role: string; text: string }>>([]);
	const [input, setInput] = useState("");
	const [sending, setSending] = useState(false);
	const [logs, setLogs] = useState<Array<{ t: string; text: string }>>([]);
	const [error, setError] = useState("");
	const chatRef = useRef<HTMLDivElement>(null);
	const logRef = useRef<HTMLDivElement>(null);

	// 实例事件流(消息 + 重试)
	useEffect(() => {
		const es = new EventSource(`/api/dirs/${dirId}/instances/${instance.id}/events`);
		es.onmessage = (e) => {
			try {
				const data = JSON.parse(e.data) as {
					type?: string;
					event?: { type?: string; message?: { role?: string; content?: unknown } } & Record<string, unknown>;
					instance?: { status?: string };
				};
				if (data.type === "agent.stream") {
					const msg = data.event?.message;
					if (msg?.role === "assistant") {
						const text = extractText(msg.content);
						if (text) {
							setLogs((prev) => {
								const next = [...prev];
								const last = next[next.length - 1];
								if (last && last.t === "stream") next[next.length - 1] = { t: "stream", text };
								else next.push({ t: "stream", text });
								return next.slice(-200);
							});
						}
					}
				} else if (data.type === "agent.retry") {
					const ev = data.event ?? {};
					if (ev.type === "retry_scheduled") {
						setLogs((prev) => [
							...prev.slice(-199),
							{ t: "retry", text: `[retry] ${ev.operation} ${ev.attempt}/${ev.maxAttempts}: ${ev.errorMessage ?? ""}` },
						]);
					} else if (ev.type === "retry_finished") {
						setLogs((prev) => [...prev.slice(-199), { t: "retry", text: `[ok] retry ${ev.operation} finished` }]);
					}
				}
			} catch {
				// ignore
			}
		};
		return () => es.close();
	}, [dirId, instance.id]);

	// 直聊流
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
							if (last && last.role === "assistant") next[next.length - 1] = { role: "assistant", text };
							else next.push({ role: "assistant", text });
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
		chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight });
	}, [messages]);
	useEffect(() => {
		logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
	}, [logs]);

	const startChat = async () => {
		try {
			const r = await post<{ chatId: string }>(`/api/dirs/${dirId}/instances/${instance.id}/chat`, {
				source: { kind: "instance" },
			});
			setChatId(r.chatId);
			onChanged();
		} catch (err) {
			setError(err instanceof Error ? err.message : "chat start failed");
		}
	};

	const endChat = async () => {
		if (chatId) {
			await fetch(`/api/dirs/${dirId}/instances/${instance.id}/chat/${chatId}`, { method: "DELETE" }).catch(() => {});
		}
		setChatId(null);
		setMessages([]);
		onChanged();
	};

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

	const abort = async () => {
		await post(`/api/dirs/${dirId}/instances/${instance.id}/abort`, {}).catch((err) =>
			setError(err instanceof Error ? err.message : "abort failed"),
		);
	};

	return (
		<div className="flex h-full flex-col p-4">
			{error && <p className="mb-3 rounded bg-red-950/60 px-3 py-2 text-xs text-red-300">{error}</p>}
			<div className="mb-3 flex items-center gap-2">
				<h2 className="font-mono text-base font-semibold">{instance.id}</h2>
				<span className="text-xs text-neutral-500">
					{t("status")}: {t(`instance.${instance.status}`)}
					{instance.currentCardId != null && ` · #${instance.currentCardId}`}
				</span>
				<span className="ml-auto flex gap-2">
					{!chatId ? (
						<button className="rounded bg-blue-600 px-2 py-1 text-xs text-white" onClick={() => void startChat()}>
							{t("directChat")}
						</button>
					) : (
						<button className="rounded bg-neutral-700 px-2 py-1 text-xs text-neutral-200" onClick={() => void endChat()}>
							{t("endChat")}
						</button>
					)}
					<button className="rounded bg-neutral-800 px-2 py-1 text-xs text-red-300 hover:bg-neutral-700" onClick={() => void abort()}>
						{t("abort")}
					</button>
				</span>
			</div>

			{/* 直聊(嵌入,不遮盖) */}
			<div className="mb-4 flex h-64 flex-col rounded-lg border border-neutral-800 bg-neutral-950/40">
				<div className="border-b border-neutral-800 px-3 py-1.5 text-xs text-neutral-500">
					{t("directChat")}
					{chatId && <span className="ml-2 text-neutral-600">{chatId}</span>}
				</div>
				<div ref={chatRef} className="flex-1 overflow-y-auto p-2 text-sm">
					{!chatId && <p className="text-xs text-neutral-600">{t("chatNotStarted")}</p>}
					{messages.map((m, i) => (
						<div key={i} className={`mb-1.5 flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
							<div
								className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-2.5 py-1.5 text-xs ${
									m.role === "user" ? "bg-blue-900/60 text-blue-100" : "bg-neutral-800 text-neutral-200"
								}`}
							>
								{m.text}
							</div>
						</div>
					))}
				</div>
				{chatId && (
					<div className="flex gap-2 border-t border-neutral-800 p-2">
						<input
							value={input}
							onChange={(e) => setInput(e.target.value)}
							onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && void send()}
							placeholder={t("messagePlaceholder")}
							className="flex-1 rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs"
						/>
						<button
							disabled={sending || !input.trim()}
							className="rounded bg-blue-600 px-2.5 py-1 text-xs text-white hover:bg-blue-500 disabled:opacity-50"
							onClick={() => void send()}
						>
							{t("send")}
						</button>
					</div>
				)}
			</div>

			{/* 实时日志(嵌入) */}
			<div className="flex min-h-0 flex-1 flex-col rounded-lg border border-neutral-800 bg-neutral-950/40">
				<div className="border-b border-neutral-800 px-3 py-1.5 text-xs text-neutral-500">{t("liveLog")}</div>
				<div ref={logRef} className="min-h-0 flex-1 overflow-y-auto p-2 font-mono text-xs text-neutral-300">
					{logs.length === 0 && <p className="text-neutral-600">{t("waitingEvents")}</p>}
					{logs.map((line, i) => (
						<p key={i} className={`mb-1 whitespace-pre-wrap ${line.t === "retry" ? "text-yellow-400" : ""}`}>
							{line.text}
						</p>
					))}
				</div>
			</div>
		</div>
	);
}
