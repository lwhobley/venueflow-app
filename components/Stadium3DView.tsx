import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Canvas } from '@react-three/fiber/native';
import * as Haptics from 'expo-haptics';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CommandText } from './FutureUI';
import { spacing, useDesignTheme } from '../lib/theme';
import { StadiumScene } from './stadium/StadiumScene';
import { getZoneById, NRG_ZONES, type StadiumZone } from './stadium/nrgZones';

type Tab = 'overview' | 'amenities' | 'beo';

/**
 * Rotatable procedural NRG Stadium for the home page.
 * Drag to spin · tap glowing hotspots for zone details (rooms / amenities / menu·BEO).
 */
export function Stadium3DView() {
  const palette = useDesignTheme();
  const [selectedId, setSelectedId] = useState<string | null>('field');
  const [rotationY, setRotationY] = useState(0.55);
  const [rotationX, setRotationX] = useState(-0.42);
  const [tab, setTab] = useState<Tab>('overview');
  const lastPan = useRef({ x: 0, y: 0 });

  const zone: StadiumZone | undefined = useMemo(() => getZoneById(selectedId), [selectedId]);

  const onSelect = useCallback((id: string) => {
    setSelectedId(id);
    setTab('overview');
    void Haptics.selectionAsync();
  }, []);

  const pan = Gesture.Pan()
    .onBegin(() => {
      lastPan.current = { x: 0, y: 0 };
    })
    .onUpdate((e) => {
      const dx = e.translationX - lastPan.current.x;
      const dy = e.translationY - lastPan.current.y;
      lastPan.current = { x: e.translationX, y: e.translationY };
      setRotationY((y) => y + dx * 0.008);
      setRotationX((x) => {
        const next = x + dy * 0.005;
        return Math.max(-1.1, Math.min(0.15, next));
      });
    });

  return (
    <View style={{ marginHorizontal: spacing.lg, marginTop: spacing.md, gap: spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <View>
          <CommandText palette={palette} variant="label">NRG STADIUM · SPATIAL</CommandText>
          <CommandText palette={palette} variant="title" style={{ marginTop: 2 }}>
            Venue map
          </CommandText>
        </View>
        <CommandText palette={palette} variant="caption">Drag to rotate · Tap zones</CommandText>
      </View>

      <GestureDetector gesture={pan}>
        <View
          style={{
            height: 300,
            backgroundColor: '#0E1612',
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: palette.border,
            overflow: 'hidden',
          }}
        >
          <Canvas
            camera={{ position: [0, 6.5, 14], fov: 38, near: 0.1, far: 80 }}
            gl={{ antialias: true }}
            onCreated={({ gl }) => {
              gl.setClearColor('#0E1612');
            }}
          >
            <StadiumScene
              selectedId={selectedId}
              onSelect={onSelect}
              rotationY={rotationY}
              rotationX={rotationX}
            />
          </Canvas>

          <View
            pointerEvents="box-none"
            style={{
              position: 'absolute',
              left: 8,
              right: 8,
              bottom: 8,
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: 6,
            }}
          >
            {NRG_ZONES.map((z) => {
              const active = z.id === selectedId;
              return (
                <Pressable
                  key={z.id}
                  onPress={() => onSelect(z.id)}
                  style={{
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: active ? z.color : 'rgba(255,255,255,0.18)',
                    backgroundColor: active ? `${z.color}CC` : 'rgba(0,0,0,0.45)',
                  }}
                >
                  <CommandText
                    palette={palette}
                    variant="caption"
                    style={{ color: '#F4F7F4', fontWeight: active ? '700' : '500', fontSize: 10 }}
                  >
                    {z.shortLabel}
                  </CommandText>
                </Pressable>
              );
            })}
          </View>
        </View>
      </GestureDetector>

      {zone ? (
        <View
          style={{
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: palette.border,
            backgroundColor: palette.surface,
            padding: spacing.md,
            gap: spacing.sm,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md }}>
            <View style={{ flex: 1, gap: 2 }}>
              <CommandText palette={palette} variant="label">{zone.shortLabel}</CommandText>
              <CommandText palette={palette} variant="title">{zone.name}</CommandText>
              <CommandText palette={palette} variant="caption">{zone.capacity}</CommandText>
              {zone.sqft ? (
                <CommandText palette={palette} variant="caption">{zone.sqft}</CommandText>
              ) : null}
            </View>
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: zone.color,
                marginTop: 6,
              }}
            />
          </View>

          <View style={{ flexDirection: 'row', gap: spacing.xs }}>
            {(
              [
                ['overview', 'Overview'],
                ['amenities', 'Amenities'],
                ['beo', 'Menu / BEO'],
              ] as const
            ).map(([key, label]) => {
              const active = tab === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => setTab(key)}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: active ? palette.primary : palette.border,
                    backgroundColor: active ? palette.primary : 'transparent',
                  }}
                >
                  <CommandText
                    palette={palette}
                    variant="caption"
                    style={{ color: active ? palette.buttonText : palette.charcoal, fontWeight: '700' }}
                  >
                    {label}
                  </CommandText>
                </Pressable>
              );
            })}
          </View>

          {tab === 'overview' ? (
            <CommandText palette={palette} variant="body">
              {zone.notes ?? 'Operational zone for event setup, staffing, and guest flow.'}
            </CommandText>
          ) : null}

          {tab === 'amenities' ? (
            <View style={{ gap: 6 }}>
              {zone.amenities.map((item) => (
                <View key={item} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <MaterialCommunityIcons name="check-circle-outline" size={16} color={palette.primary} />
                  <CommandText palette={palette} variant="body" style={{ flex: 1 }}>
                    {item}
                  </CommandText>
                </View>
              ))}
            </View>
          ) : null}

          {tab === 'beo' ? (
            <CommandText palette={palette} variant="body">
              {zone.menuOrBeo}
            </CommandText>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
