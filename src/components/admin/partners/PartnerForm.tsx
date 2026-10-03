import { useState } from "react";
import { Info, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ESTABLISHMENT_LABELS, partnersApi, type PartnerDetail } from "@/lib/partners";
import { useSessionPin } from "@/lib/adminSession";

// Formulaire partenaire (création / modification). La remise client et la
// commission sont deux paramètres distincts. L'identifiant (slug) et le
// jeton du lien ne changent jamais une fois créés. Écriture avec PIN admin.

const toPct = (f: number | null | undefined) => (f == null ? "" : String(Math.round(Number(f) * 10000) / 100));
const slugify = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

export default function PartnerForm({ partner, onCancel, onSaved }: { partner: PartnerDetail["partner"] | null; onCancel: () => void; onSaved: (id: string) => void }) {
  const [f, setF] = useState({
    name: partner?.name ?? "", slug: partner?.slug ?? "", discountPct: partner ? toPct(partner.customer_discount_rate) : "10",
    commissionPct: partner?.commission_configured === false ? "" : partner ? toPct(partner.commission_rate) : "",
    commissionConfigured: partner ? partner.commission_configured : false, active: partner?.active ?? true,
    establishmentType: partner?.establishment_type ?? "", address: partner?.address ?? "", website: partner?.website ?? "",
    contactFirstName: partner?.contact_first_name ?? "", contactLastName: partner?.contact_last_name ?? "",
    contactEmail: partner?.contact_email ?? "", contactPhone: partner?.contact_phone ?? "", startDate: partner?.start_date ?? "",
    promoCodeReference: partner?.promo_code_reference ?? "", notionPageId: partner?.notion_page_id ?? "", notes: partner?.notes ?? "", rateNote: "",
  });
  const [slugTouched, setSlugTouched] = useState(!!partner);
  const [pin, setPin, pinBySession] = useSessionPin();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const rateChanged = partner && (toPct(partner.customer_discount_rate) !== f.discountPct || (f.commissionConfigured ? toPct(partner.commission_rate) : "") !== f.commissionPct || partner.commission_configured !== f.commissionConfigured);
  const zeroDiscount = Number(String(f.discountPct).replace(",", ".")) === 0;
  const field = "rounded-none h-9";
  const save = async () => {
    if (busy) return;
    if (!pin.trim()) { setErr("Saisissez le code PIN administrateur."); return; }
    setBusy(true); setErr(null);
    try {
      const r = await partnersApi<{ id: string }>({ action: "save", pin, id: partner?.id ?? null, ...f, slug: partner ? partner.slug : f.slug });
      onSaved(r.id);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <form className="border border-border/60 p-4 space-y-4 text-sm" onSubmit={(e) => { e.preventDefault(); save(); }} data-testid="partner-form">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 [&>*]:min-w-0">
        <div className="space-y-1"><Label className="text-xs">Établissement / partenaire</Label>
          <Input value={f.name} onChange={(e) => { set("name", e.target.value); if (!slugTouched && !partner) set("slug", slugify(e.target.value)); }} className={field} required /></div>
        <div className="space-y-1"><Label className="text-xs">Identifiant unique et stable</Label>
          <Input value={f.slug} disabled={!!partner} onChange={(e) => { setSlugTouched(true); set("slug", slugify(e.target.value)); }} className={field} required />
          <p className="text-[11px] text-muted-foreground">{partner ? "Ne change jamais (historique et statistiques)." : "Minuscules, chiffres et tirets ; ne pourra plus changer."}</p></div>
        <div className="space-y-1"><Label className="text-xs">Type</Label>
          <select className="h-9 w-full border border-input bg-background px-2 text-sm" value={f.establishmentType} onChange={(e) => set("establishmentType", e.target.value)}>
            <option value="">—</option>{Object.entries(ESTABLISHMENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
        <div className="space-y-1"><Label className="text-xs">Remise client (%)</Label>
          <Input inputMode="decimal" value={f.discountPct} onChange={(e) => set("discountPct", e.target.value)} className={field} />
          <p className="text-[11px] text-muted-foreground">Appliquée par le site au paiement, sur le prix de base des gâteaux éligibles. 0 % possible (commission seule).</p></div>
        <div className="space-y-1"><Label className="text-xs">Commission du partenaire (%)</Label>
          <Input inputMode="decimal" value={f.commissionPct} disabled={!f.commissionConfigured} onChange={(e) => set("commissionPct", e.target.value)} className={field} placeholder={f.commissionConfigured ? "" : "À configurer"} />
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" className="w-4 h-4" checked={!f.commissionConfigured} onChange={(e) => set("commissionConfigured", !e.target.checked)} />À configurer (aucun taux pour l'instant)</label></div>
        <div className="space-y-1"><Label className="text-xs">Statut</Label>
          <label className="flex items-center gap-2 h-9"><input type="checkbox" className="w-4 h-4" checked={f.active} onChange={(e) => set("active", e.target.checked)} />Actif (lien valable)</label></div>
        <div className="space-y-1"><Label className="text-xs">Contact — prénom</Label><Input value={f.contactFirstName} onChange={(e) => set("contactFirstName", e.target.value)} className={field} /></div>
        <div className="space-y-1"><Label className="text-xs">Contact — nom</Label><Input value={f.contactLastName} onChange={(e) => set("contactLastName", e.target.value)} className={field} /></div>
        <div className="space-y-1"><Label className="text-xs">Email (facultatif)</Label><Input type="email" value={f.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} className={field} /></div>
        <div className="space-y-1"><Label className="text-xs">Téléphone (facultatif)</Label><Input value={f.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} className={field} /></div>
        <div className="space-y-1"><Label className="text-xs">Date de début</Label><Input type="date" value={f.startDate} onChange={(e) => set("startDate", e.target.value)} className={field} /></div>
        <div className="space-y-1"><Label className="text-xs">Code de Notion (référence)</Label><Input value={f.promoCodeReference} onChange={(e) => set("promoCodeReference", e.target.value)} className={field} />
          <p className="text-[11px] text-muted-foreground">Simple référence : non utilisable au paiement (le site reconnaît le partenaire par son lien).</p></div>
        <div className="space-y-1 sm:col-span-2 lg:col-span-3"><Label className="text-xs">Notes internes</Label><Input value={f.notes} onChange={(e) => set("notes", e.target.value)} className={field} /></div>
        {rateChanged && <div className="space-y-1 sm:col-span-2 lg:col-span-3"><Label className="text-xs">Raison du changement de taux</Label><Input value={f.rateNote} onChange={(e) => set("rateNote", e.target.value)} className={field} />
          <p className="text-[11px] text-muted-foreground">S'applique aux nouvelles commandes à partir d'aujourd'hui ; les commandes passées gardent leur taux. Les conditions devront être reconfirmées pour le nouveau taux.</p></div>}
      </div>
      {zeroDiscount && (
        <p className="border border-sky-300 bg-sky-50 text-sky-900 px-3 py-2 flex gap-2"><Info className="w-4 h-4 mt-0.5 shrink-0" />
          Remise 0 % : les commandes passées avec son lien lui sont attribuées, avec sa commission. Le client ne reçoit aucune remise partenaire et garde sa remise de bienvenue s'il y a droit.</p>
      )}
      {err && <p className="border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900" role="alert">{err}</p>}
      <div className="flex flex-wrap items-end gap-2">
        {!pinBySession && <div className="space-y-1"><Label className="text-xs">Code PIN administrateur</Label><Input type="password" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} className="rounded-none h-9 w-40" data-testid="partner-pin" /></div>}
        <span className="flex-1" />
        <Button type="button" variant="outline" className="rounded-none" onClick={onCancel} disabled={busy}>Annuler</Button>
        <Button type="submit" className="rounded-none" disabled={busy}>{busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Enregistrer</Button>
      </div>
    </form>
  );
}
