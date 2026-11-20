import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Bell,
  Building2,
  CheckCheck,
  CheckCircle2,
  Download,
  Edit3,
  Lock,
  MapPin,
  Plus,
  Printer,
  Shield,
  Share2,
  Truck,
  X,
} from 'lucide-react';
import { useShop } from '../context/ShopContext.tsx';
import { daysBetweenDates, formatISODate } from '../services/intelligenceEngine.ts';

export function ReportsView() {
  const { workspace, expirySummary, notify } = useShop();
  const [rangeDays, setRangeDays] = useState<7 | 30 | 90>(30);
  const [monthlyOverhead, setMonthlyOverhead] = useState('12000');

  const todayISO = formatISODate(new Date());

  const reportData = useMemo(() => {
    if (!workspace) {
      return {
        revenue: 0,
        cogs: 0,
        grossProfit: 0,
        wastageLoss: 0,
        estimatedNetProfit: 0,
        inventoryValuation: 0,
        categoryBreakdown: [] as Array<{ category: string; revenue: number; profit: number; qty: number }>,
        productBreakdown: [] as Array<{ name: string; qty: number; revenue: number; profit: number; marginPct: number }>,
      };
    }

    const prodMap = new Map(workspace.products.map((p) => [p.id, p]));
    const filteredSales = workspace.sales.filter((s) => {
      const age = daysBetweenDates(s.saleDate.slice(0, 10), todayISO);
      return age >= 0 && age < rangeDays;
    });

    const revenue = filteredSales.reduce((s, r) => s + r.totalAmount, 0);
    const cogs = filteredSales.reduce((s, r) => s + r.totalCost, 0);
    const grossProfit = filteredSales.reduce((s, r) => s + r.grossProfit, 0);
    const wastageLoss = workspace.wastageLogs
      .filter((w) => {
        const age = daysBetweenDates(w.loggedDate.slice(0, 10), todayISO);
        return age >= 0 && age < rangeDays;
      })
      .reduce((s, w) => s + w.estimatedLoss, 0);

    const overheadProrated = (Math.max(0, Number(monthlyOverhead || 0)) / 30) * rangeDays;
    const estimatedNetProfit = grossProfit - wastageLoss - overheadProrated;
    const inventoryValuation = workspace.products.reduce(
      (s, p) => s + p.currentStock * p.purchasePrice,
      0
    );

    const catAgg = new Map<string, { revenue: number; profit: number; qty: number }>();
    const prodAgg = new Map<number, { name: string; qty: number; revenue: number; profit: number }>();

    for (const s of filteredSales) {
      for (const item of s.items) {
        const prod = prodMap.get(item.productId);
        const cat = prod?.category || 'Uncategorized';
        const cCurr = catAgg.get(cat) || { revenue: 0, profit: 0, qty: 0 };
        cCurr.revenue += item.lineTotal;
        cCurr.profit += item.lineProfit;
        cCurr.qty += item.quantity;
        catAgg.set(cat, cCurr);

        const pCurr = prodAgg.get(item.productId) || {
          name: item.productName,
          qty: 0,
          revenue: 0,
          profit: 0,
        };
        pCurr.qty += item.quantity;
        pCurr.revenue += item.lineTotal;
        pCurr.profit += item.lineProfit;
        prodAgg.set(item.productId, pCurr);
      }
    }

    const categoryBreakdown = Array.from(catAgg.entries())
      .map(([category, v]) => ({
        category,
        revenue: Math.round(v.revenue),
        profit: Math.round(v.profit),
        qty: v.qty,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    const productBreakdown = Array.from(prodAgg.values())
      .map((p) => ({
        ...p,
        marginPct: p.revenue > 0 ? Number(((p.profit / p.revenue) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    return {
      revenue,
      cogs,
      grossProfit,
      wastageLoss,
      estimatedNetProfit,
      inventoryValuation,
      categoryBreakdown,
      productBreakdown,
    };
  }, [workspace, rangeDays, monthlyOverhead, todayISO]);

  if (!workspace) return null;

  const downloadSalesReportCsv = () => {
    const header = 'Product,UnitsSold,RevenueINR,GrossProfitINR,GrossMarginPct';
    const rows = reportData.productBreakdown.map(
      (p) =>
        `"${p.name.replace(/"/g, '""')}",${p.qty},${p.revenue.toFixed(2)},${p.profit.toFixed(2)},${p.marginPct}`
    );
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dukaaniq-report-${rangeDays}d-${todayISO}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    notify('Downloaded CSV analytics report.', 'success');
  };

  return (
    <div className="space-y-6">
      <div className="no-print flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex items-center gap-1 p-1 bg-[#EBF1EC] rounded-lg">
          {([7, 30, 90] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setRangeDays(d)}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-md cursor-pointer ${
                rangeDays === d ? 'bg-white text-[#0D2818] shadow-xs' : 'text-[#4D6154]'
              }`}
            >
              Last {d} Days
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 text-xs text-[#4D6154] bg-white border border-[#DCE6DF] rounded-lg px-3 py-1.5">
            <span>Est. Monthly Shop Rent/Power (₹):</span>
            <input
              type="number"
              min="0"
              value={monthlyOverhead}
              onChange={(e) => setMonthlyOverhead(e.target.value)}
              className="w-20 font-mono font-semibold text-[#0D2818] focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={downloadSalesReportCsv}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#0D2818] bg-white hover:bg-[#F2F7F3] border border-[#C6D5CA] rounded-lg cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-[#15803D]" />
            Download CSV
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#0D2818] hover:bg-[#163D26] rounded-lg cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            Print Report
          </button>
        </div>
      </div>

      {/* Explicit Revenue vs Gross Profit vs Net Profit Distinction */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white border border-[#DCE6DF] rounded-xl p-4">
          <p className="text-xs text-[#54695B]">Total Sales Revenue</p>
          <p className="mt-1 font-mono text-xl font-bold text-[#0D2818] tabular-nums">
            ₹{Math.round(reportData.revenue).toLocaleString('en-IN')}
          </p>
          <p className="text-[11px] text-[#54695B] mt-0.5">Top-line counter bills (not profit)</p>
        </div>
        <div className="bg-white border border-[#DCE6DF] rounded-xl p-4">
          <p className="text-xs text-[#54695B]">Gross Profit (Rev − COGS)</p>
          <p className="mt-1 font-mono text-xl font-bold text-[#15803D] tabular-nums">
            ₹{Math.round(reportData.grossProfit).toLocaleString('en-IN')}
          </p>
          <p className="text-[11px] text-[#54695B] mt-0.5 tabular-nums">
            {reportData.revenue > 0
              ? `${((reportData.grossProfit / reportData.revenue) * 100).toFixed(1)}% avg gross margin`
              : '0% margin'}
          </p>
        </div>
        <div className="bg-white border border-[#DCE6DF] rounded-xl p-4">
          <p className="text-xs text-[#54695B]">Est. Net Profit</p>
          <p
            className={`mt-1 font-mono text-xl font-bold tabular-nums ${
              reportData.estimatedNetProfit >= 0 ? 'text-[#0D2818]' : 'text-[#B91C1C]'
            }`}
          >
            ₹{Math.round(reportData.estimatedNetProfit).toLocaleString('en-IN')}
          </p>
          <p className="text-[11px] text-[#54695B] mt-0.5">Gross − Wastage − Prorated Overhead</p>
        </div>
        <div className="bg-white border border-[#DCE6DF] rounded-xl p-4">
          <p className="text-xs text-[#54695B]">Inventory Valuation (Cost)</p>
          <p className="mt-1 font-mono text-xl font-bold text-[#0D2818] tabular-nums">
            ₹{Math.round(reportData.inventoryValuation).toLocaleString('en-IN')}
          </p>
          <p className="text-[11px] text-[#54695B] mt-0.5">Active stock at purchase cost</p>
        </div>
        <div className="bg-white border border-[#DCE6DF] rounded-xl p-4">
          <p className="text-xs text-[#54695B]">Wastage &amp; Expiry Exposure</p>
          <p className="mt-1 font-mono text-xl font-bold text-[#B91C1C] tabular-nums">
            ₹{Math.round(reportData.wastageLoss).toLocaleString('en-IN')}
          </p>
          <p className="text-[11px] text-[#54695B] mt-0.5 tabular-nums">
            Active &le;30d risk: ₹{Math.round(expirySummary.totalMoneyAtRisk).toLocaleString('en-IN')}
          </p>
        </div>
      </div>

      {/* Category Revenue & Profit Chart */}
      <div className="bg-white border border-[#DCE6DF] rounded-xl p-5">
        <h3 className="font-display text-base font-bold text-[#0D2818] mb-1">
          Category-Wise Revenue vs Gross Profit ({rangeDays} Days)
        </h3>
        <p className="text-xs text-[#54695B] mb-4">
          Compare top-line category turnover against actual gross profit earned
        </p>
        <div className="h-64 w-full">
          {reportData.categoryBreakdown.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={reportData.categoryBreakdown}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E7EFE9" />
                <XAxis dataKey="category" tick={{ fontSize: 11, fill: '#54695B' }} />
                <YAxis tick={{ fontSize: 11, fill: '#54695B' }} tickFormatter={(v) => `₹${v}`} />
                <Tooltip
                  formatter={(v, name) => [
                    `₹${Number(v ?? 0).toLocaleString('en-IN')}`,
                    name === 'revenue' ? 'Sales Revenue' : 'Gross Profit',
                  ]}
                />
                <Bar dataKey="revenue" fill="#15803D" radius={[4, 4, 0, 0]} />
                <Bar dataKey="profit" fill="#0D2818" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-[#54695B]">
              No sales recorded in the selected date window.
            </div>
          )}
        </div>
      </div>

      {/* Product-wise Sales & Margin Table */}
      <div className="bg-white border border-[#DCE6DF] rounded-xl overflow-hidden">
        <div className="p-4 border-b border-[#EDF2EE]">
          <h3 className="font-display text-sm font-bold text-[#0D2818]">
            Product-Wise Sales &amp; Gross Margin Breakdown
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#E2EAE4] bg-[#F5F9F6] text-xs font-semibold text-[#4D6154]">
                <th className="py-3 px-4">Product</th>
                <th className="py-3 px-3 text-right">Units Sold</th>
                <th className="py-3 px-3 text-right">Sales Revenue (₹)</th>
                <th className="py-3 px-3 text-right">Gross Profit (₹)</th>
                <th className="py-3 px-4 text-right">Gross Margin</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EDF2EE] text-xs">
              {reportData.productBreakdown.map((p) => (
                <tr key={p.name}>
                  <td className="py-2.5 px-4 font-medium text-[#0D2818]">{p.name}</td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums">{p.qty}</td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                    ₹{p.revenue.toFixed(2)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono font-semibold text-[#15803D] tabular-nums">
                    ₹{p.profit.toFixed(2)}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums">{p.marginPct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function DistributorHubView() {
  const {
    workspace,
    addDistributorOffer,
    updateDistributorOffer,
    decideGroupOrder,
    setActiveView,
    notify,
  } = useShop();
  const [activeTab, setActiveTab] = useState<'catalog' | 'orders' | 'demand'>('catalog');
  const [sharedIds, setSharedIds] = useState<number[]>([]);
  const [editingOfferId, setEditingOfferId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState({
    standardUnitPrice: '',
    bulkUnitPrice: '',
    minBulkQty: '',
    availableQty: '',
    deliveryFeeINR: '',
  });
  const [showAddOffer, setShowAddOffer] = useState(false);
  const [offerForm, setOfferForm] = useState({
    distributorName: 'Kaveri Agro Wholesale (Verified Demo)',
    distributorCity: 'Mysuru APMC Yard',
    productName: '',
    category: 'Staples & Grains',
    unit: 'pack',
    standardUnitPrice: '120',
    bulkUnitPrice: '108',
    minBulkQty: '50',
    availableQty: '300',
    leadTimeDays: '2',
    deliveryFeeINR: '280',
  });

  if (!workspace) return null;

  const offers = workspace.distributorOffers || [];
  const groupOrders = workspace.groupOrders || [];
  const villageSignals = (workspace.villageDemandSignals || []).filter((s) => s.isOptedIn);
  const approvedReorders = workspace.reorders.filter((r) => r.status === 'approved');
  const pendingReorders = workspace.reorders.filter((r) => r.status === 'pending');

  const ownerApprovedGroupOrders = groupOrders.filter(
    (g) => g.status === 'approved_by_owner' || g.status === 'distributor_accepted'
  );

  const startEditingOffer = (offer: NonNullable<typeof workspace.distributorOffers>[number]) => {
    setEditingOfferId(offer.id);
    setEditDraft({
      standardUnitPrice: String(offer.standardUnitPrice),
      bulkUnitPrice: String(offer.bulkUnitPrice),
      minBulkQty: String(offer.minBulkQty),
      availableQty: String(offer.availableQty),
      deliveryFeeINR: String(offer.deliveryFeeINR),
    });
  };

  const handleSaveOfferEdit = async (offerId: number) => {
    await updateDistributorOffer(offerId, {
      standardUnitPrice: Number(editDraft.standardUnitPrice),
      bulkUnitPrice: Number(editDraft.bulkUnitPrice),
      minBulkQty: Number(editDraft.minBulkQty),
      availableQty: Number(editDraft.availableQty),
      deliveryFeeINR: Number(editDraft.deliveryFeeINR),
    });
    setEditingOfferId(null);
  };

  const handleCreateOffer = async (e: React.FormEvent) => {
    e.preventDefault();
    await addDistributorOffer({
      distributorName: offerForm.distributorName,
      distributorCity: offerForm.distributorCity,
      verified: true,
      productName: offerForm.productName,
      category: offerForm.category,
      unit: offerForm.unit,
      standardUnitPrice: Number(offerForm.standardUnitPrice),
      bulkUnitPrice: Number(offerForm.bulkUnitPrice),
      minBulkQty: Number(offerForm.minBulkQty),
      availableQty: Number(offerForm.availableQty),
      leadTimeDays: Number(offerForm.leadTimeDays),
      deliveryFeeINR: Number(offerForm.deliveryFeeINR),
      latitude: workspace.shop.latitude ?? 12.3385,
      longitude: workspace.shop.longitude ?? 76.6524,
    });
    setShowAddOffer(false);
    setOfferForm((prev) => ({ ...prev, productName: '' }));
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white border border-[#DCE6DF] rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1 max-w-2xl">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#15803D]">
            <Lock className="w-3.5 h-3.5" />
            <span>Verified Distributor Marketplace · Privacy-Safe Opt-In Demand</span>
          </div>
          <h2 className="font-display text-lg font-bold text-[#0D2818]">
            Distributor Marketplace &amp; Wholesale Order Portal
          </h2>
          <p className="text-xs text-[#4D6154]">
            Manage verified wholesale listings, bulk-tier pricing, and stock availability; accept owner-approved collective group orders; and inspect anonymized village demand clusters without exposing private shop financials.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => setActiveView('group_buying')}
            className="px-3.5 py-2 text-xs font-semibold text-[#0D2818] bg-white hover:bg-[#F2F7F3] border border-[#C6D5CA] rounded-lg whitespace-nowrap cursor-pointer"
          >
            Group Purchasing Pools
          </button>
          <button
            type="button"
            onClick={() => setShowAddOffer(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#15803D] hover:bg-[#166534] rounded-lg whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Add Verified Listing
          </button>
        </div>
      </div>

      {/* Portal Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[#DCE6DF] pb-3">
        {[
          { id: 'catalog' as const, label: `Verified Catalog & Pricing (${offers.length})` },
          {
            id: 'orders' as const,
            label: `Incoming Shop & Group Orders (${ownerApprovedGroupOrders.length + approvedReorders.length})`,
          },
          {
            id: 'demand' as const,
            label: `Privacy-Safe Village Demand (${villageSignals.length})`,
          },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === tab.id
                ? 'bg-[#0D2818] text-white'
                : 'bg-white text-[#4D6154] border border-[#DCE6DF] hover:bg-[#F2F7F3]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* TAB 1: Verified Catalog & Pricing */}
      {activeTab === 'catalog' && (
        <div className="bg-white border border-[#DCE6DF] rounded-xl overflow-hidden">
          <div className="p-4 border-b border-[#EDF2EE] flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-sm font-bold text-[#0D2818]">
                Active Verified Wholesale Listings
              </h3>
              <p className="text-xs text-[#54695B]">
                Edit unit prices, bulk MOQs, available warehouse stock, or delivery fees inline.
              </p>
            </div>
            <span className="text-xs text-[#54695B]">
              Demo wholesale suppliers clearly labelled (Verified Demo)
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#E2EAE4] bg-[#F5F9F6] text-xs font-semibold text-[#4D6154]">
                  <th className="py-3 px-4">Product</th>
                  <th className="py-3 px-3">Distributor</th>
                  <th className="py-3 px-3 text-right">Std Price (₹)</th>
                  <th className="py-3 px-3 text-right">Bulk Price (₹)</th>
                  <th className="py-3 px-3 text-right">Min Bulk Qty</th>
                  <th className="py-3 px-3 text-right">Available Stock</th>
                  <th className="py-3 px-3 text-right">Delivery Fee</th>
                  <th className="py-3 px-4 text-right">Edit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EDF2EE] text-xs">
                {offers.map((offer) => {
                  const isEditing = editingOfferId === offer.id;
                  return (
                    <tr key={offer.id} className="hover:bg-[#F9FBF9]">
                      <td className="py-3 px-4">
                        <p className="font-semibold text-[#0D2818]">{offer.productName}</p>
                        <p className="text-[11px] text-[#54695B]">
                          {offer.category} · unit: {offer.unit}
                        </p>
                      </td>
                      <td className="py-3 px-3">
                        <p className="font-medium text-[#0D2818]">{offer.distributorName}</p>
                        <p className="text-[11px] text-[#15803D]">
                          {offer.verified ? 'Verified' : 'Unverified'} · {offer.distributorCity}
                        </p>
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums">
                        {isEditing ? (
                          <input
                            type="number"
                            value={editDraft.standardUnitPrice}
                            onChange={(e) =>
                              setEditDraft((d) => ({ ...d, standardUnitPrice: e.target.value }))
                            }
                            className="w-20 px-2 py-1 border border-[#C6D5CA] rounded text-right"
                          />
                        ) : (
                          `₹${offer.standardUnitPrice}`
                        )}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-semibold text-[#15803D] tabular-nums">
                        {isEditing ? (
                          <input
                            type="number"
                            value={editDraft.bulkUnitPrice}
                            onChange={(e) =>
                              setEditDraft((d) => ({ ...d, bulkUnitPrice: e.target.value }))
                            }
                            className="w-20 px-2 py-1 border border-[#C6D5CA] rounded text-right"
                          />
                        ) : (
                          `₹${offer.bulkUnitPrice}`
                        )}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums">
                        {isEditing ? (
                          <input
                            type="number"
                            value={editDraft.minBulkQty}
                            onChange={(e) =>
                              setEditDraft((d) => ({ ...d, minBulkQty: e.target.value }))
                            }
                            className="w-16 px-2 py-1 border border-[#C6D5CA] rounded text-right"
                          />
                        ) : (
                          offer.minBulkQty
                        )}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums">
                        {isEditing ? (
                          <input
                            type="number"
                            value={editDraft.availableQty}
                            onChange={(e) =>
                              setEditDraft((d) => ({ ...d, availableQty: e.target.value }))
                            }
                            className="w-20 px-2 py-1 border border-[#C6D5CA] rounded text-right"
                          />
                        ) : (
                          `${offer.availableQty} ${offer.unit}`
                        )}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums">
                        {isEditing ? (
                          <input
                            type="number"
                            value={editDraft.deliveryFeeINR}
                            onChange={(e) =>
                              setEditDraft((d) => ({ ...d, deliveryFeeINR: e.target.value }))
                            }
                            className="w-20 px-2 py-1 border border-[#C6D5CA] rounded text-right"
                          />
                        ) : (
                          `₹${offer.deliveryFeeINR}`
                        )}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        {isEditing ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => void handleSaveOfferEdit(offer.id)}
                              className="px-2.5 py-1 text-xs font-semibold text-white bg-[#15803D] rounded cursor-pointer"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingOfferId(null)}
                              className="px-2 py-1 text-xs text-[#54695B] hover:text-[#0D2818] cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => startEditingOffer(offer)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[#0D2818] hover:bg-[#EFF5F1] rounded cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5 text-[#15803D]" />
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: Incoming Shop & Group Orders */}
      {activeTab === 'orders' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Collective Group Order Requests */}
          <div className="lg:col-span-7 bg-white border border-[#DCE6DF] rounded-xl p-5 space-y-4">
            <div>
              <h3 className="font-display text-base font-bold text-[#0D2818]">
                Owner-Approved Collective Group Orders
              </h3>
              <p className="text-xs text-[#54695B]">
                Only pools explicitly approved by participating shopkeepers appear here for supply acceptance.
              </p>
            </div>

            {ownerApprovedGroupOrders.length === 0 ? (
              <div className="p-6 rounded-xl bg-[#F8FAF8] border border-[#E2EAE4] text-xs text-[#4D6154]">
                No owner-approved group order pools awaiting supply confirmation yet. Approve a threshold-met pool in{' '}
                <button
                  type="button"
                  onClick={() => setActiveView('group_buying')}
                  className="font-semibold text-[#15803D] underline cursor-pointer"
                >
                  Group Purchasing
                </button>{' '}
                first.
              </div>
            ) : (
              <div className="divide-y divide-[#EDF2EE]">
                {ownerApprovedGroupOrders.map((pool) => {
                  const totalValue = Math.round(pool.combinedQty * pool.bulkUnitPrice);
                  const accepted = pool.distributorAccepted || pool.status === 'distributor_accepted';
                  return (
                    <div
                      key={pool.id}
                      className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="space-y-0.5">
                        <p className="text-xs font-mono text-[#54695B]">
                          {pool.poolCode} · {pool.members.length} village shops · {pool.distributorName}
                        </p>
                        <p className="text-sm font-semibold text-[#0D2818]">{pool.productName}</p>
                        <p className="text-xs font-mono text-[#4D6154] tabular-nums">
                          Pooled Qty: {pool.combinedQty} {pool.unit} @ ₹{pool.bulkUnitPrice}/{pool.unit} · Gross Value: ₹{totalValue.toLocaleString('en-IN')}
                        </p>
                      </div>
                      {accepted ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#15803D] whitespace-nowrap">
                          <CheckCircle2 className="w-4 h-4" />
                          Supply Confirmed
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void decideGroupOrder(pool.id, 'accept_distributor')}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#15803D] hover:bg-[#166534] rounded-lg whitespace-nowrap cursor-pointer"
                        >
                          <Truck className="w-3.5 h-3.5" />
                          Accept &amp; Confirm Supply
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Approved Single-Shop Reorders */}
          <div className="lg:col-span-5 bg-white border border-[#DCE6DF] rounded-xl p-5 space-y-4">
            <div>
              <h3 className="font-display text-base font-bold text-[#0D2818]">
                Approved Single-Shop Reorder Requests
              </h3>
              <p className="text-xs text-[#54695B]">
                Owner-approved individual SKU reorders queued for distributor dispatch.
              </p>
            </div>

            {approvedReorders.length === 0 ? (
              <div className="p-5 rounded-xl bg-[#F8FAF8] border border-[#E2EAE4] text-xs text-[#4D6154]">
                {pendingReorders.length} reorder suggestions are awaiting review in the{' '}
                <button
                  type="button"
                  onClick={() => setActiveView('reorders')}
                  className="font-semibold text-[#15803D] underline cursor-pointer"
                >
                  Reorder Engine
                </button>
                .
              </div>
            ) : (
              <div className="divide-y divide-[#EDF2EE]">
                {approvedReorders.map((r) => {
                  const isShared = sharedIds.includes(r.id);
                  return (
                    <div key={r.id} className="py-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold text-[#0D2818]">{r.productName}</p>
                        <p className="text-[11px] text-[#54695B] font-mono">
                          Qty: {r.approvedQty ?? r.suggestedQty} · {r.supplierName}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={isShared}
                        onClick={() => {
                          setSharedIds((prev) => [...prev, r.id]);
                          notify(
                            `Dispatched purchase request for ${r.productName} (${r.approvedQty ?? r.suggestedQty} units).`,
                            'success'
                          );
                        }}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap cursor-pointer ${
                          isShared
                            ? 'bg-[#EFF5F1] text-[#15803D]'
                            : 'bg-[#0D2818] text-white hover:bg-[#163D26]'
                        }`}
                      >
                        <Share2 className="w-3.5 h-3.5" />
                        {isShared ? 'Confirmed' : 'Confirm Dispatch'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: Privacy-Safe Aggregated Village Demand */}
      {activeTab === 'demand' && (
        <div className="bg-white border border-[#DCE6DF] rounded-xl overflow-hidden">
          <div className="p-4 border-b border-[#EDF2EE] flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-sm font-bold text-[#0D2818]">
                Opted-In Village Cluster Demand Summary
              </h3>
              <p className="text-xs text-[#54695B]">
                Helps distributors allocate stock to rural shortages while protecting individual shop privacy (zero raw bills or margins).
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActiveView('village_map')}
              className="text-xs font-semibold text-[#15803D] hover:underline cursor-pointer"
            >
              Open Interactive Demand Map &rarr;
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#E2EAE4] bg-[#F5F9F6] text-xs font-semibold text-[#4D6154]">
                  <th className="py-3 px-4">Village Cluster</th>
                  <th className="py-3 px-3">High-Demand Category</th>
                  <th className="py-3 px-3">Lead Product</th>
                  <th className="py-3 px-3 text-right">Opted-In Shops</th>
                  <th className="py-3 px-3 text-right">Aggregated Weekly Units</th>
                  <th className="py-3 px-4 text-right">Shortage Level</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EDF2EE] text-xs">
                {villageSignals.map((sig) => (
                  <tr key={sig.id}>
                    <td className="py-3 px-4">
                      <p className="font-semibold text-[#0D2818]">{sig.villageName}</p>
                      <p className="text-[11px] text-[#54695B]">
                        {sig.district} {sig.isDemoData ? '· Demo Cluster' : '· Opted-In Local Cluster'}
                      </p>
                    </td>
                    <td className="py-3 px-3 text-[#4D6154]">{sig.topCategory}</td>
                    <td className="py-3 px-3 font-medium text-[#0D2818]">{sig.topProduct}</td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums">
                      {sig.connectedShopsCount}
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-semibold text-[#0D2818] tabular-nums">
                      {sig.estimatedWeeklyUnits.toLocaleString('en-IN')}
                    </td>
                    <td className="py-3 px-4 text-right font-semibold uppercase text-[11px]">
                      <span
                        className={
                          sig.shortageSeverity === 'high'
                            ? 'text-[#B91C1C]'
                            : sig.shortageSeverity === 'moderate'
                              ? 'text-[#B45309]'
                              : 'text-[#15803D]'
                        }
                      >
                        {sig.shortageSeverity}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add Verified Distributor Offer Modal */}
      {showAddOffer && (
        <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
          <div className="bg-white border border-[#DCE6DF] rounded-2xl w-full max-w-lg p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-[#0D2818]">
                Publish Verified Distributor Offer
              </h3>
              <button
                type="button"
                onClick={() => setShowAddOffer(false)}
                className="p-1.5 text-[#54695B] hover:text-[#0D2818] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateOffer} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-[#3F5346] mb-1">Distributor Name</label>
                  <input
                    type="text"
                    value={offerForm.distributorName}
                    onChange={(e) =>
                      setOfferForm((f) => ({ ...f, distributorName: e.target.value }))
                    }
                    className="w-full px-3 py-2 border border-[#C6D5CA] rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block font-medium text-[#3F5346] mb-1">Hub City / Yard</label>
                  <input
                    type="text"
                    value={offerForm.distributorCity}
                    onChange={(e) =>
                      setOfferForm((f) => ({ ...f, distributorCity: e.target.value }))
                    }
                    className="w-full px-3 py-2 border border-[#C6D5CA] rounded-lg"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block font-medium text-[#3F5346] mb-1">Product Name</label>
                  <input
                    type="text"
                    placeholder="e.g. India Gate Basmati Rice 5kg"
                    value={offerForm.productName}
                    onChange={(e) => setOfferForm((f) => ({ ...f, productName: e.target.value }))}
                    className="w-full px-3 py-2 border border-[#C6D5CA] rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block font-medium text-[#3F5346] mb-1">Unit</label>
                  <input
                    type="text"
                    value={offerForm.unit}
                    onChange={(e) => setOfferForm((f) => ({ ...f, unit: e.target.value }))}
                    className="w-full px-3 py-2 border border-[#C6D5CA] rounded-lg"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-[#3F5346] mb-1">Category</label>
                  <input
                    type="text"
                    value={offerForm.category}
                    onChange={(e) => setOfferForm((f) => ({ ...f, category: e.target.value }))}
                    className="w-full px-3 py-2 border border-[#C6D5CA] rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block font-medium text-[#3F5346] mb-1">Standard ₹</label>
                  <input
                    type="number"
                    min={1}
                    value={offerForm.standardUnitPrice}
                    onChange={(e) =>
                      setOfferForm((f) => ({ ...f, standardUnitPrice: e.target.value }))
                    }
                    className="w-full px-3 py-2 font-mono border border-[#C6D5CA] rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block font-medium text-[#3F5346] mb-1">Bulk Tier ₹</label>
                  <input
                    type="number"
                    min={1}
                    value={offerForm.bulkUnitPrice}
                    onChange={(e) =>
                      setOfferForm((f) => ({ ...f, bulkUnitPrice: e.target.value }))
                    }
                    className="w-full px-3 py-2 font-mono border border-[#C6D5CA] rounded-lg"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className="block font-medium text-[#3F5346] mb-1">Min Bulk Qty</label>
                  <input
                    type="number"
                    min={1}
                    value={offerForm.minBulkQty}
                    onChange={(e) => setOfferForm((f) => ({ ...f, minBulkQty: e.target.value }))}
                    className="w-full px-2.5 py-2 font-mono border border-[#C6D5CA] rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block font-medium text-[#3F5346] mb-1">Avail Stock</label>
                  <input
                    type="number"
                    min={0}
                    value={offerForm.availableQty}
                    onChange={(e) => setOfferForm((f) => ({ ...f, availableQty: e.target.value }))}
                    className="w-full px-2.5 py-2 font-mono border border-[#C6D5CA] rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block font-medium text-[#3F5346] mb-1">Lead (Days)</label>
                  <input
                    type="number"
                    min={1}
                    value={offerForm.leadTimeDays}
                    onChange={(e) => setOfferForm((f) => ({ ...f, leadTimeDays: e.target.value }))}
                    className="w-full px-2.5 py-2 font-mono border border-[#C6D5CA] rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block font-medium text-[#3F5346] mb-1">Delivery ₹</label>
                  <input
                    type="number"
                    min={0}
                    value={offerForm.deliveryFeeINR}
                    onChange={(e) =>
                      setOfferForm((f) => ({ ...f, deliveryFeeINR: e.target.value }))
                    }
                    className="w-full px-2.5 py-2 font-mono border border-[#C6D5CA] rounded-lg"
                    required
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddOffer(false)}
                  className="px-4 py-2 font-medium text-[#4D6154] hover:bg-[#F2F7F3] rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 font-semibold text-white bg-[#15803D] hover:bg-[#166534] rounded-lg cursor-pointer"
                >
                  Publish Offer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export function NotificationsView() {
  const { workspace, markNotificationsRead, notify } = useShop();
  const [browserPerm, setBrowserPerm] = useState<string>(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  );

  if (!workspace) return null;

  const requestBrowserNotifications = async () => {
    if (typeof Notification === 'undefined') {
      notify('Browser notifications are not supported on this device.', 'info');
      return;
    }
    const perm = await Notification.requestPermission();
    setBrowserPerm(perm);
    if (perm === 'granted') {
      notify('Browser alerts enabled for low stock and expiry notifications.', 'success');
    } else {
      notify('Browser notification permission was not granted. In-app alerts remain active.', 'info');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-[#4D6154]">
          In-app notifications track stockouts, batch expiries, and pending reorders. SMS / WhatsApp alerts are not claimed active without an authorized gateway.
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void requestBrowserNotifications()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#0D2818] bg-white hover:bg-[#F2F7F3] border border-[#C6D5CA] rounded-lg cursor-pointer"
          >
            <Bell className="w-3.5 h-3.5 text-[#15803D]" />
            Browser Alerts: {browserPerm}
          </button>
          <button
            type="button"
            onClick={() => void markNotificationsRead()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#15803D] hover:bg-[#166534] rounded-lg cursor-pointer"
          >
            <CheckCheck className="w-3.5 h-3.5" />
            Mark All Read
          </button>
        </div>
      </div>

      <div className="bg-white border border-[#DCE6DF] rounded-xl divide-y divide-[#EDF2EE]">
        {workspace.notifications.length === 0 ? (
          <div className="p-10 text-center text-sm text-[#54695B]">All caught up — no notifications.</div>
        ) : (
          workspace.notifications.map((n) => (
            <div
              key={n.id}
              className={`p-4 flex items-start justify-between gap-4 ${
                !n.isRead ? 'bg-[#F5FBF6]' : ''
              }`}
            >
              <div>
                <div className="flex items-center gap-2 text-xs">
                  <span
                    className={`font-semibold capitalize ${
                      n.severity === 'critical'
                        ? 'text-[#B91C1C]'
                        : n.severity === 'warning'
                        ? 'text-[#B45309]'
                        : 'text-[#15803D]'
                    }`}
                  >
                    {n.severity}
                  </span>
                  <span aria-hidden="true" className="text-[#9AB0A1]">·</span>
                  <span className="font-mono text-[#54695B]">{n.createdAt.slice(0, 10)}</span>
                </div>
                <p className="mt-1 text-sm font-semibold text-[#0D2818]">{n.title}</p>
                <p className="mt-0.5 text-xs text-[#4D6154]">{n.message}</p>
              </div>
              {!n.isRead && (
                <span className="text-[11px] font-semibold text-[#15803D] whitespace-nowrap">
                  Unread
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function SettingsView() {
  const { workspace, mode, updateShop, seedSampleIntoCurrentShop, signInWithGoogle, refreshWeather } =
    useShop();
  const [name, setName] = useState(workspace?.shop.name || '');
  const [ownerName, setOwnerName] = useState(workspace?.shop.ownerName || '');
  const [phone, setPhone] = useState(workspace?.shop.phone || '');
  const [city, setCity] = useState(workspace?.shop.city || '');
  const [stateName, setStateName] = useState(workspace?.shop.state || '');
  const [pincode, setPincode] = useState(workspace?.shop.pincode || '');
  const [address, setAddress] = useState(workspace?.shop.address || '');
  const [locMsg, setLocMsg] = useState('');
  const [saving, setSaving] = useState(false);

  if (!workspace) return null;

  const handleLocate = () => {
    if (!navigator.geolocation) {
      setLocMsg('Geolocation unavailable in this browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        await updateShop({
          latitude: Number(pos.coords.latitude.toFixed(4)),
          longitude: Number(pos.coords.longitude.toFixed(4)),
        });
        setLocMsg(
          `Saved coordinates (${pos.coords.latitude.toFixed(3)}, ${pos.coords.longitude.toFixed(3)}).`
        );
      },
      () => setLocMsg('Location access denied — manual city entry continues to work.')
    );
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateShop({ name, ownerName, phone, city, state: stateName, pincode, address });
      await refreshWeather();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <form
        onSubmit={handleSave}
        className="lg:col-span-7 bg-white border border-[#DCE6DF] rounded-xl p-6 space-y-4"
      >
        <h2 className="font-display text-base font-bold text-[#0D2818]">Shop Profile &amp; Location</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-[#3F5346] mb-1">Shop Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-[#C6D5CA] rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#3F5346] mb-1">Owner Name</label>
            <input
              type="text"
              required
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-[#C6D5CA] rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#3F5346] mb-1">City</label>
            <input
              type="text"
              required
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-[#C6D5CA] rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#3F5346] mb-1">State</label>
            <input
              type="text"
              required
              value={stateName}
              onChange={(e) => setStateName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-[#C6D5CA] rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#3F5346] mb-1">Phone</label>
            <input
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-[#C6D5CA] rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#3F5346] mb-1">PIN Code</label>
            <input
              type="text"
              value={pincode}
              onChange={(e) => setPincode(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-[#C6D5CA] rounded-lg"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-[#3F5346] mb-1">Address</label>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-[#C6D5CA] rounded-lg"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <button
            type="button"
            onClick={handleLocate}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#0D2818] bg-[#F2F7F3] hover:bg-[#E4EFE7] border border-[#C6D5CA] rounded-lg cursor-pointer"
          >
            <MapPin className="w-3.5 h-3.5 text-[#15803D]" />
            Update GPS Location
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2 text-xs font-semibold text-white bg-[#15803D] hover:bg-[#166534] rounded-lg cursor-pointer disabled:opacity-60"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
        {locMsg && <p className="text-xs text-[#4D6154]">{locMsg}</p>}
      </form>

      <div className="lg:col-span-5 space-y-4">
        <div className="bg-white border border-[#DCE6DF] rounded-xl p-6 space-y-3">
          <h3 className="font-display text-base font-bold text-[#0D2818]">
            Workspace Mode &amp; Data Controls
          </h3>
          <p className="text-xs text-[#4D6154]">
            {mode === 'demo'
              ? 'You are currently exploring the interactive Sample Kirana Sandbox. Sign in with Google to save your own real shop securely to Cloud SQL PostgreSQL.'
              : 'Your shop is persisted in Cloud SQL PostgreSQL and isolated to your authenticated Google account.'}
          </p>
          {mode === 'demo' ? (
            <button
              type="button"
              onClick={() => void signInWithGoogle()}
              className="w-full py-2.5 text-xs font-semibold text-white bg-[#0D2818] hover:bg-[#163D26] rounded-lg cursor-pointer"
            >
              Sign In with Google to Save Permanently
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void seedSampleIntoCurrentShop()}
              className="w-full py-2.5 text-xs font-semibold text-[#0D2818] bg-[#F2F7F3] hover:bg-[#E4EFE7] border border-[#C6D5CA] rounded-lg cursor-pointer"
            >
              Load Clearly Labelled Sample Kirana Dataset
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function AdminPreviewView() {
  const { workspace, mode } = useShop();
  if (!workspace) return null;

  return (
    <div className="space-y-6">
      <div className="bg-white border border-[#DCE6DF] rounded-xl p-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-[#15803D]">
            Modular Role Preview · Shop Owner MVP Prioritized
          </p>
          <h2 className="mt-1 font-display text-xl font-bold text-[#0D2818]">
            Platform Admin Governance Console
          </h2>
          <p className="mt-1.5 text-sm text-[#4D6154] max-w-2xl">
            In this MVP release, single-tenant Shop Owner workflows are live end-to-end. Multi-shop user governance, global category taxonomy administration, and cross-tenant audit dashboards are staged modularly below.
          </p>
        </div>
        <Shield className="w-5 h-5 text-[#15803D] shrink-0" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-[#DCE6DF] rounded-xl p-5">
          <div className="flex items-center gap-2 text-xs text-[#54695B]">
            <Building2 className="w-4 h-4 text-[#15803D]" />
            <span>Active Workspace Scope</span>
          </div>
          <p className="mt-2 font-display text-lg font-bold text-[#0D2818]">
            {workspace.shop.name}
          </p>
          <p className="text-xs text-[#54695B] mt-1">
            {mode === 'authenticated' ? 'Persisted Shop Tenant' : 'Interactive Demo Sandbox'}
          </p>
        </div>

        <div className="bg-white border border-[#DCE6DF] rounded-xl p-5">
          <p className="text-xs text-[#54695B]">Catalog Categories Active</p>
          <p className="mt-2 font-mono text-2xl font-bold text-[#0D2818] tabular-nums">
            {new Set(workspace.products.map((p) => p.category)).size}
          </p>
          <p className="text-xs text-[#54695B] mt-1">
            Global category management — Planned
          </p>
        </div>

        <div className="bg-white border border-[#DCE6DF] rounded-xl p-5">
          <p className="text-xs text-[#54695B]">Recorded Transactions</p>
          <p className="mt-2 font-mono text-2xl font-bold text-[#0D2818] tabular-nums">
            {workspace.sales.length + workspace.purchases.length}
          </p>
          <p className="text-xs text-[#54695B] mt-1">
            Multi-shop tenant audit viewer — Planned
          </p>
        </div>
      </div>
    </div>
  );
}
