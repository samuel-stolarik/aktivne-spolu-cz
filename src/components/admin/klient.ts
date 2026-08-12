/**
 * Spojení administrace se Supabase.
 *
 * Dvě věci na jednom místě:
 *   1. přihlašování (Supabase Auth, e-mail a heslo),
 *   2. volání Edge Funkce `admin-obsah`, přes kterou jdou úplně všechna data.
 *
 * BEZPEČNOST
 * V prohlížeči je jenom veřejný (anonymní) klíč. Ten sám o sobě nedává
 * přístup k ničemu — k přihláškám se s ním nedostane nikdo, tabulka je
 * zamčená. Přístup dává až přihlašovací token, který vydá Supabase Auth
 * po zadání správného hesla, a i ten funkce ještě porovná se jmenným
 * seznamem správců.
 *
 * Servisní klíč, který zabezpečení obchází, tady NENÍ a nikdy tu být nesmí.
 * Žije jen jako tajemství Edge Funkce na serveru.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const ADRESA_SUPABASE = import.meta.env.PUBLIC_SUPABASE_URL ?? "";
const VEREJNY_KLIC = import.meta.env.PUBLIC_SUPABASE_ANON_KEY ?? "";

/**
 * Je administrace vůbec nastavená?
 *
 * Když se web sestavil bez souboru `.env`, chybí adresa databáze i klíč.
 * Administrace to musí poznat a napsat to slovy — jinak by uživatel jen
 * klikal do prázdna a nic by se nedělo.
 */
export const JE_NASTAVENO = Boolean(ADRESA_SUPABASE && VEREJNY_KLIC);

/** Po kolika milisekundách se čekání na server vzdá. */
const CASOVY_LIMIT_MS = 20000;

let ulozenyKlient: SupabaseClient | null = null;

/** Klient Supabase. Vytvoří se až při prvním použití. */
export function klient(): SupabaseClient {
  if (!ulozenyKlient) {
    ulozenyKlient = createClient(ADRESA_SUPABASE, VEREJNY_KLIC, {
      auth: {
        // Přihlášení přežije zavření okna a token se sám obnovuje,
        // aby správce nevypadával uprostřed práce.
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  }
  return ulozenyKlient;
}

/**
 * Chyba, kterou je možné rovnou ukázat člověku.
 *
 * `message` je vždycky celá česká věta. Technické podrobnosti se do ní
 * nedávají — ty patří do konzole prohlížeče, ne na obrazovku.
 */
export class ChybaAdministrace extends Error {
  /** HTTP kód odpovědi, 0 když se spojení vůbec nenavázalo. */
  readonly stav: number;
  /** true = je potřeba se znovu přihlásit */
  readonly jePotrebaPrihlaseni: boolean;

  constructor(zprava: string, stav = 0) {
    super(zprava);
    this.name = "ChybaAdministrace";
    this.stav = stav;
    this.jePotrebaPrihlaseni = stav === 401;
  }
}

/** Přihlašovací token právě přihlášeného správce, nebo null. */
async function token(): Promise<string | null> {
  const { data } = await klient().auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * Zavolá Edge Funkci `admin-obsah`.
 *
 * @param akce  Co se má stát, například `prihlasky` nebo `uloz-obsah`.
 * @param data  Doplňující údaje akce.
 * @throws ChybaAdministrace s českou větou, kterou lze rovnou zobrazit.
 */
export async function zavolej<T>(
  akce: string,
  data: Record<string, unknown> = {},
): Promise<T> {
  if (!JE_NASTAVENO) {
    throw new ChybaAdministrace(
      "Administrace není nastavená — chybí přístup k databázi. Ozvěte se správci webu.",
    );
  }

  const prihlaseni = await token();
  if (!prihlaseni) {
    throw new ChybaAdministrace("Nejste přihlášeni. Přihlaste se prosím znovu.", 401);
  }

  // Časový limit je tu schválně. Bez něj by se při výpadku sítě čekalo
  // donekonečna a na obrazovce by pořád svítilo „pracuji" — přesně to,
  // co se stát nesmí.
  const prerus = new AbortController();
  const hlidac = window.setTimeout(() => prerus.abort(), CASOVY_LIMIT_MS);

  let odpoved: Response;
  try {
    odpoved = await fetch(`${ADRESA_SUPABASE}/functions/v1/admin-obsah`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: VEREJNY_KLIC,
        Authorization: `Bearer ${prihlaseni}`,
      },
      body: JSON.stringify({ akce, ...data }),
      signal: prerus.signal,
    });
  } catch (chyba) {
    console.error("Volání administrace selhalo:", chyba);
    if (prerus.signal.aborted) {
      throw new ChybaAdministrace(
        "Server neodpovídá. Zkontrolujte připojení k internetu a zkuste to znovu.",
      );
    }
    throw new ChybaAdministrace(
      "Nepodařilo se spojit se serverem. Zkontrolujte připojení k internetu a zkuste to znovu.",
    );
  } finally {
    window.clearTimeout(hlidac);
  }

  let telo: unknown = null;
  try {
    telo = await odpoved.json();
  } catch {
    // Odpověď se nedá přečíst — řeší se níž podle HTTP kódu.
  }

  if (!odpoved.ok) {
    const veta =
      telo && typeof telo === "object" && typeof (telo as { chyba?: unknown }).chyba === "string"
        ? (telo as { chyba: string }).chyba
        : `Server odpověděl chybou ${odpoved.status}. Zkuste to prosím znovu.`;
    throw new ChybaAdministrace(veta, odpoved.status);
  }

  return telo as T;
}

/**
 * Přeloží hlášku od Supabase Auth do češtiny.
 *
 * Supabase odpovídá anglicky a dost technicky. Správce webu je netechnický
 * člověk, takže tady z toho musí být normální věta.
 */
export function ceskyDuvodPrihlaseni(anglickaZprava: string): string {
  const zprava = anglickaZprava.toLowerCase();

  if (zprava.includes("invalid login credentials")) {
    return "E-mail nebo heslo nesouhlasí. Zkuste to prosím znovu.";
  }
  if (zprava.includes("email not confirmed")) {
    return "Účet ještě není potvrzený. Ozvěte se správci webu.";
  }
  if (zprava.includes("rate limit") || zprava.includes("too many")) {
    return "Příliš mnoho pokusů po sobě. Počkejte prosím minutu a zkuste to znovu.";
  }
  if (zprava.includes("failed to fetch") || zprava.includes("network")) {
    return "Nepodařilo se spojit se serverem. Zkontrolujte připojení k internetu.";
  }
  if (zprava.includes("signups not allowed") || zprava.includes("signup is disabled")) {
    return "Zakládání účtů je vypnuté. Účet musí založit správce v Supabase.";
  }

  console.error("Nepřeložená hláška přihlášení:", anglickaZprava);
  return "Přihlášení se nepovedlo. Zkuste to prosím znovu.";
}
