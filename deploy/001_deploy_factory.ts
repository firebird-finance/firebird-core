import {HardhatRuntimeEnvironment} from "hardhat/types";
import {DeployFunction} from "hardhat-deploy/types";
import {expandDecimals} from "../test/ts/shared/utilities";
import {BigNumber} from "ethers";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
	const {deployments, getNamedAccounts} = hre;
	const {deploy, execute} = deployments;
	const {deployer, governance, uniRouter} = await getNamedAccounts();

	const wethAddress = await getWeth(hre);

	const formula = await deploy("FireBirdFormula", {
		contract: "FireBirdFormula",
		skipIfAlreadyDeployed: true,
		from: deployer,
		args: [],
		log: true,
	});

	const factoty = await deploy("FireBirdFactory", {
		contract: "FireBirdFactory",
		skipIfAlreadyDeployed: true,
		from: deployer,
		args: [deployer, formula.address],
		log: true,
	});

	const protocolFeeRemover = await deploy("ProtocolFeeRemover", {
		contract: "ProtocolFeeRemover",
		skipIfAlreadyDeployed: true,
		from: deployer,
		args: [],
		log: true,
	});


	const router = await deploy("FireBirdRouter", {
		contract: "FireBirdRouter",
		skipIfAlreadyDeployed: true,
		from: deployer,
		args: [factoty.address, wethAddress],
		log: true,
	});
	const zapper = await deploy("FireBirdZap", {
		contract: "FireBirdZap",
		skipIfAlreadyDeployed: true,
		from: deployer,
		args: [uniRouter, router.address],
		log: true,
	});

	if (factoty.newlyDeployed || protocolFeeRemover.newlyDeployed) {
		await execute("FireBirdFactory", {from: deployer, log: true}, "setFeeTo", protocolFeeRemover.address);
	}

	if (factoty.newlyDeployed) {
		await execute("FireBirdFactory", {from: deployer, log: true}, "setProtocolFee", BigNumber.from(20000));
	}
	await execute("FireBirdFactory", {from: deployer, log: true}, "setFeeToSetter", governance);
	await execute("ProtocolFeeRemover", {from: deployer, log: true}, "setReceiver", governance);
	await execute("ProtocolFeeRemover", {from: deployer, log: true}, "setGovernance", governance);
	await execute("FireBirdZap", {from: deployer, log: true}, "setGovernance", governance);


};

export async function getWeth(hre: HardhatRuntimeEnvironment) {
	const {deployments, getNamedAccounts} = hre;
	const {deploy, get, read, execute, getOrNull, log} = deployments;
	let {deployer, weth} = await getNamedAccounts();
	if (!weth) {
		const wethContract = await deploy("WETH", {
			contract: "WETH9",
			from: deployer,
			skipIfAlreadyDeployed: true,
			args: [],
			log: true,
		});

		if ((await read("WETH", "balanceOf", deployer)).eq(BigNumber.from(0))) {
			await execute("WETH", {from: deployer, log: true, value: expandDecimals(800, 18)}, "deposit");
		}
		weth = wethContract.address;
	}
	return weth;
}

export default func;
func.tags = ["factory"];
