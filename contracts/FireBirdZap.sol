pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import "./interfaces/IWETH.sol";
import "./interfaces/IUniswapV2Router.sol";
import "./interfaces/IFireBirdRouterLite.sol";
import "./interfaces/IFireBirdFactory.sol";
import "./test/IOriginUniswapV2Factory.sol";
import "./interfaces/IFireBirdPair.sol";
import "./interfaces/IFireBirdFormula.sol";
import './libraries/TransferHelper.sol';
import "./libraries/Babylonian.sol";

contract FireBirdZap is ReentrancyGuard {
    using SafeMath for uint;
    using SafeERC20 for IERC20;

    // governance
    address public governance;
    address public WBNB;
    address private constant BNB_ADDRESS = address(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE);

    IFireBirdRouter public fireBirdRouter;
    address public fireBirdFactory;
    IFireBirdFormula public fireBirdFormula;
    mapping(address => bool) public whitelistUniRouter ;

    struct PoolLiquidityInfo {
        address router;
        address pair;
        uint256 amountAMin;
        uint256 amountBMin;
    }

    event ZapIn(address indexed sender, address from, uint256 amtFrom, address pool, uint256 amtLp);
    event ZapOut(address indexed sender, address pool, uint256 amtLp, address to, uint256 amtTo);
    event Withdraw(address indexed token, uint256 amount, address to);
    event LogGovernance(address governance);

    receive() external payable {
        require(msg.sender != tx.origin, "Zap: Do not send ETH directly");
    }

    modifier onlyGovernance() {
        require(msg.sender == governance, "Zap: !governance");
        _;
    }

    modifier onlyWhitelistUniRouter(address _uniRouter) {
        require(whitelistUniRouter[_uniRouter] || _uniRouter == address(fireBirdRouter), "Zap: !router");
        _;
    }

    constructor(IFireBirdRouter _fireBirdRouter) public {
        governance = msg.sender;
        fireBirdRouter = _fireBirdRouter;
        fireBirdFactory = _fireBirdRouter.factory();
        fireBirdFormula = IFireBirdFormula(_fireBirdRouter.formula());
        WBNB = _fireBirdRouter.WETH();
    }

    /* ========== External Functions ========== */

    // _to: must be a pair lp
    // _from: must be in lp
    // _amounts: amount_from, _minTokenB, _minLp
    function zapInToken(address _from, uint[] calldata amounts, address _to, uint8 dexId, address uniRouter, bool transferResidual)
        external
        onlyWhitelistUniRouter(uniRouter)
        nonReentrant
        returns (uint256 lpAmt)
    {
        require(_from == IFireBirdPair(_to).token0() || _from == IFireBirdPair(_to).token1(), "Zap: !pair");
        require(IFireBirdPair(_to).factory() == IFireBirdRouter(uniRouter).factory(), 'Zap: Incompatible factory');

        IERC20(_from).safeTransferFrom(msg.sender, address(this), amounts[0]);
        _approveTokenIfNeeded(_from, uniRouter);

        // swap half amount for other
        address other;
        uint256 sellAmount;
        {
            address token0 = IFireBirdPair(_to).token0();
            address token1 = IFireBirdPair(_to).token1();
            other = _from == token0 ? token1 : token0;
            sellAmount = calculateSwapInAmount(_to, _from, amounts[0], token0, dexId);
        }
        uint otherAmount = _swap(_from, sellAmount, other, address(this), _to, dexId);
        require(otherAmount >= amounts[1], "Zap: Insufficient Receive Amount");

        (,,lpAmt) = _pairDeposit(_to, _from, other, amounts[0] - sellAmount, otherAmount, 1, 1, uniRouter, transferResidual);

        require(lpAmt >= amounts[2], "Zap: High Slippage In");
        emit ZapIn(msg.sender, _from, amounts[0], _to, lpAmt);
        return lpAmt;
    }

    // _to: must be a pair lp
    function zapIn(address _to, uint _minTokenB, uint _minLp, uint8 dexId, address uniRouter, bool transferResidual)
        external
        payable
        onlyWhitelistUniRouter(uniRouter)
        nonReentrant
        returns (uint256)
    {
        require(IFireBirdPair(_to).factory() == IFireBirdRouter(uniRouter).factory(), 'Zap: Incompatible factory');

        uint256 lpAmt = _swapBNBToLp(IFireBirdPair(_to), msg.value, _minTokenB, dexId, uniRouter, transferResidual);
        require(lpAmt >= _minLp, "Zap: High Slippage In");
        emit ZapIn(msg.sender, WBNB, msg.value, _to, lpAmt);
        return lpAmt;
    }

    // _from: must be a pair lp
    function zapOutToPair(address _from, uint amount, address uniRouter)
        public
        onlyWhitelistUniRouter(uniRouter)
        nonReentrant
        returns (uint256 amountA, uint256 amountB)
    {
        require(IFireBirdPair(_from).factory() == IFireBirdRouter(uniRouter).factory(), 'Zap: Incompatible factory');

        IERC20(_from).safeTransferFrom(msg.sender, address(this), amount);
        _approveTokenIfNeeded(_from, uniRouter);

        IFireBirdPair pair = IFireBirdPair(_from);
        address token0 = pair.token0();
        address token1 = pair.token1();

        address _WBNB = WBNB;
        if (token0 == _WBNB || token1 == _WBNB) {
            if (uniRouter == address(fireBirdRouter)) {
                (amountA, amountB) = fireBirdRouter.removeLiquidityETH(_from, token0 != _WBNB ? token0 : token1, amount, 1, 1, msg.sender, block.timestamp);
            } else {
                (amountA, amountB) = IUniswapV2Router(uniRouter).removeLiquidityETH(token0 != _WBNB ? token0 : token1, amount, 1, 1, msg.sender, block.timestamp);
            }
        } else {
            (amountA, amountB) = _removeLiquidity(_from, token0, token1, amount, 1, 1, uniRouter);
        }
    }

    function zapOutToPairWithPermit(
        address _from,
        uint256 _amount,
        address _uniRouter,
        uint256 _approvalAmount,
        uint256 _deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external returns (uint256 amountA, uint256 amountB) {
        // permit
        IFireBirdPair(_from).permit(
            msg.sender,
            address(this),
            _approvalAmount,
            _deadline,
            v,
            r,
            s
        );

        return zapOutToPair(_from, _amount, _uniRouter);
    }

    // _from: must be a pair lp
    // _toToken: must be in lp
    function zapOut(address _from, uint amount, address _toToken, uint256 _minTokensRec, uint8 dexId, address uniRouter)
        public
        onlyWhitelistUniRouter(uniRouter)
        nonReentrant
        returns (uint256)
    {
        require(IFireBirdPair(_from).factory() == IFireBirdRouter(uniRouter).factory(), 'Zap: Incompatible factory');

        IERC20(_from).safeTransferFrom(msg.sender, address(this), amount);
        address token0;
        address token1;
        uint256 amountA;
        uint256 amountB;
        {
            IFireBirdPair pair = IFireBirdPair(_from);
            token0 = pair.token0();
            token1 = pair.token1();
            (amountA, amountB) = _removeLiquidity(_from, token0, token1, amount, 1, 1, uniRouter);
        }

        uint256 tokenBought;
        _approveTokenIfNeeded(token0, uniRouter);
        _approveTokenIfNeeded(token1, uniRouter);
        if (_toToken == BNB_ADDRESS) {
            address _lpOfFromAndTo = WBNB == token0 || WBNB == token1 ? _from : address(0);
            if (_lpOfFromAndTo == address(0)) revert("Zap: !pairBNB");
            tokenBought = _swapTokenForBNB(token0, amountA, address(this), _lpOfFromAndTo, dexId);
            tokenBought = tokenBought.add(_swapTokenForBNB(token1, amountB, address(this), _lpOfFromAndTo, dexId));
        } else {
            address _lpOfFromAndTo = _toToken == token0 || _toToken == token1 ? _from : address(0);
            if (_lpOfFromAndTo == address(0)) revert("Zap: !pair");
            tokenBought = _swap(token0, amountA, _toToken, address(this), _lpOfFromAndTo, dexId);
            tokenBought += _swap(token1, amountB, _toToken, address(this), _lpOfFromAndTo, dexId);
        }

        require(tokenBought >= _minTokensRec, "Zap: High Slippage Out");
        if (_toToken == BNB_ADDRESS) {
            TransferHelper.safeTransferETH(msg.sender, tokenBought);
        } else {
            IERC20(_toToken).safeTransfer(msg.sender, tokenBought);
        }

        emit ZapOut(msg.sender, _from, amount, _toToken, tokenBought);
        return tokenBought;
    }

    function zapOutWithPermit(
        address _from,
        uint256 amount,
        address _toToken,
        uint256 _minTokensRec,
        uint8 dexId,
        address uniRouter,
        uint256 _approvalAmount,
        uint256 _deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external returns (uint256) {
        // permit
        IFireBirdPair(_from).permit(
            msg.sender,
            address(this),
            _approvalAmount,
            _deadline,
            v,
            r,
            s
        );

        return zapOut(_from, amount, _toToken, _minTokensRec, dexId, uniRouter);
    }

    function migrateWithPermit(
        address tokenA,
        address tokenB,
        PoolLiquidityInfo calldata oldPair,
        PoolLiquidityInfo calldata newPair,
        uint256 liquidity,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        IFireBirdPair(oldPair.pair).permit(msg.sender, address(this), liquidity, deadline, v, r, s);

        return migrate(tokenA, tokenB, oldPair, newPair, liquidity);
    }

    // msg.sender should have approved 'liquidity' amount of LP token of 'tokenA' and 'tokenB'
    function migrate(
        address tokenA,
        address tokenB,
        PoolLiquidityInfo memory oldPair,
        PoolLiquidityInfo calldata newPair,
        uint256 liquidity
    )
        public
        onlyWhitelistUniRouter(oldPair.router)
        onlyWhitelistUniRouter(newPair.router)
    {
        if (oldPair.router != address(fireBirdRouter)) {
            address uniFactory = IUniswapV2Router(oldPair.router).factory();
            oldPair.pair = IOriginUniswapV2Factory(uniFactory).getPair(tokenA, tokenB);
        }
        IERC20(oldPair.pair).safeTransferFrom(msg.sender, address(this), liquidity);

        // Remove liquidity from the old router with permit
        (uint256 amountA, uint256 amountB) = _removeLiquidity(
            oldPair.pair,
            tokenA,
            tokenB,
            liquidity,
            oldPair.amountAMin,
            oldPair.amountBMin,
            oldPair.router
        );

        // Add liquidity to the new router
        _pairDeposit(
            newPair.pair,
            tokenA,
            tokenB,
            amountA,
            amountB,
            newPair.amountAMin,
            newPair.amountBMin,
            newPair.router,
            true // Send remaining tokens to msg.sender
        );
    }

    /* ========== View Functions ===========*/
    // _from: token A
    // return amount B that will be convert from A to perform zap in
    // return amount A that will be convert to B to perform zap in
    function getAmountBToZapIn(address _from, uint _fromAmount, address lp, uint8 dexId) external view returns (uint256 amountBConverted, uint256 amountASell) {
        address other;
        uint sellAmount;
        {
            IFireBirdPair pair = IFireBirdPair(lp);
            address token0 = pair.token0();
            address token1 = pair.token1();
            other = _from == token0 ? token1 : token0;
            sellAmount = calculateSwapInAmount(lp, _from, _fromAmount, token0, dexId);
        }

        address[] memory path = new address[](1);
        path[0] = lp;
        uint8[] memory dexIds = new uint8[](1);
        dexIds[0] = dexId;
        uint[] memory amounts = fireBirdFormula.getFactoryAmountsOut(fireBirdFactory, _from, other, sellAmount, path, dexIds);
        return (amounts[amounts.length - 1], sellAmount);
    }

    // _from: lp pair
    // return amountOtherSell _otherToken that will be removed from pair
    // return amountToConverted _toToken that will be converted from other
    // return amountToOrigin _toToken that will be removed from pair
    function getAmountToZapOut(address _from, uint amount, address _toToken, uint8 dexId)
        external view
        returns (uint256 amountOtherSell, uint256 amountToConverted, uint256 amountToOrigin)
    {
        address other;
        {
            IFireBirdPair pair = IFireBirdPair(_from);
            address token0 = pair.token0();
            address token1 = pair.token1();
            other = _toToken == token0 ? token1 : token0;
        }
        uint sellAmount;
        uint amountToRemoved;
        {
            uint _totalSupply = IERC20(_from).totalSupply();
            sellAmount = amount.mul(IERC20(other).balanceOf(_from)) / _totalSupply;
            amountToRemoved = amount.mul(IERC20(_toToken).balanceOf(_from)) / _totalSupply;
        }

        uint _amountOut = _getRemovedReserveAmountOut(_from, other, sellAmount, amountToRemoved, dexId);
        return (sellAmount, _amountOut, amountToRemoved);
    }

    function calculateSwapInAmount(address pair, address tokenIn, uint256 userIn, address pairToken0, uint8 dexId) internal view returns (uint256) {
        (uint32 tokenWeight0, uint32 tokenWeight1, uint32 swapFee) = fireBirdFormula.getFactoryWeightsAndSwapFee(fireBirdFactory, pair, dexId);

        if (tokenWeight0 == 50) {
            (uint256 res0, uint256 res1,) = IFireBirdPair(pair).getReserves();
            uint reserveIn = tokenIn == pairToken0 ? res0 : res1;
            uint rMul = uint256(10000).sub(uint256(swapFee));
            return _getExactSwapInAmount(reserveIn, userIn, rMul);
        } else {
            uint256 otherWeight = tokenIn == pairToken0 ? uint(tokenWeight1) : uint(tokenWeight0);
            return userIn.mul(otherWeight).div(100);
        }
    }

    /* ========== Private Functions ========== */
    function _getExactSwapInAmount(uint256 reserveIn, uint256 userIn, uint256 rMul) internal pure returns (uint256) {
        return Babylonian
            .sqrt(reserveIn.mul(userIn.mul(40000).mul(rMul) + reserveIn.mul(rMul.add(10000)).mul(rMul.add(10000))))
            .sub(reserveIn.mul(rMul.add(10000))) / (rMul.mul(2));
    }

    function _getRemovedReserveAmountOut(address pair, address tokenIn, uint sellAmount, uint amountToRemoved, uint8 dexId) internal view returns (uint) {
        (, uint reserveIn, uint reserveOut, uint32 tokenWeightIn, uint32 tokenWeightOut, uint32 swapFee) =
            fireBirdFormula.getFactoryReserveAndWeights(fireBirdFactory, pair, tokenIn, dexId);
        return fireBirdFormula.getAmountOut(sellAmount, reserveIn.sub(sellAmount), reserveOut.sub(amountToRemoved), tokenWeightIn, tokenWeightOut, swapFee);
    }

    function _approveTokenIfNeeded(address token, address uniRouter) private {
        if (IERC20(token).allowance(address(this), address(uniRouter)) == 0) {
            IERC20(token).safeApprove(address(uniRouter), uint(~0));
        }
        if (IERC20(token).allowance(address(this), address(fireBirdRouter)) == 0) {
            IERC20(token).safeApprove(address(fireBirdRouter), uint(~0));
        }
    }

    function _removeLiquidity(
        address pair,
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address uniRouter
    ) internal returns (uint256 amountA, uint256 amountB) {
        _approveTokenIfNeeded(pair, uniRouter);

        if (uniRouter == address(fireBirdRouter)) {
            return fireBirdRouter.removeLiquidity(pair, tokenA, tokenB, liquidity, amountAMin, amountBMin, address(this), block.timestamp);
        } else {
            return IUniswapV2Router(uniRouter).removeLiquidity(tokenA, tokenB, liquidity, amountAMin, amountBMin, address(this), block.timestamp);
        }
    }

    function _pairDeposit(
        address _pair,
        address _poolToken0,
        address _poolToken1,
        uint256 token0Bought,
        uint256 token1Bought,
        uint256 amountAMin,
        uint256 amountBMin,
        address uniRouter,
        bool transferResidual
    ) internal returns (uint256 amountA, uint256 amountB, uint256 lpAmt) {
        _approveTokenIfNeeded(_poolToken0, uniRouter);
        _approveTokenIfNeeded(_poolToken1, uniRouter);

        if (uniRouter == address(fireBirdRouter)) {
            (amountA, amountB, lpAmt) = fireBirdRouter.addLiquidity(_pair, _poolToken0, _poolToken1, token0Bought, token1Bought, amountAMin, amountBMin, msg.sender, block.timestamp);
        } else {
            (amountA, amountB, lpAmt) = IUniswapV2Router(uniRouter).addLiquidity(_poolToken0, _poolToken1, token0Bought, token1Bought, amountAMin, amountBMin, msg.sender, block.timestamp);
        }

        if (transferResidual) {
            uint amountAResidual = token0Bought.sub(amountA);
            if (amountAResidual > 0) {
                //Returning residue in token0, if any.
                _transferToken(_poolToken0, msg.sender, amountAResidual);
            }

            uint amountBRedisual = token1Bought.sub(amountB);
            if (amountBRedisual > 0) {
                //Returning residue in token1, if any
                _transferToken(_poolToken1, msg.sender, amountBRedisual);
            }
        }

        return (amountA, amountB, lpAmt);
    }

    function _swapBNBToLp(IFireBirdPair pair, uint amount, uint _minTokenB, uint8 dexId, address uniRouter, bool transferResidual) private returns (uint256 lpAmt) {
        address _WBNB = WBNB;
        require(pair.token0() == _WBNB || pair.token1() == _WBNB, "FireBirdZap: !pairBNB");
        // Lp
        address token = pair.token0() == _WBNB ? pair.token1() : pair.token0();
        uint swapValue = calculateSwapInAmount(address(pair), _WBNB, amount, pair.token0(), dexId);
        uint tokenAmount = _swapBNBForToken(token, swapValue, address(this), address(pair), dexId);
        require(tokenAmount >= _minTokenB, "Zap: Insufficient Receive Amount");

        uint256 wbnbAmount = amount.sub(swapValue);
        IWETH(_WBNB).deposit{value : wbnbAmount}();
        (,,lpAmt) = _pairDeposit(address(pair), _WBNB, token, wbnbAmount, tokenAmount, 1, 1, uniRouter, transferResidual);
    }

    function _swapBNBForToken(address token, uint value, address _receiver, address lpBNBToken, uint8 dexId) private returns (uint) {
        if (token == WBNB) {
            address _WBNB = WBNB;
            IWETH(_WBNB).deposit{value : value}();
            if (_receiver != address(this)) {
                IERC20(_WBNB).safeTransfer(_receiver, value);
            }
            return value;
        }
        address[] memory path = new address[](1);
        path[0] = lpBNBToken;
        uint8[] memory dexIds = new uint8[](1);
        dexIds[0] = dexId;

        uint balanceBefore = IERC20(token).balanceOf(_receiver);
        fireBirdRouter.swapExactETHForTokensSupportingFeeOnTransferTokens{value : value}(token, 1, path, dexIds, _receiver, block.timestamp);
        return IERC20(token).balanceOf(_receiver).sub(balanceBefore);
    }

    function _swapTokenForBNB(address token, uint amount, address _receiver, address lpTokenBNB, uint8 dexId) private returns (uint) {
        if (token == WBNB) {
            _transferToken(WBNB, _receiver, amount);
            return amount;
        }
        address[] memory path = new address[](1);
        path[0] = lpTokenBNB;
        uint8[] memory dexIds = new uint8[](1);
        dexIds[0] = dexId;

        uint balanceBefore = address(_receiver).balance;
        fireBirdRouter.swapExactTokensForETHSupportingFeeOnTransferTokens(token, amount, 1, path, dexIds, _receiver, block.timestamp);
        return address(_receiver).balance.sub(balanceBefore);
    }

    function _swap(address _from, uint _amount, address _to, address _receiver, address _lpOfFromTo, uint8 dexId) internal returns (uint) {
        if (_from == _to) {
            if (_receiver != address(this)) {
                IERC20(_from).safeTransfer(_receiver, _amount);
            }
            return _amount;
        }
        address[] memory path = new address[](1);
        path[0] = _lpOfFromTo;
        uint8[] memory dexIds = new uint8[](1);
        dexIds[0] = dexId;

        uint balanceBefore = IERC20(_to).balanceOf(_receiver);
        fireBirdRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens(_from, _to, _amount, 1, path, dexIds, _receiver, block.timestamp);
        return IERC20(_to).balanceOf(_receiver).sub(balanceBefore);
    }

    function _transferToken(address token, address to, uint amount) internal {
        if (amount == 0) {
            return;
        }

        if (token == WBNB) {
            IWETH(WBNB).withdraw(amount);
            if (to != address(this)) {
                TransferHelper.safeTransferETH(to, amount);
            }
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
        return;
    }

    /* ========== RESTRICTED FUNCTIONS ========== */
    function setWhitelistUniRouter(address _uniRouter, bool _isWhitelist) external onlyGovernance {
        whitelistUniRouter[_uniRouter] = _isWhitelist;
    }

    function withdrawToken(address[] memory tokens, address to) public onlyGovernance {
        require(to != address(0), "Zap: !receiver");

        for (uint256 i = 0; i < tokens.length; i++) {
            _withdraw(tokens[i], to);
        }
    }

    function withdrawTokenAmount(address token, address to, uint256 amount) external onlyGovernance {
        require(to != address(0), "Zap: !receiver");
        IERC20(token).safeTransfer(to, amount);
        emit Withdraw(token, amount, to);
    }

    /**
     * @dev Use only for some special tokens
     */
    function manualApproveAllowance(
        IERC20[] calldata tokens,
        address[] calldata spenders,
        uint256 allowance
    ) external onlyGovernance {
        for (uint256 i = 0; i < tokens.length; i++) {
            for (uint256 j = 0; j < spenders.length; j++) {
                tokens[i].safeApprove(spenders[j], allowance);
            }
        }
    }

    function _withdraw(address _token, address _to) internal {
        if (_token == BNB_ADDRESS) {
            TransferHelper.safeTransferETH(_to, address(this).balance);
            emit Withdraw(_token, address(this).balance, _to);
            return;
        }

        uint256 _balance = IERC20(_token).balanceOf(address(this));
        IERC20(_token).safeTransfer(_to, _balance);
        emit Withdraw(_token, _balance, _to);
    }

    function setGovernance(address _governance) external onlyGovernance {
        governance = _governance;
        emit LogGovernance(governance);
    }
}