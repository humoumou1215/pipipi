"use client";

import type { BoardSnapshot, InstanceInfo, RoleInfo } from "@/lib/types";
import { useI18n } from "@/lib/i18n";

interface Props {
	board: BoardSnapshot | null;
	selectedInstanceId: string | null;
	onSelectInstance: (instanceId: string | null) => void;
	/** 点击角色名 → 中区打开角色配置 */
	onSelectRole: (roleId: string) => void;
	onNewRole: () => void;
	/** 折叠状态(父级控制) */
	collapsed: boolean;
	onToggleCollapsed: () => void;
}

const STATUS_DOT: Record<string, string> = {
	idle: "bg-neutral-600",
	working: "bg-blue-500",
	chat: "bg-purple-500",
	error: "bg-red-500",
	stopped: "bg-neutral-700",
};

/** Agent 浏览器:角色分组 + 实例列表;点击角色 → 角色配置,点击实例 → 中区实例详情 */
export default function AgentBrowser({
	board,
	selectedInstanceId,
	onSelectInstance,
	onSelectRole,
	onNewRole,
	collapsed,
	onToggleCollapsed,
}: Props) {
	const { t } = useI18n();
	const byRole = new Map<string, InstanceInfo[]>();
	if (board) {
		for (const instance of board.instances) {
			const list = byRole.get(instance.roleId) ?? [];
			list.push(instance);
			byRole.set(instance.roleId, list);
		}
	}
	return (
		<div className="flex h-full flex-col">
			<button
				className="flex shrink-0 items-center gap-1 px-3 pt-2.5 pb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500 hover:text-neutral-300"
				onClick={onToggleCollapsed}
			>
				<span className={`inline-block text-[9px] transition-transform ${collapsed ? "" : "rotate-90"}`}>▶</span>
				{t("agents")}
			</button>
			{!collapsed && (
				<>
					<div className="min-h-0 flex-1 overflow-y-auto px-1 pb-1">
						{board && board.roles.length === 0 && <p className="px-2 py-1 text-xs text-neutral-600">{t("noRoles")}</p>}
						{board?.roles.map((role) => (
							<RoleGroup
								key={role.id}
								role={role}
								instances={byRole.get(role.id) ?? []}
								selectedInstanceId={selectedInstanceId}
								onSelectInstance={onSelectInstance}
								onSelectRole={onSelectRole}
							/>
						))}
					</div>
					<button
						className="mx-2 mb-1.5 shrink-0 rounded border border-neutral-800 px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
						onClick={onNewRole}
					>
						+ {t("newRole")}
					</button>
				</>
			)}
		</div>
	);
}

function RoleGroup({
	role,
	instances,
	selectedInstanceId,
	onSelectInstance,
	onSelectRole,
}: {
	role: RoleInfo;
	instances: InstanceInfo[];
	selectedInstanceId: string | null;
	onSelectInstance: (instanceId: string | null) => void;
	onSelectRole: (roleId: string) => void;
}) {
	const { t } = useI18n();
	return (
		<div className="mb-2">
			<button
				className="flex w-full items-center justify-between px-2 py-1 text-left hover:bg-neutral-800/70"
				onClick={() => onSelectRole(role.id)}
				title={role.id}
			>
				<span className="text-xs font-medium text-neutral-200">{role.name}</span>
				<span className="text-[10px] text-neutral-600">
					{role.model?.split("/")[1] ?? "no model"} · {role.instanceCount}
				</span>
			</button>
			{instances.map((instance) => {
				const isSelected = selectedInstanceId === instance.id;
				return (
					<div
						key={instance.id}
						onClick={() => onSelectInstance(isSelected ? null : instance.id)}
						className={`mb-0.5 flex cursor-pointer select-none items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors ${
							isSelected ? "bg-blue-800/40 text-white" : "text-neutral-300 hover:bg-neutral-800/70"
						}`}
					>
						<span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[instance.status] ?? "bg-neutral-600"}`} />
						<span className="font-mono">{instance.id.split("-").pop()}</span>
						<span className="text-[10px] text-neutral-500">
							{t(`instance.${instance.status}`)}
							{instance.currentCardId != null ? ` #${instance.currentCardId}` : ""}
						</span>
						{instance.queueLen > 0 && <span className="ml-auto text-[10px] text-yellow-400">q{instance.queueLen}</span>}
					</div>
				);
			})}
			{instances.length === 0 && <p className="px-2 text-[10px] text-neutral-600">{t("noInstances")}</p>}
		</div>
	);
}
