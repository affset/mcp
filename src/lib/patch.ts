import { mdCell } from "./format.js";

/** One field change for dry-run / apply summaries. */
export interface FieldChange {
  field: string;
  from: string;
  to: string;
}

/** Render a before → after markdown table. */
export function renderDiff(changes: FieldChange[]): string {
  if (changes.length === 0) return "_No field changes._";
  const lines = [
    "| Field | From | To |",
    "|---|---|---|",
    ...changes.map((c) => `| ${mdCell(c.field)} | ${mdCell(c.from)} | ${mdCell(c.to)} |`),
  ];
  return lines.join("\n");
}

/** Display helper for nullable / missing values. */
export function displayValue(value: unknown): string {
  if (value === undefined) return "(unset)";
  if (value === null) return "(null)";
  if (typeof value === "string" && value.trim() === "") return "(empty)";
  return String(value);
}
