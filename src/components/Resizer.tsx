"use client";

import { useEffect, useRef } from "react";

interface Props {
	/** 拖动 delta 回调:垂直分隔条时正 = 左侧面板变宽;水平分隔条时正 = 上方面板变高 */
	onDelta: (delta: number) => void;
	/** 方向:vertical=左右分隔,horizontal=上下分隔 */
	orientation?: "vertical" | "horizontal";
}

/** 分隔条:拖拽调整相邻面板大小(无上下限钳制) */
export default function Resizer({ onDelta, orientation = "vertical" }: Props) {
	const dragging = useRef(false);
	const start = useRef(0);
	const onDeltaRef = useRef(onDelta);
	onDeltaRef.current = onDelta;

	useEffect(() => {
		const move = (e: MouseEvent) => {
			if (!dragging.current) return;
			const pos = orientation === "vertical" ? e.clientX : e.clientY;
			onDeltaRef.current(pos - start.current);
			start.current = pos;
		};
		const up = () => {
			dragging.current = false;
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
		};
		window.addEventListener("mousemove", move);
		window.addEventListener("mouseup", up);
		return () => {
			window.removeEventListener("mousemove", move);
			window.removeEventListener("mouseup", up);
		};
	}, [orientation]);

	return (
		<div
			onMouseDown={(e) => {
				e.preventDefault();
				dragging.current = true;
				start.current = orientation === "vertical" ? e.clientX : e.clientY;
				document.body.style.cursor = orientation === "vertical" ? "col-resize" : "row-resize";
				document.body.style.userSelect = "none";
			}}
			className={
				orientation === "vertical"
					? "z-10 w-1 shrink-0 cursor-col-resize border-l border-neutral-800 hover:border-blue-600/60 hover:bg-blue-600/20 active:bg-blue-600/30"
					: "z-10 h-1 shrink-0 cursor-row-resize border-t border-neutral-800 hover:border-blue-600/60 hover:bg-blue-600/20 active:bg-blue-600/30"
			}
		/>
	);
}
