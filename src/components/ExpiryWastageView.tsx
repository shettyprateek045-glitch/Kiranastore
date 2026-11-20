import React, { useMemo, useState } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  ArrowRightLeft,
  Check,
  CheckCircle2,
  Clock,
  Trash2,
  X,
} from 'lucide-react';
import { useShop } from '../context/ShopContext.tsx';

type ExpiryBucket = 'all' | 'expired' | '7d' | '15d' | '30d';

const NEARBY_PARTNER_PRESETS = [
  { shopName: 'Sri Chamundi Rural Mart', village: 'Nanjangud' },
  { shopName: 'Kaveri Gramin Provision Store', village: 'Hunsur' },
  { shopName: 'Annapurna Village Bazaar', village: 'T. Narasipura' },
  { shopName: 'Nandi General & Kirana', village: 'Srirangapatna' },
];

export function ExpiryWastageView() {
  const {
    mode,
    workspace,
    expirySummary,
    removeBatchAsWastage,
    proposeStockTransfer,
    decideStockTransfer,
    notify,
  } = useShop();

  const [bucket, setBucket] = useState<ExpiryBucket>('all');
  const [removeTarget, setRemoveTarget] = useState<{
    batchId: number;
    productName: string;
    batchNumber: string;
    qty: number;
    isExpired: boolean;
  } | null>(null);
  const [reason, setReason] = useState('Expired stock removed from retail shelf');

  // Inter-shop transfer proposal modal state
  const [transferTarget, setTransferTarget] = useState<{
    batchId: number;
    productId: number;
    productName: string;
    batchNumber: string;
    maxQty: number;
    suggestedQty: number;
    expiryDate: string;
    unit: string;
    unitCost: number;
  } | null>(null);
  const [partnerShopName, setPartnerShopName] = useState(NEARBY_PARTNER_PRESETS[0].shopName);
  const [partnerVillage, setPartnerVillage] = useState(NEARBY_PARTNER_PRESETS[0].village);
  const [transferQty, setTransferQty] = useState('');
  const [transferNotes, setTransferNotes] = useState('');
  const [transferErr, setTransferErr] = useState('');
  const [submittingTransfer, setSubmittingTransfer] = useState(false);

  const productMap = useMemo(
    () => new Map((workspace?.products || []).map((p) => [p.id, p])),
    [workspace?.products]
  );

  if (!workspace) return null;

  const displayedBatches =
    bucket === 'expired'
      ? expirySummary.expired
      : bucket === '7d'
      ? expirySummary.within7
      : bucket === '15d'
      ? [...expirySummary.within7, ...expirySummary.within15]
      : bucket === '30d'
      ? [...expirySummary.within7, ...expirySummary.within15, ...expirySummary.within30]
      : [
          ...expirySummary.expired,
          ...expirySummary.within7,
          ...expirySummary.within15,
          ...expirySummary.within30,
          ...expirySummary.healthy,
        ];

  const totalWastageLoss = workspace.wastageLogs.reduce((s, w) => s + w.estimatedLoss, 0);
  const transfers = workspace.stockTransfers || [];

  const handleTransferSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferTarget) return;
    setTransferErr('');
    const qtyNum = Math.round(Number(transferQty));
    if (!Number.isInteger(qtyNum) || qtyNum <= 0 || qtyNum > transferTarget.maxQty) {
      setTransferErr(`Enter a valid quantity between 1 and ${transferTarget.maxQty}.`);
      return;
    }
    if (!partnerShopName.trim() || !partnerVillage.trim()) {
      setTransferErr('Partner shop name and village are required.');
      return;
    }
    setSubmittingTransfer(true);
    try {
      await proposeStockTransfer({
        productId: transferTarget.productId,
        batchId: transferTarget.batchId,
        targetShopName: partnerShopName.trim(),
        targetVillage: partnerVillage.trim(),
        quantity: qtyNum,
        notes:
          transferNotes.trim() ||
          `FEFO excess batch ${transferTarget.batchNumber} (Exp ${transferTarget.expiryDate})`,
      });
      setTransferTarget(null);
      setTransferNotes('');
    } catch (err: unknown) {
      setTransferErr(err instanceof Error ? err.message : 'Failed to propose stock transfer.');
    } finally {
      setSubmittingTransfer(false);
    }
  };

  const handleTransferAction = async (
    transferId: number,
    action: 'approve_source' | 'approve_target' | 'reject'
  ) => {
    try {
      await decideStockTransfer(transferId, action);
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Could not update transfer status.', 'error');
    }
  };

  return (
    <div className="space-y-6">
      {/* Expiry & FEFO KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white border border-[#DCE6DF] rounded-xl p-4">
          <p className="text-xs text-[#54695B]">Already Expired</p>
          <p className="mt-1 font-mono text-2xl font-bold text-[#B91C1C] tabular-nums">
            {expirySummary.expired.length}
          </p>
          <p className="text-xs text-[#B91C1C] mt-0.5">Blocked from sale &amp; transfer</p>
        </div>

        <div className="bg-white border border-[#DCE6DF] rounded-xl p-4">
          <p className="text-xs text-[#54695B]">Expiring in &le;7 Days</p>
          <p className="mt-1 font-mono text-2xl font-bold text-[#B45309] tabular-nums">
            {expirySummary.within7.length}
          </p>
          <p className="text-xs text-[#54695B] mt-0.5">FEFO urgent clearance</p>
        </div>

        <div className="bg-white border border-[#DCE6DF] rounded-xl p-4">
          <p className="text-xs text-[#54695B]">Expiring in 8–30 Days</p>
          <p className="mt-1 font-mono text-2xl font-bold text-[#0D2818] tabular-nums">
            {expirySummary.within15.length + expirySummary.within30.length}
          </p>
          <p className="text-xs text-[#54695B] mt-0.5">Transfer / promo window</p>
        </div>

        <div className="bg-white border border-[#DCE6DF] rounded-xl p-4">
          <p className="text-xs text-[#54695B]">Projected Unsold Loss</p>
          <p className="mt-1 font-mono text-2xl font-bold text-[#B45309] tabular-nums">
            ₹{Math.round(expirySummary.totalProjectedUnsoldLoss).toLocaleString('en-IN')}
          </p>
          <p className="text-xs text-[#54695B] mt-0.5">At current daily sales pace</p>
        </div>

        <div className="bg-white border border-[#DCE6DF] rounded-xl p-4 col-span-2 lg:col-span-1">
          <p className="text-xs text-[#54695B]">Total Stock Value at Risk</p>
          <p className="mt-1 font-mono text-2xl font-bold text-[#B91C1C] tabular-nums">
            ₹{Math.round(expirySummary.totalMoneyAtRisk).toLocaleString('en-IN')}
          </p>
          <p className="text-xs text-[#54695B] mt-0.5 tabular-nums">
            Logged wastage: ₹{Math.round(totalWastageLoss).toLocaleString('en-IN')}
          </p>
        </div>
      </div>

      {/* Filter Segmented Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-[#EBF1EC] rounded-lg">
          {(
            [
              ['all', 'All Active Batches'],
              ['expired', `Already Expired (${expirySummary.expired.length})`],
              ['7d', `Within 7d (${expirySummary.within7.length})`],
              ['15d', `Within 15d (${expirySummary.within7.length + expirySummary.within15.length})`],
              [
                '30d',
                `Within 30d (${expirySummary.within7.length + expirySummary.within15.length + expirySummary.within30.length})`,
              ],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setBucket(key)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                bucket === key
                  ? 'bg-white text-[#0D2818] shadow-xs'
                  : 'text-[#4D6154] hover:text-[#0D2818]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-xs text-[#54695B]">
          FEFO Rule: Sell lowest FEFO # first. Never sell or transfer expired batches.
        </p>
      </div>

      {/* FEFO Active Batch Table */}
      <div className="bg-white border border-[#DCE6DF] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#E2EAE4] bg-[#F5F9F6] text-xs font-semibold text-[#4D6154]">
                <th className="py-3 px-4">Product, Batch &amp; FEFO</th>
                <th className="py-3 px-3 text-right">Qty</th>
                <th className="py-3 px-3">Expiry Date</th>
                <th className="py-3 px-3 text-right">Sales Pace &amp; Unsold Risk</th>
                <th className="py-3 px-3">Recommended Action</th>
                <th className="py-3 px-4 text-right">Shelf Control</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EDF2EE] text-xs">
              {displayedBatches.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-[#54695B]">
                    No active batches in this expiry window.
                  </td>
                </tr>
              ) : (
                displayedBatches.map((b) => {
                  const isExpired = b.daysLeft < 0;
                  const isUrgent = !isExpired && b.daysLeft <= 7;
                  const isSoon = !isExpired && b.daysLeft > 7 && b.daysLeft <= 15;
                  const isWatch = !isExpired && b.daysLeft > 15 && b.daysLeft <= 30;

                  const recommendation = isExpired
                    ? 'DO NOT SELL OR TRANSFER — Remove from shelf immediately and log wastage.'
                    : b.transferEligible
                    ? `Est. ${b.projectedUnsoldUnits} units unsold before expiry. Propose inter-shop transfer or offer 15% counter promo.`
                    : isUrgent
                    ? 'Offer 20% counter clearance discount & move to front checkout display.'
                    : isSoon
                    ? 'Offer 10%–15% bundle discount with fast-moving daily staples.'
                    : isWatch
                    ? 'Prioritize FEFO shelf display (place this lot in front of newer stock).'
                    : 'Healthy shelf life — normal FEFO rotation.';

                  return (
                    <tr
                      key={b.id}
                      className={isExpired ? 'bg-red-50/40' : 'hover:bg-[#F9FCF9]'}
                    >
                      <td className="py-3 px-4">
                        <p className="font-semibold text-[#0D2818]">
                          {b.product?.name || `Product #${b.productId}`}
                        </p>
                        <p className="font-mono text-[11px] text-[#54695B]">
                          Batch {b.batchNumber}
                          {!isExpired && b.fefoRank > 0 ? ` · FEFO #${b.fefoRank}` : ''}
                          {b.mfgDate ? ` · Mfg ${b.mfgDate}` : ''}
                        </p>
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-semibold text-[#0D2818] tabular-nums">
                        {b.quantity} {b.product?.unit || 'units'}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          {isExpired ? (
                            <AlertOctagon className="w-3.5 h-3.5 text-[#B91C1C]" />
                          ) : isUrgent || isSoon ? (
                            <AlertTriangle className="w-3.5 h-3.5 text-[#B45309]" />
                          ) : isWatch ? (
                            <Clock className="w-3.5 h-3.5 text-[#4D6154]" />
                          ) : (
                            <CheckCircle2 className="w-3.5 h-3.5 text-[#15803D]" />
                          )}
                          <span
                            className={`font-mono font-semibold ${
                              isExpired
                                ? 'text-[#B91C1C]'
                                : isUrgent || isSoon
                                ? 'text-[#B45309]'
                                : 'text-[#0D2818]'
                            }`}
                          >
                            {b.expiryDate}
                          </span>
                        </div>
                        <p className="text-[11px] text-[#54695B] mt-0.5">
                          {isExpired
                            ? `Expired ${Math.abs(b.daysLeft)} days ago`
                            : `${b.daysLeft} days left`}
                        </p>
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                        <p className="text-[#0D2818] font-semibold">
                          {isExpired
                            ? `₹${b.valueAtRisk.toLocaleString('en-IN')} expired`
                            : b.projectedUnsoldUnits > 0
                            ? `${b.projectedUnsoldUnits} unsold (₹${b.projectedUnsoldLossINR.toLocaleString('en-IN')})`
                            : 'Clears in time'}
                        </p>
                        <p className="text-[11px] text-[#54695B]">
                          Pace: {b.dailySalesPace.toFixed(1)}/day · Cost ₹{b.valueAtRisk.toLocaleString('en-IN')}
                        </p>
                      </td>
                      <td
                        className={`py-3 px-3 max-w-xs ${
                          isExpired ? 'text-[#B91C1C] font-semibold' : 'text-[#3F5346]'
                        }`}
                      >
                        {recommendation}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          {b.transferEligible && !isExpired && (
                            <button
                              type="button"
                              onClick={() => {
                                setTransferTarget({
                                  batchId: b.id,
                                  productId: b.productId,
                                  productName: b.product?.name || `Product #${b.productId}`,
                                  batchNumber: b.batchNumber,
                                  maxQty: b.quantity,
                                  suggestedQty: Math.min(b.quantity, Math.max(1, b.projectedUnsoldUnits)),
                                  expiryDate: b.expiryDate,
                                  unit: b.product?.unit || 'units',
                                  unitCost: b.purchasePrice,
                                });
                                setTransferQty(
                                  String(Math.min(b.quantity, Math.max(1, b.projectedUnsoldUnits)))
                                );
                                setTransferErr('');
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-[#15803D] bg-[#ECF6EF] hover:bg-[#DFF0E4] border border-[#BBD9C4] rounded-lg cursor-pointer"
                            >
                              <ArrowRightLeft className="w-3.5 h-3.5" />
                              Transfer
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setRemoveTarget({
                                batchId: b.id,
                                productName: b.product?.name || `Product #${b.productId}`,
                                batchNumber: b.batchNumber,
                                qty: b.quantity,
                                isExpired,
                              });
                              setReason(
                                isExpired
                                  ? 'Expired stock removed from sale'
                                  : 'Damaged / spoiled batch removed'
                              );
                            }}
                            className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg cursor-pointer ${
                              isExpired
                                ? 'text-white bg-[#B91C1C] hover:bg-red-800'
                                : 'text-[#3F5346] bg-[#F2F7F3] hover:bg-[#E4EFE7]'
                            }`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            {isExpired ? 'Remove Expired' : 'Wastage'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Inter-Shop Stock Transfer Opportunities (Dual-Owner Approval) */}
      <div className="bg-white border border-[#DCE6DF] rounded-xl overflow-hidden">
        <div className="p-4 border-b border-[#EDF2EE] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4 text-[#15803D]" />
              <h3 className="font-display text-sm font-bold text-[#0D2818]">
                Inter-Shop Stock Transfer Opportunities (Dual-Owner Approval)
              </h3>
            </div>
            <p className="text-xs text-[#54695B] mt-0.5">
              Prevent expiry losses by transferring non-expired excess stock to nearby village shops. Stock only deducts after BOTH shop owners explicitly approve.
            </p>
          </div>
          <span className="text-xs font-mono text-[#54695B] whitespace-nowrap">
            {transfers.length} transfer record{transfers.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#E2EAE4] bg-[#F5F9F6] font-semibold text-[#4D6154]">
                <th className="py-2.5 px-4">Product &amp; Batch</th>
                <th className="py-2.5 px-3">Partner Village Shop</th>
                <th className="py-2.5 px-3 text-right">Qty &amp; Value</th>
                <th className="py-2.5 px-3">Dual Approval Status</th>
                <th className="py-2.5 px-4 text-right">Approval Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EDF2EE]">
              {transfers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-7 text-center text-[#54695B]">
                    No inter-shop transfer proposals yet. Click &ldquo;Transfer&rdquo; on any eligible non-expired batch above to propose one.
                  </td>
                </tr>
              ) : (
                transfers.map((tr) => {
                  const isClosed = tr.status === 'completed' || tr.status === 'rejected';
                  const prodName =
                    tr.productName || productMap.get(tr.productId)?.name || `Product #${tr.productId}`;
                  return (
                    <tr key={tr.id} className="hover:bg-[#F9FCF9]">
                      <td className="py-3 px-4">
                        <p className="font-semibold text-[#0D2818]">{prodName}</p>
                        <p className="font-mono text-[11px] text-[#54695B]">
                          {tr.batchNumber ? `Batch ${tr.batchNumber} · ` : ''}Exp {tr.expiryDate}
                        </p>
                      </td>
                      <td className="py-3 px-3">
                        <p className="font-medium text-[#0D2818]">{tr.targetShopName}</p>
                        <p className="text-[11px] text-[#54695B]">{tr.targetVillage}</p>
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums">
                        <p className="font-semibold text-[#0D2818]">{tr.quantity} units</p>
                        <p className="text-[11px] text-[#15803D]">
                          Est. ₹{Math.round(tr.quantity * tr.unitCost).toLocaleString('en-IN')} saved
                        </p>
                      </td>
                      <td className="py-3 px-3">
                        <p
                          className={`font-semibold capitalize ${
                            tr.status === 'completed'
                              ? 'text-[#15803D]'
                              : tr.status === 'rejected'
                              ? 'text-[#6B7F71]'
                              : 'text-[#B45309]'
                          }`}
                        >
                          {tr.status.replace('_', ' ')}
                        </p>
                        <p className="text-[11px] text-[#54695B]">
                          Source: {tr.sourceApproved ? 'Approved' : 'Pending'} · Partner:{' '}
                          {tr.targetApproved ? 'Approved' : 'Pending'}
                        </p>
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        {isClosed ? (
                          <span className="text-[11px] text-[#6B7F71] font-mono">
                            {tr.status === 'completed' ? 'Stock Deducted' : 'Closed'}
                          </span>
                        ) : (
                          <div className="inline-flex items-center gap-1.5">
                            {!tr.sourceApproved && (
                              <button
                                type="button"
                                onClick={() => void handleTransferAction(tr.id, 'approve_source')}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-[#15803D] hover:bg-[#166534] rounded-lg cursor-pointer"
                              >
                                <Check className="w-3.5 h-3.5" />
                                Approve (Source)
                              </button>
                            )}
                            {!tr.targetApproved && (
                              <button
                                type="button"
                                onClick={() => void handleTransferAction(tr.id, 'approve_target')}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-[#0D2818] bg-[#ECF6EF] hover:bg-[#DFF0E4] border border-[#BBD9C4] rounded-lg cursor-pointer"
                              >
                                <Check className="w-3.5 h-3.5 text-[#15803D]" />
                                {mode === 'demo' ? 'Partner Confirm (Demo)' : 'Confirm Partner Approval'}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => void handleTransferAction(tr.id, 'reject')}
                              className="p-1.5 text-[#54695B] hover:text-[#B91C1C] hover:bg-red-50 rounded-md cursor-pointer"
                              title="Reject transfer"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recorded Wastage History */}
      <div className="bg-white border border-[#DCE6DF] rounded-xl overflow-hidden">
        <div className="p-4 border-b border-[#EDF2EE]">
          <h3 className="font-display text-sm font-bold text-[#0D2818]">
            Wastage &amp; Expired Removal Log
          </h3>
          <p className="text-xs text-[#54695B]">
            Tracks every expired or damaged batch written off so expiry losses remain transparent
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#E2EAE4] bg-[#F5F9F6] text-xs font-semibold text-[#4D6154]">
                <th className="py-2.5 px-4">Date</th>
                <th className="py-2.5 px-3">Product</th>
                <th className="py-2.5 px-3 text-right">Qty Removed</th>
                <th className="py-2.5 px-3 text-right">Cost Loss (₹)</th>
                <th className="py-2.5 px-4">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EDF2EE] text-xs">
              {workspace.wastageLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-[#54695B]">
                    No wastage losses logged yet.
                  </td>
                </tr>
              ) : (
                workspace.wastageLogs.map((w) => (
                  <tr key={w.id}>
                    <td className="py-2.5 px-4 font-mono text-[#54695B]">{w.loggedDate}</td>
                    <td className="py-2.5 px-3 font-medium text-[#0D2818]">
                      {productMap.get(w.productId)?.name || `Product #${w.productId}`}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">{w.quantity}</td>
                    <td className="py-2.5 px-3 text-right font-mono font-semibold text-[#B91C1C] tabular-nums">
                      ₹{w.estimatedLoss.toLocaleString('en-IN')}
                    </td>
                    <td className="py-2.5 px-4 text-[#4D6154]">{w.reason}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Propose Inter-Shop Stock Transfer Modal */}
      {transferTarget && (
        <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
          <div className="bg-white border border-[#DCE6DF] rounded-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between pb-3 border-b border-[#EDF2EE]">
              <h3 className="font-display text-base font-bold text-[#0D2818]">
                Propose Inter-Shop FEFO Transfer
              </h3>
              <button
                type="button"
                onClick={() => setTransferTarget(null)}
                className="p-1 text-[#54695B] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleTransferSubmit} className="mt-4 space-y-3.5">
              {transferErr && (
                <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                  {transferErr}
                </div>
              )}
              <div className="p-3 rounded-lg bg-[#F5F9F6] border border-[#E2EAE4] text-xs space-y-0.5">
                <p className="font-semibold text-[#0D2818]">{transferTarget.productName}</p>
                <p className="font-mono text-[#54695B]">
                  Batch {transferTarget.batchNumber} · Exp {transferTarget.expiryDate} · Max {transferTarget.maxQty} {transferTarget.unit}
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#3F5346] mb-1">
                  Quick Select Nearby Village Shop (Demo Directory)
                </label>
                <select
                  value={`${partnerShopName}|${partnerVillage}`}
                  onChange={(e) => {
                    const [sName, vName] = e.target.value.split('|');
                    setPartnerShopName(sName);
                    setPartnerVillage(vName);
                  }}
                  className="w-full px-3 py-2 text-xs border border-[#C6D5CA] rounded-lg bg-white"
                >
                  {NEARBY_PARTNER_PRESETS.map((p) => (
                    <option key={p.shopName} value={`${p.shopName}|${p.village}`}>
                      {p.shopName} ({p.village})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#3F5346] mb-1">
                    Partner Shop Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={partnerShopName}
                    onChange={(e) => setPartnerShopName(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-[#C6D5CA] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#3F5346] mb-1">Village *</label>
                  <input
                    type="text"
                    required
                    value={partnerVillage}
                    onChange={(e) => setPartnerVillage(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-[#C6D5CA] rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#3F5346] mb-1">
                  Transfer Quantity ({transferTarget.unit}) * — Suggested: {transferTarget.suggestedQty}
                </label>
                <input
                  type="number"
                  min="1"
                  max={transferTarget.maxQty}
                  required
                  value={transferQty}
                  onChange={(e) => setTransferQty(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-[#C6D5CA] rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#3F5346] mb-1">Notes</label>
                <input
                  type="text"
                  value={transferNotes}
                  onChange={(e) => setTransferNotes(e.target.value)}
                  placeholder="Optional transfer note for partner shopkeeper"
                  className="w-full px-3 py-2 text-xs border border-[#C6D5CA] rounded-lg"
                />
              </div>
              <p className="text-[11px] text-[#54695B]">
                Your approval is recorded on proposal. Stock is deducted only after the partner shopkeeper also approves.
              </p>
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setTransferTarget(null)}
                  className="px-3.5 py-2 text-xs font-medium text-[#3F5346] bg-[#F2F7F3] rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingTransfer}
                  className="px-4 py-2 text-xs font-semibold text-white bg-[#15803D] hover:bg-[#166534] rounded-lg cursor-pointer disabled:opacity-60"
                >
                  {submittingTransfer ? 'Sending...' : 'Send Transfer Proposal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirm Removal Modal */}
      {removeTarget && (
        <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
          <div className="bg-white border border-[#DCE6DF] rounded-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between pb-3 border-b border-[#EDF2EE]">
              <h3 className="font-display text-base font-bold text-[#0D2818]">
                Remove Batch {removeTarget.batchNumber}
              </h3>
              <button
                type="button"
                onClick={() => setRemoveTarget(null)}
                className="p-1 text-[#54695B] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="mt-3 text-xs text-[#4D6154]">
              Removing <span className="font-semibold text-[#0D2818]">{removeTarget.qty} units</span> of{' '}
              <span className="font-semibold text-[#0D2818]">{removeTarget.productName}</span> will deduct them from available stock and record the cost loss in your wastage report.
            </p>
            <div className="mt-4">
              <label className="block text-xs font-medium text-[#3F5346] mb-1">
                Wastage Reason *
              </label>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-[#C6D5CA] rounded-lg"
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRemoveTarget(null)}
                className="px-4 py-2 text-xs font-medium text-[#3F5346] bg-[#F2F7F3] rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  await removeBatchAsWastage(removeTarget.batchId, reason);
                  setRemoveTarget(null);
                }}
                className="px-4 py-2 text-xs font-semibold text-white bg-[#B91C1C] hover:bg-red-800 rounded-lg cursor-pointer"
              >
                Confirm Removal &amp; Log Loss
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
