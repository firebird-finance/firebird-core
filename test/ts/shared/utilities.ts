import {BigNumber, BigNumberish} from 'ethers'
import AllBigNumber from "bignumber.js";

export const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000'
export const AddressZero = '0x0000000000000000000000000000000000000000'
export const maxUint256 = BigNumber.from(2).pow(256).sub(1)
export const maxInt128 = BigNumber.from(2).pow(128).sub(1)

export async function unlockForkAddress(ethers: any, address: string): Promise<any> {
	return ethers.provider.send('hardhat_impersonateAccount', [address]);
}

export async function unlockForkAddresses(ethers: any, addresses: string[]): Promise<any[]> {
	return Promise.all(addresses.map(address => unlockForkAddress(ethers, address)))
}

export async function forkBlockNumber(ethers: any, blockNumber: number): Promise<any> {
	if (!process.env.INFURA_API_KEY) {
		throw Error("Please set INFURA_API_KEY in .env file.")
	}
	await ethers.provider.send(
		"hardhat_reset",
		[{
			forking: {
				blockNumber: blockNumber,
				jsonRpcUrl: `https://mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`
			},
		}]
	);
}

export async function lockForkAddress(ethers: any, address: string): Promise<any> {
	return ethers.provider.send('hardhat_stopImpersonatingAccount', [address]);
}

export async function isNotDeployed(deployments: any, name: string): Promise<boolean> {
	let contract = await deployments.getOrNull(name);
	return contract == null || contract.address == null
}

export async function isDeployed(deployments: any, name: string): Promise<boolean> {
	let contract = await deployments.getOrNull(name);
	return contract && contract.address != null
}

export function toWei(n: BigNumberish): BigNumber {
	return expandDecimals(n, 18)
}

export function toWeiString(n: BigNumberish): string {
	return expandDecimalsString(n, 18)
}

export function fromWei(n: BigNumberish): string {
	return collapseDecimals(n, 18)
}

export function expandDecimals(n: BigNumberish, decimals = 18): BigNumber {
	return BigNumber.from(new AllBigNumber(n.toString()).multipliedBy(new AllBigNumber(10).pow(decimals)).toFixed(0));
}

export function expandDecimalsString(n: BigNumberish, decimals = 18): string {
	return new AllBigNumber(n.toString()).multipliedBy(new AllBigNumber(10).pow(decimals)).toFixed()
}

export function collapseDecimals(n: BigNumberish, decimals = 18): string {
	return new AllBigNumber(n.toString()).div(new AllBigNumber(10).pow(decimals)).toFixed()
}

export async function mineBlocks(ethers: any, blocks: number): Promise<any> {
	for (let i = 0; i < blocks; i++) {
		await mineOneBlock(ethers);
		if (i > 0 && i % 1000 == 0) {
			console.log("mine block %d/%d", i + 1, blocks);
		}
	}
}

export async function mineBlockTimeStamp(ethers: any, timestamp: number): Promise<any> {
	return ethers.provider.send('evm_mine', [timestamp]);
}

export async function mineBlock(ethers: any, timestamp: number): Promise<any> {
	return ethers.provider.send('evm_mine', [timestamp]);
}

export async function mineOneBlock(ethers: any): Promise<any> {
	return ethers.provider.send('evm_mine', []);
}

export async function setNextBlockTimestamp(ethers: any, timestamp: number) {
	const block = await ethers.provider.send("eth_getBlockByNumber", ["latest", false]);
	const currentTs = block.timestamp;
	const diff = timestamp - currentTs;
	await ethers.provider.send("evm_increaseTime", [diff]);
}

export async function moveForwardSeconds(ethers: any, timestamp: number) {
	await setNextBlockTimestamp(ethers, (await getLatestBlockTime(ethers)) + timestamp);
	await ethers.provider.send("evm_mine", []);
}

export async function getLatestBlockTime(ethers: any): Promise<number> {
	return (await getLatestBlock(ethers)).timestamp;
}

export async function getLatestBlockNumber(ethers: any): Promise<number> {
	return (await getLatestBlock(ethers)).number
}

export async function getLatestBlock(ethers: any): Promise<{
	hash: string;
	parentHash: string;
	number: number;
	timestamp: number;
	nonce: string;
	difficulty: number;
	gasLimit: BigNumber;
	gasUsed: BigNumber;
	miner: string;
	extraData: string;
}> {
	return await ethers.provider.getBlock("latest")
}
