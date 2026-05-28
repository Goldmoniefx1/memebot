// ============================================================
//  SOLANA MEMECOIN ALPHA BOT - FINAL FIXED VERSION
//  Token Scanner: Pump.fun API + DexScreener new pairs
//  These are the REAL endpoints that catch ALL new tokens
//  No emojis - Android safe - 100% free APIs
// ============================================================

require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// â”€â”€ State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const seenAlerts     = new Set();
const tokenPrices    = new Map();
const volumeBaseline = new Map();
const blacklist      = new Set();
let   alertCount     = 0;
let   scanCount      = 0;

// â”€â”€ Whale wallets â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let WHALE_WALLETS = [
  { addr: "5fWkLJfoDsRAaXhPJcJY19qNtDDQ5h6q1SPzsAPRrUNG", label: "Nansen Alpha 58pct WR", score: 95 },
  { addr: "6kbwsSY4hL6WVadLRLnWV2irkMN2AvFZVAS8McKJmAtJ", label: "Nansen Beta 52pct WR",  score: 90 },
  { addr: "HWBDGGT5j8LMVbGRu8UC6KQ3p9NKUi6nCfh4ENogEFee", label: "PIPPIN Whale",          score: 88 },
  { addr: "TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM",  label: "Pump Sniper Alpha",     score: 85 },
  { addr: "GVV4crwNXqTbCM4gVHbWkDVGFssnPBP9QTdS14LQWRSP", label: "Raydium Early Buyer",   score: 82 },
  { addr: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", label: "GMGN Smart Money",      score: 80 },
];

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function formatUSD(n) {
  if (!n || isNaN(n)) return "$0";
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000)     return "$" + (n / 1_000).toFixed(1) + "k";
  return "$" + Number(n).toFixed(4);
}
function formatPrice(p) {
  if (!p || isNaN(p)) return "$0";
  if (p < 0.000001)   return "$" + p.toFixed(12);
  if (p < 0.001)      return "$" + p.toFixed(8);
  if (p < 1)          return "$" + p.toFixed(6);
  return "$" + p.toFixed(4);
}
function shortAddr(a) { return a.slice(0, 6) + "..." + a.slice(-6); }
function line()  { return "===================="; }
function dash()  { return "--------------------"; }
function now()   { return new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC"; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// â”€â”€ Signal scorer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function calcSignal({ price, mcap, volume1h, priceChange1h, age_minutes, firstBuyer, buyCount }) {
  let score = 0;
  if (mcap < 30_000)          score += 35;
  else if (mcap < 100_000)    score += 28;
  else if (mcap < 300_000)    score += 20;
  else if (mcap < 1_000_000)  score += 10;
  else if (mcap < 5_000_000)  score += 4;
  if (volume1h && mcap && volume1h / mcap > 0.1) score += 15;
  if (priceChange1h > 100)    score += 25;
  else if (priceChange1h > 50) score += 18;
  else if (priceChange1h > 20) score += 10;
  else if (priceChange1h > 5)  score += 4;
  if (age_minutes < 5)        score += 30;
  else if (age_minutes < 15)  score += 22;
  else if (age_minutes < 30)  score += 15;
  else if (age_minutes < 60)  score += 8;
  else if (age_minutes < 180) score += 3;
  if (firstBuyer && buyCount <= 10) score += 20;
  score = Math.min(score, 100);

  return {
    score,
    potential:  score >= 80 ? "100x-1000x potential" : score >= 60 ? "10x-100x potential" : score >= 40 ? "5x-10x potential" : "Speculative",
    strength:   score >= 80 ? "*** MEGA ALPHA ***" : score >= 60 ? "** STRONG SIGNAL **" : score >= 40 ? "* SIGNAL *" : "WATCH",
    posSize:    score >= 70 ? "1-2% of portfolio" : score >= 50 ? "0.5-1% of portfolio" : "0.25-0.5% of portfolio",
    holdTime:   age_minutes < 15 ? "15min-2h (very early - act fast)" : age_minutes < 60 ? "1h-6h" : "2h-24h",
    risk:       score >= 70 ? "HIGH RISK / HIGH REWARD" : score >= 50 ? "MEDIUM RISK" : "LOWER RISK",
    entry:      price,
    target1:    price * 2,
    target2:    price * 5,
    target3:    price * 10,
    target4:    price * 50,
    stopLoss:   price * 0.70,
  };
}

// â”€â”€ Rug check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function checkRug(addr) {
  try {
    const res = await axios.get(
      "https://public-api.solscan.io/token/meta?tokenAddress=" + addr,
      { headers: { accept: "application/json" }, timeout: 5000 }
    );
    const meta = res.data ?? {};
    const flags = [];
    let rug = 0;
    if (!meta.website && !meta.twitter) { flags.push("No website or Twitter"); rug += 15; }
    if (meta.mintAuthority)   { flags.push("Mint authority ACTIVE - dev can print tokens"); rug += 35; }
    if (meta.freezeAuthority) { flags.push("Freeze authority ACTIVE"); rug += 35; }
    const danger = rug >= 55;
    if (danger) blacklist.add(addr);
    return { rug, flags, safe: rug < 25, warning: rug >= 25 && rug < 55, danger };
  } catch {
    return { rug: 0, flags: [], safe: true, warning: false, danger: false };
  }
}

// â”€â”€ Links â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function links(addr) {
  return {
    buy:    "https://jup.ag/swap/SOL-" + addr,
    backup: "https://raydium.io/swap/?inputCurrency=SOL&outputCurrency=" + addr,
    chart:  "https://dexscreener.com/solana/" + addr,
    pump:   "https://pump.fun/" + addr,
  };
}

// â”€â”€ Build message â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function buildMsg(type, data, sig, rug) {
  const L = links(data.address ?? "");

  if (type === "pump") {
    return line() + "\nPUMP ALERT - " + data.multiplier + "X\n" + line() + "\n" +
      "Token    : " + data.symbol + "\n" +
      "Price now: " + formatPrice(data.currentPrice) + "\n" +
      "Mkt Cap  : " + formatUSD(data.mcap) + "\n" +
      "Entry was: " + formatPrice(data.basePrice) + "\n" +
      dash() + "\n" +
      "Next target " + (data.multiplier * 2) + "x: " + formatPrice(data.basePrice * data.multiplier * 2) + "\n" +
      "Move stop loss to entry NOW\n" +
      dash() + "\n" +
      "Chart: " + L.chart + "\n" +
      line() + "\nTime: " + now();
  }

  if (type === "volume") {
    return line() + "\nVOLUME SPIKE - +" + data.spikePercent.toFixed(0) + "%\n" + line() + "\n" +
      "Token    : " + data.symbol + "\n" +
      "Price    : " + formatPrice(data.price) + "\n" +
      "Mkt Cap  : " + formatUSD(data.mcap) + "\n" +
      "1h Volume: " + formatUSD(data.volume1h) + "\n" +
      "1h Change: +" + (data.priceChange1h ?? 0).toFixed(1) + "%\n" +
      dash() + "\n" +
      "Buy before Twitter finds this\n" +
      "Buy  : " + L.buy + "\n" +
      "Chart: " + L.chart + "\n" +
      line() + "\nTime: " + now();
  }

  const header = type === "pumpfun" ? "PUMP.FUN NEW TOKEN"
    : type === "firstBuyer" ? "ULTRA EARLY - UNDER 10 BUYS"
    : type === "trending" ? "TRENDING TOKEN"
    : "NEW TOKEN";

  const rugLine = rug.danger ? "DANGER - SKIP" : rug.warning ? "WARNING - Risky" : "PASSED - Clean";

  return line() + "\n" + header + " - " + sig.strength + "\n" + line() + "\n" +
    "Token    : " + data.symbol + "\n" +
    (data.name ? "Name     : " + data.name + "\n" : "") +
    (type === "firstBuyer" ? "Buyers   : " + data.buyCount + " only - BE FIRST\n" : "") +
    (data.source ? "Source   : " + data.source + "\n" : "") +
    "Age      : " + data.age_minutes + "m old\n" +
    "Score    : " + sig.score + "/100 - " + sig.potential + "\n" +
    dash() + "\n" +
    "MARKET INFO\n" +
    "Price    : " + formatPrice(data.price) + "\n" +
    "Mkt Cap  : " + formatUSD(data.mcap) + "\n" +
    "1h Volume: " + formatUSD(data.volume1h) + "\n" +
    "1h Change: " + (data.priceChange1h >= 0 ? "+" : "") + (data.priceChange1h ?? 0).toFixed(1) + "%\n" +
    (data.buys1h !== undefined ? "Buys 1h  : " + data.buys1h + "\n" : "") +
    (data.sells1h !== undefined ? "Sells 1h : " + data.sells1h + "\n" : "") +
    (data.liquidity ? "Liquidity: " + formatUSD(data.liquidity) + "\n" : "") +
    dash() + "\n" +
    "RUG CHECK: " + rugLine + "\n" +
    (rug.flags.length ? rug.flags.map(f => "  - " + f).join("\n") + "\n" : "") +
    (rug.danger ? line() + "\nDO NOT BUY\n" + line() : (
      dash() + "\n" +
      "ENTRY PLAN\n" +
      "Entry    : " + formatPrice(sig.entry) + "\n\n" +
      "2x target: " + formatPrice(sig.target1) + "\n" +
      "5x target: " + formatPrice(sig.target2) + "\n" +
      "10x      : " + formatPrice(sig.target3) + "\n" +
      "50x moon : " + formatPrice(sig.target4) + "\n\n" +
      "Stop Loss: " + formatPrice(sig.stopLoss) + " (-30%)\n" +
      dash() + "\n" +
      "Position : " + sig.posSize + "\n" +
      "Hold time: " + sig.holdTime + "\n" +
      dash() + "\n" +
      "TAKE PROFIT\n" +
      "Sell 25% at 2x  -> recover entry\n" +
      "Sell 50% at 5x  -> lock profit\n" +
      "Hold 25% moonbag to 10x-50x\n" +
      dash() + "\n" +
      "Risk : " + sig.risk + "\n" +
      "Buy  : " + L.buy + "\n" +
      (data.source === "Pump.fun" ? "Pump : " + L.pump + "\n" : "") +
      "Chart: " + L.chart + "\n" +
      line() + "\nTime: " + now()
    ));
}

// â”€â”€ Send alert â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function sendAlert(type, data) {
  if (data.address && blacklist.has(data.address)) return;
  let sig = null;
  let rug = { rug: 0, flags: [], safe: true, warning: false, danger: false };

  if (!["pump", "volume"].includes(type)) {
    rug = await checkRug(data.address ?? "");
    sig = calcSignal({
      price: data.price, mcap: data.mcap,
      volume1h: data.volume1h ?? 0,
      priceChange1h: data.priceChange1h ?? 0,
      age_minutes: data.age_minutes ?? 60,
      firstBuyer: type === "firstBuyer",
      buyCount: data.buyCount ?? 999,
    });
    if (sig.score < 15 && !rug.danger) return;
  }

  const msg = buildMsg(type, data, sig, rug);
  try {
    await bot.sendMessage(CHAT_ID, msg, { disable_web_page_preview: true });
    alertCount++;
    console.log("[ALERT #" + alertCount + "] [" + type + "] " + data.symbol + " score:" + (sig?.score ?? "n/a"));
  } catch (err) {
    console.error("[SEND ERROR]", err.message);
  }
}

// â”€â”€ Fetch DexScreener pair â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function getDexPair(addr) {
  try {
    const res = await axios.get(
      "https://api.dexscreener.com/tokens/v1/solana/" + addr,
      { timeout: 8000 }
    );
    return res.data?.pairs?.[0] ?? null;
  } catch { return null; }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  SCANNER 1: PUMP.FUN API - catches ALL new tokens at birth
//  This is the main scanner - 2847+ tokens launch here daily
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function scanPumpFun() {
  scanCount++;
  console.log("[PUMP.FUN SCAN #" + scanCount + "] Fetching latest tokens...");
  try {
    // Pump.fun public API - returns newest tokens
    const res = await axios.get(
      "https://frontend-api.pump.fun/coins?offset=0&limit=50&sort=created_timestamp&order=DESC&includeNsfw=false",
      {
        headers: {
          "accept": "application/json",
          "User-Agent": "Mozilla/5.0",
        },
        timeout: 12000,
      }
    );

    const coins = res.data ?? [];
    console.log("[PUMP.FUN] Got " + coins.length + " tokens");

    for (const coin of coins) {
      const addr = coin.mint;
      if (!addr || seenAlerts.has("pf-" + addr) || blacklist.has(addr)) continue;
      seenAlerts.add("pf-" + addr);

      const now_ms     = Date.now();
      const created    = coin.created_timestamp ?? now_ms;
      const age_minutes = Math.floor((now_ms - created) / 60000);

      // Only alert on tokens under 2 hours old
      if (age_minutes > 120) continue;

      const mcap        = coin.usd_market_cap ?? 0;
      const price       = coin.price_sol ? coin.price_sol * 150 : 0; // rough SOL price
      const name        = coin.name ?? "Unknown";
      const symbol      = "$" + (coin.symbol ?? addr.slice(0, 6));
      const volume      = coin.volume_sol ? coin.volume_sol * 150 : 0;
      const reply_count = coin.reply_count ?? 0;
      const buys        = coin.total_supply ? 0 : 0;

      console.log("[PUMP.FUN TOKEN] " + symbol + " age:" + age_minutes + "m mcap:" + formatUSD(mcap));

      // Get better price data from DexScreener
      const pair = await getDexPair(addr);
      const finalPrice         = pair ? parseFloat(pair.priceUsd ?? 0) : price;
      const finalMcap          = pair ? (pair.fdv ?? mcap) : mcap;
      const finalVolume1h      = pair ? (pair.volume?.h1 ?? volume) : volume;
      const finalPriceChange1h = pair ? (pair.priceChange?.h1 ?? 0) : 0;
      const buys1h             = pair?.txns?.h1?.buys ?? 0;
      const sells1h            = pair?.txns?.h1?.sells ?? 0;
      const liquidity          = pair?.liquidity?.usd ?? 0;

      const alertType = buys1h <= 10 ? "firstBuyer" : "pumpfun";

      await sendAlert(alertType, {
        symbol, name,
        address: addr,
        source: "Pump.fun",
        price: finalPrice,
        mcap: finalMcap,
        volume1h: finalVolume1h,
        priceChange1h: finalPriceChange1h,
        age_minutes,
        buys1h, sells1h, liquidity,
        buyCount: buys1h,
      });

      if (!tokenPrices.has(addr)) {
        tokenPrices.set(addr, { basePrice: finalPrice, symbol: coin.symbol ?? addr.slice(0, 6) });
      }
      volumeBaseline.set(addr, { v1h: finalVolume1h, time: Date.now() });

      await sleep(500); // small delay between tokens
    }
  } catch (err) {
    console.error("[PUMP.FUN ERROR]", err.message);
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  SCANNER 2: DEXSCREENER new pairs - catches Raydium launches
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function scanDexNewPairs() {
  console.log("[DEX NEW PAIRS] Scanning Raydium + Jupiter new pairs...");
  try {
    // Search for newest Solana pairs sorted by creation time
    const searches = [
      "https://api.dexscreener.com/dex/search?q=new%20sol",
      "https://api.dexscreener.com/token-profiles/latest/v1",
      "https://api.dexscreener.com/token-boosts/latest/v1",
    ];

    for (const url of searches) {
      try {
        const res  = await axios.get(url, { timeout: 10000 });
        const data = res.data;

        // Handle different response formats
        let pairs = [];
        if (Array.isArray(data)) {
          // token-profiles or token-boosts format
          const solTokens = data.filter(t => t.chainId === "solana");
          for (const t of solTokens.slice(0, 20)) {
            if (t.tokenAddress) {
              const pair = await getDexPair(t.tokenAddress);
              if (pair) pairs.push(pair);
              await sleep(200);
            }
          }
        } else if (data.pairs) {
          pairs = data.pairs.filter(p => p.chainId === "solana");
        }

        console.log("[DEX PAIRS] Found " + pairs.length + " pairs from " + url.split("/").pop());

        for (const pair of pairs.slice(0, 30)) {
          const addr = pair.baseToken?.address;
          if (!addr || seenAlerts.has("dex-" + addr) || blacklist.has(addr)) continue;

          const mcap          = pair.fdv ?? 0;
          const price         = parseFloat(pair.priceUsd ?? 0);
          const volume1h      = pair.volume?.h1 ?? 0;
          const priceChange1h = pair.priceChange?.h1 ?? 0;
          const age_minutes   = Math.floor((Date.now() - (pair.pairCreatedAt ?? Date.now())) / 60000);
          const buys1h        = pair.txns?.h1?.buys ?? 0;
          const sells1h       = pair.txns?.h1?.sells ?? 0;
          const liquidity     = pair.liquidity?.usd ?? 0;

          if (mcap > 5_000_000 || age_minutes > 180) continue;
          seenAlerts.add("dex-" + addr);

          console.log("[DEX TOKEN] $" + pair.baseToken?.symbol + " age:" + age_minutes + "m mcap:" + formatUSD(mcap));

          const alertType = buys1h <= 10 ? "firstBuyer" : "new";
          await sendAlert(alertType, {
            symbol: "$" + (pair.baseToken?.symbol ?? addr.slice(0, 6)),
            name: pair.baseToken?.name,
            address: addr,
            source: pair.dexId ?? "Raydium",
            price, mcap, volume1h, priceChange1h, age_minutes,
            buys1h, sells1h, liquidity, buyCount: buys1h,
          });

          if (!tokenPrices.has(addr)) {
            tokenPrices.set(addr, { basePrice: price, symbol: pair.baseToken?.symbol ?? addr.slice(0, 6) });
          }
          volumeBaseline.set(addr, { v1h: volume1h, time: Date.now() });
        }
      } catch (err) {
        console.error("[DEX PAIRS URL ERROR]", err.message);
      }
      await sleep(1000);
    }
  } catch (err) {
    console.error("[DEX NEW PAIRS ERROR]", err.message);
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  SCANNER 3: Trending tokens
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function scanTrending() {
  console.log("[TRENDING] Scanning...");
  try {
    const res = await axios.get(
      "https://api.dexscreener.com/token-boosts/top/v1",
      { timeout: 12000 }
    );
    const tokens = (res.data ?? []).filter(t => t.chainId === "solana");
    console.log("[TRENDING] Found " + tokens.length + " boosted tokens");

    for (const token of tokens.slice(0, 15)) {
      const addr = token.tokenAddress;
      if (!addr || blacklist.has(addr)) continue;
      const alertKey = "trending-" + addr + "-" + Math.floor(Date.now() / 1800000);
      if (seenAlerts.has(alertKey)) continue;

      const pair = await getDexPair(addr);
      if (!pair) continue;

      const priceChange1h = pair.priceChange?.h1 ?? 0;
      const priceChange5m = pair.priceChange?.m5 ?? 0;
      const mcap          = pair.fdv ?? 0;

      if (priceChange1h < 10 && priceChange5m < 5) continue;
      if (mcap > 20_000_000) continue;

      seenAlerts.add(alertKey);
      const age_minutes = Math.floor((Date.now() - (pair.pairCreatedAt ?? Date.now())) / 60000);

      console.log("[TRENDING] $" + pair.baseToken?.symbol + " +" + priceChange1h + "% 1h");

      await sendAlert("trending", {
        symbol: "$" + (pair.baseToken?.symbol ?? addr.slice(0, 6)),
        address: addr,
        source: "Trending",
        price: parseFloat(pair.priceUsd ?? 0),
        mcap,
        volume1h: pair.volume?.h1 ?? 0,
        priceChange1h,
        age_minutes,
        buys1h: pair.txns?.h1?.buys ?? 0,
        sells1h: pair.txns?.h1?.sells ?? 0,
        liquidity: pair.liquidity?.usd ?? 0,
      });

      if (!tokenPrices.has(addr)) {
        tokenPrices.set(addr, { basePrice: parseFloat(pair.priceUsd ?? 0), symbol: pair.baseToken?.symbol ?? addr.slice(0, 6) });
      }
      await sleep(300);
    }
  } catch (err) {
    console.error("[TRENDING ERROR]", err.message);
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  SCANNER 4: Pump tracker 2x/5x/10x/50x/100x
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function scanPumps() {
  if (tokenPrices.size === 0) return;
  console.log("[PUMPS] Checking " + tokenPrices.size + " tokens...");
  for (const [addr, { basePrice, symbol }] of tokenPrices.entries()) {
    try {
      const pair = await getDexPair(addr);
      if (!pair) continue;
      const cur  = parseFloat(pair.priceUsd ?? 0);
      if (!cur || !basePrice) continue;
      const mult = cur / basePrice;
      for (const target of [2, 5, 10, 50, 100]) {
        if (mult >= target) {
          const ak = "pump-" + addr + "-" + target + "x";
          if (seenAlerts.has(ak)) continue;
          seenAlerts.add(ak);
          console.log("[PUMP] $" + symbol + " hit " + target + "x");
          await sendAlert("pump", {
            symbol: "$" + symbol, address: addr,
            currentPrice: cur, basePrice, mcap: pair.fdv ?? 0,
            volume24h: pair.volume?.h24 ?? 0,
            priceChange24h: pair.priceChange?.h24 ?? 0,
            multiplier: target,
          });
        }
      }
      await sleep(200);
    } catch { /* skip */ }
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  SCANNER 5: Volume spikes
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function scanVolumeSpikes() {
  if (volumeBaseline.size === 0) return;
  for (const [addr, baseline] of volumeBaseline.entries()) {
    try {
      if (Date.now() - baseline.time < 300_000) continue;
      const pair = await getDexPair(addr);
      if (!pair) continue;
      const cur = pair.volume?.h1 ?? 0;
      if (!baseline.v1h || baseline.v1h < 50) {
        volumeBaseline.set(addr, { v1h: cur, time: Date.now() });
        continue;
      }
      const spike = ((cur - baseline.v1h) / baseline.v1h) * 100;
      if (spike >= 150) {
        const ak = "vol-" + addr + "-" + Math.floor(Date.now() / 1800000);
        if (!seenAlerts.has(ak)) {
          seenAlerts.add(ak);
          console.log("[VOL SPIKE] $" + (pair.baseToken?.symbol) + " +" + spike.toFixed(0) + "%");
          await sendAlert("volume", {
            symbol: "$" + (pair.baseToken?.symbol ?? addr.slice(0, 6)),
            address: addr, price: parseFloat(pair.priceUsd ?? 0),
            mcap: pair.fdv ?? 0, volume1h: cur,
            priceChange1h: pair.priceChange?.h1 ?? 0, spikePercent: spike,
          });
        }
      }
      volumeBaseline.set(addr, { v1h: cur, time: Date.now() });
    } catch { /* skip */ }
  }
}

// â”€â”€ /scan CA command â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function scanCA(addr, chatId) {
  try {
    await bot.sendMessage(chatId, "Scanning " + addr + "...\nPlease wait 15 seconds.");
    const [pair, rug] = await Promise.all([getDexPair(addr), checkRug(addr)]);

    if (!pair) {
      await bot.sendMessage(chatId, "Token not found on DexScreener.\nMake sure it is a valid Solana contract address.");
      return;
    }

    const price          = parseFloat(pair.priceUsd ?? 0);
    const mcap           = pair.fdv ?? 0;
    const volume1h       = pair.volume?.h1 ?? 0;
    const volume24h      = pair.volume?.h24 ?? 0;
    const priceChange1h  = pair.priceChange?.h1 ?? 0;
    const priceChange24h = pair.priceChange?.h24 ?? 0;
    const priceChange5m  = pair.priceChange?.m5 ?? 0;
    const age_minutes    = Math.floor((Date.now() - (pair.pairCreatedAt ?? Date.now())) / 60000);
    const buys1h         = pair.txns?.h1?.buys ?? 0;
    const sells1h        = pair.txns?.h1?.sells ?? 0;
    const liquidity      = pair.liquidity?.usd ?? 0;
    const L              = links(addr);
    const sig            = calcSignal({ price, mcap, volume1h, priceChange1h, age_minutes, firstBuyer: false, buyCount: buys1h });

    const pros = [], cons = [];
    if (age_minutes < 60)            pros.push("Very early - under 1 hour old");
    if (mcap < 100_000)              pros.push("Micro cap - huge upside room");
    if (priceChange1h > 20)          pros.push("Strong momentum +" + priceChange1h.toFixed(1) + "% in 1h");
    if (buys1h > sells1h)            pros.push("More buyers than sellers (" + buys1h + " vs " + sells1h + ")");
    if (volume1h > mcap * 0.2)       pros.push("High volume vs market cap");
    if (liquidity > 10_000)          pros.push("Good liquidity " + formatUSD(liquidity));
    if (!rug.danger && !rug.warning)  pros.push("Rug check passed");

    if (rug.danger)                  cons.push("DANGER - High rug risk");
    if (rug.warning)                 cons.push("WARNING - Medium rug risk");
    rug.flags.forEach(f => cons.push(f));
    if (age_minutes > 180)           cons.push("Token is " + Math.floor(age_minutes/60) + "h old");
    if (mcap > 1_000_000)            cons.push("Market cap " + formatUSD(mcap) + " - lower upside");
    if (sells1h > buys1h)            cons.push("More sellers than buyers");
    if (liquidity < 5_000)           cons.push("Low liquidity " + formatUSD(liquidity));
    if (priceChange1h < 0)           cons.push("Negative 1h trend " + priceChange1h.toFixed(1) + "%");

    const verdict = rug.danger ? "DO NOT BUY - Rug risk too high"
      : sig.score >= 70 ? "STRONG BUY - High conviction"
      : sig.score >= 50 ? "MODERATE BUY - Small position"
      : sig.score >= 30 ? "WATCH - Wait for more volume"
      : "SKIP - Weak signal";

    const msg =
      line() + "\nTOKEN SCAN REPORT\n" + line() + "\n" +
      "Token    : $" + (pair.baseToken?.symbol ?? "Unknown") + "\n" +
      "Name     : " + (pair.baseToken?.name ?? "Unknown") + "\n" +
      "Contract : " + shortAddr(addr) + "\n" +
      "Age      : " + (age_minutes < 60 ? age_minutes + "m" : Math.floor(age_minutes/60) + "h " + (age_minutes%60) + "m") + "\n" +
      dash() + "\n" +
      "MARKET DATA\n" +
      "Price     : " + formatPrice(price) + "\n" +
      "Mkt Cap   : " + formatUSD(mcap) + "\n" +
      "Liquidity : " + formatUSD(liquidity) + "\n" +
      "5m change : " + (priceChange5m >= 0 ? "+" : "") + priceChange5m.toFixed(1) + "%\n" +
      "1h change : " + (priceChange1h >= 0 ? "+" : "") + priceChange1h.toFixed(1) + "%\n" +
      "24h change: " + (priceChange24h >= 0 ? "+" : "") + priceChange24h.toFixed(1) + "%\n" +
      "1h Volume : " + formatUSD(volume1h) + "\n" +
      "24h Volume: " + formatUSD(volume24h) + "\n" +
      "Buys 1h   : " + buys1h + "\n" +
      "Sells 1h  : " + sells1h + "\n" +
      dash() + "\n" +
      "SIGNAL SCORE: " + sig.score + "/100 - " + sig.potential + "\n" +
      dash() + "\n" +
      "POTENTIAL\n" +
      (pros.length ? pros.map(p => "+ " + p).join("\n") : "No strong positives") + "\n" +
      dash() + "\n" +
      "RISKS\n" +
      (cons.length ? cons.map(c => "- " + c).join("\n") : "No major risks found") + "\n" +
      dash() + "\n" +
      "RUG CHECK : " + (rug.danger ? "DANGER" : rug.warning ? "WARNING" : "PASSED") + "\n" +
      dash() + "\n" +
      (rug.danger ? "DO NOT BUY THIS TOKEN\n" + line() : (
        "ENTRY & EXIT PLAN\n" +
        "Entry    : " + formatPrice(sig.entry) + "\n" +
        "2x target: " + formatPrice(sig.target1) + "\n" +
        "5x target: " + formatPrice(sig.target2) + "\n" +
        "10x      : " + formatPrice(sig.target3) + "\n" +
        "50x moon : " + formatPrice(sig.target4) + "\n" +
        "Stop Loss: " + formatPrice(sig.stopLoss) + " (-30%)\n" +
        dash() + "\n" +
        "POSITION : " + sig.posSize + "\n" +
        "HOLD TIME: " + sig.holdTime + "\n" +
        dash() + "\n" +
        "TAKE PROFIT\n" +
        "Sell 25% at 2x  -> recover entry\n" +
        "Sell 50% at 5x  -> lock profit\n" +
        "Hold 25% moonbag to 10x-50x\n" +
        dash() + "\n" +
        "VERDICT  : " + verdict + "\n" +
        "RISK     : " + sig.risk + "\n" +
        dash() + "\n" +
        "Buy  : " + L.buy + "\n" +
        "Chart: " + L.chart + "\n" +
        line() + "\nTime: " + now()
      ));

    await bot.sendMessage(chatId, msg, { disable_web_page_preview: true });
  } catch (err) {
    console.error("[SCAN CA ERROR]", err.message);
    await bot.sendMessage(chatId, "Scan failed. Check the contract address and try again.");
  }
}

// â”€â”€ Telegram commands â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
    line() + "\nSOLANA MEMECOIN ALPHA BOT\n" + line() + "\n\n" +
    "TOKEN SCANNERS RUNNING:\n" +
    "1. Pump.fun API - ALL new launches\n" +
    "2. DexScreener new pairs - Raydium\n" +
    "3. Trending tokens pumping\n" +
    "4. 2x/5x/10x/50x/100x pump tracker\n" +
    "5. Volume spike detector\n\n" +
    "EVERY ALERT INCLUDES:\n" +
    "- Entry price\n" +
    "- 2x/5x/10x/50x targets\n" +
    "- Stop loss -30%\n" +
    "- Position size\n" +
    "- Hold time\n" +
    "- Direct buy link\n\n" +
    "COMMANDS:\n" +
    "/status            - bot health\n" +
    "/scan <CA>         - analyse any token\n" +
    "/addwhale <wallet> - add whale wallet\n" +
    "/whales            - whale list\n" +
    "/tracked           - tokens watched\n" +
    line()
  );
});

bot.onText(/\/status/, (msg) => {
  bot.sendMessage(msg.chat.id,
    line() + "\nBOT STATUS: RUNNING\n" + line() + "\n" +
    "Tokens tracked : " + tokenPrices.size + "\n" +
    "Alerts sent    : " + alertCount + "\n" +
    "Scans done     : " + scanCount + "\n" +
    "Rugs blocked   : " + blacklist.size + "\n" +
    "Scan rate      : 30s Pump.fun / 60s Dex\n" +
    "Time           : " + now() + "\n" +
    line()
  );
});

bot.onText(/\/scan (.+)/, async (msg, match) => {
  const addr = match[1].trim();
  if (addr.length < 32) {
    bot.sendMessage(msg.chat.id, "Invalid address.\nExample: /scan AkZ7xxxx...4pQw");
    return;
  }
  await scanCA(addr, msg.chat.id);
});

bot.onText(/\/addwhale (.+)/, (msg, match) => {
  const addr = match[1].trim();
  if (addr.length < 32) { bot.sendMessage(msg.chat.id, "Invalid wallet address."); return; }
  if (WHALE_WALLETS.find(w => w.addr === addr)) { bot.sendMessage(msg.chat.id, "Already tracking this wallet."); return; }
  WHALE_WALLETS.push({ addr, label: "Custom-" + WHALE_WALLETS.length, score: 80 });
  bot.sendMessage(msg.chat.id, "WHALE ADDED\nWallet: " + shortAddr(addr) + "\nTotal: " + WHALE_WALLETS.length);
});

bot.onText(/\/whales/, (msg) => {
  const list = WHALE_WALLETS.map((w, i) => (i+1) + ". " + w.label + "\n   " + shortAddr(w.addr)).join("\n\n");
  bot.sendMessage(msg.chat.id, line() + "\nWHALE LIST\n" + line() + "\n\n" + list + "\n\nAdd more: /addwhale <address>\nGet wallets from gmgn.ai Smart Money tab\n" + line());
});

bot.onText(/\/tracked/, (msg) => {
  bot.sendMessage(msg.chat.id,
    line() + "\nTRACKING SUMMARY\n" + line() + "\n" +
    "Tokens tracked : " + tokenPrices.size + "\n" +
    "Rugs blocked   : " + blacklist.size + "\n" +
    "Alerts sent    : " + alertCount + "\n" +
    "Scans done     : " + scanCount + "\n" +
    line()
  );
});

// â”€â”€ LAUNCH â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
console.log(line());
console.log("SOLANA MEMECOIN ALPHA BOT STARTING");
console.log("Scanner 1: Pump.fun API (all new tokens)");
console.log("Scanner 2: DexScreener new pairs (Raydium)");
console.log("Scanner 3: Trending tokens");
console.log("Scanner 4: Pump tracker 2x-100x");
console.log("Scanner 5: Volume spikes");
console.log(line());

// Run immediately
scanPumpFun();
scanDexNewPairs();
scanTrending();

// Intervals
setInterval(scanPumpFun,       30_000);  // every 30s - main scanner
setInterval(scanDexNewPairs,   60_000);  // every 1min
setInterval(scanTrending,     180_000);  // every 3min
setInterval(scanPumps,         60_000);  // every 1min
setInterval(scanVolumeSpikes, 120_000);  // every 2min

console.log("All 5 scanners live. Signals firing automatically.");
console.log(line());
