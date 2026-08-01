import io, os, sys

P = "/sessions/rcw-01d8yvniirrtjcjqoatid7yj/mnt/mini-cake-corner/src/pages/Checkout.tsx"
s = io.open(P, encoding="utf-8").read()
orig = s

def rep(old, new, n=1):
    global s
    c = s.count(old)
    if c != n:
        print("MISMATCH (%d, expected %d): %r" % (c, n, old[:100])); sys.exit(1)
    s = s.replace(old, new)

# ---------------------------------------------------------------- toasts
T = [
('''        title: "Privacy Policy required",
        description: "Please accept the privacy policy to continue.",''',
 '''        title: t("Privacy Policy required", "Politique de confidentialité requise"),
        description: t("Please accept the privacy policy to continue.", "Veuillez accepter la politique de confidentialité pour continuer."),'''),
('''        title: "Please select a delivery date",''',
 '''        title: t("Please select a delivery date", "Veuillez sélectionner une date"),'''),
('''        title: "Please enter your delivery address",''',
 '''        title: t("Please enter your delivery address", "Veuillez saisir votre adresse de livraison"),'''),
('''        title: "Delivery zone not recognised",
        description:
          "Please make sure your address includes a recognised area name (e.g., Carouge, Champel, Meyrin...)",''',
 '''        title: t("Delivery zone not recognised", "Zone de livraison non reconnue"),
        description: t(
          "Please make sure your address includes a recognised area name (e.g., Carouge, Champel, Meyrin...)",
          "Merci de vérifier que votre adresse contient un nom de quartier reconnu (ex. Carouge, Champel, Meyrin...)"),'''),
('''        title: "Pick-up Time required",
        description: "Please select a pick-up time slot.",''',
 '''        title: t("Pick-up Time required", "Heure de retrait requise"),
        description: t("Please select a pick-up time slot.", "Veuillez sélectionner un créneau de retrait."),'''),
('''        title: "Delivery information required",
        description: "Please select a delivery time slot and add a comment with the necessary delivery information.",''',
 '''        title: t("Delivery information required", "Informations de livraison requises"),
        description: t("Please select a delivery time slot and add a comment with the necessary delivery information.", "Veuillez sélectionner un créneau de livraison et ajouter un commentaire avec les informations nécessaires."),'''),
('''          title: "Date fully booked",
          description:
            "This date has reached the maximum number of orders. Please select another date.",''',
 '''          title: t("Date fully booked", "Date complète"),
          description: t(
            "This date has reached the maximum number of orders. Please select another date.",
            "Cette date a atteint le nombre maximum de commandes. Veuillez choisir une autre date."),'''),
('''        title: "Panier vide",
        description: "Ajoutez au moins un gâteau avant de procéder au paiement.",''',
 '''        title: t("Empty cart", "Panier vide"),
        description: t("Please add at least one cake before proceeding to payment.", "Ajoutez au moins un gâteau avant de procéder au paiement."),'''),
('''        title: "Erreur",
        description:
          err instanceof Error
            ? err.message
            : "Une erreur inattendue est survenue.",''',
 '''        title: t("Error", "Erreur"),
        description:
          err instanceof Error
            ? err.message
            : t("An unexpected error occurred.", "Une erreur inattendue est survenue."),'''),
]
for a, b in T:
    rep(a, b)

# ---------------------------------------------------------------- JSX
J = [
('''          Back to Cart
        </Link>''',
 '''          {t("Back to Cart", "Retour au panier")}
        </Link>'''),
('''            Contact Information
          </h2>''',
 '''            {t("Contact Information", "Coordonnées")}
          </h2>'''),
('''                Votre panier est vide. Ajoutez un gâteau avant de procéder au paiement.''',
 '''                {t("Your cart is empty. Please add a cake before proceeding to payment.", "Votre panier est vide. Ajoutez un gâteau avant de procéder au paiement.")}'''),
('''                  <Link to="/cart">Aller au panier</Link>''',
 '''                  <Link to="/cart">{t("Go to cart", "Aller au panier")}</Link>'''),
('''                  <Link to="/catalog">Voir le catalogue</Link>''',
 '''                  <Link to="/catalog">{t("View the catalogue", "Voir le catalogue")}</Link>'''),
('''                  First Name <span className="text-destructive">*</span>''',
 '''                  {t("First Name", "Prénom")} <span className="text-destructive">*</span>'''),
('''                  placeholder="Enter your first name"''',
 '''                  placeholder={t("Enter your first name", "Saisissez votre prénom")}'''),
('''                  Last Name <span className="text-destructive">*</span>''',
 '''                  {t("Last Name", "Nom")} <span className="text-destructive">*</span>'''),
('''                  placeholder="Enter your last name"''',
 '''                  placeholder={t("Enter your last name", "Saisissez votre nom")}'''),
('''                Phone Number <span className="text-destructive">*</span>''',
 '''                {t("Phone Number", "Numéro de téléphone")} <span className="text-destructive">*</span>'''),
('''                placeholder="Enter your email address"''',
 '''                placeholder={t("Enter your email address", "Saisissez votre adresse e-mail")}'''),
('''              <Label>Pick-up / Delivery Date</Label>''',
 '''              <Label>{t("Pick-up / Delivery Date", "Date de retrait / livraison")}</Label>'''),
('''                      <span>Pick a date</span>''',
 '''                      <span>{t("Pick a date", "Choisir une date")}</span>'''),
('''              <Label>Delivery Option</Label>''',
 '''              <Label>{t("Delivery Option", "Mode de réception")}</Label>'''),
('''                    <span className="font-medium">Pick-up</span>
                    <p className="text-sm text-muted-foreground">
                      Pick up your order at our store
                    </p>''',
 '''                    <span className="font-medium">{t("Pick-up", "Retrait")}</span>
                    <p className="text-sm text-muted-foreground">
                      {t("Pick up your order at our store", "Retirez votre commande à notre boutique")}
                    </p>'''),
('''                    <span className="font-medium">Delivery</span>
                    <p className="text-sm text-muted-foreground">
                      We deliver to your address
                    </p>''',
 '''                    <span className="font-medium">{t("Delivery", "Livraison")}</span>
                    <p className="text-sm text-muted-foreground">
                      {t("We deliver to your address", "Nous livrons à votre adresse")}
                    </p>'''),
('''                <Label>Pick-up Time <span className="text-destructive">*</span></Label>''',
 '''                <Label>{t("Pick-up Time", "Heure de retrait")} <span className="text-destructive">*</span></Label>'''),
('''                    <SelectValue placeholder="Select a pickup time" />''',
 '''                    <SelectValue placeholder={t("Select a pickup time", "Choisir une heure de retrait")} />'''),
('''                <h3 className="font-medium text-foreground">Delivery Details</h3>''',
 '''                <h3 className="font-medium text-foreground">{t("Delivery Details", "Détails de la livraison")}</h3>'''),
('''                  <Label htmlFor="deliveryAddress">Delivery Address</Label>''',
 '''                  <Label htmlFor="deliveryAddress">{t("Delivery Address", "Adresse de livraison")}</Label>'''),
('''                    placeholder="Enter your full address (e.g., Rue de Carouge 12, 1205 Genève)"''',
 '''                    placeholder={t("Enter your full address (e.g., Rue de Carouge 12, 1205 Genève)", "Saisissez votre adresse complète (ex. Rue de Carouge 12, 1205 Genève)")}'''),
('''                          ✓ {detectedZone.name} detected - Delivery fee: CHF {detectedZone.price}''',
 '''                          ✓ {detectedZone.name} {t("detected - Delivery fee:", "détecté, frais de livraison :")} CHF {detectedZone.price}'''),
('''                          Zone not detected. Please include area name (e.g., Carouge, Champel, Meyrin...)''',
 '''                          {t("Zone not detected. Please include area name (e.g., Carouge, Champel, Meyrin...)", "Zone non détectée. Merci d'indiquer le nom du quartier (ex. Carouge, Champel, Meyrin...)")}'''),
('''                  <Label>Delivery Time Slot <span className="text-destructive">*</span></Label>''',
 '''                  <Label>{t("Delivery Time Slot", "Créneau de livraison")} <span className="text-destructive">*</span></Label>'''),
('''                      <SelectValue placeholder="Select a delivery time slot" />''',
 '''                      <SelectValue placeholder={t("Select a delivery time slot", "Choisir un créneau de livraison")} />'''),
('''                  <Label htmlFor="deliveryComment">Delivery Instructions <span className="text-destructive">*</span></Label>''',
 '''                  <Label htmlFor="deliveryComment">{t("Delivery Instructions", "Instructions de livraison")} <span className="text-destructive">*</span></Label>'''),
('''                    placeholder="e.g., If possible around 14:30, code 4589, apartment 12, 3rd floor..."''',
 '''                    placeholder={t("e.g., If possible around 14:30, code 4589, apartment 12, 3rd floor...", "ex. Si possible vers 14h30, code 4589, appartement 12, 3e étage...")}'''),
('''                    Please include: apartment number, door code, floor, and any delivery instructions.''',
 '''                    {t("Please include: apartment number, door code, floor, and any delivery instructions.", "Merci d'indiquer : le numéro d'appartement, le code d'entrée, l'étage et toute instruction de livraison.")}'''),
('''                <span className="text-muted-foreground">Items ({items.length})</span>''',
 '''                <span className="text-muted-foreground">{t("Items", "Articles")} ({items.length})</span>'''),
('''                            {item.sizeName} {item.shapeName} Cake''',
 '''                            {item.sizeName} {item.shapeName} {t("Cake", "Gâteau")}'''),
('''                            <span>Base ({item.sizeName})</span>''',
 '''                            <span>{t("Base", "Base")} ({item.sizeName})</span>'''),
('''                            <span>Flavour: {item.flavorName}</span>
                            <span>{flavorExtra > 0 ? `+ CHF ${flavorExtra}` : "included"}</span>''',
 '''                            <span>{t("Flavour:", "Parfum :")} {item.flavorName}</span>
                            <span>{flavorExtra > 0 ? `+ CHF ${flavorExtra}` : t("included", "inclus")}</span>'''),
('''                              <span>Design: {item.styleName}</span>
                              <span>{styleExtra > 0 ? `+ CHF ${styleExtra}` : "included"}</span>''',
 '''                              <span>{t("Design:", "Design :")} {item.styleName}</span>
                              <span>{styleExtra > 0 ? `+ CHF ${styleExtra}` : t("included", "inclus")}</span>'''),
('''                          {item.baseColorName && <p>Base Colour: {item.baseColorName}</p>}
                          {item.decorationColorName && <p>Decoration Colour: {item.decorationColorName}</p>}''',
 '''                          {item.baseColorName && <p>{t("Base Colour:", "Couleur de base :")} {item.baseColorName}</p>}
                          {item.decorationColorName && <p>{t("Decoration Colour:", "Couleur de décoration :")} {item.decorationColorName}</p>}'''),
('''                            <p>Text: "{item.cakeText}"{item.textColorName ? ` (${item.textColorName})` : ""}</p>''',
 '''                            <p>{t("Text:", "Texte :")} "{item.cakeText}"{item.textColorName ? ` (${item.textColorName})` : ""}</p>'''),
('''                          {item.ribbonColorName && <p>Ribbon: {item.ribbonColorName}</p>}
                          {item.butterflyColorName && <p>Butterfly: {item.butterflyColorName}</p>}''',
 '''                          {item.ribbonColorName && <p>{t("Ribbon:", "Ruban :")} {item.ribbonColorName}</p>}
                          {item.butterflyColorName && <p>{t("Butterfly:", "Papillon :")} {item.butterflyColorName}</p>}'''),
('''                    Delivery Fee ({detectedZone?.name})''',
 '''                    {t("Delivery Fee", "Frais de livraison")} ({detectedZone?.name})'''),
('''                <span>Total</span>''',
 '''                <span>{t("Total", "Total")}</span>'''),
('''              <h3 className="font-medium text-foreground">Privacy Policy</h3>''',
 '''              <h3 className="font-medium text-foreground">{t("Privacy Policy", "Politique de confidentialité")}</h3>'''),
('''                  I have read and accept the{" "}''',
 '''                  {t("I have read and accept the", "J'ai lu et j'accepte la")}{" "}'''),
('''                    privacy policy
                  </a>''',
 '''                    {t("privacy policy", "politique de confidentialité")}
                  </a>'''),
('''                  Unlock exclusive updates & offers ✨''',
 '''                  {t("Unlock exclusive updates & offers ✨", "Recevez nos actualités et offres exclusives ✨")}'''),
('''              {items.length === 0
                ? "Empty cart"
                : isSubmitting
                  ? "Loading..."
                  : showEmbeddedCheckout
                    ? "Complete payment below"
                    : "Proceed to Payment"}''',
 '''              {items.length === 0
                ? t("Empty cart", "Panier vide")
                : isSubmitting
                  ? t("Loading...", "Chargement...")
                  : showEmbeddedCheckout
                    ? t("Complete payment below", "Finalisez le paiement ci-dessous")
                    : t("Proceed to Payment", "Procéder au paiement")}'''),
('''                Complete Your Payment
              </h3>''',
 '''                {t("Complete Your Payment", "Finalisez votre paiement")}
              </h3>'''),
('''                Please complete your payment below to confirm your order. All transactions are secured by Stripe.''',
 '''                {t("Please complete your payment below to confirm your order. All transactions are secured by Stripe.", "Veuillez finaliser votre paiement ci-dessous pour confirmer votre commande. Toutes les transactions sont sécurisées par Stripe.")}'''),
]
for a, b in J:
    rep(a, b)

tmp = P + ".tmp"
io.open(tmp, "w", encoding="utf-8").write(s)
os.replace(tmp, P)
print("OK, %d -> %d bytes" % (len(orig), len(s)))
