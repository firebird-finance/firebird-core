import {expect} from "./chai-setup";
import {BigNumber, Contract} from 'ethers'
import {ethers, network} from "hardhat";
import {ecsign} from 'ethereumjs-util'

import {expandTo18Decimals, getApprovalDigest, MaxUint256, MINIMUM_LIQUIDITY} from './shared/common'
import {SignerWithAddress} from "hardhat-deploy-ethers/dist/src/signer-with-address";
import {v2Fixture} from "./shared/fixtures";
import {AddressZero, getLatestBlock, mineBlock, toWei} from "./shared/utilities";
import {
	DeflatingErc20Factory, FireBirdFactory,
	FireBirdPairFactory,
	FireBirdRouter, RouterEventEmitter
} from "../../typechain";

const overrides = {}
describe('UniswapV2Router', () => {
	let token0: Contract
	let token1: Contract
	let WETH: Contract
	let WETHPartner: Contract
	let factory: FireBirdFactory
	let router: FireBirdRouter
	let pair: Contract
	let WETHPair: Contract
	let routerEventEmitter: RouterEventEmitter
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
		WETH = fixture.WETH
		WETHPartner = fixture.WETHPartner
		factory = fixture.factoryV2
		router = fixture.router
		pair = fixture.pair
		WETHPair = fixture.WETHPair
		routerEventEmitter = fixture.routerEventEmitter
	})

	afterEach(async function () {
		expect(await ethers.provider.getBalance(router.address)).to.eq(0)
	})

	it('factory, WETH', async () => {
		expect(await router.factory()).to.eq(factory.address)
		expect(await router.WETH()).to.eq(WETH.address)
	})

	it('addLiquidity', async () => {
		const token0Amount = expandTo18Decimals(1)
		const token1Amount = expandTo18Decimals(4)

		const expectedLiquidity = expandTo18Decimals(2)
		await token0.approve(router.address, MaxUint256)
		await token1.approve(router.address, MaxUint256)
		await expect(
			router.addLiquidity(
				pair.address,
				token0.address,
				token1.address,
				token0Amount,
				token1Amount,
				0,
				0,
				wallet.address,
				MaxUint256,
				overrides
			)
		)
			.to.emit(token0, 'Transfer')
			.withArgs(wallet.address, pair.address, token0Amount)
			.to.emit(token1, 'Transfer')
			.withArgs(wallet.address, pair.address, token1Amount)
			.to.emit(pair, 'Transfer')
			.withArgs(AddressZero, AddressZero, MINIMUM_LIQUIDITY)
			.to.emit(pair, 'Transfer')
			.withArgs(AddressZero, wallet.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
			.to.emit(pair, 'Sync')
			.withArgs(token0Amount, token1Amount)
			.to.emit(pair, 'Mint')
			.withArgs(router.address, token0Amount, token1Amount)

		expect(await pair.balanceOf(wallet.address)).to.eq(expectedLiquidity.sub(MINIMUM_LIQUIDITY))
	})

	it('addLiquidityETH', async () => {
		const WETHPartnerAmount = expandTo18Decimals(1)
		const ETHAmount = expandTo18Decimals(4)

		const expectedLiquidity = expandTo18Decimals(2)
		const WETHPairToken0 = await WETHPair.token0()
		await WETHPartner.approve(router.address, MaxUint256)
		await expect(
			router.addLiquidityETH(
				WETHPair.address,
				WETHPartner.address,
				WETHPartnerAmount,
				WETHPartnerAmount,
				ETHAmount,
				wallet.address,
				MaxUint256,
				{...overrides, value: ETHAmount}
			)
		)
			.to.emit(WETHPair, 'Transfer')
			.withArgs(AddressZero, AddressZero, MINIMUM_LIQUIDITY)
			.to.emit(WETHPair, 'Transfer')
			.withArgs(AddressZero, wallet.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
			.to.emit(WETHPair, 'Sync')
			.withArgs(
				WETHPairToken0 === WETHPartner.address ? WETHPartnerAmount : ETHAmount,
				WETHPairToken0 === WETHPartner.address ? ETHAmount : WETHPartnerAmount
			)
			.to.emit(WETHPair, 'Mint')
			.withArgs(
				router.address,
				WETHPairToken0 === WETHPartner.address ? WETHPartnerAmount : ETHAmount,
				WETHPairToken0 === WETHPartner.address ? ETHAmount : WETHPartnerAmount
			)

		expect(await WETHPair.balanceOf(wallet.address)).to.eq(expectedLiquidity.sub(MINIMUM_LIQUIDITY))
	})

	async function addLiquidity(token0Amount: BigNumber, token1Amount: BigNumber) {
		await token0.transfer(pair.address, token0Amount)
		await token1.transfer(pair.address, token1Amount)
		await pair.mint(wallet.address, overrides)
	}

	it('createPair', async () => {
		const token0Amount = expandTo18Decimals(1)
		const token1Amount = expandTo18Decimals(4)
		await token0.approve(router.address, token0Amount)
		await token1.approve(router.address, token1Amount)
		const expectedLiquidity = expandTo18Decimals(2)
		await router.createPair(
				token0.address,
				token1.address,
				expandTo18Decimals(1),
				expandTo18Decimals(4),
				50,
				10,
				wallet.address,
				overrides)
		const pair = FireBirdPairFactory.connect(await factory.getPair(token0.address,token1.address, 50 , 10), wallet)
		expect(await  pair.balanceOf(wallet.address)).to.eq(expectedLiquidity.sub(MINIMUM_LIQUIDITY))
		expect(await  pair.getSwapFee()).to.eq(10)
		let reserves = await pair.getReserves();
		let t0 = await pair.token0();
		expect(reserves._reserve0).to.eq(t0 == token0.address ? token0Amount : token1Amount)
		expect(reserves._reserve1).to.eq(t0 == token0.address ? token1Amount : token0Amount)
	})
	it('createPairWETH', async () => {
		const token0Amount = expandTo18Decimals(1)
		const token1Amount = expandTo18Decimals(4)
		await token0.approve(router.address, token0Amount)
		const expectedLiquidity = expandTo18Decimals(2)
		await router.createPairETH(
			token0.address,
			expandTo18Decimals(1),
			50,
			10,
			wallet.address,
			{
				value: token1Amount
			})
		const pair = FireBirdPairFactory.connect(await factory.getPair(token0.address, WETH.address, 50, 10), wallet)
		expect(await  pair.balanceOf(wallet.address)).to.eq(expectedLiquidity.sub(MINIMUM_LIQUIDITY))
		expect(await  pair.getSwapFee()).to.eq(10)
		let reserves = await pair.getReserves();
		let t0 = await pair.token0();
		expect(reserves._reserve0).to.eq(t0 == token0.address ? token0Amount : token1Amount)
		expect(reserves._reserve1).to.eq(t0 == token0.address ? token1Amount : token0Amount)
	})
	it('removeLiquidity', async () => {
		const token0Amount = expandTo18Decimals(1)
		const token1Amount = expandTo18Decimals(4)
		await addLiquidity(token0Amount, token1Amount)

		const expectedLiquidity = expandTo18Decimals(2)
		await pair.approve(router.address, MaxUint256)
		await expect(
			router.removeLiquidity(
				pair.address,
				token0.address,
				token1.address,
				expectedLiquidity.sub(MINIMUM_LIQUIDITY),
				0,
				0,
				wallet.address,
				MaxUint256,
				overrides
			)
		)
			.to.emit(pair, 'Transfer')
			.withArgs(wallet.address, pair.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
			.to.emit(pair, 'Transfer')
			.withArgs(pair.address, AddressZero, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
			.to.emit(token0, 'Transfer')
			.withArgs(pair.address, wallet.address, token0Amount.sub(500))
			.to.emit(token1, 'Transfer')
			.withArgs(pair.address, wallet.address, token1Amount.sub(2000))
			.to.emit(pair, 'Sync')
			.withArgs(500, 2000)
			.to.emit(pair, 'Burn')
			.withArgs(router.address, token0Amount.sub(500), token1Amount.sub(2000), wallet.address)

		expect(await pair.balanceOf(wallet.address)).to.eq(0)
		const totalSupplyToken0 = await token0.totalSupply()
		const totalSupplyToken1 = await token1.totalSupply()
		expect(await token0.balanceOf(wallet.address)).to.eq(totalSupplyToken0.sub(500))
		expect(await token1.balanceOf(wallet.address)).to.eq(totalSupplyToken1.sub(2000))
	})

	it('removeLiquidityETH', async () => {
		const WETHPartnerAmount = expandTo18Decimals(1)
		const ETHAmount = expandTo18Decimals(4)
		await WETHPartner.transfer(WETHPair.address, WETHPartnerAmount)
		await WETH.deposit({value: ETHAmount})
		await WETH.transfer(WETHPair.address, ETHAmount)
		await WETHPair.mint(wallet.address, overrides)

		const expectedLiquidity = expandTo18Decimals(2)
		const WETHPairToken0 = await WETHPair.token0()
		await WETHPair.approve(router.address, MaxUint256)
		await expect(
			router.removeLiquidityETH(
				WETHPair.address,
				WETHPartner.address,
				expectedLiquidity.sub(MINIMUM_LIQUIDITY),
				0,
				0,
				wallet.address,
				MaxUint256,
				overrides
			)
		)
			.to.emit(WETHPair, 'Transfer')
			.withArgs(wallet.address, WETHPair.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
			.to.emit(WETHPair, 'Transfer')
			.withArgs(WETHPair.address, AddressZero, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
			.to.emit(WETH, 'Transfer')
			.withArgs(WETHPair.address, router.address, ETHAmount.sub(2000))
			.to.emit(WETHPartner, 'Transfer')
			.withArgs(WETHPair.address, router.address, WETHPartnerAmount.sub(500))
			.to.emit(WETHPartner, 'Transfer')
			.withArgs(router.address, wallet.address, WETHPartnerAmount.sub(500))
			.to.emit(WETHPair, 'Sync')
			.withArgs(
				WETHPairToken0 === WETHPartner.address ? 500 : 2000,
				WETHPairToken0 === WETHPartner.address ? 2000 : 500
			)
			.to.emit(WETHPair, 'Burn')
			.withArgs(
				router.address,
				WETHPairToken0 === WETHPartner.address ? WETHPartnerAmount.sub(500) : ETHAmount.sub(2000),
				WETHPairToken0 === WETHPartner.address ? ETHAmount.sub(2000) : WETHPartnerAmount.sub(500),
				router.address
			)

		expect(await WETHPair.balanceOf(wallet.address)).to.eq(0)
		const totalSupplyWETHPartner = await WETHPartner.totalSupply()
		const totalSupplyWETH = await WETH.totalSupply()
		expect(await WETHPartner.balanceOf(wallet.address)).to.eq(totalSupplyWETHPartner.sub(500))
		expect(await WETH.balanceOf(wallet.address)).to.eq(totalSupplyWETH.sub(2000))
	})

	it('removeLiquidityWithPermit', async () => {
		const token0Amount = expandTo18Decimals(1)
		const token1Amount = expandTo18Decimals(4)
		await addLiquidity(token0Amount, token1Amount)

		const expectedLiquidity = expandTo18Decimals(2)

		const nonce = await pair.nonces(wallet.address)
		const digest = await getApprovalDigest(
			pair,
			{owner: wallet.address, spender: router.address, value: expectedLiquidity.sub(MINIMUM_LIQUIDITY)},
			nonce,
			MaxUint256
		)

		const {v, r, s} = ecsign(Buffer.from(digest.slice(2), 'hex'), Buffer.from(deployWallet.privateKey.slice(2), 'hex'))

		await router.removeLiquidityWithPermit(
			pair.address,
			token0.address,
			token1.address,
			expectedLiquidity.sub(MINIMUM_LIQUIDITY),
			0,
			0,
			wallet.address,
			MaxUint256,
			false,
			v,
			r,
			s,
			overrides
		)
	})

	it('removeLiquidityETHWithPermit', async () => {
		const WETHPartnerAmount = expandTo18Decimals(1)
		const ETHAmount = expandTo18Decimals(4)
		await WETHPartner.transfer(WETHPair.address, WETHPartnerAmount)
		await WETH.deposit({value: ETHAmount})
		await WETH.transfer(WETHPair.address, ETHAmount)
		await WETHPair.mint(wallet.address, overrides)

		const expectedLiquidity = expandTo18Decimals(2)

		const nonce = await WETHPair.nonces(wallet.address)
		const digest = await getApprovalDigest(
			WETHPair,
			{owner: wallet.address, spender: router.address, value: expectedLiquidity.sub(MINIMUM_LIQUIDITY)},
			nonce,
			MaxUint256
		)

		const {v, r, s} = ecsign(Buffer.from(digest.slice(2), 'hex'), Buffer.from(deployWallet.privateKey.slice(2), 'hex'))

		await router.removeLiquidityETHWithPermit(
			WETHPair.address,
			WETHPartner.address,
			expectedLiquidity.sub(MINIMUM_LIQUIDITY),
			0,
			0,
			wallet.address,
			MaxUint256,
			false,
			v,
			r,
			s,
			overrides
		)
	})

	describe('swapExactTokensForTokens', () => {
		const token0Amount = expandTo18Decimals(5)
		const token1Amount = expandTo18Decimals(10)
		const swapAmount = expandTo18Decimals(1)
		const expectedOutputAmount = BigNumber.from('1662497915624478906')

		beforeEach(async () => {
			await addLiquidity(token0Amount, token1Amount)
			await token0.approve(router.address, MaxUint256)
		})

		it('happy path', async () => {
			await expect(
				router.swapExactTokensForTokens(
					token0.address, token1.address,
					swapAmount,
					0,
					[pair.address],
					wallet.address,
					MaxUint256,
					overrides
				)
			)
				.to.emit(token0, 'Transfer')
				.withArgs(wallet.address, pair.address, swapAmount)
				.to.emit(token1, 'Transfer')
				.withArgs(pair.address, wallet.address, expectedOutputAmount)
				.to.emit(pair, 'Sync')
				.withArgs(token0Amount.add(swapAmount), token1Amount.sub(expectedOutputAmount))
				.to.emit(pair, 'Swap')
				.withArgs(router.address, swapAmount, 0, 0, expectedOutputAmount, wallet.address)
		})

		it('amounts', async () => {
			await token0.approve(routerEventEmitter.address, MaxUint256)
			await expect(
				routerEventEmitter.swapExactTokensForTokens(
					router.address,
					token0.address, token1.address,
					swapAmount,
					0,
					[pair.address],
					wallet.address,
					MaxUint256,
					overrides
				)
			)
				.to.emit(routerEventEmitter, 'Amounts')
				.withArgs([swapAmount, expectedOutputAmount])
		})

		it('gas', async () => {
			// ensure that setting price{0,1}CumulativeLast for the first time doesn't affect our gas math
			await mineBlock(ethers, (await getLatestBlock(ethers)).timestamp + 1)
			await pair.sync(overrides)

			await token0.approve(router.address, MaxUint256)
			await mineBlock(ethers, (await getLatestBlock(ethers)).timestamp + 1)
			const tx = await router.swapExactTokensForTokens(
				token0.address, token1.address,
				swapAmount,
				0,
				[pair.address],
				wallet.address,
				MaxUint256,
				overrides
			)
			const receipt = await tx.wait()
			expect(receipt.gasUsed).to.eq(119512)
		})
	})

	describe('swapTokensForExactTokens', () => {
		const token0Amount = expandTo18Decimals(5)
		const token1Amount = expandTo18Decimals(10)
		const expectedSwapAmount = BigNumber.from('557227237267357629')
		const outputAmount = expandTo18Decimals(1)

		beforeEach(async () => {
			await addLiquidity(token0Amount, token1Amount)
		})

		it('happy path', async () => {
			await token0.approve(router.address, MaxUint256)
			await expect(
				router.swapTokensForExactTokens(
					token0.address, token1.address,
					outputAmount,
					MaxUint256,
					[pair.address],
					wallet.address,
					MaxUint256,
					overrides
				)
			)
				.to.emit(token0, 'Transfer')
				.withArgs(wallet.address, pair.address, expectedSwapAmount)
				.to.emit(token1, 'Transfer')
				.withArgs(pair.address, wallet.address, outputAmount)
				.to.emit(pair, 'Sync')
				.withArgs(token0Amount.add(expectedSwapAmount), token1Amount.sub(outputAmount))
				.to.emit(pair, 'Swap')
				.withArgs(router.address, expectedSwapAmount, 0, 0, outputAmount, wallet.address)
		})

		it('amounts', async () => {
			await token0.approve(routerEventEmitter.address, MaxUint256)
			await expect(
				routerEventEmitter.swapTokensForExactTokens(
					router.address,
					token0.address, token1.address,
					outputAmount,
					MaxUint256,
					[pair.address],
					wallet.address,
					MaxUint256,
					overrides
				)
			)
				.to.emit(routerEventEmitter, 'Amounts')
				.withArgs([expectedSwapAmount, outputAmount])
		})

		it('gas', async () => {
			// ensure that setting price{0,1}CumulativeLast for the first time doesn't affect our gas math
			await mineBlock(ethers, (await getLatestBlock(ethers)).timestamp + 1)
			await pair.sync(overrides)

			await token0.approve(router.address, MaxUint256)
			await mineBlock(ethers, (await getLatestBlock(ethers)).timestamp + 1)
			const tx = await router.swapTokensForExactTokens(
				token0.address, token1.address,
				outputAmount,
				MaxUint256,
				[pair.address],
				wallet.address,
				MaxUint256,
				overrides
			)
			const receipt = await tx.wait()
			expect(receipt.gasUsed).to.eq(119235)
		})
	})

	describe('swapExactETHForTokens', () => {
		const WETHPartnerAmount = expandTo18Decimals(10)
		const ETHAmount = expandTo18Decimals(5)
		const swapAmount = expandTo18Decimals(1)
		const expectedOutputAmount = BigNumber.from('1662497915624478906')

		beforeEach(async () => {
			await WETHPartner.transfer(WETHPair.address, WETHPartnerAmount)
			await WETH.deposit({value: ETHAmount})
			await WETH.transfer(WETHPair.address, ETHAmount)
			await WETHPair.mint(wallet.address, overrides)

			await token0.approve(router.address, MaxUint256)
		})

		it('happy path', async () => {
			const WETHPairToken0 = await WETHPair.token0()
			await expect(
				router.swapExactETHForTokens(WETHPartner.address, 0, [WETHPair.address], wallet.address, MaxUint256, {
					...overrides,
					value: swapAmount
				})
			)
				.to.emit(WETH, 'Transfer')
				.withArgs(router.address, WETHPair.address, swapAmount)
				.to.emit(WETHPartner, 'Transfer')
				.withArgs(WETHPair.address, wallet.address, expectedOutputAmount)
				.to.emit(WETHPair, 'Sync')
				.withArgs(
					WETHPairToken0 === WETHPartner.address
						? WETHPartnerAmount.sub(expectedOutputAmount)
						: ETHAmount.add(swapAmount),
					WETHPairToken0 === WETHPartner.address
						? ETHAmount.add(swapAmount)
						: WETHPartnerAmount.sub(expectedOutputAmount)
				)
				.to.emit(WETHPair, 'Swap')
				.withArgs(
					router.address,
					WETHPairToken0 === WETHPartner.address ? 0 : swapAmount,
					WETHPairToken0 === WETHPartner.address ? swapAmount : 0,
					WETHPairToken0 === WETHPartner.address ? expectedOutputAmount : 0,
					WETHPairToken0 === WETHPartner.address ? 0 : expectedOutputAmount,
					wallet.address
				)
		})

		it('amounts', async () => {
			await expect(
				routerEventEmitter.swapExactETHForTokens(
					router.address,
					WETHPartner.address,
					0,
					[WETHPair.address],
					wallet.address,
					MaxUint256,
					{
						...overrides,
						value: swapAmount
					}
				)
			)
				.to.emit(routerEventEmitter, 'Amounts')
				.withArgs([swapAmount, expectedOutputAmount])
		})

		it('gas', async () => {
			const WETHPartnerAmount = expandTo18Decimals(10)
			const ETHAmount = expandTo18Decimals(5)
			await WETHPartner.transfer(WETHPair.address, WETHPartnerAmount)
			await WETH.deposit({value: ETHAmount})
			await WETH.transfer(WETHPair.address, ETHAmount)
			await WETHPair.mint(wallet.address, overrides)

			// ensure that setting price{0,1}CumulativeLast for the first time doesn't affect our gas math
			await mineBlock(ethers, (await getLatestBlock(ethers)).timestamp + 1)
			await pair.sync(overrides)

			const swapAmount = expandTo18Decimals(1)
			await mineBlock(ethers, (await getLatestBlock(ethers)).timestamp + 1)
			const tx = await router.swapExactETHForTokens(
				WETHPartner.address,
				0,
				[WETHPair.address],
				wallet.address,
				MaxUint256,
				{
					...overrides,
					value: swapAmount
				}
			)
			const receipt = await tx.wait()
			expect(receipt.gasUsed).to.eq(122293)
		})
	})

	describe('swapTokensForExactETH', () => {
		const WETHPartnerAmount = expandTo18Decimals(5)
		const ETHAmount = expandTo18Decimals(10)
		const expectedSwapAmount = BigNumber.from('557227237267357629')
		const outputAmount = expandTo18Decimals(1)

		beforeEach(async () => {
			await WETHPartner.transfer(WETHPair.address, WETHPartnerAmount)
			await WETH.deposit({value: ETHAmount})
			await WETH.transfer(WETHPair.address, ETHAmount)
			await WETHPair.mint(wallet.address, overrides)
		})

		it('happy path', async () => {
			await WETHPartner.approve(router.address, MaxUint256)
			const WETHPairToken0 = await WETHPair.token0()
			await expect(
				router.swapTokensForExactETH(
					WETHPartner.address,
					outputAmount,
					MaxUint256,
					[WETHPair.address],
					wallet.address,
					MaxUint256,
					overrides
				)
			)
				.to.emit(WETHPartner, 'Transfer')
				.withArgs(wallet.address, WETHPair.address, expectedSwapAmount)
				.to.emit(WETH, 'Transfer')
				.withArgs(WETHPair.address, router.address, outputAmount)
				.to.emit(WETHPair, 'Sync')
				.withArgs(
					WETHPairToken0 === WETHPartner.address
						? WETHPartnerAmount.add(expectedSwapAmount)
						: ETHAmount.sub(outputAmount),
					WETHPairToken0 === WETHPartner.address
						? ETHAmount.sub(outputAmount)
						: WETHPartnerAmount.add(expectedSwapAmount)
				)
				.to.emit(WETHPair, 'Swap')
				.withArgs(
					router.address,
					WETHPairToken0 === WETHPartner.address ? expectedSwapAmount : 0,
					WETHPairToken0 === WETHPartner.address ? 0 : expectedSwapAmount,
					WETHPairToken0 === WETHPartner.address ? 0 : outputAmount,
					WETHPairToken0 === WETHPartner.address ? outputAmount : 0,
					router.address
				)
		})

		it('amounts', async () => {
			await WETHPartner.approve(routerEventEmitter.address, MaxUint256)
			await expect(
				routerEventEmitter.swapTokensForExactETH(
					router.address,
					WETHPartner.address,
					outputAmount,
					MaxUint256,
					[WETHPair.address],
					wallet.address,
					MaxUint256,
					overrides
				)
			)
				.to.emit(routerEventEmitter, 'Amounts')
				.withArgs([expectedSwapAmount, outputAmount])
		})
	})

	describe('swapExactTokensForETH', () => {
		const WETHPartnerAmount = expandTo18Decimals(5)
		const ETHAmount = expandTo18Decimals(10)
		const swapAmount = expandTo18Decimals(1)
		const expectedOutputAmount = BigNumber.from('1662497915624478906')

		beforeEach(async () => {
			await WETHPartner.transfer(WETHPair.address, WETHPartnerAmount)
			await WETH.deposit({value: ETHAmount})
			await WETH.transfer(WETHPair.address, ETHAmount)
			await WETHPair.mint(wallet.address, overrides)
		})

		it('happy path', async () => {
			await WETHPartner.approve(router.address, MaxUint256)
			const WETHPairToken0 = await WETHPair.token0()
			await expect(
				router.swapExactTokensForETH(
					WETHPartner.address,
					swapAmount,
					0,
					[WETHPair.address],
					wallet.address,
					MaxUint256,
					overrides
				)
			)
				.to.emit(WETHPartner, 'Transfer')
				.withArgs(wallet.address, WETHPair.address, swapAmount)
				.to.emit(WETH, 'Transfer')
				.withArgs(WETHPair.address, router.address, expectedOutputAmount)
				.to.emit(WETHPair, 'Sync')
				.withArgs(
					WETHPairToken0 === WETHPartner.address
						? WETHPartnerAmount.add(swapAmount)
						: ETHAmount.sub(expectedOutputAmount),
					WETHPairToken0 === WETHPartner.address
						? ETHAmount.sub(expectedOutputAmount)
						: WETHPartnerAmount.add(swapAmount)
				)
				.to.emit(WETHPair, 'Swap')
				.withArgs(
					router.address,
					WETHPairToken0 === WETHPartner.address ? swapAmount : 0,
					WETHPairToken0 === WETHPartner.address ? 0 : swapAmount,
					WETHPairToken0 === WETHPartner.address ? 0 : expectedOutputAmount,
					WETHPairToken0 === WETHPartner.address ? expectedOutputAmount : 0,
					router.address
				)
		})

		it('amounts', async () => {
			await WETHPartner.approve(routerEventEmitter.address, MaxUint256)
			await expect(
				routerEventEmitter.swapExactTokensForETH(
					router.address,
					WETHPartner.address,
					swapAmount,
					0,
					[WETHPair.address],
					wallet.address,
					MaxUint256,
					overrides
				)
			)
				.to.emit(routerEventEmitter, 'Amounts')
				.withArgs([swapAmount, expectedOutputAmount])
		})
	})

	describe('swapETHForExactTokens', () => {
		const WETHPartnerAmount = expandTo18Decimals(10)
		const ETHAmount = expandTo18Decimals(5)
		const expectedSwapAmount = BigNumber.from('557227237267357629')
		const outputAmount = expandTo18Decimals(1)

		beforeEach(async () => {
			await WETHPartner.transfer(WETHPair.address, WETHPartnerAmount)
			await WETH.deposit({value: ETHAmount})
			await WETH.transfer(WETHPair.address, ETHAmount)
			await WETHPair.mint(wallet.address, overrides)
		})

		it('happy path', async () => {
			const WETHPairToken0 = await WETHPair.token0()
			await expect(
				router.swapETHForExactTokens(
					WETHPartner.address,
					outputAmount,
					[WETHPair.address],
					wallet.address,
					MaxUint256,
					{
						...overrides,
						value: expectedSwapAmount
					}
				)
			)
				.to.emit(WETH, 'Transfer')
				.withArgs(router.address, WETHPair.address, expectedSwapAmount)
				.to.emit(WETHPartner, 'Transfer')
				.withArgs(WETHPair.address, wallet.address, outputAmount)
				.to.emit(WETHPair, 'Sync')
				.withArgs(
					WETHPairToken0 === WETHPartner.address
						? WETHPartnerAmount.sub(outputAmount)
						: ETHAmount.add(expectedSwapAmount),
					WETHPairToken0 === WETHPartner.address
						? ETHAmount.add(expectedSwapAmount)
						: WETHPartnerAmount.sub(outputAmount)
				)
				.to.emit(WETHPair, 'Swap')
				.withArgs(
					router.address,
					WETHPairToken0 === WETHPartner.address ? 0 : expectedSwapAmount,
					WETHPairToken0 === WETHPartner.address ? expectedSwapAmount : 0,
					WETHPairToken0 === WETHPartner.address ? outputAmount : 0,
					WETHPairToken0 === WETHPartner.address ? 0 : outputAmount,
					wallet.address
				)
		})

		it('amounts', async () => {
			await expect(
				routerEventEmitter.swapETHForExactTokens(
					router.address,
					WETHPartner.address,
					outputAmount,
					[WETHPair.address],
					wallet.address,
					MaxUint256,
					{
						...overrides,
						value: expectedSwapAmount
					}
				)
			)
				.to.emit(routerEventEmitter, 'Amounts')
				.withArgs([expectedSwapAmount, outputAmount])
		})
	})
})

describe('fee-on-transfer tokens', () => {


	let DTT: Contract
	let WETH: Contract
	let router: FireBirdRouter
	let pair: Contract

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

		WETH = fixture.WETH
		router = fixture.router

		DTT = await new DeflatingErc20Factory(wallet).deploy(toWei(10000));

		// make a DTT<>WETH pair
		await fixture.factoryV2.createPair(DTT.address, WETH.address, 50, 30)
		const pairAddress = await fixture.factoryV2.getPair(DTT.address, WETH.address, 50, 30)
		pair = FireBirdPairFactory.connect(pairAddress, wallet)
	})

	afterEach(async function () {
		expect(await ethers.provider.getBalance(router.address)).to.eq(0)
	})

	async function addLiquidity(DTTAmount: BigNumber, WETHAmount: BigNumber) {
		await DTT.approve(router.address, MaxUint256)
		await router.addLiquidityETH(pair.address, DTT.address, DTTAmount, DTTAmount, WETHAmount, wallet.address, MaxUint256, {
			...overrides,
			value: WETHAmount
		})
	}

	it('removeLiquidityETHSupportingFeeOnTransferTokens', async () => {
		const DTTAmount = expandTo18Decimals(1)
		const ETHAmount = expandTo18Decimals(4)
		await addLiquidity(DTTAmount, ETHAmount)

		const DTTInPair = await DTT.balanceOf(pair.address)
		const WETHInPair = await WETH.balanceOf(pair.address)
		const liquidity = await pair.balanceOf(wallet.address)
		const totalSupply = await pair.totalSupply()
		const NaiveDTTExpected = DTTInPair.mul(liquidity).div(totalSupply)
		const WETHExpected = WETHInPair.mul(liquidity).div(totalSupply)

		await pair.approve(router.address, MaxUint256)
		await router.removeLiquidityETHSupportingFeeOnTransferTokens(
			pair.address,
			DTT.address,
			liquidity,
			NaiveDTTExpected,
			WETHExpected,
			wallet.address,
			MaxUint256,
			overrides
		)
	})

	it('removeLiquidityETHWithPermitSupportingFeeOnTransferTokens', async () => {
		const DTTAmount = expandTo18Decimals(1)
			.mul(100)
			.div(99)
		const ETHAmount = expandTo18Decimals(4)
		await addLiquidity(DTTAmount, ETHAmount)

		const expectedLiquidity = expandTo18Decimals(2)

		const nonce = await pair.nonces(wallet.address)
		const digest = await getApprovalDigest(
			pair,
			{owner: wallet.address, spender: router.address, value: expectedLiquidity.sub(MINIMUM_LIQUIDITY)},
			nonce,
			MaxUint256
		)
		const {v, r, s} = ecsign(Buffer.from(digest.slice(2), 'hex'), Buffer.from(deployWallet.privateKey.slice(2), 'hex'))

		const DTTInPair = await DTT.balanceOf(pair.address)
		const WETHInPair = await WETH.balanceOf(pair.address)
		const liquidity = await pair.balanceOf(wallet.address)
		const totalSupply = await pair.totalSupply()
		const NaiveDTTExpected = DTTInPair.mul(liquidity).div(totalSupply)
		const WETHExpected = WETHInPair.mul(liquidity).div(totalSupply)

		await pair.approve(router.address, MaxUint256)
		await router.removeLiquidityETHWithPermitSupportingFeeOnTransferTokens(
			pair.address,
			DTT.address,
			liquidity,
			NaiveDTTExpected,
			WETHExpected,
			wallet.address,
			MaxUint256,
			false,
			v,
			r,
			s,
			overrides
		)
	})

	describe('swapExactTokensForTokensSupportingFeeOnTransferTokens', () => {
		const DTTAmount = expandTo18Decimals(5)
			.mul(100)
			.div(99)
		const ETHAmount = expandTo18Decimals(10)
		const amountIn = expandTo18Decimals(1)

		beforeEach(async () => {
			await addLiquidity(DTTAmount, ETHAmount)
		})

		it('DTT -> WETH', async () => {
			await DTT.approve(router.address, MaxUint256)

			await router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
				DTT.address, WETH.address,
				amountIn,
				0,
				[pair.address],
				wallet.address,
				MaxUint256,
				overrides
			)
		})

		// WETH -> DTT
		it('WETH -> DTT', async () => {
			await WETH.deposit({value: amountIn}) // mint WETH
			await WETH.approve(router.address, MaxUint256)

			await router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
				WETH.address, DTT.address,
				amountIn,
				0,
				[pair.address],
				wallet.address,
				MaxUint256,
				overrides
			)
		})
	})

	// ETH -> DTT
	it('swapExactETHForTokensSupportingFeeOnTransferTokens', async () => {
		const DTTAmount = expandTo18Decimals(10)
			.mul(100)
			.div(99)
		const ETHAmount = expandTo18Decimals(5)
		const swapAmount = expandTo18Decimals(1)
		await addLiquidity(DTTAmount, ETHAmount)

		await router.swapExactETHForTokensSupportingFeeOnTransferTokens(
			DTT.address,
			0,
			[pair.address],
			wallet.address,
			MaxUint256,
			{
				...overrides,
				value: swapAmount
			}
		)
	})

	// DTT -> ETH
	it('swapExactTokensForETHSupportingFeeOnTransferTokens', async () => {
		const DTTAmount = expandTo18Decimals(5)
			.mul(100)
			.div(99)
		const ETHAmount = expandTo18Decimals(10)
		const swapAmount = expandTo18Decimals(1)

		await addLiquidity(DTTAmount, ETHAmount)
		await DTT.approve(router.address, MaxUint256)

		await router.swapExactTokensForETHSupportingFeeOnTransferTokens(
			DTT.address,
			swapAmount,
			0,
			[pair.address],
			wallet.address,
			MaxUint256,
			overrides
		)
	})
})

describe('fee-on-transfer tokens: reloaded', () => {


	let DTT: Contract
	let DTT2: Contract
	let router: Contract
	let signers: SignerWithAddress[];

	let wallet: SignerWithAddress;
	let other: SignerWithAddress;
	let pairAddress: string;
	let deployWallet: any;
	beforeEach(async function () {
		deployWallet = await ethers.Wallet.fromMnemonic(((network.config.accounts) as any).mnemonic);

		signers = await ethers.getSigners();
		wallet = signers[0];
		other = signers[1];
		const fixture = await v2Fixture(wallet, true)

		router = fixture.router

		DTT = await new DeflatingErc20Factory(wallet).deploy(toWei(10000));
		DTT2 = await new DeflatingErc20Factory(wallet).deploy(toWei(10000));

		// make a DTT<>WETH pair
		await fixture.factoryV2.createPair(DTT.address, DTT2.address, 50, 30)
		pairAddress = await fixture.factoryV2.getPair(DTT.address, DTT2.address, 50, 30)
	})

	afterEach(async function () {
		expect(await ethers.provider.getBalance(router.address)).to.eq(0)
	})

	async function addLiquidity(DTTAmount: BigNumber, DTT2Amount: BigNumber) {
		await DTT.approve(router.address, MaxUint256)
		await DTT2.approve(router.address, MaxUint256)
		await router.addLiquidity(
			pairAddress,
			DTT.address,
			DTT2.address,
			DTTAmount,
			DTT2Amount,
			DTTAmount,
			DTT2Amount,
			wallet.address,
			MaxUint256,
			overrides
		)
	}

	describe('swapExactTokensForTokensSupportingFeeOnTransferTokens', () => {
		const DTTAmount = expandTo18Decimals(5)
			.mul(100)
			.div(99)
		const DTT2Amount = expandTo18Decimals(5)
		const amountIn = expandTo18Decimals(1)

		beforeEach(async () => {
			await addLiquidity(DTTAmount, DTT2Amount)
		})

		it('DTT -> DTT2', async () => {
			await DTT.approve(router.address, MaxUint256)

			await router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
				DTT.address, DTT2.address,
				amountIn,
				0,
				[pairAddress],
				wallet.address,
				MaxUint256,
				overrides
			)
		})
	})
})