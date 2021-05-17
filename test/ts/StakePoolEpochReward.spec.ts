import {expect} from "./chai-setup";
import {ethers, network} from "hardhat";

import {stakePoolFixture} from './shared/fixtures'
import {SignerWithAddress} from "hardhat-deploy-ethers/dist/src/signer-with-address";
import {
	ADDRESS_ZERO,
	getLatestBlock,
	getLatestBlockNumber,
	maxUint256,
	mineBlocks, mineBlockTimeStamp,
	toWei
} from "./shared/utilities";
import {
	StakePoolController,
	StakePoolRewardFundFactory,
	TimeLockFactory,
	StakePoolRewardFund,
	TimeLock,
	EpochControllerMock, EpochControllerMockFactory,
	StakePoolEpochRewardCreator,
	StakePoolEpochReward,
	StakePoolEpochRewardFactory, TToken, TTokenFactory,
} from "../../typechain";
import {ParamType} from "@ethersproject/abi/src.ts/fragments";


function encodeParameters(types: Array<string | ParamType>, values: Array<any>) {
	const abi = new ethers.utils.AbiCoder();
	return abi.encode(types, values);
}

export function encodeEpochPoolInfo(data: any) {
	return encodeParameters(['address', 'uint256', 'uint256'], [
		data.epochController,
		data.withdrawLockupEpochs,
		data.rewardLockupEpochs
	])
}

const overrides = {};
describe('StakePoolEpochReward', () => {
	let signers: SignerWithAddress[];
	let wallet: SignerWithAddress;
	let other: SignerWithAddress;
	let stakePoolCreator: StakePoolEpochRewardCreator
	let stakePoolController: StakePoolController
	let rewardToken1: TToken;
	let rewardToken2: TToken;
	let pair: TToken;
	let version: any;
	let stakePool: StakePoolEpochReward;
	let rewardFund: StakePoolRewardFund;
	let epochController: EpochControllerMock;
	let timelock: TimeLock;
	let deployWallet: any;

	async function init(rewardRebaser: string = ADDRESS_ZERO, rewardMultiplier = ADDRESS_ZERO) {
		deployWallet = await ethers.Wallet.fromMnemonic((network.config.accounts as any).mnemonic);
		signers = await ethers.getSigners();
		wallet = signers[0];
		other = signers[1];
		const fixture = await stakePoolFixture(wallet)
		stakePoolController = fixture.stakePoolController;
		stakePoolCreator = fixture.stakePoolEpochRewardCreator;
		version = await stakePoolCreator.version();
		rewardToken1 = await new TTokenFactory(wallet).deploy("TEST1", "TEST1", toWei(10000));
		rewardToken2 = await new TTokenFactory(wallet).deploy("TEST2", "TEST2", toWei(10000));
		pair = fixture.stakeToken;
		await stakePoolController.addStakePoolCreator(stakePoolCreator.address);
		let latestBlockNumber = await getLatestBlockNumber(ethers);
		await rewardToken1.approve(stakePoolController.address, maxUint256);
		if (rewardRebaser != ADDRESS_ZERO) {
			await stakePoolController.setWhitelistRewardRebaser(rewardRebaser, true);
		}
		if (rewardMultiplier != ADDRESS_ZERO) {
			await stakePoolController.setWhitelistRewardMultiplier(rewardMultiplier, true);
		}
		epochController = await new EpochControllerMockFactory(wallet).deploy(rewardToken1.address);
		await rewardToken1.approve(epochController.address, maxUint256);
		let poolRewardInfo = encodeEpochPoolInfo({
			epochController: epochController.address,
			withdrawLockupEpochs: 0,
			rewardLockupEpochs: 0,

		});
		await stakePoolController.connect(wallet).create(4001, pair.address, rewardToken1.address, 0, 3600 * 48, poolRewardInfo);
		const stakePoolAddress = await stakePoolController.allStakePools(0);
		stakePool = StakePoolEpochRewardFactory.connect(stakePoolAddress, wallet);
		rewardFund = StakePoolRewardFundFactory.connect(await stakePool.rewardFund(), wallet);
		timelock = TimeLockFactory.connect(await stakePool.timelock(), wallet);
	}


	describe('Base function StakePool', () => {
		beforeEach(async () => {
			await init();
		})

		it('valid parameters', async () => {
			expect(await rewardFund.timelock()).to.eq(timelock.address)
			expect(await rewardFund.stakePool()).to.eq(stakePool.address)
			expect(await rewardToken1.balanceOf(rewardFund.address)).to.eq(toWei(0))
			expect(await timelock.admin()).to.eq(wallet.address)
			expect(await timelock.delay()).to.eq(3600 * 48)
		})

		it('stake', async () => {
			await expect(stakePool.stake(toWei(1))).revertedWith("TRANSFER_FROM_FAILED")
			await pair.approve(stakePool.address, toWei(1))
			await expect(stakePool.stake(toWei(1)))
				.to.emit(stakePool, "Deposit").withArgs(wallet.address, toWei("1"))
			expect((await stakePool.userInfo(wallet.address)).amount).to.eq(toWei("1"));
		})

		it('stakeFor', async () => {
			await pair.transfer(stakePool.address, toWei(1))
			await expect(stakePool.stakeFor(other.address)).revertedWith("StakePoolEpochReward: Invalid sender")
			await pair.approve(stakePool.address, toWei(1))
			await stakePoolController.setWhitelistStakingFor(wallet.address, true);
			await expect(stakePool.stakeFor(other.address))
				.to.emit(stakePool, "Deposit").withArgs(other.address, toWei("1"))
			expect((await stakePool.userInfo(other.address)).amount).to.eq(toWei("1"));
		})

		it('withdraw', async () => {
			await pair.approve(stakePool.address, toWei(1))
			await stakePool.stake(toWei(1))
			await mineBlocks(ethers, 1);
			await expect(stakePool.withdraw(toWei(1)))
				.to.emit(stakePool, "Withdraw").withArgs(wallet.address, toWei(1))
		})

		it('emergencyWithdraw', async () => {
			await pair.approve(stakePool.address, toWei(3))
			await stakePool.stake(toWei(3))
			await expect(stakePool.emergencyWithdraw()).to.revertedWith("StakePoolEpochReward: Not allow emergencyWithdraw")
			await stakePoolController.setAllowEmergencyWithdrawStakePool(stakePool.address, true)
			await expect(async () => stakePool.emergencyWithdraw())
				.changeTokenBalance(pair, wallet, toWei("3"))
			expect((await stakePool.userInfo(wallet.address)).amount).to.eq(toWei("0"));
		})
		it('failed recoverRewardToken', async () => {
			const eta = (await getLatestBlock(ethers)).timestamp + 3600 * 24 * 4;
			let signature = "recoverRewardToken(address,uint256,address)";
			let data = encodeParameters(['address', 'address', 'uint256'], [rewardToken1.address, wallet.address, 10]);
			await expect(rewardFund.recoverRewardToken(rewardToken1.address, wallet.address, 10)).revertedWith("StakePoolRewardFund: !timelock");

			await timelock.queueTransaction(rewardFund.address, 0, signature, data, eta)
			expect(await stakePool["allowRecoverRewardToken(address)"](rewardToken1.address)).to.eq(false)
			await mineBlockTimeStamp(ethers, eta)
			expect(await stakePool["allowRecoverRewardToken(address)"](rewardToken1.address)).to.eq(false)

			await expect(timelock.executeTransaction(rewardFund.address, 0, signature, data, eta)).revertedWith("Timelock::executeTransaction: Transaction execution reverted.");

		})

		it('allocateReward', async () => {
			await expect(async () => await epochController.allocateSeigniorage(toWei(100), stakePool.address))
				.changeTokenBalance(rewardToken1, rewardFund, toWei(100));
		})

		it('claimReward', async () => {
			await pair.approve(stakePool.address, toWei(3));
			await stakePool.stake(toWei(3));
			expect(await stakePool.epoch()).to.eq(0);
			await epochController.allocateSeigniorage(toWei(100), stakePool.address);
			await expect(async () => await stakePool.claimReward())
				.changeTokenBalance(rewardToken1, wallet, toWei('99.999999999999999999'));
			expect(await stakePool.epoch()).to.eq(1);
		})
	})
})
