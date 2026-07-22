import Layout from "@/components/Layout";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const FAQ = () => {
  const faqSections = [
    {
      title: "About the cakes",
      questions: [
        {
          question: "What is a Bento cake?",
          answer: "A Bento cake is a Korean-inspired cake, light in texture. It is fully customizable, allowing you to choose the design, colors, and message. Its minimalist style makes it perfect for birthdays, gifts, or any special occasion."
        },
        {
          question: "What kind of cream do you use?",
          answer: "We use whipped cream to keep the cake light, airy, and not too sweet."
        },
        {
          question: "How many days can a cake be kept?",
          answer: "The cake can be kept for 2 days. Please note that when dark and light colors are combined, slight color transfer may occur over time."
        },
        {
          question: "How should I store my cake?",
          answer: "Please keep your cake refrigerated between 0°C and 4°C.\nFor optimal freshness and texture, we recommend enjoying it within 48 hours.\nAvoid prolonged exposure to room temperature."
        },
        {
          question: "How long can the cake stay outside?",
          answer: "The cake can be left outside for up to 2 hours. We recommend keeping it refrigerated as much as possible to maintain its freshness and quality."
        },
        {
          question: "Does the food coloring stain the lips?",
          answer: "Darker colors may temporarily stain the lips. The deeper the color, the more noticeable the staining may be. We recommend choosing lighter colors to avoid any discomfort."
        }
      ]
    },
    {
      title: "Ordering",
      questions: [
        {
          question: "How can I place an order?",
          answer: "You can place your order directly on our website. If you have any questions, feel free to contact us via Instagram or WhatsApp, and we'll be happy to help."
        },
        {
          question: "What are the steps to place an order?",
          answer: "To place an order, please provide the date, size, shape, flavor, design, desired colors, text and text color, and you may also include a reference photo of a design you like."
        },
        {
          question: "How many days in advance should I order?",
          answer: "All of our cakes are made fresh to order, which means we do not have ready-made cakes. To ensure availability, we recommend placing your order at least one week in advance. Last-minute orders may be accepted depending on availability."
        },
        {
          question: "Can I cancel or modify my order?",
          answer: "Orders are confirmed only upon receipt of payment. If you wish to cancel or reschedule your order, you must notify us at least 5 days in advance to be eligible for a refund or date change. After this time, no refunds or rescheduling will be possible."
        }
      ]
    },
    {
      title: "Payment",
      questions: [
        {
          question: "Is payment required to confirm the order?",
          answer: "Yes, full payment is required to confirm and secure your order."
        },
        {
          question: "Can we pay in cash?",
          answer: "No, we do not accept cash payments."
        }
      ]
    },
    {
      title: "Pickup & Delivery",
      questions: [
        {
          question: "How can I collect my order?",
          answer: "Once your order is ready, you can collect it at the agreed pickup location and time. All pickup details will be shared with you after your order is confirmed."
        },
        {
          question: "How should I transport the cake?",
          answer: "We recommend placing the cake on the floor of the car to keep it as stable as possible. Please turn off the heating to prevent the cake from melting during the drive. When receiving the cake and removing the plastic wrap, make sure to hold it from both the top and the bottom to avoid any damage."
        },
        {
          question: "Can I get a refund if my cake is damaged after pickup?",
          answer: "Once the order has been collected, responsibility is transferred to the customer. We cannot be held liable for any damage or accidents after pickup, and no refunds will be issued."
        }
      ]
    },
    {
      title: "Refund",
      questions: [
        {
          question: "Complain about an order?",
          answer: "Please note that the images you submit are for inspiration purposes only.\nVariations in color, writing, decoration, and accessories may occur.\nIf you are not satisfied with your order, you must contact us within 48 hours after pickup.\nPlease provide clear photos of the cake to support your complaint.\nAfter this 48-hour period, we will no longer be able to process any claims or refunds."
        },
        {
          question: "How to get a refund if you want to cancel your order?",
          answer: "To request a refund, please send us an email at contact@bentocakestudio.ch at least 5 days before your scheduled pickup date.\nNo refunds will be eligible after this deadline."
        }
      ]
    },
    {
      title: "Contact",
      questions: [
        {
          question: "How can we contact you?",
          answer: "contact-section"
        }
      ]
    }
  ];

  return (
    <Layout>
      <main className="max-w-4xl mx-auto px-6 py-16">
        <h1 className="font-sans uppercase tracking-[0.105em] text-4xl md:text-5xl text-foreground mb-12 text-center">
          Frequently Asked Questions
        </h1>
        
        <div className="space-y-10">
          {faqSections.map((section, sectionIndex) => (
            <div key={sectionIndex}>
              <h2 className="font-sans uppercase tracking-[0.105em] text-xl font-semibold text-foreground mb-4">{section.title}</h2>
              <Accordion type="single" collapsible className="w-full">
                {section.questions.map((item, itemIndex) => (
                  <AccordionItem key={itemIndex} value={`${sectionIndex}-${itemIndex}`}>
                    <AccordionTrigger className="text-left text-foreground hover:text-primary">
                      {item.question}
                    </AccordionTrigger>
                    <AccordionContent className="text-muted-foreground leading-relaxed whitespace-pre-line">
                      {item.answer === "contact-section" ? (
                        <p>
                          You can contact us via Instagram{" "}
                          <a href="https://www.instagram.com/bentocakestudio/" target="_blank" rel="noopener noreferrer" className="text-primary underline hover:text-primary/80">@bentocakestudio</a>
                          , on WhatsApp at +41 79 953 13 17, or by email at{" "}
                          <a href="mailto:contact@bentocakestudio.ch" className="text-primary underline hover:text-primary/80">contact@bentocakestudio.ch</a>.
                        </p>
                      ) : (
                        item.answer
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
