import { useState } from "react";

const SESSION_KEY = "streamforge-session";
const DEFAULTS = { userId: "user-1", tenantId: "tenant-a", authToken: "" };

export function useSession() {
  const [session, setSession] = useState(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return DEFAULTS;
      const p = JSON.parse(raw);
      return {
        userId:    typeof p.userId    === "string" && p.userId    ? p.userId    : DEFAULTS.userId,
        tenantId:  typeof p.tenantId  === "string" && p.tenantId  ? p.tenantId  : DEFAULTS.tenantId,
        authToken: typeof p.authToken === "string"                ? p.authToken : "",
      };
    } catch { return DEFAULTS; }
  });

  function saveSession(next) {
    setSession(next);
    localStorage.setItem(SESSION_KEY, JSON.stringify(next));
  }

  return { session, saveSession };
}
