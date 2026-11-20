import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Mic,
  MicOff,
  Send,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useShop } from '../context/ShopContext.tsx';
import { daysBetweenDates, formatISODate } from '../services/intelligenceEngine.ts';
import {
  buildLocalVoiceAdvisorFallback,
  createSpeechRecognition,
  isSpeechRecognitionSupported,
  isSpeechSynthesisSupported,
  speakText,
  stopSpeaking,
  VOICE_LANGUAGES,
  type SpeechRecognitionInstance,
  type VoiceAdvisorSnapshot,
  type VoiceLangCode,
} from '../services/voiceCommandEngine.ts';

interface AdvisorMessage {
  id: number;
  role: 'user' | 'advisor';
  text: string;
  source?: string;
}

interface VoiceAdvisorDrawerProps {
  open: boolean;
  onClose: () => void;
}

const QUICK_PROMPTS = [
  'What is low on stock right now?',
  'Which batches are expiring soon?',
  'How much can I save in group orders?',
  'Summarize today and last 7 days sales',
];

export function VoiceAdvisorDrawer({ open, onClose }: VoiceAdvisorDrawerProps) {
  const { workspace, forecasts, expirySummary } = useShop();
  const speechSupported = useMemo(() => isSpeechRecognitionSupported(), []);
  const ttsSupported = useMemo(() => isSpeechSynthesisSupported(), []);

  const [lang, setLang] = useState<VoiceLangCode>('en-IN');
  const [audioReply, setAudioReply] = useState(true);
  const [input, setInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<AdvisorMessage[]>([
    {
      id: 1,
      role: 'advisor',
      text: 'Ask about low stock, FEFO expiry risks, group order savings, or recent sales in English, Hindi, or Kannada.',
      source: 'Grounded in live store records',
    },
  ]);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const snapshot = useMemo<VoiceAdvisorSnapshot | null>(() => {
    if (!workspace) return null;
    const todayISO = formatISODate(new Date());
    const productMap = new Map(workspace.products.map((p) => [p.id, p]));

    const stockValueINR = workspace.products.reduce(
      (sum, p) => sum + p.currentStock * p.purchasePrice,
      0
    );

    const todaySales = workspace.sales.filter((s) => s.saleDate.slice(0, 10) === todayISO);
    const last7Sales = workspace.sales.filter((s) => {
      const age = daysBetweenDates(s.saleDate.slice(0, 10), todayISO);
      return age >= 0 && age < 7;
    });

    const lowStockItems = workspace.products
      .filter((p) => p.currentStock > 0 && p.currentStock <= p.minStockLevel)
      .map((p) => ({
        name: p.name,
        currentStock: p.currentStock,
        minStockLevel: p.minStockLevel,
        unit: p.unit,
      }));

    const outOfStockNames = workspace.products
      .filter((p) => p.currentStock <= 0)
      .map((p) => p.name);

    const expiringSoonItems = [...expirySummary.within7, ...expirySummary.within15]
      .slice(0, 8)
      .map((b) => ({
        productName: productMap.get(b.productId)?.name || `Product #${b.productId}`,
        quantity: b.quantity,
        expiryDate: b.expiryDate,
      }));

    const topMovers = [...forecasts]
      .sort((a, b) => b.avgDailySales - a.avgDailySales)
      .slice(0, 5)
      .map((f) => ({ name: f.productName, dailyAvg: f.avgDailySales }));

    const deadStockNames = forecasts.filter((f) => f.deadStockFlag).map((f) => f.productName);

    const activeGroupOrders = (workspace.groupOrders || [])
      .filter((g) => g.status !== 'cancelled')
      .map((g) => {
        const unitSave = Math.max(0, g.standardUnitPrice - g.bulkUnitPrice) * g.combinedQty;
        const transportSave = Math.max(
          0,
          g.estTransportFeeIndividual - g.estTransportFeeShared
        );
        return {
          productName: g.productName,
          combinedQty: g.combinedQty,
          minBulkQty: g.minBulkQty,
          estSavingsINR: unitSave + transportSave,
        };
      });

    const activeDeliveryRunsCount = (workspace.deliveryRuns || []).filter(
      (r) => r.status !== 'cancelled' && r.status !== 'completed'
    ).length;

    return {
      shopName: workspace.shop.name,
      city: workspace.shop.city,
      totalProducts: workspace.products.length,
      stockValueINR,
      todayRevenueINR: todaySales.reduce((s, r) => s + r.totalAmount, 0),
      revenueLast7dINR: last7Sales.reduce((s, r) => s + r.totalAmount, 0),
      grossProfitLast7dINR: last7Sales.reduce((s, r) => s + r.grossProfit, 0),
      lowStockItems,
      outOfStockNames,
      expiredBatchCount: expirySummary.expired.length,
      expiringSoonItems,
      deadStockNames,
      topMovers,
      pendingReordersCount: workspace.reorders.filter((r) => r.status === 'pending').length,
      activeGroupOrders,
      activeDeliveryRunsCount,
    };
  }, [workspace, forecasts, expirySummary]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    if (!open) {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // Ignore
        }
        recognitionRef.current = null;
      }
      setIsListening(false);
      setInterimText('');
      stopSpeaking();
    }
  }, [open]);

  const submitQuestion = useCallback(
    async (rawQuestion: string) => {
      const question = rawQuestion.trim();
      if (!question || !snapshot || loading) return;

      const userMsgId = Date.now();
      setMessages((prev) => [...prev, { id: userMsgId, role: 'user', text: question }]);
      setInput('');
      setLoading(true);

      const selectedLang = VOICE_LANGUAGES.find((l) => l.code === lang) || VOICE_LANGUAGES[0];

      try {
        const res = await fetch('/api/ai/voice-advisor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question,
            languageName: selectedLang.geminiLanguageName,
            snapshot,
          }),
        });
        const data = (await res.json()) as { reply?: string; error?: string };
        if (!res.ok || !data.reply) {
          throw new Error(data.error || 'Advisor service unavailable');
        }
        setMessages((prev) => [
          ...prev,
          {
            id: userMsgId + 1,
            role: 'advisor',
            text: data.reply!,
            source: `GRAMSETU Voice AI (${selectedLang.shortLabel})`,
          },
        ]);
        if (audioReply && ttsSupported) {
          speakText(data.reply, lang);
        }
      } catch {
        const fallback = buildLocalVoiceAdvisorFallback(question, snapshot);
        setMessages((prev) => [
          ...prev,
          {
            id: userMsgId + 1,
            role: 'advisor',
            text: fallback,
            source: 'Local store records calculation',
          },
        ]);
        if (audioReply && ttsSupported) {
          speakText(fallback, 'en-IN');
        }
      } finally {
        setLoading(false);
      }
    },
    [snapshot, loading, lang, audioReply, ttsSupported]
  );

  const toggleMic = () => {
    if (isListening) {
      try {
        recognitionRef.current?.stop();
      } catch {
        // Ignore
      }
      recognitionRef.current = null;
      setIsListening(false);
      setInterimText('');
      return;
    }

    if (!speechSupported) return;

    stopSpeaking();
    const rec = createSpeechRecognition(lang, { continuous: false, interimResults: true });
    if (!rec) return;

    recognitionRef.current = rec;
    let finalTranscript = '';

    rec.onstart = () => {
      setIsListening(true);
      setInterimText('');
    };

    rec.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const txt = event.results[i][0]?.transcript || '';
        if (event.results[i].isFinal) {
          finalTranscript = `${finalTranscript} ${txt}`.trim();
        } else {
          interim = `${interim} ${txt}`.trim();
        }
      }
      setInterimText(finalTranscript || interim);
    };

    rec.onerror = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    rec.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
      const captured = finalTranscript.trim();
      setInterimText('');
      if (captured) {
        void submitQuestion(captured);
      }
    };

    try {
      rec.start();
    } catch {
      setIsListening(false);
      recognitionRef.current = null;
    }
  };

  if (!open || !workspace) return null;

  return (
    <div className="no-print fixed inset-0 z-50 flex justify-end">
      <div className="flex-1 bg-black/35" onClick={onClose} />
      <aside className="w-full max-w-md bg-white border-l border-[#DCE6DF] h-full flex flex-col shadow-xl">
        {/* Header */}
        <div className="px-5 py-4 bg-[#0D2818] text-white flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h2 className="font-display text-base font-bold truncate">GRAMSETU Voice AI Advisor</h2>
            <p className="text-[11px] text-emerald-200/80 truncate">
              Grounded in {workspace.shop.name} live records
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {ttsSupported && (
              <button
                type="button"
                onClick={() => {
                  if (audioReply) stopSpeaking();
                  setAudioReply((prev) => !prev);
                }}
                title={audioReply ? 'Mute voice replies' : 'Speak voice replies'}
                className="p-2 rounded-lg text-emerald-100 hover:bg-white/10 cursor-pointer"
              >
                {audioReply ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close voice advisor"
              className="p-2 rounded-lg text-emerald-100 hover:bg-white/10 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Language & Quick Prompts */}
        <div className="px-4 py-3 bg-[#F5F9F6] border-b border-[#DCE6DF] space-y-2.5 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-[#3F5346]">Spoken Language</span>
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value as VoiceLangCode)}
              className="px-2.5 py-1 text-xs font-medium bg-white border border-[#C6D5CA] rounded-md text-[#0D2818]"
            >
              {VOICE_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_PROMPTS.map((q) => (
              <button
                key={q}
                type="button"
                disabled={loading}
                onClick={() => void submitQuestion(q)}
                className="text-left px-2.5 py-1 text-[11px] font-medium bg-white hover:bg-[#ECF6EF] text-[#0D2818] border border-[#DCE6DF] rounded-md transition-colors cursor-pointer disabled:opacity-50"
              >
                {q}
              </button>
            ))}
          </div>
        </div>

        {/* Conversation Feed */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#F8FAF8]">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`max-w-[88%] rounded-xl px-3.5 py-2.5 text-xs leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-[#0D2818] text-white'
                    : 'bg-white border border-[#DCE6DF] text-[#111D15]'
                }`}
              >
                <p>{m.text}</p>
                {m.role === 'advisor' && (
                  <div className="mt-2 pt-1.5 border-t border-[#EDF2EE] flex items-center justify-between gap-3 text-[10px] text-[#54695B]">
                    <span>{m.source}</span>
                    {ttsSupported && (
                      <button
                        type="button"
                        onClick={() => speakText(m.text, lang)}
                        className="inline-flex items-center gap-1 text-[#15803D] font-medium hover:underline cursor-pointer"
                      >
                        <Volume2 className="w-3 h-3" />
                        Listen
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}

          {isListening && (
            <div className="px-3.5 py-2.5 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#991B1B]">
              Listening... {interimText ? `"${interimText}"` : 'Speak your question clearly.'}
            </div>
          )}

          {loading && (
            <div className="px-3.5 py-2.5 rounded-xl bg-white border border-[#DCE6DF] text-xs text-[#54695B] w-fit">
              Checking live store records...
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input + Mic Bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitQuestion(input);
          }}
          className="p-3.5 bg-white border-t border-[#DCE6DF] flex items-center gap-2 shrink-0"
        >
          <button
            type="button"
            onClick={toggleMic}
            disabled={!speechSupported || loading}
            title={
              speechSupported
                ? isListening
                  ? 'Stop listening'
                  : 'Speak question via Web Speech API'
                : 'Web Speech API unavailable in this browser'
            }
            className={`p-2.5 rounded-lg border transition-colors shrink-0 cursor-pointer disabled:opacity-40 ${
              isListening
                ? 'bg-[#B91C1C] text-white border-[#B91C1C]'
                : 'bg-[#0D2818] text-white border-[#0D2818] hover:bg-[#153C24]'
            }`}
          >
            {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4 text-[#34D399]" />}
          </button>

          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about stock, expiry, sales, group orders..."
            className="flex-1 min-w-0 px-3 py-2 text-xs border border-[#C6D5CA] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#15803D]/25 focus:border-[#15803D]"
          />

          <button
            type="submit"
            disabled={loading || !input.trim()}
            aria-label="Send question"
            className="p-2.5 rounded-lg bg-[#15803D] hover:bg-[#166534] text-white transition-colors shrink-0 cursor-pointer disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </aside>
    </div>
  );
}
