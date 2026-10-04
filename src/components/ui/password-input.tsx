import * as React from "react";
import { Eye, EyeOff } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Champ mot de passe / code PIN avec un bouton œil pour afficher ou masquer
// ce qui est tapé (connexion, inscription, nouveau mot de passe, PIN admin).
// Même rendu que <Input> ; le texte n'est montré que sur demande.
const PasswordInput = React.forwardRef<HTMLInputElement, Omit<React.ComponentProps<"input">, "type">>(
  ({ className, ...props }, ref) => {
    const [visible, setVisible] = React.useState(false);
    // Largeur fixe (w-32…) : le cadre suit l'input ; sinon il prend toute la ligne.
    const fixedWidth = /(^|\s)w-/.test(className ?? "");
    const label = visible ? "Masquer / Hide" : "Afficher / Show";
    return (
      <span className={cn("relative", fixedWidth ? "inline-flex" : "flex w-full")}>
        <Input ref={ref} type={visible ? "text" : "password"} className={cn("pr-10", className)} {...props} />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={label}
          aria-pressed={visible}
          title={label}
          tabIndex={-1}
          className="absolute right-0 top-0 h-full px-2.5 flex items-center text-muted-foreground hover:text-foreground"
        >
          {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </span>
    );
  },
);
PasswordInput.displayName = "PasswordInput";

export { PasswordInput };
