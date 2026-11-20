export interface RoutePoint {
  id?: string;
  shopName: string;
  village: string;
  latitude: number;
  longitude: number;
  loadKg: number;
  itemSummary: string;
  groupOrderCode?: string | null;
}

export interface VehicleSpec {
  type: 'Auto Cargo' | 'Mini Tempo' | 'Rural Van' | 'Bike Courier';
  capacityKg: number;
  baseDispatchFeeINR: number;
  costPerKmINR: number;
  avgSpeedKmh: number;
}

export const VEHICLE_SPECS: Record<VehicleSpec['type'], VehicleSpec> = {
  'Bike Courier': {
    type: 'Bike Courier',
    capacityKg: 60,
    baseDispatchFeeINR: 90,
    costPerKmINR: 6.5,
    avgSpeedKmh: 36,
  },
  'Auto Cargo': {
    type: 'Auto Cargo',
    capacityKg: 350,
    baseDispatchFeeINR: 180,
    costPerKmINR: 11,
    avgSpeedKmh: 30,
  },
  'Mini Tempo': {
    type: 'Mini Tempo',
    capacityKg: 900,
    baseDispatchFeeINR: 320,
    costPerKmINR: 16,
    avgSpeedKmh: 32,
  },
  'Rural Van': {
    type: 'Rural Van',
    capacityKg: 1500,
    baseDispatchFeeINR: 450,
    costPerKmINR: 20,
    avgSpeedKmh: 34,
  },
};

// Standard rural highway + village feeder winding multiplier over straight-line Haversine distance
const RURAL_ROAD_FACTOR = 1.24;
const UNLOAD_MINUTES_PER_STOP = 12;

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function roadDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  return haversineKm(lat1, lng1, lat2, lng2) * RURAL_ROAD_FACTOR;
}

function computeChainDistance(
  origin: { lat: number; lng: number },
  stops: RoutePoint[]
): number {
  if (stops.length === 0) return 0;
  let total = roadDistanceKm(origin.lat, origin.lng, stops[0].latitude, stops[0].longitude);
  for (let i = 0; i < stops.length - 1; i++) {
    total += roadDistanceKm(
      stops[i].latitude,
      stops[i].longitude,
      stops[i + 1].latitude,
      stops[i + 1].longitude
    );
  }
  return total;
}

// Compute naive individual solo round-trips from depot to each shop separately
function computeSoloTripsTotalDistance(
  origin: { lat: number; lng: number },
  stops: RoutePoint[]
): number {
  return stops.reduce((sum, s) => {
    // One-way outbound delivery leg per individual dispatch
    return sum + roadDistanceKm(origin.lat, origin.lng, s.latitude, s.longitude);
  }, 0);
}

export interface OptimizedRouteResult {
  orderedStops: Array<RoutePoint & { sequenceOrder: number; legKm: number; etaWindow: string }>;
  optimizedDistanceKm: number;
  naiveDistanceKm: number;
  distanceSavedKm: number;
  distanceSavedPct: number;
  estimatedDurationMin: number;
  totalLoadKg: number;
  vehicleCapacityKg: number;
  capacityUtilizationPct: number;
  isOverCapacity: boolean;
  estimatedFuelCostINR: number;
  soloCostPerShopINR: number;
  sharedCostPerShopINR: number;
  optimizationNotes: string;
}

/**
 * Deterministic Nearest-Neighbor + 2-Opt Local Search multi-stop delivery route optimizer.
 * Guarantees transparent, reproducible rural delivery sequencing without black-box claims.
 */
export function optimizeDeliveryRoute(
  origin: { name: string; lat: number; lng: number },
  inputStops: RoutePoint[],
  vehicleType: VehicleSpec['type'] = 'Mini Tempo',
  startHour: number = 7
): OptimizedRouteResult {
  const spec = VEHICLE_SPECS[vehicleType] || VEHICLE_SPECS['Mini Tempo'];

  if (inputStops.length === 0) {
    return {
      orderedStops: [],
      optimizedDistanceKm: 0,
      naiveDistanceKm: 0,
      distanceSavedKm: 0,
      distanceSavedPct: 0,
      estimatedDurationMin: 0,
      totalLoadKg: 0,
      vehicleCapacityKg: spec.capacityKg,
      capacityUtilizationPct: 0,
      isOverCapacity: false,
      estimatedFuelCostINR: 0,
      soloCostPerShopINR: 0,
      sharedCostPerShopINR: 0,
      optimizationNotes: 'Add at least one stop to optimize route.',
    };
  }

  // Step 1: Nearest-Neighbor initial construction from origin depot
  const remaining = [...inputStops];
  const route: RoutePoint[] = [];
  let currLat = origin.lat;
  let currLng = origin.lng;

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = roadDistanceKm(currLat, currLng, remaining[i].latitude, remaining[i].longitude);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const chosen = remaining.splice(bestIdx, 1)[0];
    route.push(chosen);
    currLat = chosen.latitude;
    currLng = chosen.longitude;
  }

  // Step 2: 2-Opt local search refinement for open delivery path
  if (route.length >= 3) {
    let improved = true;
    let iterations = 0;
    while (improved && iterations < 40) {
      improved = false;
      iterations += 1;
      const baseDist = computeChainDistance(origin, route);
      for (let i = 0; i < route.length - 1; i++) {
        for (let k = i + 1; k < route.length; k++) {
          const candidate = [
            ...route.slice(0, i),
            ...route.slice(i, k + 1).reverse(),
            ...route.slice(k + 1),
          ];
          const candDist = computeChainDistance(origin, candidate);
          if (candDist + 0.05 < baseDist) {
            route.splice(0, route.length, ...candidate);
            improved = true;
            break;
          }
        }
        if (improved) break;
      }
    }
  }

  const optimizedDistanceKm = Math.round(computeChainDistance(origin, route) * 10) / 10;
  // Compare against separate solo outbound trips from distributor depot to each village shop
  const soloTotalKm = computeSoloTripsTotalDistance(origin, inputStops);
  const inputOrderKm = computeChainDistance(origin, inputStops);
  const naiveDistanceKm = Math.round(Math.max(soloTotalKm, inputOrderKm) * 10) / 10;
  const distanceSavedKm = Math.max(0, Math.round((naiveDistanceKm - optimizedDistanceKm) * 10) / 10);
  const distanceSavedPct =
    naiveDistanceKm > 0 ? Math.round((distanceSavedKm / naiveDistanceKm) * 100) : 0;

  // Compute cumulative ETAs and leg distances
  let cumulativeMin = startHour * 60;
  let prevLat = origin.lat;
  let prevLng = origin.lng;
  const formatClock = (totalMin: number) => {
    const mins = Math.round(totalMin) % (24 * 60);
    const h24 = Math.floor(mins / 60);
    const m = mins % 60;
    const suffix = h24 >= 12 ? 'PM' : 'AM';
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${suffix}`;
  };

  const orderedStops = route.map((stop, idx) => {
    const legKm = Math.round(roadDistanceKm(prevLat, prevLng, stop.latitude, stop.longitude) * 10) / 10;
    const driveMin = (legKm / spec.avgSpeedKmh) * 60;
    cumulativeMin += driveMin;
    const windowStart = formatClock(cumulativeMin);
    const windowEnd = formatClock(cumulativeMin + 20);
    cumulativeMin += UNLOAD_MINUTES_PER_STOP;
    prevLat = stop.latitude;
    prevLng = stop.longitude;
    return {
      ...stop,
      sequenceOrder: idx + 1,
      legKm,
      etaWindow: `${windowStart} – ${windowEnd}`,
    };
  });

  const estimatedDurationMin = Math.round(cumulativeMin - startHour * 60);
  const totalLoadKg = Math.round(route.reduce((s, r) => s + Math.max(0, r.loadKg), 0) * 10) / 10;
  const capacityUtilizationPct = Math.round((totalLoadKg / spec.capacityKg) * 100);
  const isOverCapacity = totalLoadKg > spec.capacityKg;

  const estimatedFuelCostINR = Math.round(
    spec.baseDispatchFeeINR + optimizedDistanceKm * spec.costPerKmINR
  );
  const sharedCostPerShopINR = Math.round(estimatedFuelCostINR / route.length);

  // Average solo delivery cost per shop if each shop ordered an individual dispatch
  const totalSoloCost = inputStops.reduce((sum, s) => {
    const soloKm = roadDistanceKm(origin.lat, origin.lng, s.latitude, s.longitude);
    return sum + (spec.baseDispatchFeeINR * 0.75 + soloKm * spec.costPerKmINR);
  }, 0);
  const soloCostPerShopINR = Math.round(totalSoloCost / route.length);

  const optimizationNotes = `Nearest-Neighbor + 2-Opt sequence from ${origin.name} (Haversine × ${RURAL_ROAD_FACTOR} rural road factor, ${spec.avgSpeedKmh} km/h avg + ${UNLOAD_MINUTES_PER_STOP} min/stop unloading). Saves ${distanceSavedKm} km (${distanceSavedPct}%) vs. separate shop dispatches.`;

  return {
    orderedStops,
    optimizedDistanceKm,
    naiveDistanceKm,
    distanceSavedKm,
    distanceSavedPct,
    estimatedDurationMin,
    totalLoadKg,
    vehicleCapacityKg: spec.capacityKg,
    capacityUtilizationPct,
    isOverCapacity,
    estimatedFuelCostINR,
    soloCostPerShopINR,
    sharedCostPerShopINR,
    optimizationNotes,
  };
}
