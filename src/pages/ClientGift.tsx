// Offre « Attention client » (14.11.2026) — formulaire express pour une
// entreprise qui veut offrir à SON client un gâteau imprimé avec le logo de
// ce client. Pensé pour être rempli en une minute (ex. la réception d'un
// établissement) : taille, quantité, logo (nom ou site du client — pas de
// fichier, Mel le cherche elle-même), instructions facultatives, date,
// retrait ou livraison, coordonnées.
//
// PAGE CACHÉE pour l'instant : aucune entrée de menu, aucun lien, pas dans
// le sitemap, balise noindex. Accessible seulement par l'adresse directe
// /attention-client. Rectangle volontairement absent (pas de feuille
// d'impression assez grande pour l'instant).
//
// L'envoi passe par send-contact-request (type « client_gift ») : un e-mail
// à contact@, rien en base, aucun paiement. Mel crée ensuite la commande
// dans l'admin et envoie le lien de paiement (F41/F43).

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { CalendarIcon, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { submitContactRequest } from "@/lib/contactRequest";
import { combinePhoneNumber } from "@/lib/identity";
import { PhoneNumberField } from "@/components/PhoneNumberField";
import { HoneypotField } from "@/components/HoneypotField";
import { useLang } from "@/context/LanguageContext";
import { sizes, getStylePrice } from "@/data/customization";
import { isOrderDateDisabled } from "@/lib/orderDates";

const MIN_LOCAL_PHONE_DIGITS = 4;
const MAX_QUANTITY = 200;

// Bento, Retro, Medium, Large — prix = taille + image imprimée (même
// catalogue que le site, rien de recopié à la main).
const GIFT_SIZES = sizes
  .filter((s) => s.id !== "rectangle")
  .map((s) => ({ ...s, unitPrice: s.price + getStylePrice("printed-picture", s.id) }));

type Fulfillment = "pickup" | "delivery";
type Payment = "link" | "transfer";

const RequiredMark = () => <span className="text-destructive">*</span>;

const ChoiceButton = ({
  selected, onClick, children, className,
}: { selected: boolean; onClick: () => void; children: React.ReactNode; className?: string }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={selected}
    className={cn(
      "border px-3 py-3 text-sm text-left transition-colors rounded-none",
      selected ? "border-primary bg-primary/5 text-foreground" : "border-border hover:border-foreground/40 text-foreground/90",
      className,
    )}
  >
    {children}
  </button>
);

const ClientGift = () => {
  const { t } = useLang();

  const [size, setSize] = useState<string>("");
  const [quantity, setQuantity] = useState(1);
  const [clientLogo, setClientLogo] = useState("");
  const [instructions, setInstructions] = useState("");
  const [date, setDate] = useState<Date | undefined>();
  const [fulfillment, setFulfillment] = useState<Fulfillment | "">("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [countryCode, setCountryCode] = useState("+41");
  const [localPhone, setLocalPhone] = useState("");
  const [payment, setPayment] = useState<Payment>("link");
  const [honeypot, setHoneypot] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  // Page cachée : jamais indexée, même si quelqu'un trouve l'adresse.
  useEffect(() => {
    document.title = t("Client gift – Bento Cake Studio", "Attention client – Bento Cake Studio");
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => {
      meta.remove();
      document.title = "Bento Cake Studio Geneva";
    };
  }, [t]);

  const selectedSize = GIFT_SIZES.find((s) => s.id === size);
  const estimate = selectedSize ? selectedSize.unitPrice * quantity : 0;

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!selectedSize) e.size = t("Please choose a size", "Choisissez une taille");
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) e.quantity = t("Please enter a quantity", "Indiquez une quantité");
    if (!clientLogo.trim()) e.clientLogo = t("Tell us whose logo to print", "Indiquez le logo à imprimer");
    if (!date) e.date = t("Please select a date", "Choisissez une date");
    if (!fulfillment) e.fulfillment = t("Pick-up or delivery?", "Retrait ou livraison ?");
    if (fulfillment === "delivery" && !deliveryAddress.trim()) e.deliveryAddress = t("Please enter the delivery address", "Indiquez l'adresse de livraison");
    if (!companyName.trim()) e.companyName = t("Company name is required", "Nom de l'entreprise requis");
    if (!fullName.trim()) e.fullName = t("Name is required", "Nom requis");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) e.email = t("Please enter a valid email address", "Adresse e-mail invalide");
    if (localPhone.trim().length < MIN_LOCAL_PHONE_DIGITS) e.phone = t("Please enter a valid phone number", "Numéro de téléphone invalide");
    return e;
  };

  const onSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length > 0) {
      toast.error(t("Please complete the highlighted fields.", "Merci de compléter les champs indiqués."));
      return;
    }
    setSubmitting(true);
    try {
      await submitContactRequest(
        "client_gift",
        {
          size: selectedSize!.name,
          quantity: String(quantity),
          estimate: `CHF ${estimate} (${quantity} × ${selectedSize!.unitPrice}, hors livraison)`,
          clientLogo: clientLogo.trim(),
          instructions: instructions.trim() || "Faites-nous confiance (design sobre aux couleurs du client)",
          date: format(date!, "dd.MM.yyyy"),
          fulfillment: fulfillment === "delivery" ? "Livraison" : "Retrait à l'atelier",
          deliveryAddress: fulfillment === "delivery" ? deliveryAddress.trim() : "",
          payment: payment === "transfer" ? "Virement / facture" : "Lien de paiement en ligne",
          companyName: companyName.trim(),
          fullName: fullName.trim(),
          email: email.trim(),
          phone: combinePhoneNumber(countryCode, localPhone),
        },
        email.trim(),
        { honeypot },
      );
      setDone(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("Something went wrong. Please try again.", "Une erreur s'est produite. Veuillez réessayer."));
    } finally {
      setSubmitting(false);
    }
  };

  const err = (key: string) => errors[key] ? <p className="text-sm text-destructive">{errors[key]}</p> : null;

  if (done) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-16 max-w-xl text-center">
          <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <span className="text-3xl text-primary">✓</span>
          </div>
          <h1 className="font-sans uppercase tracking-[0.105em] text-xl font-semibold text-foreground mb-3">
            {t("Thank you", "Merci")}
          </h1>
          <p className="text-muted-foreground leading-relaxed">
            {t(
              "We have your request. We'll find the logo, then send you a confirmation and a payment link by email.",
              "Nous avons bien reçu votre demande. Nous recherchons le logo, puis nous vous envoyons une confirmation et un lien de paiement par e-mail.",
            )}
          </p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12 max-w-2xl">
        <h1 className="font-sans text-3xl md:text-4xl text-center tracking-[0.105em] uppercase text-foreground mb-4 font-semibold">
          {t("A personal touch for your client?", "Besoin d'une attention personnalisée pour votre client ?")}
        </h1>
        <p className="text-center text-muted-foreground mb-10 text-sm md:text-base">
          {t(
            "Cakes printed with your client's logo. One minute to order — we take care of the rest.",
            "Des gâteaux imprimés avec le logo de votre client. Une minute pour commander, on s'occupe du reste.",
          )}
        </p>

        <form onSubmit={onSubmit} className="space-y-8" noValidate>
          <HoneypotField value={honeypot} onChange={setHoneypot} />

          {/* 1. Taille */}
          <div className="space-y-2">
            <Label>{t("Size", "Taille")} <RequiredMark /></Label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {GIFT_SIZES.map((s) => (
                <ChoiceButton key={s.id} selected={size === s.id} onClick={() => setSize(s.id)} className="flex flex-col items-center text-center">
                  <img src={s.image} alt="" className="w-16 h-16 object-contain mb-2" />
                  <span className="font-medium">{s.name}</span>
                  <span className="text-xs text-muted-foreground">CHF {s.unitPrice}</span>
                </ChoiceButton>
              ))}
            </div>
            {err("size")}
          </div>

          {/* 2. Quantité */}
          <div className="space-y-2">
            <Label htmlFor="cg-qty">{t("Quantity", "Quantité")} <RequiredMark /></Label>
            <div className="flex items-center gap-3">
              <Button type="button" variant="outline" size="icon" className="rounded-none" aria-label="-" onClick={() => setQuantity((q) => Math.max(1, q - 1))}>
                <Minus className="h-4 w-4" />
              </Button>
              <Input
                id="cg-qty"
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_QUANTITY}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(0, Math.min(MAX_QUANTITY, Math.floor(Number(e.target.value) || 0))))}
                className="w-20 text-center rounded-none"
              />
              <Button type="button" variant="outline" size="icon" className="rounded-none" aria-label="+" onClick={() => setQuantity((q) => Math.min(MAX_QUANTITY, q + 1))}>
                <Plus className="h-4 w-4" />
              </Button>
              {selectedSize && quantity > 0 && (
                <span className="text-sm text-muted-foreground">
                  {t("Approx.", "Env.")} CHF {estimate} {t("(excl. delivery)", "(hors livraison)")}
                </span>
              )}
            </div>
            {err("quantity")}
          </div>

          {/* 3. Logo */}
          <div className="space-y-1.5">
            <Label htmlFor="cg-logo">{t("Your client's company name or website", "Nom de l'entreprise de votre client ou son site web")} <RequiredMark /></Label>
            <p className="text-xs text-muted-foreground">{t("No file needed: we find the logo ourselves.", "Pas besoin d'envoyer de fichier : nous trouvons le logo nous-mêmes.")}</p>
            <Input id="cg-logo" placeholder={t("e.g. Acme SA or www.acme.ch", "ex. Acme SA ou www.acme.ch")} value={clientLogo} onChange={(e) => setClientLogo(e.target.value)} />
            {err("clientLogo")}
          </div>

          {/* 4. Instructions */}
          <div className="space-y-1.5">
            <Label htmlFor="cg-instr">{t("Instructions", "Instructions")} <span className="text-muted-foreground">{t("(optional)", "(facultatif)")}</span></Label>
            <p className="text-xs text-muted-foreground">
              {t(
                "Tell us what you'd like, or trust us: a clean design in your client's colours.",
                "Dites-nous ce que vous voulez, ou faites-nous confiance : un design sobre aux couleurs de votre client.",
              )}
            </p>
            <Textarea id="cg-instr" rows={3} maxLength={2000} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
          </div>

          {/* 5. Date + retrait/livraison */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="space-y-1.5">
              <Label>{t("Date", "Date")} <RequiredMark /></Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className={cn("w-full justify-start text-left font-normal rounded-none", !date && "text-muted-foreground")}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {date ? format(date, "dd.MM.yyyy") : t("Select a date", "Sélectionner une date")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={date}
                    onSelect={(d) => d && setDate(d)}
                    disabled={isOrderDateDisabled}
                    initialFocus
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
              {err("date")}
            </div>
            <div className="space-y-1.5">
              <Label>{t("Pick-up or delivery", "Retrait ou livraison")} <RequiredMark /></Label>
              <div className="grid grid-cols-2 gap-3">
                <ChoiceButton selected={fulfillment === "pickup"} onClick={() => setFulfillment("pickup")} className="text-center">
                  {t("Pick-up", "Retrait")}
                </ChoiceButton>
                <ChoiceButton selected={fulfillment === "delivery"} onClick={() => setFulfillment("delivery")} className="text-center">
                  {t("Delivery", "Livraison")}
                </ChoiceButton>
              </div>
              {err("fulfillment")}
            </div>
          </div>
          {fulfillment === "pickup" && (
            <p className="text-xs text-muted-foreground -mt-4">{t("At the studio, Rue Prévost-Martin 8, Geneva.", "À l'atelier, Rue Prévost-Martin 8, Genève.")}</p>
          )}
          {fulfillment === "delivery" && (
            <div className="space-y-1.5 -mt-2">
              <Label htmlFor="cg-addr">{t("Delivery address", "Adresse de livraison")} <RequiredMark /></Label>
              <Input id="cg-addr" placeholder={t("Street, number, postcode, city", "Rue, numéro, NPA, ville")} value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} />
              <p className="text-xs text-muted-foreground">{t("Geneva area, from CHF 15 depending on distance.", "Région genevoise, dès CHF 15 selon la distance.")}</p>
              {err("deliveryAddress")}
            </div>
          )}

          {/* 6. Coordonnées */}
          <div className="space-y-4 border-t border-border pt-6">
            <div className="space-y-1.5">
              <Label htmlFor="cg-company">{t("Your company", "Votre entreprise")} <RequiredMark /></Label>
              <Input id="cg-company" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
              {err("companyName")}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cg-name">{t("First and last name", "Prénom et nom")} <RequiredMark /></Label>
              <Input id="cg-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
              {err("fullName")}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="cg-email">{t("Email address", "Adresse e-mail")} <RequiredMark /></Label>
                <Input id="cg-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                {err("email")}
              </div>
              <PhoneNumberField
                id="cg-phone"
                label={t("Phone number", "Numéro de téléphone")}
                countryCode={countryCode}
                onCountryCodeChange={setCountryCode}
                localPhone={localPhone}
                onLocalPhoneChange={setLocalPhone}
                error={errors.phone}
              />
            </div>
          </div>

          {/* 7. Paiement */}
          <div className="space-y-2">
            <Label>{t("Payment", "Paiement")}</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <ChoiceButton selected={payment === "link"} onClick={() => setPayment("link")}>
                {t("Online payment link", "Lien de paiement en ligne")}
              </ChoiceButton>
              <ChoiceButton selected={payment === "transfer"} onClick={() => setPayment("transfer")}>
                {t("Bank transfer / invoice", "Virement / facture")}
              </ChoiceButton>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("Nothing is charged now: we confirm your order by email first.", "Rien n'est payé maintenant : nous confirmons d'abord votre commande par e-mail.")}
            </p>
          </div>

          <Button
            type="submit"
            disabled={submitting}
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-2.5 text-[13px] font-medium uppercase tracking-[0.105em] rounded-none"
          >
            {submitting ? t("Sending…", "Envoi…") : t("Send my order", "Envoyer ma commande")}
          </Button>
        </form>
      </div>
    </Layout>
  );
};

export default ClientGift;
