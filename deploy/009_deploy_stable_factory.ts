import {HardhatRuntimeEnvironment} from "hardhat/types";
import {DeployFunction} from "hardhat-deploy/types";
import {expandDecimals} from "../test/ts/shared/utilities";
import {getWeth} from "./001_deploy_factory";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
	const {deployments, getNamedAccounts} = hre;
	const {deploy, execute, get, save} = deployments;
	const {deployer, proxyAdmin, governance} = await getNamedAccounts();
	const wethAddress = await getWeth(hre);

	const mathUtils = await deploy("MathUtils", {
		contract: "MathUtils",
		skipIfAlreadyDeployed: true,
		from: deployer,
		args: [],
		log: true,
	});

	const swapUtils = await deploy("SwapUtils", {
		contract: "SwapUtils",
		skipIfAlreadyDeployed: true,
		from: deployer,
		args: [],
		libraries: {
			MathUtils: mathUtils.address,
		},
		log: true,
	});

	const creator = await deploy("SwapCreator", {
		contract: "SwapCreator",
		skipIfAlreadyDeployed: true,
		from: deployer,
		args: [],
		libraries: {
			SwapUtils: swapUtils.address,
		},
		log: true,
	});


	console.log("proxyAdmin", proxyAdmin)


	const factoryImpl = await deploy("StableSwapFactoryImpl", {
		contract: "StableSwapFactory",
		skipIfAlreadyDeployed: true,
		from: deployer,
		args: [],
		log: true,
	});
	const factoryProxy = await deploy("StableSwapFactoryProxy", {
		contract: "AdminUpgradeabilityProxy",
		skipIfAlreadyDeployed: true,
		from: deployer,
		args: [
			factoryImpl.address,
			proxyAdmin,
			"0x",
		],
		log: true,
	})
	if (factoryProxy.newlyDeployed) {
		const stakePoolController = factoryImpl
		stakePoolController.address = factoryProxy.address
		await save("StableSwapFactory", stakePoolController)
		await execute("StableSwapFactory", {
				from: deployer,
				log: true,
			}, "initialize",
			deployer, creator.address
		)
		await execute("StableSwapFactory", {from: deployer, log: true}, "setFeeTo", governance);
		await execute("StableSwapFactory", {from: deployer, log: true}, "setFeeToken", wethAddress);
		await execute("StableSwapFactory", {from: deployer, log: true}, "setFeeAmount", expandDecimals(10, 18));
		await execute("StableSwapFactory", {from: deployer, log: true}, "setFeeToSetter", governance);

	} else if (creator.newlyDeployed) {
		await execute("StableSwapFactory", {from: deployer, log: true}, "setSwapCreator", creator.address);
	}

	await deploy("StableSwapRouter", {
		contract: "StableSwapRouter",
		skipIfAlreadyDeployed: true,
		from: deployer,
		args: [],
		log: true,
	});
};
export default func;
func.tags = ["stable-factory"];
