import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import * as THREE from 'three';
import { STADIUM_ZONES, type StadiumZone } from './stadiumZones';

type Props = {
  selectedId: string | null;
  onSelect: (id: string) => void;
  rotationY: number;
  rotationX: number;
};

function Field() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} receiveShadow>
      <planeGeometry args={[7.2, 4.0]} />
      <meshStandardMaterial color="#1F6B32" roughness={0.85} metalness={0.05} />
    </mesh>
  );
}

/** Elliptical seating bowl ring — generic multi-purpose stadium oval. */
function BowlRing({
  y,
  rx,
  rz,
  height,
  color,
  opacity = 1,
}: {
  y: number;
  rx: number;
  rz: number;
  height: number;
  color: string;
  opacity?: number;
}) {
  const geometry = useMemo(() => {
    const shape = new THREE.Shape();
    const segments = 64;
    for (let i = 0; i <= segments; i += 1) {
      const t = (i / segments) * Math.PI * 2;
      const x = Math.cos(t) * rx;
      const z = Math.sin(t) * rz;
      if (i === 0) shape.moveTo(x, z);
      else shape.lineTo(x, z);
    }
    const hole = new THREE.Path();
    const innerScale = 0.82;
    for (let i = 0; i <= segments; i += 1) {
      const t = (i / segments) * Math.PI * 2;
      const x = Math.cos(t) * rx * innerScale;
      const z = Math.sin(t) * rz * innerScale;
      if (i === 0) hole.moveTo(x, z);
      else hole.lineTo(x, z);
    }
    shape.holes.push(hole);
    return new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
  }, [rx, rz, height]);

  return (
    <mesh geometry={geometry} position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <meshStandardMaterial
        color={color}
        roughness={0.7}
        metalness={0.1}
        transparent={opacity < 1}
        opacity={opacity}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function ZoneHotspot({
  zone,
  selected,
  onSelect,
}: {
  zone: StadiumZone;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const scale = zone.scale ?? 1;

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const mat = meshRef.current.material as THREE.MeshStandardMaterial;
    if (selected) {
      const pulse = 0.55 + Math.sin(clock.elapsedTime * 4.2) * 0.35;
      mat.emissiveIntensity = pulse;
      meshRef.current.scale.setScalar(scale * (1.08 + Math.sin(clock.elapsedTime * 3.5) * 0.06));
    } else {
      mat.emissiveIntensity = 0.25;
      meshRef.current.scale.setScalar(scale);
    }
  });

  return (
    <mesh
      ref={meshRef}
      position={zone.position}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(zone.id);
      }}
    >
      <sphereGeometry args={[0.38, 24, 24]} />
      <meshStandardMaterial
        color={zone.color}
        emissive={zone.color}
        emissiveIntensity={selected ? 0.9 : 0.25}
        roughness={0.35}
        metalness={0.2}
        transparent
        opacity={selected ? 0.95 : 0.78}
      />
    </mesh>
  );
}

export function StadiumScene({ selectedId, onSelect, rotationY, rotationX }: Props) {
  return (
    <group rotation={[rotationX, rotationY, 0]}>
      <ambientLight intensity={0.55} />
      <directionalLight position={[8, 14, 6]} intensity={1.05} castShadow />
      <directionalLight position={[-6, 8, -4]} intensity={0.35} />

      <Field />

      {/* Lower bowl */}
      <BowlRing y={0.35} rx={5.6} rz={7.4} height={0.55} color="#1A2420" />
      {/* Club band */}
      <BowlRing y={1.15} rx={6.3} rz={8.1} height={0.45} color="#24302A" />
      {/* Upper deck */}
      <BowlRing y={2.15} rx={7.0} rz={8.9} height={0.5} color="#1E2923" />
      {/* Rim */}
      <BowlRing y={2.85} rx={7.5} rz={9.4} height={0.22} color="#2C3A32" opacity={0.95} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[0.35, 0.42, 32]} />
        <meshBasicMaterial color="#E8F0EA" transparent opacity={0.35} />
      </mesh>

      {STADIUM_ZONES.map((zone) => (
        <ZoneHotspot
          key={zone.id}
          zone={zone}
          selected={selectedId === zone.id}
          onSelect={onSelect}
        />
      ))}
    </group>
  );
}
