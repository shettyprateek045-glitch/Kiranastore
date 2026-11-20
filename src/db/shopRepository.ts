import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from './index.ts';
import {
  auditLogs,
  deliveryRuns,
  deliveryStops,
  distributorOffers,
  festivals,
  forecasts,
  groupOrderMembers,
  groupOrders,
  notifications,
  productBatches,
  products,
  purchaseItems,
  purchases,
  reorderRecommendations,
  saleItems,
  sales,
  shops,
  stockMovements,
  stockTransfers,
  suppliers,
  villageDemandSignals,
  wastageLogs,
} from './schema.ts';
import {
  computeProductForecasts,
  computeReorderRecommendations,
  formatISODate,
} from '../services/intelligenceEngine.ts';
import {
  optimizeDeliveryRoute,
  RoutePoint,
  VehicleSpec,
} from '../services/logisticsEngine.ts';
import { createSampleKiranaWorkspace } from '../services/sampleShopData.ts';
import type { ShopWorkspacePayload } from '../types/dukaaniq.ts';

function sanitizeDbError(context: string, error: unknown): Error {
  console.error(`[DB Error] ${context}:`, error);
  return new Error(`Database operation failed while ${context}. Please try again.`, {
    cause: error,
  });
}

export async function listUserShops(ownerUid: string) {
  try {
    return await db
      .select()
      .from(shops)
      .where(eq(shops.ownerUid, ownerUid))
      .orderBy(desc(shops.createdAt));
  } catch (error) {
    throw sanitizeDbError('loading your shops', error);
  }
}

export async function assertShopOwnership(shopId: number, ownerUid: string) {
  try {
    const rows = await db
      .select()
      .from(shops)
      .where(and(eq(shops.id, shopId), eq(shops.ownerUid, ownerUid)))
      .limit(1);
    return rows[0] ?? null;
  } catch (error) {
    throw sanitizeDbError('verifying shop access', error);
  }
}

export async function createShop(
  ownerUid: string,
  payload: {
    name: string;
    ownerName: string;
    phone?: string;
    city: string;
    state: string;
    pincode?: string;
    address?: string;
    latitude?: number | null;
    longitude?: number | null;
    seedSample?: boolean;
  }
) {
  try {
    const [created] = await db
      .insert(shops)
      .values({
        ownerUid,
        name: payload.name.trim(),
        ownerName: payload.ownerName.trim(),
        phone: payload.phone?.trim() || null,
        city: payload.city.trim() || 'Bengaluru',
        state: payload.state.trim() || 'Karnataka',
        pincode: payload.pincode?.trim() || null,
        address: payload.address?.trim() || null,
        latitude: payload.latitude ?? null,
        longitude: payload.longitude ?? null,
        isSampleData: Boolean(payload.seedSample),
      })
      .returning();

    // Seed baseline national Indian festivals for every new shop
    const sampleFestivals = createSampleKiranaWorkspace(created.id, ownerUid).festivals;
    if (sampleFestivals.length > 0) {
      await db.insert(festivals).values(
        sampleFestivals.map((f) => ({
          shopId: created.id,
          name: f.name,
          festivalDate: f.festivalDate,
          category: f.category,
          expectedUpliftPct: f.expectedUpliftPct,
          focusCategories: f.focusCategories,
          notes: f.notes ?? null,
          isDismissed: false,
          isCustom: f.isCustom,
        }))
      );
    }

    if (payload.seedSample) {
      await seedSampleDataIntoShop(created.id, ownerUid, false);
    }

    await db.insert(auditLogs).values({
      shopId: created.id,
      actorUid: ownerUid,
      action: 'CREATE_SHOP',
      entityType: 'shop',
      entityId: String(created.id),
      details: `Created shop ${created.name}`,
    });

    return created;
  } catch (error) {
    throw sanitizeDbError('creating shop profile', error);
  }
}

export async function updateShopProfile(
  shopId: number,
  ownerUid: string,
  payload: Partial<{
    name: string;
    ownerName: string;
    phone: string;
    city: string;
    state: string;
    pincode: string;
    address: string;
    latitude: number | null;
    longitude: number | null;
  }>
) {
  try {
    const [updated] = await db
      .update(shops)
      .set({
        ...(payload.name ? { name: payload.name.trim() } : {}),
        ...(payload.ownerName ? { ownerName: payload.ownerName.trim() } : {}),
        ...(payload.phone !== undefined ? { phone: payload.phone.trim() || null } : {}),
        ...(payload.city ? { city: payload.city.trim() } : {}),
        ...(payload.state ? { state: payload.state.trim() } : {}),
        ...(payload.pincode !== undefined ? { pincode: payload.pincode.trim() || null } : {}),
        ...(payload.address !== undefined ? { address: payload.address.trim() || null } : {}),
        ...(payload.latitude !== undefined ? { latitude: payload.latitude } : {}),
        ...(payload.longitude !== undefined ? { longitude: payload.longitude } : {}),
      })
      .where(and(eq(shops.id, shopId), eq(shops.ownerUid, ownerUid)))
      .returning();
    return updated ?? null;
  } catch (error) {
    throw sanitizeDbError('updating shop profile', error);
  }
}

export async function seedSampleDataIntoShop(
  shopId: number,
  ownerUid: string,
  includeFestivals: boolean = true
) {
  try {
    const sample = createSampleKiranaWorkspace(shopId, ownerUid);

    await db
      .update(shops)
      .set({ isSampleData: true })
      .where(eq(shops.id, shopId));

    // Insert suppliers and map old -> new IDs
    const supplierIdMap = new Map<number, number>();
    for (const s of sample.suppliers) {
      const [inserted] = await db
        .insert(suppliers)
        .values({
          shopId,
          name: s.name,
          contactPhone: s.contactPhone,
          email: s.email ?? null,
          address: s.address ?? null,
          paymentTerms: s.paymentTerms,
          leadTimeDays: s.leadTimeDays,
          outstandingAmount: s.outstandingAmount,
          suppliedCategories: s.suppliedCategories ?? null,
        })
        .returning();
      supplierIdMap.set(s.id, inserted.id);
    }

    // Insert products and map old -> new IDs
    const productIdMap = new Map<number, number>();
    for (const p of sample.products) {
      const [inserted] = await db
        .insert(products)
        .values({
          shopId,
          supplierId: p.supplierId ? supplierIdMap.get(p.supplierId) ?? null : null,
          name: p.name,
          sku: p.sku,
          barcode: p.barcode ?? null,
          category: p.category,
          brand: p.brand ?? null,
          unit: p.unit,
          purchasePrice: p.purchasePrice,
          sellingPrice: p.sellingPrice,
          currentStock: p.currentStock,
          minStockLevel: p.minStockLevel,
          maxStockLevel: p.maxStockLevel,
          leadTimeDays: p.leadTimeDays,
          mfgDate: p.mfgDate ?? null,
          expiryDate: p.expiryDate ?? null,
        })
        .returning();
      productIdMap.set(p.id, inserted.id);
    }

    // Insert product batches and track old -> new IDs
    const batchIdMap = new Map<number, number>();
    for (const b of sample.batches) {
      const mappedProductId = productIdMap.get(b.productId);
      if (!mappedProductId) continue;
      const [insertedBatch] = await db
        .insert(productBatches)
        .values({
          shopId,
          productId: mappedProductId,
          batchNumber: b.batchNumber,
          quantity: b.quantity,
          purchasePrice: b.purchasePrice,
          mfgDate: b.mfgDate ?? null,
          expiryDate: b.expiryDate,
          status: b.status,
        })
        .returning();
      batchIdMap.set(b.id, insertedBatch.id);
    }

    // Insert sample inter-shop FEFO transfer opportunities
    if (sample.stockTransfers && sample.stockTransfers.length > 0) {
      for (const tr of sample.stockTransfers) {
        const mappedProductId = productIdMap.get(tr.productId);
        if (!mappedProductId) continue;
        await db.insert(stockTransfers).values({
          shopId,
          productId: mappedProductId,
          batchId: tr.batchId ? batchIdMap.get(tr.batchId) ?? null : null,
          batchNumber: tr.batchNumber ?? null,
          targetShopName: tr.targetShopName,
          targetVillage: tr.targetVillage,
          quantity: tr.quantity,
          unitCost: tr.unitCost,
          expiryDate: tr.expiryDate,
          sourceApproved: tr.sourceApproved,
          targetApproved: tr.targetApproved,
          status: tr.status,
          notes: tr.notes ?? null,
        });
      }
    }

    // Insert verified distributor offers and map old -> new IDs
    const offerIdMap = new Map<number, number>();
    if (sample.distributorOffers && sample.distributorOffers.length > 0) {
      for (const offer of sample.distributorOffers) {
        const [insertedOffer] = await db
          .insert(distributorOffers)
          .values({
            shopId,
            distributorName: offer.distributorName,
            distributorCity: offer.distributorCity,
            verified: offer.verified,
            productName: offer.productName,
            category: offer.category,
            unit: offer.unit,
            standardUnitPrice: offer.standardUnitPrice,
            bulkUnitPrice: offer.bulkUnitPrice,
            minBulkQty: offer.minBulkQty,
            availableQty: offer.availableQty,
            leadTimeDays: offer.leadTimeDays,
            deliveryFeeINR: offer.deliveryFeeINR,
            latitude: offer.latitude ?? null,
            longitude: offer.longitude ?? null,
          })
          .returning();
        offerIdMap.set(offer.id, insertedOffer.id);
      }
    }

    // Insert sample group orders and member commitments
    if (sample.groupOrders && sample.groupOrders.length > 0) {
      for (const grp of sample.groupOrders) {
        const [insertedGrp] = await db
          .insert(groupOrders)
          .values({
            shopId,
            poolCode: grp.poolCode,
            productName: grp.productName,
            category: grp.category,
            unit: grp.unit,
            distributorOfferId: grp.distributorOfferId
              ? offerIdMap.get(grp.distributorOfferId) ?? null
              : null,
            distributorName: grp.distributorName,
            standardUnitPrice: grp.standardUnitPrice,
            bulkUnitPrice: grp.bulkUnitPrice,
            minBulkQty: grp.minBulkQty,
            combinedQty: grp.combinedQty,
            estTransportFeeIndividual: grp.estTransportFeeIndividual,
            estTransportFeeShared: grp.estTransportFeeShared,
            deliveryWindow: grp.deliveryWindow,
            status: grp.status,
            ownerApproved: grp.ownerApproved,
            distributorAccepted: grp.distributorAccepted,
            notes: grp.notes ?? null,
          })
          .returning();

        if (grp.members && grp.members.length > 0) {
          await db.insert(groupOrderMembers).values(
            grp.members.map((m) => ({
              groupOrderId: insertedGrp.id,
              shopName: m.shopName,
              village: m.village,
              quantity: m.quantity,
              isCurrentShop: m.isCurrentShop,
              ownerApproved: m.ownerApproved,
            }))
          );
        }
      }
    }

    // Insert privacy-safe village demand signals
    if (sample.villageDemandSignals && sample.villageDemandSignals.length > 0) {
      await db.insert(villageDemandSignals).values(
        sample.villageDemandSignals.map((sig) => ({
          shopId,
          villageName: sig.villageName,
          district: sig.district,
          latitude: sig.latitude,
          longitude: sig.longitude,
          connectedShopsCount: sig.connectedShopsCount,
          topCategory: sig.topCategory,
          topProduct: sig.topProduct,
          estimatedWeeklyUnits: sig.estimatedWeeklyUnits,
          shortageSeverity: sig.shortageSeverity,
          isOptedIn: sig.isOptedIn,
          isDemoData: sig.isDemoData,
        }))
      );
    }

    // Insert optimized multi-stop delivery runs & stops
    if (sample.deliveryRuns && sample.deliveryRuns.length > 0) {
      for (const run of sample.deliveryRuns) {
        const [insertedRun] = await db
          .insert(deliveryRuns)
          .values({
            shopId,
            runCode: run.runCode,
            vehicleType: run.vehicleType,
            vehicleCapacityKg: run.vehicleCapacityKg,
            totalLoadKg: run.totalLoadKg,
            driverName: run.driverName,
            driverPhone: run.driverPhone ?? null,
            originName: run.originName,
            originLat: run.originLat,
            originLng: run.originLng,
            optimizedDistanceKm: run.optimizedDistanceKm,
            naiveDistanceKm: run.naiveDistanceKm,
            estimatedDurationMin: run.estimatedDurationMin,
            estimatedFuelCostINR: run.estimatedFuelCostINR,
            sharedCostPerShopINR: run.sharedCostPerShopINR,
            soloCostPerShopINR: run.soloCostPerShopINR,
            status: run.status,
            optimizationNotes: run.optimizationNotes ?? null,
          })
          .returning();

        if (run.stops && run.stops.length > 0) {
          await db.insert(deliveryStops).values(
            run.stops.map((st) => ({
              deliveryRunId: insertedRun.id,
              sequenceOrder: st.sequenceOrder,
              shopName: st.shopName,
              village: st.village,
              latitude: st.latitude,
              longitude: st.longitude,
              loadKg: st.loadKg,
              itemSummary: st.itemSummary,
              groupOrderCode: st.groupOrderCode ?? null,
              etaWindow: st.etaWindow,
              status: st.status,
              deliveredAt: st.deliveredAt ?? null,
              proofNotes: st.proofNotes ?? null,
            }))
          );
        }
      }
    }

    // Insert historical sales & items
    for (const sale of sample.sales) {
      const [insertedSale] = await db
        .insert(sales)
        .values({
          shopId,
          invoiceNumber: sale.invoiceNumber,
          customerName: sale.customerName ?? null,
          customerPhone: sale.customerPhone ?? null,
          paymentMethod: sale.paymentMethod,
          subtotal: sale.subtotal,
          discount: sale.discount,
          totalAmount: sale.totalAmount,
          totalCost: sale.totalCost,
          grossProfit: sale.grossProfit,
          saleDate: sale.saleDate,
        })
        .returning();

      const itemRows = sale.items
        .map((item) => {
          const mappedProductId = productIdMap.get(item.productId);
          if (!mappedProductId) return null;
          return {
            saleId: insertedSale.id,
            productId: mappedProductId,
            productName: item.productName,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            unitCost: item.unitCost,
            lineTotal: item.lineTotal,
            lineProfit: item.lineProfit,
          };
        })
        .filter((row): row is NonNullable<typeof row> => row !== null);

      if (itemRows.length > 0) {
        await db.insert(saleItems).values(itemRows);
      }
    }

    // Insert purchases & purchase items
    for (const po of sample.purchases) {
      const [insertedPo] = await db
        .insert(purchases)
        .values({
          shopId,
          supplierId: po.supplierId ? supplierIdMap.get(po.supplierId) ?? null : null,
          poNumber: po.poNumber,
          status: po.status,
          totalAmount: po.totalAmount,
          paidAmount: po.paidAmount,
          orderDate: po.orderDate,
          receivedDate: po.receivedDate ?? null,
          notes: po.notes ?? null,
        })
        .returning();

      const poItemRows = po.items
        .map((item) => {
          const mappedProductId = productIdMap.get(item.productId);
          if (!mappedProductId) return null;
          return {
            purchaseId: insertedPo.id,
            productId: mappedProductId,
            productName: item.productName,
            orderedQty: item.orderedQty,
            receivedQty: item.receivedQty,
            unitCost: item.unitCost,
            batchNumber: item.batchNumber ?? null,
            expiryDate: item.expiryDate ?? null,
          };
        })
        .filter((row): row is NonNullable<typeof row> => row !== null);

      if (poItemRows.length > 0) {
        await db.insert(purchaseItems).values(poItemRows);
      }
    }

    // Insert stock movements
    for (const mv of sample.stockMovements) {
      const mappedProductId = productIdMap.get(mv.productId);
      if (!mappedProductId) continue;
      await db.insert(stockMovements).values({
        shopId,
        productId: mappedProductId,
        movementType: mv.movementType,
        quantityChange: mv.quantityChange,
        balanceAfter: mv.balanceAfter,
        reason: mv.reason ?? null,
        referenceId: mv.referenceId ?? null,
      });
    }

    // Insert wastage logs
    for (const w of sample.wastageLogs) {
      const mappedProductId = productIdMap.get(w.productId);
      if (!mappedProductId) continue;
      await db.insert(wastageLogs).values({
        shopId,
        productId: mappedProductId,
        batchId: null,
        quantity: w.quantity,
        estimatedLoss: w.estimatedLoss,
        reason: w.reason,
        loggedDate: w.loggedDate,
      });
    }

    if (includeFestivals) {
      const existingFestivals = await db
        .select()
        .from(festivals)
        .where(eq(festivals.shopId, shopId));
      if (existingFestivals.length === 0) {
        await db.insert(festivals).values(
          sample.festivals.map((f) => ({
            shopId,
            name: f.name,
            festivalDate: f.festivalDate,
            category: f.category,
            expectedUpliftPct: f.expectedUpliftPct,
            focusCategories: f.focusCategories,
            notes: f.notes ?? null,
            isDismissed: false,
            isCustom: f.isCustom,
          }))
        );
      }
    }

    // Insert notifications
    await db.insert(notifications).values(
      sample.notifications.map((n) => ({
        shopId,
        type: n.type,
        severity: n.severity,
        title: n.title,
        message: n.message,
        isRead: false,
      }))
    );

    // Generate persisted reorder suggestions based on newly inserted data
    await regenerateReordersForShop(shopId);
  } catch (error) {
    throw sanitizeDbError('loading sample Kirana data', error);
  }
}

export async function getShopWorkspace(shopId: number): Promise<ShopWorkspacePayload | null> {
  try {
    const shopRows = await db.select().from(shops).where(eq(shops.id, shopId)).limit(1);
    const shop = shopRows[0];
    if (!shop) return null;

    const [
      supplierRows,
      productRows,
      batchRows,
      saleRows,
      purchaseRows,
      movementRows,
      wastageRows,
      transferRows,
      distributorOfferRows,
      groupOrderRows,
      villageSignalRows,
      deliveryRunRows,
      reorderRows,
      festivalRows,
      notificationRows,
    ] = await Promise.all([
      db.select().from(suppliers).where(eq(suppliers.shopId, shopId)).orderBy(suppliers.name),
      db.select().from(products).where(eq(products.shopId, shopId)).orderBy(products.name),
      db.select().from(productBatches).where(eq(productBatches.shopId, shopId)).orderBy(productBatches.expiryDate),
      db.select().from(sales).where(eq(sales.shopId, shopId)).orderBy(desc(sales.saleDate), desc(sales.id)),
      db.select().from(purchases).where(eq(purchases.shopId, shopId)).orderBy(desc(purchases.orderDate), desc(purchases.id)),
      db.select().from(stockMovements).where(eq(stockMovements.shopId, shopId)).orderBy(desc(stockMovements.createdAt)).limit(200),
      db.select().from(wastageLogs).where(eq(wastageLogs.shopId, shopId)).orderBy(desc(wastageLogs.createdAt)),
      db.select().from(stockTransfers).where(eq(stockTransfers.shopId, shopId)).orderBy(desc(stockTransfers.createdAt)),
      db.select().from(distributorOffers).where(eq(distributorOffers.shopId, shopId)).orderBy(desc(distributorOffers.updatedAt)),
      db.select().from(groupOrders).where(eq(groupOrders.shopId, shopId)).orderBy(desc(groupOrders.updatedAt)),
      db.select().from(villageDemandSignals).where(eq(villageDemandSignals.shopId, shopId)).orderBy(desc(villageDemandSignals.estimatedWeeklyUnits)),
      db.select().from(deliveryRuns).where(eq(deliveryRuns.shopId, shopId)).orderBy(desc(deliveryRuns.updatedAt)),
      db.select().from(reorderRecommendations).where(eq(reorderRecommendations.shopId, shopId)).orderBy(desc(reorderRecommendations.createdAt)),
      db.select().from(festivals).where(eq(festivals.shopId, shopId)).orderBy(festivals.festivalDate),
      db.select().from(notifications).where(eq(notifications.shopId, shopId)).orderBy(desc(notifications.createdAt)).limit(50),
    ]);

    const saleIds = saleRows.map((s) => s.id);
    const saleItemRows =
      saleIds.length > 0
        ? await db.select().from(saleItems).where(inArray(saleItems.saleId, saleIds))
        : [];
    const saleItemsBySale = new Map<number, typeof saleItemRows>();
    for (const item of saleItemRows) {
      if (!saleItemsBySale.has(item.saleId)) saleItemsBySale.set(item.saleId, []);
      saleItemsBySale.get(item.saleId)!.push(item);
    }

    const poIds = purchaseRows.map((p) => p.id);
    const poItemRows =
      poIds.length > 0
        ? await db.select().from(purchaseItems).where(inArray(purchaseItems.purchaseId, poIds))
        : [];
    const poItemsByPo = new Map<number, typeof poItemRows>();
    for (const item of poItemRows) {
      if (!poItemsByPo.has(item.purchaseId)) poItemsByPo.set(item.purchaseId, []);
      poItemsByPo.get(item.purchaseId)!.push(item);
    }

    const groupIds = groupOrderRows.map((g) => g.id);
    const groupMemberRows =
      groupIds.length > 0
        ? await db
            .select()
            .from(groupOrderMembers)
            .where(inArray(groupOrderMembers.groupOrderId, groupIds))
        : [];
    const membersByGroup = new Map<number, typeof groupMemberRows>();
    for (const member of groupMemberRows) {
      if (!membersByGroup.has(member.groupOrderId)) membersByGroup.set(member.groupOrderId, []);
      membersByGroup.get(member.groupOrderId)!.push(member);
    }

    const runIds = deliveryRunRows.map((r) => r.id);
    const deliveryStopRows =
      runIds.length > 0
        ? await db
            .select()
            .from(deliveryStops)
            .where(inArray(deliveryStops.deliveryRunId, runIds))
        : [];
    const stopsByRun = new Map<number, typeof deliveryStopRows>();
    for (const st of deliveryStopRows) {
      if (!stopsByRun.has(st.deliveryRunId)) stopsByRun.set(st.deliveryRunId, []);
      stopsByRun.get(st.deliveryRunId)!.push(st);
    }
    for (const list of stopsByRun.values()) {
      list.sort((a, b) => a.sequenceOrder - b.sequenceOrder);
    }

    const productMap = new Map(productRows.map((p) => [p.id, p]));
    const supplierMap = new Map(supplierRows.map((s) => [s.id, s]));

    return {
      shop: {
        ...shop,
        createdAt: shop.createdAt.toISOString(),
      },
      suppliers: supplierRows,
      products: productRows,
      batches: batchRows,
      sales: saleRows.map((s) => ({
        ...s,
        createdAt: s.createdAt.toISOString(),
        items: saleItemsBySale.get(s.id) || [],
      })),
      purchases: purchaseRows.map((p) => ({
        ...p,
        items: poItemsByPo.get(p.id) || [],
      })),
      stockMovements: movementRows.map((m) => ({
        ...m,
        createdAt: m.createdAt.toISOString(),
      })),
      wastageLogs: wastageRows,
      stockTransfers: transferRows.map((tr) => ({
        ...tr,
        productName: productMap.get(tr.productId)?.name ?? 'Unknown Product',
        createdAt: tr.createdAt.toISOString(),
      })),
      distributorOffers: distributorOfferRows.map((o) => ({
        ...o,
        updatedAt: o.updatedAt.toISOString(),
      })),
      groupOrders: groupOrderRows.map((g) => ({
        ...g,
        createdAt: g.createdAt.toISOString(),
        updatedAt: g.updatedAt.toISOString(),
        members: (membersByGroup.get(g.id) || []).map((m) => ({
          ...m,
          createdAt: m.createdAt.toISOString(),
        })),
      })),
      villageDemandSignals: villageSignalRows.map((sig) => ({
        ...sig,
        updatedAt: sig.updatedAt.toISOString(),
      })),
      deliveryRuns: deliveryRunRows.map((run) => ({
        ...run,
        createdAt: run.createdAt.toISOString(),
        updatedAt: run.updatedAt.toISOString(),
        stops: stopsByRun.get(run.id) || [],
      })),
      reorders: reorderRows.map((r) => ({
        ...r,
        productName: productMap.get(r.productId)?.name ?? 'Unknown Product',
        supplierName: r.supplierId ? supplierMap.get(r.supplierId)?.name ?? 'Unassigned' : 'Unassigned',
        createdAt: r.createdAt.toISOString(),
      })),
      festivals: festivalRows,
      notifications: notificationRows.map((n) => ({
        ...n,
        createdAt: n.createdAt.toISOString(),
      })),
    };
  } catch (error) {
    throw sanitizeDbError('loading shop workspace', error);
  }
}

export async function createProductRecord(
  shopId: number,
  actorUid: string,
  payload: {
    name: string;
    sku: string;
    barcode?: string;
    category: string;
    brand?: string;
    unit: string;
    purchasePrice: number;
    sellingPrice: number;
    currentStock: number;
    minStockLevel: number;
    maxStockLevel: number;
    supplierId?: number | null;
    leadTimeDays?: number;
    mfgDate?: string;
    expiryDate?: string;
    batchNumber?: string;
  }
) {
  try {
    const [created] = await db
      .insert(products)
      .values({
        shopId,
        supplierId: payload.supplierId ?? null,
        name: payload.name.trim(),
        sku: payload.sku.trim().toUpperCase(),
        barcode: payload.barcode?.trim() || null,
        category: payload.category.trim(),
        brand: payload.brand?.trim() || null,
        unit: payload.unit.trim() || 'pcs',
        purchasePrice: payload.purchasePrice,
        sellingPrice: payload.sellingPrice,
        currentStock: payload.currentStock,
        minStockLevel: payload.minStockLevel,
        maxStockLevel: payload.maxStockLevel,
        leadTimeDays: payload.leadTimeDays ?? 3,
        mfgDate: payload.mfgDate || null,
        expiryDate: payload.expiryDate || null,
      })
      .returning();

    if (payload.currentStock > 0) {
      await db.insert(stockMovements).values({
        shopId,
        productId: created.id,
        movementType: 'opening',
        quantityChange: payload.currentStock,
        balanceAfter: payload.currentStock,
        reason: 'Opening inventory stock',
        referenceId: created.sku,
      });

      if (payload.expiryDate) {
        await db.insert(productBatches).values({
          shopId,
          productId: created.id,
          batchNumber: payload.batchNumber?.trim() || `B-${created.sku.slice(0, 6)}`,
          quantity: payload.currentStock,
          purchasePrice: payload.purchasePrice,
          mfgDate: payload.mfgDate || null,
          expiryDate: payload.expiryDate,
          status: 'active',
        });
      }
    }

    await db.insert(auditLogs).values({
      shopId,
      actorUid,
      action: 'CREATE_PRODUCT',
      entityType: 'product',
      entityId: String(created.id),
      details: `Added product ${created.name} (${created.sku})`,
    });

    return created;
  } catch (error) {
    throw sanitizeDbError('creating product', error);
  }
}

export async function updateProductRecord(
  shopId: number,
  productId: number,
  payload: Partial<{
    name: string;
    sku: string;
    barcode: string | null;
    category: string;
    brand: string | null;
    unit: string;
    purchasePrice: number;
    sellingPrice: number;
    minStockLevel: number;
    maxStockLevel: number;
    supplierId: number | null;
    leadTimeDays: number;
    mfgDate: string | null;
    expiryDate: string | null;
  }>
) {
  try {
    const [updated] = await db
      .update(products)
      .set({
        ...payload,
        updatedAt: new Date(),
      })
      .where(and(eq(products.id, productId), eq(products.shopId, shopId)))
      .returning();
    return updated ?? null;
  } catch (error) {
    throw sanitizeDbError('updating product', error);
  }
}

export async function deleteProductRecord(shopId: number, productId: number) {
  try {
    const [deleted] = await db
      .delete(products)
      .where(and(eq(products.id, productId), eq(products.shopId, shopId)))
      .returning();
    return deleted ?? null;
  } catch (error) {
    throw sanitizeDbError('deleting product', error);
  }
}

export async function adjustProductStock(
  shopId: number,
  productId: number,
  quantityChange: number,
  reason: string,
  allowNegative: boolean = false
) {
  try {
    const [existing] = await db
      .select()
      .from(products)
      .where(and(eq(products.id, productId), eq(products.shopId, shopId)))
      .limit(1);

    if (!existing) {
      throw new Error('Product not found.');
    }

    const nextStock = existing.currentStock + quantityChange;
    if (nextStock < 0 && !allowNegative) {
      throw new Error(
        `Adjustment would result in negative stock (${nextStock}). Authorize override or reduce adjustment quantity.`
      );
    }

    const [updated] = await db
      .update(products)
      .set({ currentStock: nextStock, updatedAt: new Date() })
      .where(eq(products.id, productId))
      .returning();

    await db.insert(stockMovements).values({
      shopId,
      productId,
      movementType: 'adjustment',
      quantityChange,
      balanceAfter: nextStock,
      reason: reason.trim() || 'Manual stock count adjustment',
      referenceId: `ADJ-${Date.now().toString().slice(-5)}`,
    });

    if (nextStock <= existing.minStockLevel) {
      await db.insert(notifications).values({
        shopId,
        type: nextStock <= 0 ? 'out_of_stock' : 'low_stock',
        severity: nextStock <= 0 ? 'critical' : 'warning',
        title:
          nextStock <= 0
            ? `Out of stock: ${existing.name}`
            : `Low stock alert: ${existing.name}`,
        message: `Available stock is now ${nextStock} ${existing.unit} (min level: ${existing.minStockLevel}).`,
      });
    }

    return updated;
  } catch (error) {
    if (error instanceof Error && (error.message.includes('negative stock') || error.message.includes('Product not found'))) {
      throw error;
    }
    throw sanitizeDbError('adjusting inventory stock', error);
  }
}

export async function recordSaleTransaction(
  shopId: number,
  payload: {
    customerName?: string;
    customerPhone?: string;
    paymentMethod: string;
    discount: number;
    saleDate?: string;
    items: Array<{ productId: number; quantity: number }>;
  }
) {
  try {
    const productIds = payload.items.map((i) => i.productId);
    const catalog = await db
      .select()
      .from(products)
      .where(and(eq(products.shopId, shopId), inArray(products.id, productIds)));
    const prodMap = new Map(catalog.map((p) => [p.id, p]));

    let subtotal = 0;
    let totalCost = 0;
    const computedItems: Array<{
      productId: number;
      productName: string;
      quantity: number;
      unitPrice: number;
      unitCost: number;
      lineTotal: number;
      lineProfit: number;
      newBalance: number;
      minStockLevel: number;
      unit: string;
    }> = [];

    for (const reqItem of payload.items) {
      const prod = prodMap.get(reqItem.productId);
      if (!prod) {
        throw new Error(`Product ID ${reqItem.productId} does not exist in this shop.`);
      }
      if (!Number.isInteger(reqItem.quantity) || reqItem.quantity <= 0) {
        throw new Error(`Invalid sale quantity for ${prod.name}. Must be a positive integer.`);
      }
      if (prod.currentStock < reqItem.quantity) {
        throw new Error(
          `Insufficient stock for ${prod.name}. Available: ${prod.currentStock} ${prod.unit}, requested: ${reqItem.quantity}.`
        );
      }

      const lineTotal = Number((reqItem.quantity * prod.sellingPrice).toFixed(2));
      const lineCost = Number((reqItem.quantity * prod.purchasePrice).toFixed(2));
      subtotal += lineTotal;
      totalCost += lineCost;

      computedItems.push({
        productId: prod.id,
        productName: prod.name,
        quantity: reqItem.quantity,
        unitPrice: prod.sellingPrice,
        unitCost: prod.purchasePrice,
        lineTotal,
        lineProfit: Number((lineTotal - lineCost).toFixed(2)),
        newBalance: prod.currentStock - reqItem.quantity,
        minStockLevel: prod.minStockLevel,
        unit: prod.unit,
      });
    }

    const safeDiscount = Math.max(0, Math.min(payload.discount || 0, subtotal));
    const totalAmount = Number((subtotal - safeDiscount).toFixed(2));
    const grossProfit = Number((totalAmount - totalCost).toFixed(2));
    const saleDate = payload.saleDate || formatISODate(new Date());
    const invoiceNumber = `INV-${saleDate.replace(/-/g, '')}-${String(Math.floor(100 + Math.random() * 900))}`;

    const [createdSale] = await db
      .insert(sales)
      .values({
        shopId,
        invoiceNumber,
        customerName: payload.customerName?.trim() || 'Walk-in Customer',
        customerPhone: payload.customerPhone?.trim() || null,
        paymentMethod: payload.paymentMethod || 'Cash',
        subtotal: Number(subtotal.toFixed(2)),
        discount: Number(safeDiscount.toFixed(2)),
        totalAmount,
        totalCost: Number(totalCost.toFixed(2)),
        grossProfit,
        saleDate,
      })
      .returning();

    await db.insert(saleItems).values(
      computedItems.map((i) => ({
        saleId: createdSale.id,
        productId: i.productId,
        productName: i.productName,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        unitCost: i.unitCost,
        lineTotal: i.lineTotal,
        lineProfit: i.lineProfit,
      }))
    );

    // Deduct product stock, FIFO batch stock (non-expired active batches), and log movements
    const todayISO = formatISODate(new Date());
    for (const item of computedItems) {
      await db
        .update(products)
        .set({ currentStock: item.newBalance, updatedAt: new Date() })
        .where(eq(products.id, item.productId));

      await db.insert(stockMovements).values({
        shopId,
        productId: item.productId,
        movementType: 'sale',
        quantityChange: -item.quantity,
        balanceAfter: item.newBalance,
        reason: `Retail bill ${invoiceNumber}`,
        referenceId: invoiceNumber,
      });

      // FIFO deduction from active non-expired batches
      const activeBatches = await db
        .select()
        .from(productBatches)
        .where(
          and(
            eq(productBatches.shopId, shopId),
            eq(productBatches.productId, item.productId),
            eq(productBatches.status, 'active')
          )
        )
        .orderBy(productBatches.expiryDate);

      let remainingToDeduct = item.quantity;
      for (const batch of activeBatches) {
        if (remainingToDeduct <= 0) break;
        if (batch.expiryDate < todayISO) continue; // Never sell expired batches
        const deduct = Math.min(batch.quantity, remainingToDeduct);
        const nextBatchQty = batch.quantity - deduct;
        await db
          .update(productBatches)
          .set({
            quantity: nextBatchQty,
            status: nextBatchQty === 0 ? 'depleted' : 'active',
          })
          .where(eq(productBatches.id, batch.id));
        remainingToDeduct -= deduct;
      }

      if (item.newBalance <= item.minStockLevel) {
        await db.insert(notifications).values({
          shopId,
          type: item.newBalance === 0 ? 'out_of_stock' : 'low_stock',
          severity: item.newBalance === 0 ? 'critical' : 'warning',
          title:
            item.newBalance === 0
              ? `Out of stock: ${item.productName}`
              : `Low stock alert: ${item.productName}`,
          message: `After bill ${invoiceNumber}, ${item.newBalance} ${item.unit} remaining (min: ${item.minStockLevel}).`,
        });
      }
    }

    return {
      ...createdSale,
      items: computedItems,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('Insufficient stock') ||
        error.message.includes('Invalid sale quantity') ||
        error.message.includes('does not exist'))
    ) {
      throw error;
    }
    throw sanitizeDbError('recording sale transaction', error);
  }
}

export async function createSupplierRecord(
  shopId: number,
  payload: {
    name: string;
    contactPhone: string;
    email?: string;
    address?: string;
    paymentTerms: string;
    leadTimeDays: number;
    outstandingAmount?: number;
    suppliedCategories?: string;
  }
) {
  try {
    const [created] = await db
      .insert(suppliers)
      .values({
        shopId,
        name: payload.name.trim(),
        contactPhone: payload.contactPhone.trim(),
        email: payload.email?.trim() || null,
        address: payload.address?.trim() || null,
        paymentTerms: payload.paymentTerms.trim() || 'Net 15 Days',
        leadTimeDays: Math.max(1, payload.leadTimeDays || 3),
        outstandingAmount: Math.max(0, payload.outstandingAmount || 0),
        suppliedCategories: payload.suppliedCategories?.trim() || null,
      })
      .returning();
    return created;
  } catch (error) {
    throw sanitizeDbError('creating supplier', error);
  }
}

export async function recordSupplierPayment(
  shopId: number,
  supplierId: number,
  amount: number
) {
  try {
    const [existing] = await db
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.id, supplierId), eq(suppliers.shopId, shopId)))
      .limit(1);
    if (!existing) throw new Error('Supplier not found.');

    const nextBalance = Math.max(0, Number((existing.outstandingAmount - amount).toFixed(2)));
    const [updated] = await db
      .update(suppliers)
      .set({ outstandingAmount: nextBalance })
      .where(eq(suppliers.id, supplierId))
      .returning();
    return updated;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Supplier not found')) throw error;
    throw sanitizeDbError('recording supplier payment', error);
  }
}

export async function createPurchaseOrderRecord(
  shopId: number,
  payload: {
    supplierId?: number | null;
    notes?: string;
    orderDate?: string;
    items: Array<{
      productId: number;
      orderedQty: number;
      unitCost: number;
      batchNumber?: string;
      expiryDate?: string;
    }>;
  }
) {
  try {
    const prodIds = payload.items.map((i) => i.productId);
    const catalog = await db
      .select()
      .from(products)
      .where(and(eq(products.shopId, shopId), inArray(products.id, prodIds)));
    const prodMap = new Map(catalog.map((p) => [p.id, p]));

    let totalAmount = 0;
    const preparedItems = payload.items.map((item) => {
      const prod = prodMap.get(item.productId);
      if (!prod) throw new Error(`Product ${item.productId} not found.`);
      if (!Number.isInteger(item.orderedQty) || item.orderedQty <= 0) {
        throw new Error(`Invalid order quantity for ${prod.name}.`);
      }
      totalAmount += item.orderedQty * item.unitCost;
      return {
        productId: prod.id,
        productName: prod.name,
        orderedQty: item.orderedQty,
        receivedQty: 0,
        unitCost: item.unitCost,
        batchNumber: item.batchNumber || `POB-${Date.now().toString().slice(-4)}`,
        expiryDate: item.expiryDate || null,
      };
    });

    const orderDate = payload.orderDate || formatISODate(new Date());
    const poNumber = `PO-${orderDate.replace(/-/g, '')}-${String(Math.floor(100 + Math.random() * 900))}`;

    const [createdPo] = await db
      .insert(purchases)
      .values({
        shopId,
        supplierId: payload.supplierId ?? null,
        poNumber,
        status: 'pending',
        totalAmount: Number(totalAmount.toFixed(2)),
        paidAmount: 0,
        orderDate,
        notes: payload.notes?.trim() || null,
      })
      .returning();

    await db.insert(purchaseItems).values(
      preparedItems.map((i) => ({
        purchaseId: createdPo.id,
        ...i,
      }))
    );

    return { ...createdPo, items: preparedItems };
  } catch (error) {
    if (error instanceof Error && (error.message.includes('not found') || error.message.includes('Invalid'))) {
      throw error;
    }
    throw sanitizeDbError('creating purchase order', error);
  }
}

export async function receivePurchaseOrder(
  shopId: number,
  purchaseId: number,
  paidAmount?: number
) {
  try {
    const [po] = await db
      .select()
      .from(purchases)
      .where(and(eq(purchases.id, purchaseId), eq(purchases.shopId, shopId)))
      .limit(1);
    if (!po) throw new Error('Purchase order not found.');
    if (po.status === 'received') throw new Error('Purchase order is already received.');

    const items = await db
      .select()
      .from(purchaseItems)
      .where(eq(purchaseItems.purchaseId, purchaseId));

    const receivedDate = formatISODate(new Date());
    const safePaid = Math.max(0, Math.min(paidAmount ?? 0, po.totalAmount));

    await db
      .update(purchases)
      .set({
        status: 'received',
        receivedDate,
        paidAmount: safePaid,
      })
      .where(eq(purchases.id, purchaseId));

    // Update supplier outstanding amount if unpaid balance remains
    const unpaidDelta = Number((po.totalAmount - safePaid).toFixed(2));
    if (po.supplierId && unpaidDelta > 0) {
      const [sup] = await db
        .select()
        .from(suppliers)
        .where(eq(suppliers.id, po.supplierId))
        .limit(1);
      if (sup) {
        await db
          .update(suppliers)
          .set({ outstandingAmount: Number((sup.outstandingAmount + unpaidDelta).toFixed(2)) })
          .where(eq(suppliers.id, sup.id));
      }
    }

    // Increment product stock, create product batch if expiry provided, and log movements
    for (const item of items) {
      await db
        .update(purchaseItems)
        .set({ receivedQty: item.orderedQty })
        .where(eq(purchaseItems.id, item.id));

      const [prod] = await db
        .select()
        .from(products)
        .where(eq(products.id, item.productId))
        .limit(1);
      if (!prod) continue;

      const nextStock = prod.currentStock + item.orderedQty;
      await db
        .update(products)
        .set({
          currentStock: nextStock,
          purchasePrice: item.unitCost,
          updatedAt: new Date(),
        })
        .where(eq(products.id, prod.id));

      await db.insert(stockMovements).values({
        shopId,
        productId: prod.id,
        movementType: 'purchase',
        quantityChange: item.orderedQty,
        balanceAfter: nextStock,
        reason: `Received ${po.poNumber}`,
        referenceId: po.poNumber,
      });

      const defaultExpiry = new Date();
      defaultExpiry.setDate(defaultExpiry.getDate() + 180);
      await db.insert(productBatches).values({
        shopId,
        productId: prod.id,
        batchNumber: item.batchNumber || `RCV-${po.poNumber.slice(-4)}`,
        quantity: item.orderedQty,
        purchasePrice: item.unitCost,
        mfgDate: receivedDate,
        expiryDate: item.expiryDate || formatISODate(defaultExpiry),
        status: 'active',
      });
    }

    return { poNumber: po.poNumber, receivedDate };
  } catch (error) {
    if (error instanceof Error && (error.message.includes('not found') || error.message.includes('already received'))) {
      throw error;
    }
    throw sanitizeDbError('receiving purchase order', error);
  }
}

export async function removeExpiredOrDamagedBatch(
  shopId: number,
  batchId: number,
  reason: string
) {
  try {
    const [batch] = await db
      .select()
      .from(productBatches)
      .where(and(eq(productBatches.id, batchId), eq(productBatches.shopId, shopId)))
      .limit(1);
    if (!batch) throw new Error('Batch not found.');
    if (batch.status !== 'active' || batch.quantity <= 0) {
      throw new Error('Batch has already been removed or depleted.');
    }

    const [prod] = await db
      .select()
      .from(products)
      .where(eq(products.id, batch.productId))
      .limit(1);

    const estimatedLoss = Number((batch.quantity * batch.purchasePrice).toFixed(2));
    await db
      .update(productBatches)
      .set({ status: 'removed', quantity: 0 })
      .where(eq(productBatches.id, batch.id));

    await db.insert(wastageLogs).values({
      shopId,
      productId: batch.productId,
      batchId: batch.id,
      quantity: batch.quantity,
      estimatedLoss,
      reason: reason.trim() || 'Expired batch removed from sale',
      loggedDate: formatISODate(new Date()),
    });

    if (prod) {
      const nextStock = Math.max(0, prod.currentStock - batch.quantity);
      await db
        .update(products)
        .set({ currentStock: nextStock, updatedAt: new Date() })
        .where(eq(products.id, prod.id));

      await db.insert(stockMovements).values({
        shopId,
        productId: prod.id,
        movementType: 'wastage',
        quantityChange: -batch.quantity,
        balanceAfter: nextStock,
        reason: `Batch ${batch.batchNumber} removed: ${reason}`,
        referenceId: batch.batchNumber,
      });
    }

    return { removedQty: batch.quantity, estimatedLoss };
  } catch (error) {
    if (error instanceof Error && (error.message.includes('not found') || error.message.includes('already been'))) {
      throw error;
    }
    throw sanitizeDbError('removing expired batch', error);
  }
}

export async function regenerateReordersForShop(shopId: number) {
  try {
    const workspace = await getShopWorkspace(shopId);
    if (!workspace) throw new Error('Shop not found.');

    const computedForecasts = computeProductForecasts(
      workspace.products,
      workspace.sales,
      workspace.festivals
    );

    // Persist latest forecasts snapshot
    await db.delete(forecasts).where(eq(forecasts.shopId, shopId));
    if (computedForecasts.length > 0) {
      await db.insert(forecasts).values(
        computedForecasts.map((f) => ({
          shopId,
          productId: f.productId,
          methodUsed: f.methodUsed,
          horizonDays: f.horizonDays,
          expectedDemand7d: f.expectedDemand7d,
          expectedDemand30d: f.expectedDemand30d,
          avgDailySales: f.avgDailySales,
          trendDirection: f.trendDirection,
          confidenceLevel: f.confidenceLevel,
          dataDaysUsed: f.dataDaysUsed,
          shortageRisk: f.shortageRisk,
          slowMovingFlag: f.slowMovingFlag,
          notes: f.notes,
        }))
      );
    }

    // Replace only pending reorder recommendations (preserve approved/rejected history)
    await db
      .delete(reorderRecommendations)
      .where(
        and(
          eq(reorderRecommendations.shopId, shopId),
          eq(reorderRecommendations.status, 'pending')
        )
      );

    const freshRecs = computeReorderRecommendations(
      shopId,
      workspace.products,
      workspace.suppliers,
      workspace.purchases,
      computedForecasts
    );

    if (freshRecs.length > 0) {
      await db.insert(reorderRecommendations).values(
        freshRecs.map((r) => ({
          shopId,
          productId: r.productId,
          supplierId: r.supplierId ?? null,
          availableStock: r.availableStock,
          incomingStock: r.incomingStock,
          expectedDemandLeadTime: r.expectedDemandLeadTime,
          safetyStock: r.safetyStock,
          reorderPoint: r.reorderPoint,
          suggestedQty: r.suggestedQty,
          estimatedCost: r.estimatedCost,
          reason: r.reason,
          formulaBreakdown: r.formulaBreakdown,
          status: 'pending',
        }))
      );
    }

    return { forecastCount: computedForecasts.length, reorderCount: freshRecs.length };
  } catch (error) {
    throw sanitizeDbError('generating demand forecasts and reorder suggestions', error);
  }
}

export async function decideReorderRecommendation(
  shopId: number,
  reorderId: number,
  decision: 'approved' | 'rejected',
  editedQty?: number
) {
  try {
    const [rec] = await db
      .select()
      .from(reorderRecommendations)
      .where(
        and(
          eq(reorderRecommendations.id, reorderId),
          eq(reorderRecommendations.shopId, shopId)
        )
      )
      .limit(1);
    if (!rec) throw new Error('Reorder recommendation not found.');

    const finalQty =
      decision === 'approved'
        ? Math.max(1, Math.round(editedQty ?? rec.suggestedQty))
        : 0;

    const [prod] = await db
      .select()
      .from(products)
      .where(eq(products.id, rec.productId))
      .limit(1);

    const updatedCost = prod ? Number((finalQty * prod.purchasePrice).toFixed(2)) : rec.estimatedCost;

    const [updated] = await db
      .update(reorderRecommendations)
      .set({
        status: decision,
        approvedQty: decision === 'approved' ? finalQty : null,
        estimatedCost: decision === 'approved' ? updatedCost : rec.estimatedCost,
        updatedAt: new Date(),
      })
      .where(eq(reorderRecommendations.id, reorderId))
      .returning();

    // Only create a pending purchase order when the shop owner explicitly approves
    let createdPo = null;
    if (decision === 'approved' && prod) {
      createdPo = await createPurchaseOrderRecord(shopId, {
        supplierId: rec.supplierId ?? prod.supplierId ?? null,
        notes: `Owner-approved from Reorder Recommendation #${rec.id}`,
        items: [
          {
            productId: prod.id,
            orderedQty: finalQty,
            unitCost: prod.purchasePrice,
          },
        ],
      });
    }

    return { recommendation: updated, purchaseOrder: createdPo };
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) throw error;
    throw sanitizeDbError('updating reorder recommendation', error);
  }
}

export async function createFestivalRecord(
  shopId: number,
  payload: {
    name: string;
    festivalDate: string;
    category: string;
    expectedUpliftPct: number;
    focusCategories: string;
    notes?: string;
  }
) {
  try {
    const [created] = await db
      .insert(festivals)
      .values({
        shopId,
        name: payload.name.trim(),
        festivalDate: payload.festivalDate,
        category: payload.category || 'Local Event',
        expectedUpliftPct: Math.max(5, Math.min(100, payload.expectedUpliftPct || 30)),
        focusCategories: payload.focusCategories.trim(),
        notes: payload.notes?.trim() || null,
        isDismissed: false,
        isCustom: true,
      })
      .returning();
    return created;
  } catch (error) {
    throw sanitizeDbError('adding festival event', error);
  }
}

export async function toggleFestivalDismissed(
  shopId: number,
  festivalId: number,
  isDismissed: boolean
) {
  try {
    const [updated] = await db
      .update(festivals)
      .set({ isDismissed })
      .where(and(eq(festivals.id, festivalId), eq(festivals.shopId, shopId)))
      .returning();
    return updated ?? null;
  } catch (error) {
    throw sanitizeDbError('updating festival status', error);
  }
}

export async function markAllNotificationsRead(shopId: number) {
  try {
    await db
      .update(notifications)
      .set({ isRead: true })
      .where(eq(notifications.shopId, shopId));
    return { ok: true };
  } catch (error) {
    throw sanitizeDbError('marking notifications as read', error);
  }
}

export async function createStockTransferRecord(
  shopId: number,
  payload: {
    productId: number;
    batchId?: number | null;
    targetShopName: string;
    targetVillage: string;
    quantity: number;
    notes?: string;
  }
) {
  try {
    const todayISO = formatISODate(new Date());
    const [prod] = await db
      .select()
      .from(products)
      .where(and(eq(products.id, payload.productId), eq(products.shopId, shopId)))
      .limit(1);
    if (!prod) throw new Error('Product not found in this shop.');

    const qty = Math.round(Number(payload.quantity));
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new Error('Transfer quantity must be a positive integer.');
    }
    if (qty > prod.currentStock) {
      throw new Error(
        `Transfer quantity (${qty}) exceeds available stock (${prod.currentStock} ${prod.unit}).`
      );
    }

    let expiryDate = prod.expiryDate || todayISO;
    let batchNumber: string | null = null;
    if (payload.batchId) {
      const [batch] = await db
        .select()
        .from(productBatches)
        .where(and(eq(productBatches.id, payload.batchId), eq(productBatches.shopId, shopId)))
        .limit(1);
      if (!batch || batch.status !== 'active' || batch.quantity <= 0) {
        throw new Error('Selected batch is no longer active.');
      }
      if (batch.expiryDate < todayISO) {
        throw new Error('Expired batches can never be transferred. Remove expired stock as wastage instead.');
      }
      if (qty > batch.quantity) {
        throw new Error(`Transfer quantity (${qty}) exceeds batch stock (${batch.quantity}).`);
      }
      expiryDate = batch.expiryDate;
      batchNumber = batch.batchNumber;
    } else if (prod.expiryDate && prod.expiryDate < todayISO) {
      throw new Error('Expired stock cannot be transferred to partner shops.');
    }

    const [created] = await db
      .insert(stockTransfers)
      .values({
        shopId,
        productId: prod.id,
        batchId: payload.batchId ?? null,
        batchNumber,
        targetShopName: payload.targetShopName.trim(),
        targetVillage: payload.targetVillage.trim(),
        quantity: qty,
        unitCost: prod.purchasePrice,
        expiryDate,
        sourceApproved: true,
        targetApproved: false,
        status: 'awaiting_target',
        notes: payload.notes?.trim() || null,
      })
      .returning();

    await db.insert(notifications).values({
      shopId,
      type: 'transfer',
      severity: 'info',
      title: `Transfer proposed: ${prod.name}`,
      message: `Proposed ${qty} ${prod.unit} transfer to ${created.targetShopName} (${created.targetVillage}). Awaiting partner shop approval.`,
    });

    return {
      ...created,
      productName: prod.name,
      createdAt: created.createdAt.toISOString(),
    };
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('not found') ||
        error.message.includes('Expired') ||
        error.message.includes('exceeds') ||
        error.message.includes('positive integer') ||
        error.message.includes('no longer active'))
    ) {
      throw error;
    }
    throw sanitizeDbError('creating inter-shop transfer proposal', error);
  }
}

export async function updateStockTransferApproval(
  shopId: number,
  transferId: number,
  action: 'approve_source' | 'approve_target' | 'reject'
) {
  try {
    const todayISO = formatISODate(new Date());
    const [transfer] = await db
      .select()
      .from(stockTransfers)
      .where(and(eq(stockTransfers.id, transferId), eq(stockTransfers.shopId, shopId)))
      .limit(1);
    if (!transfer) throw new Error('Stock transfer proposal not found.');
    if (transfer.status === 'completed' || transfer.status === 'rejected') {
      throw new Error(`Transfer is already ${transfer.status}.`);
    }

    if (action === 'reject') {
      const [rejected] = await db
        .update(stockTransfers)
        .set({ status: 'rejected', updatedAt: new Date() })
        .where(eq(stockTransfers.id, transferId))
        .returning();
      return { ...rejected, createdAt: rejected.createdAt.toISOString() };
    }

    if (transfer.expiryDate < todayISO) {
      throw new Error('Cannot complete transfer: this batch has already expired.');
    }

    const nextSource = action === 'approve_source' ? true : transfer.sourceApproved;
    const nextTarget = action === 'approve_target' ? true : transfer.targetApproved;
    const bothApproved = nextSource && nextTarget;

    if (!bothApproved) {
      const nextStatus = nextSource ? 'awaiting_target' : 'proposed';
      const [updated] = await db
        .update(stockTransfers)
        .set({
          sourceApproved: nextSource,
          targetApproved: nextTarget,
          status: nextStatus,
          updatedAt: new Date(),
        })
        .where(eq(stockTransfers.id, transferId))
        .returning();
      return { ...updated, createdAt: updated.createdAt.toISOString() };
    }

    // Both shop owners approved: validate current stock and deduct cleanly
    const [prod] = await db
      .select()
      .from(products)
      .where(and(eq(products.id, transfer.productId), eq(products.shopId, shopId)))
      .limit(1);
    if (!prod) throw new Error('Product no longer exists.');
    if (prod.currentStock < transfer.quantity) {
      throw new Error(
        `Insufficient stock to complete transfer. Available: ${prod.currentStock}, required: ${transfer.quantity}.`
      );
    }

    if (transfer.batchId) {
      const [batch] = await db
        .select()
        .from(productBatches)
        .where(eq(productBatches.id, transfer.batchId))
        .limit(1);
      if (batch) {
        if (batch.expiryDate < todayISO) {
          throw new Error('Cannot transfer an expired batch.');
        }
        const nextBatchQty = Math.max(0, batch.quantity - transfer.quantity);
        await db
          .update(productBatches)
          .set({
            quantity: nextBatchQty,
            status: nextBatchQty === 0 ? 'depleted' : 'active',
          })
          .where(eq(productBatches.id, batch.id));
      }
    }

    const nextStock = prod.currentStock - transfer.quantity;
    await db
      .update(products)
      .set({ currentStock: nextStock, updatedAt: new Date() })
      .where(eq(products.id, prod.id));

    await db.insert(stockMovements).values({
      shopId,
      productId: prod.id,
      movementType: 'transfer_out',
      quantityChange: -transfer.quantity,
      balanceAfter: nextStock,
      reason: `Dual-approved transfer to ${transfer.targetShopName} (${transfer.targetVillage})`,
      referenceId: `TRF-${transfer.id}`,
    });

    const [completed] = await db
      .update(stockTransfers)
      .set({
        sourceApproved: true,
        targetApproved: true,
        status: 'completed',
        updatedAt: new Date(),
      })
      .where(eq(stockTransfers.id, transferId))
      .returning();

    await db.insert(notifications).values({
      shopId,
      type: 'transfer',
      severity: 'info',
      title: `Transfer completed: ${prod.name}`,
      message: `${transfer.quantity} ${prod.unit} transferred to ${transfer.targetShopName} after dual-owner approval. Prevented est. ₹${Math.round(transfer.quantity * transfer.unitCost)} expiry loss.`,
    });

    return {
      ...completed,
      productName: prod.name,
      createdAt: completed.createdAt.toISOString(),
    };
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('not found') ||
        error.message.includes('already') ||
        error.message.includes('expired') ||
        error.message.includes('Insufficient') ||
        error.message.includes('no longer'))
    ) {
      throw error;
    }
    throw sanitizeDbError('updating inter-shop stock transfer', error);
  }
}

export async function upsertVillageDemandOptIn(
  shopId: number,
  payload: {
    isOptedIn: boolean;
    villageName?: string;
    district?: string;
    latitude?: number | null;
    longitude?: number | null;
    topCategory?: string;
    topProduct?: string;
    estimatedWeeklyUnits?: number;
    shortageSeverity?: 'low' | 'moderate' | 'high';
  }
) {
  try {
    const [shopRow] = await db.select().from(shops).where(eq(shops.id, shopId)).limit(1);
    if (!shopRow) throw new Error('Shop not found.');

    if (payload.latitude !== undefined && payload.longitude !== undefined) {
      await db
        .update(shops)
        .set({
          latitude: payload.latitude,
          longitude: payload.longitude,
        })
        .where(eq(shops.id, shopId));
    }

    const existingRows = await db
      .select()
      .from(villageDemandSignals)
      .where(
        and(eq(villageDemandSignals.shopId, shopId), eq(villageDemandSignals.isDemoData, false))
      )
      .limit(1);

    const lat = payload.latitude ?? shopRow.latitude ?? 12.2958;
    const lng = payload.longitude ?? shopRow.longitude ?? 76.6394;
    const villageName = payload.villageName?.trim() || `${shopRow.city} Cluster (Your Cluster)`;
    const district = payload.district?.trim() || shopRow.city;

    if (existingRows[0]) {
      const [updated] = await db
        .update(villageDemandSignals)
        .set({
          isOptedIn: payload.isOptedIn,
          villageName,
          district,
          latitude: lat,
          longitude: lng,
          topCategory: payload.topCategory || existingRows[0].topCategory,
          topProduct: payload.topProduct || existingRows[0].topProduct,
          estimatedWeeklyUnits:
            payload.estimatedWeeklyUnits !== undefined
              ? Math.max(0, Math.round(payload.estimatedWeeklyUnits))
              : existingRows[0].estimatedWeeklyUnits,
          shortageSeverity: payload.shortageSeverity || existingRows[0].shortageSeverity,
          updatedAt: new Date(),
        })
        .where(eq(villageDemandSignals.id, existingRows[0].id))
        .returning();
      return { ...updated, updatedAt: updated.updatedAt.toISOString() };
    }

    const [created] = await db
      .insert(villageDemandSignals)
      .values({
        shopId,
        villageName,
        district,
        latitude: lat,
        longitude: lng,
        connectedShopsCount: 1,
        topCategory: payload.topCategory || 'Staples & Grains',
        topProduct: payload.topProduct || 'Essential Staples',
        estimatedWeeklyUnits: Math.max(0, Math.round(payload.estimatedWeeklyUnits ?? 120)),
        shortageSeverity: payload.shortageSeverity || 'moderate',
        isOptedIn: payload.isOptedIn,
        isDemoData: false,
      })
      .returning();

    return { ...created, updatedAt: created.updatedAt.toISOString() };
  } catch (error) {
    throw sanitizeDbError('updating village demand opt-in status', error);
  }
}

export async function createGroupOrderRecord(
  shopId: number,
  payload: {
    distributorOfferId?: number | null;
    productName?: string;
    category?: string;
    unit?: string;
    distributorName?: string;
    standardUnitPrice?: number;
    bulkUnitPrice?: number;
    minBulkQty?: number;
    myQuantity: number;
    deliveryWindow?: string;
    notes?: string;
  }
) {
  try {
    const [shopRow] = await db.select().from(shops).where(eq(shops.id, shopId)).limit(1);
    if (!shopRow) throw new Error('Shop not found.');

    const qty = Math.round(Number(payload.myQuantity));
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new Error('Your group order quantity must be a positive integer.');
    }

    let offer: typeof distributorOffers.$inferSelect | undefined;
    if (payload.distributorOfferId) {
      const rows = await db
        .select()
        .from(distributorOffers)
        .where(
          and(
            eq(distributorOffers.id, payload.distributorOfferId),
            eq(distributorOffers.shopId, shopId)
          )
        )
        .limit(1);
      offer = rows[0];
    }

    const productName = offer?.productName || payload.productName?.trim();
    const distributorName = offer?.distributorName || payload.distributorName?.trim();
    if (!productName || !distributorName) {
      throw new Error('Product name and verified distributor offer are required.');
    }

    const standardUnitPrice = Number(offer?.standardUnitPrice ?? payload.standardUnitPrice ?? 100);
    const bulkUnitPrice = Number(offer?.bulkUnitPrice ?? payload.bulkUnitPrice ?? 90);
    const minBulkQty = Math.max(1, Math.round(Number(offer?.minBulkQty ?? payload.minBulkQty ?? 40)));
    const individualFee = Number(offer?.deliveryFeeINR ?? 300);
    const sharedFee = Math.round(individualFee / 3);
    const status = qty >= minBulkQty ? 'threshold_met' : 'open';
    const poolCode = `GRP-${String(shopRow.city || 'RUR').slice(0, 3).toUpperCase()}-${Math.floor(
      100 + Math.random() * 900
    )}`;

    const [created] = await db
      .insert(groupOrders)
      .values({
        shopId,
        poolCode,
        productName,
        category: offer?.category || payload.category || 'Staples & Grains',
        unit: offer?.unit || payload.unit || 'pcs',
        distributorOfferId: offer?.id ?? null,
        distributorName,
        standardUnitPrice,
        bulkUnitPrice,
        minBulkQty,
        combinedQty: qty,
        estTransportFeeIndividual: individualFee,
        estTransportFeeShared: sharedFee,
        deliveryWindow: payload.deliveryWindow?.trim() || 'Within 48 hours (Shared Village Route)',
        status,
        ownerApproved: false,
        distributorAccepted: false,
        notes: payload.notes?.trim() || null,
      })
      .returning();

    const [member] = await db
      .insert(groupOrderMembers)
      .values({
        groupOrderId: created.id,
        shopName: shopRow.name,
        village: shopRow.city,
        quantity: qty,
        isCurrentShop: true,
        ownerApproved: false,
      })
      .returning();

    await db.insert(notifications).values({
      shopId,
      type: 'group_order',
      severity: 'info',
      title: `Group Order Pool ${poolCode} opened`,
      message: `Started collective pool for ${productName} (${qty}/${minBulkQty} ${created.unit}) with ${distributorName}.`,
    });

    return {
      ...created,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
      members: [{ ...member, createdAt: member.createdAt.toISOString() }],
    };
  } catch (error) {
    if (error instanceof Error && (error.message.includes('required') || error.message.includes('positive'))) {
      throw error;
    }
    throw sanitizeDbError('creating group order pool', error);
  }
}

export async function joinOrUpdateGroupOrder(
  shopId: number,
  groupOrderId: number,
  quantity: number
) {
  try {
    const qty = Math.round(Number(quantity));
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new Error('Quantity must be a positive integer.');
    }

    const [shopRow] = await db.select().from(shops).where(eq(shops.id, shopId)).limit(1);
    const [pool] = await db
      .select()
      .from(groupOrders)
      .where(and(eq(groupOrders.id, groupOrderId), eq(groupOrders.shopId, shopId)))
      .limit(1);
    if (!shopRow || !pool) throw new Error('Group order pool not found.');
    if (pool.status === 'cancelled' || pool.status === 'distributor_accepted') {
      throw new Error(`Cannot modify a pool that is already ${pool.status}.`);
    }

    const members = await db
      .select()
      .from(groupOrderMembers)
      .where(eq(groupOrderMembers.groupOrderId, groupOrderId));
    const currentMember = members.find((m) => m.isCurrentShop);

    if (currentMember) {
      await db
        .update(groupOrderMembers)
        .set({ quantity: qty, ownerApproved: false })
        .where(eq(groupOrderMembers.id, currentMember.id));
    } else {
      await db.insert(groupOrderMembers).values({
        groupOrderId,
        shopName: shopRow.name,
        village: shopRow.city,
        quantity: qty,
        isCurrentShop: true,
        ownerApproved: false,
      });
    }

    const refreshedMembers = await db
      .select()
      .from(groupOrderMembers)
      .where(eq(groupOrderMembers.groupOrderId, groupOrderId));
    const combinedQty = refreshedMembers.reduce((sum, m) => sum + m.quantity, 0);
    const memberCount = Math.max(1, refreshedMembers.length);
    const sharedFee = Math.round(pool.estTransportFeeIndividual / memberCount);
    const nextStatus =
      combinedQty >= pool.minBulkQty
        ? pool.ownerApproved
          ? 'approved_by_owner'
          : 'threshold_met'
        : 'open';

    const [updated] = await db
      .update(groupOrders)
      .set({
        combinedQty,
        estTransportFeeShared: sharedFee,
        status: nextStatus,
        ownerApproved: false,
        updatedAt: new Date(),
      })
      .where(eq(groupOrders.id, groupOrderId))
      .returning();

    return {
      ...updated,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      members: refreshedMembers.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
    };
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('not found') ||
        error.message.includes('positive') ||
        error.message.includes('Cannot modify'))
    ) {
      throw error;
    }
    throw sanitizeDbError('updating group order quantity', error);
  }
}

export async function updateGroupOrderAction(
  shopId: number,
  groupOrderId: number,
  action: 'approve_owner' | 'accept_distributor' | 'cancel'
) {
  try {
    const [pool] = await db
      .select()
      .from(groupOrders)
      .where(and(eq(groupOrders.id, groupOrderId), eq(groupOrders.shopId, shopId)))
      .limit(1);
    if (!pool) throw new Error('Group order pool not found.');
    if (pool.status === 'cancelled') throw new Error('Group order pool is already cancelled.');

    const members = await db
      .select()
      .from(groupOrderMembers)
      .where(eq(groupOrderMembers.groupOrderId, groupOrderId));
    const currentMember = members.find((m) => m.isCurrentShop);

    if (action === 'cancel') {
      const [cancelled] = await db
        .update(groupOrders)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(eq(groupOrders.id, groupOrderId))
        .returning();
      return {
        ...cancelled,
        createdAt: cancelled.createdAt.toISOString(),
        updatedAt: cancelled.updatedAt.toISOString(),
        members: members.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
      };
    }

    if (action === 'approve_owner') {
      if (!currentMember || currentMember.quantity <= 0) {
        throw new Error('Join the group order with a positive quantity before approving.');
      }
      if (pool.combinedQty < pool.minBulkQty) {
        throw new Error(
          `Minimum bulk threshold (${pool.minBulkQty} ${pool.unit}) not yet reached. Current pooled qty: ${pool.combinedQty}.`
        );
      }

      await db
        .update(groupOrderMembers)
        .set({ ownerApproved: true })
        .where(eq(groupOrderMembers.id, currentMember.id));

      const [approved] = await db
        .update(groupOrders)
        .set({
          ownerApproved: true,
          status: pool.distributorAccepted ? 'distributor_accepted' : 'approved_by_owner',
          updatedAt: new Date(),
        })
        .where(eq(groupOrders.id, groupOrderId))
        .returning();

      // Create an explicit pending Purchase Order at bulk tier pricing if matching product exists
      const shopProducts = await db
        .select()
        .from(products)
        .where(eq(products.shopId, shopId));
      const matchedProduct = shopProducts.find(
        (p) =>
          p.name.toLowerCase() === pool.productName.toLowerCase() ||
          p.name.toLowerCase().includes(pool.productName.toLowerCase().split(' ')[0])
      );

      if (matchedProduct) {
        const poNumber = `PO-GRP-${pool.poolCode}-${Date.now().toString().slice(-3)}`;
        const lineTotal = Math.round(currentMember.quantity * pool.bulkUnitPrice * 100) / 100;
        const [po] = await db
          .insert(purchases)
          .values({
            shopId,
            supplierId: matchedProduct.supplierId ?? null,
            poNumber,
            status: 'pending',
            totalAmount: lineTotal,
            paidAmount: 0,
            orderDate: formatISODate(new Date()),
            notes: `Group Order ${pool.poolCode} via ${pool.distributorName} (Bulk ₹${pool.bulkUnitPrice}/${pool.unit} vs Std ₹${pool.standardUnitPrice})`,
          })
          .returning();

        await db.insert(purchaseItems).values({
          purchaseId: po.id,
          productId: matchedProduct.id,
          productName: matchedProduct.name,
          orderedQty: currentMember.quantity,
          receivedQty: 0,
          unitCost: pool.bulkUnitPrice,
        });
      }

      const productSavings = Math.round(
        (pool.standardUnitPrice - pool.bulkUnitPrice) * currentMember.quantity
      );
      await db.insert(notifications).values({
        shopId,
        type: 'group_order',
        severity: 'info',
        title: `Approved Group Order ${pool.poolCode}`,
        message: `Your order of ${currentMember.quantity} ${pool.unit} (${pool.productName}) at bulk ₹${pool.bulkUnitPrice} is approved (est. ₹${productSavings} product savings).`,
      });

      const refreshedMembers = await db
        .select()
        .from(groupOrderMembers)
        .where(eq(groupOrderMembers.groupOrderId, groupOrderId));

      return {
        ...approved,
        createdAt: approved.createdAt.toISOString(),
        updatedAt: approved.updatedAt.toISOString(),
        members: refreshedMembers.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
      };
    }

    // accept_distributor
    if (!pool.ownerApproved) {
      throw new Error('Shopkeeper approval is required before distributor acceptance.');
    }

    const [accepted] = await db
      .update(groupOrders)
      .set({
        distributorAccepted: true,
        status: 'distributor_accepted',
        updatedAt: new Date(),
      })
      .where(eq(groupOrders.id, groupOrderId))
      .returning();

    await db.insert(notifications).values({
      shopId,
      type: 'group_order',
      severity: 'info',
      title: `Distributor confirmed ${pool.poolCode}`,
      message: `${pool.distributorName} accepted collective supply of ${pool.combinedQty} ${pool.unit} (${pool.productName}). Delivery window: ${pool.deliveryWindow}.`,
    });

    return {
      ...accepted,
      createdAt: accepted.createdAt.toISOString(),
      updatedAt: accepted.updatedAt.toISOString(),
      members: members.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
    };
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('not found') ||
        error.message.includes('already') ||
        error.message.includes('threshold') ||
        error.message.includes('Join') ||
        error.message.includes('required'))
    ) {
      throw error;
    }
    throw sanitizeDbError('updating group order status', error);
  }
}

export async function createDistributorOfferRecord(
  shopId: number,
  payload: {
    distributorName: string;
    distributorCity: string;
    verified?: boolean;
    productName: string;
    category: string;
    unit: string;
    standardUnitPrice: number;
    bulkUnitPrice: number;
    minBulkQty: number;
    availableQty: number;
    leadTimeDays: number;
    deliveryFeeINR: number;
    latitude?: number | null;
    longitude?: number | null;
  }
) {
  try {
    const std = Number(payload.standardUnitPrice);
    const bulk = Number(payload.bulkUnitPrice);
    if (!Number.isFinite(std) || std <= 0 || !Number.isFinite(bulk) || bulk <= 0) {
      throw new Error('Standard and bulk prices must be positive numbers.');
    }
    if (bulk > std) {
      throw new Error('Bulk unit price cannot exceed standard unit price.');
    }

    const [created] = await db
      .insert(distributorOffers)
      .values({
        shopId,
        distributorName: payload.distributorName.trim(),
        distributorCity: payload.distributorCity.trim(),
        verified: payload.verified ?? true,
        productName: payload.productName.trim(),
        category: payload.category.trim(),
        unit: payload.unit.trim() || 'pcs',
        standardUnitPrice: std,
        bulkUnitPrice: bulk,
        minBulkQty: Math.max(1, Math.round(Number(payload.minBulkQty || 40))),
        availableQty: Math.max(0, Math.round(Number(payload.availableQty || 200))),
        leadTimeDays: Math.max(1, Math.round(Number(payload.leadTimeDays || 2))),
        deliveryFeeINR: Math.max(0, Number(payload.deliveryFeeINR || 250)),
        latitude: payload.latitude ?? null,
        longitude: payload.longitude ?? null,
      })
      .returning();

    return { ...created, updatedAt: created.updatedAt.toISOString() };
  } catch (error) {
    if (error instanceof Error && (error.message.includes('positive') || error.message.includes('exceed'))) {
      throw error;
    }
    throw sanitizeDbError('creating distributor offer', error);
  }
}

export async function updateDistributorOfferRecord(
  shopId: number,
  offerId: number,
  payload: Partial<{
    standardUnitPrice: number;
    bulkUnitPrice: number;
    minBulkQty: number;
    availableQty: number;
    leadTimeDays: number;
    deliveryFeeINR: number;
    verified: boolean;
  }>
) {
  try {
    const [existing] = await db
      .select()
      .from(distributorOffers)
      .where(and(eq(distributorOffers.id, offerId), eq(distributorOffers.shopId, shopId)))
      .limit(1);
    if (!existing) throw new Error('Distributor offer not found.');

    const nextStd = payload.standardUnitPrice !== undefined ? Number(payload.standardUnitPrice) : existing.standardUnitPrice;
    const nextBulk = payload.bulkUnitPrice !== undefined ? Number(payload.bulkUnitPrice) : existing.bulkUnitPrice;
    if (nextBulk > nextStd) {
      throw new Error('Bulk unit price cannot exceed standard unit price.');
    }

    const [updated] = await db
      .update(distributorOffers)
      .set({
        standardUnitPrice: nextStd,
        bulkUnitPrice: nextBulk,
        minBulkQty:
          payload.minBulkQty !== undefined ? Math.max(1, Math.round(payload.minBulkQty)) : existing.minBulkQty,
        availableQty:
          payload.availableQty !== undefined ? Math.max(0, Math.round(payload.availableQty)) : existing.availableQty,
        leadTimeDays:
          payload.leadTimeDays !== undefined ? Math.max(1, Math.round(payload.leadTimeDays)) : existing.leadTimeDays,
        deliveryFeeINR:
          payload.deliveryFeeINR !== undefined ? Math.max(0, payload.deliveryFeeINR) : existing.deliveryFeeINR,
        verified: payload.verified !== undefined ? payload.verified : existing.verified,
        updatedAt: new Date(),
      })
      .where(eq(distributorOffers.id, offerId))
      .returning();

    return { ...updated, updatedAt: updated.updatedAt.toISOString() };
  } catch (error) {
    if (error instanceof Error && (error.message.includes('not found') || error.message.includes('exceed'))) {
      throw error;
    }
    throw sanitizeDbError('updating distributor offer', error);
  }
}

export async function createDeliveryRunRecord(
  shopId: number,
  payload: {
    vehicleType: VehicleSpec['type'];
    driverName: string;
    driverPhone?: string;
    originName: string;
    originLat: number;
    originLng: number;
    startHour?: number;
    stops: RoutePoint[];
  }
) {
  try {
    if (!payload.stops || payload.stops.length === 0) {
      throw new Error('At least one delivery stop is required to build a route.');
    }

    const [shopRow] = await db.select().from(shops).where(eq(shops.id, shopId)).limit(1);
    if (!shopRow) throw new Error('Shop not found.');

    const plan = optimizeDeliveryRoute(
      { name: payload.originName, lat: payload.originLat, lng: payload.originLng },
      payload.stops,
      payload.vehicleType,
      payload.startHour ?? 7
    );

    const runCode = `DEL-${String(shopRow.city || 'RUR').slice(0, 3).toUpperCase()}-${Math.floor(
      400 + Math.random() * 590
    )}`;

    const [createdRun] = await db
      .insert(deliveryRuns)
      .values({
        shopId,
        runCode,
        vehicleType: payload.vehicleType,
        vehicleCapacityKg: plan.vehicleCapacityKg,
        totalLoadKg: plan.totalLoadKg,
        driverName: payload.driverName.trim() || 'Rural Fleet Partner',
        driverPhone: payload.driverPhone?.trim() || null,
        originName: payload.originName.trim(),
        originLat: payload.originLat,
        originLng: payload.originLng,
        optimizedDistanceKm: plan.optimizedDistanceKm,
        naiveDistanceKm: plan.naiveDistanceKm,
        estimatedDurationMin: plan.estimatedDurationMin,
        estimatedFuelCostINR: plan.estimatedFuelCostINR,
        sharedCostPerShopINR: plan.sharedCostPerShopINR,
        soloCostPerShopINR: plan.soloCostPerShopINR,
        status: 'planned',
        optimizationNotes: plan.optimizationNotes,
      })
      .returning();

    const insertedStops = await db
      .insert(deliveryStops)
      .values(
        plan.orderedStops.map((st) => ({
          deliveryRunId: createdRun.id,
          sequenceOrder: st.sequenceOrder,
          shopName: st.shopName,
          village: st.village,
          latitude: st.latitude,
          longitude: st.longitude,
          loadKg: st.loadKg,
          itemSummary: st.itemSummary,
          groupOrderCode: st.groupOrderCode ?? null,
          etaWindow: st.etaWindow,
          status: 'pending',
          deliveredAt: null,
          proofNotes: null,
        }))
      )
      .returning();

    await db.insert(notifications).values({
      shopId,
      type: 'delivery',
      severity: 'info',
      title: `Optimized Delivery Run ${runCode} planned`,
      message: `${plan.orderedStops.length} village stops sequenced via ${payload.vehicleType} (${plan.optimizedDistanceKm} km, saves ${plan.distanceSavedKm} km vs solo trips).`,
    });

    return {
      ...createdRun,
      createdAt: createdRun.createdAt.toISOString(),
      updatedAt: createdRun.updatedAt.toISOString(),
      stops: insertedStops.sort((a, b) => a.sequenceOrder - b.sequenceOrder),
    };
  } catch (error) {
    if (error instanceof Error && (error.message.includes('required') || error.message.includes('not found'))) {
      throw error;
    }
    throw sanitizeDbError('creating optimized delivery run', error);
  }
}

export async function updateDeliveryRunStatusRecord(
  shopId: number,
  runId: number,
  status: 'planned' | 'dispatched' | 'in_transit' | 'completed' | 'cancelled'
) {
  try {
    const [existing] = await db
      .select()
      .from(deliveryRuns)
      .where(and(eq(deliveryRuns.id, runId), eq(deliveryRuns.shopId, shopId)))
      .limit(1);
    if (!existing) throw new Error('Delivery run not found.');

    const [updated] = await db
      .update(deliveryRuns)
      .set({ status, updatedAt: new Date() })
      .where(eq(deliveryRuns.id, runId))
      .returning();

    const stops = await db
      .select()
      .from(deliveryStops)
      .where(eq(deliveryStops.deliveryRunId, runId));

    // When dispatched/in_transit, mark first pending stop as en_route for clear progress tracking
    if ((status === 'dispatched' || status === 'in_transit') && stops.length > 0) {
      const sorted = [...stops].sort((a, b) => a.sequenceOrder - b.sequenceOrder);
      const firstPending = sorted.find((s) => s.status === 'pending');
      const hasEnRoute = sorted.some((s) => s.status === 'en_route');
      if (firstPending && !hasEnRoute) {
        await db
          .update(deliveryStops)
          .set({ status: 'en_route' })
          .where(eq(deliveryStops.id, firstPending.id));
      }
    }

    if (status === 'completed') {
      const nowLabel = `${formatISODate(new Date())} ${new Date().toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
      })}`;
      for (const st of stops) {
        if (st.status !== 'delivered') {
          await db
            .update(deliveryStops)
            .set({ status: 'delivered', deliveredAt: nowLabel })
            .where(eq(deliveryStops.id, st.id));
        }
      }
    }

    await db.insert(notifications).values({
      shopId,
      type: 'delivery',
      severity: 'info',
      title: `Delivery ${existing.runCode}: ${status.replace('_', ' ')}`,
      message: `Vehicle ${existing.vehicleType} (${existing.driverName}) marked as ${status.replace('_', ' ')}.`,
    });

    const refreshedStops = await db
      .select()
      .from(deliveryStops)
      .where(eq(deliveryStops.deliveryRunId, runId));

    return {
      ...updated,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      stops: refreshedStops.sort((a, b) => a.sequenceOrder - b.sequenceOrder),
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) throw error;
    throw sanitizeDbError('updating delivery run status', error);
  }
}

export async function updateDeliveryStopStatusRecord(
  shopId: number,
  runId: number,
  stopId: number,
  status: 'pending' | 'en_route' | 'delivered',
  proofNotes?: string
) {
  try {
    const [run] = await db
      .select()
      .from(deliveryRuns)
      .where(and(eq(deliveryRuns.id, runId), eq(deliveryRuns.shopId, shopId)))
      .limit(1);
    if (!run) throw new Error('Delivery run not found.');

    const [stop] = await db
      .select()
      .from(deliveryStops)
      .where(and(eq(deliveryStops.id, stopId), eq(deliveryStops.deliveryRunId, runId)))
      .limit(1);
    if (!stop) throw new Error('Delivery stop not found.');

    const deliveredAt =
      status === 'delivered'
        ? `${formatISODate(new Date())} ${new Date().toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
          })}`
        : null;

    await db
      .update(deliveryStops)
      .set({
        status,
        deliveredAt,
        proofNotes: proofNotes !== undefined ? proofNotes.trim() || null : stop.proofNotes,
      })
      .where(eq(deliveryStops.id, stopId));

    const allStops = (
      await db.select().from(deliveryStops).where(eq(deliveryStops.deliveryRunId, runId))
    ).sort((a, b) => a.sequenceOrder - b.sequenceOrder);

    const allDelivered = allStops.length > 0 && allStops.every((s) => s.status === 'delivered');
    if (allDelivered) {
      await db
        .update(deliveryRuns)
        .set({ status: 'completed', updatedAt: new Date() })
        .where(eq(deliveryRuns.id, runId));
    } else if (status === 'delivered' || status === 'en_route') {
      // Automatically mark next pending stop as en_route when current stop completes
      if (status === 'delivered') {
        const nextPending = allStops.find((s) => s.status === 'pending');
        if (nextPending) {
          await db
            .update(deliveryStops)
            .set({ status: 'en_route' })
            .where(eq(deliveryStops.id, nextPending.id));
        }
      }
      if (run.status === 'planned' || run.status === 'dispatched') {
        await db
          .update(deliveryRuns)
          .set({ status: 'in_transit', updatedAt: new Date() })
          .where(eq(deliveryRuns.id, runId));
      }
    }

    const [refreshedRun] = await db
      .select()
      .from(deliveryRuns)
      .where(eq(deliveryRuns.id, runId))
      .limit(1);
    const refreshedStops = (
      await db.select().from(deliveryStops).where(eq(deliveryStops.deliveryRunId, runId))
    ).sort((a, b) => a.sequenceOrder - b.sequenceOrder);

    return {
      ...refreshedRun,
      createdAt: refreshedRun.createdAt.toISOString(),
      updatedAt: refreshedRun.updatedAt.toISOString(),
      stops: refreshedStops,
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) throw error;
    throw sanitizeDbError('updating delivery stop status', error);
  }
}
