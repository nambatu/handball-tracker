// ===================================================================
// Edge Function "register" - Konto anlegen mit Einladungscode
// ===================================================================
// Ersetzt POST /api/register aus server.js. Supabase Auth kennt nur
// E-Mail-Adressen; aus dem Benutzernamen wird deshalb intern eine
// erfundene Adresse <slug>@tracker.langschwerts.de. Dorthin wird nie
// etwas geschickt (email_confirm: true).
//
// Das Konto zaehlt erst mit der Zeile in "profiles" - die legt nur diese
// Function an. Ohne gesetzten REGISTRATION_CODE wird NIE registriert.
//
// verify_jwt ist aus: wer sich registriert, hat noch kein Token. Der
// Schutz ist der Einladungscode plus das Limit je Adresse.

import { createClient } from "npm:@supabase/supabase-js@2";

const MAIL_DOMAIN = "tracker.langschwerts.de";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function antwort(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// Muss zu usernameSlug() in server.js und public/js/api.js passen.
function usernameSlug(username: string): string {
  return String(username || "").replace(/[^a-z0-9]/gi, "_").toLowerCase();
}

// Zeitkonstanter Vergleich, damit sich der Code nicht ueber Laufzeit-
// unterschiede Zeichen fuer Zeichen erraten laesst.
async function gleich(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return antwort(405, { error: "Nur POST" });

  try {
    const erwartet = Deno.env.get("REGISTRATION_CODE") || "";
    if (!erwartet) {
      console.error("[register] REGISTRATION_CODE ist nicht gesetzt - Registrierung gesperrt.");
      return antwort(503, { error: "Registrierung ist nicht eingerichtet." });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "?";
    const limit = await admin.rpc("register_erlaubt", { p_ip: ip });
    if (limit.error) throw limit.error;
    if (limit.data !== true) {
      return antwort(429, { error: "Zu viele Versuche. Bitte in einer Stunde erneut probieren." });
    }

    const body = await req.json().catch(() => ({}));
    const username = String(body.username || "");
    const password = String(body.password || "");
    const code = String(body.code || "");

    if (!username || !password) {
      return antwort(400, { error: "Benutzername und Passwort werden gebraucht." });
    }
    if (!(await gleich(code, erwartet))) {
      return antwort(403, { error: "Ungültiger Einladungscode" });
    }
    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(username)) {
      return antwort(400, { error: "Benutzername: 3-32 Zeichen, nur Buchstaben, Ziffern, _ und -" });
    }
    if (password.length < 8) {
      return antwort(400, { error: "Passwort muss mindestens 8 Zeichen lang sein" });
    }
    if (password.length > 72) {
      return antwort(400, { error: "Passwort darf höchstens 72 Zeichen lang sein" });
    }

    // Gegen den NORMALISIERTEN Namen pruefen ("Ju-Lang" und "Ju_Lang"
    // waeren sonst zwei Konten mit denselben Altdaten).
    const slug = usernameSlug(username);
    const vorhanden = await admin.from("profiles").select("user_id").eq("slug", slug).maybeSingle();
    if (vorhanden.error) throw vorhanden.error;
    if (vorhanden.data) return antwort(400, { error: "Diesen Benutzernamen gibt es schon." });

    const angelegt = await admin.auth.admin.createUser({
      email: `${slug}@${MAIL_DOMAIN}`,
      password,
      email_confirm: true,
      user_metadata: { username },
    });
    if (angelegt.error || !angelegt.data?.user) {
      const text = String(angelegt.error?.message || "");
      if (/already|registered|exists/i.test(text)) {
        return antwort(400, { error: "Diesen Benutzernamen gibt es schon." });
      }
      throw angelegt.error || new Error("Konto nicht angelegt");
    }

    const userId = angelegt.data.user.id;
    const fertig = await admin.rpc("registrierung_abschliessen", {
      p_user: userId, p_username: username, p_slug: slug,
    });
    if (fertig.error) {
      // Kein halbes Konto zuruecklassen: ohne Profil koennte es nichts,
      // wuerde aber den Namen blockieren.
      await admin.auth.admin.deleteUser(userId).catch(() => {});
      throw fertig.error;
    }

    return antwort(200, {
      success: true,
      message: "Konto angelegt.",
      altdaten: !!(fertig.data && fertig.data.altdaten),
    });
  } catch (e) {
    console.error("[register] fehlgeschlagen:", (e as Error)?.message || e);
    return antwort(500, { error: "Serverfehler" });
  }
});
