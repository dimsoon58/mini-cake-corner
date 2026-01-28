import { Suspense, useRef, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Text3D, Center, Environment, Float } from "@react-three/drei";
import * as THREE from "three";

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

// Plate component
const Plate = () => {
  return (
    <mesh position={[0, -0.1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <cylinderGeometry args={[2.2, 2.2, 0.1, 64]} />
      <meshStandardMaterial color="#E8E0D8" metalness={0.1} roughness={0.8} />
    </mesh>
  );
};

// Round cake component
const RoundCake = ({ 
  radius, 
  height, 
  color, 
  decoColor,
  hasBorder,
  hasHearts,
  hasPearls,
}: { 
  radius: number; 
  height: number; 
  color: string;
  decoColor: string;
  hasBorder: boolean;
  hasHearts: boolean;
  hasPearls: boolean;
}) => {
  const cakeRef = useRef<THREE.Group>(null);

  return (
    <group ref={cakeRef}>
      {/* Main cake body */}
      <mesh position={[0, height / 2, 0]}>
        <cylinderGeometry args={[radius, radius * 1.02, height, 64]} />
        <meshStandardMaterial 
          color={color} 
          roughness={0.4}
          metalness={0.1}
        />
      </mesh>
      
      {/* Cake top layer - slightly lighter */}
      <mesh position={[0, height + 0.02, 0]}>
        <cylinderGeometry args={[radius, radius, 0.05, 64]} />
        <meshStandardMaterial 
          color={color} 
          roughness={0.3}
          metalness={0.05}
        />
      </mesh>

      {/* Middle decoration line */}
      <mesh position={[0, height / 2, 0]}>
        <torusGeometry args={[radius + 0.01, 0.03, 16, 64]} />
        <meshStandardMaterial color={decoColor} roughness={0.5} />
      </mesh>

      {/* Border decoration */}
      {hasBorder && (
        <mesh position={[0, height, 0]}>
          <torusGeometry args={[radius - 0.05, 0.06, 16, 64]} />
          <meshStandardMaterial color={decoColor} roughness={0.4} />
        </mesh>
      )}

      {/* Pearls around base */}
      {hasPearls && [...Array(16)].map((_, i) => {
        const angle = (i / 16) * Math.PI * 2;
        return (
          <mesh 
            key={i} 
            position={[
              Math.cos(angle) * (radius + 0.05),
              0.1,
              Math.sin(angle) * (radius + 0.05)
            ]}
          >
            <sphereGeometry args={[0.08, 16, 16]} />
            <meshStandardMaterial color="#F5F5F5" roughness={0.2} metalness={0.3} />
          </mesh>
        );
      })}

      {/* Hearts decoration */}
      {hasHearts && [...Array(8)].map((_, i) => {
        const angle = (i / 8) * Math.PI * 2;
        return (
          <mesh 
            key={i} 
            position={[
              Math.cos(angle) * (radius - 0.1),
              height + 0.15,
              Math.sin(angle) * (radius - 0.1)
            ]}
            rotation={[0, -angle, 0]}
          >
            <sphereGeometry args={[0.1, 16, 16]} />
            <meshStandardMaterial color="#FF6B8A" roughness={0.3} />
          </mesh>
        );
      })}
    </group>
  );
};

// Heart cake component
const HeartCake = ({ 
  scale, 
  height, 
  color,
  decoColor,
  hasBorder,
}: { 
  scale: number; 
  height: number; 
  color: string;
  decoColor: string;
  hasBorder: boolean;
}) => {
  const heartShape = useMemo(() => {
    const shape = new THREE.Shape();
    const x = 0, y = 0;
    shape.moveTo(x, y + 0.5 * scale);
    shape.bezierCurveTo(x, y + 0.5 * scale, x - 0.1 * scale, y, x - 0.5 * scale, y);
    shape.bezierCurveTo(x - 1 * scale, y, x - 1 * scale, y + 0.7 * scale, x - 1 * scale, y + 0.7 * scale);
    shape.bezierCurveTo(x - 1 * scale, y + 1.1 * scale, x - 0.5 * scale, y + 1.5 * scale, x, y + 1.9 * scale);
    shape.bezierCurveTo(x + 0.5 * scale, y + 1.5 * scale, x + 1 * scale, y + 1.1 * scale, x + 1 * scale, y + 0.7 * scale);
    shape.bezierCurveTo(x + 1 * scale, y + 0.7 * scale, x + 1 * scale, y, x + 0.5 * scale, y);
    shape.bezierCurveTo(x + 0.1 * scale, y, x, y + 0.5 * scale, x, y + 0.5 * scale);
    return shape;
  }, [scale]);

  const extrudeSettings = {
    steps: 2,
    depth: height,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.05,
    bevelOffset: 0,
    bevelSegments: 3,
  };

  return (
    <group rotation={[Math.PI / 2, Math.PI, 0]} position={[0, height / 2, 0.8 * scale]}>
      <mesh>
        <extrudeGeometry args={[heartShape, extrudeSettings]} />
        <meshStandardMaterial color={color} roughness={0.4} metalness={0.1} />
      </mesh>
      
      {/* Border on top */}
      {hasBorder && (
        <mesh position={[0, 1 * scale, height + 0.1]}>
          <torusGeometry args={[0.5 * scale, 0.05, 16, 32]} />
          <meshStandardMaterial color={decoColor} roughness={0.4} />
        </mesh>
      )}
    </group>
  );
};

// Candle component
const Candle = ({ position, color }: { position: [number, number, number]; color: string }) => {
  const flameRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (flameRef.current) {
      flameRef.current.scale.y = 1 + Math.sin(state.clock.elapsedTime * 10) * 0.1;
      flameRef.current.position.y = 0.35 + Math.sin(state.clock.elapsedTime * 8) * 0.02;
    }
  });

  return (
    <group position={position}>
      {/* Candle body */}
      <mesh position={[0, 0.15, 0]}>
        <cylinderGeometry args={[0.04, 0.04, 0.3, 16]} />
        <meshStandardMaterial color={color} roughness={0.6} />
      </mesh>
      {/* Flame */}
      <mesh ref={flameRef} position={[0, 0.35, 0]}>
        <sphereGeometry args={[0.05, 16, 16]} />
        <meshStandardMaterial 
          color="#FFD700" 
          emissive="#FF6B00"
          emissiveIntensity={2}
        />
      </mesh>
      {/* Inner flame */}
      <mesh position={[0, 0.36, 0]}>
        <sphereGeometry args={[0.025, 16, 16]} />
        <meshStandardMaterial 
          color="#FFFFFF" 
          emissive="#FFB347"
          emissiveIntensity={3}
        />
      </mesh>
    </group>
  );
};

// Cherry component
const Cherry = ({ position }: { position: [number, number, number] }) => {
  return (
    <Float speed={2} rotationIntensity={0.2} floatIntensity={0.3}>
      <group position={position}>
        <mesh>
          <sphereGeometry args={[0.12, 16, 16]} />
          <meshStandardMaterial color="#DC143C" roughness={0.3} metalness={0.2} />
        </mesh>
        {/* Stem */}
        <mesh position={[0, 0.15, 0]} rotation={[0, 0, 0.2]}>
          <cylinderGeometry args={[0.01, 0.01, 0.15, 8]} />
          <meshStandardMaterial color="#228B22" />
        </mesh>
      </group>
    </Float>
  );
};

// Rose component
const Rose = ({ position, color }: { position: [number, number, number]; color: string }) => {
  return (
    <group position={position}>
      {[...Array(5)].map((_, i) => {
        const angle = (i / 5) * Math.PI * 2;
        const radius = 0.08;
        return (
          <mesh 
            key={i} 
            position={[Math.cos(angle) * radius, 0, Math.sin(angle) * radius]}
            rotation={[0, angle, 0.3]}
          >
            <sphereGeometry args={[0.06, 8, 8]} />
            <meshStandardMaterial color={color} roughness={0.5} />
          </mesh>
        );
      })}
      <mesh position={[0, 0.02, 0]}>
        <sphereGeometry args={[0.05, 8, 8]} />
        <meshStandardMaterial color={color} roughness={0.5} />
      </mesh>
    </group>
  );
};

// Ribbon/Bow component
const Ribbon = ({ position, color }: { position: [number, number, number]; color: string }) => {
  return (
    <group position={position}>
      {/* Center knot */}
      <mesh>
        <sphereGeometry args={[0.1, 16, 16]} />
        <meshStandardMaterial color={color} roughness={0.4} />
      </mesh>
      {/* Left loop */}
      <mesh position={[-0.15, 0.05, 0]} rotation={[0, 0, 0.5]}>
        <torusGeometry args={[0.1, 0.04, 8, 16]} />
        <meshStandardMaterial color={color} roughness={0.4} />
      </mesh>
      {/* Right loop */}
      <mesh position={[0.15, 0.05, 0]} rotation={[0, 0, -0.5]}>
        <torusGeometry args={[0.1, 0.04, 8, 16]} />
        <meshStandardMaterial color={color} roughness={0.4} />
      </mesh>
    </group>
  );
};

// Main 3D Scene
const CakeScene = ({
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
  const groupRef = useRef<THREE.Group>(null);

  // Slow auto-rotation
  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.3) * 0.3;
    }
  });

  // Get actual colors
  const fillColor = baseColor ? colorMap[baseColor] || "#FFC0CB" : "#FFC0CB";
  const decoColor = decorationColor ? colorMap[decorationColor] || "#E75480" : "#E75480";

  // Size dimensions
  const sizeConfig = {
    bento: { radius: 0.8, height: 0.6 },
    medium: { radius: 1.2, height: 0.8 },
    large: { radius: 1.6, height: 1.0 },
  };

  const currentSize = size ? sizeConfig[size as keyof typeof sizeConfig] : sizeConfig.medium;

  // Check visibility based on step
  const showCake = currentStep >= 1;
  const showBaseColor = currentStep >= 4;
  const showStyle = currentStep >= 4;
  const showExtras = currentStep >= 6;
  const showCandles = currentStep >= 7;

  // Style checks
  const hasBorder = style === "normal-with-border" || style === "pearl-borders";
  const hasHearts = style === "heart-bomb";
  const hasPearls = style === "scattered-pearls" || style === "pearl-number" || style === "pearl-borders";
  const hasRoses = style === "roses-please";

  // Extras checks
  const hasCherries = extras.includes("cherries") || extras.includes("glitter-cherries");
  const hasRibbons = extras.includes("ribbons") || style === "ribbons";

  // Calculate total candles
  const totalCandles = candles.reduce((acc, c) => {
    if (c.hasPack) return acc + 6;
    return acc + c.quantity;
  }, 0);
  const displayCandles = Math.min(totalCandles, 6);

  const cakeColor = showBaseColor ? fillColor : "#FFC0CB";
  const cakeHeight = currentSize.height;

  return (
    <group ref={groupRef}>
      <Plate />
      
      {showCake && (
        <group>
          {shape === "heart" ? (
            <HeartCake 
              scale={currentSize.radius * 0.8}
              height={cakeHeight}
              color={cakeColor}
              decoColor={decoColor}
              hasBorder={hasBorder && showStyle}
            />
          ) : (
            <RoundCake 
              radius={currentSize.radius}
              height={cakeHeight}
              color={cakeColor}
              decoColor={decoColor}
              hasBorder={hasBorder && showStyle}
              hasHearts={hasHearts && showStyle}
              hasPearls={hasPearls && showStyle}
            />
          )}

          {/* Roses */}
          {showStyle && hasRoses && [...Array(5)].map((_, i) => {
            const angle = (i / 5) * Math.PI * 2;
            const r = currentSize.radius * 0.6;
            return (
              <Rose 
                key={i}
                position={[Math.cos(angle) * r, cakeHeight + 0.1, Math.sin(angle) * r]}
                color={decoColor}
              />
            );
          })}

          {/* Cherries */}
          {showExtras && hasCherries && (
            <>
              <Cherry position={[0, cakeHeight + 0.2, 0]} />
              <Cherry position={[0.2, cakeHeight + 0.15, 0.1]} />
            </>
          )}

          {/* Ribbon */}
          {showExtras && hasRibbons && (
            <Ribbon 
              position={[0, cakeHeight * 0.3, currentSize.radius + 0.1]}
              color={decoColor}
            />
          )}

          {/* Candles */}
          {showCandles && displayCandles > 0 && [...Array(displayCandles)].map((_, i) => {
            const angle = (i / displayCandles) * Math.PI * 2;
            const r = currentSize.radius * 0.5;
            const colors = ["#FFC0CB", "#87CEEB", "#FFB347", "#B8F5C8", "#E6E6FA", "#FFD700"];
            return (
              <Candle 
                key={i}
                position={[Math.cos(angle) * r, cakeHeight + 0.05, Math.sin(angle) * r]}
                color={colors[i % colors.length]}
              />
            );
          })}
        </group>
      )}
    </group>
  );
};

const CakeVisualizer = (props: CakeVisualizerProps) => {
  return (
    <div className="flex flex-col items-center justify-center p-4 bg-gradient-to-b from-pink-50 to-white rounded-2xl border border-pink-100 shadow-sm">
      <h3 className="text-sm font-medium text-muted-foreground mb-2">Aperçu 3D de votre gâteau</h3>
      
      <div className="w-full h-[300px] rounded-xl overflow-hidden bg-gradient-to-b from-pink-50/50 to-white">
        <Canvas
          camera={{ position: [3, 2.5, 3], fov: 45 }}
          shadows
        >
          <Suspense fallback={null}>
            <ambientLight intensity={0.6} />
            <directionalLight position={[5, 5, 5]} intensity={1} castShadow />
            <directionalLight position={[-5, 3, -5]} intensity={0.3} />
            <pointLight position={[0, 3, 0]} intensity={0.5} color="#FFE4EC" />
            
            <CakeScene {...props} />
            
            <OrbitControls 
              enableZoom={true}
              enablePan={false}
              minPolarAngle={Math.PI / 6}
              maxPolarAngle={Math.PI / 2.2}
              minDistance={3}
              maxDistance={8}
            />
            <Environment preset="apartment" />
          </Suspense>
        </Canvas>
      </div>

      {/* Step indicator */}
      <div className="mt-3 text-xs text-muted-foreground text-center">
        {props.currentStep < 1 && <span>Sélectionnez une taille pour voir l'aperçu</span>}
        {props.currentStep >= 1 && props.currentStep < 4 && <span>Aperçu basique</span>}
        {props.currentStep >= 4 && props.currentStep < 6 && <span>Couleurs appliquées</span>}
        {props.currentStep >= 6 && <span>🎉 Personnalisation complète</span>}
      </div>
      
      <p className="text-[10px] text-muted-foreground mt-1">
        Faites glisser pour tourner le gâteau
      </p>
    </div>
  );
};

export default CakeVisualizer;
