import { cn } from "@/lib/utils";

interface CakeVisualizerProps {
  size: string | null;
  shape: string | null;
  baseColor: string | null;
  decorationColor: string | null;
  style: string | null;
  wantsText: boolean;
  cakeText: string;
  textColor: string | null;
  extras: string[];
  candles: { id: string; quantity: number; hasPack: boolean }[];
  currentStep: number;
}

// Color mapping from ID to actual color
const colorMap: Record<string, string> = {
  "white": "#FFFFFF",
  "cream": "#FFF8E7",
  "pastel-pink": "#FFE4EC",
  "pink": "#FFC0CB",
  "dark-pink": "#E75480",
  "dark-red": "#DC143C",
  "burgundy": "#800020",
  "pastel-yellow": "#FDFD96",
  "yellow": "#FFD700",
  "orange": "#FFA500",
  "pastel-orange": "#FFB347",
  "mint-green": "#B8F5C8",
  "green": "#3CB371",
  "forest-green": "#228B22",
  "baby-blue": "#D4F1F9",
  "sky-blue": "#87CEEB",
  "midnight-blue": "#191970",
  "lavender": "#E6E6FA",
  "plum": "#8E4585",
  "light-brown": "#C4A484",
  "dark-brown": "#654321",
  "black": "#000000",
};

const CakeVisualizer = ({
  size,
  shape,
  baseColor,
  decorationColor,
  style,
  wantsText,
  cakeText,
  textColor,
  extras,
  candles,
  currentStep,
}: CakeVisualizerProps) => {
  // Get actual colors
  const fillColor = baseColor ? colorMap[baseColor] || "#FFC0CB" : "#FFC0CB";
  const decoColor = decorationColor ? colorMap[decorationColor] || "#E75480" : "#E75480";
  const txtColor = textColor ? colorMap[textColor] || "#654321" : "#654321";

  // Size dimensions
  const sizeConfig = {
    bento: { width: 120, height: 60, scale: 0.7 },
    medium: { width: 160, height: 80, scale: 0.85 },
    large: { width: 200, height: 100, scale: 1 },
  };

  const currentSize = size ? sizeConfig[size as keyof typeof sizeConfig] : sizeConfig.medium;

  // Check if elements should be visible based on step
  const showShape = currentStep >= 2;
  const showBaseColor = currentStep >= 4;
  const showDecoColor = currentStep >= 5;
  const showStyle = currentStep >= 4;
  const showText = currentStep >= 5 && wantsText && cakeText;
  const showExtras = currentStep >= 6;
  const showCandles = currentStep >= 7;

  // Calculate total candles for display
  const totalCandles = candles.reduce((acc, c) => {
    if (c.hasPack) return acc + 6;
    return acc + c.quantity;
  }, 0);
  const displayCandles = Math.min(totalCandles, 7); // Max 7 candles to display

  // Determine border style
  const hasBorder = style === "normal-with-border" || style === "pearl-borders";
  const hasHearts = style === "heart-bomb";
  const hasShag = style === "shag-cake";
  const hasRainbow = style === "rainbow-cake";
  const hasRoses = style === "roses-please";
  const hasButterfly = style === "butterfly-garden";
  const hasGlitter = style === "glitter-cake" || style === "glitter-in-the-air";
  const hasPearls = style === "scattered-pearls" || style === "pearl-number";
  const hasRetro = style === "retro-vintage";

  // Check for extras
  const hasCherries = extras.includes("cherries") || extras.includes("glitter-cherries");
  const hasGoldLeaves = extras.includes("gold-leaves") || style === "gold-leaves-style";
  const hasRibbons = extras.includes("ribbons") || style === "ribbons";
  const hasButterflyExtra = extras.includes("butterfly");

  return (
    <div className="flex flex-col items-center justify-center p-6 bg-gradient-to-b from-pink-50 to-white rounded-2xl border border-pink-100 shadow-sm">
      <h3 className="text-sm font-medium text-muted-foreground mb-4">Aperçu de votre gâteau</h3>
      
      <svg
        viewBox="0 0 300 280"
        className="w-full max-w-[280px] transition-all duration-500"
        style={{ transform: `scale(${currentSize.scale})` }}
      >
        {/* Plate/Base */}
        <ellipse
          cx="150"
          cy="240"
          rx="100"
          ry="20"
          fill="#E8E0D8"
          stroke="#D4C4B8"
          strokeWidth="2"
          className="transition-all duration-300"
        />

        {showShape && (
          <g className="animate-fade-in">
            {/* Cake Body */}
            {shape === "heart" ? (
              // Heart shape cake
              <g transform="translate(150, 180)">
                {/* Heart-shaped cake body */}
                <path
                  d={`M 0 40 
                      C -60 40, -80 -20, -40 -40 
                      C -20 -55, 0 -40, 0 -25 
                      C 0 -40, 20 -55, 40 -40 
                      C 80 -20, 60 40, 0 40 Z`}
                  fill={showBaseColor ? fillColor : "#FFC0CB"}
                  stroke={hasBorder && showStyle ? decoColor : "transparent"}
                  strokeWidth={hasBorder ? "4" : "0"}
                  className="transition-all duration-500"
                  style={{
                    filter: hasGlitter && showStyle ? "url(#glitter)" : "none"
                  }}
                />
                
                {/* Cake layers */}
                <path
                  d="M -50 20 Q 0 30 50 20"
                  fill="none"
                  stroke={showDecoColor ? decoColor : "#E75480"}
                  strokeWidth="2"
                  opacity="0.5"
                  className="transition-all duration-300"
                />
              </g>
            ) : (
              // Round cake
              <g transform="translate(150, 180)">
                {/* Cake side */}
                <path
                  d={`M -${currentSize.width/2} 0 
                      L -${currentSize.width/2} -${currentSize.height} 
                      Q -${currentSize.width/2} -${currentSize.height + 10}, 0 -${currentSize.height + 10}
                      Q ${currentSize.width/2} -${currentSize.height + 10}, ${currentSize.width/2} -${currentSize.height}
                      L ${currentSize.width/2} 0
                      Q ${currentSize.width/2} 10, 0 15
                      Q -${currentSize.width/2} 10, -${currentSize.width/2} 0 Z`}
                  fill={showBaseColor ? fillColor : "#FFC0CB"}
                  stroke={hasBorder && showStyle ? decoColor : "transparent"}
                  strokeWidth={hasBorder ? "4" : "0"}
                  className="transition-all duration-500"
                  style={{
                    filter: hasGlitter && showStyle ? "url(#glitter)" : "none"
                  }}
                />
                
                {/* Cake top ellipse */}
                <ellipse
                  cx="0"
                  cy={-currentSize.height}
                  rx={currentSize.width/2}
                  ry="15"
                  fill={showBaseColor ? fillColor : "#FFC0CB"}
                  className="transition-all duration-500"
                  style={{
                    filter: showBaseColor ? "brightness(1.05)" : "none"
                  }}
                />

                {/* Layer line */}
                <ellipse
                  cx="0"
                  cy={-currentSize.height/2}
                  rx={currentSize.width/2 + 2}
                  ry="8"
                  fill="none"
                  stroke={showDecoColor ? decoColor : "#E75480"}
                  strokeWidth="2"
                  opacity="0.4"
                  className="transition-all duration-300"
                />
              </g>
            )}

            {/* Decorations based on style */}
            {showStyle && hasHearts && (
              <g className="animate-scale-in">
                {[...Array(5)].map((_, i) => (
                  <text
                    key={i}
                    x={80 + i * 35}
                    y={shape === "heart" ? 155 : 145}
                    fontSize="16"
                    className="transition-all duration-300"
                  >
                    ❤️
                  </text>
                ))}
              </g>
            )}

            {showStyle && hasRoses && (
              <g className="animate-scale-in">
                {[...Array(4)].map((_, i) => (
                  <text
                    key={i}
                    x={95 + i * 38}
                    y={shape === "heart" ? 145 : 135}
                    fontSize="18"
                  >
                    🌹
                  </text>
                ))}
              </g>
            )}

            {showStyle && hasButterfly && (
              <g className="animate-scale-in">
                <text x="140" y={shape === "heart" ? 130 : 120} fontSize="24">🦋</text>
                <text x="120" y={shape === "heart" ? 165 : 155} fontSize="14">🦋</text>
                <text x="165" y={shape === "heart" ? 165 : 155} fontSize="14">🦋</text>
              </g>
            )}

            {showStyle && hasRetro && (
              <g className="animate-scale-in">
                {/* Retro swirls */}
                {[...Array(6)].map((_, i) => (
                  <circle
                    key={i}
                    cx={75 + i * 30}
                    cy={shape === "heart" ? 200 : 195}
                    r="8"
                    fill="none"
                    stroke={decoColor}
                    strokeWidth="2"
                  />
                ))}
              </g>
            )}

            {showStyle && hasRainbow && (
              <g className="animate-scale-in">
                {["#FF6B6B", "#FFE66D", "#4ECDC4", "#45B7D1", "#96E6A1"].map((color, i) => (
                  <rect
                    key={i}
                    x="60"
                    y={110 + i * 15}
                    width="180"
                    height="12"
                    fill={color}
                    opacity="0.6"
                    rx="2"
                  />
                ))}
              </g>
            )}

            {showStyle && hasPearls && (
              <g className="animate-scale-in">
                {[...Array(8)].map((_, i) => (
                  <circle
                    key={i}
                    cx={70 + i * 22}
                    cy={shape === "heart" ? 205 : 200}
                    r="4"
                    fill="#F5F5F5"
                    stroke="#E0E0E0"
                    strokeWidth="1"
                  />
                ))}
              </g>
            )}

            {/* Extras */}
            {showExtras && hasCherries && (
              <g className="animate-scale-in">
                <text x="135" y={shape === "heart" ? 125 : 100} fontSize="20">🍒</text>
                <text x="155" y={shape === "heart" ? 135 : 110} fontSize="16">🍒</text>
              </g>
            )}

            {showExtras && hasGoldLeaves && (
              <g className="animate-scale-in">
                <text x="115" y={shape === "heart" ? 155 : 130} fontSize="16">🍃</text>
                <text x="165" y={shape === "heart" ? 155 : 130} fontSize="16" transform="scale(-1,1) translate(-350, 0)">🍃</text>
              </g>
            )}

            {showExtras && hasRibbons && (
              <g className="animate-scale-in">
                <text x="130" y={shape === "heart" ? 220 : 215} fontSize="28">🎀</text>
              </g>
            )}

            {showExtras && hasButterflyExtra && (
              <g className="animate-scale-in">
                <text x="180" y={shape === "heart" ? 130 : 110} fontSize="20">🦋</text>
              </g>
            )}

            {/* Text on cake */}
            {showText && (
              <text
                x="150"
                y={shape === "heart" ? 175 : 160}
                textAnchor="middle"
                fontSize={cakeText.length > 15 ? "10" : cakeText.length > 10 ? "12" : "14"}
                fontFamily="cursive"
                fill={txtColor}
                className="animate-fade-in transition-all duration-300"
              >
                {cakeText}
              </text>
            )}

            {/* Candles */}
            {showCandles && displayCandles > 0 && (
              <g className="animate-scale-in">
                {[...Array(displayCandles)].map((_, i) => {
                  const spacing = 160 / (displayCandles + 1);
                  const x = 70 + spacing * (i + 1);
                  const baseY = shape === "heart" ? 130 : 95;
                  return (
                    <g key={i}>
                      {/* Candle body */}
                      <rect
                        x={x - 3}
                        y={baseY}
                        width="6"
                        height="25"
                        fill={i % 2 === 0 ? "#FFC0CB" : "#87CEEB"}
                        rx="2"
                      />
                      {/* Flame */}
                      <ellipse
                        cx={x}
                        cy={baseY - 5}
                        rx="4"
                        ry="6"
                        fill="#FFD700"
                      >
                        <animate
                          attributeName="ry"
                          values="6;7;6"
                          dur="0.5s"
                          repeatCount="indefinite"
                        />
                      </ellipse>
                      <ellipse
                        cx={x}
                        cy={baseY - 4}
                        rx="2"
                        ry="3"
                        fill="#FF6B35"
                      />
                    </g>
                  );
                })}
              </g>
            )}
          </g>
        )}

        {/* Glitter filter */}
        <defs>
          <filter id="glitter">
            <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" result="noise" />
            <feColorMatrix type="saturate" values="0" />
            <feBlend in="SourceGraphic" in2="noise" mode="overlay" />
          </filter>
        </defs>
      </svg>

      {/* Step indicator */}
      <div className="mt-4 text-xs text-muted-foreground text-center">
        {!showShape && <span>Sélectionnez une taille pour voir l'aperçu</span>}
        {showShape && !showBaseColor && <span>Aperçu basique</span>}
        {showBaseColor && !showText && <span>Couleurs appliquées</span>}
        {showText && <span>Personnalisation complète</span>}
      </div>
    </div>
  );
};

export default CakeVisualizer;
