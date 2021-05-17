import {HardhatRuntimeEnvironment} from "hardhat/types";
import {DeployFunction} from "hardhat-deploy/types";
import {expandDecimals} from "../test/ts/shared/utilities";
import {BigNumber} from "ethers";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
	const {deployments, getNamedAccounts} = hre;
	const {deploy, execute} = deployments;
	const {deployer, governance} = await getNamedAccounts();

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

	if (factoty.newlyDeployed || protocolFeeRemover.newlyDeployed) {
		await execute("FireBirdFactory", {from: deployer, log: true}, "setFeeTo", protocolFeeRemover.address);
	}

	if (factoty.newlyDeployed) {
		await execute("FireBirdFactory", {from: deployer, log: true}, "setProtocolFee", BigNumber.from(20000));
	}


	const router = await deploy("FireBirdRouter", {
		contract: "FireBirdRouter",
		skipIfAlreadyDeployed: true,
		from: deployer,
		args: [factoty.address, wethAddress],
		log: true,
	});


	await execute("FireBirdFactory", {from: deployer, log: true}, "setFeeToSetter", governance);
	await execute("ProtocolFeeRemover", {from: deployer, log: true}, "setReceiver", governance);
	await execute("ProtocolFeeRemover", {from: deployer, log: true}, "setGovernance", governance);

	const zapper = await deploy("ValueLiquidZap", {
		contract: "ValueLiquidZap",
		skipIfAlreadyDeployed: true,
		from: deployer,
		args: [],
		log: true,
	});

	if (zapper.newlyDeployed) {
		await execute("ValueLiquidZap", {from: deployer, log: true}, "setVSwapFactory", factoty.address);
		await execute("ValueLiquidZap", {from: deployer, log: true}, "setVSwapRouter", router.address);
		await execute("ValueLiquidZap", {from: deployer, log: true}, "setVSwapFormula", formula.address);
		await execute("ValueLiquidZap", {from: deployer, log: true}, "setWBNB", wethAddress);
	}
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
