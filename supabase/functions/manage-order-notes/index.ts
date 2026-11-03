import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { requireStaff, type StaffCaller } from "../_shared/staff-auth.ts";
import { corsHeaders } from "../_shared/cors.ts";

// F36 (03.11.2026) — « Notes internes » of an order (Admin > order page).
// Dated comments from the team, each with optional photos. Never shown to
// the customer. Administrators (Mel, Eli) as usual; the employee (Nahya)
// with « orders.view » can read and add too (production needs the
// customer's extra photos). No PIN: notes contain no money.
//
// Actions:
//   - list:       notes of an order, oldest first, photos as signed URLs (1 h).
//   - upload_url: signed upload URL for one photo, in the PRIVATE bucket
//                 order-notes, under notes/<orderId>/.
//   - add:        a note (text and/or up to 10 photos already uploaded).
//   - delete:     hides a note (soft delete). Its author or an administrator.

const BUCKET = "order-notes";
const MAX_PHOTOS = 10;
const MAX_TEXT = 4000;
const SIGNED_URL_SECONDS = 3600;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
// Same people as ADMIN_EMAILS in _shared/admin-auth.ts.
const ADMIN_NAMES: Record<string, string> = { "naglemelodie@gmail.com": "Mel", "e.potapushina@gmail.com": "Eli" };

const json = (cors: Record<string, string>, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const authorName = (caller: StaffCaller) =>
  caller.role === "admin" ? ADMIN_NAMES[caller.email] ?? caller.email : caller.memberName ?? caller.email;

type NoteRow = { id: string; body: string | null; image_paths: string[]; author_email: string; author_name: string | null; created_at: string };

serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json(cors, { error: "Method not allowed" }, 405);
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
    const body = await req.json().catch(() => ({}));
    const caller = await requireStaff(req, supabase, "orders.view", { body });
    if (!caller) return json(cors, { error: "Admin sign-in required", reason: "auth" }, 401);

    const action = String(body?.action ?? "");
    const orderId = String(body?.orderId ?? "");

    const orderExists = async () => {
      if (!UUID_RE.test(orderId)) return false;
      const { data, error } = await supabase.from("orders").select("id").eq("id", orderId).maybeSingle();
      if (error) throw new Error(`Failed to load order: ${error.message}`);
      return !!data;
    };

    const list = async () => {
      const { data, error } = await supabase
        .from("order_internal_notes")
        .select("id, body, image_paths, author_email, author_name, created_at")
        .eq("order_id", orderId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true });
      if (error) throw new Error(`Failed to load notes: ${error.message}`);
      const rows = (data ?? []) as NoteRow[];
      const paths = rows.flatMap((r) => r.image_paths ?? []);
      const urls = new Map<string, string>();
      if (paths.length > 0) {
        const { data: signed, error: sErr } = await supabase.storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS);
        if (sErr) console.error("manage-order-notes: signed URLs failed:", sErr);
        for (const s of signed ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
      }
      return rows.map((r) => ({
        id: r.id,
        body: r.body,
        photos: (r.image_paths ?? []).map((p) => urls.get(p)).filter((u): u is string => !!u),
        authorName: r.author_name ?? r.author_email,
        createdAt: r.created_at,
        canDelete: caller.role === "admin" || r.author_email === caller.email,
      }));
    };

    if (action === "list") {
      if (!(await orderExists())) return json(cors, { error: "Commande introuvable", reason: "not_found" }, 404);
      return json(cors, { data: await list() });
    }

    if (action === "upload_url") {
      if (!(await orderExists())) return json(cors, { error: "Commande introuvable", reason: "not_found" }, 404);
      const type = String(body?.contentType ?? "");
      if (!IMAGE_TYPES.has(type)) return json(cors, { error: "Photo JPG, PNG ou WebP uniquement", reason: "input" }, 400);
      const name = String(body?.fileName ?? "photo").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
      const path = `notes/${orderId}/${crypto.randomUUID()}_${name}`;
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
      if (error) throw new Error(`Failed to prepare upload: ${error.message}`);
      return json(cors, { data: { path, token: data.token } });
    }

    if (action === "add") {
      if (!(await orderExists())) return json(cors, { error: "Commande introuvable", reason: "not_found" }, 404);
      const text = typeof body?.body === "string" ? body.body.trim() : "";
      const prefix = `notes/${orderId}/`;
      const rawPaths: unknown[] = Array.isArray(body?.imagePaths) ? body.imagePaths : [];
      const imagePaths = [...new Set(rawPaths.filter((p): p is string => typeof p === "string" && p.startsWith(prefix) && !p.includes("..")))];
      if (text.length > MAX_TEXT) return json(cors, { error: `Note trop longue (${MAX_TEXT} caractères au maximum)`, reason: "input" }, 400);
      if (imagePaths.length > MAX_PHOTOS) return json(cors, { error: `${MAX_PHOTOS} photos au maximum par note`, reason: "input" }, 400);
      if (!text && imagePaths.length === 0) return json(cors, { error: "Écrivez une note ou ajoutez une photo", reason: "input" }, 400);
      const { error } = await supabase.from("order_internal_notes").insert({
        order_id: orderId, body: text || null, image_paths: imagePaths, author_email: caller.email, author_name: authorName(caller),
      });
      if (error) throw new Error(`Failed to save note: ${error.message}`);
      return json(cors, { data: await list() });
    }

    if (action === "delete") {
      const noteId = String(body?.noteId ?? "");
      if (!UUID_RE.test(noteId)) return json(cors, { error: "Note introuvable", reason: "not_found" }, 404);
      const { data: note, error } = await supabase
        .from("order_internal_notes").select("id, order_id, author_email").eq("id", noteId).is("deleted_at", null).maybeSingle();
      if (error) throw new Error(`Failed to load note: ${error.message}`);
      if (!note || note.order_id !== orderId) return json(cors, { error: "Note introuvable", reason: "not_found" }, 404);
      if (caller.role !== "admin" && note.author_email !== caller.email) {
        return json(cors, { error: "Seule l'autrice de la note ou une administratrice peut la supprimer", reason: "forbidden" }, 403);
      }
      const { error: dErr } = await supabase
        .from("order_internal_notes").update({ deleted_at: new Date().toISOString(), deleted_by: caller.email }).eq("id", noteId);
      if (dErr) throw new Error(`Failed to delete note: ${dErr.message}`);
      return json(cors, { data: await list() });
    }

    return json(cors, { error: "Action inconnue", reason: "input" }, 400);
  } catch (e) {
    console.error("manage-order-notes error:", e);
    return json(cors, { error: "Erreur inattendue. Réessayez.", reason: "server" }, 500);
  }
});
