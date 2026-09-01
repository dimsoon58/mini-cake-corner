import { useLang } from "@/context/LanguageContext";

/**
 * French translations for the form validation messages defined in the zod
 * schemas. The schemas live at module scope, so they cannot call `t()`
 * directly. Instead the English message is used as the lookup key and
 * translated at the moment it is rendered.
 */
export const formErrFr: Record<string, string> = {
  "First name is required": "Le prénom est requis",
  "Last name is required": "Le nom est requis",
  "Name is required": "Le nom est requis",
  "Company name is required": "Le nom de l'entreprise est requis",
  "Establishment name is required": "Le nom de l'établissement est requis",
  "Phone number is required": "Le numéro de téléphone est requis",
  "Message is required": "Le message est requis",
  "Invalid email address": "Adresse e-mail invalide",
  "Please enter a valid email address": "Veuillez saisir une adresse e-mail valide",
  "Please enter a valid phone number": "Veuillez saisir un numéro de téléphone valide",
  "Please select a date": "Veuillez sélectionner une date",
  "Please enter the number of guests": "Veuillez indiquer le nombre d'invités",
  "Estimated number of guests is required": "Le nombre estimé d'invités est requis",
  "Number of employees is required": "Le nombre d'employés est requis",
  "Number of participants is required": "Le nombre de participants est requis",
  "Please tell us about your event": "Veuillez nous parler de votre événement",
  "Please tell us about your project": "Veuillez nous parler de votre projet",
  "Please describe your dream cake": "Veuillez décrire le gâteau de vos rêves",
  "Minimum 1 guest": "Minimum 1 invité",
  "Maximum 100 guests": "Maximum 100 invités",
  "This field is required": "Ce champ est requis",
};

/** Returns a helper that translates a react-hook-form field error message. */
export const useFieldError = () => {
  const { t } = useLang();
  return (m?: string) => (m ? t(m, formErrFr[m] ?? m) : m);
};
