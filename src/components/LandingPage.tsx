import React, { Suspense, lazy, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  Box,
  CalendarRange,
  CheckCircle2,
  Mic,
  PackageCheck,
  ShieldCheck,
  Sliders,
  Store,
  TrendingUp,
} from 'lucide-react';
import { useShop } from '../context/ShopContext.tsx';

const RuralVillage3DHero = lazy(() => import('./RuralVillage3DHero.tsx'));

export function LandingPage() {
  const { signInWithGoogle, enterDemoMode, setActiveView } = useShop();
  const [signingIn, setSigningIn] = useState(false);
  const [heroImgErr, setHeroImgErr] = useState(false);
  const [hero3DUnavailable, setHero3DUnavailable] = useState(false);
  const [shelfImgErr, setShelfImgErr] = useState(false);
  const [festImgErr, setFestImgErr] = useState(false);

  const handleGoogleSignIn = async () => {
    setSigningIn(true);
    try {
      await signInWithGoogle();
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAF8] text-[#111D15]">
      {/* Dark Forest-Obsidian 3-Zone Top Bar */}
      <header className="sticky top-0 z-30 bg-[#06140D]/95 backdrop-blur-sm border-b border-white/10">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <a
            href="#top"
            className="font-display text-xl font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            GRAMSETU <span className="text-[#10B981]">AI</span>
          </a>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-emerald-100/75">
            <a href="#capabilities" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Capabilities
            </a>
            <a href="#intelligence" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              AI Intelligence
            </a>
            <a href="#workflow" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Daily Workflow
            </a>
            <a href="#roles" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Ecosystem
            </a>
          </nav>

          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={enterDemoMode}
              className="px-4 py-2 text-sm font-semibold text-[#04110A] bg-[#10B981] hover:bg-[#34D399] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Open Demo Store
            </button>
          </div>
        </div>
      </header>

      <main id="top">
        {/* Dark Rural Commerce Hero Section */}
        <section
          className="bg-[#06140D] text-white border-b border-white/10"
          style={{
            backgroundImage:
              'radial-gradient(60% 70% at 80% 15%, rgba(16, 185, 129, 0.16) 0%, rgba(6, 20, 13, 0) 70%)',
          }}
        >
          <div className="max-w-7xl mx-auto px-6 pt-12 pb-14 lg:pt-16 lg:pb-16">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
              <div className="lg:col-span-6 flex flex-col justify-between py-2">
                <div>
                  <p className="text-sm font-medium text-[#34D399] mb-4">
                    Rural Commerce &amp; Supply Chain Intelligence Platform
                  </p>
                  <h1 className="font-display text-4xl sm:text-5xl lg:text-[52px] font-bold tracking-tight text-white leading-[1.08] max-w-xl">
                    Connecting Rural Commerce. Predicting Tomorrow. Empowering Every Shop.
                  </h1>
                  <p className="mt-5 text-base sm:text-lg text-emerald-100/75 leading-relaxed max-w-xl">
                    Unify voice-assisted counter billing, wholesale invoice OCR, FEFO expiry transfers, backtested demand forecasting, group purchasing, 2-Opt rural delivery routing, and interactive 3D store &amp; village twins in one dependable workspace.
                  </p>
                </div>

                <div className="mt-8 flex flex-wrap items-center gap-3.5">
                  <button
                    type="button"
                    onClick={handleGoogleSignIn}
                    disabled={signingIn}
                    className="inline-flex items-center gap-2.5 px-6 py-3 text-sm font-semibold text-[#04110A] bg-[#10B981] hover:bg-[#34D399] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
                  >
                    <Store className="w-4 h-4" />
                    {signingIn ? 'Signing in...' : 'Sign In & Create My Shop'}
                    <ArrowRight className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={enterDemoMode}
                    className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-white/8 border border-white/20 hover:bg-white/14 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Explore Sample Rural Store
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      enterDemoMode();
                      setActiveView('village3d');
                    }}
                    className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold text-[#6EE7B7] bg-[#0C291B] border border-[#10B981]/35 hover:bg-[#113825] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Box className="w-4 h-4" />
                    Launch 3D Village Twin
                  </button>
                </div>

                <div className="mt-7 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-emerald-200/70">
                  <span className="inline-flex items-center gap-1">
                    <Mic className="w-3.5 h-3.5 text-[#34D399]" /> Voice POS Billing
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>Group Purchasing</span>
                  <span aria-hidden="true">·</span>
                  <span>2-Opt Delivery Routes</span>
                  <span aria-hidden="true">·</span>
                  <span>Cloud SQL PostgreSQL</span>
                </div>
              </div>

              <div className="lg:col-span-6">
                <div className="h-full min-h-[340px] lg:min-h-[430px] rounded-xl overflow-hidden border border-white/15 bg-[#06140D] relative">
                  {!hero3DUnavailable ? (
                    <Suspense
                      fallback={
                        <div className="w-full h-full min-h-[340px] flex flex-col items-center justify-center bg-[#06140D] text-emerald-200/80 text-xs">
                          Loading interactive 3D Rural Village Network...
                        </div>
                      }
                    >
                      <RuralVillage3DHero onUnavailable={() => setHero3DUnavailable(true)} />
                    </Suspense>
                  ) : !heroImgErr ? (
                    <img
                      src="/src/assets/images/hero_kirana_store_1795103770880.jpg"
                      alt="Organized rural Kirana retail store with stocked aisles of staples, spices, and cooking oil"
                      referrerPolicy="no-referrer"
                      onError={() => setHeroImgErr(true)}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center bg-gradient-to-br from-[#0D2818] to-[#1B4D30] text-white">
                      <Store className="w-12 h-12 mb-3 text-emerald-300" />
                      <p className="font-display text-lg font-semibold">Modern Rural Retail Intelligence</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 4-column Outcome Strip anchored in Dark Hero */}
            <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                {
                  label: 'FEFO Wastage Shield',
                  metric: 'Unsold Prediction',
                  detail: 'Estimates unsold units before expiry and supports dual-approved inter-shop stock transfers.',
                },
                {
                  label: 'Wholesale Intake',
                  metric: 'Invoice OCR + CSV',
                  detail: 'Scan supplier bills with AI vision, verify quantities and expiry dates, and stock shelves fast.',
                },
                {
                  label: 'Honest Demand AI',
                  metric: 'MAE / MAPE Backtest',
                  detail: 'Reports 1d, 7d, and 30d forecasts with holdout error metrics and transparent data limitations.',
                },
                {
                  label: 'Scenario Planning',
                  metric: 'What-If Simulator',
                  detail: 'Test festival spikes, supplier price hikes, and purchasing budget caps before spending a rupee.',
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className="bg-[#0B2015] border border-white/12 rounded-xl p-5"
                >
                  <p className="text-xs font-medium text-[#6EE7B7]">{item.label}</p>
                  <p className="mt-1 font-display text-xl font-bold text-white tabular-nums">
                    {item.metric}
                  </p>
                  <p className="mt-1.5 text-sm text-emerald-100/70 leading-snug">{item.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Daylight Operations Capabilities Bento Grid */}
        <section id="capabilities" className="max-w-7xl mx-auto px-6 py-14">
          <div className="max-w-2xl mb-10">
            <p className="text-sm font-medium text-[#15803D]">01. Store Operations &amp; Shelf Control</p>
            <h2 className="mt-2 font-display text-3xl sm:text-4xl font-bold text-[#0D2818] tracking-tight">
              Built for how rural Kirana shops actually buy, stock, and sell
            </h2>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 bg-white border border-[#DCE6DF] rounded-xl overflow-hidden flex flex-col">
              <div className="h-60 bg-[#E8F0EA] overflow-hidden">
                {!shelfImgErr ? (
                  <img
                    src="/src/assets/images/showcase_shelf_inventory_1795103868451.jpg"
                    alt="Organized Indian grocery shelves with atta, dals, cooking oils, and tea tins"
                    referrerPolicy="no-referrer"
                    onError={() => setShelfImgErr(true)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-[#0D2818] text-white">
                    <PackageCheck className="w-10 h-10 text-emerald-300" />
                  </div>
                )}
              </div>
              <div className="p-6 flex-1 flex flex-col justify-between">
                <div>
                  <h3 className="font-display text-xl font-bold text-[#0D2818]">
                    Unified Inventory, Invoice OCR &amp; FEFO Expiry Ledger
                  </h3>
                  <p className="mt-2 text-sm text-[#4A5E51] leading-relaxed">
                    Capture wholesale bills via camera or CSV, bill retail customers in seconds with instant gross profit math, enforce First-Expired-First-Out rotation, and propose dual-approved stock transfers before batches expire.
                  </p>
                </div>
                <div className="mt-5 pt-4 border-t border-[#EDF2EE] flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#54695B]">
                  <span>Gemini Invoice OCR Intake</span>
                  <span aria-hidden="true">·</span>
                  <span>Dual-Owner Stock Transfers</span>
                  <span aria-hidden="true">·</span>
                  <span>Full Stock Audit Trail</span>
                </div>
              </div>
            </div>

            <div className="lg:col-span-5 bg-white border border-[#DCE6DF] rounded-xl overflow-hidden flex flex-col">
              <div className="h-60 bg-[#E8F0EA] overflow-hidden">
                {!festImgErr ? (
                  <img
                    src="/src/assets/images/showcase_festival_prep_1795103782108.jpg"
                    alt="Festive Kirana store display prepared with ghee tins, dry fruits, jaggery, and lamps"
                    referrerPolicy="no-referrer"
                    onError={() => setFestImgErr(true)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-[#15803D] text-white">
                    <CalendarRange className="w-10 h-10" />
                  </div>
                )}
              </div>
              <div className="p-6 flex-1 flex flex-col justify-between">
                <div>
                  <h3 className="font-display text-xl font-bold text-[#0D2818]">
                    Festival Calendar &amp; Live Open-Meteo Weather Signals
                  </h3>
                  <p className="mt-2 text-sm text-[#4A5E51] leading-relaxed">
                    Prepare ahead for Diwali, Pongal, Holi, Eid, or local village fairs alongside a keyless 5-day Open-Meteo weather outlook — always separating weather planning advisories from recorded sales evidence.
                  </p>
                </div>
                <div className="mt-5 pt-4 border-t border-[#EDF2EE] text-xs text-[#54695B]">
                  5-Day Local Forecast · Custom Village Events
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Intelligence Section */}
        <section id="intelligence" className="max-w-7xl mx-auto px-6 py-14 border-t border-[#E2EAE4]">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
            <div className="lg:col-span-5">
              <p className="text-sm font-medium text-[#15803D]">02. Honest Demand &amp; Decision Intelligence</p>
              <h2 className="mt-2 font-display text-3xl font-bold text-[#0D2818] tracking-tight">
                Verifiable forecasting math built for real rural margins
              </h2>
              <p className="mt-3 text-sm sm:text-base text-[#4A5E51] leading-relaxed">
                GRAMSETU AI never invents accuracy claims. Every 1-day, 7-day, and 30-day forecast exposes its statistical model, active history depth, walk-forward backtest MAE/MAPE, and plain-language rationale.
              </p>
            </div>

            <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                {
                  icon: TrendingUp,
                  title: 'Backtested Demand Forecasting',
                  body: 'Scales from Moving Averages on sparse history to Exponential Smoothing with weekday seasonality, displaying real holdout MAE & MAPE.',
                },
                {
                  icon: ShieldCheck,
                  title: 'Priority & Budget-Aware Reorders',
                  body: 'Ranks Critical, High, and Medium reorders against an editable rupee purchasing budget cap — never auto-ordering without owner approval.',
                },
                {
                  icon: Sliders,
                  title: 'What-If Business Simulator',
                  body: 'Test hypothetical demand surges, supplier price changes, delivery costs, and lead-time delays before committing capital.',
                },
                {
                  icon: BarChart3,
                  title: 'True Gross Profit & Wastage Clarity',
                  body: 'Separates revenue, purchase-cost gross margin, dead-stock tied capital, and expiry write-offs so profitability stays transparent.',
                },
              ].map((card) => {
                const Icon = card.icon;
                return (
                  <div
                    key={card.title}
                    className="bg-white border border-[#DCE6DF] rounded-xl p-5"
                  >
                    <Icon className="w-5 h-5 text-[#15803D] mb-3" />
                    <h3 className="font-display text-base font-bold text-[#0D2818]">
                      {card.title}
                    </h3>
                    <p className="mt-1.5 text-sm text-[#4A5E51] leading-relaxed">
                      {card.body}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Daily Workflow Section */}
        <section id="workflow" className="max-w-7xl mx-auto px-6 py-14 border-t border-[#E2EAE4]">
          <div className="max-w-2xl mb-8">
            <p className="text-sm font-medium text-[#15803D]">03. End-to-End Rural Store Workflow</p>
            <h2 className="mt-2 font-display text-3xl font-bold text-[#0D2818] tracking-tight">
              From supplier invoice scan to zero-wastage restocking
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {[
              {
                step: '01',
                title: 'Stock via OCR, CSV or Manual',
                desc: 'Photograph a wholesale bill or upload CSV rows with batch numbers, expiry dates, and unit costs.',
              },
              {
                step: '02',
                title: 'Bill Counter Sales Fast',
                desc: 'Record Cash or UPI bills on mobile or desktop with automatic FEFO batch deduction and printable receipts.',
              },
              {
                step: '03',
                title: 'Prevent Expiry & Dead Stock',
                desc: 'Spot batches projected to remain unsold before expiry and initiate dual-owner transfers to nearby shops.',
              },
              {
                step: '04',
                title: 'Simulate & Approve Reorders',
                desc: 'Test purchasing budgets in the What-If Simulator, verify reorder math, and approve supplier POs confidently.',
              },
            ].map((item) => (
              <div key={item.step} className="bg-white border border-[#DCE6DF] rounded-xl p-5">
                <span className="font-mono text-xs font-semibold text-[#15803D]">
                  Step {item.step}
                </span>
                <h3 className="mt-2 font-display text-base font-bold text-[#0D2818]">
                  {item.title}
                </h3>
                <p className="mt-1.5 text-sm text-[#4A5E51] leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Role Architecture & Final CTA */}
        <section id="roles" className="max-w-7xl mx-auto px-6 py-14 border-t border-[#E2EAE4]">
          <div className="bg-[#06140D] text-white rounded-2xl p-8 sm:p-10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center border border-white/10">
            <div className="lg:col-span-8">
              <p className="text-sm font-medium text-[#34D399]">
                Complete 5-Phase Rural Commerce &amp; Supply Chain Ecosystem Live
              </p>
              <h2 className="mt-2 font-display text-2xl sm:text-3xl font-bold tracking-tight">
                Run your rural store on transparent intelligence today
              </h2>
              <p className="mt-3 text-sm sm:text-base text-emerald-100/80 max-w-2xl leading-relaxed">
                Sign in with Google to persist your shop in Cloud SQL PostgreSQL, or explore the clearly labelled Sri Lakshmi Kirana sample store right now with voice-assisted billing, village demand maps, collective group buying, 2-Opt delivery routing, and 3D twins.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-emerald-200/70">
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#10B981]" /> Shopkeeper &amp; Voice POS
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#10B981]" /> Distributor Marketplace
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#10B981]" /> Group Orders &amp; 2-Opt Logistics
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#10B981]" /> 3D Store &amp; Village Twins
                </span>
              </div>
            </div>
            <div className="lg:col-span-4 flex flex-col sm:flex-row lg:flex-col gap-3">
              <button
                type="button"
                onClick={enterDemoMode}
                className="w-full px-5 py-3 text-sm font-semibold text-[#04110A] bg-[#10B981] hover:bg-[#34D399] rounded-lg transition-colors whitespace-nowrap cursor-pointer"
              >
                Explore Sample Demo Store
              </button>
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={signingIn}
                className="w-full px-5 py-3 text-sm font-semibold text-white bg-white/10 hover:bg-white/18 border border-white/20 rounded-lg transition-colors whitespace-nowrap cursor-pointer disabled:opacity-60"
              >
                {signingIn ? 'Connecting...' : 'Sign In with Google'}
              </button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#DCE6DF] bg-white">
        <div className="max-w-7xl mx-auto px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#54695B]">
          <span className="font-display font-bold text-sm text-[#0D2818]">GRAMSETU AI</span>
          <span>Connecting Rural Commerce · Predicting Tomorrow · Empowering Every Shop</span>
          <span>© {new Date().getFullYear()} GRAMSETU AI Rural Supply Chain</span>
        </div>
      </footer>
    </div>
  );
}
