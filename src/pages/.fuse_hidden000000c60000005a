import Layout from "@/components/Layout";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const articles = [
  {
    id: "1",
    title: "Article 1 – Legal Notice",
    content: `Bento Cake Studio SNC
58 chemin de la Gradelle
1224 Chêne-Bougeries
Switzerland
Email: contact@bentocakestudio.ch

This website is published and operated by Bento Cake Studio SNC.`,
  },
  {
    id: "2",
    title: "Article 2 – Purpose",
    content: `These General Terms and Conditions of Sale (the "GTC") govern the purchase of products offered by Bento Cake Studio SNC through its online ordering platform.

By placing an order on this website, the Customer acknowledges having read and fully accepted these GTC without reservation.`,
  },
  {
    id: "3",
    title: "Article 3 – Products",
    content: `The products offered are handcrafted pastries, individually made to order with the utmost care and attention to detail. Photographs, visuals, and descriptions are provided for illustrative purposes only.

Due to the artisanal nature of our creations and the availability of materials at the time of production, subtle variations in color, shape, finishing, or decoration may occur. Such variations are inherent to handcrafted production and do not constitute grounds for complaint.

When the Customer provides a photograph or inspiration image, it serves as a creative reference only. Bento Cake Studio SNC undertakes to create a product inspired by the submitted model and to make its best efforts to respect the requested colors, style, and overall aesthetic. Each creation remains a unique interpretation and does not guarantee identical reproduction.`,
  },
  {
    id: "4",
    title: "Article 4 – Orders",
    content: `Orders are placed exclusively online. The Customer undertakes to provide accurate and complete information, including selected products and options, any personalized message, and valid contact details.

In the event of error or omission in the information provided, particularly regarding delivery address or contact details, Bento Cake Studio SNC shall not be held liable for any inability or delay in fulfilling the order.

The information and presentations displayed on the website do not constitute a legally binding offer.

An order becomes final only after validation and confirmation of payment. A confirmation email will be sent to the Customer.

Bento Cake Studio SNC reserves the right to refuse any abnormal, incomplete, or fraudulent order.

Computerized records maintained by Bento Cake Studio SNC shall constitute valid proof of transactions carried out.`,
  },
  {
    id: "5",
    title: "Article 5 – Modification and Cancellation",
    content: `Each creation is custom-designed and made to order. Any confirmed order initiates production and the reservation of specific raw materials.

Any cancellation request must be submitted in writing or via the website at least five (5) calendar days prior to the scheduled pickup or delivery date.

In such case, a refund may be granted, less any costs already incurred in preparation of the order.

After this five-day period, no refund may be granted, as production elements will have been committed.

Modification requests remain possible up to five (5) days before the scheduled date, subject to feasibility and potential price adjustment.

In the event of exceptional unavailability of a product or ingredient beyond our control, an equivalent alternative respecting the spirit and quality of the original creation will be proposed. If no solution is suitable, a credit note or refund may be issued.

The cancellation or postponement of a personal event (birthday, wedding, reception, or similar) does not constitute grounds for refund outside the conditions set forth in this Article.`,
  },
  {
    id: "6",
    title: "Article 6 – Prices",
    content: `Prices are indicated in Swiss Francs (CHF). Bento Cake Studio SNC is not subject to Swiss Value Added Tax (VAT); therefore, VAT is not applicable in accordance with Swiss legislation.

Delivery fees, where applicable, are specified at checkout. Prices applied are those in force at the time of order confirmation and cannot be modified thereafter.`,
  },
  {
    id: "7",
    title: "Article 7 – Payment Terms",
    content: `Payment is made exclusively online at the time of order validation.

Accepted payment methods include credit/debit cards and TWINT. Transactions are securely processed via the Stripe payment platform.

An order is considered final only upon confirmation of payment.

Bento Cake Studio SNC does not store any banking details. Payment information is processed directly by the payment provider in accordance with its own security policies.

Transfer of ownership of the products occurs only upon full payment of the purchase price.`,
  },
  {
    id: "8",
    title: "Article 8 – Collection and Delivery",
    content: `The Customer may choose in-store pickup or delivery to the address indicated at checkout.

Agreed pickup times must be respected. Pickup is available until the final collection time communicated to the Customer. In case of unforeseen delay, the Customer must inform Bento Cake Studio SNC promptly. Without notification and beyond the pickup deadline, the order will be considered uncollected and no refund shall be issued due to the perishable nature of the products.

For in-store pickup, transport of the products is carried out under the sole responsibility of the Customer. Bento Cake Studio SNC shall not be held liable for any deterioration occurring after handover, particularly due to improper handling, unsuitable transport, or inadequate storage.

For delivery, the service is entrusted to an independent third-party provider. Liability transfers upon handover of the product to the appointed carrier, at which point risk passes to the Customer. Delivery conditions and timelines fall under the responsibility of the appointed provider.`,
  },
  {
    id: "9",
    title: "Article 9 – Complaints",
    content: `Any complaint must be submitted within 48 hours of pickup or delivery by email to contact@bentocakestudio.ch.

All complaints must be accompanied by photographs of the concerned product to allow proper assessment. After this period, no complaint shall be accepted.`,
  },
  {
    id: "10",
    title: "Article 10 – Right of Withdrawal",
    content: `In accordance with applicable legislation, the right of withdrawal does not apply to fresh or perishable goods or to personalized products made to order. No refund shall be issued once the order has been prepared or handed over to the Customer.`,
  },
  {
    id: "11",
    title: "Article 11 – Liability",
    content: `Bento Cake Studio SNC shall not be held liable for improper storage or handling of products by the Customer, consumption beyond recommended timeframes, or allergic reactions provided that product composition is indicated.

The list of allergens may be communicated upon request. It is the Customer's responsibility to report any allergy or food intolerance at the time of ordering.

Products are manufactured, handled, and stored in compliance with hygiene standards and food regulations in force in Switzerland.

Products must be stored according to the instructions provided at pickup or indicated on packaging. Unless otherwise stated, fresh products, particularly those containing whipped cream, must be stored refrigerated between 0°C and 4°C and consumed the same day or as soon as possible. Prolonged exposure to room temperature may compromise the quality and structure of the product and should be avoided. Products must not be refrozen.

Certain decorative elements (internal supports, picks, toppers, flowers, or accessories) may not be edible and must be removed prior to consumption. Bento Cake Studio SNC declines all liability in the event of improper handling or ingestion of such elements.`,
  },
  {
    id: "12",
    title: "Article 12 – Intellectual Property",
    content: `All elements of the website, including texts, images, photographs, logos, and visuals, are the exclusive property of Bento Cake Studio SNC. Any reproduction or use, in whole or in part, without prior written authorization is strictly prohibited.

Bento Cake Studio SNC reserves the right to photograph and use its creations for promotional purposes (website, social media, and marketing materials), unless the Customer expressly objects in writing prior to product handover.`,
  },
  {
    id: "13",
    title: "Article 13 – Personal Data",
    content: `Personal data collected are used solely for order management, communication with the Customer, organization of pickup or delivery, and newsletter distribution where expressly consented to.

The Customer has the right to access, rectify, or delete personal data by contacting contact@bentocakestudio.ch.

Please note that email communications are not encrypted and may present inherent security risks associated with this method of transmission.`,
  },
  {
    id: "14",
    title: "Article 14 – Cookies",
    content: `The website uses only strictly necessary cookies and storage technologies required for proper operation.

These include:
• User authentication and session management
• Account access security
• Storage of cookie preferences
• Technical functionality of the website

Session data are retained for a limited duration (approximately 1 hour for access tokens, automatically renewed, and up to 7 days for refresh tokens).

No advertising, marketing tracking, or analytics cookies are currently used.

As these technologies are essential for website functionality, they cannot be disabled.`,
  },
  {
    id: "15",
    title: "Article 15 – Hosting and Security",
    content: `The website is created and hosted via the Lovable platform. Personal data are stored on secure servers and accessible only to technical service providers necessary for website operation.

Bento Cake Studio SNC implements appropriate technical and organizational measures to ensure data security and confidentiality.`,
  },
  {
    id: "16",
    title: "Article 16 – Force Majeure",
    content: `Bento Cake Studio SNC shall not be held liable in the event of force majeure preventing or delaying performance of its obligations. Force majeure includes, but is not limited to, natural disasters, administrative restrictions, raw material shortages, major technical incidents, strikes, or any unforeseeable and irresistible event beyond its control.`,
  },
  {
    id: "17",
    title: "Article 17 – Governing Law and Jurisdiction",
    content: `These GTC are governed by Swiss law.

Any dispute shall be subject to the exclusive jurisdiction of the courts of the Canton of Geneva, following an attempt at amicable resolution.

The language of the contract is French. In the event of translation into another language, only the French version shall prevail.`,
  },
  {
    id: "18",
    title: "Article 18 – Purpose and Legal Basis of Processing",
    content: `Personal data collected via the website are processed for:
• Order management and contract execution
• Customer communication
• Administrative and accounting management
• Website security and proper operation

Processing is based on:
• Contract performance
• Compliance with legal obligations
• Legitimate interest in managing and securing business operations`,
  },
  {
    id: "19",
    title: "Article 19 – Data Retention Period",
    content: `Personal data are retained only for the duration necessary for their intended purposes.

Order and billing data are retained in accordance with Swiss legal obligations, generally for a period of ten (10) years.`,
  },
  {
    id: "20",
    title: "Article 20 – Service Providers and Data Transfer",
    content: `Certain data may be processed by technical service providers acting on behalf of Bento Cake Studio SNC, including for hosting, authentication, and payment processing.

Such providers are bound by confidentiality and data security obligations.

Personal data are not sold or transferred to third parties for commercial purposes.`,
  },
  {
    id: "21",
    title: "Article 21 – Data Security",
    content: `Bento Cake Studio SNC implements appropriate technical and organizational measures to protect personal data against unauthorized access, loss, destruction, or disclosure.

However, no data transmission over the Internet can be guaranteed as completely secure.`,
  },
  {
    id: "22",
    title: "Article 22 – Limitation of Liability",
    content: `Bento Cake Studio SNC strives to provide accurate and up-to-date information on its website. However, no guarantee is given regarding the accuracy, reliability, or completeness of published information.

Use of the website is at the user's own risk.

To the extent permitted by law, Bento Cake Studio SNC disclaims liability for any direct or indirect damages resulting from access to or use of the website.

The website may contain links to third-party websites over which Bento Cake Studio SNC has no control and assumes no responsibility.`,
  },
  {
    id: "23",
    title: "Article 23 – Severability",
    content: `If any provision of these GTC is declared invalid or unenforceable, the remaining provisions shall remain fully in effect.`,
  },
  {
    id: "24",
    title: "Article 24 – Modification of the GTC",
    content: `Bento Cake Studio SNC reserves the right to modify these GTC at any time.

The applicable version is the one published on the website at the date of consultation.

Last updated: 26.02.2026`,
  },
];

const Legal = () => {
  return (
    <Layout>
      <div className="container mx-auto px-4 py-16 max-w-3xl">
        <h1 className="font-sans uppercase tracking-[0.105em] text-3xl md:text-4xl text-center text-foreground mb-2">
          Legal Notice, Terms and Conditions of Sale & Privacy Policy
        </h1>
        <p className="text-center text-muted-foreground mb-10">
          Bento Cake Studio SNC
        </p>

        <Accordion type="multiple" className="w-full">
          {articles.map((article) => (
            <AccordionItem key={article.id} value={article.id}>
              <AccordionTrigger className="text-left font-medium" style={{ color: '#78020E' }}>
                {article.title}
              </AccordionTrigger>
              <AccordionContent>
                <p className="text-muted-foreground whitespace-pre-line leading-relaxed">
                  {article.content}
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
