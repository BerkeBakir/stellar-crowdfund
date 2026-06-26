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
  try {
    await StellarWalletsKit.disconnect();
  } catch {
    /* best effort */
  }
}

export async function signXdr(xdr: string, publicKey: string): Promise<string> {
  ensureInit();
  try {
    const { signedTxXdr } = await StellarWalletsKit.signTransaction(xdr, {
      address: publicKey,
      networkPassphrase: NETWORK_PASSPHRASE,
    });
    return signedTxXdr;
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Transaction signing was rejected.');
  }
}
