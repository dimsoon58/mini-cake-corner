import Layout from "@/components/Layout";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useLang } from "@/context/LanguageContext";

// Source of truth: the two final legal documents provided by Bento Cake
// Studio (FR + EN versions of "Mentions légales, Conditions générales de
// vente et Politique de confidentialité", last updated 08.09.2026). The
// legal wording below is reproduced verbatim from those documents; only
// web-display structure (headings, paragraphs, spacing) is applied here.
// FR is shown when the site language is "fr", EN otherwise.

type Block =
  | { p: string; pFr: string }
  | { h: string; hFr: string };

interface Article {
  id: string;
  part: "gtc" | "privacy";
  title: string;
  titleFr: string;
  blocks: Block[];
}

const articles: Article[] = [
  {
    id: "1",
    part: "gtc",
    title: "Article 1 – Legal Notice",
    titleFr: "Article 1 – Mentions légales",
    blocks: [
      {
        p: "Bento Cake Studio SNC\n58 chemin de la Gradelle\n1224 Chêne-Bougeries, Switzerland\nEmail: contact@bentocakestudio.ch",
        pFr: "Bento Cake Studio SNC\n58 chemin de la Gradelle\n1224 Chêne-Bougeries, Suisse\nEmail : contact@bentocakestudio.ch",
      },
      {
        p: "The website is published and operated by Bento Cake Studio SNC.",
        pFr: "Le site est édité et exploité par Bento Cake Studio SNC.",
      },
    ],
  },
  {
    id: "2",
    part: "gtc",
    title: "Article 2 – Purpose and Scope",
    titleFr: "Article 2 – Objet et champ d'application",
    blocks: [
      {
        p: "These General Terms and Conditions of Sale (hereinafter the \"Terms and Conditions\") define the conditions under which customers (hereinafter the \"Customer\") may order and purchase products offered by Bento Cake Studio SNC through its website or, where offered, through an order processed manually by Bento Cake Studio SNC.",
        pFr: "Les présentes Conditions Générales de Vente (ci-après « CGV ») définissent les modalités selon lesquelles les clients (ci-après « le Client ») peuvent commander et acheter les produits proposés par Bento Cake Studio SNC via son site internet ou, lorsque cela est proposé, par l'intermédiaire d'une commande prise manuellement par Bento Cake Studio SNC.",
      },
      {
        p: "Any order validated with Bento Cake Studio SNC implies full and unconditional acceptance of these Terms and Conditions.",
        pFr: "Toute commande validée auprès de Bento Cake Studio SNC implique l'acceptation pleine et entière des présentes CGV.",
      },
    ],
  },
  {
    id: "3",
    part: "gtc",
    title: "Article 3 – Products",
    titleFr: "Article 3 – Produits",
    blocks: [
      {
        p: "The products offered are handmade artisanal pastries made to order. Photographs, visuals and product descriptions are provided for illustrative purposes only.",
        pFr: "Les produits proposés sont des pâtisseries artisanales, réalisées à la main et à la commande. Les photographies, visuels et descriptions des produits sont communiqués à titre indicatif.",
      },
      {
        p: "Due to the artisanal nature of the creations, slight variations in colour, shape, finish or decoration may occur. Colours may also vary slightly depending on screens, lighting and the food colourings used.",
        pFr: "En raison du caractère artisanal des créations, de légères variations de couleur, de forme, de finition ou de décoration peuvent exister. Les teintes peuvent également différer légèrement selon les écrans, l'éclairage et les colorants utilisés.",
      },
      {
        p: "The Customer acknowledges having been informed that very dark or highly pigmented colours may temporarily stain the lips, mouth or certain surfaces. This effect is inherent to the use of the food colourings required to achieve such shades and does not constitute a product defect or, on its own, grounds for a complaint or refund.",
        pFr: "Le Client reconnaît avoir été informé que les couleurs très foncées ou fortement pigmentées peuvent temporairement colorer les lèvres, la bouche ou certaines surfaces. Cet effet est inhérent à l'utilisation de colorants nécessaires à l'obtention de ces teintes et ne constitue ni un défaut du produit ni, à lui seul, un motif de réclamation ou de remboursement.",
      },
      {
        p: "The design selected by the Customer on the website forms the basis of the order. Any reference photograph provided by the Customer is used solely as a source of inspiration for elements that can be created using the techniques offered by Bento Cake Studio SNC.",
        pFr: "Le design sélectionné par le Client sur le site constitue la base de la commande. Toute photographie de référence transmise par le Client est utilisée uniquement comme source d'inspiration pour les éléments pouvant être réalisés avec les techniques proposées par Bento Cake Studio SNC.",
      },
      {
        p: "Bento Cake Studio SNC does not work with fondant. Figurines, decorations or other fondant elements shown in a reference photograph will therefore not be reproduced or added to the order.",
        pFr: "Bento Cake Studio SNC ne travaille pas avec de la pâte à sucre. Les figurines, décorations ou autres éléments en pâte à sucre figurant sur une photographie de référence ne seront donc pas reproduits ni ajoutés à la commande.",
      },
      {
        p: "Bento Cake Studio SNC will make every reasonable effort to respect the style, colours and overall spirit of the selected design, without guaranteeing an identical reproduction.",
        pFr: "Bento Cake Studio SNC fera son maximum pour respecter le style, les couleurs et l'esprit général du design choisi, sans garantir une reproduction strictement identique.",
      },
    ],
  },
  {
    id: "4",
    part: "gtc",
    title: "Article 4 – Orders and Confirmation",
    titleFr: "Article 4 – Commandes et confirmation",
    blocks: [
      {
        p: "Orders are primarily placed through the website. Bento Cake Studio SNC may also accept certain orders processed manually, including by message, telephone or email.",
        pFr: "Les commandes sont principalement effectuées via le site internet. Bento Cake Studio SNC peut également accepter certaines commandes prises manuellement, notamment par message, téléphone ou e-mail.",
      },
      {
        p: "The Customer undertakes to provide accurate and complete information when placing an order, including the selected product and options, any personalised message and valid contact details.",
        pFr: "Le Client s'engage à fournir des informations exactes et complètes lors de la commande, notamment le produit sélectionné et ses options, le message personnalisé le cas échéant, ainsi que des coordonnées valides.",
      },
      {
        p: "In the event of an error or omission in the information provided by the Customer, particularly regarding the delivery address or contact details, Bento Cake Studio SNC shall not be held responsible for any inability to fulfil the order or any delay in its fulfilment.",
        pFr: "En cas d'erreur ou d'omission dans les informations fournies par le Client, notamment concernant l'adresse de livraison ou les coordonnées de contact, Bento Cake Studio SNC ne saurait être tenue responsable de l'impossibilité d'exécuter la commande ou d'un retard dans son exécution.",
      },
      {
        p: "The information and product presentations displayed on the website do not constitute a legally binding offer.",
        pFr: "Les informations et présentations figurant sur le site ne constituent pas une offre juridiquement contraignante.",
      },
      {
        p: "The order is considered final once the payment has been validated and confirmed. A confirmation email is sent to the Customer.",
        pFr: "La commande est considérée comme définitive après validation et confirmation du paiement. Un e-mail de confirmation est adressé au Client.",
      },
      {
        p: "An order placed through the website is considered definitively confirmed only once payment has been validated and the Customer has received a confirmation email from Bento Cake Studio SNC.",
        pFr: "Une commande passée sur le site n'est considérée comme définitivement confirmée qu'après validation du paiement et réception par le Client d'un e-mail de confirmation de Bento Cake Studio SNC.",
      },
      {
        p: "If no confirmation email is received, the Customer is invited to contact Bento Cake Studio SNC to verify that the order has been correctly registered. If a payment appears to have been charged without any order confirmation being received, the Customer is requested to contact Bento Cake Studio SNC before placing another order.",
        pFr: "En l'absence d'e-mail de confirmation, le Client est invité à contacter Bento Cake Studio SNC afin de vérifier que la commande a bien été enregistrée. Si un paiement semble avoir été débité sans qu'aucune confirmation de commande n'ait été reçue, le Client est prié de contacter Bento Cake Studio SNC avant d'effectuer une nouvelle commande.",
      },
      {
        p: "Bento Cake Studio SNC reserves the right to refuse any unusual, incomplete or fraudulent order.",
        pFr: "Bento Cake Studio SNC se réserve le droit de refuser toute commande anormale, incomplète ou frauduleuse.",
      },
      {
        p: "Electronic records retained by Bento Cake Studio SNC may be used as evidence of transactions carried out.",
        pFr: "Les enregistrements informatiques conservés par Bento Cake Studio SNC constituent une preuve des transactions intervenues.",
      },
    ],
  },
  {
    id: "5",
    part: "gtc",
    title: "Article 5 – Changes and Cancellations",
    titleFr: "Article 5 – Modification et annulation",
    blocks: [
      {
        p: "As each creation is designed and made to order for our Customers, any confirmed order involves production planning and the reservation or purchase of specific ingredients and materials.",
        pFr: "Chaque création étant imaginée et réalisée sur mesure pour nos Clients, toute commande confirmée engage la mise en production ainsi que la réservation de matières premières spécifiques.",
      },
      {
        p: "Any cancellation request must be submitted in writing or through the website at least 5 calendar days before the scheduled pick-up or delivery date.",
        pFr: "Toute demande d'annulation devra être adressée par écrit ou via le site au minimum 5 jours calendaires avant la date prévue de retrait ou de livraison.",
      },
      {
        p: "In such cases, a refund may be issued after deduction of any costs already incurred in preparing the order.",
        pFr: "Dans ce cas, un remboursement est possible, sous déduction des frais déjà engagés pour la préparation de la commande.",
      },
      {
        p: "Once this 5-day period has passed, the order will no longer be eligible for a refund, as the necessary elements for its preparation will already have been committed.",
        pFr: "Passé ce délai de 5 jours, la commande ne pourra plus faire l'objet d'un remboursement, les éléments nécessaires à sa réalisation ayant été engagés.",
      },
      {
        p: "Requests for changes may be made up to 5 days before the scheduled date, subject to feasibility and any applicable price adjustment.",
        pFr: "Les demandes de modification restent possibles jusqu'à 5 jours avant la date prévue, sous réserve de faisabilité et d'un éventuel ajustement tarifaire.",
      },
      {
        p: "In the event that a product or ingredient becomes exceptionally unavailable due to circumstances beyond our control, an equivalent alternative respecting the spirit and quality of the original creation will be proposed. If no suitable solution can be agreed upon, a credit or refund may be offered.",
        pFr: "En cas d'indisponibilité exceptionnelle d'un produit ou d'un ingrédient indépendant de notre volonté, une alternative équivalente respectant l'esprit et la qualité de la création initialement prévue sera proposée. Si aucune solution ne convient, un avoir ou un remboursement est possible.",
      },
      {
        p: "The cancellation or postponement of a Customer's personal event (birthday, wedding, reception or otherwise) does not constitute grounds for a refund outside the conditions and time limits set out in this Article.",
        pFr: "L'annulation ou le report d'un événement personnel du Client (anniversaire, mariage, réception ou autre) ne constitue pas un motif de remboursement en dehors des conditions et délais prévus au présent article.",
      },
    ],
  },
  {
    id: "6",
    part: "gtc",
    title: "Article 6 – Prices and Express Order Surcharge",
    titleFr: "Article 6 – Prix et supplément express",
    blocks: [
      {
        p: "Prices are indicated in Swiss francs (CHF). As Bento Cake Studio SNC is not subject to Value Added Tax (VAT), VAT is not applicable in accordance with current Swiss legislation.",
        pFr: "Les prix sont indiqués en francs suisses (CHF). Bento Cake Studio SNC n'étant pas assujettie à la taxe sur la valeur ajoutée (TVA), la TVA n'est pas applicable conformément à la législation suisse en vigueur.",
      },
      {
        p: "Delivery charges, where applicable, are specified when the order is validated. The prices applied are those in force at the time the order is placed and cannot subsequently be changed.",
        pFr: "Les frais de livraison, le cas échéant, sont précisés lors de la validation de la commande. Les prix appliqués sont ceux en vigueur au moment de la commande et ne peuvent être modifiés ultérieurement.",
      },
      {
        p: "Orders accepted 3 calendar days or less before the scheduled pick-up or delivery date, whether placed directly through the website or manually processed by Bento Cake Studio SNC, are subject to an express surcharge of 10% of the total order amount and cannot be cancelled once confirmed.",
        pFr: "Les commandes acceptées 3 jours calendaires ou moins avant la date prévue de retrait ou de livraison, qu'elles soient passées directement sur le site ou prises manuellement par Bento Cake Studio SNC, font l'objet d'un supplément express de 10 % du montant total de la commande et sont non annulables une fois confirmées.",
      },
      {
        p: "This surcharge is communicated to the Customer before the order is validated and paid.",
        pFr: "Ce supplément est communiqué au Client avant la validation et le paiement de la commande.",
      },
    ],
  },
  {
    id: "7",
    part: "gtc",
    title: "Article 7 – Payment Terms",
    titleFr: "Article 7 – Modalités de paiement",
    blocks: [
      {
        p: "For orders placed directly through the website, payment is made online when the order is validated. For manually processed orders, the applicable payment terms are those communicated to the Customer by Bento Cake Studio SNC.",
        pFr: "Pour les commandes passées directement sur le site, le paiement s'effectue en ligne au moment de la validation de la commande. Pour les commandes prises manuellement, les modalités de paiement applicables sont celles communiquées au Client par Bento Cake Studio SNC.",
      },
      {
        p: "Payment methods accepted on the website include bank cards and TWINT. Transactions are securely processed through the PostFinance Checkout platform.",
        pFr: "Les moyens de paiement acceptés sur le site sont les cartes bancaires ainsi que TWINT. Les transactions sont traitées de manière sécurisée via la plateforme de PostFinance Checkout.",
      },
      {
        p: "The order is considered final only once payment has been confirmed.",
        pFr: "La commande n'est considérée comme définitive qu'après confirmation du paiement.",
      },
      {
        p: "Bento Cake Studio SNC does not store any banking or card details. Payment information is processed directly by the payment service provider in accordance with its own terms and security policies.",
        pFr: "Bento Cake Studio SNC ne conserve aucune donnée bancaire. Les informations de paiement sont traitées directement par le prestataire de paiement conformément à ses propres conditions et politiques de sécurité.",
      },
      {
        p: "Ownership of the products is transferred only once the Customer has paid the full purchase price.",
        pFr: "Le transfert de propriété des produits intervient uniquement après paiement intégral du prix par le Client.",
      },
    ],
  },
  {
    id: "8",
    part: "gtc",
    title: "Article 8 – Customer Benefits: Welcome Offer and Cashback",
    titleFr: "Article 8 – Avantages clients : offre de bienvenue et cashback",
    blocks: [
      { h: "Welcome Offer", hFr: "Offre de bienvenue" },
      {
        p: "Customers who create a customer account on the website and subscribe to the newsletter may benefit from a 10% welcome discount, valid for three months from activation and usable once only.",
        pFr: "Les Clients disposant d'un compte client créé sur le site et inscrits à la newsletter peuvent bénéficier d'une remise de bienvenue de 10 %, valable pendant trois mois à compter de son activation et utilisable une seule fois.",
      },
      {
        p: "The discount applies to the base price of one eligible product and excludes, in particular, extras, options and delivery charges.",
        pFr: "La remise s'applique au prix de base d'un produit éligible, à l'exclusion notamment des extras, options et frais de livraison.",
      },
      {
        p: "The offer is limited to one use per Customer. Creating multiple accounts or using different email addresses for the purpose of benefiting from the offer more than once is considered abusive use.",
        pFr: "L'offre est réservée à un usage unique par Client. La création de plusieurs comptes ou l'utilisation de différentes adresses e-mail dans le but de bénéficier plusieurs fois de cette offre est considérée comme un usage abusif.",
      },
      {
        p: "In such cases, Bento Cake Studio SNC reserves the right to remove the discount, request payment of the outstanding balance corresponding to the normal order price or, if the amount is not regularised, cancel the order.",
        pFr: "Bento Cake Studio SNC se réserve dans ce cas le droit de retirer la remise, de demander le paiement du solde correspondant au prix normal de la commande ou, à défaut de régularisation, d'annuler la commande.",
      },
      {
        p: "This offer is available only for orders placed directly through the website using a customer account and cannot be applied retroactively to an order placed by telephone, email, message or any other channel.",
        pFr: "Cette offre est disponible uniquement pour les commandes passées directement sur le site via un compte client et ne peut pas être appliquée rétroactivement à une commande passée par téléphone, e-mail, message ou tout autre canal.",
      },
      { h: "Cashback Programme", hFr: "Programme de cashback" },
      {
        p: "Customers with a customer account may benefit from cashback corresponding to 3.5% of the eligible amount of orders placed and paid directly through the website.",
        pFr: "Les Clients disposant d'un compte client peuvent bénéficier d'un cashback correspondant à 3,5 % du montant éligible de leurs commandes passées et payées directement sur le site.",
      },
      {
        p: "Cashback is calculated on the eligible product amount after application of any discounts or cashback used and does not include delivery charges.",
        pFr: "Le cashback est calculé sur le montant éligible des produits, après application des éventuelles remises ou du cashback utilisé, et n'inclut pas les frais de livraison.",
      },
      {
        p: "The amount earned is credited to the customer account and remains valid for one year from the date it is awarded. It may be used for subsequent eligible orders placed through the website.",
        pFr: "Le montant acquis est crédité sur le compte client et reste valable pendant une durée d'un an à compter de son attribution. Il peut être utilisé lors de commandes ultérieures éligibles passées sur le site.",
      },
      {
        p: "Cashback is a promotional benefit and cannot be exchanged for cash, refunded in cash or transferred to another person.",
        pFr: "Le cashback constitue un avantage commercial et ne peut être échangé contre de l'argent, remboursé en espèces ou transféré à un tiers.",
      },
      {
        p: "Orders placed by telephone, email, message or any other channel outside the customer account on the website do not allow Customers to earn cashback or use their available cashback balance.",
        pFr: "Les commandes passées par téléphone, e-mail, message ou tout autre canal en dehors du compte client sur le site ne permettent ni de cumuler du cashback ni d'utiliser le solde disponible.",
      },
    ],
  },
  {
    id: "9",
    part: "gtc",
    title: "Article 9 – Pick-Up, Delivery and Delays",
    titleFr: "Article 9 – Retrait, livraison et retards",
    blocks: [
      {
        p: "The Customer may choose either pick-up or delivery to the address provided when placing the order.",
        pFr: "Le Client peut choisir le retrait sur place ou la livraison à l'adresse indiquée lors de la commande.",
      },
      {
        p: "For pick-up orders, the Customer selects a time slot when placing the order and agrees to respect it. Any opening hours displayed on online platforms do not constitute unrestricted pick-up hours: orders must be collected during the reserved time slot.",
        pFr: "En cas de retrait sur place, le Client sélectionne lors de sa commande un créneau horaire qu'il s'engage à respecter. Les horaires d'ouverture éventuellement affichés sur les plateformes en ligne ne constituent pas des horaires de retrait libre : les commandes doivent être retirées pendant le créneau réservé.",
      },
      {
        p: "In the event of an unexpected delay, the Customer is requested to inform Bento Cake Studio SNC as soon as possible. A slight delay may be tolerated where reasonably possible.",
        pFr: "En cas de retard imprévu, le Client est prié d'en informer Bento Cake Studio SNC dans les meilleurs délais. Un léger retard pourra être toléré dans la mesure du possible.",
      },
      {
        p: "In the event of a more significant delay, a new collection deadline may exceptionally be agreed with Bento Cake Studio SNC. Such a deadline is valid only if expressly accepted by Bento Cake Studio SNC.",
        pFr: "En cas de retard plus important, un nouveau délai de retrait pourra exceptionnellement être convenu avec Bento Cake Studio SNC. Ce délai n'est valable que s'il a été expressément accepté par Bento Cake Studio SNC.",
      },
      {
        p: "Without such agreement, Bento Cake Studio SNC does not guarantee that the order can be handed over outside the reserved time slot. Once the agreed time slot or, where applicable, the exceptionally agreed new deadline has passed, the order may be considered uncollected and will not be eligible for a refund due to the perishable nature of the products.",
        pFr: "À défaut d'accord, Bento Cake Studio SNC ne garantit pas la remise de la commande en dehors du créneau réservé. Passé le créneau convenu ou, le cas échéant, le nouveau délai exceptionnellement accordé, la commande pourra être considérée comme non retirée et ne pourra donner lieu à aucun remboursement, compte tenu du caractère périssable des produits.",
      },
      {
        p: "For pick-up orders, transportation of the products is entirely the Customer's responsibility. Bento Cake Studio SNC shall not be held responsible for any damage occurring after the product has been handed over, including damage caused by improper handling, unsuitable transportation or inappropriate storage.",
        pFr: "En cas de retrait sur place, le transport des produits est effectué sous l'entière responsabilité du Client. Bento Cake Studio SNC ne saurait être tenue responsable de toute détérioration survenue après la remise du produit, notamment en cas de mauvaise manipulation, de transport inadapté ou de conservation inappropriée.",
      },
      {
        p: "For deliveries, the delivery is carried out by an independent third-party transport provider appointed by Bento Cake Studio SNC.",
        pFr: "En cas de livraison, celle-ci est effectuée par un prestataire de transport tiers mandaté par Bento Cake Studio SNC.",
      },
      {
        p: "Bento Cake Studio SNC takes all reasonable care in preparing, packaging and handing over the order to the delivery provider under conditions suitable for transporting the product.",
        pFr: "Bento Cake Studio SNC apporte le plus grand soin à la préparation, à l'emballage et à la remise de la commande au transporteur dans des conditions adaptées au transport du produit.",
      },
      {
        p: "In the event of a delay, damage or other incident occurring during delivery, the Customer is invited to contact Bento Cake Studio SNC as soon as possible. Bento Cake Studio SNC will review the situation with the Customer and, where appropriate, take the necessary steps with the delivery provider.",
        pFr: "En cas de retard, dommage ou incident survenu au cours de la livraison, le Client est invité à contacter Bento Cake Studio SNC dans les meilleurs délais. Bento Cake Studio SNC examinera la situation avec le Client et effectuera, le cas échéant, les démarches nécessaires auprès du prestataire de livraison.",
      },
      {
        p: "Bento Cake Studio SNC cannot, however, be held responsible for circumstances beyond its control relating to transportation, including traffic conditions, accidents, unforeseen events or incorrect delivery information provided by the Customer.",
        pFr: "Bento Cake Studio SNC ne peut toutefois être tenue responsable des circonstances indépendantes de sa volonté liées au transport, notamment les conditions de circulation, accidents, événements imprévisibles ou informations de livraison incorrectes communiquées par le Client.",
      },
      {
        p: "In the event of a delay in the preparation, handover or delivery of an order attributable to Bento Cake Studio SNC, Bento Cake Studio SNC will endeavour to inform the Customer as soon as possible.",
        pFr: "En cas de retard dans la préparation, la remise ou la livraison d'une commande imputable à Bento Cake Studio SNC, Bento Cake Studio SNC s'efforcera d'en informer le Client dans les meilleurs délais.",
      },
      {
        p: "A minor delay does not automatically entitle the Customer to a refund or compensation.",
        pFr: "Un léger retard ne donne pas automatiquement droit à un remboursement ou à une indemnisation.",
      },
      {
        p: "Where a significant delay renders the order unusable for the purpose or event previously communicated to Bento Cake Studio SNC, the situation will be reviewed on a case-by-case basis in order to determine an appropriate solution.",
        pFr: "Lorsqu'un retard important rend la commande inutilisable pour l'usage ou l'événement prévu et communiqué à Bento Cake Studio SNC, la situation sera examinée au cas par cas afin de déterminer une solution appropriée.",
      },
    ],
  },
  {
    id: "10",
    part: "gtc",
    title: "Article 10 – Complaints",
    titleFr: "Article 10 – Réclamations",
    blocks: [
      {
        p: "Any complaint must be submitted within 48 hours following pick-up or delivery by email to: contact@bentocakestudio.ch.",
        pFr: "Toute réclamation doit être formulée dans un délai de 48 heures après le retrait ou la livraison, par e-mail à l'adresse suivante : contact@bentocakestudio.ch.",
      },
      {
        p: "Any complaint must be accompanied by photographs of the product concerned in order to allow the matter to be assessed. After this period, complaints may no longer be considered.",
        pFr: "Toute réclamation devra être accompagnée de photographies du produit concerné afin de permettre son examen. Passé ce délai, aucune réclamation ne pourra être prise en compte.",
      },
      {
        p: "Bento Cake Studio SNC endeavours to provide an initial response within an indicative period of 72 business hours following receipt of the complaint. This period may be extended, particularly during closure periods, in the event of an exceptional volume of requests, technical issues or where internal checks or enquiries with a third-party provider are required.",
        pFr: "Bento Cake Studio SNC s'efforce d'apporter une première réponse dans un délai indicatif de 72 heures ouvrées suivant la réception de la réclamation. Ce délai peut être prolongé notamment en cas de période de fermeture, de volume exceptionnel de demandes, de problème technique ou lorsqu'une vérification interne ou auprès d'un prestataire tiers est nécessaire.",
      },
      {
        p: "Exceeding this indicative response period does not constitute acceptance of the complaint and does not automatically entitle the Customer to a refund or compensation.",
        pFr: "Le dépassement de ce délai indicatif ne vaut ni acceptation de la réclamation ni droit automatique à un remboursement ou à une indemnisation.",
      },
    ],
  },
  {
    id: "11",
    part: "gtc",
    title: "Article 11 – Right of Withdrawal",
    titleFr: "Article 11 – Droit de rétractation",
    blocks: [
      {
        p: "In accordance with applicable legislation, the right of withdrawal does not apply to fresh or perishable products or to personalised products made to order.",
        pFr: "Conformément à la législation en vigueur, le droit de rétractation ne s'applique pas aux produits frais ou périssables ni aux produits personnalisés et réalisés sur commande.",
      },
      {
        p: "No refund may be issued once the order has been prepared or handed over to the Customer.",
        pFr: "Aucun remboursement ne pourra être effectué une fois la commande préparée ou remise au Client.",
      },
    ],
  },
  {
    id: "12",
    part: "gtc",
    title: "Article 12 – Liability, Storage and Decorative Elements",
    titleFr: "Article 12 – Responsabilité, conservation et éléments décoratifs",
    blocks: [
      {
        p: "Bento Cake Studio SNC shall not be held responsible for improper storage or handling of products by the Customer, consumption beyond the recommended period or allergic reactions where the composition of the products has been indicated.",
        pFr: "Bento Cake Studio SNC ne saurait être tenue responsable d'une mauvaise conservation ou manipulation des produits par le Client, d'une consommation au-delà des délais recommandés ou de réactions allergiques dès lors que la composition des produits est indiquée.",
      },
      {
        p: "A list of allergens may be provided to the Customer upon request. It is the Customer's responsibility to inform Bento Cake Studio SNC of any allergy or food intolerance when placing the order.",
        pFr: "La liste des allergènes peut être communiquée au Client sur simple demande. Il appartient au Client de signaler toute allergie ou intolérance alimentaire lors de la commande.",
      },
      {
        p: "Products are prepared, handled and stored in accordance with applicable hygiene standards and Swiss food regulations. Bento Cake Studio SNC ensures compliance with the legal requirements applicable to food products in order to maintain the quality and safety of the products offered.",
        pFr: "Les produits sont fabriqués, manipulés et conservés conformément aux normes d'hygiène et aux réglementations alimentaires en vigueur en Suisse. Bento Cake Studio SNC veille au respect des exigences légales applicables aux denrées alimentaires afin de garantir la qualité et la sécurité des produits proposés.",
      },
      {
        p: "Products must be stored in accordance with the instructions communicated at the time of pick-up. Unless otherwise indicated, fresh products, particularly those made with whipped cream, must be stored in the refrigerator between 0°C and 4°C and consumed within a maximum of 48 hours following pick-up or delivery. Products should not be left at room temperature for prolonged periods and must not be frozen.",
        pFr: "Les produits doivent être conservés conformément aux indications communiquées lors du retrait. Sauf indication contraire, les produits frais, notamment ceux à base de crème chantilly, doivent être conservés au réfrigérateur entre 0°C et 4°C et doivent être consommés dans un délai maximal de 48 heures suivant leur retrait ou leur livraison. Il est déconseillé de laisser les produits à température ambiante de manière prolongée. Les produits ne doivent pas être congelés.",
      },
      {
        p: "Certain decorative elements, including internal supports, picks, toppers, flowers or decorative accessories, may not be edible.",
        pFr: "Certains éléments décoratifs (supports internes, pics, toppers, fleurs ou accessoires décoratifs) peuvent ne pas être comestibles.",
      },
      {
        p: "These elements must under no circumstances be consumed and must be removed before cutting or consuming the product.",
        pFr: "Ces éléments ne doivent en aucun cas être consommés et doivent impérativement être retirés avant de découper ou de consommer le produit.",
      },
      {
        p: "It is the Customer's responsibility to remove such elements before the product is consumed. Bento Cake Studio SNC shall not be held responsible in the event of ingestion or improper handling of these elements.",
        pFr: "Il appartient au Client de les retirer avant la consommation du produit. Bento Cake Studio SNC ne saurait être tenue responsable en cas d'ingestion ou de mauvaise manipulation de ces éléments.",
      },
      {
        p: "The Customer is responsible for ensuring that all such elements have been removed before serving the cake, particularly where the cake is intended for children.",
        pFr: "Le Client est responsable de s'assurer que ces éléments ont bien été retirés avant de servir le gâteau, notamment lorsque celui-ci est destiné à des enfants.",
      },
    ],
  },
  {
    id: "13",
    part: "gtc",
    title: "Article 13 – Classes and Workshops",
    titleFr: "Article 13 – Ateliers et workshops",
    blocks: [
      {
        p: "Workshops offered by Bento Cake Studio SNC are available by prior reservation and subject to availability. A reservation is considered final once payment has been validated and a confirmation has been received.",
        pFr: "Les ateliers proposés par Bento Cake Studio SNC sont accessibles sur réservation préalable, dans la limite des places disponibles. La réservation est considérée comme définitive après validation du paiement et réception d'une confirmation.",
      },
      { h: "Cancellation by the Participant", hFr: "Annulation par le participant" },
      {
        p: "Any cancellation request must be communicated to Bento Cake Studio SNC by WhatsApp or telephone at least 7 calendar days before the workshop date in order to qualify for a refund.",
        pFr: "Toute demande d'annulation doit être communiquée à Bento Cake Studio SNC par WhatsApp ou téléphone au minimum 7 jours calendaires avant la date de l'atelier pour pouvoir bénéficier d'un remboursement.",
      },
      {
        p: "After this deadline, no refund will be issued. Failure to attend the workshop also does not entitle the participant to a refund.",
        pFr: "Passé ce délai, aucun remboursement ne pourra être effectué. Toute absence à l'atelier ne donne également droit à aucun remboursement.",
      },
      { h: "Cancellation or Postponement by Bento Cake Studio SNC", hFr: "Annulation ou report par Bento Cake Studio SNC" },
      {
        p: "Bento Cake Studio SNC reserves the right to cancel or postpone a workshop, particularly if the minimum number of participants indicated at the time of booking is not reached.",
        pFr: "Bento Cake Studio SNC se réserve le droit d'annuler ou de reporter un atelier, notamment si le nombre minimum de participants indiqué lors de la réservation n'est pas atteint.",
      },
      {
        p: "Where reasonably possible, affected participants will be informed no later than 72 hours before the start of the workshop. A full refund, credit or transfer to another date will then be offered.",
        pFr: "Dans la mesure du possible, les participants concernés en seront informés au plus tard 72 heures avant le début de l'atelier. Un remboursement intégral, un avoir ou un report sur une autre date leur sera alors proposé.",
      },
      {
        p: "This does not prevent a later cancellation in the event of force majeure, illness, technical problems or any other exceptional event beyond the control of Bento Cake Studio SNC.",
        pFr: "Cette règle n'empêche pas une annulation ultérieure en cas de force majeure, maladie, problème technique ou autre événement exceptionnel indépendant de la volonté de Bento Cake Studio SNC.",
      },
      { h: "Late Arrivals", hFr: "Retards" },
      {
        p: "A maximum tolerance of 15 minutes for late arrival is allowed. The workshop will begin and end at the originally scheduled times, regardless of the participant's arrival time.",
        pFr: "Une tolérance maximale de 15 minutes de retard est accordée. L'atelier débutera et se terminera aux horaires initialement prévus, indépendamment de l'heure d'arrivée du participant.",
      },
      {
        p: "No extension can be guaranteed in the event of late arrival, and the participant must leave the workshop at the scheduled finishing time even if their creation has not been completed.",
        pFr: "Aucun prolongement ne pourra être garanti en cas de retard et le participant devra quitter l'atelier à l'heure de fin prévue, même si sa création n'est pas terminée.",
      },
      {
        p: "A delay of more than 15 minutes may result in the participant being unable to take part in all or part of the workshop, without automatically entitling them to a refund.",
        pFr: "Un retard supérieur à 15 minutes peut entraîner l'impossibilité de participer à tout ou partie de l'atelier, sans droit automatique à un remboursement.",
      },
      { h: "Minor Participants", hFr: "Participants mineurs" },
      {
        p: "Participants under the age of 14 must be accompanied by an adult throughout the workshop.",
        pFr: "Les participants âgés de moins de 14 ans doivent être accompagnés d'un adulte pendant toute la durée de l'atelier.",
      },
      {
        p: "From the age of 14, minor participants may attend without an accompanying adult, subject to the consent of their legal representative.",
        pFr: "À partir de 14 ans, les participants mineurs peuvent participer sans accompagnateur, sous réserve de l'accord de leur représentant légal.",
      },
      {
        p: "Bento Cake Studio SNC reserves the right to request the contact details of a legal representative or emergency contact person.",
        pFr: "Bento Cake Studio SNC se réserve la possibilité de demander les coordonnées d'un représentant légal ou d'une personne à contacter en cas d'urgence.",
      },
      { h: "Allergens", hFr: "Allergènes" },
      {
        p: "Workshops may involve handling products containing, in particular, gluten, eggs, milk, nuts, soy or other allergens.",
        pFr: "Les ateliers peuvent impliquer la manipulation de produits contenant notamment du gluten, des œufs, du lait, des fruits à coque, du soja ou d'autres allergènes.",
      },
      {
        p: "Any allergy or intolerance must be reported before the workshop. Bento Cake Studio SNC cannot guarantee the complete absence of traces or cross-contamination.",
        pFr: "Toute allergie ou intolérance doit être signalée avant l'atelier. Bento Cake Studio SNC ne peut garantir l'absence totale de traces ou de contamination croisée.",
      },
      { h: "Safety, Conduct and Liability", hFr: "Sécurité, comportement et responsabilité" },
      {
        p: "Participants agree to comply with hygiene and safety instructions and with all instructions relating to the use of equipment.",
        pFr: "Les participants s'engagent à respecter les consignes d'hygiène et de sécurité ainsi que les instructions relatives à l'utilisation du matériel.",
      },
      {
        p: "Bento Cake Studio SNC reserves the right to refuse entry to or terminate the participation of any person who appears to be under the influence of alcohol, drugs or any other substance that affects their behaviour or ability to participate safely in the workshop.",
        pFr: "Bento Cake Studio SNC se réserve le droit de refuser l'accès ou d'interrompre la participation de toute personne se présentant manifestement sous l'influence de l'alcool, de drogues ou de toute autre substance altérant son comportement ou sa capacité à participer à l'atelier en toute sécurité.",
      },
      {
        p: "In such cases, no refund may be claimed.",
        pFr: "Dans ce cas, aucun remboursement ne pourra être exigé.",
      },
      {
        p: "Bento Cake Studio SNC shall not be held responsible for any damage resulting from failure to comply with instructions or improper use of equipment.",
        pFr: "Bento Cake Studio SNC ne saurait être tenue responsable d'un dommage résultant du non-respect des consignes ou d'une utilisation inappropriée du matériel.",
      },
      { h: "Photos and Videos", hFr: "Photos et vidéos" },
      {
        p: "Photographs or videos may be taken during certain workshops. Any use or publication allowing a participant to be identified will be carried out with their prior consent.",
        pFr: "Des photographies ou vidéos peuvent être réalisées pendant certains ateliers. Toute utilisation ou publication permettant d'identifier un participant sera effectuée avec son consentement préalable.",
      },
      {
        p: "For minor participants, authorisation from their legal representative may be required.",
        pFr: "Pour les participants mineurs, l'autorisation de leur représentant légal pourra être requise.",
      },
    ],
  },
  {
    id: "14",
    part: "gtc",
    title: "Article 14 – Professional Orders and Special Conditions",
    titleFr: "Article 14 – Commandes professionnelles et conditions particulières",
    blocks: [
      {
        p: "Certain professional orders, large-volume orders, collaborations, events or customised services may be subject to a quotation, contract or specific terms and conditions of sale.",
        pFr: "Certaines commandes professionnelles, commandes en grande quantité, collaborations, événements ou prestations sur mesure peuvent faire l'objet d'un devis, d'un contrat ou de conditions particulières de vente.",
      },
      {
        p: "Where such specific conditions are agreed between Bento Cake Studio SNC and the Customer, they shall prevail over these General Terms and Conditions of Sale with respect to the matters specifically governed by them.",
        pFr: "Lorsque de telles conditions spécifiques sont convenues entre Bento Cake Studio SNC et le Client, elles prévalent sur les présentes Conditions Générales de Vente pour les éléments qu'elles réglementent spécifiquement.",
      },
      {
        p: "For all matters not covered by such specific conditions, these General Terms and Conditions of Sale shall remain applicable.",
        pFr: "Pour tous les points non prévus par ces conditions particulières, les présentes CGV restent applicables.",
      },
    ],
  },
  {
    id: "15",
    part: "gtc",
    title: "Article 15 – Intellectual Property",
    titleFr: "Article 15 – Propriété intellectuelle",
    blocks: [
      {
        p: "All elements of the website, including texts, images, photographs, logos and visuals, are the exclusive property of Bento Cake Studio SNC. Any reproduction or use, whether in whole or in part, without prior written authorisation is strictly prohibited.",
        pFr: "L'ensemble des éléments du site, incluant les textes, images, photographies, logos et visuels, est la propriété exclusive de Bento Cake Studio SNC. Toute reproduction ou utilisation, totale ou partielle, sans autorisation préalable écrite est strictement interdite.",
      },
      {
        p: "Bento Cake Studio SNC reserves the right to photograph and use completed creations for promotional purposes, including on its website, social media and communication materials, unless the Customer submits a written request to the contrary before the product is handed over.",
        pFr: "Bento Cake Studio SNC se réserve le droit de photographier et d'utiliser les créations réalisées à des fins promotionnelles (site internet, réseaux sociaux, supports de communication), sauf demande écrite contraire du Client formulée avant la remise du produit.",
      },
      {
        p: "Materials, documents, visuals, methods and content provided or presented during classes and workshops are intended for personal use only. They may not be reproduced, distributed or commercially exploited without prior authorisation from Bento Cake Studio SNC.",
        pFr: "Les supports, documents, visuels, méthodes et contenus remis ou présentés dans le cadre des ateliers et workshops sont destinés à un usage personnel. Ils ne peuvent être reproduits, diffusés ou exploités à des fins commerciales sans autorisation préalable de Bento Cake Studio SNC.",
      },
    ],
  },
  {
    id: "16",
    part: "gtc",
    title: "Article 16 – Force Majeure",
    titleFr: "Article 16 – Force majeure",
    blocks: [
      {
        p: "Bento Cake Studio SNC shall not be held responsible where a force majeure event prevents or delays the performance of its obligations.",
        pFr: "Bento Cake Studio SNC ne pourra être tenue responsable en cas de survenance d'un événement de force majeure empêchant ou retardant l'exécution de ses obligations.",
      },
      {
        p: "Force majeure events may include, in particular, natural disasters, administrative restrictions, shortages of raw materials, major technical incidents, strikes or any other event that is unforeseeable, unavoidable and beyond the control of Bento Cake Studio SNC.",
        pFr: "Constituent notamment des cas de force majeure : catastrophes naturelles, restrictions administratives, pénuries de matières premières, incidents techniques majeurs, grèves, ou tout événement imprévisible, irrésistible et indépendant de la volonté de Bento Cake Studio SNC.",
      },
    ],
  },
  {
    id: "17",
    part: "gtc",
    title: "Article 17 – Website Availability and Use",
    titleFr: "Article 17 – Disponibilité et utilisation du site",
    blocks: [
      {
        p: "Bento Cake Studio SNC cannot guarantee continuous and uninterrupted operation of the website. Technical issues, maintenance or temporary unavailability may, in particular, prevent or interrupt the ordering or payment process.",
        pFr: "Bento Cake Studio SNC ne peut garantir un fonctionnement continu et sans interruption du site. Des problèmes techniques, opérations de maintenance ou indisponibilités temporaires peuvent notamment empêcher ou interrompre le processus de commande ou de paiement.",
      },
      {
        p: "If it is not possible to place an order through the website, the Customer may contact Bento Cake Studio SNC through the available communication channels in order to enquire about alternative solutions.",
        pFr: "En cas d'impossibilité de passer commande sur le site, le Client peut contacter Bento Cake Studio SNC par les moyens de communication mis à sa disposition afin de connaître les solutions alternatives disponibles.",
      },
      {
        p: "Bento Cake Studio SNC endeavours to provide accurate and up-to-date information on its website. However, no guarantee is given as to the accuracy, reliability or completeness of the information published.",
        pFr: "Bento Cake Studio SNC s'efforce de fournir des informations exactes et à jour sur son site. Toutefois, aucune garantie n'est donnée quant à l'exactitude, la fiabilité ou l'exhaustivité des informations publiées.",
      },
      {
        p: "Use of the website is at the user's own responsibility.",
        pFr: "L'utilisation du site se fait sous la responsabilité de l'utilisateur.",
      },
      {
        p: "To the extent permitted by law, Bento Cake Studio SNC disclaims liability for direct or indirect damage resulting from access to or use of the website.",
        pFr: "Dans les limites autorisées par la loi, Bento Cake Studio SNC décline toute responsabilité pour les dommages directs ou indirects résultant de l'accès ou de l'utilisation du site.",
      },
      {
        p: "The website may contain links to third-party websites over which Bento Cake Studio SNC has no control and for which it assumes no responsibility.",
        pFr: "Le site peut contenir des liens vers des sites tiers sur lesquels Bento Cake Studio SNC n'exerce aucun contrôle et pour lesquels elle décline toute responsabilité.",
      },
    ],
  },
  {
    id: "18",
    part: "gtc",
    title: "Article 18 – Governing Law and Jurisdiction",
    titleFr: "Article 18 – Droit applicable et juridiction compétente",
    blocks: [
      {
        p: "These Terms and Conditions are governed by Swiss law.",
        pFr: "Les présentes CGV sont soumises au droit suisse.",
      },
      {
        p: "Any dispute shall be subject to the exclusive jurisdiction of the courts of the Canton of Geneva, following an attempt to resolve the matter amicably.",
        pFr: "Tout litige sera soumis à la compétence exclusive des tribunaux du canton de Genève, après tentative de résolution amiable.",
      },
      {
        p: "The contractual language is French. In the event that these Terms and Conditions are translated into another language, the French version shall prevail.",
        pFr: "La langue du contrat est le français. En cas de traduction des présentes CGV dans une autre langue, seule la version française fera foi.",
      },
    ],
  },
  {
    id: "19",
    part: "gtc",
    title: "Article 19 – Severability and Amendments to the Terms and Conditions",
    titleFr: "Article 19 – Validité partielle et modification des CGV",
    blocks: [
      {
        p: "If any provision of these Terms and Conditions is declared invalid or unenforceable, the remaining provisions shall remain fully effective.",
        pFr: "Si une disposition des présentes CGV devait être déclarée nulle ou inapplicable, les autres dispositions demeureront pleinement en vigueur.",
      },
      {
        p: "Bento Cake Studio SNC reserves the right to amend these Terms and Conditions at any time.",
        pFr: "Bento Cake Studio SNC se réserve le droit de modifier les présentes CGV à tout moment.",
      },
      {
        p: "For any given order, the applicable version of the Terms and Conditions is the version in force at the time the order is validated.",
        pFr: "Pour une commande donnée, la version applicable des CGV est celle en vigueur au moment de la validation de cette commande.",
      },
    ],
  },
  {
    id: "20",
    part: "privacy",
    title: "Article 20 – Personal Data, Purposes of Processing and Rights",
    titleFr: "Article 20 – Données personnelles, finalités du traitement et droits",
    blocks: [
      {
        p: "Personal data collected is used, in particular, for creating and managing customer accounts, identifying users, managing and tracking orders, maintaining purchase history, communicating with Customers and organising pick-up or delivery.",
        pFr: "Les données personnelles collectées sont utilisées notamment pour la création et la gestion du compte client, l'identification de l'utilisateur, la gestion et le suivi des commandes, l'historique des achats, la communication avec le Client, ainsi que l'organisation du retrait ou de la livraison.",
      },
      {
        p: "Personal data may also be used to send commercial communications and newsletters where the Customer has expressly consented to receive them. Newsletter subscription is optional, and users may unsubscribe at any time using the link provided in each email.",
        pFr: "Elles peuvent également être utilisées pour l'envoi d'informations commerciales et de newsletters lorsque le Client y a expressément consenti. L'inscription à la newsletter est facultative et l'utilisateur peut se désinscrire à tout moment via le lien prévu à cet effet dans chaque e-mail.",
      },
      {
        p: "Data associated with the customer account may also be used to facilitate future orders and improve the user experience on the website.",
        pFr: "Les données liées au compte client peuvent également être utilisées afin de faciliter les prochaines commandes et d'améliorer l'expérience utilisateur sur le site.",
      },
      {
        p: "Data may also be processed where necessary for the administrative and accounting management of the business, the security of the website and compliance with Bento Cake Studio SNC's legal obligations.",
        pFr: "Les données peuvent également être traitées lorsque cela est nécessaire à la gestion administrative et comptable de l'activité, à la sécurisation du site et au respect des obligations légales de Bento Cake Studio SNC.",
      },
      {
        p: "The processing of such data is based, in particular, on the performance of the contractual relationship with the Customer, compliance with applicable legal obligations, consent where required and the legitimate interests of Bento Cake Studio SNC relating to the management and security of its business.",
        pFr: "Le traitement de ces données repose notamment sur l'exécution de la relation contractuelle avec le Client, le respect des obligations légales applicables, le consentement lorsque celui-ci est requis ainsi que les intérêts légitimes de Bento Cake Studio SNC liés à la gestion et à la sécurité de son activité.",
      },
      {
        p: "In accordance with applicable regulations, the Customer may, in particular, request access to their personal data, its correction or deletion and may object to certain processing activities, subject to applicable legal retention obligations.",
        pFr: "Conformément à la réglementation applicable, le Client peut notamment demander l'accès à ses données personnelles, leur rectification ou leur suppression, ainsi que s'opposer à certains traitements, sous réserve des obligations légales de conservation applicables.",
      },
      {
        p: "Any request may be sent to contact@bentocakestudio.ch.",
        pFr: "Toute demande peut être adressée à contact@bentocakestudio.ch.",
      },
      {
        p: "Email communications are not encrypted and may present security risks inherent to this method of transmission.",
        pFr: "Les communications par e-mail ne sont pas chiffrées et peuvent présenter des risques de sécurité inhérents à ce mode de transmission.",
      },
    ],
  },
  {
    id: "21",
    part: "privacy",
    title: "Article 21 – Data Retention",
    titleFr: "Article 21 – Durée de conservation",
    blocks: [
      {
        p: "Personal data is retained only for as long as necessary for the purposes for which it was collected.",
        pFr: "Les données personnelles sont conservées uniquement pour la durée nécessaire aux finalités pour lesquelles elles ont été collectées.",
      },
      {
        p: "Data relating to orders and invoicing is retained in accordance with Swiss legal obligations, generally for a period of 10 years.",
        pFr: "Les données relatives aux commandes et à la facturation sont conservées conformément aux obligations légales suisses, en principe pour une durée de 10 ans.",
      },
    ],
  },
  {
    id: "22",
    part: "privacy",
    title: "Article 22 – Service Providers and Data Transfers",
    titleFr: "Article 22 – Prestataires et transmission des données",
    blocks: [
      {
        p: "Certain personal data may be processed by or transferred to service providers acting on behalf of Bento Cake Studio SNC, particularly in connection with the operation of the website, payment processing, delivery, administrative and accounting management and the sending of communications.",
        pFr: "Certaines données personnelles peuvent être traitées ou transmises à des prestataires intervenant pour le compte de Bento Cake Studio SNC, notamment dans le cadre du fonctionnement du site, du traitement des paiements, de la livraison, de la gestion administrative et comptable, ainsi que de l'envoi de communications.",
      },
      {
        p: "Only the data necessary to perform these services is shared.",
        pFr: "Seules les données nécessaires à l'exécution de ces prestations sont transmises.",
      },
      {
        p: "The relevant service providers are required to respect the confidentiality and security of the data.",
        pFr: "Les prestataires concernés sont tenus de respecter la confidentialité et la sécurité des données.",
      },
      {
        p: "Personal data is not sold to third parties or transferred to third parties for their own independent commercial purposes.",
        pFr: "Les données personnelles ne sont pas vendues à des tiers ni transmises à des tiers à des fins commerciales indépendantes.",
      },
    ],
  },
  {
    id: "23",
    part: "privacy",
    title: "Article 23 – Cookies and Audience Measurement",
    titleFr: "Article 23 – Cookies et mesure d'audience",
    blocks: [
      {
        p: "The website uses cookies and similar technologies necessary for its proper operation, including for managing authentication and user sessions, securing account access and remembering certain preferences.",
        pFr: "Le site utilise des cookies et technologies similaires nécessaires à son bon fonctionnement, notamment pour la gestion de l'authentification, des sessions utilisateur, la sécurisation des accès et la mémorisation de certaines préférences.",
      },
      {
        p: "The website may also use audience measurement tools, including Google Analytics, in order to better understand how the website is used and to improve its functionality and content.",
        pFr: "Le site peut également utiliser des outils de mesure d'audience, notamment Google Analytics, afin de mieux comprendre l'utilisation du site et d'améliorer ses fonctionnalités et son contenu.",
      },
      {
        p: "Audience measurement cookies are activated only in accordance with the choices expressed by the user through the cookie management banner. Users may change their preferences at any time.",
        pFr: "Les cookies de mesure d'audience ne sont activés qu'en fonction des choix exprimés par l'utilisateur via le bandeau de gestion des cookies. L'utilisateur peut modifier ses préférences à tout moment.",
      },
      {
        p: "No advertising cookies are used unless otherwise stated in a future version of this Privacy Policy.",
        pFr: "Aucun cookie publicitaire n'est utilisé, sauf indication contraire communiquée ultérieurement dans la présente politique.",
      },
    ],
  },
  {
    id: "24",
    part: "privacy",
    title: "Article 24 – Hosting and Data Security",
    titleFr: "Article 24 – Hébergement et sécurité des données",
    blocks: [
      {
        p: "The website and the data required for its operation are hosted and processed by specialised technical service providers.",
        pFr: "Le site et les données nécessaires à son fonctionnement sont hébergés et traités par des prestataires techniques spécialisés.",
      },
      {
        p: "Bento Cake Studio SNC implements appropriate technical and organisational measures to protect personal data against unauthorised access, loss, destruction, alteration or disclosure.",
        pFr: "Bento Cake Studio SNC met en œuvre des mesures techniques et organisationnelles appropriées afin de protéger les données personnelles contre tout accès non autorisé, perte, destruction, modification ou divulgation.",
      },
      {
        p: "However, no transmission of data over the Internet can be guaranteed to be completely secure.",
        pFr: "Toutefois, aucune transmission de données via Internet ne peut être garantie comme totalement sécurisée.",
      },
    ],
  },
  {
    id: "25",
    part: "privacy",
    title: "Article 25 – Amendments to the Privacy Policy",
    titleFr: "Article 25 – Modification de la politique de confidentialité",
    blocks: [
      {
        p: "Bento Cake Studio SNC reserves the right to amend this Privacy Policy in order to reflect, in particular, changes to its services, technical tools or applicable regulations.",
        pFr: "Bento Cake Studio SNC se réserve le droit de modifier la présente Politique de confidentialité afin de tenir compte notamment de l'évolution de ses services, de ses outils techniques ou de la réglementation applicable.",
      },
      {
        p: "The version currently in force is the version published on the website at the time of consultation.",
        pFr: "La version en vigueur est celle publiée sur le site au moment de la consultation.",
      },
      {
        p: "Last updated: 08.09.2026",
        pFr: "Dernière mise à jour : 08.09.2026",
      },
    ],
  },
];

const Legal = () => {
  const { t } = useLang();

  const renderArticle = (article: Article) => (
    <AccordionItem key={article.id} value={article.id}>
      <AccordionTrigger className="text-left font-medium" style={{ color: "#78020E" }}>
        {t(article.title, article.titleFr)}
      </AccordionTrigger>
      <AccordionContent>
        <div className="space-y-3">
          {article.blocks.map((block, i) =>
            "h" in block ? (
              <p key={i} className="font-semibold text-foreground pt-2">
                {t(block.h, block.hFr)}
              </p>
            ) : (
              <p key={i} className="text-muted-foreground whitespace-pre-line leading-relaxed">
                {t(block.p, block.pFr)}
              </p>
            ),
          )}
        </div>
      </AccordionContent>
    </AccordionItem>
  );

  const sectionHeadingClass =
    "font-sans uppercase tracking-[0.105em] text-lg md:text-xl text-foreground mb-4 font-semibold";

  return (
    <Layout>
      <div className="container mx-auto px-4 py-16 max-w-3xl">
        <h1 className="font-sans uppercase tracking-[0.105em] text-2xl md:text-4xl text-center text-foreground mb-2 font-semibold">
          {t(
            "Legal Notice, General Terms and Conditions of Sale and Privacy Policy",
            "Mentions légales, Conditions générales de vente et Politique de confidentialité",
          )}
        </h1>
        <p className="text-center text-muted-foreground mb-10">Bento Cake Studio SNC</p>

        <h2 className={sectionHeadingClass}>
          {t("I. General Terms and Conditions of Sale", "I. Conditions générales de vente")}
        </h2>
        <Accordion type="multiple" className="w-full mb-12">
          {articles.filter((a) => a.part === "gtc").map(renderArticle)}
        </Accordion>

        <h2 className={sectionHeadingClass}>
          {t("II. Privacy Policy", "II. Politique de confidentialité")}
        </h2>
        <Accordion type="multiple" className="w-full">
          {articles.filter((a) => a.part === "privacy").map(renderArticle)}
        </Accordion>
      </div>
    </Layout>
  );
};

export default Legal;
