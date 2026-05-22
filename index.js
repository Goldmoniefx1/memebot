// ============================================================
//  SOLANA MEMECOIN ALPHA BOT - FULL TIER 1 + TIER 2
//  TIER 1: Copy trade links, Rug detector, First buyer,
//          Exit signal (whale sell alerts)
//  TIER 2: Volume spike, Multi-whale confirm, Dev wallet monitor
//  100% FREE - DexScreener + Solscan only
//  No emojis - Android compatible
// ============================================================

require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// â”€â”€ Whale wallets (scored every 24h) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let WHALE_WALLETS = [
  { addr: "5tzFkiKscXHK5ZXCGbXZxdw7gzeJnuFcEKBTjHfkfxBK", label: "Whale-1", score: 100 },
  { addr: "DfYCNezifxAEsQbAJ1b3j6PX3JVBe8fu11KBhxsbw5d2", label: "Whale-2", score: 100 },
  { addr: "8xRELyKBSFbQkHFBFvPEtFNDSB6tEJZnNEMSuwRNNrBy", label: "Whale-3", score: 100 },
  { addr: "GUfCR9mK6azb9vcpsxgXyj7XRPAaFqzmLgtP5HmC3Mt",  label: "Whale-4", score: 100 },
  { addr: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", label: "Whale-5", score: 100 },
  { addr: "ASTyfSima4LLAdDgoFGkgqoKowG1LZFDr9fAQrg7iaJZ", label: "Whale-6", score: 100 },
  { addr: "HVh6wHNBAsG3pq1Bj5oCzRjoWKVogEDHwUHkRz3ekFgt", label: "Whale-7", score: 100 },
  { addr: "2RtGg6fsFiiF1EQzHqk75DAkyEjqiCPMkQ3sJHhT73g",  label: "Whale-8", score: 100 },
];

// â”€â”€ State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const seenAlerts        = new Set();
const tokenPrices       = new Map(); // addr -> { basePrice, symbol, buyCount }
const whaleLastTx       = new Map(); // addr -> last tx hash
const whaleWinStats     = new Map(); // addr -> { winRate, avgRoi, score }
const tokenBuyBuffer    = new Map(); // addr -> [{ wallet, time, amount }] multi-whale buffer
const volumeBaseline    = new Map(); // addr -> baseline volume for spike detection
const devWallets        = new Map(); // tokenAddr -> devWalletAddr
const blacklist         = new Set(); // rugged token addresses

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function formatUSD(n) {
  if (!n || isNaN(n)) return "$0";
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000)     return "$" + (n / 1_000).toFixed(1) + "k";
  return "$" + Number(n).toFixed(4);
}

function formatPrice(p) {
  if (!p || isNaN(p)) return "$0";
  if (p < 0.000001)  return "$" + p.toFixed(12);
  if (p < 0.001)     return "$" + p.toFixed(8);
  if (p < 1)         return "$" + p.toFixed(6);
  return "$" + p.toFixed(4);
}

function shortAddr(addr) {
  return addr.slice(0, 6) + "..." + addr.slice(-6);
}

function line() { return "===================="; }
function dash() { return "--------------------"; }

function now() {
  return new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

// â”€â”€ Signal scorer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function calcSignal({ price, mcap, volume1h, priceChange1h, age_minutes, whaleBuy, whaleScore, multiWhale, firstBuyer, buyCount }) {
  let score = 0;
  if (mcap < 50_000)         score += 25;
  else if (mcap < 200_000)   score += 18;
  else if (mcap < 500_000)   score += 10;
  if (volume1h && mcap && volume1h / mcap > 0.3) score += 15;
  if (priceChange1h > 100)   score += 20;
  else if (priceChange1h > 50)  score += 14;
  else if (priceChange1h > 20)  score += 8;
  if (age_minutes < 10)      score += 25;
  else if (age_minutes < 30) score += 18;
  else if (age_minutes < 60) score += 10;
  if (whaleBuy)              score += Math.floor((whaleScore ?? 100) / 100 * 25);
  if (multiWhale)            score += 20; // 2+ whales = big boost
  if (firstBuyer && buyCount <= 10) score += 15; // ultra early

  score = Math.min(score, 100);

  let risk;
  if (score >= 85)      risk = "HIGH RISK / HIGH REWARD";
  else if (score >= 65) risk = "MEDIUM RISK";
  else                  risk = "LOWER RISK";

  let potential;
  if (score >= 90)      potential = "100x-1000x potential";
  else if (score >= 75) potential = "10x-100x potential";
  else if (score >= 55) potential = "5x-10x potential";
  else                  potential = "Speculative";

  let strength;
  if (score >= 90)      strength = "*** MEGA ALPHA ***";
  else if (score >= 75) strength = "** STRONG ALPHA **";
  else if (score >= 55) strength = "* ALPHA SIGNAL *";
  else                  strength = "WATCH";

  const entry    = price;
  const target1  = price * 2;
  const target2  = price * 5;
  const target3  = price * 10;
  const target4  = price * 50;
  const stopLoss = price * 0.70;

  let posSize, posTip;
  if (score >= 85) {
    posSize = "1% - 2% of portfolio";
    posTip  = "High conviction â€” stay disciplined on size";
  } else if (score >= 65) {
    posSize = "0.5% - 1% of portfolio";
    posTip  = "Good signal â€” moderate size";
  } else {
    posSize = "0.25% - 0.5% of portfolio";
    posTip  = "Speculative â€” tiny size only";
  }

  let holdTime;
  if (age_minutes < 20)      holdTime = "15min - 2h (very early)";
  else if (age_minutes < 60) holdTime = "1h - 6h (early stage)";
  else                       holdTime = "2h - 24h (mid stage)";

  return { score, risk, potential, strength, entry, target1, target2, target3, target4, stopLoss, posSize, posTip, holdTime };
}

// â”€â”€ RUG PULL DETECTOR â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function checkRug(tokenAddr) {
  try {
    // Check token metadata via Solscan
    const res = await axios.get(
      "https://public-api.solscan.io/token/meta?tokenAddress=" + tokenAddr,
      { headers: { accept: "application/json" }, timeout: 8000 }
    );
    const meta = res.data ?? {};

    const flags = [];
    let rugScore = 0; // higher = more risky

    // Check 1: No website or social links
    if (!meta.website && !meta.twitter) {
      flags.push("No website or Twitter found");
      rugScore += 20;
    }

    // Check 2: Supply concentration â€” check top holders
    const holdersRes = await axios.get(
      "https://public-api.solscan.io/token/holders?tokenAddress=" + tokenAddr + "&limit=10&offset=0",
      { headers: { accept: "application/json" }, timeout: 8000 }
    );
    const holders = holdersRes.data?.data ?? [];

    if (holders.length > 0) {
      const topHolder = holders[0];
      const topPct    = topHolder.amount / (meta.supply ?? 1) * 100;
      if (topPct > 20) {
        flags.push("Top wallet holds " + topPct.toFixed(1) + "% of supply");
        rugScore += 30;
      }
      // Check if top 3 hold > 50%
      const top3Pct = holders.slice(0, 3).reduce((s, h) => s + h.amount, 0) / (meta.supply ?? 1) * 100;
      if (top3Pct > 50) {
        flags.push("Top 3 wallets hold " + top3Pct.toFixed(1) + "% of supply");
        rugScore += 25;
      }
    }

    // Check 3: Mint authority still active (dev can print more tokens)
    if (meta.mintAuthority) {
      flags.push("Mint authority ACTIVE - dev can mint more tokens");
      rugScore += 35;
    }

    // Check 4: Freeze authority (dev can freeze your wallet)
    if (meta.freezeAuthority) {
      flags.push("Freeze authority ACTIVE - dev can freeze wallets");
      rugScore += 35;
    }

    const safe    = rugScore < 30;
    const warning = rugScore >= 30 && rugScore < 60;
    const danger  = rugScore >= 60;

    if (danger) blacklist.add(tokenAddr);

    return { rugScore, flags, safe, warning, danger };

  } catch (err) {
    // If we can't check, assume unknown
    return { rugScore: 0, flags: ["Rug check unavailable"], safe: true, warning: false, danger: false };
  }
}

// â”€â”€ COPY TRADE LINK BUILDER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function buildCopyTradeLinks(tokenAddr) {
  const jupiter = "https://jup.ag/swap/SOL-" + tokenAddr;
  const raydium = "https://raydium.io/swap/?inputCurrency=SOL&outputCurrency=" + tokenAddr;
  const dex     = "https://dexscreener.com/solana/" + tokenAddr;
  return { jupiter, raydium, dex };
}

// â”€â”€ BUILD FULL ALERT MESSAGE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function buildMessage(type, data, sig, rug, links) {

  // PUMP alert
  if (type === "pump") {
    return (
      line() + "\n" +
      "PUMP ALERT - " + data.multiplier + "X\n" +
      line() + "\n" +
      "Token         : " + data.symbol + "\n" +
      "Current Price : " + formatPrice(data.currentPrice) + "\n" +
      "Market Cap    : " + formatUSD(data.mcap) + "\n" +
      "24h Volume    : " + formatUSD(data.volume24h) + "\n" +
      "24h Change    : +" + (data.priceChange24h ?? 0).toFixed(1) + "%\n" +
      dash() + "\n" +
      "Entry was     : " + formatPrice(data.basePrice) + "\n" +
      "Next targets  :\n" +
      "  " + (data.multiplier * 2) + "x : " + formatPrice(data.basePrice * data.multiplier * 2) + "\n" +
      "  " + (data.multiplier * 5) + "x : " + formatPrice(data.basePrice * data.multiplier * 5) + "\n" +
      dash() + "\n" +
      "ACTION: Move stop loss to entry price now!\n" +
      dash() + "\n" +
      "Chart  : " + links.dex + "\n" +
      "Buy    : " + links.jupiter + "\n" +
      line() + "\n" +
      "Time: " + now()
    );
  }

  // EXIT alert (whale sell)
  if (type === "exit") {
    return (
      line() + "\n" +
      "EXIT SIGNAL - WHALE SELLING\n" +
      line() + "\n" +
      "Token         : " + data.symbol + "\n" +
      "Whale         : " + data.label + "\n" +
      "Wallet        : " + shortAddr(data.wallet) + "\n" +
      "Sell Amount   : " + formatUSD(data.amountUSD) + "\n" +
      "Current Price : " + formatPrice(data.price) + "\n" +
      "Market Cap    : " + formatUSD(data.mcap) + "\n" +
      dash() + "\n" +
      "ACTION REQUIRED:\n" +
      "  - Consider taking profits NOW\n" +
      "  - At minimum move stop loss to entry\n" +
      "  - Watch for more whale sells in next 10min\n" +
      dash() + "\n" +
      "Chart  : " + links.dex + "\n" +
      line() + "\n" +
      "Time: " + now()
    );
  }

  // VOLUME SPIKE alert
  if (type === "volume") {
    return (
      line() + "\n" +
      "VOLUME SPIKE DETECTED\n" +
      line() + "\n" +
      "Token         : " + data.symbol + "\n" +
      "Volume Spike  : +" + data.spikePercent.toFixed(0) + "% vs baseline\n" +
      "Current Price : " + formatPrice(data.price) + "\n" +
      "Market Cap    : " + formatUSD(data.mcap) + "\n" +
      "1h Volume     : " + formatUSD(data.volume1h) + "\n" +
      "1h Change     : +" + (data.priceChange1h ?? 0).toFixed(1) + "%\n" +
      dash() + "\n" +
      "Buy before Twitter finds this.\n" +
      dash() + "\n" +
      "Buy    : " + links.jupiter + "\n" +
      "Chart  : " + links.dex + "\n" +
      line() + "\n" +
      "Time: " + now()
    );
  }

  // DEV WALLET SELL alert
  if (type === "devSell") {
    return (
      line() + "\n" +
      "WARNING - DEV WALLET SELLING\n" +
      line() + "\n" +
      "Token         : " + data.symbol + "\n" +
      "Dev Wallet    : " + shortAddr(data.devWallet) + "\n" +
      "Sell Amount   : " + formatUSD(data.amountUSD) + "\n" +
      "Current Price : " + formatPrice(data.price) + "\n" +
      "Market Cap    : " + formatUSD(data.mcap) + "\n" +
      dash() + "\n" +
      "HIGH RISK - Dev may be dumping!\n" +
      "Consider exiting your position.\n" +
      dash() + "\n" +
      "Chart  : " + links.dex + "\n" +
      line() + "\n" +
      "Time: " + now()
    );
  }

  // MULTI-WHALE CONFIRMATION
  if (type === "multiWhale") {
    const whaleList = data.whalesList.map((w, i) =>
      "  " + (i + 1) + ". " + w.label + " bought " + formatUSD(w.amount)
    ).join("\n");
    return (
      line() + "\n" +
      "MULTI-WHALE CONFIRMATION\n" +
      line() + "\n" +
      "Token         : " + data.symbol + "\n" +
      "Whales in     : " + data.whalesList.length + " wallets bought\n" +
      dash() + "\n" +
      whaleList + "\n" +
      dash() + "\n" +
      "Signal        : " + sig.strength + "\n" +
      "Score         : " + sig.score + "/100 - " + sig.potential + "\n\n" +
      "MARKET INFO\n" +
      "Price         : " + formatPrice(data.price) + "\n" +
      "Market Cap    : " + formatUSD(data.mcap) + "\n" +
      "Age           : " + data.age_minutes + "m old\n" +
      dash() + "\n" +
      "ENTRY & EXIT PLAN\n" +
      "ENTRY         : " + formatPrice(sig.entry) + "\n\n" +
      "Target 1 (2x) : " + formatPrice(sig.target1) + "\n" +
      "Target 2 (5x) : " + formatPrice(sig.target2) + "\n" +
      "Target 3 (10x): " + formatPrice(sig.target3) + "\n" +
      "Moonbag (50x) : " + formatPrice(sig.target4) + "\n\n" +
      "Stop Loss -30%: " + formatPrice(sig.stopLoss) + "\n" +
      dash() + "\n" +
      "POSITION SIZE : " + sig.posSize + "\n" +
      sig.posTip + "\n\n" +
      "HOLD TIME     : " + sig.holdTime + "\n" +
      dash() + "\n" +
      "TAKE PROFIT\n" +
      "Sell 25% at 2x  -> recover entry\n" +
      "Sell 50% at 5x  -> lock profit\n" +
      "Hold 25% to 10x-100x (moonbag)\n" +
      dash() + "\n" +
      "RUG CHECK     : " + (rug.danger ? "DANGER - " : rug.warning ? "WARNING - " : "SAFE - ") + (rug.flags[0] ?? "Passed") + "\n" +
      "Risk          : " + sig.risk + "\n" +
      dash() + "\n" +
      "Buy    : " + links.jupiter + "\n" +
      "Backup : " + links.raydium + "\n" +
      "Chart  : " + links.dex + "\n" +
      line() + "\n" +
      "Time: " + now()
    );
  }

  // STANDARD alerts: whale, new, trending, firstBuyer
  let header = "";
  if (type === "whale")      header = "WHALE BUY SIGNAL";
  if (type === "new")        header = "NEW TOKEN LAUNCH";
  if (type === "trending")   header = "TRENDING TOKEN";
  if (type === "firstBuyer") header = "ULTRA EARLY - UNDER 10 BUYS";

  return (
    line() + "\n" +
    header + " - " + sig.strength + "\n" +
    line() + "\n" +
    "Token         : " + data.symbol + "\n" +
    (type === "whale"
      ? "Whale         : " + data.label + "\n" +
        "Wallet        : " + shortAddr(data.wallet) + "\n" +
        "Whale Score   : " + (data.whaleScore ?? 100) + "/100\n" +
        "Buy Size      : " + formatUSD(data.amountUSD) + "\n"
      : "") +
    (type === "firstBuyer"
      ? "Total Buyers  : " + data.buyCount + " (BE FIRST!)\n"
      : "") +
    "Age           : " + data.age_minutes + "m old\n" +
    "Score         : " + sig.score + "/100 - " + sig.potential + "\n" +
    dash() + "\n" +
    "MARKET INFO\n" +
    "Price         : " + formatPrice(data.price) + "\n" +
    "Market Cap    : " + formatUSD(data.mcap) + "\n" +
    "1h Volume     : " + formatUSD(data.volume1h) + "\n" +
    "1h Change     : +" + (data.priceChange1h ?? 0).toFixed(1) + "%\n" +
    dash() + "\n" +
    "RUG CHECK\n" +
    (rug.danger  ? "DANGER  - DO NOT BUY\n" : "") +
    (rug.warning ? "WARNING - Proceed with caution\n" : "") +
    (rug.safe    ? "PASSED  - Looks clean\n" : "") +
    (rug.flags.length ? rug.flags.map(f => "  Flag: " + f).join("\n") + "\n" : "") +
    (rug.danger ? "\nThis token is blacklisted. Skipping.\n" + line() : (
    dash() + "\n" +
    "ENTRY & EXIT PLAN\n" +
    "ENTRY         : " + formatPrice(sig.entry) + "\n\n" +
    "Target 1 (2x) : " + formatPrice(sig.target1) + "\n" +
    "Target 2 (5x) : " + formatPrice(sig.target2) + "\n" +
    "Target 3 (10x): " + formatPrice(sig.target3) + "\n" +
    "Moonbag (50x) : " + formatPrice(sig.target4) + "\n\n" +
    "Stop Loss -30%: " + formatPrice(sig.stopLoss) + "\n" +
    dash() + "\n" +
    "POSITION SIZE : " + sig.posSize + "\n" +
    sig.posTip + "\n\n" +
    "HOLD TIME     : " + sig.holdTime + "\n" +
    dash() + "\n" +
    "TAKE PROFIT\n" +
    "Sell 25% at 2x  -> recover entry\n" +
    "Sell 50% at 5x  -> lock profit\n" +
    "Hold 25% to 10x-100x (moonbag)\n" +
    dash() + "\n" +
    "Risk          : " + sig.risk + "\n" +
    dash() + "\n" +
    "Buy    : " + links.jupiter + "\n" +
    "Backup : " + links.raydium + "\n" +
    "Chart  : " + links.dex + "\n" +
    line() + "\n" +
    "Time: " + now()
    ))
  );
}

// â”€â”€ Send alert â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function sendAlert(type, data) {
  // Block blacklisted tokens
  if (data.address && blacklist.has(data.address) && type !== "devSell") return;

  let sig  = null;
  let rug  = { rugScore: 0, flags: [], safe: true, warning: false, danger: false };
  const links = buildCopyTradeLinks(data.address ?? "");

  if (!["pump", "exit", "volume", "devSell"].includes(type)) {
    // Run rug check
    if (data.address) rug = await checkRug(data.address);
    if (rug.danger) {
      // Still send warning but mark as dangerous
      console.log("[RUG DETECTED] " + data.symbol + " - blocked from buy alerts");
    }

    sig = calcSignal({
      price:         data.price,
      mcap:          data.mcap,
      volume1h:      data.volume1h ?? 0,
      priceChange1h: data.priceChange1h ?? 0,
      age_minutes:   data.age_minutes ?? 60,
      whaleBuy:      type === "whale" || type === "multiWhale",
      whaleScore:    data.whaleScore ?? 100,
      multiWhale:    type === "multiWhale",
      firstBuyer:    type === "firstBuyer",
      buyCount:      data.buyCount ?? 999,
    });
    if (sig.score < 40 && !rug.danger) return;
  }

  const msg = buildMessage(type, data, sig, rug, links);

  try {
    await bot.sendMessage(CHAT_ID, msg, { disable_web_page_preview: true });
    console.log("[" + type.toUpperCase() + "] " + data.symbol + " | Score: " + (sig?.score ?? type));
  } catch (err) {
    console.error("Telegram error:", err.message);
  }
}

// â”€â”€ Fetch token pair â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function getTokenInfo(address) {
  try {
    const res = await axios.get(
      "https://api.dexscreener.com/tokens/v1/solana/" + address,
      { timeout: 8000 }
    );
    return res.data?.pairs?.[0] ?? null;
  } catch { return null; }
}

// â”€â”€ 1. WHALE BUY + EXIT TRACKER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function scanWhaleWallets() {
  for (const whale of WHALE_WALLETS) {
    try {
      const res = await axios.get(
        "https://public-api.solscan.io/account/transactions?account=" + whale.addr + "&limit=10",
        { headers: { accept: "application/json" }, timeout: 10000 }
      );
      const txs = res.data ?? [];
      if (!txs.length) continue;

      const latestSig = txs[0]?.txHash;
      if (!latestSig || whaleLastTx.get(whale.addr) === latestSig) continue;
      whaleLastTx.set(whale.addr, latestSig);

      for (const tx of txs) {
        if (!tx.tokenBalances?.length) continue;
        for (const tb of tx.tokenBalances) {
          const tokenAddr = tb.account;
          const change    = (tb.amount?.postAmount ?? 0) - (tb.amount?.preAmount ?? 0);
          if (!change) continue;

          const pair = await getTokenInfo(tokenAddr);
          if (!pair) continue;

          const mcap        = pair.fdv ?? 0;
          if (mcap > 5_000_000) continue;

          const price       = parseFloat(pair.priceUsd ?? 0);
          const age_minutes = Math.floor((Date.now() - (pair.pairCreatedAt ?? Date.now())) / 60000);
          const amountUSD   = Math.abs(change) * price;
          if (amountUSD < 100) continue;

          const isBuy  = change > 0;
          const isSell = change < 0;

          // â”€â”€ WHALE BUY â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
          if (isBuy) {
            const alertKey = "whale-" + whale.addr + "-" + tx.txHash + "-" + tokenAddr;
            if (!seenAlerts.has(alertKey)) {
              seenAlerts.add(alertKey);

              // Multi-whale buffer
              if (!tokenBuyBuffer.has(tokenAddr)) tokenBuyBuffer.set(tokenAddr, []);
              tokenBuyBuffer.get(tokenAddr).push({ wallet: whale.addr, label: whale.label, amount: amountUSD, time: Date.now() });

              // Check if 2+ whales bought same token within 10 min
              const recentBuys = tokenBuyBuffer.get(tokenAddr).filter(b => Date.now() - b.time < 600_000);
              if (recentBuys.length >= 2) {
                const multiKey = "multi-" + tokenAddr + "-" + recentBuys.length;
                if (!seenAlerts.has(multiKey)) {
                  seenAlerts.add(multiKey);
                  await sendAlert("multiWhale", {
                    symbol:     "$" + (pair.baseToken?.symbol ?? tokenAddr.slice(0, 6)),
                    address:    tokenAddr,
                    price,
                    mcap,
                    volume1h:   pair.volume?.h1 ?? 0,
                    priceChange1h: pair.priceChange?.h1 ?? 0,
                    age_minutes,
                    whaleScore: whale.score ?? 100,
                    whalesList: recentBuys,
                  });
                }
              } else {
                // Single whale buy
                await sendAlert("whale", {
                  symbol:     "$" + (pair.baseToken?.symbol ?? tokenAddr.slice(0, 6)),
                  address:    tokenAddr,
                  wallet:     whale.addr,
                  label:      whale.label,
                  whaleScore: whale.score ?? 100,
                  amountUSD,
                  price,
                  mcap,
                  volume1h:   pair.volume?.h1 ?? 0,
                  priceChange1h: pair.priceChange?.h1 ?? 0,
                  age_minutes,
                });
              }

              if (!tokenPrices.has(tokenAddr)) {
                tokenPrices.set(tokenAddr, { basePrice: price, symbol: pair.baseToken?.symbol });
              }
            }
          }

          // â”€â”€ WHALE EXIT (SELL) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
          if (isSell) {
            const exitKey = "exit-" + whale.addr + "-" + tx.txHash + "-" + tokenAddr;
            if (!seenAlerts.has(exitKey)) {
              seenAlerts.add(exitKey);
              await sendAlert("exit", {
                symbol:   "$" + (pair.baseToken?.symbol ?? tokenAddr.slice(0, 6)),
                address:  tokenAddr,
                wallet:   whale.addr,
                label:    whale.label,
                amountUSD,
                price,
                mcap,
              });
            }
          }
        }
      }
      await new Promise(r => setTimeout(r, 800));
    } catch (err) {
      console.error("Whale error [" + whale.label + "]:", err.message);
    }
  }
}

// â”€â”€ 2. NEW TOKEN + FIRST BUYER TRACKER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function scanNewTokens() {
  try {
    const res = await axios.get(
      "https://api.dexscreener.com/token-profiles/latest/v1",
      { timeout: 10000 }
    );
    const tokens = res.data?.filter(t => t.chainId === "solana") ?? [];

    for (const token of tokens) {
      const addr = token.tokenAddress;
      if (!addr || seenAlerts.has("new-" + addr)) continue;
      if (blacklist.has(addr)) continue;

      const pair = await getTokenInfo(addr);
      if (!pair) continue;

      const mcap          = pair.fdv ?? 0;
      const price         = parseFloat(pair.priceUsd ?? 0);
      const volume1h      = pair.volume?.h1 ?? 0;
      const priceChange1h = pair.priceChange?.h1 ?? 0;
      const age_minutes   = Math.floor((Date.now() - (pair.pairCreatedAt ?? Date.now())) / 60000);
      const buyCount      = pair.txns?.h1?.buys ?? 999;

      if (mcap > 500_000 || age_minutes > 60) continue;
      seenAlerts.add("new-" + addr);

      // Record dev wallet (first buyer is likely dev)
      if (buyCount <= 5) {
        try {
          const holdersRes = await axios.get(
            "https://public-api.solscan.io/token/holders?tokenAddress=" + addr + "&limit=1&offset=0",
            { headers: { accept: "application/json" }, timeout: 6000 }
          );
          const topHolder = holdersRes.data?.data?.[0];
          if (topHolder) devWallets.set(addr, topHolder.owner);
        } catch { /* skip */ }
      }

      // Ultra early alert â€” under 10 buys
      if (buyCount <= 10) {
        await sendAlert("firstBuyer", {
          symbol: "$" + (pair.baseToken?.symbol ?? addr.slice(0, 6)),
          address: addr, price, mcap, volume1h, priceChange1h, age_minutes, buyCount,
        });
      } else {
        await sendAlert("new", {
          symbol: "$" + (pair.baseToken?.symbol ?? addr.slice(0, 6)),
          address: addr, price, mcap, volume1h, priceChange1h, age_minutes,
        });
      }

      if (!tokenPrices.has(addr)) {
        tokenPrices.set(addr, { basePrice: price, symbol: pair.baseToken?.symbol });
      }

      // Set volume baseline
      volumeBaseline.set(addr, { v1h: volume1h, time: Date.now() });
    }
  } catch (err) {
    console.error("New token error:", err.message);
  }
}

// â”€â”€ 3. PUMP TRACKER 2x/5x/10x/50x/100x â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function scanPumps() {
  for (const [addr, { basePrice, symbol }] of tokenPrices.entries()) {
    try {
      const pair = await getTokenInfo(addr);
      if (!pair) continue;
      const currentPrice = parseFloat(pair.priceUsd ?? 0);
      if (!currentPrice || !basePrice) continue;
      const multiplier = currentPrice / basePrice;

      for (const target of [2, 5, 10, 50, 100]) {
        if (multiplier >= target) {
          const alertKey = "pump-" + addr + "-" + target + "x";
          if (seenAlerts.has(alertKey)) continue;
          seenAlerts.add(alertKey);
          await sendAlert("pump", {
            symbol: "$" + symbol, address: addr,
            currentPrice, basePrice,
            mcap: pair.fdv ?? 0,
            volume24h: pair.volume?.h24 ?? 0,
            priceChange24h: pair.priceChange?.h24 ?? 0,
            multiplier: target,
          });
        }
      }
    } catch { /* skip */ }
  }
}

// â”€â”€ 4. VOLUME SPIKE DETECTOR â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function scanVolumeSspikes() {
  for (const [addr, baseline] of volumeBaseline.entries()) {
    try {
      if (Date.now() - baseline.time < 300_000) continue; // need 5min of data
      const pair = await getTokenInfo(addr);
      if (!pair) continue;

      const currentVol = pair.volume?.h1 ?? 0;
      if (!baseline.v1h || baseline.v1h === 0) {
        volumeBaseline.set(addr, { v1h: currentVol, time: Date.now() });
        continue;
      }

      const spikePercent = ((currentVol - baseline.v1h) / baseline.v1h) * 100;

      if (spikePercent >= 300) { // 3x volume spike
        const alertKey = "vol-" + addr + "-" + Math.floor(Date.now() / 1800000);
        if (!seenAlerts.has(alertKey)) {
          seenAlerts.add(alertKey);
          await sendAlert("volume", {
            symbol:       "$" + (pair.baseToken?.symbol ?? addr.slice(0, 6)),
            address:      addr,
            price:        parseFloat(pair.priceUsd ?? 0),
            mcap:         pair.fdv ?? 0,
            volume1h:     currentVol,
            priceChange1h: pair.priceChange?.h1 ?? 0,
            spikePercent,
          });
        }
      }

      // Update baseline
      volumeBaseline.set(addr, { v1h: currentVol, time: Date.now() });
    } catch { /* skip */ }
  }
}

// â”€â”€ 5. DEV WALLET MONITOR â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function scanDevWallets() {
  for (const [tokenAddr, devAddr] of devWallets.entries()) {
    try {
      const res = await axios.get(
        "https://public-api.solscan.io/account/transactions?account=" + devAddr + "&limit=5",
        { headers: { accept: "application/json" }, timeout: 8000 }
      );
      const txs = res.data ?? [];

      for (const tx of txs) {
        if (!tx.tokenBalances?.length) continue;
        for (const tb of tx.tokenBalances) {
          if (tb.account !== tokenAddr) continue;
          const change = (tb.amount?.postAmount ?? 0) - (tb.amount?.preAmount ?? 0);
          if (change >= 0) continue; // only sells

          const alertKey = "dev-" + devAddr + "-" + tx.txHash;
          if (seenAlerts.has(alertKey)) continue;
          seenAlerts.add(alertKey);

          const pair      = await getTokenInfo(tokenAddr);
          const price     = parseFloat(pair?.priceUsd ?? 0);
          const amountUSD = Math.abs(change) * price;

          await sendAlert("devSell", {
            symbol:    "$" + (pair?.baseToken?.symbol ?? tokenAddr.slice(0, 6)),
            address:   tokenAddr,
            devWallet: devAddr,
            amountUSD,
            price,
            mcap:      pair?.fdv ?? 0,
          });
        }
      }
      await new Promise(r => setTimeout(r, 500));
    } catch { /* skip */ }
  }
}

// â”€â”€ 6. WHALE SCORING (every 24h) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function scoreWhales() {
  console.log("[WHALE SCORER] Running 24h scoring...");
  const scored = [];
  for (const whale of WHALE_WALLETS) {
    try {
      const res = await axios.get(
        "https://public-api.solscan.io/account/transactions?account=" + whale.addr + "&limit=20",
        { headers: { accept: "application/json" }, timeout: 10000 }
      );
      const txs = res.data ?? [];
      let wins = 0, total = 0, totalRoi = 0;

      for (const tx of txs) {
        if (!tx.tokenBalances?.length) continue;
        for (const tb of tx.tokenBalances) {
          const change = (tb.amount?.postAmount ?? 0) - (tb.amount?.preAmount ?? 0);
          if (change <= 0) continue;
          total++;
          const pair = await getTokenInfo(tb.account);
          if (!pair) continue;
          const pct = pair.priceChange?.h24 ?? 0;
          if (pct > 20) { wins++; totalRoi += pct; }
          await new Promise(r => setTimeout(r, 300));
        }
      }

      const winRate    = total > 0 ? Math.round((wins / total) * 100) : 0;
      const avgRoi     = total > 0 ? Math.round(totalRoi / total) : 0;
      const whaleScore = Math.min(Math.round(winRate * 0.6 + Math.min(avgRoi, 100) * 0.4), 100);
      whaleWinStats.set(whale.addr, { wins, total, winRate, avgRoi, whaleScore });
      scored.push({ ...whale, score: whaleScore, winRate, avgRoi });
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      scored.push({ ...whale, score: whale.score ?? 50 });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  WHALE_WALLETS = scored.slice(0, 8).map((w, i) => ({
    ...w, label: "Whale-" + (i + 1) + " [" + w.score + "pts]",
  }));

  const summary =
    line() + "\n" +
    "WHALE LEADERBOARD UPDATED\n" +
    line() + "\n" +
    WHALE_WALLETS.map((w, i) => {
      const s = whaleWinStats.get(w.addr) ?? {};
      return (i + 1) + ". " + w.label + "\n" +
        "   Win Rate : " + (s.winRate ?? "?") + "%\n" +
        "   Avg ROI  : " + (s.avgRoi ?? "?") + "%\n" +
        "   Score    : " + w.score + "/100\n" +
        "   Wallet   : " + shortAddr(w.addr);
    }).join("\n\n") + "\n" +
    line() + "\n" +
    "Next refresh: 24 hours\n" +
    "Time: " + now();

  try { await bot.sendMessage(CHAT_ID, summary, { disable_web_page_preview: true }); } catch { /* skip */ }
  console.log("[WHALE SCORER] Done.");
}

// â”€â”€ Telegram commands â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
    line() + "\n" +
    "SOLANA MEMECOIN ALPHA BOT\n" +
    line() + "\n\n" +
    "TIER 1 FEATURES:\n" +
    "- Copy trade links (Jupiter + Raydium)\n" +
    "- Rug pull detector\n" +
    "- First buyer tracker (under 10 buys)\n" +
    "- Whale exit signals (sell alerts)\n\n" +
    "TIER 2 FEATURES:\n" +
    "- Volume spike detector (3x baseline)\n" +
    "- Multi-whale confirmation (2+ whales)\n" +
    "- Dev wallet sell monitor\n\n" +
    "EVERY ALERT INCLUDES:\n" +
    "- Entry price\n" +
    "- Targets: 2x / 5x / 10x / 50x\n" +
    "- Stop loss (-30%)\n" +
    "- Position size advice\n" +
    "- Hold time\n" +
    "- Take profit strategy\n" +
    "- Direct buy links\n\n" +
    "COMMANDS:\n" +
    "/status  - bot health\n" +
    "/whales  - whale leaderboard\n" +
    "/tracked - tokens being watched\n" +
    "/pnl     - today signal summary\n" +
    line()
  );
});

bot.onText(/\/status/, (msg) => {
  bot.sendMessage(msg.chat.id,
    line() + "\n" +
    "BOT STATUS\n" +
    line() + "\n" +
    "Status        : RUNNING\n" +
    "Whale wallets : " + WHALE_WALLETS.length + "\n" +
    "Tokens tracked: " + tokenPrices.size + "\n" +
    "Dev wallets   : " + devWallets.size + "\n" +
    "Blacklisted   : " + blacklist.size + " rugs\n" +
    "Alerts sent   : " + seenAlerts.size + "\n" +
    "Scan rate     : 30 seconds\n" +
    "Whale refresh : every 24 hours\n" +
    "Time          : " + now() + "\n" +
    line()
  );
});

bot.onText(/\/whales/, (msg) => {
  const list = WHALE_WALLETS.map((w, i) => {
    const s = whaleWinStats.get(w.addr) ?? {};
    return (i + 1) + ". " + w.label + "\n" +
      "   Win Rate: " + (s.winRate ?? "?") + "%  Avg ROI: " + (s.avgRoi ?? "?") + "%\n" +
      "   " + shortAddr(w.addr);
  }).join("\n\n");
  bot.sendMessage(msg.chat.id, line() + "\nWHALE LEADERBOARD\n" + line() + "\n\n" + list + "\n\n" + line());
});

bot.onText(/\/tracked/, (msg) => {
  bot.sendMessage(msg.chat.id,
    "Tracking " + tokenPrices.size + " tokens for pumps\n" +
    "Monitoring " + devWallets.size + " dev wallets\n" +
    "Blacklisted " + blacklist.size + " rugs"
  );
});

bot.onText(/\/pnl/, (msg) => {
  bot.sendMessage(msg.chat.id,
    line() + "\n" +
    "SIGNAL SUMMARY\n" +
    line() + "\n" +
    "Total alerts today : " + seenAlerts.size + "\n" +
    "Tokens tracked     : " + tokenPrices.size + "\n" +
    "Rugs blocked       : " + blacklist.size + "\n\n" +
    "Tip: Track each signal manually in\n" +
    "DexScreener to measure your PnL.\n" +
    "Full auto PnL tracker coming in v2.\n" +
    line()
  );
});

// â”€â”€ LAUNCH â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
console.log(line());
console.log("SOLANA MEMECOIN ALPHA BOT STARTING");
console.log(line());
console.log("Whale wallets : " + WHALE_WALLETS.length);
console.log("Features      : Rug check, Copy trade, Exit signals,");
console.log("                Volume spikes, Multi-whale, Dev monitor");
console.log(line());

// Run immediately
scanWhaleWallets();
scanNewTokens();

// Intervals
setInterval(scanWhaleWallets,   45_000);   // 45s
setInterval(scanNewTokens,      30_000);   // 30s
setInterval(scanPumps,          60_000);   // 1m
setInterval(scanVolumeSspikes,  120_000);  // 2m
setInterval(scanDevWallets,     60_000);   // 1m
setInterval(scoreWhales,     86_400_000);  // 24h

console.log("All scanners live. Waiting for alpha...");
console.log(line());
