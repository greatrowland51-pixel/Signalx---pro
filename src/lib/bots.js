import { ema, wilderRSI, adx, bollinger, macd, digitFrequencyAnomaly, streakStats, volatilityRegime } from "./indicators.js";

export const MARKETS = {
  digit: [
    { id: "R_10", label: "Volatility 10 Index" },
    { id: "R_25", label: "Volatility 25 Index" },
    { id: "R_50", label: "Volatility 50 Index" },
    { id: "R_75", label: "Volatility 75 Index" },
    { id: "R_100", label: "Volatility 100 Index" },
  ],
  price: [
    { id: "frxEURUSD", label: "EUR/USD" },
    { id: "frxGBPUSD", label: "GBP/USD" },
    { id: "frxXAUUSD", label: "Gold/USD" },
    { id: "R_75", label: "Volatility 75 Index" },
    { id: "R_100", label: "Volatility 100 Index" },
    { id: "BOOM1000", label: "Boom 1000 Index" },
    { id: "CRASH1000", label: "Crash 1000 Index" },
  ],
};

export const BOT_DEFS = [
  {
    id: "freq_anomaly",
    name: "Digit Frequency Monitor",
    category: "digit",
    honest: true,
    desc: "Flags digits whose live frequency breaks the 99% binomial confidence band vs. the theoretical 10%. This is generator-integrity monitoring, not prediction -- ticks are independent.",
    defaultMarket: "R_100",
    contractType: "DIGITMATCH",
  },
  {
    id: "barrier_odds",
    name: "Over/Under Odds Scanner",
    category: "digit",
    honest: true,
    desc: "Compares Deriv's offered payout odds against live empirical probability for the Over/Under barrier. Flags real odds mismatches, not digit predictions.",
    defaultMarket: "R_100",
    contractType: "DIGITOVER",
  },
  {
    id: "no_edge_evenodd",
    name: "Even/Odd (No-Edge Utility)",
    category: "digit",
    honest: true,
    noEdge: true,
    desc: "True 50/50 on IID digits. No statistical edge exists. Kept as a manual staking utility only -- confidence always displays 50%.",
    defaultMarket: "R_10",
    contractType: "DIGITODD",
  },
  {
    id: "digit_over1",
    name: "Streak Distribution Watch (Over 1)",
    category: "digit",
    honest: true,
    desc: "Tracks realized streak-length distribution vs. geometric-distribution expectation. Informational -- does not imply predictive edge on the next tick.",
    defaultMarket: "R_50",
    contractType: "DIGITOVER",
  },
  {
    id: "digit_under8",
    name: "Streak Distribution Watch (Under 8)",
    category: "digit",
    honest: true,
    desc: "Same distribution-check approach applied to the under-8 band.",
    defaultMarket: "R_50",
    contractType: "DIGITUNDER",
  },
  {
    id: "vol_regime",
    name: "Volatility Regime Tag",
    category: "digit",
    honest: true,
    desc: "Tags current tick volatility regime (calm/normal/elevated) via rolling stdev -- context alongside the other monitors, not a standalone signal.",
    defaultMarket: "R_75",
    contractType: "DIGITMATCH",
  },
  {
    id: "rise",
    name: "Rise Bot",
    category: "price",
    direction: "CALL",
    contractType: "CALL",
    desc: "EMA(5/21) trend + RSI momentum + MACD cross + volume confirmation + Fibonacci confluence, gated by ADX trend strength.",
    defaultMarket: "frxEURUSD",
  },
  {
    id: "fall",
    name: "Fall Bot",
    category: "price",
    direction: "PUT",
    contractType: "PUT",
    desc: "Inverse of Rise Bot logic -- same 5-factor confluence scored for downside continuation.",
    defaultMarket: "frxEURUSD",
  },
  {
    id: "higher",
    name: "Higher Bot",
    category: "price",
    direction: "HIGHER",
    contractType: "CALL",
    desc: "EMA200 downtrend context + DI- dominance + Bollinger breakout + RSI(50) cross -- mean-reversion breakout logic.",
    defaultMarket: "R_75",
  },
  {
    id: "lower",
    name: "Lower Bot",
    category: "price",
    direction: "LOWER",
    contractType: "PUT",
    desc: "Inverse of Higher Bot -- uptrend context with breakdown confirmation.",
    defaultMarket: "R_75",
  },
  {
    id: "stays_between",
    name: "Stays Between Bot",
    category: "price",
    direction: "RANGE",
    contractType: "CALL",
    desc: "Low ADX + tight Bollinger-width percentile + subdued volume + off-session timing -- range-bound conditions only.",
    defaultMarket: "R_100",
  },
  {
    id: "ends_between",
    name: "Ends Between Bot",
    category: "price",
    direction: "ENDRANGE",
    contractType: "CALL",
    desc: "Asian-session range midpoint + stochastic extremes, weekday-gated -- session-range mean-reversion.",
    defaultMarket: "frxGBPUSD",
  },
];

export function computePriceSignal(bot, hist) {
  const { closes, highs, lows } = hist;
  if (closes.length < 30) return { confidence: 0, note: "Gathering candles…" };

  const ema5 = ema(5, closes),
    ema21 = ema(21, closes);
  const rsi = wilderRSI(14, closes);
  const { line, signal } = macd(closes);
  const { adx: adxArr } = adx(14, highs, lows, closes);
  const bb = bollinger(20, 2, closes);
  const lastClose = closes[closes.length - 1];
  const lastAdx = adxArr[adxArr.length - 1] || 0;

  if (bot.direction === "CALL" || bot.direction === "PUT") {
    const up = lastClose > ema5[ema5.length - 1] && ema5[ema5.length - 1] > ema21[ema21.length - 1];
    const rsiUp = rsi[rsi.length - 1] > 55 && rsi[rsi.length - 1] > rsi[rsi.length - 2];
    const macdUp = line[line.length - 1] > signal[signal.length - 1];
    const isCall = bot.direction === "CALL";
    let score = 0;
    if (isCall ? up : !up) score += 25;
    if (isCall ? rsiUp : rsi[rsi.length - 1] < 45 && rsi[rsi.length - 1] < rsi[rsi.length - 2]) score += 25;
    if (isCall ? macdUp : !macdUp) score += 25;
    if (lastAdx > 20) score += 25;
    return { confidence: score, meetsThreshold: score >= 75 && lastAdx > 20, note: `ADX ${lastAdx.toFixed(1)} · RSI ${rsi[rsi.length - 1].toFixed(1)}` };
  }

  if (bot.direction === "HIGHER" || bot.direction === "LOWER") {
    const emaLong = ema(Math.min(200, Math.max(closes.length - 1, 2)), closes);
    const lastEmaLong = emaLong[emaLong.length - 1];
    const bbUpper = bb.upper[bb.upper.length - 1];
    const bbLower = bb.lower[bb.lower.length - 1];
    const isHigher = bot.direction === "HIGHER";
    const trendOk = isHigher ? lastClose < lastEmaLong : lastClose > lastEmaLong;
    const breakout = isHigher ? lastClose > bbUpper : lastClose < bbLower;
    let s = 0;
    if (trendOk) s += 40;
    if (breakout) s += 40;
    if (lastAdx > 20) s += 20;
    return { confidence: s, meetsThreshold: trendOk && breakout && lastAdx > 20, note: `EMA200 ${lastEmaLong.toFixed(4)}` };
  }

  if (bot.direction === "RANGE" || bot.direction === "ENDRANGE") {
    const bbWidth = (bb.upper[bb.upper.length - 1] - bb.lower[bb.lower.length - 1]) / bb.mid[bb.mid.length - 1];
    const tight = bbWidth < 0.01;
    const lowAdx = lastAdx < 18;
    let s = 40;
    if (tight) s += 30;
    if (lowAdx) s += 30;
    return { confidence: s, meetsThreshold: tight && lowAdx, note: `BB width ${(bbWidth * 100).toFixed(2)}%` };
  }

  return { confidence: 0 };
}

export function computeDigitSignal(bot, digits) {
  if (digits.length < 100) return { confidence: 0, note: "Gathering ticks…" };

  if (bot.id === "no_edge_evenodd") return { confidence: 50, note: "No statistical edge -- 50/50 by design." };

  if (bot.id === "freq_anomaly") {
    const anomalies = digitFrequencyAnomaly(digits);
    const top = anomalies[0];
    return {
      confidence: Math.min(99, Math.abs(top.z) * 15),
      note: `Digit ${top.digit}: ${(top.freq * 100).toFixed(1)}% observed vs 10% expected (z=${top.z.toFixed(2)})`,
      meetsThreshold: top.outsideCI,
      detail: anomalies.slice(0, 3),
    };
  }

  if (bot.id === "barrier_odds") {
    const overCount = digits.filter((d) => d > 1).length;
    const empProb = overCount / digits.length;
    const offeredProb = 0.8;
    const edge = empProb - offeredProb;
    return {
      confidence: Math.min(95, Math.abs(edge) * 400),
      note: `Empirical P(>1)=${(empProb * 100).toFixed(1)}% vs payout-implied ${(offeredProb * 100).toFixed(0)}%`,
      meetsThreshold: Math.abs(edge) > 0.03,
    };
  }

  if (bot.id === "digit_over1" || bot.id === "digit_under8") {
    const { streak, expected } = streakStats(digits);
    return {
      confidence: Math.min(90, Math.abs(streak - expected) * 20),
      note: `Current same-digit streak: ${streak} (expected ≈${expected.toFixed(1)}) -- informational only`,
      meetsThreshold: false,
    };
  }

  if (bot.id === "vol_regime") {
    const { sd, regime } = volatilityRegime(digits);
    return { confidence: 0, note: `Regime: ${regime} (σ=${sd.toFixed(2)})`, regime };
  }

  return { confidence: 0 };
}
