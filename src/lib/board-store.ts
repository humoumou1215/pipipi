import { useEffect } from "react";
import type { Activity, BoardSnapshot, CardDetail, CardSummary, InstanceInfo, Notification } from "./types";

export interface BoardState {
	snapshot: BoardSnapshot | null;
	selectedCardId: number | null;
	selectedInstanceId: string | null;
	selectedRoleId: string | null;
	selectedFile: { path: string; name: string } | null;
	cardDetail: CardDetail | null;
	activities: Activity[];
	notifications: Notification[];
}

export function emptyBoardState(): BoardState {
	return { snapshot: null, selectedCardId: null, selectedInstanceId: null, selectedRoleId: null, selectedFile: null, cardDetail: null, activities: [], notifications: [] };
}

export type BoardEvent =
	| { type: "card.updated" | "card.created" | "card.moved"; card: CardSummary }
	| { type: "activity.created"; activity: Activity }
	| { type: "instance.updated"; instance: InstanceInfo }
	| { type: "notification.created"; notification: Notification }
	| { type: "wake.created"; signal: unknown }
	| { type: "agent.stream"; cardId: number; instanceId: string; event: { message?: { content?: unknown } } };

export function applyBoardEvent(state: BoardState, event: BoardEvent): BoardState {
	switch (event.type) {
		case "card.created":
		case "card.updated":
		case "card.moved": {
			const snapshot = state.snapshot;
			if (!snapshot) return state;
			const idx = snapshot.cards.findIndex((c) => c.id === event.card.id);
			const cards = idx >= 0 ? snapshot.cards.map((c) => (c.id === event.card.id ? event.card : c)) : [...snapshot.cards, event.card];
			return {
				...state,
				snapshot: { ...snapshot, cards },
				cardDetail:
					state.selectedCardId === event.card.id && state.cardDetail
						? { ...state.cardDetail, ...event.card }
						: state.cardDetail,
			};
		}
		case "activity.created": {
			const activities = [...state.activities, event.activity];
			return { ...state, activities };
		}
		case "instance.updated": {
			const snapshot = state.snapshot;
			if (!snapshot) return state;
			const idx = snapshot.instances.findIndex((i) => i.id === event.instance.id);
			const instances =
				idx >= 0 ? snapshot.instances.map((i) => (i.id === event.instance.id ? event.instance : i)) : [...snapshot.instances, event.instance];
			return { ...state, snapshot: { ...snapshot, instances } };
		}
		case "notification.created": {
			return { ...state, notifications: [event.notification, ...state.notifications] };
		}
		case "agent.stream": {
			if (state.selectedCardId !== event.cardId) return state;
			return state;
		}
		case "wake.created":
			return state;
	}
}

/** SSE 订阅:snapshot 由调用方通过 GET /board 拉取,此处只收增量 */
export function useBoardEvents(dirId: string | null, onEvent: (event: BoardEvent) => void): void {
	useEffect(() => {
		if (!dirId) return;
		const es = new EventSource(`/api/dirs/${dirId}/events`);
		es.onmessage = (e) => {
			try {
				const data = JSON.parse(e.data) as BoardEvent;
				if (data && typeof data.type === "string") onEvent(data);
			} catch {
				// ignore malformed frames
			}
		};
		es.onerror = () => {
			// EventSource 自动重连
		};
		return () => es.close();
	}, [dirId, onEvent]);
}
