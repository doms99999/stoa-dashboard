// Probe: scan StoaRouter `Routed` events on Robinhood Chain (4663).
const { ethers } = require('ethers');
const fs = require('fs');

const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const ROUTER = '0x2F2804fad735a38015650f32f95Ad5E08D6B3eE5';
const abi = JSON.parse(fs.readFileSync(__dirname + '/StoaRouter.json', 'utf8'));
const iface = new ethers.Interface(abi);

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC, 4663);
  const latest = await provider.getBlockNumber();
  const SPAN = Number(process.argv[2] || 30000);
  const from = latest - SPAN;
  console.log(`blocks ${from}..${latest} (span ${SPAN})`);
  const topic = ethers.id('Routed(address,address,address,address,address,uint256,uint256,address,address,address)');
  const logs = [];
  for (let start = from; start <= latest; start += 5000) {
    const end = Math.min(start + 4999, latest);
    const chunk = await provider.getLogs({ address: ROUTER, topics: [topic], fromBlock: start, toBlock: end });
    logs.push(...chunk);
    process.stdout.write(`\r${end - from}/${SPAN} blocks, ${logs.length} swaps`);
  }
  console.log('');
  const senders = new Set(), referrers = new Set();
  const pairs = {}, venues = {};
  let ethIn = 0n;
  const WETH = '0x0bd7d308f8e1639fab988df18a80151bdfeacad73'.slice(0, 42);
  for (const log of logs) {
    const a = iface.parseLog(log).args;
    senders.add(a.sender.toLowerCase());
    if (a.referrer !== ethers.ZeroAddress) referrers.add(a.referrer.toLowerCase());
    const key = `${a.tokenIn.slice(0, 8)}→${a.tokenOut.slice(0, 8)}`;
    pairs[key] = (pairs[key] || 0) + 1;
    const v = (a.venue1 || '').toLowerCase();
    venues[v] = (venues[v] || 0) + 1;
    if (a.tokenIn.toLowerCase() === '0x0bd7d308f8e1639fab988df18a80151bdfeacad7' || a.tokenIn === ethers.ZeroAddress) ethIn += a.amountIn;
  }
  console.log(JSON.stringify({
    swaps: logs.length, uniqueTraders: senders.size, uniqueReferrers: referrers.size,
    topPairs: Object.entries(pairs).sort((x, y) => y[1] - x[1]).slice(0, 6),
    venues: Object.entries(venues).sort((x, y) => y[1] - x[1]).slice(0, 6),
  }, null, 1));
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
