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
