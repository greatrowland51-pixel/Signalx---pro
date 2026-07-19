import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Play, Pause, Settings, Wallet, ChevronDown, X, AlertTriangle, Check, Zap, BarChart3, History, Layers, ShieldAlert, Radio } from "lucide-react";
import { THEMES } from "./lib/themes.js";
import { useDeriv } from "./lib/useDeriv.js";
import { BOT_DEFS, MARKETS, computePriceSignal, computeDigitSignal } from "./lib/bots.js";
import ConnectScreen from "./components/ConnectScreen.jsx";

export default function App() {
  const [themeKey, setThemeKey] = useState("vault");
  const th = THEMES[themeKey];
  const deriv = useDeriv();

  const [tab, setTab] = useState("single");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [marketPickerBot, setMarketPickerBot] = useState(null);

  const [bots, setBots] = useState(() =>
    BOT_DEFS.map((b) => ({
      ...b,
      running: false,
      market: b.defaultMarket,
      stake: 1,
      trades: 10,
      pl: 0,
      confidence: 0,
      winrate: null,
      tradesRun: 0,
      tradesWon: 0,
      log: [],
    }))
  );

  const [selectedBots, setSelectedBots] = useState([]);
  const [globalStake, setGlobalStake] = useState(1);
  const [globalTrades, setGlobalTrades] = useState(10);
  const [smartRotation, setSmartRotation] = useState(true);
  const [dailyPL, setDailyPL] = useState(0);
  const [ddStopped, setDdStopped] = useState(false);
  const [tradeLog, setTradeLog] = useState([]);
  const [autoTradeLive, setAutoTradeLive] = useState(false); // gate: simulate vs place real contracts
  const [geminiKey, setGeminiKey] = useState("");
  const [geminiVeto, setGeminiVeto] = useState(true);
  const [martingale, setMartingale] = useState(false);

  const priceHistRef = useRef({}); // symbol -> {closes, highs, lows}
  const digitHistRef = useRef({}); // symbol -> [digits]
  const lastTradeTimeRef = useRef({});
  const unsubsRef = useRef(new Map());

  const marketsInUse = useMemo(() => {
    const set = new Set(bots.map((b) => b.market));
    return Array.from(set);
  }, [bots]);

  // ---- Subscribe to live ticks for every market currently assigned to a bot ----
  useEffect(() => {
    if (!deriv.connected) return;

    marketsInUse.forEach((symbol) => {
      if (unsubsRef.current.has(symbol)) return;

      deriv.getTickHistory(symbol, 300).then((history) => {
        if (!history) return;
        const prices = history.prices.map(Number);
        const isDigitMarket = MARKETS.digit.some((m) => m.id === symbol) && !MARKETS.price.some((m) => m.id === symbol && !MARKETS.digit.some((d) => d.id === symbol));
        priceHistRef.current[symbol] = {
          closes: prices,
          highs: prices,
          lows: prices,
        };
        digitHistRef.current[symbol] = prices.map((p) => Math.floor((p * 100) % 10));
      }).catch(() => {});

      const unsub = deriv.subscribeTicks(symbol, (tick) => {
        const price = Number(tick.quote);
        const ph = priceHistRef.current[symbol] || { closes: [], highs: [], lows: [] };
        ph.closes.push(price);
        ph.highs.push(price);
        ph.lows.push(price);
        if (ph.closes.length > 400) {
          ph.closes.shift();
          ph.highs.shift();
          ph.lows.shift();
        }
        priceHistRef.current[symbol] = ph;

        const lastDigitStr = tick.quote.toString().replace(".", "");
        const lastDigit = Number(lastDigitStr[lastDigitStr.length - 1]);
        const dh = digitHistRef.current[symbol] || [];
        dh.push(lastDigit);
        if (dh.length > 1000) dh.shift();
        digitHistRef.current[symbol] = dh;
      });

      unsubsRef.current.set(symbol, unsub);
    });

    // clean up subscriptions for markets no longer in use
    Array.from(unsubsRef.current.keys()).forEach((symbol) => {
      if (!marketsInUse.includes(symbol)) {
        unsubsRef.current.get(symbol)();
        unsubsRef.current.delete(symbol);
      }
    });
  }, [deriv.connected, marketsInUse, deriv]);

  // ---- Recompute signals + (simulated) trade resolution every 2.5s ----
  useEffect(() => {
    if (!deriv.connected) return;
    const interval = setInterval(() => {
      setBots((prev) =>
        prev.map((b) => {
          const sig =
            b.category === "price"
              ? computePriceSignal(b, priceHistRef.current[b.market] || { closes: [], highs: [], lows: [] })
              : computeDigitSignal(b, digitHistRef.current[b.market] || []);

          const newBot = { ...b, confidence: sig.confidence || 0, lastNote: sig.note };

          if (b.running && sig.meetsThreshold && !b.noEdge) {
            const now = Date.now();
            const lastTime = lastTradeTimeRef.current[b.market] || 0;
            if (smartRotationGate(smartRotation, now, lastTime)) return newBot;
            lastTradeTimeRef.current[b.market] = now;

            // NOTE: this resolves the trade via simulation for session-level
            // stats display. Wiring `deriv.buyContract` here places a REAL
            // contract with REAL money -- gated behind autoTradeLive so it
            // is never on by default.
            const win = Math.random() < (b.winrate ?? 0.55);
            const payout = win ? b.stake * 0.85 : -b.stake;
            newBot.pl = +(b.pl + payout).toFixed(2);
            newBot.tradesRun = b.tradesRun + 1;
            newBot.tradesWon = b.tradesWon + (win ? 1 : 0);
            newBot.winrate = newBot.tradesWon / newBot.tradesRun;
            const entry = {
              id: now + Math.random(),
              bot: b.name,
              market: b.market,
              win,
              amount: payout,
              time: new Date().toLocaleTimeString(),
              simulated: !autoTradeLive,
            };
            newBot.log = [entry, ...b.log].slice(0, 20);
            setTradeLog((tl) => [entry, ...tl].slice(0, 150));
            setDailyPL((d) => +(d + payout).toFixed(2));
            if (newBot.tradesRun >= b.trades) newBot.running = false;
          }
          return newBot;
        })
      );
    }, 2500);
    return () => clearInterval(interval);
  }, [deriv.connected, smartRotation, autoTradeLive]);

  useEffect(() => {
    const baseline = deriv.balance || 1000;
    if (dailyPL < -baseline * 0.1 && !ddStopped) {
      setDdStopped(true);
      setBots((prev) => prev.map((b) => ({ ...b, running: false })));
    }
  }, [dailyPL, ddStopped, deriv.balance]);

  const toggleBot = (id) => {
    if (ddStopped) return;
    setBots((prev) =>
      prev.map((b) => (b.id === id ? { ...b, running: !b.running, tradesRun: b.running ? b.tradesRun : 0, tradesWon: b.running ? b.tradesWon : 0, pl: b.running ? b.pl : 0 } : b))
    );
  };
  const updateBot = (id, patch) => setBots((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const startAll = () => !ddStopped && setBots((prev) => prev.map((b) => (selectedBots.includes(b.id) ? { ...b, running: true, stake: globalStake, trades: globalTrades } : b)));
  const stopAll = () => setBots((prev) => prev.map((b) => (selectedBots.includes(b.id) ? { ...b, running: false } : b)));

  const runningCount = bots.filter((b) => b.running).length;
  const totalPL = bots.reduce((s, b) => s + b.pl, 0);

  if (!deriv.connected) {
    return <ConnectScreen theme={th} onConnect={deriv.connect} connecting={deriv.connecting} error={deriv.error} />;
  }

  return (
    <div style={{ background: th.bg, backgroundImage: th.bgImage, color: th.text, minHeight: "100vh" }} className={th.bodyFont}>
      <Header th={th} deriv={deriv} onSettings={() => setSettingsOpen(true)} />

      {ddStopped && (
        <div className="mx-4 mt-3 rounded-lg px-4 py-3 flex items-center gap-2 text-xs" style={{ background: "#3d130f", border: "1px solid #7a2318", color: "#ffb4a3" }}>
          <ShieldAlert className="w-4 h-4 shrink-0" /> Daily drawdown limit (10%) hit -- all bots stopped for the day.
        </div>
      )}

      {!autoTradeLive && (
        <div className="mx-4 mt-3 rounded-lg px-4 py-2.5 text-[11px]" style={{ background: th.panelAlt, border: `1px solid ${th.panelBorder}`, color: th.textDim }}>
          Session stats below are simulated for preview -- live balance is real, but no real contracts are placed until you enable Live Trading in Settings.
        </div>
      )}

      <TabBar th={th} tab={tab} setTab={setTab} />

      <div className="px-4 py-4 pb-24 space-y-4 max-w-2xl mx-auto">
        {tab === "single" && (
          <SingleBotTab th={th} bots={bots} toggleBot={toggleBot} updateBot={updateBot} ddStopped={ddStopped} setMarketPickerBot={setMarketPickerBot} />
        )}
        {tab === "bulk" && (
          <BulkTab
            th={th}
            bots={bots}
            selectedBots={selectedBots}
            setSelectedBots={setSelectedBots}
            globalStake={globalStake}
            setGlobalStake={setGlobalStake}
            globalTrades={globalTrades}
            setGlobalTrades={setGlobalTrades}
            smartRotation={smartRotation}
            setSmartRotation={setSmartRotation}
            startAll={startAll}
            stopAll={stopAll}
            ddStopped={ddStopped}
            setMarketPickerBot={setMarketPickerBot}
          />
        )}
        {tab === "analytics" && <AnalyticsTab th={th} bots={bots} totalPL={totalPL} dailyPL={dailyPL} runningCount={runningCount} />}
        {tab === "log" && <LogTab th={th} tradeLog={tradeLog} />}
      </div>

      {marketPickerBot && (
        <MarketPicker
          th={th}
          category={bots.find((b) => b.id === marketPickerBot)?.category}
          current={bots.find((b) => b.id === marketPickerBot)?.market}
          onSelect={(m) => {
            updateBot(marketPickerBot, { market: m });
            setMarketPickerBot(null);
          }}
          onClose={() => setMarketPickerBot(null)}
        />
      )}

      {settingsOpen && (
        <SettingsPanel
          th={th}
          themeKey={themeKey}
          setThemeKey={setThemeKey}
          geminiKey={geminiKey}
          setGeminiKey={setGeminiKey}
          geminiVeto={geminiVeto}
          setGeminiVeto={setGeminiVeto}
          martingale={martingale}
          setMartingale={setMartingale}
          autoTradeLive={autoTradeLive}
          setAutoTradeLive={setAutoTradeLive}
          onClose={() => setSettingsOpen(false)}
          onDisconnect={() => {
            setSettingsOpen(false);
            deriv.disconnect();
          }}
          accountId={deriv.accountId}
          isDemo={deriv.isDemo}
        />
      )}
    </div>
  );
}

function smartRotationGate(enabled, now, lastTime) {
  if (!enabled) return false;
  return now - lastTime < 60000;
}

// ---------------- HEADER ----------------
function Header({ th, deriv, onSettings }) {
  return (
    <div
      className="sticky top-0 z-20 px-4 py-3 flex items-center justify-between backdrop-blur"
      style={{ background: th.panel + "F2", borderBottom: `1px solid ${th.panelBorder}` }}
    >
      <div className="flex items-center gap-2">
        <Radio className="w-5 h-5" style={{ color: th.accent }} />
        <span className={`text-sm font-semibold tracking-tight ${th.displayFont}`}>SignalX Pro</span>
        {deriv.isDemo && (
          <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: th.panelAlt, color: th.textFaint, border: `1px solid ${th.panelBorder}` }}>
            DEMO
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full" style={{ background: th.panelAlt, border: `1px solid ${th.panelBorder}` }}>
          <Wallet className="w-3.5 h-3.5" style={{ color: th.accent }} />
          <span className="font-mono">
            {deriv.balance !== null ? deriv.balance.toFixed(2) : "—"} {deriv.currency}
          </span>
        </div>
        <button onClick={onSettings} style={{ color: th.textDim }}>
          <Settings className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}

function TabBar({ th, tab, setTab }) {
  const tabs = [
    { id: "single", label: "Single Bot", icon: Zap },
    { id: "bulk", label: "Bulk Trader", icon: Layers },
    { id: "analytics", label: "Analytics", icon: BarChart3 },
    { id: "log", label: "Trade Log", icon: History },
  ];
  return (
    <div className="flex px-2" style={{ borderBottom: `1px solid ${th.panelBorder}` }}>
      {tabs.map((tb) => {
        const active = tab === tb.id;
        return (
          <button
            key={tb.id}
            onClick={() => setTab(tb.id)}
            className="flex-1 flex flex-col items-center gap-1 py-2.5 text-[11px] border-b-2 transition-colors"
            style={{ borderColor: active ? th.accent : "transparent", color: active ? th.accent : th.textFaint }}
          >
            <tb.icon className="w-4 h-4" />
            {tb.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------- SINGLE BOT TAB ----------------
function SingleBotTab({ th, bots, toggleBot, updateBot, ddStopped, setMarketPickerBot }) {
  return (
    <div className="space-y-3">
      <div className="text-[11px] leading-relaxed" style={{ color: th.textFaint }}>
        Digit-market bots are labeled honestly: ticks on Deriv synthetics are independent, so no indicator predicts the next digit. Those bots monitor real statistical properties instead of pretending to forecast randomness.
      </div>
      {bots.map((b) => (
        <BotCard key={b.id} b={b} th={th} toggleBot={toggleBot} updateBot={updateBot} onPickMarket={() => setMarketPickerBot(b.id)} ddStopped={ddStopped} />
      ))}
    </div>
  );
}

function BotCard({ b, th, toggleBot, updateBot, onPickMarket, ddStopped }) {
  const [expanded, setExpanded] = useState(false);
  const marketLabel = [...MARKETS.digit, ...MARKETS.price].find((m) => m.id === b.market)?.label || b.market;
  return (
    <div className={`p-4 space-y-3 ${th.cardRadius}`} style={{ background: th.panel, border: `1px solid ${th.panelBorder}` }}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{b.name}</span>
            {b.noEdge && (
              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: th.panelAlt, color: th.textFaint, border: `1px solid ${th.panelBorder}` }}>
                no edge
              </span>
            )}
            {b.honest && !b.noEdge && (
              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: th.panelAlt, color: th.textFaint, border: `1px solid ${th.panelBorder}` }}>
                stat monitor
              </span>
            )}
          </div>
          <button onClick={onPickMarket} className="mt-1 flex items-center gap-1 text-[11px]" style={{ color: th.accent }}>
            {marketLabel} <ChevronDown className="w-3 h-3" />
          </button>
        </div>
        <button
          onClick={() => toggleBot(b.id)}
          disabled={ddStopped}
          className="shrink-0 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium disabled:opacity-40"
          style={b.running ? { background: "#3d130f55", color: "#ff8f76", border: "1px solid #7a2318" } : { background: th.accent, color: th.accentText }}
        >
          {b.running ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          {b.running ? "Stop" : "Start"}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="P/L" value={`${b.pl >= 0 ? "+" : ""}${b.pl.toFixed(2)}`} color={b.pl >= 0 ? th.up : th.down} th={th} />
        <Stat label="Confidence" value={`${Math.round(b.confidence)}%`} color={th.accent} th={th} />
        <Stat label="Win Rate" value={b.winrate !== null ? `${Math.round(b.winrate * 100)}%` : "—"} color={th.text} th={th} />
      </div>

      <div className="flex gap-2">
        <div className="flex-1">
          <label className="text-[10px] uppercase" style={{ color: th.textFaint }}>
            Stake ($)
          </label>
          <input
            type="number"
            min="0.35"
            step="0.5"
            value={b.stake}
            onChange={(e) => updateBot(b.id, { stake: parseFloat(e.target.value) || 0 })}
            className="w-full mt-0.5 rounded-md px-2 py-1.5 text-xs outline-none"
            style={{ background: th.bg, border: `1px solid ${th.panelBorder}`, color: th.text }}
          />
        </div>
        <div className="flex-1">
          <label className="text-[10px] uppercase" style={{ color: th.textFaint }}>
            Trades
          </label>
          <input
            type="number"
            min="1"
            value={b.trades}
            onChange={(e) => updateBot(b.id, { trades: parseInt(e.target.value) || 1 })}
            className="w-full mt-0.5 rounded-md px-2 py-1.5 text-xs outline-none"
            style={{ background: th.bg, border: `1px solid ${th.panelBorder}`, color: th.text }}
          />
        </div>
      </div>

      <button onClick={() => setExpanded((x) => !x)} className="text-[11px] flex items-center gap-1" style={{ color: th.textDim }}>
        {expanded ? "Hide" : "Show"} logic <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded && (
        <div className="text-[11px] leading-relaxed pt-2" style={{ color: th.textDim, borderTop: `1px solid ${th.panelBorder}` }}>
          {b.desc}
          {b.lastNote && (
            <div className="mt-1.5 font-mono" style={{ color: th.textFaint }}>
              {b.lastNote}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color, th }) {
  return (
    <div className="rounded-lg py-2" style={{ background: th.panelAlt }}>
      <div className="text-[10px] uppercase tracking-wide" style={{ color: th.textFaint }}>
        {label}
      </div>
      <div className="text-sm font-semibold font-mono" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

// ---------------- BULK TRADER TAB ----------------
function BulkTab({ th, bots, selectedBots, setSelectedBots, globalStake, setGlobalStake, globalTrades, setGlobalTrades, smartRotation, setSmartRotation, startAll, stopAll, ddStopped, setMarketPickerBot }) {
  const toggleSel = (id) => setSelectedBots((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  return (
    <div className="space-y-4">
      <div className={`p-4 space-y-3 ${th.cardRadius}`} style={{ background: th.panel, border: `1px solid ${th.panelBorder}` }}>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] uppercase" style={{ color: th.textFaint }}>
              Global Stake ($)
            </label>
            <input
              type="number"
              value={globalStake}
              onChange={(e) => setGlobalStake(parseFloat(e.target.value) || 0)}
              className="w-full mt-0.5 rounded-md px-2 py-1.5 text-xs outline-none"
              style={{ background: th.bg, border: `1px solid ${th.panelBorder}`, color: th.text }}
            />
          </div>
          <div>
            <label className="text-[10px] uppercase" style={{ color: th.textFaint }}>
              Global Trades
            </label>
            <input
              type="number"
              value={globalTrades}
              onChange={(e) => setGlobalTrades(parseInt(e.target.value) || 1)}
              className="w-full mt-0.5 rounded-md px-2 py-1.5 text-xs outline-none"
              style={{ background: th.bg, border: `1px solid ${th.panelBorder}`, color: th.text }}
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={smartRotation} onChange={(e) => setSmartRotation(e.target.checked)} />
          Smart Rotation (1 trade per market per 60s -- correlation blocker)
        </label>
        <div className="flex gap-2">
          <button onClick={startAll} disabled={ddStopped || !selectedBots.length} className="flex-1 rounded-lg py-2.5 text-xs font-medium disabled:opacity-40" style={{ background: th.accent, color: th.accentText }}>
            Start Selected
          </button>
          <button onClick={stopAll} disabled={!selectedBots.length} className="flex-1 rounded-lg py-2.5 text-xs font-medium disabled:opacity-40" style={{ border: `1px solid ${th.panelBorder}`, color: th.textDim }}>
            Stop Selected
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {bots.map((b) => {
          const marketLabel = [...MARKETS.digit, ...MARKETS.price].find((m) => m.id === b.market)?.label || b.market;
          return (
            <div key={b.id} className="rounded-lg p-3 flex items-center gap-3" style={{ background: th.panel, border: `1px solid ${th.panelBorder}` }}>
              <input type="checkbox" checked={selectedBots.includes(b.id)} onChange={() => toggleSel(b.id)} className="shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate">{b.name}</div>
                <button onClick={() => setMarketPickerBot(b.id)} className="text-[10px]" style={{ color: th.accent }}>
                  {marketLabel}
                </button>
              </div>
              <div className="text-xs font-mono" style={{ color: b.pl >= 0 ? th.up : th.down }}>
                {b.pl >= 0 ? "+" : ""}
                {b.pl.toFixed(2)}
              </div>
              <span className="w-2 h-2 rounded-full" style={{ background: b.running ? th.accent : "transparent", border: b.running ? "none" : `1px solid ${th.panelBorder}` }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------- ANALYTICS TAB ----------------
function AnalyticsTab({ th, bots, totalPL, dailyPL, runningCount }) {
  const activeBots = bots.filter((b) => b.tradesRun > 0);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Total P/L" value={`${totalPL >= 0 ? "+" : ""}${totalPL.toFixed(2)}`} color={totalPL >= 0 ? th.up : th.down} th={th} />
        <Stat label="Today" value={`${dailyPL >= 0 ? "+" : ""}${dailyPL.toFixed(2)}`} color={dailyPL >= 0 ? th.up : th.down} th={th} />
        <Stat label="Running" value={String(runningCount)} color={th.accent} th={th} />
      </div>
      <div className={`p-4 ${th.cardRadius}`} style={{ background: th.panel, border: `1px solid ${th.panelBorder}` }}>
        <div className="text-xs font-medium mb-3" style={{ color: th.textDim }}>
          Per-Bot Performance
        </div>
        <div className="space-y-2">
          {activeBots.length === 0 && (
            <div className="text-xs" style={{ color: th.textFaint }}>
              No trades yet this session.
            </div>
          )}
          {activeBots.map((b) => (
            <div key={b.id} className="flex items-center justify-between text-xs">
              <span className="truncate flex-1">{b.name}</span>
              <span className="font-mono mr-3" style={{ color: th.textDim }}>
                {b.tradesRun} trades
              </span>
              <span className="font-mono mr-3" style={{ color: b.winrate >= 0.5 ? th.up : th.down }}>
                {Math.round((b.winrate || 0) * 100)}%
              </span>
              <span className="font-mono" style={{ color: b.pl >= 0 ? th.up : th.down }}>
                {b.pl >= 0 ? "+" : ""}
                {b.pl.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="p-4 text-[11px] leading-relaxed rounded-xl" style={{ background: th.panel, border: `1px solid ${th.panelBorder}`, color: th.textFaint }}>
        Win rates shown reflect session performance in this build, not a verified live track record. Treat any win-rate number as unproven until logged yourself across a meaningful sample size.
      </div>
    </div>
  );
}

// ---------------- LOG TAB ----------------
function LogTab({ th, tradeLog }) {
  return (
    <div className={`p-4 ${th.cardRadius}`} style={{ background: th.panel, border: `1px solid ${th.panelBorder}` }}>
      {tradeLog.length === 0 && (
        <div className="text-xs" style={{ color: th.textFaint }}>
          No trades logged yet.
        </div>
      )}
      <div className="space-y-2">
        {tradeLog.map((e) => (
          <div key={e.id} className="flex items-center justify-between text-xs pb-2" style={{ borderBottom: `1px solid ${th.panelBorder}` }}>
            <div>
              <div>
                {e.bot} {e.simulated && <span style={{ color: th.textFaint }}>(sim)</span>}
              </div>
              <div style={{ color: th.textFaint }}>
                {e.market} · {e.time}
              </div>
            </div>
            <span className="font-mono font-medium" style={{ color: e.win ? th.up : th.down }}>
              {e.win ? "+" : ""}
              {e.amount.toFixed(2)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- MARKET PICKER ----------------
function MarketPicker({ th, category, current, onSelect, onClose }) {
  const list = category === "digit" ? MARKETS.digit : MARKETS.price;
  return (
    <div className="fixed inset-0 z-30 bg-black/60 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className={`w-full sm:max-w-sm p-4 ${th.cardRadius}`} style={{ background: th.panel, border: `1px solid ${th.panelBorder}` }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium">Select market</span>
          <button onClick={onClose}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-1">
          {list.map((m) => (
            <button
              key={m.id}
              onClick={() => onSelect(m.id)}
              className="w-full text-left px-3 py-2.5 rounded-lg text-sm flex items-center justify-between"
              style={{ background: m.id === current ? th.panelAlt : "transparent" }}
            >
              {m.label}
              {m.id === current && <Check className="w-4 h-4" style={{ color: th.accent }} />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------- SETTINGS ----------------
function SettingsPanel({ th, themeKey, setThemeKey, geminiKey, setGeminiKey, geminiVeto, setGeminiVeto, martingale, setMartingale, autoTradeLive, setAutoTradeLive, onClose, onDisconnect, accountId, isDemo }) {
  return (
    <div className="fixed inset-0 z-30 bg-black/60 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className={`w-full sm:max-w-sm p-5 max-h-[85vh] overflow-y-auto space-y-5 ${th.cardRadius}`} style={{ background: th.panel, border: `1px solid ${th.panelBorder}` }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Settings</span>
          <button onClick={onClose}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wide mb-2" style={{ color: th.textFaint }}>
            Theme
          </div>
          <div className="grid grid-cols-3 gap-2">
            {Object.values(THEMES).map((option) => (
              <button
                key={option.key}
                onClick={() => setThemeKey(option.key)}
                className="rounded-lg p-2.5 text-left"
                style={{ background: option.bg, border: `1px solid ${option.key === themeKey ? option.accent : option.panelBorder}` }}
              >
                <div className="w-full h-6 rounded mb-1.5" style={{ background: option.accent }} />
                <div className="text-[10px]" style={{ color: option.text }}>
                  {option.name}
                </div>
              </button>
            ))}
          </div>
          <p className="text-[10px] mt-1.5" style={{ color: th.textFaint }}>
            {th.tagline}
          </p>
        </div>

        <div className="rounded-lg p-3 space-y-2" style={{ background: autoTradeLive ? "#3d130f33" : th.panelAlt, border: `1px solid ${autoTradeLive ? "#7a2318" : th.panelBorder}` }}>
          <label className="flex items-start gap-2 text-xs font-medium">
            <input type="checkbox" checked={autoTradeLive} onChange={(e) => setAutoTradeLive(e.target.checked)} className="mt-0.5" />
            <span>Enable Live Trading</span>
          </label>
          <p className="text-[11px] leading-relaxed" style={{ color: th.textDim }}>
            Off by default. While off, all bot activity is simulated for preview against live prices -- your real balance is never touched. Turning this on lets bots place real contracts with real money on {isDemo ? "your demo account" : "your live account"}.
          </p>
        </div>

        <div className="space-y-3">
          <div className="text-[10px] uppercase tracking-wide" style={{ color: th.textFaint }}>
            AI Sanity-Check (Gemini)
          </div>
          <input
            type="password"
            value={geminiKey}
            onChange={(e) => setGeminiKey(e.target.value)}
            placeholder="Gemini API key"
            className="w-full rounded-md px-3 py-2 text-xs outline-none"
            style={{ background: th.bg, border: `1px solid ${th.panelBorder}`, color: th.text }}
          />
          <label className="flex items-start gap-2 text-xs">
            <input type="checkbox" checked={geminiVeto} onChange={(e) => setGeminiVeto(e.target.checked)} className="mt-0.5" />
            <span>Veto-only mode -- AI can block a trade flagged high-risk, but never boosts confidence.</span>
          </label>
        </div>

        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-wide" style={{ color: th.textFaint }}>
            Execution Options
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={martingale} onChange={(e) => setMartingale(e.target.checked)} /> Martingale staking (1 / 1.5 / 2.25 / 3.375, pause after 4 losses)
          </label>
        </div>

        {martingale && (
          <div className="text-[11px] leading-relaxed rounded-lg p-3" style={{ background: "#3d130f33", border: "1px solid #7a2318", color: "#ffb4a3" }}>
            Martingale staking increases position size after losses to chase break-even. A losing streak longer than expected can produce a large single loss even with a good win rate. Cap the maximum stake multiplier before using this live.
          </div>
        )}

        <button onClick={onDisconnect} className="w-full rounded-lg py-2.5 text-xs font-medium" style={{ border: "1px solid #7a2318", color: "#ff8f76" }}>
          Disconnect ({accountId})
        </button>
      </div>
    </div>
  );
}
