"use client";

import type { BoardSnapshot, CardSummary, Column } from "@/lib/types";

interface Props {
	board: BoardSnapshot;
	onMoveCard: (cardId: number, columnId: number) => void;
	onOpenCard: (cardId: number) => void;
}

export default function BoardView({ board, onMoveCard, onOpenCard }: Props) {
	return (
		<div className="flex h-full gap-3 overflow-x-auto p-3">
			{board.columns.map((column) => (
				<ColumnView
					key={column.id}
					column={column}
					cards={board.cards.filter((c) => c.columnId === column.id)}
					instances={board.instances}
					onMoveCard={onMoveCard}
					onOpenCard={onOpenCard}
				/>
			))}
		</div>
	);
}

function ColumnView({
	column,
	cards,
	instances,
	onMoveCard,
	onOpenCard,
}: {
	column: Column;
	cards: CardSummary[];
	instances: BoardSnapshot["instances"];
	onMoveCard: (cardId: number, columnId: number) => void;
	onOpenCard: (cardId: number) => void;
}) {
	return (
		<div
			className="flex min-w-72 flex-col rounded-lg border border-neutral-800 bg-neutral-900/60"
			onDragOver={(e) => e.preventDefault()}
			onDrop={(e) => {
				e.preventDefault();
				const id = Number(e.dataTransfer.getData("text/plain"));
				if (Number.isInteger(id) && id > 0) onMoveCard(id, column.id);
			}}
		>
			<div className="flex items-center justify-between px-3 py-2">
				<span className="text-sm font-medium text-neutral-300">
					{column.name}
					{column.workflowRole && <span className="ml-2 text-xs text-blue-400">@ {column.workflowRole}</span>}
				</span>
				<span className="text-xs text-neutral-500">{cards.length}</span>
			</div>
			<div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
				{cards.map((card) => (
					<CardItem key={card.id} card={card} instances={instances} onOpen={onOpenCard} />
				))}
				{cards.length === 0 && <div className="flex-1" />}
			</div>
		</div>
	);
}

const STATUS_COLORS: Record<string, string> = {
	ready: "bg-neutral-600",
	claimed: "bg-yellow-600",
	in_progress: "bg-blue-600",
	review: "bg-purple-600",
	blocked: "bg-red-600",
	done: "bg-green-600",
};

function CardItem({
	card,
	instances,
	onOpen,
}: {
	card: CardSummary;
	instances: BoardSnapshot["instances"];
	onOpen: (cardId: number) => void;
}) {
	const holder = card.holderId ? instances.find((i) => i.id === card.holderId) : undefined;
	return (
		<div
			draggable
			onDragStart={(e) => e.dataTransfer.setData("text/plain", String(card.id))}
			onClick={() => onOpen(card.id)}
			className="cursor-pointer rounded border border-neutral-800 bg-neutral-900 p-2.5 hover:border-neutral-600"
		>
			<div className="mb-1 flex items-center gap-1.5">
				<span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_COLORS[card.status] ?? "bg-neutral-500"}`} />
				{card.priority > 0 && (
					<span className="rounded bg-orange-900/60 px-1 text-[10px] text-orange-300">P{card.priority}</span>
				)}
				{card.assigneeRole && <span className="rounded bg-blue-900/60 px-1 text-[10px] text-blue-300">{card.assigneeRole}</span>}
				<span className="ml-auto text-[10px] text-neutral-500">#{card.id}</span>
			</div>
			<p className="text-sm leading-snug text-neutral-200">{card.title}</p>
			<div className="mt-1.5 flex items-center gap-1 text-[10px] text-neutral-500">
				{card.tags.slice(0, 3).map((tag) => (
					<span key={tag} className="rounded bg-neutral-800 px-1">
						{tag}
					</span>
				))}
				{holder && (
					<span className="ml-auto rounded bg-neutral-800 px-1 text-neutral-400">{holder.id}</span>
				)}
			</div>
		</div>
	);
}
