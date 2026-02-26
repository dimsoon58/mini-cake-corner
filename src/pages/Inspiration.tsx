import { useEffect } from "react";
import Layout from "@/components/Layout";

const Inspiration = () => {
  useEffect(() => {
    // Load Pinterest script
    const existing = document.querySelector('script[src*="pinit.js"]');
    if (!existing) {
      const script = document.createElement("script");
      script.src = "https://assets.pinterest.com/js/pinit.js";
      script.async = true;
      script.defer = true;
      document.body.appendChild(script);
    } else {
      // Re-render widgets if script already loaded
      (window as any).PinUtils?.build?.();
    }
  }, []);

  return (
    <Layout>
      <main className="container mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <h1 className="font-serif text-4xl md:text-5xl text-foreground mb-4">
            Inspiration
          </h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Explorez nos créations et inspirations sur Pinterest
          </p>
        </div>

        <div className="flex justify-center my-12">
          <a
            data-pin-do="embedBoard"
            data-pin-board-width="900"
            data-pin-scale-height="800"
            data-pin-scale-width="80"
            href="https://ch.pinterest.com/bentocakestudiosnc/_saved/"
          />
        </div>
      </main>
    </Layout>
  );
};

export default Inspiration;
