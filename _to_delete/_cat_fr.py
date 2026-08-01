import io, os, sys, re

P = "/sessions/rcw-01d8yvniirrtjcjqoatid7yj/mnt/mini-cake-corner/src/pages/Catalog.tsx"
s = io.open(P, encoding="utf-8").read()
orig = s

def rep(old, new, n=1):
    global s
    c = s.count(old)
    if c != n:
        print("MISMATCH (%d, expected %d): %r" % (c, n, old[:90]))
        sys.exit(1)
    s = s.replace(old, new)

def repall(old, new):
    global s
    c = s.count(old)
    if c == 0:
        print("MISSING: %r" % old[:90]); sys.exit(1)
    s = s.replace(old, new)
    print("  x%d  %s" % (c, old[:50]))

# ---------------------------------------------------------------- 1. palette
OLD_BASE = '''const baseColors = [
  { id: "white", name: "White", color: "#FFFFFF" },
  { id: "cream", name: "Cream", color: "#FFF8E7" },
  { id: "pastel-pink", name: "Pastel Pink", color: "#FFE4EC" },
  { id: "pink", name: "Pink", color: "#FFC0CB" },
  { id: "dark-red", name: "Red", color: "#DC143C" },
  { id: "burgundy", name: "Burgundy", color: "#800020" },
  { id: "pastel-yellow", name: "Pastel Yellow", color: "#FDFD96" },
  { id: "yellow", name: "Yellow", color: "#FFD700" },
  { id: "orange", name: "Orange", color: "#FFA500" },
  { id: "pastel-orange", name: "Pastel Orange", color: "#FFB347" },
  { id: "mint-green", name: "Mint Green", color: "#B8F5C8" },
  { id: "green", name: "Green", color: "#3CB371" },
  { id: "forest-green", name: "Forest Green", color: "#14532D" },
  { id: "baby-blue", name: "Baby Blue", color: "#D4F1F9" },
  { id: "sky-blue", name: "Sky Blue", color: "#87CEEB" },
  { id: "midnight-blue", name: "Midnight Blue", color: "#191970" },
  { id: "lavender", name: "Lavender", color: "#E6E6FA" },
  { id: "plum", name: "Plum", color: "#8E4585" },
  { id: "light-brown", name: "Light Brown", color: "#C4A484" },
  { id: "dark-brown", name: "Dark Brown", color: "#654321" },
  { id: "black", name: "Black", color: "#000000" },
];'''
NEW_BASE = '''const baseColors = [
  { id: "white", name: "White", color: "#FFFFFF" },
  { id: "cream", name: "Cream", color: "#FFF8E7" },
  { id: "pastel-pink", name: "Pastel Pink", color: "#FFE4EC" },
  { id: "pink", name: "Pink", color: "#FFC0CB" },
  { id: "dark-pink", name: "Dark Pink", color: "#DE4489" },
  { id: "dark-red", name: "Red", color: "#CB2A1D" },
  { id: "burgundy", name: "Burgundy", color: "#800020" },
  { id: "pastel-yellow", name: "Pastel Yellow", color: "#FDFD96" },
  { id: "yellow", name: "Yellow", color: "#FFD700" },
  { id: "pastel-orange", name: "Pastel Orange", color: "#F5BE6A" },
  { id: "orange", name: "Orange", color: "#EE7C3A" },
  { id: "mint-green", name: "Pastel Green", color: "#87C895" },
  { id: "green", name: "Green", color: "#429356" },
  { id: "forest-green", name: "Forest Green", color: "#14532D" },
  { id: "baby-blue", name: "Pastel Blue", color: "#C7E4F8" },
  { id: "sky-blue", name: "Sky Blue", color: "#70B8EC" },
  { id: "blue", name: "Blue", color: "#3C88C9" },
  { id: "midnight-blue", name: "Midnight Blue", color: "#122B6D" },
  { id: "lavender", name: "Lavender", color: "#E6E6FA" },
  { id: "plum", name: "Plum", color: "#8E4585" },
  { id: "light-brown", name: "Light Brown", color: "#C4A484" },
  { id: "dark-brown", name: "Dark Brown", color: "#654321" },
  { id: "black", name: "Black", color: "#000000" },
];'''
rep(OLD_BASE, NEW_BASE)

# ---------------------------------------------------------- 2. extra FR maps
ANCHOR = '''const textStyleFr: Record<string, string> = {
  "Normal": "Normal", "UPPERCASE": "MAJUSCULES", "Cursive": "Cursive",
};'''
EXTRA_MAPS = ANCHOR + '''
const colourFr: Record<string, string> = {
  "White": "Blanc",
  "Cream": "Crème",
  "Pastel Pink": "Rose Pastel",
  "Pink": "Rose",
  "Baby Pink": "Rose Bébé",
  "Dark Pink": "Rose Foncé",
  "Red": "Rouge",
  "Wine Red": "Rouge Vin",
  "Burgundy": "Bordeaux",
  "Pastel Yellow": "Jaune Pastel",
  "Yellow": "Jaune",
  "Pastel Orange": "Orange Pastel",
  "Orange": "Orange",
  "Pastel Green": "Vert Pastel",
  "Green": "Vert",
  "Forest Green": "Vert Forêt",
  "Pastel Blue": "Bleu Pastel",
  "Sky Blue": "Bleu Ciel",
  "Blue": "Bleu",
  "Midnight Blue": "Bleu Nuit",
  "Lavender": "Lavande",
  "Plum": "Prune",
  "Light Brown": "Brun Clair",
  "Dark Brown": "Brun Foncé",
  "Black": "Noir",
  "Gold": "Or",
};
const candleNameFr: Record<string, string> = {
  "blue-ombre": "Dégradé bleu",
  "thick-spiral": "Spirale épaisse",
  "shiny-spiral": "Spirale brillante",
  "spiral-pastel": "Spirale pastel",
  "rainbow": "Arc-en-ciel",
  "pink-ombre": "Dégradé rose",
  "daisy": "Marguerite",
  "heart": "Cœur rouge",
  "puppy": "Chiot",
  "teddy-bear": "Nounours",
  "cherry": "Cerise",
  "ribbon": "Ruban",
  "soccer": "Ballon de foot",
  "pink-car": "Voiture rose",
  "red-car": "Voiture rouge",
  "blue-car": "Voiture bleue",
  "yellow-car": "Voiture jaune",
};
const extraDescFr: Record<string, string> = {
  "cherries": "Des cerises confites posées sur le gâteau.",
  "glitter-cherries": "Des cerises confites recouvertes de paillettes comestibles.",
  "sprinkles": "De petits vermicelles colorés parsemés sur le gâteau.",
  "gold-leaves": "De petits morceaux de feuille d'or comestible pour une touche de luxe.",
  "heart": "Des cœurs pochés sur le gâteau.",
  "ribbons": "Des rubans de satin décoratifs placés autour du gâteau.",
  "retro": "Un pochage de gâteau vintage.",
  "butterfly": "Des papillons comestibles posés sur le gâteau.",
  "scattered-pearl": "De petites perles comestibles éparpillées sur le gâteau.",
  "pearl-border": "Une bordure composée de petites perles comestibles.",
  "pearl-number": "Un chiffre réalisé avec des perles comestibles.",
  "glitter": "Des paillettes comestibles parsemées sur tout le gâteau pour un effet scintillant.",
  "glitter-base": "Des paillettes recouvrant le dessus du gâteau.",
  "glitter-in-the-air": "Soufflez sur le gâteau et les paillettes s'envolent.",
  "drawing": "Un dessin réalisé à la main sur le gâteau.",
  "printed-picture": "Une image imprimée comestible posée sur le gâteau.",
};'''
rep(ANCHOR, EXTRA_MAPS)

# ------------------------------------------------------------- 3. colour names
repall(">{color.name}</span>", ">{t(color.name, colourFr[color.name] ?? color.name)}</span>")

# ------------------------------------------------------------- 4. page header
rep('''          Get inspired by our signature cake designs, choose your favourite, then personalise it with your preferred size, flavour, colours and message to create a cake that's uniquely yours.''',
    '''          {t("Get inspired by our signature cake designs, choose your favourite, then personalise it with your preferred size, flavour, colours and message to create a cake that's uniquely yours.", "Laissez-vous inspirer par nos créations signature, choisissez votre préférée, puis personnalisez-la avec la taille, le parfum, les couleurs et le message de votre choix pour créer un gâteau qui vous ressemble.")}''')

rep('''                  {collection.title}''',
    '''                  {t(collection.title, collectionTitleFr[collection.title] ?? collection.title)}''')

rep('''                          Best Seller''',
    '''                          {t("Best Seller", "Best-seller")}''')

rep('''                          {cake.name}
                        </h3>''',
    '''                          {t(cake.name, cakeNameFr[cake.id] ?? cake.name)}
                        </h3>''')

rep('''                          {cake.description}''',
    '''                          {t(cake.description, cakeDescFr[cake.id] ?? cake.description)}''')

rep('''                            CHOOSE THIS STYLE''',
    '''                            {t("CHOOSE THIS STYLE", "CHOISIR CE STYLE")}''')

rep('''              CUSTOM REQUEST''',
    '''              {t("CUSTOM REQUEST", "DEMANDE SUR MESURE")}''')

rep('''                Can't find what you're looking for?''',
    '''                {t("Can't find what you're looking for?", "Vous ne trouvez pas ce que vous cherchez ?")}''')

rep('''                Every cake in our collections can be personalised, but if you're
                dreaming of something completely different, we'd love to create a
                fully bespoke design just for you. Tell us about your idea, your
                colours and your occasion, and we'll bring it to life.''',
    '''                {t("Every cake in our collections can be personalised, but if you're dreaming of something completely different, we'd love to create a fully bespoke design just for you. Tell us about your idea, your colours and your occasion, and we'll bring it to life.", "Tous les gâteaux de nos collections peuvent être personnalisés, mais si vous rêvez de quelque chose de complètement différent, nous serions ravies de créer un modèle entièrement sur mesure rien que pour vous. Parlez-nous de votre idée, de vos couleurs et de votre occasion, et nous lui donnerons vie.")}''')

rep('''                Please note: We aim to respond within 48 hours. For the best availability, please submit your request at least one week before your desired date.''',
    '''                {t("Please note: We aim to respond within 48 hours. For the best availability, please submit your request at least one week before your desired date.", "À noter : nous nous efforçons de répondre sous 48 heures. Pour une meilleure disponibilité, merci d'envoyer votre demande au moins une semaine avant la date souhaitée.")}''')

rep('''                  REQUEST A CUSTOM CAKE''',
    '''                  {t("REQUEST A CUSTOM CAKE", "DEMANDER UN GÂTEAU SUR MESURE")}''')

# ------------------------------------------------------------- 5. sheet header
rep('''              {selectedCake?.name}
            </SheetTitle>''',
    '''              {selectedCake ? t(selectedCake.name, cakeNameFr[selectedCake.id] ?? selectedCake.name) : ""}
            </SheetTitle>''')

rep('''              Customise your cake options''',
    '''              {t("Customise your cake options", "Personnalisez les options de votre gâteau")}''')

# ------------------------------------------------------------- 6. pickup date
rep('''                  Pickup Date <span className="text-destructive">*</span>''',
    '''                  {t("Pickup Date", "Date de retrait")} <span className="text-destructive">*</span>''')
rep('''<p className="text-xs max-w-[200px]">Order preparation date (minimum 4 days in advance)</p>''',
    '''<p className="text-xs max-w-[200px]">{t("Order preparation date (minimum 4 days in advance)", "Date de préparation de la commande (minimum 4 jours à l'avance)")}</p>''')
rep('''                        <span>Pick a date</span>''',
    '''                        <span>{t("Pick a date", "Choisir une date")}</span>''')

# ------------------------------------------------------------- 7. size
rep('''                  Size <span className="text-destructive">*</span>''',
    '''                  {t("Size", "Taille")} <span className="text-destructive">*</span>''')
rep('''                      <p className="text-xs max-w-[200px]">Choose the size of your cake.</p>''',
    '''                      <p className="text-xs max-w-[200px]">{t("Choose the size of your cake.", "Choisissez la taille de votre gâteau.")}</p>''')
rep('''<SelectValue placeholder="Select size" />''',
    '''<SelectValue placeholder={t("Select size", "Choisir une taille")} />''')
rep('''                          <span>{size.name} - CHF {size.price}</span>''',
    '''                          <span>{t(size.name, sizeNameFr[size.id] ?? size.name)} - CHF {size.price}</span>''')

# ------------------------------------------------------------- 8. shape
rep('''                  Shape <span className="text-destructive">*</span>''',
    '''                  {t("Shape", "Forme")} <span className="text-destructive">*</span>''')
rep('''<TooltipContent><p className="text-xs max-w-[200px]">Choose the shape of your cake.</p></TooltipContent>''',
    '''<TooltipContent><p className="text-xs max-w-[200px]">{t("Choose the shape of your cake.", "Choisissez la forme de votre gâteau.")}</p></TooltipContent>''')
rep('''<SelectValue placeholder="Select shape" />''',
    '''<SelectValue placeholder={t("Select shape", "Choisir une forme")} />''')
rep('''                          {shape.name} {extra > 0 ? `(+CHF ${extra})` : ""}''',
    '''                          {t(shape.name, shapeNameFr[shape.id] ?? shape.name)} {extra > 0 ? `(+CHF ${extra})` : ""}''')

# ------------------------------------------------------------- 9. flavour
rep('''                  Flavour <span className="text-destructive">*</span>''',
    '''                  {t("Flavour", "Parfum")} <span className="text-destructive">*</span>''')
rep('''<TooltipContent><p className="text-xs max-w-[200px]">Please select the flavour of your cake.</p></TooltipContent>''',
    '''<TooltipContent><p className="text-xs max-w-[200px]">{t("Please select the flavour of your cake.", "Veuillez sélectionner le parfum de votre gâteau.")}</p></TooltipContent>''')
rep('''<SelectValue placeholder="Select flavour" />''',
    '''<SelectValue placeholder={t("Select flavour", "Choisir un parfum")} />''')
rep('''                            <span>{flavor.name} {extra > 0 ? `(+CHF ${extra})` : ""}</span>''',
    '''                            <span>{t(flavor.name, flavorNameFr[flavor.id] ?? flavor.name)} {extra > 0 ? `(+CHF ${extra})` : ""}</span>''')
rep('''                                <p><span className="font-medium">Contains:</span> Eggs, Milk</p>
                                <p><span className="font-medium">May contain:</span> Gluten, Nuts</p>
                                <p className="text-muted-foreground/70 italic">Prepared in a kitchen that processes gluten.</p>''',
    '''                                <p><span className="font-medium">{t("Contains:", "Contient :")}</span> {t("Eggs, Milk", "Œufs, lait")}</p>
                                <p><span className="font-medium">{t("May contain:", "Peut contenir :")}</span> {t("Gluten, Nuts", "Gluten, fruits à coque")}</p>
                                <p className="text-muted-foreground/70 italic">{t("Prepared in a kitchen that processes gluten.", "Préparé dans une cuisine qui manipule du gluten.")}</p>''')
rep('''                                Contains: {info.contains}''',
    '''                                {t("Contains:", "Contient :")} {info.contains}''')

# ------------------------------------------------------------- 10. design
rep('''                  Design
                  <Tooltip>''',
    '''                  {t("Design", "Design")}
                  <Tooltip>''')
rep('''<p className="text-xs max-w-[220px]">You can select any design. You can also add extras and/or inspiration pictures in the next steps.</p>''',
    '''<p className="text-xs max-w-[220px]">{t("You can select any design. You can also add extras and/or inspiration pictures in the next steps.", "Vous pouvez choisir n'importe quel design. Vous pourrez aussi ajouter des extras et/ou des photos d'inspiration aux étapes suivantes.")}</p>''')
rep('''                  <p className="font-medium text-foreground">{selectedCake.styleName}</p>''',
    '''                  <p className="font-medium text-foreground">{t(selectedCake.styleName, styleNameFr[selectedCake.styleId] ?? selectedCake.styleName)}</p>''')
rep('''                  <label className="text-sm font-medium text-foreground">Choose your preferred design</label>''',
    '''                  <label className="text-sm font-medium text-foreground">{t("Choose your preferred design", "Choisissez votre design préféré")}</label>''')

# ------------------------------------------------------------- 11. base colour
rep('''                  Base Colour <span className="text-destructive">*</span>''',
    '''                  {t("Base Colour", "Couleur de base")} <span className="text-destructive">*</span>''')
rep('''<TooltipContent><p className="text-xs max-w-[200px]">The base colour is essential to personalise your cake.</p></TooltipContent>''',
    '''<TooltipContent><p className="text-xs max-w-[200px]">{t("The base colour is essential to personalise your cake.", "La couleur de base est essentielle pour personnaliser votre gâteau.")}</p></TooltipContent>''')
repall('''<span>⚠️</span> We recommend choosing light colours, as dark colours may temporarily stain lips.''',
       '''<span>⚠️</span> {t("We recommend choosing light colours, as dark colours may temporarily stain lips.", "Nous vous recommandons de choisir des couleurs claires, car les couleurs foncées peuvent temporairement colorer les lèvres.")}''')

# --------------------------------------------------------- 12. secondary colours
rep('''                  {colorCfg.secondaryLabel} <span className="text-destructive cursor-help">''',
    '''                  {t(colorCfg.secondaryLabel, secondaryLabelFr[colorCfg.secondaryLabel] ?? colorCfg.secondaryLabel)} <span className="text-destructive cursor-help">''')
rep('''<TooltipContent><p className="text-xs max-w-[200px]">Select up to {maxColors} {maxColors === 1 ? "colour" : "colours"} for your design.</p></TooltipContent>''',
    '''<TooltipContent><p className="text-xs max-w-[200px]">{t(`Select up to ${maxColors} ${maxColors === 1 ? "colour" : "colours"} for your design.`, `Sélectionnez jusqu'à ${maxColors} ${maxColors === 1 ? "couleur" : "couleurs"} pour votre design.`)}</p></TooltipContent>''')
rep('''<TooltipContent><p className="text-xs max-w-[200px]">Choose the colours for this part of your cake.</p></TooltipContent>''',
    '''<TooltipContent><p className="text-xs max-w-[200px]">{t("Choose the colours for this part of your cake.", "Choisissez les couleurs pour cette partie de votre gâteau.")}</p></TooltipContent>''')
rep('''                  You can choose up to {maxColors} colours. You can also explain how you would like them to be arranged in the comment section.''',
    '''                  {t(`You can choose up to ${maxColors} colours. You can also explain how you would like them to be arranged in the comment section.`, `Vous pouvez choisir jusqu'à ${maxColors} couleurs. Vous pouvez aussi préciser dans la zone de commentaire comment vous souhaitez qu'elles soient disposées.`)}''')
rep('''<p className="text-xs text-primary font-medium">{selections.decorationColors.length}/{maxColors} colours selected</p>''',
    '''<p className="text-xs text-primary font-medium">{selections.decorationColors.length}/{maxColors} {t("colours selected", "couleurs sélectionnées")}</p>''')

# ------------------------------------------------------------- 13. roses
rep('''                  Roses Colour <span className="text-destructive">*</span>''',
    '''                  {t("Roses Colour", "Couleur des roses")} <span className="text-destructive">*</span>''')
rep('''<TooltipContent><p className="text-xs max-w-[200px]">Choose one colour for the piped roses.</p></TooltipContent>''',
    '''<TooltipContent><p className="text-xs max-w-[200px]">{t("Choose one colour for the piped roses.", "Choisissez une couleur pour les roses pochées.")}</p></TooltipContent>''')

# ------------------------------------------------------------- 14. rainbow borders
rep('''                    { key: "borderTopColor", label: "Top Border Colour" },
                    { key: "borderBottomColor", label: "Bottom Border Colour" },''',
    '''                    { key: "borderTopColor", label: t("Top Border Colour", "Couleur de la bordure du haut") },
                    { key: "borderBottomColor", label: t("Bottom Border Colour", "Couleur de la bordure du bas") },''')

# ------------------------------------------------------------- 15. text
rep('''                  Add Text
                  <Tooltip>''',
    '''                  {t("Add Text", "Ajouter un texte")}
                  <Tooltip>''')
rep('''<p className="text-xs max-w-[220px]">If you would like to add text, you can choose the typography.</p>''',
    '''<p className="text-xs max-w-[220px]">{t("If you would like to add text, you can choose the typography.", "Si vous souhaitez ajouter un texte, vous pouvez choisir la typographie.")}</p>''')
rep('''                    No Text
                  </button>''',
    '''                    {t("No Text", "Sans texte")}
                  </button>''')
rep('''                    Add Text
                  </button>''',
    '''                    {t("Add Text", "Ajouter un texte")}
                  </button>''')
rep('''                    <label className="text-sm font-medium text-foreground">Text Style</label>''',
    '''                    <label className="text-sm font-medium text-foreground">{t("Text Style", "Style du texte")}</label>''')
rep('''                          {style.name}''',
    '''                          {t(style.name, textStyleFr[style.name] ?? style.name)}''')
rep('''                    <label className="text-sm font-medium text-foreground">Your Message</label>''',
    '''                    <label className="text-sm font-medium text-foreground">{t("Your Message", "Votre message")}</label>''')
rep('''                      placeholder="e.g., Happy Birthday!"''',
    '''                      placeholder={t("e.g., Happy Birthday!", "ex. Joyeux anniversaire !")}''')
rep('''                        <p className="text-xs text-muted-foreground mb-1">Preview:</p>''',
    '''                        <p className="text-xs text-muted-foreground mb-1">{t("Preview:", "Aperçu :")}</p>''')
rep('''                    <label className="text-sm font-medium text-foreground">Text Colour</label>''',
    '''                    <label className="text-sm font-medium text-foreground">{t("Text Colour", "Couleur du texte")}</label>''')

# ------------------------------------------------------------- 16. extras
rep('''                  ✨ Extra
                  <Tooltip>''',
    '''                  ✨ {t("Extra", "Extras")}
                  <Tooltip>''')
rep('''<p className="text-xs max-w-[220px]">You can add any additional elements to personalise your design.</p>''',
    '''<p className="text-xs max-w-[220px]">{t("You can add any additional elements to personalise your design.", "Vous pouvez ajouter tous les éléments supplémentaires que vous souhaitez pour personnaliser votre design.")}</p>''')
rep('''<p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{group.label}</p>''',
    '''<p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t(group.label, groupLabelFr[group.label] ?? group.label)}</p>''')
rep('''{extra.id === "pearl-border" && selectedCake?.styleId === "retro-ribbons-glitter" ? "Full border of pearls" : extra.name}''',
    '''{extra.id === "pearl-border" && selectedCake?.styleId === "retro-ribbons-glitter" ? t("Full border of pearls", "Bordure complète de perles") : t(extra.name, extraNameFr[extra.id] ?? extra.name)}''')
rep('''                                        <p className="text-xs max-w-[200px]">{extraDescriptions[extra.id]}</p>''',
    '''                                        <p className="text-xs max-w-[200px]">{t(extraDescriptions[extra.id], extraDescFr[extra.id] ?? extraDescriptions[extra.id])}</p>''')

rep('''<p className="text-xs font-medium text-foreground">Glitter Colour <span className="text-destructive">*</span></p>''',
    '''<p className="text-xs font-medium text-foreground">{t("Glitter Colour", "Couleur des paillettes")} <span className="text-destructive">*</span></p>''')
rep('''<p className="text-xs font-medium text-foreground">Glitter Cherries Colour</p>''',
    '''<p className="text-xs font-medium text-foreground">{t("Glitter Cherries Colour", "Couleur des cerises pailletées")}</p>''')
rep('''<p className="text-xs font-medium text-foreground">Ribbon Colour <span className="text-destructive">*</span></p>''',
    '''<p className="text-xs font-medium text-foreground">{t("Ribbon Colour", "Couleur des rubans")} <span className="text-destructive">*</span></p>''')
rep('''<p className="text-xs font-medium text-foreground">Butterfly Colour <span className="text-destructive">*</span></p>''',
    '''<p className="text-xs font-medium text-foreground">{t("Butterfly Colour", "Couleur du papillon")} <span className="text-destructive">*</span></p>''')

# --------------------------------------------------------- 17. printed picture
rep('''                  <label className="text-sm font-medium text-foreground">Upload Your Image</label>
                  <p className="text-xs text-muted-foreground">
                    Upload the image or logo you want printed on your cake (JPG, PNG, WEBP)
                  </p>''',
    '''                  <label className="text-sm font-medium text-foreground">{t("Upload Your Image", "Téléchargez votre image")}</label>
                  <p className="text-xs text-muted-foreground">
                    {t("Upload the image or logo you want printed on your cake (JPG, PNG, WEBP)", "Téléchargez l'image ou le logo que vous souhaitez faire imprimer sur votre gâteau (JPG, PNG, WEBP)")}
                  </p>''')
rep('''                      <span className="text-sm text-muted-foreground">Click to upload image</span>''',
    '''                      <span className="text-sm text-muted-foreground">{t("Click to upload image", "Cliquez pour télécharger une image")}</span>''')

# ------------------------------------------------------------- 18. comment
rep('''                  💬 Comment
                  <Tooltip>''',
    '''                  💬 {t("Comment", "Commentaire")}
                  <Tooltip>''')
rep('''<p className="text-xs max-w-[240px]">Write any guidelines you would like to clarify. Please note that if you request decorations or extras that were not selected, the price may change.</p>''',
    '''<p className="text-xs max-w-[240px]">{t("Write any guidelines you would like to clarify. Please note that if you request decorations or extras that were not selected, the price may change.", "Notez toutes les précisions que vous souhaitez apporter. Veuillez noter que si vous demandez des décorations ou des extras qui n'ont pas été sélectionnés, le prix peut changer.")}</p>''')
rep('''                  placeholder="Any special requests or details about your cake..."''',
    '''                  placeholder={t("Any special requests or details about your cake...", "Toute demande particulière ou tout détail concernant votre gâteau...")}''')
rep('''                    Upload
                    <Tooltip>''',
    '''                    {t("Upload", "Télécharger")}
                    <Tooltip>''')
rep('''<TooltipContent><p className="text-xs max-w-[200px]">Upload an inspiration picture if you would like.</p></TooltipContent>''',
    '''<TooltipContent><p className="text-xs max-w-[200px]">{t("Upload an inspiration picture if you would like.", "Téléchargez une photo d'inspiration si vous le souhaitez.")}</p></TooltipContent>''')
rep('''                    Upload reference images (max 5, 5 MB per image, JPG, PNG, WEBP)''',
    '''                    {t("Upload reference images (max 5, 5 MB per image, JPG, PNG, WEBP)", "Téléchargez des images de référence (max. 5, 5 Mo par image, JPG, PNG, WEBP)")}''')
rep('''                      <span className="text-xs text-muted-foreground">Click to upload images</span>''',
    '''                      <span className="text-xs text-muted-foreground">{t("Click to upload images", "Cliquez pour télécharger des images")}</span>''')
rep('''                        When a client provides an inspiration photo, it is for reference only. Bento Cake Studio SNC will create a design inspired by it and aim to respect the colours and style, but an identical reproduction is not guaranteed.''',
    '''                        {t("When a client provides an inspiration photo, it is for reference only. Bento Cake Studio SNC will create a design inspired by it and aim to respect the colours and style, but an identical reproduction is not guaranteed.", "Lorsqu'une cliente fournit une photo d'inspiration, celle-ci sert uniquement de référence. Bento Cake Studio SNC créera un design inspiré de cette photo en veillant à en respecter les couleurs et le style, mais une reproduction à l'identique n'est pas garantie.")}''')

# ------------------------------------------------------------- 19. candles
rep('''                <label className="text-sm font-medium text-foreground">🕯️ Candles (Optional)</label>''',
    '''                <label className="text-sm font-medium text-foreground">🕯️ {t("Candles (Optional)", "Bougies (optionnel)")}</label>''')
rep('''                            <p className="text-xs font-medium text-foreground">{candle.name}</p>''',
    '''                            <p className="text-xs font-medium text-foreground">{t(candle.name, candleNameFr[candle.id] ?? candle.name)}</p>''')
rep('''                              <p className="text-[10px] text-muted-foreground mb-1">CHF {candle.unitPrice}/pièce · Pack {candle.packSize} = CHF {candle.packPrice}</p>''',
    '''                              <p className="text-[10px] text-muted-foreground mb-1">CHF {candle.unitPrice}{t("/ea", "/pièce")} · {t("Pack", "Pack")} {candle.packSize} = CHF {candle.packPrice}</p>''')
rep('''                              <p className="text-[10px] text-muted-foreground mb-1">CHF {candle.unitPrice} / pièce</p>''',
    '''                              <p className="text-[10px] text-muted-foreground mb-1">CHF {candle.unitPrice} {t("each", "/ pièce")}</p>''')
rep('''                              <p className="text-[10px] text-primary font-semibold mt-1">✓ Pack appliqué</p>''',
    '''                              <p className="text-[10px] text-primary font-semibold mt-1">✓ {t("Pack applied", "Pack appliqué")}</p>''')
rep('''                    <>See less <ChevronUp className="w-3 h-3" /></>
                  ) : (
                    <>See more <ChevronDown className="w-3 h-3" /></>''',
    '''                    <>{t("See less", "Voir moins")} <ChevronUp className="w-3 h-3" /></>
                  ) : (
                    <>{t("See more", "Voir plus")} <ChevronDown className="w-3 h-3" /></>''')

# ------------------------------------------------------------- 20. total / CTA
rep('''                <span className="font-medium text-foreground">Total</span>''',
    '''                <span className="font-medium text-foreground">{t("Total", "Total")}</span>''')
rep('''                Add to Cart
              </Button>''',
    '''                {t("Add to Cart", "Ajouter au panier")}
              </Button>''')

# ------------------------------------------------------------- 21. toasts
rep('''        title: "Maximum 5 images",
        description: "You have already reached the maximum number of reference images.",''',
    '''        title: t("Maximum 5 images", "Maximum 5 images"),
        description: t("You have already reached the maximum number of reference images.", "Vous avez déjà atteint le nombre maximum d'images de référence."),''')
rep('''        title: "File too large",
        description: `Each image must be under 5 MB. ${oversizedFiles.length} file(s) exceeded the limit.`,''',
    '''        title: t("File too large", "Fichier trop volumineux"),
        description: t(`Each image must be under 5 MB. ${oversizedFiles.length} file(s) exceeded the limit.`, `Chaque image doit faire moins de 5 Mo. ${oversizedFiles.length} fichier(s) dépassent la limite.`),''')
rep('''      title: `${accepted.length} image${accepted.length > 1 ? "s" : ""} added ✓`,
      description: rejected > 0
        ? `${rejected} image(s) ignored (max 5 reached).`
        : `${selections.commentImages.length + accepted.length}/5 reference images.`,''',
    '''      title: t(`${accepted.length} image${accepted.length > 1 ? "s" : ""} added ✓`, `${accepted.length} image${accepted.length > 1 ? "s" : ""} ajoutée${accepted.length > 1 ? "s" : ""} ✓`),
      description: rejected > 0
        ? t(`${rejected} image(s) ignored (max 5 reached).`, `${rejected} image(s) ignorée(s) (maximum de 5 atteint).`)
        : t(`${selections.commentImages.length + accepted.length}/5 reference images.`, `${selections.commentImages.length + accepted.length}/5 images de référence.`),''')

TOASTS = [
 ('title: "Date required", description: "Please select a pickup/delivery date."',
  'title: t("Date required", "Date requise"), description: t("Please select a pickup/delivery date.", "Veuillez sélectionner une date de retrait ou de livraison.")'),
 ('title: "Base Colour required", description: "Please select a base colour for your cake."',
  'title: t("Base Colour required", "Couleur de base requise"), description: t("Please select a base colour for your cake.", "Veuillez sélectionner une couleur de base pour votre gâteau.")'),
 ('title: `${cfg.secondaryLabel} required`, description: `Please select at least one colour for your cake.`',
  'title: t(`${cfg.secondaryLabel} required`, `${secondaryLabelFr[cfg.secondaryLabel] ?? cfg.secondaryLabel} requise`), description: t("Please select at least one colour for your cake.", "Veuillez sélectionner au moins une couleur pour votre gâteau.")'),
 ('title: "Border colours required", description: "Please choose a top and a bottom border colour."',
  'title: t("Border colours required", "Couleurs de bordure requises"), description: t("Please choose a top and a bottom border colour.", "Veuillez choisir une couleur de bordure pour le haut et pour le bas.")'),
 ('title: "Rose Color required", description: "Please select a colour for your roses."',
  'title: t("Roses Colour required", "Couleur des roses requise"), description: t("Please select a colour for your roses.", "Veuillez sélectionner une couleur pour vos roses.")'),
 ('title: "Text Colour required", description: "Please select a colour for your text."',
  'title: t("Text Colour required", "Couleur du texte requise"), description: t("Please select a colour for your text.", "Veuillez sélectionner une couleur pour votre texte.")'),
 ('title: "Text message required", description: "Please enter your message."',
  'title: t("Text message required", "Message requis"), description: t("Please enter your message.", "Veuillez saisir votre message.")'),
 ('title: "Image required", description: "Please upload an image for your printed picture cake."',
  'title: t("Image required", "Image requise"), description: t("Please upload an image for your printed picture cake.", "Veuillez télécharger une image pour votre gâteau avec photo imprimée.")'),
 ('title: "Glitter Colour required", description: "Please select a colour for your glitter."',
  'title: t("Glitter Colour required", "Couleur des paillettes requise"), description: t("Please select a colour for your glitter.", "Veuillez sélectionner une couleur pour vos paillettes.")'),
 ('title: "Glitter Cherries Colour required", description: "Please select a colour for your glitter cherries."',
  'title: t("Glitter Cherries Colour required", "Couleur des cerises pailletées requise"), description: t("Please select a colour for your glitter cherries.", "Veuillez sélectionner une couleur pour vos cerises pailletées.")'),
 ('title: "Ribbon Colour required", description: "Please select a colour for your ribbons."',
  'title: t("Ribbon Colour required", "Couleur des rubans requise"), description: t("Please select a colour for your ribbons.", "Veuillez sélectionner une couleur pour vos rubans.")'),
 ('title: "Butterfly Colour required", description: "Please select a colour for your butterfly."',
  'title: t("Butterfly Colour required", "Couleur du papillon requise"), description: t("Please select a colour for your butterfly.", "Veuillez sélectionner une couleur pour votre papillon.")'),
]
for a, b in TOASTS:
    rep(a, b)

# ------------------------------------------------------- 22. inspiration deep link
rep('''      name: `Inspiration Cake #${index + 1}`,
      description: "Based on the inspiration photo you selected",''',
    '''      name: t(`Inspiration Cake #${index + 1}`, `Gâteau d'inspiration n°${index + 1}`),
      description: t("Based on the inspiration photo you selected", "D'après la photo d'inspiration que vous avez sélectionnée"),''')

tmp = P + ".tmp"
io.open(tmp, "w", encoding="utf-8").write(s)
os.replace(tmp, P)
print("OK, %d -> %d bytes" % (len(orig), len(s)))
