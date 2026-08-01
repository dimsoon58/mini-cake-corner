# -*- coding: utf-8 -*-
import io, os, re, json

path = "/sessions/rcw-01d8yvniirrtjcjqoatid7yj/mnt/mini-cake-corner/src/pages/Legal.tsx"

FR = {}

FR["1"] = ("Article 1 – Mentions légales", """Bento Cake Studio SNC
58 chemin de la Gradelle
1224 Chêne-Bougeries
Suisse
E-mail : contact@bentocakestudio.ch

Ce site est publié et exploité par Bento Cake Studio SNC.""")

FR["2"] = ("Article 2 – Objet", """Les présentes Conditions Générales de Vente (les « CGV ») régissent l'achat des produits proposés par Bento Cake Studio SNC par l'intermédiaire de sa plateforme de commande en ligne.

En passant commande sur ce site, le Client reconnaît avoir pris connaissance des présentes CGV et les accepter pleinement et sans réserve.""")

FR["3"] = ("Article 3 – Produits", """Les produits proposés sont des pâtisseries artisanales, confectionnées individuellement sur commande avec le plus grand soin et une attention particulière portée aux détails. Les photographies, visuels et descriptions sont fournis à titre illustratif uniquement.

En raison du caractère artisanal de nos créations et de la disponibilité des matières premières au moment de la production, de légères variations de couleur, de forme, de finition ou de décoration peuvent survenir. De telles variations sont inhérentes à une fabrication artisanale et ne sauraient constituer un motif de réclamation.

Lorsque le Client transmet une photographie ou une image d'inspiration, celle-ci constitue une simple référence créative. Bento Cake Studio SNC s'engage à réaliser un produit inspiré du modèle transmis et à mettre en œuvre ses meilleurs efforts pour respecter les couleurs, le style et l'esthétique générale demandés. Chaque création demeure une interprétation unique et ne garantit pas une reproduction à l'identique.""")

FR["4"] = ("Article 4 – Commandes", """Les commandes sont passées exclusivement en ligne. Le Client s'engage à fournir des informations exactes et complètes, notamment les produits et options sélectionnés, tout message personnalisé ainsi que des coordonnées valides.

En cas d'erreur ou d'omission dans les informations communiquées, notamment s'agissant de l'adresse de livraison ou des coordonnées, Bento Cake Studio SNC ne saurait être tenue responsable de l'impossibilité d'exécuter la commande ou d'un retard dans son exécution.

Les informations et présentations figurant sur le site ne constituent pas une offre juridiquement contraignante.

La commande n'est définitive qu'après validation et confirmation du paiement. Un courriel de confirmation est adressé au Client.

Bento Cake Studio SNC se réserve le droit de refuser toute commande anormale, incomplète ou frauduleuse.

Les registres informatisés conservés par Bento Cake Studio SNC constituent une preuve valable des transactions effectuées.""")

FR["5"] = ("Article 5 – Modification et annulation", """Chaque création est conçue sur mesure et confectionnée sur commande. Toute commande confirmée déclenche la production ainsi que la réservation de matières premières spécifiques.

Toute demande d'annulation doit être adressée par écrit ou via le site au moins cinq (5) jours calendaires avant la date de retrait ou de livraison prévue.

Dans ce cas, un remboursement peut être accordé, déduction faite des frais déjà engagés pour la préparation de la commande.

Passé ce délai de cinq jours, aucun remboursement ne pourra être accordé, les éléments de production ayant été engagés.

Les demandes de modification demeurent possibles jusqu'à cinq (5) jours avant la date prévue, sous réserve de faisabilité et d'un éventuel ajustement de prix.

En cas d'indisponibilité exceptionnelle d'un produit ou d'un ingrédient indépendante de notre volonté, une alternative équivalente respectant l'esprit et la qualité de la création initiale sera proposée. Si aucune solution ne convient, un avoir ou un remboursement pourra être délivré.

L'annulation ou le report d'un événement personnel (anniversaire, mariage, réception ou similaire) ne constitue pas un motif de remboursement en dehors des conditions prévues au présent article.""")

FR["6"] = ("Article 6 – Prix", """Les prix sont indiqués en francs suisses (CHF). Bento Cake Studio SNC n'est pas assujettie à la taxe sur la valeur ajoutée (TVA) suisse ; la TVA n'est dès lors pas applicable conformément à la législation suisse.

Les frais de livraison, le cas échéant, sont précisés lors du paiement. Les prix appliqués sont ceux en vigueur au moment de la confirmation de la commande et ne peuvent être modifiés ultérieurement.""")

FR["7"] = ("Article 7 – Modalités de paiement", """Le paiement s'effectue exclusivement en ligne au moment de la validation de la commande.

Les moyens de paiement acceptés sont les cartes de crédit/débit et TWINT. Les transactions sont traitées de manière sécurisée via la plateforme de paiement Stripe.

Une commande n'est réputée définitive qu'après confirmation du paiement.

Bento Cake Studio SNC ne conserve aucune donnée bancaire. Les informations de paiement sont traitées directement par le prestataire de paiement conformément à ses propres politiques de sécurité.

Le transfert de propriété des produits n'intervient qu'après paiement intégral du prix de vente.""")

FR["8"] = ("Article 8 – Retrait et livraison", """Le Client peut choisir le retrait sur place ou la livraison à l'adresse indiquée lors du paiement.

Les horaires de retrait convenus doivent être respectés. Le retrait est possible jusqu'à l'heure limite communiquée au Client. En cas de retard imprévu, le Client doit en informer Bento Cake Studio SNC dans les meilleurs délais. À défaut d'information et au-delà de l'heure limite de retrait, la commande sera considérée comme non retirée et aucun remboursement ne sera accordé en raison du caractère périssable des produits.

En cas de retrait sur place, le transport des produits s'effectue sous la seule responsabilité du Client. Bento Cake Studio SNC ne saurait être tenue responsable d'une quelconque détérioration survenue après la remise, notamment en raison d'une manipulation inappropriée, d'un transport inadapté ou d'une conservation inadéquate.

En cas de livraison, la prestation est confiée à un prestataire tiers indépendant. La responsabilité est transférée lors de la remise du produit au transporteur désigné, moment auquel les risques passent au Client. Les conditions et délais de livraison relèvent de la responsabilité du prestataire désigné.""")

FR["9"] = ("Article 9 – Réclamations", """Toute réclamation doit être adressée dans les 48 heures suivant le retrait ou la livraison, par courriel à contact@bentocakestudio.ch.

Toute réclamation doit être accompagnée de photographies du produit concerné afin d'en permettre une appréciation adéquate. Passé ce délai, aucune réclamation ne sera acceptée.""")

FR["10"] = ("Article 10 – Droit de rétractation", """Conformément à la législation applicable, le droit de rétractation ne s'applique pas aux denrées fraîches ou périssables ni aux produits personnalisés confectionnés sur commande. Aucun remboursement ne sera accordé une fois la commande préparée ou remise au Client.""")

FR["11"] = ("Article 11 – Responsabilité", """Bento Cake Studio SNC ne saurait être tenue responsable d'une conservation ou d'une manipulation inappropriée des produits par le Client, d'une consommation au-delà des délais recommandés, ni de réactions allergiques pour autant que la composition des produits soit indiquée.

La liste des allergènes peut être communiquée sur demande. Il appartient au Client de signaler toute allergie ou intolérance alimentaire au moment de la commande.

Les produits sont fabriqués, manipulés et conservés dans le respect des normes d'hygiène et de la réglementation alimentaire en vigueur en Suisse.

Les produits doivent être conservés conformément aux instructions communiquées lors du retrait ou indiquées sur l'emballage. Sauf indication contraire, les produits frais, en particulier ceux contenant de la crème fouettée, doivent être conservés au réfrigérateur entre 0°C et 4°C et consommés le jour même ou dans les meilleurs délais. Une exposition prolongée à température ambiante peut compromettre la qualité et la structure du produit et doit être évitée. Les produits ne doivent pas être recongelés.

Certains éléments décoratifs (supports internes, piques, toppers, fleurs ou accessoires) peuvent ne pas être comestibles et doivent être retirés avant consommation. Bento Cake Studio SNC décline toute responsabilité en cas de manipulation inappropriée ou d'ingestion de tels éléments.""")

FR["12"] = ("Article 12 – Propriété intellectuelle", """L'ensemble des éléments du site, notamment les textes, images, photographies, logos et visuels, sont la propriété exclusive de Bento Cake Studio SNC. Toute reproduction ou utilisation, totale ou partielle, sans autorisation écrite préalable est strictement interdite.

Bento Cake Studio SNC se réserve le droit de photographier et d'utiliser ses créations à des fins promotionnelles (site internet, réseaux sociaux et supports marketing), sauf opposition expresse et écrite du Client avant la remise du produit.""")

FR["13"] = ("Article 13 – Données personnelles", """Les données personnelles collectées sont utilisées uniquement pour la gestion des commandes, la communication avec le Client, l'organisation du retrait ou de la livraison, ainsi que l'envoi de la newsletter lorsque le Client y a expressément consenti.

Le Client dispose d'un droit d'accès, de rectification et de suppression de ses données personnelles en écrivant à contact@bentocakestudio.ch.

Il est précisé que les communications par courriel ne sont pas chiffrées et peuvent présenter les risques de sécurité inhérents à ce mode de transmission.""")

FR["14"] = ("Article 14 – Cookies", """Le site utilise uniquement des cookies et technologies de stockage strictement nécessaires à son bon fonctionnement.

Il s'agit notamment de :
• L'authentification des utilisateurs et la gestion des sessions
• La sécurité de l'accès aux comptes
• L'enregistrement des préférences en matière de cookies
• Le fonctionnement technique du site

Les données de session sont conservées pour une durée limitée (environ 1 heure pour les jetons d'accès, renouvelés automatiquement, et jusqu'à 7 jours pour les jetons de rafraîchissement).

Aucun cookie publicitaire, de suivi marketing ou de mesure d'audience n'est actuellement utilisé.

Ces technologies étant indispensables au fonctionnement du site, elles ne peuvent pas être désactivées.""")

FR["15"] = ("Article 15 – Hébergement et sécurité", """Le site est créé et hébergé via la plateforme Lovable. Les données personnelles sont stockées sur des serveurs sécurisés et accessibles uniquement aux prestataires techniques nécessaires à l'exploitation du site.

Bento Cake Studio SNC met en œuvre des mesures techniques et organisationnelles appropriées afin d'assurer la sécurité et la confidentialité des données.""")

FR["16"] = ("Article 16 – Force majeure", """Bento Cake Studio SNC ne saurait être tenue responsable en cas de force majeure empêchant ou retardant l'exécution de ses obligations. Constituent notamment des cas de force majeure, sans que cette liste soit exhaustive, les catastrophes naturelles, les restrictions administratives, les pénuries de matières premières, les incidents techniques majeurs, les grèves ou tout événement imprévisible et irrésistible échappant à son contrôle.""")

FR["17"] = ("Article 17 – Droit applicable et for judiciaire", """Les présentes CGV sont soumises au droit suisse.

Tout litige relève de la compétence exclusive des tribunaux du canton de Genève, après tentative de résolution amiable.

La langue du contrat est le français. En cas de traduction dans une autre langue, seule la version française fait foi.""")

FR["18"] = ("Article 18 – Finalités et bases légales du traitement", """Les données personnelles collectées via le site sont traitées aux fins suivantes :
• La gestion des commandes et l'exécution du contrat
• La communication avec le Client
• La gestion administrative et comptable
• La sécurité et le bon fonctionnement du site

Le traitement repose sur :
• L'exécution du contrat
• Le respect des obligations légales
• L'intérêt légitime à gérer et sécuriser l'activité commerciale""")

FR["19"] = ("Article 19 – Durée de conservation des données", """Les données personnelles ne sont conservées que pendant la durée nécessaire aux finalités poursuivies.

Les données relatives aux commandes et à la facturation sont conservées conformément aux obligations légales suisses, en principe pendant une durée de dix (10) ans.""")

FR["20"] = ("Article 20 – Prestataires et transfert de données", """Certaines données peuvent être traitées par des prestataires techniques agissant pour le compte de Bento Cake Studio SNC, notamment pour l'hébergement, l'authentification et le traitement des paiements.

Ces prestataires sont tenus à des obligations de confidentialité et de sécurité des données.

Les données personnelles ne sont ni vendues ni transmises à des tiers à des fins commerciales.""")

FR["21"] = ("Article 21 – Sécurité des données", """Bento Cake Studio SNC met en œuvre des mesures techniques et organisationnelles appropriées afin de protéger les données personnelles contre tout accès non autorisé, perte, destruction ou divulgation.

Toutefois, aucune transmission de données sur Internet ne peut être garantie comme entièrement sécurisée.""")

FR["22"] = ("Article 22 – Limitation de responsabilité", """Bento Cake Studio SNC s'efforce de fournir des informations exactes et à jour sur son site. Aucune garantie n'est toutefois donnée quant à l'exactitude, la fiabilité ou l'exhaustivité des informations publiées.

L'utilisation du site s'effectue aux risques et périls de l'utilisateur.

Dans les limites autorisées par la loi, Bento Cake Studio SNC décline toute responsabilité pour tout dommage direct ou indirect résultant de l'accès au site ou de son utilisation.

Le site peut contenir des liens vers des sites tiers sur lesquels Bento Cake Studio SNC n'exerce aucun contrôle et n'assume aucune responsabilité.""")

FR["23"] = ("Article 23 – Divisibilité", """Si une disposition des présentes CGV est déclarée nulle ou inapplicable, les autres dispositions demeurent pleinement en vigueur.""")

FR["24"] = ("Article 24 – Modification des CGV", """Bento Cake Studio SNC se réserve le droit de modifier les présentes CGV à tout moment.

La version applicable est celle publiée sur le site à la date de consultation.

Dernière mise à jour : 26.02.2026""")

assert len(FR) == 24, len(FR)

src = io.open(path, encoding="utf-8").read()
orig = src

# 1. import
anchor = '} from "@/components/ui/accordion";\n'
assert src.count(anchor) == 1
src = src.replace(anchor, anchor + 'import { useLang } from "@/context/LanguageContext";\n', 1)

# 2. article fields
pat = re.compile(
    r'\n    id: "(\d+)",\n    title: ("(?:[^"\\]|\\.)*"),\n    content: (`[^`]*`),\n  \},',
    re.S)

seen = []
def rep(m):
    aid = m.group(1)
    seen.append(aid)
    tfr, cfr = FR[aid]
    assert "`" not in cfr and "${" not in cfr
    return ('\n    id: "%s",\n    title: %s,\n    titleFr: %s,\n    content: %s,\n    contentFr: `%s`,\n  },'
            % (aid, m.group(2), json.dumps(tfr, ensure_ascii=False), m.group(3), cfr))

src, n = pat.subn(rep, src)
assert n == 24, n
assert seen == [str(i) for i in range(1, 25)], seen

# 3. component
a = "const Legal = () => {\n  return ("
assert src.count(a) == 1
src = src.replace(a, "const Legal = () => {\n  const { t } = useLang();\n\n  return (", 1)

a = "          Legal Notice, Terms and Conditions of Sale & Privacy Policy\n"
assert src.count(a) == 1
src = src.replace(a, '          {t("Legal Notice, Terms and Conditions of Sale & Privacy Policy", "Mentions légales, Conditions générales de vente et Politique de confidentialité")}\n', 1)

a = "                {article.title}\n"
assert src.count(a) == 1
src = src.replace(a, "                {t(article.title, article.titleFr)}\n", 1)

a = "                  {article.content}\n"
assert src.count(a) == 1
src = src.replace(a, "                  {t(article.content, article.contentFr)}\n", 1)

assert src != orig
tmp = path + ".tmp_fr"
io.open(tmp, "w", encoding="utf-8").write(src)
os.replace(tmp, path)
print("written", len(src))
