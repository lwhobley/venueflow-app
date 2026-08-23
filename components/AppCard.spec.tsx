import React from 'react';
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnimatedTab, AppCard, CollapsibleSection, Rule, SectionHeader } from './AppCard';

const animation = vi.hoisted(() => ({ parallel: vi.fn(), timing: vi.fn() }));

vi.mock('react-native', () => {
  class Value {
    setValue = vi.fn();
    interpolate = vi.fn(() => 'rotation');
  }
  const Animated = {
    Value,
    View: 'Animated.View',
    parallel: (items: unknown[]) => {
      animation.parallel(items);
      return { start: vi.fn() };
    },
    timing: (...args: unknown[]) => {
      animation.timing(...args);
      return { start: vi.fn() };
    },
  };
  return {
    Animated,
    Easing: { cubic: 'cubic', out: (value: unknown) => value },
    LayoutAnimation: { configureNext: vi.fn() },
    Platform: { OS: 'ios' },
    Pressable: 'Pressable',
    StyleSheet: { hairlineWidth: 1 },
    UIManager: {},
    View: 'View',
  };
});
vi.mock('react-native-paper', () => ({ Text: 'Text' }));
vi.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: 'Icon' }));
vi.mock('../lib/theme', () => ({
  radius: { sharp: 0, soft: 16 },
  spacing: { lg: 24, md: 16, sm: 8 },
  type: { body: {}, label: {}, title: {} },
  useDesignTheme: () => ({
    border: '#222', charcoal: '#111', cream: '#eee', divider: '#333',
    muted: '#777', primary: '#900', surface: '#fff', surfaceSoft: '#f5f5f5',
  }),
}));

describe('AppCard primitives', () => {
  beforeEach(() => {
    animation.parallel.mockClear();
    animation.timing.mockClear();
  });

  it('renders editorial card and section variants', async () => {
    const renderer = createRoot();
    await act(async () => renderer.render(
      <AppCard tone="soft" padded={false}>
        <SectionHeader kicker="Today" title="Floor" subtitle="Overview" trailing="action" />
        <Rule />
      </AppCard>,
    ));

    const output = JSON.stringify(renderer.container.toJSON());
    expect(output).toContain('Today');
    expect(output).toContain('Floor');
    expect(output).toContain('Overview');
    expect(output).toContain('action');
  });

  it('expands a collapsible section when pressed', async () => {
    const renderer = createRoot();
    await act(async () => renderer.render(
      <CollapsibleSection title="Details" subtitle="More">hidden detail</CollapsibleSection>,
    ));
    expect(JSON.stringify(renderer.container.toJSON())).not.toContain('hidden detail');

    const pressable = renderer.container.queryAll((node) => node.type === 'Pressable')[0];
    await act(async () => pressable.props.onPress());
    expect(JSON.stringify(renderer.container.toJSON())).toContain('hidden detail');
  });

  it('starts the tab transition animation', async () => {
    const renderer = createRoot();
    await act(async () => renderer.render(<AnimatedTab tabKey="reports">tab body</AnimatedTab>));

    expect(JSON.stringify(renderer.container.toJSON())).toContain('tab body');
    expect(animation.parallel).toHaveBeenCalledOnce();
    expect(animation.timing).toHaveBeenCalledTimes(2);
  });
});
