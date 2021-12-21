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
            matic: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
            kcc: '0x4446Fc4eb47f2f6586f9fAAb68B3498F86C07521',
            iotex: '0xa00744882684c3e4747faefd68d283ea44099d03',
        },
        governance: {
            hardhat: 1,
            local: 1,
            bsc: '0xA20CA7c6705fB88847Cbf50549D7A38f4e99d32c',
            matic: '0xA20CA7c6705fB88847Cbf50549D7A38f4e99d32c',
            kcc: '0xA20CA7c6705fB88847Cbf50549D7A38f4e99d32c',
            iotex: '0xA20CA7c6705fB88847Cbf50549D7A38f4e99d32c',
            bsctestnet: 1,
        },
        proxyAdmin: {
            hardhat: 2,
            local: 2,
            bsc: '0x6C844B76d8984a7703Ac4AA211a6507E088D8169',
            matic: '0x6C844B76d8984a7703Ac4AA211a6507E088D8169',
            kcc: '0x6C844B76d8984a7703Ac4AA211a6507E088D8169',
            iotex: '0x6C844B76d8984a7703Ac4AA211a6507E088D8169',
            bsctestnet: 2,
        },
        uniRouter: {
            hardhat: '0x9Ac64Cc6e4415144C455BD8E4837Fea55603e5c3',
            local: '0x9Ac64Cc6e4415144C455BD8E4837Fea55603e5c3',
            bsc: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
            matic: '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff',
            kcc: '0xc0fFee0000C824D24E0F280f1e4D21152625742b',
            bsctestnet: '0x9Ac64Cc6e4415144C455BD8E4837Fea55603e5c3', //https://pancake.kiemtienonline360.com/
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
        overrides: {
            "contracts/FireBirdRouter.sol": {
                version: '0.7.6',
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 9999,
                    },
                },
            }
        }
    },

    networks: {
        hardhat: {
            tags: process.env.DEFAULT_TAG ? process.env.DEFAULT_TAG.split(',') : ['local'],
            live: false,
            saveDeployments: false,
            allowUnlimitedContractSize: false,
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
        bsc: {
            tags: ['production'],
            live: true,
            saveDeployments: true,
            accounts,
            loggingEnabled: true,
            url: `https://bsc-dataseed.binance.org/`,
        },
        matic: {
            tags: ['production'],
            live: true,
            saveDeployments: true,
            accounts,
            loggingEnabled: true,
            url: `https://rpc-mainnet.maticvigil.com/`,
        },
        kcc: {
            tags: ['production'],
            live: true,
            saveDeployments: true,
            accounts,
            loggingEnabled: true,
            url: `https://rpc-mainnet.kcc.network/`,
        },
        iotex: {
            tags: ['production'],
            live: true,
            saveDeployments: true,
            accounts,
            loggingEnabled: true,
            url: `https://babel-api.mainnet.iotex.io/`,
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
