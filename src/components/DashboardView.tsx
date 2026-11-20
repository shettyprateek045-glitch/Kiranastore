import React, { useMemo } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Box,
  CloudSun,
  MapPin,
  PackagePlus,
  Receipt,
  RefreshCw,
  ShoppingCart,
  Sliders,
  TrendingUp,
  Warehouse,
} from 'lucide-react';
import { useShop } from '../context/ShopContext.tsx';
import { formatISODate } from '../services/intelligenceEngine.ts';

function formatINR(val: number): string {
  return `₹${Math.round(val).toLocaleString('en-IN')}`;
}

export function DashboardView() {
  const {
    workspace,
    forecasts,
    expirySummary,
    insights,
    weather,
    setActiveView,
    regenerateForecastsAndReorders,
    seedSampleIntoCurrentShop,
  } = useShop();

  const todayISO = formatISODate(new Date());

  const metrics = useMemo(() => {
    if (!workspace) {
      return {
        totalProducts: 0,
        stockValue: 0,
        todaySales: 0,
        todayProfit: 0,
        total30dSales: 0,
        total30dProfit: 0,
        lowStockCount: 0,
        outOfStockCount: 0,
        nearingExpiryCount: 0,
        expiredCount: 0,
        fastMovingCount: 0,
        slowMovingCount: 0,
        pendingPOsCount: 0,
        deadStockValue: 0,
        predicted7dDemand: 0,
        expectedPurchasesValue: 0,
        estGroupSavings: 0,
      };
    }

    const stockValue = workspace.products.reduce(
      (sum, p) => sum + p.currentStock * p.purchasePrice,
      0
    );
    const todaysBills = workspace.sales.filter((s) => s.saleDate.slice(0, 10) === todayISO);
    const todaySales = todaysBills.reduce((sum, s) => sum + s.totalAmount, 0);
    const todayProfit = todaysBills.reduce((sum, s) => sum + s.grossProfit, 0);
    const total30dSales = workspace.sales.reduce((sum, s) => sum + s.totalAmount, 0);
    const total30dProfit = workspace.sales.reduce((sum, s) => sum + s.grossProfit, 0);

    const outOfStockCount = workspace.products.filter((p) => p.currentStock <= 0).length;
    const lowStockCount = workspace.products.filter(
      (p) => p.currentStock > 0 && p.currentStock <= p.minStockLevel
    ).length;
    const nearingExpiryCount =
      expirySummary.within7.length +
      expirySummary.within15.length +
      expirySummary.within30.length;
    const expiredCount = expirySummary.expired.length;
    const fastMovingCount = forecasts.filter((f) => f.avgDailySales >= 2).length;
    const slowMovingCount = forecasts.filter(
      (f) => f.slowMovingFlag || f.deadStockFlag
    ).length;
    const pendingPOsCount = workspace.purchases.filter((po) => po.status === 'pending').length;

    const productById = new Map(workspace.products.map((p) => [p.id, p]));
    const deadStockValue = forecasts
      .filter((f) => f.deadStockFlag)
      .reduce((sum, f) => {
        const prod = productById.get(f.productId);
        return sum + (prod ? prod.currentStock * prod.purchasePrice : 0);
      }, 0);
    const predicted7dDemand = forecasts.reduce((sum, f) => sum + f.expectedDemand7d, 0);
    const pendingReorders = workspace.reorders.filter((r) => r.status === 'pending');
    const expectedPurchasesValue =
      pendingReorders.reduce((sum, r) => sum + r.estimatedCost, 0) +
      workspace.purchases
        .filter((po) => po.status === 'pending')
        .reduce((sum, po) => sum + po.totalAmount, 0);
    const activeGroupPools = (workspace.groupOrders || []).filter((g) => g.status !== 'cancelled');
    let liveGroupProductSavings = 0;
    let liveGroupTransportSavings = 0;
    for (const pool of activeGroupPools) {
      const myMember = pool.members.find((m) => m.isCurrentShop);
      const myQty = myMember?.quantity ?? 0;
      if (myQty > 0) {
        liveGroupProductSavings += Math.max(0, pool.standardUnitPrice - pool.bulkUnitPrice) * myQty;
        liveGroupTransportSavings += Math.max(
          0,
          pool.estTransportFeeIndividual - pool.estTransportFeeShared
        );
      }
    }
    const hasLiveGroupSavings = activeGroupPools.length > 0;
    const approvedOrPendingReorderTotal = workspace.reorders
      .filter((r) => r.status === 'approved' || r.status === 'pending')
      .reduce((sum, r) => sum + r.estimatedCost, 0);
    const estGroupSavings = hasLiveGroupSavings
      ? Math.round(liveGroupProductSavings + liveGroupTransportSavings)
      : Math.round(approvedOrPendingReorderTotal * 0.08);

    return {
      totalProducts: workspace.products.length,
      stockValue,
      todaySales,
      todayProfit,
      total30dSales,
      total30dProfit,
      lowStockCount,
      outOfStockCount,
      nearingExpiryCount,
      expiredCount,
      fastMovingCount,
      slowMovingCount,
      pendingPOsCount,
      deadStockValue,
      predicted7dDemand,
      expectedPurchasesValue,
      estGroupSavings,
      liveGroupProductSavings: Math.round(liveGroupProductSavings),
      liveGroupTransportSavings: Math.round(liveGroupTransportSavings),
      hasLiveGroupSavings,
      activeGroupPoolCount: activeGroupPools.length,
    };
  }, [workspace, forecasts, expirySummary, todayISO]);

  // Unified chronological Store Activity Timeline (Sales, Purchases, Movements, FEFO Transfers)
  const activityTimeline = useMemo(() => {
    if (!workspace) return [];
    const prodMap = new Map(workspace.products.map((p) => [p.id, p.name]));
    const events: Array<{
      id: string;
      date: string;
      kind: 'Sale' | 'Purchase' | 'Transfer' | 'Stock';
      title: string;
      detail: string;
      amountLabel: string;
      tone: 'positive' | 'warning' | 'neutral';
    }> = [];

    for (const s of workspace.sales.slice(0, 4)) {
      events.push({
        id: `sale-${s.id}`,
        date: s.saleDate.slice(0, 10),
        kind: 'Sale',
        title: `Counter Bill ${s.invoiceNumber}`,
        detail: `${s.items.length} items · ${s.paymentMethod}${s.customerName ? ` · ${s.customerName}` : ''}`,
        amountLabel: `+${formatINR(s.totalAmount)}`,
        tone: 'positive',
      });
    }
    for (const po of workspace.purchases.slice(0, 3)) {
      events.push({
        id: `po-${po.id}`,
        date: po.orderDate.slice(0, 10),
        kind: 'Purchase',
        title: `Purchase Order ${po.poNumber}`,
        detail: `${po.items.length} SKU lines · Status: ${po.status}`,
        amountLabel: formatINR(po.totalAmount),
        tone: 'neutral',
      });
    }
    for (const tr of (workspace.stockTransfers || []).slice(0, 3)) {
      events.push({
        id: `tr-${tr.id}`,
        date: (tr.createdAt || todayISO).slice(0, 10),
        kind: 'Transfer',
        title: `FEFO Transfer → ${tr.targetShopName}`,
        detail: `${tr.quantity} × ${tr.productName || prodMap.get(tr.productId) || 'SKU'} · ${tr.status.replace('_', ' ')}`,
        amountLabel: formatINR(tr.quantity * tr.unitCost),
        tone: tr.status === 'completed' ? 'positive' : 'warning',
      });
    }
    for (const mv of workspace.stockMovements.filter((m) => m.movementType === 'wastage' || m.movementType === 'adjustment').slice(0, 3)) {
      events.push({
        id: `mv-${mv.id}`,
        date: mv.createdAt.slice(0, 10),
        kind: 'Stock',
        title: `${mv.movementType === 'wastage' ? 'Wastage Logged' : 'Stock Audit'} · ${prodMap.get(mv.productId) || `Product #${mv.productId}`}`,
        detail: mv.reason || 'Inventory adjustment',
        amountLabel: `${mv.quantityChange > 0 ? '+' : ''}${mv.quantityChange} units`,
        tone: mv.quantityChange < 0 ? 'warning' : 'neutral',
      });
    }

    return events.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7);
  }, [workspace, todayISO]);

  // 14-day sales & gross profit trend
  const salesTrendData = useMemo(() => {
    if (!workspace) return [];
    const byDate = new Map<string, { revenue: number; profit: number }>();
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      byDate.set(formatISODate(d), { revenue: 0, profit: 0 });
    }
    for (const s of workspace.sales) {
      const key = s.saleDate.slice(0, 10);
      if (byDate.has(key)) {
        const curr = byDate.get(key)!;
        curr.revenue += s.totalAmount;
        curr.profit += s.grossProfit;
      }
    }
    return Array.from(byDate.entries()).map(([date, vals]) => ({
      date: date.slice(5),
      revenue: Math.round(vals.revenue),
      profit: Math.round(vals.profit),
    }));
  }, [workspace]);

  // Category stock value distribution
  const categoryStockData = useMemo(() => {
    if (!workspace) return [];
    const catMap = new Map<string, number>();
    for (const p of workspace.products) {
      catMap.set(p.category, (catMap.get(p.category) || 0) + p.currentStock * p.purchasePrice);
    }
    return Array.from(catMap.entries())
      .map(([category, value]) => ({
        category: category.length > 14 ? `${category.slice(0, 13)}…` : category,
        value: Math.round(value),
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [workspace]);

  // Top-selling products
  const topSelling = useMemo(() => {
    if (!workspace) return [];
    const agg = new Map<number, { name: string; qty: number; revenue: number; profit: number }>();
    for (const s of workspace.sales) {
      for (const item of s.items) {
        const curr = agg.get(item.productId) || {
          name: item.productName,
          qty: 0,
          revenue: 0,
          profit: 0,
        };
        curr.qty += item.quantity;
        curr.revenue += item.lineTotal;
        curr.profit += item.lineProfit;
        agg.set(item.productId, curr);
      }
    }
    return Array.from(agg.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);
  }, [workspace]);

  if (!workspace) return null;

  const isCatalogEmpty = workspace.products.length === 0;

  return (
    <div className="space-y-6">
      {/* Empty shop starter callout when user created a blank shop */}
      {isCatalogEmpty && (
        <div className="bg-white border border-[#DCE6DF] rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-bold text-[#0D2818]">
              Your shop catalog is empty
            </h2>
            <p className="mt-1 text-sm text-[#4D6154]">
              Add your first Kirana product manually, upload a CSV sheet, or load our clearly labelled sample Kirana store to evaluate forecasting and alerts right away.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setActiveView('inventory')}
              className="px-4 py-2 text-sm font-semibold text-white bg-[#15803D] hover:bg-[#166534] rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              Add First Product
            </button>
            <button
              type="button"
              onClick={() => void seedSampleIntoCurrentShop()}
              className="px-4 py-2 text-sm font-medium text-[#0D2818] bg-[#F2F7F3] hover:bg-[#E4EFE7] border border-[#C6D5CA] rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              Load Sample Kirana Data
            </button>
          </div>
        </div>
      )}

      {/* Quick Action Bar */}
      <div className="flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={() => setActiveView('sales')}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-[#15803D] hover:bg-[#166534] rounded-lg transition-colors whitespace-nowrap cursor-pointer"
        >
          <Receipt className="w-4 h-4" />
          Record Sale
        </button>
        <button
          type="button"
          onClick={() => setActiveView('store3d')}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-[#0D2818] hover:bg-[#153C24] rounded-lg transition-colors whitespace-nowrap cursor-pointer"
        >
          <Box className="w-4 h-4 text-[#86EFAC]" />
          3D Store Twin
        </button>
        <button
          type="button"
          onClick={() => setActiveView('inventory')}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-[#0D2818] bg-white hover:bg-[#F2F7F3] border border-[#C6D5CA] rounded-lg transition-colors whitespace-nowrap cursor-pointer"
        >
          <PackagePlus className="w-4 h-4 text-[#15803D]" />
          Add Product
        </button>
        <button
          type="button"
          onClick={() => setActiveView('purchases')}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-[#0D2818] bg-white hover:bg-[#F2F7F3] border border-[#C6D5CA] rounded-lg transition-colors whitespace-nowrap cursor-pointer"
        >
          <ShoppingCart className="w-4 h-4 text-[#15803D]" />
          Add Purchase
        </button>
        <button
          type="button"
          onClick={() => setActiveView('inventory')}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-[#0D2818] bg-white hover:bg-[#F2F7F3] border border-[#C6D5CA] rounded-lg transition-colors whitespace-nowrap cursor-pointer"
        >
          <Warehouse className="w-4 h-4 text-[#15803D]" />
          View Inventory
        </button>
        <button
          type="button"
          onClick={() => setActiveView('simulator')}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-[#0D2818] bg-white hover:bg-[#F2F7F3] border border-[#C6D5CA] rounded-lg transition-colors whitespace-nowrap cursor-pointer"
        >
          <Sliders className="w-4 h-4 text-[#15803D]" />
          What-If Simulator
        </button>
        <button
          type="button"
          onClick={() => setActiveView('village_map')}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-[#0D2818] bg-white hover:bg-[#F2F7F3] border border-[#C6D5CA] rounded-lg transition-colors whitespace-nowrap cursor-pointer"
        >
          <MapPin className="w-4 h-4 text-[#15803D]" />
          Village Map
        </button>
        <button
          type="button"
          onClick={() => {
            void regenerateForecastsAndReorders();
            setActiveView('forecast');
          }}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-[#0D2818] bg-white hover:bg-[#F2F7F3] border border-[#C6D5CA] rounded-lg transition-colors whitespace-nowrap cursor-pointer"
        >
          <RefreshCw className="w-4 h-4 text-[#15803D]" />
          Generate Demand Forecast
        </button>
      </div>

      {/* Primary KPI Strip (5 Financial & Core Operations Metrics) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        <div className="bg-white border border-[#DCE6DF] rounded-xl p-5">
          <p className="text-xs font-medium text-[#54695B]">Total Products</p>
          <p className="mt-1.5 font-mono text-2xl font-bold text-[#0D2818] tabular-nums">
            {metrics.totalProducts}
          </p>
          <p className="mt-1 text-xs text-[#54695B]">
            {metrics.fastMovingCount} fast-moving · {metrics.slowMovingCount} slow/dead
          </p>
        </div>

        <div className="bg-white border border-[#DCE6DF] rounded-xl p-5">
          <p className="text-xs font-medium text-[#54695B]">Total Stock Value (Cost)</p>
          <p className="mt-1.5 font-mono text-2xl font-bold text-[#0D2818] tabular-nums">
            {formatINR(metrics.stockValue)}
          </p>
          <p className="mt-1 text-xs text-[#54695B]">Measured at purchase cost</p>
        </div>

        <div className="bg-white border border-[#DCE6DF] rounded-xl p-5">
          <p className="text-xs font-medium text-[#54695B]">Today&apos;s Sales (Revenue)</p>
          <p className="mt-1.5 font-mono text-2xl font-bold text-[#15803D] tabular-nums">
            {formatINR(metrics.todaySales)}
          </p>
          <p className="mt-1 text-xs text-[#54695B] tabular-nums">
            30d revenue: {formatINR(metrics.total30dSales)}
          </p>
        </div>

        <div className="bg-white border border-[#DCE6DF] rounded-xl p-5">
          <p className="text-xs font-medium text-[#54695B]">Est. Gross Profit (Today)</p>
          <p className="mt-1.5 font-mono text-2xl font-bold text-[#0D2818] tabular-nums">
            {formatINR(metrics.todayProfit)}
          </p>
          <p className="mt-1 text-xs text-[#54695B] tabular-nums">
            30d gross profit: {formatINR(metrics.total30dProfit)}
          </p>
        </div>

        <div className="bg-white border border-[#DCE6DF] rounded-xl p-5">
          <p className="text-xs font-medium text-[#54695B]">Pending Purchase Orders</p>
          <p className="mt-1.5 font-mono text-2xl font-bold text-[#0D2818] tabular-nums">
            {metrics.pendingPOsCount}
          </p>
          <button
            type="button"
            onClick={() => setActiveView('purchases')}
            className="mt-1 text-xs font-medium text-[#15803D] hover:underline cursor-pointer"
          >
            View supplier deliveries
          </button>
        </div>
      </div>

      {/* Operational Health Row (Low Stock, Out of Stock, Nearing Expiry, Fast/Slow Movers) */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <button
          type="button"
          onClick={() => setActiveView('inventory')}
          className="text-left bg-white border border-[#DCE6DF] hover:border-[#B7CBBF] rounded-xl p-4 transition-colors cursor-pointer"
        >
          <p className="text-xs text-[#54695B]">Low-Stock SKUs</p>
          <p className="mt-1 font-mono text-xl font-bold text-[#B45309] tabular-nums">
            {metrics.lowStockCount}
          </p>
          <p className="text-xs text-[#B45309] mt-0.5">Below min level</p>
        </button>

        <button
          type="button"
          onClick={() => setActiveView('reorders')}
          className="text-left bg-white border border-[#DCE6DF] hover:border-[#B7CBBF] rounded-xl p-4 transition-colors cursor-pointer"
        >
          <p className="text-xs text-[#54695B]">Out-of-Stock SKUs</p>
          <p className="mt-1 font-mono text-xl font-bold text-[#B91C1C] tabular-nums">
            {metrics.outOfStockCount}
          </p>
          <p className="text-xs text-[#B91C1C] mt-0.5">Immediate restock</p>
        </button>

        <button
          type="button"
          onClick={() => setActiveView('expiry')}
          className="text-left bg-white border border-[#DCE6DF] hover:border-[#B7CBBF] rounded-xl p-4 transition-colors cursor-pointer"
        >
          <p className="text-xs text-[#54695B]">Nearing / Past Expiry</p>
          <p className="mt-1 font-mono text-xl font-bold text-[#B91C1C] tabular-nums">
            {metrics.nearingExpiryCount + metrics.expiredCount}
          </p>
          <p className="text-xs text-[#54695B] mt-0.5 tabular-nums">
            {metrics.expiredCount} expired · {formatINR(expirySummary.totalMoneyAtRisk)} risk
          </p>
        </button>

        <button
          type="button"
          onClick={() => setActiveView('forecast')}
          className="text-left bg-white border border-[#DCE6DF] hover:border-[#B7CBBF] rounded-xl p-4 transition-colors cursor-pointer"
        >
          <p className="text-xs text-[#54695B]">Fast-Moving SKUs</p>
          <p className="mt-1 font-mono text-xl font-bold text-[#15803D] tabular-nums">
            {metrics.fastMovingCount}
          </p>
          <p className="text-xs text-[#54695B] mt-0.5">&ge; 2 units/day avg</p>
        </button>

        <button
          type="button"
          onClick={() => setActiveView('insights')}
          className="text-left bg-white border border-[#DCE6DF] hover:border-[#B7CBBF] rounded-xl p-4 transition-colors cursor-pointer col-span-2 lg:col-span-1"
        >
          <p className="text-xs text-[#54695B]">Dead-Stock Tied Value</p>
          <p className="mt-1 font-mono text-xl font-bold text-[#B45309] tabular-nums">
            {formatINR(metrics.deadStockValue)}
          </p>
          <p className="text-xs text-[#54695B] mt-0.5">
            {metrics.slowMovingCount} slow/dead SKUs
          </p>
        </button>
      </div>

      {/* Module A Forward Intelligence Strip (Predicted Demand, Expected Purchases, Group Order Savings Preview) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <button
          type="button"
          onClick={() => setActiveView('forecast')}
          className="text-left bg-white border border-[#DCE6DF] hover:border-[#B7CBBF] rounded-xl p-4 transition-colors cursor-pointer"
        >
          <p className="text-xs text-[#54695B]">Predicted 7-Day Store Demand</p>
          <p className="mt-1 font-mono text-xl font-bold text-[#0D2818] tabular-nums">
            {metrics.predicted7dDemand.toLocaleString('en-IN')} units
          </p>
          <p className="text-xs text-[#54695B] mt-0.5">
            Statistical forecast across {workspace.products.length} active SKUs
          </p>
        </button>

        <button
          type="button"
          onClick={() => setActiveView('reorders')}
          className="text-left bg-white border border-[#DCE6DF] hover:border-[#B7CBBF] rounded-xl p-4 transition-colors cursor-pointer"
        >
          <p className="text-xs text-[#54695B]">Expected Purchases (Pending POs + Reorders)</p>
          <p className="mt-1 font-mono text-xl font-bold text-[#0D2818] tabular-nums">
            {formatINR(metrics.expectedPurchasesValue)}
          </p>
          <p className="text-xs text-[#54695B] mt-0.5">
            {workspace.reorders.filter((r) => r.status === 'pending').length} pending reorder reviews · {metrics.pendingPOsCount} open POs
          </p>
        </button>

        <button
          type="button"
          onClick={() => setActiveView('group_buying')}
          className="text-left bg-white border border-[#DCE6DF] hover:border-[#B7CBBF] rounded-xl p-4 transition-colors cursor-pointer"
        >
          <p className="text-xs text-[#54695B]">
            {metrics.hasLiveGroupSavings
              ? 'Group Order Savings (Bulk + Transport)'
              : 'Potential Group Order Savings (Indicative)'}
          </p>
          <p className="mt-1 font-mono text-xl font-bold text-[#15803D] tabular-nums">
            {formatINR(metrics.estGroupSavings)}
          </p>
          <p className="text-xs text-[#54695B] mt-0.5 tabular-nums">
            {metrics.hasLiveGroupSavings
              ? `${metrics.activeGroupPoolCount} pools · ${formatINR(metrics.liveGroupProductSavings)} bulk + ${formatINR(metrics.liveGroupTransportSavings)} delivery`
              : 'Start a collective pool to unlock wholesale bulk discounts'}
          </p>
        </button>
      </div>

      {/* Charts Row: Sales Trend + Stock Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white border border-[#DCE6DF] rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-display text-base font-bold text-[#0D2818]">
                14-Day Sales Revenue &amp; Gross Profit
              </h2>
              <p className="text-xs text-[#54695B]">
                Revenue vs recorded purchase-cost gross margin (₹)
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActiveView('reports')}
              className="text-xs font-medium text-[#15803D] hover:underline whitespace-nowrap cursor-pointer"
            >
              Full Reports
            </button>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={salesTrendData} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#15803D" stopOpacity={0.22} />
                    <stop offset="95%" stopColor="#15803D" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E7EFE9" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#54695B' }} />
                <YAxis tick={{ fontSize: 11, fill: '#54695B' }} tickFormatter={(v) => `₹${v}`} />
                <Tooltip
                  formatter={(value, name) => [
                    `₹${Number(value ?? 0).toLocaleString('en-IN')}`,
                    name === 'revenue' ? 'Sales Revenue' : 'Gross Profit',
                  ]}
                  contentStyle={{
                    backgroundColor: '#FFFFFF',
                    borderColor: '#DCE6DF',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke="#15803D"
                  strokeWidth={2}
                  fill="url(#revGrad)"
                />
                <Area
                  type="monotone"
                  dataKey="profit"
                  stroke="#0D2818"
                  strokeWidth={2}
                  fillOpacity={0}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="lg:col-span-5 bg-white border border-[#DCE6DF] rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-display text-base font-bold text-[#0D2818]">
                Stock Value by Category
              </h2>
              <p className="text-xs text-[#54695B]">Inventory capital tied per category (₹ at cost)</p>
            </div>
          </div>
          <div className="h-64 w-full">
            {categoryStockData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={categoryStockData}
                  layout="vertical"
                  margin={{ top: 4, right: 16, left: 10, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#E7EFE9" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#54695B' }} tickFormatter={(v) => `₹${v}`} />
                  <YAxis
                    type="category"
                    dataKey="category"
                    width={102}
                    tick={{ fontSize: 11, fill: '#111D15' }}
                  />
                  <Tooltip
                    formatter={(value) => [`₹${Number(value ?? 0).toLocaleString('en-IN')}`, 'Stock Cost']}
                    contentStyle={{
                      backgroundColor: '#FFFFFF',
                      borderColor: '#DCE6DF',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                  />
                  <Bar dataKey="value" fill="#15803D" radius={[0, 4, 4, 0]} barSize={18} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-[#54695B]">
                Add inventory products to visualize category stock distribution.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Operational Grid: Expiry Alerts + AI Insights + Top Sellers + Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Expiry Alerts & Weather Signal */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white border border-[#DCE6DF] rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-[#B91C1C]" />
                <h2 className="font-display text-base font-bold text-[#0D2818]">
                  Priority Expiry Alerts
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setActiveView('expiry')}
                className="text-xs font-medium text-[#15803D] hover:underline cursor-pointer"
              >
                Manage Batches
              </button>
            </div>

            {expirySummary.expired.length === 0 && expirySummary.within15.length + expirySummary.within7.length === 0 ? (
              <p className="text-sm text-[#54695B] py-4">
                No expired or 15-day expiring batches detected right now.
              </p>
            ) : (
              <div className="divide-y divide-[#EDF2EE]">
                {[...expirySummary.expired, ...expirySummary.within7, ...expirySummary.within15]
                  .slice(0, 5)
                  .map((b) => (
                    <div key={b.id} className="py-2.5 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[#0D2818] truncate">
                          {b.product?.name || `Product #${b.productId}`}
                        </p>
                        <p className="text-xs text-[#54695B] font-mono">
                          Batch {b.batchNumber} · {b.quantity} {b.product?.unit || 'units'} · Exp {b.expiryDate}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p
                          className={`text-xs font-semibold ${
                            b.daysLeft < 0
                              ? 'text-[#B91C1C]'
                              : b.daysLeft <= 7
                              ? 'text-[#B45309]'
                              : 'text-[#92400E]'
                          }`}
                        >
                          {b.daysLeft < 0
                            ? `Expired (${Math.abs(b.daysLeft)}d ago)`
                            : `Expires in ${b.daysLeft}d`}
                        </p>
                        <p className="text-xs font-mono text-[#54695B] tabular-nums">
                          {formatINR(b.valueAtRisk)}
                        </p>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* Live Open-Meteo Weather Planning Signal */}
          <div className="bg-white border border-[#DCE6DF] rounded-xl p-5">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <CloudSun className="w-4 h-4 text-[#15803D]" />
                <h2 className="font-display text-sm font-bold text-[#0D2818]">
                  Regional Weather Signal ({weather?.source || 'Open-Meteo'})
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setActiveView('festivals')}
                className="text-xs font-medium text-[#15803D] hover:underline cursor-pointer"
              >
                5-Day View
              </button>
            </div>
            <p className="text-xs text-[#4D6154] leading-relaxed">
              {weather
                ? weather.temperatureC !== undefined
                  ? `${weather.city}: ${weather.temperatureC}°C · ${weather.condition} · Humidity ${weather.humidity}%${weather.windKmh !== undefined ? ` · Wind ${weather.windKmh} km/h` : ''}. ${weather.planningNote}`
                  : weather.planningNote
                : 'Checking Open-Meteo weather outlook (advisory only; never blocks store operations).'}
            </p>
            {weather && (
              <p className="mt-2 text-[11px] text-[#6B7F71] font-mono">
                Checked: {new Date(weather.updatedAt).toLocaleTimeString()} · Planning signal only (separate from sales forecasts)
              </p>
            )}
          </div>
        </div>

        {/* Business Insights + Top Selling + Recent Activity */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-white border border-[#DCE6DF] rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-[#15803D]" />
                <h2 className="font-display text-base font-bold text-[#0D2818]">
                  Actionable Store Insights
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setActiveView('insights')}
                className="inline-flex items-center gap-1 text-xs font-medium text-[#15803D] hover:underline cursor-pointer"
              >
                Open AI Insights <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="divide-y divide-[#EDF2EE]">
              {insights.slice(0, 4).map((ins) => (
                <div key={ins.id} className="py-3">
                  <div className="flex items-center justify-between gap-2 text-xs text-[#54695B]">
                    <span className="font-medium capitalize">
                      {ins.kind === 'observation' ? 'Recorded Observation' : 'Demand Prediction'}
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
                  <p className="mt-1 text-sm font-semibold text-[#0D2818]">{ins.title}</p>
                  <p className="mt-0.5 text-xs text-[#4D6154]">{ins.summary}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white border border-[#DCE6DF] rounded-xl p-5">
              <h2 className="font-display text-sm font-bold text-[#0D2818] mb-3">
                Top-Selling Products (30d)
              </h2>
              {topSelling.length === 0 ? (
                <p className="text-xs text-[#54695B]">No recorded sales yet.</p>
              ) : (
                <div className="divide-y divide-[#EDF2EE]">
                  {topSelling.map((item) => (
                    <div key={item.name} className="py-2 flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-[#0D2818] truncate">
                        {item.name}
                      </span>
                      <span className="text-xs font-mono text-[#15803D] tabular-nums shrink-0">
                        {item.qty} sold · {formatINR(item.revenue)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white border border-[#DCE6DF] rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-[#15803D]" />
                  <h2 className="font-display text-sm font-bold text-[#0D2818]">
                    Store Activity Timeline
                  </h2>
                </div>
                <span className="text-[11px] text-[#54695B]">Chronological</span>
              </div>
              {activityTimeline.length === 0 ? (
                <p className="text-xs text-[#54695B]">No recent store activity recorded.</p>
              ) : (
                <div className="divide-y divide-[#EDF2EE]">
                  {activityTimeline.map((ev) => (
                    <div key={ev.id} className="py-2 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-[#0D2818] truncate">
                          <span className="font-semibold text-[#15803D]">{ev.kind}</span> · {ev.title}
                        </p>
                        <p className="text-[11px] text-[#54695B] truncate">
                          {ev.date} · {ev.detail}
                        </p>
                      </div>
                      <span
                        className={`text-xs font-mono font-semibold tabular-nums shrink-0 ${
                          ev.tone === 'positive'
                            ? 'text-[#15803D]'
                            : ev.tone === 'warning'
                            ? 'text-[#B45309]'
                            : 'text-[#0D2818]'
                        }`}
                      >
                        {ev.amountLabel}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
