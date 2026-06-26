# Stellar Crowdfund — Design (Orange Belt)

**Date:** 2026-06-26
**Program:** Stellar Journey to Mastery — Level 3 (🟠 Orange Belt)
**Location:** `C:\Users\Monster\Desktop\stellar-crowdfund`
**Repo:** New, separate, public GitHub repo (`stellar-crowdfund`)

---

## 1. Purpose

A production-shaped decentralized crowdfunding dApp on **Stellar Testnet** using a
**factory pattern** and **inter-contract communication**. A Factory contract deploys
individual Campaign contracts. Contributors send real Testnet XLM (via the native
Stellar Asset Contract) to a campaign; if the goal is met by the deadline the creator
withdraws the funds and the campaign records the creator's success in a Reputation
contract; otherwise contributors reclaim their contributions. The frontend is
mobile-first, streams on-chain events in real time, and ships with a CI/CD pipeline,
contract + frontend tests, and full documentation.

---

## 2. Scope

### 🔴 Mandatory (Level 3 requirements)
1. **Three contracts + inter-contract communication**, deployed to Testnet, called from the frontend:
   - Factory → Campaign (on-chain deploy + registry)
   - Campaign → Reputation (record success on successful claim)
2. **Real XLM custody**: `contribute` / `claim` / `refund` move real Testnet XLM via the native SAC; the interaction tx hash is verifiable on Stellar Expert.
3. **Event streaming + real-time** UI updates (RPC `getEvents`).
4. **CI/CD pipeline** (GitHub Actions, green).
5. **Mobile responsive** frontend.
6. **Error handling + loading states** throughout.
7. **Contract + frontend tests** (3+ passing, both layers).
8. Public repo + comprehensive README + **10+ meaningful commits** + live Vercel demo.
9. Submission artifacts: screenshots of mobile UI, CI/CD running, test output (3+); demo video (1–2 min).

### 🟡 Included enhancements
- Stellar Expert links on tx hashes; toast notifications; Friendbot "Get Test XLM".
- Reputation badge/score visible in the UI.
- Campaign progress percentage + time-remaining countdown.
- Vercel ↔ GitHub auto-deploy.

### ⚪ Out of scope (later)
Multi-asset (USDC, etc.), campaign edit/cancel, comments, categories/search, image
upload/IPFS, milestone-based release, mainnet, i18n, indexer/backend DB (RPC polling
suffices).

---

## 3. Contracts (Rust / Soroban)

Three crates under `contracts/`. All amounts are `i128` stroops of native XLM.

### 3.1 Factory (`contracts/factory`)
State: the Campaign wasm hash, the native token (SAC) address, the Reputation contract
address, and a registry `Vec<Address>` of deployed campaigns.

- `init(campaign_wasm_hash: BytesN<32>, token: Address, reputation: Address)` — one-time setup (idempotent guard).
- `create_campaign(creator: Address, goal: i128, deadline: u64) -> Address` — requires
  `creator` auth; validates `goal > 0` and `deadline > now`; **deploys a new Campaign
  contract** via the on-chain deployer (`env.deployer().with_current_contract(salt).deploy_v2`),
  calls the new campaign's `init(creator, goal, deadline, token, reputation, factory=self)`,
  appends its address to the registry, emits `campaign_created(campaign, creator)`; returns the address.
- `list_campaigns() -> Vec<Address>`.
- `is_campaign(addr: Address) -> bool` — used by Reputation to authorize callers.

### 3.2 Campaign (`contracts/campaign`)
State: creator, goal, deadline, token addr, reputation addr, factory addr, status enum
`Active|Claimed|Refunding`, total raised, and per-contributor amounts `Map<Address,i128>`.

- `init(creator, goal, deadline, token, reputation, factory)` — one-time (guarded).
- `contribute(from: Address, amount: i128)` — requires `from` auth; `amount > 0`; status
  `Active` and `now <= deadline`; calls `token.transfer(from, current_contract, amount)`
  (cross-contract to SAC); adds to the contributor's total and `total_raised`; emits
  `contributed(from, amount)`; if `total_raised >= goal` emits `goal_reached(total_raised)`.
- `claim()` — requires creator auth; only when `now > deadline` and `total_raised >= goal`
  and status `Active`; sets status `Claimed`; `token.transfer(current_contract, creator, total_raised)`;
  **calls `reputation.record_success(creator)`** (cross-contract); emits `claimed(creator, total_raised)`.
- `refund()` — callable by a contributor when `now > deadline` and `total_raised < goal`;
  sets status `Refunding`; refunds the caller's recorded contribution via
  `token.transfer(current_contract, caller, amount)`, zeroes their record; emits `refunded(caller, amount)`.
- Views: `get_summary() -> (creator, goal, deadline, total_raised, status)`, `contribution_of(addr) -> i128`.

### 3.3 Reputation (`contracts/reputation`)
State: factory address, `Map<Address,u32>` creator → successful-campaign count.

- `init(factory: Address)` — one-time (guarded).
- `record_success(creator: Address)` — **only callable by a registered campaign**: the
  caller must be `env.current_contract` invoked from a campaign; verified by calling
  `factory.is_campaign(invoker)`. Increments the creator's score; emits `reputation_up(creator, new_score)`.
- `get_score(creator: Address) -> u32`.

**Inter-contract edges:** Factory deploys + initializes Campaign (edge 1); Campaign calls
Reputation on successful claim, and Reputation calls back to Factory to authorize the
caller (edge 2). Campaign ↔ native SAC token for all value transfer.

---

## 4. Architecture (frontend-only, Next.js App Router, mobile-first)

```
contracts/
  factory/      campaign/      reputation/     # 3 Rust crates + tests
src/
  app/
    layout.tsx                 # theme + Toaster
    page.tsx                   # campaign list (home)
    campaign/[id]/page.tsx     # campaign detail (contribute / claim / refund)
    create/page.tsx            # create campaign form
  components/
    WalletBar.tsx              # StellarWalletsKit connect/disconnect + Friendbot
    CampaignCard.tsx           # list item: progress bar, % funded, countdown
    CampaignDetail.tsx         # detail view + actions + live events
    CreateForm.tsx             # goal + deadline form
    ContributeForm.tsx         # amount + contribute
    TxStatus.tsx               # pending/success/fail + Explorer link + loading states
    ReputationBadge.tsx        # creator score
  lib/
    factory.ts                 # create/list campaigns
    campaign.ts                # contribute/claim/refund/read summary
    reputation.ts              # get_score
    soroban.ts                 # shared RPC client: simulate read, invoke+sign+poll
    wallet.ts                  # StellarWalletsKit wrapper
    events.ts                  # getEvents polling (contributed/goal_reached/claimed/refunded)
    friendbot.ts               # fund testnet account
    format.ts                  # address/amount/time helpers (pure, tested)
    config.ts                  # network + factory/reputation/token addresses
  store.ts                     # zustand: wallet, campaigns, tx status, events
tests/
  format.test.ts               # pure helper unit tests (Vitest)
  CampaignCard.test.tsx        # React component test (@testing-library/react)
.github/workflows/ci.yml       # CI: contract tests + frontend lint/test/build
```

**Single-responsibility layers:** `lib/*` holds chain logic (no UI); `components/*` is
presentation; `store.ts` is shared state. Pure helpers are unit-tested; a representative
React component is tested with Testing Library; contract logic has Rust unit tests.

---

## 5. Data Flow

1. **Create** → `factory.create_campaign(creator, goal, deadline)` → Factory deploys a
   Campaign, registers it, emits `campaign_created` → UI shows the new card.
2. **Contribute** → `campaign.contribute(from, amount)` → SAC transfer into the campaign →
   `contributed` (+ `goal_reached`) event → progress bar updates live.
3. **Claim** (creator, goal met, past deadline) → funds to creator + `reputation.record_success` →
   `claimed` + `reputation_up` events → creator badge increments.
4. **Refund** (contributor, goal missed, past deadline) → contribution returned → `refunded` event.
5. **Real-time**: `events.ts` polls `getEvents` (~5s) for all campaign/factory events and
   syncs the store; reads (`get_summary`, `list_campaigns`, `get_score`) refresh via simulation.

---

## 6. Error Handling & Loading States

| Condition | Behavior |
|---|---|
| Wallet missing / rejected | Toast (error) + retry; actions disabled |
| Invalid input (goal/amount ≤ 0, deadline in past) | Inline validation, button disabled |
| Contribute after deadline / not Active | Button disabled + reason shown |
| Claim before deadline / goal not met / not creator | Button hidden or disabled with reason |
| Refund when goal met / before deadline | Button hidden |
| RPC / simulation / tx failure | TxStatus "fail" + readable error (toast) |
| In-flight tx | Spinners + disabled controls + pending status |

Every error reaches the user as a readable string (never `[object Object]`).

---

## 7. CI/CD

`.github/workflows/ci.yml` runs on push and pull_request:
- **contracts job:** install Rust + `wasm32` target, `cargo test` for the three crates.
- **frontend job:** `npm ci`, `npm run lint`, `npm test` (Vitest), `npm run build`.

A green run is captured as a submission screenshot. Vercel is connected to GitHub for
auto-deploy on the default branch.

---

## 8. Dependencies & Network

- Contracts: Rust + `soroban-sdk` (+ `testutils` for tests) + `stellar-cli`.
- Frontend: `next`, `react`, `tailwindcss` v4, `typescript`, `@stellar/stellar-sdk`,
  `@creit.tech/stellar-wallets-kit`, `zustand`, `sonner`; dev: `vitest`,
  `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`.
- Network: **Testnet** — Soroban RPC `https://soroban-testnet.stellar.org`, passphrase
  `Test SDF Network ; September 2015`, Friendbot `https://friendbot.stellar.org`,
  native SAC obtained via `stellar contract id asset --asset native --network testnet`,
  Explorer `https://stellar.expert/explorer/testnet`.

---

## 9. Testing & Delivery

- **Contracts:** Rust unit tests — Factory creates/registers a campaign; Campaign happy
  path (contribute → goal reached → claim moves funds + bumps reputation); refund path
  (goal missed → contributor reclaims); validation rejections; Reputation only accepts
  registered campaigns. Uses `testutils` + a mock/native token for transfers.
- **Frontend:** Vitest for pure helpers (`format.ts`) and a React component test for
  `CampaignCard` (renders goal/progress/countdown from props).
- **CI/CD:** GitHub Actions green on push/PR.
- Public GitHub repo, English `README.md` (overview, architecture diagram, the three
  **deployed contract addresses**, a verifiable **interaction tx hash**, setup/run, CI
  badge, screenshots, demo video link), Vercel deploy + live link, **10+ meaningful commits**.
- Demo video (1–2 min) recorded and uploaded by the user; a storyboard/script is provided,
  and optionally an automated Playwright walkthrough GIF.

---

## 10. Mandatory → Acceptance Criteria (summary)

- [ ] Factory, Campaign, Reputation deployed to Testnet; addresses recorded.
- [ ] Factory deploys a Campaign on-chain (inter-contract edge 1).
- [ ] Campaign calls Reputation on successful claim (inter-contract edge 2).
- [ ] contribute / claim / refund move real Testnet XLM; interaction tx hash on Explorer.
- [ ] Events polled; UI updates in real time.
- [ ] CI/CD pipeline green (contract + frontend jobs).
- [ ] Mobile responsive; loading states + error handling throughout.
- [ ] 3+ passing tests across contract and frontend.
- [ ] Public repo + README + 10+ commits + live Vercel demo + required screenshots + demo video.
