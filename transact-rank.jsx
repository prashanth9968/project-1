import { useState, useEffect, useCallback } from "react";

// ============================================================
//  CONFIGURATION
//  Set BACKEND_URL to your deployed server to use the real API.
//  Leave null to use the built-in mock backend (default).
//  e.g. const BACKEND_URL = "https://transact-rank.up.railway.app";
// ============================================================
const BACKEND_URL = null;

const DEMO_USERS = ["diana", "alice", "bob", "charlie", "evan"];
const CATEGORIES = ["salary", "food", "transport", "entertainment", "utilities", "shopping", "other"];
const ACTIVITY_CAP = 50;
const RATE_LIMIT = { window: 60_000, max: 10 };

// ============================================================
//  MOCK BACKEND
//  Mirrors the Python FastAPI implementation exactly:
//  same validation rules, idempotency logic, rate limits,
//  balance checks, and multi-factor ranking algorithm.
// ============================================================
function createStore() {
  const M = 60_000, H = 3_600_000, D = 86_400_000, now = Date.now();
  const seeds = [
    { transaction_id: "seed-d1", user_id: "diana",   amount: 4500, transaction_type: "credit", category: "salary",    ts: now - 30*M },
    { transaction_id: "seed-d2", user_id: "diana",   amount: 3000, transaction_type: "credit", category: "salary",    ts: now - 3*H  },
    { transaction_id: "seed-d3", user_id: "diana",   amount: 1200, transaction_type: "credit", category: "shopping",  ts: now - 6*H  },
    { transaction_id: "seed-d4", user_id: "diana",   amount:  500, transaction_type: "debit",  category: "food",      ts: now - 8*H  },
    { transaction_id: "seed-a1", user_id: "alice",   amount: 2000, transaction_type: "credit", category: "salary",    ts: now - 2*H  },
    { transaction_id: "seed-a2", user_id: "alice",   amount:  800, transaction_type: "credit", category: "other",     ts: now - 5*H  },
    { transaction_id: "seed-a3", user_id: "alice",   amount:  350, transaction_type: "debit",  category: "transport", ts: now - 7*H  },
    { transaction_id: "seed-b1", user_id: "bob",     amount: 1500, transaction_type: "credit", category: "salary",    ts: now - 2*D  },
    { transaction_id: "seed-b2", user_id: "bob",     amount:  600, transaction_type: "debit",  category: "shopping",  ts: now - 2*D+H},
    { transaction_id: "seed-c1", user_id: "charlie", amount:  800, transaction_type: "credit", category: "utilities", ts: now - 4*D  },
    { transaction_id: "seed-c2", user_id: "charlie", amount:  400, transaction_type: "debit",  category: "food",      ts: now - 4*D+H},
    { transaction_id: "seed-e1", user_id: "evan",    amount:  500, transaction_type: "credit", category: "other",     ts: now - 15*D },
  ];
  const store = { transactions: {}, userTxns: {}, balances: {}, processedIds: new Set(), rateLimits: {} };
  for (const s of seeds) {
    store.transactions[s.transaction_id] = { ...s, status: "success", failure_reason: null, balance_after: 0 };
    (store.userTxns[s.user_id] = store.userTxns[s.user_id] || []).push(s.transaction_id);
    store.balances[s.user_id] = (store.balances[s.user_id] || 0) + (s.transaction_type === "credit" ? s.amount : -s.amount);
    store.processedIds.add(s.transaction_id);
  }
  for (const uid in store.balances) store.balances[uid] = r2(store.balances[uid]);
  return store;
}

const STORE = createStore();

function r2(n) { return Math.round(n * 100) / 100; }

function validateFields(data) {
  const e = [];
  if (!data.transaction_id || !/^[a-zA-Z0-9_-]+$/.test(data.transaction_id)) e.push("transaction_id: alphanumeric + _ - only");
  if (!data.user_id || data.user_id.length < 3 || !/^[a-zA-Z0-9_-]+$/.test(data.user_id)) e.push("user_id: 3+ chars, alphanumeric");
  const amt = parseFloat(data.amount);
  if (isNaN(amt) || amt < 0.01 || amt > 100_000) e.push("amount: 0.01 – 100,000");
  if (!["credit", "debit"].includes(data.transaction_type)) e.push("transaction_type: 'credit' or 'debit'");
  return e;
}

function mockPost(data) {
  return new Promise((resolve, reject) => setTimeout(() => {
    const errs = validateFields(data);
    if (errs.length) return reject({ status: 422, message: "Validation failed: " + errs.join("; ") });
    const { transaction_id: txnId, user_id: userId } = data;
    const amount = r2(parseFloat(data.amount));
    if (STORE.processedIds.has(txnId))
      return resolve({ ...STORE.transactions[txnId], is_duplicate: true, message: "Duplicate transaction_id — returning original result." });
    const now = Date.now();
    STORE.rateLimits[userId] = (STORE.rateLimits[userId] || []).filter(t => now - t < RATE_LIMIT.window);
    if (STORE.rateLimits[userId].length >= RATE_LIMIT.max)
      return reject({ status: 429, message: `Rate limit: max ${RATE_LIMIT.max} transactions per 60 s per user` });
    const balance = STORE.balances[userId] || 0;
    let status, failureReason = null, balanceAfter;
    if (data.transaction_type === "debit") {
      if (balance < amount) { status = "failed"; failureReason = "insufficient_balance"; balanceAfter = balance; }
      else { status = "success"; balanceAfter = r2(balance - amount); STORE.balances[userId] = balanceAfter; }
    } else { status = "success"; balanceAfter = r2(balance + amount); STORE.balances[userId] = balanceAfter; }
    const txn = { transaction_id: txnId, user_id: userId, amount, transaction_type: data.transaction_type,
      category: data.category || "other", ts: now, status, failure_reason: failureReason, balance_after: balanceAfter,
      is_duplicate: false, message: status === "success" ? "Transaction processed successfully." : `Transaction failed: ${failureReason}.` };
    STORE.transactions[txnId] = txn;
    (STORE.userTxns[userId] = STORE.userTxns[userId] || []).push(txnId);
    STORE.processedIds.add(txnId);
    STORE.rateLimits[userId].push(now);
    resolve(txn);
  }, 350));
}

function mockGetSummary(userId) {
  return new Promise((resolve, reject) => setTimeout(() => {
    const ids = STORE.userTxns[userId];
    if (!ids?.length) return reject({ status: 404, message: `No transactions found for user '${userId}'` });
    const txns = ids.map(id => STORE.transactions[id]);
    const ok = txns.filter(t => t.status === "success");
    resolve({ user_id: userId,
      net_balance: r2(STORE.balances[userId] || 0),
      total_credits: r2(ok.filter(t => t.transaction_type === "credit").reduce((s, t) => s + t.amount, 0)),
      total_debits: r2(ok.filter(t => t.transaction_type === "debit").reduce((s, t) => s + t.amount, 0)),
      transaction_count: txns.length, successful_transactions: ok.length, failed_transactions: txns.length - ok.length,
      transactions: [...txns].sort((a, b) => b.ts - a.ts) });
  }, 250));
}

function mockGetRankings() {
  return new Promise((resolve) => setTimeout(() => {
    const now = Date.now(), HOUR = 3_600_000;
    const stats = Object.keys(STORE.userTxns).map(uid => {
      const txns = STORE.userTxns[uid].map(id => STORE.transactions[id]);
      const ok = txns.filter(t => t.status === "success");
      if (!ok.length) return null;
      return { user_id: uid, net_balance: r2(STORE.balances[uid] || 0),
        total_credits: r2(ok.filter(t => t.transaction_type === "credit").reduce((s, t) => s + t.amount, 0)),
        total_debits: r2(ok.filter(t => t.transaction_type === "debit").reduce((s, t) => s + t.amount, 0)),
        transaction_count: txns.length, successful_count: ok.length, last_ts: Math.max(...txns.map(t => t.ts)) };
    }).filter(Boolean);
    const maxBal = Math.max(...stats.map(u => Math.max(u.net_balance, 0)), 1);
    const scored = stats.map(u => {
      const bs = r2((Math.max(u.net_balance, 0) / maxBal) * 40);
      const as_ = r2(Math.min(u.successful_count / ACTIVITY_CAP, 1) * 30);
      const hrs = (now - u.last_ts) / HOUR;
      const rs = hrs <= 24 ? 30 : hrs <= 168 ? 20 : hrs <= 720 ? 10 : 0;
      return { user_id: u.user_id, score: r2(bs + as_ + rs), net_balance: u.net_balance,
        total_credits: u.total_credits, total_debits: u.total_debits,
        transaction_count: u.transaction_count, successful_transactions: u.successful_count, last_ts: u.last_ts,
        score_breakdown: { balance_score: bs, activity_score: as_, recency_score: rs } };
    });
    scored.sort((a, b) => b.score - a.score || b.net_balance - a.net_balance);
    let rc = 1;
    scored.forEach((e, i) => { e.rank = (i > 0 && scored[i].score === scored[i-1].score) ? scored[i-1].rank : rc; rc++; });
    resolve({ total_users: scored.length, rankings: scored });
  }, 300));
}

// Real-backend adapter (used when BACKEND_URL is set)
async function realPost(data) {
  const r = await fetch(`${BACKEND_URL}/transaction`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  const json = await r.json();
  if (!r.ok) throw { status: r.status, message: json.detail || "Request failed" };
  return json;
}
async function realGetSummary(uid) {
  const r = await fetch(`${BACKEND_URL}/summary/${uid}`);
  const json = await r.json();
  if (!r.ok) throw { status: r.status, message: json.detail || "Not found" };
  return json;
}
async function realGetRankings() {
  const r = await fetch(`${BACKEND_URL}/ranking`);
  return r.json();
}

const api = {
  postTransaction: BACKEND_URL ? realPost : mockPost,
  getSummary: BACKEND_URL ? realGetSummary : mockGetSummary,
  getRankings: BACKEND_URL ? realGetRankings : mockGetRankings,
};

// ============================================================
//  UTILITIES
// ============================================================
function genId() { return "txn_" + Math.random().toString(36).substr(2, 9); }
function fmt$(n) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n); }
function fmtTime(ts) {
  if (!ts) return "–";
  const d = Date.now() - ts, M = 60_000, H = 3_600_000, D = 86_400_000;
  if (d < M) return "just now";
  if (d < H) return `${Math.floor(d/M)}m ago`;
  if (d < D) return `${Math.floor(d/H)}h ago`;
  return `${Math.floor(d/D)}d ago`;
}
function rankMedal(r) { return r === 1 ? "🥇" : r === 2 ? "🥈" : r === 3 ? "🥉" : `#${r}`; }

// ============================================================
//  APP
// ============================================================
export default function App() {
  const [tab, setTab] = useState("tx");
  const [form, setForm] = useState({ transaction_id: genId(), user_id: "", amount: "", transaction_type: "credit", category: "other" });
  const [txResult, setTxResult] = useState(null);
  const [txLoading, setTxLoading] = useState(false);
  const [recent, setRecent] = useState([]);
  const [lastId, setLastId] = useState(null);

  const [summaryUID, setSummaryUID] = useState("");
  const [summary, setSummary] = useState(null);
  const [summaryErr, setSummaryErr] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const [rankings, setRankings] = useState(null);
  const [rankLoading, setRankLoading] = useState(false);

  const [toast, setToast] = useState(null);
  const showToast = useCallback((type, msg) => { setToast({ type, msg }); setTimeout(() => setToast(null), 4500); }, []);

  const submitTx = useCallback(async (overrideId) => {
    if (txLoading) return;
    setTxLoading(true); setTxResult(null);
    try {
      const res = await api.postTransaction({ ...form, ...(overrideId ? { transaction_id: overrideId } : {}) });
      setTxResult({ ok: true, data: res });
      setRecent(p => [res, ...p].slice(0, 6));
      setLastId(res.transaction_id);
      if (res.is_duplicate) showToast("warn", "Duplicate transaction_id — returned original result");
      else if (res.status === "failed") showToast("err", `Transaction failed: ${res.failure_reason}`);
      else showToast("ok", `Transaction successful · Balance: ${fmt$(res.balance_after)}`);
      if (!overrideId) setForm(p => ({ ...p, transaction_id: genId() }));
    } catch (e) { setTxResult({ ok: false, error: e }); showToast("err", e.message || "Request failed"); }
    finally { setTxLoading(false); }
  }, [form, txLoading, showToast]);

  const fetchSummary = useCallback(async (uid) => {
    const id = (uid || summaryUID).trim();
    if (!id) return;
    setSummaryLoading(true); setSummaryErr(null); setSummary(null);
    try { setSummary(await api.getSummary(id)); }
    catch (e) { setSummaryErr(e.message || "User not found"); }
    finally { setSummaryLoading(false); }
  }, [summaryUID]);

  const fetchRankings = useCallback(async () => {
    setRankLoading(true);
    try { setRankings(await api.getRankings()); } finally { setRankLoading(false); }
  }, []);

  useEffect(() => { if (tab === "rank") fetchRankings(); }, [tab, fetchRankings]);

  // Shared style helpers
  const card = { background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 12, padding: 20 };
  const inp = { width: "100%", padding: "10px 14px", background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-secondary)", borderRadius: 8, color: "var(--color-text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box", fontFamily: "inherit" };
  const lbl = { fontSize: 11, color: "var(--color-text-tertiary)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6, display: "block" };
  const pill = (on) => ({ padding: "4px 12px", borderRadius: 20, fontSize: 12, cursor: "pointer", fontWeight: 500, border: `0.5px solid ${on ? "var(--color-border-info)" : "var(--color-border-tertiary)"}`, background: on ? "var(--color-background-info)" : "var(--color-background-secondary)", color: on ? "var(--color-text-info)" : "var(--color-text-secondary)" });
  const tabBtn = (id) => ({ padding: "7px 16px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 500, background: tab === id ? "var(--color-background-info)" : "transparent", color: tab === id ? "var(--color-text-info)" : "var(--color-text-secondary)" });

  return (
    <div style={{ minHeight: "100vh", fontFamily: "var(--font-sans), system-ui, sans-serif" }}>
      <style>{`
        @keyframes fadeUp { from{opacity:0;transform:translateY(-10px)} to{opacity:1;transform:translateY(0)} }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.35} }
        .bar { transition: width .75s cubic-bezier(.4,0,.2,1); }
        .hrow:hover { background: var(--color-background-secondary) !important; }
        .inp-f:focus { border-color: var(--color-border-info) !important; box-shadow: 0 0 0 3px rgba(55,138,221,.14) !important; }
        .act-btn:active { transform: scale(0.98); }
      `}</style>

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", top: 16, right: 16, zIndex: 9999, maxWidth: 300, padding: "11px 16px", borderRadius: 10, fontSize: 13, fontWeight: 500, animation: "fadeUp .25s ease",
          background: toast.type === "ok" ? "var(--color-background-success)" : toast.type === "warn" ? "var(--color-background-warning)" : "var(--color-background-danger)",
          border: toast.type === "ok" ? "0.5px solid var(--color-border-success)" : toast.type === "warn" ? "0.5px solid var(--color-border-warning)" : "0.5px solid var(--color-border-danger)",
          color: toast.type === "ok" ? "var(--color-text-success)" : toast.type === "warn" ? "var(--color-text-warning)" : "var(--color-text-danger)" }}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div style={{ borderBottom: "0.5px solid var(--color-border-tertiary)", padding: "10px 24px" }}>
        <div style={{ maxWidth: 980, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 16, fontWeight: 500 }}>TransactRank</span>
            <span style={{ background: "var(--color-background-secondary)", color: "var(--color-text-tertiary)", fontSize: 11, padding: "2px 9px", borderRadius: 20, fontWeight: 500 }}>
              {BACKEND_URL ? "Live backend" : "Mock backend · 5 demo users pre-loaded"}
            </span>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            {[["tx", "Submit transaction"], ["summary", "User summary"], ["rank", "Leaderboard"]].map(([id, lbl]) => (
              <button key={id} onClick={() => setTab(id)} className="act-btn" style={tabBtn(id)}>{lbl}</button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 980, margin: "0 auto", padding: "24px" }}>

        {/* ───────────────────── TRANSACTION TAB ───────────────────── */}
        {tab === "tx" && (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 340px", gap: 20, alignItems: "start" }}>

            {/* Form */}
            <div style={card}>
              <p style={{ margin: "0 0 4px", fontWeight: 500, fontSize: 16 }}>POST /transaction</p>
              <p style={{ margin: "0 0 20px", fontSize: 13, color: "var(--color-text-secondary)" }}>Idempotent · rate-limited (10/min) · balance-validated</p>

              <div style={{ marginBottom: 16 }}>
                <label style={lbl}>User ID</label>
                <input className="inp-f" style={inp} value={form.user_id} onChange={e => setForm(p => ({ ...p, user_id: e.target.value }))} placeholder="e.g. alice" />
                <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                  {DEMO_USERS.map(u => <button key={u} onClick={() => setForm(p => ({ ...p, user_id: u }))} style={pill(form.user_id === u)}>{u}</button>)}
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={lbl}>Amount (USD)</label>
                <div style={{ position: "relative" }}>
                  <span style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: "var(--color-text-tertiary)", fontSize: 14 }}>$</span>
                  <input className="inp-f" style={{ ...inp, paddingLeft: 26 }} type="number" min="0.01" max="100000" step="0.01"
                    value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} placeholder="0.00" />
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={lbl}>Type</label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {[["credit", "↑ Credit — add funds"], ["debit", "↓ Debit — withdraw funds"]].map(([t, label]) => (
                    <button key={t} className="act-btn" onClick={() => setForm(p => ({ ...p, transaction_type: t }))} style={{
                      padding: 12, borderRadius: 8, cursor: "pointer", fontWeight: 500, fontSize: 13, textAlign: "left",
                      border: `0.5px solid ${form.transaction_type === t ? (t === "credit" ? "var(--color-border-success)" : "var(--color-border-danger)") : "var(--color-border-tertiary)"}`,
                      background: form.transaction_type === t ? (t === "credit" ? "var(--color-background-success)" : "var(--color-background-danger)") : "var(--color-background-secondary)",
                      color: form.transaction_type === t ? (t === "credit" ? "var(--color-text-success)" : "var(--color-text-danger)") : "var(--color-text-secondary)",
                    }}>{label}</button>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={lbl}>Category</label>
                <select className="inp-f" style={{ ...inp, cursor: "pointer" }} value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
                </select>
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={lbl}>Transaction ID <span style={{ color: "var(--color-text-tertiary)", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(idempotency key)</span></label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input className="inp-f" style={{ ...inp, fontFamily: "var(--font-mono)", fontSize: 12 }} value={form.transaction_id}
                    onChange={e => setForm(p => ({ ...p, transaction_id: e.target.value }))} />
                  <button className="act-btn" onClick={() => setForm(p => ({ ...p, transaction_id: genId() }))} title="Generate new ID" style={{
                    background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", color: "var(--color-text-secondary)", borderRadius: 8, padding: "0 13px", cursor: "pointer", flexShrink: 0, fontSize: 17,
                  }}>↺</button>
                </div>
              </div>

              <button className="act-btn" onClick={() => submitTx()} disabled={txLoading} style={{
                width: "100%", padding: 13, borderRadius: 8, fontWeight: 500, fontSize: 14, cursor: txLoading ? "not-allowed" : "pointer", marginBottom: 10,
                background: "var(--color-background-info)", color: "var(--color-text-info)", border: "0.5px solid var(--color-border-info)",
                opacity: txLoading ? 0.6 : 1,
              }}>{txLoading ? "Processing…" : "Submit transaction"}</button>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <button className="act-btn" onClick={() => lastId && submitTx(lastId)} disabled={!lastId || txLoading} style={{
                  padding: "9px 10px", borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: lastId ? "pointer" : "not-allowed", opacity: lastId ? 1 : 0.4,
                  background: "var(--color-background-warning)", border: "0.5px solid var(--color-border-warning)", color: "var(--color-text-warning)",
                }}>Demo: duplicate ID</button>
                <button className="act-btn" onClick={() => setForm(p => ({ ...p, amount: "999999", transaction_type: "debit", transaction_id: genId() }))} style={{
                  padding: "9px 10px", borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: "pointer",
                  background: "var(--color-background-danger)", border: "0.5px solid var(--color-border-danger)", color: "var(--color-text-danger)",
                }}>Demo: overdraw</button>
              </div>
            </div>

            {/* Response + Recent */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={card}>
                <p style={{ margin: "0 0 14px", fontSize: 11, fontWeight: 500, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.07em" }}>Response</p>
                {!txResult && !txLoading && <p style={{ color: "var(--color-text-tertiary)", fontSize: 13, textAlign: "center", padding: "18px 0", margin: 0 }}>Submit a transaction to see the response</p>}
                {txLoading && <p style={{ color: "var(--color-text-info)", fontSize: 13, textAlign: "center", padding: "18px 0", animation: "pulse 1s infinite", margin: 0 }}>Processing…</p>}
                {txResult?.ok && (() => {
                  const d = txResult.data, isDup = d.is_duplicate, isFail = d.status === "failed";
                  return (
                    <>
                      <div style={{ marginBottom: 12 }}>
                        <span style={{ fontSize: 11, fontWeight: 500, padding: "3px 10px", borderRadius: 20,
                          background: isDup ? "var(--color-background-warning)" : isFail ? "var(--color-background-danger)" : "var(--color-background-success)",
                          border: `0.5px solid ${isDup ? "var(--color-border-warning)" : isFail ? "var(--color-border-danger)" : "var(--color-border-success)"}`,
                          color: isDup ? "var(--color-text-warning)" : isFail ? "var(--color-text-danger)" : "var(--color-text-success)" }}>
                          {isDup ? "Duplicate" : isFail ? "Failed" : "Success"}
                        </span>
                      </div>
                      {[["balance_after", fmt$(d.balance_after)], ["transaction_id", d.transaction_id], ["user_id", d.user_id],
                        ["amount", fmt$(d.amount)], ["type", d.transaction_type], ["status", d.status],
                        d.failure_reason ? ["failure_reason", d.failure_reason] : null,
                        d.is_duplicate ? ["is_duplicate", "true"] : null].filter(Boolean).map(([k, v]) => (
                        <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: "0.5px solid var(--color-border-tertiary)", fontSize: 12 }}>
                          <span style={{ color: "var(--color-text-tertiary)" }}>{k}</span>
                          <span style={{ fontFamily: k.includes("id") ? "var(--font-mono)" : "inherit", maxWidth: 170, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            color: (k === "failure_reason" || k === "is_duplicate") ? "var(--color-text-danger)" : "var(--color-text-primary)" }}>{v}</span>
                        </div>
                      ))}
                    </>
                  );
                })()}
                {txResult?.ok === false && (
                  <div style={{ color: "var(--color-text-danger)", fontSize: 13 }}>
                    <p style={{ fontWeight: 500, margin: "0 0 6px" }}>{txResult.error.status} error</p>
                    <p style={{ margin: 0 }}>{txResult.error.message}</p>
                  </div>
                )}
              </div>

              {recent.length > 0 && (
                <div style={card}>
                  <p style={{ margin: "0 0 12px", fontSize: 11, fontWeight: 500, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.07em" }}>Recent</p>
                  {recent.map((t, i) => (
                    <div key={i} className="hrow" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px", borderRadius: 6, marginBottom: 3 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ color: t.transaction_type === "credit" ? "var(--color-text-success)" : "var(--color-text-danger)", fontSize: 16 }}>{t.transaction_type === "credit" ? "↑" : "↓"}</span>
                        <div>
                          <p style={{ margin: 0, fontSize: 13, fontWeight: 500 }}>{fmt$(t.amount)} · {t.user_id}</p>
                          <p style={{ margin: 0, fontSize: 11, color: "var(--color-text-tertiary)" }}>{t.category} · {fmtTime(t.ts)}</p>
                        </div>
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 500, padding: "2px 8px", borderRadius: 20,
                        background: t.status === "success" ? "var(--color-background-success)" : "var(--color-background-danger)",
                        color: t.status === "success" ? "var(--color-text-success)" : "var(--color-text-danger)" }}>{t.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ───────────────────── SUMMARY TAB ───────────────────── */}
        {tab === "summary" && (
          <div>
            <div style={{ ...card, marginBottom: 20 }}>
              <p style={{ margin: "0 0 4px", fontWeight: 500, fontSize: 16 }}>GET /summary/:userId</p>
              <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--color-text-secondary)" }}>Full transaction history and financial aggregates</p>
              <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                <input className="inp-f" style={{ ...inp, flex: 1 }} value={summaryUID}
                  onChange={e => setSummaryUID(e.target.value)} placeholder="Enter user ID…"
                  onKeyDown={e => e.key === "Enter" && fetchSummary()} />
                <button className="act-btn" onClick={() => fetchSummary()} disabled={summaryLoading} style={{
                  background: "var(--color-background-info)", color: "var(--color-text-info)", border: "0.5px solid var(--color-border-info)",
                  borderRadius: 8, padding: "0 20px", fontWeight: 500, cursor: "pointer", fontSize: 13, flexShrink: 0 }}>Fetch</button>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {DEMO_USERS.map(u => <button key={u} onClick={() => { setSummaryUID(u); fetchSummary(u); }} style={pill(false)}>{u}</button>)}
              </div>
            </div>

            {summaryLoading && <p style={{ textAlign: "center", color: "var(--color-text-info)", padding: 40, animation: "pulse 1s infinite" }}>Loading…</p>}
            {summaryErr && <div style={{ ...card, color: "var(--color-text-danger)", textAlign: "center" }}>{summaryErr}</div>}

            {summary && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 12, marginBottom: 20 }}>
                  {[
                    { lbl: "Net balance",   val: fmt$(summary.net_balance),      clr: summary.net_balance >= 0 ? "var(--color-text-success)" : "var(--color-text-danger)" },
                    { lbl: "Total credits", val: fmt$(summary.total_credits),     clr: "var(--color-text-success)" },
                    { lbl: "Total debits",  val: fmt$(summary.total_debits),      clr: "var(--color-text-danger)" },
                    { lbl: "Transactions",  val: `${summary.successful_transactions} ok / ${summary.failed_transactions} failed`, clr: "var(--color-text-primary)" },
                  ].map(({ lbl: l, val, clr }) => (
                    <div key={l} style={{ background: "var(--color-background-secondary)", borderRadius: 8, padding: "14px", textAlign: "center" }}>
                      <p style={{ margin: "0 0 6px", fontSize: 11, color: "var(--color-text-tertiary)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.07em" }}>{l}</p>
                      <p style={{ margin: 0, fontSize: 17, fontWeight: 500, color: clr, fontFamily: "var(--font-mono)" }}>{val}</p>
                    </div>
                  ))}
                </div>

                <div style={card}>
                  <p style={{ margin: "0 0 16px", fontWeight: 500 }}>Transaction history · {summary.user_id}</p>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, tableLayout: "fixed" }}>
                      <thead>
                        <tr style={{ borderBottom: "0.5px solid var(--color-border-secondary)" }}>
                          {[["ID", "18%"], ["Type", "13%"], ["Amount", "13%"], ["Category", "13%"], ["Status", "10%"], ["Balance after", "14%"], ["Time", "10%"]].map(([h, w]) => (
                            <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: "var(--color-text-tertiary)", fontWeight: 500, fontSize: 11, textTransform: "uppercase", whiteSpace: "nowrap", width: w }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {summary.transactions.map((t, i) => (
                          <tr key={i} className="hrow" style={{ borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
                            <td style={{ padding: "10px", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--color-text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.transaction_id}</td>
                            <td style={{ padding: "10px", color: t.transaction_type === "credit" ? "var(--color-text-success)" : "var(--color-text-danger)", fontWeight: 500 }}>
                              {t.transaction_type === "credit" ? "↑ credit" : "↓ debit"}
                            </td>
                            <td style={{ padding: "10px", fontFamily: "var(--font-mono)", fontWeight: 500 }}>{fmt$(t.amount)}</td>
                            <td style={{ padding: "10px", color: "var(--color-text-secondary)" }}>{t.category}</td>
                            <td style={{ padding: "10px" }}>
                              <span style={{ fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 20,
                                background: t.status === "success" ? "var(--color-background-success)" : "var(--color-background-danger)",
                                color: t.status === "success" ? "var(--color-text-success)" : "var(--color-text-danger)" }}>{t.status}</span>
                            </td>
                            <td style={{ padding: "10px", fontFamily: "var(--font-mono)" }}>{fmt$(t.balance_after)}</td>
                            <td style={{ padding: "10px", color: "var(--color-text-tertiary)", whiteSpace: "nowrap" }}>{fmtTime(t.ts)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ───────────────────── RANKINGS TAB ───────────────────── */}
        {tab === "rank" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
              <div>
                <p style={{ margin: "0 0 4px", fontWeight: 500, fontSize: 16 }}>GET /ranking</p>
                <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-secondary)" }}>Multi-factor score: Balance (0–40) + Activity (0–30) + Recency (0–30)</p>
              </div>
              <button className="act-btn" onClick={fetchRankings} disabled={rankLoading} style={{
                background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-secondary)",
                color: "var(--color-text-secondary)", borderRadius: 8, padding: "8px 16px", cursor: "pointer", fontWeight: 500, fontSize: 13 }}>
                {rankLoading ? "Computing…" : "↺ Refresh"}
              </button>
            </div>

            {rankLoading && <p style={{ textAlign: "center", color: "var(--color-text-info)", padding: 40, animation: "pulse 1s infinite" }}>Computing rankings…</p>}

            {rankings && (
              <>
                <div style={{ ...card, marginBottom: 16, overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: "0.5px solid var(--color-border-secondary)" }}>
                        {["Rank", "User", "Score /100", "Score breakdown", "Balance", "Txns", "Last active"].map(h => (
                          <th key={h} style={{ padding: "10px 14px", textAlign: "left", color: "var(--color-text-tertiary)", fontWeight: 500, fontSize: 11, textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rankings.rankings.map((r) => (
                        <tr key={r.user_id} className="hrow" style={{ borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
                          <td style={{ padding: "16px 14px", fontSize: 20 }}>{rankMedal(r.rank)}</td>
                          <td style={{ padding: "16px 14px", fontWeight: 500 }}>{r.user_id}</td>
                          <td style={{ padding: "16px 14px" }}>
                            <span style={{ fontSize: 22, fontWeight: 500, fontFamily: "var(--font-mono)" }}>{r.score}</span>
                          </td>
                          <td style={{ padding: "16px 14px", minWidth: 220 }}>
                            {[
                              { label: "Balance",  v: r.score_breakdown.balance_score,  max: 40, bg: "var(--color-background-info)",    fg: "var(--color-text-info)" },
                              { label: "Activity", v: r.score_breakdown.activity_score, max: 30, bg: "var(--color-background-success)", fg: "var(--color-text-success)" },
                              { label: "Recency",  v: r.score_breakdown.recency_score,  max: 30, bg: "var(--color-background-warning)", fg: "var(--color-text-warning)" },
                            ].map(({ label, v, max, bg, fg }) => (
                              <div key={label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                                <span style={{ fontSize: 10, color: "var(--color-text-tertiary)", width: 44, flexShrink: 0 }}>{label}</span>
                                <div style={{ flex: 1, background: "var(--color-background-secondary)", borderRadius: 3, height: 8, overflow: "hidden" }}>
                                  <div className="bar" style={{ width: `${(v / max) * 100}%`, height: "100%", background: bg, borderRadius: 3 }} />
                                </div>
                                <span style={{ fontSize: 10, color: fg, fontFamily: "var(--font-mono)", width: 24, textAlign: "right", flexShrink: 0 }}>{v}</span>
                              </div>
                            ))}
                          </td>
                          <td style={{ padding: "16px 14px", fontFamily: "var(--font-mono)", fontWeight: 500, color: r.net_balance >= 0 ? "var(--color-text-success)" : "var(--color-text-danger)" }}>{fmt$(r.net_balance)}</td>
                          <td style={{ padding: "16px 14px", color: "var(--color-text-secondary)" }}>{r.transaction_count}</td>
                          <td style={{ padding: "16px 14px", color: "var(--color-text-tertiary)", whiteSpace: "nowrap" }}>{fmtTime(r.last_ts)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Scoring legend */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 12 }}>
                  {[
                    { fg: "var(--color-text-info)",    label: "Balance score (0–40)",  desc: `Normalised net balance vs. the global max. Negative balances score 0. Rewards real financial growth.` },
                    { fg: "var(--color-text-success)", label: "Activity score (0–30)", desc: `Successful txns capped at ${ACTIVITY_CAP}. Prevents micro-transaction spam from gaming the leaderboard.` },
                    { fg: "var(--color-text-warning)", label: "Recency score (0–30)",  desc: "30 pts if active < 24 h · 20 pts < 7 d · 10 pts < 30 d. Rewards sustained engagement over one-time bursts." },
                  ].map(({ fg, label, desc }) => (
                    <div key={label} style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, padding: 16, borderLeft: `3px solid ${fg}` }}>
                      <p style={{ margin: "0 0 6px", fontSize: 12, fontWeight: 500, color: fg }}>{label}</p>
                      <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>{desc}</p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
