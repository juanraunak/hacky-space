// What the story adds to the 3D scene in flight (PLAN.md v4): the comet, and
// Einstein's comic bubble beside my ship (he rides in the co-pilot seat).

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { BubbleLayer, type BubbleItem } from './Npc';
import { Comet } from './phenomena/Comet';
import { foot } from '../play/onfoot';
import { ship } from '../play/game';
import { flightSaying } from '../play/story';
import { origin } from './origin';

const side = new THREE.Vector3();

export function StoryBubbles() {
  const root = useRef<THREE.Group>(null);
  useFrame(() => { if (root.current) root.current.visible = foot.mode === 'fly'; });
  const items = useMemo<BubbleItem[]>(() => [
    // beside the ship, off the right wing, so the bubble never hides what's ahead
    {
      at: () => {
        side.set(7, -0.4, 0).applyQuaternion(ship.q);
        return [ship.pos.x - origin.x + side.x, ship.pos.y - origin.y + side.y, ship.pos.z - origin.z + side.z];
      },
      source: () => flightSaying(),
    },
  ], []);
  return (
    <group ref={root}>
      <BubbleLayer parent={root} items={items} />
    </group>
  );
}

export function StoryScenery() {
  return <Comet />;
}
