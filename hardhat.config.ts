import {config as dotEnvConfig} from 'dotenv';

dotEnvConfig();
import {HardhatUserConfig} from 'hardhat/types';
import 'hardhat-typechain';
import 'hardhat-deploy';
import 'hardhat-deploy-ethers';
import 'hardhat-contract-sizer';
import 'hardhat-gas-reporter';
import '@nomiclabs/hardhat-etherscan';

import {HardhatNetworkAccountsUserConfig} from 'hardhat/types/config';

const INFURA_API_KEY = process.env.INFURA_API_KEY as string;
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY as string;
const MNEMONIC = process.env.MNEMONIC as string;
const accounts: HardhatNetworkAccountsUserConfig = {
    mnemonic: MNEMONIC ?? 'test test test test test test test test test test test junk'
}
const config: HardhatUserConfig = {
    defaultNetwork: 'hardhat',
    namedAccounts: {
        deployer: 0,
        bob: 1,
        weth: {
            bsctestnet: '0xae13d989dac2f0debff460ac112a837c89baa7cd',
            bsc: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
        },
        governance: {
            hardhat: 1,
            local: 1,
            bsc: '0xA20CA7c6705fB88847Cbf50549D7A38f4e99d32c',
            bsctestnet: 1,
        },
        proxyAdmin: {
            hardhat: 2,
            local: 2,
            bsc: '0x6C844B76d8984a7703Ac4AA211a6507E088D8169',
            bsctestnet: 2,
        },
    },
    etherscan: {
        apiKey: ETHERSCAN_API_KEY,
    },
    solidity: {
        compilers: [
            {
                version: '0.5.16', settings: {
                    optimizer: {
                        enabled: true,
                        runs: 999999,
                    },
                },
            },
            {
                version: '0.6.12', settings: {
                    optimizer: {
                        enabled: true,
                        runs: 999999,
                    },
                },
            },
            {
                version: '0.7.6', settings: {
                    optimizer: {
                        enabled: true,
                        runs: 999999,
                    },
                },
            },
        ],
    },

    networks: {
        hardhat: {
            tags: process.env.DEFAULT_TAG ? process.env.DEFAULT_TAG.split(',') : ['local'],
            live: false,
            saveDeployments: false,
            allowUnlimitedContractSize: true,
            chainId: 1,
            accounts,
        },
        localhost: {
            tags: ['local'],
            live: false,
            saveDeployments: false,
            url: 'http://localhost:8545',
            accounts,
            timeout: 60000,
        },
        rinkeby: {
            tags: ['local', 'staging'],
            live: true,
            saveDeployments: true,
            url: `https://rinkeby.infura.io/v3/${INFURA_API_KEY}`,
            accounts,
        },
        kovan: {
            tags: ['local', 'staging'],
            live: true,
            saveDeployments: true,
            accounts,
            loggingEnabled: true,
            url: `https://kovan.infura.io/v3/${INFURA_API_KEY}`,
        },
        bsctestnet: {
            tags: ['local', 'staging'],
            live: true,
            saveDeployments: true,
            accounts,
            loggingEnabled: true,
            url: `https://data-seed-prebsc-1-s2.binance.org:8545`,
        },
        ganache: {
            tags: ['local'],
            live: true,
            saveDeployments: false,
            accounts,
            url: 'http://127.0.0.1:8555', // Coverage launches its own ganache-cli client
        },
        coverage: {
            tags: ['local'],
            live: false,
            saveDeployments: false,
            accounts,
            url: 'http://127.0.0.1:8555', // Coverage launches its own ganache-cli client
        },
    },
    typechain: {
        outDir: 'typechain',
        target: 'ethers-v5',
    },
    paths: {
        sources: './contracts',
        tests: './test',
        cache: './cache',
        artifacts: './artifacts',
    },
    external: {
        contracts: [{
            artifacts : "node_modules/@openzeppelin/upgrades/build/contracts"
        }]
    },
    mocha: {
        timeout: 200000
    },
    contractSizer: {
        alphaSort: true,
        runOnCompile: true,
        disambiguatePaths: false,
    }
};

export default config;
