import type { Product } from '../types/dukaaniq.ts';

export type VoiceLangCode = 'en-IN' | 'hi-IN' | 'kn-IN';

export interface VoiceLanguageOption {
  code: VoiceLangCode;
  shortLabel: string;
  label: string;
  geminiLanguageName: string;
}

export const VOICE_LANGUAGES: VoiceLanguageOption[] = [
  { code: 'en-IN', shortLabel: 'EN', label: 'English (India)', geminiLanguageName: 'English' },
  { code: 'hi-IN', shortLabel: 'HI', label: 'हिन्दी (Hindi)', geminiLanguageName: 'Hindi' },
  { code: 'kn-IN', shortLabel: 'KN', label: 'ಕನ್ನಡ (Kannada)', geminiLanguageName: 'Kannada' },
];

export interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}

export interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

export interface SpeechRecognitionResultListLike {
  readonly length: number;
  [index: number]: SpeechRecognitionResultLike;
}

export interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultListLike;
}

export interface SpeechRecognitionErrorEventLike {
  readonly error: string;
  readonly message?: string;
}

export interface SpeechRecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

interface WindowWithSpeech extends Window {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as WindowWithSpeech;
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function createSpeechRecognition(
  lang: VoiceLangCode,
  options?: { continuous?: boolean; interimResults?: boolean }
): SpeechRecognitionInstance | null {
  if (typeof window === 'undefined') return null;
  const w = window as WindowWithSpeech;
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
  if (!Ctor) return null;

  const rec = new Ctor();
  rec.lang = lang;
  rec.continuous = options?.continuous ?? false;
  rec.interimResults = options?.interimResults ?? true;
  rec.maxAlternatives = 2;
  return rec;
}

export function speakText(text: string, lang: VoiceLangCode = 'en-IN'): void {
  if (!isSpeechSynthesisSupported() || !text.trim()) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = 1.02;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
  } catch {
    // Ignore browser autoplay or TTS restrictions cleanly
  }
}

export function stopSpeaking(): void {
  if (!isSpeechSynthesisSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // Ignore
  }
}

const WORD_NUMBERS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  to: 2,
  too: 2,
  three: 3,
  four: 4,
  for: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  dozen: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  // Hindi transliterated numbers
  ek: 1,
  do: 2,
  teen: 3,
  char: 4,
  paanch: 5,
  panch: 5,
  chhe: 6,
  saat: 7,
  aath: 8,
  nau: 9,
  das: 10,
  // Kannada transliterated numbers
  ondu: 1,
  eradu: 2,
  mooru: 3,
  muru: 3,
  naalku: 4,
  nalku: 4,
  aidu: 5,
  aaru: 6,
  elu: 7,
  entu: 8,
  ombattu: 9,
  hattu: 10,
};

const STOP_WORDS = new Set([
  'add',
  'put',
  'bill',
  'cart',
  'in',
  'to',
  'the',
  'my',
  'of',
  'please',
  'item',
  'items',
  'product',
  'products',
  'pack',
  'packs',
  'packet',
  'packets',
  'bag',
  'bags',
  'bottle',
  'bottles',
  'piece',
  'pieces',
  'pcs',
  'unit',
  'units',
  'box',
  'boxes',
  'tin',
  'tins',
  'jodo',
  'dalo',
  'daalo',
  'serisu',
  'haku',
  'remove',
  'delete',
  'hatao',
  'nikalo',
  'tege',
  'from',
]);

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[-_/.,]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(' ')
    .filter((t) => t.length > 0 && !STOP_WORDS.has(t));
}

function extractLeadingQuantity(clause: string): { quantity: number; remainder: string; explicitQty: boolean } {
  const cleaned = clause
    .replace(/^(please\s+)?(add|put|include|bill|buy|give\s+me|jodo|dalo|daalo|serisu|haku)\s+/i, '')
    .replace(/\s+(to|in|into)\s+(the\s+)?(cart|bill|basket)$/i, '')
    .replace(/\s+(jodo|dalo|daalo|serisu|haku)$/i, '')
    .trim();

  if (!cleaned) return { quantity: 1, remainder: '', explicitQty: false };

  const words = cleaned.split(/\s+/);
  const first = words[0].toLowerCase();

  // Handle "half dozen"
  if (words.length >= 2 && first === 'half' && words[1].toLowerCase() === 'dozen') {
    return { quantity: 6, remainder: words.slice(2).join(' ').trim(), explicitQty: true };
  }

  // Handle numeric digits like "2 atta" or "3x maggi"
  const digitMatch = first.match(/^(\d+)x?$/);
  if (digitMatch && words.length >= 2) {
    const qty = Math.max(1, Math.min(99, parseInt(digitMatch[1], 10)));
    return { quantity: qty, remainder: words.slice(1).join(' ').trim(), explicitQty: true };
  }

  // Handle word numbers like "two atta" or "do parle g"
  // Avoid treating "to" or "for" as quantity unless followed by a noun
  if (first in WORD_NUMBERS && words.length >= 2) {
    const qty = WORD_NUMBERS[first];
    return { quantity: qty, remainder: words.slice(1).join(' ').trim(), explicitQty: true };
  }

  // Handle trailing quantity like "atta 2"
  const last = words[words.length - 1].toLowerCase();
  const trailingDigit = last.match(/^(\d+)$/);
  if (trailingDigit && words.length >= 2 && !/^\d+(g|kg|ml|l|gm)$/i.test(last)) {
    const qty = Math.max(1, Math.min(99, parseInt(trailingDigit[1], 10)));
    return { quantity: qty, remainder: words.slice(0, -1).join(' ').trim(), explicitQty: true };
  }

  return { quantity: 1, remainder: cleaned, explicitQty: false };
}

export function matchProductByPhrase(phrase: string, products: Product[]): Product | null {
  const normPhrase = normalizeText(phrase);
  if (!normPhrase) return null;

  const queryTokens = tokenize(normPhrase);
  if (queryTokens.length === 0) return null;

  let bestProduct: Product | null = null;
  let bestScore = 0;

  for (const product of products) {
    const normName = normalizeText(product.name);
    const normBrand = normalizeText(product.brand || '');
    const normCategory = normalizeText(product.category);
    const normSku = normalizeText(product.sku);
    const normBarcode = normalizeText(product.barcode || '');
    const combined = `${normName} ${normBrand} ${normCategory} ${normSku}`;
    const targetTokens = normalizeText(combined).split(' ').filter(Boolean);

    let score = 0;

    if (normName === normPhrase || normSku === normPhrase || (normBarcode && normBarcode === normPhrase)) {
      score += 120;
    } else if (normName.includes(normPhrase)) {
      score += 75;
    } else if (combined.includes(normPhrase)) {
      score += 50;
    }

    let matchedTokenCount = 0;
    for (const qt of queryTokens) {
      if (qt.length < 2) continue;
      if (targetTokens.includes(qt)) {
        score += 30;
        matchedTokenCount += 1;
      } else if (targetTokens.some((tt) => tt.startsWith(qt) || (qt.length >= 4 && tt.includes(qt)))) {
        score += 18;
        matchedTokenCount += 1;
      } else if (normName.includes(qt)) {
        score += 16;
        matchedTokenCount += 1;
      }
    }

    // Bonus for covering all query tokens
    if (queryTokens.length > 0 && matchedTokenCount === queryTokens.length) {
      score += 25;
    }

    // Small preference for in-stock items on ties
    if (score > 0 && product.currentStock > 0) {
      score += 3;
    }

    if (score > bestScore) {
      bestScore = score;
      bestProduct = product;
    }
  }

  // Require a minimum meaningful score so random chatter doesn't add wrong items
  return bestScore >= 24 ? bestProduct : null;
}

export type ParsedSalesVoiceCommand =
  | { type: 'search'; query: string; raw: string }
  | { type: 'clear_search'; raw: string }
  | { type: 'clear_cart'; raw: string }
  | {
      type: 'remove';
      items: Array<{ product: Product; quantity?: number }>;
      unmatched: string[];
      raw: string;
    }
  | {
      type: 'add';
      items: Array<{ product: Product; quantity: number }>;
      unmatched: string[];
      raw: string;
    }
  | { type: 'unknown'; raw: string; suggestion: string };

export function parseSalesVoiceCommand(
  rawTranscript: string,
  products: Product[]
): ParsedSalesVoiceCommand {
  const raw = rawTranscript.trim();
  const normalized = normalizeText(raw);

  if (!normalized) {
    return {
      type: 'unknown',
      raw,
      suggestion: 'Try saying "Add 2 Atta", "Search Cooking Oil", or "Clear cart".',
    };
  }

  // 1. Clear search
  if (
    /^(clear|reset|remove|cancel)\s+(the\s+)?(search|filter)$/.test(normalized) ||
    /^(show\s+all(\s+products|\s+items)?|sab\s+dikhao)$/.test(normalized)
  ) {
    return { type: 'clear_search', raw };
  }

  // 2. Clear cart
  if (
    /^(clear|empty|reset|cancel)\s+(the\s+)?(cart|bill|basket)$/.test(normalized) ||
    /^(cart|bill)\s+(khali|clear)\s*(karo)?$/.test(normalized)
  ) {
    return { type: 'clear_cart', raw };
  }

  // 3. Search / Find product
  const searchMatch = normalized.match(
    /^(search|find|show|filter|lookup|look\s+up|khojo|dhoondo|dhundo|huduku)\s+(for\s+)?(.+)$/
  );
  if (searchMatch && searchMatch[3]) {
    const query = searchMatch[3]
      .replace(/\s+(products|items|product|item)$/i, '')
      .trim();
    if (query) {
      return { type: 'search', query, raw };
    }
  }

  // 4. Remove from cart
  const removeMatch = normalized.match(/^(remove|delete|drop|hatao|nikalo|tege)\s+(.+)$/);
  if (removeMatch && removeMatch[2]) {
    const clauses = removeMatch[2]
      .split(/\s+(?:and|aur|mattu)\s+|,\s*/i)
      .map((c) => c.trim())
      .filter(Boolean);
    const items: Array<{ product: Product; quantity?: number }> = [];
    const unmatched: string[] = [];

    for (const clause of clauses) {
      const { quantity, remainder, explicitQty } = extractLeadingQuantity(clause);
      const matched = matchProductByPhrase(remainder || clause, products);
      if (matched) {
        items.push({ product: matched, quantity: explicitQty ? quantity : undefined });
      } else {
        unmatched.push(clause);
      }
    }

    if (items.length > 0 || unmatched.length > 0) {
      return { type: 'remove', items, unmatched, raw };
    }
  }

  // 5. Add to cart (supports multi-item "add 2 atta and 3 parle g" or direct "2 sunflower oil")
  const hasExplicitAddVerb = /^(please\s+)?(add|put|include|bill|buy|give\s+me|jodo|dalo|daalo|serisu|haku)\b/i.test(
    normalized
  );

  const clauses = normalized
    .split(/\s+(?:and|aur|mattu|plus)\s+|,\s*/i)
    .map((c) => c.trim())
    .filter(Boolean);

  const matchedAdds: Array<{ product: Product; quantity: number }> = [];
  const unmatched: string[] = [];

  for (const clause of clauses) {
    const { quantity, remainder } = extractLeadingQuantity(clause);
    const targetPhrase = remainder || clause;
    const matched = matchProductByPhrase(targetPhrase, products);
    if (matched) {
      const existing = matchedAdds.find((item) => item.product.id === matched.id);
      if (existing) {
        existing.quantity += quantity;
      } else {
        matchedAdds.push({ product: matched, quantity });
      }
    } else if (hasExplicitAddVerb || clauses.length > 1) {
      unmatched.push(targetPhrase);
    }
  }

  if (matchedAdds.length > 0) {
    return { type: 'add', items: matchedAdds, unmatched, raw };
  }

  if (hasExplicitAddVerb) {
    return { type: 'add', items: [], unmatched: unmatched.length ? unmatched : [normalized], raw };
  }

  // 6. Fallback: treat short unrecognized noun phrase as product search so shopkeeper sees matches
  if (normalized.split(' ').length <= 3) {
    return { type: 'search', query: normalized, raw };
  }

  return {
    type: 'unknown',
    raw,
    suggestion: 'Say "Add 2 Atta", "Add 1 Maggi and 2 Parle-G", "Search Oil", or "Clear cart".',
  };
}

export interface VoiceAdvisorSnapshot {
  shopName: string;
  city: string;
  totalProducts: number;
  stockValueINR: number;
  todayRevenueINR: number;
  revenueLast7dINR: number;
  grossProfitLast7dINR: number;
  lowStockItems: Array<{ name: string; currentStock: number; minStockLevel: number; unit: string }>;
  outOfStockNames: string[];
  expiredBatchCount: number;
  expiringSoonItems: Array<{ productName: string; quantity: number; expiryDate: string }>;
  deadStockNames: string[];
  topMovers: Array<{ name: string; dailyAvg: number }>;
  pendingReordersCount: number;
  activeGroupOrders: Array<{ productName: string; combinedQty: number; minBulkQty: number; estSavingsINR: number }>;
  activeDeliveryRunsCount: number;
}

export function buildLocalVoiceAdvisorFallback(
  question: string,
  snapshot: VoiceAdvisorSnapshot
): string {
  const q = question.toLowerCase();

  if (q.includes('low') || q.includes('stockout') || q.includes('reorder') || q.includes('kam')) {
    if (snapshot.lowStockItems.length === 0 && snapshot.outOfStockNames.length === 0) {
      return `All ${snapshot.totalProducts} products at ${snapshot.shopName} are currently above minimum stock thresholds, with ${snapshot.pendingReordersCount} pending reorder suggestions.`;
    }
    const lowNames = snapshot.lowStockItems
      .slice(0, 4)
      .map((i) => `${i.name} (${i.currentStock} ${i.unit} left)`)
      .join(', ');
    const oosPart =
      snapshot.outOfStockNames.length > 0
        ? ` Out of stock: ${snapshot.outOfStockNames.slice(0, 3).join(', ')}.`
        : '';
    return `You have ${snapshot.lowStockItems.length} low-stock items including ${lowNames}.${oosPart} Review ${snapshot.pendingReordersCount} pending reorders in the Reorder Engine.`;
  }

  if (q.includes('expir') || q.includes('fefo') || q.includes('waste') || q.includes('kharab')) {
    const soon = snapshot.expiringSoonItems
      .slice(0, 3)
      .map((b) => `${b.productName} (${b.quantity} units by ${b.expiryDate})`)
      .join(', ');
    return `You have ${snapshot.expiredBatchCount} expired active batches to remove immediately, and ${snapshot.expiringSoonItems.length} batches expiring within 15 days${soon ? `, led by ${soon}` : ''}. Open Expiry & FEFO to prioritize selling or transfer stock.`;
  }

  if (q.includes('group') || q.includes('save') || q.includes('bulk') || q.includes('pool')) {
    if (snapshot.activeGroupOrders.length === 0) {
      return 'There are no open group purchase pools right now. Visit Group Purchasing to combine orders with nearby village shops.';
    }
    const totalSave = snapshot.activeGroupOrders.reduce((s, g) => s + g.estSavingsINR, 0);
    const top = snapshot.activeGroupOrders[0];
    return `You have ${snapshot.activeGroupOrders.length} active group orders with an estimated combined savings of ₹${Math.round(totalSave).toLocaleString('en-IN')}. Top pool: ${top.productName} (${top.combinedQty}/${top.minBulkQty} bulk target).`;
  }

  if (q.includes('delivery') || q.includes('route') || q.includes('tempo') || q.includes('truck')) {
    return `${snapshot.activeDeliveryRunsCount} rural delivery runs are currently tracked in Delivery & Logistics with Nearest-Neighbor + 2-Opt route optimization and shared per-shop transport savings.`;
  }

  if (q.includes('dead') || q.includes('slow')) {
    return snapshot.deadStockNames.length > 0
      ? `Dead stock with zero sales in 30 days includes ${snapshot.deadStockNames.slice(0, 4).join(', ')}. Consider bundle offers or inter-shop transfer.`
      : 'No dead stock items with zero 30-day sales are flagged right now.';
  }

  return `${snapshot.shopName} (${snapshot.city}) recorded ₹${Math.round(snapshot.todayRevenueINR).toLocaleString('en-IN')} today and ₹${Math.round(snapshot.revenueLast7dINR).toLocaleString('en-IN')} in the last 7 days (₹${Math.round(snapshot.grossProfitLast7dINR).toLocaleString('en-IN')} gross profit). Watch ${snapshot.lowStockItems.length} low-stock items and ${snapshot.expiringSoonItems.length} batches expiring soon.`;
}
