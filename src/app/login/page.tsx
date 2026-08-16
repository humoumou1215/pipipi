"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, post } from "@/lib/api";
import { useI18n, I18nProvider } from "@/lib/i18n";

export default function LoginPage() {
	return (
		<I18nProvider>
			<LoginPageInner />
		</I18nProvider>
	);
}

function LoginPageInner() {
	const router = useRouter();
	const { t } = useI18n();
	const [mode, setMode] = useState<"login" | "setup">("login");
	const [initialized, setInitialized] = useState<boolean | null>(null);
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [displayName, setDisplayName] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		api<{ initialized: boolean }>("/api/auth/setup")
			.then((r) => {
				setInitialized(r.initialized);
				setMode(r.initialized ? "login" : "setup");
			})
			.catch(() => setInitialized(true));
	}, []);

	const submit = useCallback(
		async (e: React.FormEvent) => {
			e.preventDefault();
			setError("");
			setBusy(true);
			try {
				if (mode === "setup") {
					await post("/api/auth/setup", { username, password, displayName });
				} else {
					await post("/api/auth/login", { username, password });
				}
				router.push("/");
				router.refresh();
			} catch (err) {
				setError(err instanceof Error ? err.message : "failed");
			} finally {
				setBusy(false);
			}
		},
		[mode, username, password, displayName, router],
	);

	if (initialized === null) {
		return <div className="flex h-screen items-center justify-center text-neutral-500">loading…</div>;
	}

	return (
		<div className="flex h-screen items-center justify-center">
			<form onSubmit={submit} className="w-80 rounded-lg border border-neutral-800 bg-neutral-900 p-6">
				<h1 className="mb-4 text-xl font-semibold">pipipi</h1>
				{mode === "setup" && (
					<p className="mb-4 text-sm text-neutral-400">{t("login.setupTitle")}</p>
				)}
				{mode === "setup" && (
					<input
						className="mb-3 w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm"
						placeholder={t("login.displayName")}
						value={displayName}
						onChange={(e) => setDisplayName(e.target.value)}
					/>
				)}
				<input
					className="mb-3 w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm"
					placeholder={t("login.username")}
					value={username}
					onChange={(e) => setUsername(e.target.value)}
					autoFocus
				/>
				<input
					className="mb-4 w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm"
					type="password"
					placeholder={t("login.password")}
					value={password}
					onChange={(e) => setPassword(e.target.value)}
				/>
				{error && <p className="mb-3 text-sm text-red-400">{error}</p>}
				<button
					disabled={busy}
					className="w-full rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
				>
					{busy ? "…" : mode === "setup" ? t("login.createAdmin") : t("login.login")}
				</button>
			</form>
		</div>
	);
}
