export type UserRole = 'shop_owner' | 'distributor' | 'delivery_provider' | 'admin';

export interface ShopProfile {
  id: number;
  ownerUid: string;
  name: string;
  ownerName: string;
  phone?: string | null;
  city: string;
  state: string;
  pincode?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  currency: string;
  isSampleData: boolean;
  createdAt?: string;
}

export interface Supplier {
  id: number;
  shopId: number;
  name: string;
  contactPhone: string;
  email?: string | null;
  address?: string | null;
  paymentTerms: string;
  leadTimeDays: number;
  outstandingAmount: number;
  suppliedCategories?: string | null;
}

export interface Product {
  id: number;
  shopId: number;
  supplierId?: number | null;
  name: string;
  sku: string;
  barcode?: string | null;
  category: string;
  brand?: string | null;
  unit: string;
  purchasePrice: number;
  sellingPrice: number;
  currentStock: number;
  minStockLevel: number;
  maxStockLevel: number;
  leadTimeDays: number;
  mfgDate?: string | null;
  expiryDate?: string | null;
  imageUrl?: string | null;
}

export interface ProductBatch {
  id: number;
  shopId: number;
  productId: number;
  batchNumber: string;
  quantity: number;
  purchasePrice: number;
  mfgDate?: string | null;
  expiryDate: string;
  status: 'active' | 'removed' | 'depleted' | string;
}

export interface SaleItem {
  id?: number;
  saleId?: number;
  productId: number;
  productName: string;
  quantity: number;
  unitPrice: number;
  unitCost: number;
  lineTotal: number;
  lineProfit: number;
}

export interface SaleRecord {
  id: number;
  shopId: number;
  invoiceNumber: string;
  customerName?: string | null;
  customerPhone?: string | null;
  paymentMethod: string;
  subtotal: number;
  discount: number;
  totalAmount: number;
  totalCost: number;
  grossProfit: number;
  saleDate: string;
  items: SaleItem[];
  createdAt?: string;
}

export interface PurchaseItem {
  id?: number;
  purchaseId?: number;
  productId: number;
  productName: string;
  orderedQty: number;
  receivedQty: number;
  unitCost: number;
  batchNumber?: string | null;
  expiryDate?: string | null;
}

export interface PurchaseOrder {
  id: number;
  shopId: number;
  supplierId?: number | null;
  poNumber: string;
  status: 'pending' | 'received' | 'cancelled' | string;
  totalAmount: number;
  paidAmount: number;
  orderDate: string;
  receivedDate?: string | null;
  notes?: string | null;
  items: PurchaseItem[];
}

export interface StockMovement {
  id: number;
  shopId: number;
  productId: number;
  movementType: 'sale' | 'purchase' | 'adjustment' | 'wastage' | 'opening' | 'transfer_out' | string;
  quantityChange: number;
  balanceAfter: number;
  reason?: string | null;
  referenceId?: string | null;
  createdAt: string;
}

export interface WastageLog {
  id: number;
  shopId: number;
  productId: number;
  batchId?: number | null;
  quantity: number;
  estimatedLoss: number;
  reason: string;
  loggedDate: string;
}

export interface StockTransferOpportunity {
  id: number;
  shopId: number;
  productId: number;
  productName?: string;
  batchId?: number | null;
  batchNumber?: string | null;
  targetShopName: string;
  targetVillage: string;
  quantity: number;
  unitCost: number;
  expiryDate: string;
  sourceApproved: boolean;
  targetApproved: boolean;
  status: 'proposed' | 'awaiting_target' | 'approved' | 'completed' | 'rejected' | string;
  notes?: string | null;
  createdAt?: string;
}

export interface ProductForecast {
  id?: number;
  productId: number;
  productName: string;
  category: string;
  currentStock: number;
  methodUsed: string;
  horizonDays: number;
  expectedDemand1d: number;
  expectedDemand7d: number;
  expectedDemand30d: number;
  avgDailySales: number;
  trendDirection: 'rising' | 'stable' | 'declining';
  confidenceLevel: 'High' | 'Medium' | 'Low';
  dataDaysUsed: number;
  backtestMae: number | null;
  backtestMape: number | null;
  backtestWindowDays: number;
  explanation: string;
  dataLimitationNote: string;
  shortageRisk: boolean;
  daysUntilStockout: number | null;
  slowMovingFlag: boolean;
  deadStockFlag: boolean;
  notes: string;
  series: {
    date: string;
    actual: number | null;
    predicted: number | null;
  }[];
}

export interface ReorderRecommendation {
  id: number;
  shopId: number;
  productId: number;
  productName?: string;
  supplierId?: number | null;
  supplierName?: string;
  availableStock: number;
  incomingStock: number;
  expectedDemandLeadTime: number;
  safetyStock: number;
  reorderPoint: number;
  suggestedQty: number;
  approvedQty?: number | null;
  estimatedCost: number;
  priority?: 'Critical' | 'High' | 'Medium';
  reason: string;
  formulaBreakdown: string;
  status: 'pending' | 'approved' | 'rejected' | string;
  createdAt?: string;
}

export interface FestivalEvent {
  id: number;
  shopId: number;
  name: string;
  festivalDate: string;
  category: string;
  expectedUpliftPct: number;
  focusCategories: string;
  notes?: string | null;
  isDismissed: boolean;
  isCustom: boolean;
}

export interface AppNotification {
  id: number;
  shopId: number;
  type:
    | 'low_stock'
    | 'out_of_stock'
    | 'expiring'
    | 'expired'
    | 'purchase'
    | 'reorder'
    | 'sales_spike'
    | 'transfer'
    | 'group_order'
    | 'delivery'
    | string;
  severity: 'critical' | 'warning' | 'info' | string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

export interface DistributorOffer {
  id: number;
  shopId: number;
  distributorName: string;
  distributorCity: string;
  verified: boolean;
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
  updatedAt?: string;
}

export interface GroupOrderMember {
  id: number;
  groupOrderId: number;
  shopName: string;
  village: string;
  quantity: number;
  isCurrentShop: boolean;
  ownerApproved: boolean;
  createdAt?: string;
}

export interface GroupOrder {
  id: number;
  shopId: number;
  poolCode: string;
  productName: string;
  category: string;
  unit: string;
  distributorOfferId?: number | null;
  distributorName: string;
  standardUnitPrice: number;
  bulkUnitPrice: number;
  minBulkQty: number;
  combinedQty: number;
  estTransportFeeIndividual: number;
  estTransportFeeShared: number;
  deliveryWindow: string;
  status: 'open' | 'threshold_met' | 'approved_by_owner' | 'distributor_accepted' | 'cancelled' | string;
  ownerApproved: boolean;
  distributorAccepted: boolean;
  notes?: string | null;
  members: GroupOrderMember[];
  createdAt?: string;
  updatedAt?: string;
}

export interface VillageDemandSignal {
  id: number;
  shopId: number;
  villageName: string;
  district: string;
  latitude: number;
  longitude: number;
  connectedShopsCount: number;
  topCategory: string;
  topProduct: string;
  estimatedWeeklyUnits: number;
  shortageSeverity: 'low' | 'moderate' | 'high' | string;
  isOptedIn: boolean;
  isDemoData: boolean;
  updatedAt?: string;
}

export interface DeliveryStop {
  id: number;
  deliveryRunId: number;
  sequenceOrder: number;
  shopName: string;
  village: string;
  latitude: number;
  longitude: number;
  loadKg: number;
  itemSummary: string;
  groupOrderCode?: string | null;
  etaWindow: string;
  status: 'pending' | 'en_route' | 'delivered' | string;
  deliveredAt?: string | null;
  proofNotes?: string | null;
}

export interface DeliveryRun {
  id: number;
  shopId: number;
  runCode: string;
  vehicleType: 'Auto Cargo' | 'Mini Tempo' | 'Rural Van' | 'Bike Courier' | string;
  vehicleCapacityKg: number;
  totalLoadKg: number;
  driverName: string;
  driverPhone?: string | null;
  originName: string;
  originLat: number;
  originLng: number;
  optimizedDistanceKm: number;
  naiveDistanceKm: number;
  estimatedDurationMin: number;
  estimatedFuelCostINR: number;
  sharedCostPerShopINR: number;
  soloCostPerShopINR: number;
  status: 'planned' | 'dispatched' | 'in_transit' | 'completed' | 'cancelled' | string;
  optimizationNotes?: string | null;
  stops: DeliveryStop[];
  createdAt?: string;
  updatedAt?: string;
}

export interface BusinessInsight {
  id: string;
  kind: 'observation' | 'prediction';
  category: 'fast_moving' | 'slow_moving' | 'dead_stock' | 'margin' | 'stockout' | 'expiry' | 'sales_trend';
  severity: 'positive' | 'warning' | 'critical' | 'neutral';
  title: string;
  summary: string;
  metricLabel: string;
  recommendedAction: string;
}

export interface WeatherForecastDay {
  date: string;
  tempMaxC: number;
  tempMinC: number;
  condition: string;
  rainMm: number;
}

export interface WeatherSignal {
  configured: boolean;
  source?: string;
  city: string;
  temperatureC?: number;
  condition?: string;
  humidity?: number;
  windKmh?: number;
  planningNote: string;
  forecastDays?: WeatherForecastDay[];
  updatedAt: string;
}

export interface InvoiceOcrItem {
  name: string;
  category: string;
  brand: string;
  unit: string;
  quantity: number;
  purchasePrice: number;
  sellingPrice: number;
  batchNumber?: string;
  expiryDate?: string;
}

export interface InvoiceOcrResult {
  vendorName: string;
  invoiceNumber: string;
  invoiceDate: string;
  items: InvoiceOcrItem[];
  notes: string;
}

export interface WhatIfScenarioInput {
  demandChangePct: number;
  purchasingBudgetINR: number;
  supplierPriceChangePct: number;
  deliveryCostPerOrderINR: number;
  stockAvailabilityPct: number;
  leadTimeDeltaDays: number;
}

export interface WhatIfProductImpact {
  productId: number;
  productName: string;
  category: string;
  baselineDemand30d: number;
  simulatedDemand30d: number;
  simulatedStock: number;
  baselineReorderQty: number;
  simulatedReorderQty: number;
  simulatedPurchaseCost: number;
  shortageUnits: number;
  projectedWastageRiskINR: number;
}

export interface WhatIfScenarioResult {
  totalBaselineDemand30d: number;
  totalSimulatedDemand30d: number;
  totalReorderUnits: number;
  totalPurchaseCostINR: number;
  totalDeliveryCostINR: number;
  budgetGapINR: number;
  projectedInventoryValueINR: number;
  shortageSkuCount: number;
  estimatedWastageRiskINR: number;
  items: WhatIfProductImpact[];
}

export interface ShopWorkspacePayload {
  shop: ShopProfile;
  suppliers: Supplier[];
  products: Product[];
  batches: ProductBatch[];
  sales: SaleRecord[];
  purchases: PurchaseOrder[];
  stockMovements: StockMovement[];
  wastageLogs: WastageLog[];
  stockTransfers?: StockTransferOpportunity[];
  distributorOffers?: DistributorOffer[];
  groupOrders?: GroupOrder[];
  villageDemandSignals?: VillageDemandSignal[];
  deliveryRuns?: DeliveryRun[];
  reorders: ReorderRecommendation[];
  festivals: FestivalEvent[];
  notifications: AppNotification[];
}

export type ActiveView =
  | 'dashboard'
  | 'store3d'
  | 'inventory'
  | 'sales'
  | 'purchases'
  | 'suppliers'
  | 'expiry'
  | 'forecast'
  | 'reorders'
  | 'simulator'
  | 'festivals'
  | 'insights'
  | 'reports'
  | 'village_map'
  | 'village3d'
  | 'group_buying'
  | 'logistics'
  | 'distributor'
  | 'notifications'
  | 'settings'
  | 'admin';
