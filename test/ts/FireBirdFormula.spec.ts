import {expect} from "./chai-setup";
import {BigNumber, Contract} from 'ethers'
import {ethers, network} from "hardhat";

import {
	getAmountIn,
	getAmountOut,
	MaxUint256,
} from './shared/common'
import {SignerWithAddress} from "hardhat-deploy-ethers/dist/src/signer-with-address";
import {v2Fixture} from "./shared/fixtures";

const overrides = {}

describe('FireBirdFormula', () => {
	let token0: Contract
	let token1: Contract
	let pair: Contract
	let router: Contract
	let formula: Contract
	let signers: SignerWithAddress[];

	let wallet: SignerWithAddress;
	let other: SignerWithAddress;
	let deployWallet: any;
	beforeEach(async function () {
		deployWallet = await ethers.Wallet.fromMnemonic(((network.config.accounts) as any).mnemonic);

		signers = await ethers.getSigners();
		wallet = signers[0];
		other = signers[1];
		const fixture = await v2Fixture(wallet, true)
		token0 = fixture.token0
		token1 = fixture.token1
		pair = fixture.pair
		router = fixture.router
		formula = fixture.formula
	})

	it('quote', async () => {
		expect(await formula.quote(BigNumber.from(1), BigNumber.from(100), BigNumber.from(200))).to.eq(BigNumber.from(2))
		expect(await formula.quote(BigNumber.from(2), BigNumber.from(200), BigNumber.from(100))).to.eq(BigNumber.from(1))
		await expect(formula.quote(BigNumber.from(0), BigNumber.from(100), BigNumber.from(200))).to.be.revertedWith(
			'FireBirdFormula: INSUFFICIENT_AMOUNT'
		)
		await expect(formula.quote(BigNumber.from(1), BigNumber.from(0), BigNumber.from(200))).to.be.revertedWith(
			'FireBirdFormula: INSUFFICIENT_LIQUIDITY'
		)
		await expect(formula.quote(BigNumber.from(1), BigNumber.from(100), BigNumber.from(0))).to.be.revertedWith(
			'FireBirdFormula: INSUFFICIENT_LIQUIDITY'
		)
	})

	it('getAmountOut', async () => {
		expect(await formula.getAmountOut(BigNumber.from(4), BigNumber.from(100), BigNumber.from(100), 50, 50, 30)).to.eq(BigNumber.from(3))
		expect(await formula.getAmountOut(BigNumber.from(3242), BigNumber.from(12344502), BigNumber.from(32304234), 50, 50, 30)).to.eq(BigNumber.from(8456))
		await expect(formula.getAmountOut(BigNumber.from(0), BigNumber.from(100), BigNumber.from(100), 50, 50, 30)).to.be.revertedWith(
			'FireBirdFormula: INSUFFICIENT_INPUT_AMOUNT'
		)
		await expect(formula.getAmountOut(BigNumber.from(2), BigNumber.from(0), BigNumber.from(100), 50, 50, 30)).to.be.revertedWith(
			'FireBirdFormula: INSUFFICIENT_LIQUIDITY'
		)
		await expect(formula.getAmountOut(BigNumber.from(2), BigNumber.from(100), BigNumber.from(0), 50, 50, 30)).to.be.revertedWith(
			'FireBirdFormula: INSUFFICIENT_LIQUIDITY'
		)
	})


	it('getAmountIn', async () => {
		// expect(await router.getAmountIn(BigNumber.from(1), BigNumber.from(100), BigNumber.from(100), 50, 50, 3)).to.eq(BigNumber.from(2))
		expect(await formula.getAmountIn(BigNumber.from(3242), BigNumber.from(12344502), BigNumber.from(32304234), 50, 50, 30)).to.eq(BigNumber.from(1243))
		await expect(formula.getAmountIn(BigNumber.from(0), BigNumber.from(100), BigNumber.from(100), 50, 50, 30)).to.be.revertedWith(
			'FireBirdFormula: INSUFFICIENT_OUTPUT_AMOUNT'
		)
		await expect(formula.getAmountIn(BigNumber.from(1), BigNumber.from(0), BigNumber.from(100), 50, 50, 30)).to.be.revertedWith(
			'FireBirdFormula: INSUFFICIENT_LIQUIDITY'
		)
		await expect(formula.getAmountIn(BigNumber.from(1), BigNumber.from(100), BigNumber.from(0), 50, 50, 30)).to.be.revertedWith(
			'FireBirdFormula: INSUFFICIENT_LIQUIDITY'
		)
	})


	it('getAmountsOut', async () => {
		await token0.approve(router.address, MaxUint256)
		await token1.approve(router.address, MaxUint256)
		await router.addLiquidity(
			pair.address,
			token0.address,
			token1.address,
			BigNumber.from(10000),
			BigNumber.from(10000),
			0,
			0,
			wallet.address,
			MaxUint256,
			overrides
		)

		await expect(formula.getAmountsOut(token0.address, token1.address, BigNumber.from(2), [])).to.be.revertedWith(
			'FireBirdFormula: INVALID_PATH'
		)
		const path = [pair.address]
		expect(await formula.getAmountsOut(token0.address, token1.address, BigNumber.from(4), path)).to.deep.eq([BigNumber.from(4), BigNumber.from(3)])
	})

	it('getAmountsIn', async () => {
		await token0.approve(router.address, MaxUint256)
		await token1.approve(router.address, MaxUint256)
		await router.addLiquidity(
			pair.address,
			token0.address,
			token1.address,
			BigNumber.from(10000),
			BigNumber.from(10000),
			0,
			0,
			wallet.address,
			MaxUint256,
			overrides
		)

		await expect(formula.getAmountsIn(token0.address, token1.address, BigNumber.from(1), [])).to.be.revertedWith(
			'FireBirdFormula: INVALID_PATH'
		)
		const path = [pair.address]
		expect(await formula.getAmountsIn(token0.address, token1.address, BigNumber.from(1), path)).to.deep.eq([BigNumber.from(2), BigNumber.from(1)])
	})
	it('mintLiquidityFee', async () => {
		//(((100 + 1000)/1000)^(50/100) - 1) * 1000000
		expect(await formula.mintLiquidityFee(1000000, 1000, 1000, 50, 50, 100, 0)).to.eq(48808)
		expect(await formula.mintLiquidityFee(1000000, 1000, 1000, 50, 50, 0, 100)).to.eq(48808)
		expect(await formula.mintLiquidityFee(1000000, 1000, 1000, 50, 50, 100, 100)).to.eq(97616)
		//(((100 + 2000)/2000)^(50/100) - 1) * 1000000
		expect(await formula.mintLiquidityFee(1000000, 2000, 1000, 50, 50, 100, 0)).to.eq(24695)
		expect(await formula.mintLiquidityFee(1000000, 2000, 1000, 50, 50, 0, 100)).to.eq(48808)
		expect(await formula.mintLiquidityFee(1000000, 2000, 1000, 50, 50, 100, 100)).to.eq(73503)
	})
})

describe('FireBirdFormulaWeight', () => {


	let token0: Contract
	let token1: Contract
	let pair: Contract
	let router: Contract
	let formula: Contract
	let signers: SignerWithAddress[];

	let wallet: SignerWithAddress;
	let other: SignerWithAddress;
	let deployWallet: any;
	beforeEach(async function () {
		deployWallet = await ethers.Wallet.fromMnemonic(((network.config.accounts) as any).mnemonic);

		signers = await ethers.getSigners();
		wallet = signers[0];
		other = signers[1];
		const fixture = await v2Fixture(wallet, true)
		token0 = fixture.token0
		token1 = fixture.token1
		pair = fixture.pair
		router = fixture.router
		formula = fixture.formula
	})
	it('getAmountOut', async () => {
		expect(await formula.getAmountOut(1000, 10000,10000, 98, 2, 0)).to.eq(9906)
		// expect(getAmountOut(1000, 10000, 10000, 98, 2, 0)).to.eq(9906);

		expect(await formula.getAmountOut(1000, 10023423400,2313453450000, 98, 2, 0)).to.eq(11309403)
		// expect(getAmountOut(1000, 10023423400, 2313453450000, 98, 2, 0)).to.eq(11309403);


		expect(await formula.getAmountOut(100023423, 10023423400, 2313453450000, 98, 2, 0)).to.eq(891266825871)
		// expect(getAmountOut(100023423, 10023423400, 2313453450000, 98, 2, 0)).to.eq(891266825871);

		expect(await formula.getAmountOut(10023423400, 10023423400, 2313453450000, 98, 2, 0)).to.eq(2313453449999)
		// expect(await getAmountOut(10023423400, 10023423400, 2313453450000, 98, 2, 0)).to.eq(2313453449999)
		expect(await formula.getAmountOut(10023423400, 10023423400, 2313453450000, 2, 98, 0)).to.eq(32495410881)
		// expect(await getAmountOut(10023423400, 10023423400, 2313453450000, 2, 98, 0)).to.eq(32495410881)


		expect(await formula.getAmountOut(20023423400, 10023423400, 2313453450000, 2, 98, 0)).to.eq(51256025942)
		// expect(await getAmountOut(20023423400, 10023423400, 2313453450000, 2, 98, 0)).to.eq(51256025942)



		expect(await formula.getAmountOut("4232002342342343", "100234234002342342343", "300234232002342342343", 2, 98, 0)).to.eq("258692951827702")
		// expect(await getAmountOut("4232002342342343", "100234234002342342343", "300234232002342342343", 2, 98, 0)).to.eq("258692951827702")

	})

	it('getAmountOut:withFee', async () => {
		expect(await formula.getAmountOut(1000, 10000, 10000, 20, 80, 30)).to.eq(234)
		// expect(getAmountOut(1000, 10000, 10000, 20, 80, 3)).to.eq(234);

		expect(await formula.getAmountOut(1000, 10000, 10000, 2, 98, 30)).to.eq(19)
		// expect(getAmountOut(1000, 10000, 10000, 2, 98, 3)).to.eq(19);

		expect(await formula.getAmountOut(1000, 10000, 10000, 98, 2, 30)).to.eq(9905)
		// expect(getAmountOut(1000, 10000, 10000, 98, 2, 3)).to.eq(9905);

	})

	it('getAmountIn', async () => {
		expect(await formula.getAmountIn(1000, 10000, 10000, 22, 78, 30)).to.eq(4543)
		expect(getAmountIn(1000, 10000, 10000, 22, 78, 30)).to.eq(4543);
		expect(getAmountOut(4529, 10000, 10000, 22, 78, 30)).to.eq(998);

		expect(await formula.getAmountIn(1000, 10000, 10000, 2, 98, 30)).to.eq(1741518)
		expect(getAmountIn(1000, 10000, 10000, 2, 98, 30)).to.eq(1741518);

		expect(await formula.getAmountIn(23423400, 10023423400, 2313453450000, 2, 98, 30)).to.eq(4989030)
		// expect(getAmountIn(23423400, 10023423400, 2313453450000, 2, 98, 3)).to.eq(4989030);

		expect(await formula.getAmountIn(1000, 10000, 10000, 98, 2, 30)).to.eq(22)
		// expect(getAmountIn(1000, 10000, 10000, 98, 2, 3)).to.eq(22);
	})

	it('mintLiquidityFee', async () => {
		//(((100 + 1000)/1000)^(90/100) - 1) * 1000000
		expect(await formula.mintLiquidityFee(1000000, 1000, 1000, 90, 10, 100, 0)).to.eq(89565)
		//(((100 + 1000)/1000)^(10/100) - 1) * 1000000
		expect(await formula.mintLiquidityFee(1000000, 1000, 1000, 90, 10, 0, 100)).to.eq(9576)
		expect(await formula.mintLiquidityFee(1000000, 1000, 1000, 90, 10, 100, 100)).to.eq(99141)
		//(((100 + 2000)/2000)^(90/100) - 1) * 1000000
		expect(await formula.mintLiquidityFee(1000000, 2000, 1000, 90, 10, 100, 0)).to.eq(44889)
		expect(await formula.mintLiquidityFee(1000000, 2000, 1000, 90, 10, 0, 100)).to.eq(9576)
		expect(await formula.mintLiquidityFee(1000000, 2000, 1000, 90, 10, 100, 100)).to.eq(54465)
	})

})