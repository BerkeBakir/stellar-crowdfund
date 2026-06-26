export const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
export const RPC_URL = 'https://soroban-testnet.stellar.org';
export const FRIENDBOT_URL = 'https://friendbot.stellar.org';
export const EXPLORER_BASE_URL = 'https://stellar.expert/explorer/testnet';

export const FACTORY_ID = 'CB7XBGQMQCABLW6YAHPDKNLPXZSG7TVAR6EZGVL4PKAQC4DLDVSFFXRW';
export const REPUTATION_ID = 'CDCW4N245PCGTYZOOSNY2PJXZMGU4B6GVVNX4FWHC34QPSC27FV5ZPQR';
export const TOKEN_ID = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

export function explorerTxUrl(hash: string): string {
  return `${EXPLORER_BASE_URL}/tx/${hash}`;
}
export function explorerContractUrl(id: string): string {
  return `${EXPLORER_BASE_URL}/contract/${id}`;
}
