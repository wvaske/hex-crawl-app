const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

/**
 * Authenticated fetch wrapper that includes credentials (cookies)
 * and sets JSON content type by default.
 */
export async function apiFetch<T = unknown>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}
