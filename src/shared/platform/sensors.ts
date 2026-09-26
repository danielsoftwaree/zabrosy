export type SensorPermission = 'granted' | 'denied' | 'unavailable' | 'insecure' | 'error';

type PermissionConstructor = { requestPermission?: () => Promise<string> };
export type SensorEnvironment = {
  isSecureContext: boolean;
  DeviceOrientationEvent?: PermissionConstructor;
  DeviceMotionEvent?: PermissionConstructor;
};

export function sensorEnvironment(): SensorEnvironment {
  if (typeof window === 'undefined') return { isSecureContext: false };
  return window as unknown as SensorEnvironment;
}

function permissionFor(constructor: PermissionConstructor | undefined): Promise<SensorPermission> {
  if (!constructor) return Promise.resolve('unavailable');
  if (!constructor.requestPermission) return Promise.resolve('granted');
  try {
    return constructor.requestPermission().then(
      (result) => result === 'granted' ? 'granted' : 'denied',
      () => 'error',
    );
  } catch {
    return Promise.resolve('error');
  }
}

// Call directly from a tap. Both requests start before awaiting either permission.
export async function requestSensorPermissions(environment = sensorEnvironment()) {
  if (!environment.isSecureContext) {
    return { orientation: 'insecure', motion: 'insecure' } as const;
  }
  const [orientation, motion] = await Promise.all([
    permissionFor(environment.DeviceOrientationEvent),
    permissionFor(environment.DeviceMotionEvent),
  ]);
  return { orientation, motion };
}

function finite(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function readOrientation(event: Pick<DeviceOrientationEvent, 'alpha' | 'beta' | 'gamma' | 'absolute'> & {
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
}) {
  const accuracy = finite(event.webkitCompassAccuracy);
  const rawHeading = finite(event.webkitCompassHeading);
  return {
    alpha: finite(event.alpha),
    beta: finite(event.beta),
    gamma: finite(event.gamma),
    absolute: event.absolute,
    // Relative alpha is deliberately NOT relabelled as a north-referenced heading.
    heading: rawHeading !== null && (accuracy === null || accuracy >= 0)
      ? ((rawHeading % 360) + 360) % 360 : null,
    accuracy: accuracy !== null && accuracy >= 0 ? accuracy : null,
  };
}

export function readMotion(event: Pick<DeviceMotionEvent, 'rotationRate' | 'acceleration'>) {
  return {
    rotation: {
      alpha: finite(event.rotationRate?.alpha),
      beta: finite(event.rotationRate?.beta),
      gamma: finite(event.rotationRate?.gamma),
    },
    acceleration: {
      x: finite(event.acceleration?.x),
      y: finite(event.acceleration?.y),
      z: finite(event.acceleration?.z),
    },
  };
}

export function relativeAngle(current: number, zero: number) {
  return ((current - zero + 180) % 360 + 360) % 360 - 180;
}

// Heading of the rear camera's optical axis projected onto the horizontal
// plane, in the orientation event's frame. It is NOT a north reference.
export function cameraPlaneHeading(alpha: number | null, beta: number | null, gamma: number | null): number | null {
  if (alpha === null || beta === null || gamma === null || ![alpha, beta, gamma].every(Number.isFinite)) return null
  const a = alpha * Math.PI / 180, b = beta * Math.PI / 180, g = gamma * Math.PI / 180
  const east = -Math.cos(a) * Math.sin(g) - Math.sin(a) * Math.sin(b) * Math.cos(g)
  const north = -Math.sin(a) * Math.sin(g) + Math.cos(a) * Math.sin(b) * Math.cos(g)
  if (Math.hypot(east, north) < 0.15) return null
  return (Math.atan2(east, north) * 180 / Math.PI + 360) % 360
}
