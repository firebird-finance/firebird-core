import {
	getAddress,
	keccak256,
	defaultAbiCoder,
	toUtf8Bytes,
	solidityPack
} from 'ethers/lib/utils'
import {BigNumber, Contract, ContractFactory, Signer, Bytes} from "ethers";
import { ParamType } from "@ethersproject/abi/src.ts/fragments";
import { ethers } from "hardhat";
import { Artifact } from 'hardhat/types';

const Decimal = require('decimal.js');
export const MINIMUM_LIQUIDITY = BigNumber.from(10).pow(3)
export const MaxUint256 = BigNumber.from(2).pow(256).sub(1)
const PERMIT_TYPEHASH = keccak256(
	toUtf8Bytes('Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)')
)

export function expandTo18Decimals(n: number): BigNumber {
	return BigNumber.from(n).mul(BigNumber.from(10).pow(18))
}

function getDomainSeparator(name: string, tokenAddress: string) {
	return keccak256(
		defaultAbiCoder.encode(
			['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
			[
				keccak256(toUtf8Bytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')),
				keccak256(toUtf8Bytes(name)),
				keccak256(toUtf8Bytes('1')),
				1,
				tokenAddress
			]
		)
	)
}

function getPairSalt(token0: string | number, token1: string | number, tokenWeight0: string | number, swapFee: number) {
	return keccak256(solidityPack(['address', 'address', 'uint32', 'uint32'], [token0, token1, tokenWeight0, swapFee]));
}

export function getCreate2Address(
	factoryAddress: string,
	[tokenA, tokenB]: [string, string],
	tokenWeightA: number,
	swapFee: number,
	bytecode: string
): string {
	const [token0, token1, tokenWeight0] = tokenA < tokenB ? [tokenA, tokenB, tokenWeightA] : [tokenB, tokenA, 100 - tokenWeightA]
	const create2Inputs = [
		'0xff',
		factoryAddress,
		getPairSalt(token0, token1, tokenWeight0, swapFee),
		keccak256(bytecode)
	]
	const sanitizedInputs = `0x${create2Inputs.map(i => i.slice(2)).join('')}`
	return getAddress(`0x${keccak256(sanitizedInputs).slice(-40)}`)
}

export async function getApprovalDigest(
	token: Contract,
	approve: {
		owner: string
		spender: string
		value: BigNumber
	},
	nonce: BigNumber,
	deadline: BigNumber
): Promise<string> {
	const name = await token.name()
	const DOMAIN_SEPARATOR = getDomainSeparator(name, token.address)
	return keccak256(
		solidityPack(
			['bytes1', 'bytes1', 'bytes32', 'bytes32'],
			[
				'0x19',
				'0x01',
				DOMAIN_SEPARATOR,
				keccak256(
					defaultAbiCoder.encode(
						['bytes32', 'address', 'address', 'uint256', 'uint256', 'uint256'],
						[PERMIT_TYPEHASH, approve.owner, approve.spender, approve.value, nonce, deadline]
					)
				)
			]
		)
	)
}

export function encodePrice(reserve0: BigNumber, reserve1: BigNumber, weight0 = 50) {
	let pow112of2 = BigNumber.from(2).pow(112);
	reserve0 = reserve0.mul(100 - weight0);
	reserve1 = reserve1.mul(weight0);
	return [reserve1.mul(pow112of2).div(reserve0), reserve0.mul(pow112of2).div(reserve1)]
}

export function crossReserveTargetAmount(
	sourceReserveBalance: any,
	sourceReserveWeight: any,
	targetReserveBalance: any,
	targetReserveWeight: any,
	amount: any,
) {
	sourceReserveBalance = Decimal(sourceReserveBalance.toString());
	sourceReserveWeight = Decimal(sourceReserveWeight.toString());
	targetReserveBalance = Decimal(targetReserveBalance.toString());
	targetReserveWeight = Decimal(targetReserveWeight.toString());
	amount = Decimal(amount.toString());

	// special case for equal weights
	if (sourceReserveWeight.eq(targetReserveWeight)) {
		return targetReserveBalance.mul(amount).div(sourceReserveBalance.add(amount));
	}

	// return targetReserveBalance * (1 - (sourceReserveBalance / (sourceReserveBalance + amount)) ^ (sourceReserveWeight / targetReserveWeight))
	return targetReserveBalance.mul(
		Decimal(1).sub(
			sourceReserveBalance.div(sourceReserveBalance.add(amount)).pow(sourceReserveWeight.div(targetReserveWeight))
		)
	)
}

export function getAmountOut(
	amountIn: any,
	reserveIn: any,
	reserveOut: any,
	tokenWeightIn: any,
	tokenWeightOut: any,
	swapFee: number,
) {
	reserveIn = Decimal(BigNumber.from(reserveIn).toString());
	tokenWeightIn = Decimal(BigNumber.from(tokenWeightIn).toString());
	reserveOut = Decimal(BigNumber.from(reserveOut).toString());
	tokenWeightOut = Decimal(BigNumber.from(tokenWeightOut).toString());
	amountIn = Decimal(BigNumber.from(amountIn).toString());

	// special case for equal weights
	if (tokenWeightIn.eq(tokenWeightOut)) {
		const amountInWithFee = amountIn.mul(10000 - swapFee);
		const ret = reserveOut.mul(amountInWithFee).div(reserveIn.mul(10000).add(amountInWithFee));
		return BigNumber.from(ret.toString(0));
	}

	// return reserveOut * (1 - (reserveIn / (reserveIn + amountIn ( 1 - swapFee)) ^ (tokenWeightIn / tokenWeightOut))
	let amountWithFee = amountIn.mul(Decimal(10000).sub(Decimal(swapFee))).div(10000);
	const ret = reserveOut.sub(reserveOut.mul(reserveIn.div(reserveIn.add(amountWithFee)).pow(tokenWeightIn.div(tokenWeightOut))));
	return BigNumber.from(ret.toFixed(0));
}

export function getAmountIn(
	amountOut: any,
	reserveIn: any,
	reserveOut: any,
	tokenWeightIn: any,
	tokenWeightOut: any,
	swapFee: number,
) {
	reserveIn = Decimal(BigNumber.from(reserveIn).toString());
	tokenWeightIn = Decimal(BigNumber.from(tokenWeightIn).toString());
	reserveOut = Decimal(BigNumber.from(reserveOut).toString());
	tokenWeightOut = Decimal(BigNumber.from(tokenWeightOut).toString());
	amountOut = Decimal(BigNumber.from(amountOut).toString());

	// special case for equal weights
	if (tokenWeightIn.eq(tokenWeightOut)) {
		const numerator = reserveIn.mul(amountOut).mul(10000);
		const denominator = reserveOut.sub(amountOut).mul(10000 - swapFee);
		return BigNumber.from(numerator.div(denominator).add(1).toFixed(0));
	}
	return BigNumber.from(reserveIn.mul(
		Decimal(
			reserveOut.div(reserveOut.sub(amountOut)).pow(tokenWeightOut.div(tokenWeightIn))
		).sub(Decimal(1))
	).mul(10000).div(10000 - swapFee).add(1).toFixed(0));
}

function encodeParameters(types: Array<string | ParamType>, values: Array<any>) {
	const abi = new ethers.utils.AbiCoder();
	return abi.encode(types, values);
}

export function encodePoolInfo(data : any) {
	return encodeParameters([ 'address', 'address', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256'], [
		data.rewardRebaser,
		data.rewardMultiplier,
		data.startBlock,
		data.endRewardBlock,
		data.rewardPerBlock,
		data.lockRewardPercent,
		data.startVestingBlock,
		data.endVestingBlock,
		data.unstakingFrozenTime,
	])
}

export function encodeEpochPoolInfo(data : any) {
	return encodeParameters([ 'address', 'uint256', 'uint256'], [
		data.epochController,
		data.withdrawLockupEpochs,
		data.rewardLockupEpochs
	])
}

// Workaround for linking libraries not yet working in buidler-waffle plugin
// https://github.com/nomiclabs/buidler/issues/611
export function linkBytecode(
	artifact: Artifact,
	libraries: Record<string, string>,
): string | Bytes {
	let bytecode = artifact.bytecode

	for (const [, fileReferences] of Object.entries(artifact.linkReferences)) {
		for (const [libName, fixups] of Object.entries(fileReferences)) {
			const addr = libraries[libName]
			if (addr === undefined) {
				continue
			}

			for (const fixup of fixups) {
				bytecode =
					bytecode.substr(0, 2 + fixup.start * 2) +
					addr.substr(2) +
					bytecode.substr(2 + (fixup.start + fixup.length) * 2)
			}
		}
	}

	return bytecode
}

export async function deployContractWithLibraries(
	signer: Signer,
	artifact: Artifact,
	libraries: Record<string, string>,
	args?: Array<unknown>,
): Promise<Contract> {
	const swapFactory = (await ethers.getContractFactory(
		artifact.abi,
		linkBytecode(artifact, libraries),
		signer,
	)) as ContractFactory

	if (args) {
		return swapFactory.deploy(...args)
	} else {
		return swapFactory.deploy()
	}
}
