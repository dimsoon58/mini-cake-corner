// French labels of the catalogue colours and text styles, shared by the
// customer catalogue (Catalog.tsx) and the admin production labels — moved
// here unchanged from Catalog.tsx so both read the exact same names.
// Keyed by the English catalogue name (baseColors[].name, textStyles[].name),
// extras by their catalogue id.

export const textStyleFr: Record<string, string> = {
  "Normal": "Normal", "UPPERCASE": "MAJUSCULES", "Cursive": "Cursive",
};
export const colourFr: Record<string, string> = {
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
export const extraNameFr: Record<string, string> = {
  "gold-leaves": "Feuilles d'or",
  "cherries": "Cerises",
  "glitter-cherries": "Cerises pailletées",
  "glitter": "Paillettes",
  "glitter-base": "Glitter Base",
  "glitter-in-the-air": "Paillettes dans l'air",
  "scattered-pearl": "Perles éparpillées",
  "pearl-border": "Bordure de perles (chacune)",
  "retro": "Rétro",
  "ribbons": "Rubans",
  "pearl-number": "Pearl Number",
  "butterfly": "Papillon",
  "sprinkles": "Vermicelles",
  "printed-picture": "Printed Picture",
};
