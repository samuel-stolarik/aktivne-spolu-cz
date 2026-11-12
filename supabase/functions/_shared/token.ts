// Osobní odkaz na formulář zápisu po akci.
//
// Token má 32 náhodných bajtů (256 bitů) a jde do odkazu v base64url.
// Uhodnout se nedá. Do databáze se ukládá JEN jeho SHA-256, takže z dat
// v databázi odkaz sestavit nejde.

/** Vyrobí nový token pro odkaz. */
export function novyToken(): string {
  const bajty = new Uint8Array(32);
  crypto.getRandomValues(bajty);
  let bin = '';
  for (const b of bajty) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** Tvar tokenu, jak ho vyrábí `novyToken`. Jiný řetězec se ani nehashuje. */
export function jeToken(t: unknown): t is string {
  return typeof t === 'string' && /^[A-Za-z0-9_-]{43}$/.test(t);
}

/** SHA-256 tokenu jako 64 znaků šestnáctkově. */
export async function otiskTokenu(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const otisk = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(otisk, (b) => b.toString(16).padStart(2, '0')).join('');
}
