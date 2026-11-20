import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  Mic,
  MicOff,
  Minus,
  Pencil,
  Plus,
  Printer,
  QrCode,
  Receipt,
  Search,
  Smartphone,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useShop } from '../context/ShopContext.tsx';
import type { SaleRecord } from '../types/dukaaniq.ts';
import { daysBetweenDates, formatISODate } from '../services/intelligenceEngine.ts';
import {
  buildUpiPaymentUri,
  generateBillPaymentRef,
  generateUpiQrDataUrl,
  isValidUpiVpa,
  loadShopUpiConfig,
  saveShopUpiConfig,
  type ShopUpiConfig,
} from '../services/upiQrService.ts';
import {
  createSpeechRecognition,
  isSpeechRecognitionSupported,
  isSpeechSynthesisSupported,
  parseSalesVoiceCommand,
  speakText,
  stopSpeaking,
  VOICE_LANGUAGES,
  type SpeechRecognitionInstance,
  type VoiceLangCode,
} from '../services/voiceCommandEngine.ts';

interface CartLine {
  productId: number;
  quantity: number;
}

interface VoiceFeedback {
  tone: 'success' | 'info' | 'warning';
  transcript: string;
  message: string;
}

export function SalesBillingView() {
  const { workspace, recordSale } = useShop();
  const [subTab, setSubTab] = useState<'pos' | 'history'>('pos');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'Cash' | 'UPI' | 'Card' | 'Credit'>('UPI');
  const [discount, setDiscount] = useState('0');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');
  const [printableBill, setPrintableBill] = useState<SaleRecord | null>(null);
  const [printableUpiRef, setPrintableUpiRef] = useState<string | null>(null);
  const [periodFilter, setPeriodFilter] = useState<'daily' | 'weekly' | 'monthly'>('weekly');

  // Merchant UPI & QR Code payment modal state
  const [upiConfig, setUpiConfig] = useState<ShopUpiConfig>({
    vpa: 'gramsetushop@upi',
    payeeName: 'Kirana Store',
    isConfigured: false,
  });
  const [editingUpi, setEditingUpi] = useState(false);
  const [vpaDraft, setVpaDraft] = useState('');
  const [payeeDraft, setPayeeDraft] = useState('');
  const [vpaErr, setVpaErr] = useState('');
  const [upiModalOpen, setUpiModalOpen] = useState(false);
  const [upiRef, setUpiRef] = useState('');
  const [upiUri, setUpiUri] = useState('');
  const [upiQrDataUrl, setUpiQrDataUrl] = useState('');
  const [upiQrLoading, setUpiQrLoading] = useState(false);
  const [copiedUpi, setCopiedUpi] = useState(false);

  // Web Speech API voice billing state
  const speechSupported = useMemo(() => isSpeechRecognitionSupported(), []);
  const ttsSupported = useMemo(() => isSpeechSynthesisSupported(), []);
  const [voiceLang, setVoiceLang] = useState<VoiceLangCode>('en-IN');
  const [voiceAudioReply, setVoiceAudioReply] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [voiceFeedback, setVoiceFeedback] = useState<VoiceFeedback | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  const todayISO = formatISODate(new Date());

  // Load saved shop UPI ID whenever active shop changes
  useEffect(() => {
    if (!workspace) return;
    const loaded = loadShopUpiConfig(workspace.shop.id, workspace.shop.name);
    setUpiConfig(loaded);
    setVpaDraft(loaded.vpa);
    setPayeeDraft(loaded.payeeName);
  }, [workspace?.shop.id, workspace?.shop.name]);

  const productMap = useMemo(
    () => new Map((workspace?.products || []).map((p) => [p.id, p])),
    [workspace?.products]
  );

  // Identify products where ALL active batches are expired so we block selling expired goods
  const expiredOnlyProductIds = useMemo(() => {
    const set = new Set<number>();
    if (!workspace) return set;
    for (const p of workspace.products) {
      const activeBatches = workspace.batches.filter(
        (b) => b.productId === p.id && b.status === 'active' && b.quantity > 0
      );
      if (activeBatches.length > 0 && activeBatches.every((b) => b.expiryDate < todayISO)) {
        set.add(p.id);
      }
    }
    return set;
  }, [workspace, todayISO]);

  const searchableProducts = useMemo(() => {
    if (!workspace) return [];
    const q = deferredSearch.trim().toLowerCase();
    return workspace.products.filter((p) => {
      if (!q) return true;
      return `${p.name} ${p.sku} ${p.barcode || ''} ${p.category}`.toLowerCase().includes(q);
    });
  }, [workspace, deferredSearch]);

  const cartTotals = useMemo(() => {
    let subtotal = 0;
    let totalCost = 0;
    for (const line of cart) {
      const p = productMap.get(line.productId);
      if (!p) continue;
      subtotal += p.sellingPrice * line.quantity;
      totalCost += p.purchasePrice * line.quantity;
    }
    const disc = Math.max(0, Math.min(Number(discount || 0), subtotal));
    const total = Number((subtotal - disc).toFixed(2));
    const grossProfit = Number((total - totalCost).toFixed(2));
    return {
      subtotal: Number(subtotal.toFixed(2)),
      discount: Number(disc.toFixed(2)),
      total,
      totalCost: Number(totalCost.toFixed(2)),
      grossProfit,
    };
  }, [cart, productMap, discount]);

  // Regenerate scannable NPCI UPI QR whenever modal is open or VPA/total changes
  useEffect(() => {
    if (!upiModalOpen || !workspace || cartTotals.total <= 0) return;
    const activeRef = upiRef || generateBillPaymentRef(workspace.shop.id);
    if (!upiRef) setUpiRef(activeRef);
    const totalQty = cart.reduce((s, l) => s + l.quantity, 0);
    const uri = buildUpiPaymentUri({
      vpa: upiConfig.vpa,
      payeeName: upiConfig.payeeName || workspace.shop.name,
      amount: cartTotals.total,
      transactionRef: activeRef,
      note: `Bill ${activeRef} (${totalQty} items)`,
    });
    setUpiUri(uri);
    let cancelled = false;
    setUpiQrLoading(true);
    generateUpiQrDataUrl(uri)
      .then((dataUrl) => {
        if (!cancelled) setUpiQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setUpiQrDataUrl('');
      })
      .finally(() => {
        if (!cancelled) setUpiQrLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [upiModalOpen, upiConfig, upiRef, cartTotals.total, cart, workspace]);

  const salesSummaryByPeriod = useMemo(() => {
    if (!workspace) return { count: 0, revenue: 0, grossProfit: 0, filtered: [] as SaleRecord[] };
    const maxDays = periodFilter === 'daily' ? 1 : periodFilter === 'weekly' ? 7 : 30;
    const filtered = workspace.sales.filter((s) => {
      const age = daysBetweenDates(s.saleDate.slice(0, 10), todayISO);
      return age >= 0 && age < maxDays;
    });
    return {
      count: filtered.length,
      revenue: filtered.reduce((sum, s) => sum + s.totalAmount, 0),
      grossProfit: filtered.reduce((sum, s) => sum + s.grossProfit, 0),
      filtered,
    };
  }, [workspace, periodFilter, todayISO]);

  const announceVoiceResult = useCallback(
    (feedback: VoiceFeedback) => {
      setVoiceFeedback(feedback);
      if (voiceAudioReply && ttsSupported) {
        speakText(feedback.message, voiceLang);
      }
    },
    [voiceAudioReply, ttsSupported, voiceLang]
  );

  const executeVoiceCommand = useCallback(
    (transcript: string) => {
      if (!workspace) return;
      setErr('');
      const parsed = parseSalesVoiceCommand(transcript, workspace.products);

      if (parsed.type === 'clear_search') {
        setSearch('');
        announceVoiceResult({
          tone: 'info',
          transcript: parsed.raw,
          message: 'Cleared product search. Showing all products.',
        });
        return;
      }

      if (parsed.type === 'search') {
        setSearch(parsed.query);
        const matches = workspace.products.filter((p) =>
          `${p.name} ${p.sku} ${p.barcode || ''} ${p.category} ${p.brand || ''}`
            .toLowerCase()
            .includes(parsed.query.toLowerCase())
        ).length;
        announceVoiceResult({
          tone: matches > 0 ? 'info' : 'warning',
          transcript: parsed.raw,
          message:
            matches > 0
              ? `Showing ${matches} matching product${matches === 1 ? '' : 's'} for "${parsed.query}".`
              : `Filtered catalog for "${parsed.query}" — no exact matches found.`,
        });
        return;
      }

      if (parsed.type === 'clear_cart') {
        setCart([]);
        announceVoiceResult({
          tone: 'info',
          transcript: parsed.raw,
          message: 'Cleared all items from the current bill.',
        });
        return;
      }

      if (parsed.type === 'remove') {
        if (parsed.items.length === 0) {
          announceVoiceResult({
            tone: 'warning',
            transcript: parsed.raw,
            message: `Could not find "${parsed.unmatched.join(', ')}" to remove from the bill.`,
          });
          return;
        }
        const removedSummary: string[] = [];
        let nextCart = [...cart];
        for (const entry of parsed.items) {
          const idx = nextCart.findIndex((l) => l.productId === entry.product.id);
          if (idx === -1) continue;
          if (entry.quantity && entry.quantity < nextCart[idx].quantity) {
            nextCart[idx] = { ...nextCart[idx], quantity: nextCart[idx].quantity - entry.quantity };
            removedSummary.push(`${entry.quantity} ${entry.product.name}`);
          } else {
            nextCart = nextCart.filter((l) => l.productId !== entry.product.id);
            removedSummary.push(entry.product.name);
          }
        }
        setCart(nextCart);
        announceVoiceResult({
          tone: removedSummary.length > 0 ? 'info' : 'warning',
          transcript: parsed.raw,
          message:
            removedSummary.length > 0
              ? `Removed ${removedSummary.join(', ')} from the bill.`
              : 'None of the requested items were currently in the bill.',
        });
        return;
      }

      if (parsed.type === 'add') {
        if (parsed.items.length === 0) {
          announceVoiceResult({
            tone: 'warning',
            transcript: parsed.raw,
            message: `No catalog match found for "${parsed.unmatched.join(', ')}". Try saying the product name or "Search <item>".`,
          });
          return;
        }

        const addedLabels: string[] = [];
        const skippedNotices: string[] = [];
        const nextCart = [...cart];

        for (const entry of parsed.items) {
          const prod = entry.product;
          if (expiredOnlyProductIds.has(prod.id)) {
            skippedNotices.push(`${prod.name} is blocked (expired batch only)`);
            continue;
          }
          if (prod.currentStock <= 0) {
            skippedNotices.push(`${prod.name} is out of stock`);
            continue;
          }
          const existingIdx = nextCart.findIndex((l) => l.productId === prod.id);
          const existingQty = existingIdx >= 0 ? nextCart[existingIdx].quantity : 0;
          const remainingStock = Math.max(0, prod.currentStock - existingQty);
          if (remainingStock <= 0) {
            skippedNotices.push(`${prod.name} reached max stock (${prod.currentStock})`);
            continue;
          }
          const qtyToAdd = Math.min(entry.quantity, remainingStock);
          if (existingIdx >= 0) {
            nextCart[existingIdx] = { ...nextCart[existingIdx], quantity: existingQty + qtyToAdd };
          } else {
            nextCart.push({ productId: prod.id, quantity: qtyToAdd });
          }
          addedLabels.push(`${qtyToAdd} ${prod.name}`);
          if (qtyToAdd < entry.quantity) {
            skippedNotices.push(`${prod.name} capped at ${prod.currentStock} available`);
          }
        }

        if (addedLabels.length > 0) {
          setCart(nextCart);
        }

        if (parsed.unmatched.length > 0) {
          skippedNotices.push(`Unmatched: ${parsed.unmatched.join(', ')}`);
        }

        if (addedLabels.length > 0) {
          const extra = skippedNotices.length > 0 ? ` Note: ${skippedNotices.join('; ')}.` : '';
          announceVoiceResult({
            tone: skippedNotices.length > 0 ? 'info' : 'success',
            transcript: parsed.raw,
            message: `Added ${addedLabels.join(', ')} to bill.${extra}`,
          });
        } else {
          const warnMsg = skippedNotices.join('. ') || 'Could not add requested items.';
          setErr(warnMsg);
          announceVoiceResult({
            tone: 'warning',
            transcript: parsed.raw,
            message: warnMsg,
          });
        }
        return;
      }

      announceVoiceResult({
        tone: 'warning',
        transcript: parsed.raw,
        message: parsed.suggestion,
      });
    },
    [workspace, cart, expiredOnlyProductIds, announceVoiceResult]
  );

  const stopVoiceListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Ignore
      }
      recognitionRef.current = null;
    }
    setIsListening(false);
    setInterimTranscript('');
  }, []);

  const toggleVoiceListening = useCallback(() => {
    if (isListening) {
      stopVoiceListening();
      return;
    }
    if (!speechSupported) {
      setVoiceFeedback({
        tone: 'warning',
        transcript: '',
        message:
          'Browser Web Speech API is unavailable here. Use Chrome/Edge with microphone permission, or tap a sample voice command below.',
      });
      return;
    }

    stopSpeaking();
    const recognition = createSpeechRecognition(voiceLang, {
      continuous: false,
      interimResults: true,
    });
    if (!recognition) return;

    recognitionRef.current = recognition;
    let latestFinal = '';

    recognition.onstart = () => {
      setIsListening(true);
      setInterimTranscript('');
    };

    recognition.onresult = (event) => {
      let interim = '';
      let finalChunk = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const res = event.results[i];
        const text = res[0]?.transcript || '';
        if (res.isFinal) {
          finalChunk += ` ${text}`;
        } else {
          interim += ` ${text}`;
        }
      }
      if (interim.trim()) {
        setInterimTranscript(interim.trim());
      }
      if (finalChunk.trim()) {
        latestFinal = `${latestFinal} ${finalChunk}`.trim();
        setInterimTranscript(latestFinal);
      }
    };

    recognition.onerror = (event) => {
      setIsListening(false);
      recognitionRef.current = null;
      const errLabel =
        event.error === 'not-allowed'
          ? 'Microphone permission denied. Please allow microphone access in your browser.'
          : event.error === 'no-speech'
          ? 'No speech detected. Tap Voice Command and speak clearly.'
          : `Voice recognition stopped (${event.error}).`;
      setVoiceFeedback({
        tone: 'warning',
        transcript: '',
        message: errLabel,
      });
    };

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
      if (latestFinal.trim()) {
        executeVoiceCommand(latestFinal.trim());
      }
      setInterimTranscript('');
    };

    try {
      recognition.start();
    } catch {
      setIsListening(false);
      recognitionRef.current = null;
    }
  }, [isListening, speechSupported, voiceLang, stopVoiceListening, executeVoiceCommand]);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // Ignore
        }
        recognitionRef.current = null;
      }
      stopSpeaking();
    };
  }, []);

  if (!workspace) return null;

  const addToCart = (productId: number) => {
    setErr('');
    const prod = productMap.get(productId);
    if (!prod || prod.currentStock <= 0) return;
    if (expiredOnlyProductIds.has(productId)) {
      setErr(`${prod.name} only has expired batch stock. Remove expired goods before selling.`);
      return;
    }
    setCart((prev) => {
      const existing = prev.find((l) => l.productId === productId);
      if (existing) {
        if (existing.quantity >= prod.currentStock) {
          setErr(`Only ${prod.currentStock} ${prod.unit} available for ${prod.name}.`);
          return prev;
        }
        return prev.map((l) =>
          l.productId === productId ? { ...l, quantity: l.quantity + 1 } : l
        );
      }
      return [...prev, { productId, quantity: 1 }];
    });
  };

  const updateCartQty = (productId: number, delta: number) => {
    setErr('');
    const prod = productMap.get(productId);
    if (!prod) return;
    setCart((prev) =>
      prev
        .map((l) => {
          if (l.productId !== productId) return l;
          const next = l.quantity + delta;
          if (next > prod.currentStock) {
            setErr(`Maximum available stock for ${prod.name} is ${prod.currentStock} ${prod.unit}.`);
            return l;
          }
          return { ...l, quantity: next };
        })
        .filter((l) => l.quantity > 0)
    );
  };

  const completeSale = async (
    overrideMethod?: 'Cash' | 'UPI' | 'Card' | 'Credit',
    confirmedUpiRef?: string | null
  ) => {
    setErr('');
    if (cart.length === 0) {
      setErr('Add at least one item to generate a bill.');
      return;
    }
    setSubmitting(true);
    try {
      const methodToUse = overrideMethod || paymentMethod;
      const created = await recordSale({
        customerName: customerName.trim() || 'Walk-in Customer',
        customerPhone: customerPhone.trim() || undefined,
        paymentMethod: methodToUse,
        discount: cartTotals.discount,
        items: cart,
      });
      if (created) {
        setPrintableBill(created);
        setPrintableUpiRef(confirmedUpiRef || null);
        setUpiModalOpen(false);
        setUpiRef('');
        setCart([]);
        setCustomerName('');
        setCustomerPhone('');
        setDiscount('0');
      }
    } catch (error: unknown) {
      setErr(error instanceof Error ? error.message : 'Failed to save bill.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    await completeSale();
  };

  const handleOpenUpiQr = () => {
    setErr('');
    if (cart.length === 0 || cartTotals.total <= 0) {
      setErr('Add at least one item with a payable total above ₹0 to generate a UPI QR code.');
      return;
    }
    setPaymentMethod('UPI');
    setUpiRef(generateBillPaymentRef(workspace.shop.id));
    setCopiedUpi(false);
    setUpiModalOpen(true);
  };

  const handleSaveUpiConfig = () => {
    setVpaErr('');
    if (!isValidUpiVpa(vpaDraft)) {
      setVpaErr('Enter a valid UPI ID such as yourshop@okaxis, yourshop@ybl, or yourshop@paytm.');
      return;
    }
    const saved = saveShopUpiConfig(
      workspace.shop.id,
      vpaDraft,
      payeeDraft.trim() || workspace.shop.name
    );
    setUpiConfig(saved);
    setEditingUpi(false);
  };

  const handleCopyUpiUri = async () => {
    if (!upiUri || typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(upiUri);
      setCopiedUpi(true);
      setTimeout(() => setCopiedUpi(false), 2200);
    } catch {
      // Ignore clipboard permission errors
    }
  };

  return (
    <div className="space-y-5">
      {/* Sub-navigation */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex items-center gap-1 p-1 bg-[#EBF1EC] rounded-lg">
          <button
            type="button"
            onClick={() => setSubTab('pos')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              subTab === 'pos'
                ? 'bg-white text-[#0D2818] shadow-xs'
                : 'text-[#4D6154] hover:text-[#0D2818]'
            }`}
          >
            Fast Counter Billing
          </button>
          <button
            type="button"
            onClick={() => setSubTab('history')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              subTab === 'history'
                ? 'bg-white text-[#0D2818] shadow-xs'
                : 'text-[#4D6154] hover:text-[#0D2818]'
            }`}
          >
            Sales History ({workspace.sales.length})
          </button>
        </div>

        <div className="flex items-center gap-1 p-1 bg-[#EBF1EC] rounded-lg">
          {(['daily', 'weekly', 'monthly'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriodFilter(p)}
              className={`px-3 py-1 text-xs font-medium rounded-md capitalize cursor-pointer ${
                periodFilter === p
                  ? 'bg-white text-[#0D2818] shadow-xs'
                  : 'text-[#4D6154] hover:text-[#0D2818]'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Period Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-[#DCE6DF] rounded-xl p-4">
          <p className="text-xs text-[#54695B] capitalize">{periodFilter} Bills Recorded</p>
          <p className="mt-1 font-mono text-xl font-bold text-[#0D2818] tabular-nums">
            {salesSummaryByPeriod.count}
          </p>
        </div>
        <div className="bg-white border border-[#DCE6DF] rounded-xl p-4">
          <p className="text-xs text-[#54695B] capitalize">{periodFilter} Sales Revenue</p>
          <p className="mt-1 font-mono text-xl font-bold text-[#15803D] tabular-nums">
            ₹{Math.round(salesSummaryByPeriod.revenue).toLocaleString('en-IN')}
          </p>
        </div>
        <div className="bg-white border border-[#DCE6DF] rounded-xl p-4">
          <p className="text-xs text-[#54695B] capitalize">{periodFilter} Gross Profit (After COGS)</p>
          <p className="mt-1 font-mono text-xl font-bold text-[#0D2818] tabular-nums">
            ₹{Math.round(salesSummaryByPeriod.grossProfit).toLocaleString('en-IN')}
          </p>
        </div>
      </div>

      {subTab === 'pos' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Product Picker Grid */}
          <div className="lg:col-span-7 bg-white border border-[#DCE6DF] rounded-xl p-5 space-y-4">
            {/* Search & Web Speech API Voice Control Bar */}
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="w-4 h-4 text-[#6B7F71] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Tap, type, or speak item name, SKU, or barcode..."
                    className="w-full pl-9 pr-8 py-2.5 text-sm border border-[#C6D5CA] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#15803D]/25 focus:border-[#15803D]"
                  />
                  {search && (
                    <button
                      type="button"
                      onClick={() => setSearch('')}
                      aria-label="Clear product search"
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#6B7F71] hover:text-[#0D2818] cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={toggleVoiceListening}
                  className={`inline-flex items-center gap-2 px-3.5 py-2.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    isListening
                      ? 'bg-[#B91C1C] text-white border-[#B91C1C] hover:bg-[#991B1B]'
                      : 'bg-[#0D2818] text-white border-[#0D2818] hover:bg-[#153C24]'
                  }`}
                  title={
                    speechSupported
                      ? 'Speak to add items or search products (Web Speech API)'
                      : 'Web Speech API unavailable in this browser'
                  }
                >
                  {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4 text-[#34D399]" />}
                  {isListening ? 'Stop Listening' : 'Voice Command'}
                </button>

                <select
                  value={voiceLang}
                  onChange={(e) => setVoiceLang(e.target.value as VoiceLangCode)}
                  aria-label="Voice recognition language"
                  className="px-2.5 py-2.5 text-xs font-medium text-[#0D2818] bg-[#F5F9F6] border border-[#C6D5CA] rounded-lg cursor-pointer"
                >
                  {VOICE_LANGUAGES.map((lang) => (
                    <option key={lang.code} value={lang.code}>
                      {lang.shortLabel} · {lang.label}
                    </option>
                  ))}
                </select>

                {ttsSupported && (
                  <button
                    type="button"
                    onClick={() => {
                      if (voiceAudioReply) stopSpeaking();
                      setVoiceAudioReply((prev) => !prev);
                    }}
                    title={voiceAudioReply ? 'Mute spoken confirmation' : 'Enable spoken confirmation'}
                    aria-label={voiceAudioReply ? 'Mute spoken confirmation' : 'Enable spoken confirmation'}
                    className={`p-2.5 rounded-lg border transition-colors cursor-pointer ${
                      voiceAudioReply
                        ? 'bg-[#F2FBF4] text-[#15803D] border-[#B7DFC1]'
                        : 'bg-white text-[#6B7F71] border-[#C6D5CA]'
                    }`}
                  >
                    {voiceAudioReply ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                  </button>
                )}
              </div>

              {/* Live Voice Listening / Feedback Strip */}
              {isListening && (
                <div className="px-3.5 py-2.5 rounded-lg bg-[#FEF2F2] border border-[#FECACA] flex items-center justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <p className="font-semibold text-[#991B1B]">
                      Listening ({VOICE_LANGUAGES.find((l) => l.code === voiceLang)?.label}) — Speak now...
                    </p>
                    <p className="text-[#7F1D1D] truncate mt-0.5">
                      {interimTranscript ? `"${interimTranscript}"` : 'Try: "Add 2 Atta", "Search Cooking Oil", or "Add 1 Maggi and 2 Parle-G"'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={stopVoiceListening}
                    className="text-[11px] font-semibold text-[#991B1B] hover:underline shrink-0 cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              )}

              {!isListening && voiceFeedback && (
                <div
                  className={`px-3.5 py-2.5 rounded-lg border flex items-start justify-between gap-3 text-xs ${
                    voiceFeedback.tone === 'success'
                      ? 'bg-[#ECF6EF] border-[#B7DFC1] text-[#16532D]'
                      : voiceFeedback.tone === 'warning'
                      ? 'bg-amber-50 border-amber-200 text-amber-900'
                      : 'bg-[#F5F9F6] border-[#DCE6DF] text-[#0D2818]'
                  }`}
                >
                  <div className="min-w-0">
                    {voiceFeedback.transcript && (
                      <p className="text-[11px] opacity-75 truncate">
                        Heard: &ldquo;{voiceFeedback.transcript}&rdquo;
                      </p>
                    )}
                    <p className="font-medium leading-snug">{voiceFeedback.message}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setVoiceFeedback(null)}
                    aria-label="Dismiss voice status"
                    className="opacity-70 hover:opacity-100 shrink-0 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Quick Voice Command Examples (also clickable to test without microphone) */}
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#54695B]">
                <span className="font-medium text-[#3F5346]">Voice examples:</span>
                {[
                  'Add 2 Atta',
                  'Add 1 Maggi and 2 Parle-G',
                  'Search Cooking Oil',
                  'Clear search',
                ].map((sample) => (
                  <button
                    key={sample}
                    type="button"
                    onClick={() => executeVoiceCommand(sample)}
                    className="px-2 py-0.5 rounded bg-[#F2F7F3] hover:bg-[#E4EFE7] border border-[#DCE6DF] text-[#0D2818] transition-colors cursor-pointer"
                  >
                    &ldquo;{sample}&rdquo;
                  </button>
                ))}
              </div>
            </div>

            {searchableProducts.length === 0 ? (
              <p className="text-sm text-[#54695B] py-8 text-center">
                No products available to bill. Add items in Inventory first.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[520px] overflow-y-auto pr-1">
                {searchableProducts.map((p) => {
                  const isOut = p.currentStock <= 0;
                  const isExpiredOnly = expiredOnlyProductIds.has(p.id);
                  const inCart = cart.find((c) => c.productId === p.id)?.quantity || 0;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={isOut || isExpiredOnly}
                      onClick={() => addToCart(p.id)}
                      className={`text-left p-3.5 rounded-xl border transition-colors ${
                        isOut || isExpiredOnly
                          ? 'border-[#E6ECE8] bg-[#F7F9F8] opacity-60 cursor-not-allowed'
                          : inCart > 0
                          ? 'border-[#15803D] bg-[#F2FBF4] cursor-pointer'
                          : 'border-[#DCE6DF] bg-white hover:border-[#15803D] cursor-pointer'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold text-[#0D2818] leading-snug">
                          {p.name}
                        </p>
                        <span className="font-mono text-sm font-bold text-[#15803D] tabular-nums shrink-0">
                          ₹{p.sellingPrice}
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center justify-between text-xs">
                        <span className="text-[#54695B]">{p.category}</span>
                        {isExpiredOnly ? (
                          <span className="font-semibold text-[#B91C1C]">Expired — Blocked</span>
                        ) : isOut ? (
                          <span className="font-semibold text-[#B91C1C]">Out of Stock</span>
                        ) : (
                          <span className="font-mono text-[#4D6154] tabular-nums">
                            {p.currentStock} {p.unit} left {inCart > 0 ? `· ${inCart} in bill` : ''}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Active Bill / Cart Panel */}
          <form
            onSubmit={handleCheckout}
            className="lg:col-span-5 bg-white border border-[#DCE6DF] rounded-xl p-5 space-y-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-[#EDF2EE]">
              <div className="flex items-center gap-2">
                <Receipt className="w-4 h-4 text-[#15803D]" />
                <h3 className="font-display text-base font-bold text-[#0D2818]">Current Bill</h3>
              </div>
              {cart.length > 0 && (
                <button
                  type="button"
                  onClick={() => setCart([])}
                  className="text-xs text-[#B91C1C] hover:underline cursor-pointer"
                >
                  Clear Cart
                </button>
              )}
            </div>

            {err && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                {err}
              </div>
            )}

            {cart.length === 0 ? (
              <p className="text-sm text-[#54695B] py-6 text-center">
                Tap products on the left to build a customer bill.
              </p>
            ) : (
              <div className="divide-y divide-[#EDF2EE] max-h-64 overflow-y-auto">
                {cart.map((line) => {
                  const p = productMap.get(line.productId);
                  if (!p) return null;
                  return (
                    <div key={line.productId} className="py-2.5 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-[#0D2818] truncate">{p.name}</p>
                        <p className="text-[11px] font-mono text-[#54695B] tabular-nums">
                          ₹{p.sellingPrice} × {line.quantity} = ₹{(p.sellingPrice * line.quantity).toFixed(2)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => updateCartQty(line.productId, -1)}
                          className="w-7 h-7 flex items-center justify-center rounded-md border border-[#C6D5CA] hover:bg-[#F2F7F3] cursor-pointer"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="w-7 text-center font-mono text-xs font-semibold tabular-nums">
                          {line.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => updateCartQty(line.productId, 1)}
                          className="w-7 h-7 flex items-center justify-center rounded-md border border-[#C6D5CA] hover:bg-[#F2F7F3] cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => updateCartQty(line.productId, -line.quantity)}
                          className="p-1 text-[#6B7F71] hover:text-[#B91C1C] cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[#EDF2EE]">
              <div>
                <label className="block text-xs font-medium text-[#3F5346] mb-1">
                  Customer Name
                </label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Walk-in Customer"
                  className="w-full px-3 py-2 text-xs border border-[#C6D5CA] rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#3F5346] mb-1">
                  Discount (₹)
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono border border-[#C6D5CA] rounded-lg"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#3F5346] mb-1.5">
                Payment Mode
              </label>
              <div className="grid grid-cols-4 gap-1.5">
                {(['UPI', 'Cash', 'Card', 'Credit'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setPaymentMethod(m)}
                    className={`py-2 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                      paymentMethod === m
                        ? 'bg-[#0D2818] text-white border-[#0D2818]'
                        : 'bg-white text-[#3F5346] border-[#C6D5CA] hover:bg-[#F2F7F3]'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
              {paymentMethod === 'UPI' && (
                <div className="mt-2.5 p-3 rounded-lg bg-[#F5F9F6] border border-[#DCE6DF] space-y-2">
                  {!editingUpi ? (
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <div className="min-w-0">
                        <p className="text-[11px] text-[#54695B]">
                          Merchant UPI ID {!upiConfig.isConfigured ? '(Default — Edit for live payments)' : '(Saved)'}
                        </p>
                        <p className="font-mono font-semibold text-[#0D2818] truncate">
                          {upiConfig.vpa}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setVpaDraft(upiConfig.vpa);
                          setPayeeDraft(upiConfig.payeeName);
                          setVpaErr('');
                          setEditingUpi(true);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-[#15803D] bg-white border border-[#C6D5CA] hover:bg-[#ECF6EF] rounded-md whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Pencil className="w-3 h-3" />
                        Edit UPI ID
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2 text-xs">
                      <div>
                        <label className="block text-[11px] font-medium text-[#3F5346] mb-1">
                          Shop Merchant UPI VPA
                        </label>
                        <input
                          type="text"
                          value={vpaDraft}
                          onChange={(e) => setVpaDraft(e.target.value)}
                          placeholder="e.g. srilakshmikiran@okaxis"
                          className="w-full px-2.5 py-1.5 font-mono text-xs bg-white border border-[#C6D5CA] rounded-md"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-[#3F5346] mb-1">
                          Payee Display Name
                        </label>
                        <input
                          type="text"
                          value={payeeDraft}
                          onChange={(e) => setPayeeDraft(e.target.value)}
                          placeholder={workspace.shop.name}
                          className="w-full px-2.5 py-1.5 text-xs bg-white border border-[#C6D5CA] rounded-md"
                        />
                      </div>
                      {vpaErr && <p className="text-[11px] text-[#B91C1C]">{vpaErr}</p>}
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingUpi(false);
                            setVpaErr('');
                          }}
                          className="px-2.5 py-1 text-[11px] font-medium text-[#4D6154] hover:text-[#0D2818] cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleSaveUpiConfig}
                          className="px-3 py-1 text-[11px] font-semibold text-white bg-[#15803D] hover:bg-[#166534] rounded-md cursor-pointer"
                        >
                          Save UPI ID
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="p-4 rounded-xl bg-[#F5F9F6] border border-[#E2EAE4] space-y-1.5 text-xs">
              <div className="flex justify-between text-[#4D6154]">
                <span>Subtotal</span>
                <span className="font-mono tabular-nums">₹{cartTotals.subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-[#4D6154]">
                <span>Discount</span>
                <span className="font-mono tabular-nums">-₹{cartTotals.discount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-base font-bold text-[#0D2818] pt-1.5 border-t border-[#DCE6DF]">
                <span>Payable Total</span>
                <span className="font-mono tabular-nums">₹{cartTotals.total.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-[11px] text-[#15803D] pt-1">
                <span>Estimated Gross Profit (after purchase cost)</span>
                <span className="font-mono font-semibold tabular-nums">
                  ₹{cartTotals.grossProfit.toFixed(2)}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              {paymentMethod === 'UPI' && (
                <button
                  type="button"
                  onClick={handleOpenUpiQr}
                  disabled={submitting || cart.length === 0 || cartTotals.total <= 0}
                  className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-[#0D2818] hover:bg-[#153C24] rounded-lg transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer disabled:opacity-50"
                >
                  <QrCode className="w-4 h-4 text-[#34D399]" />
                  Show UPI Payment QR (₹{cartTotals.total.toFixed(2)})
                </button>
              )}

              <button
                type="submit"
                disabled={submitting || cart.length === 0}
                className="w-full py-3 text-sm font-semibold text-white bg-[#15803D] hover:bg-[#166534] rounded-lg transition-colors cursor-pointer disabled:opacity-50"
              >
                {submitting ? 'Saving Bill & Updating Stock...' : 'Complete Sale & Generate Bill'}
              </button>
            </div>
          </form>
        </div>
      ) : (
        /* Sales History Table */
        <div className="bg-white border border-[#DCE6DF] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#E2EAE4] bg-[#F5F9F6] text-xs font-semibold text-[#4D6154]">
                  <th className="py-3 px-4">Invoice &amp; Date</th>
                  <th className="py-3 px-3">Customer</th>
                  <th className="py-3 px-3">Items</th>
                  <th className="py-3 px-3">Mode</th>
                  <th className="py-3 px-3 text-right">Total (₹)</th>
                  <th className="py-3 px-3 text-right">Gross Profit (₹)</th>
                  <th className="py-3 px-4 text-right">Bill</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EDF2EE] text-xs">
                {salesSummaryByPeriod.filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-[#54695B]">
                      No sales recorded in this period.
                    </td>
                  </tr>
                ) : (
                  salesSummaryByPeriod.filtered.map((s) => (
                    <tr key={s.id} className="hover:bg-[#F9FCF9]">
                      <td className="py-3 px-4">
                        <p className="font-mono font-semibold text-[#0D2818]">{s.invoiceNumber}</p>
                        <p className="text-[#54695B]">{s.saleDate}</p>
                      </td>
                      <td className="py-3 px-3 text-[#111D15]">{s.customerName || 'Walk-in'}</td>
                      <td className="py-3 px-3 text-[#4D6154]">
                        {s.items.length} line{s.items.length === 1 ? '' : 's'} (
                        {s.items.reduce((sum, i) => sum + i.quantity, 0)} qty)
                      </td>
                      <td className="py-3 px-3 text-[#3F5346]">{s.paymentMethod}</td>
                      <td className="py-3 px-3 text-right font-mono font-semibold text-[#0D2818] tabular-nums">
                        ₹{s.totalAmount.toFixed(2)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-semibold text-[#15803D] tabular-nums">
                        ₹{s.grossProfit.toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            setPrintableUpiRef(null);
                            setPrintableBill(s);
                          }}
                          className="inline-flex items-center gap-1 text-[#15803D] hover:underline font-medium cursor-pointer"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          Print
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Printable Retail Bill Modal */}
      {printableBill && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="print-container bg-white border border-[#DCE6DF] rounded-2xl w-full max-w-md p-6">
            <div className="flex items-start justify-between pb-4 border-b border-dashed border-[#C6D5CA]">
              <div>
                <h3 className="font-display text-lg font-bold text-[#0D2818]">
                  {workspace.shop.name}
                </h3>
                <p className="text-xs text-[#54695B]">
                  {workspace.shop.address || `${workspace.shop.city}, ${workspace.shop.state}`}
                </p>
                {workspace.shop.phone && (
                  <p className="text-xs text-[#54695B]">Ph: {workspace.shop.phone}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setPrintableBill(null)}
                className="no-print p-1 text-[#54695B] hover:text-[#0D2818] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="py-3 text-xs flex justify-between border-b border-dashed border-[#C6D5CA]">
              <div>
                <p className="font-mono font-semibold text-[#0D2818]">{printableBill.invoiceNumber}</p>
                <p className="text-[#54695B]">Customer: {printableBill.customerName || 'Walk-in'}</p>
              </div>
              <div className="text-right">
                <p className="font-mono text-[#0D2818]">{printableBill.saleDate}</p>
                <p className="text-[#54695B]">Paid via {printableBill.paymentMethod}</p>
                {printableUpiRef && printableBill.paymentMethod === 'UPI' && (
                  <p className="font-mono text-[10px] text-[#15803D]">UPI Ref: {printableUpiRef}</p>
                )}
              </div>
            </div>

            <table className="w-full text-xs my-3">
              <thead>
                <tr className="border-b border-[#E2EAE4] text-[#54695B]">
                  <th className="py-1.5 text-left">Item</th>
                  <th className="py-1.5 text-right">Qty</th>
                  <th className="py-1.5 text-right">Rate</th>
                  <th className="py-1.5 text-right">Amt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F2]">
                {printableBill.items.map((item, idx) => (
                  <tr key={idx}>
                    <td className="py-1.5 pr-2 text-[#0D2818]">{item.productName}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums">{item.quantity}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums">₹{item.unitPrice}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums">
                      ₹{item.lineTotal.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="pt-3 border-t border-dashed border-[#C6D5CA] space-y-1 text-xs">
              <div className="flex justify-between text-[#54695B]">
                <span>Subtotal</span>
                <span className="font-mono tabular-nums">₹{printableBill.subtotal.toFixed(2)}</span>
              </div>
              {printableBill.discount > 0 && (
                <div className="flex justify-between text-[#54695B]">
                  <span>Discount</span>
                  <span className="font-mono tabular-nums">-₹{printableBill.discount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-bold text-[#0D2818] pt-1">
                <span>Grand Total</span>
                <span className="font-mono tabular-nums">₹{printableBill.totalAmount.toFixed(2)}</span>
              </div>
            </div>

            <p className="mt-4 text-center text-[11px] text-[#54695B]">
              Thank you for shopping at {workspace.shop.name}!
            </p>

            <div className="no-print mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setPrintableBill(null);
                  setPrintableUpiRef(null);
                }}
                className="px-4 py-2 text-xs font-medium text-[#3F5346] bg-[#F2F7F3] rounded-lg cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#15803D] hover:bg-[#166534] rounded-lg cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                Print Receipt
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Customer Scan & Pay UPI QR Modal */}
      {upiModalOpen && (
        <div className="no-print fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4">
          <div className="bg-white border border-[#DCE6DF] rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="px-5 py-4 bg-[#0D2818] text-white flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <Smartphone className="w-4 h-4 text-[#34D399] shrink-0" />
                <div className="min-w-0">
                  <h3 className="font-display text-base font-bold truncate">UPI Scan &amp; Pay</h3>
                  <p className="text-[11px] text-emerald-200/80 truncate">
                    {upiConfig.payeeName || workspace.shop.name}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setUpiModalOpen(false)}
                aria-label="Close UPI QR modal"
                className="p-1.5 text-emerald-100/80 hover:text-white rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="text-center space-y-1">
                <p className="text-xs font-medium text-[#54695B]">Exact Payable Bill Amount</p>
                <p className="font-mono text-3xl font-bold text-[#0D2818] tabular-nums">
                  ₹{cartTotals.total.toFixed(2)}
                </p>
                <p className="text-[11px] text-[#54695B]">
                  {cart.length} product{cart.length === 1 ? '' : 's'} ({cart.reduce((s, l) => s + l.quantity, 0)} qty) · Ref{' '}
                  <span className="font-mono font-semibold text-[#0D2818]">{upiRef}</span>
                </p>
              </div>

              {/* Scannable QR Display */}
              <div className="mx-auto w-fit p-3.5 bg-white border-2 border-[#0D2818] rounded-2xl shadow-xs">
                {upiQrLoading ? (
                  <div className="w-[240px] h-[240px] flex items-center justify-center text-xs text-[#54695B]">
                    Generating UPI QR...
                  </div>
                ) : upiQrDataUrl ? (
                  <img
                    src={upiQrDataUrl}
                    alt={`UPI QR code for ₹${cartTotals.total.toFixed(2)} to ${upiConfig.vpa}`}
                    className="w-[240px] h-[240px] block"
                  />
                ) : (
                  <div className="w-[240px] h-[240px] flex items-center justify-center text-xs text-[#B91C1C] text-center px-4">
                    Could not render QR code. Verify the merchant UPI ID.
                  </div>
                )}
              </div>

              <div className="text-center space-y-1">
                <p className="text-xs font-semibold text-[#0D2818]">
                  Scan with Google Pay · PhonePe · Paytm · BHIM · Any UPI App
                </p>
                <p className="font-mono text-xs text-[#15803D]">{upiConfig.vpa}</p>
                {!upiConfig.isConfigured && (
                  <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5 mt-1.5">
                    Demo default VPA active. Click &ldquo;Edit UPI ID&rdquo; on the billing panel to save your shop&rsquo;s real UPI ID.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => void handleCopyUpiUri()}
                  className="inline-flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold text-[#0D2818] bg-[#F2F7F3] hover:bg-[#E4EFE7] border border-[#C6D5CA] rounded-lg whitespace-nowrap cursor-pointer"
                >
                  {copiedUpi ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-[#15803D]" />
                      Copied UPI Link
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      Copy UPI Link
                    </>
                  )}
                </button>
                <a
                  href={upiUri || '#'}
                  className="inline-flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold text-[#0D2818] bg-[#F2F7F3] hover:bg-[#E4EFE7] border border-[#C6D5CA] rounded-lg whitespace-nowrap"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open UPI App
                </a>
              </div>

              <div className="pt-2 border-t border-[#EDF2EE] space-y-2">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void completeSale('UPI', upiRef)}
                  className="w-full py-3 px-4 text-sm font-semibold text-white bg-[#15803D] hover:bg-[#166534] rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                >
                  {submitting
                    ? 'Recording UPI Sale...'
                    : `Payment Received — Complete Sale (₹${cartTotals.total.toFixed(2)})`}
                </button>
                <button
                  type="button"
                  onClick={() => setUpiModalOpen(false)}
                  className="w-full py-2 text-xs font-medium text-[#54695B] hover:text-[#0D2818] cursor-pointer"
                >
                  Back to Bill
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
