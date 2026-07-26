// Constant-time comparison, used wherever a secret or token is checked.
//
// Lived in the plugin proxy, which meant core/auth had to import the plugin
// platform to compare two strings safely.

/** Compares two strings without leaking their common prefix length. */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}
