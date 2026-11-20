import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Navigation,
  Package,
  Play,
  Plus,
  Route,
  Truck,
  X,
} from 'lucide-react';
import { useShop } from '../context/ShopContext.tsx';
import {
  optimizeDeliveryRoute,
  RoutePoint,
  VEHICLE_SPECS,
  VehicleSpec,
} from '../services/logisticsEngine.ts';
import type { DeliveryRun } from '../types/dukaaniq.ts';

function formatINR(val: number): string {
  return `₹${Math.round(val).toLocaleString('en-IN')}`;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h <= 0) return `${m} min`;
  return `${h}h ${m}m`;
}

export function LogisticsView() {
  const {
    workspace,
    createDeliveryRun,
    updateDeliveryRunStatus,
    updateDeliveryStopStatus,
    setActiveView,
  } = useShop();

  const runs = workspace?.deliveryRuns || [];
  const [selectedRunId, setSelectedRunId] = useState<number | null>(runs[0]?.id ?? null);
  const [showSoloOverlay, setShowSoloOverlay] = useState(true);
  const [proofDrafts, setProofDrafts] = useState<Record<number, string>>({});
  const [showPlannerModal, setShowPlannerModal] = useState(false);

  // Planner modal state
  const [vehicleType, setVehicleType] = useState<VehicleSpec['type']>('Mini Tempo');
  const [driverName, setDriverName] = useState('Prakash N. (Rural Carrier)');
  const [driverPhone, setDriverPhone] = useState('+91 98451 64012');
  const [startHour, setStartHour] = useState<number>(7);
  const [selectedOriginIdx, setSelectedOriginIdx] = useState<number>(0);
  const [selectedStopKeys, setSelectedStopKeys] = useState<string[]>([]);
  const [stopLoads, setStopLoads] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [plannerErr, setPlannerErr] = useState('');

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  // Keep selectedRunId synchronized when runs list updates
  useEffect(() => {
    if (runs.length === 0) {
      setSelectedRunId(null);
      return;
    }
    if (!selectedRunId || !runs.some((r) => r.id === selectedRunId)) {
      setSelectedRunId(runs[0].id);
    }
  }, [runs, selectedRunId]);

  const activeRun: DeliveryRun | null = useMemo(
    () => runs.find((r) => r.id === selectedRunId) || runs[0] || null,
    [runs, selectedRunId]
  );

  // Unique origin distributor hubs for the Route Planner
  const originHubs = useMemo(() => {
    const offers = workspace?.distributorOffers || [];
    const seen = new Map<string, { name: string; lat: number; lng: number }>();
    for (const o of offers) {
      if (o.latitude != null && o.longitude != null) {
        const key = `${o.distributorName}-${o.distributorCity}`;
        if (!seen.has(key)) {
          seen.set(key, {
            name: `${o.distributorName.replace(' (Verified Demo)', '')} (${o.distributorCity})`,
            lat: o.latitude,
            lng: o.longitude,
          });
        }
      }
    }
    if (seen.size === 0) {
      return [
        {
          name: 'Mysuru APMC Wholesale Depot',
          lat: 12.3385,
          lng: 76.6524,
        },
      ];
    }
    return Array.from(seen.values());
  }, [workspace]);

  // Candidate delivery stops built from your shop + opted-in village clusters + active group orders
  const candidateStops = useMemo(() => {
    if (!workspace) return [];
    const list: Array<RoutePoint & { key: string }> = [];
    const signals = workspace.villageDemandSignals || [];
    const activeGroups = (workspace.groupOrders || []).filter((g) => g.status !== 'cancelled');

    // Add current shop first
    list.push({
      key: 'current-shop',
      shopName: `${workspace.shop.name} (Your Shop)`,
      village: workspace.shop.city,
      latitude: workspace.shop.latitude ?? 12.2958,
      longitude: workspace.shop.longitude ?? 76.6394,
      loadKg: 140,
      itemSummary:
        activeGroups[0]
          ? `${activeGroups[0].productName} (${activeGroups[0].poolCode})`
          : 'Consolidated Weekly Kirana Restock',
      groupOrderCode: activeGroups[0]?.poolCode ?? null,
    });

    // Add opted-in village clusters as candidate delivery stops
    for (const sig of signals) {
      if (!sig.isDemoData) continue;
      list.push({
        key: `village-${sig.id}`,
        shopName: `${sig.villageName} Partner Store`,
        village: sig.villageName.split(' ')[0],
        latitude: sig.latitude,
        longitude: sig.longitude,
        loadKg: Math.min(240, Math.max(80, Math.round(sig.estimatedWeeklyUnits * 0.65))),
        itemSummary: `${sig.topProduct} (${sig.topCategory})`,
        groupOrderCode: activeGroups[0]?.poolCode ?? null,
      });
    }
    return list;
  }, [workspace]);

  // Pre-select first 3 stops when opening modal
  const openPlannerModal = () => {
    const initialKeys = candidateStops.slice(0, 4).map((c) => c.key);
    setSelectedStopKeys(initialKeys);
    const initialLoads: Record<string, number> = {};
    for (const c of candidateStops) initialLoads[c.key] = c.loadKg;
    setStopLoads(initialLoads);
    setShowPlannerModal(true);
  };

  const selectedOrigin = originHubs[selectedOriginIdx] || originHubs[0];

  const plannerStops: RoutePoint[] = useMemo(() => {
    return candidateStops
      .filter((c) => selectedStopKeys.includes(c.key))
      .map((c) => ({
        shopName: c.shopName,
        village: c.village,
        latitude: c.latitude,
        longitude: c.longitude,
        loadKg: stopLoads[c.key] ?? c.loadKg,
        itemSummary: c.itemSummary,
        groupOrderCode: c.groupOrderCode,
      }));
  }, [candidateStops, selectedStopKeys, stopLoads]);

  const livePreviewPlan = useMemo(() => {
    if (!selectedOrigin || plannerStops.length === 0) return null;
    return optimizeDeliveryRoute(selectedOrigin, plannerStops, vehicleType, startHour);
  }, [selectedOrigin, plannerStops, vehicleType, startHour]);

  // Fleet-wide KPIs
  const fleetStats = useMemo(() => {
    const active = runs.filter((r) => r.status !== 'cancelled');
    const totalOptimizedKm = active.reduce((s, r) => s + r.optimizedDistanceKm, 0);
    const totalNaiveKm = active.reduce((s, r) => s + r.naiveDistanceKm, 0);
    const savedKm = Math.max(0, Math.round((totalNaiveKm - totalOptimizedKm) * 10) / 10);
    const savedPct = totalNaiveKm > 0 ? Math.round((savedKm / totalNaiveKm) * 100) : 0;
    const totalSoloSavedPerShop = active.reduce(
      (s, r) => s + Math.max(0, r.soloCostPerShopINR - r.sharedCostPerShopINR),
      0
    );
    const avgCapacityPct =
      active.length > 0
        ? Math.round(
            active.reduce(
              (s, r) => s + (r.totalLoadKg / Math.max(1, r.vehicleCapacityKg)) * 100,
              0
            ) / active.length
          )
        : 0;
    return {
      activeCount: active.length,
      savedKm,
      savedPct,
      totalSoloSavedPerShop,
      avgCapacityPct,
    };
  }, [runs]);

  // Initialize Leaflet route map once
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;
    const map = L.map(mapContainerRef.current, {
      center: [12.2958, 76.6394],
      zoom: 10,
      scrollWheelZoom: true,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 18,
    }).addTo(map);
    const group = L.layerGroup().addTo(map);
    mapInstanceRef.current = map;
    layerGroupRef.current = group;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
      layerGroupRef.current = null;
    };
  }, []);

  // Re-render active delivery route layers on Leaflet map
  useEffect(() => {
    const map = mapInstanceRef.current;
    const group = layerGroupRef.current;
    if (!map || !group || !activeRun) return;

    group.clearLayers();
    const sortedStops = [...activeRun.stops].sort((a, b) => a.sequenceOrder - b.sequenceOrder);
    const boundsPoints: [number, number][] = [[activeRun.originLat, activeRun.originLng]];

    // Optional naive solo trips dashed comparison lines
    if (showSoloOverlay) {
      for (const st of sortedStops) {
        L.polyline(
          [
            [activeRun.originLat, activeRun.originLng],
            [st.latitude, st.longitude],
          ],
          {
            color: '#94A3B8',
            weight: 2,
            opacity: 0.75,
            dashArray: '6 6',
          }
        ).addTo(group);
      }
    }

    // Optimized multi-stop polyline
    const optimizedCoords: [number, number][] = [
      [activeRun.originLat, activeRun.originLng],
      ...sortedStops.map((s) => [s.latitude, s.longitude] as [number, number]),
    ];
    L.polyline(optimizedCoords, {
      color: '#15803D',
      weight: 4,
      opacity: 0.92,
    }).addTo(group);

    // Depot Origin marker
    const depotIcon = L.divIcon({
      className: '',
      html: `<div style="background:#2563EB;color:#fff;font-family:Inter,sans-serif;font-weight:700;font-size:10px;padding:3px 7px;border-radius:6px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.28);white-space:nowrap;">HUB</div>`,
      iconSize: [38, 22],
      iconAnchor: [19, 11],
    });
    L.marker([activeRun.originLat, activeRun.originLng], { icon: depotIcon })
      .bindPopup(
        `<div style="font-family:Inter,sans-serif;line-height:1.4;">
          <div style="font-weight:700;color:#0D2818;font-size:12px;">${escapeHtml(activeRun.originName)}</div>
          <div style="font-size:11px;color:#2563EB;font-weight:600;">Dispatch Origin · ${escapeHtml(activeRun.vehicleType)}</div>
          <div style="font-size:11px;color:#4D6154;margin-top:3px;">Driver: ${escapeHtml(activeRun.driverName)}</div>
        </div>`
      )
      .addTo(group);

    // Numbered Stop Markers
    for (const st of sortedStops) {
      boundsPoints.push([st.latitude, st.longitude]);
      const bg =
        st.status === 'delivered'
          ? '#15803D'
          : st.status === 'en_route'
            ? '#D97706'
            : '#0D2818';
      const stopIcon = L.divIcon({
        className: '',
        html: `<div style="width:26px;height:26px;border-radius:9999px;background:${bg};color:#fff;border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-family:Inter,sans-serif;font-weight:700;font-size:11px;box-shadow:0 2px 6px rgba(0,0,0,0.3);">${st.sequenceOrder}</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });
      L.marker([st.latitude, st.longitude], { icon: stopIcon })
        .bindPopup(
          `<div style="font-family:Inter,sans-serif;min-width:200px;line-height:1.45;">
            <div style="font-weight:700;color:#0D2818;font-size:12px;">Stop #${st.sequenceOrder}: ${escapeHtml(st.shopName)}</div>
            <div style="font-size:11px;color:#54695B;">${escapeHtml(st.village)} · ETA ${escapeHtml(st.etaWindow)}</div>
            <hr style="border:0;border-top:1px solid #DCE6DF;margin:6px 0;" />
            <div style="font-size:11px;color:#0D2818;"><strong>Cargo:</strong> ${escapeHtml(st.itemSummary)}</div>
            <div style="font-size:11px;color:#0D2818;"><strong>Weight:</strong> ${st.loadKg} kg · <strong>Status:</strong> ${escapeHtml(st.status.replace('_', ' ').toUpperCase())}</div>
            ${st.proofNotes ? `<div style="font-size:10px;color:#15803D;margin-top:4px;">Note: ${escapeHtml(st.proofNotes)}</div>` : ''}
          </div>`
        )
        .addTo(group);
    }

    if (boundsPoints.length >= 2) {
      map.fitBounds(L.latLngBounds(boundsPoints), { padding: [36, 36] });
    } else if (boundsPoints.length === 1) {
      map.setView(boundsPoints[0], 11);
    }
  }, [activeRun, showSoloOverlay]);

  if (!workspace) return null;

  const handleSaveOptimizedRun = async (e: React.FormEvent) => {
    e.preventDefault();
    setPlannerErr('');
    if (!driverName.trim()) {
      setPlannerErr('Please enter a driver or carrier name before saving the delivery run.');
      return;
    }
    if (!selectedOrigin || plannerStops.length === 0) {
      setPlannerErr('Select at least one village delivery stop to optimize the route.');
      return;
    }
    setSubmitting(true);
    try {
      await createDeliveryRun({
        vehicleType,
        driverName: driverName.trim(),
        driverPhone: driverPhone.trim(),
        originName: selectedOrigin.name,
        originLat: selectedOrigin.lat,
        originLng: selectedOrigin.lng,
        startHour,
        stops: plannerStops,
      });
      setShowPlannerModal(false);
    } catch (error: unknown) {
      setPlannerErr(error instanceof Error ? error.message : 'Failed to save delivery run.');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleStopSelection = (key: string) => {
    setSelectedStopKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const activeCapacityPct = activeRun
    ? Math.round((activeRun.totalLoadKg / Math.max(1, activeRun.vehicleCapacityKg)) * 100)
    : 0;
  const activeSavedKm = activeRun
    ? Math.max(0, Math.round((activeRun.naiveDistanceKm - activeRun.optimizedDistanceKm) * 10) / 10)
    : 0;
  const activeSavedPct =
    activeRun && activeRun.naiveDistanceKm > 0
      ? Math.round((activeSavedKm / activeRun.naiveDistanceKm) * 100)
      : 0;

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white border border-[#DCE6DF] rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1 max-w-2xl">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#15803D]">
            <Route className="w-3.5 h-3.5" />
            <span>Nearest-Neighbor + 2-Opt Route Optimizer · Transparent Rural Road Costing</span>
          </div>
          <h2 className="font-display text-lg font-bold text-[#0D2818]">
            AI Rural Logistics &amp; Shared Multi-Stop Delivery Optimization
          </h2>
          <p className="text-xs text-[#4D6154]">
            Consolidates nearby village shop orders onto shared vehicles, sequences stops using Nearest-Neighbor + 2-Opt local search (Haversine × 1.24 rural road factor), enforces vehicle payload limits, and tracks stop-by-stop delivery confirmations.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => setActiveView('group_buying')}
            className="px-3.5 py-2 text-xs font-semibold text-[#0D2818] bg-white hover:bg-[#F2F7F3] border border-[#C6D5CA] rounded-lg whitespace-nowrap cursor-pointer"
          >
            Group Orders
          </button>
          <button
            type="button"
            onClick={openPlannerModal}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#15803D] hover:bg-[#166534] rounded-lg whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Plan Optimized Route
          </button>
        </div>
      </div>

      {/* Fleet KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-[#DCE6DF] rounded-xl p-4">
          <p className="text-xs text-[#54695B]">Active Delivery Runs</p>
          <p className="mt-1 font-mono text-2xl font-bold text-[#0D2818] tabular-nums">
            {fleetStats.activeCount}
          </p>
          <p className="mt-0.5 text-xs text-[#54695B]">
            {runs.filter((r) => r.status === 'in_transit').length} in transit ·{' '}
            {runs.filter((r) => r.status === 'completed').length} completed
          </p>
        </div>

        <div className="bg-white border border-[#DCE6DF] rounded-xl p-4">
          <p className="text-xs text-[#54695B]">Distance Saved vs. Solo Trips</p>
          <p className="mt-1 font-mono text-2xl font-bold text-[#15803D] tabular-nums">
            {fleetStats.savedKm} km
          </p>
          <p className="mt-0.5 text-xs text-[#54695B] tabular-nums">
            {fleetStats.savedPct}% fewer rural road kilometers
          </p>
        </div>

        <div className="bg-white border border-[#DCE6DF] rounded-xl p-4">
          <p className="text-xs text-[#54695B]">Est. Transport Saved / Shop</p>
          <p className="mt-1 font-mono text-2xl font-bold text-[#15803D] tabular-nums">
            {formatINR(fleetStats.totalSoloSavedPerShop)}
          </p>
          <p className="mt-0.5 text-xs text-[#54695B]">
            Solo dispatch fee minus shared tempo split
          </p>
        </div>

        <div className="bg-white border border-[#DCE6DF] rounded-xl p-4">
          <p className="text-xs text-[#54695B]">Avg. Vehicle Capacity Load</p>
          <p className="mt-1 font-mono text-2xl font-bold text-[#0D2818] tabular-nums">
            {fleetStats.avgCapacityPct}%
          </p>
          <p className="mt-0.5 text-xs text-[#54695B]">Payload balance across active runs</p>
        </div>
      </div>

      {/* Run Selector Bar */}
      {runs.length > 0 && (
        <div className="flex flex-wrap items-center gap-2.5">
          {runs.map((run) => {
            const doneStops = run.stops.filter((s) => s.status === 'delivered').length;
            const isSelected = activeRun?.id === run.id;
            return (
              <button
                key={run.id}
                type="button"
                onClick={() => setSelectedRunId(run.id)}
                className={`text-left px-4 py-2.5 rounded-xl border transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-[#0D2818] text-white border-[#0D2818]'
                    : 'bg-white text-[#0D2818] border-[#DCE6DF] hover:border-[#B7CBBF]'
                }`}
              >
                <div className="flex items-center gap-2 text-xs font-mono font-bold">
                  <Truck className="w-3.5 h-3.5 text-[#34D399]" />
                  <span>{run.runCode}</span>
                  <span
                    className={`text-[10px] uppercase ${
                      isSelected ? 'text-emerald-300' : 'text-[#15803D]'
                    }`}
                  >
                    · {run.status.replace('_', ' ')}
                  </span>
                </div>
                <p
                  className={`mt-0.5 text-[11px] font-mono tabular-nums ${
                    isSelected ? 'text-emerald-100/80' : 'text-[#54695B]'
                  }`}
                >
                  {run.vehicleType} · {doneStops}/{run.stops.length} stops · {run.optimizedDistanceKm} km
                </p>
              </button>
            );
          })}
        </div>
      )}

      {/* Active Route Map + Dispatch Summary */}
      {activeRun ? (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Map Canvas */}
            <div className="lg:col-span-8 bg-white border border-[#DCE6DF] rounded-xl overflow-hidden flex flex-col">
              <div className="px-4 py-3 border-b border-[#EDF2EE] flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3 text-xs text-[#4D6154]">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-[#0D2818]">
                    <span className="w-3 h-1 bg-[#15803D] rounded" />
                    2-Opt Route ({activeRun.optimizedDistanceKm} km)
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#2563EB]" />
                    Origin Hub
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#15803D]" />
                    Delivered
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#D97706]" />
                    En Route
                  </span>
                </div>

                <label className="inline-flex items-center gap-2 text-xs text-[#3F5346] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showSoloOverlay}
                    onChange={(e) => setShowSoloOverlay(e.target.checked)}
                    className="accent-[#15803D]"
                  />
                  Show Solo Trips ({activeRun.naiveDistanceKm} km)
                </label>
              </div>

              <div ref={mapContainerRef} className="w-full h-[410px] z-0" />
            </div>

            {/* Dispatch Controls & Transparent Costing */}
            <div className="lg:col-span-4 space-y-4">
              <div className="bg-white border border-[#DCE6DF] rounded-xl p-5 space-y-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-mono text-[#54695B]">{activeRun.runCode}</p>
                    <h3 className="font-display text-base font-bold text-[#0D2818]">
                      {activeRun.vehicleType} Dispatch
                    </h3>
                    <p className="text-xs text-[#4D6154] mt-0.5">
                      Driver: <span className="font-semibold text-[#0D2818]">{activeRun.driverName}</span>
                      {activeRun.driverPhone ? ` · ${activeRun.driverPhone}` : ''}
                    </p>
                  </div>
                  <span className="text-xs font-semibold uppercase text-[#15803D]">
                    {activeRun.status.replace('_', ' ')}
                  </span>
                </div>

                {/* Capacity Bar */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#54695B]">Payload Utilization</span>
                    <span
                      className={`font-mono font-semibold tabular-nums ${
                        activeCapacityPct > 100 ? 'text-[#B91C1C]' : 'text-[#0D2818]'
                      }`}
                    >
                      {activeRun.totalLoadKg} / {activeRun.vehicleCapacityKg} kg ({activeCapacityPct}%)
                    </span>
                  </div>
                  <div className="w-full h-2 bg-[#EDF2EE] rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        activeCapacityPct > 100 ? 'bg-[#B91C1C]' : 'bg-[#15803D]'
                      }`}
                      style={{ width: `${Math.min(100, activeCapacityPct)}%` }}
                    />
                  </div>
                </div>

                {/* Transparent Distance & Cost Math */}
                <div className="grid grid-cols-2 gap-3 bg-[#F8FAF8] border border-[#E7EFE9] rounded-lg p-3 text-xs">
                  <div>
                    <p className="text-[#54695B]">Optimized Distance</p>
                    <p className="mt-0.5 font-mono font-bold text-[#0D2818] tabular-nums">
                      {activeRun.optimizedDistanceKm} km
                    </p>
                    <p className="text-[11px] text-[#15803D] font-mono tabular-nums">
                      Saves {activeSavedKm} km ({activeSavedPct}%)
                    </p>
                  </div>
                  <div>
                    <p className="text-[#54695B]">Est. Route Time</p>
                    <p className="mt-0.5 font-mono font-bold text-[#0D2818] tabular-nums">
                      {formatDuration(activeRun.estimatedDurationMin)}
                    </p>
                    <p className="text-[11px] text-[#54695B]">Includes 12m/stop unload</p>
                  </div>
                  <div>
                    <p className="text-[#54695B]">Total Est. Run Cost</p>
                    <p className="mt-0.5 font-mono font-bold text-[#0D2818] tabular-nums">
                      {formatINR(activeRun.estimatedFuelCostINR)}
                    </p>
                    <p className="text-[11px] text-[#54695B]">Base fee + fuel/km</p>
                  </div>
                  <div>
                    <p className="text-[#54695B]">Cost Per Shop</p>
                    <p className="mt-0.5 font-mono font-bold text-[#15803D] tabular-nums">
                      {formatINR(activeRun.sharedCostPerShopINR)}
                    </p>
                    <p className="text-[11px] text-[#54695B] font-mono tabular-nums">
                      vs Solo {formatINR(activeRun.soloCostPerShopINR)}
                    </p>
                  </div>
                </div>

                {activeRun.optimizationNotes && (
                  <p className="text-[11px] text-[#54695B] leading-relaxed">
                    {activeRun.optimizationNotes}
                  </p>
                )}

                {/* Run Status Controls */}
                {activeRun.status !== 'completed' && activeRun.status !== 'cancelled' && (
                  <div className="pt-2 border-t border-[#EDF2EE] flex flex-wrap gap-2">
                    {activeRun.status === 'planned' && (
                      <button
                        type="button"
                        onClick={() => void updateDeliveryRunStatus(activeRun.id, 'dispatched')}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-[#15803D] hover:bg-[#166534] rounded-lg cursor-pointer"
                      >
                        <Play className="w-3.5 h-3.5" />
                        Dispatch Vehicle
                      </button>
                    )}
                    {activeRun.status === 'dispatched' && (
                      <button
                        type="button"
                        onClick={() => void updateDeliveryRunStatus(activeRun.id, 'in_transit')}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-[#0D2818] hover:bg-[#163D26] rounded-lg cursor-pointer"
                      >
                        <Navigation className="w-3.5 h-3.5 text-[#86EFAC]" />
                        Start Transit
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void updateDeliveryRunStatus(activeRun.id, 'completed')}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#0D2818] bg-[#EFF5F1] hover:bg-[#E1ECE5] rounded-lg cursor-pointer"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#15803D]" />
                      Complete Run
                    </button>
                    <button
                      type="button"
                      onClick={() => void updateDeliveryRunStatus(activeRun.id, 'cancelled')}
                      className="px-3 py-2 text-xs font-medium text-[#B91C1C] hover:bg-red-50 rounded-lg cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Stop-by-Stop Delivery Sequence & Proof Checklist */}
          <div className="bg-white border border-[#DCE6DF] rounded-xl overflow-hidden">
            <div className="p-4 border-b border-[#EDF2EE] flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-display text-sm font-bold text-[#0D2818]">
                  Optimized Multi-Stop Delivery Sequence ({activeRun.runCode})
                </h3>
                <p className="text-xs text-[#54695B]">
                  Origin: {activeRun.originName} · Update each stop as the vehicle arrives and unloads.
                </p>
              </div>
              <span className="text-xs font-mono text-[#54695B] tabular-nums">
                {activeRun.stops.filter((s) => s.status === 'delivered').length} of{' '}
                {activeRun.stops.length} stops delivered
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#E2EAE4] bg-[#F5F9F6] text-xs font-semibold text-[#4D6154]">
                    <th className="py-3 px-4">Stop</th>
                    <th className="py-3 px-3">Shop &amp; Village</th>
                    <th className="py-3 px-3">Cargo Summary</th>
                    <th className="py-3 px-3 text-right">Load (kg)</th>
                    <th className="py-3 px-3">ETA Window</th>
                    <th className="py-3 px-3">Status &amp; Delivery Proof</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EDF2EE] text-xs">
                  {[...activeRun.stops]
                    .sort((a, b) => a.sequenceOrder - b.sequenceOrder)
                    .map((st) => {
                      const proofVal = proofDrafts[st.id] ?? st.proofNotes ?? '';
                      return (
                        <tr key={st.id} className="hover:bg-[#F9FBF9]">
                          <td className="py-3 px-4 font-mono font-bold text-[#0D2818]">
                            #{st.sequenceOrder}
                          </td>
                          <td className="py-3 px-3">
                            <p className="font-semibold text-[#0D2818]">{st.shopName}</p>
                            <p className="text-[11px] text-[#54695B]">
                              {st.village} · {st.latitude.toFixed(3)}, {st.longitude.toFixed(3)}
                            </p>
                          </td>
                          <td className="py-3 px-3">
                            <p className="text-[#0D2818]">{st.itemSummary}</p>
                            {st.groupOrderCode && (
                              <p className="text-[11px] font-mono text-[#15803D]">
                                Pool: {st.groupOrderCode}
                              </p>
                            )}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums text-[#0D2818]">
                            {st.loadKg} kg
                          </td>
                          <td className="py-3 px-3 font-mono text-[#4D6154] whitespace-nowrap">
                            <span className="inline-flex items-center gap-1">
                              <Clock className="w-3 h-3 text-[#54695B]" />
                              {st.etaWindow}
                            </span>
                          </td>
                          <td className="py-3 px-3">
                            <p
                              className={`font-semibold uppercase text-[11px] ${
                                st.status === 'delivered'
                                  ? 'text-[#15803D]'
                                  : st.status === 'en_route'
                                    ? 'text-[#D97706]'
                                    : 'text-[#54695B]'
                              }`}
                            >
                              {st.status.replace('_', ' ')}
                              {st.deliveredAt ? ` · ${st.deliveredAt}` : ''}
                            </p>
                            {st.status === 'delivered' ? (
                              <p className="text-[11px] text-[#4D6154] mt-0.5">
                                {st.proofNotes || 'Handover confirmed'}
                              </p>
                            ) : (
                              <input
                                type="text"
                                placeholder="Optional handover note (e.g. signed)"
                                value={proofVal}
                                onChange={(e) =>
                                  setProofDrafts((prev) => ({ ...prev, [st.id]: e.target.value }))
                                }
                                className="mt-1 w-48 px-2 py-1 text-[11px] border border-[#DCE6DF] rounded"
                              />
                            )}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            {st.status === 'delivered' ? (
                              <span className="inline-flex items-center gap-1 text-[#15803D] font-semibold">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Done
                              </span>
                            ) : (
                              <div className="inline-flex items-center gap-1.5">
                                {st.status === 'pending' && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void updateDeliveryStopStatus(activeRun.id, st.id, 'en_route')
                                    }
                                    className="px-2.5 py-1.5 text-xs font-medium text-[#0D2818] bg-[#EFF5F1] hover:bg-[#E1ECE5] rounded-lg cursor-pointer"
                                  >
                                    En Route
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() =>
                                    void updateDeliveryStopStatus(
                                      activeRun.id,
                                      st.id,
                                      'delivered',
                                      proofVal || 'Verified & received by shopkeeper'
                                    )
                                  }
                                  className="px-2.5 py-1.5 text-xs font-semibold text-white bg-[#15803D] hover:bg-[#166534] rounded-lg cursor-pointer"
                                >
                                  Mark Delivered
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div className="bg-white border border-[#DCE6DF] rounded-xl p-8 text-center space-y-3">
          <Package className="w-8 h-8 text-[#15803D] mx-auto" />
          <p className="text-sm font-semibold text-[#0D2818]">No delivery runs planned yet</p>
          <p className="text-xs text-[#54695B]">
            Combine nearby village orders into an optimized multi-stop route to cut fuel and delivery fees.
          </p>
          <button
            type="button"
            onClick={openPlannerModal}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#15803D] hover:bg-[#166534] rounded-lg cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Plan First Optimized Route
          </button>
        </div>
      )}

      {/* AI Route Optimizer & Planner Modal */}
      {showPlannerModal && (
        <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-[#DCE6DF] rounded-2xl w-full max-w-2xl p-6 space-y-5 my-8">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-display text-base font-bold text-[#0D2818]">
                  Plan Multi-Stop Rural Delivery Route (2-Opt Optimizer)
                </h3>
                <p className="text-xs text-[#54695B]">
                  Select depot, vehicle class, and village stops to preview exact optimized sequence &amp; savings.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPlannerModal(false)}
                className="p-1.5 text-[#54695B] hover:text-[#0D2818] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveOptimizedRun} className="space-y-4 text-xs">
              {plannerErr && (
                <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                  {plannerErr}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-[#3F5346] mb-1">
                    Origin Wholesale Hub
                  </label>
                  <select
                    value={selectedOriginIdx}
                    onChange={(e) => setSelectedOriginIdx(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-[#C6D5CA] rounded-lg"
                  >
                    {originHubs.map((hub, idx) => (
                      <option key={hub.name} value={idx}>
                        {hub.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-[#3F5346] mb-1">
                    Vehicle Class &amp; Capacity
                  </label>
                  <select
                    value={vehicleType}
                    onChange={(e) => setVehicleType(e.target.value as VehicleSpec['type'])}
                    className="w-full px-3 py-2 border border-[#C6D5CA] rounded-lg"
                  >
                    {Object.values(VEHICLE_SPECS).map((spec) => (
                      <option key={spec.type} value={spec.type}>
                        {spec.type} — {spec.capacityKg} kg max · ₹{spec.costPerKmINR}/km
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-[#3F5346] mb-1">Driver / Carrier</label>
                  <input
                    type="text"
                    value={driverName}
                    onChange={(e) => setDriverName(e.target.value)}
                    className="w-full px-3 py-2 border border-[#C6D5CA] rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block font-medium text-[#3F5346] mb-1">Driver Contact</label>
                  <input
                    type="text"
                    value={driverPhone}
                    onChange={(e) => setDriverPhone(e.target.value)}
                    className="w-full px-3 py-2 border border-[#C6D5CA] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[#3F5346] mb-1">Departure Hour (24h)</label>
                  <input
                    type="number"
                    min={5}
                    max={18}
                    value={startHour}
                    onChange={(e) => setStartHour(Number(e.target.value))}
                    className="w-full px-3 py-2 font-mono border border-[#C6D5CA] rounded-lg"
                  />
                </div>
              </div>

              {/* Stop Checklist */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-[#0D2818]">
                    Select Village Stops &amp; Cargo Weight (kg)
                  </label>
                  <span className="text-[#54695B] font-mono">
                    {plannerStops.length} stops selected
                  </span>
                </div>
                <div className="max-h-48 overflow-y-auto divide-y divide-[#EDF2EE] border border-[#DCE6DF] rounded-xl">
                  {candidateStops.map((stop) => {
                    const checked = selectedStopKeys.includes(stop.key);
                    return (
                      <div
                        key={stop.key}
                        className="px-3 py-2.5 flex items-center justify-between gap-3 hover:bg-[#F9FBF9]"
                      >
                        <label className="flex items-center gap-2.5 cursor-pointer min-w-0">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleStopSelection(stop.key)}
                            className="accent-[#15803D]"
                          />
                          <div className="min-w-0">
                            <p className="font-semibold text-[#0D2818] truncate">{stop.shopName}</p>
                            <p className="text-[11px] text-[#54695B] truncate">
                              {stop.village} · {stop.itemSummary}
                            </p>
                          </div>
                        </label>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <input
                            type="number"
                            min={10}
                            max={1200}
                            disabled={!checked}
                            value={stopLoads[stop.key] ?? stop.loadKg}
                            onChange={(e) =>
                              setStopLoads((prev) => ({
                                ...prev,
                                [stop.key]: Math.max(1, Number(e.target.value)),
                              }))
                            }
                            className="w-16 px-2 py-1 font-mono text-right border border-[#C6D5CA] rounded disabled:opacity-40"
                          />
                          <span className="text-[11px] text-[#54695B]">kg</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Live 2-Opt Optimization Preview */}
              {livePreviewPlan && (
                <div className="bg-[#F8FAF8] border border-[#DCE6DF] rounded-xl p-4 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-display font-bold text-[#0D2818]">
                      Live 2-Opt Route Preview
                    </p>
                    <span className="font-mono font-semibold text-[#15803D] tabular-nums">
                      Saves {livePreviewPlan.distanceSavedKm} km ({livePreviewPlan.distanceSavedPct}%)
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono tabular-nums">
                    <div>
                      <p className="text-[11px] text-[#54695B]">Optimized Dist</p>
                      <p className="font-bold text-[#0D2818]">
                        {livePreviewPlan.optimizedDistanceKm} km
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] text-[#54695B]">Est. Duration</p>
                      <p className="font-bold text-[#0D2818]">
                        {formatDuration(livePreviewPlan.estimatedDurationMin)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] text-[#54695B]">Shared / Shop</p>
                      <p className="font-bold text-[#15803D]">
                        {formatINR(livePreviewPlan.sharedCostPerShopINR)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] text-[#54695B]">Load vs Capacity</p>
                      <p
                        className={`font-bold ${
                          livePreviewPlan.isOverCapacity ? 'text-[#B91C1C]' : 'text-[#0D2818]'
                        }`}
                      >
                        {livePreviewPlan.totalLoadKg}/{livePreviewPlan.vehicleCapacityKg} kg
                      </p>
                    </div>
                  </div>
                  <p className="text-[11px] text-[#4D6154]">
                    Sequence:{' '}
                    <span className="font-semibold text-[#0D2818]">
                      Depot → {livePreviewPlan.orderedStops.map((s) => s.village).join(' → ')}
                    </span>
                  </p>
                  {livePreviewPlan.isOverCapacity && (
                    <div className="flex items-center gap-2 text-[#B91C1C] font-medium">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        Total load exceeds {vehicleType} capacity ({livePreviewPlan.vehicleCapacityKg} kg). Upgrade vehicle class or split into 2 runs.
                      </span>
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowPlannerModal(false)}
                  className="px-4 py-2 font-medium text-[#4D6154] hover:bg-[#F2F7F3] rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || plannerStops.length === 0 || Boolean(livePreviewPlan?.isOverCapacity)}
                  className="px-4 py-2 font-semibold text-white bg-[#15803D] hover:bg-[#166534] disabled:opacity-50 rounded-lg cursor-pointer"
                >
                  {submitting ? 'Saving Route...' : 'Save Optimized Delivery Run'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
