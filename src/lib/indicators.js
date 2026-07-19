export function ema(period, data) {
  if (!data.length) return [];
  const k = 2 / (period + 1);
  const out = [data[0]];
  for (let i = 1; i < data.length; i++) out.push(data[i] * k + out[i - 1] * (1 - k));
  return out;
}

export function wilderRSI(period, data) {
  if (data.length < period + 1) return new Array(data.length).fill(50);
  let gains = 0,
    losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = data[i] - data[i - 1];
    if (d >= 0) gains += d;
    else losses -= d;
  }
  let avgGain = gains / period,
    avgLoss = losses / period;
  const out = new Array(period).fill(50);
  for (let i = period; i < data.length; i++) {
    const d = i === period ? 0 : data[i] - data[i - 1];
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    out.push(100 - 100 / (1 + rs));
  }
  return out;
}

export function atr(period, highs, lows, closes) {
  const trs = [];
  for (let i = 0; i < highs.length; i++) {
    if (i === 0) {
      trs.push(highs[i] - lows[i]);
      continue;
    }
    trs.push(
      Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      )
    );
  }
  return ema(period, trs);
}

export function adx(period, highs, lows, closes) {
  const len = highs.length;
  const plusDM = [0],
    minusDM = [0];
  for (let i = 1; i < len; i++) {
    const up = highs[i] - highs[i - 1];
    const down = lows[i - 1] - lows[i];
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
  }
  const trArr = atr(period, highs, lows, closes);
  const smoothedPlus = ema(period, plusDM);
  const smoothedMinus = ema(period, minusDM);
  const diPlus = smoothedPlus.map((v, i) => (trArr[i] ? (100 * v) / trArr[i] : 0));
  const diMinus = smoothedMinus.map((v, i) => (trArr[i] ? (100 * v) / trArr[i] : 0));
  const dx = diPlus.map((v, i) => {
    const sum = v + diMinus[i];
    return sum === 0 ? 0 : (100 * Math.abs(v - diMinus[i])) / sum;
  });
  const adxArr = ema(period, dx);
  return { adx: adxArr, diPlus, diMinus };
}

export function bollinger(period, std, data) {
  const upper = [],
    lower = [],
    mid = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      upper.push(data[i]);
      lower.push(data[i]);
      mid.push(data[i]);
      continue;
    }
    const slice = data.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    mid.push(mean);
    upper.push(mean + std * sd);
    lower.push(mean - std * sd);
  }
  return { upper, lower, mid };
}

export function macd(data, fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(fast, data);
  const emaSlow = ema(slow, data);
  const line = emaFast.map((v, i) => v - emaSlow[i]);
  const sig = ema(signal, line);
  return { line, signal: sig };
}

export function stochastic(period, kSmooth, highs, lows, closes) {
  const kRaw = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      kRaw.push(50);
      continue;
    }
    const hh = Math.max(...highs.slice(i - period + 1, i + 1));
    const ll = Math.min(...lows.slice(i - period + 1, i + 1));
    kRaw.push(hh === ll ? 50 : (100 * (closes[i] - ll)) / (hh - ll));
  }
  const k = ema(kSmooth, kRaw);
  const d = ema(3, k);
  return { k, d };
}

export function fibLevels(high, low) {
  const range = high - low;
  return {
    l236: high - range * 0.236,
    l382: high - range * 0.382,
    l500: high - range * 0.5,
    l618: high - range * 0.618,
  };
}

export function digitFrequencyAnomaly(digits) {
  const n = digits.length;
  const counts = new Array(10).fill(0);
  digits.forEach((d) => counts[d]++);
  const p = 0.1;
  const se = Math.sqrt((p * (1 - p)) / n);
  const z99 = 2.576;
  const results = counts.map((c, digit) => {
    const freq = c / n;
    const z = (freq - p) / se;
    return { digit, freq, count: c, z, outsideCI: Math.abs(z) > z99 };
  });
  results.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
  return results;
}

export function streakStats(digits) {
  let streak = 1;
  for (let i = digits.length - 2; i >= 0; i--) {
    if (digits[i] === digits[digits.length - 1]) streak++;
    else break;
  }
  const expected = 1 / 0.9;
  return { streak, expected, deviation: streak - expected };
}

export function volatilityRegime(digits, window = 50) {
  const recent = digits.slice(-window);
  const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
  const variance = recent.reduce((a, b) => a + (b - mean) ** 2, 0) / recent.length;
  const sd = Math.sqrt(variance);
  const regime = sd > 3.1 ? "Elevated" : sd < 2.7 ? "Calm" : "Normal";
  return { sd, regime };
}
