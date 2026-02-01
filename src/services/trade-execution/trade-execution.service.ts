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
import { formatUSDC } from '../../utils/formatters.js';
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
    const { estimatedCost, slippage } = this.calculateTradeMetrics(
      request.side,
      request.size,
      orderbook,
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
    );

    this.logger.info(
      { walletAddress, estimatedCost, slippage },
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
  ): { estimatedCost: string; slippage: string } {
    const sizeNum = parseFloat(size);
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
    };
  }

  private async buildTransaction(
    walletAddress: `0x${string}`,
    request: PrepareTradeRequest,
    tokenId: string,
  ): Promise<UnsignedTransaction> {
    // This is a simplified implementation
    // In production, you would fetch real orders and build the proper transaction
    const ctfExchangeAddress = getContractAddress('CTF_EXCHANGE');

    // Placeholder: encode a simple transaction
    // In reality, you'd need to:
    // 1. Fetch best orders from orderbook
    // 2. Build order parameters
    // 3. Sign order (or use existing signed orders)
    // 4. Encode fillOrder call
    const data = encodeFunctionData({
      abi: CTF_EXCHANGE_ABI,
      functionName: 'fillOrder',
      args: [
        {
          salt: 0n,
          maker: walletAddress,
          signer: walletAddress,
          taker: '0x0000000000000000000000000000000000000000' as `0x${string}`,
          tokenId: BigInt(tokenId),
          makerAmount: BigInt(parseFloat(request.size) * 1e6),
          takerAmount: BigInt(parseFloat(request.size) * 0.5 * 1e6),
          expiration: BigInt(Math.floor(Date.now() / 1000) + 3600),
          nonce: 0n,
          feeRateBps: 0n,
          side: request.side === 'buy' ? 0 : 1,
          signatureType: 0,
        },
        '0x' as `0x${string}`,
        BigInt(parseFloat(request.size) * 1e6),
      ],
    });

    return await this.blockchainAdapter.prepareTransaction({
      to: ctfExchangeAddress,
      data,
      value: 0n,
    });
  }
}
