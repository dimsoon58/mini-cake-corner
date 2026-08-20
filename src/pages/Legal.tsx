import Layout from "@/components/Layout";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useLang } from "@/context/LanguageContext";

const articles = [
  {
    id: "1",
    title: "Article 1 – Legal Notice",
    titleFr: "Article 1 – Mentions légales",
    content: `Bento Cake Studio SNC
58 chemin de la Gradelle
1224 Chêne-Bougeries
Switzerland
Email: contact@bentocakestudio.ch

This website is published and operated by Bento Cake Studio SNC.`,
    contentFr: `Bento Cake Studio SNC
58 chemin de la Gradelle
1224 Chêne-Bougeries
Suisse
E-mail : contact@bentocakestudio.ch

Ce site est publié et exploité par Bento Cake Studio SNC.`,
  },
  {
    id: "2",
    title: "Article 2 – Purpose",
    titleFr: "Article 2 – Objet",
    content: `These General Terms and Conditions of Sale (the "GTC") govern the purchase of products offered by Bento Cake Studio SNC through its online ordering platform.

By placing an order on this website, the Customer acknowledges having read and fully accepted these GTC without reservation.`,
    contentFr: `Les présentes Conditions Générales de Vente (les « CGV ») régissent l'achat des produits proposés par Bento Cake Studio SNC par l'intermédiaire de sa plateforme de commande en ligne.

En passant commande sur ce site, le Client reconnaît avoir pris connaissance des présentes CGV et les accepter pleinement et sans réserve.`,
  },
  {
    id: "3",
    title: "Article 3 – Products",
    titleFr: "Article 3 – Produits",
    content: `The products offered are handcrafted pastries, individually made to order with the utmost care and attention to detail. Photographs, visuals, and descriptions are provided for illustrative purposes only.

Due to the artisanal nature of our creations and the availability of materials at the time of production, subtle variations in color, shape, finishing, or decoration may occur. Such variations are inherent to handcrafted production and do not constitute grounds for complaint.

When the Customer provides a photograph or inspiration image, it serves as a creative reference only. Bento Cake Studio SNC undertakes to create a product inspired by the submitted model and to make its best efforts to respect the requested colors, style, and overall aesthetic. Each creation remains a unique interpretation and does not guarantee identical reproduction.`,
    contentFr: `Les produits proposés sont des pâtisseries artisanales, confectionnées individuellement sur commande avec le plus grand soin et une attention particulière portée aux détails. Les photographies, visuels et descriptions sont fournis à titre illustratif uniquement.

En raison du caractère artisanal de nos créations et de la disponibilité des matières premières au moment de la production, de légères variations de couleur, de forme, de finition ou de décoration peuvent survenir. De telles variations sont inhérentes à une fabrication artisanale et ne sauraient constituer un motif de réclamation.

Lorsque le Client transmet une photographie ou une image d'inspiration, celle-ci constitue une simple référence créative. Bento Cake Studio SNC s'engage à réaliser un produit inspiré du modèle transmis et à mettre en œuvre ses meilleurs efforts pour respecter les couleurs, le style et l'esthétique générale demandés. Chaque création demeure une interprétation unique et ne garantit pas une reproduction à l'identique.`,
  },
  {
    id: "4",
    title: "Article 4 – Orders",
    titleFr: "Article 4 – Commandes",
    content: `Orders are placed exclusively online. The Customer undertakes to provide accurate and complete information, including selected products and options, any personalized message, and valid contact details.

In the event of error or omission in the information provided, particularly regarding delivery address or contact details, Bento Cake Studio SNC shall not be held liable for any inability or delay in fulfilling the order.

The information and presentations displayed on the website do not constitute a legally binding offer.

An order becomes final only after validation and confirmation of payment. A confirmation email will be sent to the Customer.

Bento Cake Studio SNC reserves the right to refuse any abnormal, incomplete, or fraudulent order.

Computerized records maintained by Bento Cake Studio SNC shall constitute valid proof of transactions carried out.`,
    contentFr: `Les commandes sont passées exclusivement en ligne. Le Client s'engage à fournir des informations exactes et complètes, notamment les produits et options sélectionnés, tout message personnalisé ainsi que des coordonnées valides.

En cas d'erreur ou d'omission dans les informations communiquées, notamment s'agissant de l'adresse de livraison ou des coordonnées, Bento Cake Studio SNC ne saurait être tenue responsable de l'impossibilité d'exécuter la commande ou d'un retard dans son exécution.

Les informations et présentations figurant sur le site ne constituent pas une offre juridiquement contraignante.

La commande n'est définitive qu'après validation et confirmation du paiement. Un courriel de confirmation est adressé au Client.

Bento Cake Studio SNC se réserve le droit de refuser toute commande anormale, incomplète ou frauduleuse.

Les registres informatisés conservés par Bento Cake Studio SNC constituent une preuve valable des transactions effectuées.`,
  },
  {
    id: "5",
    title: "Article 5 – Modification and Cancellation",
    titleFr: "Article 5 – Modification et annulation",
    content: `Each creation is custom-designed and made to order. Any confirmed order initiates production and the reservation of specific raw materials.

Any cancellation request must be submitted in writing or via the website at least five (5) calendar days prior to the scheduled pickup or delivery date.

In such case, a refund may be granted, less any costs already incurred in preparation of the order.

After this five-day period, no refund may be granted, as production elements will have been committed.

Modification requests remain possible up to five (5) days before the scheduled date, subject to feasibility and potential price adjustment.

In the event of exceptional unavailability of a product or ingredient beyond our control, an equivalent alternative respecting the spirit and quality of the original creation will be proposed. If no solution is suitable, a credit note or refund may be issued.

The cancellation or postponement of a personal event (birthday, wedding, reception, or similar) does not constitute grounds for refund outside the conditions set forth in this Article.`,
    contentFr: `Chaque création est conçue sur mesure et confectionnée sur commande. Toute commande confirmée déclenche la production ainsi que la réservation de matières premières spécifiques.

Toute demande d'annulation doit être adressée par écrit ou via le site au moins cinq (5) jours calendaires avant la date de retrait ou de livraison prévue.

Dans ce cas, un remboursement peut être accordé, déduction faite des frais déjà engagés pour la préparation de la commande.

Passé ce délai de cinq jours, aucun remboursement ne pourra être accordé, les éléments de production ayant été engagés.

Les demandes de modification demeurent possibles jusqu'à cinq (5) jours avant la date prévue, sous réserve de faisabilité et d'un éventuel ajustement de prix.

En cas d'indisponibilité exceptionnelle d'un produit ou d'un ingrédient indépendante de notre volonté, une alternative équivalente respectant l'esprit et la qualité de la création initiale sera proposée. Si aucune solution ne convient, un avoir ou un remboursement pourra être délivré.

L'annulation ou le report d'un événement personnel (anniversaire, mariage, réception ou similaire) ne constitue pas un motif de remboursement en dehors des conditions prévues au présent article.`,
  },
  {
    id: "6",
    title: "Article 6 – Prices",
    titleFr: "Article 6 – Prix",
    content: `Prices are indicated in Swiss Francs (CHF). Bento Cake Studio SNC is not subject to Swiss Value Added Tax (VAT); therefore, VAT is not applicable in accordance with Swiss legislation.

Delivery fees, where applicable, are specified at checkout. Prices applied are those in force at the time of order confirmation and cannot be modified thereafter.`,
    contentFr: `Les prix sont indiqués en francs suisses (CHF). Bento Cake Studio SNC n'est pas assujettie à la taxe sur la valeur ajoutée (TVA) suisse ; la TVA n'est dès lors pas applicable conformément à la législation suisse.

Les frais de livraison, le cas échéant, sont précisés lors du paiement. Les prix appliqués sont ceux en vigueur au moment de la confirmation de la commande et ne peuvent être modifiés ultérieurement.`,
  },
  {
    id: "7",
    title: "Article 7 – Payment Terms",
    titleFr: "Article 7 – Modalités de paiement",
    content: `Payment is made exclusively online at the time of order validation.

Accepted payment methods include credit/debit cards and TWINT. Transactions are securely processed via the PostFinance payment platform.

An order is considered final only upon confirmation of payment.

Bento Cake Studio SNC does not store any banking details. Payment information is processed directly by the payment provider in accordance with its own security policies.

Transfer of ownership of the products occurs only upon full payment of the purchase price.`,
    contentFr: `Le paiement s'effectue exclusivement en ligne au moment de la validation de la commande.

Les moyens de paiement acceptés sont les cartes de crédit/débit et TWINT. Les transactions sont traitées de manière sécurisée via la plateforme de paiement PostFinance.

Une commande n'est réputée définitive qu'après confirmation du paiement.

Bento Cake Studio SNC ne conserve aucune donnée bancaire. Les informations de paiement sont traitées directement par le prestataire de paiement conformément à ses propres politiques de sécurité.

Le transfert de propriété des produits n'intervient qu'après paiement intégral du prix de vente.`,
  },
  {
    id: "8",
    title: "Article 8 – Collection and Delivery",
    titleFr: "Article 8 – Retrait et livraison",
    content: `The Customer may choose in-store pickup or delivery to the address indicated at checkout.

Agreed pickup times must be respected. Pickup is available until the final collection time communicated to the Customer. In case of unforeseen delay, the Customer must inform Bento Cake Studio SNC promptly. Without notification and beyond the pickup deadline, the order will be considered uncollected and no refund shall be issued due to the perishable nature of the products.

For in-store pickup, transport of the products is carried out under the sole responsibility of the Customer. Bento Cake Studio SNC shall not be held liable for any deterioration occurring after handover, particularly due to improper handling, unsuitable transport, or inadequate storage.

For delivery, the service is entrusted to an independent third-party provider. Liability transfers upon handover of the product to the appointed carrier, at which point risk passes to the Customer. Delivery conditions and timelines fall under the responsibility of the appointed provider.`,
    contentFr: `Le Client peut choisir le retrait sur place ou la livraison à l'adresse indiquée lors du paiement.

Les horaires de retrait convenus doivent être respectés. Le retrait est possible jusqu'à l'heure limite communiquée au Client. En cas de retard imprévu, le Client doit en informer Bento Cake Studio SNC dans les meilleurs délais. À défaut d'information et au-delà de l'heure limite de retrait, la commande sera considérée comme non retirée et aucun remboursement ne sera accordé en raison du caractère périssable des produits.

En cas de retrait sur place, le transport des produits s'effectue sous la seule responsabilité du Client. Bento Cake Studio SNC ne saurait être tenue responsable d'une quelconque détérioration survenue après la remise, notamment en raison d'une manipulation inappropriée, d'un transport inadapté ou d'une conservation inadéquate.

En cas de livraison, la prestation est confiée à un prestataire tiers indépendant. La responsabilité est transférée lors de la remise du produit au transporteur désigné, moment auquel les risques passent au Client. Les conditions et délais de livraison relèvent de la responsabilité du prestataire désigné.`,
  },
  {
    id: "9",
    title: "Article 9 – Complaints",
    titleFr: "Article 9 – Réclamations",
    content: `Any complaint must be submitted within 48 hours of pickup or delivery by email to contact@bentocakestudio.ch.

All complaints must be accompanied by photographs of the concerned product to allow proper assessment. After this period, no complaint shall be accepted.`,
    contentFr: `Toute réclamation doit être adressée dans les 48 heures suivant le retrait ou la livraison, par courriel à contact@bentocakestudio.ch.

Toute réclamation doit être accompagnée de photographies du produit concerné afin d'en permettre une appréciation adéquate. Passé ce délai, aucune réclamation ne sera acceptée.`,
  },
  {
    id: "10",
    title: "Article 10 – Right of Withdrawal",
    titleFr: "Article 10 – Droit de rétractation",
    content: `In accordance with applicable legislation, the right of withdrawal does not apply to fresh or perishable goods or to personalized products made to order. No refund shall be issued once the order has been prepared or handed over to the Customer.`,
    contentFr: `Conformément à la législation applicable, le droit de rétractation ne s'applique pas aux denrées fraîches ou périssables ni aux produits personnalisés confectionnés sur commande. Aucun remboursement ne sera accordé une fois la commande préparée ou remise au Client.`,
  },
  {
    id: "11",
    title: "Article 11 – Liability",
    titleFr: "Article 11 – Responsabilité",
    content: `Bento Cake Studio SNC shall not be held liable for improper storage or handling of products by the Customer, consumption beyond recommended timeframes, or allergic reactions provided that product composition is indicated.

The list of allergens may be communicated upon request. It is the Customer's responsibility to report any allergy or food intolerance at the time of ordering.

Products are manufactured, handled, and stored in compliance with hygiene standards and food regulations in force in Switzerland.

Products must be stored according to the instructions provided at pickup or indicated on packaging. Unless otherwise stated, fresh products, particularly those containing whipped cream, must be stored refrigerated between 0°C and 4°C and consumed the same day or as soon as possible. Prolonged exposure to room temperature may compromise the quality and structure of the product and should be avoided. Products must not be refrozen.

Certain decorative elements (internal supports, picks, toppers, flowers, or accessories) may not be edible and must be removed prior to consumption. Bento Cake Studio SNC declines all liability in the event of improper handling or ingestion of such elements.`,
    contentFr: `Bento Cake Studio SNC ne saurait être tenue responsable d'une conservation ou d'une manipulation inappropriée des produits par le Client, d'une consommation au-delà des délais recommandés, ni de réactions allergiques pour autant que la composition des produits soit indiquée.

La liste des allergènes peut être communiquée sur demande. Il appartient au Client de signaler toute allergie ou intolérance alimentaire au moment de la commande.

Les produits sont fabriqués, manipulés et conservés dans le respect des normes d'hygiène et de la réglementation alimentaire en vigueur en Suisse.

Les produits doivent être conservés conformément aux instructions communiquées lors du retrait ou indiquées sur l'emballage. Sauf indication contraire, les produits frais, en particulier ceux contenant de la crème fouettée, doivent être conservés au réfrigérateur entre 0°C et 4°C et consommés le jour même ou dans les meilleurs délais. Une exposition prolongée à température ambiante peut compromettre la qualité et la structure du produit et doit être évitée. Les produits ne doivent pas être recongelés.

Certains éléments décoratifs (supports internes, piques, toppers, fleurs ou accessoires) peuvent ne pas être comestibles et doivent être retirés avant consommation. Bento Cake Studio SNC décline toute responsabilité en cas de manipulation inappropriée ou d'ingestion de tels éléments.`,
  },
  {
    id: "12",
    title: "Article 12 – Intellectual Property",
    titleFr: "Article 12 – Propriété intellectuelle",
    content: `All elements of the website, including texts, images, photographs, logos, and visuals, are the exclusive property of Bento Cake Studio SNC. Any reproduction or use, in whole or in part, without prior written authorization is strictly prohibited.

Bento Cake Studio SNC reserves the right to photograph and use its creations for promotional purposes (website, social media, and marketing materials), unless the Customer expressly objects in writing prior to product handover.`,
    contentFr: `L'ensemble des éléments du site, notamment les textes, images, photographies, logos et visuels, sont la propriété exclusive de Bento Cake Studio SNC. Toute reproduction ou utilisation, totale ou partielle, sans autorisation écrite préalable est strictement interdite.

Bento Cake Studio SNC se réserve le droit de photographier et d'utiliser ses créations à des fins promotionnelles (site internet, réseaux sociaux et supports marketing), sauf opposition expresse et écrite du Client avant la remise du produit.`,
  },
  {
    id: "13",
    title: "Article 13 – Personal Data",
    titleFr: "Article 13 – Données personnelles",
    content: `Personal data collected are used solely for order management, communication with the Customer, organization of pickup or delivery, and newsletter distribution where expressly consented to.

The Customer has the right to access, rectify, or delete personal data by contacting contact@bentocakestudio.ch.

Please note that email communications are not encrypted and may present inherent security risks associated with this method of transmission.`,
    contentFr: `Les données personnelles collectées sont utilisées uniquement pour la gestion des commandes, la communication avec le Client, l'organisation du retrait ou de la livraison, ainsi que l'envoi de la newsletter lorsque le Client y a expressément consenti.

Le Client dispose d'un droit d'accès, de rectification et de suppression de ses données personnelles en écrivant à contact@bentocakestudio.ch.

Il est précisé que les communications par courriel ne sont pas chiffrées et peuvent présenter les risques de sécurité inhérents à ce mode de transmission.`,
  },
  {
    id: "14",
    title: "Article 14 – Cookies",
    titleFr: "Article 14 – Cookies",
    content: `The website uses only strictly necessary cookies and storage technologies required for proper operation.

These include:
• User authentication and session management
• Account access security
• Storage of cookie preferences
• Technical functionality of the website

Session data are retained for a limited duration (approximately 1 hour for access tokens, automatically renewed, and up to 7 days for refresh tokens).

No advertising, marketing tracking, or analytics cookies are currently used.

As these technologies are essential for website functionality, they cannot be disabled.`,
    contentFr: `Le site utilise uniquement des cookies et technologies de stockage strictement nécessaires à son bon fonctionnement.

Il s'agit notamment de :
• L'authentification des utilisateurs et la gestion des sessions
• La sécurité de l'accès aux comptes
• L'enregistrement des préférences en matière de cookies
• Le fonctionnement technique du site

Les données de session sont conservées pour une durée limitée (environ 1 heure pour les jetons d'accès, renouvelés automatiquement, et jusqu'à 7 jours pour les jetons de rafraîchissement).

Aucun cookie publicitaire, de suivi marketing ou de mesure d'audience n'est actuellement utilisé.

Ces technologies étant indispensables au fonctionnement du site, elles ne peuvent pas être désactivées.`,
  },
  {
    id: "15",
    title: "Article 15 – Hosting and Security",
    titleFr: "Article 15 – Hébergement et sécurité",
    content: `The website is created and hosted via the Lovable platform. Personal data are stored on secure servers and accessible only to technical service providers necessary for website operation.

Bento Cake Studio SNC implements appropriate technical and organizational measures to ensure data security and confidentiality.`,
    contentFr: `Le site est créé et hébergé via la plateforme Lovable. Les données personnelles sont stockées sur des serveurs sécurisés et accessibles uniquement aux prestataires techniques nécessaires à l'exploitation du site.

Bento Cake Studio SNC met en œuvre des mesures techniques et organisationnelles appropriées afin d'assurer la sécurité et la confidentialité des données.`,
  },
  {
    id: "16",
    title: "Article 16 – Force Majeure",
    titleFr: "Article 16 – Force majeure",
    content: `Bento Cake Studio SNC shall not be held liable in the event of force majeure preventing or delaying performance of its obligations. Force majeure includes, but is not limited to, natural disasters, administrative restrictions, raw material shortages, major technical incidents, strikes, or any unforeseeable and irresistible event beyond its control.`,
    contentFr: `Bento Cake Studio SNC ne saurait être tenue responsable en cas de force majeure empêchant ou retardant l'exécution de ses obligations. Constituent notamment des cas de force majeure, sans que cette liste soit exhaustive, les catastrophes naturelles, les restrictions administratives, les pénuries de matières premières, les incidents techniques majeurs, les grèves ou tout événement imprévisible et irrésistible échappant à son contrôle.`,
  },
  {
    id: "17",
    title: "Article 17 – Governing Law and Jurisdiction",
    titleFr: "Article 17 – Droit applicable et for judiciaire",
    content: `These GTC are governed by Swiss law.

Any dispute shall be subject to the exclusive jurisdiction of the courts of the Canton of Geneva, following an attempt at amicable resolution.

The language of the contract is French. In the event of translation into another language, only the French version shall prevail.`,
    contentFr: `Les présentes CGV sont soumises au droit suisse.

Tout litige relève de la compétence exclusive des tribunaux du canton de Genève, après tentative de résolution amiable.

La langue du contrat est le français. En cas de traduction dans une autre langue, seule la version française fait foi.`,
  },
  {
    id: "18",
    title: "Article 18 – Purpose and Legal Basis of Processing",
    titleFr: "Article 18 – Finalités et bases légales du traitement",
    content: `Personal data collected via the website are processed for:
• Order management and contract execution
• Customer communication
• Administrative and accounting management
• Website security and proper operation

Processing is based on:
• Contract performance
• Compliance with legal obligations
• Legitimate interest in managing and securing business operations`,
    contentFr: `Les données personnelles collectées via le site sont traitées aux fins suivantes :
• La gestion des commandes et l'exécution du contrat
• La communication avec le Client
• La gestion administrative et comptable
• La sécurité et le bon fonctionnement du site

Le traitement repose sur :
• L'exécution du contrat
• Le respect des obligations légales
• L'intérêt légitime à gérer et sécuriser l'activité commerciale`,
  },
  {
    id: "19",
    title: "Article 19 – Data Retention Period",
    titleFr: "Article 19 – Durée de conservation des données",
    content: `Personal data are retained only for the duration necessary for their intended purposes.

Order and billing data are retained in accordance with Swiss legal obligations, generally for a period of ten (10) years.`,
    contentFr: `Les données personnelles ne sont conservées que pendant la durée nécessaire aux finalités poursuivies.

Les données relatives aux commandes et à la facturation sont conservées conformément aux obligations légales suisses, en principe pendant une durée de dix (10) ans.`,
  },
  {
    id: "20",
    title: "Article 20 – Service Providers and Data Transfer",
    titleFr: "Article 20 – Prestataires et transfert de données",
    content: `Certain data may be processed by technical service providers acting on behalf of Bento Cake Studio SNC, including for hosting, authentication, and payment processing.

Such providers are bound by confidentiality and data security obligations.

Personal data are not sold or transferred to third parties for commercial purposes.`,
    contentFr: `Certaines données peuvent être traitées par des prestataires techniques agissant pour le compte de Bento Cake Studio SNC, notamment pour l'hébergement, l'authentification et le traitement des paiements.

Ces prestataires sont tenus à des obligations de confidentialité et de sécurité des données.

Les données personnelles ne sont ni vendues ni transmises à des tiers à des fins commerciales.`,
  },
  {
    id: "21",
    title: "Article 21 – Data Security",
    titleFr: "Article 21 – Sécurité des données",
    content: `Bento Cake Studio SNC implements appropriate technical and organizational measures to protect personal data against unauthorized access, loss, destruction, or disclosure.

However, no data transmission over the Internet can be guaranteed as completely secure.`,
    contentFr: `Bento Cake Studio SNC met en œuvre des mesures techniques et organisationnelles appropriées afin de protéger les données personnelles contre tout accès non autorisé, perte, destruction ou divulgation.

Toutefois, aucune transmission de données sur Internet ne peut être garantie comme entièrement sécurisée.`,
  },
  {
    id: "22",
    title: "Article 22 – Limitation of Liability",
    titleFr: "Article 22 – Limitation de responsabilité",
    content: `Bento Cake Studio SNC strives to provide accurate and up-to-date information on its website. However, no guarantee is given regarding the accuracy, reliability, or completeness of published information.

Use of the website is at the user's own risk.

To the extent permitted by law, Bento Cake Studio SNC disclaims liability for any direct or indirect damages resulting from access to or use of the website.

The website may contain links to third-party websites over which Bento Cake Studio SNC has no control and assumes no responsibility.`,
    contentFr: `Bento Cake Studio SNC s'efforce de fournir des informations exactes et à jour sur son site. Aucune garantie n'est toutefois donnée quant à l'exactitude, la fiabilité ou l'exhaustivité des informations publiées.

L'utilisation du site s'effectue aux risques et périls de l'utilisateur.

Dans les limites autorisées par la loi, Bento Cake Studio SNC décline toute responsabilité pour tout dommage direct ou indirect résultant de l'accès au site ou de son utilisation.

Le site peut contenir des liens vers des sites tiers sur lesquels Bento Cake Studio SNC n'exerce aucun contrôle et n'assume aucune responsabilité.`,
  },
  {
    id: "23",
    title: "Article 23 – Severability",
    titleFr: "Article 23 – Divisibilité",
    content: `If any provision of these GTC is declared invalid or unenforceable, the remaining provisions shall remain fully in effect.`,
    contentFr: `Si une disposition des présentes CGV est déclarée nulle ou inapplicable, les autres dispositions demeurent pleinement en vigueur.`,
  },
  {
    id: "24",
    title: "Article 24 – Modification of the GTC",
    titleFr: "Article 24 – Modification des CGV",
    content: `Bento Cake Studio SNC reserves the right to modify these GTC at any time.

The applicable version is the one published on the website at the date of consultation.

Last updated: 26.02.2026`,
    contentFr: `Bento Cake Studio SNC se réserve le droit de modifier les présentes CGV à tout moment.

La version applicable est celle publiée sur le site à la date de consultation.

Dernière mise à jour : 26.02.2026`,
  },
];

const Legal = () => {
  const { t } = useLang();

  return (
    <Layout>
      <div className="container mx-auto px-4 py-16 max-w-3xl">
        <h1 className="font-sans uppercase tracking-[0.105em] text-3xl md:text-4xl text-center text-foreground mb-2">
          {t("Legal Notice, Terms and Conditions of Sale & Privacy Policy", "Mentions légales, Conditions générales de vente et Politique de confidentialité")}
        </h1>
        <p className="text-center text-muted-foreground mb-10">
          Bento Cake Studio SNC
        </p>

        <Accordion type="multiple" className="w-full">
          {articles.map((article) => (
            <AccordionItem key={article.id} value={article.id}>
              <AccordionTrigger className="text-left font-medium" style={{ color: '#78020E' }}>
                {t(article.title, article.titleFr)}
              </AccordionTrigger>
              <AccordionContent>
                <p className="text-muted-foreground whitespace-pre-line leading-relaxed">
                  {t(article.content, article.contentFr)}
                </p>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </Layout>
  );
};

export default Legal;
