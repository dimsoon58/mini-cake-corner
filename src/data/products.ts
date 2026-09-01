export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  image: string;
  category: string;
  flavors: string[];
  sizes: { name: string; price: number }[];
  designs: { name: string; image: string }[];
}

export const products: Product[] = [
  {
    id: "1",
    name: "Classic Strawberry Bento",
    description: "Fresh strawberry cream topped with seasonal fruits",
    price: 28,
    image: "https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=500&h=500&fit=crop",
    category: "Fruity",
    flavors: ["Strawberry", "Vanilla", "Matcha"],
    sizes: [
      { name: "Small (4\")", price: 28 },
      { name: "Medium (5\")", price: 35 },
      { name: "Large (6\")", price: 42 },
    ],
    designs: [
      { name: "Minimalist", image: "🎨" },
      { name: "Floral", image: "🌸" },
      { name: "Heart", image: "💕" },
      { name: "Birthday", image: "🎂" },
    ],
  },
  {
    id: "2",
    name: "Matcha Dreams",
    description: "Premium Japanese matcha with red bean paste",
    price: 32,
    image: "https://images.unsplash.com/photo-1563729784474-d77dbb933a9e?w=500&h=500&fit=crop",
    category: "Matcha",
    flavors: ["Matcha", "Hojicha", "Black Sesame"],
    sizes: [
      { name: "Small (4\")", price: 32 },
      { name: "Medium (5\")", price: 39 },
      { name: "Large (6\")", price: 46 },
    ],
    designs: [
      { name: "Zen", image: "🍵" },
      { name: "Sakura", image: "🌸" },
      { name: "Traditional", image: "🎋" },
      { name: "Modern", image: "✨" },
    ],
  },
  {
    id: "3",
    name: "Chocolate Delight",
    description: "Rich dark chocolate with gold accents",
    price: 30,
    image: "https://images.unsplash.com/photo-1606890737304-57a1ca8a5b62?w=500&h=500&fit=crop",
    category: "Chocolate",
    flavors: ["Dark Chocolate", "Milk Chocolate", "White Chocolate"],
    sizes: [
      { name: "Small (4\")", price: 30 },
      { name: "Medium (5\")", price: 37 },
      { name: "Large (6\")", price: 44 },
    ],
    designs: [
      { name: "Elegant", image: "✨" },
      { name: "Rustic", image: "🌿" },
      { name: "Romantic", image: "💝" },
      { name: "Classic", image: "🎀" },
    ],
  },
  {
    id: "4",
    name: "Mango Passion",
    description: "Tropical mango mousse with passion fruit",
    price: 29,
    image: "https://images.unsplash.com/photo-1621303837174-89787a7d4729?w=500&h=500&fit=crop",
    category: "Fruity",
    flavors: ["Mango", "Passion Fruit", "Pineapple"],
    sizes: [
      { name: "Small (4\")", price: 29 },
      { name: "Medium (5\")", price: 36 },
      { name: "Large (6\")", price: 43 },
    ],
    designs: [
      { name: "Tropical", image: "🌺" },
      { name: "Sunshine", image: "☀️" },
      { name: "Ocean", image: "🌊" },
      { name: "Garden", image: "🌼" },
    ],
  },
  {
    id: "5",
    name: "Rose Velvet",
    description: "Delicate rose-flavored cream with edible flowers",
    price: 34,
    image: "https://images.unsplash.com/photo-1535141192574-5d4897c12636?w=500&h=500&fit=crop",
    category: "Floral",
    flavors: ["Rose", "Lavender", "Elderflower"],
    sizes: [
      { name: "Small (4\")", price: 34 },
      { name: "Medium (5\")", price: 41 },
      { name: "Large (6\")", price: 48 },
    ],
    designs: [
      { name: "Botanical", image: "🌹" },
      { name: "Vintage", image: "🎭" },
      { name: "Garden Party", image: "🦋" },
      { name: "Luxury", image: "👑" },
    ],
  },
  {
    id: "6",
    name: "Earl Grey Elegance",
    description: "Infused with premium Earl Grey tea and bergamot",
    price: 31,
    image: "https://images.unsplash.com/photo-1464349095431-e9a21285b5f3?w=500&h=500&fit=crop",
    category: "Tea",
    flavors: ["Earl Grey", "Jasmine", "Chamomile"],
    sizes: [
      { name: "Small (4\")", price: 31 },
      { name: "Medium (5\")", price: 38 },
      { name: "Large (6\")", price: 45 },
    ],
    designs: [
      { name: "British", image: "☕" },
      { name: "Elegant", image: "🎩" },
      { name: "Afternoon Tea", image: "🫖" },
      { name: "Sophisticated", image: "🌟" },
    ],
  },
];
