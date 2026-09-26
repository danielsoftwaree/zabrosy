import { describe, expect, it, vi } from 'vitest';
import { readMotion, readOrientation, relativeAngle, requestSensorPermissions } from './sensors';

describe('sensor permissions', () => {
  it('never requests hardware access in an insecure context', async () => {
    const requestPermission = vi.fn();
    expect(await requestSensorPermissions({ isSecureContext: false, DeviceMotionEvent: { requestPermission } }))
      .toEqual({ orientation: 'insecure', motion: 'insecure' });
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('requests both APIs within the user gesture and handles denial independently', async () => {
    const orientation = vi.fn().mockResolvedValue('denied');
    const motion = vi.fn().mockResolvedValue('granted');
    const result = requestSensorPermissions({
      isSecureContext: true,
      DeviceOrientationEvent: { requestPermission: orientation },
      DeviceMotionEvent: { requestPermission: motion },
    });
    expect(orientation).toHaveBeenCalledOnce();
    expect(motion).toHaveBeenCalledOnce();
    expect(await result).toEqual({ orientation: 'denied', motion: 'granted' });
  });

  it('distinguishes absent APIs and permission failures', async () => {
    expect(await requestSensorPermissions({ isSecureContext: true, DeviceMotionEvent: {
      requestPermission: () => { throw new Error('permission failure'); },
    } })).toEqual({ orientation: 'unavailable', motion: 'error' });
  });
});

describe('sensor interpretation', () => {
  it('does not invent a compass heading from relative alpha', () => {
    expect(readOrientation({ alpha: 30, beta: null, gamma: NaN, absolute: false }))
      .toEqual({ alpha: 30, beta: null, gamma: null, absolute: false, heading: null, accuracy: null });
  });

  it('rejects invalid compass accuracy and preserves real zero', () => {
    const event = { alpha: 0, beta: 0, gamma: 0, absolute: false, webkitCompassHeading: 0 };
    expect(readOrientation(event).heading).toBe(0);
    expect(readOrientation({ ...event, webkitCompassAccuracy: -1 }).heading).toBeNull();
  });

  it('keeps missing acceleration unknown rather than zero', () => {
    expect(readMotion({ rotationRate: null, acceleration: null }).acceleration)
      .toEqual({ x: null, y: null, z: null });
  });

  it('crosses north using the short relative angle', () => {
    expect(relativeAngle(1, 359)).toBe(2);
    expect(relativeAngle(359, 1)).toBe(-2);
  });
});
