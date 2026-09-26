import { useEffect, useState } from 'react';
import { readMotion, readOrientation } from './sensors';

type Reading<T> = { value: T; receivedAt: number };

export function useDeviceReadings(orientationEnabled: boolean, motionEnabled: boolean) {
  const [orientation, setOrientation] = useState<Reading<ReturnType<typeof readOrientation>> | null>(null);
  const [motion, setMotion] = useState<Reading<ReturnType<typeof readMotion>> | null>(null);

  useEffect(() => {
    if (!orientationEnabled && !motionEnabled) return;
    let lastOrientation = 0;
    let lastMotion = 0;
    const onOrientation = (event: DeviceOrientationEvent) => {
      const now = Date.now();
      if (document.hidden || now - lastOrientation < 100) return;
      const value = readOrientation(event);
      if ([value.alpha, value.beta, value.gamma, value.heading].every((item) => item === null)) return;
      lastOrientation = now;
      setOrientation({ value, receivedAt: now });
    };
    const onMotion = (event: DeviceMotionEvent) => {
      const now = Date.now();
      if (document.hidden || now - lastMotion < 100) return;
      const value = readMotion(event);
      if ([...Object.values(value.rotation), ...Object.values(value.acceleration)].every((item) => item === null)) return;
      lastMotion = now;
      setMotion({ value, receivedAt: now });
    };
    const onVisibility = () => {
      setOrientation(null);
      setMotion(null);
    };
    if (orientationEnabled) window.addEventListener('deviceorientation', onOrientation);
    if (motionEnabled) window.addEventListener('devicemotion', onMotion);
    document.addEventListener('visibilitychange', onVisibility);
    const timer = window.setInterval(() => {
      const oldest = Date.now() - 3000;
      setOrientation((reading) => reading && reading.receivedAt < oldest ? null : reading);
      setMotion((reading) => reading && reading.receivedAt < oldest ? null : reading);
    }, 1000);
    return () => {
      window.removeEventListener('deviceorientation', onOrientation);
      window.removeEventListener('devicemotion', onMotion);
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(timer);
    };
  }, [orientationEnabled, motionEnabled]);

  return { orientation: orientationEnabled ? orientation : null, motion: motionEnabled ? motion : null };
}
