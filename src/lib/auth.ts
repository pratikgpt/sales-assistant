// The dashboard shows real customer conversations, so it sits behind a shared password.
// The cookie holds a hash of the password (Web Crypto, so it also works in middleware).

export const AUTH_COOKIE = "sa_auth";

export async function authToken(password: string): Promise<string> {
  const data = new TextEncoder().encode(`sales-assistant:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
