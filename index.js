// ============================================================
//  Solana Memecoin Tracker â€” FULL SIGNAL BOT (100% FREE)
//  Entry + Exit + Stop Loss + Position Size + Hold Time
//  Whale tracking via Solscan + DexScreener (both free)
// ============================================================

require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// â”€â”€ Known high win-rate whale wallets â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const WHALE_WALLETS = [
  { addr: "5tzFkiKscXHK5ZXCGbXZxdw7gzeJnuFcEKBTjHfkfxBK", label: "Whale Alpha" },
  { addr: "DfYCNezifxAEsQbAJ1b3j6PX3JVBe8fu11KBhxsbw5d2", label: "Whale Beta" },
  { addr: "8xRELyKBSFbQkHFBFvPEtFNDSB6tEJZnNEMSuwRNNrBy", label: "Whale Gamma" },
  { addr: "GUfCR9mK6azb9vcpsxgXyj7XRPAaFqzmLgtP5HmC3Mt",  label: "Whale Delta" },
  { addr: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", label: "Whale Epsilon" },
  { addr: "ASTyfSima4LLAdDgoFGkgqoKowG1LZFDr9fAQrg7iaJZ", label: "Whale Zeta" },
  { addr: "HVh6wHNBAsG3pq1Bj5oCzRjoWKVogEDHwUHkRz3ekFgt", label: "Whale Eta" },
  { addr: "2RtGg6fsFiiF1EQzHqk75DAkyEjqiCPMkQ3sJHhT73g",  label: "Whale Theta" },
];

// â”€â”€ State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const seenAlerts  = new Set();
const tokenPrices = new Map();
const whaleLastTx = new Map();

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function formatUSD(n) {
  if (!n || isNaN(n)) return "$0";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}k`;
  return `$${Number(n).toFixed(4)}`;
}

function formatPrice(p) {
  if (!p || isNaN(p)) return "$0";
  if (p < 0.000001)  return `$${p.toFixed(12)}`;
  if (p < 0.001)     return `$${p.toFixed(8)}`;
  if (p < 1)         return `$${p.toFixed(6)}`;
  return `$${p.toFixed(4)}`;
}

function shortAddr(addr) {
  return `${addr.slice(0, 4)}â€¦${addr.slice(-4)}`;
}

// â”€â”€ Signal calculator â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function calcSignal({ price, mcap, volume1h, priceChange1h, age_minutes, whaleBuy }) {
  // Score
  let score = 0;
  if (mcap < 50_000)        score += 25;
  else if (mcap < 200_000)  score += 18;
  else if (mcap < 500_000)  score += 10;
  if (volume1h && mcap && volume1h / mcap > 0.3) score += 20;
  if (priceChange1h > 100)  score += 25;
  else if (priceChange1h > 50)  score += 18;
  else if (priceChange1h > 20)  score += 10;
  if (age_minutes < 20)     score += 20;
  else if (age_minutes < 60) score += 10;
  if (whaleBuy)             score += 30;
  score = Math.min(score, 100);

  // Risk level
  let risk, riskEmoji;
  if (score >= 85)      { risk = "HIGH RISK / HIGH REWARD"; riskEmoji = "ðŸ”´"; }
  else if (score >= 65) { risk = "MEDIUM RISK";             riskEmoji = "ðŸŸ¡"; }
  else                  { risk = "LOWER RISK";              riskEmoji = "ðŸŸ¢"; }

  // Potential label
  let potential;
  if (score >= 90)      potential = "100x-1000x potential ðŸš€";
  else if (score >= 75) potential = "10x-100x potential ðŸ”¥";
  else if (score >= 55) potential = "5x-10x potential ðŸ“ˆ";
  else                  potential = "Watch closely ðŸ‘€";

  // Signal strength
  let strength;
  if (score >= 90)      strength = "ðŸ”¥ðŸ”¥ðŸ”¥ MEGA SIGNAL";
  else if (score >= 75) strength = "ðŸ”¥ðŸ”¥ STRONG SIGNAL";
  else if (score >= 55) strength = "ðŸ”¥ SIGNAL";
  else                  strength = "ðŸ‘€ WATCH";

  // Entry & targets
  const entry      = price;
  const target1    = price * 2;    // 2x
  const target2    = price * 5;    // 5x
  const target3    = price * 10;   // 10x
  const target4    = price * 50;   // 50x (moonbag)
  const stopLoss   = price * 0.70; // -30% stop loss

  // Position size based on risk/score
  let posSize, posTip;
  if (score >= 85) {
    posSize = "1% - 2% of portfolio";
    posTip  = "High conviction but volatile â€” keep size small";
  } else if (score >= 65) {
    posSize = "0.5% - 1% of portfolio";
    posTip  = "Decent signal â€” moderate size";
  } else {
    posSize = "0.25% - 0.5% of portfolio";
    posTip  = "Speculative â€” tiny size only";
  }

  // Hold time
  let holdTime;
  if (age_minutes < 20)     holdTime = "15min - 2h (very early, fast move expected)";
  else if (age_minutes < 60) holdTime = "1h - 6h (early stage)";
  else                       holdTime = "2h - 24h (mid stage)";

  // Take profit strategy
  const tpStrategy =
    "â€¢ Sell 25% at 2x â†’ recover entry\n" +
    "â€¢ Sell 50% at 5x â†’ lock profit\n" +
    "â€¢ Hold 25% to 10x-100x (moonbag)";

  return {
    score, risk, riskEmoji, potential, strength,
    entry, target1, target2, target3, target4, stopLoss,
    posSize, posTip, holdTime, tpStrategy,
  };
}

// â”€â”€ Build alert message â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function buildMessage(type, data, sig) {
  const divider = "â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€";

  let header = "";
  if (type === "whale")    header = `ðŸ‹ *WHALE BUY DETECTED*`;
  if (type === "new")      header = `ðŸ†• *NEW TOKEN LAUNCH*`;
  if (type === "trending") header = `ðŸ“ˆ *TRENDING TOKEN*`;
  if (type === "pump")     header = `ðŸš€ *${data.multiplier}X PUMP ALERT*`;

  // Pump alerts are simpler â€” no entry/exit needed, already moving
  if (type === "pump") {
    return (
      `${header}\n\n` +
      `Token: *${data.symbol}*\n` +
      `${divider}\n` +
      `ðŸ’° Current Price: ${formatPrice(data.currentPrice)}\n` +
      `ðŸ“Š Market Cap: ${formatUSD(data.mcap)}\n` +
      `ðŸ“¦ 24h Volume: ${formatUSD(data.volume24h)}\n` +
      `ðŸ“ˆ 24h Change: +${data.priceChange24h?.toFixed(1)}%\n\n` +
      `ðŸ Entry was: ${formatPrice(data.basePrice)}\n` +
      `ðŸŽ¯ Still holding? Next targets:\n` +
      `   â”œ ${formatPrice(data.basePrice * data.multiplier * 2)} (${data.multiplier * 2}x)\n` +
      `   â”” ${formatPrice(data.basePrice * data.multiplier * 5)} (${data.multiplier * 5}x)\n\n` +
      `ðŸ›‘ Move stop loss to entry price now!\n\n` +
      `[DexScreener](https://dexscreener.com/solana/${data.address})`
    );
  }

  return (
    `${header}\n` +
    `${sig.strength}\n\n` +
    `Token: *${data.symbol}*\n` +
    (type === "whale" ? `Whale: *${data.label}* (\`${shortAddr(data.wallet)}\`)\n` : "") +
    (type === "whale" ? `Buy Size: ${formatUSD(data.amountUSD)}\n` : "") +
    `Age: ${data.age_minutes}m old\n` +
    `Score: *${sig.score}/100* â€” ${sig.potential}\n` +
    `${divider}\n` +
    `ðŸ“Š *MARKET INFO*\n` +
    `Price: ${formatPrice(data.price)}\n` +
    `Market Cap: ${formatUSD(data.mcap)}\n` +
    `1h Volume: ${formatUSD(data.volume1h)}\n` +
    `1h Change: +${data.priceChange1h?.toFixed(1) ?? 0}%\n` +
    `${divider}\n` +
    `ðŸ“ *ENTRY & EXIT PLAN*\n` +
    `ðŸŸ¢ Entry Price: ${formatPrice(sig.entry)}\n\n` +
    `ðŸŽ¯ Target 1 (2x):  ${formatPrice(sig.target1)}\n` +
    `ðŸŽ¯ Target 2 (5x):  ${formatPrice(sig.target2)}\n` +
    `ðŸŽ¯ Target 3 (10x): ${formatPrice(sig.target3)}\n` +
    `ðŸŒ™ Moonbag (50x):  ${formatPrice(sig.target4)}\n\n` +
    `ðŸ›‘ Stop Loss (-30%): ${formatPrice(sig.stopLoss)}\n` +
    `${divider}\n` +
    `ðŸ’¼ *POSITION SIZE*\n` +
    `${sig.posSize}\n` +
    `_${sig.posTip}_\n\n` +
    `â± *HOLD TIME*\n` +
    `${sig.holdTime}\n` +
    `${divider}\n` +
    `ðŸ“¤ *TAKE PROFIT STRATEGY*\n` +
    `${sig.tpStrategy}\n` +
    `${divider}\n` +
    `${sig.riskEmoji} Risk: ${sig.risk}\n\n` +
    `[DexScreener](https://dexscreener.com/solana/${data.address}) | [Solscan](https://solscan.io/token/${data.address})`
  );
}

// â”€â”€ Send alert â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function sendAlert(type, data) {
  let sig = null;
  if (type !== "pump") {
    sig = calcSignal({
      price:         data.price,
      mcap:          data.mcap,
      volume1h:      data.volume1h ?? 0,
      priceChange1h: data.priceChange1h ?? 0,
      age_minutes:   data.age_minutes ?? 60,
      whaleBuy:      type === "whale",
    });
    if (sig.score < 40) return; // skip low score signals
  }

  const msg = buildMessage(type, data, sig);

  try {
    await bot.sendMessage(CHAT_ID, msg, {
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    });
    console.log(`âœ… [${type}] Alert sent: ${data.symbol} | Score: ${sig?.score ?? "pump"}`);
  } catch (err) {
    console.error("Telegram error:", err.message);
  }
}

// â”€â”€ Fetch pair info from DexScreener â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function getTokenInfo(address) {
  try {
    const res = await axios.get(
      `https://api.dexscreener.com/tokens/v1/solana/${address}`,
      { timeout: 8000 }
    );
    return res.data?.pairs?.[0] ?? null;
  } catch { return null; }
}

// â”€â”€ 1. WHALE TRACKING (Solscan free API) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function scanWhaleWallets() {
  for (const whale of WHALE_WALLETS) {
    try {
      const res = await axios.get(
        `https://public-api.solscan.io/account/transactions?account=${whale.addr}&limit=5`,
        { headers: { accept: "application/json" }, timeout: 10000 }
      );
      const txs = res.data ?? [];
      if (!txs.length) continue;

      const latestSig = txs[0]?.txHash;
      if (!latestSig || whaleLastTx.get(whale.addr) === latestSig) continue;
      whaleLastTx.set(whale.addr, latestSig);

      for (const tx of txs) {
        if (!tx.tokenBalances?.length) continue;
        for (const tokenBal of tx.tokenBalances) {
          const tokenAddr   = tokenBal.account;
          const changeAmt   = (tokenBal.amount?.postAmount ?? 0) - (tokenBal.amount?.preAmount ?? 0);
          if (!changeAmt || changeAmt <= 0) continue;

          const alertKey = `whale-${whale.addr}-${tx.txHash}-${tokenAddr}`;
          if (seenAlerts.has(alertKey)) continue;
          seenAlerts.add(alertKey);

          const pair = await getTokenInfo(tokenAddr);
          if (!pair) continue;

          const mcap        = pair.fdv ?? 0;
          if (mcap > 5_000_000) continue;

          const price       = parseFloat(pair.priceUsd ?? 0);
          const createdAt   = pair.pairCreatedAt ?? Date.now();
          const age_minutes = Math.floor((Date.now() - createdAt) / 60000);
          const amountUSD   = changeAmt * price;
          if (amountUSD < 100) continue;

          await sendAlert("whale", {
            symbol:        `$${pair.baseToken?.symbol ?? tokenAddr.slice(0, 6)}`,
            address:       tokenAddr,
            wallet:        whale.addr,
            label:         whale.label,
            amountUSD,
            price,
            mcap,
            volume1h:      pair.volume?.h1 ?? 0,
            priceChange1h: pair.priceChange?.h1 ?? 0,
            age_minutes,
          });

          if (!tokenPrices.has(tokenAddr)) {
            tokenPrices.set(tokenAddr, { basePrice: price, symbol: pair.baseToken?.symbol });
          }
        }
      }
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      console.error(`Whale error [${whale.label}]:`, err.message);
    }
  }
}

// â”€â”€ 2. NEW TOKEN LAUNCHES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function scanNewTokens() {
  try {
    const res = await axios.get(
      "https://api.dexscreener.com/token-profiles/latest/v1",
      { timeout: 10000 }
    );
    const tokens = res.data?.filter(t => t.chainId === "solana") ?? [];

    for (const token of tokens) {
      const addr = token.tokenAddress;
      if (!addr || seenAlerts.has(`new-${addr}`)) continue;

      const pair = await getTokenInfo(addr);
      if (!pair) continue;

      const mcap        = pair.fdv ?? 0;
      const price       = parseFloat(pair.priceUsd ?? 0);
      const volume1h    = pair.volume?.h1 ?? 0;
      const priceChange1h = pair.priceChange?.h1 ?? 0;
      const age_minutes = Math.floor((Date.now() - (pair.pairCreatedAt ?? Date.now())) / 60000);

      if (mcap > 500_000 || age_minutes > 60) continue;
      seenAlerts.add(`new-${addr}`);

      await sendAlert("new", {
        symbol: `$${pair.baseToken?.symbol ?? addr.slice(0, 6)}`,
        address: addr,
        price,
        mcap,
        volume1h,
        priceChange1h,
        age_minutes,
      });

      if (!tokenPrices.has(addr)) {
        tokenPrices.set(addr, { basePrice: price, symbol: pair.baseToken?.symbol });
      }
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
          const alertKey = `pump-${addr}-${target}x`;
          if (seenAlerts.has(alertKey)) continue;
          seenAlerts.add(alertKey);

          await sendAlert("pump", {
            symbol:        `$${symbol}`,
            address:       addr,
            currentPrice,
            basePrice,
            mcap:          pair.fdv ?? 0,
            volume24h:     pair.volume?.h24 ?? 0,
            priceChange24h: pair.priceChange?.h24 ?? 0,
            multiplier:    target,
          });
        }
      }
    } catch { /* skip */ }
  }
}

// â”€â”€ 4. TRENDING TOKENS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function scanTrending() {
  try {
    const res = await axios.get(
      "https://api.dexscreener.com/token-boosts/top/v1",
      { timeout: 10000 }
    );
    const tokens = res.data?.filter(t => t.chainId === "solana") ?? [];

    for (const token of tokens.slice(0, 10)) {
      const addr = token.tokenAddress;
      if (!addr) continue;

      const alertKey = `trending-${addr}-${Math.floor(Date.now() / 3600000)}`;
      if (seenAlerts.has(alertKey)) continue;

      const pair = await getTokenInfo(addr);
      if (!pair) continue;

      const mcap          = pair.fdv ?? 0;
      const priceChange1h = pair.priceChange?.h1 ?? 0;
      const priceChange5m = pair.priceChange?.m5 ?? 0;
      const volume1h      = pair.volume?.h1 ?? 0;
      const price         = parseFloat(pair.priceUsd ?? 0);
      const age_minutes   = Math.floor((Date.now() - (pair.pairCreatedAt ?? Date.now())) / 60000);

      if (priceChange1h < 30 && priceChange5m < 15) continue;
      if (mcap > 10_000_000) continue;

      seenAlerts.add(alertKey);

      await sendAlert("trending", {
        symbol: `$${pair.baseToken?.symbol ?? addr.slice(0, 6)}`,
        address: addr,
        price,
        mcap,
        volume1h,
        priceChange1h,
        priceChange5m,
        age_minutes,
      });
    }
  } catch (err) {
    console.error("Trending error:", err.message);
  }
}

// â”€â”€ Telegram commands â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
    "ðŸ‘¾ *Solana Memecoin Signal Bot LIVE!*\n\n" +
    "Every alert includes:\n" +
    "âœ… Entry price\n" +
    "ðŸŽ¯ Target 1 / 2 / 3 + Moonbag\n" +
    "ðŸ›‘ Stop loss (-30%)\n" +
    "ðŸ’¼ Position size advice\n" +
    "â± Suggested hold time\n" +
    "ðŸ“¤ Take profit strategy\n\n" +
    "Alert types:\n" +
    "ðŸ‹ Whale buys (10x-1000x wallets)\n" +
    "ðŸ†• New tokens under $500k mcap\n" +
    "ðŸš€ 2x/5x/10x/50x/100x pumps\n" +
    "ðŸ“ˆ Trending tokens pumping\n\n" +
    "Commands:\n" +
    "/status â€” bot health\n" +
    "/whales â€” tracked wallets\n" +
    "/tracked â€” tokens being watched",
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/status/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `âœ… *Signal Bot Running!*\n\n` +
    `ðŸ‹ Whale wallets: ${WHALE_WALLETS.length}\n` +
    `ðŸ“Š Tokens tracked: ${tokenPrices.size}\n` +
    `ðŸ”” Alerts sent: ${seenAlerts.size}\n` +
    `â± Scanning every 30s`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/whales/, (msg) => {
  const list = WHALE_WALLETS.map((w, i) =>
    `${i + 1}. ${w.label} â€” \`${shortAddr(w.addr)}\``
  ).join("\n");
  bot.sendMessage(msg.chat.id,
    `ðŸ‹ *Tracked Whale Wallets:*\n\n${list}`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/tracked/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `ðŸ‘€ Watching *${tokenPrices.size}* tokens for 2x-100x pumps`,
    { parse_mode: "Markdown" }
  );
});

// â”€â”€ Launch all scanners â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
console.log("ðŸš€ Solana Signal Bot starting...");
console.log(`ðŸ‹ Tracking ${WHALE_WALLETS.length} whale wallets`);
console.log("ðŸ“¡ Scanning for new tokens, pumps, trends\n");

scanWhaleWallets();
scanNewTokens();
scanTrending();

setInterval(scanWhaleWallets, 45_000);
setInterval(scanNewTokens,    30_000);
setInterval(scanPumps,        60_000);
setInterval(scanTrending,    300_000);

console.log("âœ… All scanners live! Waiting for signals...");
