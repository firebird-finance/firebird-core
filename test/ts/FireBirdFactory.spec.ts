import {expect} from "./chai-setup";
import {BigNumber, Contract} from 'ethers'
import {ethers} from "hardhat";


import {getCreate2Address} from './shared/common'
import {factoryFixture} from './shared/fixtures'
import {SignerWithAddress} from "hardhat-deploy-ethers/dist/src/signer-with-address";
import { ADDRESS_ZERO, toWei } from "./shared/utilities";
import {TestErc20, TestErc20Factory, FireBirdPairFactory} from "../../typechain";

let TEST_ADDRESSES: [string, string];

describe('FireBirdFactory', () => {
	let signers: SignerWithAddress[];
	let wallet: SignerWithAddress;
	let other: SignerWithAddress;
	let uniswapPairBytecode: string;
	let factory: Contract
	let token0: TestErc20;
	let token1: TestErc20;

	beforeEach(async () => {
		signers = await ethers.getSigners();
		wallet = signers[0];
		other = signers[1];
		const fixture = await factoryFixture(wallet)
		factory = fixture.factory;
		uniswapPairBytecode = new FireBirdPairFactory(wallet).bytecode;

		token0 = await new TestErc20Factory(wallet).deploy(toWei(10000));
		token1 = await new TestErc20Factory(wallet).deploy(toWei(10000));
		let token0Lt = BigNumber.from(token0.address).lt(BigNumber.from(token1.address));

		TEST_ADDRESSES = [token0Lt ? token0.address : token1.address, token0Lt ? token1.address: token0.address];
	})

	it('feeTo, feeToSetter, allPairsLength', async () => {
		expect(await factory.feeTo()).to.eq(ADDRESS_ZERO)
		expect(await factory.feeToSetter()).to.eq(wallet.address)
		expect(await factory.allPairsLength()).to.eq(0)
	})

	async function createPair(tokens: [string, string], tokenWeightA: number,
														swapFee: number) {
		const allPairsLength = Number(await factory.allPairsLength());
		const create2Address = getCreate2Address(factory.address, tokens, tokenWeightA, swapFee, uniswapPairBytecode)
		expect(await factory.isPair(create2Address)).to.eq(false)
		await expect(factory.createPair(...tokens, tokenWeightA, swapFee))
			.to.emit(factory, 'PairCreated')
			.withArgs(TEST_ADDRESSES[0], TEST_ADDRESSES[1], create2Address, tokenWeightA, swapFee, BigNumber.from(allPairsLength + 1))

		await expect(factory.createPair(...tokens)).to.be.reverted // FLP: PAIR_EXISTS
		await expect(factory.createPair(...tokens.slice().reverse())).to.be.reverted // FLP: PAIR_EXISTS
		expect(await factory.getPair(...tokens, tokenWeightA, swapFee)).to.eq(create2Address)
		expect(await factory.getPair(...tokens.slice().reverse(), 100 - tokenWeightA, swapFee)).to.eq(create2Address)

		expect(await factory.getPair(...tokens, tokenWeightA, swapFee)).to.eq(create2Address)
		expect(await factory.getPair(...tokens.slice().reverse(), 100 - tokenWeightA, swapFee)).to.eq(create2Address)
		expect(await factory.allPairs(allPairsLength)).to.eq(create2Address)
		expect(await factory.isPair(create2Address)).to.eq(true)
		expect(await factory.allPairsLength()).to.eq(allPairsLength + 1)

		const pair = FireBirdPairFactory.connect(create2Address, wallet)
		expect(await pair.factory()).to.eq(factory.address)
		expect(await pair.token0()).to.eq(TEST_ADDRESSES[0])
		expect(await pair.token1()).to.eq(TEST_ADDRESSES[1])
		const tokenWeights = await pair.getTokenWeights();
		expect(tokenWeights[0]).to.eq(tokenWeightA)
		expect(tokenWeights[1]).to.eq(100 - tokenWeightA)
		expect(await pair.getSwapFee()).to.eq(swapFee)
	}

	it('createPair', async () => {
		await createPair(TEST_ADDRESSES, 50, 30)
		await expect(factory.createPair(...TEST_ADDRESSES, 50, 30)).to.be.revertedWith('FLP: PAIR_EXISTS')
		await createPair(TEST_ADDRESSES, 50, 40)
		await createPair(TEST_ADDRESSES, 10, 500)
		await createPair(TEST_ADDRESSES, 10, 5)
	})

	it('createInvalidPair', async () => {
		await expect(createPair([
			'0x1000000000000000000000000000000000000000',
			'0x0000000000000000000000000000000000000000'
		], 50, 30)).to.be.revertedWith('FLP: ZERO_ADDRESS')
		await expect(createPair(TEST_ADDRESSES, 0, 30)).to.be.revertedWith('FLP: INVALID_TOKEN_WEIGHT')
		await expect(createPair(TEST_ADDRESSES, 100, 30)).to.be.revertedWith('FLP: INVALID_TOKEN_WEIGHT')
		await expect(createPair(TEST_ADDRESSES, 99, 30)).to.be.revertedWith('FLP: INVALID_TOKEN_WEIGHT')
		await expect(createPair(TEST_ADDRESSES, 51, 30)).to.be.revertedWith('FLP: INVALID_TOKEN_WEIGHT')
		await expect(createPair(TEST_ADDRESSES, 40, 0)).to.be.revertedWith('FLP: INVALID_SWAP_FEE')
		await expect(createPair(TEST_ADDRESSES, 40, 20000)).to.be.revertedWith('FLP: INVALID_SWAP_FEE')
		await expect(createPair(TEST_ADDRESSES, 40, 200004)).to.be.revertedWith('FLP: INVALID_SWAP_FEE')
		await expect(createPair(TEST_ADDRESSES, 40, 0)).to.be.revertedWith('FLP: INVALID_SWAP_FEE')
	})

	it('createPair:reverse', async () => {
		await createPair(TEST_ADDRESSES.slice().reverse() as [string, string], 50, 30)
	})

	it('createPair:gas', async () => {
		const tx = await factory.createPair(...TEST_ADDRESSES, 50, 30)
		const receipt = await tx.wait()
		expect(receipt.gasUsed).to.eq(3377231)
	})

	it('setFeeTo', async () => {
		await expect(factory.connect(other).setFeeTo(other.address)).to.be.revertedWith('FLP: FORBIDDEN')
		await factory.setFeeTo(wallet.address)
		expect(await factory.feeTo()).to.eq(wallet.address)
	})
	it('setProtocolFee', async () => {
		await expect(factory.connect(other).setProtocolFee(1)).to.be.revertedWith('FLP: FORBIDDEN')
		await expect(factory.setProtocolFee(1999)).to.be.revertedWith('FLP: Invalid Protocol fee')
		await expect(factory.setProtocolFee(100001)).to.be.revertedWith('FLP: Invalid Protocol fee')
		await factory.setProtocolFee(10000)
		expect(await factory.protocolFee()).to.eq(10000)
		await factory.setProtocolFee(20000)
		expect(await factory.protocolFee()).to.eq(20000)
		await factory.setProtocolFee(100000)
		expect(await factory.protocolFee()).to.eq(100000)
		await factory.setProtocolFee(0)
		expect(await factory.protocolFee()).to.eq(0)
		await factory.setProtocolFee(50000)
		expect(await factory.protocolFee()).to.eq(50000)
	})

	it('setFeeToSetter', async () => {
		await expect(factory.connect(other).setFeeToSetter(other.address)).to.be.revertedWith('FLP: FORBIDDEN')
		await factory.setFeeToSetter(other.address)
		expect(await factory.feeToSetter()).to.eq(other.address)
		await expect(factory.setFeeToSetter(wallet.address)).to.be.revertedWith('FLP: FORBIDDEN')
	})
})
