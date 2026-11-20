import { relations } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  displayName: text('display_name'),
  role: text('role').notNull().default('shop_owner'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const shops = pgTable(
  'shops',
  {
    id: serial('id').primaryKey(),
    ownerUid: text('owner_uid')
      .notNull()
      .references(() => users.uid, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    ownerName: text('owner_name').notNull(),
    phone: text('phone'),
    city: text('city').notNull().default('Bengaluru'),
    state: text('state').notNull().default('Karnataka'),
    pincode: text('pincode'),
    address: text('address'),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    currency: text('currency').notNull().default('INR'),
    isSampleData: boolean('is_sample_data').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('shops_owner_uid_idx').on(table.ownerUid)]
);

export const suppliers = pgTable(
  'suppliers',
  {
    id: serial('id').primaryKey(),
    shopId: integer('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    contactPhone: text('contact_phone').notNull(),
    email: text('email'),
    address: text('address'),
    paymentTerms: text('payment_terms').notNull().default('Net 15 Days'),
    leadTimeDays: integer('lead_time_days').notNull().default(3),
    outstandingAmount: doublePrecision('outstanding_amount').notNull().default(0),
    suppliedCategories: text('supplied_categories'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('suppliers_shop_id_idx').on(table.shopId)]
);

export const products = pgTable(
  'products',
  {
    id: serial('id').primaryKey(),
    shopId: integer('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    supplierId: integer('supplier_id').references(() => suppliers.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    sku: text('sku').notNull(),
    barcode: text('barcode'),
    category: text('category').notNull(),
    brand: text('brand'),
    unit: text('unit').notNull().default('pcs'),
    purchasePrice: doublePrecision('purchase_price').notNull(),
    sellingPrice: doublePrecision('selling_price').notNull(),
    currentStock: integer('current_stock').notNull().default(0),
    minStockLevel: integer('min_stock_level').notNull().default(10),
    maxStockLevel: integer('max_stock_level').notNull().default(100),
    leadTimeDays: integer('lead_time_days').notNull().default(3),
    mfgDate: text('mfg_date'),
    expiryDate: text('expiry_date'),
    imageUrl: text('image_url'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('products_shop_id_idx').on(table.shopId),
    index('products_category_idx').on(table.category),
  ]
);

export const productBatches = pgTable(
  'product_batches',
  {
    id: serial('id').primaryKey(),
    shopId: integer('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    batchNumber: text('batch_number').notNull(),
    quantity: integer('quantity').notNull(),
    purchasePrice: doublePrecision('purchase_price').notNull(),
    mfgDate: text('mfg_date'),
    expiryDate: text('expiry_date').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('batches_shop_id_idx').on(table.shopId),
    index('batches_product_id_idx').on(table.productId),
    index('batches_expiry_idx').on(table.expiryDate),
  ]
);

export const sales = pgTable(
  'sales',
  {
    id: serial('id').primaryKey(),
    shopId: integer('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    invoiceNumber: text('invoice_number').notNull(),
    customerName: text('customer_name'),
    customerPhone: text('customer_phone'),
    paymentMethod: text('payment_method').notNull().default('Cash'),
    subtotal: doublePrecision('subtotal').notNull(),
    discount: doublePrecision('discount').notNull().default(0),
    totalAmount: doublePrecision('total_amount').notNull(),
    totalCost: doublePrecision('total_cost').notNull(),
    grossProfit: doublePrecision('gross_profit').notNull(),
    saleDate: text('sale_date').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('sales_shop_id_idx').on(table.shopId),
    index('sales_date_idx').on(table.saleDate),
  ]
);

export const saleItems = pgTable(
  'sale_items',
  {
    id: serial('id').primaryKey(),
    saleId: integer('sale_id')
      .notNull()
      .references(() => sales.id, { onDelete: 'cascade' }),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    productName: text('product_name').notNull(),
    quantity: integer('quantity').notNull(),
    unitPrice: doublePrecision('unit_price').notNull(),
    unitCost: doublePrecision('unit_cost').notNull(),
    lineTotal: doublePrecision('line_total').notNull(),
    lineProfit: doublePrecision('line_profit').notNull(),
  },
  (table) => [index('sale_items_sale_id_idx').on(table.saleId)]
);

export const purchases = pgTable(
  'purchases',
  {
    id: serial('id').primaryKey(),
    shopId: integer('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    supplierId: integer('supplier_id').references(() => suppliers.id, {
      onDelete: 'set null',
    }),
    poNumber: text('po_number').notNull(),
    status: text('status').notNull().default('pending'),
    totalAmount: doublePrecision('total_amount').notNull(),
    paidAmount: doublePrecision('paid_amount').notNull().default(0),
    orderDate: text('order_date').notNull(),
    receivedDate: text('received_date'),
    notes: text('notes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('purchases_shop_id_idx').on(table.shopId)]
);

export const purchaseItems = pgTable(
  'purchase_items',
  {
    id: serial('id').primaryKey(),
    purchaseId: integer('purchase_id')
      .notNull()
      .references(() => purchases.id, { onDelete: 'cascade' }),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    productName: text('product_name').notNull(),
    orderedQty: integer('ordered_qty').notNull(),
    receivedQty: integer('received_qty').notNull().default(0),
    unitCost: doublePrecision('unit_cost').notNull(),
    batchNumber: text('batch_number'),
    expiryDate: text('expiry_date'),
  },
  (table) => [index('purchase_items_po_id_idx').on(table.purchaseId)]
);

export const stockMovements = pgTable(
  'stock_movements',
  {
    id: serial('id').primaryKey(),
    shopId: integer('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    movementType: text('movement_type').notNull(),
    quantityChange: integer('quantity_change').notNull(),
    balanceAfter: integer('balance_after').notNull(),
    reason: text('reason'),
    referenceId: text('reference_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('stock_movements_shop_idx').on(table.shopId),
    index('stock_movements_product_idx').on(table.productId),
  ]
);

export const wastageLogs = pgTable(
  'wastage_logs',
  {
    id: serial('id').primaryKey(),
    shopId: integer('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    batchId: integer('batch_id'),
    quantity: integer('quantity').notNull(),
    estimatedLoss: doublePrecision('estimated_loss').notNull(),
    reason: text('reason').notNull(),
    loggedDate: text('logged_date').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('wastage_shop_idx').on(table.shopId)]
);

export const forecasts = pgTable(
  'forecasts',
  {
    id: serial('id').primaryKey(),
    shopId: integer('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    methodUsed: text('method_used').notNull(),
    horizonDays: integer('horizon_days').notNull().default(30),
    expectedDemand7d: doublePrecision('expected_demand_7d').notNull(),
    expectedDemand30d: doublePrecision('expected_demand_30d').notNull(),
    avgDailySales: doublePrecision('avg_daily_sales').notNull(),
    trendDirection: text('trend_direction').notNull(),
    confidenceLevel: text('confidence_level').notNull(),
    dataDaysUsed: integer('data_days_used').notNull(),
    shortageRisk: boolean('shortage_risk').notNull().default(false),
    slowMovingFlag: boolean('slow_moving_flag').notNull().default(false),
    notes: text('notes'),
    generatedAt: timestamp('generated_at').defaultNow().notNull(),
  },
  (table) => [index('forecasts_shop_idx').on(table.shopId)]
);

export const reorderRecommendations = pgTable(
  'reorder_recommendations',
  {
    id: serial('id').primaryKey(),
    shopId: integer('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    supplierId: integer('supplier_id'),
    availableStock: integer('available_stock').notNull(),
    incomingStock: integer('incoming_stock').notNull().default(0),
    expectedDemandLeadTime: doublePrecision('expected_demand_lead_time').notNull(),
    safetyStock: integer('safety_stock').notNull(),
    reorderPoint: integer('reorder_point').notNull(),
    suggestedQty: integer('suggested_qty').notNull(),
    approvedQty: integer('approved_qty'),
    estimatedCost: doublePrecision('estimated_cost').notNull(),
    reason: text('reason').notNull(),
    formulaBreakdown: text('formula_breakdown').notNull(),
    status: text('status').notNull().default('pending'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('reorders_shop_idx').on(table.shopId)]
);

export const festivals = pgTable(
  'festivals',
  {
    id: serial('id').primaryKey(),
    shopId: integer('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    festivalDate: text('festival_date').notNull(),
    category: text('category').notNull().default('National'),
    expectedUpliftPct: integer('expected_uplift_pct').notNull().default(35),
    focusCategories: text('focus_categories').notNull(),
    notes: text('notes'),
    isDismissed: boolean('is_dismissed').notNull().default(false),
    isCustom: boolean('is_custom').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('festivals_shop_idx').on(table.shopId)]
);

export const notifications = pgTable(
  'notifications',
  {
    id: serial('id').primaryKey(),
    shopId: integer('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    severity: text('severity').notNull().default('info'),
    title: text('title').notNull(),
    message: text('message').notNull(),
    isRead: boolean('is_read').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('notifications_shop_idx').on(table.shopId)]
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: serial('id').primaryKey(),
    shopId: integer('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    actorUid: text('actor_uid'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    details: text('details'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('audit_logs_shop_idx').on(table.shopId)]
);

export const stockTransfers = pgTable(
  'stock_transfers',
  {
    id: serial('id').primaryKey(),
    shopId: integer('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    batchId: integer('batch_id').references(() => productBatches.id, { onDelete: 'set null' }),
    batchNumber: text('batch_number'),
    targetShopName: text('target_shop_name').notNull(),
    targetVillage: text('target_village').notNull(),
    quantity: integer('quantity').notNull(),
    unitCost: doublePrecision('unit_cost').notNull(),
    expiryDate: text('expiry_date').notNull(),
    sourceApproved: boolean('source_approved').notNull().default(false),
    targetApproved: boolean('target_approved').notNull().default(false),
    status: text('status').notNull().default('proposed'),
    notes: text('notes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('stock_transfers_shop_idx').on(table.shopId)]
);

export const distributorOffers = pgTable(
  'distributor_offers',
  {
    id: serial('id').primaryKey(),
    shopId: integer('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    distributorName: text('distributor_name').notNull(),
    distributorCity: text('distributor_city').notNull(),
    verified: boolean('verified').notNull().default(true),
    productName: text('product_name').notNull(),
    category: text('category').notNull(),
    unit: text('unit').notNull().default('pcs'),
    standardUnitPrice: doublePrecision('standard_unit_price').notNull(),
    bulkUnitPrice: doublePrecision('bulk_unit_price').notNull(),
    minBulkQty: integer('min_bulk_qty').notNull().default(40),
    availableQty: integer('available_qty').notNull().default(200),
    leadTimeDays: integer('lead_time_days').notNull().default(2),
    deliveryFeeINR: doublePrecision('delivery_fee_inr').notNull().default(250),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('distributor_offers_shop_idx').on(table.shopId)]
);

export const groupOrders = pgTable(
  'group_orders',
  {
    id: serial('id').primaryKey(),
    shopId: integer('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    poolCode: text('pool_code').notNull(),
    productName: text('product_name').notNull(),
    category: text('category').notNull(),
    unit: text('unit').notNull().default('pcs'),
    distributorOfferId: integer('distributor_offer_id').references(
      () => distributorOffers.id,
      { onDelete: 'set null' }
    ),
    distributorName: text('distributor_name').notNull(),
    standardUnitPrice: doublePrecision('standard_unit_price').notNull(),
    bulkUnitPrice: doublePrecision('bulk_unit_price').notNull(),
    minBulkQty: integer('min_bulk_qty').notNull(),
    combinedQty: integer('combined_qty').notNull().default(0),
    estTransportFeeIndividual: doublePrecision('est_transport_fee_individual').notNull().default(300),
    estTransportFeeShared: doublePrecision('est_transport_fee_shared').notNull().default(110),
    deliveryWindow: text('delivery_window').notNull().default('Within 48 hours'),
    status: text('status').notNull().default('open'),
    ownerApproved: boolean('owner_approved').notNull().default(false),
    distributorAccepted: boolean('distributor_accepted').notNull().default(false),
    notes: text('notes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('group_orders_shop_idx').on(table.shopId)]
);

export const groupOrderMembers = pgTable(
  'group_order_members',
  {
    id: serial('id').primaryKey(),
    groupOrderId: integer('group_order_id')
      .notNull()
      .references(() => groupOrders.id, { onDelete: 'cascade' }),
    shopName: text('shop_name').notNull(),
    village: text('village').notNull(),
    quantity: integer('quantity').notNull(),
    isCurrentShop: boolean('is_current_shop').notNull().default(false),
    ownerApproved: boolean('owner_approved').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('group_order_members_pool_idx').on(table.groupOrderId)]
);

export const villageDemandSignals = pgTable(
  'village_demand_signals',
  {
    id: serial('id').primaryKey(),
    shopId: integer('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    villageName: text('village_name').notNull(),
    district: text('district').notNull(),
    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),
    connectedShopsCount: integer('connected_shops_count').notNull().default(1),
    topCategory: text('top_category').notNull(),
    topProduct: text('top_product').notNull(),
    estimatedWeeklyUnits: integer('estimated_weekly_units').notNull().default(0),
    shortageSeverity: text('shortage_severity').notNull().default('low'),
    isOptedIn: boolean('is_opted_in').notNull().default(false),
    isDemoData: boolean('is_demo_data').notNull().default(true),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('village_demand_signals_shop_idx').on(table.shopId)]
);

export const deliveryRuns = pgTable(
  'delivery_runs',
  {
    id: serial('id').primaryKey(),
    shopId: integer('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    runCode: text('run_code').notNull(),
    vehicleType: text('vehicle_type').notNull().default('Mini Tempo'),
    vehicleCapacityKg: doublePrecision('vehicle_capacity_kg').notNull().default(900),
    totalLoadKg: doublePrecision('total_load_kg').notNull().default(0),
    driverName: text('driver_name').notNull(),
    driverPhone: text('driver_phone'),
    originName: text('origin_name').notNull(),
    originLat: doublePrecision('origin_lat').notNull(),
    originLng: doublePrecision('origin_lng').notNull(),
    optimizedDistanceKm: doublePrecision('optimized_distance_km').notNull().default(0),
    naiveDistanceKm: doublePrecision('naive_distance_km').notNull().default(0),
    estimatedDurationMin: integer('estimated_duration_min').notNull().default(0),
    estimatedFuelCostINR: doublePrecision('estimated_fuel_cost_inr').notNull().default(0),
    sharedCostPerShopINR: doublePrecision('shared_cost_per_shop_inr').notNull().default(0),
    soloCostPerShopINR: doublePrecision('solo_cost_per_shop_inr').notNull().default(0),
    status: text('status').notNull().default('planned'),
    optimizationNotes: text('optimization_notes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('delivery_runs_shop_idx').on(table.shopId)]
);

export const deliveryStops = pgTable(
  'delivery_stops',
  {
    id: serial('id').primaryKey(),
    deliveryRunId: integer('delivery_run_id')
      .notNull()
      .references(() => deliveryRuns.id, { onDelete: 'cascade' }),
    sequenceOrder: integer('sequence_order').notNull(),
    shopName: text('shop_name').notNull(),
    village: text('village').notNull(),
    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),
    loadKg: doublePrecision('load_kg').notNull().default(0),
    itemSummary: text('item_summary').notNull(),
    groupOrderCode: text('group_order_code'),
    etaWindow: text('eta_window').notNull(),
    status: text('status').notNull().default('pending'),
    deliveredAt: text('delivered_at'),
    proofNotes: text('proof_notes'),
  },
  (table) => [index('delivery_stops_run_idx').on(table.deliveryRunId)]
);

export const usersRelations = relations(users, ({ many }) => ({
  shops: many(shops),
}));

export const shopsRelations = relations(shops, ({ one, many }) => ({
  owner: one(users, {
    fields: [shops.ownerUid],
    references: [users.uid],
  }),
  suppliers: many(suppliers),
  products: many(products),
  sales: many(sales),
  purchases: many(purchases),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  shop: one(shops, {
    fields: [products.shopId],
    references: [shops.id],
  }),
  supplier: one(suppliers, {
    fields: [products.supplierId],
    references: [suppliers.id],
  }),
  batches: many(productBatches),
  movements: many(stockMovements),
}));
