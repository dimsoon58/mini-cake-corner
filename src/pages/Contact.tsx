import Layout from "@/components/Layout";

const Contact = () => {
  return (
    <Layout>
      {/* Content */}
      <main className="max-w-4xl mx-auto px-6 py-16">
        <h1 className="text-4xl md:text-5xl font-serif text-foreground mb-12 text-center">
          Contact Us
        </h1>
        
        <div className="space-y-8 text-foreground leading-relaxed">
          <p className="text-justify">
            For your custom cake, we take many considerations for the price. This includes the cake size and the amount of labor & time required to make your cake.
          </p>
          
          <p className="text-justify">
            If the cake is minimal in the design, the price will remain the same as the starting price. You can send us your idea for customization and we will happily quote you the price.
          </p>
          
          <p className="font-semibold">
            We take orders by insta DM or by Whatsapp:{" "}
            <a 
              href="https://wa.me/41799531317" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              +41 79 953 13 17
            </a>
          </p>
          
          <p className="text-justify">
            All of our cakes are made fresh upon orders, which means we don't have any ready cakes. To ensure your order, please order{" "}
            <strong>1 week in advance minimum</strong>.
          </p>
          
          <p className="text-justify">
            Orders are confirmed only upon receipt of payment. If you wish to cancel or reschedule your order, you must notify us at least{" "}
            <strong>5 days in advance</strong>{" "}
            to receive a refund or change the date. Otherwise,{" "}
            <strong>no refunds or rescheduling will be possible</strong>.
          </p>
        </div>
      </main>
    </Layout>
  );
};

export default Contact;
