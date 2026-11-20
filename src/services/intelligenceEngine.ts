import type {
  BusinessInsight,
  FestivalEvent,
  Product,
  ProductBatch,
  ProductForecast,
  PurchaseOrder,
  ReorderRecommendation,
  SaleRecord,
  Supplier,
  WhatIfScenarioInput,
  WhatIfScenarioResult,
} from '../types/dukaaniq.ts';

export function formatISODate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function daysBetweenDates(fromISO: string, toISO: string): number {
  const a = new Date(`${fromISO}T00:00:00`);
  const b = new Date(`${toISO}T00:00:00`);
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function evaluateHoldoutBacktest(historyValues: number[], activeSaleDays: number): {
  mae: number | null;
  mape: number | null;
  windowDays: number;
} {
  // Honest walk-forward holdout over the last 7 recorded days when sufficient history exists
  if (historyValues.length < 21 || activeSaleDays < 8) {
    return { mae: null, mape: null, windowDays: 0 };
  }

  const holdoutStart = historyValues.length - 7;
  const alpha = 0.35;
  let absErrorSum = 0;
  let pctErrorSum = 0;
  let nonZeroActuals = 0;

  for (let idx = holdoutStart; idx < historyValues.length; idx++) {
    const train = historyValues.slice(0, idx);
    let smoothed = train[0];
    for (let i = 1; i < train.length; i++) {
      smoothed = alpha * train[i] + (1 - alpha) * smoothed;
    }
    const trailing7 = train.slice(-7).reduce((a, b) => a + b, 0) / 7;
    const pred = 0.6 * smoothed + 0.4 * trailing7;
    const actual = historyValues[idx];
    absErrorSum += Math.abs(actual - pred);
    if (actual > 0) {
      pctErrorSum += Math.abs(actual - pred) / actual;
      nonZeroActuals++;
    }
  }

  const mae = Number((absErrorSum / 7).toFixed(2));
  const mape =
    nonZeroActuals >= 3
      ? Number(Math.min(150, (pctErrorSum / nonZeroActuals) * 100).toFixed(1))
      : null;

  return { mae, mape, windowDays: 7 };
}

export function computeProductForecasts(
  products: Product[],
  sales: SaleRecord[],
  festivals: FestivalEvent[],
  referenceDateISO: string = formatISODate(new Date())
): ProductForecast[] {
  const refDate = new Date(`${referenceDateISO}T00:00:00`);

  // Build 30-day date grid ending on referenceDateISO
  const pastDates: string[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(refDate);
    d.setDate(d.getDate() - i);
    pastDates.push(formatISODate(d));
  }

  // Future 14 days for forecast charting
  const futureDates: string[] = [];
  for (let i = 1; i <= 14; i++) {
    const d = new Date(refDate);
    d.setDate(d.getDate() + i);
    futureDates.push(formatISODate(d));
  }

  // Upcoming active festivals within next 30 days
  const upcomingFestivals = festivals.filter((f) => {
    if (f.isDismissed) return false;
    const diff = daysBetweenDates(referenceDateISO, f.festivalDate);
    return diff >= 0 && diff <= 30;
  });

  // Aggregate daily quantities per product
  const dailySalesMap = new Map<number, Map<string, number>>();
  for (const sale of sales) {
    const dayKey = sale.saleDate.slice(0, 10);
    for (const item of sale.items) {
      if (!dailySalesMap.has(item.productId)) {
        dailySalesMap.set(item.productId, new Map());
      }
      const pMap = dailySalesMap.get(item.productId)!;
      pMap.set(dayKey, (pMap.get(dayKey) || 0) + item.quantity);
    }
  }

  return products.map((product) => {
    const pMap = dailySalesMap.get(product.id) || new Map<string, number>();
    const historyValues = pastDates.map((d) => pMap.get(d) || 0);
    const activeSaleDays = historyValues.filter((v) => v > 0).length;
    const totalSold30d = historyValues.reduce((sum, v) => sum + v, 0);

    // Choose forecasting method transparently based on recorded history depth
    let methodUsed = 'Insufficient History Baseline';
    let confidenceLevel: 'High' | 'Medium' | 'Low' = 'Low';
    let baseDailyDemand = 0;

    if (activeSaleDays >= 12) {
      methodUsed = 'Exponential Smoothing (α=0.35) + Day-of-Week Seasonality';
      confidenceLevel = 'High';
      const alpha = 0.35;
      let smoothed = historyValues[0];
      for (let i = 1; i < historyValues.length; i++) {
        smoothed = alpha * historyValues[i] + (1 - alpha) * smoothed;
      }
      const trailing14 = historyValues.slice(-14).reduce((a, b) => a + b, 0) / 14;
      baseDailyDemand = 0.6 * smoothed + 0.4 * trailing14;
    } else if (activeSaleDays >= 4) {
      methodUsed = 'Weighted Moving Average (7d / 30d)';
      confidenceLevel = 'Medium';
      const avg7 = historyValues.slice(-7).reduce((a, b) => a + b, 0) / 7;
      const avg30 = totalSold30d / 30;
      baseDailyDemand = 0.6 * avg7 + 0.4 * avg30;
    } else if (totalSold30d > 0) {
      methodUsed = 'Simple 30-Day Moving Average (Sparse Data)';
      confidenceLevel = 'Low';
      baseDailyDemand = totalSold30d / 30;
    } else {
      methodUsed = 'Zero-Sales Baseline (No 30-Day History)';
      confidenceLevel = 'Low';
      baseDailyDemand = 0;
    }

    // Real walk-forward holdout evaluation against recorded sales
    const backtest = evaluateHoldoutBacktest(historyValues, activeSaleDays);

    // Trend detection: compare last 7 days vs previous 7 days
    const last7Sum = historyValues.slice(-7).reduce((a, b) => a + b, 0);
    const prev7Sum = historyValues.slice(-14, -7).reduce((a, b) => a + b, 0);
    let trendDirection: 'rising' | 'stable' | 'declining' = 'stable';
    if (prev7Sum > 0 && last7Sum > prev7Sum * 1.15) {
      trendDirection = 'rising';
    } else if (prev7Sum > 0 && last7Sum < prev7Sum * 0.82) {
      trendDirection = 'declining';
    }

    // Day-of-week multipliers when enough history exists
    const dowTotals = [0, 0, 0, 0, 0, 0, 0];
    const dowCounts = [0, 0, 0, 0, 0, 0, 0];
    pastDates.forEach((dStr, idx) => {
      const dow = new Date(`${dStr}T00:00:00`).getDay();
      dowTotals[dow] += historyValues[idx];
      dowCounts[dow] += 1;
    });
    const overallMean = totalSold30d / 30;
    const dowFactors = dowTotals.map((sum, dow) => {
      if (activeSaleDays < 10 || overallMean <= 0 || dowCounts[dow] === 0) return 1;
      const raw = sum / dowCounts[dow] / overallMean;
      return Math.max(0.75, Math.min(1.35, raw));
    });

    // Festival uplift factor if product category matches upcoming festival
    let festivalUpliftFactor = 1;
    let matchedFestivalName = '';
    for (const fest of upcomingFestivals) {
      const cats = fest.focusCategories
        .toLowerCase()
        .split(',')
        .map((c) => c.trim());
      if (cats.some((c) => product.category.toLowerCase().includes(c) || c.includes(product.category.toLowerCase()))) {
        const candidate = 1 + Math.min(fest.expectedUpliftPct, 60) / 100;
        if (candidate > festivalUpliftFactor) {
          festivalUpliftFactor = candidate;
          matchedFestivalName = fest.name;
        }
      }
    }

    const trendMultiplier =
      trendDirection === 'rising' ? 1.08 : trendDirection === 'declining' ? 0.92 : 1.0;

    // Build chart series (last 14 days actual + next 14 days predicted)
    const series: { date: string; actual: number | null; predicted: number | null }[] = [];
    for (let i = 16; i < pastDates.length; i++) {
      series.push({
        date: pastDates[i].slice(5),
        actual: historyValues[i],
        predicted: null,
      });
    }

    let demand1d = 0;
    let demand7d = 0;
    let demand14d = 0;
    futureDates.forEach((fDate, idx) => {
      const dow = new Date(`${fDate}T00:00:00`).getDay();
      const festBoost = festivalUpliftFactor > 1 ? 1 + (festivalUpliftFactor - 1) * 0.5 : 1;
      const dailyPred = Math.max(
        0,
        Number((baseDailyDemand * dowFactors[dow] * trendMultiplier * festBoost).toFixed(2))
      );
      if (idx === 0) demand1d = dailyPred;
      if (idx < 7) demand7d += dailyPred;
      demand14d += dailyPred;
      series.push({
        date: fDate.slice(5),
        actual: null,
        predicted: Number(dailyPred.toFixed(1)),
      });
    });

    const expectedDemand1d = Number(demand1d.toFixed(1));
    const expectedDemand7d = Math.round(demand7d);
    const expectedDemand30d = Math.round((demand14d / 14) * 30 * (festivalUpliftFactor > 1 ? 1.06 : 1));
    const avgDailySales = Number((totalSold30d / 30).toFixed(2));
    const daysUntilStockout =
      baseDailyDemand > 0.05 ? Math.floor(product.currentStock / baseDailyDemand) : null;
    const shortageRisk =
      product.currentStock <= product.minStockLevel ||
      (daysUntilStockout !== null && daysUntilStockout <= product.leadTimeDays + 4);
    const deadStockFlag = totalSold30d === 0 && product.currentStock > 0;
    const slowMovingFlag = !deadStockFlag && totalSold30d <= 5 && product.currentStock >= 10;

    const explanationParts: string[] = [];
    explanationParts.push(
      `Observed ${totalSold30d} ${product.unit} sold across ${activeSaleDays} active billing days in the last 30 days (avg ${avgDailySales}/day).`
    );
    if (trendDirection === 'rising') {
      explanationParts.push(`Recent 7-day demand (${last7Sum}) increased vs prior 7 days (${prev7Sum}), applying a +8% momentum adjustment.`);
    } else if (trendDirection === 'declining') {
      explanationParts.push(`Recent 7-day demand (${last7Sum}) slowed vs prior 7 days (${prev7Sum}), moderating the forecast by -8%.`);
    }
    if (matchedFestivalName) {
      explanationParts.push(`Includes category seasonal uplift signal for upcoming ${matchedFestivalName}.`);
    }

    const dataLimitationNote =
      activeSaleDays < 8
        ? `Only ${activeSaleDays} active sales days recorded; walk-forward backtest error requires at least 8 active days. Record more daily bills to raise forecast confidence.`
        : backtest.mae !== null
        ? `Walk-forward 7-day holdout test measured MAE = ${backtest.mae} ${product.unit}/day${backtest.mape !== null ? ` (MAPE ${backtest.mape}%)` : ''}. External weather and neighborhood shocks are shown separately as planning signals.`
        : 'Forecast relies strictly on recorded store sales; sudden local price changes or festival shifts can deviate from past averages.';

    const noteParts: string[] = [];
    if (activeSaleDays < 4) {
      noteParts.push(
        `Limited history (${activeSaleDays} active sales days in last 30d); accuracy improves as more daily bills are recorded.`
      );
    } else {
      noteParts.push(`Computed from ${activeSaleDays} active sales days over the last 30 days (${totalSold30d} ${product.unit} sold).`);
    }
    if (matchedFestivalName) {
      noteParts.push(`Includes seasonal lift signal for ${matchedFestivalName}.`);
    }
    if (deadStockFlag) {
      noteParts.push('Zero units sold in 30 days — consider bundle promotion or inter-shop transfer before reordering.');
    }

    return {
      productId: product.id,
      productName: product.name,
      category: product.category,
      currentStock: product.currentStock,
      methodUsed,
      horizonDays: 30,
      expectedDemand1d,
      expectedDemand7d,
      expectedDemand30d,
      avgDailySales,
      trendDirection,
      confidenceLevel,
      dataDaysUsed: activeSaleDays,
      backtestMae: backtest.mae,
      backtestMape: backtest.mape,
      backtestWindowDays: backtest.windowDays,
      explanation: explanationParts.join(' '),
      dataLimitationNote,
      shortageRisk,
      daysUntilStockout,
      slowMovingFlag,
      deadStockFlag,
      notes: noteParts.join(' '),
      series,
    };
  });
}

export function computeReorderRecommendations(
  shopId: number,
  products: Product[],
  suppliers: Supplier[],
  purchases: PurchaseOrder[],
  forecasts: ProductForecast[]
): Omit<ReorderRecommendation, 'id'>[] {
  const supplierMap = new Map(suppliers.map((s) => [s.id, s]));
  const forecastMap = new Map(forecasts.map((f) => [f.productId, f]));

  const incomingMap = new Map<number, number>();
  for (const po of purchases) {
    if (po.status !== 'pending') continue;
    for (const item of po.items) {
      const remaining = Math.max(0, item.orderedQty - (item.receivedQty || 0));
      incomingMap.set(item.productId, (incomingMap.get(item.productId) || 0) + remaining);
    }
  }

  const recommendations: Omit<ReorderRecommendation, 'id'>[] = [];

  for (const product of products) {
    const forecast = forecastMap.get(product.id);
    const supplier = product.supplierId ? supplierMap.get(product.supplierId) : undefined;
    const leadTime = supplier?.leadTimeDays ?? product.leadTimeDays ?? 3;
    const dailyRate = forecast ? Math.max(forecast.expectedDemand7d / 7, forecast.avgDailySales) : 0;
    const expectedDemandLeadTime = Number((dailyRate * leadTime).toFixed(1));
    const safetyStock = Math.max(
      Math.ceil(product.minStockLevel * 0.6),
      Math.ceil(dailyRate * 2)
    );
    const reorderPoint = Math.max(
      product.minStockLevel,
      Math.ceil(expectedDemandLeadTime + safetyStock)
    );
    const incomingStock = incomingMap.get(product.id) || 0;
    const effectivePosition = product.currentStock + incomingStock;

    if (effectivePosition <= reorderPoint) {
      const rawSuggested = product.maxStockLevel - product.currentStock - incomingStock;
      const suggestedQty = Math.max(0, Math.round(rawSuggested));

      if (suggestedQty <= 0) continue;

      const estimatedCost = Number((suggestedQty * product.purchasePrice).toFixed(2));
      const priority: 'Critical' | 'High' | 'Medium' =
        product.currentStock <= 0
          ? 'Critical'
          : forecast?.daysUntilStockout !== null &&
            forecast?.daysUntilStockout !== undefined &&
            forecast.daysUntilStockout <= leadTime
          ? 'Critical'
          : product.currentStock <= product.minStockLevel
          ? 'High'
          : 'Medium';

      const reason =
        product.currentStock === 0
          ? 'Out of stock — immediate restock needed to prevent lost sales.'
          : forecast?.shortageRisk
          ? `Projected demand (${forecast.expectedDemand7d} ${product.unit} / 7d) will breach reorder point (${reorderPoint}) within lead time (${leadTime}d).`
          : `Current stock (${product.currentStock}) plus incoming (${incomingStock}) is below reorder point (${reorderPoint}).`;

      const formulaBreakdown =
        `Reorder Point = (${expectedDemandLeadTime} demand over ${leadTime}d lead time) + (${safetyStock} safety stock) = ${reorderPoint}. ` +
        `Suggested Qty = max(0, ${product.maxStockLevel} max target - ${product.currentStock} available - ${incomingStock} incoming) = ${suggestedQty} ${product.unit}.`;

      recommendations.push({
        shopId,
        productId: product.id,
        productName: product.name,
        supplierId: product.supplierId ?? null,
        supplierName: supplier?.name ?? 'Unassigned Supplier',
        availableStock: product.currentStock,
        incomingStock,
        expectedDemandLeadTime,
        safetyStock,
        reorderPoint,
        suggestedQty,
        approvedQty: null,
        estimatedCost,
        priority,
        reason,
        formulaBreakdown,
        status: 'pending',
      });
    }
  }

  const priorityRank = { Critical: 0, High: 1, Medium: 2 };
  return recommendations.sort((a, b) => {
    const pa = priorityRank[a.priority || 'Medium'];
    const pb = priorityRank[b.priority || 'Medium'];
    if (pa !== pb) return pa - pb;
    return a.availableStock - b.availableStock;
  });
}

export interface EnrichedExpiryBatch extends ProductBatch {
  product?: Product;
  daysLeft: number;
  valueAtRisk: number;
  dailySalesPace: number;
  expectedSoldBeforeExpiry: number;
  projectedUnsoldUnits: number;
  projectedUnsoldLossINR: number;
  fefoRank: number;
  transferEligible: boolean;
}

export function classifyExpiryBatches(
  batches: ProductBatch[],
  products: Product[],
  referenceDateISO: string = formatISODate(new Date()),
  forecasts: ProductForecast[] = []
) {
  const productMap = new Map(products.map((p) => [p.id, p]));
  const forecastMap = new Map(forecasts.map((f) => [f.productId, f]));
  const activeBatches = batches.filter((b) => b.status === 'active' && b.quantity > 0);

  // Assign FEFO rank per product (1 = sell first, earliest valid expiry)
  const byProduct = new Map<number, ProductBatch[]>();
  for (const b of activeBatches) {
    if (!byProduct.has(b.productId)) byProduct.set(b.productId, []);
    byProduct.get(b.productId)!.push(b);
  }
  const fefoRankMap = new Map<number, number>();
  for (const list of byProduct.values()) {
    const sorted = [...list].sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
    sorted.forEach((b, idx) => fefoRankMap.set(b.id, idx + 1));
  }

  const expired: EnrichedExpiryBatch[] = [];
  const within7: EnrichedExpiryBatch[] = [];
  const within15: EnrichedExpiryBatch[] = [];
  const within30: EnrichedExpiryBatch[] = [];
  const healthy: EnrichedExpiryBatch[] = [];

  for (const batch of activeBatches) {
    const product = productMap.get(batch.productId);
    const fc = forecastMap.get(batch.productId);
    const daysLeft = daysBetweenDates(referenceDateISO, batch.expiryDate);
    const valueAtRisk = Number((batch.quantity * batch.purchasePrice).toFixed(2));
    const dailySalesPace = fc ? Math.max(fc.avgDailySales, fc.expectedDemand7d / 7) : 0;
    const expectedSoldBeforeExpiry =
      daysLeft <= 0 ? 0 : Math.min(batch.quantity, Math.floor(dailySalesPace * daysLeft));
    const projectedUnsoldUnits =
      daysLeft < 0 ? batch.quantity : Math.max(0, batch.quantity - expectedSoldBeforeExpiry);
    const projectedUnsoldLossINR = Number((projectedUnsoldUnits * batch.purchasePrice).toFixed(2));
    // Eligible for inter-shop transfer ONLY if NOT expired (>= 3 days left) and likely to remain unsold locally
    const transferEligible = daysLeft >= 3 && daysLeft <= 30 && projectedUnsoldUnits >= 3;

    const enriched: EnrichedExpiryBatch = {
      ...batch,
      product,
      daysLeft,
      valueAtRisk,
      dailySalesPace: Number(dailySalesPace.toFixed(2)),
      expectedSoldBeforeExpiry,
      projectedUnsoldUnits,
      projectedUnsoldLossINR,
      fefoRank: fefoRankMap.get(batch.id) || 1,
      transferEligible,
    };

    if (daysLeft < 0) {
      expired.push(enriched);
    } else if (daysLeft <= 7) {
      within7.push(enriched);
    } else if (daysLeft <= 15) {
      within15.push(enriched);
    } else if (daysLeft <= 30) {
      within30.push(enriched);
    } else {
      healthy.push(enriched);
    }
  }

  const sortByDays = <T extends { daysLeft: number }>(arr: T[]) =>
    arr.sort((a, b) => a.daysLeft - b.daysLeft);

  return {
    expired: sortByDays(expired),
    within7: sortByDays(within7),
    within15: sortByDays(within15),
    within30: sortByDays(within30),
    healthy: sortByDays(healthy),
    totalMoneyAtRisk: Number(
      [...expired, ...within7, ...within15, ...within30]
        .reduce((sum, b) => sum + b.valueAtRisk, 0)
        .toFixed(2)
    ),
    totalProjectedUnsoldLoss: Number(
      [...within7, ...within15, ...within30]
        .reduce((sum, b) => sum + b.projectedUnsoldLossINR, 0)
        .toFixed(2)
    ),
  };
}

export function runWhatIfSimulation(
  products: Product[],
  forecasts: ProductForecast[],
  purchases: PurchaseOrder[],
  input: WhatIfScenarioInput
): WhatIfScenarioResult {
  const forecastMap = new Map(forecasts.map((f) => [f.productId, f]));
  const incomingMap = new Map<number, number>();
  for (const po of purchases) {
    if (po.status !== 'pending') continue;
    for (const item of po.items) {
      incomingMap.set(
        item.productId,
        (incomingMap.get(item.productId) || 0) + Math.max(0, item.orderedQty - (item.receivedQty || 0))
      );
    }
  }

  const demandMult = Math.max(0.1, 1 + input.demandChangePct / 100);
  const priceMult = Math.max(0.4, 1 + input.supplierPriceChangePct / 100);
  const stockMult = Math.max(0, input.stockAvailabilityPct / 100);

  let totalBaselineDemand30d = 0;
  let totalSimulatedDemand30d = 0;
  let totalReorderUnits = 0;
  let totalPurchaseCostINR = 0;
  let projectedInventoryValueINR = 0;
  let shortageSkuCount = 0;
  let estimatedWastageRiskINR = 0;

  const items = products.map((p) => {
    const fc = forecastMap.get(p.id);
    const baselineDemand30d = fc ? fc.expectedDemand30d : Math.round(p.minStockLevel * 1.2);
    const simulatedDemand30d = Math.round(baselineDemand30d * demandMult);
    const simulatedDaily = simulatedDemand30d / 30;
    const simulatedStock = Math.round(p.currentStock * stockMult);
    const incoming = incomingMap.get(p.id) || 0;
    const effectiveLeadTime = Math.max(1, (p.leadTimeDays || 3) + input.leadTimeDeltaDays);
    const unitCost = p.purchasePrice * priceMult;

    const baselineReorderQty = Math.max(0, p.maxStockLevel - p.currentStock - incoming);
    const simReorderPoint = Math.max(
      p.minStockLevel,
      Math.ceil(simulatedDaily * effectiveLeadTime + Math.max(Math.ceil(p.minStockLevel * 0.6), Math.ceil(simulatedDaily * 2)))
    );

    const needsReorder = simulatedStock + incoming <= simReorderPoint;
    const dynamicTarget = Math.max(p.maxStockLevel, Math.ceil(simulatedDaily * (effectiveLeadTime + 14)));
    const simulatedReorderQty = needsReorder
      ? Math.max(0, Math.round(dynamicTarget - simulatedStock - incoming))
      : 0;

    const simulatedPurchaseCost = Number((simulatedReorderQty * unitCost).toFixed(2));
    const shortageUnits = Math.max(0, Math.round(simulatedDaily * (effectiveLeadTime + 7) - (simulatedStock + incoming)));
    if (shortageUnits > 0) shortageSkuCount++;

    // Wastage exposure if simulated demand drops sharply while high stock sits on shelf
    const excessUnits =
      simulatedDemand30d < simulatedStock * 0.45 && p.expiryDate
        ? Math.max(0, Math.round(simulatedStock - simulatedDemand30d * 1.8))
        : 0;
    const projectedWastageRiskINR = Number((excessUnits * p.purchasePrice).toFixed(2));

    totalBaselineDemand30d += baselineDemand30d;
    totalSimulatedDemand30d += simulatedDemand30d;
    totalReorderUnits += simulatedReorderQty;
    totalPurchaseCostINR += simulatedPurchaseCost;
    projectedInventoryValueINR += (simulatedStock + simulatedReorderQty) * unitCost;
    estimatedWastageRiskINR += projectedWastageRiskINR;

    return {
      productId: p.id,
      productName: p.name,
      category: p.category,
      baselineDemand30d,
      simulatedDemand30d,
      simulatedStock,
      baselineReorderQty,
      simulatedReorderQty,
      simulatedPurchaseCost,
      shortageUnits,
      projectedWastageRiskINR,
    };
  });

  const activeSupplierOrders = Math.max(1, Math.ceil(items.filter((i) => i.simulatedReorderQty > 0).length / 4));
  const totalDeliveryCostINR =
    totalReorderUnits > 0 ? activeSupplierOrders * Math.max(0, input.deliveryCostPerOrderINR) : 0;
  const totalOutlay = totalPurchaseCostINR + totalDeliveryCostINR;
  const budgetGapINR = Number((input.purchasingBudgetINR - totalOutlay).toFixed(2));

  return {
    totalBaselineDemand30d,
    totalSimulatedDemand30d,
    totalReorderUnits,
    totalPurchaseCostINR: Number(totalPurchaseCostINR.toFixed(2)),
    totalDeliveryCostINR: Number(totalDeliveryCostINR.toFixed(2)),
    budgetGapINR,
    projectedInventoryValueINR: Number(projectedInventoryValueINR.toFixed(2)),
    shortageSkuCount,
    estimatedWastageRiskINR: Number(estimatedWastageRiskINR.toFixed(2)),
    items: items.sort((a, b) => b.simulatedPurchaseCost - a.simulatedPurchaseCost),
  };
}

export function generateDeterministicInsights(
  products: Product[],
  batches: ProductBatch[],
  sales: SaleRecord[],
  forecasts: ProductForecast[],
  referenceDateISO: string = formatISODate(new Date())
): BusinessInsight[] {
  const insights: BusinessInsight[] = [];

  // 1. Sales Period Comparison (Last 7 days vs Previous 7 days)
  const last7Sales = sales.filter((s) => {
    const d = daysBetweenDates(s.saleDate.slice(0, 10), referenceDateISO);
    return d >= 0 && d < 7;
  });
  const prev7Sales = sales.filter((s) => {
    const d = daysBetweenDates(s.saleDate.slice(0, 10), referenceDateISO);
    return d >= 7 && d < 14;
  });
  const revLast7 = last7Sales.reduce((s, r) => s + r.totalAmount, 0);
  const revPrev7 = prev7Sales.reduce((s, r) => s + r.totalAmount, 0);

  if (revLast7 > 0 && revPrev7 > 0) {
    const deltaPct = Math.round(((revLast7 - revPrev7) / revPrev7) * 100);
    insights.push({
      id: 'insight-sales-trend',
      kind: 'observation',
      category: 'sales_trend',
      severity: deltaPct >= 0 ? 'positive' : 'warning',
      title:
        deltaPct >= 0
          ? `Weekly sales revenue rose ${deltaPct}% over the previous 7 days`
          : `Weekly sales revenue dipped ${Math.abs(deltaPct)}% compared to the prior 7 days`,
      summary: `Recorded ₹${Math.round(revLast7).toLocaleString('en-IN')} across ${last7Sales.length} bills in the last 7 days versus ₹${Math.round(revPrev7).toLocaleString('en-IN')} in the preceding week.`,
      metricLabel: `${deltaPct >= 0 ? '+' : ''}${deltaPct}% WoW Revenue`,
      recommendedAction:
        deltaPct >= 0
          ? 'Review top-moving staples to ensure stock buffers keep up with stronger footfall.'
          : 'Check out-of-stock essentials and review slower categories for weekend offers.',
    });
  }

  // 2. Fast-moving items
  const fastMovers = [...forecasts]
    .filter((f) => f.avgDailySales >= 2)
    .sort((a, b) => b.avgDailySales - a.avgDailySales);

  if (fastMovers.length > 0) {
    const top = fastMovers[0];
    insights.push({
      id: 'insight-fast-mover',
      kind: 'observation',
      category: 'fast_moving',
      severity: top.shortageRisk ? 'warning' : 'positive',
      title: `${top.productName} is your fastest-selling item this month`,
      summary: `Averaging ${top.avgDailySales.toFixed(1)} units/day with ${top.currentStock} units currently on shelf.${top.daysUntilStockout !== null ? ` At current pace, stock covers ~${top.daysUntilStockout} days.` : ''}`,
      metricLabel: `${top.avgDailySales.toFixed(1)} units/day`,
      recommendedAction: top.shortageRisk
        ? 'Approve the pending reorder suggestion before shelf stock runs dry.'
        : 'Maintain regular supplier cadence and monitor weekend surges.',
    });
  }

  // 3. Stockout Risk
  const stockoutRisks = forecasts.filter((f) => f.shortageRisk);
  if (stockoutRisks.length > 0) {
    const names = stockoutRisks
      .slice(0, 3)
      .map((p) => p.productName)
      .join(', ');
    insights.push({
      id: 'insight-stockout-risk',
      kind: 'prediction',
      category: 'stockout',
      severity: 'critical',
      title: `${stockoutRisks.length} product${stockoutRisks.length > 1 ? 's are' : ' is'} predicted to run low within lead time`,
      summary: `Forecasted 7-day demand puts ${names}${stockoutRisks.length > 3 ? ` and ${stockoutRisks.length - 3} more` : ''} at high stockout risk.`,
      metricLabel: `${stockoutRisks.length} SKUs at risk`,
      recommendedAction: 'Open Smart Reorder Engine to inspect formula calculations and approve supplier POs.',
    });
  }

  // 4. Expiry & FEFO Risk
  const expiry = classifyExpiryBatches(batches, products, referenceDateISO, forecasts);
  if (expiry.expired.length > 0) {
    const expiredVal = expiry.expired.reduce((s, b) => s + b.valueAtRisk, 0);
    insights.push({
      id: 'insight-expired-alert',
      kind: 'observation',
      category: 'expiry',
      severity: 'critical',
      title: `${expiry.expired.length} expired batch${expiry.expired.length > 1 ? 'es' : ''} must be removed from sale immediately`,
      summary: `Already-expired stock worth ₹${Math.round(expiredVal).toLocaleString('en-IN')} at purchase cost is still marked active. Never sell expired goods.`,
      metricLabel: `₹${Math.round(expiredVal).toLocaleString('en-IN')} expired`,
      recommendedAction: 'Open Expiry Intelligence to remove expired batches from shelves and log wastage.',
    });
  }
  if (expiry.within15.length + expiry.within7.length > 0) {
    const nearCount = expiry.within7.length + expiry.within15.length;
    const nearVal = [...expiry.within7, ...expiry.within15].reduce((s, b) => s + b.valueAtRisk, 0);
    insights.push({
      id: 'insight-near-expiry',
      kind: 'observation',
      category: 'expiry',
      severity: 'warning',
      title: `${nearCount} batch${nearCount > 1 ? 'es expire' : ' expires'} within 15 days`,
      summary: `₹${Math.round(nearVal).toLocaleString('en-IN')} of inventory cost is tied up in batches nearing expiry (est. ₹${Math.round(expiry.totalProjectedUnsoldLoss).toLocaleString('en-IN')} projected unsold at current velocity).`,
      metricLabel: `₹${Math.round(nearVal).toLocaleString('en-IN')} at risk`,
      recommendedAction: 'Rotate stock using FEFO or approve an inter-shop stock transfer with a high-demand neighboring shop.',
    });
  }

  // 5. Dead & Slow-Moving Stock
  const deadStocks = forecasts.filter((f) => f.deadStockFlag);
  if (deadStocks.length > 0) {
    const tiedCapital = deadStocks.reduce((sum, f) => {
      const p = products.find((item) => item.id === f.productId);
      return sum + (p ? p.currentStock * p.purchasePrice : 0);
    }, 0);
    insights.push({
      id: 'insight-dead-stock',
      kind: 'observation',
      category: 'dead_stock',
      severity: 'warning',
      title: `${deadStocks.length} stocked product${deadStocks.length > 1 ? 's have' : ' has'} recorded zero sales in 30 days`,
      summary: `${deadStocks.slice(0, 3).map((d) => d.productName).join(', ')} represent ₹${Math.round(tiedCapital).toLocaleString('en-IN')} in slow-locked shelf capital.`,
      metricLabel: `₹${Math.round(tiedCapital).toLocaleString('en-IN')} tied up`,
      recommendedAction: 'Pause reorders for these SKUs and consider combo offers or inter-shop transfers.',
    });
  }

  // 6. Margin Analysis
  const withMargin = products
    .filter((p) => p.sellingPrice > 0)
    .map((p) => ({
      ...p,
      marginPct: ((p.sellingPrice - p.purchasePrice) / p.sellingPrice) * 100,
    }))
    .sort((a, b) => b.marginPct - a.marginPct);

  if (withMargin.length >= 2) {
    const highest = withMargin[0];
    const lowest = withMargin[withMargin.length - 1];
    insights.push({
      id: 'insight-margin-spread',
      kind: 'observation',
      category: 'margin',
      severity: 'neutral',
      title: `Gross margins span ${lowest.marginPct.toFixed(1)}% to ${highest.marginPct.toFixed(1)}% across your catalog`,
      summary: `${highest.name} delivers the strongest margin (${highest.marginPct.toFixed(1)}%), while ${lowest.name} runs tightest at ${lowest.marginPct.toFixed(1)}%.`,
      metricLabel: `${highest.marginPct.toFixed(1)}% top margin`,
      recommendedAction: 'Feature high-margin spices, tea, and snacks at eye level near the billing counter.',
    });
  }

  return insights;
}
