// ============================================================
//  Solana Memecoin Tracker — Telegram Alert Bot
//  Triggers: whale buys, 2x/5x/10x, Twitter spikes, new tokens
// ============================================================

require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// ── Tracked whale wallets (add your own) ─────────────────────
const WHALE_WALLETS = [
  "7xKp3mZzXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXmR4f",
  "3nBqRk11XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXx7Hew",
  "9pQxVt55XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX2Jds",
];

// ── State ────────────────────────────────────────────────────
const seenTokens = new Set();       // avoid duplicate alerts
const tokenPrices = new Map();      // track price for 2x/5x/10x
const twitterBaseline = new Map();  // track mention counts

// ── Helpers ──────────────────────────────────────────────────
function shortAddr(addr) {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function formatUSD(n) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}

function scoreToken({ mcap, volume, twitterMentions, whaleBuy }) {
  let score = 0;
  if (mcap < 100_000) score += 30;
  else if (mcap < 500_000) score += 20;
  if (volume / mcap > 0.5) score += 25;
  if (twitterMentions > 500) score += 20;
  if (whaleBuy) score += 25;
  return Math.min(score, 100);
}

// ── Send Telegram alert ──────────────────────────────────────
async function sendAlert(type, data) {
  const icons = {
    whale:   "🐋",
    pump:    "🚀",
    twitter: "🐦",
    new:     "🆕",
  };

  let msg = "";

  if (type === "whale") {
    const score = scoreToken(data);
    msg = `${icons.whale} *Whale Buy Detected!*\n\n` +
      `Token: \`${data.symbol}\`\n` +
      `Wallet: \`${shortAddr(data.wallet)}\`\n` +
      `Amount: ${formatUSD(data.amountUSD)}\n` +
      `Market Cap: ${formatUSD(data.mcap)}\n` +
      `Score: ${score}/100 🔥\n\n` +
      `[DexScreener](https://dexscreener.com/solana/${data.address}) | [Birdeye](https://birdeye.so/token/${data.address})`;
  }

  if (type === "pump") {
    msg = `${icons.pump} *${data.multiplier}x Alert — ${data.symbol}!*\n\n` +
      `Price: $${data.price}\n` +
      `Market Cap: ${formatUSD(data.mcap)}\n` +
      `24h Volume: ${formatUSD(data.volume)}\n\n` +
      `[DexScreener](https://dexscreener.com/solana/${data.address})`;
  }

  if (type === "twitter") {
    msg = `${icons.twitter} *Twitter Spike — ${data.symbol}*\n\n` +
      `Mentions: ${data.mentions.toLocaleString()} (+${data.increase}% in 1h)\n` +
      `Market Cap: ${formatUSD(data.mcap)}\n\n` +
      `[Search Twitter](https://twitter.com/search?q=%24${data.symbol.replace("$","")})`;
  }

  if (type === "new") {
    const score = scoreToken(data);
    msg = `${icons.new} *New Token — ${data.symbol}*\n\n` +
      `Age: ${data.ageMinutes}m old\n` +
      `Market Cap: ${formatUSD(data.mcap)}\n` +
      `1h Volume: ${formatUSD(data.volume)}\n` +
      `Whale activity: ${data.whaleBuy ? "✅ YES" : "❌ No"}\n` +
      `Score: ${score}/100\n\n` +
      `[DexScreener](https://dexscreener.com/solana/${data.address})`;
  }

  try {
    await bot.sendMessage(CHAT_ID, msg, {
      parse_mode: "Markdown",
      disable_web_page_preview: false,
    });
  } catch (err) {
    console.error("Telegram send error:", err.message);
  }
}

// ── 1. Poll DexScreener for new Solana tokens ────────────────
async function checkNewTokens() {
  try {
    const res = await axios.get(
      "https://api.dexscreener.com/token-profiles/latest/v1",
      { timeout: 8000 }
    );
    const pairs = res.data?.filter(t => t.chainId === "solana") ?? [];

    for (const token of pairs) {
      const addr = token.tokenAddress;
      if (!addr || seenTokens.has(addr)) continue;

      const mcap = token.fdv ?? 0;
      const volume = token.volume?.h1 ?? 0;
      const ageMs = Date.now() - new Date(token.pairCreatedAt ?? 0).getTime();
      const ageMinutes = Math.floor(ageMs / 60000);

      if (mcap > 500_000 || ageMinutes > 60) continue;

      seenTokens.add(addr);

      // Check whale overlap (simplified: real impl uses Birdeye wallet API)
      const whaleBuy = false; // set true when Birdeye confirms

      const score = scoreToken({ mcap, volume, twitterMentions: 0, whaleBuy });
      if (score >= 50) {
        await sendAlert("new", {
          symbol: `$${token.symbol ?? addr.slice(0, 6)}`,
          address: addr,
          mcap,
          volume,
          ageMinutes,
          whaleBuy,
        });
      }

      // Store baseline price for multiplier tracking
      tokenPrices.set(addr, { basePrice: token.priceUsd ?? 0, symbol: token.symbol });
    }
  } catch (err) {
    console.error("DexScreener poll error:", err.message);
  }
}

// ── 2. Check 2x / 5x / 10x pumps ────────────────────────────
async function checkPumps() {
  for (const [addr, { basePrice, symbol }] of tokenPrices.entries()) {
    try {
      const res = await axios.get(
        `https://api.dexscreener.com/tokens/v1/solana/${addr}`,
        { timeout: 8000 }
      );
      const pair = res.data?.pairs?.[0];
      if (!pair) continue;

      const currentPrice = parseFloat(pair.priceUsd ?? 0);
      const multiplier = currentPrice / basePrice;

      for (const target of [2, 5, 10]) {
        const key = `${addr}-${target}x`;
        if (multiplier >= target && !seenTokens.has(key)) {
          seenTokens.add(key);
          await sendAlert("pump", {
            symbol: `$${symbol}`,
            address: addr,
            price: currentPrice.toFixed(8),
            mcap: pair.fdv ?? 0,
            volume: pair.volume?.h24 ?? 0,
            multiplier: target,
          });
        }
      }
    } catch (err) {
      // skip individual token errors
    }
  }
}

// ── 3. Twitter mention spike (via RapidAPI or Nitter RSS) ────
//    Replace with your preferred Twitter/X API endpoint
async function checkTwitterSpikes() {
  if (!process.env.TWITTER_BEARER_TOKEN) return;

  const watchlist = ["$KEKW", "$PEPE2", "$GIGABRAIN"]; // auto-populated from new tokens in prod

  for (const symbol of watchlist) {
    try {
      const query = encodeURIComponent(`${symbol} lang:en -is:retweet`);
      const res = await axios.get(
        `https://api.twitter.com/2/tweets/counts/recent?query=${query}&granularity=hour`,
        {
          headers: { Authorization: `Bearer ${process.env.TWITTER_BEARER_TOKEN}` },
          timeout: 8000,
        }
      );
      const counts = res.data?.data ?? [];
      if (counts.length < 2) continue;

      const latest = counts[counts.length - 1].tweet_count;
      const prev = counts[counts.length - 2].tweet_count || 1;
      const increase = Math.round(((latest - prev) / prev) * 100);

      const baseline = twitterBaseline.get(symbol) ?? prev;
      twitterBaseline.set(symbol, latest);

      if (increase >= 200 && latest >= 100) {
        const key = `tw-${symbol}-${Date.now()}`;
        await sendAlert("twitter", {
          symbol,
          mentions: latest,
          increase,
          mcap: 0, // enrich with DexScreener data in prod
        });
      }
    } catch (err) {
      // skip
    }
  }
}

// ── 4. Whale wallet tracker (via Birdeye) ───────────────────
async function checkWhaleWallets() {
  if (!process.env.BIRDEYE_API_KEY) return;

  for (const wallet of WHALE_WALLETS) {
    try {
      const res = await axios.get(
        `https://public-api.birdeye.so/v1/wallet/tx_list?wallet=${wallet}&limit=5`,
        {
          headers: { "X-API-KEY": process.env.BIRDEYE_API_KEY },
          timeout: 8000,
        }
      );
      const txs = res.data?.data?.items ?? [];

      for (const tx of txs) {
        if (tx.type !== "swap") continue;
        const tokenAddr = tx.tokenAddress;
        const alertKey = `whale-${wallet}-${tx.txHash}`;
        if (seenTokens.has(alertKey)) continue;

        seenTokens.add(alertKey);

        // Fetch token info
        const tokenRes = await axios.get(
          `https://public-api.birdeye.so/public/token_overview?address=${tokenAddr}`,
          { headers: { "X-API-KEY": process.env.BIRDEYE_API_KEY }, timeout: 8000 }
        );
        const info = tokenRes.data?.data ?? {};
        const mcap = info.realMc ?? 0;

        if (mcap < 5_000_000) { // only alert on smaller cap tokens
          await sendAlert("whale", {
            symbol: `$${info.symbol ?? tokenAddr.slice(0, 6)}`,
            address: tokenAddr,
            wallet,
            amountUSD: tx.amount ?? 0,
            mcap,
            volume: info.v24hUSD ?? 0,
            twitterMentions: 0,
            whaleBuy: true,
          });
        }
      }
    } catch (err) {
      console.error(`Whale check error for ${shortAddr(wallet)}:`, err.message);
    }
  }
}

// ── Telegram commands ────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
    "👾 *Solana Memecoin Tracker is live!*\n\n" +
    "I'll alert you when:\n" +
    "🐋 A whale wallet buys a new token\n" +
    "🚀 A token hits 2x, 5x or 10x\n" +
    "🐦 Twitter mentions spike 200%+\n" +
    "🆕 A new token <$500k mcap has whale activity\n\n" +
    "Commands:\n" +
    "/status — bot health check\n" +
    "/wallets — list tracked whale wallets\n" +
    "/mute — pause alerts for 1 hour",
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/status/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `✅ Bot running\n📊 Tokens tracked: ${tokenPrices.size}\n👁 Seen events: ${seenTokens.size}`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/wallets/, (msg) => {
  const list = WHALE_WALLETS.map((w, i) => `${i + 1}. \`${shortAddr(w)}\``).join("\n");
  bot.sendMessage(msg.chat.id, `🐋 *Tracked wallets:*\n\n${list}`, { parse_mode: "Markdown" });
});

// ── Poll intervals ───────────────────────────────────────────
console.log("🚀 Solana Memecoin Tracker bot starting...");
console.log("📡 Polling DexScreener, Birdeye, Twitter...\n");

checkNewTokens();
checkWhaleWallets();
checkTwitterSpikes();

setInterval(checkNewTokens,     30_000);   // every 30s
setInterval(checkPumps,         60_000);   // every 1m
setInterval(checkWhaleWallets,  45_000);   // every 45s
setInterval(checkTwitterSpikes, 300_000);  // every 5m
