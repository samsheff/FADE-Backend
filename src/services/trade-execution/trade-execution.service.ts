import { encodeFunctionData } from 'viem';
import { ViemAdapter } from '../../adapters/blockchain/viem.adapter.js';
import { MarketRepository } from '../../adapters/database/repositories/market.repository.js';
import { MarketDataService } from '../market-data/market-data.service.js';
import {
  PrepareTradeRequest,
  PrepareTradeResponse,
  UnsignedTransaction,
} from '../../types/trade.types.js';
import { CTF_EXCHANGE_ABI, getContractAddress } from '../../config/constants.js';
import {
  ValidationError,
  NotFoundError,
  InsufficientLiquidityError,
} from '../../utils/errors.js';
import { validateAddress, validateSize, validateMarketId } from '../../utils/validators.js';
import { getLogger } from '../../utils/logger.js';

export class TradeExecutionService {
  private blockchainAdapter: ViemAdapter;
  private marketRepo: MarketRepository;
  private marketDataService: MarketDataService;
  private logger;

  constructor() {
    this.blockchainAdapter = new ViemAdapter();
    this.marketRepo = new MarketRepository();
    this.marketDataService = new MarketDataService();
    this.logger = getLogger();
  }

  async prepareTrade(
    walletAddress: string,
    request: PrepareTradeRequest,
  ): Promise<PrepareTradeResponse> {
    this.logger.info({ walletAddress, request }, 'Preparing trade');

    // Validate inputs
    validateAddress(walletAddress);
    validateMarketId(request.marketId);
    validateSize(request.size);

    // Validate limit order parameters
    const orderType = request.orderType || 'market';
    if (orderType === 'limit' && !request.limitPrice) {
      throw new ValidationError('limitPrice is required for limit orders');
    }
    if (request.limitPrice && parseFloat(request.limitPrice) <= 0) {
      throw new ValidationError('limitPrice must be greater than 0');
    }

    // Check market exists and is active
    const market = await this.marketRepo.findById(request.marketId);
    if (!market) {
      throw new NotFoundError('Market', request.marketId);
    }
    if (!market.active) {
      throw new ValidationError('Market is not active');
    }

    // Get token address for outcome
    const tokenId = market.tokens[request.outcome];
    if (!tokenId) {
      throw new ValidationError(`Invalid outcome: ${request.outcome}`);
    }

    // Get orderbook to calculate costs and slippage
    const orderbook = await this.marketDataService.getOrderbook(
      request.marketId,
      request.outcome,
    );

    // Calculate estimated cost and slippage
    const { estimatedCost, slippage, bestPrice } = this.calculateTradeMetrics(
      request.side,
      request.size,
      orderbook,
      orderType,
      request.limitPrice,
    );

    // Build unsigned transaction
    // Note: This is a simplified implementation
    // In production, you would need to:
    // 1. Fetch actual orders from the orderbook
    // 2. Build the order matching logic
    // 3. Encode the proper fillOrder call
    const unsignedTx = await this.buildTransaction(
      walletAddress as `0x${string}`,
      request,
      tokenId,
      bestPrice,
    );

    this.logger.info(
      { walletAddress, estimatedCost, slippage, orderType },
      'Trade preparation completed',
    );

    return {
      unsignedTx,
      estimatedCost,
      slippageEstimate: slippage,
    };
  }

  private calculateTradeMetrics(
    side: 'buy' | 'sell',
    size: string,
    orderbook: { bids: Array<{ price: string; size: string }>; asks: Array<{ price: string; size: string }> },
    orderType: 'market' | 'limit' = 'market',
    limitPrice?: string,
  ): { estimatedCost: string; slippage: string; bestPrice: string } {
    const sizeNum = parseFloat(size);

    // For limit orders, use the specified limit price
    if (orderType === 'limit' && limitPrice) {
      const limitPriceNum = parseFloat(limitPrice);
      const totalCost = sizeNum * limitPriceNum;

      return {
        estimatedCost: totalCost.toFixed(2),
        slippage: '0.00', // No slippage for limit orders
        bestPrice: limitPrice,
      };
    }

    // For market orders, walk the orderbook
    const levels = side === 'buy' ? orderbook.asks : orderbook.bids;

    if (levels.length === 0) {
      throw new InsufficientLiquidityError('orderbook');
    }

    let remainingSize = sizeNum;
    let totalCost = 0;
    let weightedPrice = 0;

    for (const level of levels) {
      const levelSize = parseFloat(level.size);
      const levelPrice = parseFloat(level.price);

      if (remainingSize <= 0) break;

      const fillSize = Math.min(remainingSize, levelSize);
      totalCost += fillSize * levelPrice;
      weightedPrice += fillSize * levelPrice;
      remainingSize -= fillSize;
    }

    if (remainingSize > 0) {
      throw new InsufficientLiquidityError('orderbook');
    }

    const avgPrice = weightedPrice / sizeNum;
    const bestPrice = parseFloat(levels[0].price);
    const slippage = Math.abs((avgPrice - bestPrice) / bestPrice);

    return {
      estimatedCost: totalCost.toFixed(2),
      slippage: (slippage * 100).toFixed(2),
      bestPrice: bestPrice.toString(),
    };
  }

  private async buildTransaction(
    walletAddress: `0x${string}`,
    request: PrepareTradeRequest,
    tokenId: string,
    bestPrice: string,
  ): Promise<UnsignedTransaction> {
    const ctfExchangeAddress = getContractAddress('CTF_EXCHANGE');
    const sizeNum = parseFloat(request.size);
    const priceNum = parseFloat(bestPrice);
    const outcomeAmount = this.toBaseUnits(sizeNum, 6);
    const usdcAmount = this.toBaseUnits(sizeNum * priceNum, 6);

    const makerAmount = request.side === 'buy' ? outcomeAmount : usdcAmount;
    const takerAmount = request.side === 'buy' ? usdcAmount : outcomeAmount;
    const data = encodeFunctionData({
      abi: CTF_EXCHANGE_ABI,
      functionName: 'fillOrder',
      args: [
        {
          salt: BigInt(Date.now()),
          maker: walletAddress,
          signer: walletAddress,
          taker: '0x0000000000000000000000000000000000000000' as `0x${string}`,
          tokenId: BigInt(tokenId),
          makerAmount,
          takerAmount,
          expiration: BigInt(Math.floor(Date.now() / 1000) + 3600),
          nonce: 0n,
          feeRateBps: 0n,
          side: request.side === 'buy' ? 0 : 1,
          signatureType: 0,
        },
        '0x' as `0x${string}`,
        outcomeAmount,
      ],
    });

    return await this.blockchainAdapter.prepareTransaction({
      to: ctfExchangeAddress,
      data,
      value: 0n,
    });
  }

  private toBaseUnits(value: number, decimals: number): bigint {
    const factor = 10 ** decimals;
    return BigInt(Math.round(value * factor));
  }
}
