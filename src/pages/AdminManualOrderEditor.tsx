import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { fr as frLocale } from "date-fns/locale";
import { AlertTriangle, CalendarIcon, ChevronLeft, Loader2, Lock, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/admin/AdminLayout";
import { DeliveryAddressAutocomplete } from "@/components/DeliveryAddressAutocomplete";
import { ItemEditor } from "@/components/admin/manual-order/ItemEditor";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { isAdminEmail } from "@/lib/adminAccess";
import { extractFunctionErrorMessage } from "@/lib/functionErrors";
import { customersApi, type CustomerDetail } from "@/lib/customers";
import { cn } from "@/lib/utils";
import {
  ADJUSTMENT_REASONS,
  type AdjustmentMode,
  type DateGroup,
  type EditorItem,
  emptyItem,
  extraFields,
  friendlyMessage,
  type ManualOrderCatalog,
  newKey,
  type QuoteResult,
  CHANNEL_LABELS,
  formatChf,
  labelBreakdownLine,
  MANUAL_STATUS_LABELS,
  slotsFor,
} from "@/lib/manualOrders";

// Admin > Manual orders — create / edit (draft or awaiting payment). Prices
// are never computed here: every change is sent to quote-manual-order (the
// checkout's own engine) and the result is displayed; saving recomputes it
// again on the server (manage-manual-order).

const field = "w-full border border-input bg-background px-2 py-1.5 text-sm rounded-none";
const label = "block text-xs font-bold uppercase tracking-[0.08em] text-foreground mb-1.5";
const sectionTitle = "px-4 py-3 border-b border-border/60 text-base font-bold uppercase tracking-[0.12em] text-foreground";

// "YYYY-MM-DD" <-> local Date (never through UTC, so the day never shifts).
const parseDay = (s: string) => {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : undefined;
};

// Same calendar as the checkout. Past days are blocked; today and tomorrow
// stay possible for an Admin order.
const DayPicker = ({ value, onChange, lang }: { value: string; onChange: (v: string) => void; lang: "en" | "fr" }) => {
  const [open, setOpen] = useState(false);
  const selected = parseDay(value);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={cn(field, "flex items-center gap-2 text-left", !selected && "text-muted-foreground")}>
          <CalendarIcon className="w-4 h-4 shrink-0" />
          {selected
            ? format(selected, lang === "fr" ? "EEEE d MMMM yyyy" : "EEEE, MMMM d, yyyy", lang === "fr" ? { locale: frLocale } : undefined)
            : lang === "fr" ? "Choisir une date" : "Pick a date"}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          onSelect={(d) => { if (d) { onChange(format(d, "yyyy-MM-dd")); setOpen(false); } }}
          disabled={(d) => d < today}
          locale={lang === "fr" ? frLocale : undefined}
          weekStartsOn={1}
          initialFocus
          className="p-3 pointer-events-auto"
        />
      </PopoverContent>
    </Popover>
  );
};

// A server call never leaves a button spinning: after this delay the
// editor stops waiting and says so.
const SERVER_TIMEOUT_MS = 30_000;
const TIMEOUT = Symbol("timeout");
function withTimeout<T>(p: Promise<T>): Promise<T | typeof TIMEOUT> {
  return Promise.race([p, new Promise<typeof TIMEOUT>((resolve) => setTimeout(() => resolve(TIMEOUT), SERVER_TIMEOUT_MS))]);
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const emptyGroup = (): DateGroup => ({ key: newKey(), date: "", deliveryMethod: "pickup", slot: "", placeId: null, addressLabel: null });

const AdminManualOrderEditor = () => {
  const { id } = useParams<{ id: string }>();
  // « Nouvelle commande manuelle » from a customer page: prefill the contact
  // (new order only). The order is then linked to that customer by the
  // database (same email), never by name.
  const [searchParams] = useSearchParams();
  const prefillCustomerId = !id ? searchParams.get("customer") : null;
  const navigate = useNavigate();
  const { t, lang } = useLang();
  const { user, loading: authLoading } = useAuth();
  const isAdmin = isAdminEmail(user?.email);
  const tr = (l: { en: string; fr: string }) => t(l.en, l.fr);

  const [catalog, setCatalog] = useState<ManualOrderCatalog | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [orderId, setOrderId] = useState<string | null>(id ?? null);
  const [orderNumber, setOrderNumber] = useState<string | null>(null);
  const [isDraft, setIsDraft] = useState(true);
  const [notEditable, setNotEditable] = useState<string | null>(null);

  const [customer, setCustomer] = useState({ first_name: "", last_name: "", phone: "", email: "", company: "", lang: "fr" as "fr" | "en", channel: "phone" });
  const [internalNotes, setInternalNotes] = useState("");
  const [orderComment, setOrderComment] = useState("");
  const [items, setItems] = useState<EditorItem[]>([]);
  const [groups, setGroups] = useState<DateGroup[]>([emptyGroup()]);
  const [adjMode, setAdjMode] = useState<AdjustmentMode>("none");
  const [adjDirection, setAdjDirection] = useState<"discount" | "supplement">("discount");
  const [adjValue, setAdjValue] = useState("");
  const [adjReason, setAdjReason] = useState("");
  const [adjNote, setAdjNote] = useState("");

  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteFailed, setQuoteFailed] = useState(false);
  const [saving, setSaving] = useState<"draft" | "confirm" | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  useEffect(() => {
    document.title = "Admin – Commande manuelle – Bento Cake Studio";
    return () => { document.title = "Bento Cake Studio Geneva"; };
  }, []);

  // ── Load catalogue (+ existing order) ────────────────────────────────
  useEffect(() => {
    if (authLoading || !isAdmin) { setLoading(authLoading); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: cat, error: catErr } = await supabase.functions.invoke("quote-manual-order", { body: { catalog: true } });
      if (cancelled) return;
      if (catErr || cat?.error) {
        const reason = catErr ? await extractFunctionErrorMessage(catErr, "") : String(cat.error);
        console.error("catalog failed:", reason || catErr);
        setLoadError(t("Could not load the product options. Please try again.", "Impossible de charger les options produits. Merci de réessayer."));
        setLoading(false);
        return;
      }
      setCatalog(cat as ManualOrderCatalog);

      if (!id && prefillCustomerId) {
        try {
          const d = await customersApi<CustomerDetail>({ action: "get", customerId: prefillCustomerId });
          if (!cancelled && d?.customer) {
            setCustomer((prev) => ({
              ...prev,
              first_name: d.customer.firstName ?? "", last_name: d.customer.lastName ?? "",
              phone: d.customer.phone ?? "", email: d.customer.email ?? "", company: d.customer.company ?? "",
            }));
          }
        } catch (e) {
          console.error("customer prefill failed:", e);
        }
      }

      if (id) {
        const { data: o, error } = await supabase.functions.invoke("manage-manual-order", { body: { action: "get", orderId: id } });
        if (cancelled) return;
        if (error || o?.error) {
          setLoadError(t("Could not load this order.", "Impossible de charger cette commande."));
          setLoading(false);
          return;
        }
        setOrderNumber(o.orderNumber);
        setIsDraft(o.isDraft);
        setNotEditable(o.editable ? null : (o.notEditableReason || t("This order can't be edited.", "Cette commande ne peut pas être modifiée.")));
        setCustomer({
          first_name: o.customer.first_name ?? "", last_name: o.customer.last_name ?? "", phone: o.customer.phone ?? "",
          email: o.customer.email ?? "", company: o.customer.company ?? "", lang: o.customer.lang === "en" ? "en" : "fr",
          channel: o.customer.channel ?? "phone",
        });
        setInternalNotes(o.internal_notes ?? "");
        setOrderComment(o.order_comment ?? "");
        const loadedGroups: DateGroup[] = (o.fulfillments ?? []).map((f: { date: string; deliveryMethod: "pickup" | "delivery"; deliveryPlaceId: string | null; deliveryAddressLabel: string | null; slot: string | null }) => ({
          key: newKey(), date: f.date, deliveryMethod: f.deliveryMethod, slot: f.slot ?? "", placeId: f.deliveryPlaceId, addressLabel: f.deliveryAddressLabel,
        }));
        const groupOfItem = new Map<number, string>();
        (o.fulfillments ?? []).forEach((f: { itemIndexes: number[] }, gi: number) => f.itemIndexes.forEach((ii) => groupOfItem.set(ii, loadedGroups[gi].key)));
        setGroups(loadedGroups.length > 0 ? loadedGroups : [emptyGroup()]);
        setItems((o.items ?? []).map((it: Partial<EditorItem> & { product: EditorItem["product"] }, ii: number) => ({
          ...emptyItem(it.product),
          ...Object.fromEntries(Object.entries(it).filter(([, v]) => v !== null && v !== undefined)),
          key: newKey(),
          dateKey: groupOfItem.get(ii) ?? null,
          workshop_sponge_choices: it.workshop_sponge_choices ?? (it.product === "workshop" ? Array.from({ length: it.workshop_participants ?? 1 }, () => "vanilla") : []),
        })));
        if (o.adjustment) {
          setAdjMode(o.adjustment.type);
          if (o.adjustment.type === "final") setAdjValue(String(o.adjustment.value));
          else { setAdjDirection(o.adjustment.value < 0 ? "discount" : "supplement"); setAdjValue(String(Math.abs(o.adjustment.value))); }
          setAdjReason(o.adjustment.reason ?? "");
          setAdjNote(o.adjustment.note ?? "");
        }
      } else {
        const g = emptyGroup();
        setGroups([g]);
        setItems([{ ...emptyItem("bento_cake"), dateKey: g.key }]);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [authLoading, isAdmin, id, t]);

  // ── Payload (same shape for quote and save) ───────────────────────────
  const adjustment = useMemo(() => {
    if (adjMode === "none") return null;
    const v = Number(adjValue.replace(",", "."));
    if (!adjValue.trim() || !Number.isFinite(v)) return null;
    const value = adjMode === "final" ? v : (adjDirection === "discount" ? -Math.abs(v) : Math.abs(v));
    return { type: adjMode, value };
  }, [adjMode, adjValue, adjDirection]);

  // With a single date every product belongs to it; the per-product date
  // choice only exists when the order has several dates.
  const dateKeyOf = useCallback(
    (it: EditorItem) => (groups.length === 1 ? groups[0].key : it.dateKey),
    [groups],
  );

  const payload = useMemo(() => {
    const itemsPayload = items.map((it) => ({
      product: it.product, size: it.size, shape: it.shape, flavors: it.flavors, design: it.design, extras: it.extras, candles: it.candles,
      workshop_session_id: it.workshop_session_id, workshop_participants: it.workshop_participants,
      workshop_sponge_choices: it.workshop_sponge_choices, workshop_has_minor: it.workshop_has_minor,
      workshop_minor_consent_confirmed: it.workshop_minor_consent_confirmed,
      item_comment: it.item_comment, internal_notes: it.internal_notes, reference_images: it.reference_images,
      base_color: it.base_color, decoration_color: it.decoration_color, cake_text: it.cake_text, text_color: it.text_color, text_style: it.text_style,
      ...extraFields(it),
    }));
    const fulfillments = groups
      .map((g) => ({
        date: g.date,
        deliveryMethod: g.deliveryMethod,
        deliveryPlaceId: g.deliveryMethod === "delivery" ? g.placeId : null,
        slot: g.slot || null,
        itemIndexes: items.map((it, i) => (it.product !== "workshop" && dateKeyOf(it) === g.key ? i : -1)).filter((i) => i >= 0),
      }))
      .filter((f) => f.itemIndexes.length > 0);
    return { items: itemsPayload, fulfillments };
  }, [items, groups, dateKeyOf]);

  // ── Live quote (debounced) ────────────────────────────────────────────
  const quoteSeq = useRef(0);
  useEffect(() => {
    if (!catalog || items.length === 0) { setQuote(null); return; }
    const seq = ++quoteSeq.current;
    const handle = setTimeout(async () => {
      setQuoting(true);
      setQuoteFailed(false);
      try {
        const res = await withTimeout(supabase.functions.invoke("quote-manual-order", { body: { ...payload, adjustment } }));
        if (seq !== quoteSeq.current) return;
        if (res === TIMEOUT || res.error || res.data?.error) {
          console.error("quote failed:", res === TIMEOUT ? "timeout" : res.error || res.data?.error);
          setQuoteFailed(true);
          return;
        }
        setQuote(res.data as QuoteResult);
      } catch (e) {
        if (seq === quoteSeq.current) { console.error("quote failed:", e); setQuoteFailed(true); }
      } finally {
        if (seq === quoteSeq.current) setQuoting(false);
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [catalog, payload, adjustment, items.length]);

  // ── What is still missing to confirm (shown live, checked on confirm) ──
  // Same rules as the server's confirm check; the server re-checks anyway.
  const missing = useMemo(() => {
    const l = lang === "en" ? "en" : "fr";
    const out: string[] = [];
    if (!customer.first_name.trim()) out.push(t("First name", "Prénom"));
    if (!customer.last_name.trim()) out.push(t("Last name", "Nom"));
    if (!customer.phone.trim()) out.push(t("Phone", "Téléphone"));
    if (!EMAIL_RE.test(customer.email.trim())) out.push(t("A valid email", "Un email valide"));
    if (items.length === 0) out.push(t("At least one product", "Au moins un produit"));
    const physical = items.some((it) => it.product !== "workshop");
    if (physical && groups.some((g) => !g.date)) out.push(t("The date (section 3)", "La date (section 3)"));
    quote?.items.forEach((r, i) => { if (r.error) out.push(`${t("Product", "Produit")} ${i + 1} : ${friendlyMessage(r.error, l)}`); });
    quote?.errors.forEach((e) => out.push(friendlyMessage(e, l)));
    return Array.from(new Set(out));
  }, [customer, items, groups, quote, lang, t]);

  // ── Save ──────────────────────────────────────────────────────────────
  const save = async (mode: "draft" | "confirm") => {
    if (mode === "confirm" && missing.length > 0) {
      setProblems(missing);
      toast.error(t("Some information is missing", "Des informations manquent"));
      return;
    }
    setSaving(mode);
    setProblems([]);
    const body = {
      action: "save",
      orderId,
      mode,
      customer,
      internal_notes: internalNotes,
      order_comment: orderComment,
      ...payload,
      adjustment: adjustment ? { ...adjustment, reason: adjReason || null, note: adjNote || null } : null,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let res: { data: any; error: unknown } | typeof TIMEOUT;
    try {
      res = await withTimeout(supabase.functions.invoke("manage-manual-order", { body }));
    } catch (e) {
      console.error("save failed:", e);
      setSaving(null);
      setProblems([t("The server could not be reached. Check your connection and try again.", "Le serveur n'a pas pu être joint. Vérifiez votre connexion et réessayez.")]);
      toast.error(t("Not saved", "Non enregistrée"));
      return;
    }
    setSaving(null);
    if (res === TIMEOUT) {
      // The order may still have been created: never invite a blind retry.
      setProblems([t(
        "The server did not answer within 30 seconds. The order may have been saved anyway — check the manual orders list before trying again.",
        "Le serveur n'a pas répondu en 30 secondes. La commande a peut-être quand même été enregistrée — vérifiez la liste des commandes manuelles avant de réessayer.",
      )]);
      toast.error(t("No answer from the server", "Pas de réponse du serveur"));
      return;
    }
    const { data, error } = res;
    if (error || data?.error) {
      let detail: { error?: string; problems?: string[] } | null = data ?? null;
      if (error) {
        try { detail = await (error as { context?: Response }).context?.json(); } catch { /* ignore */ }
      }
      const list = detail?.problems?.length ? detail.problems : [detail?.error || t("The order could not be saved.", "La commande n'a pas pu être enregistrée.")];
      setProblems(list);
      toast.error(t("Not saved", "Non enregistrée"));
      return;
    }
    setOrderId(data.orderId);
    setOrderNumber(data.orderNumber);
    setIsDraft(data.isDraft);
    toast.success(mode === "draft"
      ? t(`Draft ${data.orderNumber ?? ""} saved`, `Brouillon ${data.orderNumber ?? ""} enregistré`)
      : t(`${data.orderNumber ?? "Order"} confirmed — awaiting payment`, `${data.orderNumber ?? "Commande"} confirmée — en attente de paiement`));
    if (mode === "confirm") navigate("/admin/manual-orders");
    else if (!id) navigate(`/admin/manual-orders/${data.orderId}/edit`, { replace: true });
  };

  // ── Guards ────────────────────────────────────────────────────────────
  if (authLoading || (loading && !loadError)) {
    return (
      <AdminLayout>
        <main className="container mx-auto px-4 py-16 text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
        </main>
      </AdminLayout>
    );
  }
  if (!user || !isAdmin) {
    return (
      <AdminLayout>
        <main className="max-w-md mx-auto px-6 py-24 text-center">
          <Lock className="w-8 h-8 mx-auto text-muted-foreground mb-4" />
          <h1 className="font-sans uppercase tracking-[0.105em] text-2xl text-foreground mb-4">
            {!user ? t("Admin sign-in required", "Connexion administrateur requise") : t("Access denied", "Accès refusé")}
          </h1>
        </main>
      </AdminLayout>
    );
  }
  if (loadError || !catalog) {
    return (
      <AdminLayout>
        <main className="container mx-auto px-4 py-16 text-center text-muted-foreground">{loadError}</main>
      </AdminLayout>
    );
  }

  const status = !orderId ? null : isDraft ? "draft" : "awaiting_payment";
  const readOnly = !!notEditable;
  const q = quote;
  const adjAmount = q?.adjustment.amount ?? 0;

  return (
    <AdminLayout>
      <main className="container mx-auto px-4 py-8 max-w-6xl">
        <Link to="/admin/manual-orders" className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground mb-4">
          <ChevronLeft className="w-3.5 h-3.5 mr-1" /> {t("Manual orders", "Commandes manuelles")}
        </Link>
        <div className="flex items-center gap-3 flex-wrap mb-6">
          <h1 className="font-sans uppercase tracking-[0.105em] text-2xl text-foreground">
            {orderNumber || t("New manual order", "Nouvelle commande manuelle")}
          </h1>
          {status && (
            <span className={cn("px-2 py-0.5 text-[10px] uppercase tracking-wide", MANUAL_STATUS_LABELS[status].className)}>
              {tr(MANUAL_STATUS_LABELS[status])}
            </span>
          )}
        </div>

        {readOnly && (
          <div className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 mb-6 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {notEditable}
          </div>
        )}

        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-8 lg:items-start">
          <fieldset disabled={readOnly} className="space-y-6 min-w-0">
            {/* 1. Client */}
            <section className="border border-border/60 bg-background">
              <h2 className={sectionTitle}>1. {t("Customer", "Client")}</h2>
              <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {([
                  ["first_name", t("First name", "Prénom")],
                  ["last_name", t("Last name", "Nom")],
                  ["phone", t("Phone", "Téléphone")],
                  ["email", t("Email", "Email")],
                  ["company", t("Company (optional)", "Entreprise (optionnel)")],
                ] as const).map(([k, lab]) => (
                  <div key={k}>
                    <label className={label}>{lab}{k !== "company" && <span className="text-destructive"> *</span>}</label>
                    <input
                      type={k === "email" ? "email" : k === "phone" ? "tel" : "text"}
                      aria-label={lab}
                      value={customer[k]}
                      onChange={(e) => setCustomer({ ...customer, [k]: e.target.value })}
                      className={field}
                    />
                  </div>
                ))}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={label}>{t("Channel", "Canal")}</label>
                    <select value={customer.channel} onChange={(e) => setCustomer({ ...customer, channel: e.target.value })} className={field}>
                      {Object.entries(CHANNEL_LABELS).map(([k, v]) => <option key={k} value={k}>{tr(v)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={label}>{t("Email language", "Langue des emails")}</label>
                    <select value={customer.lang} onChange={(e) => setCustomer({ ...customer, lang: e.target.value === "en" ? "en" : "fr" })} className={field}>
                      <option value="fr">Français</option>
                      <option value="en">English</option>
                    </select>
                  </div>
                </div>
              </div>
            </section>

            {/* 2. Products */}
            <section className="space-y-3">
              <h2 className="text-base font-bold uppercase tracking-[0.12em] text-foreground">2. {t("Products", "Produits")}</h2>
              {items.map((it, i) => (
                <ItemEditor
                  key={it.key}
                  index={i}
                  item={it}
                  catalog={catalog}
                  dateGroups={groups}
                  quote={q?.items[i]}
                  onChange={(next) => setItems((prev) => prev.map((x) => (x.key === it.key ? next : x)))}
                  onRemove={() => setItems((prev) => prev.filter((x) => x.key !== it.key))}
                />
              ))}
              <button
                type="button"
                onClick={() => setItems((prev) => [...prev, { ...emptyItem("bento_cake"), dateKey: groups[0]?.key ?? null }])}
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                <Plus className="w-4 h-4" /> {t("Add a product", "Ajouter un produit")}
              </button>
            </section>

            {/* 3. Dates */}
            <section className="border border-border/60 bg-background">
              <h2 className={sectionTitle}>3. {t("Dates / delivery", "Dates / livraison")}</h2>
              <div className="p-4 space-y-4">
                <p className="text-xs text-muted-foreground">
                  {t("One group per day. Assign each product to its date in the product block. Workshops use their session date.",
                    "Un groupe par jour. Chaque produit est rattaché à sa date dans son bloc. Les workshops utilisent la date de leur session.")}
                </p>
                {groups.map((g, gi) => {
                  const fq = q?.fulfillments.find((f) => f.date === g.date);
                  const used = items.some((it) => dateKeyOf(it) === g.key && it.product !== "workshop");
                  return (
                    <div key={g.key} className="border border-border/50 p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold uppercase tracking-[0.1em]">{t("Date", "Date")} {gi + 1}</span>
                        {groups.length > 1 && (
                          <button type="button" onClick={() => {
                            setGroups((prev) => prev.filter((x) => x.key !== g.key));
                            setItems((prev) => prev.map((it) => (it.dateKey === g.key ? { ...it, dateKey: null } : it)));
                          }} className="text-muted-foreground hover:text-destructive" aria-label={t("Remove this date", "Retirer cette date")}>
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div>
                          <label className={label}>{t("Date", "Date")}</label>
                          <DayPicker value={g.date} lang={lang === "en" ? "en" : "fr"} onChange={(v) => setGroups((prev) => prev.map((x) => (x.key === g.key ? { ...x, date: v } : x)))} />
                        </div>
                        <div>
                          <label className={label}>{t("Method", "Mode")}</label>
                          <select
                            value={g.deliveryMethod}
                            onChange={(e) => {
                              const method = e.target.value === "delivery" ? "delivery" : "pickup";
                              // Keep the slot only if the other list has it too.
                              setGroups((prev) => prev.map((x) => (x.key === g.key ? { ...x, deliveryMethod: method, slot: slotsFor(method).includes(x.slot) ? x.slot : "" } : x)));
                            }}
                            className={field}
                          >
                            <option value="pickup">{t("Pickup", "Retrait")}</option>
                            <option value="delivery">{t("Delivery", "Livraison")}</option>
                          </select>
                        </div>
                        <div>
                          <label className={label}>{t("Time slot", "Créneau")}</label>
                          <select value={g.slot} onChange={(e) => setGroups((prev) => prev.map((x) => (x.key === g.key ? { ...x, slot: e.target.value } : x)))} className={field}>
                            <option value="">{t("Choose a time slot…", "Choisir un créneau…")}</option>
                            {/* An older free-text slot stays visible until it is replaced. */}
                            {g.slot && !slotsFor(g.deliveryMethod).includes(g.slot) && <option value={g.slot}>{g.slot}</option>}
                            {slotsFor(g.deliveryMethod).map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                      </div>
                      {g.deliveryMethod === "delivery" && (
                        <div>
                          <label className={label}>{t("Delivery address", "Adresse de livraison")}</label>
                          {g.addressLabel && g.placeId && <p className="text-xs text-muted-foreground mb-1">{g.addressLabel}</p>}
                          <DeliveryAddressAutocomplete
                            languageCode={lang === "en" ? "en" : "fr"}
                            placeholder={g.placeId ? t("Change the address…", "Changer l'adresse…") : t("Start typing the address…", "Commencez à taper l'adresse…")}
                            onSelect={(sel) => setGroups((prev) => prev.map((x) => (x.key === g.key ? { ...x, placeId: sel.placeId, addressLabel: sel.label } : x)))}
                            onClear={() => { /* keep the confirmed address until another one is picked */ }}
                          />
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {!used
                          ? t("No product in this date yet.", "Aucun produit dans cette date pour l'instant.")
                          : fq?.error
                            ? <span className="text-amber-800">{friendlyMessage(fq.error, lang === "en" ? "en" : "fr")}</span>
                            : fq
                              ? <>
                                  {g.deliveryMethod === "delivery" && fq.deliveryFee != null && <>{t("Delivery", "Livraison")} {formatChf(fq.deliveryFee)}{fq.deliveryZone ? ` (${fq.deliveryZone})` : ""} · </>}
                                  {t("Express", "Express")} {fq.expressRate ? `${Math.round(fq.expressRate * 100)} %` : "0 %"}
                                  {fq.expressSurcharge ? ` = ${formatChf(fq.expressSurcharge)}` : ""}
                                </>
                              : null}
                      </p>
                    </div>
                  );
                })}
                <button
                  type="button"
                  onClick={() => {
                    const first = groups[0]?.key ?? null;
                    const known = new Set(groups.map((g) => g.key));
                    // Products that were implicitly on the single date stay on it.
                    setItems((prev) => prev.map((it) => (it.product !== "workshop" && (!it.dateKey || !known.has(it.dateKey)) ? { ...it, dateKey: first } : it)));
                    setGroups((prev) => [...prev, emptyGroup()]);
                  }}
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  <Plus className="w-4 h-4" /> {t("Add a date", "Ajouter une date")}
                </button>
              </div>
            </section>

            {/* 4. Notes */}
            <section className="border border-border/60 bg-background">
              <h2 className={sectionTitle}>4. {t("Notes", "Notes")}</h2>
              <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={cn(label, "text-primary")}>{t("Internal note (never shown to the customer)", "Note interne (jamais montrée au client)")}</label>
                  <textarea value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} rows={3} className={cn(field, "border-primary/40")} />
                </div>
                <div>
                  <label className={label}>{t("Note visible to the customer", "Note visible par le client")}</label>
                  <textarea value={orderComment} onChange={(e) => setOrderComment(e.target.value)} rows={3} className={field} />
                </div>
              </div>
            </section>
          </fieldset>

          {/* 5. Price summary (sticky on desktop) */}
          <aside className="mt-6 lg:mt-0 lg:sticky lg:top-28">
            <div className="border border-border bg-secondary/30 p-4 space-y-3 text-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.105em] flex items-center justify-between">
                {t("Price", "Prix")} {quoting && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
              </p>
              <ul className="space-y-1">
                {items.map((it, i) => {
                  const qi = q?.items[i];
                  return (
                    <li key={it.key}>
                      <div className="flex justify-between gap-2 font-semibold">
                        <span>{t("Product", "Produit")} {i + 1}</span>
                        <span>{qi?.total != null ? formatChf(qi.total) : <span className="text-amber-800">—</span>}</span>
                      </div>
                      {qi?.total != null && qi.breakdown && qi.breakdown.length > 0 && (
                        <ul className="mt-0.5 mb-1.5 pl-3 border-l border-border space-y-0.5 text-xs">
                          {qi.breakdown.map((line, li) => (
                            <li key={li} className="flex justify-between gap-2">
                              <span className="text-muted-foreground">{labelBreakdownLine(line, catalog, lang === "en" ? "en" : "fr", it.size)}</span>
                              <span className={line.amount === 0 ? "text-muted-foreground" : ""}>{line.amount === 0 ? t("incl.", "inclus") : `+${line.amount.toFixed(2)}`}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
                <li className="flex justify-between"><span className="text-muted-foreground">{t("Delivery", "Livraison")}</span><span>{formatChf(q?.totals.delivery ?? 0)}</span></li>
                <li className="flex justify-between"><span className="text-muted-foreground">{t("Express", "Express")}</span><span>{formatChf(q?.totals.express ?? 0)}</span></li>
              </ul>
              <div className="flex justify-between border-t border-border pt-2 font-semibold">
                <span>{t("Calculated price", "Prix calculé")}</span>
                <span>{q?.totals.calculated != null ? formatChf(q.totals.calculated) : "—"}</span>
              </div>

              <fieldset disabled={readOnly} className="space-y-2 border-t border-border pt-3">
                <label className={label}>{t("Adjustment", "Ajustement")}</label>
                <select value={adjMode} onChange={(e) => setAdjMode(e.target.value as AdjustmentMode)} className={field}>
                  <option value="none">{t("None", "Aucun")}</option>
                  <option value="amount">{t("Amount in CHF", "Montant en CHF")}</option>
                  <option value="percent">{t("Percentage", "Pourcentage")}</option>
                  <option value="final">{t("Final price set by hand", "Prix final saisi à la main")}</option>
                </select>
                {adjMode !== "none" && (
                  <>
                    <div className="flex gap-2">
                      {adjMode !== "final" && (
                        <select value={adjDirection} onChange={(e) => setAdjDirection(e.target.value === "supplement" ? "supplement" : "discount")} className={cn(field, "w-auto")}>
                          <option value="discount">{t("Discount", "Remise")}</option>
                          <option value="supplement">{t("Supplement", "Supplément")}</option>
                        </select>
                      )}
                      <input
                        inputMode="decimal"
                        value={adjValue}
                        onChange={(e) => setAdjValue(e.target.value)}
                        placeholder={adjMode === "percent" ? "10" : adjMode === "final" ? "110" : "10"}
                        className={field}
                        aria-label={t("Value", "Valeur")}
                      />
                      <span className="self-center text-muted-foreground">{adjMode === "percent" ? "%" : "CHF"}</span>
                    </div>
                    <select value={adjReason} onChange={(e) => setAdjReason(e.target.value)} className={field} aria-label={t("Reason", "Raison")}>
                      <option value="">{t("Reason…", "Raison…")}</option>
                      {ADJUSTMENT_REASONS.map((r) => <option key={r.id} value={r.id}>{tr(r)}</option>)}
                    </select>
                    <input value={adjNote} onChange={(e) => setAdjNote(e.target.value)} placeholder={t("Note (optional)", "Note (optionnel)")} className={field} />
                  </>
                )}
              </fieldset>

              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("Adjustment", "Ajustement")}</span>
                <span className={adjAmount < 0 ? "text-emerald-700" : adjAmount > 0 ? "text-amber-800" : ""}>
                  {adjAmount === 0 ? "—" : `${adjAmount > 0 ? "+" : "−"}${formatChf(Math.abs(adjAmount))}`}
                </span>
              </div>
              <div className="flex justify-between border-t border-border pt-2 text-base font-bold text-primary">
                <span>{t("Final price", "Prix final")}</span>
                <span>{q?.final != null ? formatChf(q.final) : "—"}</span>
              </div>

              {quoteFailed && (
                <p className="text-xs text-destructive">
                  {t("The price could not be calculated (server error). Change a field to try again.", "Le prix n'a pas pu être calculé (erreur serveur). Modifiez un champ pour réessayer.")}
                </p>
              )}
              {!readOnly && missing.length > 0 && (
                <div className="border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <p className="font-semibold mb-1">{t("Missing before confirming:", "Il manque pour confirmer :")}</p>
                  <ul className="space-y-0.5">
                    {missing.map((m) => <li key={m}>• {m}</li>)}
                  </ul>
                  <p className="mt-1 text-amber-800/80">{t("You can still save a draft.", "Vous pouvez quand même enregistrer un brouillon.")}</p>
                </div>
              )}
              {problems.length > 0 && (
                <ul className="text-xs text-destructive space-y-0.5 border-t border-border pt-2">
                  {problems.map((p) => <li key={p}>• {friendlyMessage(p, lang === "en" ? "en" : "fr")}</li>)}
                </ul>
              )}

              {!readOnly && (
                <div className="space-y-2 pt-1">
                  <Button onClick={() => save("draft")} disabled={!!saving} variant="outline" className="w-full rounded-none">
                    {saving === "draft" && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                    {t("Save as draft", "Enregistrer en brouillon")}
                  </Button>
                  <Button onClick={() => save("confirm")} disabled={!!saving} className="w-full rounded-none bg-primary hover:bg-primary/90 text-primary-foreground">
                    {saving === "confirm" && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                    {t("Confirm — awaiting payment", "Confirmer — en attente de paiement")}
                  </Button>
                  <p className="text-[11px] text-muted-foreground">
                    {t("No email is sent and no workshop seat is reserved at this stage.", "Aucun email n'est envoyé et aucune place workshop n'est réservée à ce stade.")}
                  </p>
                </div>
              )}
            </div>
          </aside>
        </div>
      </main>
    </AdminLayout>
  );
};

export default AdminManualOrderEditor;
