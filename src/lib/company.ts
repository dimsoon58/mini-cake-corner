// Identité de l'entreprise affichée sur le site (mentions légales, CGV,
// pied de page). Une seule source : à modifier ici uniquement.
// Adresse affichée = l'atelier (adresse physique), jamais le siège privé.
export const COMPANY = {
  name: "Bento Cake Studio SNC",
  street: "Rue Prévost-Martin 8",
  city: "1205 Genève",
  cityEn: "1205 Geneva",
  phone: "+41 78 337 95 00",
  phoneHref: "tel:+41783379500",
  email: "contact@bentocakestudio.ch",
  ide: "CHE-425.048.539",
} as const;

// Pages légales (une page chacune, liées dans le pied de page et au paiement).
export const LEGAL_PATHS = {
  notice: "/mentions-legales",
  gtc: "/cgv",
  privacy: "/politique-de-confidentialite",
} as const;

// Version des CGV et de la politique de confidentialité affichée en bas des pages.
export const LEGAL_UPDATED = "07.10.2026";
