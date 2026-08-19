/**
 * Test de connexion PostFinance — fonction temporaire, autonome.
 *
 * Aucun import du projet : tout est dans ce seul fichier, on peut donc le
 * coller tel quel dans l'editeur de fonctions du dashboard Supabase.
 *
 * Elle ne cree aucune transaction et ne modifie rien. Elle verifie que les
 * trois secrets sont lisibles, que la cle est bien du base64, et quelle
 * famille d'URL repond sur ce compte.
 *
 * A supprimer une fois l'integration validee.
 */
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const HOST = "https://checkout.postfinance.ch";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function jwtFor(path: string, method: string, userId: string, authKey: string) {
  const enc = new TextEncoder();
  const header = b64url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT", ver: 1 })));
  const payload = b64url(
    enc.encode(
      JSON.stringify({
        sub: String(userId),
        iat: Math.floor(Date.now() / 1000),
        requestPath: path,
        requestMethod: method,
      }),
    ),
  );

  const rawKey = atob(authKey.replace(/-/g, "+").replace(/_/g, "/"));
  const keyBytes = new Uint8Array(rawKey.length);
  for (let i = 0; i < rawKey.length; i++) keyBytes[i] = rawKey.charCodeAt(i);

  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, enc.encode(`${header}.${payload}`)),
  );
  return `${header}.${payload}.${b64url(sig)}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const result: Record<string, unknown> = { fonction: "postfinance-selftest", version: 2 };

  try {
    const spaceId = Deno.env.get("POSTFINANCE_SPACE_ID");
    const userId = Deno.env.get("POSTFINANCE_USER_ID");
    const authKey = Deno.env.get("POSTFINANCE_AUTHENTICATION_KEY");

    result.secrets = {
      POSTFINANCE_SPACE_ID: spaceId ? `present (${spaceId})` : "MANQUANT",
      POSTFINANCE_USER_ID: userId ? `present (${userId})` : "MANQUANT",
      POSTFINANCE_AUTHENTICATION_KEY: authKey
        ? `present (${authKey.length} caracteres)`
        : "MANQUANT",
    };

    if (!spaceId || !userId || !authKey) {
      result.suite =
        "Ajoute les secrets manquants dans Supabase > Project Settings > Edge Functions > Secrets, puis recharge cette page.";
      return new Response(JSON.stringify(result, null, 2), {
        headers: { ...cors, "Content-Type": "application/json" },
        status: 200,
      });
    }

    try {
      atob(authKey.replace(/-/g, "+").replace(/_/g, "/"));
      result.cleBase64 = "valide";
    } catch {
      result.cleBase64 = "INVALIDE — la cle ne semble pas etre du base64";
    }

    // Deux familles d'URL coexistent chez PostFinance : on regarde qui repond.
    const candidates = [
      `/api/space/read?id=${encodeURIComponent(spaceId)}`,
      `/api/transaction/count?spaceId=${encodeURIComponent(spaceId)}`,
      `/payment/spaces/${encodeURIComponent(spaceId)}`,
    ];

    const essais: unknown[] = [];
    for (const path of candidates) {
      try {
        const jwt = await jwtFor(path, "GET", userId, authKey);
        const res = await fetch(`${HOST}${path}`, {
          method: "GET",
          headers: { Authorization: `Bearer ${jwt}`, Accept: "application/json" },
        });
        const text = await res.text();
        essais.push({ url: path, statut: res.status, reponse: text.slice(0, 300) });
      } catch (e) {
        essais.push({ url: path, erreur: String(e) });
      }
    }
    result.essais = essais;
    result.lecture =
      "200 = authentification OK et bonne famille d'URL. 401/403 = cle ou droits. 404 = mauvaise famille d'URL.";
  } catch (e) {
    result.erreur = e instanceof Error ? e.message : String(e);
  }

  return new Response(JSON.stringify(result, null, 2), {
    headers: { ...cors, "Content-Type": "application/json" },
    status: 200,
  });
});
