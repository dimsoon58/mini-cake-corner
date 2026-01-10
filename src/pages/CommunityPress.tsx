import Layout from "@/components/Layout";

const CommunityPress = () => {
  return (
    <Layout>
      <div className="container mx-auto px-4 py-16">
        <h1 className="font-serif text-4xl md:text-5xl text-center text-foreground mb-8">
          Community & Press
        </h1>
        <p className="text-center text-muted-foreground max-w-2xl mx-auto">
          Stay tuned! We're working on sharing our community highlights and press features.
        </p>
      </div>
    </Layout>
  );
};

export default CommunityPress;