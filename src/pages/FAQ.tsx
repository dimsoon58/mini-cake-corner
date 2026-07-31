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
          answerFr: "Le Bento cake est un gâteau d'inspiration coréenne, à la texture légère. Il est entièrement personnalisable : vous pouvez choisir le design, les couleurs et le message. Son style minimaliste en fait le compagnon idéal des anniversaires, des cadeaux ou de toute occasion particulière."
        },
        {
          question: "What kind of cream do you use?",
          questionFr: "Quelle crème utilisez-vous ?",
          answer: "We use whipped cream to keep the cake light, airy, and not too sweet.",
          answerFr: "Nous utilisons une crème fouettée afin de préserver la légèreté du gâteau, tout en délicatesse et sans excès de sucre."
        },
        {
          question: "How many days can a cake be kept?",
          questionFr: "Combien de jours un gâteau se conserve-t-il ?",
          answer: "The cake can be kept for 2 days. Please note that when dark and light colours are combined, slight colour transfer may occur over time.",
          answerFr: "Le gâteau se conserve 2 jours. Veuillez noter que lorsque des couleurs foncées et claires sont associées, un léger transfert de couleur peut se produire avec le temps."
        },
        {
          question: "How should I store my cake?",
          questionFr: "Comment conserver mon gâteau ?",
          answer: "Please keep your cake refrigerated between 0°C and 4°C.\nFor optimal freshness and texture, we recommend enjoying it within 48 hours.\nAvoid prolonged exposure to room temperature.",
          answerFr: "Veuillez conserver votre gâteau au réfrigérateur, entre 0°C et 4°C.\nPour une fraîcheur et une texture optimales, nous vous recommandons de le déguster dans les 48 heures.\nÉvitez toute exposition prolongée à température ambiante."
        },
        {
          question: "How long can the cake stay outside?",
          questionFr: "Combien de temps le gâteau peut-il rester à température ambiante ?",
          answer: "The cake can be left outside for up to 2 hours. We recommend keeping it refrigerated as much as possible to maintain its freshness and quality.",
          answerFr: "Le gâteau peut rester à température ambiante jusqu'à 2 heures. Nous vous recommandons de le garder au réfrigérateur autant que possible afin de préserver sa fraîcheur et sa qualité."
        },
        {
          question: "Does the food colouring stain the lips?",
          questionFr: "Le colorant alimentaire tache-t-il les lèvres ?",
          answer: "Darker colours may temporarily stain the lips. The deeper the colour, the more noticeable the staining may be. We recommend choosing lighter colours to avoid any discomfort.",
          answerFr: "Les couleurs plus foncées peuvent teinter temporairement les lèvres. Plus la couleur est intense, plus la coloration risque d'être visible. Nous vous conseillons de privilégier des couleurs plus claires afin d'éviter tout désagrément."
        },
        {
          question: "Can pregnant women eat your cakes?",
          questionFr: "Les femmes enceintes peuvent-elles déguster vos gâteaux ?",
          answer: "Yes. All of our cakes are safe to eat during pregnancy, as we do not use raw eggs in our recipes.\nHowever, as a precaution, we do not recommend choosing our Passion Fruit or Lemon Curd fillings during pregnancy. Although the eggs used in these fillings are cooked, some healthcare professionals recommend avoiding them due to the small potential risk associated with egg-based curds.",
          answerFr: "Oui. Tous nos gâteaux peuvent être dégustés en toute sérénité pendant la grossesse, car nous n'utilisons pas d'œufs crus dans nos recettes.\nToutefois, par précaution, nous vous déconseillons de choisir nos garnitures Fruit de la Passion ou Lemon Curd durant la grossesse. Bien que les œufs de ces garnitures soient cuits, certains professionnels de santé recommandent de les éviter en raison du léger risque potentiel lié aux curds à base d'œufs."
        }
      ]
    },
    {
      title: "Ordering",
      titleFr: "Commande",
      questions: [
        {
          question: "How can I place an order?",
          questionFr: "Comment passer une commande ?",
          answer: "You can place your order directly on our website. If you have any questions, feel free to contact us via Instagram or WhatsApp, and we'll be happy to help.",
          answerFr: "Vous pouvez passer votre commande directement sur notre site. Si vous avez la moindre question, n'hésitez pas à nous contacter via Instagram ou WhatsApp : nous serons ravis de vous accompagner."
        },
        {
          question: "What are the steps to place an order?",
          questionFr: "Quelles sont les étapes pour passer une commande ?",
          answer: "To place an order, please provide the date, size, shape, flavour, design, desired colours, text and text colour, and you may also include a reference photo of a design you like.",
          answerFr: "Pour passer une commande, merci de nous indiquer la date, la taille, la forme, le parfum, le design, les couleurs souhaitées, le texte et sa couleur. Vous pouvez également joindre une photo de référence d'un design qui vous plaît."
        },
        {
          question: "How many days in advance should I order?",
          questionFr: "Combien de jours à l'avance faut-il commander ?",
          answer: "All of our cakes are made fresh to order, which means we do not have ready-made cakes. To ensure availability, we recommend placing your order at least one week in advance. Last-minute orders may be accepted depending on availability.",
          answerFr: "Tous nos gâteaux sont préparés frais sur commande : nous ne proposons donc pas de gâteaux déjà réalisés. Afin de garantir la disponibilité, nous vous recommandons de commander au moins une semaine à l'avance. Les commandes de dernière minute peuvent être acceptées selon les disponibilités."
        },
        {
          question: "Can I cancel or modify my order?",
          questionFr: "Puis-je annuler ou modifier ma commande ?",
          answer: "Orders are confirmed only upon receipt of payment. If you wish to cancel or reschedule your order, you must notify us at least 5 days in advance to be eligible for a refund or date change. After this time, no refunds or rescheduling will be possible.",
          answerFr: "Les commandes ne sont confirmées qu'à réception du paiement. Si vous souhaitez annuler ou reporter votre commande, vous devez nous en informer au moins 5 jours à l'avance pour pouvoir bénéficier d'un remboursement ou d'un changement de date. Passé ce délai, aucun remboursement ni report ne sera possible."
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
          answerFr: "Oui, le paiement intégral est requis pour confirmer et garantir votre commande."
        },
        {
          question: "Can we pay in cash?",
          questionFr: "Peut-on payer en espèces ?",
          answer: "No, we do not accept cash payments.",
          answerFr: "Non, nous n'acceptons pas les paiements en espèces."
        }
      ]
    },
    {
      title: "Pickup & Delivery",
      titleFr: "Retrait & Livraison",
      questions: [
        {
          question: "How can I collect my order?",
          questionFr: "Comment récupérer ma commande ?",
          answer: "Once your order is ready, you can collect it at the agreed pickup location and time. All pickup details will be shared with you after your order is confirmed.",
          answerFr: "Une fois votre commande prête, vous pourrez la récupérer au lieu et à l'heure de retrait convenus. Tous les détails du retrait vous seront communiqués après la confirmation de votre commande."
        },
        {
          question: "How should I transport the cake?",
          questionFr: "Comment transporter le gâteau ?",
          answer: "We recommend placing the cake on the floor of the car to keep it as stable as possible. Please turn off the heating to prevent the cake from melting during the drive. When receiving the cake and removing the plastic wrap, make sure to hold it from both the top and the bottom to avoid any damage.",
          answerFr: "Nous vous recommandons de poser le gâteau au sol de la voiture afin de le maintenir aussi stable que possible. Veuillez couper le chauffage pour éviter que le gâteau ne fonde pendant le trajet. Lorsque vous recevez le gâteau et retirez le film plastique, veillez à le tenir à la fois par le dessus et par le dessous afin d'éviter tout dommage."
        },
        {
          question: "Can I get a refund if my cake is damaged after pickup?",
          questionFr: "Puis-je être remboursé(e) si mon gâteau est abîmé après le retrait ?",
          answer: "Once the order has been collected, responsibility is transferred to the customer. We cannot be held liable for any damage or accidents after pickup, and no refunds will be issued.",
          answerFr: "Dès que la commande a été récupérée, la responsabilité est transférée au client. Nous ne pouvons être tenus responsables d'aucun dommage ni incident survenant après le retrait, et aucun remboursement ne sera accordé."
        }
      ]
    },
    {
      title: "Refund",
      titleFr: "Remboursement",
      questions: [
        {
          question: "Complain about an order?",
          questionFr: "Signaler un problème sur une commande ?",
          answer: "Please note that the images you submit are for inspiration purposes only.\nVariations in color, writing, decoration, and accessories may occur.\nIf you are not satisfied with your order, you must contact us within 48 hours after pickup.\nPlease provide clear photos of the cake to support your complaint.\nAfter this 48-hour period, we will no longer be able to process any claims or refunds.",
          answerFr: "Veuillez noter que les images que vous nous transmettez ont une simple valeur d'inspiration.\nDes variations de couleur, d'écriture, de décoration et d'accessoires peuvent survenir.\nSi vous n'êtes pas satisfait(e) de votre commande, vous devez nous contacter dans les 48 heures suivant le retrait.\nMerci de joindre des photos nettes du gâteau à l'appui de votre réclamation.\nPassé ce délai de 48 heures, nous ne pourrons plus traiter aucune réclamation ni aucun remboursement."
        },
        {
          question: "How to get a refund if you want to cancel your order?",
          questionFr: "Comment obtenir un remboursement si vous souhaitez annuler votre commande ?",
          answer: "To request a refund, please send us an email at contact@bentocakestudio.ch at least 5 days before your scheduled pickup date.\nNo refunds will be eligible after this deadline.",
          answerFr: "Pour demander un remboursement, merci de nous écrire à l'adresse contact@bentocakestudio.ch au moins 5 jours avant la date de retrait prévue.\nAucun remboursement ne sera possible passé ce délai."
        }
      ]
    },
    {
      title: "Contact",
      titleFr: "Contact",
      questions: [
        {
          question: "How can we contact you?",
          questionFr: "Comment pouvons-nous vous contacter ?",
          answer: "contact-section",
          answerFr: "contact-section"
        }
      ]
    }
  ];

  return (
    <Layout>
      <main className="max-w-4xl mx-auto px-6 py-16">
        <h1 className="font-sans uppercase tracking-[0.105em] text-4xl md:text-5xl text-foreground mb-12 text-center">
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
                          {t(", on WhatsApp at +41 78 337 95 00, or by email at", ", sur WhatsApp au +41 78 337 95 00, ou par e-mail à l'adresse")}{" "}
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
