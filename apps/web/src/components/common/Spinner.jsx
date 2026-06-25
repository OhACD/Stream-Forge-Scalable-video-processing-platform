import React from "react";

export default function Spinner({ size = "md" }) {
  return <span className={`spinner${size === "lg" ? " spinner-lg" : ""}`} role="status" aria-label="Loading" />;
}
