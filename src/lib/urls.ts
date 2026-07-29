/** Validate http(s) URL; returns an error message or undefined when ok. */
export function httpUrlError(value: string, label: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return `${label} is not a valid URL: ${value}`;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return `${label} must be http(s), got ${parsed.protocol}`;
  }
  return undefined;
}
