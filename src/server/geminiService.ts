import { GoogleGenAI, Type } from '@google/genai';
import type { InvoiceOcrResult } from '../types/dukaaniq.ts';

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

export interface WeeklySummaryMetrics {
  shopName: string;
  city: string;
  isSampleData: boolean;
  totalProducts: number;
  stockValueINR: number;
  revenueLast7dINR: number;
  grossProfitLast7dINR: number;
  lowStockCount: number;
  outOfStockCount: number;
  expiredBatchCount: number;
  expiring15dCount: number;
  moneyAtExpiryRiskINR: number;
  fastMovers: Array<{ name: string; dailyAvg: number; stock: number }>;
  deadStockNames: string[];
  upcomingFestivals: Array<{ name: string; date: string; focus: string }>;
}

export async function generateKiranaExecutiveSummary(
  metrics: WeeklySummaryMetrics
): Promise<string> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }

  const prompt = `
Analyze the following ACTUAL recorded rural Kirana store snapshot for GRAMSETU AI and write a clear, practical weekly business brief for the shopkeeper in simple everyday English (no technical jargon, no invented numbers).

Shop Snapshot:
- Shop: ${metrics.shopName} (${metrics.city})${metrics.isSampleData ? ' [Sample Demo Store]' : ''}
- Catalog size: ${metrics.totalProducts} products | Stock value at cost: ₹${Math.round(metrics.stockValueINR).toLocaleString('en-IN')}
- Last 7 days revenue: ₹${Math.round(metrics.revenueLast7dINR).toLocaleString('en-IN')} | Gross profit: ₹${Math.round(metrics.grossProfitLast7dINR).toLocaleString('en-IN')}
- Low stock items: ${metrics.lowStockCount} | Out of stock items: ${metrics.outOfStockCount}
- Expired batches still active: ${metrics.expiredBatchCount} | Batches expiring within 15 days: ${metrics.expiring15dCount} (₹${Math.round(metrics.moneyAtExpiryRiskINR).toLocaleString('en-IN')} at cost)
- Fast movers: ${metrics.fastMovers.map((m) => `${m.name} (${m.dailyAvg.toFixed(1)}/day, ${m.stock} left)`).join('; ') || 'None recorded'}
- Dead stock (0 sales in 30d): ${metrics.deadStockNames.join(', ') || 'None'}
- Upcoming festivals: ${metrics.upcomingFestivals.map((f) => `${f.name} on ${f.date} (${f.focus})`).join('; ') || 'None'}

Format strictly into 4 concise bulleted takeaways (max 2 sentences each):
1. Immediate Stock & Cash-Flow Priority
2. FEFO Expiry, Wastage & Inter-Shop Transfer Protection (never suggest selling expired goods)
3. Fast-Mover & Margin Opportunity
4. Next 7-Day Buying & Festival Preparation

Keep it under 190 words. Use exact Indian Rupee (₹) numbers strictly from the snapshot above. Clearly distinguish observed data from estimates or suggestions.
`.trim();

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: prompt,
    config: {
      systemInstruction:
        'You are GRAMSETU AI, a practical rural retail advisor for Indian Kirana shopkeepers. Be concise, honest, and grounded strictly in the provided figures. Never fabricate numbers or suggest selling expired items.',
    },
  });

  const text = response.text?.trim();
  if (!text) {
    throw new Error('Model returned an empty business summary.');
  }
  return text;
}

export async function extractInvoiceItemsFromImage(
  base64Data: string,
  mimeType: string
): Promise<InvoiceOcrResult> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }

  const cleanBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
  const safeMime = mimeType || 'image/jpeg';

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: safeMime,
            data: cleanBase64,
          },
        },
        {
          text:
            'Extract all wholesale/grocery purchase invoice items from this image for a Kirana store inventory import. ' +
            'Return strict JSON with vendorName, invoiceNumber, invoiceDate (YYYY-MM-DD or empty), notes, and items array. ' +
            'For each item provide: name, category (one of: Staples & Grains, Cooking Oils, Pulses, Biscuits & Snacks, Beverages, Dairy & Bakery, Spices & Masala, Home Care, Personal Care, Dry Fruits, Other), ' +
            'brand, unit (e.g. bag, pack, bottle, kg, pcs), quantity (integer >= 1), purchasePrice (unit purchase rate in INR), sellingPrice (MRP or estimated selling price >= purchasePrice), optional batchNumber, and optional expiryDate (YYYY-MM-DD if clearly printed, else empty string). ' +
            'Never invent items that are not visible on the invoice.',
        },
      ],
    },
    config: {
      systemInstruction:
        'You are an accurate wholesale grocery invoice OCR extractor. Extract only items visible in the uploaded invoice image. If a field is unreadable, leave it empty or conservatively estimated and mention it in notes.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          vendorName: { type: Type.STRING },
          invoiceNumber: { type: Type.STRING },
          invoiceDate: { type: Type.STRING },
          notes: { type: Type.STRING },
          items: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                category: { type: Type.STRING },
                brand: { type: Type.STRING },
                unit: { type: Type.STRING },
                quantity: { type: Type.INTEGER },
                purchasePrice: { type: Type.NUMBER },
                sellingPrice: { type: Type.NUMBER },
                batchNumber: { type: Type.STRING },
                expiryDate: { type: Type.STRING },
              },
              required: ['name', 'category', 'unit', 'quantity', 'purchasePrice', 'sellingPrice'],
            },
          },
        },
        required: ['vendorName', 'items'],
      },
    },
  });

  const raw = (response.text || '').trim();
  if (!raw) {
    throw new Error('Could not extract structured items from this invoice image.');
  }

  const parsed = JSON.parse(raw) as InvoiceOcrResult;
  return {
    vendorName: parsed.vendorName || 'Wholesale Supplier',
    invoiceNumber: parsed.invoiceNumber || '',
    invoiceDate: parsed.invoiceDate || '',
    notes: parsed.notes || 'Verify extracted quantities, rates, and expiry dates before saving to inventory.',
    items: Array.isArray(parsed.items)
      ? parsed.items
          .filter((i) => i && i.name && i.name.trim())
          .map((i) => ({
            name: String(i.name).trim(),
            category: String(i.category || 'Other'),
            brand: String(i.brand || ''),
            unit: String(i.unit || 'pcs'),
            quantity: Math.max(1, Math.round(Number(i.quantity || 1))),
            purchasePrice: Math.max(0, Number(i.purchasePrice || 0)),
            sellingPrice: Math.max(1, Number(i.sellingPrice || Number(i.purchasePrice || 0) * 1.15 || 10)),
            batchNumber: i.batchNumber ? String(i.batchNumber).trim() : '',
            expiryDate: i.expiryDate && /^\d{4}-\d{2}-\d{2}$/.test(String(i.expiryDate).trim())
              ? String(i.expiryDate).trim()
              : '',
          }))
      : [],
  };
}

export interface VoiceAdvisorSnapshotPayload {
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
  activeGroupOrders: Array<{
    productName: string;
    combinedQty: number;
    minBulkQty: number;
    estSavingsINR: number;
  }>;
  activeDeliveryRunsCount: number;
}

export async function answerShopkeeperVoiceQuery(
  question: string,
  languageName: string,
  snapshot: VoiceAdvisorSnapshotPayload
): Promise<string> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }

  const prompt = `
Answer the rural Kirana shopkeeper's voice question clearly and practically in ${languageName}.
Keep your reply concise (2 to 4 short sentences, under 75 words) and natural to read aloud via voice synthesis. Do not use markdown asterisks or bullet symbols. Never invent figures not present in the snapshot below, and never suggest selling expired products.

Live Shop Snapshot:
- Shop: ${snapshot.shopName} (${snapshot.city})
- Catalog: ${snapshot.totalProducts} products | Stock value: ₹${Math.round(snapshot.stockValueINR).toLocaleString('en-IN')}
- Today's sales: ₹${Math.round(snapshot.todayRevenueINR).toLocaleString('en-IN')}
- Last 7d sales: ₹${Math.round(snapshot.revenueLast7dINR).toLocaleString('en-IN')} | Gross profit: ₹${Math.round(snapshot.grossProfitLast7dINR).toLocaleString('en-IN')}
- Low stock (${snapshot.lowStockItems.length}): ${snapshot.lowStockItems.slice(0, 6).map((i) => `${i.name} (${i.currentStock}/${i.minStockLevel} ${i.unit})`).join(', ') || 'None'}
- Out of stock (${snapshot.outOfStockNames.length}): ${snapshot.outOfStockNames.slice(0, 5).join(', ') || 'None'}
- Expired active batches: ${snapshot.expiredBatchCount} | Expiring within 15d (${snapshot.expiringSoonItems.length}): ${snapshot.expiringSoonItems.slice(0, 5).map((b) => `${b.productName} ${b.quantity} qty by ${b.expiryDate}`).join(', ') || 'None'}
- Top fast movers: ${snapshot.topMovers.slice(0, 4).map((m) => `${m.name} (${m.dailyAvg.toFixed(1)}/day)`).join(', ') || 'None'}
- Dead stock: ${snapshot.deadStockNames.slice(0, 4).join(', ') || 'None'}
- Pending reorders: ${snapshot.pendingReordersCount}
- Active group orders (${snapshot.activeGroupOrders.length}): ${snapshot.activeGroupOrders.slice(0, 3).map((g) => `${g.productName} ${g.combinedQty}/${g.minBulkQty} est savings ₹${Math.round(g.estSavingsINR)}`).join('; ') || 'None'}
- Active delivery runs: ${snapshot.activeDeliveryRunsCount}

Shopkeeper's question: "${question}"
`.trim();

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: prompt,
    config: {
      systemInstruction:
        'You are GRAMSETU AI Voice Advisor for Indian rural Kirana shopkeepers. Give accurate, spoken-friendly answers strictly grounded in the shop snapshot provided.',
    },
  });

  const text = response.text?.trim();
  if (!text) {
    throw new Error('Voice advisor returned an empty response.');
  }
  return text;
}

