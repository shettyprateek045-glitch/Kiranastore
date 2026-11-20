import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase.ts';
import type {
  ActiveView,
  BusinessInsight,
  FestivalEvent,
  Product,
  ProductForecast,
  ShopProfile,
  ShopWorkspacePayload,
  Supplier,
  UserRole,
  WeatherSignal,
} from '../types/dukaaniq.ts';
import {
  classifyExpiryBatches,
  computeProductForecasts,
  computeReorderRecommendations,
  formatISODate,
  generateDeterministicInsights,
} from '../services/intelligenceEngine.ts';
import {
  optimizeDeliveryRoute,
  RoutePoint,
  VehicleSpec,
} from '../services/logisticsEngine.ts';
import { createSampleKiranaWorkspace } from '../services/sampleShopData.ts';

interface ToastMessage {
  id: number;
  type: 'success' | 'error' | 'info';
  text: string;
}

interface ShopContextValue {
  mode: 'landing' | 'demo' | 'authenticated';
  authLoading: boolean;
  workspaceLoading: boolean;
  user: User | null;
  shops: ShopProfile[];
  workspace: ShopWorkspacePayload | null;
  needsShopSetup: boolean;
  activeView: ActiveView;
  setActiveView: (v: ActiveView) => void;
  activeRole: UserRole;
  setActiveRole: (r: UserRole) => void;
  forecasts: ProductForecast[];
  expirySummary: ReturnType<typeof classifyExpiryBatches>;
  insights: BusinessInsight[];
  weather: WeatherSignal | null;
  toasts: ToastMessage[];
  dismissToast: (id: number) => void;
  notify: (text: string, type?: 'success' | 'error' | 'info') => void;
  signInWithGoogle: () => Promise<void>;
  signOutUser: () => Promise<void>;
  enterDemoMode: () => void;
  exitToLanding: () => void;
  selectShop: (shopId: number) => Promise<void>;
  createNewShop: (payload: {
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
  }) => Promise<void>;
  updateShop: (payload: Partial<ShopProfile>) => Promise<void>;
  seedSampleIntoCurrentShop: () => Promise<void>;
  addProduct: (payload: Omit<Product, 'id' | 'shopId'> & { batchNumber?: string }) => Promise<void>;
  updateProduct: (productId: number, payload: Partial<Product>) => Promise<void>;
  deleteProduct: (productId: number) => Promise<void>;
  importProductsCsv: (rows: Array<Partial<Product>>) => Promise<number>;
  adjustStock: (productId: number, quantityChange: number, reason: string, allowNegative?: boolean) => Promise<void>;
  recordSale: (payload: {
    customerName?: string;
    customerPhone?: string;
    paymentMethod: string;
    discount: number;
    items: Array<{ productId: number; quantity: number }>;
  }) => Promise<ShopWorkspacePayload['sales'][number] | null>;
  addSupplier: (payload: Omit<Supplier, 'id' | 'shopId'>) => Promise<void>;
  paySupplier: (supplierId: number, amount: number) => Promise<void>;
  createPurchaseOrder: (payload: {
    supplierId?: number | null;
    notes?: string;
    items: Array<{ productId: number; orderedQty: number; unitCost: number; batchNumber?: string; expiryDate?: string }>;
  }) => Promise<void>;
  receivePurchase: (purchaseId: number, paidAmount: number) => Promise<void>;
  removeBatchAsWastage: (batchId: number, reason: string) => Promise<void>;
  regenerateForecastsAndReorders: () => Promise<void>;
  decideReorder: (reorderId: number, decision: 'approved' | 'rejected', editedQty?: number) => Promise<void>;
  addFestival: (payload: Omit<FestivalEvent, 'id' | 'shopId' | 'isDismissed' | 'isCustom'>) => Promise<void>;
  toggleFestivalDismiss: (festivalId: number, isDismissed: boolean) => Promise<void>;
  markNotificationsRead: () => Promise<void>;
  refreshWeather: () => Promise<void>;
  proposeStockTransfer: (payload: {
    productId: number;
    batchId?: number | null;
    targetShopName: string;
    targetVillage: string;
    quantity: number;
    notes?: string;
  }) => Promise<void>;
  decideStockTransfer: (
    transferId: number,
    action: 'approve_source' | 'approve_target' | 'reject'
  ) => Promise<void>;
  toggleVillageDemandOptIn: (payload: {
    isOptedIn: boolean;
    villageName?: string;
    district?: string;
    latitude?: number | null;
    longitude?: number | null;
    topCategory?: string;
    topProduct?: string;
    estimatedWeeklyUnits?: number;
    shortageSeverity?: 'low' | 'moderate' | 'high';
  }) => Promise<void>;
  createGroupOrder: (payload: {
    distributorOfferId: number;
    myQuantity: number;
    deliveryWindow?: string;
    notes?: string;
  }) => Promise<void>;
  joinGroupOrder: (
    groupOrderId: number,
    quantity: number,
    partner?: { shopName: string; village: string }
  ) => Promise<void>;
  decideGroupOrder: (
    groupOrderId: number,
    action: 'approve_owner' | 'accept_distributor' | 'cancel'
  ) => Promise<void>;
  addDistributorOffer: (payload: {
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
  }) => Promise<void>;
  updateDistributorOffer: (
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
  ) => Promise<void>;
  createDeliveryRun: (payload: {
    vehicleType: VehicleSpec['type'];
    driverName: string;
    driverPhone?: string;
    originName: string;
    originLat: number;
    originLng: number;
    startHour?: number;
    stops: RoutePoint[];
  }) => Promise<void>;
  updateDeliveryRunStatus: (
    runId: number,
    status: 'planned' | 'dispatched' | 'in_transit' | 'completed' | 'cancelled'
  ) => Promise<void>;
  updateDeliveryStopStatus: (
    runId: number,
    stopId: number,
    status: 'pending' | 'en_route' | 'delivered',
    proofNotes?: string
  ) => Promise<void>;
}

const ShopContext = createContext<ShopContextValue | null>(null);

export function ShopProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<'landing' | 'demo' | 'authenticated'>('landing');
  const [authLoading, setAuthLoading] = useState(true);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [shops, setShops] = useState<ShopProfile[]>([]);
  const [workspace, setWorkspace] = useState<ShopWorkspacePayload | null>(null);
  const [needsShopSetup, setNeedsShopSetup] = useState(false);
  const [activeView, setActiveView] = useState<ActiveView>('dashboard');
  const [activeRole, setActiveRole] = useState<UserRole>('shop_owner');
  const [weather, setWeather] = useState<WeatherSignal | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const notify = useCallback((text: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev.slice(-3), { id, type, text }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const authedFetch = useCallback(
    async (path: string, options: RequestInit = {}) => {
      const currentUser = auth.currentUser;
      const freshToken = currentUser ? await currentUser.getIdToken() : idToken;
      if (!freshToken) {
        throw new Error('Authentication token unavailable. Please sign in again.');
      }
      setIdToken(freshToken);
      const res = await fetch(path, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${freshToken}`,
          ...(options.headers || {}),
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      return data;
    },
    [idToken]
  );

  const loadAuthenticatedShop = useCallback(
    async (shopId: number) => {
      setWorkspaceLoading(true);
      try {
        const data = (await authedFetch(`/api/shops/${shopId}/workspace`)) as ShopWorkspacePayload;
        setWorkspace(data);
        setNeedsShopSetup(false);
        setMode('authenticated');
      } catch (err: unknown) {
        notify(err instanceof Error ? err.message : 'Failed to load shop data.', 'error');
      } finally {
        setWorkspaceLoading(false);
      }
    },
    [authedFetch, notify]
  );

  const bootstrapAuthenticatedUser = useCallback(
    async (firebaseUser: User) => {
      setWorkspaceLoading(true);
      try {
        const token = await firebaseUser.getIdToken();
        setIdToken(token);
        const res = await fetch('/api/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load profile.');
        const loadedShops: ShopProfile[] = data.shops || [];
        setShops(loadedShops);
        if (loadedShops.length > 0) {
          await loadAuthenticatedShop(loadedShops[0].id);
        } else {
          setWorkspace(null);
          setNeedsShopSetup(true);
          setMode('authenticated');
        }
      } catch (err: unknown) {
        notify(err instanceof Error ? err.message : 'Could not load your account.', 'error');
      } finally {
        setWorkspaceLoading(false);
      }
    },
    [loadAuthenticatedShop, notify]
  );

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        await bootstrapAuthenticatedUser(firebaseUser);
      } else {
        setIdToken(null);
        setShops([]);
      }
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, [bootstrapAuthenticatedUser]);

  const refreshWeather = useCallback(async () => {
    const city = workspace?.shop.city || 'Mysuru';
    const params = new URLSearchParams({ city });
    if (typeof workspace?.shop.latitude === 'number' && typeof workspace?.shop.longitude === 'number') {
      params.set('lat', String(workspace.shop.latitude));
      params.set('lon', String(workspace.shop.longitude));
    }
    try {
      const res = await fetch(`/api/weather?${params.toString()}`);
      if (!res.ok) return;
      const data = (await res.json()) as WeatherSignal;
      setWeather(data);
    } catch {
      // Weather is strictly optional; never block store workflows
    }
  }, [workspace?.shop.city, workspace?.shop.latitude, workspace?.shop.longitude]);

  useEffect(() => {
    if (workspace?.shop.city) {
      void refreshWeather();
    }
  }, [workspace?.shop.city, refreshWeather]);

  const signInWithGoogle = useCallback(async () => {
    try {
      const result = await signInWithPopup(auth, googleAuthProvider);
      if (result.user) {
        notify(`Welcome, ${result.user.displayName || result.user.email}`, 'success');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Google sign-in was cancelled.';
      if (!msg.includes('popup-closed-by-user')) {
        notify(msg, 'error');
      }
    }
  }, [notify]);

  const signOutUser = useCallback(async () => {
    await signOut(auth);
    setIdToken(null);
    setWorkspace(null);
    setShops([]);
    setNeedsShopSetup(false);
    setMode('landing');
    setActiveView('dashboard');
    notify('Signed out safely.', 'info');
  }, [notify]);

  const enterDemoMode = useCallback(() => {
    const sample = createSampleKiranaWorkspace(999, 'demo-kirana-owner');
    setWorkspace(sample);
    setNeedsShopSetup(false);
    setMode('demo');
    setActiveView('dashboard');
    notify('Loaded clearly labelled sample Kirana store for interactive exploration.', 'info');
  }, [notify]);

  const exitToLanding = useCallback(() => {
    if (mode === 'demo') {
      setWorkspace(null);
      setMode('landing');
    }
  }, [mode]);

  const selectShop = useCallback(
    async (shopId: number) => {
      if (mode === 'authenticated') {
        await loadAuthenticatedShop(shopId);
      }
    },
    [mode, loadAuthenticatedShop]
  );

  const reloadCurrentShop = useCallback(async () => {
    if (mode === 'authenticated' && workspace?.shop.id) {
      await loadAuthenticatedShop(workspace.shop.id);
    }
  }, [mode, workspace?.shop.id, loadAuthenticatedShop]);

  const createNewShop: ShopContextValue['createNewShop'] = useCallback(
    async (payload) => {
      const created = (await authedFetch('/api/shops', {
        method: 'POST',
        body: JSON.stringify(payload),
      })) as ShopProfile;
      setShops((prev) => [created, ...prev]);
      await loadAuthenticatedShop(created.id);
      notify(`Shop "${created.name}" created successfully.`, 'success');
    },
    [authedFetch, loadAuthenticatedShop, notify]
  );

  const updateShop: ShopContextValue['updateShop'] = useCallback(
    async (payload) => {
      if (!workspace) return;
      if (mode === 'demo') {
        setWorkspace((prev) => (prev ? { ...prev, shop: { ...prev.shop, ...payload } } : prev));
        notify('Updated demo shop profile.', 'success');
        return;
      }
      await authedFetch(`/api/shops/${workspace.shop.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      await reloadCurrentShop();
      notify('Shop settings saved to database.', 'success');
    },
    [mode, workspace, authedFetch, reloadCurrentShop, notify]
  );

  const seedSampleIntoCurrentShop = useCallback(async () => {
    if (!workspace) return;
    if (mode === 'demo') {
      setWorkspace(createSampleKiranaWorkspace(999, 'demo-kirana-owner'));
      notify('Reset sample Kirana store to baseline.', 'info');
      return;
    }
    setWorkspaceLoading(true);
    try {
      const updated = (await authedFetch(`/api/shops/${workspace.shop.id}/seed-sample`, {
        method: 'POST',
      })) as ShopWorkspacePayload;
      setWorkspace(updated);
      notify('Sample Kirana products, batches, suppliers, and 30-day sales loaded.', 'success');
    } finally {
      setWorkspaceLoading(false);
    }
  }, [mode, workspace, authedFetch, notify]);

  const addProduct: ShopContextValue['addProduct'] = useCallback(
    async (payload) => {
      if (!workspace) return;
      if (mode === 'demo') {
        const nextId = Math.max(0, ...workspace.products.map((p) => p.id)) + 1;
        const created: Product = {
          ...payload,
          id: nextId,
          shopId: workspace.shop.id,
          sku: payload.sku.trim().toUpperCase(),
        };
        setWorkspace((prev) => {
          if (!prev) return prev;
          const nextBatches = [...prev.batches];
          if (created.currentStock > 0 && created.expiryDate) {
            nextBatches.push({
              id: Math.max(0, ...prev.batches.map((b) => b.id)) + 1,
              shopId: prev.shop.id,
              productId: nextId,
              batchNumber: payload.batchNumber?.trim() || `B-${created.sku.slice(0, 6)}`,
              quantity: created.currentStock,
              purchasePrice: created.purchasePrice,
              mfgDate: created.mfgDate ?? null,
              expiryDate: created.expiryDate,
              status: 'active',
            });
          }
          const nextMovements = [
            {
              id: Math.max(0, ...prev.stockMovements.map((m) => m.id)) + 1,
              shopId: prev.shop.id,
              productId: nextId,
              movementType: 'opening',
              quantityChange: created.currentStock,
              balanceAfter: created.currentStock,
              reason: 'Opening inventory stock',
              referenceId: created.sku,
              createdAt: formatISODate(new Date()),
            },
            ...prev.stockMovements,
          ];
          return {
            ...prev,
            products: [...prev.products, created],
            batches: nextBatches,
            stockMovements: nextMovements,
          };
        });
        notify(`Added "${payload.name}" to inventory.`, 'success');
        return;
      }
      await authedFetch(`/api/shops/${workspace.shop.id}/products`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      await reloadCurrentShop();
      notify(`Added "${payload.name}" to PostgreSQL inventory.`, 'success');
    },
    [mode, workspace, authedFetch, reloadCurrentShop, notify]
  );

  const updateProduct: ShopContextValue['updateProduct'] = useCallback(
    async (productId, payload) => {
      if (!workspace) return;
      if (mode === 'demo') {
        setWorkspace((prev) =>
          prev
            ? {
                ...prev,
                products: prev.products.map((p) => (p.id === productId ? { ...p, ...payload } : p)),
              }
            : prev
        );
        notify('Product updated.', 'success');
        return;
      }
      await authedFetch(`/api/shops/${workspace.shop.id}/products/${productId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      await reloadCurrentShop();
      notify('Product updated.', 'success');
    },
    [mode, workspace, authedFetch, reloadCurrentShop, notify]
  );

  const deleteProduct = useCallback(
    async (productId: number) => {
      if (!workspace) return;
      if (mode === 'demo') {
        setWorkspace((prev) =>
          prev
            ? {
                ...prev,
                products: prev.products.filter((p) => p.id !== productId),
                batches: prev.batches.filter((b) => b.productId !== productId),
              }
            : prev
        );
        notify('Product deleted from catalog.', 'info');
        return;
      }
      await authedFetch(`/api/shops/${workspace.shop.id}/products/${productId}`, {
        method: 'DELETE',
      });
      await reloadCurrentShop();
      notify('Product deleted from database.', 'info');
    },
    [mode, workspace, authedFetch, reloadCurrentShop, notify]
  );

  const importProductsCsv = useCallback(
    async (rows: Array<Partial<Product>>): Promise<number> => {
      if (!workspace || rows.length === 0) return 0;
      if (mode === 'demo') {
        let nextId = Math.max(0, ...workspace.products.map((p) => p.id)) + 1;
        const added: Product[] = [];
        for (const r of rows) {
          if (!r.name || !r.category) continue;
          added.push({
            id: nextId++,
            shopId: workspace.shop.id,
            supplierId: null,
            name: String(r.name),
            sku: String(r.sku || `CSV-${nextId}`).toUpperCase(),
            barcode: r.barcode || null,
            category: String(r.category),
            brand: r.brand || null,
            unit: String(r.unit || 'pcs'),
            purchasePrice: Math.max(0, Number(r.purchasePrice || 0)),
            sellingPrice: Math.max(1, Number(r.sellingPrice || 1)),
            currentStock: Math.max(0, Math.round(Number(r.currentStock || 0))),
            minStockLevel: Math.max(1, Math.round(Number(r.minStockLevel || 10))),
            maxStockLevel: Math.max(10, Math.round(Number(r.maxStockLevel || 60))),
            leadTimeDays: 3,
            expiryDate: r.expiryDate || null,
          });
        }
        setWorkspace((prev) =>
          prev ? { ...prev, products: [...prev.products, ...added] } : prev
        );
        notify(`Imported ${added.length} products from CSV.`, 'success');
        return added.length;
      }
      const resp = await authedFetch(`/api/shops/${workspace.shop.id}/products/import-csv`, {
        method: 'POST',
        body: JSON.stringify({ products: rows }),
      });
      await reloadCurrentShop();
      notify(`Imported ${resp.importedCount} products into PostgreSQL.`, 'success');
      return resp.importedCount;
    },
    [mode, workspace, authedFetch, reloadCurrentShop, notify]
  );

  const adjustStock = useCallback(
    async (productId: number, quantityChange: number, reason: string, allowNegative = false) => {
      if (!workspace) return;
      if (mode === 'demo') {
        const prod = workspace.products.find((p) => p.id === productId);
        if (!prod) throw new Error('Product not found.');
        const nextStock = prod.currentStock + quantityChange;
        if (nextStock < 0 && !allowNegative) {
          throw new Error(
            `Adjustment would result in negative stock (${nextStock}). Authorize override or reduce adjustment.`
          );
        }
        setWorkspace((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            products: prev.products.map((p) =>
              p.id === productId ? { ...p, currentStock: nextStock } : p
            ),
            stockMovements: [
              {
                id: Math.max(0, ...prev.stockMovements.map((m) => m.id)) + 1,
                shopId: prev.shop.id,
                productId,
                movementType: 'adjustment',
                quantityChange,
                balanceAfter: nextStock,
                reason: reason || 'Manual stock count adjustment',
                referenceId: `ADJ-${Date.now().toString().slice(-4)}`,
                createdAt: formatISODate(new Date()),
              },
              ...prev.stockMovements,
            ],
          };
        });
        notify(`Stock adjusted for ${prod.name}. New balance: ${nextStock} ${prod.unit}.`, 'success');
        return;
      }
      await authedFetch(`/api/shops/${workspace.shop.id}/inventory/adjust`, {
        method: 'POST',
        body: JSON.stringify({ productId, quantityChange, reason, allowNegative }),
      });
      await reloadCurrentShop();
      notify('Inventory adjustment recorded.', 'success');
    },
    [mode, workspace, authedFetch, reloadCurrentShop, notify]
  );

  const recordSale: ShopContextValue['recordSale'] = useCallback(
    async (payload) => {
      if (!workspace) return null;
      if (mode === 'demo') {
        const prodMap = new Map(workspace.products.map((p) => [p.id, p]));
        let subtotal = 0;
        let totalCost = 0;
        const computedItems = payload.items.map((reqItem) => {
          const prod = prodMap.get(reqItem.productId);
          if (!prod) throw new Error('Product not found.');
          if (reqItem.quantity <= 0 || !Number.isInteger(reqItem.quantity)) {
            throw new Error(`Invalid quantity for ${prod.name}.`);
          }
          if (prod.currentStock < reqItem.quantity) {
            throw new Error(
              `Insufficient stock for ${prod.name}. Available: ${prod.currentStock} ${prod.unit}.`
            );
          }
          const lineTotal = Number((reqItem.quantity * prod.sellingPrice).toFixed(2));
          const lineCost = Number((reqItem.quantity * prod.purchasePrice).toFixed(2));
          subtotal += lineTotal;
          totalCost += lineCost;
          return {
            productId: prod.id,
            productName: prod.name,
            quantity: reqItem.quantity,
            unitPrice: prod.sellingPrice,
            unitCost: prod.purchasePrice,
            lineTotal,
            lineProfit: Number((lineTotal - lineCost).toFixed(2)),
          };
        });

        const safeDiscount = Math.max(0, Math.min(payload.discount || 0, subtotal));
        const totalAmount = Number((subtotal - safeDiscount).toFixed(2));
        const grossProfit = Number((totalAmount - totalCost).toFixed(2));
        const saleDate = formatISODate(new Date());
        const invoiceNumber = `INV-${saleDate.replace(/-/g, '')}-${String(Math.floor(100 + Math.random() * 900))}`;

        const newSale: ShopWorkspacePayload['sales'][number] = {
          id: Math.max(0, ...workspace.sales.map((s) => s.id)) + 1,
          shopId: workspace.shop.id,
          invoiceNumber,
          customerName: payload.customerName?.trim() || 'Walk-in Customer',
          customerPhone: payload.customerPhone?.trim() || null,
          paymentMethod: payload.paymentMethod,
          subtotal: Number(subtotal.toFixed(2)),
          discount: Number(safeDiscount.toFixed(2)),
          totalAmount,
          totalCost: Number(totalCost.toFixed(2)),
          grossProfit,
          saleDate,
          items: computedItems,
        };

        setWorkspace((prev) => {
          if (!prev) return prev;
          const nextProducts = prev.products.map((p) => {
            const sold = computedItems.find((i) => i.productId === p.id);
            return sold ? { ...p, currentStock: p.currentStock - sold.quantity } : p;
          });
          // FIFO batch deduction (skip already expired batches)
          const nextBatches = prev.batches.map((b) => ({ ...b }));
          for (const sold of computedItems) {
            let rem = sold.quantity;
            const eligible = nextBatches
              .filter((b) => b.productId === sold.productId && b.status === 'active' && b.expiryDate >= saleDate)
              .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
            for (const b of eligible) {
              if (rem <= 0) break;
              const take = Math.min(b.quantity, rem);
              b.quantity -= take;
              if (b.quantity === 0) b.status = 'depleted';
              rem -= take;
            }
          }
          let mvId = Math.max(0, ...prev.stockMovements.map((m) => m.id)) + 1;
          const addedMoves = computedItems.map((item) => {
            const updatedProd = nextProducts.find((p) => p.id === item.productId);
            return {
              id: mvId++,
              shopId: prev.shop.id,
              productId: item.productId,
              movementType: 'sale',
              quantityChange: -item.quantity,
              balanceAfter: updatedProd?.currentStock ?? 0,
              reason: `Retail bill ${invoiceNumber}`,
              referenceId: invoiceNumber,
              createdAt: saleDate,
            };
          });
          const nextNotifs = [...prev.notifications];
          let notifId = Math.max(0, ...nextNotifs.map((n) => n.id)) + 1;
          for (const item of computedItems) {
            const p = nextProducts.find((pr) => pr.id === item.productId);
            if (p && p.currentStock <= p.minStockLevel) {
              nextNotifs.unshift({
                id: notifId++,
                shopId: prev.shop.id,
                type: p.currentStock === 0 ? 'out_of_stock' : 'low_stock',
                severity: p.currentStock === 0 ? 'critical' : 'warning',
                title: p.currentStock === 0 ? `Out of stock: ${p.name}` : `Low stock alert: ${p.name}`,
                message: `After bill ${invoiceNumber}, ${p.currentStock} ${p.unit} remaining (min: ${p.minStockLevel}).`,
                isRead: false,
                createdAt: saleDate,
              });
            }
          }

          return {
            ...prev,
            products: nextProducts,
            batches: nextBatches,
            sales: [newSale, ...prev.sales],
            stockMovements: [...addedMoves, ...prev.stockMovements],
            notifications: nextNotifs,
          };
        });

        notify(`Bill ${invoiceNumber} recorded (₹${totalAmount.toLocaleString('en-IN')}). Stock updated.`, 'success');
        return newSale;
      }

      const createdSale = (await authedFetch(`/api/shops/${workspace.shop.id}/sales`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })) as ShopWorkspacePayload['sales'][number];
      await reloadCurrentShop();
      notify(
        `Bill ${createdSale.invoiceNumber} saved to database (₹${createdSale.totalAmount.toLocaleString('en-IN')}).`,
        'success'
      );
      return createdSale;
    },
    [mode, workspace, authedFetch, reloadCurrentShop, notify]
  );

  const addSupplier: ShopContextValue['addSupplier'] = useCallback(
    async (payload) => {
      if (!workspace) return;
      if (mode === 'demo') {
        const nextId = Math.max(0, ...workspace.suppliers.map((s) => s.id)) + 1;
        setWorkspace((prev) =>
          prev
            ? {
                ...prev,
                suppliers: [...prev.suppliers, { ...payload, id: nextId, shopId: prev.shop.id }],
              }
            : prev
        );
        notify(`Supplier "${payload.name}" added.`, 'success');
        return;
      }
      await authedFetch(`/api/shops/${workspace.shop.id}/suppliers`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      await reloadCurrentShop();
      notify(`Supplier "${payload.name}" saved.`, 'success');
    },
    [mode, workspace, authedFetch, reloadCurrentShop, notify]
  );

  const paySupplier = useCallback(
    async (supplierId: number, amount: number) => {
      if (!workspace) return;
      if (mode === 'demo') {
        setWorkspace((prev) =>
          prev
            ? {
                ...prev,
                suppliers: prev.suppliers.map((s) =>
                  s.id === supplierId
                    ? { ...s, outstandingAmount: Math.max(0, Number((s.outstandingAmount - amount).toFixed(2))) }
                    : s
                ),
              }
            : prev
        );
        notify(`Recorded payment of ₹${amount.toLocaleString('en-IN')}.`, 'success');
        return;
      }
      await authedFetch(`/api/shops/${workspace.shop.id}/suppliers/${supplierId}/payment`, {
        method: 'POST',
        body: JSON.stringify({ amount }),
      });
      await reloadCurrentShop();
      notify(`Recorded supplier payment of ₹${amount.toLocaleString('en-IN')}.`, 'success');
    },
    [mode, workspace, authedFetch, reloadCurrentShop, notify]
  );

  const createPurchaseOrder: ShopContextValue['createPurchaseOrder'] = useCallback(
    async (payload) => {
      if (!workspace) return;
      if (mode === 'demo') {
        const prodMap = new Map(workspace.products.map((p) => [p.id, p]));
        const orderDate = formatISODate(new Date());
        const poNumber = `PO-${orderDate.replace(/-/g, '')}-${String(Math.floor(100 + Math.random() * 900))}`;
        const items = payload.items.map((item) => {
          const prod = prodMap.get(item.productId);
          return {
            productId: item.productId,
            productName: prod?.name || 'Product',
            orderedQty: item.orderedQty,
            receivedQty: 0,
            unitCost: item.unitCost,
            batchNumber: item.batchNumber || `POB-${Date.now().toString().slice(-4)}`,
            expiryDate: item.expiryDate || null,
          };
        });
        const totalAmount = Number(
          items.reduce((s, i) => s + i.orderedQty * i.unitCost, 0).toFixed(2)
        );
        setWorkspace((prev) =>
          prev
            ? {
                ...prev,
                purchases: [
                  {
                    id: Math.max(0, ...prev.purchases.map((p) => p.id)) + 1,
                    shopId: prev.shop.id,
                    supplierId: payload.supplierId ?? null,
                    poNumber,
                    status: 'pending',
                    totalAmount,
                    paidAmount: 0,
                    orderDate,
                    receivedDate: null,
                    notes: payload.notes || null,
                    items,
                  },
                  ...prev.purchases,
                ],
              }
            : prev
        );
        notify(`Purchase Order ${poNumber} created (Pending Delivery).`, 'success');
        return;
      }
      await authedFetch(`/api/shops/${workspace.shop.id}/purchases`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      await reloadCurrentShop();
      notify('Purchase order created.', 'success');
    },
    [mode, workspace, authedFetch, reloadCurrentShop, notify]
  );

  const receivePurchase = useCallback(
    async (purchaseId: number, paidAmount: number) => {
      if (!workspace) return;
      if (mode === 'demo') {
        const po = workspace.purchases.find((p) => p.id === purchaseId);
        if (!po || po.status === 'received') return;
        const today = formatISODate(new Date());
        const defaultExp = new Date();
        defaultExp.setDate(defaultExp.getDate() + 180);
        const defaultExpISO = formatISODate(defaultExp);
        const safePaid = Math.max(0, Math.min(paidAmount, po.totalAmount));
        const unpaidDelta = Number((po.totalAmount - safePaid).toFixed(2));

        setWorkspace((prev) => {
          if (!prev) return prev;
          const nextProducts = prev.products.map((p) => {
            const line = po.items.find((i) => i.productId === p.id);
            return line
              ? { ...p, currentStock: p.currentStock + line.orderedQty, purchasePrice: line.unitCost }
              : p;
          });
          let bId = Math.max(0, ...prev.batches.map((b) => b.id)) + 1;
          const addedBatches = po.items.map((line) => ({
            id: bId++,
            shopId: prev.shop.id,
            productId: line.productId,
            batchNumber: line.batchNumber || `RCV-${po.poNumber.slice(-4)}`,
            quantity: line.orderedQty,
            purchasePrice: line.unitCost,
            mfgDate: today,
            expiryDate: line.expiryDate || defaultExpISO,
            status: 'active',
          }));
          let mId = Math.max(0, ...prev.stockMovements.map((m) => m.id)) + 1;
          const addedMoves = po.items.map((line) => {
            const p = nextProducts.find((pr) => pr.id === line.productId);
            return {
              id: mId++,
              shopId: prev.shop.id,
              productId: line.productId,
              movementType: 'purchase',
              quantityChange: line.orderedQty,
              balanceAfter: p?.currentStock ?? line.orderedQty,
              reason: `Received ${po.poNumber}`,
              referenceId: po.poNumber,
              createdAt: today,
            };
          });
          const nextSuppliers = prev.suppliers.map((s) =>
            s.id === po.supplierId && unpaidDelta > 0
              ? { ...s, outstandingAmount: Number((s.outstandingAmount + unpaidDelta).toFixed(2)) }
              : s
          );
          const nextPurchases = prev.purchases.map((p) =>
            p.id === purchaseId
              ? {
                  ...p,
                  status: 'received',
                  receivedDate: today,
                  paidAmount: safePaid,
                  items: p.items.map((i) => ({ ...i, receivedQty: i.orderedQty })),
                }
              : p
          );
          return {
            ...prev,
            products: nextProducts,
            batches: [...prev.batches, ...addedBatches],
            stockMovements: [...addedMoves, ...prev.stockMovements],
            suppliers: nextSuppliers,
            purchases: nextPurchases,
          };
        });
        notify(`Received ${po.poNumber}. Inventory stock and batch records updated.`, 'success');
        return;
      }
      await authedFetch(`/api/shops/${workspace.shop.id}/purchases/${purchaseId}/receive`, {
        method: 'POST',
        body: JSON.stringify({ paidAmount }),
      });
      await reloadCurrentShop();
      notify('Goods received — stock quantities and batches updated.', 'success');
    },
    [mode, workspace, authedFetch, reloadCurrentShop, notify]
  );

  const removeBatchAsWastage = useCallback(
    async (batchId: number, reason: string) => {
      if (!workspace) return;
      if (mode === 'demo') {
        const batch = workspace.batches.find((b) => b.id === batchId);
        if (!batch || batch.status !== 'active') return;
        const loss = Number((batch.quantity * batch.purchasePrice).toFixed(2));
        const today = formatISODate(new Date());
        setWorkspace((prev) => {
          if (!prev) return prev;
          const nextProducts = prev.products.map((p) =>
            p.id === batch.productId
              ? { ...p, currentStock: Math.max(0, p.currentStock - batch.quantity) }
              : p
          );
          const updatedProd = nextProducts.find((p) => p.id === batch.productId);
          return {
            ...prev,
            products: nextProducts,
            batches: prev.batches.map((b) =>
              b.id === batchId ? { ...b, status: 'removed', quantity: 0 } : b
            ),
            wastageLogs: [
              {
                id: Math.max(0, ...prev.wastageLogs.map((w) => w.id)) + 1,
                shopId: prev.shop.id,
                productId: batch.productId,
                batchId: batch.id,
                quantity: batch.quantity,
                estimatedLoss: loss,
                reason: reason || 'Expired stock removed from shelf',
                loggedDate: today,
              },
              ...prev.wastageLogs,
            ],
            stockMovements: [
              {
                id: Math.max(0, ...prev.stockMovements.map((m) => m.id)) + 1,
                shopId: prev.shop.id,
                productId: batch.productId,
                movementType: 'wastage',
                quantityChange: -batch.quantity,
                balanceAfter: updatedProd?.currentStock ?? 0,
                reason: `Batch ${batch.batchNumber} removed: ${reason}`,
                referenceId: batch.batchNumber,
                createdAt: today,
              },
              ...prev.stockMovements,
            ],
          };
        });
        notify(`Batch ${batch.batchNumber} removed from sale and logged as wastage (₹${loss}).`, 'info');
        return;
      }
      await authedFetch(`/api/shops/${workspace.shop.id}/batches/${batchId}/remove`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      await reloadCurrentShop();
      notify('Expired/damaged batch removed and wastage recorded.', 'info');
    },
    [mode, workspace, authedFetch, reloadCurrentShop, notify]
  );

  const regenerateForecastsAndReorders = useCallback(async () => {
    if (!workspace) return;
    if (mode === 'demo') {
      const f = computeProductForecasts(workspace.products, workspace.sales, workspace.festivals);
      const fresh = computeReorderRecommendations(
        workspace.shop.id,
        workspace.products,
        workspace.suppliers,
        workspace.purchases,
        f
      );
      setWorkspace((prev) => {
        if (!prev) return prev;
        const historical = prev.reorders.filter((r) => r.status !== 'pending');
        let nextId = Math.max(0, ...prev.reorders.map((r) => r.id)) + 1;
        const pendingWithIds = fresh.map((r) => ({
          ...r,
          id: nextId++,
          createdAt: new Date().toISOString(),
        }));
        return {
          ...prev,
          reorders: [...pendingWithIds, ...historical],
        };
      });
      notify(`Recalculated demand forecasts and ${fresh.length} reorder suggestions.`, 'success');
      return;
    }
    const resp = await authedFetch(`/api/shops/${workspace.shop.id}/reorders/generate`, {
      method: 'POST',
    });
    await reloadCurrentShop();
    notify(
      `Forecasted ${resp.summary.forecastCount} products and generated ${resp.summary.reorderCount} reorder suggestions.`,
      'success'
    );
  }, [mode, workspace, authedFetch, reloadCurrentShop, notify]);

  const decideReorder = useCallback(
    async (reorderId: number, decision: 'approved' | 'rejected', editedQty?: number) => {
      if (!workspace) return;
      if (mode === 'demo') {
        const rec = workspace.reorders.find((r) => r.id === reorderId);
        if (!rec) return;
        const finalQty = decision === 'approved' ? Math.max(1, Math.round(editedQty ?? rec.suggestedQty)) : 0;
        const prod = workspace.products.find((p) => p.id === rec.productId);
        const updatedCost = prod ? Number((finalQty * prod.purchasePrice).toFixed(2)) : rec.estimatedCost;

        setWorkspace((prev) => {
          if (!prev) return prev;
          const nextReorders = prev.reorders.map((r) =>
            r.id === reorderId
              ? {
                  ...r,
                  status: decision,
                  approvedQty: decision === 'approved' ? finalQty : null,
                  estimatedCost: decision === 'approved' ? updatedCost : r.estimatedCost,
                }
              : r
          );
          const nextPurchases = [...prev.purchases];
          if (decision === 'approved' && prod) {
            const today = formatISODate(new Date());
            const poNumber = `PO-${today.replace(/-/g, '')}-${String(Math.floor(100 + Math.random() * 900))}`;
            nextPurchases.unshift({
              id: Math.max(0, ...prev.purchases.map((p) => p.id)) + 1,
              shopId: prev.shop.id,
              supplierId: rec.supplierId ?? prod.supplierId ?? null,
              poNumber,
              status: 'pending',
              totalAmount: updatedCost,
              paidAmount: 0,
              orderDate: today,
              receivedDate: null,
              notes: `Owner-approved from Reorder Recommendation #${rec.id}`,
              items: [
                {
                  productId: prod.id,
                  productName: prod.name,
                  orderedQty: finalQty,
                  receivedQty: 0,
                  unitCost: prod.purchasePrice,
                  batchNumber: `POB-${Date.now().toString().slice(-4)}`,
                  expiryDate: null,
                },
              ],
            });
          }
          return { ...prev, reorders: nextReorders, purchases: nextPurchases };
        });

        notify(
          decision === 'approved'
            ? `Approved reorder of ${finalQty} units. Pending Purchase Order created.`
            : 'Reorder recommendation rejected.',
          decision === 'approved' ? 'success' : 'info'
        );
        return;
      }
      await authedFetch(`/api/shops/${workspace.shop.id}/reorders/${reorderId}/action`, {
        method: 'POST',
        body: JSON.stringify({ decision, editedQty }),
      });
      await reloadCurrentShop();
      notify(
        decision === 'approved'
          ? 'Reorder approved and Purchase Order created in Purchases.'
          : 'Reorder recommendation dismissed.',
        decision === 'approved' ? 'success' : 'info'
      );
    },
    [mode, workspace, authedFetch, reloadCurrentShop, notify]
  );

  const addFestival: ShopContextValue['addFestival'] = useCallback(
    async (payload) => {
      if (!workspace) return;
      if (mode === 'demo') {
        const nextId = Math.max(0, ...workspace.festivals.map((f) => f.id)) + 1;
        setWorkspace((prev) =>
          prev
            ? {
                ...prev,
                festivals: [
                  ...prev.festivals,
                  { ...payload, id: nextId, shopId: prev.shop.id, isDismissed: false, isCustom: true },
                ].sort((a, b) => a.festivalDate.localeCompare(b.festivalDate)),
              }
            : prev
        );
        notify(`Added "${payload.name}" to your seasonal calendar.`, 'success');
        return;
      }
      await authedFetch(`/api/shops/${workspace.shop.id}/festivals`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      await reloadCurrentShop();
      notify(`Added "${payload.name}" to your seasonal calendar.`, 'success');
    },
    [mode, workspace, authedFetch, reloadCurrentShop, notify]
  );

  const toggleFestivalDismiss = useCallback(
    async (festivalId: number, isDismissed: boolean) => {
      if (!workspace) return;
      if (mode === 'demo') {
        setWorkspace((prev) =>
          prev
            ? {
                ...prev,
                festivals: prev.festivals.map((f) =>
                  f.id === festivalId ? { ...f, isDismissed } : f
                ),
              }
            : prev
        );
        return;
      }
      await authedFetch(`/api/shops/${workspace.shop.id}/festivals/${festivalId}`, {
        method: 'PUT',
        body: JSON.stringify({ isDismissed }),
      });
      await reloadCurrentShop();
    },
    [mode, workspace, authedFetch, reloadCurrentShop]
  );

  const markNotificationsRead = useCallback(async () => {
    if (!workspace) return;
    if (mode === 'demo') {
      setWorkspace((prev) =>
        prev
          ? {
              ...prev,
              notifications: prev.notifications.map((n) => ({ ...n, isRead: true })),
            }
          : prev
      );
      return;
    }
    await authedFetch(`/api/shops/${workspace.shop.id}/notifications/mark-read`, {
      method: 'POST',
    });
    await reloadCurrentShop();
  }, [mode, workspace, authedFetch, reloadCurrentShop]);

  const proposeStockTransfer: ShopContextValue['proposeStockTransfer'] = useCallback(
    async (payload) => {
      if (!workspace) return;
      const todayISO = formatISODate(new Date());
      if (mode === 'demo') {
        const prod = workspace.products.find((p) => p.id === payload.productId);
        if (!prod) throw new Error('Product not found.');
        const qty = Math.round(payload.quantity);
        if (qty <= 0 || qty > prod.currentStock) {
          throw new Error(`Enter a quantity between 1 and ${prod.currentStock} ${prod.unit}.`);
        }
        const batch = payload.batchId
          ? workspace.batches.find((b) => b.id === payload.batchId)
          : undefined;
        const expiryDate = batch?.expiryDate || prod.expiryDate || todayISO;
        if (expiryDate < todayISO) {
          throw new Error('Expired batches cannot be transferred. Remove expired stock as wastage.');
        }
        if (batch && qty > batch.quantity) {
          throw new Error(`Quantity exceeds batch stock (${batch.quantity}).`);
        }
        setWorkspace((prev) => {
          if (!prev) return prev;
          const existing = prev.stockTransfers || [];
          const nextId = Math.max(0, ...existing.map((t) => t.id)) + 1;
          return {
            ...prev,
            stockTransfers: [
              {
                id: nextId,
                shopId: prev.shop.id,
                productId: prod.id,
                productName: prod.name,
                batchId: batch?.id ?? null,
                batchNumber: batch?.batchNumber ?? null,
                targetShopName: payload.targetShopName.trim(),
                targetVillage: payload.targetVillage.trim(),
                quantity: qty,
                unitCost: prod.purchasePrice,
                expiryDate,
                sourceApproved: true,
                targetApproved: false,
                status: 'awaiting_target',
                notes: payload.notes?.trim() || null,
                createdAt: new Date().toISOString(),
              },
              ...existing,
            ],
            notifications: [
              {
                id: Math.max(0, ...prev.notifications.map((n) => n.id)) + 1,
                shopId: prev.shop.id,
                type: 'transfer',
                severity: 'info',
                title: `Transfer proposed: ${prod.name}`,
                message: `Proposed ${qty} ${prod.unit} transfer to ${payload.targetShopName} (${payload.targetVillage}). Awaiting partner shop approval.`,
                isRead: false,
                createdAt: todayISO,
              },
              ...prev.notifications,
            ],
          };
        });
        notify(
          `Transfer proposal sent to ${payload.targetShopName}. Awaiting partner shop approval.`,
          'success'
        );
        return;
      }
      await authedFetch(`/api/shops/${workspace.shop.id}/transfers`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      await reloadCurrentShop();
      notify(`Transfer proposal saved for ${payload.targetShopName}.`, 'success');
    },
    [mode, workspace, authedFetch, reloadCurrentShop, notify]
  );

  const decideStockTransfer: ShopContextValue['decideStockTransfer'] = useCallback(
    async (transferId, action) => {
      if (!workspace) return;
      const todayISO = formatISODate(new Date());
      if (mode === 'demo') {
        const list = workspace.stockTransfers || [];
        const target = list.find((t) => t.id === transferId);
        if (!target || target.status === 'completed' || target.status === 'rejected') return;

        if (action === 'reject') {
          setWorkspace((prev) =>
            prev
              ? {
                  ...prev,
                  stockTransfers: (prev.stockTransfers || []).map((t) =>
                    t.id === transferId ? { ...t, status: 'rejected' } : t
                  ),
                }
              : prev
          );
          notify('Stock transfer proposal rejected.', 'info');
          return;
        }

        if (target.expiryDate < todayISO) {
          throw new Error('Cannot complete transfer because the batch has already expired.');
        }

        const nextSource = action === 'approve_source' ? true : target.sourceApproved;
        const nextTarget = action === 'approve_target' ? true : target.targetApproved;
        const bothApproved = nextSource && nextTarget;

        if (bothApproved) {
          const prod = workspace.products.find((p) => p.id === target.productId);
          if (!prod || prod.currentStock < target.quantity) {
            throw new Error('Insufficient stock remaining to complete this transfer.');
          }
        }

        setWorkspace((prev) => {
          if (!prev) return prev;
          const nextTransfers = (prev.stockTransfers || []).map((t) =>
            t.id === transferId
              ? {
                  ...t,
                  sourceApproved: nextSource,
                  targetApproved: nextTarget,
                  status: bothApproved ? 'completed' : nextSource ? 'awaiting_target' : 'proposed',
                }
              : t
          );

          if (!bothApproved) {
            return { ...prev, stockTransfers: nextTransfers };
          }

          const nextProducts = prev.products.map((p) =>
            p.id === target.productId
              ? { ...p, currentStock: Math.max(0, p.currentStock - target.quantity) }
              : p
          );
          const updatedProd = nextProducts.find((p) => p.id === target.productId);
          const nextBatches = prev.batches.map((b) => {
            if (target.batchId && b.id === target.batchId) {
              const rem = Math.max(0, b.quantity - target.quantity);
              return { ...b, quantity: rem, status: rem === 0 ? 'depleted' : 'active' };
            }
            return b;
          });
          const nextMovements = [
            {
              id: Math.max(0, ...prev.stockMovements.map((m) => m.id)) + 1,
              shopId: prev.shop.id,
              productId: target.productId,
              movementType: 'transfer_out',
              quantityChange: -target.quantity,
              balanceAfter: updatedProd?.currentStock ?? 0,
              reason: `Dual-approved transfer to ${target.targetShopName} (${target.targetVillage})`,
              referenceId: `TRF-${target.id}`,
              createdAt: todayISO,
            },
            ...prev.stockMovements,
          ];
          const nextNotifs = [
            {
              id: Math.max(0, ...prev.notifications.map((n) => n.id)) + 1,
              shopId: prev.shop.id,
              type: 'transfer',
              severity: 'info',
              title: `Transfer completed: ${target.productName || updatedProd?.name || 'SKU'}`,
              message: `${target.quantity} units transferred to ${target.targetShopName} after dual-owner approval. Prevented est. ₹${Math.round(target.quantity * target.unitCost)} expiry loss.`,
              isRead: false,
              createdAt: todayISO,
            },
            ...prev.notifications,
          ];

          return {
            ...prev,
            products: nextProducts,
            batches: nextBatches,
            stockTransfers: nextTransfers,
            stockMovements: nextMovements,
            notifications: nextNotifs,
          };
        });

        notify(
          bothApproved
            ? `Transfer completed! Stock deducted & ledger updated after dual-owner approval.`
            : 'Approval recorded. Waiting for the other shop owner to confirm.',
          'success'
        );
        return;
      }

      await authedFetch(`/api/shops/${workspace.shop.id}/transfers/${transferId}/action`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      await reloadCurrentShop();
      notify(
        action === 'reject'
          ? 'Stock transfer proposal rejected.'
          : 'Stock transfer approval updated in database.',
        action === 'reject' ? 'info' : 'success'
      );
    },
    [mode, workspace, authedFetch, reloadCurrentShop, notify]
  );

  const toggleVillageDemandOptIn = useCallback(
    async (payload: {
      isOptedIn: boolean;
      villageName?: string;
      district?: string;
      latitude?: number | null;
      longitude?: number | null;
      topCategory?: string;
      topProduct?: string;
      estimatedWeeklyUnits?: number;
      shortageSeverity?: 'low' | 'moderate' | 'high';
    }) => {
      if (!workspace) return;
      const todayISO = formatISODate(new Date());

      if (mode === 'demo') {
        setWorkspace((prev) => {
          if (!prev) return prev;
          const nextShop = {
            ...prev.shop,
            ...(payload.latitude !== undefined ? { latitude: payload.latitude } : {}),
            ...(payload.longitude !== undefined ? { longitude: payload.longitude } : {}),
          };
          const signals = prev.villageDemandSignals || [];
          const ownIdx = signals.findIndex((s) => !s.isDemoData);
          let nextSignals = [...signals];
          if (ownIdx >= 0) {
            nextSignals[ownIdx] = {
              ...nextSignals[ownIdx],
              isOptedIn: payload.isOptedIn,
              villageName: payload.villageName?.trim() || nextSignals[ownIdx].villageName,
              district: payload.district?.trim() || nextSignals[ownIdx].district,
              latitude: payload.latitude ?? nextShop.latitude ?? nextSignals[ownIdx].latitude,
              longitude: payload.longitude ?? nextShop.longitude ?? nextSignals[ownIdx].longitude,
              topCategory: payload.topCategory || nextSignals[ownIdx].topCategory,
              topProduct: payload.topProduct || nextSignals[ownIdx].topProduct,
              estimatedWeeklyUnits:
                payload.estimatedWeeklyUnits !== undefined
                  ? Math.max(0, Math.round(payload.estimatedWeeklyUnits))
                  : nextSignals[ownIdx].estimatedWeeklyUnits,
              shortageSeverity: payload.shortageSeverity || nextSignals[ownIdx].shortageSeverity,
              updatedAt: todayISO,
            };
          } else {
            nextSignals = [
              {
                id: Math.max(0, ...signals.map((s) => s.id)) + 1,
                shopId: prev.shop.id,
                villageName: payload.villageName?.trim() || `${prev.shop.city} Cluster (Your Cluster)`,
                district: payload.district?.trim() || prev.shop.city,
                latitude: payload.latitude ?? nextShop.latitude ?? 12.2958,
                longitude: payload.longitude ?? nextShop.longitude ?? 76.6394,
                connectedShopsCount: 1,
                topCategory: payload.topCategory || 'Staples & Grains',
                topProduct: payload.topProduct || 'Essential Staples',
                estimatedWeeklyUnits: Math.max(0, Math.round(payload.estimatedWeeklyUnits ?? 140)),
                shortageSeverity: payload.shortageSeverity || 'moderate',
                isOptedIn: payload.isOptedIn,
                isDemoData: false,
                updatedAt: todayISO,
              },
              ...signals,
            ];
          }
          return { ...prev, shop: nextShop, villageDemandSignals: nextSignals };
        });
        notify(
          payload.isOptedIn
            ? 'Privacy-safe village demand sharing enabled (anonymized aggregates only).'
            : 'Opted out of village demand sharing. Only local forecasts remain visible to you.',
          'success'
        );
        return;
      }

      await authedFetch(`/api/shops/${workspace.shop.id}/village-signals/opt-in`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      await reloadCurrentShop();
      notify(
        payload.isOptedIn
          ? 'Village demand sharing settings saved to database.'
          : 'Opted out of village demand sharing.',
        'success'
      );
    },
    [mode, workspace, authedFetch, reloadCurrentShop, notify]
  );

  const createGroupOrder = useCallback(
    async (payload: {
      distributorOfferId: number;
      myQuantity: number;
      deliveryWindow?: string;
      notes?: string;
    }) => {
      if (!workspace) return;
      const qty = Math.round(Number(payload.myQuantity));
      if (!Number.isInteger(qty) || qty <= 0) {
        notify('Please enter a valid positive quantity.', 'error');
        return;
      }

      if (mode === 'demo') {
        const offer = (workspace.distributorOffers || []).find(
          (o) => o.id === payload.distributorOfferId
        );
        if (!offer) {
          notify('Selected distributor offer not found.', 'error');
          return;
        }
        const todayISO = formatISODate(new Date());
        const poolCode = `GRP-${String(workspace.shop.city || 'RUR').slice(0, 3).toUpperCase()}-${Math.floor(
          210 + Math.random() * 780
        )}`;
        const nextId = Math.max(0, ...(workspace.groupOrders || []).map((g) => g.id)) + 1;
        const status = qty >= offer.minBulkQty ? 'threshold_met' : 'open';

        setWorkspace((prev) => {
          if (!prev) return prev;
          const newPool = {
            id: nextId,
            shopId: prev.shop.id,
            poolCode,
            productName: offer.productName,
            category: offer.category,
            unit: offer.unit,
            distributorOfferId: offer.id,
            distributorName: offer.distributorName,
            standardUnitPrice: offer.standardUnitPrice,
            bulkUnitPrice: offer.bulkUnitPrice,
            minBulkQty: offer.minBulkQty,
            combinedQty: qty,
            estTransportFeeIndividual: offer.deliveryFeeINR,
            estTransportFeeShared: Math.round(offer.deliveryFeeINR / 3),
            deliveryWindow: payload.deliveryWindow?.trim() || 'Within 48 hours (Shared Route)',
            status,
            ownerApproved: false,
            distributorAccepted: false,
            notes: payload.notes?.trim() || 'New collective pool opened for nearby village shops.',
            createdAt: todayISO,
            updatedAt: todayISO,
            members: [
              {
                id: Date.now(),
                groupOrderId: nextId,
                shopName: prev.shop.name,
                village: prev.shop.city,
                quantity: qty,
                isCurrentShop: true,
                ownerApproved: false,
                createdAt: todayISO,
              },
            ],
          };
          return {
            ...prev,
            groupOrders: [newPool, ...(prev.groupOrders || [])],
            notifications: [
              {
                id: Math.max(0, ...prev.notifications.map((n) => n.id)) + 1,
                shopId: prev.shop.id,
                type: 'group_order',
                severity: 'info',
                title: `Group Order ${poolCode} created`,
                message: `Opened pool for ${offer.productName} (${qty}/${offer.minBulkQty} ${offer.unit}) with ${offer.distributorName}.`,
                isRead: false,
                createdAt: todayISO,
              },
              ...prev.notifications,
            ],
          };
        });
        notify(`Group Order ${poolCode} opened! Share with nearby shops or adjust qty.`, 'success');
        return;
      }

      await authedFetch(`/api/shops/${workspace.shop.id}/group-orders`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      await reloadCurrentShop();
      notify('New group purchasing pool saved to database.', 'success');
    },
    [mode, workspace, authedFetch, reloadCurrentShop, notify]
  );

  const joinGroupOrder = useCallback(
    async (
      groupOrderId: number,
      quantity: number,
      partner?: { shopName: string; village: string }
    ) => {
      if (!workspace) return;
      const qty = Math.round(Number(quantity));
      if (!Number.isInteger(qty) || qty <= 0) {
        notify('Quantity must be a positive integer.', 'error');
        return;
      }

      if (mode === 'demo') {
        const todayISO = formatISODate(new Date());
        setWorkspace((prev) => {
          if (!prev) return prev;
          const nextGroups = (prev.groupOrders || []).map((g) => {
            if (g.id !== groupOrderId) return g;
            let nextMembers = [...g.members];
            if (partner && partner.shopName.trim()) {
              const cleanName = partner.shopName.trim();
              const cleanVillage = partner.village.trim() || prev.shop.city;
              const existingIdx = nextMembers.findIndex(
                (m) => !m.isCurrentShop && m.shopName.toLowerCase() === cleanName.toLowerCase()
              );
              if (existingIdx >= 0) {
                nextMembers[existingIdx] = {
                  ...nextMembers[existingIdx],
                  quantity: qty,
                  village: cleanVillage,
                  ownerApproved: true,
                };
              } else {
                nextMembers.push({
                  id: Date.now(),
                  groupOrderId: g.id,
                  shopName: cleanName,
                  village: cleanVillage,
                  quantity: qty,
                  isCurrentShop: false,
                  ownerApproved: true,
                  createdAt: todayISO,
                });
              }
            } else {
              const hasCurrent = nextMembers.some((m) => m.isCurrentShop);
              nextMembers = hasCurrent
                ? nextMembers.map((m) =>
                    m.isCurrentShop ? { ...m, quantity: qty, ownerApproved: false } : m
                  )
                : [
                    ...nextMembers,
                    {
                      id: Date.now(),
                      groupOrderId: g.id,
                      shopName: prev.shop.name,
                      village: prev.shop.city,
                      quantity: qty,
                      isCurrentShop: true,
                      ownerApproved: false,
                      createdAt: todayISO,
                    },
                  ];
            }
            const combinedQty = nextMembers.reduce((sum, m) => sum + m.quantity, 0);
            const sharedFee = Math.round(
              g.estTransportFeeIndividual / Math.max(1, nextMembers.length)
            );
            const preserveOwnerApproval = Boolean(partner && g.ownerApproved);
            return {
              ...g,
              members: nextMembers,
              combinedQty,
              estTransportFeeShared: sharedFee,
              ownerApproved: preserveOwnerApproval,
              status:
                combinedQty >= g.minBulkQty
                  ? preserveOwnerApproval
                    ? 'approved_by_owner'
                    : 'threshold_met'
                  : 'open',
              updatedAt: todayISO,
            };
          });
          return { ...prev, groupOrders: nextGroups };
        });
        notify(
          partner
            ? `${partner.shopName.trim()} joined the shared pool with ${qty} units.`
            : `Updated your commitment to ${qty} units in the group pool.`,
          'success'
        );
        return;
      }

      await authedFetch(`/api/shops/${workspace.shop.id}/group-orders/${groupOrderId}/join`, {
        method: 'POST',
        body: JSON.stringify({
          quantity: qty,
          partnerShopName: partner?.shopName?.trim() || undefined,
          partnerVillage: partner?.village?.trim() || undefined,
        }),
      });
      await reloadCurrentShop();
      notify(
        partner
          ? `${partner.shopName.trim()} added to shared group order.`
          : 'Group order commitment updated.',
        'success'
      );
    },
    [mode, workspace, authedFetch, reloadCurrentShop, notify]
  );

  const decideGroupOrder = useCallback(
    async (groupOrderId: number, action: 'approve_owner' | 'accept_distributor' | 'cancel') => {
      if (!workspace) return;
      if (mode === 'demo') {
        const target = (workspace.groupOrders || []).find((g) => g.id === groupOrderId);
        if (!target) return;
        const currentMember = target.members.find((m) => m.isCurrentShop);
        const todayISO = formatISODate(new Date());

        if (action === 'approve_owner') {
          if (!currentMember || currentMember.quantity <= 0) {
            notify('Join this group pool with a positive quantity before approving.', 'error');
            return;
          }
          if (target.combinedQty < target.minBulkQty) {
            notify(
              `Need ${target.minBulkQty - target.combinedQty} more ${target.unit} to unlock bulk pricing.`,
              'error'
            );
            return;
          }
        }
        if (action === 'accept_distributor' && !target.ownerApproved) {
          notify('Shopkeeper must explicitly approve the order before distributor acceptance.', 'error');
          return;
        }

        setWorkspace((prev) => {
          if (!prev) return prev;
          const nextGroups = (prev.groupOrders || []).map((g) => {
            if (g.id !== groupOrderId) return g;
            if (action === 'cancel') return { ...g, status: 'cancelled', updatedAt: todayISO };
            if (action === 'approve_owner') {
              return {
                ...g,
                ownerApproved: true,
                status: g.distributorAccepted ? 'distributor_accepted' : 'approved_by_owner',
                members: g.members.map((m) =>
                  m.isCurrentShop ? { ...m, ownerApproved: true } : m
                ),
                updatedAt: todayISO,
              };
            }
            return {
              ...g,
              distributorAccepted: true,
              status: 'distributor_accepted',
              updatedAt: todayISO,
            };
          });

          let nextPurchases = prev.purchases;
          if (action === 'approve_owner' && currentMember) {
            const matchedProd = prev.products.find(
              (p) =>
                p.name.toLowerCase() === target.productName.toLowerCase() ||
                p.name.toLowerCase().includes(target.productName.toLowerCase().split(' ')[0])
            );
            if (matchedProd) {
              const newPo = {
                id: Math.max(0, ...prev.purchases.map((p) => p.id)) + 1,
                shopId: prev.shop.id,
                supplierId: matchedProd.supplierId ?? null,
                poNumber: `PO-${target.poolCode}`,
                status: 'pending' as const,
                totalAmount: Math.round(currentMember.quantity * target.bulkUnitPrice * 100) / 100,
                paidAmount: 0,
                orderDate: todayISO,
                notes: `Approved Group Order ${target.poolCode} via ${target.distributorName} (Bulk ₹${target.bulkUnitPrice}/${target.unit})`,
                items: [
                  {
                    productId: matchedProd.id,
                    productName: matchedProd.name,
                    orderedQty: currentMember.quantity,
                    receivedQty: 0,
                    unitCost: target.bulkUnitPrice,
                  },
                ],
              };
              nextPurchases = [newPo, ...prev.purchases];
            }
          }

          const notifTitle =
            action === 'approve_owner'
              ? `Approved Group Order ${target.poolCode}`
              : action === 'accept_distributor'
                ? `Distributor confirmed ${target.poolCode}`
                : `Cancelled Group Order ${target.poolCode}`;
          const notifMsg =
            action === 'approve_owner'
              ? `Pending Bulk Purchase Order created for ${currentMember?.quantity ?? 0} ${target.unit} at ₹${target.bulkUnitPrice}/${target.unit}.`
              : action === 'accept_distributor'
                ? `${target.distributorName} confirmed supply of ${target.combinedQty} ${target.unit} (${target.deliveryWindow}).`
                : `Pool ${target.poolCode} was cancelled by shopkeeper.`;

          return {
            ...prev,
            groupOrders: nextGroups,
            purchases: nextPurchases,
            notifications: [
              {
                id: Math.max(0, ...prev.notifications.map((n) => n.id)) + 1,
                shopId: prev.shop.id,
                type: 'group_order',
                severity: 'info',
                title: notifTitle,
                message: notifMsg,
                isRead: false,
                createdAt: todayISO,
              },
              ...prev.notifications,
            ],
          };
        });

        notify(
          action === 'approve_owner'
            ? `Order approved! Bulk Purchase Order created at ₹${target.bulkUnitPrice}/${target.unit}.`
            : action === 'accept_distributor'
              ? `Distributor supply confirmed for ${target.poolCode}!`
              : `Group pool ${target.poolCode} cancelled.`,
          action === 'cancel' ? 'info' : 'success'
        );
        return;
      }

      await authedFetch(`/api/shops/${workspace.shop.id}/group-orders/${groupOrderId}/action`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      await reloadCurrentShop();
      notify(
        action === 'approve_owner'
          ? 'Group order approved & Bulk Purchase Order created in database.'
          : action === 'accept_distributor'
            ? 'Distributor acceptance confirmed in database.'
            : 'Group order cancelled.',
        action === 'cancel' ? 'info' : 'success'
      );
    },
    [mode, workspace, authedFetch, reloadCurrentShop, notify]
  );

  const addDistributorOffer = useCallback(
    async (payload: {
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
    }) => {
      if (!workspace) return;
      if (payload.bulkUnitPrice > payload.standardUnitPrice) {
        notify('Bulk unit price cannot exceed standard unit price.', 'error');
        return;
      }

      if (mode === 'demo') {
        const todayISO = formatISODate(new Date());
        setWorkspace((prev) => {
          if (!prev) return prev;
          const nextId = Math.max(0, ...(prev.distributorOffers || []).map((o) => o.id)) + 1;
          return {
            ...prev,
            distributorOffers: [
              {
                id: nextId,
                shopId: prev.shop.id,
                distributorName: payload.distributorName.trim(),
                distributorCity: payload.distributorCity.trim(),
                verified: payload.verified ?? true,
                productName: payload.productName.trim(),
                category: payload.category.trim(),
                unit: payload.unit.trim() || 'pcs',
                standardUnitPrice: Number(payload.standardUnitPrice),
                bulkUnitPrice: Number(payload.bulkUnitPrice),
                minBulkQty: Math.max(1, Math.round(payload.minBulkQty)),
                availableQty: Math.max(0, Math.round(payload.availableQty)),
                leadTimeDays: Math.max(1, Math.round(payload.leadTimeDays)),
                deliveryFeeINR: Math.max(0, Number(payload.deliveryFeeINR)),
                latitude: payload.latitude ?? 12.31,
                longitude: payload.longitude ?? 76.65,
                updatedAt: todayISO,
              },
              ...(prev.distributorOffers || []),
            ],
          };
        });
        notify(`Verified distributor offer added for ${payload.productName}.`, 'success');
        return;
      }

      await authedFetch(`/api/shops/${workspace.shop.id}/distributor-offers`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      await reloadCurrentShop();
      notify(`Distributor offer published to marketplace.`, 'success');
    },
    [mode, workspace, authedFetch, reloadCurrentShop, notify]
  );

  const updateDistributorOffer = useCallback(
    async (
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
    ) => {
      if (!workspace) return;
      if (mode === 'demo') {
        const todayISO = formatISODate(new Date());
        setWorkspace((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            distributorOffers: (prev.distributorOffers || []).map((o) =>
              o.id === offerId ? { ...o, ...payload, updatedAt: todayISO } : o
            ),
          };
        });
        notify('Distributor catalog pricing & availability updated.', 'success');
        return;
      }

      await authedFetch(`/api/shops/${workspace.shop.id}/distributor-offers/${offerId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      await reloadCurrentShop();
      notify('Distributor catalog updated in database.', 'success');
    },
    [mode, workspace, authedFetch, reloadCurrentShop, notify]
  );

  const createDeliveryRun = useCallback(
    async (payload: {
      vehicleType: VehicleSpec['type'];
      driverName: string;
      driverPhone?: string;
      originName: string;
      originLat: number;
      originLng: number;
      startHour?: number;
      stops: RoutePoint[];
    }) => {
      if (!workspace) return;
      if (!payload.stops || payload.stops.length === 0) {
        notify('Select at least one village stop to optimize a route.', 'error');
        return;
      }

      if (mode === 'demo') {
        const plan = optimizeDeliveryRoute(
          { name: payload.originName, lat: payload.originLat, lng: payload.originLng },
          payload.stops,
          payload.vehicleType,
          payload.startHour ?? 7
        );
        const todayISO = formatISODate(new Date());
        const nextId = Math.max(0, ...(workspace.deliveryRuns || []).map((r) => r.id)) + 1;
        const runCode = `DEL-${String(workspace.shop.city || 'RUR').slice(0, 3).toUpperCase()}-${Math.floor(
          410 + Math.random() * 580
        )}`;
        const newRun = {
          id: nextId,
          shopId: workspace.shop.id,
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
          status: 'planned' as const,
          optimizationNotes: plan.optimizationNotes,
          createdAt: todayISO,
          updatedAt: todayISO,
          stops: plan.orderedStops.map((st, idx) => ({
            id: Date.now() + idx,
            deliveryRunId: nextId,
            sequenceOrder: st.sequenceOrder,
            shopName: st.shopName,
            village: st.village,
            latitude: st.latitude,
            longitude: st.longitude,
            loadKg: st.loadKg,
            itemSummary: st.itemSummary,
            groupOrderCode: st.groupOrderCode ?? null,
            etaWindow: st.etaWindow,
            status: 'pending' as const,
            deliveredAt: null,
            proofNotes: null,
          })),
        };

        setWorkspace((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            deliveryRuns: [newRun, ...(prev.deliveryRuns || [])],
            notifications: [
              {
                id: Math.max(0, ...prev.notifications.map((n) => n.id)) + 1,
                shopId: prev.shop.id,
                type: 'delivery',
                severity: 'info',
                title: `Optimized Delivery Run ${runCode} planned`,
                message: `${plan.orderedStops.length} stops sequenced via ${payload.vehicleType} (${plan.optimizedDistanceKm} km, saves ${plan.distanceSavedKm} km).`,
                isRead: false,
                createdAt: todayISO,
              },
              ...prev.notifications,
            ],
          };
        });
        notify(
          `Route ${runCode} optimized! Saves ${plan.distanceSavedKm} km (${plan.distanceSavedPct}%) vs separate trips.`,
          'success'
        );
        return;
      }

      await authedFetch(`/api/shops/${workspace.shop.id}/delivery-runs`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      await reloadCurrentShop();
      notify('Optimized delivery run saved to database.', 'success');
    },
    [mode, workspace, authedFetch, reloadCurrentShop, notify]
  );

  const updateDeliveryRunStatus = useCallback(
    async (
      runId: number,
      status: 'planned' | 'dispatched' | 'in_transit' | 'completed' | 'cancelled'
    ) => {
      if (!workspace) return;
      if (mode === 'demo') {
        const todayISO = formatISODate(new Date());
        const nowLabel = `${todayISO} ${new Date().toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
        })}`;
        setWorkspace((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            deliveryRuns: (prev.deliveryRuns || []).map((run) => {
              if (run.id !== runId) return run;
              let nextStops = run.stops;
              if (status === 'dispatched' || status === 'in_transit') {
                const hasEnRoute = run.stops.some((s) => s.status === 'en_route');
                let promoted = false;
                nextStops = run.stops.map((s) => {
                  if (!hasEnRoute && !promoted && s.status === 'pending') {
                    promoted = true;
                    return { ...s, status: 'en_route' };
                  }
                  return s;
                });
              } else if (status === 'completed') {
                nextStops = run.stops.map((s) =>
                  s.status === 'delivered' ? s : { ...s, status: 'delivered', deliveredAt: nowLabel }
                );
              }
              return { ...run, status, stops: nextStops, updatedAt: todayISO };
            }),
          };
        });
        notify(`Delivery run marked as ${status.replace('_', ' ')}.`, 'success');
        return;
      }

      await authedFetch(`/api/shops/${workspace.shop.id}/delivery-runs/${runId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      });
      await reloadCurrentShop();
      notify(`Delivery run status updated to ${status.replace('_', ' ')}.`, 'success');
    },
    [mode, workspace, authedFetch, reloadCurrentShop, notify]
  );

  const updateDeliveryStopStatus = useCallback(
    async (
      runId: number,
      stopId: number,
      status: 'pending' | 'en_route' | 'delivered',
      proofNotes?: string
    ) => {
      if (!workspace) return;
      if (mode === 'demo') {
        const todayISO = formatISODate(new Date());
        const nowLabel = `${todayISO} ${new Date().toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
        })}`;
        setWorkspace((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            deliveryRuns: (prev.deliveryRuns || []).map((run) => {
              if (run.id !== runId) return run;
              let updatedStops = run.stops.map((st) =>
                st.id === stopId
                  ? {
                      ...st,
                      status,
                      deliveredAt: status === 'delivered' ? nowLabel : null,
                      proofNotes: proofNotes !== undefined ? proofNotes.trim() || null : st.proofNotes,
                    }
                  : st
              );
              if (status === 'delivered') {
                let promoted = false;
                updatedStops = updatedStops.map((st) => {
                  if (!promoted && st.status === 'pending') {
                    promoted = true;
                    return { ...st, status: 'en_route' };
                  }
                  return st;
                });
              }
              const allDone = updatedStops.length > 0 && updatedStops.every((s) => s.status === 'delivered');
              const nextRunStatus = allDone
                ? 'completed'
                : run.status === 'planned' || run.status === 'dispatched'
                  ? 'in_transit'
                  : run.status;
              return { ...run, status: nextRunStatus, stops: updatedStops, updatedAt: todayISO };
            }),
          };
        });
        notify(`Stop marked as ${status.replace('_', ' ')}.`, 'success');
        return;
      }

      await authedFetch(
        `/api/shops/${workspace.shop.id}/delivery-runs/${runId}/stops/${stopId}/status`,
        {
          method: 'POST',
          body: JSON.stringify({ status, proofNotes }),
        }
      );
      await reloadCurrentShop();
      notify(`Delivery stop updated to ${status.replace('_', ' ')}.`, 'success');
    },
    [mode, workspace, authedFetch, reloadCurrentShop, notify]
  );

  const forecasts = useMemo(() => {
    if (!workspace) return [];
    return computeProductForecasts(workspace.products, workspace.sales, workspace.festivals);
  }, [workspace]);

  const expirySummary = useMemo(() => {
    if (!workspace) {
      return {
        expired: [],
        within7: [],
        within15: [],
        within30: [],
        healthy: [],
        totalMoneyAtRisk: 0,
        totalProjectedUnsoldLoss: 0,
      };
    }
    return classifyExpiryBatches(workspace.batches, workspace.products, undefined, forecasts);
  }, [workspace, forecasts]);

  const insights = useMemo(() => {
    if (!workspace) return [];
    return generateDeterministicInsights(
      workspace.products,
      workspace.batches,
      workspace.sales,
      forecasts
    );
  }, [workspace, forecasts]);

  const value: ShopContextValue = {
    mode,
    authLoading,
    workspaceLoading,
    user,
    shops,
    workspace,
    needsShopSetup,
    activeView,
    setActiveView,
    activeRole,
    setActiveRole,
    forecasts,
    expirySummary,
    insights,
    weather,
    toasts,
    dismissToast,
    notify,
    signInWithGoogle,
    signOutUser,
    enterDemoMode,
    exitToLanding,
    selectShop,
    createNewShop,
    updateShop,
    seedSampleIntoCurrentShop,
    addProduct,
    updateProduct,
    deleteProduct,
    importProductsCsv,
    adjustStock,
    recordSale,
    addSupplier,
    paySupplier,
    createPurchaseOrder,
    receivePurchase,
    removeBatchAsWastage,
    regenerateForecastsAndReorders,
    decideReorder,
    addFestival,
    toggleFestivalDismiss,
    markNotificationsRead,
    refreshWeather,
    proposeStockTransfer,
    decideStockTransfer,
    toggleVillageDemandOptIn,
    createGroupOrder,
    joinGroupOrder,
    decideGroupOrder,
    addDistributorOffer,
    updateDistributorOffer,
    createDeliveryRun,
    updateDeliveryRunStatus,
    updateDeliveryStopStatus,
  };

  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

export function useShop() {
  const ctx = useContext(ShopContext);
  if (!ctx) throw new Error('useShop must be used within ShopProvider');
  return ctx;
}
