import React, { useDeferredValue, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Download,
  Edit2,
  FileScan,
  History,
  Plus,
  ScanBarcode,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useShop } from '../context/ShopContext.tsx';
import type { InvoiceOcrItem, InvoiceOcrResult, Product } from '../types/dukaaniq.ts';

const CATEGORIES = [
  'Staples & Grains',
  'Cooking Oils',
  'Pulses',
  'Biscuits & Snacks',
  'Beverages',
  'Dairy & Bakery',
  'Spices & Masala',
  'Home Care',
  'Personal Care',
  'Dry Fruits',
  'Other',
];

export function InventoryView() {
  const {
    workspace,
    addProduct,
    updateProduct,
    deleteProduct,
    importProductsCsv,
    adjustStock,
    notify,
  } = useShop();

  const [subTab, setSubTab] = useState<'catalog' | 'movements'>('catalog');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [supplierFilter, setSupplierFilter] = useState('All');
  const [sortBy, setSortBy] = useState<'name' | 'stock_asc' | 'price_desc' | 'expiry_asc'>('name');

  const [showProductModal, setShowProductModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<Product | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [showBarcodeModal, setShowBarcodeModal] = useState(false);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [scannerMsg, setScannerMsg] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const ocrInputRef = useRef<HTMLInputElement | null>(null);

  // Invoice OCR state
  const [showOcrModal, setShowOcrModal] = useState(false);
  const [ocrPreviewUrl, setOcrPreviewUrl] = useState<string | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrError, setOcrError] = useState('');
  const [ocrMeta, setOcrMeta] = useState<{
    vendorName: string;
    invoiceNumber: string;
    invoiceDate: string;
    notes: string;
  } | null>(null);
  const [ocrItems, setOcrItems] = useState<InvoiceOcrItem[]>([]);
  const [ocrImporting, setOcrImporting] = useState(false);

  // Product Form state
  const [form, setForm] = useState({
    name: '',
    sku: '',
    barcode: '',
    category: 'Staples & Grains',
    brand: '',
    unit: 'pack',
    purchasePrice: '',
    sellingPrice: '',
    currentStock: '',
    minStockLevel: '10',
    maxStockLevel: '60',
    supplierId: '',
    leadTimeDays: '3',
    mfgDate: '',
    expiryDate: '',
    batchNumber: '',
  });
  const [formErr, setFormErr] = useState('');
  const [saving, setSaving] = useState(false);

  // Stock adjustment state
  const [adjDelta, setAdjDelta] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const [adjAllowNeg, setAdjAllowNeg] = useState(false);
  const [adjErr, setAdjErr] = useState('');

  const supplierMap = useMemo(
    () => new Map((workspace?.suppliers || []).map((s) => [s.id, s.name])),
    [workspace?.suppliers]
  );

  const productMap = useMemo(
    () => new Map((workspace?.products || []).map((p) => [p.id, p])),
    [workspace?.products]
  );

  const filteredProducts = useMemo(() => {
    if (!workspace) return [];
    const q = deferredSearch.trim().toLowerCase();
    const list = workspace.products.filter((p) => {
      if (categoryFilter !== 'All' && p.category !== categoryFilter) return false;
      if (supplierFilter !== 'All' && String(p.supplierId || '') !== supplierFilter) return false;
      if (q) {
        const hay = `${p.name} ${p.sku} ${p.barcode || ''} ${p.brand || ''} ${p.category}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    return [...list].sort((a, b) => {
      if (sortBy === 'stock_asc') return a.currentStock - b.currentStock;
      if (sortBy === 'price_desc') return b.sellingPrice - a.sellingPrice;
      if (sortBy === 'expiry_asc') {
        const ea = a.expiryDate || '9999-12-31';
        const eb = b.expiryDate || '9999-12-31';
        return ea.localeCompare(eb);
      }
      return a.name.localeCompare(b.name);
    });
  }, [workspace, deferredSearch, categoryFilter, supplierFilter, sortBy]);

  if (!workspace) return null;

  const openAddModal = () => {
    setEditingProduct(null);
    setForm({
      name: '',
      sku: '',
      barcode: '',
      category: 'Staples & Grains',
      brand: '',
      unit: 'pack',
      purchasePrice: '',
      sellingPrice: '',
      currentStock: '20',
      minStockLevel: '10',
      maxStockLevel: '60',
      supplierId: workspace.suppliers[0] ? String(workspace.suppliers[0].id) : '',
      leadTimeDays: '3',
      mfgDate: '',
      expiryDate: '',
      batchNumber: '',
    });
    setFormErr('');
    setShowProductModal(true);
  };

  const openEditModal = (p: Product) => {
    setEditingProduct(p);
    setForm({
      name: p.name,
      sku: p.sku,
      barcode: p.barcode || '',
      category: p.category,
      brand: p.brand || '',
      unit: p.unit,
      purchasePrice: String(p.purchasePrice),
      sellingPrice: String(p.sellingPrice),
      currentStock: String(p.currentStock),
      minStockLevel: String(p.minStockLevel),
      maxStockLevel: String(p.maxStockLevel),
      supplierId: p.supplierId ? String(p.supplierId) : '',
      leadTimeDays: String(p.leadTimeDays),
      mfgDate: p.mfgDate || '',
      expiryDate: p.expiryDate || '',
      batchNumber: '',
    });
    setFormErr('');
    setShowProductModal(true);
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormErr('');
    const pPrice = Number(form.purchasePrice);
    const sPrice = Number(form.sellingPrice);
    const stock = Math.round(Number(form.currentStock || 0));
    const minL = Math.round(Number(form.minStockLevel || 0));
    const maxL = Math.round(Number(form.maxStockLevel || 0));

    if (!form.name.trim()) return setFormErr('Product name is required.');
    if (Number.isNaN(pPrice) || pPrice < 0 || Number.isNaN(sPrice) || sPrice <= 0) {
      return setFormErr('Please enter valid purchase and selling prices.');
    }
    if (stock < 0 || minL < 0 || maxL <= 0 || maxL < minL) {
      return setFormErr('Check stock levels: stock cannot be negative and max must exceed min.');
    }

    setSaving(true);
    try {
      if (editingProduct) {
        await updateProduct(editingProduct.id, {
          name: form.name.trim(),
          sku: form.sku.trim() || editingProduct.sku,
          barcode: form.barcode.trim() || null,
          category: form.category,
          brand: form.brand.trim() || null,
          unit: form.unit.trim() || 'pcs',
          purchasePrice: pPrice,
          sellingPrice: sPrice,
          minStockLevel: minL,
          maxStockLevel: maxL,
          supplierId: form.supplierId ? Number(form.supplierId) : null,
          leadTimeDays: Math.max(1, Number(form.leadTimeDays || 3)),
          mfgDate: form.mfgDate || null,
          expiryDate: form.expiryDate || null,
        });
      } else {
        await addProduct({
          name: form.name.trim(),
          sku: form.sku.trim() || `SKU-${Date.now().toString().slice(-5)}`,
          barcode: form.barcode.trim() || null,
          category: form.category,
          brand: form.brand.trim() || null,
          unit: form.unit.trim() || 'pcs',
          purchasePrice: pPrice,
          sellingPrice: sPrice,
          currentStock: stock,
          minStockLevel: minL,
          maxStockLevel: maxL,
          supplierId: form.supplierId ? Number(form.supplierId) : null,
          leadTimeDays: Math.max(1, Number(form.leadTimeDays || 3)),
          mfgDate: form.mfgDate || null,
          expiryDate: form.expiryDate || null,
          batchNumber: form.batchNumber.trim() || undefined,
        });
      }
      setShowProductModal(false);
    } catch (err: unknown) {
      setFormErr(err instanceof Error ? err.message : 'Failed to save product.');
    } finally {
      setSaving(false);
    }
  };

  const handleAdjustSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustTarget) return;
    setAdjErr('');
    const delta = Number(adjDelta);
    if (!Number.isInteger(delta) || delta === 0) {
      return setAdjErr('Enter a non-zero whole number (e.g., +10 or -3).');
    }
    if (!adjReason.trim()) {
      return setAdjErr('Please enter a reason for the stock adjustment.');
    }
    try {
      await adjustStock(adjustTarget.id, delta, adjReason.trim(), adjAllowNeg);
      setAdjustTarget(null);
      setAdjDelta('');
      setAdjReason('');
      setAdjAllowNeg(false);
    } catch (err: unknown) {
      setAdjErr(err instanceof Error ? err.message : 'Stock adjustment failed.');
    }
  };

  const handleExportCsv = () => {
    const headers = [
      'Name',
      'SKU',
      'Barcode',
      'Category',
      'Brand',
      'Unit',
      'PurchasePrice',
      'SellingPrice',
      'CurrentStock',
      'MinStock',
      'MaxStock',
      'ExpiryDate',
    ];
    const rows = workspace.products.map((p) =>
      [
        `"${p.name.replace(/"/g, '""')}"`,
        p.sku,
        p.barcode || '',
        `"${p.category}"`,
        `"${p.brand || ''}"`,
        p.unit,
        p.purchasePrice,
        p.sellingPrice,
        p.currentStock,
        p.minStockLevel,
        p.maxStockLevel,
        p.expiryDate || '',
      ].join(',')
    );
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dukaaniq-inventory-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    notify('Exported inventory CSV file.', 'success');
  };

  const handleCsvFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length < 2) {
        notify('CSV file must include a header row and at least one product row.', 'error');
        return;
      }
      const headerCols = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/"/g, ''));
      const parsed: Array<Partial<Product>> = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
        const get = (keys: string[]) => {
          const idx = headerCols.findIndex((h) => keys.includes(h));
          return idx >= 0 ? cols[idx] : '';
        };
        const name = get(['name', 'product', 'product_name', 'product name']);
        if (!name) continue;
        parsed.push({
          name,
          sku: get(['sku', 'code']) || `CSV-${i}`,
          barcode: get(['barcode', 'ean']) || undefined,
          category: get(['category']) || 'Other',
          brand: get(['brand']) || undefined,
          unit: get(['unit']) || 'pcs',
          purchasePrice: Number(get(['purchaseprice', 'purchase_price', 'cost']) || 0),
          sellingPrice: Number(get(['sellingprice', 'selling_price', 'mrp', 'price']) || 10),
          currentStock: Number(get(['currentstock', 'stock', 'qty', 'quantity']) || 0),
          minStockLevel: Number(get(['minstock', 'min_stock', 'min']) || 10),
          maxStockLevel: Number(get(['maxstock', 'max_stock', 'max']) || 60),
          expiryDate: get(['expirydate', 'expiry_date', 'expiry']) || undefined,
        });
      }
      if (parsed.length === 0) {
        notify('No valid rows found in CSV. Ensure columns include Name, Category, PurchasePrice, SellingPrice.', 'error');
        return;
      }
      await importProductsCsv(parsed);
    } catch {
      notify('Could not parse CSV file. Please check file formatting.', 'error');
    } finally {
      e.target.value = '';
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  const startBarcodeScanner = async () => {
    setScannerMsg('Requesting camera permission...');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      const win = window as unknown as {
        BarcodeDetector?: new (opts?: { formats: string[] }) => {
          detect: (src: HTMLVideoElement) => Promise<Array<{ rawValue: string }>>;
        };
      };
      if (win.BarcodeDetector) {
        setScannerMsg('Point camera at product barcode...');
        const detector = new win.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'code_128', 'upc_a'] });
        const scanTick = async () => {
          if (!streamRef.current || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes.length > 0) {
              const found = codes[0].rawValue;
              setBarcodeInput(found);
              setSearch(found);
              stopCamera();
              setShowBarcodeModal(false);
              notify(`Barcode detected: ${found}`, 'success');
              return;
            }
          } catch {
            // Keep scanning
          }
          window.setTimeout(scanTick, 400);
        };
        void scanTick();
      } else {
        setScannerMsg(
          'Camera preview active, but native browser BarcodeDetector is unsupported here. Enter or scan with a USB barcode reader below.'
        );
      }
    } catch {
      setScannerMsg(
        'Camera permission denied or unavailable. Enter a barcode manually or use a USB barcode scanner below.'
      );
    }
  };

  const handleOcrFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setOcrError('Please upload a JPG, PNG, or WebP photo of your wholesale invoice.');
      return;
    }
    if (file.size > 7 * 1024 * 1024) {
      setOcrError('Image is larger than 7 MB. Please upload a smaller or cropped photo.');
      return;
    }
    setOcrError('');
    setOcrLoading(true);
    setOcrItems([]);
    setOcrMeta(null);

    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Could not read image file.'));
        reader.readAsDataURL(file);
      });
      setOcrPreviewUrl(dataUrl);

      const resp = await fetch('/api/ai/invoice-ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: dataUrl, mimeType: file.type }),
      });
      const data = (await resp.json()) as InvoiceOcrResult & { error?: string };
      if (!resp.ok) {
        throw new Error(data.error || 'Could not extract items from invoice image.');
      }
      setOcrMeta({
        vendorName: data.vendorName || '',
        invoiceNumber: data.invoiceNumber || '',
        invoiceDate: data.invoiceDate || '',
        notes: data.notes || '',
      });
      setOcrItems(Array.isArray(data.items) ? data.items : []);
      if (!data.items || data.items.length === 0) {
        setOcrError(
          'No clear line items were readable from this image. Try a sharper photo or add rows manually below.'
        );
      }
    } catch (err: unknown) {
      setOcrError(err instanceof Error ? err.message : 'Invoice OCR extraction failed.');
    } finally {
      setOcrLoading(false);
      e.target.value = '';
    }
  };

  const handleImportOcrItems = async () => {
    const validRows = ocrItems.filter((it) => it.name.trim().length > 0);
    if (validRows.length === 0) {
      setOcrError('Add or verify at least one product row before importing.');
      return;
    }
    setOcrImporting(true);
    try {
      const mapped: Array<Partial<Product>> = validRows.map((it, idx) => ({
        name: it.name.trim(),
        sku: `OCR-${Date.now().toString().slice(-4)}-${idx + 1}`,
        category: it.category || 'Other',
        brand: it.brand || undefined,
        unit: it.unit || 'pcs',
        purchasePrice: Math.max(0, Number(it.purchasePrice || 0)),
        sellingPrice: Math.max(1, Number(it.sellingPrice || Math.round((it.purchasePrice || 10) * 1.15))),
        currentStock: Math.max(0, Math.round(Number(it.quantity || 1))),
        minStockLevel: 8,
        maxStockLevel: Math.max(30, Math.round(Number(it.quantity || 1) * 3)),
        expiryDate: it.expiryDate || undefined,
      }));
      const count = await importProductsCsv(mapped);
      notify(`Imported ${count} verified items from wholesale invoice.`, 'success');
      setShowOcrModal(false);
      setOcrItems([]);
      setOcrPreviewUrl(null);
      setOcrMeta(null);
    } catch (err: unknown) {
      setOcrError(err instanceof Error ? err.message : 'Failed to import verified invoice items.');
    } finally {
      setOcrImporting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header Controls & Tabs */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="inline-flex items-center gap-1 p-1 bg-[#EBF1EC] rounded-lg self-start">
          <button
            type="button"
            onClick={() => setSubTab('catalog')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              subTab === 'catalog'
                ? 'bg-white text-[#0D2818] shadow-xs'
                : 'text-[#4D6154] hover:text-[#0D2818]'
            }`}
          >
            Product Catalog ({workspace.products.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('movements')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              subTab === 'movements'
                ? 'bg-white text-[#0D2818] shadow-xs'
                : 'text-[#4D6154] hover:text-[#0D2818]'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            Stock Movement Ledger ({workspace.stockMovements.length})
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setShowOcrModal(true);
              setOcrError('');
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#0D2818] bg-[#ECF6EF] hover:bg-[#DFF0E4] border border-[#BBD9C4] rounded-lg whitespace-nowrap cursor-pointer"
          >
            <FileScan className="w-3.5 h-3.5 text-[#15803D]" />
            Scan Invoice (OCR)
          </button>
          <button
            type="button"
            onClick={() => {
              setShowBarcodeModal(true);
              setScannerMsg('');
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#0D2818] bg-white hover:bg-[#F2F7F3] border border-[#C6D5CA] rounded-lg whitespace-nowrap cursor-pointer"
          >
            <ScanBarcode className="w-3.5 h-3.5 text-[#15803D]" />
            Barcode Scan
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleCsvFileChange}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#0D2818] bg-white hover:bg-[#F2F7F3] border border-[#C6D5CA] rounded-lg whitespace-nowrap cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5 text-[#15803D]" />
            Import CSV
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#0D2818] bg-white hover:bg-[#F2F7F3] border border-[#C6D5CA] rounded-lg whitespace-nowrap cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-[#15803D]" />
            Export CSV
          </button>
          <button
            type="button"
            onClick={openAddModal}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#15803D] hover:bg-[#166534] rounded-lg whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Add Product
          </button>
        </div>
      </div>

      {subTab === 'catalog' ? (
        <>
          {/* Filter Bar */}
          <div className="bg-white border border-[#DCE6DF] rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3">
            <div className="lg:col-span-5 relative">
              <Search className="w-4 h-4 text-[#6B7F71] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by product name, SKU, brand, or barcode..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-[#C6D5CA] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#15803D]/25 focus:border-[#15803D]"
              />
            </div>

            <div className="lg:col-span-3">
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                aria-label="Filter by category"
                className="w-full px-3 py-2 text-sm border border-[#C6D5CA] rounded-lg bg-white"
              >
                <option value="All">All Categories</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className="lg:col-span-2">
              <select
                value={supplierFilter}
                onChange={(e) => setSupplierFilter(e.target.value)}
                aria-label="Filter by supplier"
                className="w-full px-3 py-2 text-sm border border-[#C6D5CA] rounded-lg bg-white"
              >
                <option value="All">All Suppliers</option>
                {workspace.suppliers.map((s) => (
                  <option key={s.id} value={String(s.id)}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="lg:col-span-2">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                aria-label="Sort products"
                className="w-full px-3 py-2 text-sm border border-[#C6D5CA] rounded-lg bg-white"
              >
                <option value="name">Sort: Name (A-Z)</option>
                <option value="stock_asc">Sort: Lowest Stock</option>
                <option value="price_desc">Sort: Highest Price</option>
                <option value="expiry_asc">Sort: Earliest Expiry</option>
              </select>
            </div>
          </div>

          {/* Products Table */}
          <div className="bg-white border border-[#DCE6DF] rounded-xl overflow-hidden">
            {filteredProducts.length === 0 ? (
              <div className="p-10 text-center">
                <p className="font-display text-base font-semibold text-[#0D2818]">
                  No products match your current filter
                </p>
                <p className="mt-1 text-sm text-[#54695B]">
                  Add a new Kirana item or clear the search filters to see your full stock catalog.
                </p>
                <button
                  type="button"
                  onClick={openAddModal}
                  className="mt-4 px-4 py-2 text-xs font-semibold text-white bg-[#15803D] hover:bg-[#166534] rounded-lg cursor-pointer"
                >
                  Add First Product
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#E2EAE4] bg-[#F5F9F6] text-xs font-semibold text-[#4D6154]">
                      <th className="py-3 px-4">Product &amp; SKU</th>
                      <th className="py-3 px-3">Category / Supplier</th>
                      <th className="py-3 px-3 text-right">Buy / Sell (₹)</th>
                      <th className="py-3 px-3 text-right">Stock</th>
                      <th className="py-3 px-3">Status</th>
                      <th className="py-3 px-3">Nearest Expiry</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EDF2EE] text-sm">
                    {filteredProducts.map((p) => {
                      const marginPct =
                        p.sellingPrice > 0
                          ? (((p.sellingPrice - p.purchasePrice) / p.sellingPrice) * 100).toFixed(1)
                          : '0.0';
                      const stockStatus =
                        p.currentStock <= 0
                          ? { label: 'Out of Stock', cls: 'text-[#B91C1C] font-semibold' }
                          : p.currentStock <= p.minStockLevel
                          ? { label: 'Low Stock', cls: 'text-[#B45309] font-semibold' }
                          : { label: 'Healthy', cls: 'text-[#15803D] font-medium' };

                      return (
                        <tr key={p.id} className="hover:bg-[#F9FCF9] transition-colors">
                          <td className="py-3 px-4">
                            <p className="font-semibold text-[#0D2818]">{p.name}</p>
                            <p className="text-xs text-[#54695B] font-mono">
                              {p.sku}
                              {p.barcode ? ` · ${p.barcode}` : ''}
                              {p.brand ? ` · ${p.brand}` : ''}
                            </p>
                          </td>
                          <td className="py-3 px-3">
                            <p className="text-xs font-medium text-[#111D15]">{p.category}</p>
                            <p className="text-xs text-[#54695B]">
                              {p.supplierId ? supplierMap.get(p.supplierId) || 'Unassigned' : 'Unassigned'}
                            </p>
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums">
                            <p className="text-xs text-[#0D2818] font-semibold">
                              ₹{p.purchasePrice} / ₹{p.sellingPrice}
                            </p>
                            <p className="text-[11px] text-[#54695B]">{marginPct}% margin</p>
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums">
                            <p className="font-semibold text-[#0D2818]">
                              {p.currentStock} {p.unit}
                            </p>
                            <p className="text-[11px] text-[#54695B]">
                              Min {p.minStockLevel} / Max {p.maxStockLevel}
                            </p>
                          </td>
                          <td className={`py-3 px-3 text-xs whitespace-nowrap ${stockStatus.cls}`}>
                            {stockStatus.label}
                          </td>
                          <td className="py-3 px-3 text-xs font-mono text-[#4D6154] whitespace-nowrap">
                            {p.expiryDate || '—'}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setAdjustTarget(p);
                                  setAdjDelta('');
                                  setAdjReason('');
                                  setAdjErr('');
                                }}
                                title="Adjust Stock"
                                className="p-1.5 text-[#3F5346] hover:text-[#15803D] hover:bg-[#EFF5F1] rounded-md cursor-pointer"
                              >
                                <SlidersHorizontal className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => openEditModal(p)}
                                title="Edit Product"
                                className="p-1.5 text-[#3F5346] hover:text-[#0D2818] hover:bg-[#EFF5F1] rounded-md cursor-pointer"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteTarget(p)}
                                title="Delete Product"
                                className="p-1.5 text-[#3F5346] hover:text-[#B91C1C] hover:bg-red-50 rounded-md cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : (
        /* Stock Movement History Table */
        <div className="bg-white border border-[#DCE6DF] rounded-xl overflow-hidden">
          <div className="p-4 border-b border-[#EDF2EE]">
            <h3 className="font-display text-sm font-bold text-[#0D2818]">
              Full Stock Movement History
            </h3>
            <p className="text-xs text-[#54695B]">
              Every counter sale, received purchase order, wastage write-off, and manual adjustment
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#E2EAE4] bg-[#F5F9F6] text-xs font-semibold text-[#4D6154]">
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-3">Product</th>
                  <th className="py-3 px-3">Type</th>
                  <th className="py-3 px-3 text-right">Qty Change</th>
                  <th className="py-3 px-3 text-right">Balance After</th>
                  <th className="py-3 px-4">Reason / Ref</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EDF2EE] text-xs">
                {workspace.stockMovements.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-[#54695B]">
                      No stock movements recorded yet.
                    </td>
                  </tr>
                ) : (
                  workspace.stockMovements.map((m) => (
                    <tr key={m.id} className="hover:bg-[#F9FCF9]">
                      <td className="py-2.5 px-4 font-mono text-[#54695B] whitespace-nowrap">
                        {m.createdAt.slice(0, 10)}
                      </td>
                      <td className="py-2.5 px-3 font-medium text-[#0D2818]">
                        {productMap.get(m.productId)?.name || `Product #${m.productId}`}
                      </td>
                      <td className="py-2.5 px-3 capitalize text-[#3F5346]">{m.movementType}</td>
                      <td
                        className={`py-2.5 px-3 text-right font-mono font-semibold tabular-nums ${
                          m.quantityChange >= 0 ? 'text-[#15803D]' : 'text-[#B91C1C]'
                        }`}
                      >
                        {m.quantityChange >= 0 ? `+${m.quantityChange}` : m.quantityChange}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-[#0D2818] tabular-nums">
                        {m.balanceAfter}
                      </td>
                      <td className="py-2.5 px-4 text-[#4D6154]">
                        {m.reason || '—'} {m.referenceId ? `(${m.referenceId})` : ''}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add / Edit Product Modal */}
      {showProductModal && (
        <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
          <div className="bg-white border border-[#DCE6DF] rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between pb-4 border-b border-[#EDF2EE]">
              <h3 className="font-display text-lg font-bold text-[#0D2818]">
                {editingProduct ? 'Edit Product' : 'Add New Product'}
              </h3>
              <button
                type="button"
                onClick={() => setShowProductModal(false)}
                className="p-1.5 text-[#54695B] hover:text-[#0D2818] rounded-md cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveProduct} className="mt-4 space-y-4">
              {formErr && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                  {formErr}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-[#3F5346] mb-1">Product Name *</label>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g., Tata Sampann Toor Dal 1kg"
                    className="w-full px-3 py-2 text-sm border border-[#C6D5CA] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#3F5346] mb-1">SKU</label>
                  <input
                    type="text"
                    value={form.sku}
                    onChange={(e) => setForm({ ...form, sku: e.target.value })}
                    placeholder="Auto-generated if blank"
                    className="w-full px-3 py-2 text-sm border border-[#C6D5CA] rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#3F5346] mb-1">Barcode / EAN</label>
                  <input
                    type="text"
                    value={form.barcode}
                    onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                    placeholder="8901..."
                    className="w-full px-3 py-2 text-sm border border-[#C6D5CA] rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#3F5346] mb-1">Category *</label>
                  <select
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-[#C6D5CA] rounded-lg bg-white"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#3F5346] mb-1">Brand</label>
                  <input
                    type="text"
                    value={form.brand}
                    onChange={(e) => setForm({ ...form, brand: e.target.value })}
                    placeholder="e.g., Tata, Fortune, Parle"
                    className="w-full px-3 py-2 text-sm border border-[#C6D5CA] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#3F5346] mb-1">Unit *</label>
                  <input
                    type="text"
                    required
                    value={form.unit}
                    onChange={(e) => setForm({ ...form, unit: e.target.value })}
                    placeholder="pack / kg / bag / bottle"
                    className="w-full px-3 py-2 text-sm border border-[#C6D5CA] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#3F5346] mb-1">Preferred Supplier</label>
                  <select
                    value={form.supplierId}
                    onChange={(e) => setForm({ ...form, supplierId: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-[#C6D5CA] rounded-lg bg-white"
                  >
                    <option value="">Unassigned</option>
                    {workspace.suppliers.map((s) => (
                      <option key={s.id} value={String(s.id)}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#3F5346] mb-1">Purchase Price (₹) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={form.purchasePrice}
                    onChange={(e) => setForm({ ...form, purchasePrice: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-[#C6D5CA] rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#3F5346] mb-1">Selling Price (₹) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.5"
                    required
                    value={form.sellingPrice}
                    onChange={(e) => setForm({ ...form, sellingPrice: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-[#C6D5CA] rounded-lg font-mono"
                  />
                </div>
                {!editingProduct && (
                  <div>
                    <label className="block text-xs font-medium text-[#3F5346] mb-1">Opening Stock *</label>
                    <input
                      type="number"
                      min="0"
                      required
                      value={form.currentStock}
                      onChange={(e) => setForm({ ...form, currentStock: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-[#C6D5CA] rounded-lg font-mono"
                    />
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-[#3F5346] mb-1">Min Stock Buffer *</label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={form.minStockLevel}
                    onChange={(e) => setForm({ ...form, minStockLevel: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-[#C6D5CA] rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#3F5346] mb-1">Max Target Stock *</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={form.maxStockLevel}
                    onChange={(e) => setForm({ ...form, maxStockLevel: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-[#C6D5CA] rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#3F5346] mb-1">Mfg Date (optional)</label>
                  <input
                    type="date"
                    value={form.mfgDate}
                    onChange={(e) => setForm({ ...form, mfgDate: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-[#C6D5CA] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#3F5346] mb-1">Expiry Date (optional)</label>
                  <input
                    type="date"
                    value={form.expiryDate}
                    onChange={(e) => setForm({ ...form, expiryDate: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-[#C6D5CA] rounded-lg"
                  />
                </div>
                {!editingProduct && (
                  <div>
                    <label className="block text-xs font-medium text-[#3F5346] mb-1">Opening Batch No.</label>
                    <input
                      type="text"
                      value={form.batchNumber}
                      onChange={(e) => setForm({ ...form, batchNumber: e.target.value })}
                      placeholder="Auto-created if expiry set"
                      className="w-full px-3 py-2 text-sm border border-[#C6D5CA] rounded-lg font-mono"
                    />
                  </div>
                )}
              </div>

              <div className="pt-3 flex items-center justify-end gap-3 border-t border-[#EDF2EE]">
                <button
                  type="button"
                  onClick={() => setShowProductModal(false)}
                  className="px-4 py-2 text-xs font-medium text-[#3F5346] bg-[#F2F7F3] hover:bg-[#E4EFE7] rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 text-xs font-semibold text-white bg-[#15803D] hover:bg-[#166534] rounded-lg cursor-pointer disabled:opacity-60"
                >
                  {saving ? 'Saving...' : editingProduct ? 'Save Changes' : 'Add Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Stock Adjustment Modal */}
      {adjustTarget && (
        <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
          <div className="bg-white border border-[#DCE6DF] rounded-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between pb-3 border-b border-[#EDF2EE]">
              <h3 className="font-display text-base font-bold text-[#0D2818]">
                Adjust Stock — {adjustTarget.name}
              </h3>
              <button
                type="button"
                onClick={() => setAdjustTarget(null)}
                className="p-1 text-[#54695B] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleAdjustSubmit} className="mt-4 space-y-3.5">
              {adjErr && (
                <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                  {adjErr}
                </div>
              )}
              <p className="text-xs text-[#54695B]">
                Current recorded stock:{' '}
                <span className="font-mono font-bold text-[#0D2818]">
                  {adjustTarget.currentStock} {adjustTarget.unit}
                </span>
              </p>
              <div>
                <label className="block text-xs font-medium text-[#3F5346] mb-1">
                  Quantity Change (+ to add, - to deduct) *
                </label>
                <input
                  type="number"
                  required
                  value={adjDelta}
                  onChange={(e) => setAdjDelta(e.target.value)}
                  placeholder="e.g., 10 or -2"
                  className="w-full px-3 py-2 text-sm font-mono border border-[#C6D5CA] rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#3F5346] mb-1">
                  Reason for Adjustment *
                </label>
                <input
                  type="text"
                  required
                  value={adjReason}
                  onChange={(e) => setAdjReason(e.target.value)}
                  placeholder="Physical shelf count mismatch / damaged / return"
                  className="w-full px-3 py-2 text-sm border border-[#C6D5CA] rounded-lg"
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-[#4D6154]">
                <input
                  type="checkbox"
                  checked={adjAllowNeg}
                  onChange={(e) => setAdjAllowNeg(e.target.checked)}
                  className="accent-[#15803D]"
                />
                Authorized owner override (allow negative stock audit balance)
              </label>
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setAdjustTarget(null)}
                  className="px-3.5 py-2 text-xs font-medium text-[#3F5346] bg-[#F2F7F3] rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-[#15803D] hover:bg-[#166534] rounded-lg cursor-pointer"
                >
                  Record Adjustment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirm Delete Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
          <div className="bg-white border border-[#DCE6DF] rounded-2xl w-full max-w-md p-6">
            <h3 className="font-display text-base font-bold text-[#0D2818]">
              Delete &ldquo;{deleteTarget.name}&rdquo;?
            </h3>
            <p className="mt-2 text-sm text-[#4D6154]">
              This removes the product and its active batch records from your catalog. Past bills remain untouched.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 text-xs font-medium text-[#3F5346] bg-[#F2F7F3] rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  await deleteProduct(deleteTarget.id);
                  setDeleteTarget(null);
                }}
                className="px-4 py-2 text-xs font-semibold text-white bg-[#B91C1C] hover:bg-red-800 rounded-lg cursor-pointer"
              >
                Delete Product
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Barcode Scanner & Lookup Modal */}
      {showBarcodeModal && (
        <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
          <div className="bg-white border border-[#DCE6DF] rounded-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between pb-3 border-b border-[#EDF2EE]">
              <h3 className="font-display text-base font-bold text-[#0D2818]">
                Barcode Lookup &amp; Camera Scan
              </h3>
              <button
                type="button"
                onClick={() => {
                  stopCamera();
                  setShowBarcodeModal(false);
                }}
                className="p-1 text-[#54695B] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <video
                ref={videoRef}
                muted
                playsInline
                className="w-full h-44 bg-[#0D2818] rounded-lg object-cover"
              />
              <button
                type="button"
                onClick={() => void startBarcodeScanner()}
                className="w-full py-2 text-xs font-semibold text-white bg-[#15803D] hover:bg-[#166534] rounded-lg cursor-pointer"
              >
                Start Camera Barcode Scanner
              </button>
              {scannerMsg && <p className="text-xs text-[#4D6154]">{scannerMsg}</p>}
              <div className="pt-2 border-t border-[#EDF2EE]">
                <label className="block text-xs font-medium text-[#3F5346] mb-1">
                  Or type / scan barcode directly:
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={barcodeInput}
                    onChange={(e) => setBarcodeInput(e.target.value)}
                    placeholder="e.g., 8901725121105"
                    className="flex-1 px-3 py-2 text-sm font-mono border border-[#C6D5CA] rounded-lg"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setSearch(barcodeInput.trim());
                      stopCamera();
                      setShowBarcodeModal(false);
                    }}
                    className="px-3.5 py-2 text-xs font-semibold text-[#0D2818] bg-[#EFF5F1] hover:bg-[#DFECE3] rounded-lg cursor-pointer"
                  >
                    Find
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Wholesale Invoice OCR Intake Modal */}
      {showOcrModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white border border-[#DCE6DF] rounded-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between pb-4 border-b border-[#EDF2EE]">
              <div>
                <h3 className="font-display text-lg font-bold text-[#0D2818]">
                  Wholesale Invoice OCR Intake
                </h3>
                <p className="text-xs text-[#54695B]">
                  Upload or photograph a distributor bill. Review &amp; verify every extracted line item before adding to inventory.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowOcrModal(false)}
                className="p-1.5 text-[#54695B] hover:text-[#0D2818] rounded-md cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-[#F5F9F6] border border-[#DCE6DF]">
                <div className="text-xs text-[#3F5346]">
                  <p className="font-semibold text-[#0D2818]">Upload Supplier Bill Photo (JPG / PNG)</p>
                  <p className="mt-0.5 text-[#54695B]">
                    Server-side Gemini Vision reads product names, quantities, wholesale rates, and expiry dates for your confirmation.
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <input
                    ref={ocrInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleOcrFileChange}
                    className="hidden"
                  />
                  <button
                    type="button"
                    disabled={ocrLoading}
                    onClick={() => ocrInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#15803D] hover:bg-[#166534] rounded-lg whitespace-nowrap cursor-pointer disabled:opacity-60"
                  >
                    <Camera className="w-4 h-4" />
                    {ocrLoading ? 'Reading Invoice...' : 'Upload / Capture Bill'}
                  </button>
                </div>
              </div>

              {ocrError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                  {ocrError}
                </div>
              )}

              {ocrPreviewUrl && (
                <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
                  <div className="md:col-span-4 border border-[#DCE6DF] rounded-xl overflow-hidden bg-[#F8FAF8]">
                    <img
                      src={ocrPreviewUrl}
                      alt="Uploaded wholesale invoice preview"
                      className="w-full max-h-52 object-contain"
                    />
                  </div>
                  <div className="md:col-span-8 space-y-2 text-xs text-[#3F5346]">
                    {ocrMeta ? (
                      <div className="p-3.5 rounded-xl bg-[#F8FAF8] border border-[#E2EAE4] space-y-1">
                        <p>
                          <span className="font-semibold text-[#0D2818]">Detected Vendor:</span>{' '}
                          {ocrMeta.vendorName || 'Not printed clearly'}
                        </p>
                        <p>
                          <span className="font-semibold text-[#0D2818]">Bill No / Date:</span>{' '}
                          {ocrMeta.invoiceNumber || '—'} · {ocrMeta.invoiceDate || '—'}
                        </p>
                        {ocrMeta.notes && (
                          <p className="text-[#54695B]">
                            <span className="font-semibold text-[#0D2818]">OCR Note:</span> {ocrMeta.notes}
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="p-3.5 rounded-xl bg-[#F8FAF8] border border-[#E2EAE4] text-[#54695B]">
                        {ocrLoading
                          ? 'Analyzing bill layout and line items...'
                          : 'Invoice loaded. Review or edit extracted rows below.'}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {ocrItems.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-[#0D2818]">
                      Extracted Line Items ({ocrItems.length}) — Verify Before Import
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        setOcrItems((prev) => [
                          ...prev,
                          {
                            name: '',
                            category: 'Staples & Grains',
                            brand: '',
                            unit: 'pack',
                            quantity: 10,
                            purchasePrice: 50,
                            sellingPrice: 60,
                            expiryDate: '',
                          },
                        ])
                      }
                      className="text-xs font-medium text-[#15803D] hover:underline cursor-pointer"
                    >
                      + Add Row Manually
                    </button>
                  </div>
                  <div className="overflow-x-auto border border-[#DCE6DF] rounded-xl">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-[#F5F9F6] border-b border-[#E2EAE4] text-[#4D6154]">
                          <th className="py-2 px-2.5">Product Name</th>
                          <th className="py-2 px-2">Category</th>
                          <th className="py-2 px-2 w-16">Qty</th>
                          <th className="py-2 px-2 w-16">Unit</th>
                          <th className="py-2 px-2 w-20">Buy ₹</th>
                          <th className="py-2 px-2 w-20">Sell ₹</th>
                          <th className="py-2 px-2 w-32">Expiry</th>
                          <th className="py-2 px-2 w-8"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#EDF2EE]">
                        {ocrItems.map((row, idx) => (
                          <tr key={idx}>
                            <td className="p-1.5">
                              <input
                                type="text"
                                value={row.name}
                                onChange={(e) =>
                                  setOcrItems((prev) =>
                                    prev.map((it, i) => (i === idx ? { ...it, name: e.target.value } : it))
                                  )
                                }
                                className="w-full px-2 py-1 border border-[#C6D5CA] rounded text-xs"
                              />
                            </td>
                            <td className="p-1.5">
                              <select
                                value={CATEGORIES.includes(row.category) ? row.category : 'Other'}
                                onChange={(e) =>
                                  setOcrItems((prev) =>
                                    prev.map((it, i) => (i === idx ? { ...it, category: e.target.value } : it))
                                  )
                                }
                                className="w-full px-1.5 py-1 border border-[#C6D5CA] rounded bg-white text-xs"
                              >
                                {CATEGORIES.map((c) => (
                                  <option key={c} value={c}>
                                    {c}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="p-1.5">
                              <input
                                type="number"
                                min="1"
                                value={row.quantity}
                                onChange={(e) =>
                                  setOcrItems((prev) =>
                                    prev.map((it, i) =>
                                      i === idx ? { ...it, quantity: Number(e.target.value) } : it
                                    )
                                  )
                                }
                                className="w-full px-1.5 py-1 border border-[#C6D5CA] rounded font-mono text-xs"
                              />
                            </td>
                            <td className="p-1.5">
                              <input
                                type="text"
                                value={row.unit}
                                onChange={(e) =>
                                  setOcrItems((prev) =>
                                    prev.map((it, i) => (i === idx ? { ...it, unit: e.target.value } : it))
                                  )
                                }
                                className="w-full px-1.5 py-1 border border-[#C6D5CA] rounded text-xs"
                              />
                            </td>
                            <td className="p-1.5">
                              <input
                                type="number"
                                min="0"
                                step="0.5"
                                value={row.purchasePrice}
                                onChange={(e) =>
                                  setOcrItems((prev) =>
                                    prev.map((it, i) =>
                                      i === idx ? { ...it, purchasePrice: Number(e.target.value) } : it
                                    )
                                  )
                                }
                                className="w-full px-1.5 py-1 border border-[#C6D5CA] rounded font-mono text-xs"
                              />
                            </td>
                            <td className="p-1.5">
                              <input
                                type="number"
                                min="1"
                                step="0.5"
                                value={row.sellingPrice}
                                onChange={(e) =>
                                  setOcrItems((prev) =>
                                    prev.map((it, i) =>
                                      i === idx ? { ...it, sellingPrice: Number(e.target.value) } : it
                                    )
                                  )
                                }
                                className="w-full px-1.5 py-1 border border-[#C6D5CA] rounded font-mono text-xs"
                              />
                            </td>
                            <td className="p-1.5">
                              <input
                                type="date"
                                value={row.expiryDate || ''}
                                onChange={(e) =>
                                  setOcrItems((prev) =>
                                    prev.map((it, i) => (i === idx ? { ...it, expiryDate: e.target.value } : it))
                                  )
                                }
                                className="w-full px-1.5 py-1 border border-[#C6D5CA] rounded font-mono text-xs"
                              />
                            </td>
                            <td className="p-1.5 text-center">
                              <button
                                type="button"
                                onClick={() => setOcrItems((prev) => prev.filter((_, i) => i !== idx))}
                                className="p-1 text-[#54695B] hover:text-[#B91C1C] cursor-pointer"
                                title="Remove row"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="pt-3 border-t border-[#EDF2EE] flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowOcrModal(false)}
                  className="px-4 py-2 text-xs font-medium text-[#3F5346] bg-[#F2F7F3] hover:bg-[#E4EFE7] rounded-lg cursor-pointer"
                >
                  Close
                </button>
                <button
                  type="button"
                  disabled={ocrItems.length === 0 || ocrImporting}
                  onClick={() => void handleImportOcrItems()}
                  className="px-5 py-2 text-xs font-semibold text-white bg-[#15803D] hover:bg-[#166534] rounded-lg cursor-pointer disabled:opacity-50"
                >
                  {ocrImporting ? 'Importing...' : `Import ${ocrItems.length} Verified Items`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
