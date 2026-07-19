import { useState, useRef, useCallback, useEffect } from "react";

const APP_ID = 1089;
const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

export function useDeriv() {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [balance, setBalance] = useState(null);
  const [currency, setCurrency] = useState("USD");
  const [accountId, setAccountId] = useState("");
  const [isDemo, setIsDemo] = useState(null);

  const wsRef = useRef(null);
  const reqIdRef = useRef(1);
  const pendingRef = useRef(new Map());
  const tickSubsRef = useRef(new Map());
  const reconnectTimerRef = useRef(null);
  const tokenRef = useRef("");

  const send = useCallback((payload) => {
    return new Promise((resolve, reject) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        reject(new Error("Not connected"));
        return;
      }
      const req_id = reqIdRef.current++;
      pendingRef.current.set(req_id, { resolve, reject });
      wsRef.current.send(JSON.stringify({ ...payload, req_id }));
      setTimeout(() => {
        if (pendingRef.current.has(req_id)) {
          pendingRef.current.delete(req_id);
          reject(new Error("Request timed out"));
        }
      }, 15000);
    });
  }, []);

  const handleMessage = useCallback((event) => {
    const data = JSON.parse(event.data);

    if (data.req_id && pendingRef.current.has(data.req_id)) {
      const { resolve, reject } = pendingRef.current.get(data.req_id);
      pendingRef.current.delete(data.req_id);
      if (data.error) reject(new Error(data.error.message));
      else resolve(data);
    }

    if (data.msg_type === "balance" && data.balance) {
      setBalance(data.balance.balance);
      setCurrency(data.balance.currency);
    }

    if (data.msg_type === "tick" && data.tick) {
      const subs = tickSubsRef.current.get(data.tick.symbol);
      if (subs) subs.forEach((cb) => cb(data.tick));
    }

    if (data.msg_type === "ohlc" && data.ohlc) {
      const subs = tickSubsRef.current.get(`ohlc:${data.ohlc.symbol}`);
      if (subs) subs.forEach((cb) => cb(data.ohlc));
    }
  }, []);

  const connect = useCallback(
    (token) => {
      return new Promise((resolve, reject) => {
        setConnecting(true);
        setError("");
        tokenRef.current = token;
        try {
          const ws = new WebSocket(WS_URL);
          wsRef.current = ws;

          ws.onopen = () => {
            ws.send(JSON.stringify({ authorize: token, req_id: 0 }));
          };

          ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.req_id === 0) {
              if (data.error) {
                setError(data.error.message || "Authorization failed.");
                setConnecting(false);
                ws.close();
                reject(new Error(data.error.message));
                return;
              }
              setAccountId(data.authorize.loginid);
              setCurrency(data.authorize.currency);
              setBalance(data.authorize.balance);
              setIsDemo(data.authorize.loginid?.startsWith("VRTC"));
              setConnected(true);
              setConnecting(false);
              send({ balance: 1, subscribe: 1 }).catch(() => {});
              resolve(data.authorize);
              return;
            }
            handleMessage(event);
          };

          ws.onerror = () => {
            setError("Could not reach Deriv. Check your connection and try again.");
            setConnecting(false);
            reject(new Error("WebSocket error"));
          };

          ws.onclose = () => {
            setConnected(false);
            if (tokenRef.current) {
              reconnectTimerRef.current = setTimeout(() => {
                if (tokenRef.current) connect(tokenRef.current).catch(() => {});
              }, 3000);
            }
          };
        } catch (e) {
          setError("Unexpected error connecting.");
          setConnecting(false);
          reject(e);
        }
      });
    },
    [send, handleMessage]
  );

  const disconnect = useCallback(() => {
    tokenRef.current = "";
    clearTimeout(reconnectTimerRef.current);
    wsRef.current?.close();
    setConnected(false);
    setBalance(null);
    setAccountId("");
  }, []);

  const subscribeTicks = useCallback(
    (symbol, callback) => {
      if (!tickSubsRef.current.has(symbol)) {
        tickSubsRef.current.set(symbol, new Set());
        send({ ticks: symbol, subscribe: 1 }).catch((e) => setError(e.message));
      }
      tickSubsRef.current.get(symbol).add(callback);
      return () => {
        const subs = tickSubsRef.current.get(symbol);
        if (subs) {
          subs.delete(callback);
          if (subs.size === 0) tickSubsRef.current.delete(symbol);
        }
      };
    },
    [send]
  );

  const getTickHistory = useCallback(
    async (symbol, count = 300) => {
      const res = await send({
        ticks_history: symbol,
        count,
        end: "latest",
        style: "ticks",
      });
      return res.history;
    },
    [send]
  );

  const getCandleHistory = useCallback(
    async (symbol, granularity = 60, count = 300) => {
      const res = await send({
        ticks_history: symbol,
        count,
        end: "latest",
        style: "candles",
        granularity,
      });
      return res.candles;
    },
    [send]
  );

  const buyContract = useCallback(
    async ({ symbol, contractType, stake, duration, durationUnit = "t", barrier }) => {
      const proposal = await send({
        proposal: 1,
        amount: stake,
        basis: "stake",
        contract_type: contractType,
        currency,
        duration,
        duration_unit: durationUnit,
        symbol,
        ...(barrier ? { barrier } : {}),
      });
      const buy = await send({
        buy: proposal.proposal.id,
        price: stake,
      });
      return buy;
    },
    [send, currency]
  );

  useEffect(() => {
    return () => {
      clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, []);

  return {
    connected,
    connecting,
    error,
    setError,
    balance,
    currency,
    accountId,
    isDemo,
    connect,
    disconnect,
    subscribeTicks,
    getTickHistory,
    getCandleHistory,
    buyContract,
  };
}
