import React, { Suspense, lazy, useEffect, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Box,
  CalendarRange,
  ClipboardCheck,
  Globe,
  Layers,
  LayoutDashboard,
  Lightbulb,
  LogOut,
  MapPin,
  Menu,
  Mic,
  Package,
  Receipt,
  Route,
  Settings,
  Shield,
  ShoppingCart,
  Sliders,
  Store,
  TrendingUp,
  Truck,
  Users,
  X,
} from 'lucide-react';
import { ShopProvider, useShop } from './context/ShopContext.tsx';
import type { ActiveView, UserRole } from './types/dukaaniq.ts';
import { LandingPage } from './components/LandingPage.tsx';
import { ShopSetupModal } from './components/ShopSetupModal.tsx';
import { DashboardView } from './components/DashboardView.tsx';
import { InventoryView } from './components/InventoryView.tsx';
import { SalesBillingView } from './components/SalesBillingView.tsx';
import { PurchasesView, SuppliersView } from './components/PurchasesSuppliersView.tsx';
import { ExpiryWastageView } from './components/ExpiryWastageView.tsx';
import {
  BusinessInsightsView,
  DemandForecastView,
  FestivalPlannerView,
  ReorderEngineView,
  WhatIfSimulatorView,
} from './components/IntelligenceViews.tsx';
import {
  AdminPreviewView,
  DistributorHubView,
  NotificationsView,
  ReportsView,
  SettingsView,
} from './components/ReportsAndModulesView.tsx';
import {
  SmartGroupPurchasingView,
  VillageDemandMapView,
} from './components/RuralNetworkViews.tsx';
import { LogisticsView } from './components/LogisticsView.tsx';
import { VoiceAdvisorDrawer } from './components/VoiceAdvisorDrawer.tsx';

const preloadStore3D = () => import('./components/Store3DTwinView.tsx');
const Store3DTwinView = lazy(preloadStore3D);
const preloadVillage3D = () => import('./components/Village3DTwinView.tsx');
const Village3DTwinView = lazy(preloadVillage3D);

interface NavGroup {
  label: string;
  items: Array<{ id: ActiveView; label: string; icon: React.ComponentType<{ className?: string }> }>;
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Daily Operations',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { id: 'store3d', label: '3D Store Twin', icon: Box },
      { id: 'inventory', label: 'Inventory', icon: Package },
      { id: 'sales', label: 'Sales & Billing', icon: Receipt },
      { id: 'purchases', label: 'Purchases', icon: ShoppingCart },
      { id: 'suppliers', label: 'Suppliers', icon: Truck },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { id: 'expiry', label: 'Expiry & FEFO', icon: AlertTriangle },
      { id: 'forecast', label: 'Demand Forecast', icon: TrendingUp },
      { id: 'reorders', label: 'Reorder Engine', icon: ClipboardCheck },
      { id: 'simulator', label: 'What-If Simulator', icon: Sliders },
      { id: 'festivals', label: 'Festival & Weather', icon: CalendarRange },
      { id: 'insights', label: 'Business Insights', icon: Lightbulb },
    ],
  },
  {
    label: 'Rural Network',
    items: [
      { id: 'village_map', label: 'Village Demand Map', icon: MapPin },
      { id: 'village3d', label: '3D Village Twin', icon: Globe },
      { id: 'group_buying', label: 'Group Purchasing', icon: Layers },
      { id: 'logistics', label: 'Delivery & Logistics', icon: Route },
      { id: 'distributor', label: 'Distributor Portal', icon: Users },
    ],
  },
  {
    label: 'Analytics & Platform',
    items: [
      { id: 'reports', label: 'Reports', icon: BarChart3 },
      { id: 'notifications', label: 'Notifications', icon: Bell },
      { id: 'settings', label: 'Shop Settings', icon: Settings },
      { id: 'admin', label: 'Admin Preview', icon: Shield },
    ],
  },
];

const VIEW_TITLES: Record<ActiveView, { title: string; subtitle: string }> = {
  dashboard: { title: 'Store Overview', subtitle: 'Live inventory health, daily billing, dead-stock risk, and activity timeline' },
  store3d: { title: '3D Spatial Store Digital Twin', subtitle: 'Interactive aisle heatmap for stock levels, expiry risk, and demand velocity' },
  inventory: { title: 'Product & Inventory Management', subtitle: 'Catalog, Invoice OCR intake, CSV import/export, stock adjustments, and audit ledger' },
  sales: { title: 'Sales & Counter Billing', subtitle: 'Fast counter & Web Speech API voice billing with automatic FEFO deduction and printable receipts' },
  purchases: { title: 'Purchase Orders', subtitle: 'Create supplier POs and receive deliveries into batch inventory' },
  suppliers: { title: 'Suppliers & Payables', subtitle: 'Wholesale contacts, lead times, and payment balances' },
  expiry: { title: 'Expiry, FEFO & Inter-Shop Transfers', subtitle: 'Unsold-before-expiry predictions, wastage logging, and dual-approved stock transfers' },
  forecast: { title: 'AI Demand Forecasting', subtitle: 'Walk-forward backtested 1-day, 7-day, and 30-day statistical demand predictions' },
  reorders: { title: 'Smart Reorder Engine', subtitle: 'Priority-ranked, budget-aware reorder recommendations awaiting owner approval' },
  simulator: { title: 'What-If Business Simulator', subtitle: 'Hypothetical scenario testing for demand shifts, supplier prices, and budget caps' },
  festivals: { title: 'Festival Calendar & Open-Meteo Weather', subtitle: 'Local event demand planning alongside live 5-day regional weather signals' },
  insights: { title: 'Smart Business Insights', subtitle: 'Clear observations, predictions, and weekly AI business advisor brief' },
  reports: { title: 'Reports & Profit Analytics', subtitle: 'Revenue, gross profit, net profit, inventory valuation, and CSV export' },
  village_map: { title: 'Village Demand Intelligence Map', subtitle: 'OpenStreetMap aggregated rural shortage hotspots, distributor hubs, and privacy-safe opt-in sharing' },
  village3d: { title: '3D Village Commerce Digital Twin', subtitle: 'Interactive 3D regional demand towers, wholesale trade arcs, and animated rural delivery routes' },
  group_buying: { title: 'Smart Group Purchasing', subtitle: 'Collective multi-shop order pooling, bulk unit discounts, and shared transport savings' },
  logistics: { title: 'AI Logistics & Delivery Optimization', subtitle: 'Nearest-Neighbor + 2-Opt multi-stop rural routing, vehicle load planning, and stop-by-stop proof tracking' },
  distributor: { title: 'Distributor Marketplace & Portal', subtitle: 'Verified wholesale catalogs, incoming collective order acceptance, and opted-in village demand' },
  notifications: { title: 'Notifications & Alerts', subtitle: 'Low stock, expiry warnings, transfer proposals, group orders, and delivery updates' },
  settings: { title: 'Shop Settings', subtitle: 'Manage shop details, location signals, and workspace data' },
  admin: { title: 'Admin Governance Preview', subtitle: 'Modular platform oversight and upcoming multi-tenant controls' },
};

function WorkspaceShell() {
  const {
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
    expirySummary,
    toasts,
    dismissToast,
    notify,
    signInWithGoogle,
    signOutUser,
    exitToLanding,
    selectShop,
  } = useShop();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [voiceAdvisorOpen, setVoiceAdvisorOpen] = useState(false);

  // Fast keyboard shortcuts for rapid shop floor switching (Alt+1..4)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      if (e.key === '1') {
        e.preventDefault();
        setActiveView('dashboard');
      } else if (e.key === '2') {
        e.preventDefault();
        setActiveView('store3d');
      } else if (e.key === '3') {
        e.preventDefault();
        setActiveView('sales');
      } else if (e.key === '4') {
        e.preventDefault();
        setActiveView('inventory');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setActiveView]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#06140D] flex items-center justify-center">
        <div className="text-center space-y-2">
          <p className="font-display text-xl font-bold text-white">
            GRAMSETU <span className="text-[#10B981]">AI</span>
          </p>
          <p className="text-xs text-emerald-200/70">Loading workspace...</p>
        </div>
      </div>
    );
  }

  if (mode === 'landing') {
    return <LandingPage />;
  }

  if (mode === 'authenticated' && needsShopSetup) {
    return <ShopSetupModal />;
  }

  if (workspaceLoading || !workspace) {
    return (
      <div className="min-h-screen bg-[#F8FAF8] flex items-center justify-center">
        <div className="bg-white border border-[#DCE6DF] rounded-xl p-8 w-full max-w-sm text-center space-y-2">
          <p className="font-display text-lg font-bold text-[#0D2818]">Loading Shop Workspace</p>
          <p className="text-xs text-[#54695B]">Fetching inventory, batches, sales, and forecasts...</p>
        </div>
      </div>
    );
  }

  const unreadCount = workspace.notifications.filter((n) => !n.isRead).length;
  const pendingReorderCount = workspace.reorders.filter((r) => r.status === 'pending').length;
  const expiredCount = expirySummary.expired.length;
  const headerMeta = VIEW_TITLES[activeView];

  const renderSidebarContent = () => (
    <div className="flex flex-col h-full bg-[#0D2818] text-white">
      <div className="px-5 h-16 flex items-center justify-between border-b border-white/10 shrink-0">
        <button
          type="button"
          onClick={() => setActiveView('dashboard')}
          className="font-display text-lg font-bold tracking-tight text-white cursor-pointer"
        >
          GRAMSETU <span className="text-[#34D399]">AI</span>
        </button>
        <button
          type="button"
          onClick={() => setMobileMenuOpen(false)}
          className="lg:hidden p-1.5 text-emerald-100/80 hover:text-white cursor-pointer"
          aria-label="Close navigation"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Shop Switcher & Multi-Role Perspective */}
      <div className="px-4 py-3.5 border-b border-white/10 space-y-2.5">
        <div>
          <div className="flex items-center gap-2 text-xs text-emerald-200/80">
            <Store className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate font-semibold text-white">{workspace.shop.name}</span>
          </div>
          <p className="mt-0.5 text-[11px] text-emerald-200/70 truncate">
            {workspace.shop.city}, {workspace.shop.state}
          </p>
        </div>
        {mode === 'authenticated' && shops.length > 1 && (
          <select
            value={workspace.shop.id}
            onChange={(e) => void selectShop(Number(e.target.value))}
            className="w-full bg-[#153C24] text-white text-xs px-2.5 py-1.5 rounded-md border border-white/15"
          >
            {shops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <div>
          <label className="block text-[10px] text-emerald-200/60 mb-1">Workspace Role View</label>
          <select
            value={activeRole}
            onChange={(e) => {
              const nextRole = e.target.value as UserRole;
              setActiveRole(nextRole);
              if (nextRole === 'shop_owner') setActiveView('dashboard');
              else if (nextRole === 'distributor') setActiveView('distributor');
              else if (nextRole === 'admin') setActiveView('admin');
              else if (nextRole === 'delivery_provider') {
                setActiveView('logistics');
              }
            }}
            aria-label="Select workspace role view"
            className="w-full bg-[#153C24] text-emerald-50 text-xs px-2.5 py-1.5 rounded-md border border-white/15"
          >
            <option value="shop_owner">Shopkeeper (Active)</option>
            <option value="distributor">Distributor Portal</option>
            <option value="delivery_provider">Delivery Provider (Logistics)</option>
            <option value="admin">Admin Governance</option>
          </select>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="px-2.5 mb-1.5 text-[11px] font-medium text-emerald-200/60">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = activeView === item.id;
                const badgeCount =
                  item.id === 'notifications'
                    ? unreadCount
                    : item.id === 'reorders'
                    ? pendingReorderCount
                    : item.id === 'expiry'
                    ? expiredCount
                    : 0;

                return (
                  <button
                    key={item.id}
                    type="button"
                    onMouseEnter={
                      item.id === 'store3d'
                        ? () => void preloadStore3D()
                        : item.id === 'village3d'
                        ? () => void preloadVillage3D()
                        : undefined
                    }
                    onClick={() => {
                      setActiveView(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                      active
                        ? 'bg-[#15803D] text-white font-semibold'
                        : 'text-emerald-100/80 hover:bg-white/8 hover:text-white'
                    }`}
                  >
                    <span className="flex items-center gap-2.5 truncate">
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </span>
                    {badgeCount > 0 && (
                      <span className="font-mono text-[11px] tabular-nums text-emerald-200 shrink-0">
                        {badgeCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer Account Controls */}
      <div className="p-4 border-t border-white/10 space-y-2 shrink-0">
        {mode === 'demo' ? (
          <>
            <button
              type="button"
              onClick={() => void signInWithGoogle()}
              className="w-full py-2 text-xs font-semibold text-[#0D2818] bg-white hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer"
            >
              Sign In with Google
            </button>
            <button
              type="button"
              onClick={exitToLanding}
              className="w-full py-1.5 text-xs text-emerald-200/80 hover:text-white cursor-pointer"
            >
              Back to Home
            </button>
          </>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white truncate">
                {user?.displayName || 'Shop Owner'}
              </p>
              <p className="text-[11px] text-emerald-200/70 truncate">{user?.email}</p>
            </div>
            <button
              type="button"
              onClick={() => void signOutUser()}
              title="Sign Out"
              className="p-2 text-emerald-200/80 hover:text-white hover:bg-white/10 rounded-lg cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F8FAF8] flex">
      {/* Desktop Sidebar */}
      <aside className="no-print hidden lg:block w-64 shrink-0 sticky top-0 h-screen">
        {renderSidebarContent()}
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="no-print fixed inset-0 z-50 lg:hidden flex">
          <div className="w-64 h-full shadow-xl">{renderSidebarContent()}</div>
          <div
            className="flex-1 bg-black/40"
            onClick={() => setMobileMenuOpen(false)}
          />
        </div>
      )}

      {/* Main Content Viewport */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Sample Data Transparency Banner (only shown when clearly labelled sample data is active) */}
        {(mode === 'demo' || workspace.shop.isSampleData) && (
          <div className="no-print bg-[#ECF6EF] border-b border-[#CFE3D5] px-4 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[#16532D]">
            <span>
              <span className="font-semibold">Sample Data Mode:</span> Viewing clearly labelled demonstration data for{' '}
              {workspace.shop.name}. Changes in demo sandbox stay local unless you sign in.
            </span>
            {mode === 'demo' && (
              <button
                type="button"
                onClick={() => void signInWithGoogle()}
                className="font-semibold text-[#0D2818] hover:underline whitespace-nowrap cursor-pointer"
              >
                Sign In to Create Real Shop
              </button>
            )}
          </div>
        )}

        {/* Contextual Top Bar */}
        <header className="no-print bg-white border-b border-[#DCE6DF] px-4 sm:px-6 h-16 flex items-center justify-between gap-4 sticky top-0 z-20">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 text-[#0D2818] hover:bg-[#F2F7F3] rounded-lg cursor-pointer"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <h1 className="font-display text-base sm:text-lg font-bold text-[#0D2818] truncate">
                {headerMeta.title}
              </h1>
              <p className="hidden sm:block text-xs text-[#54695B] truncate">
                {headerMeta.subtitle}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setVoiceAdvisorOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border bg-[#0D2818] text-white border-[#0D2818] hover:bg-[#153C24] whitespace-nowrap transition-colors cursor-pointer"
              title="Open Multilingual GRAMSETU Voice AI Advisor"
            >
              <Mic className="w-3.5 h-3.5 text-[#34D399]" />
              <span className="hidden sm:inline">Voice AI</span>
            </button>
            <button
              type="button"
              onMouseEnter={() => void preloadStore3D()}
              onClick={() => setActiveView(activeView === 'store3d' ? 'dashboard' : 'store3d')}
              className={`hidden sm:inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border whitespace-nowrap transition-colors cursor-pointer ${
                activeView === 'store3d'
                  ? 'bg-[#0D2818] text-white border-[#0D2818]'
                  : 'bg-white text-[#0D2818] border-[#C6D5CA] hover:bg-[#F2F7F3]'
              }`}
              title="Open 3D Spatial Store Twin (Alt+2)"
            >
              <Box className="w-3.5 h-3.5 text-[#15803D]" />
              {activeView === 'store3d' ? 'Exit 3D' : '3D Store'}
            </button>
            <button
              type="button"
              onClick={() => setActiveView('notifications')}
              className="relative p-2 text-[#3F5346] hover:text-[#0D2818] hover:bg-[#F2F7F3] rounded-lg cursor-pointer"
              aria-label="Notifications"
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 text-[10px] font-mono font-bold text-white bg-[#B91C1C] px-1 rounded">
                  {unreadCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveView('sales')}
              className="px-3.5 py-2 text-xs font-semibold text-white bg-[#15803D] hover:bg-[#166534] rounded-lg whitespace-nowrap cursor-pointer"
            >
              New Bill
            </button>
          </div>
        </header>

        {/* Active Module Content */}
        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">
          {activeView === 'dashboard' && <DashboardView />}
          {activeView === 'store3d' && (
            <Suspense
              fallback={
                <div className="w-full h-[calc(100vh-8.2rem)] min-h-[540px] rounded-2xl border border-[#DCE6DF] bg-[#EBF1EC] flex items-center justify-center">
                  <div className="bg-white border border-[#DCE6DF] rounded-xl px-6 py-4 text-center">
                    <p className="font-display text-sm font-bold text-[#0D2818]">
                      Initializing 3D Store Digital Twin...
                    </p>
                    <p className="mt-1 text-xs text-[#54695B]">
                      Mapping live aisles, shelf stock, and expiry overlays
                    </p>
                  </div>
                </div>
              }
            >
              <Store3DTwinView />
            </Suspense>
          )}
          {activeView === 'inventory' && <InventoryView />}
          {activeView === 'sales' && <SalesBillingView />}
          {activeView === 'purchases' && <PurchasesView />}
          {activeView === 'suppliers' && <SuppliersView />}
          {activeView === 'expiry' && <ExpiryWastageView />}
          {activeView === 'forecast' && <DemandForecastView />}
          {activeView === 'reorders' && <ReorderEngineView />}
          {activeView === 'simulator' && <WhatIfSimulatorView />}
          {activeView === 'festivals' && <FestivalPlannerView />}
          {activeView === 'insights' && <BusinessInsightsView />}
          {activeView === 'reports' && <ReportsView />}
          {activeView === 'village_map' && <VillageDemandMapView />}
          {activeView === 'village3d' && (
            <Suspense
              fallback={
                <div className="w-full h-[calc(100vh-10rem)] min-h-[500px] rounded-2xl border border-[#DCE6DF] bg-[#EAF2EC] flex items-center justify-center">
                  <div className="bg-white border border-[#DCE6DF] rounded-xl px-6 py-4 text-center">
                    <p className="font-display text-sm font-bold text-[#0D2818]">
                      Initializing 3D Village Commerce Twin...
                    </p>
                    <p className="mt-1 text-xs text-[#54695B]">
                      Mapping village demand towers, wholesale trade arcs, and delivery routes
                    </p>
                  </div>
                </div>
              }
            >
              <Village3DTwinView />
            </Suspense>
          )}
          {activeView === 'group_buying' && <SmartGroupPurchasingView />}
          {activeView === 'logistics' && <LogisticsView />}
          {activeView === 'distributor' && <DistributorHubView />}
          {activeView === 'notifications' && <NotificationsView />}
          {activeView === 'settings' && <SettingsView />}
          {activeView === 'admin' && <AdminPreviewView />}
        </main>
      </div>

      {/* Multilingual Voice AI Advisor Slide-Over */}
      <VoiceAdvisorDrawer
        open={voiceAdvisorOpen}
        onClose={() => setVoiceAdvisorOpen(false)}
      />

      {/* Toast Feedback Stack */}
      <div className="no-print fixed bottom-4 right-4 z-50 space-y-2 max-w-sm w-[calc(100%-2rem)]">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`px-4 py-3 rounded-xl border text-xs font-medium flex items-center justify-between gap-3 shadow-sm ${
              t.type === 'error'
                ? 'bg-red-50 border-red-200 text-red-800'
                : t.type === 'success'
                ? 'bg-[#0D2818] border-[#0D2818] text-white'
                : 'bg-white border-[#DCE6DF] text-[#0D2818]'
            }`}
          >
            <span>{t.text}</span>
            <button
              type="button"
              onClick={() => dismissToast(t.id)}
              className="opacity-70 hover:opacity-100 cursor-pointer shrink-0"
              aria-label="Dismiss notification"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ShopProvider>
      <WorkspaceShell />
    </ShopProvider>
  );
}
