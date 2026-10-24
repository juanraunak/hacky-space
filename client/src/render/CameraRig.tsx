// The game loop and the camera, in that order, before anything draws.
// Damped chase camera (spring on position, slerp on rotation) behind the
// ship; cutscenes take over by returning a shot.

import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { stepGame, ship } from '../play/game';
import { stepRoute } from '../play/route';
import { cutsceneShot, chaseShot, fx } from '../cutscenes/cutscenes';
import { camWorld, maybeRecenter, origin } from './origin';
import { audio } from '../audio/audio';

export const camRef = { current: null as THREE.PerspectiveCamera | null };

const look = new THREE.Matrix4();
const qTarget = new THREE.Quaternion();
const up = new THREE.Vector3();
let lastActive = '';

export function GameLoop() {
  useFrame((_, dt) => {
    stepGame(dt);
    stepRoute();
    const f = ship.field;
    audio.update(ship.rate, ship.thrusting ? (ship.boosting ? 2 : 1) : 0, f ? Math.min(1, f.danger + (f.deepest?.kind === 'black_hole' ? Math.max(0, 1 - f.deepestR / (f.deepest.rs * 4)) : 0)) : 0);
  }, -2);
  return null;
}

export function CameraRig() {
  const camera = useThree(s => s.camera) as THREE.PerspectiveCamera;
  camRef.current = camera;
  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const cut = cutsceneShot();
    const shot = cut ?? chaseShot(1);
    const snap = (fx.active || '') !== lastActive && (fx.active === 'intro' || fx.active === 'ending' || lastActive === 'intro' || lastActive === 'ending');
    lastActive = fx.active;
    const hard = snap || !!shot.cockpit;
    const kp = hard ? 1 : 1 - Math.exp(-dt * (cut ? 3 : 7));
    camWorld.x += (shot.pos.x - camWorld.x) * kp;
    camWorld.y += (shot.pos.y - camWorld.y) * kp;
    camWorld.z += (shot.pos.z - camWorld.z) * kp;
    // gentle shake near wells and on hits
    const f = ship.field;
    const shake = (cut ? 0 : (f?.danger ?? 0) * (shot.cockpit ? 0.04 : 0.35) + ship.hitFlash * (shot.cockpit ? 0.05 : 0.4));
    const t = clock.elapsedTime;
    maybeRecenter();
    camera.position.set(
      camWorld.x - origin.x + Math.sin(t * 37) * shake,
      camWorld.y - origin.y + Math.sin(t * 41 + 1) * shake,
      camWorld.z - origin.z + Math.sin(t * 29 + 2) * shake,
    );
    up.set(0, 1, 0);
    if (!cut || fx.active === 'reunion') up.applyQuaternion(ship.q);
    look.lookAt(camera.position, new THREE.Vector3(shot.look.x - origin.x, shot.look.y - origin.y, shot.look.z - origin.z), up);
    qTarget.setFromRotationMatrix(look);
    camera.quaternion.slerp(qTarget, hard ? 1 : 1 - Math.exp(-dt * (cut ? 4 : 9)));
    const fov = camera.fov + (shot.fov - camera.fov) * (1 - Math.exp(-dt * 4));
    const near = shot.cockpit ? 0.05 : 0.3;
    if (Math.abs(fov - camera.fov) > 0.01 || camera.near !== near) { camera.fov = fov; camera.near = near; camera.updateProjectionMatrix(); }
  }, -1);
  return null;
}
