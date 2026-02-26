export interface AllergenInfo {
  contains: string;
  mayContain: string;
  warning?: string;
}

export const allergenMap: Record<string, AllergenInfo> = {
  // Standard
  "vanilla": {
    contains: "gluten (wheat), eggs, milk",
    mayContain: "nuts",
  },
  "red-velvet": {
    contains: "gluten (wheat), eggs, milk",
    mayContain: "nuts",
  },
  "chocolate": {
    contains: "gluten (wheat), eggs, milk",
    mayContain: "nuts",
  },
  // Special
  "chocolate-lovers": {
    contains: "gluten (wheat), eggs, milk",
    mayContain: "nuts",
  },
  "dark-berrylicious": {
    contains: "gluten (wheat), eggs, milk",
    mayContain: "nuts",
  },
  "white-berrylicious": {
    contains: "gluten (wheat), eggs, milk",
    mayContain: "nuts",
  },
  "salted-caramel": {
    contains: "gluten (wheat), eggs, milk",
    mayContain: "nuts",
  },
  "lemon-curd": {
    contains: "gluten (wheat), eggs, milk",
    mayContain: "nuts",
  },
  // Deluxe
  "tiramisu": {
    contains: "gluten (wheat), eggs, milk",
    mayContain: "nuts",
  },
  "praline": {
    contains: "gluten (wheat), eggs, milk, nuts (almond, hazelnut)",
    mayContain: "other nuts",
    warning: "Contains almond & hazelnut",
  },
  "passion-fruit": {
    contains: "gluten (wheat), eggs, milk",
    mayContain: "nuts",
  },
  // Gluten-free
  "vanilla-gf": {
    contains: "eggs, milk",
    mayContain: "gluten (wheat), nuts",
  },
  "red-velvet-gf": {
    contains: "eggs, milk",
    mayContain: "gluten (wheat), nuts",
  },
  "chocolate-gf": {
    contains: "eggs, milk",
    mayContain: "gluten (wheat), nuts",
  },
};

export const AllergenDisplay = ({ flavorId }: { flavorId: string }) => {
  const info = allergenMap[flavorId];
  if (!info) return null;

  return (
    <div className="text-[10px] leading-tight mt-1 space-y-0.5">
      {info.warning && (
        <p className="font-semibold text-destructive">⚠️ {info.warning}</p>
      )}
      <p className="text-muted-foreground">
        <span className="font-medium">Contains:</span> {info.contains}
      </p>
      <p className="text-muted-foreground">
        <span className="font-medium">May contain:</span> {info.mayContain}
      </p>
    </div>
  );
};
