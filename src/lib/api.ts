export async function api<T>(path: string, options?: RequestInit): Promise<T> {
	const res = await fetch(path, {
		headers: { "content-type": "application/json" },
		...options,
	});
	if (!res.ok) {
		let message = `${res.status} ${res.statusText}`;
		try {
			const body = (await res.json()) as { error?: string };
			if (body.error) message = body.error;
		} catch {
			// keep default message
		}
		throw new Error(message);
	}
	return (await res.json()) as T;
}

export function post<T>(path: string, body?: unknown): Promise<T> {
	return api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
}

export function put<T>(path: string, body: unknown): Promise<T> {
	return api<T>(path, { method: "PUT", body: JSON.stringify(body) });
}

export function del<T>(path: string): Promise<T> {
	return api<T>(path, { method: "DELETE" });
}
