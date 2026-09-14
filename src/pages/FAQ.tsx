import Layout from "@/components/Layout";
import { useLang } from "@/context/LanguageContext";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const FAQ = () => {
  const { t } = useLang();

  const faqSections = [
    {
      title: "About the cakes",
      titleFr: "À propos des gâteaux",
      questions: [
        {
          question: "What is a Bento cake?",
          questionFr: "Qu'est-ce qu'un Bento cake ?",
          answer: "A Bento cake is a Korean-inspired cake, light in texture. It is fully customisable, allowing you to choose the design, colors, and message. Its minimalist style makes it perfect for birthdays, gifts, or any special occasion.",
          answerFr: "Le Bento cake est un gâteau d'inspiration coréenne, à la texture légère. Il est entièrement personnalisable : vous choisissez le design, les couleurs et le message. Son style minimaliste en fait le cadeau idéal pour un anniversaire ou toute autre occasion spéciale."
        },
        {
          question: "What kind of cream do you use?",
          questionFr: "Quel type de crème utilisez-vous ?",
          answer: "We use whipped cream to keep the cake light, airy, and not too sweet.",
          answerFr: "Nous utilisons de la crème chantilly afin de garder nos gâteaux légers, aériens et peu sucrés."
        },
        {
          question: "Do you use buttercream?",
          questionFr: "Utilisez-vous de la crème au beurre ?",
          answer: "Yes, but only for certain details such as writing, drawings and dark-coloured decorations. Its firmer texture helps keep details precise and reduces colour transfer.\n\nButtercream is also used in our Bento Kits as it is more stable during transport and easier to work with at home.",
          answerFr: "Oui, mais uniquement pour certains détails tels que les écritures, les dessins et les décorations aux couleurs foncées. Sa texture plus ferme permet de conserver des détails précis et de limiter le transfert des couleurs.\n\nNous utilisons également de la crème au beurre dans nos Bento Kits, car elle est plus stable pendant le transport et plus facile à travailler à la maison."
        },
        {
          question: "Should I take my cake out of the fridge before serving?",
          questionFr: "Dois-je sortir mon gâteau du réfrigérateur avant de le servir ?",
          answer: "No, there's no need. We recommend keeping your cake refrigerated and taking it out only when you're ready to enjoy it.",
          answerFr: "Non, ce n'est pas nécessaire. Nous vous recommandons de conserver votre gâteau au réfrigérateur et de le sortir uniquement lorsque vous êtes prête à le déguster."
        },
        {
          question: "Do your cakes contain allergens?",
          questionFr: "Vos gâteaux contiennent-ils des allergènes ?",
          answer: "Our cakes contain gluten (wheat), eggs and milk. Depending on the flavour, additional allergens may be present. Our products are prepared in a kitchen where nuts and other allergens are also handled, so we cannot guarantee the complete absence of traces.\n\nIf you have an allergy or intolerance, please check the allergen information provided for each flavour or contact us before placing your order.",
          answerFr: "Nos gâteaux contiennent du gluten (blé), des œufs et du lait. Selon le parfum choisi, d'autres allergènes peuvent être présents. Nos produits sont préparés dans une cuisine où des fruits à coque et d'autres allergènes sont également manipulés. Nous ne pouvons donc pas garantir l'absence totale de traces.\n\nSi vous avez une allergie ou une intolérance, veuillez consulter les informations relatives aux allergènes indiquées pour chaque parfum ou nous contacter avant de passer commande."
        },
        {
          question: "How should I store my cake?",
          questionFr: "Comment conserver mon gâteau ?",
          answer: "Keep your cake refrigerated between 0°C and 4°C and consume it within 48 hours for optimal freshness and texture. Please note that when dark and light colours are combined, slight colour transfer may occur over time.",
          answerFr: "Conservez votre gâteau au réfrigérateur entre 0°C et 4°C et consommez-le dans les 48 heures afin de préserver au mieux sa fraîcheur et sa texture. Veuillez noter que lorsque des couleurs foncées et claires sont associées, un léger transfert de couleur peut apparaître avec le temps."
        },
        {
          question: "How long can the cake stay outside?",
          questionFr: "Combien de temps le gâteau peut-il rester hors du réfrigérateur ?",
          answer: "We recommend keeping the cake refrigerated until serving and limiting the time spent at room temperature as much as possible, especially during warmer weather.",
          answerFr: "Nous vous recommandons de conserver le gâteau au réfrigérateur jusqu'au moment de le servir et de limiter autant que possible le temps passé à température ambiante, en particulier lorsqu'il fait chaud."
        },
        {
          question: "Does the food colouring stain the lips?",
          questionFr: "Les colorants alimentaires peuvent-ils colorer les lèvres ?",
          answer: "Darker colours may temporarily stain the lips or tongue. The deeper the colour, the more noticeable the staining may be. If you would prefer to avoid this, we recommend choosing lighter colours.",
          answerFr: "Les couleurs foncées peuvent temporairement colorer les lèvres ou la langue. Plus la couleur est intense, plus cet effet peut être visible. Si vous souhaitez l'éviter, nous vous recommandons de choisir des couleurs plus claires."
        },
        {
          question: "Can pregnant women eat your cakes?",
          questionFr: "Les femmes enceintes peuvent-elles manger nos gâteaux ?",
          answer: "Our cakes are made without raw eggs. However, as a precaution, we do not recommend our Passion Fruit or Lemon Curd fillings during pregnancy. If you have any specific dietary or health concerns, we recommend checking with your healthcare professional before ordering.",
          answerFr: "Nos gâteaux sont préparés sans œufs crus. Cependant, par mesure de précaution, nous déconseillons les garnitures Passion Fruit et Lemon Curd pendant la grossesse. En cas de question spécifique liée à votre alimentation ou à votre santé, nous vous recommandons de demander conseil à votre professionnel de santé avant de commander."
        }
      ]
    },
    {
      title: "Ordering",
      titleFr: "Commandes",
      questions: [
        {
          question: "How can I place an order?",
          questionFr: "Comment passer une commande ?",
          answer: "Orders can be placed directly through our website. Simply choose your cake, customise the available options, select your date and complete the payment online.\n\nFor a design or request that is not available in our catalogue, please use our Custom Request form.",
          answerFr: "Les commandes peuvent être passées directement sur notre site internet. Il vous suffit de choisir votre gâteau, de personnaliser les options disponibles, de sélectionner votre date et d'effectuer le paiement en ligne.\n\nPour un design ou une demande qui n'est pas disponible dans notre catalogue, veuillez utiliser notre formulaire Custom Request."
        },
        {
          question: "Can I place a last-minute order?",
          questionFr: "Puis-je passer une commande de dernière minute ?",
          answer: "Yes, subject to availability. We recommend placing your order at least 6 days in advance. For shorter notice, an express surcharge automatically applies:\n\n4–5 days before pickup: +15%\n2–3 days before pickup: +20%\n\nOrders placed less than 2 days in advance cannot be accepted.",
          answerFr: "Oui, sous réserve de disponibilité. Nous vous recommandons de passer votre commande au moins 6 jours à l'avance. Pour les commandes passées dans un délai plus court, un supplément express s'applique automatiquement :\n\n4 à 5 jours avant le retrait : +15 %\n2 à 3 jours avant le retrait : +20 %\n\nLes commandes passées moins de 2 jours à l'avance ne peuvent pas être acceptées."
        },
        {
          question: "Can I cancel or modify my order?",
          questionFr: "Puis-je annuler ou modifier ma commande ?",
          answer: "Orders are confirmed once full payment has been received. Cancellations or date changes must be requested at least 5 days before the scheduled pickup date. After this deadline, orders are non-refundable and cannot be rescheduled.\n\nChanges to the design, flavour, size or other order details are subject to availability and may not be possible once production has begun.",
          answerFr: "Les commandes sont confirmées dès réception du paiement intégral. Toute annulation ou demande de changement de date doit être effectuée au moins 5 jours avant la date de retrait prévue. Passé ce délai, la commande n'est plus remboursable et ne peut plus être reportée.\n\nLes modifications concernant le design, le parfum, la taille ou tout autre détail de la commande sont soumises à disponibilité et peuvent ne plus être possibles une fois la production commencée."
        }
      ]
    },
    {
      title: "Payment",
      titleFr: "Paiement",
      questions: [
        {
          question: "Is payment required to confirm the order?",
          questionFr: "Le paiement est-il nécessaire pour confirmer la commande ?",
          answer: "Yes, full payment is required to confirm and secure your order.",
          answerFr: "Oui, le paiement intégral est nécessaire pour confirmer et garantir votre commande."
        },
        {
          question: "Do you accept cash payments?",
          questionFr: "Acceptez-vous les paiements en espèces ?",
          answer: "No, we do not accept cash payments. All orders must be paid online to be confirmed.",
          answerFr: "Non, nous n'acceptons pas les paiements en espèces. Toutes les commandes doivent être payées en ligne afin d'être confirmées."
        }
      ]
    },
    {
      title: "Pickup & Delivery",
      titleFr: "Retrait & Livraison",
      questions: [
        {
          question: "How can I collect my order?",
          questionFr: "Où puis-je récupérer ma commande ?",
          answer: "Orders can be collected from our pickup location at Rue Prévost-Martin 8, 1205 Geneva, at the date and time selected or confirmed for your order. Please arrive within your scheduled pickup time.",
          answerFr: "Les commandes peuvent être récupérées à notre point de retrait situé Rue Prévost-Martin 8, 1205 Genève, à la date et à l'heure sélectionnées ou confirmées pour votre commande. Merci de respecter le créneau de retrait prévu."
        },
        {
          question: "Do you offer delivery?",
          questionFr: "Proposez-vous la livraison ?",
          answer: "Yes, delivery is available within Geneva and surrounding areas, subject to availability. Delivery fees are calculated based on distance and will be displayed or confirmed when placing your order.",
          answerFr: "Oui, la livraison est disponible à Genève et dans les environs, sous réserve de disponibilité. Les frais de livraison sont calculés en fonction de la distance et sont affichés ou confirmés lors de votre commande."
        },
        {
          question: "How should I transport the cake?",
          questionFr: "Comment transporter mon gâteau ?",
          answer: "Keep the cake flat and stable during transport. We recommend placing it on the floor of the car rather than on a seat. Keep the car cool and avoid direct sunlight or heat.\n\nWhen removing the plastic wrap, place the cake on a flat surface and gently pull the wrap away from the cake to avoid damaging the decoration.",
          answerFr: "Gardez le gâteau bien à plat et stable pendant le transport. Nous vous recommandons de le placer sur le sol de la voiture plutôt que sur un siège. Gardez la voiture au frais et évitez toute exposition directe au soleil ou à la chaleur.\n\nPour retirer le film plastique, placez le gâteau sur une surface plane et retirez délicatement le film en l'éloignant du gâteau afin de ne pas abîmer la décoration."
        },
        {
          question: "Can I get a refund if my cake is damaged after pickup?",
          questionFr: "Puis-je être remboursée si mon gâteau est endommagé après le retrait ?",
          answer: "Once the cake has been collected, the customer is responsible for its transport and handling. Unfortunately, we cannot offer refunds for damage occurring after pickup.",
          answerFr: "Une fois le gâteau récupéré, le client est responsable de son transport et de sa manipulation. Malheureusement, nous ne pouvons pas effectuer de remboursement pour les dommages survenus après le retrait."
        }
      ]
    },
    {
      title: "Issues & Refunds",
      titleFr: "Problèmes & Remboursements",
      questions: [
        {
          question: "What should I do if there is an issue with my order?",
          questionFr: "Que faire en cas de problème avec ma commande ?",
          answer: "As each cake is handmade, slight variations in colour, writing, decoration and placement may occur. Reference images are used as inspiration and exact replication cannot be guaranteed.\n\nIf there is an issue with your order, please contact us within 48 hours of pickup and provide clear photos of the cake so we can review your request. Claims submitted after 48 hours may no longer be eligible for review.",
          answerFr: "Chaque gâteau étant réalisé à la main, de légères variations de couleur, d'écriture, de décoration ou de placement peuvent survenir. Les images de référence servent d'inspiration et une reproduction parfaitement identique ne peut pas être garantie.\n\nEn cas de problème avec votre commande, veuillez nous contacter dans les 48 heures suivant le retrait et nous envoyer des photos claires du gâteau afin que nous puissions examiner votre demande. Les réclamations envoyées après ce délai de 48 heures peuvent ne plus être prises en compte."
        }
      ]
    },
    {
      title: "Contact",
      titleFr: "Contact",
      questions: [
        {
          question: "How can I contact you?",
          questionFr: "Comment puis-je vous contacter ?",
          answer: "contact-section",
          answerFr: "contact-section"
        }
      ]
    }
  ];

  return (
    <Layout>
      <main className="max-w-4xl mx-auto px-6 py-16">
        <h1 className="font-sans uppercase tracking-[0.105em] text-3xl md:text-4xl text-foreground mb-12 text-center font-semibold">
          {t("Frequently Asked Questions", "Questions fréquentes")}
        </h1>

        <div className="space-y-10">
          {faqSections.map((section, sectionIndex) => (
            <div key={sectionIndex}>
              <h2 className="font-sans uppercase tracking-[0.105em] text-xl font-semibold text-foreground mb-4">{t(section.title, section.titleFr)}</h2>
              <Accordion type="single" collapsible className="w-full">
                {section.questions.map((item, itemIndex) => (
                  <AccordionItem key={itemIndex} value={`${sectionIndex}-${itemIndex}`}>
                    <AccordionTrigger className="text-left text-foreground hover:text-primary">
                      {t(item.question, item.questionFr)}
                    </AccordionTrigger>
                    <AccordionContent className="text-muted-foreground leading-relaxed whitespace-pre-line">
                      {item.answer === "contact-section" ? (
                        <p>
                          {t("You can contact us via Instagram", "Vous pouvez nous contacter via Instagram")}{" "}
                          <a href="https://www.instagram.com/bentocakestudio/" target="_blank" rel="noopener noreferrer" className="text-primary underline hover:text-primary/80">@bentocakestudio</a>
                          {t(", on WhatsApp at +41 78 337 95 00, or by email at", ", sur WhatsApp au +41 78 337 95 00 ou par e-mail à")}{" "}
                          <a href="mailto:contact@bentocakestudio.ch" className="text-primary underline hover:text-primary/80">contact@bentocakestudio.ch</a>.
                        </p>
                      ) : (
                        t(item.answer, item.answerFr)
                      )}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          ))}
        </div>
      </main>
    </Layout>
  );
};

export default FAQ;
