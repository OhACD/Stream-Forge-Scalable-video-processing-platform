import { useState, useCallback } from "react";

export function useActivity() {
  const [entries, setEntries] = useState([]);

  const log = useCallback((message, tone = "info") => {
    const at = new Date().toLocaleTimeString([], {
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    setEntries((prev) => [{ message, tone, at }, ...prev].slice(0, 40));
  }, []);

  return { entries, log };
}
