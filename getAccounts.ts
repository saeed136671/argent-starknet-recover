import { Wallet } from "ethers";
import { ec, hash, number, SequencerProvider, stark } from "starknet";
import { getPathForIndex, getStarkPair } from "./keyDerivation";

const CHECK_OFFSET = 10;

const PROXY_CONTRACT_CLASS_HASHES = [
  "0x25ec026985a3bf9d0cc1fe17326b245dfdc3ff89b8fde106542a3ea56c5a918",
];
const ARGENT_ACCOUNT_CONTRACT_CLASS_HASHES = [
  "0x3e327de1c40540b98d05cbcb13552008e36f0ec8d61d46956d2f9752c294328",
];

export const BASE_DERIVATION_PATHS = [
  "m/44'/9004'/0'/0",
  "m/2645'/1195502025'/1148870696'/0'/0'",
];

async function getAccountByKeyPair(
  keyPair: ReturnType<typeof getStarkPair>,
  network: "mainnet-alpha" | "goerli-alpha",
  contractClassHash: string,
  accountClassHash: string
) {
  const provider = new SequencerProvider({ network });

  const starkPub = ec.getStarkKey(keyPair);

  const address = hash.calculateContractAddressFromHash(
    starkPub,
    contractClassHash,
    stark.compileCalldata({
      implementation: accountClassHash,
      selector: hash.getSelectorFromName("initialize"),
      calldata: stark.compileCalldata({
        signer: starkPub,
        guardian: "0",
      }),
    }),
    0
  );

  const code = await provider.getCode(address);

  if (code.bytecode.length > 0) {
    return {
      address,
      networkId: network,
      privateKey: number.toHex(number.toBN(keyPair.getPrivate().toString())),
    };
  }
}

export async function getAccountsBySeedPhrase(
  seedPhrase: string,
  network: "mainnet-alpha" | "goerli-alpha"
) {
  const wallet = Wallet.fromMnemonic(seedPhrase);

  const proxyClassHashAndAccountClassHash2DMap = BASE_DERIVATION_PATHS.flatMap(
    (dp) =>
      PROXY_CONTRACT_CLASS_HASHES.flatMap((contractHash) =>
        ARGENT_ACCOUNT_CONTRACT_CLASS_HASHES.map(
          (implementation) => [contractHash, implementation, dp] as const
        )
      )
  );

  const accounts: {
    address: string;
    networkId: string;
    derivationPath: string;
    privateKey: string;
  }[] = [];

  const promises = proxyClassHashAndAccountClassHash2DMap.map(
    async ([contractClassHash, accountClassHash, baseDerivationPath]) => {
      let lastHit = 0;
      let lastCheck = 0;

      while (lastHit + CHECK_OFFSET > lastCheck) {
        const starkPair = getStarkPair(
          lastCheck,
          wallet.privateKey,
          baseDerivationPath
        );

        const account = await getAccountByKeyPair(
          starkPair,
          network,
          contractClassHash,
          accountClassHash
        );

        if (account) {
          lastHit = lastCheck;
          accounts.push({
            ...account,
            derivationPath: getPathForIndex(lastCheck, baseDerivationPath),
          });
        }

        ++lastCheck;
      }
    }
  );

  await Promise.all(promises);

  return accounts;
}

export async function getAccountsByPrivateKey(
  privateKey: string,
  network: "mainnet-alpha" | "goerli-alpha"
) {
  const proxyClassHashAndAccountClassHash2DMap =
    PROXY_CONTRACT_CLASS_HASHES.flatMap((contractHash) =>
      ARGENT_ACCOUNT_CONTRACT_CLASS_HASHES.map(
        (implementation) => [contractHash, implementation] as const
      )
    );

  const keyPair = ec.getKeyPair(privateKey);

  const accounts: {
    address: string;
    networkId: string;
    privateKey?: string;
  }[] = [];

  const promises = proxyClassHashAndAccountClassHash2DMap.map(
    async ([contractClassHash, accountClassHash]) => {
      const account = await getAccountByKeyPair(
        keyPair,
        network,
        contractClassHash,
        accountClassHash
      );

      if (account) {
        accounts.push(account);
      }
    }
  );

  await Promise.all(promises);

  return accounts;
}
