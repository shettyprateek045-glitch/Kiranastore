# GRAMSETU AI — Rural Commerce & Supply Chain Intelligence Platform

**Tagline:** *Connecting Rural Commerce. Predicting Tomorrow. Empowering Every Shop.*

**GRAMSETU AI** is a full-stack rural retail and supply chain ecosystem that connects Kirana shopkeepers, wholesale distributors, and rural delivery providers through honest backtested demand forecasting, FEFO expiry protection, voice-assisted counter billing, collective group purchasing, 2-Opt delivery route optimization, and interactive 3D Store & Village Digital Twins.

---

## Core Platform Modules (All 5 Phases Live)

### 1. Store Operations, Voice POS Billing & Smart Inventory
- **Web Speech API Voice Billing & Product Search:** Hands-free counter billing in **English (India)**, **Hindi**, and **Kannada** (`SpeechRecognition` + `speechSynthesis`). Speak multi-item orders (*"Add 2 Atta and 3 Parle-G"*), remove items, clear the bill, or search inventory (*"Search Cooking Oil"*) while automatically enforcing available stock limits and blocking expired-only batches.
- **Instant UPI / QR Code POS Payments:** Generates NPCI-standard `upi://pay` QR codes locally in the browser for the exact payable bill total, with per-shop editable Merchant UPI VPA (`@okaxis`, `@ybl`, `@paytm`, etc.), mobile UPI deep-link launch, one-tap payment confirmation, and UPI reference stamping on printed receipts.
- **Fast Counter POS:** Cash/UPI/Card/Credit billing, automatic FEFO batch deduction, instant gross-profit math, printable thermal-friendly receipts, and Daily/Weekly/Monthly sales history.
- **Invoice OCR Intake & Inventory Ledger:** Upload wholesale bill photos for structured item extraction via server-side Gemini Vision OCR, import/export CSV catalogs, scan barcodes, perform reasoned stock adjustments, and inspect the complete stock movement audit trail.

### 2. AI Demand Forecasting, Reorders & What-If Simulator
- **Walk-Forward Backtested Forecasting:** Transparent 1-day, 7-day, and 30-day demand predictions scaling from Moving Averages to Exponential Smoothing ($\alpha = 0.35$) with day-of-week seasonality, exposing real holdout **MAE / MAPE** error metrics and clear data-depth notices.
- **Priority & Budget-Aware Reorder Engine:** Formula-backed Critical/High/Medium reorder recommendations capped against an editable rupee purchasing budget with owner **Approve / Edit Qty / Reject** controls (never auto-orders without approval).
- **What-If Business Simulator:** Stress-test hypothetical demand surges, supplier price shifts, delivery fees, stock availability, and lead-time delays before committing working capital.
- **FEFO Expiry Shield & Inter-Shop Transfers:** Tracks Already Expired (blocked from sale), 7-day, 15-day, and 30-day expiry windows, estimates unsold units before expiry, logs wastage, and coordinates **dual-approved inter-shop stock transfers** to nearby village shops.
- **Festival Planner & Keyless 5-Day Weather:** Local festival calendar paired with live keyless **Open-Meteo** 5-day regional weather planning signals (strictly separated from recorded sales history).

### 3. Rural Commerce Network & Distributor Marketplace
- **Village Demand Intelligence Map (Leaflet + OpenStreetMap):** Interactive geospatial view of aggregated rural shortage hotspots, verified APMC wholesale hubs, and privacy-safe opt-in demand sharing (never exposes private shop transactions).
- **Smart Group Purchasing:** Combine orders across nearby village shops to unlock distributor bulk pricing tiers and split transport costs, with dual shopkeeper approval and distributor acceptance workflow.
- **Distributor Marketplace & Portal:** Manage verified wholesale bulk catalogs, accept or decline incoming collective shop pools, and review opted-in village demand clusters.

### 4. AI Logistics & Delivery Optimization (Delivery Provider Role)
- **Deterministic Nearest-Neighbor + 2-Opt Route Optimizer:** Computes multi-stop rural delivery routes using Haversine distance with a `1.24×` rural road factor across selectable vehicle capacities (*Bike Courier*, *Auto Cargo*, *Mini Tempo*, *Rural Van*), comparing naive vs. optimized distance, fuel cost, ETA, and solo-vs-shared delivery cost per shop.
- **Interactive Route Map & Proof Tracker:** Visualize sequenced drop-offs on Leaflet, dispatch runs, and mark stops delivered with proof notes.

### 5. Interactive 3D Digital Twins & Multilingual Voice AI Advisor
- **Dark 3D Rural Village Hero:** Interactive Three.js rural village commerce diorama on the landing page with orbiting delivery tempos, wholesale trade arcs, and automatic photo fallback.
- **3D Spatial Store Digital Twin (`3D Store Twin`):** Interactive 3D aisle layout of your store with live heatmaps for stock levels, expiry risk, and demand velocity.
- **3D Village Commerce Digital Twin (`3D Village Twin`):** Regional 3D supply network mapping live village demand towers, distributor hubs, group order trade arcs, and animated cargo tempos with click-to-inspect HUD cards.
- **Multilingual GRAMSETU Voice AI Advisor (`Voice AI`):** Slide-over advisor supporting spoken or typed operational questions in English, Hindi, or Kannada, grounded strictly in live store metrics with deterministic local fallback.

---

## Architecture & Tech Stack

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS v4, Lucide Icons, Recharts, Three.js (`OrbitControls`), Leaflet (OpenStreetMap), Browser Web Speech API
- **Backend API:** Express + TypeScript REST API (`server.ts`, `src/server/apiRoutes.ts`)
- **Database:** Cloud SQL for PostgreSQL managed with Drizzle ORM (`src/db/schema.ts`, `src/db/index.ts`, `src/db/shopRepository.ts`)
- **Authentication:** Firebase Authentication (Google Sign-In) with server-side token verification (`firebase-admin`) + clearly labelled **Sri Lakshmi Kirana Sample Demo Store**
- **AI Services (Server-Side):** `@google/genai` (`gemini-4-hydrogen`) for wholesale invoice OCR, weekly executive business briefs, and multilingual shopkeeper voice advisory
- **Weather Feed:** Keyless Open-Meteo Geocoding & 5-Day Forecast API

---

## PostgreSQL Database Schema (23 Tables)

Defined in `src/db/schema.ts` and managed via Drizzle ORM:

- **Core Operations:** `users`, `shops`, `suppliers`, `products`, `product_batches`, `sales`, `sale_items`, `purchases`, `purchase_items`, `stock_movements`, `wastage_logs`, `stock_transfers`
- **Intelligence & Planning:** `forecasts`, `reorder_recommendations`, `festivals`, `notifications`, `audit_logs`
- **Rural Commerce Network:** `distributor_offers`, `group_orders`, `group_order_members`, `village_demand_signals`
- **AI Logistics & Delivery:** `delivery_runs`, `delivery_stops`

---

## Project Structure

```text
├── server.ts                          # Express server + Vite middleware (port 3000)
├── src/
│   ├── App.tsx                        # Multi-role workspace shell & navigation
│   ├── context/ShopContext.tsx        # State, Cloud SQL API sync & Demo sandbox
│   ├── db/
│   │   ├── schema.ts                  # 23 PostgreSQL Drizzle ORM tables
│   │   ├── index.ts                   # Cloud SQL PostgreSQL connection pool
│   │   └── shopRepository.ts          # Transactional DB queries & CRUD
│   ├── server/
│   │   ├── apiRoutes.ts               # Authenticated REST & AI/Weather routes
│   │   └── geminiService.ts           # Invoice OCR, Weekly Brief & Voice Advisor
│   ├── services/
│   │   ├── intelligenceEngine.ts      # Walk-forward forecasting, FEFO & What-If math
│   │   ├── logisticsEngine.ts         # Nearest-Neighbor + 2-Opt route optimizer
│   │   ├── voiceCommandEngine.ts      # Web Speech API parser & advisor fallback
│   │   └── sampleShopData.ts          # Clearly labelled sample rural store generator
│   └── components/
│       ├── LandingPage.tsx            # Dark 3D Village Hero + Ecosystem overview
│       ├── RuralVillage3DHero.tsx     # Three.js interactive landing diorama
│       ├── Store3DTwinView.tsx        # Three.js 3D store interior twin
│       ├── Village3DTwinView.tsx      # Three.js 3D regional village network twin
│       ├── SalesBillingView.tsx       # Counter POS + Web Speech API voice commands
│       ├── VoiceAdvisorDrawer.tsx     # Multilingual Voice AI Advisor drawer
│       ├── InventoryView.tsx          # Catalog, OCR intake, CSV & stock ledger
│       ├── ExpiryWastageView.tsx      # FEFO risk & dual-approved transfers
│       ├── IntelligenceViews.tsx      # Forecasts, Reorders, Simulator, Festivals
│       ├── RuralNetworkViews.tsx      # Leaflet Village Map & Group Purchasing
│       ├── LogisticsView.tsx          # Leaflet 2-Opt Delivery Route Optimizer
│       ├── PurchasesSuppliersView.tsx # Purchase Orders & Supplier Payables
│       └── ReportsAndModulesView.tsx  # Reports, Distributor Portal, Settings, Admin
```

---

## Local Development & Scripts

1. Copy `.env.example` to `.env` and configure required variables:
   - `GEMINI_API_KEY`: Server-side key for Invoice OCR, Weekly Brief, and Voice AI Advisor (falls back gracefully for deterministic features if unset).
   - `APP_URL`: Deployed application URL.
   - Cloud SQL (`SQL_*`) credentials and `firebase-applet-config.json` are provisioned automatically in AI Studio.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run development server (Express + Vite on port `3000`):
   ```bash
   npm run dev
   ```
4. Type-check and build for production:
   ```bash
   npm run lint
   npm run build
   npm start
   ```
