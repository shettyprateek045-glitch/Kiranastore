import React, { useMemo, useState } from 'react';
import { CheckCircle2, Plus, Truck, Wallet, X } from 'lucide-react';
import { useShop } from '../context/ShopContext.tsx';
import type { PurchaseOrder, Supplier } from '../types/dukaaniq.ts';

export function PurchasesView() {
  const { workspace, createPurchaseOrder, receivePurchase } = useShop();
  const [showCreatePo, setShowCreatePo] = useState(false);
  const [receiveTarget, setReceiveTarget] = useState<PurchaseOrder | null>(null);
  const [paidNow, setPaidNow] = useState('');

  // New PO state
  const [supplierId, setSupplierId] = useState('');
  const [notes, setNotes] = useState('');
  const [poLines, setPoLines] = useState<
    Array<{ productId: number; orderedQty: number; unitCost: number; expiryDate: string }>
  >([]);
  const [selectedProdId, setSelectedProdId] = useState('');
  const [lineQty, setLineQty] = useState('20');
  const [lineExpiry, setLineExpiry] = useState('');
  const [err, setErr] = useState('');

  const supplierMap = useMemo(
    () => new Map((workspace?.suppliers || []).map((s) => [s.id, s.name])),
    [workspace?.suppliers]
  );

  if (!workspace) return null;

  const addLine = () => {
    const pid = Number(selectedProdId);
    const prod = workspace.products.find((p) => p.id === pid);
    const qty = Math.round(Number(lineQty));
    if (!prod || qty <= 0) return;
    setPoLines((prev) => [
      ...prev,
      { productId: prod.id, orderedQty: qty, unitCost: prod.purchasePrice, expiryDate: lineExpiry },
    ]);
    setSelectedProdId('');
    setLineQty('20');
    setLineExpiry('');
  };

  const handleCreatePo = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (poLines.length === 0) return setErr('Add at least one product line to the purchase order.');
    try {
      await createPurchaseOrder({
        supplierId: supplierId ? Number(supplierId) : null,
        notes: notes.trim() || undefined,
        items: poLines.map((l) => ({
          productId: l.productId,
          orderedQty: l.orderedQty,
          unitCost: l.unitCost,
          expiryDate: l.expiryDate || undefined,
        })),
      });
      setShowCreatePo(false);
      setPoLines([]);
      setNotes('');
    } catch (error: unknown) {
      setErr(error instanceof Error ? error.message : 'Could not create purchase order.');
    }
  };

  const pendingCount = workspace.purchases.filter((p) => p.status === 'pending').length;
  const completedCount = workspace.purchases.filter((p) => p.status === 'received').length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="text-sm text-[#4D6154]">
          <span className="font-mono font-semibold text-[#0D2818]">{pendingCount}</span> pending deliveries ·{' '}
          <span className="font-mono font-semibold text-[#15803D]">{completedCount}</span> received orders
        </div>
        <button
          type="button"
          onClick={() => {
            setSupplierId(workspace.suppliers[0] ? String(workspace.suppliers[0].id) : '');
            setErr('');
            setShowCreatePo(true);
          }}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#15803D] hover:bg-[#166534] rounded-lg whitespace-nowrap cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          Create Purchase Order
        </button>
      </div>

      <div className="bg-white border border-[#DCE6DF] rounded-xl overflow-hidden">
        {workspace.purchases.length === 0 ? (
          <div className="p-10 text-center text-sm text-[#54695B]">
            No purchase orders yet. Create a PO manually or approve one from Reorder Recommendations.
          </div>
        ) : (
          <div className="divide-y divide-[#EDF2EE]">
            {workspace.purchases.map((po) => (
              <div key={po.id} className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <span className="font-mono text-sm font-bold text-[#0D2818]">{po.poNumber}</span>
                    <span aria-hidden="true" className="text-[#9AB0A1]">·</span>
                    <span className="text-xs font-medium text-[#3F5346]">
                      {po.supplierId ? supplierMap.get(po.supplierId) || 'Supplier' : 'Direct Wholesale'}
                    </span>
                    <span aria-hidden="true" className="text-[#9AB0A1]">·</span>
                    <span
                      className={`text-xs font-semibold capitalize ${
                        po.status === 'received' ? 'text-[#15803D]' : 'text-[#B45309]'
                      }`}
                    >
                      {po.status === 'received' ? `Received (${po.receivedDate})` : 'Pending Delivery'}
                    </span>
                  </div>
                  <p className="text-xs text-[#54695B]">
                    Ordered {po.orderDate} · {po.items.map((i) => `${i.productName} (×${i.orderedQty})`).join(', ')}
                  </p>
                  {po.notes && <p className="text-xs text-[#6B7F71]">{po.notes}</p>}
                </div>

                <div className="flex items-center justify-between lg:justify-end gap-5 shrink-0">
                  <div className="text-right font-mono tabular-nums">
                    <p className="text-sm font-bold text-[#0D2818]">
                      ₹{po.totalAmount.toLocaleString('en-IN')}
                    </p>
                    <p className="text-[11px] text-[#54695B]">
                      Paid: ₹{po.paidAmount.toLocaleString('en-IN')}
                    </p>
                  </div>

                  {po.status === 'pending' ? (
                    <button
                      type="button"
                      onClick={() => {
                        setReceiveTarget(po);
                        setPaidNow(String(po.totalAmount));
                      }}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#0D2818] hover:bg-[#163D26] rounded-lg whitespace-nowrap cursor-pointer"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Receive Goods &amp; Add Stock
                    </button>
                  ) : (
                    <span className="text-xs font-medium text-[#15803D] whitespace-nowrap">
                      Stock Updated
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create PO Modal */}
      {showCreatePo && (
        <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
          <div className="bg-white border border-[#DCE6DF] rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between pb-3 border-b border-[#EDF2EE]">
              <h3 className="font-display text-base font-bold text-[#0D2818]">
                Create Owner-Approved Purchase Order
              </h3>
              <button
                type="button"
                onClick={() => setShowCreatePo(false)}
                className="p-1 text-[#54695B] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreatePo} className="mt-4 space-y-4">
              {err && (
                <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                  {err}
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-[#3F5346] mb-1">Supplier</label>
                <select
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-[#C6D5CA] rounded-lg bg-white"
                >
                  <option value="">Direct Wholesale / Unassigned</option>
                  {workspace.suppliers.map((s) => (
                    <option key={s.id} value={String(s.id)}>
                      {s.name} ({s.paymentTerms})
                    </option>
                  ))}
                </select>
              </div>

              <div className="p-3.5 rounded-xl bg-[#F5F9F6] border border-[#E2EAE4] space-y-3">
                <p className="text-xs font-semibold text-[#0D2818]">Add Items to Order</p>
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                  <select
                    value={selectedProdId}
                    onChange={(e) => setSelectedProdId(e.target.value)}
                    className="sm:col-span-6 px-2.5 py-2 text-xs border border-[#C6D5CA] rounded-lg bg-white"
                  >
                    <option value="">Select product...</option>
                    {workspace.products.map((p) => (
                      <option key={p.id} value={String(p.id)}>
                        {p.name} (₹{p.purchasePrice})
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="1"
                    value={lineQty}
                    onChange={(e) => setLineQty(e.target.value)}
                    placeholder="Qty"
                    className="sm:col-span-2 px-2.5 py-2 text-xs font-mono border border-[#C6D5CA] rounded-lg bg-white"
                  />
                  <input
                    type="date"
                    value={lineExpiry}
                    onChange={(e) => setLineExpiry(e.target.value)}
                    title="Expected batch expiry"
                    className="sm:col-span-3 px-2 py-2 text-xs border border-[#C6D5CA] rounded-lg bg-white"
                  />
                  <button
                    type="button"
                    onClick={addLine}
                    className="sm:col-span-1 px-2 py-2 text-xs font-semibold text-white bg-[#15803D] rounded-lg cursor-pointer"
                  >
                    +
                  </button>
                </div>

                {poLines.length > 0 && (
                  <div className="divide-y divide-[#DCE6DF] text-xs">
                    {poLines.map((l, idx) => {
                      const prod = workspace.products.find((p) => p.id === l.productId);
                      return (
                        <div key={idx} className="py-2 flex items-center justify-between">
                          <span className="text-[#0D2818]">
                            {prod?.name} × {l.orderedQty}
                          </span>
                          <span className="font-mono tabular-nums">
                            ₹{(l.orderedQty * l.unitCost).toLocaleString('en-IN')}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-[#3F5346] mb-1">Notes</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Delivery instructions or invoice reference"
                  className="w-full px-3 py-2 text-sm border border-[#C6D5CA] rounded-lg"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreatePo(false)}
                  className="px-4 py-2 text-xs font-medium text-[#3F5346] bg-[#F2F7F3] rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-[#15803D] hover:bg-[#166534] rounded-lg cursor-pointer"
                >
                  Save Purchase Order
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Receive PO Modal */}
      {receiveTarget && (
        <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
          <div className="bg-white border border-[#DCE6DF] rounded-2xl w-full max-w-md p-6">
            <h3 className="font-display text-base font-bold text-[#0D2818]">
              Confirm Goods Received — {receiveTarget.poNumber}
            </h3>
            <p className="mt-1.5 text-xs text-[#4D6154]">
              Receiving this order automatically increases available stock and creates batch expiry records for all {receiveTarget.items.length} line items.
            </p>
            <div className="mt-4">
              <label className="block text-xs font-medium text-[#3F5346] mb-1">
                Amount Paid Today (₹) — Total ₹{receiveTarget.totalAmount.toLocaleString('en-IN')}
              </label>
              <input
                type="number"
                min="0"
                max={receiveTarget.totalAmount}
                value={paidNow}
                onChange={(e) => setPaidNow(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono border border-[#C6D5CA] rounded-lg"
              />
              <p className="mt-1 text-[11px] text-[#54695B]">
                Any remaining balance will be added to the supplier&apos;s outstanding payable ledger.
              </p>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setReceiveTarget(null)}
                className="px-4 py-2 text-xs font-medium text-[#3F5346] bg-[#F2F7F3] rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  await receivePurchase(receiveTarget.id, Number(paidNow || 0));
                  setReceiveTarget(null);
                }}
                className="px-4 py-2 text-xs font-semibold text-white bg-[#15803D] hover:bg-[#166534] rounded-lg cursor-pointer"
              >
                Confirm &amp; Update Stock
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function SuppliersView() {
  const { workspace, addSupplier, paySupplier } = useShop();
  const [showAdd, setShowAdd] = useState(false);
  const [payTarget, setPayTarget] = useState<Supplier | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [form, setForm] = useState({
    name: '',
    contactPhone: '',
    email: '',
    address: '',
    paymentTerms: 'Net 15 Days',
    leadTimeDays: '3',
    outstandingAmount: '0',
    suppliedCategories: '',
  });

  if (!workspace) return null;

  const totalOutstanding = workspace.suppliers.reduce((s, sup) => s + sup.outstandingAmount, 0);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    await addSupplier({
      name: form.name,
      contactPhone: form.contactPhone,
      email: form.email || null,
      address: form.address || null,
      paymentTerms: form.paymentTerms,
      leadTimeDays: Math.max(1, Number(form.leadTimeDays || 3)),
      outstandingAmount: Math.max(0, Number(form.outstandingAmount || 0)),
      suppliedCategories: form.suppliedCategories || null,
    });
    setShowAdd(false);
    setForm({
      name: '',
      contactPhone: '',
      email: '',
      address: '',
      paymentTerms: 'Net 15 Days',
      leadTimeDays: '3',
      outstandingAmount: '0',
      suppliedCategories: '',
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="text-sm text-[#4D6154]">
          <span className="font-mono font-semibold text-[#0D2818]">{workspace.suppliers.length}</span> active suppliers · Total payable:{' '}
          <span className="font-mono font-semibold text-[#B45309] tabular-nums">
            ₹{Math.round(totalOutstanding).toLocaleString('en-IN')}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#15803D] hover:bg-[#166534] rounded-lg whitespace-nowrap cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          Add Supplier
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {workspace.suppliers.length === 0 ? (
          <div className="md:col-span-2 bg-white border border-[#DCE6DF] rounded-xl p-10 text-center text-sm text-[#54695B]">
            No suppliers added yet. Add your local wholesalers to track lead times and payables.
          </div>
        ) : (
          workspace.suppliers.map((s) => (
            <div key={s.id} className="bg-white border border-[#DCE6DF] rounded-xl p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-display text-base font-bold text-[#0D2818]">{s.name}</h3>
                    <p className="text-xs text-[#54695B] mt-0.5">
                      {s.contactPhone} {s.email ? `· ${s.email}` : ''}
                    </p>
                  </div>
                  <Truck className="w-4 h-4 text-[#15803D] shrink-0" />
                </div>
                {s.address && <p className="mt-2 text-xs text-[#4D6154]">{s.address}</p>}
                <p className="mt-2 text-xs text-[#54695B]">
                  Categories: {s.suppliedCategories || 'General Groceries'}
                </p>
                <p className="mt-1 text-xs text-[#54695B]">
                  Terms: {s.paymentTerms} · Avg Lead Time:{' '}
                  <span className="font-mono text-[#0D2818]">{s.leadTimeDays} days</span>
                </p>
              </div>

              <div className="mt-4 pt-3 border-t border-[#EDF2EE] flex items-center justify-between">
                <div>
                  <p className="text-[11px] text-[#54695B]">Outstanding Payable</p>
                  <p
                    className={`font-mono text-base font-bold tabular-nums ${
                      s.outstandingAmount > 0 ? 'text-[#B45309]' : 'text-[#15803D]'
                    }`}
                  >
                    ₹{s.outstandingAmount.toLocaleString('en-IN')}
                  </p>
                </div>
                {s.outstandingAmount > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setPayTarget(s);
                      setPayAmount(String(s.outstandingAmount));
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#0D2818] bg-[#EFF5F1] hover:bg-[#DFECE3] rounded-lg cursor-pointer"
                  >
                    <Wallet className="w-3.5 h-3.5 text-[#15803D]" />
                    Record Payment
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
          <div className="bg-white border border-[#DCE6DF] rounded-2xl w-full max-w-lg p-6">
            <div className="flex items-center justify-between pb-3 border-b border-[#EDF2EE]">
              <h3 className="font-display text-base font-bold text-[#0D2818]">Add Supplier</h3>
              <button type="button" onClick={() => setShowAdd(false)} className="p-1 text-[#54695B] cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleAdd} className="mt-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#3F5346] mb-1">Supplier Name *</label>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-[#C6D5CA] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#3F5346] mb-1">Contact Phone *</label>
                  <input
                    type="tel"
                    required
                    value={form.contactPhone}
                    onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-[#C6D5CA] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#3F5346] mb-1">Payment Terms</label>
                  <input
                    type="text"
                    value={form.paymentTerms}
                    onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-[#C6D5CA] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#3F5346] mb-1">Lead Time (Days)</label>
                  <input
                    type="number"
                    min="1"
                    value={form.leadTimeDays}
                    onChange={(e) => setForm({ ...form, leadTimeDays: e.target.value })}
                    className="w-full px-3 py-2 text-sm font-mono border border-[#C6D5CA] rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#3F5346] mb-1">Supplied Categories</label>
                <input
                  type="text"
                  value={form.suppliedCategories}
                  onChange={(e) => setForm({ ...form, suppliedCategories: e.target.value })}
                  placeholder="e.g., Staples & Grains, Pulses, Cooking Oils"
                  className="w-full px-3 py-2 text-sm border border-[#C6D5CA] rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#3F5346] mb-1">Address</label>
                <input
                  type="text"
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
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
                  Save Supplier
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {payTarget && (
        <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
          <div className="bg-white border border-[#DCE6DF] rounded-2xl w-full max-w-sm p-6">
            <h3 className="font-display text-base font-bold text-[#0D2818]">
              Record Payment to {payTarget.name}
            </h3>
            <div className="mt-4">
              <label className="block text-xs font-medium text-[#3F5346] mb-1">
                Payment Amount (₹) — Outstanding ₹{payTarget.outstandingAmount.toLocaleString('en-IN')}
              </label>
              <input
                type="number"
                min="1"
                max={payTarget.outstandingAmount}
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono border border-[#C6D5CA] rounded-lg"
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPayTarget(null)}
                className="px-4 py-2 text-xs font-medium text-[#3F5346] bg-[#F2F7F3] rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const amt = Number(payAmount);
                  if (amt > 0) {
                    await paySupplier(payTarget.id, amt);
                    setPayTarget(null);
                  }
                }}
                className="px-4 py-2 text-xs font-semibold text-white bg-[#15803D] hover:bg-[#166534] rounded-lg cursor-pointer"
              >
                Save Payment
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
