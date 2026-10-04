// Caractéristiques de référence des photos d'inspiration (dictée du
// 2026-10-04), pour la préparation et les étiquettes de production.
//
// * Clé = identifiant enregistré dans la commande (order_items.design =
//   « inspiration-N »), qui n'est PAS la position dans la galerie : la
//   position (« Inspiration Cake #3 ») est rappelée dans `position` et
//   vérifiée par les tests contre src/data/inspirations.ts.
// * Les 82 lignes ont été comparées une à une aux photos (aucun décalage).
// * Ce sont des valeurs de RÉFÉRENCE : elles ne remplacent jamais un choix
//   enregistré dans la commande ; l'étiquette ne les affiche (« réf. ») que
//   là où la commande n'a rien.
// * null = non précisé dans la dictée (rien n'est inventé). `toCheck` liste
//   ce qui reste à vérifier.
// * Noms de design : ceux du catalogue (src/data/customization.ts) quand la
//   photo le confirme — « Headband » = Heart Bomb (cœurs dispersés),
//   « Shaker » = Shag Cake, « Rose Splice / Rose Spruce » = Roses Please
//   (roses pochées), « headboarder » (#15) = Normal with border.

export interface InspirationReference {
  position: number;            // n° dans la galerie (« Inspiration Cake #N »)
  design: string | null;       // design(s), noms du catalogue quand vérifiés
  base: string | null;         // couleur de base
  decoration: string | null;   // couleurs de décoration
  extras: string[];            // cerises, perles, rubans, fleurs, paillettes…
  writingColour: string | null;
  writingStyle: string | null;
  toCheck: string[];
}

type Row = [position: number, id: string, design: string | null, base: string | null, decoration: string | null, extras: string[], writingColour: string | null, writingStyle?: string | null, toCheck?: string[]];

const ROWS: Row[] = [
  [1, "inspiration-14", "Retro / Vintage", "Bordeaux", "Bordeaux", ["Cerises pailletées"], null],
  [2, "inspiration-71", "Retro / Vintage", "Bleue", "Rose, orange, bleu, vert", [], "Verte"],
  [3, "inspiration-22", "Pearl Border × Retro", "Rose clair", "Rose foncé", ["Bordure de perles"], "Rose foncé"],
  [4, "inspiration-19", "Roses Please", "Rose", "Rose foncé et rouge", [], "Rouge", null, ["Dictée « Rose Splice » : roses pochées sur la photo → Roses Please"]],
  [5, "inspiration-17", "Heart Bomb", "Blanche", "Rouge", [], "Rouge", null, ["Dictée « Headband » : cœurs dispersés sur la photo → Heart Bomb"]],
  [6, "inspiration-2", "Shag Cake", null, null, [], null, null, ["Couleurs citées sans répartition base / déco : bleu, vert, rose, orange, blanc", "Dictée « Shaker » → Shag Cake (photo)"]],
  [7, "inspiration-81", "Butterfly Garden", "Dégradé bleu et blanc", null, ["Perles", "Papillons"], null],
  [8, "inspiration-13", "Pearl Border × Retro (rétro chic)", "Noire", "Noire", ["Perles blanches"], null],
  [9, "inspiration-1", null, "Verte", "Blanc, vert, rose, bleu", [], "Blanche", null, ["Design non précisé"]],
  [10, "inspiration-3", "Shag Cake", "Bleue", "Orange, rose, bleu", ["Cerises pailletées"], null, null, ["Dictée « Shaker » → Shag Cake (photo)"]],
  [11, "inspiration-4", "Heart Bomb, fleurs à la place des cœurs", "Rose", "Rose", ["Fleurs rouges"], "Rouge", null, ["Dictée « Headband » → Heart Bomb"]],
  [12, "inspiration-6", "Normal without border", "Rouge", null, [], "Blanche"],
  [13, "inspiration-7", null, "Rose", "Rouge", [], null, null, ["Design non précisé"]],
  [14, "inspiration-8", "Heart Bomb", "Blanche", "Rouge", ["Quelques cœurs rouges"], "Rouge", null, ["Confirmé le 2026-10-04 : Heart Bomb, base blanche, déco rouge"]],
  [15, "inspiration-9", "Normal with border + Printed Picture", "Blanche", "Blanche", ["Photo imprimée"], null, null, ["Dictée « headboarder » : bordure pochée sur la photo → Normal with border"]],
  [16, "inspiration-10", "Gold Leaves", "Blanche", null, ["Feuille d'or"], "Rouge"],
  [17, "inspiration-11", "Normal with border + Printed Picture", "Rouge", "Rouge", ["Photo imprimée"], null],
  [18, "inspiration-12", "Sprinkles with Border", "Verte", "Verte", ["Vermicelles"], "Rose foncé"],
  [19, "inspiration-15", "Retro / Vintage + Gold Leaves", "Rose", "Rouge", ["Feuille d'or"], "Rouge"],
  [20, "inspiration-16", "Retro / Vintage", "Noire", "Noire", ["Perles argentées"], null],
  [21, "inspiration-18", "Retro / Vintage", "Violet clair", "Violet foncé et blanc", ["Perles", "Feuille d'or"], null],
  [22, "inspiration-20", "Normal with border", "Rouge", "Rouge", [], "Blanche"],
  [23, "inspiration-21", "Retro / Vintage + Roses Please", "Noire", "Noire", ["Fleurs de toutes les couleurs", "Cerises pailletées"], null, "En perles", ["Dictée « Rose Spruce » : roses pochées sur la photo → Roses Please"]],
  [24, "inspiration-23", "Pearl Border × Retro", "Rose clair", "Rose pêche", ["Bordure de perles"], null],
  [25, "inspiration-24", "Pearl Border × Retro", "Blanche", "Blanche", ["Bordure de perles"], "Rose"],
  [26, "inspiration-25", "Sprinkles with Border", "Bleu foncé", "Bleu foncé", ["Vermicelles"], "Bleu clair"],
  [27, "inspiration-26", "Normal with border + Custom Drawing", "Verte", "Verte", ["Smileys jaunes"], null],
  [28, "inspiration-27", "Normal with border", "Verte", "Verte", [], "Rose clair"],
  [29, "inspiration-28", "Normal without border + Custom Drawing", "Bleue", null, ["Fleurs blanches et jaunes"], null],
  [30, "inspiration-29", "Rainbow Cake", "Rouge", "Multicolore (arc-en-ciel)", [], null, null, ["Base dictée « rouge » ; la photo paraît rose foncé"]],
  [31, "inspiration-30", "Normal with border", "Noire", "Noire et verte", [], "Rose"],
  [32, "inspiration-31", "Gold Leaves", "Rouge", null, ["Feuille d'or"], "Blanche"],
  [33, "inspiration-32", "Normal without border", "Rouge", null, [], "Blanche"],
  [34, "inspiration-33", "Normal with border + Roses Please", "Noire", "Noire", ["Fleurs roses"], null, null, ["Dictée « Rose Spruce » : roses pochées sur la photo → Roses Please"]],
  [35, "inspiration-34", "Retro / Vintage", "Blanche", "Blanche", [], null],
  [36, "inspiration-35", "Normal without border", "Rose clair", null, [], "Verte"],
  [37, "inspiration-36", "Rainbow (à vérifier)", "Rose foncé et rouge", "Rouge", ["Cœur blanc"], null, null, ["Design dicté « Rainbow » : pas d'arc-en-ciel visible sur la photo (cœurs blancs)"]],
  [38, "inspiration-37", "Retro / Vintage + Roses Please", "Jaune", "Jaune et orange", ["Fleurs roses"], null, null, ["Dictée « Rose Spruce » : roses pochées sur la photo → Roses Please"]],
  [39, "inspiration-38", "Roses Please", "Rouge", "Rouge", ["Fleurs blanches"], null, null, ["Dictée « Rose Spruce » : roses pochées sur la photo → Roses Please"]],
  [40, "inspiration-39", "Gender Reveal", "Blanche", "Blanche", ["Dessin noir"], null],
  [41, "inspiration-40", "Retro / Vintage", "Bleue pailletée", "Bleue et blanche", [], null],
  [42, "inspiration-41", "Retro / Vintage", "Rose", "Rouge", [], null],
  [43, "inspiration-42", "Normal with border", "Blanche", "Rouge", [], null],
  [44, "inspiration-43", "Normal with border + Custom Drawing", "Rose", null, ["Dessin rouge et noir"], null],
  [45, "inspiration-44", "Roses Please", "Rose", "Rose", ["Fleurs roses"], "Blanche", null, ["Dictée « Rose Spruce » : roses pochées sur la photo → Roses Please"]],
  [46, "inspiration-45", "Normal without border + Custom Drawing", "Blanche", null, ["Dessins rouges, bleus et verts"], null],
  [47, "inspiration-46", "Normal without border, style « Heartbound »", "Verte", "Orange", ["Cerises"], null, null, ["Style « Heartbound » à vérifier (cerises sur la photo, pas de cœurs)"]],
  [48, "inspiration-47", "Retro / Vintage", "Rouge", "Blanche", ["Ruban rouge"], null],
  [49, "inspiration-48", "Rainbow Cake", "Noire", "Noire", ["Cerises pailletées"], null],
  [50, "inspiration-49", "Chequered (damier)", null, null, [], null, null, ["Pas de design « Chequered » dans le catalogue", "Couleurs citées sans répartition base / déco : rose, bleu, vert, rose foncé, bleu foncé"]],
  [51, "inspiration-50", "Retro × Ribbons", "Rose clair", "Rose clair", ["Rubans"], null, null, ["Couleur des rubans non précisée"]],
  [52, "inspiration-51", "Roses Please", "Rose", "Rouge", ["Roses rouges"], null, null, ["Dictée « Rose Splice » : roses rouges sur la photo → Roses Please"]],
  [53, "inspiration-52", "Retro × Ribbons", "Rose", "Rose", ["Ruban rose"], null],
  [54, "inspiration-53", "Normal without border", "Noire", "Noire et verte", [], null],
  [55, "inspiration-54", "Retro / Vintage", "Noire", "Noire", [], null],
  [56, "inspiration-55", "Normal without border + Custom Drawing", "Blanche", null, ["Dessin noir"], null],
  [57, "inspiration-56", "Retro × Ribbons", "Beige crème", "Beige crème", ["Ruban noir"], null],
  [58, "inspiration-57", "Retro / Vintage", "Bleue", null, ["Vermicelles"], null, null, ["Dictée « bleu sprinkles, clair » : répartition du bleu clair à vérifier"]],
  [59, "inspiration-58", "Normal without border", "Blanche", "Bleue", ["Citron"], null],
  [60, "inspiration-59", "Retro / Vintage", "Rouge", "Rouge", [], null],
  [61, "inspiration-60", "Retro / Vintage", "Bleu foncé", "Bleu foncé", [], null],
  [62, "inspiration-61", "Retro / Vintage", "Crème", "Crème et rose", ["Cerises"], null],
  [63, "inspiration-62", null, "Blanche", "Beige", ["Fruits", "Fleurs"], null, null, ["Design non précisé"]],
  [64, "inspiration-63", "Pearl Border", "Bleue", "Beige", ["Bordure de perles"], null, null, ["« Pearl Border » seul : design exact à vérifier"]],
  [65, "inspiration-64", "Retro / Vintage", "Bleu clair", "Bleu clair", [], null],
  [66, "inspiration-65", "Retro × Ribbons", "Bleue", "Bleue", ["Rubans"], null, null, ["Couleur des rubans non précisée"]],
  [67, "inspiration-66", "Normal without border + fleurs", "Rose", "Rose", ["Fleurs roses"], null, "En perles"],
  [68, "inspiration-67", "Retro × Ribbons", "Rose", "Rose", ["Ruban noir"], null],
  [69, "inspiration-68", "Retro / Vintage", "Rose", "Blanche", ["Cerises"], null],
  [70, "inspiration-69", "Normal without border + Custom Drawing", "Beige", null, ["Fleurs orange, roses et vertes"], null],
  [71, "inspiration-70", "Normal without border", null, null, ["Boules de disco"], null, null, ["Couleur de base à préciser"]],
  [72, "inspiration-72", "Roses Please", "Bleu foncé", "Bleu foncé", ["Fleurs roses"], null],
  [73, "inspiration-73", "Retro / Vintage", "Rose", "Rose clair et rose", ["Petites feuilles de trèfle"], null],
  [74, "inspiration-74", "Retro × Ribbons", "Blanche", "Blanche", ["Ruban rose"], null],
  [75, "inspiration-75", "Normal without border", "Blanche", null, ["Fleurs violettes et roses"], null],
  [76, "inspiration-76", "Roses Please", "Rose", "Rouge", [], null],
  [77, "inspiration-77", "Roses Please", "Orange", "Orange", ["Fleurs roses"], null, null, ["Dictée « rose-rose » : roses roses sur la photo"]],
  [78, "inspiration-78", "Gold Leaves", "Rouge", null, ["Feuille d'or"], "Blanche"],
  [79, "inspiration-79", "Glitter Base", "Rose avec paillettes dorées", "Rose foncé", [], null],
  [80, "inspiration-80", "Retro / Vintage", "Rose clair", "Rose clair et rose foncé", [], null],
  [81, "inspiration-82", "Normal without border + Custom Drawing", "Bleue", null, ["Dessins roses, blancs et verts"], null],
  [82, "inspiration-83", "Normal with border", null, null, [], null, null, ["« Rouge » dicté sans répartition base / déco"]],
];

export const INSPIRATION_REFERENCE: Record<string, InspirationReference> = Object.fromEntries(
  ROWS.map(([position, id, design, base, decoration, extras, writingColour, writingStyle, toCheck]) => [id, {
    position, design, base, decoration, extras, writingColour, writingStyle: writingStyle ?? null, toCheck: toCheck ?? [],
  }]),
);

/** Référence d'une inspiration à partir de order_items.design (sinon null). */
export const inspirationReference = (design: string | null | undefined): InspirationReference | null =>
  (design && INSPIRATION_REFERENCE[design]) || null;
