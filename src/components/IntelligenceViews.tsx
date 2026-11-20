import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  CalendarPlus,
  Check,
  CloudSun,
  EyeOff,
  Lightbulb,
  RefreshCw,
  RotateCcw,
  Sliders,
  Sparkles,
  X,
} from 'lucide-react';
import { useShop } from '../context/ShopContext.tsx';
import {
  daysBetweenDates,
  formatISODate,
  runWhatIfSimulation,
} from '../services/intelligenceEngine.ts';
import type { WhatIfScenarioInput } from '../types/dukaaniq.ts';

export function DemandForecastView() {
  const { workspace, forecasts, regenerateForecastsAndReorders } = useShop();
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  const activeForecast = useMemo(() => {
    if (forecasts.length === 0) return null;
    return forecasts.find((f) => f.productId === selectedProductId) || forecasts[0];
  }, [forecasts, selectedProductId]);

  if (!workspace) return null;

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      await regenerateForecastsAndReorders();
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-xs text-[#54695B]">
            Walk-forward backtested 1-day, 7-day, and 30-day statistical demand predictions computed strictly from recorded store sales history and active festivals.
          </p>
        </div>
        <button
          type="button"
          onClick={handleRegenerate}
          disabled={regenerating}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#15803D] hover:bg-[#166534] rounded-lg whitespace-nowrap cursor-pointer disabled:opacity-60"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${regenerating ? 'animate-spin' : ''}`} />
          {regenerating ? 'Computing...' : 'Recalculate Forecasts & Reorders'}
        </button>
      </div>

      {/* Explicit Data Source Transparency Banner */}
      <div
        className={`rounded-xl border px-4 py-3 text-xs flex flex-wrap items-center justify-between gap-2 ${
          workspace.shop.isSampleData
            ? 'bg-amber-50/75 border-amber-200 text-amber-900'
            : 'bg-[#F5F9F6] border-[#DCE6DF] text-[#3F5346]'
        }`}
      >
        <div>
          <span className="font-semibold">
            {workspace.shop.isSampleData
              ? 'Demo Store Historical Data:'
              : 'Live Recorded Shop Data:'}
          </span>{' '}
          {workspace.shop.isSampleData
            ? '7-day and 30-day forecasts below are computed from clearly labelled sample Kirana sales history so you can evaluate the math. Sign in with your own shop to forecast from your actual billing ledger.'
            : `7-day and 30-day forecasts below are computed strictly from ${workspace.sales.length} recorded bills in ${workspace.shop.name}. Products with fewer than 8 active sales days report N/A holdout error instead of fabricated accuracy.`}
        </div>
        <span className="font-mono text-[11px] font-semibold whitespace-nowrap">
          {workspace.sales.length} Bills Analyzed
        </span>
      </div>

      {forecasts.length === 0 ? (
        <div className="bg-white border border-[#DCE6DF] rounded-xl p-10 text-center text-sm text-[#54695B]">
          Add products and record daily sales to generate statistical demand forecasts.
        </div>
      ) : (
        <>
          {/* Selected Product Forecast Detail Chart */}
          {activeForecast && (
            <div className="bg-white border border-[#DCE6DF] rounded-xl p-6 space-y-5">
              <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                <div>
                  <label className="block text-xs text-[#54695B] mb-1">
                    Inspect Product Forecast
                  </label>
                  <select
                    value={activeForecast.productId}
                    onChange={(e) => setSelectedProductId(Number(e.target.value))}
                    className="px-3.5 py-2 text-sm font-semibold text-[#0D2818] border border-[#C6D5CA] rounded-lg bg-white max-w-md"
                  >
                    {forecasts.map((f) => (
                      <option key={f.productId} value={f.productId}>
                        {f.productName} ({f.expectedDemand7d} / 7d)
                      </option>
                    ))}
                  </select>
                </div>

                <div className="text-xs text-[#4D6154] md:text-right space-y-1">
                  <p>
                    Method:{' '}
                    <span className="font-semibold text-[#0D2818]">{activeForecast.methodUsed}</span>
                  </p>
                  <p>
                    Confidence:{' '}
                    <span
                      className={`font-semibold ${
                        activeForecast.confidenceLevel === 'High'
                          ? 'text-[#15803D]'
                          : activeForecast.confidenceLevel === 'Medium'
                          ? 'text-[#B45309]'
                          : 'text-[#B91C1C]'
                      }`}
                    >
                      {activeForecast.confidenceLevel}
                    </span>{' '}
                    · History:{' '}
                    <span className="font-mono text-[#0D2818]">
                      {activeForecast.dataDaysUsed} active days
                    </span>{' '}
                    · Backtest:{' '}
                    <span className="font-mono text-[#0D2818]">
                      {activeForecast.backtestMae !== null
                        ? `MAE ${activeForecast.backtestMae} u/d · MAPE ${activeForecast.backtestMape ?? '—'}% (${activeForecast.backtestWindowDays}d holdout)`
                        : 'N/A (needs ≥8 active days)'}
                    </span>
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
                <div className="p-3.5 rounded-lg bg-[#F5F9F6] border border-[#E2EAE4]">
                  <p className="text-xs text-[#54695B]">Next-Day (1d)</p>
                  <p className="mt-1 font-mono text-xl font-bold text-[#0D2818] tabular-nums">
                    {activeForecast.expectedDemand1d} units
                  </p>
                  <p className="text-[11px] text-[#54695B]">
                    Avg {activeForecast.avgDailySales.toFixed(1)}/day
                  </p>
                </div>
                <div className="p-3.5 rounded-lg bg-[#F5F9F6] border border-[#E2EAE4]">
                  <p className="text-xs text-[#54695B]">Next 7 Days</p>
                  <p className="mt-1 font-mono text-xl font-bold text-[#15803D] tabular-nums">
                    {activeForecast.expectedDemand7d} units
                  </p>
                  <p className="text-[11px] text-[#54695B] capitalize">
                    Trend: {activeForecast.trendDirection}
                  </p>
                </div>
                <div className="p-3.5 rounded-lg bg-[#F5F9F6] border border-[#E2EAE4]">
                  <p className="text-xs text-[#54695B]">Next 30 Days</p>
                  <p className="mt-1 font-mono text-xl font-bold text-[#0D2818] tabular-nums">
                    {activeForecast.expectedDemand30d} units
                  </p>
                  <p className="text-[11px] text-[#54695B]">Monthly outlook</p>
                </div>
                <div className="p-3.5 rounded-lg bg-[#F5F9F6] border border-[#E2EAE4]">
                  <p className="text-xs text-[#54695B]">Current Stock</p>
                  <p className="mt-1 font-mono text-xl font-bold text-[#0D2818] tabular-nums">
                    {activeForecast.currentStock} units
                  </p>
                  <p className="text-[11px] text-[#54695B]">
                    {activeForecast.daysUntilStockout !== null
                      ? `~${activeForecast.daysUntilStockout} days cover`
                      : 'No active velocity'}
                  </p>
                </div>
                <div className="p-3.5 rounded-lg bg-[#F5F9F6] border border-[#E2EAE4] col-span-2 lg:col-span-1">
                  <p className="text-xs text-[#54695B]">Risk Classification</p>
                  <p
                    className={`mt-1 text-base font-bold ${
                      activeForecast.shortageRisk
                        ? 'text-[#B91C1C]'
                        : activeForecast.deadStockFlag || activeForecast.slowMovingFlag
                        ? 'text-[#B45309]'
                        : 'text-[#15803D]'
                    }`}
                  >
                    {activeForecast.shortageRisk
                      ? 'Shortage Risk'
                      : activeForecast.deadStockFlag
                      ? 'Dead Stock (0 / 30d)'
                      : activeForecast.slowMovingFlag
                      ? 'Slow-Moving'
                      : 'Balanced Stock'}
                  </p>
                  <p className="text-[11px] text-[#54695B]">
                    {activeForecast.backtestMae !== null
                      ? `7d Holdout MAE: ${activeForecast.backtestMae}`
                      : 'Insufficient history for holdout'}
                  </p>
                </div>
              </div>

              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={activeForecast.series} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E7EFE9" />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#54695B' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#54695B' }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#FFFFFF',
                        borderColor: '#DCE6DF',
                        borderRadius: '8px',
                        fontSize: '12px',
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                    <Line
                      type="monotone"
                      dataKey="actual"
                      name="Recorded Daily Sales"
                      stroke="#0D2818"
                      strokeWidth={2.2}
                      dot={{ r: 3 }}
                      connectNulls={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="predicted"
                      name="Predicted Daily Demand"
                      stroke="#15803D"
                      strokeWidth={2.2}
                      strokeDasharray="6 4"
                      dot={{ r: 3 }}
                      connectNulls={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="text-[#3F5346] bg-[#F8FAF8] border border-[#E2EAE4] rounded-lg p-3">
                  <span className="font-semibold text-[#0D2818]">Plain-Language Forecast Basis:</span>{' '}
                  {activeForecast.explanation}
                </div>
                <div className="text-[#4D6154] bg-[#F8FAF8] border border-[#E2EAE4] rounded-lg p-3">
                  <span className="font-semibold text-[#0D2818]">Backtest &amp; Data Limitations:</span>{' '}
                  {activeForecast.dataLimitationNote}
                </div>
              </div>
            </div>
          )}

          {/* All Products Forecast Table */}
          <div className="bg-white border border-[#DCE6DF] rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#E2EAE4] bg-[#F5F9F6] text-xs font-semibold text-[#4D6154]">
                    <th className="py-3 px-4">Product &amp; Method</th>
                    <th className="py-3 px-3 text-right">Stock</th>
                    <th className="py-3 px-3 text-right">1d</th>
                    <th className="py-3 px-3 text-right">7d</th>
                    <th className="py-3 px-3 text-right">30d</th>
                    <th className="py-3 px-3 text-right">Holdout MAE / MAPE</th>
                    <th className="py-3 px-3">Confidence</th>
                    <th className="py-3 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EDF2EE] text-xs">
                  {forecasts.map((f) => (
                    <tr
                      key={f.productId}
                      onClick={() => setSelectedProductId(f.productId)}
                      className={`cursor-pointer transition-colors ${
                        activeForecast?.productId === f.productId
                          ? 'bg-[#F2FBF4]'
                          : 'hover:bg-[#F9FCF9]'
                      }`}
                    >
                      <td className="py-3 px-4">
                        <p className="font-semibold text-[#0D2818]">{f.productName}</p>
                        <p className="text-[11px] text-[#54695B]">{f.methodUsed}</p>
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-[#0D2818]">
                        {f.currentStock}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-[#4D6154]">
                        {f.expectedDemand1d}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-semibold text-[#15803D] tabular-nums">
                        {f.expectedDemand7d}
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-[#0D2818] tabular-nums">
                        {f.expectedDemand30d}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-[#4D6154] whitespace-nowrap">
                        {f.backtestMae !== null
                          ? `${f.backtestMae} / ${f.backtestMape ?? '—'}%`
                          : 'N/A (<8d)'}
                      </td>
                      <td className="py-3 px-3 text-[#4D6154] whitespace-nowrap">
                        {f.confidenceLevel} ({f.dataDaysUsed}d)
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap font-semibold">
                        {f.shortageRisk ? (
                          <span className="text-[#B91C1C]">Shortage Risk</span>
                        ) : f.deadStockFlag ? (
                          <span className="text-[#B45309]">Dead Stock</span>
                        ) : f.slowMovingFlag ? (
                          <span className="text-[#B45309]">Slow-Moving</span>
                        ) : (
                          <span className="text-[#15803D]">Normal</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function ReorderEngineView() {
  const { workspace, regenerateForecastsAndReorders, decideReorder } = useShop();
  const [editQtyMap, setEditQtyMap] = useState<Record<number, string>>({});
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const [budgetCapStr, setBudgetCapStr] = useState('25000');

  if (!workspace) return null;

  const budgetCap = Math.max(0, Number(budgetCapStr) || 0);

  const list = useMemo(() => {
    const base =
      filter === 'pending'
        ? workspace.reorders.filter((r) => r.status === 'pending')
        : workspace.reorders;

    const prioOrder = { Critical: 0, High: 1, Medium: 2 };
    return [...base].sort((a, b) => {
      const pa = a.priority ?? (a.availableStock <= 0 ? 'Critical' : a.availableStock <= a.reorderPoint * 0.5 ? 'High' : 'Medium');
      const pb = b.priority ?? (b.availableStock <= 0 ? 'Critical' : b.availableStock <= b.reorderPoint * 0.5 ? 'High' : 'Medium');
      if (prioOrder[pa] !== prioOrder[pb]) return prioOrder[pa] - prioOrder[pb];
      return b.estimatedCost - a.estimatedCost;
    });
  }, [workspace.reorders, filter]);

  // Budget allocation preview across pending recommendations ordered by priority
  const budgetAllocation = useMemo(() => {
    let remaining = budgetCap;
    const fitsMap = new Map<number, boolean>();
    let totalPendingCost = 0;
    let coveredCount = 0;

    for (const rec of list) {
      if (rec.status !== 'pending') continue;
      const editedVal = editQtyMap[rec.id] ?? String(rec.suggestedQty);
      const numericQty = Math.max(1, Math.round(Number(editedVal) || rec.suggestedQty));
      const prod = workspace.products.find((p) => p.id === rec.productId);
      const liveCost = prod ? numericQty * prod.purchasePrice : rec.estimatedCost;
      totalPendingCost += liveCost;

      if (budgetCap === 0 || liveCost <= remaining) {
        fitsMap.set(rec.id, true);
        remaining -= liveCost;
        coveredCount++;
      } else {
        fitsMap.set(rec.id, false);
      }
    }

    return {
      fitsMap,
      totalPendingCost,
      coveredCount,
      remainingBudget: Math.max(0, remaining),
      shortfall: Math.max(0, totalPendingCost - budgetCap),
    };
  }, [list, budgetCap, editQtyMap, workspace.products]);

  return (
    <div className="space-y-6">
      {/* Transparent Formula + Purchasing Budget Planner Banner */}
      <div className="bg-white border border-[#DCE6DF] rounded-xl p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="font-display text-sm font-bold text-[#0D2818]">
              Priority-Ranked Reorder Engine (Owner Approval Required — Never Auto-Ordered)
            </h2>
            <p className="text-xs font-mono text-[#3F5346]">
              Reorder Point = Lead-Time Demand + Safety Stock · Suggested Qty = max(0, Target − Available − Pending POs)
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div className="inline-flex p-1 bg-[#EBF1EC] rounded-lg">
              <button
                type="button"
                onClick={() => setFilter('pending')}
                className={`px-3 py-1 text-xs font-semibold rounded-md cursor-pointer ${
                  filter === 'pending' ? 'bg-white text-[#0D2818]' : 'text-[#4D6154]'
                }`}
              >
                Pending Review ({workspace.reorders.filter((r) => r.status === 'pending').length})
              </button>
              <button
                type="button"
                onClick={() => setFilter('all')}
                className={`px-3 py-1 text-xs font-semibold rounded-md cursor-pointer ${
                  filter === 'all' ? 'bg-white text-[#0D2818]' : 'text-[#4D6154]'
                }`}
              >
                All History ({workspace.reorders.length})
              </button>
            </div>
            <button
              type="button"
              onClick={() => void regenerateForecastsAndReorders()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#15803D] hover:bg-[#166534] rounded-lg cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh Suggestions
            </button>
          </div>
        </div>

        {/* Budget Cap Filter Bar */}
        <div className="pt-3 border-t border-[#EDF2EE] flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <label className="font-semibold text-[#0D2818] whitespace-nowrap">
              Weekly Purchasing Budget Cap (₹):
            </label>
            <input
              type="number"
              min="0"
              step="500"
              value={budgetCapStr}
              onChange={(e) => setBudgetCapStr(e.target.value)}
              className="w-32 px-3 py-1.5 font-mono font-semibold text-[#0D2818] border border-[#C6D5CA] rounded-lg"
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono tabular-nums text-[#3F5346]">
            <span>
              Pending Outlay: <strong className="text-[#0D2818]">₹{Math.round(budgetAllocation.totalPendingCost).toLocaleString('en-IN')}</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Fits Budget: <strong className="text-[#15803D]">{budgetAllocation.coveredCount} priority SKUs</strong>
            </span>
            {budgetCap > 0 && budgetAllocation.shortfall > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-[#B45309] font-semibold">
                  Exceeds cap by ₹{Math.round(budgetAllocation.shortfall).toLocaleString('en-IN')}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="bg-white border border-[#DCE6DF] rounded-xl p-10 text-center text-sm text-[#54695B]">
          No pending reorder suggestions right now. All stocked items are above their reorder points or covered by incoming purchase orders.
        </div>
      ) : (
        <div className="space-y-4">
          {list.map((rec) => {
            const editedVal = editQtyMap[rec.id] ?? String(rec.suggestedQty);
            const numericQty = Math.max(1, Math.round(Number(editedVal) || rec.suggestedQty));
            const prod = workspace.products.find((p) => p.id === rec.productId);
            const liveCost = prod ? numericQty * prod.purchasePrice : rec.estimatedCost;
            const priority: 'Critical' | 'High' | 'Medium' =
              rec.priority ??
              (rec.availableStock <= 0
                ? 'Critical'
                : rec.availableStock <= rec.reorderPoint * 0.5
                ? 'High'
                : 'Medium');
            const fitsBudget = rec.status !== 'pending' || (budgetAllocation.fitsMap.get(rec.id) ?? true);

            return (
              <div
                key={rec.id}
                className="bg-white border border-[#DCE6DF] rounded-xl p-5 space-y-4"
              >
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <span
                        className={`text-xs font-bold uppercase tracking-wide ${
                          priority === 'Critical'
                            ? 'text-[#B91C1C]'
                            : priority === 'High'
                            ? 'text-[#B45309]'
                            : 'text-[#15803D]'
                        }`}
                      >
                        {priority} Priority
                      </span>
                      <span aria-hidden="true" className="text-[#9AB0A1]">·</span>
                      <h3 className="font-display text-base font-bold text-[#0D2818]">
                        {rec.productName || prod?.name || `Product #${rec.productId}`}
                      </h3>
                      <span aria-hidden="true" className="text-[#9AB0A1]">·</span>
                      <span className="text-xs text-[#4D6154]">
                        Supplier: {rec.supplierName || 'Unassigned'}
                      </span>
                      <span aria-hidden="true" className="text-[#9AB0A1]">·</span>
                      <span
                        className={`text-xs font-semibold capitalize ${
                          rec.status === 'approved'
                            ? 'text-[#15803D]'
                            : rec.status === 'rejected'
                            ? 'text-[#6B7F71]'
                            : fitsBudget
                            ? 'text-[#15803D]'
                            : 'text-[#B45309]'
                        }`}
                      >
                        {rec.status === 'pending'
                          ? fitsBudget
                            ? 'Within Budget Cap'
                            : 'Above Budget Cap'
                          : rec.status}
                      </span>
                    </div>
                    <p className="text-xs text-[#3F5346]">{rec.reason}</p>
                    <p className="text-[11px] font-mono text-[#54695B] bg-[#F8FAF8] border border-[#E6EFE9] rounded-md px-3 py-2 mt-2">
                      {rec.formulaBreakdown}
                    </p>
                  </div>

                  {/* Key Metrics */}
                  <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-3 gap-3 shrink-0 text-xs">
                    <div>
                      <p className="text-[#54695B]">Available</p>
                      <p className="font-mono font-bold text-[#0D2818] tabular-nums">
                        {rec.availableStock}
                      </p>
                    </div>
                    <div>
                      <p className="text-[#54695B]">Incoming PO</p>
                      <p className="font-mono font-bold text-[#0D2818] tabular-nums">
                        {rec.incomingStock}
                      </p>
                    </div>
                    <div>
                      <p className="text-[#54695B]">Reorder Pt</p>
                      <p className="font-mono font-bold text-[#B45309] tabular-nums">
                        {rec.reorderPoint}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t border-[#EDF2EE] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex flex-wrap items-center gap-4 text-xs">
                    <div className="flex items-center gap-2">
                      <label className="text-[#4D6154] font-medium">Order Qty:</label>
                      {rec.status === 'pending' ? (
                        <input
                          type="number"
                          min="1"
                          value={editedVal}
                          onChange={(e) =>
                            setEditQtyMap((prev) => ({ ...prev, [rec.id]: e.target.value }))
                          }
                          className="w-20 px-2.5 py-1.5 font-mono font-semibold text-[#0D2818] border border-[#C6D5CA] rounded-lg"
                        />
                      ) : (
                        <span className="font-mono font-bold text-[#0D2818]">
                          {rec.approvedQty ?? rec.suggestedQty}
                        </span>
                      )}
                    </div>
                    <div>
                      <span className="text-[#54695B]">Est. Purchase Cost: </span>
                      <span className="font-mono font-bold text-[#0D2818] tabular-nums">
                        ₹{Math.round(rec.status === 'pending' ? liveCost : rec.estimatedCost).toLocaleString('en-IN')}
                      </span>
                    </div>
                  </div>

                  {rec.status === 'pending' && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void decideReorder(rec.id, 'rejected')}
                        className="inline-flex items-center gap-1 px-3.5 py-2 text-xs font-medium text-[#4D6154] bg-[#F2F7F3] hover:bg-[#E4EFE7] rounded-lg cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                        Reject
                      </button>
                      <button
                        type="button"
                        onClick={() => void decideReorder(rec.id, 'approved', numericQty)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#15803D] hover:bg-[#166534] rounded-lg cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                        Approve &amp; Create PO
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function WhatIfSimulatorView() {
  const { workspace, forecasts } = useShop();

  const defaultInput: WhatIfScenarioInput = {
    demandChangePct: 15,
    purchasingBudgetINR: 35000,
    supplierPriceChangePct: 5,
    deliveryCostPerOrderINR: 250,
    stockAvailabilityPct: 100,
    leadTimeDeltaDays: 0,
  };

  const [scenario, setScenario] = useState<WhatIfScenarioInput>(defaultInput);

  const result = useMemo(() => {
    if (!workspace) return null;
    return runWhatIfSimulation(workspace.products, forecasts, workspace.purchases, scenario);
  }, [workspace, forecasts, scenario]);

  const chartData = useMemo(() => {
    if (!result) return [];
    return result.items.slice(0, 8).map((item) => ({
      name: item.productName.length > 16 ? `${item.productName.slice(0, 15)}…` : item.productName,
      Baseline: item.baselineDemand30d,
      Simulated: item.simulatedDemand30d,
    }));
  }, [result]);

  if (!workspace || !result) return null;

  return (
    <div className="space-y-6">
      {/* Honest Hypothetical Simulation Banner */}
      <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-2.5 text-xs text-[#92400E]">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-[#B45309]" />
          <div>
            <p className="font-semibold text-[#78350F]">
              Hypothetical Business Simulation Mode — Live Store Data Remains Untouched
            </p>
            <p className="mt-0.5">
              Adjust demand surges, supplier pricing, purchasing cash budgets, or delivery delays below to evaluate reorder outlay, shortage exposure, and expiry wastage risk before making real purchases.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() =>
            setScenario({
              demandChangePct: 0,
              purchasingBudgetINR: 35000,
              supplierPriceChangePct: 0,
              deliveryCostPerOrderINR: 250,
              stockAvailabilityPct: 100,
              leadTimeDeltaDays: 0,
            })
          }
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#78350F] bg-white hover:bg-amber-50 border border-[#FCD34D] rounded-lg whitespace-nowrap cursor-pointer shrink-0"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Reset to Baseline
        </button>
      </div>

      {/* Simulation Controls Grid */}
      <div className="bg-white border border-[#DCE6DF] rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-[#15803D]" />
            <h2 className="font-display text-sm font-bold text-[#0D2818]">
              Scenario Assumptions (6 Variables)
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() =>
                setScenario({
                  demandChangePct: 35,
                  purchasingBudgetINR: 40000,
                  supplierPriceChangePct: 8,
                  deliveryCostPerOrderINR: 300,
                  stockAvailabilityPct: 90,
                  leadTimeDeltaDays: 2,
                })
              }
              className="px-2.5 py-1 font-medium text-[#0D2818] bg-[#EFF5F1] hover:bg-[#DFECE3] rounded-md cursor-pointer"
            >
              Festival Surge (+35%)
            </button>
            <button
              type="button"
              onClick={() =>
                setScenario({
                  demandChangePct: -20,
                  purchasingBudgetINR: 18000,
                  supplierPriceChangePct: 4,
                  deliveryCostPerOrderINR: 200,
                  stockAvailabilityPct: 110,
                  leadTimeDeltaDays: 0,
                })
              }
              className="px-2.5 py-1 font-medium text-[#0D2818] bg-[#EFF5F1] hover:bg-[#DFECE3] rounded-md cursor-pointer"
            >
              Monsoon Slowdown (-20%)
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="font-medium text-[#3F5346]">Expected Demand Change</span>
              <span className="font-mono font-bold text-[#0D2818] tabular-nums">
                {scenario.demandChangePct >= 0 ? `+${scenario.demandChangePct}%` : `${scenario.demandChangePct}%`}
              </span>
            </div>
            <input
              type="range"
              min="-50"
              max="100"
              step="5"
              value={scenario.demandChangePct}
              onChange={(e) => setScenario({ ...scenario, demandChangePct: Number(e.target.value) })}
              className="w-full accent-[#15803D]"
            />
          </div>

          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="font-medium text-[#3F5346]">Purchasing Budget Cap</span>
              <span className="font-mono font-bold text-[#0D2818] tabular-nums">
                ₹{scenario.purchasingBudgetINR.toLocaleString('en-IN')}
              </span>
            </div>
            <input
              type="range"
              min="5000"
              max="150000"
              step="2500"
              value={scenario.purchasingBudgetINR}
              onChange={(e) => setScenario({ ...scenario, purchasingBudgetINR: Number(e.target.value) })}
              className="w-full accent-[#15803D]"
            />
          </div>

          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="font-medium text-[#3F5346]">Supplier Price Change</span>
              <span className="font-mono font-bold text-[#0D2818] tabular-nums">
                {scenario.supplierPriceChangePct >= 0
                  ? `+${scenario.supplierPriceChangePct}%`
                  : `${scenario.supplierPriceChangePct}%`}
              </span>
            </div>
            <input
              type="range"
              min="-20"
              max="40"
              step="1"
              value={scenario.supplierPriceChangePct}
              onChange={(e) =>
                setScenario({ ...scenario, supplierPriceChangePct: Number(e.target.value) })
              }
              className="w-full accent-[#15803D]"
            />
          </div>

          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="font-medium text-[#3F5346]">Delivery Cost / Supplier Order</span>
              <span className="font-mono font-bold text-[#0D2818] tabular-nums">
                ₹{scenario.deliveryCostPerOrderINR}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="1500"
              step="50"
              value={scenario.deliveryCostPerOrderINR}
              onChange={(e) =>
                setScenario({ ...scenario, deliveryCostPerOrderINR: Number(e.target.value) })
              }
              className="w-full accent-[#15803D]"
            />
          </div>

          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="font-medium text-[#3F5346]">Starting Stock Availability</span>
              <span className="font-mono font-bold text-[#0D2818] tabular-nums">
                {scenario.stockAvailabilityPct}%
              </span>
            </div>
            <input
              type="range"
              min="50"
              max="150"
              step="5"
              value={scenario.stockAvailabilityPct}
              onChange={(e) =>
                setScenario({ ...scenario, stockAvailabilityPct: Number(e.target.value) })
              }
              className="w-full accent-[#15803D]"
            />
          </div>

          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="font-medium text-[#3F5346]">Supplier Lead-Time Shift</span>
              <span className="font-mono font-bold text-[#0D2818] tabular-nums">
                {scenario.leadTimeDeltaDays >= 0
                  ? `+${scenario.leadTimeDeltaDays}d`
                  : `${scenario.leadTimeDeltaDays}d`}
              </span>
            </div>
            <input
              type="range"
              min="-2"
              max="7"
              step="1"
              value={scenario.leadTimeDeltaDays}
              onChange={(e) =>
                setScenario({ ...scenario, leadTimeDeltaDays: Number(e.target.value) })
              }
              className="w-full accent-[#15803D]"
            />
          </div>
        </div>
      </div>

      {/* Simulated Impact KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white border border-[#DCE6DF] rounded-xl p-4">
          <p className="text-xs text-[#54695B]">Simulated 30d Demand</p>
          <p className="mt-1 font-mono text-xl font-bold text-[#0D2818] tabular-nums">
            {result.totalSimulatedDemand30d.toLocaleString('en-IN')} u
          </p>
          <p className="text-xs text-[#54695B] tabular-nums">
            Baseline: {result.totalBaselineDemand30d.toLocaleString('en-IN')} u
          </p>
        </div>

        <div className="bg-white border border-[#DCE6DF] rounded-xl p-4">
          <p className="text-xs text-[#54695B]">Total Restock + Delivery</p>
          <p className="mt-1 font-mono text-xl font-bold text-[#0D2818] tabular-nums">
            ₹{Math.round(result.totalPurchaseCostINR + result.totalDeliveryCostINR).toLocaleString('en-IN')}
          </p>
          <p className="text-xs text-[#54695B] tabular-nums">
            {result.totalReorderUnits} units · Delivery ₹{result.totalDeliveryCostINR.toLocaleString('en-IN')}
          </p>
        </div>

        <div className="bg-white border border-[#DCE6DF] rounded-xl p-4">
          <p className="text-xs text-[#54695B]">Budget Surplus / Gap</p>
          <p
            className={`mt-1 font-mono text-xl font-bold tabular-nums ${
              result.budgetGapINR > 0 ? 'text-[#B91C1C]' : 'text-[#15803D]'
            }`}
          >
            {result.budgetGapINR > 0
              ? `-₹${Math.round(result.budgetGapINR).toLocaleString('en-IN')}`
              : `+₹${Math.round(
                  Math.max(
                    0,
                    scenario.purchasingBudgetINR -
                      (result.totalPurchaseCostINR + result.totalDeliveryCostINR)
                  )
                ).toLocaleString('en-IN')}`}
          </p>
          <p className="text-xs text-[#54695B]">
            {result.budgetGapINR > 0 ? 'Needs extra credit or pooling' : 'Fits within cash budget'}
          </p>
        </div>

        <div className="bg-white border border-[#DCE6DF] rounded-xl p-4">
          <p className="text-xs text-[#54695B]">Shortage-Exposed SKUs</p>
          <p
            className={`mt-1 font-mono text-xl font-bold tabular-nums ${
              result.shortageSkuCount > 0 ? 'text-[#B91C1C]' : 'text-[#15803D]'
            }`}
          >
            {result.shortageSkuCount}
          </p>
          <p className="text-xs text-[#54695B]">Below simulated reorder point</p>
        </div>

        <div className="bg-white border border-[#DCE6DF] rounded-xl p-4 col-span-2 lg:col-span-1">
          <p className="text-xs text-[#54695B]">Est. Overstock / Wastage Risk</p>
          <p className="mt-1 font-mono text-xl font-bold text-[#B45309] tabular-nums">
            ₹{Math.round(result.estimatedWastageRiskINR).toLocaleString('en-IN')}
          </p>
          <p className="text-xs text-[#54695B]">Excess beyond 45d cover</p>
        </div>
      </div>

      {/* Baseline vs Simulated Demand Chart */}
      <div className="bg-white border border-[#DCE6DF] rounded-xl p-5">
        <h3 className="font-display text-sm font-bold text-[#0D2818]">
          Baseline vs. Simulated 30-Day Demand (Top 8 SKUs)
        </h3>
        <p className="text-xs text-[#54695B] mb-4">
          Visual comparison of recorded baseline trajectory against your hypothetical scenario
        </p>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E7EFE9" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#54695B' }} />
              <YAxis tick={{ fontSize: 11, fill: '#54695B' }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#FFFFFF',
                  borderColor: '#DCE6DF',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
              />
              <Legend wrapperStyle={{ fontSize: '12px' }} />
              <Bar dataKey="Baseline" fill="#94A3B8" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Simulated" fill="#15803D" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* SKU-Level Scenario Impact Table */}
      <div className="bg-white border border-[#DCE6DF] rounded-xl overflow-hidden">
        <div className="p-4 border-b border-[#EDF2EE]">
          <h3 className="font-display text-sm font-bold text-[#0D2818]">
            SKU-Level Hypothetical Reorder &amp; Risk Breakdown
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#E2EAE4] bg-[#F5F9F6] font-semibold text-[#4D6154]">
                <th className="py-2.5 px-4">Product</th>
                <th className="py-2.5 px-3 text-right">Sim. Stock</th>
                <th className="py-2.5 px-3 text-right">Base → Sim 30d</th>
                <th className="py-2.5 px-3 text-right">Reorder Qty</th>
                <th className="py-2.5 px-3 text-right">Est. Order Cost</th>
                <th className="py-2.5 px-4 text-right">Overstock Risk</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EDF2EE]">
              {result.items.slice(0, 15).map((item) => (
                <tr key={item.productId} className="hover:bg-[#F9FCF9]">
                  <td className="py-2.5 px-4">
                    <p className="font-semibold text-[#0D2818]">{item.productName}</p>
                    <p className="text-[11px] text-[#54695B]">{item.category}</p>
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                    {item.simulatedStock}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                    {item.baselineDemand30d} →{' '}
                    <span className="font-semibold text-[#15803D]">{item.simulatedDemand30d}</span>
                  </td>
                  <td
                    className={`py-2.5 px-3 text-right font-mono font-semibold tabular-nums ${
                      item.simulatedReorderQty > 0 ? 'text-[#B91C1C]' : 'text-[#54695B]'
                    }`}
                  >
                    {item.simulatedReorderQty}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                    ₹{Math.round(item.simulatedPurchaseCost).toLocaleString('en-IN')}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums text-[#B45309]">
                    {item.projectedWastageRiskINR > 0
                      ? `₹${Math.round(item.projectedWastageRiskINR).toLocaleString('en-IN')}`
                      : '—'}
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

export function FestivalPlannerView() {
  const { workspace, weather, refreshWeather, addFestival, toggleFestivalDismiss } = useShop();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    name: '',
    festivalDate: '',
    category: 'Local Event',
    expectedUpliftPct: '30',
    focusCategories: 'Staples & Grains, Cooking Oils, Biscuits & Snacks',
    notes: '',
  });

  if (!workspace) return null;

  const todayISO = formatISODate(new Date());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await addFestival({
      name: form.name,
      festivalDate: form.festivalDate,
      category: form.category,
      expectedUpliftPct: Number(form.expectedUpliftPct || 30),
      focusCategories: form.focusCategories,
      notes: form.notes || null,
    });
    setShowAdd(false);
    setForm({
      name: '',
      festivalDate: '',
      category: 'Local Event',
      expectedUpliftPct: '30',
      focusCategories: 'Staples & Grains, Cooking Oils, Biscuits & Snacks',
      notes: '',
    });
  };

  return (
    <div className="space-y-6">
      {/* Open-Meteo 5-Day Weather Planning Panel (Explicitly separated from sales evidence) */}
      <div className="bg-white border border-[#DCE6DF] rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <CloudSun className="w-4 h-4 text-[#15803D]" />
              <h2 className="font-display text-sm font-bold text-[#0D2818]">
                Live Regional Weather &amp; 5-Day Forecast ({weather?.source || 'Open-Meteo'}) — {weather?.city || workspace.shop.city}
              </h2>
            </div>
            <p className="mt-1 text-xs text-[#4D6154]">
              {weather?.planningNote ||
                'Checking Open-Meteo regional outlook. Weather signals are advisory planning inputs and remain separate from recorded sales statistics.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refreshWeather()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#0D2818] bg-[#F2F7F3] hover:bg-[#E4EFE7] border border-[#C6D5CA] rounded-lg whitespace-nowrap cursor-pointer shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5 text-[#15803D]" />
            Refresh Weather
          </button>
        </div>

        {weather?.forecastDays && weather.forecastDays.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {weather.forecastDays.map((day) => (
              <div
                key={day.date}
                className="p-3 rounded-lg bg-[#F8FAF8] border border-[#E2EAE4] text-xs"
              >
                <p className="font-mono font-semibold text-[#0D2818]">{day.date.slice(5)}</p>
                <p className="mt-1 font-medium text-[#3F5346] truncate">{day.condition}</p>
                <p className="mt-1 font-mono text-[#0D2818] tabular-nums">
                  {day.tempMaxC}° / {day.tempMinC}°C
                </p>
                <p className="text-[11px] text-[#54695B] font-mono tabular-nums">
                  Rain: {day.rainMm} mm
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-xs text-[#4D6154] max-w-2xl">
          Every rural Kirana shop experiences different festival and village fair spikes. Customize uplift expectations, add local haat or school reopening dates, or dismiss events that do not fit your neighborhood.
        </p>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#15803D] hover:bg-[#166534] rounded-lg whitespace-nowrap cursor-pointer"
        >
          <CalendarPlus className="w-4 h-4" />
          Add Local Event
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {workspace.festivals.map((fest) => {
          const daysAway = daysBetweenDates(todayISO, fest.festivalDate);
          const matchingProducts = workspace.products.filter((p) =>
            fest.focusCategories
              .toLowerCase()
              .split(',')
              .some((cat) => p.category.toLowerCase().includes(cat.trim()))
          );

          return (
            <div
              key={fest.id}
              className={`bg-white border border-[#DCE6DF] rounded-xl p-5 flex flex-col justify-between ${
                fest.isDismissed ? 'opacity-60' : ''
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-display text-base font-bold text-[#0D2818]">{fest.name}</h3>
                    <p className="text-xs text-[#54695B] mt-0.5 font-mono">
                      {fest.festivalDate} · {fest.category} ·{' '}
                      {daysAway >= 0 ? `In ${daysAway} days` : `${Math.abs(daysAway)}d ago`}
                    </p>
                  </div>
                  <span className="font-mono text-xs font-bold text-[#15803D] whitespace-nowrap">
                    +{fest.expectedUpliftPct}% Est. Lift
                  </span>
                </div>

                {fest.notes && <p className="mt-2.5 text-xs text-[#4D6154]">{fest.notes}</p>}

                <p className="mt-2.5 text-xs text-[#3F5346]">
                  <span className="font-semibold">Focus Categories:</span> {fest.focusCategories}
                </p>

                {!fest.isDismissed && matchingProducts.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-[#EDF2EE]">
                    <p className="text-[11px] font-semibold text-[#54695B] mb-1.5">
                      Suggested Stock Preparation ({matchingProducts.length} matching SKUs in your shop):
                    </p>
                    <ul className="space-y-1 text-xs text-[#111D15]">
                      {matchingProducts.slice(0, 4).map((p) => (
                        <li key={p.id} className="flex items-center justify-between gap-2">
                          <span className="truncate">{p.name}</span>
                          <span className="font-mono text-[11px] text-[#54695B] shrink-0">
                            Stock: {p.currentStock} {p.unit}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="mt-4 pt-3 border-t border-[#EDF2EE] flex items-center justify-between">
                <span className="text-[11px] text-[#6B7F71]">
                  {fest.isCustom ? 'Custom Local Event' : 'Seasonal Calendar'}
                </span>
                <button
                  type="button"
                  onClick={() => void toggleFestivalDismiss(fest.id, !fest.isDismissed)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-[#4D6154] hover:text-[#0D2818] cursor-pointer"
                >
                  {fest.isDismissed ? (
                    <>
                      <RotateCcw className="w-3.5 h-3.5" /> Restore
                    </>
                  ) : (
                    <>
                      <EyeOff className="w-3.5 h-3.5" /> Dismiss
                    </>
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
          <div className="bg-white border border-[#DCE6DF] rounded-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between pb-3 border-b border-[#EDF2EE]">
              <h3 className="font-display text-base font-bold text-[#0D2818]">
                Add Local Festival or Demand Event
              </h3>
              <button type="button" onClick={() => setShowAdd(false)} className="p-1 text-[#54695B] cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-[#3F5346] mb-1">Event Name *</label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g., Village Fair / School Reopening / Wedding Week"
                  className="w-full px-3 py-2 text-sm border border-[#C6D5CA] rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#3F5346] mb-1">Date *</label>
                  <input
                    type="date"
                    required
                    value={form.festivalDate}
                    onChange={(e) => setForm({ ...form, festivalDate: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-[#C6D5CA] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#3F5346] mb-1">Expected Lift (%)</label>
                  <input
                    type="number"
                    min="5"
                    max="100"
                    value={form.expectedUpliftPct}
                    onChange={(e) => setForm({ ...form, expectedUpliftPct: e.target.value })}
                    className="w-full px-3 py-2 text-sm font-mono border border-[#C6D5CA] rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#3F5346] mb-1">Focus Categories *</label>
                <input
                  type="text"
                  required
                  value={form.focusCategories}
                  onChange={(e) => setForm({ ...form, focusCategories: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-[#C6D5CA] rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#3F5346] mb-1">Preparation Notes</label>
                <input
                  type="text"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Optional stock prep notes"
                  className="w-full px-3 py-2 text-sm border border-[#C6D5CA] rounded-lg"
                />
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAdd(false)}
                  className="px-4 py-2 text-xs font-medium text-[#3F5346] bg-[#F2F7F3] rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-[#15803D] hover:bg-[#166534] rounded-lg cursor-pointer"
                >
                  Add Event
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export function BusinessInsightsView() {
  const { workspace, forecasts, expirySummary, insights } = useShop();
  const [aiBrief, setAiBrief] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

  if (!workspace) return null;

  const todayISO = formatISODate(new Date());

  const handleGenerateAiBrief = async () => {
    setAiLoading(true);
    setAiError('');
    try {
      const last7 = workspace.sales.filter((s) => {
        const d = daysBetweenDates(s.saleDate.slice(0, 10), todayISO);
        return d >= 0 && d < 7;
      });
      const stockValueINR = workspace.products.reduce(
        (sum, p) => sum + p.currentStock * p.purchasePrice,
        0
      );
      const payload = {
        shopName: workspace.shop.name,
        city: workspace.shop.city,
        isSampleData: workspace.shop.isSampleData,
        totalProducts: workspace.products.length,
        stockValueINR,
        revenueLast7dINR: last7.reduce((s, r) => s + r.totalAmount, 0),
        grossProfitLast7dINR: last7.reduce((s, r) => s + r.grossProfit, 0),
        lowStockCount: workspace.products.filter(
          (p) => p.currentStock > 0 && p.currentStock <= p.minStockLevel
        ).length,
        outOfStockCount: workspace.products.filter((p) => p.currentStock <= 0).length,
        expiredBatchCount: expirySummary.expired.length,
        expiring15dCount: expirySummary.within7.length + expirySummary.within15.length,
        moneyAtExpiryRiskINR: expirySummary.totalMoneyAtRisk,
        fastMovers: forecasts
          .filter((f) => f.avgDailySales >= 2)
          .sort((a, b) => b.avgDailySales - a.avgDailySales)
          .slice(0, 4)
          .map((f) => ({ name: f.productName, dailyAvg: f.avgDailySales, stock: f.currentStock })),
        deadStockNames: forecasts.filter((f) => f.deadStockFlag).map((f) => f.productName),
        upcomingFestivals: workspace.festivals
          .filter((f) => !f.isDismissed && daysBetweenDates(todayISO, f.festivalDate) >= 0)
          .slice(0, 3)
          .map((f) => ({ name: f.name, date: f.festivalDate, focus: f.focusCategories })),
      };

      const resp = await fetch('/api/ai/weekly-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Could not generate AI business brief.');
      setAiBrief(data.summary);
    } catch (err: unknown) {
      setAiError(err instanceof Error ? err.message : 'Failed to generate AI brief.');
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Server-side AI Weekly Brief Generator */}
      <div className="bg-white border border-[#DCE6DF] rounded-xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#EDF2EE]">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#15803D]" />
              <h2 className="font-display text-base font-bold text-[#0D2818]">
                GRAMSETU AI Weekly Business Advisor Brief
              </h2>
            </div>
            <p className="mt-1 text-xs text-[#54695B]">
              Generates a plain-language 4-point shopkeeper summary strictly from your recorded numbers.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleGenerateAiBrief()}
            disabled={aiLoading}
            className="px-4 py-2 text-xs font-semibold text-white bg-[#0D2818] hover:bg-[#163D26] rounded-lg whitespace-nowrap cursor-pointer disabled:opacity-60"
          >
            {aiLoading ? 'Analyzing Shop Data...' : 'Generate Weekly AI Brief'}
          </button>
        </div>

        {aiError && (
          <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
            {aiError}
          </div>
        )}

        {aiBrief ? (
          <div className="mt-4 p-4 rounded-xl bg-[#F5F9F6] border border-[#E2EAE4] text-sm text-[#111D15] whitespace-pre-line leading-relaxed">
            {aiBrief}
          </div>
        ) : (
          <p className="mt-4 text-xs text-[#54695B]">
            Click &ldquo;Generate Weekly AI Brief&rdquo; to synthesize your current stock risks, expiry losses, fast-movers, and upcoming festival preparations into 4 everyday actions.
          </p>
        )}
      </div>

      {/* Deterministic Observations vs Predictions Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {insights.length === 0 ? (
          <div className="md:col-span-2 bg-white border border-[#DCE6DF] rounded-xl p-10 text-center text-sm text-[#54695B]">
            Record inventory and daily sales to unlock data-backed store insights.
          </div>
        ) : (
          insights.map((ins) => (
            <div key={ins.id} className="bg-white border border-[#DCE6DF] rounded-xl p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-medium text-[#54695B]">
                    {ins.kind === 'observation' ? 'Recorded Observation' : 'Forecasted Prediction'}
                  </span>
                  <span
                    className={`font-mono font-semibold tabular-nums ${
                      ins.severity === 'critical'
                        ? 'text-[#B91C1C]'
                        : ins.severity === 'warning'
                        ? 'text-[#B45309]'
                        : 'text-[#15803D]'
                    }`}
                  >
                    {ins.metricLabel}
                  </span>
                </div>
                <h3 className="mt-2 font-display text-base font-bold text-[#0D2818]">
                  {ins.title}
                </h3>
                <p className="mt-1.5 text-xs text-[#4D6154] leading-relaxed">{ins.summary}</p>
              </div>
              <div className="mt-4 pt-3 border-t border-[#EDF2EE] flex items-start gap-2 text-xs text-[#15803D]">
                <Lightbulb className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{ins.recommendedAction}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
