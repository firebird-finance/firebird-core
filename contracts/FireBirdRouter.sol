pragma solidity >=0.7.6;
pragma abicoder v2;

import './interfaces/IFireBirdFactory.sol';
import './interfaces/IFireBirdFormula.sol';
import './interfaces/IFireBirdPair.sol';
import './libraries/TransferHelper.sol';
import './interfaces/IERC20.sol';
import './interfaces/IFireBirdRouter.sol';
import './libraries/SafeMath.sol';
import './interfaces/IWETH.sol';
import "./interfaces/IAggregationExecutor.sol";
import "./interfaces/ISwapFeeReward.sol";
import "./libraries/Permitable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract FireBirdRouter is IFireBirdRouter, Ownable, Permitable {
    using SafeMath for uint;
    address public immutable override factory;
    address public immutable override formula;
    address public immutable override WETH;
    address public override swapFeeReward;
    address private constant ETH_ADDRESS = address(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE);

    uint256 private constant _PARTIAL_FILL = 0x01;
    uint256 private constant _REQUIRES_EXTRA_ETH = 0x02;
    uint256 private constant _SHOULD_CLAIM = 0x04;
    uint256 private constant _BURN_FROM_MSG_SENDER = 0x08;
    uint256 private constant _BURN_FROM_TX_ORIGIN = 0x10;

    struct SwapDescription {
        IERC20 srcToken;
        IERC20 dstToken;
        address srcReceiver;
        address dstReceiver;
        uint256 amount;
        uint256 minReturnAmount;
        uint256 flags;
        bytes permit;
    }

    event Swapped(
        address sender,
        IERC20 srcToken,
        IERC20 dstToken,
        address dstReceiver,
        uint256 spentAmount,
        uint256 returnAmount
    );

    modifier ensure(uint256 deadline) {
        require(deadline >= block.timestamp, 'Router: EXPIRED');
        _;
    }
    constructor(address _factory, address _formula, address _WETH) public {
        factory = _factory;
        formula = _formula;
        WETH = _WETH;
    }

    receive() external payable {
        assert(msg.sender == WETH);
        // only accept ETH via fallback from the WETH contract
    }

    function setSwapFeeReward(address _swapFeeReward) public onlyOwner {
        swapFeeReward = _swapFeeReward;
    }

    // **** ADD LIQUIDITY ****
    function _addLiquidity(
        address pair,
        address tokenA,
        address tokenB,
        uint amountADesired,
        uint amountBDesired,
        uint amountAMin,
        uint amountBMin
    ) internal virtual returns (uint amountA, uint amountB) {
        (uint reserveA, uint reserveB) = IFireBirdFormula(formula).getReserves(pair, tokenA, tokenB);
        if (reserveA == 0 && reserveB == 0) {
            (amountA, amountB) = (amountADesired, amountBDesired);
        } else {
            uint amountBOptimal = IFireBirdFormula(formula).quote(amountADesired, reserveA, reserveB);
            if (amountBOptimal <= amountBDesired) {
                require(amountBOptimal >= amountBMin, 'Router: INSUFFICIENT_B_AMOUNT');
                (amountA, amountB) = (amountADesired, amountBOptimal);
            } else {
                uint amountAOptimal = IFireBirdFormula(formula).quote(amountBDesired, reserveB, reserveA);
                assert(amountAOptimal <= amountADesired);
                require(amountAOptimal >= amountAMin, 'Router: INSUFFICIENT_A_AMOUNT');
                (amountA, amountB) = (amountAOptimal, amountBDesired);
            }
        }
    }

    function _addLiquidityToken(
        address pair,
        address tokenA,
        address tokenB,
        uint amountADesired,
        uint amountBDesired,
        uint amountAMin,
        uint amountBMin
    ) internal returns (uint amountA, uint amountB) {
        (amountA, amountB) = _addLiquidity(pair, tokenA, tokenB, amountADesired, amountBDesired, amountAMin, amountBMin);
        TransferHelper.safeTransferFrom(tokenA, msg.sender, pair, amountA);
        TransferHelper.safeTransferFrom(tokenB, msg.sender, pair, amountB);
    }
    function createPair( address tokenA, address tokenB,uint amountA,uint amountB, uint32 tokenWeightA, uint32 swapFee, address to) public virtual override returns (uint liquidity) {
        address pair = IFireBirdFactory(factory).createPair(tokenA, tokenB, tokenWeightA, swapFee);
        _addLiquidityToken(pair, tokenA, tokenB, amountA, amountB, 0, 0);
        liquidity = IFireBirdPair(pair).mint(to);
    }
    function addLiquidity(
        address pair,
        address tokenA,
        address tokenB,
        uint amountADesired,
        uint amountBDesired,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) external virtual override ensure(deadline) returns (uint amountA, uint amountB, uint liquidity) {
        (amountA,  amountB) = _addLiquidityToken(pair, tokenA, tokenB, amountADesired, amountBDesired, amountAMin, amountBMin);
        liquidity = IFireBirdPair(pair).mint(to);
    }

    function _addLiquidityETH(
        address pair,
        address token,
        uint amountTokenDesired,
        uint amountTokenMin,
        uint amountETHMin,
        address to
    ) internal returns (uint amountToken, uint amountETH, uint liquidity) {
        (amountToken, amountETH) = _addLiquidity(
            pair,
            token,
            WETH,
            amountTokenDesired,
            msg.value,
            amountTokenMin,
            amountETHMin
        );
        TransferHelper.safeTransferFrom(token, msg.sender, pair, amountToken);
        transferETHTo(amountETH, pair);
        liquidity = IFireBirdPair(pair).mint(to);
        // refund dust eth, if any
        if (msg.value > amountETH) TransferHelper.safeTransferETH(msg.sender, msg.value - amountETH);
    }
    function createPairETH( address token, uint amountToken, uint32 tokenWeight, uint32 swapFee, address to) public virtual override payable returns (uint liquidity) {
        address pair = IFireBirdFactory(factory).createPair(token, WETH, tokenWeight, swapFee);
        (,,liquidity) = _addLiquidityETH(pair, token, amountToken, 0, 0, to);
    }
    function addLiquidityETH(
        address pair,
        address token,
        uint amountTokenDesired,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline
    ) public virtual override payable ensure(deadline) returns (uint amountToken, uint amountETH, uint liquidity) {
        (amountToken, amountETH, liquidity) = _addLiquidityETH(pair, token, amountTokenDesired, amountTokenMin, amountETHMin, to);
    }

    // **** SWAP ****
    // requires the initial amount to have already been sent to the first pair
    function _swap(address tokenIn, uint[] memory amounts, address[] memory path, address _to) internal virtual {
        address input = tokenIn;
        for (uint i = 0; i < path.length; i++) {
            IFireBirdPair pairV2 = IFireBirdPair(path[i]);
            address token0 = pairV2.token0();
            uint amountOut = amounts[i + 1];
            (uint amount0Out, uint amount1Out, address output) = input == token0 ? (uint(0), amountOut, pairV2.token1()) : (amountOut, uint(0), token0);
            if (swapFeeReward != address(0)) {
                ISwapFeeReward(swapFeeReward).swap(msg.sender, input, output, amountOut, path[i]);
            }
            address to = i < path.length - 1 ? path[i + 1] : _to;
            pairV2.swap(
                amount0Out, amount1Out, to, new bytes(0)
            );
            emit Exchange(address(pairV2), amountOut, output);
            input = output;
        }
    }

    function swapExactTokensForTokens(
        address tokenIn,
        address tokenOut,
        uint amountIn,
        uint amountOutMin,
        address[] memory path,
        uint8[] memory dexIds,
        address to,
        uint deadline
    ) public virtual override ensure(deadline) returns (uint[] memory amounts) {
        amounts = _validateAmountOut(tokenIn, tokenOut, amountIn, amountOutMin, path, dexIds);

        TransferHelper.safeTransferFrom(
            tokenIn, msg.sender, path[0], amounts[0]
        );
        _swap(tokenIn, amounts, path, to);
    }

    function swapTokensForExactTokens(
        address tokenIn,
        address tokenOut,
        uint amountOut,
        uint amountInMax,
        address[] calldata path,
        uint8[] calldata dexIds,
        address to,
        uint deadline
    ) external virtual override ensure(deadline) returns (uint[] memory amounts) {
        amounts = _validateAmountIn(tokenIn, tokenOut, amountOut, amountInMax, path, dexIds);

        TransferHelper.safeTransferFrom(
            tokenIn, msg.sender, path[0], amounts[0]
        );
        _swap(tokenIn, amounts, path, to);
    }

    function swapExactETHForTokens(address tokenOut, uint amountOutMin, address[] calldata path, uint8[] calldata dexIds, address to, uint deadline)
        external
        virtual
        override
        payable
        ensure(deadline)
        returns (uint[] memory amounts)
    {
        amounts = _validateAmountOut(WETH, tokenOut, msg.value, amountOutMin, path, dexIds);

        transferETHTo(amounts[0], path[0]);
        _swap(WETH, amounts, path, to);
    }
    function swapTokensForExactETH(address tokenIn, uint amountOut, uint amountInMax, address[] calldata path, uint8[] calldata dexIds, address to, uint deadline)
        external
        virtual
        override
        ensure(deadline)
        returns (uint[] memory amounts)
    {
        amounts = _validateAmountIn(tokenIn, WETH, amountOut, amountInMax, path, dexIds);

        TransferHelper.safeTransferFrom(
            tokenIn, msg.sender, path[0], amounts[0]
        );
        _swap(tokenIn, amounts, path, address(this));
        transferAll(ETH_ADDRESS, to, amounts[amounts.length - 1]);
    }
    function swapExactTokensForETH(address tokenIn, uint amountIn, uint amountOutMin, address[] calldata path, uint8[] calldata dexIds, address to, uint deadline)
        external
        virtual
        override
        ensure(deadline)
        returns (uint[] memory amounts)
    {
        amounts = _validateAmountOut(tokenIn, WETH, amountIn, amountOutMin, path, dexIds);

        TransferHelper.safeTransferFrom(
            tokenIn, msg.sender, path[0], amounts[0]
        );
        _swap(tokenIn, amounts, path, address(this));
        transferAll(ETH_ADDRESS, to, amounts[amounts.length - 1]);
    }
    function swapETHForExactTokens(address tokenOut, uint amountOut, address[] calldata path, uint8[] calldata dexIds, address to, uint deadline)
        external
        virtual
        override
        payable
        ensure(deadline)
        returns (uint[] memory amounts)
    {
        amounts = _validateAmountIn(WETH, tokenOut, amountOut, msg.value, path, dexIds);

        transferETHTo(amounts[0], path[0]);
        _swap(WETH, amounts, path, to);
        // refund dust eth, if any
        if (msg.value > amounts[0]) TransferHelper.safeTransferETH(msg.sender, msg.value - amounts[0]);
    }

    // **** SWAP (supporting fee-on-transfer tokens) ****
    // requires the initial amount to have already been sent to the first pair
    function _swapSupportingFeeOnTransferTokens(address tokenIn, address[] memory path, uint8[] memory dexIds, address _to) internal virtual {
        for (uint i; i < path.length; i++) {
            uint amountOutput;
            address currentOutput;
            {
                (address output, uint reserveInput, uint reserveOutput, uint32 tokenWeightInput,, uint32 swapFee) = IFireBirdFormula(formula).getFactoryReserveAndWeights(factory, path[i], tokenIn, dexIds[i]);
                uint amountInput = IERC20(tokenIn).balanceOf(path[i]).sub(reserveInput);
                amountOutput = IFireBirdFormula(formula).getAmountOut(amountInput, reserveInput, reserveOutput, tokenWeightInput, 100-tokenWeightInput, swapFee);
                currentOutput = output;
            }

            IFireBirdPair pair = IFireBirdPair(path[i]);
            (uint amount0Out, uint amount1Out) = tokenIn == pair.token0() ? (uint(0), amountOutput) : (amountOutput, uint(0));
            if (swapFeeReward != address(0)) {
                ISwapFeeReward(swapFeeReward).swap(msg.sender, tokenIn, currentOutput, amountOutput, path[i]);
            }
            address to = i < path.length - 1 ? path[i + 1] : _to;
            pair.swap(amount0Out, amount1Out, to, new bytes(0));
            emit Exchange(path[i], amountOutput, currentOutput);
            tokenIn = currentOutput;
        }
    }
    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        address tokenIn,
        address tokenOut,
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        uint8[] calldata dexIds,
        address to,
        uint deadline
    ) external virtual override ensure(deadline) {
        TransferHelper.safeTransferFrom(
            tokenIn, msg.sender, path[0], amountIn
        );
        uint balanceBefore = IERC20(tokenOut).balanceOf(to);
        _swapSupportingFeeOnTransferTokens(tokenIn, path, dexIds, to);
        require(
            IERC20(tokenOut).balanceOf(to).sub(balanceBefore) >= amountOutMin,
            'Router: INSUFFICIENT_OUTPUT_AMOUNT'
        );
    }
    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        address tokenOut,
        uint amountOutMin,
        address[] calldata path,
        uint8[] calldata dexIds,
        address to,
        uint deadline
    )
        external
        virtual
        override
        payable
        ensure(deadline)
    {
//            require(path[0] == WETH, 'Router: INVALID_PATH');
        uint amountIn = msg.value;
        transferETHTo(amountIn, path[0]);
        uint balanceBefore = IERC20(tokenOut).balanceOf(to);
        _swapSupportingFeeOnTransferTokens(WETH, path, dexIds, to);
        require(
            IERC20(tokenOut).balanceOf(to).sub(balanceBefore) >= amountOutMin,
            'Router: INSUFFICIENT_OUTPUT_AMOUNT'
        );
    }
    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        address tokenIn,
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        uint8[] calldata dexIds,
        address to,
        uint deadline
    )
        external
        virtual
        override
        ensure(deadline)
    {
        TransferHelper.safeTransferFrom(
            tokenIn, msg.sender, path[0], amountIn
        );
        _swapSupportingFeeOnTransferTokens(tokenIn, path, dexIds, address(this));
        uint amountOut = IERC20(WETH).balanceOf(address(this));
        require(amountOut >= amountOutMin, 'Router: INSUFFICIENT_OUTPUT_AMOUNT');
        transferAll(ETH_ADDRESS, to, amountOut);
    }

    function swap(
        IAggregationExecutor caller,
        SwapDescription calldata desc,
        bytes calldata data
    )
        external
        payable
        returns (uint256 returnAmount)
    {
        require(desc.minReturnAmount > 0, "Min return should not be 0");
        require(data.length > 0, "data should be not zero");

        uint256 flags = desc.flags;
        uint256 amount = desc.amount;
        IERC20 srcToken = desc.srcToken;
        IERC20 dstToken = desc.dstToken;

        if (flags & _REQUIRES_EXTRA_ETH != 0) {
            require(msg.value > (isETH(srcToken) ? amount : 0), "Invalid msg.value");
        } else {
            require(msg.value == (isETH(srcToken) ? amount : 0), "Invalid msg.value");
        }

        if (flags & _SHOULD_CLAIM != 0) {
            require(!isETH(srcToken), "Claim token is ETH");
            _permit(srcToken, amount, desc.permit);
            TransferHelper.safeTransferFrom(address(srcToken), msg.sender, desc.srcReceiver, amount);
        }

        address dstReceiver = (desc.dstReceiver == address(0)) ? msg.sender : desc.dstReceiver;
        uint256 initialSrcBalance = (flags & _PARTIAL_FILL != 0) ? getBalance(srcToken, msg.sender) : 0;
        uint256 initialDstBalance = getBalance(dstToken, dstReceiver);

        {
            // solhint-disable-next-line avoid-low-level-calls
            (bool success, bytes memory result) = address(caller).call{value: msg.value}(abi.encodeWithSelector(caller.callBytes.selector, data, msg.sender));
            if (!success) {
                revert(RevertReasonParser.parse(result, "callBytes failed: "));
            }
        }

        uint256 spentAmount = amount;
        returnAmount = getBalance(dstToken, dstReceiver).sub(initialDstBalance);

        if (flags & _PARTIAL_FILL != 0) {
            spentAmount = initialSrcBalance.add(amount).sub(getBalance(srcToken, msg.sender));
            require(returnAmount.mul(amount) >= desc.minReturnAmount.mul(spentAmount), "Return amount is not enough");
        } else {
            require(returnAmount >= desc.minReturnAmount, "Return amount is not enough");
        }

        emit Swapped(
            msg.sender,
            srcToken,
            dstToken,
            dstReceiver,
            spentAmount,
            returnAmount
        );
        emit Exchange(address(caller), returnAmount, isETH(dstToken) ? WETH : address(dstToken));
    }

    function getBalance(IERC20 token, address account) internal view returns (uint) {
        if (isETH(token)) {
            return account.balance;
        } else {
            return token.balanceOf(account);
        }
    }

    function _validateAmountOut(
        address tokenIn,
        address tokenOut,
        uint amountIn,
        uint amountOutMin,
        address[] memory path,
        uint8[] memory dexIds
    ) internal view returns (uint[] memory amounts) {
        amounts = IFireBirdFormula(formula).getFactoryAmountsOut(factory, tokenIn, tokenOut, amountIn, path, dexIds);
        require(amounts[amounts.length - 1] >= amountOutMin, 'Router: INSUFFICIENT_OUTPUT_AMOUNT');
    }

    function _validateAmountIn(
        address tokenIn,
        address tokenOut,
        uint amountOut,
        uint amountInMax,
        address[] calldata path,
        uint8[] calldata dexIds
    ) internal view returns (uint[] memory amounts) {
        amounts = IFireBirdFormula(formula).getFactoryAmountsIn(factory, tokenIn, tokenOut, amountOut, path, dexIds);
        require(amounts[0] <= amountInMax, 'Router: EXCESSIVE_INPUT_AMOUNT');
    }

    function transferETHTo(uint amount, address to) internal {
        IWETH(WETH).deposit{value: amount}();
        assert(IWETH(WETH).transfer(to, amount));
    }

    function transferAll(address token, address to, uint amount) internal returns (bool) {
        if (amount == 0) {
            return true;
        }

        if (isETH(IERC20(token))) {
            IWETH(WETH).withdraw(amount);
            TransferHelper.safeTransferETH(to, amount);
        } else {
            TransferHelper.safeTransfer(token, to, amount);
        }
        return true;
    }

    function isETH(IERC20 token) internal pure returns (bool) {
        return (address(token) == ETH_ADDRESS);
    }
// **** REMOVE LIQUIDITY ****
    function _removeLiquidity(
        address pair,
        address tokenA,
        address tokenB,
        uint liquidity,
        uint amountAMin,
        uint amountBMin,
        address to
    ) internal  returns (uint amountA, uint amountB) {
        require(IFireBirdFactory(factory).isPair(pair), "Router: Invalid pair");
        IFireBirdPair(pair).transferFrom(msg.sender, pair, liquidity);
        // send liquidity to pair
        (uint amount0, uint amount1) = IFireBirdPair(pair).burn(to);
        (address token0,) = IFireBirdFormula(formula).sortTokens(tokenA, tokenB);
        (amountA, amountB) = tokenA == token0 ? (amount0, amount1) : (amount1, amount0);
        require(amountA >= amountAMin, 'Router: INSUFFICIENT_A_AMOUNT');
        require(amountB >= amountBMin, 'Router: INSUFFICIENT_B_AMOUNT');
    }
    function removeLiquidity(
        address pair,
        address tokenA,
        address tokenB,
        uint liquidity,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) public virtual override ensure(deadline) returns (uint amountA, uint amountB) {
        (amountA, amountB) = _removeLiquidity(pair, tokenA, tokenB, liquidity, amountAMin, amountBMin, to);
    }

    function removeLiquidityETH(
        address pair,
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline
    ) public virtual override ensure(deadline) returns (uint amountToken, uint amountETH) {
        (amountToken, amountETH) = _removeLiquidity(
            pair,
            token,
            WETH,
            liquidity,
            amountTokenMin,
            amountETHMin,
            address(this)
        );
        TransferHelper.safeTransfer(token, to, amountToken);
        transferAll(ETH_ADDRESS, to, amountETH);
    }

    function removeLiquidityWithPermit(
        address pair,
        address tokenA,
        address tokenB,
        uint liquidity,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline,
        bool approveMax, uint8 v, bytes32 r, bytes32 s
    ) external virtual override ensure(deadline) returns (uint amountA, uint amountB) {
        {
            uint value = approveMax ? uint(- 1) : liquidity;
            IFireBirdPair(pair).permit(msg.sender, address(this), value, deadline, v, r, s);
        }
        (amountA, amountB) = _removeLiquidity(pair, tokenA, tokenB, liquidity, amountAMin, amountBMin, to);
    }

    function removeLiquidityETHWithPermit(
        address pair,
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline,
        bool approveMax, uint8 v, bytes32 r, bytes32 s
    ) external virtual override returns (uint amountToken, uint amountETH) {
        uint value = approveMax ? uint(- 1) : liquidity;
        IFireBirdPair(pair).permit(msg.sender, address(this), value, deadline, v, r, s);
        (amountToken, amountETH) = removeLiquidityETH(pair, token, liquidity, amountTokenMin, amountETHMin, to, deadline);
    }

    // **** REMOVE LIQUIDITY (supporting fee-on-transfer tokens) ****
    function removeLiquidityETHSupportingFeeOnTransferTokens(
        address pair,
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline
    ) public virtual override ensure(deadline) returns (uint amountETH) {
        (, amountETH) = removeLiquidity(
            pair,
            token,
            WETH,
            liquidity,
            amountTokenMin,
            amountETHMin,
            address(this),
            deadline
        );
        TransferHelper.safeTransfer(token, to, IERC20(token).balanceOf(address(this)));
        transferAll(ETH_ADDRESS, to, amountETH);
    }

    function removeLiquidityETHWithPermitSupportingFeeOnTransferTokens(
        address pair,
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline,
        bool approveMax, uint8 v, bytes32 r, bytes32 s
    ) external virtual override returns (uint amountETH) {
        uint value = approveMax ? uint(- 1) : liquidity;
        IFireBirdPair(pair).permit(msg.sender, address(this), value, deadline, v, r, s);
        amountETH = removeLiquidityETHSupportingFeeOnTransferTokens(
            pair, token, liquidity, amountTokenMin, amountETHMin, to, deadline
        );
    }

    function rescueFunds(address token, uint256 amount) external onlyOwner {
        if (isETH(IERC20(token))) {
            TransferHelper.safeTransferETH(msg.sender, amount);
        } else {
            TransferHelper.safeTransfer(token, msg.sender, amount);
        }
    }
}