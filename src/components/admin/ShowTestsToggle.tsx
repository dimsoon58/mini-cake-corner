// « Afficher les tests » retiré de l'admin (06.10.2026, demande de Mel) : les
// commandes de test (orders.is_test) restent TOUJOURS masquées sur les écrans
// de travail, même avec un ancien lien « ?tests=1 ». Le serveur garde
// l'option includeTests (jamais envoyée à true par l'admin).
export function useShowTests(): [boolean, (on: boolean) => void] {
  return [false, () => {}];
}

// Plus rien à afficher : gardé pour ne pas toucher aux écrans qui l'utilisent.
export function ShowTestsToggle(_props: { checked: boolean; onChange: (on: boolean) => void; className?: string }) {
  return null;
}
