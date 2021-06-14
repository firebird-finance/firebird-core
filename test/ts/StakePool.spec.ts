import {expect} from "./chai-setup";
import {ethers, network} from "hardhat";
import {stakePoolFixture} from './shared/fixtures'
import {SignerWithAddress} from "hardhat-deploy-ethers/dist/src/signer-with-address";
import {
	ADDRESS_ZERO,
	getLatestBlock,
	getLatestBlockNumber, getLatestBlockTime,
	maxUint256,
	mineBlocks, mineBlockTimeStamp,
	toWei
} from "./shared/utilities";
import {
	StakePoolController,
	StakePool,
	StakePoolFactory,
	StakePoolCreator,
	StakePoolRewardFundFactory,
	TimeLockFactory,
	StakePoolRewardFund,
	TimeLock,
	StakePoolRewardRebaserMockFactory,
	StakePoolRewardMultiplierMockFactory, TTokenFactory, TToken,
} from "../../typechain";
import {ParamType} from "@ethersproject/abi/src.ts/fragments";
import {encodePoolInfo} from "./StakePoolController.spec";

function encodeParameters(types: Array<string | ParamType>, values: Array<any>) {
	const abi = new ethers.utils.AbiCoder();
	return abi.encode(types, values);
}

const overrides = {};
describe('StakePool', () => {
	let signers: SignerWithAddress[];
	let wallet: SignerWithAddress;
	let other: SignerWithAddress;
	let stakePoolCreator: StakePoolCreator
	let stakePoolController: StakePoolController
	let version: any;
	let rewardToken1: TToken;
	let rewardToken2: TToken;
	let pair: TToken;
	let stakePool: StakePool;
	let rewardFund: StakePoolRewardFund;
	let timelock: TimeLock;
	let deployWallet: any;

	async function init(rewardRebaser: string = ADDRESS_ZERO, rewardMultiplier = ADDRESS_ZERO) {
		deployWallet = await ethers.Wallet.fromMnemonic((network.config.accounts as any).mnemonic);
		signers = await ethers.getSigners();
		wallet = signers[0];
		other = signers[1];
		const fixture = await stakePoolFixture(wallet)

		stakePoolController = fixture.stakePoolController;
		stakePoolCreator = fixture.stakePoolCreator;
		version = await stakePoolCreator.version();

		rewardToken1 = await new TTokenFactory(wallet).deploy("TEST1", "TEST1", toWei(10000));
		rewardToken2 = await new TTokenFactory(wallet).deploy("TEST2", "TEST2", toWei(10000));
		pair = fixture.stakeToken;
		await stakePoolController.addStakePoolCreator(stakePoolCreator.address);
		let latestBlockTime = await getLatestBlockTime(ethers);
		await rewardToken1.approve(stakePoolController.address, maxUint256);
		await rewardToken2.approve(stakePoolController.address, maxUint256);
		if (rewardRebaser != ADDRESS_ZERO) {
			await stakePoolController.setWhitelistRewardRebaser(rewardRebaser, true);
		}
		if (rewardMultiplier != ADDRESS_ZERO) {
			await stakePoolController.setWhitelistRewardMultiplier(rewardMultiplier, true);
		}
		let poolRewardInfo = encodePoolInfo({
			rewardRebaser: rewardRebaser,
			rewardMultiplier: rewardMultiplier,
			startTime: latestBlockTime + 1,
			endRewardTime: latestBlockTime + 3600 * 24 * 20,
			rewardPerSecond: toWei(0.1),
			lockRewardPercent: 0,
			startVestingTime: 0,
			endVestingTime: 0,
			unstakingFrozenTime: 0,
		});

		await stakePoolController.connect(wallet).create(version, pair.address, rewardToken1.address, toWei(100), 3600 * 24, poolRewardInfo);
		const stakePoolAddress = await stakePoolController.allStakePools(0);
		stakePool = StakePoolFactory.connect(stakePoolAddress, wallet);
		rewardFund = StakePoolRewardFundFactory.connect(await stakePool.rewardFund(), wallet);
		timelock = TimeLockFactory.connect(await stakePool.timelock(), wallet);
	}


	describe('Base function StakePool', () => {
		beforeEach(async () => {
			await init();
		})
		it('valid parameters', async () => {
			expect(await stakePool.rewardPoolInfoLength()).to.eq(1)
			expect(await rewardFund.timelock()).to.eq(timelock.address)
			expect(await rewardFund.stakePool()).to.eq(stakePool.address)
			expect(await rewardToken1.balanceOf(rewardFund.address)).to.eq(toWei(100))
			expect(await timelock.admin()).to.eq(wallet.address)
			expect(await timelock.delay()).to.eq(3600 * 24)
		})
		it('stake', async () => {
			await expect(stakePool.stake(toWei(1))).revertedWith("TransferHelper: TRANSFER_FROM_FAILED")
			await pair.approve(stakePool.address, toWei(1))
			await expect(stakePool.stake(toWei(1)))
				.to.emit(stakePool, "Deposit").withArgs(wallet.address, toWei("1"))
			expect((await stakePool.userInfo(wallet.address)).amount).to.eq(toWei("1"));
		})

		it('stakeFor', async () => {
			await pair.transfer(stakePool.address, toWei(1))
			await expect(stakePool.stakeFor(other.address)).revertedWith("StakePool: Invalid sender")
			await pair.approve(stakePool.address, toWei(1))
			await stakePoolController.setWhitelistStakingFor(wallet.address, true);
			await expect(stakePool.stakeFor(other.address))
				.to.emit(stakePool, "Deposit").withArgs(other.address, toWei("1"))
			expect((await stakePool.userInfo(other.address)).amount).to.eq(toWei("1"));
		})

		it('pendingReward', async () => {
			await pair.approve(stakePool.address, toWei(1))
			await stakePool.stake(toWei(1))
			await mineBlocks(ethers, 1);
			expect(await stakePool.pendingReward(0, wallet.address)).to.eq(toWei(0.1));
			await mineBlocks(ethers, 1);
			expect(await stakePool.pendingReward(0, wallet.address)).to.eq(toWei(0.2));
			await mineBlocks(ethers, 1);
			expect(await stakePool.pendingReward(0, wallet.address)).to.eq(toWei(0.3));
		})
		it('withdraw', async () => {
			await pair.approve(stakePool.address, toWei(1))
			await stakePool.stake(toWei(1))
			await mineBlocks(ethers, 1);
			expect(await stakePool.pendingReward(0, wallet.address)).to.eq(toWei(0.1));
			await expect(stakePool.withdraw(toWei(1)))
				.to.emit(stakePool, "Withdraw").withArgs(wallet.address, toWei(1))
				.to.emit(stakePool, "PayRewardPool").withArgs(0, rewardToken1.address, wallet.address, toWei(0.2), toWei(0.2), toWei(0.2))
				.to.emit(rewardToken1, "Transfer").withArgs(rewardFund.address, wallet.address, toWei(0.2))
		})
		it('emergencyWithdraw', async () => {
			await pair.approve(stakePool.address, toWei(3))
			await stakePool.stake(toWei(3))
			// await expect(stakePool.emergencyWithdraw()).to.revertedWith("StakePool: Not allow emergencyWithdraw")
			// await stakePoolController.setAllowEmergencyWithdrawStakePool(stakePool.address, true)
			await expect(async () => stakePool.emergencyWithdraw())
				.changeTokenBalance(pair, wallet, toWei("3"))
			expect((await stakePool.userInfo(wallet.address)).amount).to.eq(toWei("0"));
		})
		it('failed recoverRewardToken', async () => {
			const eta = (await getLatestBlock(ethers)).timestamp + 3600 * 24 * 2;
			let signature = "recoverRewardToken(address,uint256,address)";
			let data = encodeParameters(['address', 'address', 'uint256'], [rewardToken1.address, wallet.address, 10]);
			await expect(rewardFund.recoverRewardToken(rewardToken1.address, wallet.address, 10)).revertedWith("StakePoolRewardFund: !timelock");

			await timelock.queueTransaction(rewardFund.address, 0, signature, data, eta)
			expect(await stakePool.allowRecoverRewardToken(rewardToken1.address)).to.eq(false)
			await mineBlockTimeStamp(ethers, eta)
			expect(await stakePool.allowRecoverRewardToken(rewardToken1.address)).to.eq(false)
			await expect(timelock.executeTransaction(rewardFund.address, 0, signature, data, eta)).revertedWith("Timelock::executeTransaction: Transaction execution reverted.");
		})
		it('success recoverRewardToken', async () => {
			const eta = (await getLatestBlock(ethers)).timestamp + 3600 * 24 * 24;
			let signature = "recoverRewardToken(address,address,uint256)";
			let data = encodeParameters(['address', 'address', 'uint256'], [rewardToken1.address, wallet.address, 2]);
			await timelock.queueTransaction(rewardFund.address, 0, signature, data, eta)
			await mineBlockTimeStamp(ethers, eta)
			expect(await stakePool.allowRecoverRewardToken(rewardToken1.address)).to.eq(true)
			await expect(timelock.executeTransaction(rewardFund.address, 0, signature, data, eta))
				.to.emit(rewardToken1, "Transfer").withArgs(rewardFund.address, wallet.address, 2);
		})
		it('success recoverAllRewardToken', async () => {
			const eta = (await getLatestBlock(ethers)).timestamp + 3600 * 24 * 24;
			let signature = "recoverAllRewardToken(address,address)";
			let data = encodeParameters(['address', 'address'], [rewardToken1.address, wallet.address]);
			await timelock.queueTransaction(rewardFund.address, 0, signature, data, eta)
			await mineBlockTimeStamp(ethers, eta)
			expect(await stakePool.allowRecoverRewardToken(rewardToken1.address)).to.eq(true)
			await expect(timelock.executeTransaction(rewardFund.address, 0, signature, data, eta))
				.to.emit(rewardToken1, "Transfer").withArgs(rewardFund.address, wallet.address, toWei(100));
		})

		it('updateRewardPool', async () => {
			let rewardPoolInfo = await stakePool.rewardPoolInfo(0);
			const eta = (await getLatestBlock(ethers)).timestamp + 3600 * 24 * 2;
			let signature = "updateRewardPool(uint8,uint256,uint256)";
			let newEndBlocks = rewardPoolInfo.endRewardTime.add(100);
			let data = encodeParameters(['uint8', 'uint256', 'uint256'], [0, newEndBlocks, toWei(0.2)]);
			await timelock.queueTransaction(stakePool.address, 0, signature, data, eta)
			await mineBlockTimeStamp(ethers, eta)
			await timelock.executeTransaction(stakePool.address, 0, signature, data, eta)
			rewardPoolInfo = await stakePool.rewardPoolInfo(0);
			expect(rewardPoolInfo.endRewardTime).to.eq(newEndBlocks)
			expect(rewardPoolInfo.rewardPerSecond).to.eq(toWei(0.2))
		})

		it('stopRewardPool', async () => {
			let rewardPoolInfo = await stakePool.rewardPoolInfo(0);
			const eta = (await getLatestBlock(ethers)).timestamp + 3600 * 24 * 4;
			let signature = "stopRewardPool(uint8)";
			let newEndBlocks = rewardPoolInfo.endRewardTime.add(10);
			let data = encodeParameters(['uint8'], [0]);
			await timelock.queueTransaction(stakePool.address, 0, signature, data, eta)
			await mineBlockTimeStamp(ethers, eta)
			await timelock.executeTransaction(stakePool.address, 0, signature, data, eta)
			rewardPoolInfo = await stakePool.rewardPoolInfo(0);
			const latestBlock = await getLatestBlockTime(ethers)
			expect(rewardPoolInfo.endRewardTime).to.eq(latestBlock)
			expect(rewardPoolInfo.rewardPerSecond).to.eq(0)
		})

	})

	describe('RewardRebaser', () => {
		beforeEach(async () => {
			const rebaser = await new StakePoolRewardRebaserMockFactory(wallet).deploy(toWei("2"))
			await init(rebaser.address);
		})
		it('pendingReward & Withdraw', async () => {
			await pair.approve(stakePool.address, toWei(1))
			await stakePool.stake(toWei(1))
			await mineBlocks(ethers, 1);
			let rewardPoolInfo = await stakePool.rewardPoolInfo(0);
			expect(await stakePool.getRewardRebase(0, rewardPoolInfo.rewardToken, toWei(0.1))).to.eq(toWei(0.2));
			expect(await stakePool["getRewardPerSecond(uint8)"](0)).to.eq(toWei(0.2));
			expect(await stakePool.pendingReward(0, wallet.address)).to.eq(toWei(0.2));
			await mineBlocks(ethers, 1);
			expect(await stakePool.pendingReward(0, wallet.address)).to.eq(toWei(0.4));
			await mineBlocks(ethers, 1);
			expect(await stakePool.pendingReward(0, wallet.address)).to.eq(toWei(0.6));
			await expect(stakePool.withdraw(toWei(1)))
				.to.emit(stakePool, "Withdraw").withArgs(wallet.address, toWei(1))
				.to.emit(stakePool, "PayRewardPool").withArgs(0, rewardToken1.address, wallet.address, toWei(0.4), toWei(0.8), toWei(0.8))
				.to.emit(rewardToken1, "Transfer").withArgs(rewardFund.address, wallet.address, toWei(0.8))
		})
		it('updateRewardRebaser', async () => {
			const eta = (await getLatestBlock(ethers)).timestamp + 3600 * 24 * 4;
			let signature = "updateRewardRebaser(uint8,address)";
			let data = encodeParameters(['uint8', 'address'], [0, ADDRESS_ZERO]);
			await timelock.queueTransaction(stakePool.address, 0, signature, data, eta)
			await mineBlockTimeStamp(ethers, eta - 180)
			await expect(timelock.executeTransaction(stakePool.address, 0, signature, data, eta)).revertedWith("Timelock::executeTransaction: Transaction hasn't surpassed time lock.");
			await mineBlockTimeStamp(ethers, eta)
			await timelock.executeTransaction(stakePool.address, 0, signature, data, eta);
			expect((await stakePool.rewardPoolInfo(0)).rewardRebaser, ADDRESS_ZERO);
			await pair.approve(stakePool.address, toWei(1))
			await stakePool.stake(toWei(1))
			await mineBlocks(ethers, 1);
			let rewardPoolInfo = await stakePool.rewardPoolInfo(0);
			expect(await stakePool.getRewardRebase(0, rewardPoolInfo.rewardToken, toWei(0.1))).to.eq(toWei(0.1));
			expect(await stakePool.pendingReward(0, wallet.address)).to.eq(toWei(0.1));
		});
	});

	describe('RewardMultiplier', () => {
		beforeEach(async () => {
			const rewardMultiplier = await new StakePoolRewardMultiplierMockFactory(wallet).deploy(toWei("2"))
			await init(ADDRESS_ZERO, rewardMultiplier.address);
		})
		it('pendingReward & Withdraw', async () => {
			await pair.approve(stakePool.address, toWei(1))
			await stakePool.stake(toWei(1))
			await mineBlocks(ethers, 1);
			expect(await stakePool.getRewardMultiplier(0, 1, 2, toWei(0.1))).to.eq(toWei(0.2));
			expect(await stakePool["getRewardPerSecond(uint8)"](0)).to.eq(toWei(0.2));
			expect(await stakePool.pendingReward(0, wallet.address)).to.eq(toWei(0.2));
			await mineBlocks(ethers, 1);
			expect(await stakePool.pendingReward(0, wallet.address)).to.eq(toWei(0.4));
			await mineBlocks(ethers, 1);
			expect(await stakePool.pendingReward(0, wallet.address)).to.eq(toWei(0.6));
			await expect(stakePool.withdraw(toWei(1)))
				.to.emit(stakePool, "Withdraw").withArgs(wallet.address, toWei(1))
				.to.emit(stakePool, "PayRewardPool").withArgs(0, rewardToken1.address, wallet.address, toWei(0.8), toWei(0.8), toWei(0.8))
				.to.emit(rewardToken1, "Transfer").withArgs(rewardFund.address, wallet.address, toWei(0.8))
		})
		it('updateRewardMultiplier', async () => {
			const eta = (await getLatestBlock(ethers)).timestamp + 3600 * 24 * 4;
			let signature = "updateRewardMultiplier(uint8,address)";
			let data = encodeParameters(['uint8', 'address'], [0, ADDRESS_ZERO]);
			await timelock.queueTransaction(stakePool.address, 0, signature, data, eta)
			await mineBlockTimeStamp(ethers, eta - 180)
			await expect(timelock.executeTransaction(stakePool.address, 0, signature, data, eta)).revertedWith("Timelock::executeTransaction: Transaction hasn't surpassed time lock.");
			await mineBlockTimeStamp(ethers, eta)
			await timelock.executeTransaction(stakePool.address, 0, signature, data, eta);
			expect((await stakePool.rewardPoolInfo(0)).rewardMultiplier, ADDRESS_ZERO);
			await pair.approve(stakePool.address, toWei(1))
			await stakePool.stake(toWei(1))
			await mineBlocks(ethers, 1);
			expect(await stakePool.getRewardMultiplier(0, 1, 2, toWei(0.1))).to.eq(toWei(0.1));
			expect(await stakePool.pendingReward(0, wallet.address)).to.eq(toWei(0.1));
		});
	});
	describe('AddRewardPool', () => {
		async function addRewardPool() {
			const eta = (await getLatestBlock(ethers)).timestamp + 3600 * 24 * 2;
			let latestBlockTime = eta + 1;

			let signature = "addRewardPool(address,address,address,uint256,uint256,uint256,uint256,uint256,uint256)";
			let data = encodeParameters(['address', 'address', 'address', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256'], [rewardToken2.address, ADDRESS_ZERO, ADDRESS_ZERO, latestBlockTime + 1, latestBlockTime + 3600, toWei(0.2), 0, 0, 0]);
			await timelock.queueTransaction(stakePool.address, 0, signature, data, eta)
			await mineBlockTimeStamp(ethers, eta)
			await timelock.executeTransaction(stakePool.address, 0, signature, data, eta);
		}

		beforeEach(async () => {
			await init();
			await addRewardPool();
		})
		it('pendingReward', async () => {
			await pair.approve(stakePool.address, toWei(1))
			await stakePool.stake(toWei(1))
			await mineBlocks(ethers, 1);
			expect(await stakePool.pendingReward(1, wallet.address)).to.eq(toWei(0.2));
			await mineBlocks(ethers, 1);
			expect(await stakePool.pendingReward(1, wallet.address)).to.eq(toWei(0.4));
			await mineBlocks(ethers, 1);
			expect(await stakePool.pendingReward(1, wallet.address)).to.eq(toWei(0.6));
		})
	});
})
