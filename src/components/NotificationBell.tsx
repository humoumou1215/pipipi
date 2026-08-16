"use client";

import { useEffect, useState } from "react";
import type { Notification } from "@/lib/types";
import { api, post } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface Props {
	dirId: string | null;
	onOpenCard: (cardId: number) => void;
}

export default function NotificationBell({ dirId, onOpenCard }: Props) {
	const { t } = useI18n();
	const [notifications, setNotifications] = useState<Notification[]>([]);
	const [open, setOpen] = useState(false);

	const load = async () => {
		try {
			const r = await api<{ notifications: Notification[]; unread: number }>("/api/notifications?unread=1");
			setNotifications(r.notifications);
		} catch {
			// ignore
		}
	};

	useEffect(() => {
		void load();
	}, []);

	const unread = notifications.filter((n) => n.read === 0).length;

	const markRead = async (id: number, cardId: number | null) => {
		await post("/api/notifications", { id });
		setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: 1 } : n)));
		if (cardId != null && dirId) {
			onOpenCard(cardId);
			setOpen(false);
		}
	};

	const markAll = async () => {
		await post("/api/notifications/read-all", {});
		setNotifications((prev) => prev.map((n) => ({ ...n, read: 1 })));
	};

	const typeLabel = (type: string) => {
		const key = `notification.${type === "review_request" ? "reviewRequest" : type === "card_update" ? "cardUpdate" : type}`;
		const v = t(key);
		return v === key ? type : v;
	};

	return (
		<div className="relative">
			<button
				className="relative rounded px-2 py-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
				onClick={() => {
					setOpen((v) => !v);
					void load();
				}}
				title={t("notification.title")}
			>
				<svg width="15" height="15" viewBox="0 0 16 16" fill="none" className="block">
					<path
						d="M8 1.5a4.5 4.5 0 0 0-4.5 4.5v3l-1.2 2.4A.8.8 0 0 0 3 12.5h10a.8.8 0 0 0 .7-1.1L12.5 9V6A4.5 4.5 0 0 0 8 1.5Z"
						stroke="currentColor"
						strokeWidth="1.2"
						fill="none"
					/>
					<path d="M6.5 13.5a1.7 1.7 0 0 0 3 0" stroke="currentColor" strokeWidth="1.2" fill="none" />
				</svg>
				{unread > 0 && (
					<span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] text-white">
						{unread}
					</span>
				)}
			</button>
			{open && (
				<div className="absolute right-0 top-7 z-30 w-80 rounded-lg border border-neutral-700 bg-neutral-900 shadow-xl">
					<div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
						<span className="text-xs font-medium text-neutral-300">{t("notification.title")}</span>
						{unread > 0 && (
							<button className="text-[10px] text-neutral-500 hover:text-neutral-300" onClick={() => void markAll()}>
								{t("notification.markAll")}
							</button>
						)}
					</div>
					<div className="max-h-72 overflow-y-auto">
						{notifications.length === 0 && <p className="p-3 text-xs text-neutral-600">{t("notification.empty")}</p>}
						{notifications.map((n) => (
							<button
								key={n.id}
								onClick={() => void markRead(n.id, n.cardId)}
								className={`block w-full border-b border-neutral-800 px-3 py-2 text-left text-xs hover:bg-neutral-800 ${
									n.read === 0 ? "bg-blue-950/30" : ""
								}`}
							>
								<div className="flex items-center gap-2">
									<span className="text-neutral-300">{typeLabel(n.type)}</span>
									{n.cardId != null && <span className="text-neutral-500">#{n.cardId}</span>}
									<span className="ml-auto text-[10px] text-neutral-600">{new Date(n.createdAt).toLocaleString()}</span>
								</div>
							</button>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
