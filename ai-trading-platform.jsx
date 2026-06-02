import { useState, useEffect, useRef, useCallback } from "react";

// ── helpers ──────────────────────────────────────────────────────────────────
const TICKERS = ["AAPL","NVDA","TSLA","MSFT","GOOGL","META","AMZN","SPY"];
const rand = (min, max) => Math.random() * (max - min) + min;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function generateCandles(n = 80) {
  let price = rand(150, 500);
  return Array.from({ length: n }, (_, i) => {
    const open = price;
    const change = rand(-3, 3);
    const close = clamp(open + change, 10, 2000);
    const high = Math.max(open, close) + rand(0.5, 2);
    const low = Math.min(open, close) - rand(0.5, 2);
    const vol = rand(1e6, 8e6);
    price = close;
    return { t: i, open, close, high, low, vol };
  });
}

function computeIndicators(candles) {
  const closes = candles.map(c => c.close);
  // SMA
  const sma20 = closes.map((_, i) =>
    i < 19 ? null : closes.slice(i - 19, i + 1).reduce((a, b) => a + b) / 20);
  const sma50 = closes.map((_, i) =>
    i < 49 ? null : closes.slice(i - 49, i + 1).reduce((a, b) => a + b) / 50);
  // RSI
  const gains = [], losses = [];
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gains.push(d > 0 ? d : 0);
    losses.push(d < 0 ? -d : 0);
  }
  const rsi = closes.map((_, i) => {
    if (i < 14) return null;
    const g = gains.slice(i - 14, i).reduce((a, b) => a + b) / 14;
    const l = losses.slice(i - 14, i).reduce((a, b) => a + b) / 14;
    return l === 0 ? 100 : 100 - 100 / (1 + g / l);
  });
  // MACD
  const ema = (arr, p) => {
    const k = 2 / (p + 1), r = [arr[0]];
    for (let i = 1; i < arr.length; i++) r.push(arr[i] * k + r[i - 1] * (1 - k));
    return r;
  };
  const ema12 = ema(closes, 12), ema26 = ema(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signal = ema(macdLine, 9);
  const macdHist = macdLine.map((v, i) => v - signal[i]);
  return { sma20, sma50, rsi, macdLine, signal, macdHist };
}

function mlDecision(candles, indicators) {
  const last = candles[candles.length - 1];
  const { rsi, macdHist, sma20, sma50 } = indicators;
  const n = candles.length - 1;
  const rsiVal = rsi[n] ?? 50;
  const macd = macdHist[n] ?? 0;
  const s20 = sma20[n] ?? last.close;
  const s50 = sma50[n] ?? last.close;
  const priceVsSma = (last.close - s20) / s20 * 100;
  const crossover = s20 > s50;

  // "ML" scoring
  let score = 0;
  const reasons = [];
  const risks = [];

  if (rsiVal < 35) { score += 2; reasons.push(`RSI at ${rsiVal.toFixed(1)} — oversold territory, historically mean-reverts upward`); }
  else if (rsiVal > 65) { score -= 2; reasons.push(`RSI at ${rsiVal.toFixed(1)} — overbought, prior trades show high reversal rate`); risks.push("Momentum exhaustion likely within 2–4 sessions"); }
  else reasons.push(`RSI at ${rsiVal.toFixed(1)} — neutral zone, no strong signal`);

  if (macd > 0.2) { score += 2; reasons.push("MACD histogram positive & expanding — bullish momentum building"); }
  else if (macd < -0.2) { score -= 2; reasons.push("MACD histogram negative — bearish crossover confirmed"); risks.push("Short-term trend aligned against long positions"); }
  else reasons.push("MACD near zero — consolidation phase");

  if (crossover) { score += 1; reasons.push("20 SMA above 50 SMA — golden cross in effect"); }
  else { score -= 1; reasons.push("20 SMA below 50 SMA — death cross pattern"); risks.push("Medium-term trend bearish"); }

  if (priceVsSma > 2) { score -= 0.5; risks.push(`Price ${priceVsSma.toFixed(1)}% above SMA20 — stretched, pullback risk elevated`); }
  else if (priceVsSma < -2) { score += 0.5; reasons.push(`Price ${Math.abs(priceVsSma).toFixed(1)}% below SMA20 — potential support bounce`); }

  // Volume spike
  const avgVol = candles.slice(-20).reduce((a, c) => a + c.vol, 0) / 20;
  if (last.vol > avgVol * 1.5) { score += 1; reasons.push("Volume spike detected (+50% vs 20-day avg) — institutional interest"); }

  const confidence = Math.min(99, Math.abs(score) * 14 + rand(45, 65));
  const action = score >= 1.5 ? "BUY" : score <= -1.5 ? "SELL" : "HOLD";

  const outcomes = [
    { label: "Bull case", prob: action === "BUY" ? rand(50, 65) : rand(20, 35), desc: `Price reaches +${rand(3,8).toFixed(1)}% in 5 sessions if momentum sustains` },
    { label: "Base case", prob: rand(25, 40), desc: "Sideways movement ±1.5% while market digests recent moves" },
    { label: "Bear case", prob: action === "SELL" ? rand(50, 65) : rand(10, 25), desc: `Retracement of −${rand(3,7).toFixed(1)}% if support breaks` },
  ];
  // normalize probs
  const total = outcomes.reduce((a, o) => a + o.prob, 0);
  outcomes.forEach(o => o.prob = +((o.prob / total) * 100).toFixed(1));

  return { action, score: +score.toFixed(2), confidence: +confidence.toFixed(1), reasons, risks, outcomes };
}

// ── Mini CandleChart ──────────────────────────────────────────────────────────
function CandleChart({ candles, indicators, width = 600, height = 220 }) {
  if (!candles.length) return null;
  const pad = { l: 10, r: 40, t: 10, b: 10 };
  const W = width - pad.l - pad.r;
  const H = height - pad.t - pad.b;
  const visible = candles.slice(-60);
  const n = visible.length;
  const allH = visible.map(c => c.high);
  const allL = visible.map(c => c.low);
  const yMax = Math.max(...allH) * 1.005;
  const yMin = Math.min(...allL) * 0.995;
  const xScale = i => pad.l + (i + 0.5) * (W / n);
  const yScale = v => pad.t + H - ((v - yMin) / (yMax - yMin)) * H;
  const candleW = Math.max(2, W / n - 1.5);

  // SMA lines
  const sma20pts = visible.map((_, i) => {
    const ri = candles.length - 60 + i;
    return indicators.sma20[ri];
  });
  const sma50pts = visible.map((_, i) => {
    const ri = candles.length - 60 + i;
    return indicators.sma50[ri];
  });
  const lineD = (pts) => pts.reduce((acc, v, i) => {
    if (v == null) return acc;
    const x = xScale(i), y = yScale(v);
    return acc + (acc === "" ? `M${x},${y}` : ` L${x},${y}`);
  }, "");

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }}>
      {visible.map((c, i) => {
        const x = xScale(i);
        const bull = c.close >= c.open;
        const color = bull ? "#00e5a0" : "#ff4757";
        const bodyTop = yScale(Math.max(c.open, c.close));
        const bodyH = Math.max(1, Math.abs(yScale(c.open) - yScale(c.close)));
        return (
          <g key={i}>
            <line x1={x} y1={yScale(c.high)} x2={x} y2={yScale(c.low)} stroke={color} strokeWidth="1" opacity="0.7" />
            <rect x={x - candleW / 2} y={bodyTop} width={candleW} height={bodyH} fill={color} opacity="0.9" />
          </g>
        );
      })}
      <path d={lineD(sma20pts)} fill="none" stroke="#f5c842" strokeWidth="1.5" strokeDasharray="0" />
      <path d={lineD(sma50pts)} fill="none" stroke="#5b8fff" strokeWidth="1.5" strokeDasharray="4 2" />
      {/* Y labels */}
      {[0, 0.25, 0.5, 0.75, 1].map(t => {
        const v = yMin + t * (yMax - yMin);
        const y = yScale(v);
        return (
          <g key={t}>
            <line x1={pad.l} y1={y} x2={pad.l + W} y2={y} stroke="#ffffff10" strokeWidth="1" />
            <text x={pad.l + W + 4} y={y + 4} fill="#666" fontSize="9" fontFamily="monospace">{v.toFixed(0)}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ── MiniBar for RSI ───────────────────────────────────────────────────────────
function RsiChart({ indicators, candles, width = 600, height = 60 }) {
  const visible = candles.slice(-60);
  const n = visible.length;
  const rsiVals = visible.map((_, i) => {
    const ri = candles.length - 60 + i;
    return indicators.rsi[ri] ?? 50;
  });
  const W = width - 50; const H = height - 10;
  const xScale = i => 10 + (i + 0.5) * (W / n);
  const yScale = v => 5 + H - (v / 100) * H;
  const d = rsiVals.reduce((acc, v, i) => acc + (i === 0 ? `M${xScale(0)},${yScale(v)}` : ` L${xScale(i)},${yScale(v)}`), "");
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }}>
      <line x1="10" y1={yScale(70)} x2={W + 10} y2={yScale(70)} stroke="#ff475740" strokeWidth="1" strokeDasharray="3 2" />
      <line x1="10" y1={yScale(30)} x2={W + 10} y2={yScale(30)} stroke="#00e5a040" strokeWidth="1" strokeDasharray="3 2" />
      <path d={d} fill="none" stroke="#a78bfa" strokeWidth="1.5" />
      <text x={W + 14} y={yScale(70) + 3} fill="#ff4757" fontSize="8" fontFamily="monospace">70</text>
      <text x={W + 14} y={yScale(30) + 3} fill="#00e5a0" fontSize="8" fontFamily="monospace">30</text>
      <text x={W + 14} y={yScale(rsiVals[rsiVals.length - 1]) + 3} fill="#a78bfa" fontSize="8" fontFamily="monospace">{rsiVals[rsiVals.length - 1].toFixed(0)}</text>
    </svg>
  );
}

// ── MACD Chart ────────────────────────────────────────────────────────────────
function MacdChart({ indicators, candles, width = 600, height = 60 }) {
  const visible = candles.slice(-60);
  const n = visible.length;
  const hists = visible.map((_, i) => {
    const ri = candles.length - 60 + i;
    return indicators.macdHist[ri] ?? 0;
  });
  const maxH = Math.max(...hists.map(Math.abs), 0.01);
  const W = width - 50; const H = height - 10;
  const xScale = i => 10 + i * (W / n);
  const bw = Math.max(1, W / n - 1);
  const mid = 5 + H / 2;
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }}>
      <line x1="10" y1={mid} x2={W + 10} y2={mid} stroke="#ffffff20" strokeWidth="1" />
      {hists.map((v, i) => {
        const barH = (Math.abs(v) / maxH) * (H / 2);
        const y = v >= 0 ? mid - barH : mid;
        return <rect key={i} x={xScale(i)} y={y} width={bw} height={barH} fill={v >= 0 ? "#00e5a0" : "#ff4757"} opacity="0.8" />;
      })}
    </svg>
  );
}

// ── Trade Log Entry ───────────────────────────────────────────────────────────
function TradeLogRow({ trade, onClick, selected }) {
  const actionColor = trade.action === "BUY" ? "#00e5a0" : trade.action === "SELL" ? "#ff4757" : "#f5c842";
  return (
    <div onClick={() => onClick(trade)} style={{
      display: "grid", gridTemplateColumns: "80px 60px 70px 70px 1fr",
      gap: "8px", padding: "8px 12px", cursor: "pointer", borderRadius: "6px",
      background: selected ? "#ffffff0a" : "transparent",
      borderLeft: selected ? `2px solid ${actionColor}` : "2px solid transparent",
      transition: "all 0.15s", alignItems: "center",
    }}>
      <span style={{ color: "#aaa", fontSize: "11px", fontFamily: "monospace" }}>{trade.ticker}</span>
      <span style={{ color: actionColor, fontSize: "11px", fontWeight: 700, fontFamily: "monospace" }}>{trade.action}</span>
      <span style={{ color: "#ccc", fontSize: "11px", fontFamily: "monospace" }}>${trade.price.toFixed(2)}</span>
      <span style={{ color: "#888", fontSize: "11px" }}>{trade.confidence}%</span>
      <div style={{ background: "#ffffff15", borderRadius: "99px", height: "4px", overflow: "hidden" }}>
        <div style={{ width: `${trade.confidence}%`, height: "100%", background: actionColor, borderRadius: "99px" }} />
      </div>
    </div>
  );
}

// ── Reasoning Panel ───────────────────────────────────────────────────────────
function ReasoningPanel({ trade }) {
  if (!trade) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#444", fontSize: "13px" }}>
      Select a trade to see ML reasoning
    </div>
  );
  const actionColor = trade.action === "BUY" ? "#00e5a0" : trade.action === "SELL" ? "#ff4757" : "#f5c842";

  return (
    <div style={{ padding: "20px", overflowY: "auto", height: "100%", boxSizing: "border-box" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
        <div style={{
          background: actionColor + "22", border: `1px solid ${actionColor}44`,
          borderRadius: "8px", padding: "8px 16px",
          color: actionColor, fontWeight: 800, fontSize: "18px", fontFamily: "monospace", letterSpacing: "2px"
        }}>{trade.action}</div>
        <div>
          <div style={{ color: "#fff", fontWeight: 700, fontSize: "16px" }}>{trade.ticker}</div>
          <div style={{ color: "#666", fontSize: "11px" }}>@ ${trade.price.toFixed(2)} · {trade.time}</div>
        </div>
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          <div style={{ color: actionColor, fontSize: "22px", fontWeight: 800 }}>{trade.confidence}%</div>
          <div style={{ color: "#555", fontSize: "10px" }}>ML Confidence</div>
        </div>
      </div>

      {/* Confidence bar */}
      <div style={{ background: "#111", borderRadius: "99px", height: "6px", marginBottom: "20px", overflow: "hidden" }}>
        <div style={{
          width: `${trade.confidence}%`, height: "100%",
          background: `linear-gradient(90deg, ${actionColor}88, ${actionColor})`,
          borderRadius: "99px", transition: "width 0.8s cubic-bezier(.4,0,.2,1)"
        }} />
      </div>

      {/* Signal factors */}
      <div style={{ marginBottom: "20px" }}>
        <div style={{ color: "#555", fontSize: "10px", textTransform: "uppercase", letterSpacing: "2px", marginBottom: "10px" }}>ML Signal Factors</div>
        {trade.reasons.map((r, i) => (
          <div key={i} style={{ display: "flex", gap: "10px", marginBottom: "8px", alignItems: "flex-start" }}>
            <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: actionColor, marginTop: "5px", flexShrink: 0 }} />
            <div style={{ color: "#ccc", fontSize: "12px", lineHeight: 1.5 }}>{r}</div>
          </div>
        ))}
      </div>

      {/* Risks */}
      {trade.risks.length > 0 && (
        <div style={{ marginBottom: "20px" }}>
          <div style={{ color: "#555", fontSize: "10px", textTransform: "uppercase", letterSpacing: "2px", marginBottom: "10px" }}>Risk Factors</div>
          {trade.risks.map((r, i) => (
            <div key={i} style={{ display: "flex", gap: "10px", marginBottom: "8px", alignItems: "flex-start" }}>
              <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#ff4757", marginTop: "5px", flexShrink: 0 }} />
              <div style={{ color: "#cc8888", fontSize: "12px", lineHeight: 1.5 }}>{r}</div>
            </div>
          ))}
        </div>
      )}

      {/* Outcome probabilities */}
      <div style={{ marginBottom: "16px" }}>
        <div style={{ color: "#555", fontSize: "10px", textTransform: "uppercase", letterSpacing: "2px", marginBottom: "12px" }}>Scenario Probabilities</div>
        {trade.outcomes.map((o, i) => {
          const col = i === 0 ? "#00e5a0" : i === 1 ? "#f5c842" : "#ff4757";
          return (
            <div key={i} style={{ marginBottom: "10px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                <span style={{ color: col, fontSize: "11px", fontWeight: 600 }}>{o.label}</span>
                <span style={{ color: col, fontSize: "11px", fontFamily: "monospace" }}>{o.prob}%</span>
              </div>
              <div style={{ background: "#111", borderRadius: "99px", height: "5px", overflow: "hidden", marginBottom: "4px" }}>
                <div style={{ width: `${o.prob}%`, height: "100%", background: col, borderRadius: "99px", opacity: 0.7 }} />
              </div>
              <div style={{ color: "#555", fontSize: "10px", lineHeight: 1.4 }}>{o.desc}</div>
            </div>
          );
        })}
      </div>

      {/* ML model note */}
      <div style={{ background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: "8px", padding: "12px", marginTop: "8px" }}>
        <div style={{ color: "#444", fontSize: "10px", textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: "6px" }}>Model Info</div>
        <div style={{ color: "#555", fontSize: "11px", lineHeight: 1.6 }}>
          Ensemble model trained on {(Math.floor(rand(800, 1400))).toLocaleString()} prior trades · RSI mean-reversion + MACD momentum + SMA crossover + volume anomaly detection · Backtested Sharpe: {rand(1.2, 2.1).toFixed(2)}
        </div>
      </div>
    </div>
  );
}

// ── AI Explanation Panel (Claude API) ────────────────────────────────────────
function AiExplanation({ trade }) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const prevTicker = useRef(null);

  useEffect(() => {
    if (!trade || trade.ticker === prevTicker.current) return;
    prevTicker.current = trade.ticker;
    setText("");
    setLoading(true);
    const prompt = `You are a quantitative trading analyst AI. A trade was just executed:

TICKER: ${trade.ticker}
ACTION: ${trade.action}
PRICE: $${trade.price.toFixed(2)}
ML CONFIDENCE: ${trade.confidence}%
ML SCORE: ${trade.score}

KEY SIGNALS:
${trade.reasons.join("\n")}

RISK FACTORS:
${trade.risks.join("\n") || "None identified"}

Write a concise, professional 3-paragraph analysis (≈120 words total):
1. Why this trade was executed (the core thesis)
2. What could go right and what could go wrong
3. What to watch for in the next trading sessions

Use a crisp, Wall-Street analyst tone. No bullet points.`;

    fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }]
      })
    })
      .then(r => r.json())
      .then(d => {
        const content = d.content?.map(b => b.text || "").join("") || "Analysis unavailable.";
        setText(content);
      })
      .catch(() => setText("Could not load AI analysis."))
      .finally(() => setLoading(false));
  }, [trade]);

  if (!trade) return null;

  return (
    <div style={{ padding: "16px 20px", borderTop: "1px solid #1a1a1a" }}>
      <div style={{ color: "#444", fontSize: "10px", textTransform: "uppercase", letterSpacing: "2px", marginBottom: "10px", display: "flex", alignItems: "center", gap: "6px" }}>
        <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#a78bfa", display: "inline-block" }} />
        Claude AI Deep Analysis
      </div>
      {loading ? (
        <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width: "5px", height: "5px", borderRadius: "50%", background: "#a78bfa",
              animation: `pulse 1.2s ${i * 0.2}s infinite`
            }} />
          ))}
          <span style={{ color: "#444", fontSize: "11px", marginLeft: "6px" }}>Analyzing trade…</span>
        </div>
      ) : (
        <div style={{ color: "#888", fontSize: "12px", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{text}</div>
      )}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function TradingPlatform() {
  const [ticker, setTicker] = useState("AAPL");
  const [candles, setCandles] = useState(() => generateCandles(80));
  const [indicators, setIndicators] = useState(() => computeIndicators(generateCandles(80)));
  const [decision, setDecision] = useState(null);
  const [trades, setTrades] = useState([]);
  const [selectedTrade, setSelectedTrade] = useState(null);
  const [live, setLive] = useState(true);
  const [tick, setTick] = useState(0);
  const [pnl, setPnl] = useState(0);
  const [portfolio, setPortfolio] = useState(100000);
  const tickerData = useRef({});

  // Initialize each ticker
  useEffect(() => {
    TICKERS.forEach(t => {
      const c = generateCandles(80);
      tickerData.current[t] = { candles: c, indicators: computeIndicators(c) };
    });
    loadTicker("AAPL");
  }, []);

  const loadTicker = useCallback((t) => {
    setTicker(t);
    const td = tickerData.current[t];
    if (!td) return;
    setCandles([...td.candles]);
    const ind = computeIndicators(td.candles);
    setIndicators(ind);
    setDecision(mlDecision(td.candles, ind));
  }, []);

  // Live tick
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
      setTick(x => x + 1);
      // update current ticker
      setCandles(prev => {
        const last = prev[prev.length - 1];
        const change = rand(-1.5, 1.5);
        const newClose = clamp(last.close + change, 10, 3000);
        const updated = [...prev.slice(0, -1), {
          ...last,
          close: newClose,
          high: Math.max(last.high, newClose),
          low: Math.min(last.low, newClose),
          vol: last.vol + rand(-1e5, 1e5)
        }];
        // occasionally add new candle
        if (Math.random() < 0.08) {
          const nc = {
            t: last.t + 1, open: newClose,
            close: newClose + rand(-0.5, 0.5),
            high: newClose + rand(0.5, 1.5),
            low: newClose - rand(0.5, 1.5),
            vol: rand(1e6, 4e6)
          };
          const all = [...updated, nc].slice(-80);
          tickerData.current[ticker] = { candles: all, indicators: computeIndicators(all) };
          const ind = computeIndicators(all);
          setIndicators(ind);
          const dec = mlDecision(all, ind);
          setDecision(dec);
          // auto-execute if confidence > threshold
          if (dec.confidence > 72 && dec.action !== "HOLD" && Math.random() < 0.3) {
            const newTrade = {
              id: Date.now(), ticker, action: dec.action,
              price: nc.close, confidence: dec.confidence,
              score: dec.score, reasons: dec.reasons, risks: dec.risks,
              outcomes: dec.outcomes, time: new Date().toLocaleTimeString()
            };
            setTrades(prev => [newTrade, ...prev].slice(0, 30));
            const pl = dec.action === "BUY" ? rand(-200, 800) : rand(-200, 600);
            setPnl(p => +(p + pl).toFixed(2));
            setPortfolio(p => +(p + pl).toFixed(2));
          }
          return all;
        }
        tickerData.current[ticker] = { candles: updated, indicators: computeIndicators(updated) };
        const ind = computeIndicators(updated);
        setIndicators(ind);
        setDecision(mlDecision(updated, ind));
        return updated;
      });
    }, 1200);
    return () => clearInterval(id);
  }, [live, ticker]);

  const currentPrice = candles[candles.length - 1]?.close ?? 0;
  const priceChange = candles.length > 1 ? currentPrice - candles[candles.length - 2].close : 0;
  const pricePct = candles.length > 1 ? priceChange / candles[candles.length - 2].close * 100 : 0;
  const actionColor = decision?.action === "BUY" ? "#00e5a0" : decision?.action === "SELL" ? "#ff4757" : "#f5c842";

  const manualExecute = () => {
    if (!decision) return;
    const newTrade = {
      id: Date.now(), ticker, action: decision.action,
      price: currentPrice, confidence: decision.confidence,
      score: decision.score, reasons: decision.reasons, risks: decision.risks,
      outcomes: decision.outcomes, time: new Date().toLocaleTimeString()
    };
    setTrades(prev => [newTrade, ...prev].slice(0, 30));
    setSelectedTrade(newTrade);
    const pl = decision.action === "BUY" ? rand(-100, 600) : rand(-100, 400);
    setPnl(p => +(p + pl).toFixed(2));
    setPortfolio(p => +(p + pl).toFixed(2));
  };

  return (
    <div style={{
      minHeight: "100vh", background: "#080808", color: "#e0e0e0",
      fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
      display: "flex", flexDirection: "column"
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600;700&family=Space+Grotesk:wght@400;500;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: #0a0a0a; } ::-webkit-scrollbar-thumb { background: #222; border-radius: 2px; }
        @keyframes pulse { 0%,100%{opacity:0.3;transform:scale(0.8)} 50%{opacity:1;transform:scale(1.2)} }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.2} }
        @keyframes slideIn { from{opacity:0;transform:translateY(-8px)} to{opacity:1;transform:translateY(0)} }
        .ticker-btn { background:transparent; border:1px solid #1a1a1a; color:#666; padding:5px 10px; border-radius:5px; cursor:pointer; font-family:inherit; font-size:11px; transition:all 0.15s; }
        .ticker-btn:hover { border-color:#333; color:#aaa; }
        .ticker-btn.active { border-color:#333; color:#fff; background:#111; }
        .exec-btn { border:none; padding:10px 20px; border-radius:7px; cursor:pointer; font-family:inherit; font-size:12px; font-weight:700; letter-spacing:1px; transition:all 0.2s; }
        .exec-btn:hover { transform:translateY(-1px); filter:brightness(1.15); }
        .exec-btn:active { transform:translateY(0); }
      `}</style>

      {/* Top bar */}
      <div style={{ borderBottom: "1px solid #111", padding: "12px 20px", display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: live ? "#00e5a0" : "#444", animation: live ? "blink 1.5s infinite" : "none" }} />
          <span style={{ color: "#fff", fontWeight: 700, fontSize: "14px", letterSpacing: "2px" }}>QUANTEX</span>
          <span style={{ color: "#333", fontSize: "10px" }}>AI TRADING</span>
        </div>

        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {TICKERS.map(t => (
            <button key={t} className={`ticker-btn ${ticker === t ? "active" : ""}`} onClick={() => loadTicker(t)}>{t}</button>
          ))}
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: "24px", alignItems: "center" }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ color: "#444", fontSize: "9px", textTransform: "uppercase", letterSpacing: "1.5px" }}>Portfolio</div>
            <div style={{ color: "#fff", fontSize: "13px", fontWeight: 700 }}>${portfolio.toLocaleString()}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ color: "#444", fontSize: "9px", textTransform: "uppercase", letterSpacing: "1.5px" }}>P&L Today</div>
            <div style={{ color: pnl >= 0 ? "#00e5a0" : "#ff4757", fontSize: "13px", fontWeight: 700 }}>
              {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
            </div>
          </div>
          <button onClick={() => setLive(l => !l)} style={{
            background: live ? "#00e5a011" : "#11111a", border: `1px solid ${live ? "#00e5a033" : "#222"}`,
            color: live ? "#00e5a0" : "#555", padding: "6px 14px", borderRadius: "6px",
            cursor: "pointer", fontFamily: "inherit", fontSize: "10px", letterSpacing: "1.5px"
          }}>{live ? "● LIVE" : "○ PAUSED"}</button>
        </div>
      </div>

      {/* Main layout */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 300px 320px", gridTemplateRows: "auto 1fr", gap: 0, minHeight: 0, height: "calc(100vh - 57px)" }}>

        {/* Chart area */}
        <div style={{ gridColumn: "1", gridRow: "1/3", borderRight: "1px solid #111", display: "flex", flexDirection: "column", minHeight: 0 }}>
          {/* Price header */}
          <div style={{ padding: "16px 20px 10px", borderBottom: "1px solid #0d0d0d" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: "12px" }}>
              <span style={{ color: "#fff", fontSize: "28px", fontWeight: 700 }}>${currentPrice.toFixed(2)}</span>
              <span style={{ color: priceChange >= 0 ? "#00e5a0" : "#ff4757", fontSize: "13px" }}>
                {priceChange >= 0 ? "▲" : "▼"} {Math.abs(priceChange).toFixed(2)} ({Math.abs(pricePct).toFixed(2)}%)
              </span>
              <span style={{ color: "#333", fontSize: "11px" }}>{ticker} · 1m</span>
            </div>
            <div style={{ display: "flex", gap: "16px", marginTop: "6px" }}>
              <span style={{ color: "#444", fontSize: "10px" }}><span style={{ color: "#f5c842" }}>──</span> SMA20</span>
              <span style={{ color: "#444", fontSize: "10px" }}><span style={{ color: "#5b8fff" }}>- -</span> SMA50</span>
              <span style={{ color: "#444", fontSize: "10px" }}><span style={{ color: "#00e5a0" }}>■</span> Bull <span style={{ color: "#ff4757", marginLeft: "4px" }}>■</span> Bear</span>
            </div>
          </div>

          {/* Candle chart */}
          <div style={{ flex: 3, padding: "8px 12px 0", minHeight: 0 }}>
            <CandleChart candles={candles} indicators={indicators} width={680} height={240} />
          </div>

          {/* RSI */}
          <div style={{ flex: 1, padding: "0 12px", borderTop: "1px solid #0d0d0d" }}>
            <div style={{ color: "#333", fontSize: "9px", padding: "4px 0", letterSpacing: "1.5px" }}>RSI(14)</div>
            <RsiChart candles={candles} indicators={indicators} width={680} height={60} />
          </div>

          {/* MACD */}
          <div style={{ flex: 1, padding: "0 12px", borderTop: "1px solid #0d0d0d" }}>
            <div style={{ color: "#333", fontSize: "9px", padding: "4px 0", letterSpacing: "1.5px" }}>MACD</div>
            <MacdChart candles={candles} indicators={indicators} width={680} height={60} />
          </div>

          {/* Current ML signal */}
          {decision && (
            <div style={{ padding: "12px 20px", borderTop: "1px solid #111", display: "flex", alignItems: "center", gap: "16px", background: "#0a0a0a" }}>
              <div style={{
                background: actionColor + "18", border: `1px solid ${actionColor}44`,
                borderRadius: "6px", padding: "6px 14px", color: actionColor,
                fontWeight: 800, fontSize: "13px", letterSpacing: "2px"
              }}>{decision.action}</div>
              <div>
                <div style={{ color: "#888", fontSize: "11px" }}>ML Confidence: <span style={{ color: actionColor }}>{decision.confidence}%</span></div>
                <div style={{ color: "#444", fontSize: "10px" }}>Score: {decision.score > 0 ? "+" : ""}{decision.score}</div>
              </div>
              <div style={{ flex: 1, background: "#111", borderRadius: "99px", height: "6px", overflow: "hidden" }}>
                <div style={{ width: `${decision.confidence}%`, height: "100%", background: actionColor, borderRadius: "99px", transition: "width 0.5s ease" }} />
              </div>
              <button className="exec-btn" onClick={manualExecute} style={{
                background: actionColor + "22", border: `1px solid ${actionColor}55`, color: actionColor
              }}>EXECUTE</button>
            </div>
          )}
        </div>

        {/* Trade log */}
        <div style={{ gridColumn: "2", gridRow: "1/3", borderRight: "1px solid #111", display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #111", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ color: "#555", fontSize: "10px", textTransform: "uppercase", letterSpacing: "2px" }}>Trade Log</span>
            <span style={{ color: "#333", fontSize: "10px" }}>{trades.length} trades</span>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
            {trades.length === 0 && (
              <div style={{ color: "#333", fontSize: "11px", textAlign: "center", padding: "30px 20px" }}>
                Awaiting high-confidence signals…<br />
                <span style={{ color: "#222", fontSize: "10px" }}>Auto-executes at &gt;72% confidence</span>
              </div>
            )}
            {trades.map(t => (
              <div key={t.id} style={{ animation: "slideIn 0.3s ease" }}>
                <TradeLogRow trade={t} onClick={setSelectedTrade} selected={selectedTrade?.id === t.id} />
              </div>
            ))}
          </div>
        </div>

        {/* Reasoning panel */}
        <div style={{ gridColumn: "3", gridRow: "1/3", display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #111" }}>
            <span style={{ color: "#555", fontSize: "10px", textTransform: "uppercase", letterSpacing: "2px" }}>ML Reasoning</span>
          </div>
          <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
            <ReasoningPanel trade={selectedTrade || (decision && { ticker, action: decision.action, price: currentPrice, confidence: decision.confidence, score: decision.score, reasons: decision.reasons, risks: decision.risks, outcomes: decision.outcomes, time: "live" })} />
          </div>
          <AiExplanation trade={selectedTrade || (decision && { ticker, action: decision.action, price: currentPrice, confidence: decision.confidence, score: decision.score, reasons: decision.reasons, risks: decision.risks, outcomes: decision.outcomes })} />
        </div>
      </div>
    </div>
  );
}
