# Stoa Swaps — Robinhood Chain Dashboard

A public dashboard of every swap routed by [Stoa](https://stoadex.com) on
Robinhood Chain (chain ID 4663): total volume, unique traders, routes per
venue, top pairs, top referrers, and the latest swaps. Built for the Stoa
build bounty (option 3: public dashboard).

**Live page:** enable GitHub Pages on this repo (Settings → Pages → deploy
from `main`), or open `index.html` from any static host.

## How the data is built (the "queries")

All figures come from one on-chain source — the StoaRouter's `Routed` event:

- Contract: `0x2F2804fad735a38015650f32f95Ad5E08D6B3eE5` (StoaRouter, Robinhood Chain)
- Event: `Routed(address sender, address to, address referrer, address tokenIn,
  address tokenOut, uint256 amountIn, uint256 amountOut, address mid,
  address venue1, address venue2)`
- Query: `eth_getLogs` over the full chain history in 10M-block ranges
  (the public RPC `https://rpc.mainnet.chain.robinhood.com` accepts wide
  ranges; the router is young, so full history is ~12 calls).

`fetch-swaps.js` performs the scan, decodes each event with the router ABI
(`StoaRouter.json`, from stoadex.com/abi), resolves token symbols/decimals
(Stoa's token list, with on-chain fallback), prices each swap in USD (the
USDG side, or the ETH/WETH side at Stoa's own ETH→USDG quote), and writes
`data.json`, which `index.html` renders. Re-run it any time to refresh:

```bash
npm install
node fetch-swaps.js
```

## Files

- `index.html` — the dashboard (static, no build step).
- `data.json` — generated snapshot (regenerate with the script).
- `fetch-swaps.js` — the full-history indexer described above.
- `StoaRouter.json` — router ABI used to decode events.
- `probe.js` — small range scanner used while developing.

## Notes

- Figures describe StoaRouter activity only, exactly as emitted on-chain.
- Not affiliated with Stoa. Not financial advice.
