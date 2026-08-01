# -*- coding: utf-8 -*-
import io, os, re, sys

ROOT = "/sessions/rcw-01d8yvniirrtjcjqoatid7yj/mnt/mini-cake-corner"

def read(p):
    return io.open(p, "r", encoding="utf-8").read()

def write(p, s):
    tmp = p + ".tmp"
    io.open(tmp, "w", encoding="utf-8").write(s)
    os.replace(tmp, p)

def rep(s, old, new, n=1, tag=""):
    c = s.count(old)
    if c != n:
        print("MISMATCH [%s] expected %d got %d: %r" % (tag, n, c, old[:90]))
        sys.exit(1)
    return s.replace(old, new)

# ---------------------------------------------------------------- 1. helper
HELPER = u'''import { useLang } from "@/context/LanguageContext";

/**
 * French translations for the form validation messages defined in the zod
 * schemas. The schemas live at module scope, so they cannot call `t()`
 * directly. Instead the English message is used as the lookup key and
 * translated at the moment it is rendered.
 */
export const formErrFr: Record<string, string> = {
  "First name is required": "Le prenom est requis",
  "Last name is required": "Le nom est requis",
  "Name is required": "Le nom est requis",
  "Company name is required": "Le nom de l'entreprise est requis",
  "Establishment name is required": "Le nom de l'etablissement est requis",
  "Phone number is required": "Le numero de telephone est requis",
  "Message is required": "Le message est requis",
  "Invalid email address": "Adresse e-mail invalide",
  "Please enter a valid email address": "Veuillez saisir une adresse e-mail valide",
  "Please enter a valid phone number": "Veuillez saisir un numero de telephone valide",
  "Please select a date": "Veuillez selectionner une date",
  "Please enter the number of guests": "Veuillez indiquer le nombre d'invites",
  "Estimated number of guests is required": "Le nombre estime d'invites est requis",
  "Number of employees is required": "Le nombre d'employes est requis",
  "Number of participants is required": "Le nombre de participants est requis",
  "Please tell us about your event": "Veuillez nous parler de votre evenement",
  "Please tell us about your project": "Veuillez nous parler de votre projet",
  "Please describe your dream cake": "Veuillez decrire le gateau de vos reves",
  "Minimum 1 guest": "Minimum 1 invite",
  "Maximum 100 guests": "Maximum 100 invites",
  "This field is required": "Ce champ est requis",
};

/** Returns a helper that translates a react-hook-form field error message. */
export const useFieldError = () => {
  const { t } = useLang();
  return (m?: string) => (m ? t(m, formErrFr[m] ?? m) : m);
};
'''
# restore proper accents (written above without accents to keep the source ascii-safe)
ACC = {
    "Le prenom est requis": u"Le prénom est requis",
    "Le nom de l'etablissement est requis": u"Le nom de l'établissement est requis",
    "Le numero de telephone est requis": u"Le numéro de téléphone est requis",
    "Veuillez saisir un numero de telephone valide": u"Veuillez saisir un numéro de téléphone valide",
    "Veuillez selectionner une date": u"Veuillez sélectionner une date",
    "Veuillez indiquer le nombre d'invites": u"Veuillez indiquer le nombre d'invités",
    "Le nombre estime d'invites est requis": u"Le nombre estimé d'invités est requis",
    "Le nombre d'employes est requis": u"Le nombre d'employés est requis",
    "Veuillez nous parler de votre evenement": u"Veuillez nous parler de votre événement",
    "Veuillez decrire le gateau de vos reves": u"Veuillez décrire le gâteau de vos rêves",
    "Minimum 1 invite": u"Minimum 1 invité",
    "Maximum 100 invites": u"Maximum 100 invités",
}
for k, v in ACC.items():
    HELPER = HELPER.replace('"%s"' % k, '"%s"' % v)

write(os.path.join(ROOT, "src/lib/formErrors.ts"), HELPER)
print("wrote src/lib/formErrors.ts")

# ------------------------------------------------- 2. wire the error renders
ERR_RE = re.compile(r"\{errors\.([A-Za-z_][A-Za-z0-9_]*)\.message\}")

TARGETS = [
    ("src/pages/Contact.tsx", 5),
    ("src/pages/Workshop.tsx", 5),
    ("src/pages/Business.tsx", 19),
    ("src/components/CustomRequestForm.tsx", 7),
]

for rel, expected in TARGETS:
    p = os.path.join(ROOT, rel)
    s = read(p)
    orig_len = len(s)

    found = len(ERR_RE.findall(s))
    if found != expected:
        print("MISMATCH [%s] error renders expected %d got %d" % (rel, expected, found))
        sys.exit(1)
    s = ERR_RE.sub(lambda m: "{fe(errors.%s.message)}" % m.group(1), s)

    # import
    if 'from "@/lib/formErrors"' not in s:
        anchor = 'import { useLang } from "@/context/LanguageContext";'
        if anchor not in s:
            print("MISMATCH [%s] no useLang import" % rel)
            sys.exit(1)
        s = s.replace(anchor, anchor + '\nimport { useFieldError } from "@/lib/formErrors";', 1)

    # add the helper after every `const { ... } = useLang();`
    HOOK_RE = re.compile(r"(const \{[^}]*\} = useLang\(\);)")
    nhooks = len(HOOK_RE.findall(s))
    if nhooks == 0:
        print("MISMATCH [%s] no useLang() call" % rel)
        sys.exit(1)
    if "useFieldError()" not in s:
        s = HOOK_RE.sub(lambda m: m.group(1) + "\n  const fe = useFieldError();", s)

    write(p, s)
    print("%-42s %d errors, %d hooks, %d -> %d bytes" % (rel, found, nhooks, orig_len, len(s)))

# ------------------------------------------------------ 3. Contact.tsx toasts
p = os.path.join(ROOT, "src/pages/Contact.tsx")
s = read(p)
s = rep(s,
        u'toast.success("Your message has been sent. We\'ll get back to you soon!");',
        u'toast.success(t("Your message has been sent. We\'ll get back to you soon!", "Votre message a bien été envoyé. Nous vous répondrons très vite !"));',
        1, "contact-toast-success")
s = rep(s,
        u'toast.error("File size must be under 10 MB.");',
        u'toast.error(t("File size must be under 10 MB.", "Le fichier doit faire moins de 10 Mo."));',
        1, "contact-toast-size")
write(p, s)
print("Contact.tsx toasts OK")

# --------------------------------------------------- 4. Index "Coming soon..."
p = os.path.join(ROOT, "src/pages/Index.tsx")
s = read(p)
s = rep(s,
        u'<p className="text-center text-muted-foreground italic">Coming soon...</p>',
        u'<p className="text-center text-muted-foreground italic">{t("Coming soon...", "Bientôt disponible...")}</p>',
        1, "index-coming-soon")
write(p, s)
print("Index.tsx OK")

# ------------------------------------------------- 5. DotCakes tier note "included"
p = os.path.join(ROOT, "src/pages/DotCakes.tsx")
s = read(p)
s = rep(s,
        u't(tier.note, tier.note.replace("per Dot Cake", "par Dot Cake"))',
        u't(tier.note, tierNoteFr[tier.note] ?? tier.note)',
        1, "dot-note")
anchor = u'const INITIAL_CANDLES_SHOWN = 4;'
s = rep(s, anchor,
        u'const tierNoteFr: Record<string, string> = {\n'
        u'  "included": "inclus",\n'
        u'  "+CHF 1.50 per Dot Cake": "+CHF 1.50 par Dot Cake",\n'
        u'  "+CHF 2.50 per Dot Cake": "+CHF 2.50 par Dot Cake",\n'
        u'};\n\n' + anchor,
        1, "dot-anchor")
write(p, s)
print("DotCakes.tsx OK")

print("ALL DONE")
