// Fetch ALL Stoa swaps on Robinhood Chain from StoaRouter `Routed` events
// and build data.json for the dashboard.
//
// Source: StoaRouter 0x2F2804fad735a38015650f32f95Ad5E08D6B3eE5 (chain 4663)
// Event:  Routed(sender, to, referrer, tokenIn, tokenOut, amountIn, amountOut,
//                mid, venue1, venue2)
// The public RPC accepts very wide eth_getLogs ranges, so a full-history
// scan is ~12 calls of 10M blocks each.
//
// Usage: node fetch-swaps.js   ->   writes data.json next to this file.
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const RPC = process.env.RPC_URL || 'https://rpc.mainnet.chain.robinhood.com';
const ROUTER = '0x2F2804fad735a38015650f32f95Ad5E08D6B3eE5';
const TOPIC = ethers.id('Routed(address,address,address,address,address,uint256,uint256,address,address,address)');
const USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168';
const WETH = '0x0bd7d308f8e1639fab988df18a80151bdfeacad7';
const ZERO = '0x0000000000000000000000000000000000000000';

const VENUE_NAMES = {
  '0x27958279f95225b2a5517e7dd12b6fc0317e5c5d': 'Uniswap V4',
};

const abi = JSON.parse(fs.readFileSync(path.join(__dirname, 'StoaRouter.json'), 'utf8'));
const iface = new ethers.Interface(abi);

async function tokenList() {
  const map = new Map();
  try {
    const r = await fetch('https://stoadex.com/api/v1/tokens?chain=robinhood');
    const j = await r.json();
    for (const t of j.tokens || []) map.set(t.address.toLowerCase(), { symbol: t.symbol, decimals: t.decimals ?? 18 });
  } catch { /* fall back to on-chain reads */ }
  map.set(ZERO, { symbol: 'ETH', decimals: 18 });
  map.set(WETH, { symbol: 'WETH', decimals: 18 });
  map.set(USDG, { symbol: 'USDG', decimals: 6 });
  return map;
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC, 4663);
  const latest = await provider.getBlockNumber();
  console.log(`Scanning Routed events 0..${latest}`);
  const logs = [];
  for (let from = 0; from <= latest; from += 10_000_000) {
    const to = Math.min(from + 9_999_999, latest);
    const chunk = await provider.getLogs({ address: ROUTER, topics: [TOPIC], fromBlock: from, toBlock: to });
    logs.push(...chunk);
    console.log(`  ${from}..${to}: +${chunk.length} (total ${logs.length})`);
  }

  const meta = await tokenList();
  const erc20 = new ethers.Interface(['function symbol() view returns (string)', 'function decimals() view returns (uint8)']);
  async function metaOf(addr) {
    const key = addr.toLowerCase();
    if (meta.has(key)) return meta.get(key);
    let m = { symbol: addr.slice(0, 8), decimals: 18 };
    try {
      const c = new ethers.Contract(addr, erc20, provider);
      m = { symbol: await c.symbol(), decimals: Number(await c.decimals()) };
    } catch { /* keep fallback */ }
    meta.set(key, m);
    return m;
  }

  // ETH price in USDG from Stoa's own quote, for valuing ETH-sided swaps
  let ethUsd = null;
  try {
    const r = await fetch('https://stoadex.com/api/v1/quote?chain=robinhood&sellToken=native&buyToken=' +
      '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168&amount=1000000000000000000');
    const q = await r.json();
    ethUsd = Number(q.amountOut) / 1e6;
  } catch { /* volume in USD will skip ETH-sided swaps */ }

  const blockTimes = new Map();
  async function timeOf(block) {
    if (!blockTimes.has(block)) {
      const b = await provider.getBlock(block);
      blockTimes.set(block, b.timestamp);
    }
    return blockTimes.get(block);
  }

  const swaps = [];
  for (const log of logs) {
    const a = iface.parseLog(log).args;
    const inM = await metaOf(a.tokenIn), outM = await metaOf(a.tokenOut);
    const amtIn = Number(a.amountIn) / 10 ** inM.decimals;
    const amtOut = Number(a.amountOut) / 10 ** outM.decimals;
    let usd = null;
    if (a.tokenIn.toLowerCase() === USDG) usd = amtIn;
    else if (a.tokenOut.toLowerCase() === USDG) usd = amtOut;
    else if (ethUsd && (a.tokenIn === ZERO || a.tokenIn.toLowerCase() === WETH)) usd = amtIn * ethUsd;
    else if (ethUsd && (a.tokenOut === ZERO || a.tokenOut.toLowerCase() === WETH)) usd = amtOut * ethUsd;
    const venueAddr = (a.venue1 || ZERO).toLowerCase();
    swaps.push({
      block: log.blockNumber, tx: log.transactionHash, time: await timeOf(log.blockNumber),
      trader: a.sender, to: a.to,
      referrer: a.referrer === ZERO ? null : a.referrer,
      tokenIn: a.tokenIn, tokenOut: a.tokenOut,
      inSymbol: inM.symbol, outSymbol: outM.symbol,
      amountIn: amtIn, amountOut: amtOut, usd,
      venue: VENUE_NAMES[venueAddr] || venueAddr,
      venue2: a.venue2 && a.venue2 !== ZERO ? (VENUE_NAMES[a.venue2.toLowerCase()] || a.venue2.toLowerCase()) : null,
      mid: a.mid && a.mid !== ZERO ? a.mid : null,
    });
  }
  swaps.sort((x, y) => y.block - x.block);

  const now = Math.floor(Date.now() / 1000);
  const sum = (arr) => arr.reduce((s, x) => s + (x.usd || 0), 0);
  const uniq = (arr, k) => new Set(arr.map(x => x[k].toLowerCase())).size;
  const inWin = (sec) => swaps.filter(s => s.time >= now - sec);
  const byKey = (arr, kf) => {
    const m = new Map();
    for (const s of arr) { const k = kf(s); const e = m.get(k) || { swaps: 0, usd: 0 }; e.swaps++; e.usd += s.usd || 0; m.set(k, e); }
    return [...m.entries()].map(([k, v]) => ({ key: k, ...v })).sort((a, b) => b.swaps - a.swaps);
  };

  const data = {
    generatedAt: new Date().toISOString(),
    router: ROUTER, chainId: 4663, latestBlock: latest, ethUsd,
    stats: {
      totalSwaps: swaps.length,
      volumeUsd: sum(swaps),
      uniqueTraders: uniq(swaps, 'trader'),
      uniqueReferrers: new Set(swaps.filter(s => s.referrer).map(s => s.referrer.toLowerCase())).size,
      swaps24h: inWin(86400).length, volume24h: sum(inWin(86400)),
      swaps7d: inWin(7 * 86400).length, volume7d: sum(inWin(7 * 86400)),
      firstSwapTime: swaps.length ? swaps[swaps.length - 1].time : null,
    },
    venues: byKey(swaps, s => s.venue).map(v => ({ name: v.key, swaps: v.swaps, volumeUsd: v.usd })),
    pairs: byKey(swaps, s => `${s.inSymbol} → ${s.outSymbol}`).slice(0, 15)
      .map(p => ({ pair: p.key, swaps: p.swaps, volumeUsd: p.usd })),
    referrers: byKey(swaps.filter(s => s.referrer), s => s.referrer.toLowerCase()).slice(0, 15)
      .map(r => ({ address: r.key, swaps: r.swaps, volumeUsd: r.usd })),
    swaps: swaps.slice(0, 100),
  };
  fs.writeFileSync(path.join(__dirname, 'data.json'), JSON.stringify(data, null, 1));
  console.log('Wrote data.json:', data.stats);
}

main().catch(e => { console.error('ERR', e); process.exit(1); });
