import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, ClipboardList, Download, FileSpreadsheet, FileText, Images, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AdminLayout from "@/components/admin/AdminLayout";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { isAdminEmail } from "@/lib/adminAccess";
import { PRODUCT_LABELS, formatDateCH } from "@/lib/orderLabels";
import {
  EXCLUDED_LABELS, buildCakeLabels, defaultSelectedKeys, layoutAll,
  type CakeLabel, type LabelPage, type LabelSourceItem,
} from "@/lib/productionLabels";
import { canvasMeasure, exportNiimbotXlsx, exportOnePng, exportPdf, exportPngZip, renderPage } from "@/lib/productionLabelsExport";
import { buildPrepSheet, prepSheetHtml, workshopTypeLabel, type PrepWorkshopSession } from "@/lib/prepSheet";
import { cn } from "@/lib/utils";

// Admin > Étiquettes de production. Remplace les Post-it : une étiquette
// NIIMBOT B1 (50 × 80 mm) par gâteau, générée depuis les commandes, sans
// ressaisie. Lecture seule : rien n'est modifié, aucun e-mail n'est envoyé.
// Deux entrées : une période (depuis l'agenda) ou une commande
// (?order=<id>[&item=<id>], depuis la fiche commande).
// 2026-10-10 : fiche de mise en place (boîtes, génoises, goûts, garnitures)
// des gâteaux cochés + des workshops cochés de la période (get-production).

const zDate = (offsetDays = 0) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date(Date.now() + offsetDays * 86_400_000));

const PageImage = ({ page, width = 192 }: { page: LabelPage; width?: number }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (ref.current) renderPage(page, ref.current); }, [page]);
  return (
    <canvas
      ref={ref}
      style={{ width, height: (width * 640) / 384, imageRendering: "pixelated" }}
      className="block border border-border bg-white"
      aria-label={`Étiquette ${page.cake.orderNumber ?? ""} ${page.cake.customer}${page.count > 1 ? `, ${page.index} sur ${page.count}` : ""}`}
    />
  );
};

const BADGES: Record<string, string> = { to_accept: "À accepter", awaiting_payment: "En attente de paiement" };

export default function AdminLabels() {
  const { t } = useLang();
  const { user, loading: authLoading } = useAuth();
  const isAdmin = isAdminEmail(user?.email);
  const [params] = useSearchParams();
  const orderId = params.get("order");
  const itemId = params.get("item");
  const [from, setFrom] = useState(params.get("date") ?? zDate(0));
  const [to, setTo] = useState(params.get("date") ?? zDate(2));
  const [items, setItems] = useState<LabelSourceItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [fontsReady, setFontsReady] = useState(false);
  const [sessions, setSessions] = useState<PrepWorkshopSession[]>([]);
  const [sessionsError, setSessionsError] = useState(false);
  const [selectedSessions, setSelectedSessions] = useState<Set<string>>(new Set());

  useEffect(() => {
    document.title = "Admin – Étiquettes de production – Bento Cake Studio";
    document.fonts?.ready.then(() => setFontsReady(true)).catch(() => setFontsReady(true));
    return () => { document.title = "Bento Cake Studio Geneva"; };
  }, []);

  // Workshops de la période (mêmes chiffres que la page Production) ; jamais
  // pour une seule commande. Un échec n'empêche pas les étiquettes.
  const loadSessions = useCallback(async () => {
    setSessions([]); setSessionsError(false);
    if (orderId) return;
    const { data, error: err } = await supabase.functions.invoke("get-production", { body: { from, to } });
    if (err) { setSessionsError(true); return; }
    const list = ((data?.workshopSessions ?? []) as PrepWorkshopSession[]).filter((x) => x.bases.some((b) => b.needed > 0) || x.unknownUnits > 0);
    setSessions(list);
    setSelectedSessions(new Set(list.map((x) => x.sessionId)));
  }, [orderId, from, to]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    loadSessions();
    try {
      const { data, error: err } = await supabase.functions.invoke("get-orders-for-labels", { body: orderId ? { orderId } : { from, to } });
      if (err) {
        const ctx = (err as { context?: Response }).context;
        let msg: string | null = null;
        try { msg = (await ctx?.json())?.error ?? null; } catch { /* pas du JSON */ }
        throw new Error(msg ?? (ctx?.status === 404 ? "La fonction get-orders-for-labels n'est pas encore déployée." : "Chargement impossible. Réessayez."));
      }
      const list = (data?.items ?? []) as LabelSourceItem[];
      setItems(list);
      const cakes = buildCakeLabels(list);
      setSelected(new Set(defaultSelectedKeys(cakes, itemId)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setItems(null);
    } finally { setLoading(false); }
  }, [orderId, itemId, from, to, loadSessions]);

  useEffect(() => { if (!authLoading && isAdmin && orderId) load(); }, [authLoading, isAdmin, orderId, load]);

  const cakes = useMemo(() => (items ? buildCakeLabels(items) : []), [items]);
  const excluded = useMemo(() => (items ?? []).filter((i) => i.excluded), [items]);
  const chosen = useMemo(() => cakes.filter((c) => selected.has(c.key)), [cakes, selected]);
  const toAccept = useMemo(() => cakes.filter((c) => c.badge === "to_accept"), [cakes]);
  const itemsById = useMemo(() => new Map((items ?? []).map((i) => [i.id, i])), [items]);
  const chosenSessions = useMemo(() => sessions.filter((x) => selectedSessions.has(x.sessionId)), [sessions, selectedSessions]);
  const sheet = useMemo(() => buildPrepSheet(chosen, itemsById, chosenSessions), [chosen, itemsById, chosenSessions]);
  const prepMissing = chosen.some((c) => !itemsById.get(c.itemId)?.prep);
  const pages = useMemo(() => (fontsReady ? layoutAll(chosen, canvasMeasure) : []), [chosen, fontsReady]);
  const pagesByCake = useMemo(() => {
    const m = new Map<string, LabelPage[]>();
    for (const p of pages) m.set(p.cake.key, [...(m.get(p.cake.key) ?? []), p]);
    return m;
  }, [pages]);
  const byDate = useMemo(() => {
    const m = new Map<string, CakeLabel[]>();
    for (const c of cakes) m.set(c.date ?? "", [...(m.get(c.date ?? "") ?? []), c]);
    return [...m];
  }, [cakes]);

  if (authLoading) return <AdminLayout><main className="py-16 text-center"><Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" /></main></AdminLayout>;
  if (!user || !isAdmin) {
    return (
      <AdminLayout>
        <main className="max-w-md mx-auto px-6 py-24 text-center">
          <Lock className="w-8 h-8 mx-auto text-muted-foreground mb-4" />
          <h1 className="font-sans uppercase tracking-[0.105em] text-2xl text-foreground mb-4">{!user ? t("Admin sign-in required", "Connexion administrateur requise") : t("Access denied", "Accès refusé")}</h1>
          {!user && <Button asChild className="rounded-none"><Link to={`/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`}>{t("Sign in", "Se connecter")}</Link></Button>}
        </main>
      </AdminLayout>
    );
  }

  const toggleSession = (id: string) => setSelectedSessions((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const periodText = orderId ? `Commande ${cakes[0]?.orderNumber ?? ""}` : from === to ? formatDateCH(from) : `du ${formatDateCH(from)} au ${formatDateCH(to)}`;
  const printSheet = () => {
    const w = window.open("", "_blank");
    if (!w) { setError("Le navigateur a bloqué la nouvelle fenêtre : autorisez les fenêtres pop-up pour ce site."); return; }
    w.document.write(prepSheetHtml(sheet, periodText));
    w.document.close();
  };
  const toggle = (key: string) => setSelected((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const suites = pages.filter((p) => p.index > 1).length;
  const stamp = orderId ? (cakes[0]?.orderNumber ?? "commande") : from === to ? from : `${from}_${to}`;
  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what); setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };
  const missingCount = chosen.filter((c) => c.missing.length > 0).length;

  return (
    <AdminLayout>
      <main className="container mx-auto px-4 py-8 max-w-6xl space-y-5">
        <Link to={orderId ? `/admin/order/${orderId}` : "/admin/calendar"} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> {orderId ? "Fiche commande" : "Agenda de production"}
        </Link>
        <h1 className="font-sans uppercase tracking-[0.105em] text-2xl md:text-3xl text-foreground font-semibold">Étiquettes de production</h1>
        <p className="text-xs text-muted-foreground">
          Une étiquette NIIMBOT B1 de 50 × 80 mm par gâteau, avec les règles de l'agenda de production (workshops, bougies, gâteaux annulés et commandes non retenues exclus).
          Rien n'est modifié dans les commandes et aucun e-mail n'est envoyé.
        </p>

        {!orderId && (
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1"><Label className="text-xs text-muted-foreground">Retrait / livraison du</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-none h-10 w-40" /></div>
            <div className="space-y-1"><Label className="text-xs text-muted-foreground">au</Label>
              <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="rounded-none h-10 w-40" /></div>
            <Button className="rounded-none" onClick={load} disabled={loading || !from || !to}>
              {loading && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Afficher les gâteaux
            </Button>
          </div>
        )}
        {orderId && loading && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
        {error && <p className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert">{error}</p>}

        {items && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <section className="space-y-3 min-w-0" data-testid="labels-list">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold">{chosen.length} gâteau{chosen.length > 1 ? "x" : ""} sélectionné{chosen.length > 1 ? "s" : ""} sur {cakes.length}</span>
                <span className="text-muted-foreground">· {pages.length} étiquette{pages.length > 1 ? "s" : ""}{suites ? ` (dont ${suites} « Suite »)` : ""}</span>
                <span className="flex-1" />
                <Button size="sm" variant="outline" className="rounded-none h-8" onClick={() => setSelected(new Set(defaultSelectedKeys(cakes)))}>Tous les confirmés</Button>
                {toAccept.length > 0 && (
                  <Button size="sm" variant="outline" className="rounded-none h-8" onClick={() => setSelected((s) => new Set([...s, ...toAccept.map((c) => c.key)]))}>
                    + les {toAccept.length} « À accepter »
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="rounded-none h-8" onClick={() => setSelected(new Set())}>Aucun</Button>
              </div>
              {cakes.length === 0 && <p className="text-sm text-muted-foreground">Aucun gâteau {orderId ? "à étiqueter dans cette commande" : "sur cette période"}.</p>}
              {byDate.map(([date, list]) => (
                <div key={date} className="space-y-1">
                  <h2 className="text-xs uppercase tracking-[0.08em] text-muted-foreground pt-2">{date ? formatDateCH(date) : "Sans date"}</h2>
                  <ul className="divide-y divide-border/60 border border-border/60">
                    {list.map((c) => {
                      const n = pagesByCake.get(c.key)?.length ?? 0;
                      return (
                        <li key={c.key} className="flex items-start gap-3 px-3 py-2 text-sm">
                          <input type="checkbox" className="w-4 h-4 mt-1 shrink-0" checked={selected.has(c.key)} onChange={() => toggle(c.key)} aria-label={`Sélectionner ${c.orderNumber ?? ""} ${c.customer} ${c.marker ?? ""}`} />
                          <div className="min-w-0 flex-1">
                            <p className="break-words"><b>{c.orderNumber ?? "N° ?"}</b> · {c.customer || "Client ?"}{c.marker && <b> · {c.marker}</b>}</p>
                            <p className="text-muted-foreground break-words">{c.productLine || "Produit ?"}{c.flavour ? ` · ${c.flavour}` : ""}</p>
                            <div className="flex flex-wrap gap-1 mt-0.5">
                              {c.isTest && <span className="text-[10px] px-1.5 border border-border">TEST</span>}
                              {c.badge === "to_accept" && <span className="text-[10px] font-semibold uppercase px-1.5 bg-blue-600 text-white">À accepter · non coché par défaut</span>}
                              {c.badge === "awaiting_payment" && <span className="text-[10px] px-1.5 border border-amber-300 bg-amber-50 text-amber-900">{BADGES[c.badge]}</span>}
                              {(c.alerts ?? []).map((a) => <span key={a} className="text-[10px] font-semibold px-1.5 bg-foreground text-background">⚠ {a}</span>)}
                              {n > 1 && <span className="text-[10px] px-1.5 border border-sky-300 bg-sky-50 text-sky-900">{n} étiquettes (texte long)</span>}
                            </div>
                            {c.missing.length > 0 && (
                              <p className="text-xs text-amber-900 flex gap-1 mt-0.5"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />Manque : {c.missing.join(", ")}</p>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
              {!orderId && (sessions.length > 0 || sessionsError) && (
                <div className="space-y-1 pt-2" data-testid="labels-workshops">
                  <h2 className="text-xs uppercase tracking-[0.08em] text-muted-foreground">Workshops (fiche de mise en place seulement, pas d'étiquette)</h2>
                  {sessionsError && <p className="text-xs text-amber-900">Workshops non chargés : la fiche ne les compte pas.</p>}
                  <ul className="divide-y divide-border/60 border border-border/60">
                    {sessions.map((x) => {
                      const n = x.bases.reduce((k, b) => k + b.needed, 0) + x.unknownUnits;
                      return (
                        <li key={x.sessionId} className="flex items-start gap-3 px-3 py-2 text-sm">
                          <input type="checkbox" className="w-4 h-4 mt-1 shrink-0" checked={selectedSessions.has(x.sessionId)} onChange={() => toggleSession(x.sessionId)} aria-label={`Sélectionner ${workshopTypeLabel(x.type)} ${x.date}`} />
                          <div className="min-w-0 flex-1">
                            <p><b>{workshopTypeLabel(x.type)}</b> · {formatDateCH(x.date)}{x.time ? ` ${x.time.slice(0, 5)}` : ""}</p>
                            <p className="text-muted-foreground">{n} gâteau{n > 1 ? "x" : ""} · {x.bases.filter((b) => b.needed > 0).map((b) => `${b.base === "vanilla" ? "vanille" : "chocolat"} ${b.needed}`).join(", ")}{x.unknownUnits ? ` · ${x.unknownUnits} génoise(s) à choisir` : ""}</p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {excluded.length > 0 && (
                <div className="text-xs text-muted-foreground space-y-1 border-t border-border/60 pt-2">
                  <p className="font-semibold">Sans étiquette dans cette commande :</p>
                  {excluded.map((i) => <p key={i.id}>{(i.product && PRODUCT_LABELS[i.product]?.fr) || i.product || "Article"} — {EXCLUDED_LABELS[i.excluded!]}</p>)}
                </div>
              )}
            </section>

            <section className="space-y-3 min-w-0" data-testid="labels-preview">
              <div className="flex flex-wrap gap-2">
                <Button className="rounded-none" disabled={!chosen.length || !!busy} onClick={() => run("xlsx", () => exportNiimbotXlsx(chosen, `etiquettes-niimbot_${stamp}.xlsx`))}>
                  {busy === "xlsx" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FileSpreadsheet className="w-4 h-4 mr-1" />}Excel pour l'app NIIMBOT
                </Button>
                <Button variant="outline" className="rounded-none" disabled={!pages.length || !!busy} onClick={() => run("png", () => exportPngZip(pages, `etiquettes-images_${stamp}.zip`))}>
                  {busy === "png" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Images className="w-4 h-4 mr-1" />}Images PNG (ZIP)
                </Button>
                <Button variant="outline" className="rounded-none" disabled={!pages.length || !!busy} onClick={() => run("pdf", () => exportPdf(pages, `etiquettes-50x80_${stamp}.pdf`))}>
                  {busy === "pdf" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FileText className="w-4 h-4 mr-1" />}PDF 50 × 80 mm
                </Button>
              </div>
              <div className="border border-border/60 px-3 py-3 space-y-3 text-sm" data-testid="prep-sheet">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold uppercase tracking-[0.06em] text-xs flex-1">Fiche de mise en place</h2>
                  <Button size="sm" variant="outline" className="rounded-none h-8" disabled={!chosen.length && !chosenSessions.length} onClick={printSheet}>
                    <ClipboardList className="w-4 h-4 mr-1" />Imprimer (A4)
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Calculée sur les gâteaux{orderId ? "" : " et les workshops"} cochés, avec les règles de la page Production. Boîtes : la taille du gâteau ; Dot Cakes en pièces ; Workshop Peinture = Bento, Workshop Signature = Retro Box.
                </p>
                {prepMissing && <p className="text-xs text-amber-900">Génoises et goûts indisponibles : la fonction get-orders-for-labels doit être redéployée.</p>}
                {!chosen.length && !chosenSessions.length ? <p className="text-xs text-muted-foreground">Cochez au moins un gâteau.</p> : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <h3 className="text-xs uppercase tracking-[0.06em] text-muted-foreground mb-1">Boîtes</h3>
                      <ul>{sheet.boxes.map((b) => <li key={b.label} className="flex justify-between border-b border-border/40 py-0.5"><span>{b.label === "Dot" ? "Dot (pièces)" : b.label}</span><b>{b.units}</b></li>)}</ul>
                    </div>
                    <div>
                      <h3 className="text-xs uppercase tracking-[0.06em] text-muted-foreground mb-1">Génoises</h3>
                      {sheet.genoises.map((g) => (
                        <div key={g.base} className="mb-1">
                          <p className="font-semibold flex justify-between"><span>{g.label}</span><span>{g.total}</span></p>
                          <ul className="pl-3">{g.rows.map((r) => <li key={r.label} className="flex justify-between text-muted-foreground"><span>{r.label}</span><span>{r.units}</span></li>)}</ul>
                        </div>
                      ))}
                    </div>
                    <div>
                      <h3 className="text-xs uppercase tracking-[0.06em] text-muted-foreground mb-1">Goûts</h3>
                      <ul>{sheet.flavours.map((f) => <li key={f.label} className="flex justify-between border-b border-border/40 py-0.5"><span>{f.label}</span><b>{f.units}</b></li>)}</ul>
                    </div>
                    <div>
                      <h3 className="text-xs uppercase tracking-[0.06em] text-muted-foreground mb-1">Garnitures</h3>
                      {sheet.ingredients.length === 0 ? <p className="text-muted-foreground">—</p> : (
                        <ul>{sheet.ingredients.map((f) => <li key={f.label} className="flex justify-between border-b border-border/40 py-0.5"><span>{f.label}</span><b>{f.units}</b></li>)}</ul>
                      )}
                    </div>
                    {sheet.toCheck.length > 0 && (
                      <div className="sm:col-span-2 text-xs text-amber-900">
                        <p className="font-semibold">À vérifier :</p>
                        {sheet.toCheck.map((c, i) => <p key={i}>{c.who} — {c.what}{c.units > 1 ? ` (${c.units})` : ""}</p>)}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {missingCount > 0 && <p className="text-xs text-amber-900">{missingCount} gâteau(x) sélectionné(s) avec une information manquante : vérifiez la commande avant d'imprimer.</p>}
              <details className="text-xs border border-border/60 px-3 py-2">
                <summary className="cursor-pointer font-semibold">Comment imprimer avec la NIIMBOT B1</summary>
                <div className="space-y-2 pt-2 text-muted-foreground">
                  <p><b className="text-foreground">Plusieurs gâteaux — Excel :</b> l'app NIIMBOT imprime un lot à partir d'un fichier Excel (une ligne par étiquette).
                    La première fois, créer dans l'app une étiquette 50 × 80 mm verticale, ouvrir « Source de données », lier ce fichier et placer les colonnes
                    (Date, Client, Commande, Repère, puis « Détails » qui contient tous les champs remplis, un par ligne). Enregistrer ce modèle ; les fois suivantes,
                    il suffit de lier le nouveau fichier puis d'imprimer tout le lot.</p>
                  <p><b className="text-foreground">Rendu exact — images :</b> chaque image PNG est une étiquette à la résolution de l'imprimante (203 dpi). Dans l'app :
                    Insérer &gt; Image, l'étirer sur toute l'étiquette, imprimer (une image à la fois).</p>
                  <p><b className="text-foreground">PDF :</b> pour contrôler la mise en page à taille réelle ; son import dans l'app NIIMBOT n'est pas garanti.</p>
                  <p>Le site n'imprime pas directement en Bluetooth : l'impression passe par l'app NIIMBOT.</p>
                </div>
              </details>
              {pages.length === 0 && chosen.length > 0 && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
              <div className="flex flex-wrap gap-3">
                {pages.map((p) => (
                  <figure key={p.key} className="space-y-1">
                    <PageImage page={p} />
                    <figcaption className="flex items-center justify-between gap-1 text-[11px] text-muted-foreground w-[192px]">
                      <span className="truncate">{p.cake.orderNumber}{p.cake.marker ? ` · ${p.cake.marker}` : ""}{p.count > 1 ? ` · ${p.index}/${p.count}` : ""}</span>
                      <button type="button" className="inline-flex items-center gap-0.5 hover:text-foreground" onClick={() => run("one", () => exportOnePng(p))} aria-label="Télécharger cette étiquette">
                        <Download className="w-3.5 h-3.5" />PNG
                      </button>
                    </figcaption>
                  </figure>
                ))}
              </div>
            </section>
          </div>
        )}
        {!items && !loading && !error && !orderId && <p className={cn("text-sm text-muted-foreground")}>Choisissez une période puis « Afficher les gâteaux ».</p>}
      </main>
    </AdminLayout>
  );
}
