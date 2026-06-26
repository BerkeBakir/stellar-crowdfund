# Stellar Crowdfund Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-shaped Stellar Testnet crowdfunding dApp using a factory pattern with three inter-communicating Soroban contracts (Factory deploys Campaigns; Campaign moves real XLM and reports success to a Reputation contract), a mobile-first Next.js frontend with real-time events, CI/CD, and contract + frontend tests.

**Architecture:** A `Factory` contract deploys `Campaign` contracts on-chain and keeps a registry. Each `Campaign` custodies real Testnet XLM via the native Stellar Asset Contract (SAC) and, on a successful claim, calls a shared `Reputation` contract (which authorizes the caller back through the Factory registry). The Next.js frontend invokes contracts via `@stellar/stellar-sdk`, signs with StellarWalletsKit, and polls Soroban RPC `getEvents` for live updates. Pure logic is unit-tested (Rust + Vitest); a React component is tested with Testing Library; CI runs both layers.

**Tech Stack:** Rust + `soroban-sdk` 22 + `stellar-cli` 27; Next.js 16 (App Router) + TypeScript + Tailwind v4; `@stellar/stellar-sdk`; `@creit.tech/stellar-wallets-kit`; Zustand; sonner; Vitest + `@testing-library/react`; GitHub Actions; Playwright (demo video).

## Global Constraints

- **Testnet only**: Soroban RPC `https://soroban-testnet.stellar.org`, passphrase `Test SDF Network ; September 2015`, Friendbot `https://friendbot.stellar.org`, Explorer base `https://stellar.expert/explorer/testnet`. The native SAC token address is obtained via `stellar contract id asset --asset native --network testnet`.
- **Amounts** are `i128` stroops of native XLM (1 XLM = 10,000,000 stroops). `goal`, `amount`, `total_raised` are all stroops.
- **Deadlines** are unix timestamps (`u64` seconds), compared against `env.ledger().timestamp()`.
- **Three contracts + two inter-contract edges**: Factory deploys+inits Campaign (edge 1); Campaign calls Reputation on claim, Reputation authorizes via Factory `is_campaign` (edge 2). Campaign ↔ native SAC for all value transfer.
- Every error surfaced to the user must be a readable string — never `[object Object]`.
- **Loading states** on every async action; controls disabled while a tx is in flight.
- **API-VERIFY RULE:** The exact APIs of `soroban-sdk` (deployer `deploy_v2`, `token::TokenClient`, cross-contract `Client`s, `require_auth` semantics), `@stellar/stellar-sdk` (Soroban RPC), and `@creit.tech/stellar-wallets-kit` may differ across versions. Implementers MUST verify the installed package's real exports/signatures (Rust: `cargo doc`/source or compiler errors; TS: `node_modules/**/*.d.ts`) and adapt the example code, preserving the documented behavior. Reviewers verify such adaptations against the installed types. Contract logic is validated by `cargo test` BEFORE deploy — make the tests pass, adapting APIs as needed.
- Toolchain note: this machine ALREADY has rustup (default toolchain `stable-x86_64-pc-windows-gnu`), `wasm32v1-none` + `wasm32-unknown-unknown` targets, and `stellar` CLI 27 at `~/.cargo/bin`. Prepend `export PATH="$HOME/.cargo/bin:$PATH"`. Plain `cargo test` fails at the mingw cdylib link step on Windows — use `cargo test --lib` for contract unit tests; the wasm release build (`stellar contract build`) is what gets deployed.
- Commit after each task with a clear conventional message (target: 10+ meaningful commits).

---

### Task 1: Toolchain check, funded identity, native SAC address

**Files:**
- Create: `contracts/.gitkeep`
- Create: `docs/DEPLOY_NOTES.md`

**Interfaces:**
- Produces: a funded Testnet identity `crowdfund` (its `G...` address recorded), and the native SAC token contract address, both in `docs/DEPLOY_NOTES.md`. Later tasks deploy with `--source crowdfund` and pass the token address to the Factory.

- [ ] **Step 1: Verify the toolchain**

Run:
```bash
export PATH="$HOME/.cargo/bin:$PATH"
rustc --version && cargo --version && stellar --version
rustup target list --installed | grep wasm32
```
Expected: prints versions and at least one `wasm32...` target. (If `stellar` is missing, install via `winget install --id Stellar.StellarCLI --source winget --accept-package-agreements --accept-source-agreements --disable-interactivity`.)

- [ ] **Step 2: Create and fund the identity**

Run:
```bash
export PATH="$HOME/.cargo/bin:$PATH"
stellar keys generate crowdfund --network testnet --fund --overwrite
stellar keys address crowdfund
```
Expected: prints a funded `G...` address.

- [ ] **Step 3: Get the native SAC token address**

Run:
```bash
export PATH="$HOME/.cargo/bin:$PATH"
stellar contract id asset --asset native --network testnet
```
Expected: prints a `C...` contract address (the wrapped native XLM token). Record it.

- [ ] **Step 4: Record notes and commit**

Create `contracts/.gitkeep` (empty) and `docs/DEPLOY_NOTES.md` containing: the toolchain versions, the `crowdfund` `G...` address (public key only — never the secret), and the native SAC `C...` address. Leave placeholders for the three contract IDs.

```bash
git add contracts/.gitkeep docs/DEPLOY_NOTES.md
git commit -m "chore: toolchain check, funded testnet identity, native SAC address"
```

---

### Task 2: Reputation contract + tests

**Files:**
- Create: `contracts/reputation/Cargo.toml`
- Create: `contracts/reputation/src/lib.rs`
- Create: `contracts/reputation/src/test.rs`

**Interfaces:**
- Produces (contract functions):
  - `init(factory: Address)` — one-time (guarded).
  - `record_success(campaign: Address, creator: Address)` — requires `campaign` auth; requires `factory.is_campaign(campaign) == true`; increments `creator`'s score; emits `("rep_up", creator)` → `new_score`.
  - `get_score(creator: Address) -> u32`.
- Consumes: a Factory client interface `is_campaign(Address) -> bool` (defined in Task 4; in tests a mock factory provides it).

- [ ] **Step 1: `contracts/reputation/Cargo.toml`**

```toml
[package]
name = "reputation"
version = "0.1.0"
edition = "2021"
publish = false

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
soroban-sdk = "22"

[dev-dependencies]
soroban-sdk = { version = "22", features = ["testutils"] }

[profile.release]
opt-level = "z"
overflow-checks = true
debug = 0
strip = "symbols"
panic = "abort"
codegen-units = 1
lto = true
```

(API-VERIFY: confirm the installed `soroban-sdk` major with `cargo search soroban-sdk`; if not `22`, use the installed major and adapt APIs.)

- [ ] **Step 2: Write the failing tests `contracts/reputation/src/test.rs`**

```rust
#![cfg(test)]
use super::{Reputation, ReputationClient};
use soroban_sdk::{contract, contractimpl, testutils::Address as _, Address, Env};

// Minimal mock factory exposing is_campaign.
#[contract]
pub struct MockFactory;
#[contractimpl]
impl MockFactory {
    pub fn is_campaign(_env: Env, _addr: Address) -> bool {
        true
    }
}

#[contract]
pub struct MockFactoryNo;
#[contractimpl]
impl MockFactoryNo {
    pub fn is_campaign(_env: Env, _addr: Address) -> bool {
        false
    }
}

fn setup(factory_yes: bool) -> (Env, ReputationClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let factory = if factory_yes {
        env.register(MockFactory, ())
    } else {
        env.register(MockFactoryNo, ())
    };
    let rep_id = env.register(Reputation, ());
    let client = ReputationClient::new(&env, &rep_id);
    client.init(&factory);
    (env, client, factory)
}

#[test]
fn records_and_reads_score() {
    let (env, client, _f) = setup(true);
    let campaign = Address::generate(&env);
    let creator = Address::generate(&env);
    client.record_success(&campaign, &creator);
    client.record_success(&campaign, &creator);
    assert_eq!(client.get_score(&creator), 2);
}

#[test]
fn unknown_creator_is_zero() {
    let (env, client, _f) = setup(true);
    let who = Address::generate(&env);
    assert_eq!(client.get_score(&who), 0);
}

#[test]
#[should_panic(expected = "caller is not a registered campaign")]
fn rejects_unregistered_campaign() {
    let (env, client, _f) = setup(false);
    let campaign = Address::generate(&env);
    let creator = Address::generate(&env);
    client.record_success(&campaign, &creator);
}
```

- [ ] **Step 3: Run to verify fail**

Run: `export PATH="$HOME/.cargo/bin:$PATH" && cd contracts/reputation && cargo test --lib`
Expected: FAIL — `Reputation`/`ReputationClient` not defined.

- [ ] **Step 4: Write `contracts/reputation/src/lib.rs`**

```rust
#![no_std]
use soroban_sdk::{
    contract, contractclient, contractimpl, contracttype, symbol_short, Address, Env,
};

#[contractclient(name = "FactoryClient")]
pub trait FactoryInterface {
    fn is_campaign(env: Env, addr: Address) -> bool;
}

#[contracttype]
pub enum DataKey {
    Factory,
    Score(Address),
}

#[contract]
pub struct Reputation;

#[contractimpl]
impl Reputation {
    pub fn init(env: Env, factory: Address) {
        if env.storage().instance().has(&DataKey::Factory) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Factory, &factory);
    }

    pub fn record_success(env: Env, campaign: Address, creator: Address) {
        // The calling campaign must authorize this sub-invocation.
        campaign.require_auth();

        let factory: Address = env.storage().instance().get(&DataKey::Factory).unwrap();
        let is_campaign = FactoryClient::new(&env, &factory).is_campaign(&campaign);
        if !is_campaign {
            panic!("caller is not a registered campaign");
        }

        let key = DataKey::Score(creator.clone());
        let score: u32 = env.storage().persistent().get(&key).unwrap_or(0);
        let new_score = score + 1;
        env.storage().persistent().set(&key, &new_score);
        env.events()
            .publish((symbol_short!("rep_up"), creator), new_score);
    }

    pub fn get_score(env: Env, creator: Address) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::Score(creator))
            .unwrap_or(0)
    }
}

mod test;
```

(API-VERIFY: `#[contractclient]` on a trait generates `FactoryClient`. Confirm this attribute exists in soroban-sdk 22; if the registration call `env.register(C, ())` differs, adapt `setup()` and the test mock accordingly.)

- [ ] **Step 5: Run to verify pass**

Run: `export PATH="$HOME/.cargo/bin:$PATH" && cd contracts/reputation && cargo test --lib`
Expected: PASS — 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add contracts/reputation
git commit -m "feat(contract): reputation contract with factory-gated record_success + tests"
```

---

### Task 3: Campaign contract + tests

**Files:**
- Create: `contracts/campaign/Cargo.toml`
- Create: `contracts/campaign/src/lib.rs`
- Create: `contracts/campaign/src/test.rs`

**Interfaces:**
- Produces (contract functions):
  - `init(creator, goal: i128, deadline: u64, token: Address, reputation: Address, factory: Address)` — one-time (guarded).
  - `contribute(from: Address, amount: i128)` — `from` auth; `amount > 0`; status Active; `now <= deadline`; SAC `transfer(from → this, amount)`; updates contributor total + `total_raised`; emits `("contrib", from)` → amount; if reached, emits `("goal_met",)` → total.
  - `claim()` — creator auth; `now > deadline`; `total_raised >= goal`; status Active → Claimed; SAC `transfer(this → creator, total_raised)`; calls `reputation.record_success(this, creator)`; emits `("claimed", creator)` → total.
  - `refund()` — caller is a contributor; `now > deadline`; `total_raised < goal`; SAC `transfer(this → caller, their_amount)`; zero their record; emits `("refunded", caller)` → amount.
  - Views: `summary() -> (Address, i128, u64, i128, u32)` = (creator, goal, deadline, total_raised, status_code), `contribution_of(addr) -> i128`.
- Consumes: native SAC token client (`soroban_sdk::token::TokenClient`); a Reputation client (`record_success(campaign, creator)`).

- [ ] **Step 1: `contracts/campaign/Cargo.toml`**

```toml
[package]
name = "campaign"
version = "0.1.0"
edition = "2021"
publish = false

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
soroban-sdk = "22"

[dev-dependencies]
soroban-sdk = { version = "22", features = ["testutils"] }

[profile.release]
opt-level = "z"
overflow-checks = true
debug = 0
strip = "symbols"
panic = "abort"
codegen-units = 1
lto = true
```

- [ ] **Step 2: Write the failing tests `contracts/campaign/src/test.rs`**

```rust
#![cfg(test)]
use super::{Campaign, CampaignClient};
use soroban_sdk::{
    contract, contractimpl, symbol_short,
    testutils::{Address as _, Ledger},
    token, Address, Env,
};

// Mock reputation that records calls.
#[contract]
pub struct MockRep;
#[contractimpl]
impl MockRep {
    pub fn record_success(env: Env, _campaign: Address, creator: Address) {
        env.events().publish((symbol_short!("rec"),), creator);
    }
}

fn create_token<'a>(env: &Env, admin: &Address) -> (Address, token::StellarAssetClient<'a>) {
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let id = sac.address();
    (id.clone(), token::StellarAssetClient::new(env, &id))
}

fn setup() -> (Env, CampaignClient<'static>, Address, Address, token::StellarAssetClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1000);

    let admin = Address::generate(&env);
    let (token_id, token_admin) = create_token(&env, &admin);
    let reputation = env.register(MockRep, ());
    let factory = Address::generate(&env);
    let creator = Address::generate(&env);

    let campaign_id = env.register(Campaign, ());
    let client = CampaignClient::new(&env, &campaign_id);
    // goal 1000 stroops, deadline 2000
    client.init(&creator, &1000i128, &2000u64, &token_id, &reputation, &factory);
    (env, client, creator, token_id, token_admin, reputation)
}

#[test]
fn contribute_accumulates_and_reaches_goal() {
    let (env, client, _creator, token_id, token_admin, _rep) = setup();
    let alice = Address::generate(&env);
    token_admin.mint(&alice, &1000);
    let token_client = token::TokenClient::new(&env, &token_id);

    client.contribute(&alice, &600);
    client.contribute(&alice, &500); // now 1100 >= 1000

    assert_eq!(client.contribution_of(&alice), 1100);
    let (_c, goal, _d, total, _status) = client.summary();
    assert_eq!(goal, 1000);
    assert_eq!(total, 1100);
    // funds moved into the campaign
    assert_eq!(token_client.balance(&client.address), 1100);
    assert_eq!(token_client.balance(&alice), 1000 - 1100 + 0); // alice spent 1100 of 1000? see mint below
}

#[test]
fn claim_after_success_moves_funds_and_calls_reputation() {
    let (env, client, creator, token_id, token_admin, _rep) = setup();
    let alice = Address::generate(&env);
    token_admin.mint(&alice, &2000);
    client.contribute(&alice, &1000); // exactly goal
    let token_client = token::TokenClient::new(&env, &token_id);

    env.ledger().set_timestamp(3000); // past deadline 2000
    client.claim();

    assert_eq!(token_client.balance(&creator), 1000);
    let (_c, _g, _d, _t, status) = client.summary();
    assert_eq!(status, 1); // Claimed
}

#[test]
fn refund_when_goal_missed() {
    let (env, client, _creator, token_id, token_admin, _rep) = setup();
    let bob = Address::generate(&env);
    token_admin.mint(&bob, &2000);
    client.contribute(&bob, &400); // below goal 1000
    let token_client = token::TokenClient::new(&env, &token_id);

    env.ledger().set_timestamp(3000); // past deadline
    client.refund(&bob);

    assert_eq!(token_client.balance(&bob), 2000); // got the 400 back
    assert_eq!(client.contribution_of(&bob), 0);
}

#[test]
#[should_panic(expected = "campaign is not active")]
fn cannot_contribute_after_deadline() {
    let (env, client, _creator, _t, token_admin, _rep) = setup();
    let alice = Address::generate(&env);
    token_admin.mint(&alice, &1000);
    env.ledger().set_timestamp(3000);
    client.contribute(&alice, &100);
}

#[test]
#[should_panic(expected = "goal not reached")]
fn cannot_claim_when_goal_missed() {
    let (env, client, _creator, _t, token_admin, _rep) = setup();
    let alice = Address::generate(&env);
    token_admin.mint(&alice, &1000);
    client.contribute(&alice, &100);
    env.ledger().set_timestamp(3000);
    client.claim();
}
```

NOTE for implementer: the `refund` signature in tests is `refund(caller)` (caller passed explicitly and `require_auth`'d) — adjust the contract to take `caller: Address`. Fix the `contribute_accumulates_and_reaches_goal` balance asserts to match real mint amounts (mint alice 2000, contribute 1100 → alice 900, campaign 1100); correct the arithmetic when implementing so the test asserts true balances.

- [ ] **Step 3: Run to verify fail**

Run: `export PATH="$HOME/.cargo/bin:$PATH" && cd contracts/campaign && cargo test --lib`
Expected: FAIL — `Campaign` not defined.

- [ ] **Step 4: Write `contracts/campaign/src/lib.rs`**

```rust
#![no_std]
use soroban_sdk::{
    contract, contractclient, contractimpl, contracttype, symbol_short, token, Address, Env,
};

#[contractclient(name = "ReputationClient")]
pub trait ReputationInterface {
    fn record_success(env: Env, campaign: Address, creator: Address);
}

#[derive(Clone, Copy, PartialEq)]
#[contracttype]
pub enum Status {
    Active = 0,
    Claimed = 1,
    Refunding = 2,
}

#[contracttype]
pub enum DataKey {
    Creator,
    Goal,
    Deadline,
    Token,
    Reputation,
    Factory,
    Status,
    TotalRaised,
    Contribution(Address),
}

#[contract]
pub struct Campaign;

#[contractimpl]
impl Campaign {
    pub fn init(
        env: Env,
        creator: Address,
        goal: i128,
        deadline: u64,
        token: Address,
        reputation: Address,
        factory: Address,
    ) {
        if env.storage().instance().has(&DataKey::Creator) {
            panic!("already initialized");
        }
        if goal <= 0 {
            panic!("goal must be positive");
        }
        let s = env.storage().instance();
        s.set(&DataKey::Creator, &creator);
        s.set(&DataKey::Goal, &goal);
        s.set(&DataKey::Deadline, &deadline);
        s.set(&DataKey::Token, &token);
        s.set(&DataKey::Reputation, &reputation);
        s.set(&DataKey::Factory, &factory);
        s.set(&DataKey::Status, &Status::Active);
        s.set(&DataKey::TotalRaised, &0i128);
    }

    pub fn contribute(env: Env, from: Address, amount: i128) {
        from.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }
        let s = env.storage().instance();
        let status: Status = s.get(&DataKey::Status).unwrap();
        let deadline: u64 = s.get(&DataKey::Deadline).unwrap();
        if status != Status::Active || env.ledger().timestamp() > deadline {
            panic!("campaign is not active");
        }

        let token: Address = s.get(&DataKey::Token).unwrap();
        let this = env.current_contract_address();
        token::TokenClient::new(&env, &token).transfer(&from, &this, &amount);

        let ckey = DataKey::Contribution(from.clone());
        let prev: i128 = env.storage().persistent().get(&ckey).unwrap_or(0);
        env.storage().persistent().set(&ckey, &(prev + amount));

        let total: i128 = s.get(&DataKey::TotalRaised).unwrap();
        let new_total = total + amount;
        s.set(&DataKey::TotalRaised, &new_total);

        env.events().publish((symbol_short!("contrib"), from), amount);

        let goal: i128 = s.get(&DataKey::Goal).unwrap();
        if new_total >= goal {
            env.events().publish((symbol_short!("goal_met"),), new_total);
        }
    }

    pub fn claim(env: Env) {
        let s = env.storage().instance();
        let creator: Address = s.get(&DataKey::Creator).unwrap();
        creator.require_auth();

        let status: Status = s.get(&DataKey::Status).unwrap();
        let deadline: u64 = s.get(&DataKey::Deadline).unwrap();
        let goal: i128 = s.get(&DataKey::Goal).unwrap();
        let total: i128 = s.get(&DataKey::TotalRaised).unwrap();
        if status != Status::Active {
            panic!("campaign is not active");
        }
        if env.ledger().timestamp() <= deadline {
            panic!("deadline not reached");
        }
        if total < goal {
            panic!("goal not reached");
        }

        s.set(&DataKey::Status, &Status::Claimed);

        let token: Address = s.get(&DataKey::Token).unwrap();
        let this = env.current_contract_address();
        token::TokenClient::new(&env, &token).transfer(&this, &creator, &total);

        let reputation: Address = s.get(&DataKey::Reputation).unwrap();
        ReputationClient::new(&env, &reputation).record_success(&this, &creator);

        env.events().publish((symbol_short!("claimed"), creator), total);
    }

    pub fn refund(env: Env, caller: Address) {
        caller.require_auth();
        let s = env.storage().instance();
        let status: Status = s.get(&DataKey::Status).unwrap();
        let deadline: u64 = s.get(&DataKey::Deadline).unwrap();
        let goal: i128 = s.get(&DataKey::Goal).unwrap();
        let total: i128 = s.get(&DataKey::TotalRaised).unwrap();
        if env.ledger().timestamp() <= deadline {
            panic!("deadline not reached");
        }
        if total >= goal {
            panic!("goal was reached");
        }
        if status == Status::Claimed {
            panic!("already claimed");
        }
        s.set(&DataKey::Status, &Status::Refunding);

        let ckey = DataKey::Contribution(caller.clone());
        let amount: i128 = env.storage().persistent().get(&ckey).unwrap_or(0);
        if amount <= 0 {
            panic!("nothing to refund");
        }
        env.storage().persistent().set(&ckey, &0i128);

        let token: Address = s.get(&DataKey::Token).unwrap();
        let this = env.current_contract_address();
        token::TokenClient::new(&env, &token).transfer(&this, &caller, &amount);

        env.events().publish((symbol_short!("refunded"), caller), amount);
    }

    pub fn summary(env: Env) -> (Address, i128, u64, i128, u32) {
        let s = env.storage().instance();
        let creator: Address = s.get(&DataKey::Creator).unwrap();
        let goal: i128 = s.get(&DataKey::Goal).unwrap();
        let deadline: u64 = s.get(&DataKey::Deadline).unwrap();
        let total: i128 = s.get(&DataKey::TotalRaised).unwrap();
        let status: Status = s.get(&DataKey::Status).unwrap();
        (creator, goal, deadline, total, status as u32)
    }

    pub fn contribution_of(env: Env, who: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Contribution(who))
            .unwrap_or(0)
    }
}

mod test;
```

(API-VERIFY: confirm `token::TokenClient`, `token::StellarAssetClient`, `env.register_stellar_asset_contract_v2`, and `#[contractclient]` exist in soroban-sdk 22; the SAC test helper name changed across versions — adapt the test's `create_token` to the installed API. Confirm `Status as u32` is valid for the `#[contracttype]` enum; if not, map explicitly.)

- [ ] **Step 5: Run to verify pass; fix balance asserts**

Run: `export PATH="$HOME/.cargo/bin:$PATH" && cd contracts/campaign && cargo test --lib`
Expected: PASS — 5 tests pass (after correcting the balance arithmetic noted in Step 2).

- [ ] **Step 6: Commit**

```bash
git add contracts/campaign
git commit -m "feat(contract): campaign with XLM custody, claim->reputation, refund + tests"
```

---

### Task 4: Factory contract + tests

**Files:**
- Create: `contracts/factory/Cargo.toml`
- Create: `contracts/factory/src/lib.rs`
- Create: `contracts/factory/src/test.rs`

**Interfaces:**
- Produces:
  - `init(campaign_wasm_hash: BytesN<32>, token: Address, reputation: Address)` — one-time (guarded).
  - `create_campaign(creator: Address, goal: i128, deadline: u64) -> Address` — `creator` auth; `goal > 0`; deploys a Campaign via the on-chain deployer, calls its `init`, registers it, emits `("created", campaign)` → creator; returns the campaign address.
  - `list_campaigns() -> Vec<Address>`.
  - `is_campaign(addr: Address) -> bool`.
- Consumes: the Campaign wasm (its hash is installed/uploaded and passed to `init`); a Campaign client for the cross-deploy `init` call.

- [ ] **Step 1: `contracts/factory/Cargo.toml`**

```toml
[package]
name = "factory"
version = "0.1.0"
edition = "2021"
publish = false

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
soroban-sdk = "22"

[dev-dependencies]
soroban-sdk = { version = "22", features = ["testutils"] }
campaign = { path = "../campaign" }

[profile.release]
opt-level = "z"
overflow-checks = true
debug = 0
strip = "symbols"
panic = "abort"
codegen-units = 1
lto = true
```

- [ ] **Step 2: Write the failing tests `contracts/factory/src/test.rs`**

```rust
#![cfg(test)]
use super::{Factory, FactoryClient};
use soroban_sdk::{testutils::Address as _, Address, BytesN, Env};

fn setup() -> (Env, FactoryClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1000);

    // Upload the campaign wasm so the factory can deploy instances of it.
    let wasm_hash = env.deployer().upload_contract_wasm(campaign::WASM);
    let token = Address::generate(&env);
    let reputation = Address::generate(&env);

    let factory_id = env.register(Factory, ());
    let client = FactoryClient::new(&env, &factory_id);
    client.init(&wasm_hash, &token, &reputation);
    let creator = Address::generate(&env);
    (env, client, creator)
}

#[test]
fn creates_and_registers_campaign() {
    let (env, client, creator) = setup();
    let addr = client.create_campaign(&creator, &1000i128, &2000u64);
    let list = client.list_campaigns();
    assert_eq!(list.len(), 1);
    assert_eq!(list.get(0).unwrap(), addr.clone());
    assert!(client.is_campaign(&addr));
    let random = Address::generate(&env);
    assert!(!client.is_campaign(&random));
}

#[test]
#[should_panic(expected = "goal must be positive")]
fn rejects_zero_goal() {
    let (_env, client, creator) = setup();
    client.create_campaign(&creator, &0i128, &2000u64);
}
```

(API-VERIFY: `campaign::WASM` is the constant `soroban-sdk` generates for the campaign crate's compiled wasm in dev/test. Confirm the constant name; some versions expose it via `contractimport!` instead. If `campaign::WASM` is unavailable, use `soroban_sdk::contractimport!(file = "../campaign/target/wasm32v1-none/release/campaign.wasm")` in the test after building the campaign wasm, and adapt.)

- [ ] **Step 3: Run to verify fail**

Run: `export PATH="$HOME/.cargo/bin:$PATH" && cd contracts/factory && cargo test --lib`
Expected: FAIL — `Factory` not defined (and you may need the campaign wasm built first).

- [ ] **Step 4: Write `contracts/factory/src/lib.rs`**

```rust
#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, BytesN, Env, Vec,
};

// Generated client for calling the freshly-deployed campaign's init.
mod campaign_contract {
    use soroban_sdk::contractimport;
    contractimport!(file = "../campaign/target/wasm32v1-none/release/campaign.wasm");
}

#[contracttype]
pub enum DataKey {
    WasmHash,
    Token,
    Reputation,
    Campaigns,
    IsCampaign(Address),
    Counter,
}

#[contract]
pub struct Factory;

#[contractimpl]
impl Factory {
    pub fn init(env: Env, campaign_wasm_hash: BytesN<32>, token: Address, reputation: Address) {
        if env.storage().instance().has(&DataKey::WasmHash) {
            panic!("already initialized");
        }
        let s = env.storage().instance();
        s.set(&DataKey::WasmHash, &campaign_wasm_hash);
        s.set(&DataKey::Token, &token);
        s.set(&DataKey::Reputation, &reputation);
        s.set(&DataKey::Campaigns, &Vec::<Address>::new(&env));
        s.set(&DataKey::Counter, &0u32);
    }

    pub fn create_campaign(env: Env, creator: Address, goal: i128, deadline: u64) -> Address {
        creator.require_auth();
        if goal <= 0 {
            panic!("goal must be positive");
        }

        let s = env.storage().instance();
        let wasm_hash: BytesN<32> = s.get(&DataKey::WasmHash).unwrap();
        let token: Address = s.get(&DataKey::Token).unwrap();
        let reputation: Address = s.get(&DataKey::Reputation).unwrap();

        // Unique salt per campaign.
        let counter: u32 = s.get(&DataKey::Counter).unwrap();
        let mut salt_bytes = [0u8; 32];
        salt_bytes[0] = counter as u8;
        salt_bytes[1] = (counter >> 8) as u8;
        salt_bytes[2] = (counter >> 16) as u8;
        salt_bytes[3] = (counter >> 24) as u8;
        let salt = BytesN::from_array(&env, &salt_bytes);

        let campaign_addr = env
            .deployer()
            .with_current_contract(salt)
            .deploy_v2(wasm_hash, ());

        // Initialize the new campaign.
        let factory_addr = env.current_contract_address();
        campaign_contract::Client::new(&env, &campaign_addr).init(
            &creator,
            &goal,
            &deadline,
            &token,
            &reputation,
            &factory_addr,
        );

        // Register.
        let mut list: Vec<Address> = s.get(&DataKey::Campaigns).unwrap();
        list.push_back(campaign_addr.clone());
        s.set(&DataKey::Campaigns, &list);
        s.set(&DataKey::IsCampaign(campaign_addr.clone()), &true);
        s.set(&DataKey::Counter, &(counter + 1));

        env.events()
            .publish((symbol_short!("created"), campaign_addr.clone()), creator);

        campaign_addr
    }

    pub fn list_campaigns(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::Campaigns)
            .unwrap_or(Vec::new(&env))
    }

    pub fn is_campaign(env: Env, addr: Address) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::IsCampaign(addr))
            .unwrap_or(false)
    }
}

mod test;
```

(API-VERIFY: `env.deployer().with_current_contract(salt).deploy_v2(wasm_hash, constructor_args)` is the soroban-sdk 22 deployer API — confirm `deploy_v2`'s signature (it may take `(wasm_hash, constructor_args)` where args is `()` when there's no `#[contractimpl]` constructor; here the Campaign has no `__constructor`, so we deploy then call `init` separately, passing `()` as constructor args). If `deploy_v2` differs, use the version's deploy call. `contractimport!` requires the campaign wasm to exist at the given path — Task 5 ensures the build order, but for `cargo test` the campaign wasm must be built first; document this.)

- [ ] **Step 5: Build campaign wasm, then run factory tests**

Run:
```bash
export PATH="$HOME/.cargo/bin:$PATH"
cd contracts/campaign && stellar contract build && cd ../factory && cargo test --lib
```
Expected: PASS — 2 tests pass. (If `campaign::WASM` was used in the test instead of a path import, the dev-dependency on `campaign` provides it.)

- [ ] **Step 6: Commit**

```bash
git add contracts/factory
git commit -m "feat(contract): factory deploys+registers campaigns + tests"
```

---

### Task 5: Build all + deploy workflow to Testnet

**Files:**
- Create: `scripts/deploy.sh`
- Modify: `docs/DEPLOY_NOTES.md` (append the three contract IDs + deploy tx)

**Interfaces:**
- Consumes: funded `crowdfund` identity + native SAC address (Task 1); the three built contracts.
- Produces: deployed **Reputation**, **Factory** contract IDs (and the installed Campaign wasm hash), all recorded. The frontend `config.ts` (Task 7) uses the Factory + Reputation IDs and the token address.

- [ ] **Step 1: Write `scripts/deploy.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.cargo/bin:$PATH"
NET=testnet
SRC=crowdfund
TOKEN=$(stellar contract id asset --asset native --network $NET)

echo "Building contracts..."
( cd contracts/campaign && stellar contract build )
( cd contracts/reputation && stellar contract build )
( cd contracts/factory && stellar contract build )

echo "Uploading campaign wasm (returns hash)..."
CAMPAIGN_HASH=$(stellar contract upload --wasm contracts/campaign/target/wasm32v1-none/release/campaign.wasm --source $SRC --network $NET)

echo "Deploying reputation (init deferred until factory known)..."
REP_ID=$(stellar contract deploy --wasm contracts/reputation/target/wasm32v1-none/release/reputation.wasm --source $SRC --network $NET)

echo "Deploying factory..."
FACTORY_ID=$(stellar contract deploy --wasm contracts/factory/target/wasm32v1-none/release/factory.wasm --source $SRC --network $NET)

echo "Init factory (campaign hash, token, reputation)..."
stellar contract invoke --id $FACTORY_ID --source $SRC --network $NET -- init --campaign_wasm_hash $CAMPAIGN_HASH --token $TOKEN --reputation $REP_ID

echo "Init reputation (factory)..."
stellar contract invoke --id $REP_ID --source $SRC --network $NET -- init --factory $FACTORY_ID

echo "TOKEN=$TOKEN"
echo "CAMPAIGN_HASH=$CAMPAIGN_HASH"
echo "REPUTATION_ID=$REP_ID"
echo "FACTORY_ID=$FACTORY_ID"
```

- [ ] **Step 2: Run the deploy**

Run: `export PATH="$HOME/.cargo/bin:$PATH" && bash scripts/deploy.sh`
Expected: prints the token address, campaign wasm hash, reputation ID, factory ID. (If `stellar contract upload` flag differs, use `stellar contract install`; confirm against `stellar contract --help`.)

- [ ] **Step 3: Smoke-test create_campaign**

Run (substitute IDs; `G` = `stellar keys address crowdfund`):
```bash
export PATH="$HOME/.cargo/bin:$PATH"
NOW=$(date +%s); DEADLINE=$((NOW+3600))
stellar contract invoke --id <FACTORY_ID> --source crowdfund --network testnet -- create_campaign --creator <G> --goal 100000000 --deadline $DEADLINE
stellar contract invoke --id <FACTORY_ID> --source crowdfund --network testnet -- list_campaigns
```
Expected: returns a new campaign `C...` address; `list_campaigns` includes it.

- [ ] **Step 4: Record and commit**

Append to `docs/DEPLOY_NOTES.md`: token address, campaign wasm hash, reputation ID, factory ID, the deploy + create tx hashes, and Explorer links. Commit:
```bash
git add scripts/deploy.sh docs/DEPLOY_NOTES.md
git commit -m "chore: deploy workflow; deploy factory+reputation to testnet"
```

---

### Task 6: Next.js scaffold, dependencies, config

**Files:**
- Create: project scaffold via `create-next-app` (root, alongside `contracts/`, `docs/`, `scripts/`)
- Create: `src/lib/config.ts`
- Modify: `package.json` (test script)

**Interfaces:**
- Produces: `src/lib/config.ts` exporting `NETWORK_PASSPHRASE`, `RPC_URL`, `FRIENDBOT_URL`, `EXPLORER_BASE_URL`, `EXPLORER_TX_URL` helper, `FACTORY_ID`, `REPUTATION_ID`, `TOKEN_ID`.

- [ ] **Step 1: Scaffold**

Run (if `create-next-app` refuses due to existing dirs, temporarily move `contracts/ docs/ scripts/ .superpowers/` aside, scaffold, then move back):
```bash
npx --yes create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --no-turbopack --use-npm
```
Expected: app created; `src/app/page.tsx` exists.

- [ ] **Step 2: Dependencies + test tooling**

```bash
npm install @stellar/stellar-sdk @creit.tech/stellar-wallets-kit zustand sonner
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @vitejs/plugin-react
```

- [ ] **Step 3: Test config + script**

Add `"test": "vitest run"` to `package.json` scripts. Set `compilerOptions.target` to `"ES2020"` in `tsconfig.json` (BigInt literals). Create `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', globals: true, setupFiles: ['./vitest.setup.ts'] },
});
```
Create `vitest.setup.ts`:
```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 4: `src/lib/config.ts`** (fill IDs from `docs/DEPLOY_NOTES.md`)

```ts
export const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
export const RPC_URL = 'https://soroban-testnet.stellar.org';
export const FRIENDBOT_URL = 'https://friendbot.stellar.org';
export const EXPLORER_BASE_URL = 'https://stellar.expert/explorer/testnet';

export const FACTORY_ID = '__FACTORY_ID__';
export const REPUTATION_ID = '__REPUTATION_ID__';
export const TOKEN_ID = '__TOKEN_ID__';

export function explorerTxUrl(hash: string): string {
  return `${EXPLORER_BASE_URL}/tx/${hash}`;
}
export function explorerContractUrl(id: string): string {
  return `${EXPLORER_BASE_URL}/contract/${id}`;
}
```

- [ ] **Step 5: Build + commit**

Run: `npm run build`
```bash
git add -A
git commit -m "chore: scaffold Next.js app, deps, test tooling, config"
```

---

### Task 7: Pure helpers (`format.ts`) + Vitest

**Files:**
- Create: `src/lib/format.ts`
- Test: `tests/format.test.ts`

**Interfaces:**
- Produces:
  - `truncate(addr: string): string` — `CABC…WXYZ` (first 5 + last 4) for len > 12, else input.
  - `stroopsToXlm(stroops: bigint): string` — divide by 10_000_000, trim trailing zeros, e.g. `15000000n → "1.5"`.
  - `xlmToStroops(xlm: string): bigint` — parse a decimal XLM string to stroops; throws on invalid.
  - `pct(raised: bigint, goal: bigint): number` — clamped 0–100 integer percent.
  - `timeLeft(deadline: number, now: number): string` — `"2d 3h"`, `"5h 12m"`, or `"ended"`.

- [ ] **Step 1: Write the failing tests `tests/format.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { truncate, stroopsToXlm, xlmToStroops, pct, timeLeft } from '@/lib/format';

describe('truncate', () => {
  it('shortens long', () => expect(truncate('CABCDEFGHIJKLMNOPQRSTUV')).toBe('CABCD…QRSTUV'.slice(0,5)+'…'+'CABCDEFGHIJKLMNOPQRSTUV'.slice(-4)));
  it('keeps short', () => expect(truncate('CABC')).toBe('CABC'));
});

describe('stroopsToXlm', () => {
  it('whole', () => expect(stroopsToXlm(10000000n)).toBe('1'));
  it('fraction', () => expect(stroopsToXlm(15000000n)).toBe('1.5'));
  it('zero', () => expect(stroopsToXlm(0n)).toBe('0'));
});

describe('xlmToStroops', () => {
  it('whole', () => expect(xlmToStroops('2')).toBe(20000000n));
  it('fraction', () => expect(xlmToStroops('1.5')).toBe(15000000n));
  it('rejects bad', () => expect(() => xlmToStroops('abc')).toThrow());
});

describe('pct', () => {
  it('half', () => expect(pct(50n, 100n)).toBe(50));
  it('clamps over', () => expect(pct(150n, 100n)).toBe(100));
  it('zero goal', () => expect(pct(10n, 0n)).toBe(0));
});

describe('timeLeft', () => {
  it('ended', () => expect(timeLeft(100, 200)).toBe('ended'));
  it('hours', () => expect(timeLeft(1000 + 3600 * 5, 1000)).toBe('5h 0m'));
});
```

- [ ] **Step 2: Run to verify fail** — `npm test` → FAIL (module missing).

- [ ] **Step 3: Write `src/lib/format.ts`**

```ts
const STROOPS = 10_000_000n;

export function truncate(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 5)}…${addr.slice(-4)}`;
}

export function stroopsToXlm(stroops: bigint): string {
  const neg = stroops < 0n;
  const abs = neg ? -stroops : stroops;
  const whole = abs / STROOPS;
  const frac = abs % STROOPS;
  let out = whole.toString();
  if (frac > 0n) {
    const fracStr = frac.toString().padStart(7, '0').replace(/0+$/, '');
    out += `.${fracStr}`;
  }
  return neg ? `-${out}` : out;
}

export function xlmToStroops(xlm: string): bigint {
  const t = xlm.trim();
  if (!/^\d+(\.\d{1,7})?$/.test(t)) throw new Error('Invalid XLM amount');
  const [whole, frac = ''] = t.split('.');
  const fracPadded = frac.padEnd(7, '0');
  return BigInt(whole) * STROOPS + BigInt(fracPadded);
}

export function pct(raised: bigint, goal: bigint): number {
  if (goal <= 0n) return 0;
  const p = Number((raised * 100n) / goal);
  return Math.max(0, Math.min(100, p));
}

export function timeLeft(deadline: number, now: number): string {
  const s = deadline - now;
  if (s <= 0) return 'ended';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  return `${h}h ${m}m`;
}
```

- [ ] **Step 4: Run to verify pass** — `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/format.ts tests/format.test.ts vitest.config.ts vitest.setup.ts
git commit -m "feat: pure format/validation helpers with tests"
```

---

### Task 8: Shared Soroban client (`soroban.ts`)

**Files:**
- Create: `src/lib/soroban.ts`

**Interfaces:**
- Consumes: `RPC_URL`, `NETWORK_PASSPHRASE` (config); `signXdr` (Task 9).
- Produces:
  - `server: rpc.Server` (exported).
  - `simulateRead(contractId: string, method: string, args?: xdr.ScVal[]): Promise<unknown>` — read via a throwaway never-funded source; returns `scValToNative` of the result.
  - `invoke(publicKey: string, contractId: string, method: string, args: xdr.ScVal[]): Promise<string>` — build → `prepareTransaction` → `signXdr` → send → poll; returns tx hash; throws readable Error.
  - re-exports `nativeToScVal`, `scValToNative`, `Address`, `xdr` for callers.

- [ ] **Step 1: Write `src/lib/soroban.ts`** (mirrors the verified Tip Jar client pattern)

```ts
import {
  rpc, Contract, TransactionBuilder, nativeToScVal, scValToNative,
  Address, Account, Keypair, BASE_FEE, xdr,
} from '@stellar/stellar-sdk';
import { RPC_URL, NETWORK_PASSPHRASE } from './config';
import { signXdr } from './wallet';

export const server = new rpc.Server(RPC_URL);
export { nativeToScVal, scValToNative, Address, xdr };

function readSource(): Account {
  return new Account(Keypair.random().publicKey(), '0');
}

export async function simulateRead(
  contractId: string, method: string, args: xdr.ScVal[] = []
): Promise<unknown> {
  const tx = new TransactionBuilder(readSource(), { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`Simulation failed: ${sim.error}`);
  const retval = sim.result?.retval;
  if (!retval) throw new Error(`No return value from ${method}.`);
  return scValToNative(retval);
}

export async function invoke(
  publicKey: string, contractId: string, method: string, args: xdr.ScVal[]
): Promise<string> {
  const account = await server.getAccount(publicKey);
  const built = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(60)
    .build();
  const prepared = await server.prepareTransaction(built);
  const signedXdr = await signXdr(prepared.toXDR(), publicKey);
  const signedTx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  const sent = await server.sendTransaction(signedTx);
  if (sent.status === 'ERROR') {
    throw new Error(`Submission failed: ${sent.errorResult?.toXDR('base64') ?? 'unknown'}`);
  }
  const hash = sent.hash;
  let getResp = await server.getTransaction(hash);
  const deadline = Date.now() + 30_000;
  while (getResp.status === 'NOT_FOUND' && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    getResp = await server.getTransaction(hash);
  }
  if (getResp.status !== 'SUCCESS') throw new Error(`Transaction ${hash} ended with status ${getResp.status}.`);
  return hash;
}
```

(API-VERIFY: these SDK names are CONFIRMED for `@stellar/stellar-sdk@16` from prior work; if a different major installs, verify against `.d.ts`.)

- [ ] **Step 2: `npx tsc --noEmit`** clean (if stale cache: `rm -f tsconfig.tsbuildinfo`). Commit:
```bash
git add src/lib/soroban.ts
git commit -m "feat: shared soroban RPC client (read sim + invoke/sign/poll)"
```

---

### Task 9: Wallet wrapper (`wallet.ts`)

**Files:**
- Create: `src/lib/wallet.ts`

**Interfaces:**
- Consumes: `NETWORK_PASSPHRASE`.
- Produces: `openWalletModal(): Promise<string>`, `disconnect(): Promise<void>`, `signXdr(xdr: string, publicKey: string): Promise<string>` — identical contract to the verified Tip Jar wrapper.

- [ ] **Step 1: Write `src/lib/wallet.ts`** (use the StellarWalletsKit v2.4 static API VERIFIED in prior work: `StellarWalletsKit.init`, `authModal`, `disconnect`, `signTransaction` returning `{ signedTxXdr }`, per-module subpath imports)

```ts
'use client';
import { StellarWalletsKit, Networks } from '@creit.tech/stellar-wallets-kit';
import { FreighterModule } from '@creit.tech/stellar-wallets-kit/modules/freighter';
import { xBullModule, XBULL_ID } from '@creit.tech/stellar-wallets-kit/modules/xbull';
import { AlbedoModule } from '@creit.tech/stellar-wallets-kit/modules/albedo';
import { LobstrModule } from '@creit.tech/stellar-wallets-kit/modules/lobstr';
import { NETWORK_PASSPHRASE } from './config';

let inited = false;
function ensureInit() {
  if (inited) return;
  StellarWalletsKit.init({
    network: NETWORK_PASSPHRASE as Networks,
    selectedWalletId: XBULL_ID,
    modules: [new FreighterModule(), new xBullModule(), new AlbedoModule(), new LobstrModule()],
  });
  inited = true;
}

export async function openWalletModal(): Promise<string> {
  ensureInit();
  const { address } = await StellarWalletsKit.authModal();
  if (!address) throw new Error('No wallet address returned.');
  return address;
}

export async function disconnect(): Promise<void> {
  try { await StellarWalletsKit.disconnect(); } catch { /* best effort */ }
}

export async function signXdr(xdr: string, publicKey: string): Promise<string> {
  ensureInit();
  try {
    const { signedTxXdr } = await StellarWalletsKit.signTransaction(xdr, {
      address: publicKey, networkPassphrase: NETWORK_PASSPHRASE,
    });
    return signedTxXdr;
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Transaction signing was rejected.');
  }
}
```

(API-VERIFY: confirm the v2.4 init/authModal/signTransaction shapes and module subpaths against the installed `.d.ts` — the prior project verified these exact names; re-confirm if the version differs.)

- [ ] **Step 2: `npx tsc --noEmit`** clean. Commit:
```bash
git add src/lib/wallet.ts
git commit -m "feat: StellarWalletsKit multi-wallet wrapper"
```

---

### Task 10: Contract lib wrappers (`factory.ts`, `campaign.ts`, `reputation.ts`)

**Files:**
- Create: `src/lib/factory.ts`
- Create: `src/lib/campaign.ts`
- Create: `src/lib/reputation.ts`

**Interfaces:**
- Consumes: `simulateRead`, `invoke`, `nativeToScVal`, `Address`, `scValToNative` (Task 8); `FACTORY_ID`, `REPUTATION_ID` (config).
- Produces:
  - factory.ts: `listCampaigns(): Promise<string[]>`; `createCampaign(pk, goal: bigint, deadline: number): Promise<string>` (returns tx hash).
  - campaign.ts: `type Summary = { creator: string; goal: bigint; deadline: number; raised: bigint; status: number }`; `getSummary(id): Promise<Summary>`; `contributionOf(id, who): Promise<bigint>`; `contribute(pk, id, amount: bigint): Promise<string>`; `claim(pk, id): Promise<string>`; `refund(pk, id): Promise<string>`.
  - reputation.ts: `getScore(creator: string): Promise<number>`.

- [ ] **Step 1: `src/lib/factory.ts`**

```ts
import { simulateRead, invoke, nativeToScVal, Address } from './soroban';
import { FACTORY_ID } from './config';

export async function listCampaigns(): Promise<string[]> {
  const raw = (await simulateRead(FACTORY_ID, 'list_campaigns')) as unknown[];
  return (raw ?? []).map((a) => String(a));
}

export async function createCampaign(pk: string, goal: bigint, deadline: number): Promise<string> {
  return invoke(pk, FACTORY_ID, 'create_campaign', [
    new Address(pk).toScVal(),
    nativeToScVal(goal, { type: 'i128' }),
    nativeToScVal(BigInt(deadline), { type: 'u64' }),
  ]);
}
```

- [ ] **Step 2: `src/lib/campaign.ts`**

```ts
import { simulateRead, invoke, nativeToScVal, Address } from './soroban';

export type Summary = {
  creator: string; goal: bigint; deadline: number; raised: bigint; status: number;
};

export async function getSummary(id: string): Promise<Summary> {
  const t = (await simulateRead(id, 'summary')) as [string, bigint, bigint | number, bigint, number];
  return {
    creator: String(t[0]),
    goal: BigInt(t[1]),
    deadline: Number(t[2]),
    raised: BigInt(t[3]),
    status: Number(t[4]),
  };
}

export async function contributionOf(id: string, who: string): Promise<bigint> {
  const v = (await simulateRead(id, 'contribution_of', [new Address(who).toScVal()])) as bigint | number;
  return BigInt(v ?? 0);
}

export async function contribute(pk: string, id: string, amount: bigint): Promise<string> {
  return invoke(pk, id, 'contribute', [new Address(pk).toScVal(), nativeToScVal(amount, { type: 'i128' })]);
}
export async function claim(pk: string, id: string): Promise<string> {
  return invoke(pk, id, 'claim', []);
}
export async function refund(pk: string, id: string): Promise<string> {
  return invoke(pk, id, 'refund', [new Address(pk).toScVal()]);
}
```

- [ ] **Step 3: `src/lib/reputation.ts`**

```ts
import { simulateRead, Address } from './soroban';
import { REPUTATION_ID } from './config';

export async function getScore(creator: string): Promise<number> {
  const v = (await simulateRead(REPUTATION_ID, 'get_score', [new Address(creator).toScVal()])) as number | bigint;
  return Number(v ?? 0);
}
```

- [ ] **Step 4: `npx tsc --noEmit`** clean. **Live read sanity-check**: write a throwaway node script importing `listCampaigns` + `getSummary` for the campaign created in Task 5, print results, then delete it. Commit:
```bash
git add src/lib/factory.ts src/lib/campaign.ts src/lib/reputation.ts
git commit -m "feat: factory/campaign/reputation contract client wrappers"
```

---

### Task 11: Event polling (`events.ts`)

**Files:**
- Create: `src/lib/events.ts`

**Interfaces:**
- Consumes: `server` (Task 8); `FACTORY_ID` (config).
- Produces:
  - `type ChainEvent = { kind: 'created'|'contrib'|'goal_met'|'claimed'|'refunded'|'rep_up'; contract: string; topicAddr: string; value: string; ledger: number; txHash: string }`.
  - `fetchLatestLedger(): Promise<number>`.
  - `getCampaignEvents(startLedger: number, contractIds: string[]): Promise<{ events: ChainEvent[]; latestLedger: number }>` — fetches events from the factory + all known campaign contracts; decodes the topic symbol to `kind`.

- [ ] **Step 1: Write `src/lib/events.ts`**

```ts
import { rpc, scValToNative, xdr } from '@stellar/stellar-sdk';
import { server } from './soroban';

export type EventKind = 'created' | 'contrib' | 'goal_met' | 'claimed' | 'refunded' | 'rep_up';
export type ChainEvent = {
  kind: EventKind; contract: string; topicAddr: string; value: string; ledger: number; txHash: string;
};

const KINDS: Record<string, EventKind> = {
  created: 'created', contrib: 'contrib', goal_met: 'goal_met',
  claimed: 'claimed', refunded: 'refunded', rep_up: 'rep_up',
};

export async function fetchLatestLedger(): Promise<number> {
  return (await server.getLatestLedger()).sequence;
}

export async function getCampaignEvents(
  startLedger: number, contractIds: string[]
): Promise<{ events: ChainEvent[]; latestLedger: number }> {
  if (contractIds.length === 0) return { events: [], latestLedger: startLedger };
  const resp = await server.getEvents({
    startLedger,
    filters: [{ type: 'contract', contractIds, topics: [['*', '*']] }],
  });
  const events: ChainEvent[] = [];
  for (const e of resp.events ?? []) {
    try {
      const topics = (e.topic as xdr.ScVal[]).map((t) => scValToNative(t));
      const kind = KINDS[String(topics[0])];
      if (!kind) continue;
      const value = scValToNative(e.value);
      events.push({
        kind,
        contract: e.contractId?.toString() ?? '',
        topicAddr: topics[1] != null ? String(topics[1]) : '',
        value: typeof value === 'bigint' ? value.toString() : String(value),
        ledger: e.ledger,
        txHash: e.txHash ?? '',
      });
    } catch { /* skip undecodable */ }
  }
  return { events, latestLedger: resp.latestLedger };
}
```

(API-VERIFY: `e.contractId` field/shape and `getEvents` single-filter contractIds cap — confirm against the installed SDK; this matched `@stellar/stellar-sdk@16` in prior work. A filter may cap contractIds length; if so, chunk.)

- [ ] **Step 2: `npx tsc --noEmit`** clean. Commit:
```bash
git add src/lib/events.ts
git commit -m "feat: multi-contract event polling"
```

---

### Task 12: Friendbot + store

**Files:**
- Create: `src/lib/friendbot.ts`
- Create: `src/store.ts`

**Interfaces:**
- Produces:
  - friendbot.ts: `fundAccount(publicKey: string): Promise<void>` (400 `op_already_exists` = success).
  - store.ts: `useAppStore` with `{ publicKey, connected, txStatus, lastTxHash, lastError, campaigns: string[], events: ChainEvent[] }`, `TxStatus='idle'|'pending'|'success'|'fail'`, actions `setWallet`, `setTxStatus`, `setTxResult`, `setCampaigns`, `addEvents`.

- [ ] **Step 1: `src/lib/friendbot.ts`**

```ts
import { FRIENDBOT_URL } from './config';
export async function fundAccount(publicKey: string): Promise<void> {
  const res = await fetch(`${FRIENDBOT_URL}/?addr=${encodeURIComponent(publicKey)}`);
  if (res.ok) return;
  const body = await res.text().catch(() => '');
  if (res.status === 400 && body.includes('op_already_exists')) return;
  throw new Error(`Friendbot funding failed (${res.status}).`);
}
```

- [ ] **Step 2: `src/store.ts`**

```ts
import { create } from 'zustand';
import type { ChainEvent } from '@/lib/events';

export type TxStatus = 'idle' | 'pending' | 'success' | 'fail';

type AppState = {
  publicKey: string | null;
  connected: boolean;
  txStatus: TxStatus;
  lastTxHash: string | null;
  lastError: string | null;
  campaigns: string[];
  events: ChainEvent[];
  setWallet: (pk: string | null) => void;
  setTxStatus: (s: TxStatus) => void;
  setTxResult: (hash: string | null, error: string | null) => void;
  setCampaigns: (c: string[]) => void;
  addEvents: (e: ChainEvent[]) => void;
};

export const useAppStore = create<AppState>((set) => ({
  publicKey: null, connected: false, txStatus: 'idle',
  lastTxHash: null, lastError: null, campaigns: [], events: [],
  setWallet: (pk) => set({ publicKey: pk, connected: pk !== null }),
  setTxStatus: (s) => set({ txStatus: s }),
  setTxResult: (hash, error) => set({ lastTxHash: hash, lastError: error }),
  setCampaigns: (c) => set({ campaigns: c }),
  addEvents: (e) => set((st) => {
    if (e.length === 0) return st;
    const seen = new Set(st.events.map((x) => `${x.txHash}:${x.ledger}:${x.kind}:${x.topicAddr}`));
    const fresh = e.filter((x) => !seen.has(`${x.txHash}:${x.ledger}:${x.kind}:${x.topicAddr}`));
    if (fresh.length === 0) return st;
    return { events: [...fresh.reverse(), ...st.events].slice(0, 50) };
  }),
}));
```

- [ ] **Step 3: `npx tsc --noEmit`** clean. Commit:
```bash
git add src/lib/friendbot.ts src/store.ts
git commit -m "feat: friendbot helper + zustand store"
```

---

### Task 13: WalletBar component

**Files:**
- Create: `src/components/WalletBar.tsx`

**Interfaces:**
- Consumes: `openWalletModal`, `disconnect` (Task 9); `fundAccount` (Task 12); `useAppStore` (Task 12); `truncate` (Task 7); `toast`.
- Produces: `<WalletBar />` — connect/disconnect, truncated address, "Get Test XLM", all with loading states + readable error toasts.

- [ ] **Step 1: Write `src/components/WalletBar.tsx`**

```tsx
'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { openWalletModal, disconnect } from '@/lib/wallet';
import { fundAccount } from '@/lib/friendbot';
import { useAppStore } from '@/store';
import { truncate } from '@/lib/format';

export default function WalletBar() {
  const { publicKey, connected, setWallet } = useAppStore();
  const [busy, setBusy] = useState(false);

  async function connect() {
    setBusy(true);
    try { setWallet(await openWalletModal()); toast.success('Wallet connected.'); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Failed to connect.'); }
    finally { setBusy(false); }
  }
  async function handleDisconnect() {
    try { await disconnect(); } catch { /* ignore */ }
    setWallet(null);
  }
  async function fund() {
    if (!publicKey) return;
    setBusy(true);
    try { await fundAccount(publicKey); toast.success('Funded with Test XLM.'); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Funding failed.'); }
    finally { setBusy(false); }
  }

  if (!connected || !publicKey) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
        <span className="text-sm opacity-70">Connect a wallet</span>
        <button onClick={connect} disabled={busy} className="rounded bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-50">
          {busy ? 'Connecting…' : 'Connect Wallet'}
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
      <span className="font-mono text-sm">{truncate(publicKey)}</span>
      <div className="flex gap-2">
        <button onClick={fund} disabled={busy} className="rounded border px-3 py-1.5 text-sm disabled:opacity-50">{busy ? '…' : 'Get Test XLM'}</button>
        <button onClick={handleDisconnect} className="rounded border px-3 py-1.5 text-sm">Disconnect</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `npm run build`** succeeds. Commit:
```bash
git add src/components/WalletBar.tsx
git commit -m "feat: WalletBar with loading states"
```

---

### Task 14: CampaignCard + its React component test

**Files:**
- Create: `src/components/CampaignCard.tsx`
- Test: `tests/CampaignCard.test.tsx`

**Interfaces:**
- Consumes: `Summary` (Task 10); `stroopsToXlm`, `pct`, `timeLeft`, `truncate` (Task 7).
- Produces: `<CampaignCard summary={Summary} id={string} now={number} />` — renders goal, raised, % bar, countdown, truncated creator, and a link to `/campaign/[id]`. This is the **frontend component test** target.

- [ ] **Step 1: Write the failing test `tests/CampaignCard.test.tsx`**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CampaignCard from '@/components/CampaignCard';

const summary = { creator: 'GCREATORADDR1234567890XYZ', goal: 100_000_000n, deadline: 5000, raised: 50_000_000n, status: 0 };

describe('CampaignCard', () => {
  it('shows goal and raised in XLM', () => {
    render(<CampaignCard id="CABC123" summary={summary} now={1000} />);
    expect(screen.getByText(/10/)).toBeInTheDocument(); // goal 10 XLM
    expect(screen.getByText(/5 \/ 10 XLM|5/)).toBeInTheDocument();
  });
  it('shows 50% progress', () => {
    render(<CampaignCard id="CABC123" summary={summary} now={1000} />);
    expect(screen.getByText(/50%/)).toBeInTheDocument();
  });
  it('shows ended when past deadline', () => {
    render(<CampaignCard id="CABC123" summary={summary} now={9999} />);
    expect(screen.getByText(/ended/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npm test` → FAIL (component missing).

- [ ] **Step 3: Write `src/components/CampaignCard.tsx`**

```tsx
import Link from 'next/link';
import type { Summary } from '@/lib/campaign';
import { stroopsToXlm, pct, timeLeft, truncate } from '@/lib/format';

export default function CampaignCard({ id, summary, now }: { id: string; summary: Summary; now: number }) {
  const percent = pct(summary.raised, summary.goal);
  const statusLabel = summary.status === 1 ? 'Claimed' : summary.status === 2 ? 'Refunding' : 'Active';
  return (
    <Link href={`/campaign/${id}`} className="block rounded-lg border p-4 hover:border-white/40">
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="font-mono opacity-70">{truncate(summary.creator)}</span>
        <span className="opacity-70">{timeLeft(summary.deadline, now)}</span>
      </div>
      <div className="mb-1 text-sm">
        {stroopsToXlm(summary.raised)} / {stroopsToXlm(summary.goal)} XLM
      </div>
      <div className="h-2 w-full overflow-hidden rounded bg-white/10">
        <div className="h-full bg-green-500" style={{ width: `${percent}%` }} />
      </div>
      <div className="mt-1 flex items-center justify-between text-xs opacity-70">
        <span>{percent}%</span>
        <span>{statusLabel}</span>
      </div>
    </Link>
  );
}
```

- [ ] **Step 4: Run to verify pass** — `npm test` → PASS (format + CampaignCard).

- [ ] **Step 5: Commit**

```bash
git add src/components/CampaignCard.tsx tests/CampaignCard.test.tsx
git commit -m "feat: CampaignCard with progress + component test"
```

---

### Task 15: Home page (campaign list) + PollProvider

**Files:**
- Create: `src/components/PollProvider.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Consumes: `listCampaigns`, `getSummary` (Task 10); `getCampaignEvents`, `fetchLatestLedger` (Task 11); `useAppStore` (Task 12); `CampaignCard` (Task 14); `WalletBar` (Task 13).
- Produces: a home page listing campaigns (mobile-first responsive grid), a 5s poller that refreshes the campaign list + events, and `<Toaster />` in the layout.

- [ ] **Step 1: `src/components/PollProvider.tsx`**

```tsx
'use client';
import { useEffect, useRef } from 'react';
import { listCampaigns } from '@/lib/factory';
import { getCampaignEvents, fetchLatestLedger } from '@/lib/events';
import { useAppStore } from '@/store';
import { FACTORY_ID } from '@/lib/config';

export default function PollProvider() {
  const setCampaigns = useAppStore((s) => s.setCampaigns);
  const addEvents = useAppStore((s) => s.addEvents);
  const campaigns = useAppStore((s) => s.campaigns);
  const cursor = useRef<number | null>(null);
  const campaignsRef = useRef<string[]>([]);
  campaignsRef.current = campaigns;

  useEffect(() => {
    let active = true;
    async function tick() {
      try {
        const ids = await listCampaigns();
        if (!active) return;
        setCampaigns(ids);
        if (cursor.current === null) {
          const latest = await fetchLatestLedger();
          cursor.current = Math.max(latest - 2000, 1);
        }
        const contracts = [FACTORY_ID, ...ids];
        const { events, latestLedger } = await getCampaignEvents(cursor.current, contracts);
        if (!active) return;
        if (events.length > 0) addEvents(events);
        cursor.current = latestLedger + 1;
      } catch { /* non-fatal */ }
    }
    tick();
    const t = setInterval(tick, 5000);
    return () => { active = false; clearInterval(t); };
  }, [setCampaigns, addEvents]);

  return null;
}
```

- [ ] **Step 2: Replace `src/app/page.tsx`**

```tsx
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import WalletBar from '@/components/WalletBar';
import PollProvider from '@/components/PollProvider';
import CampaignCard from '@/components/CampaignCard';
import { useAppStore } from '@/store';
import { getSummary, type Summary } from '@/lib/campaign';

export default function Home() {
  const campaigns = useAppStore((s) => s.campaigns);
  const [summaries, setSummaries] = useState<Record<string, Summary>>({});
  const now = Math.floor(Date.now() / 1000);

  useEffect(() => {
    let active = true;
    (async () => {
      const entries = await Promise.all(
        campaigns.map(async (id) => { try { return [id, await getSummary(id)] as const; } catch { return null; } })
      );
      if (!active) return;
      const map: Record<string, Summary> = {};
      for (const e of entries) if (e) map[e[0]] = e[1];
      setSummaries(map);
    })();
    return () => { active = false; };
  }, [campaigns]);

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6 flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">Stellar Crowdfund</h1>
        <p className="text-sm opacity-70">Decentralized crowdfunding on Stellar Testnet — factory-deployed campaigns with real XLM.</p>
      </header>
      <PollProvider />
      <WalletBar />
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Campaigns</h2>
        <Link href="/create" className="rounded bg-white px-3 py-1.5 text-sm font-medium text-black">+ New campaign</Link>
      </div>
      {campaigns.length === 0 ? (
        <p className="text-sm opacity-60">No campaigns yet. Create the first one!</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {campaigns.map((id) => summaries[id] && <CampaignCard key={id} id={id} summary={summaries[id]} now={now} />)}
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Add `<Toaster />` + metadata to `src/app/layout.tsx`** (read first, preserve fonts/className; set `metadata.title = 'Stellar Crowdfund'`, description accordingly; mount `<Toaster />` once after `{children}`).

- [ ] **Step 4: `npm run build`** succeeds. Commit:
```bash
git add src/components/PollProvider.tsx src/app/page.tsx src/app/layout.tsx
git commit -m "feat: home campaign list + 5s poller + toaster"
```

---

### Task 16: Create-campaign page

**Files:**
- Create: `src/components/CreateForm.tsx`
- Create: `src/app/create/page.tsx`

**Interfaces:**
- Consumes: `createCampaign` (Task 10); `useAppStore`; `xlmToStroops` (Task 7); `explorerTxUrl` (config); `toast`; `useRouter` from `next/navigation`.
- Produces: a form (goal in XLM + duration in days) that calls `createCampaign`, shows loading/tx status, and routes home on success.

- [ ] **Step 1: `src/components/CreateForm.tsx`**

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { createCampaign } from '@/lib/factory';
import { useAppStore } from '@/store';
import { xlmToStroops } from '@/lib/format';
import { explorerTxUrl } from '@/lib/config';

export default function CreateForm() {
  const router = useRouter();
  const { connected, publicKey } = useAppStore();
  const [goal, setGoal] = useState('');
  const [days, setDays] = useState('7');
  const [busy, setBusy] = useState(false);

  let goalOk = false;
  try { goalOk = xlmToStroops(goal) > 0n; } catch { goalOk = false; }
  const daysOk = /^\d+$/.test(days) && Number(days) >= 1;
  const canSubmit = connected && goalOk && daysOk && !busy;

  async function submit() {
    if (!publicKey) return;
    setBusy(true);
    try {
      const goalStroops = xlmToStroops(goal);
      const deadline = Math.floor(Date.now() / 1000) + Number(days) * 86400;
      const hash = await createCampaign(publicKey, goalStroops, deadline);
      toast.success('Campaign created!');
      toast.message('Tx', { description: explorerTxUrl(hash) });
      router.push('/');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create campaign.');
    } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <label className="text-sm font-medium">Goal (XLM)</label>
      <input value={goal} onChange={(e) => setGoal(e.target.value)} inputMode="decimal" placeholder="10" className="rounded border bg-transparent px-3 py-2" />
      {goal !== '' && !goalOk && <span className="text-xs text-red-400">Enter a positive amount (max 7 decimals).</span>}
      <label className="text-sm font-medium">Duration (days)</label>
      <input value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" className="rounded border bg-transparent px-3 py-2" />
      {!daysOk && <span className="text-xs text-red-400">At least 1 day.</span>}
      <button onClick={submit} disabled={!canSubmit} className="rounded bg-white px-4 py-2 font-medium text-black disabled:opacity-40">
        {busy ? 'Creating…' : 'Create campaign'}
      </button>
      {!connected && <span className="text-xs opacity-60">Connect a wallet first.</span>}
    </div>
  );
}
```

- [ ] **Step 2: `src/app/create/page.tsx`**

```tsx
import Link from 'next/link';
import CreateForm from '@/components/CreateForm';

export default function CreatePage() {
  return (
    <main className="mx-auto max-w-md p-4 sm:p-6 flex flex-col gap-4">
      <Link href="/" className="text-sm opacity-70">← Back</Link>
      <h1 className="text-xl font-bold">Create a campaign</h1>
      <CreateForm />
    </main>
  );
}
```

- [ ] **Step 3: `npm run build`** succeeds. Commit:
```bash
git add src/components/CreateForm.tsx src/app/create/page.tsx
git commit -m "feat: create-campaign page"
```

---

### Task 17: Campaign detail page (contribute / claim / refund)

**Files:**
- Create: `src/components/TxStatus.tsx`
- Create: `src/components/ReputationBadge.tsx`
- Create: `src/components/CampaignDetail.tsx`
- Create: `src/app/campaign/[id]/page.tsx`

**Interfaces:**
- Consumes: `getSummary`, `contribute`, `claim`, `refund`, `contributionOf` (Task 10); `getScore` (Task 10 reputation); `useAppStore`; `stroopsToXlm`, `xlmToStroops`, `pct`, `timeLeft`, `truncate` (Task 7); `explorerTxUrl`, `explorerContractUrl` (config); `toast`.
- Produces: a detail view showing live summary + progress + countdown + creator reputation, with contribute (when active), claim (creator, goal met, past deadline), refund (contributor, goal missed, past deadline) actions — each with loading/tx status and disabled-with-reason logic.

- [ ] **Step 1: `src/components/TxStatus.tsx`**

```tsx
'use client';
import { useAppStore } from '@/store';
import { explorerTxUrl } from '@/lib/config';

export default function TxStatus() {
  const { txStatus, lastTxHash, lastError } = useAppStore();
  if (txStatus === 'idle') return null;
  if (txStatus === 'pending') return <div className="rounded border border-yellow-600 p-2 text-sm">⏳ Transaction pending…</div>;
  if (txStatus === 'fail') return <div className="rounded border border-red-600 p-2 text-sm text-red-400">❌ {lastError ?? 'Transaction failed.'}</div>;
  return (
    <div className="rounded border border-green-600 p-2 text-sm">
      ✅ Success!{lastTxHash && (<> <a href={explorerTxUrl(lastTxHash)} target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">View on Stellar Expert</a></>)}
    </div>
  );
}
```

- [ ] **Step 2: `src/components/ReputationBadge.tsx`**

```tsx
'use client';
import { useEffect, useState } from 'react';
import { getScore } from '@/lib/reputation';

export default function ReputationBadge({ creator }: { creator: string }) {
  const [score, setScore] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    getScore(creator).then((s) => { if (active) setScore(s); }).catch(() => {});
    return () => { active = false; };
  }, [creator]);
  if (score === null) return null;
  return <span className="rounded-full border px-2 py-0.5 text-xs">⭐ {score} successful</span>;
}
```

- [ ] **Step 3: `src/components/CampaignDetail.tsx`**

```tsx
'use client';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { getSummary, contribute, claim, refund, contributionOf, type Summary } from '@/lib/campaign';
import { useAppStore } from '@/store';
import { stroopsToXlm, xlmToStroops, pct, timeLeft, truncate } from '@/lib/format';
import { explorerContractUrl } from '@/lib/config';
import TxStatus from './TxStatus';
import ReputationBadge from './ReputationBadge';

export default function CampaignDetail({ id }: { id: string }) {
  const { connected, publicKey, events, setTxStatus, setTxResult } = useAppStore();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [myContribution, setMyContribution] = useState<bigint>(0n);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const now = Math.floor(Date.now() / 1000);

  const refresh = useCallback(async () => {
    try {
      const s = await getSummary(id);
      setSummary(s);
      if (publicKey) setMyContribution(await contributionOf(id, publicKey));
    } catch { /* ignore */ }
  }, [id, publicKey]);

  useEffect(() => { refresh(); }, [refresh, events]);

  async function run(action: () => Promise<string>, label: string) {
    if (!publicKey) return;
    setBusy(true); setTxStatus('pending'); setTxResult(null, null);
    try {
      const hash = await action();
      setTxResult(hash, null); setTxStatus('success'); toast.success(`${label} succeeded`);
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : `${label} failed`;
      setTxResult(null, msg); setTxStatus('fail'); toast.error(msg);
    } finally { setBusy(false); }
  }

  if (!summary) return <p className="text-sm opacity-60">Loading campaign…</p>;

  const percent = pct(summary.raised, summary.goal);
  const ended = now > summary.deadline;
  const goalMet = summary.raised >= summary.goal;
  const isCreator = publicKey === summary.creator;
  const active = summary.status === 0;
  let amtOk = false; try { amtOk = xlmToStroops(amount) > 0n; } catch { amtOk = false; }

  const canContribute = connected && active && !ended && amtOk && !busy;
  const canClaim = connected && isCreator && active && ended && goalMet && !busy;
  const canRefund = connected && active && ended && !goalMet && myContribution > 0n && !busy;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="font-mono opacity-70">by {truncate(summary.creator)}</span>
          <ReputationBadge creator={summary.creator} />
        </div>
        <div className="mb-1 text-lg font-semibold">{stroopsToXlm(summary.raised)} / {stroopsToXlm(summary.goal)} XLM</div>
        <div className="h-2 w-full overflow-hidden rounded bg-white/10"><div className="h-full bg-green-500" style={{ width: `${percent}%` }} /></div>
        <div className="mt-1 flex justify-between text-xs opacity-70"><span>{percent}%</span><span>{timeLeft(summary.deadline, now)}</span></div>
        <a href={explorerContractUrl(id)} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs text-blue-400 underline">Contract on Stellar Expert</a>
      </div>

      {active && !ended && (
        <div className="flex flex-col gap-2 rounded-lg border p-4">
          <label className="text-sm font-medium">Contribute (XLM)</label>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="1" className="rounded border bg-transparent px-3 py-2" />
          <button onClick={() => run(() => contribute(publicKey!, id, xlmToStroops(amount)), 'Contribution')} disabled={!canContribute} className="rounded bg-white px-4 py-2 font-medium text-black disabled:opacity-40">{busy ? 'Sending…' : 'Contribute'}</button>
          {!connected && <span className="text-xs opacity-60">Connect a wallet first.</span>}
        </div>
      )}

      {ended && goalMet && isCreator && active && (
        <button onClick={() => run(() => claim(publicKey!, id), 'Claim')} disabled={!canClaim} className="rounded bg-green-600 px-4 py-2 font-medium disabled:opacity-40">{busy ? 'Claiming…' : 'Claim funds'}</button>
      )}
      {ended && !goalMet && myContribution > 0n && (
        <button onClick={() => run(() => refund(publicKey!, id), 'Refund')} disabled={!canRefund} className="rounded border px-4 py-2 font-medium disabled:opacity-40">{busy ? 'Refunding…' : `Refund my ${stroopsToXlm(myContribution)} XLM`}</button>
      )}

      <TxStatus />
    </div>
  );
}
```

(NOTE: `useCallback` import is from `react` — fix the import line to `import { useCallback, useEffect, useState } from 'react';`.)

- [ ] **Step 4: `src/app/campaign/[id]/page.tsx`**

```tsx
import Link from 'next/link';
import CampaignDetail from '@/components/CampaignDetail';

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="mx-auto max-w-md p-4 sm:p-6 flex flex-col gap-4">
      <Link href="/" className="text-sm opacity-70">← Back</Link>
      <h1 className="text-xl font-bold break-all">Campaign</h1>
      <CampaignDetail id={id} />
    </main>
  );
}
```

(API-VERIFY: Next.js 16 dynamic route `params` is a Promise — confirm and `await` it as shown.)

- [ ] **Step 5: `npm run build`** succeeds; `npx tsc --noEmit` clean. Commit:
```bash
git add src/components/TxStatus.tsx src/components/ReputationBadge.tsx src/components/CampaignDetail.tsx "src/app/campaign/[id]/page.tsx"
git commit -m "feat: campaign detail with contribute/claim/refund + reputation"
```

---

### Task 18: CI/CD pipeline (GitHub Actions)

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: a workflow with a `contracts` job (Rust + wasm target + `cargo test --lib` for the three crates) and a `frontend` job (`npm ci`, `npm run lint`, `npm test`, `npm run build`). Runs on push + pull_request.

- [ ] **Step 1: Write `.github/workflows/ci.yml`**

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  contracts:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: wasm32v1-none
      - name: Test contracts
        run: |
          for c in reputation campaign factory; do
            ( cd contracts/$c && cargo test --lib )
          done

  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm test
      - run: npm run build
```

(API-VERIFY: the factory test may need the campaign wasm built first. If `cargo test --lib` for factory requires the campaign wasm artifact (via `contractimport!` path), add a build step before it: `( cd contracts/campaign && cargo build --release --target wasm32v1-none )` — or switch the factory test to use the `campaign` dev-dependency's `campaign::WASM` constant so no prebuilt artifact path is needed. Pick whichever the implementation in Task 4 actually used and make CI match.)

- [ ] **Step 2: Validate YAML locally** (optional) and commit:
```bash
git add .github/workflows/ci.yml
git commit -m "ci: GitHub Actions for contract + frontend tests"
```

---

### Task 19: Seed script + demo data on-chain

**Files:**
- Create: `scripts/seed.sh`
- Modify: `docs/DEPLOY_NOTES.md` (append a verifiable interaction tx hash)

**Interfaces:**
- Consumes: deployed Factory + token (Tasks 5); funded `crowdfund` identity.
- Produces: real on-chain demo state — at least two campaigns, several contributions (one campaign reaching its goal), recorded interaction tx hashes. Used by the demo video (Task 21) and screenshots (Task 20).

- [ ] **Step 1: Write `scripts/seed.sh`** (creates campaigns + contributes; the contributor is the `crowdfund` identity which must approve the SAC transfer; uses `--source crowdfund`)

```bash
#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.cargo/bin:$PATH"
NET=testnet; SRC=crowdfund
G=$(stellar keys address $SRC)
FACTORY=${FACTORY_ID:?set FACTORY_ID}
NOW=$(date +%s)

# Campaign A: short deadline, will be funded to goal (5 XLM).
A=$(stellar contract invoke --id $FACTORY --source $SRC --network $NET -- create_campaign --creator $G --goal 50000000 --deadline $((NOW+600)))
echo "Campaign A = $A"
stellar contract invoke --id $A --source $SRC --network $NET -- contribute --from $G --amount 50000000

# Campaign B: longer deadline, partially funded (2 of 20 XLM).
B=$(stellar contract invoke --id $FACTORY --source $SRC --network $NET -- create_campaign --creator $G --goal 200000000 --deadline $((NOW+86400)))
echo "Campaign B = $B"
stellar contract invoke --id $B --source $SRC --network $NET -- contribute --from $G --amount 20000000
echo "Seed complete. A=$A B=$B"
```

- [ ] **Step 2: Run seed**

Run: `export PATH="$HOME/.cargo/bin:$PATH" && FACTORY_ID=<FACTORY_ID> bash scripts/seed.sh`
Expected: two campaign addresses; contribute invocations succeed (print tx hashes). Capture one `contribute` tx hash.

- [ ] **Step 3: Record + commit**

Append the verifiable interaction (e.g. a `contribute`) tx hash + Explorer link to `docs/DEPLOY_NOTES.md`. Commit:
```bash
git add scripts/seed.sh docs/DEPLOY_NOTES.md
git commit -m "chore: seed script + on-chain demo data; record interaction tx hash"
```

---

### Task 20: Manual E2E + screenshots (mobile, tests, CI)

**Files:**
- Create: `public/screenshots/mobile-ui.png`
- Create: `public/screenshots/test-output.png`
- Create: `public/screenshots/ci-pipeline.png`
- Create: `public/screenshots/campaign-detail.png`

**Interfaces:**
- Consumes: the seeded contracts + the full app.
- Produces: required submission screenshots.

- [ ] **Step 1: Capture mobile UI + detail** via headless Playwright at a mobile viewport (e.g. 390×844): run `npm run dev`, navigate to `/` and `/campaign/<A>`, screenshot. (The poller fills the list from on-chain state; no wallet signing needed for these views.) Save `mobile-ui.png` and `campaign-detail.png`.

- [ ] **Step 2: Capture test output** — run `npm test` and `(cd contracts/<c> && cargo test --lib)`; screenshot the terminal showing 3+ passing tests → `test-output.png`. (A terminal screenshot is taken by the human or via the app's environment; if automation is unavailable, the human captures it.)

- [ ] **Step 3: Capture CI running** — after Task 22 pushes to GitHub, screenshot the green Actions run → `ci-pipeline.png`. (This step completes after the repo exists; revisit post-push.)

- [ ] **Step 4: Commit available screenshots**
```bash
git add public/screenshots
git commit -m "docs: submission screenshots (mobile, detail, tests)"
```

---

### Task 21: Demo video (Playwright recording)

**Files:**
- Create: `scripts/record-demo.mjs`
- Create: `public/demo/stellar-crowdfund-demo.webm` (generated; may be git-ignored if large — see step)

**Interfaces:**
- Consumes: seeded on-chain data + running dev server.
- Produces: a 1–2 minute screen recording walking the product tour, handed to the user for YouTube upload.

- [ ] **Step 1: Write `scripts/record-demo.mjs`**

```js
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
mkdirSync('public/demo', { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: 'public/demo', size: { width: 1280, height: 800 } },
});
const page = await context.newPage();

async function caption(text) {
  await page.evaluate((t) => {
    let el = document.getElementById('__cap');
    if (!el) { el = document.createElement('div'); el.id='__cap';
      el.style.cssText='position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#000c;color:#fff;padding:8px 16px;border-radius:8px;font:16px sans-serif;z-index:99999'; document.body.appendChild(el); }
    el.textContent = t;
  }, text);
}

await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
await page.waitForTimeout(9000); // poller fills campaigns
await caption('Stellar Crowdfund — factory-deployed campaigns, real XLM on Testnet');
await page.waitForTimeout(3000);
await caption('Live campaign list with progress & countdown');
await page.waitForTimeout(3000);
// open first campaign
const first = page.locator('a[href^="/campaign/"]').first();
if (await first.count()) { await first.click(); await page.waitForTimeout(6000); await caption('Campaign detail: contribute / claim / refund + creator reputation'); await page.waitForTimeout(4000); }
await page.goBack(); await page.waitForTimeout(2000);
await page.goto('http://localhost:3000/create', { waitUntil: 'networkidle' });
await caption('Create a new campaign — Factory deploys a fresh contract on-chain'); await page.waitForTimeout(4000);
await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
await caption('Connect any Stellar wallet (StellarWalletsKit)'); 
const connect = page.getByRole('button', { name: /connect wallet/i });
if (await connect.count()) { await connect.click(); await page.waitForTimeout(4000); }
await caption('Three contracts • inter-contract calls • live events • CI/CD'); await page.waitForTimeout(3000);

await context.close(); // finalizes the video
await browser.close();
console.log('demo recorded to public/demo/');
```

- [ ] **Step 2: Record**

Run: `npm run dev` (separate shell), then `node scripts/record-demo.mjs`. Expected: a `.webm` in `public/demo/`. Verify it plays and is ~60–90s. (If too short/long, adjust the `waitForTimeout` values.)

- [ ] **Step 3: Decide tracking** — if the `.webm` is under ~25 MB, commit it; otherwise keep it out of git (add `public/demo/*.webm` to `.gitignore`) and hand the file path to the user. Either way, the README links to the user's uploaded YouTube URL.
```bash
git add scripts/record-demo.mjs .gitignore
git commit -m "chore: Playwright demo recording script"
```

---

### Task 22: README, GitHub, Vercel, CI green

**Files:**
- Modify: `README.md`
- Create: `.vercelignore`

**Interfaces:**
- Consumes: everything; the three contract IDs + interaction tx hash (`docs/DEPLOY_NOTES.md`); screenshots (Task 20).
- Produces: public repo, green CI, Vercel deploy, README satisfying the Level 3 checklist.

- [ ] **Step 1: Write `.vercelignore`** (exclude heavy/irrelevant dirs from the Vercel upload)
```
contracts
target
.superpowers
docs/superpowers
.github
public/demo
```

- [ ] **Step 2: Write `README.md`** including: overview; an architecture diagram (the 3 contracts + 2 inter-contract edges + SAC); the **three deployed contract addresses** (Factory, Campaign-wasm-hash, Reputation) with Explorer links; a verifiable **interaction tx hash**; setup/run (contracts: `bash scripts/deploy.sh`; frontend: `npm run dev`); the CI badge `![CI](https://github.com/<user>/stellar-crowdfund/actions/workflows/ci.yml/badge.svg)`; screenshots (mobile UI, CI pipeline, test output); a **Live demo** line; and a **Demo video** line (YouTube placeholder for the user to fill).

- [ ] **Step 3: Commit, create public repo, push**
```bash
git add README.md .vercelignore
git commit -m "docs: comprehensive README for Stellar Crowdfund"
# create public repo via gh or API, push master:main
```
Expected: repo on GitHub; the push triggers the CI workflow.

- [ ] **Step 4: Verify CI green**, then deploy to Vercel (`npx vercel --prod --yes`), link Vercel↔GitHub for auto-deploy, add the live URL to the README, and push. Capture the green CI screenshot (Task 20 Step 3). Final commit:
```bash
git add README.md
git commit -m "docs: add live demo URL"
git push
```

---

## Self-Review

**1. Spec coverage:**
- 3 contracts + inter-contract (Factory→Campaign deploy, Campaign→Reputation) → Tasks 2,3,4 (+5 deploy). ✓
- Real XLM custody (contribute/claim/refund via SAC) → Task 3; tx hash → Tasks 5/19/22. ✓
- Event streaming + real-time → Tasks 11,15. ✓
- CI/CD → Task 18 (green verified Task 22). ✓
- Mobile responsive → Tasks 14,15,16,17 (responsive classes), screenshot Task 20. ✓
- Error handling + loading states → every component (busy flags, TxStatus, readable errors). ✓
- Contract + frontend tests (3+) → Rust tests (Tasks 2,3,4) + Vitest format (Task 7) + CampaignCard component test (Task 14). ✓
- Public repo + README + 10+ commits + live demo → Task 22 (commit count ≈ 22). ✓
- Submission screenshots (mobile, CI, tests) + demo video → Tasks 20,21. ✓
- 🟡 Explorer links (config + TxStatus/detail), toasts (all), Friendbot (Task 13), reputation badge (Task 17), progress %/countdown (Tasks 14,17), Vercel↔GitHub auto-deploy (Task 22). ✓

**2. Placeholder scan:** `__FACTORY_ID__/__REPUTATION_ID__/__TOKEN_ID__` (Task 6) and `<FACTORY_ID>`/`<A>` markers are fill-from-deploy with explicit instructions, not vague placeholders. No `TODO`/"add error handling" remain. The Task 3 test arithmetic note and the `useCallback` import note are explicit corrections, not placeholders.

**3. Type consistency:** `Summary { creator, goal: bigint, deadline: number, raised: bigint, status: number }` (Task 10) is consumed unchanged in CampaignCard (14), home (15), detail (17). `ChainEvent` (Task 11) matches store dedupe (12) and is read in PollProvider (15). `invoke/simulateRead` signatures (Task 8) match all lib wrappers (10/11). `signXdr(xdr, publicKey)` consistent (9/8). Contract method names (`create_campaign`, `contribute`, `claim`, `refund`, `summary`, `contribution_of`, `list_campaigns`, `is_campaign`, `record_success`, `get_score`) are consistent between Rust (2,3,4) and TS wrappers (10).

**Note on TDD scope:** Pure logic (3 Rust contracts + `format.ts` + the `CampaignCard` component) is test-driven (Tasks 2,3,4,7,14). Wallet/RPC/network glue is verified by `npx tsc`, a live read sanity-check (Task 10), and manual E2E (Task 20) — consistent with the spec's testing section. The factory's on-chain deploy and the Campaign↔SAC↔Reputation cross-contract flow are validated by Rust `cargo test` with `testutils` BEFORE any deploy, de-risking the novel inter-contract logic.
