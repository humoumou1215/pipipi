"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type Lang = "zh" | "en";

// 术语表:
//   Board=看板  Column=列  Card=卡片  Role=角色  Instance=实例
//   Assignee=负责人  Approver=验收人  Stage=阶段  Status=状态
//   Activity=活动  Comment=评论  Wake=唤醒  Block=阻塞
//   Direct chat=直聊  Queue=队列  Checklist=清单  Notification=通知
// key 统一 snake_case,按域前缀分组(status.* / activity.* / role.* / login.* / dirPicker.* / notification.*)

const zh: Record<string, string> = {
	appName: "pipipi",
	board: "看板",
	login: "登录",
	logout: "退出",
	roles: "角色",
	addBoard: "+ 看板",
	addCard: "+ 卡片",
	createCard: "创建卡片",
	cardTitle: "卡片标题",
	description: "描述",
	priority: "优先级",
	tags: "标签(逗号分隔)",
	assigneeRole: "负责人角色…",
	approver: "验收人(默认:你)",
	stages: "阶段:角色 id,逗号分隔(如 dev, qa)",
	status: "状态",
	assignee: "负责人",
	edit: "编辑",
	save: "保存",
	saved: "已保存",
	actions: "操作",
	assignTo: "指派给…",
	moveTo: "移动到…",
	setApprover: "设置验收人…",
	wake: "唤醒",
	block: "阻塞",
	unblock: "解除阻塞",
	blockReason: "阻塞原因:",
	approve: "通过",
	reject: "驳回",
	activity: "活动",
	noActivity: "暂无活动",
	commentPlaceholder: "评论…用 @角色 / @用户 提及",
	comment: "评论",
	checklist: "清单",
	addChecklist: "添加清单项…",
	add: "添加",
	stagesTitle: "阶段",
	agents: "Agents",
	noRoles: "暂无角色配置",
	noInstances: "无实例",
	directChat: "直聊",
	endChat: "结束直聊",
	liveLog: "实时日志",
	abort: "中止",
	loading: "加载中…",
	registerBoard: "注册一个看板目录(+ 看板)",
	waitingEvents: "等待事件…",
	startChat: "开始",
	messagePlaceholder: "给 Agent 发消息…",
	send: "发送",
	chatNotStarted: "开始直聊(fork 会话,不影响看板)",
	files: "文件",
	filePreview: "文件预览",
	fileTruncated: " (截断)",
	dirEmpty: "(空目录)",
	language: "中文",
	internalError: "内部错误",
	dirsLoadFailed: "目录加载失败",
	noDirs: "注册一个看板目录",
	browse: "浏览",
	newRole: "新建角色",

	// 卡片状态(status.*)
	"status.ready": "待处理",
	"status.claimed": "已认领",
	"status.in_progress": "处理中",
	"status.review": "待验收",
	"status.blocked": "已阻塞",
	"status.done": "已完成",

	// 实例状态(instance.*)
	"instance.idle": "空闲",
	"instance.working": "工作中",
	"instance.chat": "直聊中",
	"instance.error": "错误",
	"instance.stopped": "已停止",

	// 活动类型(activity.*)
	"activity.created": "创建",
	"activity.claimed": "认领",
	"activity.comment": "评论",
	"activity.moved": "移动",
	"activity.assigned": "指派",
	"activity.stage_done": "阶段完成",
	"activity.blocked": "阻塞",
	"activity.unblocked": "解除阻塞",
	"activity.review_requested": "请求验收",
	"activity.review_approved": "验收通过",
	"activity.rejected": "驳回",
	"activity.manual_wake": "唤醒",
	"activity.error": "错误",
	"activity.claim_reaped": "认领回收",

	// 活动演员(actor.*)
	"actor.user": "用户",
	"actor.agent": "Agent",

	// 角色配置(role.*)
	"role.title": "角色配置",
	"role.name": "名称",
	"role.instances": "实例数",
	"role.model": "模型(provider/id)",
	"role.thinking": "思考级别",
	"role.scope": "模板作用域",
	"role.scope.project": "项目(当前看板)",
	"role.scope.global": "全局(~/.pipipi/roles,跨看板共享)",
	"role.newPrompt": "新角色 id(小写,如 qa):",
	"role.dir": "目录",
	"role.select": "选择角色或新建角色进行配置",
	"role.files.agent": "角色指令(agent.md)",
	"role.files.memory": "长期记忆(memory.md)",
	"role.files.append": "追加系统提示(append_system.md)",
	"thinking.off": "关闭",
	"thinking.low": "低",
	"thinking.medium": "中",
	"thinking.high": "高",

	// 登录/引导(login.*)
	"login.title": "pipipi",
	"login.setupTitle": "首次运行:创建管理员账号,管理员可创建其他用户",
	"login.displayName": "显示名",
	"login.username": "用户名",
	"login.password": "密码",
	"login.createAdmin": "创建管理员",
	"login.login": "登录",

	// 目录选择(dirPicker.*)
	"dirPicker.title": "选择看板目录",
	"dirPicker.use": "使用此目录",
	"dirPicker.up": "上级",
	"dirPicker.empty": "(无子目录)",

	// 通知(notification.*)
	"notification.title": "通知",
	"notification.markAll": "全部已读",
	"notification.empty": "暂无通知",
	"notification.mention": "提到了你",
	"notification.reviewRequest": "请求验收",
	"notification.cardUpdate": "卡片更新",
};

const en: Record<string, string> = {
	appName: "pipipi",
	board: "Board",
	login: "Login",
	logout: "Logout",
	roles: "Roles",
	addBoard: "+ Board",
	addCard: "+ Card",
	createCard: "Create Card",
	cardTitle: "Card title",
	description: "Description",
	priority: "Priority",
	tags: "Tags (comma separated)",
	assigneeRole: "Assignee role…",
	approver: "Approver (default: you)",
	stages: "Stages: role ids, comma separated (e.g. dev, qa)",
	status: "Status",
	assignee: "Assignee",
	edit: "Edit",
	save: "Save",
	saved: "saved",
	actions: "Actions",
	assignTo: "Assign to…",
	moveTo: "Move to…",
	setApprover: "Set approver…",
	wake: "Wake",
	block: "Block",
	unblock: "Unblock",
	blockReason: "reason:",
	approve: "Approve",
	reject: "Reject",
	activity: "Activity",
	noActivity: "No activity yet.",
	commentPlaceholder: "Comment… use @role / @user to mention",
	comment: "Comment",
	checklist: "Checklist",
	addChecklist: "Add checklist item…",
	add: "Add",
	stagesTitle: "Stages",
	agents: "Agents",
	noRoles: "No roles configured.",
	noInstances: "no instances",
	directChat: "Chat",
	endChat: "End chat",
	liveLog: "Log",
	abort: "Abort",
	loading: "loading…",
	registerBoard: "Register a board directory (+ Board)",
	waitingEvents: "waiting for events…",
	startChat: "Start",
	messagePlaceholder: "Message the agent…",
	send: "Send",
	chatNotStarted: "Start a direct chat (forked session, won't affect the board).",
	files: "Files",
	filePreview: "File Preview",
	fileTruncated: " (truncated)",
	dirEmpty: "(empty)",
	language: "EN",
	internalError: "internal error",
	dirsLoadFailed: "dirs load failed",
	noDirs: "Register a board directory",
	browse: "Browse",
	newRole: "New role",

	"status.ready": "ready",
	"status.claimed": "claimed",
	"status.in_progress": "in progress",
	"status.review": "review",
	"status.blocked": "blocked",
	"status.done": "done",

	"instance.idle": "idle",
	"instance.working": "working",
	"instance.chat": "chat",
	"instance.error": "error",
	"instance.stopped": "stopped",

	"activity.created": "created",
	"activity.claimed": "claimed",
	"activity.comment": "commented",
	"activity.moved": "moved",
	"activity.assigned": "assigned",
	"activity.stage_done": "stage done",
	"activity.blocked": "blocked",
	"activity.unblocked": "unblocked",
	"activity.review_requested": "requested review",
	"activity.review_approved": "approved",
	"activity.rejected": "rejected",
	"activity.manual_wake": "woke",
	"activity.error": "error",
	"activity.claim_reaped": "claim reaped",

	"actor.user": "user",
	"actor.agent": "agent",

	"role.title": "Role Config",
	"role.name": "Name",
	"role.instances": "Instances",
	"role.model": "Model (provider/id)",
	"role.thinking": "Thinking level",
	"role.scope": "Template scope",
	"role.scope.project": "project (this board)",
	"role.scope.global": "global (~/.pipipi/roles, shared across boards)",
	"role.newPrompt": "New role id (lowercase, e.g. qa):",
	"role.dir": "dir",
	"role.select": "Select a role or create a new one to configure.",
	"role.files.agent": "Role instructions (agent.md)",
	"role.files.memory": "Long-term memory (memory.md)",
	"role.files.append": "Append to system prompt (append_system.md)",
	"thinking.off": "off",
	"thinking.low": "low",
	"thinking.medium": "medium",
	"thinking.high": "high",

	"login.title": "pipipi",
	"login.setupTitle": "First run: create the admin account. Admin creates all other users.",
	"login.displayName": "Display name",
	"login.username": "Username",
	"login.password": "Password",
	"login.createAdmin": "Create admin",
	"login.login": "Login",

	"dirPicker.title": "Choose board directory",
	"dirPicker.use": "Use this directory",
	"dirPicker.up": "up",
	"dirPicker.empty": "(no subdirectories)",

	"notification.title": "Notifications",
	"notification.markAll": "mark all read",
	"notification.empty": "No notifications.",
	"notification.mention": "mentioned you",
	"notification.reviewRequest": "requests review",
	"notification.cardUpdate": "card updated",
};

const dicts: Record<Lang, Record<string, string>> = { zh, en };

const I18nContext = createContext<{ lang: Lang; t: (key: string) => string; toggle: () => void }>({
	lang: "zh",
	t: (k) => zh[k] ?? k,
	toggle: () => {},
});

const LANG_KEY = "pipipi.lang";

export function I18nProvider({ children }: { children: React.ReactNode }) {
	const [lang, setLang] = useState<Lang>("zh");

	useEffect(() => {
		const saved = localStorage.getItem(LANG_KEY);
		if (saved === "en" || saved === "zh") setLang(saved);
	}, []);

	const toggle = useCallback(() => {
		setLang((prev) => {
			const next: Lang = prev === "zh" ? "en" : "zh";
			localStorage.setItem(LANG_KEY, next);
			return next;
		});
	}, []);

	const t = useCallback((key: string) => dicts[lang][key] ?? key, [lang]);
	const value = useMemo(() => ({ lang, t, toggle }), [lang, t, toggle]);

	return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
	return useContext(I18nContext);
}
