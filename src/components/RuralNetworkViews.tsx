import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  CheckCircle2,
  Compass,
  Layers,
  Lock,
  MapPin,
  Navigation,
  Plus,
  ShieldCheck,
  Store,
  Truck,
  Users,
  X,
} from 'lucide-react';
import { useShop } from '../context/ShopContext.tsx';
import type { DistributorOffer, GroupOrder } from '../types/dukaaniq.ts';

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

function getPoolSavings(pool: GroupOrder) {
  const myMember = pool.members.find((m) => m.isCurrentShop);
  const myQty = myMember?.quantity ?? 0;
  const unitDiscount = Math.max(0, pool.standardUnitPrice - pool.bulkUnitPrice);
  const myProductSavings = Math.round(unitDiscount * myQty);
  const poolProductSavings = Math.round(unitDiscount * pool.combinedQty);
  const myTransportSavings =
    myQty > 0 ? Math.max(0, Math.round(pool.estTransportFeeIndividual - pool.estTransportFeeShared)) : 0;
  return {
    myQty,
    unitDiscount,
    myProductSavings,
    poolProductSavings,
    myTransportSavings,
    totalMySavings: myProductSavings + myTransportSavings,
  };
}

export function VillageDemandMapView() {
  const { workspace, forecasts, toggleVillageDemandOptIn, setActiveView, notify } = useShop();
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  const signals = workspace?.villageDemandSignals || [];
  const offers = workspace?.distributorOffers || [];
  const ownSignal = signals.find((s) => !s.isDemoData);

  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [villageInput, setVillageInput] = useState<string>(
    ownSignal?.villageName || `${workspace?.shop.city || 'Mysuru'} Cluster`
  );
  const [districtInput, setDistrictInput] = useState<string>(
    ownSignal?.district || workspace?.shop.city || 'Mysuru'
  );
  const [latInput, setLatInput] = useState<string>(
    String(ownSignal?.latitude ?? workspace?.shop.latitude ?? 12.2958)
  );
  const [lngInput, setLngInput] = useState<string>(
    String(ownSignal?.longitude ?? workspace?.shop.longitude ?? 76.6394)
  );
  const [locatingGps, setLocatingGps] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  // Compute privacy-safe anonymized aggregate from current shop forecasts
  const ownShopAggregate = useMemo(() => {
    if (!forecasts.length) {
      return {
        topCategory: 'Staples & Grains',
        topProduct: 'Essential Staples',
        estimatedWeeklyUnits: 140,
        shortageSeverity: 'moderate' as const,
      };
    }
    const sorted = [...forecasts].sort((a, b) => b.expectedDemand7d - a.expectedDemand7d);
    const top = sorted[0];
    const totalWeekly = Math.round(forecasts.reduce((s, f) => s + f.expectedDemand7d, 0));
    const shortageCount = forecasts.filter((f) => f.shortageRisk).length;
    const shortageSeverity: 'low' | 'moderate' | 'high' =
      shortageCount >= 5 ? 'high' : shortageCount >= 2 ? 'moderate' : 'low';
    return {
      topCategory: top.category,
      topProduct: top.productName,
      estimatedWeeklyUnits: Math.max(20, totalWeekly),
      shortageSeverity,
    };
  }, [forecasts]);

  const categories = useMemo(() => {
    const set = new Set<string>(['All']);
    for (const s of signals) set.add(s.topCategory);
    return Array.from(set);
  }, [signals]);

  const visibleSignals = useMemo(() => {
    return signals.filter((s) => {
      if (!s.isOptedIn) return false;
      if (categoryFilter !== 'All' && s.topCategory !== categoryFilter) return false;
      return true;
    });
  }, [signals, categoryFilter]);

  // Unique verified distributor hub coordinates
  const distributorHubs = useMemo(() => {
    const hubMap = new Map<
      string,
      { name: string; city: string; lat: number; lng: number; skuCount: number; verified: boolean }
    >();
    for (const o of offers) {
      if (o.latitude == null || o.longitude == null) continue;
      const key = `${o.distributorName}-${o.distributorCity}`;
      const existing = hubMap.get(key);
      if (existing) {
        existing.skuCount += 1;
      } else {
        hubMap.set(key, {
          name: o.distributorName,
          city: o.distributorCity,
          lat: o.latitude,
          lng: o.longitude,
          skuCount: 1,
          verified: o.verified,
        });
      }
    }
    return Array.from(hubMap.values());
  }, [offers]);

  const mapCenter: [number, number] = useMemo(() => {
    const parsedLat = Number(latInput);
    const parsedLng = Number(lngInput);
    if (Number.isFinite(parsedLat) && Number.isFinite(parsedLng)) {
      return [parsedLat, parsedLng];
    }
    return [12.2958, 76.6394];
  }, [latInput, lngInput]);

  // Initialize Leaflet map once
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: mapCenter,
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

  // Re-render Leaflet layers whenever visibleSignals, distributorHubs, or shop location changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    const group = layerGroupRef.current;
    if (!map || !group || !workspace) return;

    group.clearLayers();

    // 1. Privacy-safe village demand circles
    for (const sig of visibleSignals) {
      const color =
        sig.shortageSeverity === 'high'
          ? '#B91C1C'
          : sig.shortageSeverity === 'moderate'
            ? '#D97706'
            : '#15803D';
      const radiusMeters = Math.min(7500, Math.max(2200, sig.estimatedWeeklyUnits * 18));

      L.circle([sig.latitude, sig.longitude], {
        radius: radiusMeters,
        color,
        weight: 2,
        fillColor: color,
        fillOpacity: 0.2,
      })
        .bindPopup(
          `<div style="font-family: Inter, sans-serif; min-width: 210px; line-height: 1.45;">
            <div style="font-weight: 700; color: #0D2818; font-size: 13px;">${escapeHtml(sig.villageName)}</div>
            <div style="font-size: 11px; color: #54695B; margin-top: 2px;">${escapeHtml(sig.district)} District · ${sig.connectedShopsCount} opted-in shops${sig.isDemoData ? ' (Demo Cluster)' : ' (Your Cluster)'}</div>
            <hr style="border: 0; border-top: 1px solid #DCE6DF; margin: 8px 0;" />
            <div style="font-size: 11px; color: #0D2818;"><strong>Top Category:</strong> ${escapeHtml(sig.topCategory)}</div>
            <div style="font-size: 11px; color: #0D2818;"><strong>High-Demand SKU:</strong> ${escapeHtml(sig.topProduct)}</div>
            <div style="font-size: 11px; color: #0D2818;"><strong>Est. Weekly Demand:</strong> ${sig.estimatedWeeklyUnits.toLocaleString('en-IN')} units</div>
            <div style="font-size: 11px; color: ${color}; font-weight: 600; margin-top: 4px;">Shortage Signal: ${escapeHtml(sig.shortageSeverity.toUpperCase())}</div>
            <div style="font-size: 10px; color: #54695B; margin-top: 6px;">Aggregated village data only. No individual shop sales or bills exposed.</div>
          </div>`
        )
        .addTo(group);

      L.circleMarker([sig.latitude, sig.longitude], {
        radius: 5,
        color: '#FFFFFF',
        weight: 1.5,
        fillColor: color,
        fillOpacity: 1,
      }).addTo(group);
    }

    // 2. Verified distributor hubs
    for (const hub of distributorHubs) {
      L.circleMarker([hub.lat, hub.lng], {
        radius: 8,
        color: '#FFFFFF',
        weight: 2,
        fillColor: '#2563EB',
        fillOpacity: 0.95,
      })
        .bindPopup(
          `<div style="font-family: Inter, sans-serif; min-width: 190px; line-height: 1.45;">
            <div style="font-weight: 700; color: #0D2818; font-size: 12px;">${escapeHtml(hub.name)}</div>
            <div style="font-size: 11px; color: #2563EB; font-weight: 600;">${hub.verified ? 'Verified Wholesale Hub' : 'Distributor Hub'} · ${escapeHtml(hub.city)}</div>
            <div style="font-size: 11px; color: #4D6154; margin-top: 4px;">${hub.skuCount} active bulk-tier catalog offers</div>
          </div>`
        )
        .addTo(group);
    }

    // 3. Current shop location marker
    const shopLat = workspace.shop.latitude ?? mapCenter[0];
    const shopLng = workspace.shop.longitude ?? mapCenter[1];
    L.circleMarker([shopLat, shopLng], {
      radius: 9,
      color: '#10B981',
      weight: 3,
      fillColor: '#0D2818',
      fillOpacity: 1,
    })
      .bindPopup(
        `<div style="font-family: Inter, sans-serif; line-height: 1.4;">
          <div style="font-weight: 700; color: #0D2818; font-size: 12px;">${escapeHtml(workspace.shop.name)} (Your Shop)</div>
          <div style="font-size: 11px; color: #15803D;">${escapeHtml(workspace.shop.city)}, ${escapeHtml(workspace.shop.state)}</div>
          <div style="font-size: 10px; color: #54695B; margin-top: 3px;">Coords: ${shopLat.toFixed(4)}, ${shopLng.toFixed(4)}</div>
        </div>`
      )
      .addTo(group);

    map.setView([shopLat, shopLng], map.getZoom(), { animate: true });
  }, [visibleSignals, distributorHubs, workspace, mapCenter]);

  if (!workspace) return null;

  const isCurrentlyOptedIn = ownSignal?.isOptedIn ?? false;

  const handleUseGps = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      notify('Browser geolocation is unavailable on this device. Enter coordinates manually below.', 'info');
      return;
    }
    setLocatingGps(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const nextLat = Number(pos.coords.latitude.toFixed(5));
        const nextLng = Number(pos.coords.longitude.toFixed(5));
        setLatInput(String(nextLat));
        setLngInput(String(nextLng));
        setLocatingGps(false);
        try {
          await toggleVillageDemandOptIn({
            isOptedIn: isCurrentlyOptedIn,
            villageName: villageInput,
            district: districtInput,
            latitude: nextLat,
            longitude: nextLng,
            ...ownShopAggregate,
          });
          notify(`Location updated from GPS (${nextLat}, ${nextLng}).`, 'success');
        } catch {
          notify('Could not save GPS coordinates.', 'error');
        }
      },
      () => {
        setLocatingGps(false);
        notify('Location permission declined. You can set coordinates manually anytime.', 'info');
      },
      { enableHighAccuracy: false, timeout: 8000 }
    );
  };

  const handleSaveManualLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedLat = Number(latInput);
    const parsedLng = Number(lngInput);
    if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng) || Math.abs(parsedLat) > 90 || Math.abs(parsedLng) > 180) {
      notify('Enter valid latitude (-90 to 90) and longitude (-180 to 180).', 'error');
      return;
    }
    setSavingSettings(true);
    try {
      await toggleVillageDemandOptIn({
        isOptedIn: isCurrentlyOptedIn,
        villageName: villageInput,
        district: districtInput,
        latitude: parsedLat,
        longitude: parsedLng,
        ...ownShopAggregate,
      });
    } finally {
      setSavingSettings(false);
    }
  };

  const handleToggleOptIn = async () => {
    setSavingSettings(true);
    try {
      const parsedLat = Number(latInput);
      const parsedLng = Number(lngInput);
      await toggleVillageDemandOptIn({
        isOptedIn: !isCurrentlyOptedIn,
        villageName: villageInput,
        district: districtInput,
        latitude: Number.isFinite(parsedLat) ? parsedLat : 12.2958,
        longitude: Number.isFinite(parsedLng) ? parsedLng : 76.6394,
        ...ownShopAggregate,
      });
    } finally {
      setSavingSettings(false);
    }
  };

  const totalAggregatedUnits = visibleSignals.reduce((s, v) => s + v.estimatedWeeklyUnits, 0);
  const highShortageCount = visibleSignals.filter((v) => v.shortageSeverity === 'high').length;

  return (
    <div className="space-y-6">
      {/* Privacy & Opt-In Control Header */}
      <div className="bg-white border border-[#DCE6DF] rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1 max-w-2xl">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#15803D]">
            <Lock className="w-3.5 h-3.5" />
            <span>Privacy-First Village Aggregation · OpenStreetMap (Keyless)</span>
          </div>
          <h2 className="font-display text-lg font-bold text-[#0D2818]">
            Village-Level Demand Intelligence &amp; Supply Hotspots
          </h2>
          <p className="text-xs text-[#4D6154]">
            Shows aggregated weekly demand units and shortage zones across opted-in village clusters and verified wholesale hubs. Individual shop daily revenue, profit margins, and customer phone numbers are never shared. Nearby demo clusters are clearly labelled.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            type="button"
            disabled={savingSettings}
            onClick={() => void handleToggleOptIn()}
            className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg border whitespace-nowrap transition-colors cursor-pointer ${
              isCurrentlyOptedIn
                ? 'bg-[#15803D] text-white border-[#15803D] hover:bg-[#166534]'
                : 'bg-white text-[#0D2818] border-[#C6D5CA] hover:bg-[#F2F7F3]'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            {isCurrentlyOptedIn ? 'Opted-In: Anonymized Sharing ON' : 'Opted-Out: Sharing OFF'}
          </button>
          <button
            type="button"
            onClick={() => setActiveView('group_buying')}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#0D2818] hover:bg-[#163D26] rounded-lg whitespace-nowrap cursor-pointer"
          >
            <Layers className="w-3.5 h-3.5 text-[#86EFAC]" />
            Open Group Orders
          </button>
        </div>
      </div>

      {/* Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-[#DCE6DF] rounded-xl p-4">
          <p className="text-xs text-[#54695B]">Opted-In Village Clusters</p>
          <p className="mt-1 font-mono text-2xl font-bold text-[#0D2818] tabular-nums">
            {visibleSignals.length}
          </p>
          <p className="mt-0.5 text-xs text-[#54695B]">
            {visibleSignals.reduce((s, v) => s + v.connectedShopsCount, 0)} participating shops
          </p>
        </div>
        <div className="bg-white border border-[#DCE6DF] rounded-xl p-4">
          <p className="text-xs text-[#54695B]">Aggregated Weekly Demand</p>
          <p className="mt-1 font-mono text-2xl font-bold text-[#15803D] tabular-nums">
            {totalAggregatedUnits.toLocaleString('en-IN')}
          </p>
          <p className="mt-0.5 text-xs text-[#54695B]">units across filtered category</p>
        </div>
        <div className="bg-white border border-[#DCE6DF] rounded-xl p-4">
          <p className="text-xs text-[#54695B]">High-Shortage Hotspots</p>
          <p className="mt-1 font-mono text-2xl font-bold text-[#B91C1C] tabular-nums">
            {highShortageCount}
          </p>
          <p className="mt-0.5 text-xs text-[#54695B]">strong group-order candidates</p>
        </div>
        <div className="bg-white border border-[#DCE6DF] rounded-xl p-4">
          <p className="text-xs text-[#54695B]">Verified Distributor Hubs</p>
          <p className="mt-1 font-mono text-2xl font-bold text-[#2563EB] tabular-nums">
            {distributorHubs.length}
          </p>
          <p className="mt-0.5 text-xs text-[#54695B]">
            {offers.length} active bulk-rate offers
          </p>
        </div>
      </div>

      {/* Map + Location & Filter Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 bg-white border border-[#DCE6DF] rounded-xl overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-[#EDF2EE] flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3 text-xs text-[#4D6154]">
              <span className="inline-flex items-center gap-1.5 font-semibold text-[#0D2818]">
                <span className="w-2.5 h-2.5 rounded-full bg-[#0D2818] border-2 border-[#10B981]" />
                Your Shop
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#B91C1C]" />
                High Shortage
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#D97706]" />
                Moderate
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#15803D]" />
                Balanced
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#2563EB]" />
                Distributor Hub
              </span>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-[#54695B]">Category</label>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="text-xs bg-[#F8FAF8] border border-[#C6D5CA] rounded-lg px-2.5 py-1.5 text-[#0D2818]"
              >
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div ref={mapContainerRef} className="w-full h-[430px] z-0" />
        </div>

        {/* Location Controls & Privacy Disclosure */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-white border border-[#DCE6DF] rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-display text-sm font-bold text-[#0D2818]">
                Shop Coordinates &amp; Village Cluster
              </h3>
              <Compass className="w-4 h-4 text-[#15803D]" />
            </div>
            <p className="text-xs text-[#54695B]">
              Use browser GPS only when you click below, or enter your village coordinates manually.
            </p>
            <button
              type="button"
              disabled={locatingGps}
              onClick={handleUseGps}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-[#0D2818] bg-[#EFF5F1] hover:bg-[#E1ECE5] border border-[#C6D5CA] rounded-lg cursor-pointer"
            >
              <Navigation className="w-3.5 h-3.5 text-[#15803D]" />
              {locatingGps ? 'Requesting GPS Permission...' : 'Use My GPS Location (Permission Required)'}
            </button>

            <form onSubmit={handleSaveManualLocation} className="space-y-3 pt-1">
              <div>
                <label className="block text-xs font-medium text-[#3F5346] mb-1">
                  Village / Market Cluster Name
                </label>
                <input
                  type="text"
                  value={villageInput}
                  onChange={(e) => setVillageInput(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-[#C6D5CA] rounded-lg"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#3F5346] mb-1">District</label>
                <input
                  type="text"
                  value={districtInput}
                  onChange={(e) => setDistrictInput(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-[#C6D5CA] rounded-lg"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-medium text-[#3F5346] mb-1">Latitude</label>
                  <input
                    type="number"
                    step="0.0001"
                    value={latInput}
                    onChange={(e) => setLatInput(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs font-mono border border-[#C6D5CA] rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#3F5346] mb-1">Longitude</label>
                  <input
                    type="number"
                    step="0.0001"
                    value={lngInput}
                    onChange={(e) => setLngInput(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs font-mono border border-[#C6D5CA] rounded-lg"
                    required
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={savingSettings}
                className="w-full px-3.5 py-2 text-xs font-semibold text-white bg-[#0D2818] hover:bg-[#163D26] rounded-lg cursor-pointer"
              >
                {savingSettings ? 'Saving Coordinates...' : 'Save Location & Sync Cluster'}
              </button>
            </form>
          </div>

          <div className="bg-white border border-[#DCE6DF] rounded-xl p-5 space-y-2.5">
            <h3 className="font-display text-sm font-bold text-[#0D2818]">
              What Your Shop Shares When Opted-In
            </h3>
            <div className="text-xs text-[#4D6154] space-y-1.5">
              <p>
                <span className="font-semibold text-[#15803D]">Shared (Cluster Aggregate):</span>{' '}
                {ownShopAggregate.topCategory} · est. {ownShopAggregate.estimatedWeeklyUnits} weekly units · shortage level ({ownShopAggregate.shortageSeverity}).
              </p>
              <p>
                <span className="font-semibold text-[#B91C1C]">Never Shared:</span> Daily billing totals, profit margins, supplier dues, batch purchase prices, or customer contacts.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Village Demand Hotspot Table */}
      <div className="bg-white border border-[#DCE6DF] rounded-xl overflow-hidden">
        <div className="p-4 border-b border-[#EDF2EE] flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-display text-sm font-bold text-[#0D2818]">
              District Village Demand Directory
            </h3>
            <p className="text-xs text-[#54695B]">
              Click &ldquo;Pool Order&rdquo; to combine demand with neighboring shops and unlock bulk distributor pricing.
            </p>
          </div>
          <span className="text-xs font-mono text-[#54695B]">
            Showing {visibleSignals.length} opted-in clusters
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#E2EAE4] bg-[#F5F9F6] text-xs font-semibold text-[#4D6154]">
                <th className="py-3 px-4">Village / Cluster</th>
                <th className="py-3 px-3">Top Category &amp; Product</th>
                <th className="py-3 px-3 text-right">Opted-In Shops</th>
                <th className="py-3 px-3 text-right">Est. Weekly Demand</th>
                <th className="py-3 px-3">Shortage Signal</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EDF2EE] text-xs">
              {visibleSignals.map((sig) => (
                <tr key={sig.id} className="hover:bg-[#F9FBF9]">
                  <td className="py-3 px-4">
                    <p className="font-semibold text-[#0D2818]">{sig.villageName}</p>
                    <p className="text-[11px] text-[#54695B]">
                      {sig.district} · {sig.latitude.toFixed(3)}, {sig.longitude.toFixed(3)}{' '}
                      {sig.isDemoData ? '· Demo Cluster' : '· Live Local Shop'}
                    </p>
                  </td>
                  <td className="py-3 px-3">
                    <p className="font-medium text-[#0D2818]">{sig.topProduct}</p>
                    <p className="text-[11px] text-[#54695B]">{sig.topCategory}</p>
                  </td>
                  <td className="py-3 px-3 text-right font-mono tabular-nums text-[#0D2818]">
                    {sig.connectedShopsCount}
                  </td>
                  <td className="py-3 px-3 text-right font-mono font-semibold tabular-nums text-[#0D2818]">
                    {sig.estimatedWeeklyUnits.toLocaleString('en-IN')} units
                  </td>
                  <td className="py-3 px-3">
                    <span
                      className={`font-semibold uppercase text-[11px] ${
                        sig.shortageSeverity === 'high'
                          ? 'text-[#B91C1C]'
                          : sig.shortageSeverity === 'moderate'
                            ? 'text-[#B45309]'
                            : 'text-[#15803D]'
                      }`}
                    >
                      {sig.shortageSeverity}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      type="button"
                      onClick={() => setActiveView('group_buying')}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-[#15803D] hover:bg-[#EFF5F1] rounded-lg whitespace-nowrap cursor-pointer"
                    >
                      Pool Order
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function SmartGroupPurchasingView() {
  const {
    workspace,
    createGroupOrder,
    joinGroupOrder,
    decideGroupOrder,
    setActiveView,
  } = useShop();

  const [qtyDrafts, setQtyDrafts] = useState<Record<number, string>>({});
  const [partnerFormPoolId, setPartnerFormPoolId] = useState<number | null>(null);
  const [partnerShopName, setPartnerShopName] = useState('');
  const [partnerVillage, setPartnerVillage] = useState('');
  const [partnerQty, setPartnerQty] = useState('15');
  const [partnerErr, setPartnerErr] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedOfferId, setSelectedOfferId] = useState<string>('');
  const [newPoolQty, setNewPoolQty] = useState<string>('20');
  const [newDeliveryWindow, setNewDeliveryWindow] = useState<string>(
    'Within 48 hours (Shared Rural Tempo)'
  );
  const [newPoolNotes, setNewPoolNotes] = useState<string>('');
  const [createErr, setCreateErr] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const groupOrders = workspace?.groupOrders || [];
  const offers = workspace?.distributorOffers || [];

  const summary = useMemo(() => {
    const activePools = groupOrders.filter((g) => g.status !== 'cancelled');
    let totalPooledUnits = 0;
    let totalProductSavings = 0;
    let totalTransportSavings = 0;
    for (const g of activePools) {
      totalPooledUnits += g.combinedQty;
      const calc = getPoolSavings(g);
      totalProductSavings += calc.myProductSavings;
      totalTransportSavings += calc.myTransportSavings;
    }
    return {
      activePoolCount: activePools.length,
      totalPooledUnits,
      totalProductSavings,
      totalTransportSavings,
    };
  }, [groupOrders]);

  if (!workspace) return null;

  const openCreateForOffer = (offer?: DistributorOffer) => {
    const target = offer || offers[0];
    setSelectedOfferId(target ? String(target.id) : '');
    setNewPoolQty(target ? String(Math.min(25, Math.ceil(target.minBulkQty / 2))) : '20');
    setShowCreateModal(true);
  };

  const handleCreatePool = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateErr('');
    if (!selectedOfferId) {
      setCreateErr('Please select a verified distributor offer.');
      return;
    }
    const qtyNum = Math.round(Number(newPoolQty));
    if (!Number.isInteger(qtyNum) || qtyNum <= 0) {
      setCreateErr('Enter a valid positive quantity for your shop.');
      return;
    }
    if (!newDeliveryWindow.trim()) {
      setCreateErr('Enter a preferred delivery window.');
      return;
    }
    setSubmitting(true);
    try {
      await createGroupOrder({
        distributorOfferId: Number(selectedOfferId),
        myQuantity: qtyNum,
        deliveryWindow: newDeliveryWindow.trim(),
        notes: newPoolNotes.trim(),
      });
      setShowCreateModal(false);
      setNewPoolNotes('');
    } catch (error: unknown) {
      setCreateErr(error instanceof Error ? error.message : 'Failed to create group pool.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddPartnerShop = async (poolId: number) => {
    setPartnerErr('');
    const qtyNum = Math.round(Number(partnerQty));
    if (!partnerShopName.trim()) {
      setPartnerErr('Enter the neighboring shop name.');
      return;
    }
    if (!partnerVillage.trim()) {
      setPartnerErr('Enter the village or town name.');
      return;
    }
    if (!Number.isInteger(qtyNum) || qtyNum <= 0) {
      setPartnerErr('Quantity must be a positive integer.');
      return;
    }
    setSubmitting(true);
    try {
      await joinGroupOrder(poolId, qtyNum, {
        shopName: partnerShopName.trim(),
        village: partnerVillage.trim(),
      });
      setPartnerFormPoolId(null);
      setPartnerShopName('');
      setPartnerVillage('');
      setPartnerQty('15');
    } catch (error: unknown) {
      setPartnerErr(error instanceof Error ? error.message : 'Failed to add partner shop.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white border border-[#DCE6DF] rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1 max-w-2xl">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#15803D]">
            <Users className="w-3.5 h-3.5" />
            <span>Collective Rural Procurement · Explicit Shopkeeper Approval Required</span>
          </div>
          <h2 className="font-display text-lg font-bold text-[#0D2818]">
            Smart Group Purchasing &amp; Verified Wholesale Tiers
          </h2>
          <p className="text-xs text-[#4D6154]">
            Pool orders with nearby village Kirana stores to cross distributor bulk MOQs and share rural tempo delivery costs. No purchase order is ever placed automatically—you explicitly approve your share once the bulk threshold is met.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => setActiveView('village_map')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#0D2818] bg-white hover:bg-[#F2F7F3] border border-[#C6D5CA] rounded-lg whitespace-nowrap cursor-pointer"
          >
            <MapPin className="w-3.5 h-3.5 text-[#15803D]" />
            Village Map
          </button>
          <button
            type="button"
            onClick={() => setActiveView('logistics')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#0D2818] bg-white hover:bg-[#F2F7F3] border border-[#C6D5CA] rounded-lg whitespace-nowrap cursor-pointer"
          >
            <Truck className="w-3.5 h-3.5 text-[#15803D]" />
            Delivery Routes
          </button>
          <button
            type="button"
            onClick={() => openCreateForOffer()}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#15803D] hover:bg-[#166534] rounded-lg whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Start New Group Pool
          </button>
        </div>
      </div>

      {/* Transparent 4-KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-[#DCE6DF] rounded-xl p-4">
          <p className="text-xs text-[#54695B]">Active Group Pools</p>
          <p className="mt-1 font-mono text-2xl font-bold text-[#0D2818] tabular-nums">
            {summary.activePoolCount}
          </p>
          <p className="mt-0.5 text-xs text-[#54695B]">
            {groupOrders.filter((g) => g.status === 'threshold_met').length} ready for your approval
          </p>
        </div>
        <div className="bg-white border border-[#DCE6DF] rounded-xl p-4">
          <p className="text-xs text-[#54695B]">Combined Pooled Volume</p>
          <p className="mt-1 font-mono text-2xl font-bold text-[#0D2818] tabular-nums">
            {summary.totalPooledUnits.toLocaleString('en-IN')}
          </p>
          <p className="mt-0.5 text-xs text-[#54695B]">units across participating shops</p>
        </div>
        <div className="bg-white border border-[#DCE6DF] rounded-xl p-4">
          <p className="text-xs text-[#54695B]">Est. Bulk Product Savings</p>
          <p className="mt-1 font-mono text-2xl font-bold text-[#15803D] tabular-nums">
            {formatINR(summary.totalProductSavings)}
          </p>
          <p className="mt-0.5 text-xs text-[#54695B]">(Standard − Bulk Price) × your qty</p>
        </div>
        <div className="bg-white border border-[#DCE6DF] rounded-xl p-4">
          <p className="text-xs text-[#54695B]">Est. Shared Transport Savings</p>
          <p className="mt-1 font-mono text-2xl font-bold text-[#15803D] tabular-nums">
            {formatINR(summary.totalTransportSavings)}
          </p>
          <p className="mt-0.5 text-xs text-[#54695B]">Solo delivery fee minus shared split</p>
        </div>
      </div>

      {/* Group Order Cards */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-bold text-[#0D2818]">
            Collective Group Order Pools
          </h3>
          <span className="text-xs text-[#54695B]">
            Sample partner shops are labelled (Demo Partner)
          </span>
        </div>

        {groupOrders.length === 0 ? (
          <div className="bg-white border border-[#DCE6DF] rounded-xl p-8 text-center space-y-3">
            <p className="text-sm font-semibold text-[#0D2818]">No group purchasing pools yet</p>
            <p className="text-xs text-[#54695B]">
              Start a pool from any verified distributor offer below to invite nearby village shops.
            </p>
            <button
              type="button"
              onClick={() => openCreateForOffer()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#15803D] hover:bg-[#166534] rounded-lg cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Create First Pool
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            {groupOrders.map((pool) => {
              const savings = getPoolSavings(pool);
              const pct = Math.min(100, Math.round((pool.combinedQty / Math.max(1, pool.minBulkQty)) * 100));
              const remainingToMoq = Math.max(0, pool.minBulkQty - pool.combinedQty);
              const draftQty = qtyDrafts[pool.id] ?? String(savings.myQty || 15);
              const isLocked =
                pool.status === 'cancelled' || pool.status === 'distributor_accepted';

              const statusLabel =
                pool.status === 'distributor_accepted'
                  ? 'Confirmed by Distributor'
                  : pool.status === 'approved_by_owner'
                    ? 'Owner Approved · Awaiting Distributor'
                    : pool.status === 'threshold_met'
                      ? 'Bulk Threshold Met · Ready to Approve'
                      : pool.status === 'cancelled'
                        ? 'Cancelled'
                        : `Open · Need ${remainingToMoq} more ${pool.unit}`;

              const statusColor =
                pool.status === 'distributor_accepted'
                  ? 'text-[#15803D]'
                  : pool.status === 'approved_by_owner'
                    ? 'text-[#2563EB]'
                    : pool.status === 'threshold_met'
                      ? 'text-[#15803D]'
                      : pool.status === 'cancelled'
                        ? 'text-[#B91C1C]'
                        : 'text-[#B45309]';

              return (
                <div
                  key={pool.id}
                  className="bg-white border border-[#DCE6DF] rounded-xl p-5 flex flex-col justify-between gap-4"
                >
                  <div className="space-y-4">
                    {/* Top Row */}
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-mono text-[#54695B]">
                          {pool.poolCode} · {pool.category}
                        </p>
                        <h4 className="mt-0.5 font-display text-base font-bold text-[#0D2818]">
                          {pool.productName}
                        </h4>
                        <p className="text-xs text-[#4D6154] mt-0.5">
                          Supplier: <span className="font-semibold text-[#0D2818]">{pool.distributorName}</span>
                        </p>
                      </div>
                      <span className={`text-xs font-semibold text-right shrink-0 ${statusColor}`}>
                        {statusLabel}
                      </span>
                    </div>

                    {/* Progress Toward Bulk MOQ */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-[#4D6154]">
                          Combined Pool Progress ({pool.members.length} shops)
                        </span>
                        <span className="font-mono font-semibold text-[#0D2818] tabular-nums">
                          {pool.combinedQty} / {pool.minBulkQty} {pool.unit} ({pct}%)
                        </span>
                      </div>
                      <div className="w-full h-2 bg-[#EDF2EE] rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            pct >= 100 ? 'bg-[#15803D]' : 'bg-[#D97706]'
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>

                    {/* Transparent Two-Part Savings Breakdown */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-[#F8FAF8] border border-[#E7EFE9] rounded-lg p-3 text-xs">
                      <div>
                        <p className="text-[#54695B] font-medium">1. Bulk Product Discount</p>
                        <p className="mt-1 font-mono text-[#0D2818] tabular-nums">
                          ₹{pool.standardUnitPrice} → <strong className="text-[#15803D]">₹{pool.bulkUnitPrice}</strong> / {pool.unit}
                        </p>
                        <p className="mt-0.5 text-[11px] text-[#15803D] font-mono tabular-nums">
                          Your share ({savings.myQty} {pool.unit}): save {formatINR(savings.myProductSavings)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[#54695B] font-medium">2. Est. Shared Transport Split</p>
                        <p className="mt-1 font-mono text-[#0D2818] tabular-nums">
                          Solo ₹{pool.estTransportFeeIndividual} → <strong className="text-[#15803D]">₹{pool.estTransportFeeShared}</strong>
                        </p>
                        <p className="mt-0.5 text-[11px] text-[#15803D] font-mono tabular-nums">
                          Est. delivery saving: {formatINR(savings.myTransportSavings)}
                        </p>
                      </div>
                    </div>

                    {/* Participating Village Shops */}
                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold text-[#3F5346]">
                        Participating Village Shops
                      </p>
                      <div className="divide-y divide-[#EDF2EE] border border-[#EDF2EE] rounded-lg">
                        {pool.members.map((m) => (
                          <div
                            key={m.id}
                            className="px-3 py-2 flex items-center justify-between text-xs"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <Store className="w-3.5 h-3.5 text-[#54695B] shrink-0" />
                              <span className="truncate font-medium text-[#0D2818]">
                                {m.shopName}
                                {m.isCurrentShop ? ' (You)' : ''}
                              </span>
                              <span className="text-[#54695B] shrink-0">· {m.village}</span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0 font-mono tabular-nums">
                              <span className="font-semibold text-[#0D2818]">
                                {m.quantity} {pool.unit}
                              </span>
                              <span
                                className={`text-[11px] ${
                                  m.ownerApproved ? 'text-[#15803D]' : 'text-[#B45309]'
                                }`}
                              >
                                {m.ownerApproved ? 'Approved' : 'Pending'}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                      <p className="text-[11px] text-[#54695B]">
                        Window: {pool.deliveryWindow}
                        {pool.notes ? ` · ${pool.notes}` : ''}
                      </p>
                    </div>
                  </div>

                  {/* Interactive Shopkeeper Controls */}
                  {!isLocked && (
                    <div className="pt-3 border-t border-[#EDF2EE] space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="text-xs text-[#54695B]">My Qty:</label>
                          <input
                            type="number"
                            min={1}
                            value={draftQty}
                            onChange={(e) =>
                              setQtyDrafts((prev) => ({ ...prev, [pool.id]: e.target.value }))
                            }
                            aria-label={`Your quantity for ${pool.productName}`}
                            className="w-20 px-2 py-1.5 text-xs font-mono border border-[#C6D5CA] rounded-lg"
                          />
                          <button
                            type="button"
                            onClick={() => void joinGroupOrder(pool.id, Number(draftQty))}
                            className="px-2.5 py-1.5 text-xs font-semibold text-[#0D2818] bg-[#EFF5F1] hover:bg-[#E1ECE5] rounded-lg whitespace-nowrap cursor-pointer"
                          >
                            {savings.myQty > 0 ? 'Update Qty' : 'Join Pool'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPartnerErr('');
                              setPartnerFormPoolId(partnerFormPoolId === pool.id ? null : pool.id);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-[#15803D] bg-white hover:bg-[#F2FBF4] border border-[#C6D5CA] rounded-lg whitespace-nowrap cursor-pointer"
                          >
                            <Plus className="w-3 h-3" />
                            Add Neighbor Shop
                          </button>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {!pool.ownerApproved ? (
                            <button
                              type="button"
                              disabled={pool.combinedQty < pool.minBulkQty || savings.myQty <= 0}
                              onClick={() => void decideGroupOrder(pool.id, 'approve_owner')}
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap cursor-pointer ${
                                pool.combinedQty >= pool.minBulkQty && savings.myQty > 0
                                  ? 'bg-[#15803D] text-white hover:bg-[#166534]'
                                  : 'bg-[#EDF2EE] text-[#7A8F82] cursor-not-allowed'
                              }`}
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Approve &amp; Create Bulk PO
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void decideGroupOrder(pool.id, 'accept_distributor')}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#0D2818] hover:bg-[#163D26] rounded-lg whitespace-nowrap cursor-pointer"
                            >
                              <Truck className="w-3.5 h-3.5 text-[#86EFAC]" />
                              Confirm Distributor Supply
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => void decideGroupOrder(pool.id, 'cancel')}
                            className="px-2.5 py-1.5 text-xs font-medium text-[#B91C1C] hover:bg-red-50 rounded-lg cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>

                      {partnerFormPoolId === pool.id && (
                        <div className="p-3 rounded-lg bg-[#F5F9F6] border border-[#DCE6DF] space-y-2.5">
                          <p className="text-xs font-semibold text-[#0D2818]">
                            Add Participating Neighboring Village Shop to {pool.poolCode}
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                            <input
                              type="text"
                              value={partnerShopName}
                              onChange={(e) => setPartnerShopName(e.target.value)}
                              placeholder="Neighbor shop name (e.g. Nanjundeshwara Store)"
                              className="sm:col-span-5 px-2.5 py-1.5 text-xs bg-white border border-[#C6D5CA] rounded-md"
                            />
                            <input
                              type="text"
                              value={partnerVillage}
                              onChange={(e) => setPartnerVillage(e.target.value)}
                              placeholder="Village (e.g. Bannur)"
                              className="sm:col-span-4 px-2.5 py-1.5 text-xs bg-white border border-[#C6D5CA] rounded-md"
                            />
                            <input
                              type="number"
                              min={1}
                              value={partnerQty}
                              onChange={(e) => setPartnerQty(e.target.value)}
                              placeholder="Qty"
                              className="sm:col-span-3 px-2.5 py-1.5 text-xs font-mono bg-white border border-[#C6D5CA] rounded-md"
                            />
                          </div>
                          {partnerErr && <p className="text-[11px] text-[#B91C1C]">{partnerErr}</p>}
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setPartnerFormPoolId(null)}
                              className="px-2.5 py-1 text-xs text-[#4D6154] hover:text-[#0D2818] cursor-pointer"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              disabled={submitting}
                              onClick={() => void handleAddPartnerShop(pool.id)}
                              className="px-3 py-1 text-xs font-semibold text-white bg-[#15803D] hover:bg-[#166534] rounded-md cursor-pointer disabled:opacity-50"
                            >
                              Add Shop to Pool
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Verified Distributor Price Comparison Table */}
      <div className="bg-white border border-[#DCE6DF] rounded-xl overflow-hidden">
        <div className="p-4 border-b border-[#EDF2EE] flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-display text-sm font-bold text-[#0D2818]">
              Verified Distributor Price Comparison (Standard vs. Group Bulk Tier)
            </h3>
            <p className="text-xs text-[#54695B]">
              Compare verified distributor quotes before launching or joining a rural group order.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setActiveView('distributor')}
            className="text-xs font-semibold text-[#15803D] hover:underline cursor-pointer"
          >
            Manage Catalog in Distributor Portal &rarr;
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#E2EAE4] bg-[#F5F9F6] text-xs font-semibold text-[#4D6154]">
                <th className="py-3 px-4">Product &amp; Category</th>
                <th className="py-3 px-3">Verified Distributor</th>
                <th className="py-3 px-3 text-right">Standard Rate</th>
                <th className="py-3 px-3 text-right">Group Bulk Rate</th>
                <th className="py-3 px-3 text-right">Bulk MOQ</th>
                <th className="py-3 px-3 text-right">Est. Delivery Fee</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EDF2EE] text-xs">
              {offers.map((offer) => {
                const savePerUnit = Math.max(0, offer.standardUnitPrice - offer.bulkUnitPrice);
                const savePct =
                  offer.standardUnitPrice > 0
                    ? Math.round((savePerUnit / offer.standardUnitPrice) * 100)
                    : 0;
                return (
                  <tr key={offer.id} className="hover:bg-[#F9FBF9]">
                    <td className="py-3 px-4">
                      <p className="font-semibold text-[#0D2818]">{offer.productName}</p>
                      <p className="text-[11px] text-[#54695B]">
                        {offer.category} · {offer.availableQty} {offer.unit} available
                      </p>
                    </td>
                    <td className="py-3 px-3">
                      <p className="font-medium text-[#0D2818]">{offer.distributorName}</p>
                      <p className="text-[11px] text-[#54695B]">
                        {offer.distributorCity} · {offer.leadTimeDays}d lead
                      </p>
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-[#4D6154]">
                      ₹{offer.standardUnitPrice}/{offer.unit}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums">
                      <span className="font-bold text-[#15803D]">
                        ₹{offer.bulkUnitPrice}/{offer.unit}
                      </span>
                      <span className="block text-[11px] text-[#15803D]">
                        Save ₹{savePerUnit} ({savePct}%)
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-[#0D2818]">
                      {offer.minBulkQty} {offer.unit}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-[#4D6154]">
                      ₹{offer.deliveryFeeINR}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => openCreateForOffer(offer)}
                        className="px-3 py-1.5 text-xs font-semibold text-white bg-[#0D2818] hover:bg-[#163D26] rounded-lg whitespace-nowrap cursor-pointer"
                      >
                        Start Pool
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create New Group Order Pool Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
          <div className="bg-white border border-[#DCE6DF] rounded-2xl w-full max-w-lg p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-display text-base font-bold text-[#0D2818]">
                  Start Collective Group Order Pool
                </h3>
                <p className="text-xs text-[#54695B]">
                  Pick a verified wholesale offer and commit your shop&apos;s initial quantity.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="p-1.5 text-[#54695B] hover:text-[#0D2818] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreatePool} className="space-y-4">
              {createErr && (
                <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                  {createErr}
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-[#3F5346] mb-1">
                  Verified Distributor Offer
                </label>
                <select
                  value={selectedOfferId}
                  onChange={(e) => setSelectedOfferId(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-[#C6D5CA] rounded-lg"
                  required
                >
                  {offers.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.productName} — {o.distributorName} (Bulk ₹{o.bulkUnitPrice} vs Std ₹{o.standardUnitPrice}, MOQ {o.minBulkQty})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#3F5346] mb-1">
                    Your Shop&apos;s Quantity
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={newPoolQty}
                    onChange={(e) => setNewPoolQty(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono border border-[#C6D5CA] rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#3F5346] mb-1">
                    Preferred Delivery Window
                  </label>
                  <input
                    type="text"
                    value={newDeliveryWindow}
                    onChange={(e) => setNewDeliveryWindow(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-[#C6D5CA] rounded-lg"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#3F5346] mb-1">
                  Notes for Neighboring Shops (Optional)
                </label>
                <textarea
                  rows={2}
                  value={newPoolNotes}
                  onChange={(e) => setNewPoolNotes(e.target.value)}
                  placeholder="e.g. Pooling for upcoming village fair — need 20 more units to lock wholesale rate."
                  className="w-full px-3 py-2 text-xs border border-[#C6D5CA] rounded-lg"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-xs font-medium text-[#4D6154] hover:bg-[#F2F7F3] rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-semibold text-white bg-[#15803D] hover:bg-[#166534] rounded-lg cursor-pointer"
                >
                  {submitting ? 'Creating Pool...' : 'Open Group Pool'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
