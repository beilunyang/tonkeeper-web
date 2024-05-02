import { Cell } from '@ton/core';
import { mnemonicToPrivateKey, sha256_sync, sign } from '@ton/crypto';
import { IAppSdk } from '@tonkeeper/core/dist/AppSdk';
import { AuthState } from '@tonkeeper/core/dist/entries/password';
import { getWalletMnemonic } from '@tonkeeper/core/dist/service/mnemonicService';
import {
    parseSignerSignature,
    storeTransactionAndCreateDeepLink
} from '@tonkeeper/core/dist/service/signerService';
import { getWalletAuthState } from '@tonkeeper/core/dist/service/walletService';
import { delay } from '@tonkeeper/core/dist/utils/common';
import nacl from 'tweetnacl';
import { LedgerTransaction } from '@tonkeeper/core/dist/service/ledger/connector';
import { CellSigner, Signer } from "@tonkeeper/core/dist/entries/signer";

export const signTonConnectOver = (sdk: IAppSdk, publicKey: string) => {
    return async (bufferToSign: Buffer) => {
        const auth = await getWalletAuthState(sdk.storage, publicKey);
        switch (auth.kind) {
            case 'signer': {
                throw new Error('Signer linked by QR is not support sign buffer.');
            }
            case 'signer-deeplink': {
                throw new Error('Signer linked by deep link is not support sign buffer.');
            }
            default: {
                const mnemonic = await getMnemonic(sdk, publicKey);
                const keyPair = await mnemonicToPrivateKey(mnemonic);
                const signature = nacl.sign.detached(
                    Buffer.from(sha256_sync(bufferToSign)),
                    keyPair.secretKey
                );
                return signature;
            }
        }
    };
};

export const getSigner = async (sdk: IAppSdk, publicKey: string): Promise<Signer> => {
    const auth = await getWalletAuthState(sdk.storage, publicKey);

    switch (auth.kind) {
        case 'signer': {
            const callback = async (message: Cell) => {
                const result = await pairSignerByNotification(
                    sdk,
                    message.toBoc({ idx: false }).toString('base64')
                );
                return parseSignerSignature(result);
            };
            callback.type = 'cell' as const;
            return callback;
        }
        case 'ledger': {
            const callback = async (path: number[], transaction: LedgerTransaction) =>
                pairLedgerByNotification(sdk, path, transaction);
            callback.type = 'ledger' as const;
            return callback;
        }
        case 'signer-deeplink': {
            const callback = async (message: Cell) => {
                const deeplink = await storeTransactionAndCreateDeepLink(
                    sdk,
                    publicKey,
                    message.toBoc({ idx: false }).toString('base64')
                );

                /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
                window.location = deeplink as any;

                await delay(2000);

                throw new Error('Navigate to deeplink');
            };
            callback.type = 'cell' as const;
            return callback as CellSigner;
        }
        default: {
            const mnemonic = await getMnemonic(sdk, publicKey);
            const callback = async (message: Cell) => {
                const keyPair = await mnemonicToPrivateKey(mnemonic);
                return sign(message.hash(), keyPair.secretKey);
            };
            callback.type = 'cell' as const;
            return callback;
        }
    }
};

export const getMnemonic = async (sdk: IAppSdk, publicKey: string): Promise<string[]> => {
    const auth = await getWalletAuthState(sdk.storage, publicKey);

    switch (auth.kind) {
        case 'none': {
            return getWalletMnemonic(sdk.storage, publicKey, auth.kind);
        }
        case 'password': {
            const password = await getPasswordByNotification(sdk, auth);
            return getWalletMnemonic(sdk.storage, publicKey, password);
        }
        case 'keychain': {
            if (!sdk.keychain) {
                throw Error('Keychain is undefined');
            }
            const mnemonic = await sdk.keychain.getPassword(publicKey);
            return mnemonic.split(' ');
        }
        default:
            throw new Error('Unexpected auth method');
    }
};

export const getPasswordByNotification = async (sdk: IAppSdk, auth: AuthState): Promise<string> => {
    const id = Date.now();
    return new Promise<string>((resolve, reject) => {
        sdk.uiEvents.emit('getPassword', {
            method: 'getPassword',
            id,
            params: { auth }
        });

        const onCallback = (message: {
            method: 'response';
            id?: number | undefined;
            params: string | Error;
        }) => {
            if (message.id === id) {
                const { params } = message;
                sdk.uiEvents.off('response', onCallback);

                if (typeof params === 'string') {
                    resolve(params);
                } else {
                    reject(params);
                }
            }
        };

        sdk.uiEvents.on('response', onCallback);
    });
};

const pairSignerByNotification = async (sdk: IAppSdk, boc: string): Promise<string> => {
    const id = Date.now();
    return new Promise<string>((resolve, reject) => {
        sdk.uiEvents.emit('signer', {
            method: 'signer',
            id,
            params: boc
        });

        const onCallback = (message: {
            method: 'response';
            id?: number | undefined;
            params: string | Error;
        }) => {
            if (message.id === id) {
                const { params } = message;
                sdk.uiEvents.off('response', onCallback);

                if (typeof params === 'string') {
                    resolve(params);
                } else {
                    reject(params);
                }
            }
        };

        sdk.uiEvents.on('response', onCallback);
    });
};

const pairLedgerByNotification = async (
    sdk: IAppSdk,
    path: number[],
    transaction: LedgerTransaction
): Promise<Cell> => {
    const id = Date.now();
    return new Promise<Cell>((resolve, reject) => {
        sdk.uiEvents.emit('ledger', {
            method: 'ledger',
            id,
            params: { path, transaction }
        });

        const onCallback = (message: {
            method: 'response';
            id?: number | undefined;
            params: unknown;
        }) => {
            if (message.id === id) {
                const { params } = message;
                sdk.uiEvents.off('response', onCallback);

                if (params && typeof params === 'object') {
                    resolve(params as Cell);
                } else {
                    reject(params);
                }
            }
        };

        sdk.uiEvents.on('response', onCallback);
    });
};
