import { Router, Response } from 'express';
import { AuthRequest, requireAuth } from '../middleware/auth.ts';
import {
  adjustProductStock,
  assertShopOwnership,
  createDeliveryRunRecord,
  createDistributorOfferRecord,
  createFestivalRecord,
  createGroupOrderRecord,
  createProductRecord,
  createPurchaseOrderRecord,
  createShop,
  createStockTransferRecord,
  createSupplierRecord,
  decideReorderRecommendation,
  deleteProductRecord,
  getShopWorkspace,
  joinOrUpdateGroupOrder,
  listUserShops,
  markAllNotificationsRead,
  receivePurchaseOrder,
  recordSaleTransaction,
  recordSupplierPayment,
  regenerateReordersForShop,
  removeExpiredOrDamagedBatch,
  seedSampleDataIntoShop,
  toggleFestivalDismissed,
  updateDeliveryRunStatusRecord,
  updateDeliveryStopStatusRecord,
  updateDistributorOfferRecord,
  updateGroupOrderAction,
  updateProductRecord,
  updateShopProfile,
  updateStockTransferApproval,
  upsertVillageDemandOptIn,
} from '../db/shopRepository.ts';
import {
  answerShopkeeperVoiceQuery,
  extractInvoiceItemsFromImage,
  generateKiranaExecutiveSummary,
  VoiceAdvisorSnapshotPayload,
  WeeklySummaryMetrics,
} from './geminiService.ts';
import { computeProductForecasts } from '../services/intelligenceEngine.ts';

export const apiRouter = Router();

function parsePositiveInt(raw: string): number | null {
  const num = Number(raw);
  return Number.isInteger(num) && num > 0 ? num : null;
}

async function verifyOwnedShop(req: AuthRequest, res: Response): Promise<number | null> {
  const shopId = parsePositiveInt(String(req.params.shopId || ''));
  if (!shopId) {
    res.status(400).json({ error: 'Invalid shop ID.' });
    return null;
  }
  const owned = await assertShopOwnership(shopId, req.user!.uid);
  if (!owned) {
    res.status(403).json({ error: 'Access denied for this shop.' });
    return null;
  }
  return shopId;
}

function mapWmoWeatherCode(code: number): string {
  if (code === 0) return 'Clear Sky';
  if (code >= 1 && code <= 3) return 'Partly Cloudy';
  if (code >= 45 && code <= 48) return 'Foggy / Misty';
  if (code >= 51 && code <= 57) return 'Light Drizzle';
  if (code >= 61 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow / Sleet';
  if (code >= 80 && code <= 82) return 'Rain Showers';
  if (code >= 95 && code <= 99) return 'Thunderstorm';
  return 'Fair Weather';
}

// Keyless Open-Meteo Weather & 5-Day Forecast endpoint (never blocks inventory or sales)
apiRouter.get('/weather', async (req, res) => {
  const city = String(req.query.city || 'Mysuru').trim();
  const latParam = req.query.lat !== undefined ? Number(req.query.lat) : NaN;
  const lonParam = req.query.lon !== undefined ? Number(req.query.lon) : NaN;
  const updatedAt = new Date().toISOString();

  try {
    let latitude = Number.isFinite(latParam) ? latParam : NaN;
    let longitude = Number.isFinite(lonParam) ? lonParam : NaN;
    let resolvedCity = city;

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;
      const geoResp = await fetch(geoUrl, { signal: AbortSignal.timeout(6000) });
      if (geoResp.ok) {
        const geoData = (await geoResp.json()) as {
          results?: Array<{ name?: string; latitude: number; longitude: number }>;
        };
        if (geoData.results && geoData.results.length > 0) {
          latitude = geoData.results[0].latitude;
          longitude = geoData.results[0].longitude;
          resolvedCity = geoData.results[0].name || city;
        }
      }
    }

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      // Safe fallback coordinates for Mysuru rural cluster if geocoding returned empty
      latitude = 12.2958;
      longitude = 76.6394;
    }

    const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum&forecast_days=5&timezone=auto`;
    const weatherResp = await fetch(forecastUrl, { signal: AbortSignal.timeout(7000) });
    if (!weatherResp.ok) {
      return res.json({
        configured: false,
        source: 'Open-Meteo',
        city: resolvedCity,
        planningNote:
          'Open-Meteo weather feed is temporarily unavailable; inventory and forecasting continue from recorded sales data.',
        updatedAt,
      });
    }

    const data = (await weatherResp.json()) as {
      current?: {
        temperature_2m?: number;
        relative_humidity_2m?: number;
        weather_code?: number;
        wind_speed_10m?: number;
      };
      daily?: {
        time?: string[];
        weather_code?: number[];
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
        precipitation_sum?: number[];
      };
    };

    const temp = Math.round(data.current?.temperature_2m ?? 28);
    const humidity = Math.round(data.current?.relative_humidity_2m ?? 58);
    const windKmh = Math.round(data.current?.wind_speed_10m ?? 10);
    const condition = mapWmoWeatherCode(data.current?.weather_code ?? 0);

    const forecastDays = (data.daily?.time || []).map((date, idx) => ({
      date,
      tempMaxC: Math.round(data.daily?.temperature_2m_max?.[idx] ?? temp),
      tempMinC: Math.round(data.daily?.temperature_2m_min?.[idx] ?? temp - 6),
      condition: mapWmoWeatherCode(data.daily?.weather_code?.[idx] ?? 0),
      rainMm: Number((data.daily?.precipitation_sum?.[idx] ?? 0).toFixed(1)),
    }));

    const rainyUpcoming = forecastDays.some((d) => d.rainMm >= 3);
    const hotUpcoming = temp >= 34 || forecastDays.some((d) => d.tempMaxC >= 36);

    let planningNote =
      'Weather planning signal (advisory, separate from recorded sales history): Mild conditions — follow standard replenishment plan.';
    if (hotUpcoming) {
      planningNote =
        'Weather planning signal (advisory): High daytime heat forecasted — cold beverages, dairy curd, buttermilk, and glucose packs often see increased walk-in demand.';
    } else if (rainyUpcoming || condition.toLowerCase().includes('rain') || condition.toLowerCase().includes('thunder')) {
      planningNote =
        'Weather planning signal (advisory): Rain expected in 5-day forecast — instant noodles, tea, coffee, and biscuits often tick up; watch bakery shelf-life in high humidity.';
    }

    return res.json({
      configured: true,
      source: 'Open-Meteo',
      city: resolvedCity,
      temperatureC: temp,
      condition,
      humidity,
      windKmh,
      planningNote,
      forecastDays,
      updatedAt,
    });
  } catch (error) {
    console.error('Open-Meteo weather fetch failed:', error);
    return res.json({
      configured: false,
      source: 'Open-Meteo',
      city,
      planningNote:
        'Could not reach Open-Meteo weather service; all store forecasting continues strictly from recorded sales data.',
      updatedAt,
    });
  }
});

// Server-side AI Weekly Business Brief (Gemini 4 Hydrogen)
apiRouter.post('/ai/weekly-summary', async (req, res) => {
  try {
    const metrics = req.body as WeeklySummaryMetrics;
    if (!metrics || typeof metrics.totalProducts !== 'number') {
      return res.status(400).json({ error: 'Valid store metrics payload is required.' });
    }
    const summary = await generateKiranaExecutiveSummary(metrics);
    return res.json({
      summary,
      model: 'gemini-4-hydrogen',
      generatedAt: new Date().toISOString(),
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to generate AI business brief.';
    console.error('AI summary error:', error);
    return res.status(502).json({ error: msg });
  }
});

// Server-side Invoice OCR Extraction (Gemini 4 Hydrogen multimodal)
apiRouter.post('/ai/invoice-ocr', async (req, res) => {
  try {
    const { imageBase64, mimeType } = req.body || {};
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return res.status(400).json({ error: 'Invoice image payload (base64) is required.' });
    }
    const cleanBase64 = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
    if (cleanBase64.length < 100) {
      return res.status(400).json({ error: 'Uploaded image appears empty or invalid.' });
    }
    const safeMime =
      typeof mimeType === 'string' && mimeType.startsWith('image/')
        ? mimeType
        : 'image/jpeg';
    const result = await extractInvoiceItemsFromImage(cleanBase64, safeMime);
    return res.json(result);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to extract invoice items.';
    console.error('Invoice OCR error:', error);
    return res.status(502).json({ error: msg });
  }
});

// Server-side Multilingual Shopkeeper Voice AI Advisor (Gemini 4 Hydrogen)
apiRouter.post('/ai/voice-advisor', async (req, res) => {
  try {
    const { question, languageName, snapshot } = req.body || {};
    if (!question || typeof question !== 'string' || !question.trim()) {
      return res.status(400).json({ error: 'A shopkeeper question is required.' });
    }
    if (!snapshot || typeof (snapshot as VoiceAdvisorSnapshotPayload).totalProducts !== 'number') {
      return res.status(400).json({ error: 'Valid shop metrics snapshot is required.' });
    }
    const safeLang =
      typeof languageName === 'string' && languageName.trim() ? languageName.trim() : 'English';
    const reply = await answerShopkeeperVoiceQuery(
      question.trim(),
      safeLang,
      snapshot as VoiceAdvisorSnapshotPayload
    );
    return res.json({
      reply,
      model: 'gemini-4-hydrogen',
      generatedAt: new Date().toISOString(),
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to answer voice query.';
    console.error('Voice advisor error:', error);
    return res.status(502).json({ error: msg });
  }
});

// Authenticated User & Shop Profile Routes (All Cloud SQL access requires verified Firebase Auth)
apiRouter.get('/me', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userShops = await listUserShops(req.user!.uid);
    return res.json({
      user: {
        uid: req.user!.uid,
        email: req.user!.email || '',
        displayName: req.user!.name || req.user!.email?.split('@')[0] || 'Shop Owner',
      },
      shops: userShops,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to load profile.';
    return res.status(500).json({ error: msg });
  }
});

apiRouter.post('/shops', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { name, ownerName, phone, city, state, pincode, address, latitude, longitude, seedSample } =
      req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Shop name is required.' });
    }
    const created = await createShop(req.user!.uid, {
      name: String(name),
      ownerName: String(ownerName || req.user!.name || 'Shop Owner'),
      phone: phone ? String(phone) : undefined,
      city: String(city || 'Mysuru'),
      state: String(state || 'Karnataka'),
      pincode: pincode ? String(pincode) : undefined,
      address: address ? String(address) : undefined,
      latitude: typeof latitude === 'number' ? latitude : null,
      longitude: typeof longitude === 'number' ? longitude : null,
      seedSample: Boolean(seedSample),
    });
    return res.status(201).json(created);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to create shop.';
    return res.status(500).json({ error: msg });
  }
});

apiRouter.put('/shops/:shopId', requireAuth, async (req: AuthRequest, res) => {
  try {
    const shopId = await verifyOwnedShop(req, res);
    if (!shopId) return;
    const updated = await updateShopProfile(shopId, req.user!.uid, req.body || {});
    return res.json(updated);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to update shop.';
    return res.status(500).json({ error: msg });
  }
});

apiRouter.post('/shops/:shopId/seed-sample', requireAuth, async (req: AuthRequest, res) => {
  try {
    const shopId = await verifyOwnedShop(req, res);
    if (!shopId) return;
    await seedSampleDataIntoShop(shopId, req.user!.uid, true);
    const workspace = await getShopWorkspace(shopId);
    return res.json(workspace);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to load sample store data.';
    return res.status(500).json({ error: msg });
  }
});

apiRouter.get('/shops/:shopId/workspace', requireAuth, async (req: AuthRequest, res) => {
  try {
    const shopId = await verifyOwnedShop(req, res);
    if (!shopId) return;
    const workspace = await getShopWorkspace(shopId);
    if (!workspace) return res.status(404).json({ error: 'Shop not found.' });
    return res.json(workspace);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to load workspace.';
    return res.status(500).json({ error: msg });
  }
});

// Products CRUD & CSV Import
apiRouter.post('/shops/:shopId/products', requireAuth, async (req: AuthRequest, res) => {
  try {
    const shopId = await verifyOwnedShop(req, res);
    if (!shopId) return;
    const body = req.body || {};
    if (!body.name || !body.category) {
      return res.status(400).json({ error: 'Product name and category are required.' });
    }
    if (Number(body.purchasePrice) < 0 || Number(body.sellingPrice) <= 0 || Number(body.currentStock) < 0) {
      return res.status(400).json({ error: 'Prices and opening stock must be valid non-negative numbers.' });
    }
    const created = await createProductRecord(shopId, req.user!.uid, {
      name: String(body.name),
      sku: String(body.sku || `SKU-${Date.now().toString().slice(-5)}`),
      barcode: body.barcode ? String(body.barcode) : undefined,
      category: String(body.category),
      brand: body.brand ? String(body.brand) : undefined,
      unit: String(body.unit || 'pcs'),
      purchasePrice: Number(body.purchasePrice),
      sellingPrice: Number(body.sellingPrice),
      currentStock: Math.round(Number(body.currentStock || 0)),
      minStockLevel: Math.max(0, Math.round(Number(body.minStockLevel || 10))),
      maxStockLevel: Math.max(1, Math.round(Number(body.maxStockLevel || 100))),
      supplierId: body.supplierId ? Number(body.supplierId) : null,
      leadTimeDays: Math.max(1, Math.round(Number(body.leadTimeDays || 3))),
      mfgDate: body.mfgDate || undefined,
      expiryDate: body.expiryDate || undefined,
      batchNumber: body.batchNumber || undefined,
    });
    return res.status(201).json(created);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to create product.';
    return res.status(500).json({ error: msg });
  }
});

apiRouter.post('/shops/:shopId/products/import-csv', requireAuth, async (req: AuthRequest, res) => {
  try {
    const shopId = await verifyOwnedShop(req, res);
    if (!shopId) return;
    const rows = Array.isArray(req.body?.products) ? req.body.products : [];
    if (rows.length === 0) {
      return res.status(400).json({ error: 'No valid product rows provided for import.' });
    }
    const imported = [];
    for (const row of rows) {
      if (!row.name || !row.category) continue;
      const created = await createProductRecord(shopId, req.user!.uid, {
        name: String(row.name),
        sku: String(row.sku || `CSV-${Math.floor(1000 + Math.random() * 9000)}`),
        barcode: row.barcode ? String(row.barcode) : undefined,
        category: String(row.category),
        brand: row.brand ? String(row.brand) : undefined,
        unit: String(row.unit || 'pcs'),
        purchasePrice: Math.max(0, Number(row.purchasePrice || 0)),
        sellingPrice: Math.max(1, Number(row.sellingPrice || 1)),
        currentStock: Math.max(0, Math.round(Number(row.currentStock || 0))),
        minStockLevel: Math.max(1, Math.round(Number(row.minStockLevel || 10))),
        maxStockLevel: Math.max(10, Math.round(Number(row.maxStockLevel || 60))),
        expiryDate: row.expiryDate || undefined,
      });
      imported.push(created);
    }
    return res.status(201).json({ importedCount: imported.length, products: imported });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to import CSV products.';
    return res.status(500).json({ error: msg });
  }
});

apiRouter.put('/shops/:shopId/products/:productId', requireAuth, async (req: AuthRequest, res) => {
  try {
    const shopId = await verifyOwnedShop(req, res);
    if (!shopId) return;
    const productId = parsePositiveInt(String(req.params.productId || ''));
    if (!productId) return res.status(400).json({ error: 'Invalid product ID.' });
    const updated = await updateProductRecord(shopId, productId, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Product not found.' });
    return res.json(updated);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to update product.';
    return res.status(500).json({ error: msg });
  }
});

apiRouter.delete('/shops/:shopId/products/:productId', requireAuth, async (req: AuthRequest, res) => {
  try {
    const shopId = await verifyOwnedShop(req, res);
    if (!shopId) return;
    const productId = parsePositiveInt(String(req.params.productId || ''));
    if (!productId) return res.status(400).json({ error: 'Invalid product ID.' });
    const deleted = await deleteProductRecord(shopId, productId);
    if (!deleted) return res.status(404).json({ error: 'Product not found.' });
    return res.json({ deletedId: productId });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to delete product.';
    return res.status(500).json({ error: msg });
  }
});

// Stock Adjustment & Batch Wastage Removal
apiRouter.post('/shops/:shopId/inventory/adjust', requireAuth, async (req: AuthRequest, res) => {
  try {
    const shopId = await verifyOwnedShop(req, res);
    if (!shopId) return;
    const { productId, quantityChange, reason, allowNegative } = req.body || {};
    if (!productId || !Number.isInteger(Number(quantityChange)) || Number(quantityChange) === 0) {
      return res.status(400).json({ error: 'Valid productId and non-zero integer quantityChange are required.' });
    }
    const updated = await adjustProductStock(
      shopId,
      Number(productId),
      Number(quantityChange),
      String(reason || 'Stock audit adjustment'),
      Boolean(allowNegative)
    );
    return res.json(updated);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to adjust stock.';
    const status = msg.includes('negative stock') || msg.includes('not found') ? 400 : 500;
    return res.status(status).json({ error: msg });
  }
});

apiRouter.post('/shops/:shopId/batches/:batchId/remove', requireAuth, async (req: AuthRequest, res) => {
  try {
    const shopId = await verifyOwnedShop(req, res);
    if (!shopId) return;
    const batchId = parsePositiveInt(String(req.params.batchId || ''));
    if (!batchId) return res.status(400).json({ error: 'Invalid batch ID.' });
    const result = await removeExpiredOrDamagedBatch(
      shopId,
      batchId,
      String(req.body?.reason || 'Expired stock removed from shelf')
    );
    return res.json(result);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to remove batch.';
    const status = msg.includes('not found') || msg.includes('already') ? 400 : 500;
    return res.status(status).json({ error: msg });
  }
});

// Sales Billing
apiRouter.post('/shops/:shopId/sales', requireAuth, async (req: AuthRequest, res) => {
  try {
    const shopId = await verifyOwnedShop(req, res);
    if (!shopId) return;
    const { customerName, customerPhone, paymentMethod, discount, saleDate, items } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'At least one product item is required to record a sale.' });
    }
    const created = await recordSaleTransaction(shopId, {
      customerName,
      customerPhone,
      paymentMethod: String(paymentMethod || 'Cash'),
      discount: Number(discount || 0),
      saleDate,
      items: items.map((i: { productId: number; quantity: number }) => ({
        productId: Number(i.productId),
        quantity: Number(i.quantity),
      })),
    });
    return res.status(201).json(created);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to record sale.';
    const status =
      msg.includes('Insufficient stock') || msg.includes('Invalid') || msg.includes('does not exist')
        ? 400
        : 500;
    return res.status(status).json({ error: msg });
  }
});

// Suppliers
apiRouter.post('/shops/:shopId/suppliers', requireAuth, async (req: AuthRequest, res) => {
  try {
    const shopId = await verifyOwnedShop(req, res);
    if (!shopId) return;
    const body = req.body || {};
    if (!body.name || !body.contactPhone) {
      return res.status(400).json({ error: 'Supplier name and contact number are required.' });
    }
    const created = await createSupplierRecord(shopId, {
      name: String(body.name),
      contactPhone: String(body.contactPhone),
      email: body.email ? String(body.email) : undefined,
      address: body.address ? String(body.address) : undefined,
      paymentTerms: String(body.paymentTerms || 'Net 15 Days'),
      leadTimeDays: Number(body.leadTimeDays || 3),
      outstandingAmount: Number(body.outstandingAmount || 0),
      suppliedCategories: body.suppliedCategories ? String(body.suppliedCategories) : undefined,
    });
    return res.status(201).json(created);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to create supplier.';
    return res.status(500).json({ error: msg });
  }
});

apiRouter.post('/shops/:shopId/suppliers/:supplierId/payment', requireAuth, async (req: AuthRequest, res) => {
  try {
    const shopId = await verifyOwnedShop(req, res);
    if (!shopId) return;
    const supplierId = parsePositiveInt(String(req.params.supplierId || ''));
    const amount = Number(req.body?.amount || 0);
    if (!supplierId || amount <= 0) {
      return res.status(400).json({ error: 'Valid supplier ID and positive payment amount are required.' });
    }
    const updated = await recordSupplierPayment(shopId, supplierId, amount);
    return res.json(updated);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to record supplier payment.';
    return res.status(500).json({ error: msg });
  }
});

// Purchases
apiRouter.post('/shops/:shopId/purchases', requireAuth, async (req: AuthRequest, res) => {
  try {
    const shopId = await verifyOwnedShop(req, res);
    if (!shopId) return;
    const { supplierId, notes, orderDate, items } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'At least one purchase item is required.' });
    }
    const created = await createPurchaseOrderRecord(shopId, {
      supplierId: supplierId ? Number(supplierId) : null,
      notes,
      orderDate,
      items: items.map((i: { productId: number; orderedQty: number; unitCost: number; batchNumber?: string; expiryDate?: string }) => ({
        productId: Number(i.productId),
        orderedQty: Number(i.orderedQty),
        unitCost: Number(i.unitCost),
        batchNumber: i.batchNumber,
        expiryDate: i.expiryDate,
      })),
    });
    return res.status(201).json(created);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to create purchase order.';
    return res.status(400).json({ error: msg });
  }
});

apiRouter.post('/shops/:shopId/purchases/:purchaseId/receive', requireAuth, async (req: AuthRequest, res) => {
  try {
    const shopId = await verifyOwnedShop(req, res);
    if (!shopId) return;
    const purchaseId = parsePositiveInt(String(req.params.purchaseId || ''));
    if (!purchaseId) return res.status(400).json({ error: 'Invalid purchase order ID.' });
    const paidAmount = req.body?.paidAmount !== undefined ? Number(req.body.paidAmount) : 0;
    const result = await receivePurchaseOrder(shopId, purchaseId, paidAmount);
    return res.json(result);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to receive purchase order.';
    return res.status(400).json({ error: msg });
  }
});

// Forecasting & Reorders
apiRouter.post('/shops/:shopId/reorders/generate', requireAuth, async (req: AuthRequest, res) => {
  try {
    const shopId = await verifyOwnedShop(req, res);
    if (!shopId) return;
    const summary = await regenerateReordersForShop(shopId);
    const workspace = await getShopWorkspace(shopId);
    const computedForecasts = workspace
      ? computeProductForecasts(workspace.products, workspace.sales, workspace.festivals)
      : [];
    return res.json({ summary, forecasts: computedForecasts, reorders: workspace?.reorders || [] });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to generate forecasts and reorders.';
    return res.status(500).json({ error: msg });
  }
});

apiRouter.post('/shops/:shopId/reorders/:reorderId/action', requireAuth, async (req: AuthRequest, res) => {
  try {
    const shopId = await verifyOwnedShop(req, res);
    if (!shopId) return;
    const reorderId = parsePositiveInt(String(req.params.reorderId || ''));
    const decision = req.body?.decision;
    if (!reorderId || (decision !== 'approved' && decision !== 'rejected')) {
      return res.status(400).json({ error: 'Valid reorderId and decision ("approved" or "rejected") are required.' });
    }
    const editedQty = req.body?.editedQty !== undefined ? Number(req.body.editedQty) : undefined;
    const result = await decideReorderRecommendation(shopId, reorderId, decision, editedQty);
    return res.json(result);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to process reorder decision.';
    return res.status(400).json({ error: msg });
  }
});

// Festivals
apiRouter.post('/shops/:shopId/festivals', requireAuth, async (req: AuthRequest, res) => {
  try {
    const shopId = await verifyOwnedShop(req, res);
    if (!shopId) return;
    const body = req.body || {};
    if (!body.name || !body.festivalDate || !body.focusCategories) {
      return res.status(400).json({ error: 'Festival name, date, and focus categories are required.' });
    }
    const created = await createFestivalRecord(shopId, {
      name: String(body.name),
      festivalDate: String(body.festivalDate),
      category: String(body.category || 'Local Event'),
      expectedUpliftPct: Number(body.expectedUpliftPct || 30),
      focusCategories: String(body.focusCategories),
      notes: body.notes ? String(body.notes) : undefined,
    });
    return res.status(201).json(created);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to create festival.';
    return res.status(500).json({ error: msg });
  }
});

apiRouter.put('/shops/:shopId/festivals/:festivalId', requireAuth, async (req: AuthRequest, res) => {
  try {
    const shopId = await verifyOwnedShop(req, res);
    if (!shopId) return;
    const festivalId = parsePositiveInt(String(req.params.festivalId || ''));
    if (!festivalId) return res.status(400).json({ error: 'Invalid festival ID.' });
    const updated = await toggleFestivalDismissed(shopId, festivalId, Boolean(req.body?.isDismissed));
    return res.json(updated);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to update festival.';
    return res.status(500).json({ error: msg });
  }
});

// Notifications
apiRouter.post('/shops/:shopId/notifications/mark-read', requireAuth, async (req: AuthRequest, res) => {
  try {
    const shopId = await verifyOwnedShop(req, res);
    if (!shopId) return;
    const result = await markAllNotificationsRead(shopId);
    return res.json(result);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to mark notifications read.';
    return res.status(500).json({ error: msg });
  }
});

// Inter-Shop FEFO Stock Transfers (Dual-Owner Approval)
apiRouter.post('/shops/:shopId/transfers', requireAuth, async (req: AuthRequest, res) => {
  try {
    const shopId = await verifyOwnedShop(req, res);
    if (!shopId) return;
    const { productId, batchId, targetShopName, targetVillage, quantity, notes } = req.body || {};
    if (!productId || !targetShopName || !targetVillage || !quantity) {
      return res
        .status(400)
        .json({ error: 'Product, target shop name, village, and quantity are required.' });
    }
    const created = await createStockTransferRecord(shopId, {
      productId: Number(productId),
      batchId: batchId ? Number(batchId) : null,
      targetShopName: String(targetShopName),
      targetVillage: String(targetVillage),
      quantity: Number(quantity),
      notes: notes ? String(notes) : undefined,
    });
    return res.status(201).json(created);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to propose stock transfer.';
    const status =
      msg.includes('Expired') ||
      msg.includes('exceeds') ||
      msg.includes('not found') ||
      msg.includes('positive') ||
      msg.includes('active')
        ? 400
        : 500;
    return res.status(status).json({ error: msg });
  }
});

apiRouter.post('/shops/:shopId/transfers/:transferId/action', requireAuth, async (req: AuthRequest, res) => {
  try {
    const shopId = await verifyOwnedShop(req, res);
    if (!shopId) return;
    const transferId = parsePositiveInt(String(req.params.transferId || ''));
    const action = req.body?.action;
    if (
      !transferId ||
      (action !== 'approve_source' && action !== 'approve_target' && action !== 'reject')
    ) {
      return res.status(400).json({
        error: 'Valid transferId and action ("approve_source", "approve_target", or "reject") are required.',
      });
    }
    const updated = await updateStockTransferApproval(shopId, transferId, action);
    return res.json(updated);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to update stock transfer.';
    const status =
      msg.includes('not found') ||
      msg.includes('already') ||
      msg.includes('expired') ||
      msg.includes('Insufficient')
        ? 400
        : 500;
    return res.status(status).json({ error: msg });
  }
});

// Phase 3: Privacy-Safe Village Demand Opt-In & Location Update
apiRouter.post('/shops/:shopId/village-signals/opt-in', requireAuth, async (req: AuthRequest, res) => {
  try {
    const shopId = await verifyOwnedShop(req, res);
    if (!shopId) return;
    const body = req.body || {};
    const updated = await upsertVillageDemandOptIn(shopId, {
      isOptedIn: Boolean(body.isOptedIn),
      villageName: body.villageName ? String(body.villageName) : undefined,
      district: body.district ? String(body.district) : undefined,
      latitude: body.latitude !== undefined && body.latitude !== null ? Number(body.latitude) : undefined,
      longitude: body.longitude !== undefined && body.longitude !== null ? Number(body.longitude) : undefined,
      topCategory: body.topCategory ? String(body.topCategory) : undefined,
      topProduct: body.topProduct ? String(body.topProduct) : undefined,
      estimatedWeeklyUnits:
        body.estimatedWeeklyUnits !== undefined ? Number(body.estimatedWeeklyUnits) : undefined,
      shortageSeverity:
        body.shortageSeverity === 'high' ||
        body.shortageSeverity === 'moderate' ||
        body.shortageSeverity === 'low'
          ? body.shortageSeverity
          : undefined,
    });
    return res.json(updated);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to update village demand sharing.';
    return res.status(500).json({ error: msg });
  }
});

// Phase 3: Smart Group Purchasing Pools
apiRouter.post('/shops/:shopId/group-orders', requireAuth, async (req: AuthRequest, res) => {
  try {
    const shopId = await verifyOwnedShop(req, res);
    if (!shopId) return;
    const body = req.body || {};
    if (!body.myQuantity || Number(body.myQuantity) <= 0) {
      return res.status(400).json({ error: 'A positive quantity is required to open a group order pool.' });
    }
    const created = await createGroupOrderRecord(shopId, {
      distributorOfferId: body.distributorOfferId ? Number(body.distributorOfferId) : null,
      productName: body.productName ? String(body.productName) : undefined,
      category: body.category ? String(body.category) : undefined,
      unit: body.unit ? String(body.unit) : undefined,
      distributorName: body.distributorName ? String(body.distributorName) : undefined,
      standardUnitPrice: body.standardUnitPrice !== undefined ? Number(body.standardUnitPrice) : undefined,
      bulkUnitPrice: body.bulkUnitPrice !== undefined ? Number(body.bulkUnitPrice) : undefined,
      minBulkQty: body.minBulkQty !== undefined ? Number(body.minBulkQty) : undefined,
      myQuantity: Number(body.myQuantity),
      deliveryWindow: body.deliveryWindow ? String(body.deliveryWindow) : undefined,
      notes: body.notes ? String(body.notes) : undefined,
    });
    return res.status(201).json(created);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to create group order pool.';
    return res.status(400).json({ error: msg });
  }
});

apiRouter.post('/shops/:shopId/group-orders/:groupOrderId/join', requireAuth, async (req: AuthRequest, res) => {
  try {
    const shopId = await verifyOwnedShop(req, res);
    if (!shopId) return;
    const groupOrderId = parsePositiveInt(String(req.params.groupOrderId || ''));
    const quantity = Number(req.body?.quantity);
    if (!groupOrderId || !Number.isInteger(quantity) || quantity <= 0) {
      return res.status(400).json({ error: 'Valid groupOrderId and positive integer quantity are required.' });
    }
    const updated = await joinOrUpdateGroupOrder(shopId, groupOrderId, quantity);
    return res.json(updated);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to join/update group order pool.';
    return res.status(400).json({ error: msg });
  }
});

apiRouter.post('/shops/:shopId/group-orders/:groupOrderId/action', requireAuth, async (req: AuthRequest, res) => {
  try {
    const shopId = await verifyOwnedShop(req, res);
    if (!shopId) return;
    const groupOrderId = parsePositiveInt(String(req.params.groupOrderId || ''));
    const action = req.body?.action;
    if (
      !groupOrderId ||
      (action !== 'approve_owner' && action !== 'accept_distributor' && action !== 'cancel')
    ) {
      return res.status(400).json({
        error: 'Valid groupOrderId and action ("approve_owner", "accept_distributor", or "cancel") are required.',
      });
    }
    const updated = await updateGroupOrderAction(shopId, groupOrderId, action);
    return res.json(updated);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to process group order action.';
    return res.status(400).json({ error: msg });
  }
});

// Phase 3: Verified Distributor Offers & Catalog
apiRouter.post('/shops/:shopId/distributor-offers', requireAuth, async (req: AuthRequest, res) => {
  try {
    const shopId = await verifyOwnedShop(req, res);
    if (!shopId) return;
    const body = req.body || {};
    if (!body.distributorName || !body.distributorCity || !body.productName || !body.category) {
      return res
        .status(400)
        .json({ error: 'Distributor name, city, product name, and category are required.' });
    }
    const created = await createDistributorOfferRecord(shopId, {
      distributorName: String(body.distributorName),
      distributorCity: String(body.distributorCity),
      verified: body.verified !== undefined ? Boolean(body.verified) : true,
      productName: String(body.productName),
      category: String(body.category),
      unit: String(body.unit || 'pcs'),
      standardUnitPrice: Number(body.standardUnitPrice),
      bulkUnitPrice: Number(body.bulkUnitPrice),
      minBulkQty: Number(body.minBulkQty || 40),
      availableQty: Number(body.availableQty || 200),
      leadTimeDays: Number(body.leadTimeDays || 2),
      deliveryFeeINR: Number(body.deliveryFeeINR || 250),
      latitude: body.latitude !== undefined ? Number(body.latitude) : null,
      longitude: body.longitude !== undefined ? Number(body.longitude) : null,
    });
    return res.status(201).json(created);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to create distributor offer.';
    return res.status(400).json({ error: msg });
  }
});

apiRouter.put('/shops/:shopId/distributor-offers/:offerId', requireAuth, async (req: AuthRequest, res) => {
  try {
    const shopId = await verifyOwnedShop(req, res);
    if (!shopId) return;
    const offerId = parsePositiveInt(String(req.params.offerId || ''));
    if (!offerId) return res.status(400).json({ error: 'Invalid distributor offer ID.' });
    const body = req.body || {};
    const updated = await updateDistributorOfferRecord(shopId, offerId, {
      standardUnitPrice: body.standardUnitPrice !== undefined ? Number(body.standardUnitPrice) : undefined,
      bulkUnitPrice: body.bulkUnitPrice !== undefined ? Number(body.bulkUnitPrice) : undefined,
      minBulkQty: body.minBulkQty !== undefined ? Number(body.minBulkQty) : undefined,
      availableQty: body.availableQty !== undefined ? Number(body.availableQty) : undefined,
      leadTimeDays: body.leadTimeDays !== undefined ? Number(body.leadTimeDays) : undefined,
      deliveryFeeINR: body.deliveryFeeINR !== undefined ? Number(body.deliveryFeeINR) : undefined,
      verified: body.verified !== undefined ? Boolean(body.verified) : undefined,
    });
    return res.json(updated);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to update distributor offer.';
    return res.status(400).json({ error: msg });
  }
});

// Phase 4: AI Logistics & Multi-Stop Delivery Optimization
apiRouter.post('/shops/:shopId/delivery-runs', requireAuth, async (req: AuthRequest, res) => {
  try {
    const shopId = await verifyOwnedShop(req, res);
    if (!shopId) return;
    const body = req.body || {};
    if (!body.originName || !Array.isArray(body.stops) || body.stops.length === 0) {
      return res.status(400).json({ error: 'Origin depot and at least one delivery stop are required.' });
    }
    const created = await createDeliveryRunRecord(shopId, {
      vehicleType: body.vehicleType || 'Mini Tempo',
      driverName: String(body.driverName || 'Rural Fleet Partner'),
      driverPhone: body.driverPhone ? String(body.driverPhone) : undefined,
      originName: String(body.originName),
      originLat: Number(body.originLat ?? 12.3385),
      originLng: Number(body.originLng ?? 76.6524),
      startHour: body.startHour !== undefined ? Number(body.startHour) : 7,
      stops: body.stops.map((s: Record<string, unknown>) => ({
        shopName: String(s.shopName || 'Partner Shop'),
        village: String(s.village || 'Village'),
        latitude: Number(s.latitude ?? 12.2958),
        longitude: Number(s.longitude ?? 76.6394),
        loadKg: Number(s.loadKg ?? 50),
        itemSummary: String(s.itemSummary || 'Consolidated Kirana Stock'),
        groupOrderCode: s.groupOrderCode ? String(s.groupOrderCode) : null,
      })),
    });
    return res.status(201).json(created);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to create optimized delivery run.';
    return res.status(400).json({ error: msg });
  }
});

apiRouter.post('/shops/:shopId/delivery-runs/:runId/status', requireAuth, async (req: AuthRequest, res) => {
  try {
    const shopId = await verifyOwnedShop(req, res);
    if (!shopId) return;
    const runId = parsePositiveInt(String(req.params.runId || ''));
    const status = req.body?.status;
    if (
      !runId ||
      !['planned', 'dispatched', 'in_transit', 'completed', 'cancelled'].includes(String(status))
    ) {
      return res.status(400).json({ error: 'Valid runId and delivery status are required.' });
    }
    const updated = await updateDeliveryRunStatusRecord(shopId, runId, status);
    return res.json(updated);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to update delivery run status.';
    return res.status(400).json({ error: msg });
  }
});

apiRouter.post(
  '/shops/:shopId/delivery-runs/:runId/stops/:stopId/status',
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const shopId = await verifyOwnedShop(req, res);
      if (!shopId) return;
      const runId = parsePositiveInt(String(req.params.runId || ''));
      const stopId = parsePositiveInt(String(req.params.stopId || ''));
      const status = req.body?.status;
      if (!runId || !stopId || !['pending', 'en_route', 'delivered'].includes(String(status))) {
        return res.status(400).json({ error: 'Valid runId, stopId, and stop status are required.' });
      }
      const updated = await updateDeliveryStopStatusRecord(
        shopId,
        runId,
        stopId,
        status,
        req.body?.proofNotes !== undefined ? String(req.body.proofNotes) : undefined
      );
      return res.json(updated);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to update delivery stop status.';
      return res.status(400).json({ error: msg });
    }
  }
);
