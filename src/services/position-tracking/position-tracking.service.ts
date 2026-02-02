import { PositionRepository } from '../../adapters/database/repositories/position.repository.js';
import { MarketDataService } from '../market-data/market-data.service.js';
import { Position, PositionListResponse } from '../../types/position.types.js';
import { Trade, Outcome } from '../../types/trade.types.js';
import { validateAddress } from '../../utils/validators.js';
import { getLogger } from '../../utils/logger.js';
import { TradeIngestionService } from './trade-ingestion.service.js';

export class PositionTrackingService {
  private positionRepo: PositionRepository;
  private marketDataService: MarketDataService;
  private tradeIngestionService: TradeIngestionService;
  private logger;

  constructor() {
    this.positionRepo = new PositionRepository();
    this.marketDataService = new MarketDataService();
    this.tradeIngestionService = new TradeIngestionService();
    this.logger = getLogger();
  }

  async getPositions(walletAddress: string): Promise<PositionListResponse> {
    this.logger.debug({ walletAddress }, 'Getting positions');

    validateAddress(walletAddress);

    const ingestedTrades = await this.tradeIngestionService.ingestTradesForWallet(walletAddress);
    for (const trade of ingestedTrades) {
      try {
        await this.updatePositionFromTrade(trade);
      } catch (error) {
        this.logger.error({ error, trade }, 'Failed to update position from ingested trade');
      }
    }

    const positions = await this.positionRepo.findByWallet(walletAddress);

    // Calculate total P&L
    const totalPnl = positions.reduce((sum, pos) => {
      const realized = parseFloat(pos.realizedPnl);
      const unrealized = parseFloat(pos.unrealizedPnl);
      return sum + realized + unrealized;
    }, 0);

    return {
      positions,
      totalPnl: totalPnl.toFixed(2),
    };
  }

  async updatePositionFromTrade(trade: Trade): Promise<Position> {
    this.logger.debug({ trade }, 'Updating position from trade');

    const existing = await this.positionRepo.findOne(
      trade.walletAddress,
      trade.marketId,
      trade.outcome,
    );

    const tradePrice = parseFloat(trade.price);
    const tradeSize = parseFloat(trade.size);
    const tradeCost = tradePrice * tradeSize;

    if (!existing) {
      // Create new position
      return await this.positionRepo.upsert(
        trade.walletAddress,
        trade.marketId,
        trade.outcome,
        {
          avgPrice: trade.price,
          size: trade.size,
          realizedPnl: '0',
          unrealizedPnl: '0',
        },
      );
    }

    // Update existing position
    const existingPrice = parseFloat(existing.avgPrice);
    const existingSize = parseFloat(existing.size);

    let newSize: number;
    let newAvgPrice: number;
    let realizedPnl = parseFloat(existing.realizedPnl);

    if (trade.side === 'buy') {
      // Buying increases position
      newSize = existingSize + tradeSize;
      newAvgPrice = (existingPrice * existingSize + tradeCost) / newSize;
    } else {
      // Selling decreases position
      newSize = existingSize - tradeSize;
      if (newSize < 0) {
        throw new Error('Cannot sell more than current position');
      }

      // Calculate realized P&L
      const pnl = (tradePrice - existingPrice) * tradeSize;
      realizedPnl += pnl;

      // Average price stays the same when selling
      newAvgPrice = existingPrice;
    }

    return await this.positionRepo.upsert(
      trade.walletAddress,
      trade.marketId,
      trade.outcome,
      {
        avgPrice: newAvgPrice.toFixed(6),
        size: newSize.toFixed(6),
        realizedPnl: realizedPnl.toFixed(6),
      },
    );
  }

  async updateUnrealizedPnl(walletAddress: string): Promise<void> {
    this.logger.debug({ walletAddress }, 'Updating unrealized P&L');

    validateAddress(walletAddress);

    const positions = await this.positionRepo.findByWallet(walletAddress);

    for (const position of positions) {
      try {
        // Get current market price
        const orderbook = await this.marketDataService.getOrderbook(
          position.marketId,
          position.outcome,
        );

        // Use mid price as current price
        const bestBid = orderbook.bids[0]?.price || '0';
        const bestAsk = orderbook.asks[0]?.price || '0';
        const currentPrice = (parseFloat(bestBid) + parseFloat(bestAsk)) / 2;

        // Calculate unrealized P&L
        const avgPrice = parseFloat(position.avgPrice);
        const size = parseFloat(position.size);
        const unrealizedPnl = (currentPrice - avgPrice) * size;

        // Update position
        await this.positionRepo.updateUnrealizedPnl(
          position.walletAddress,
          position.marketId,
          position.outcome as Outcome,
          unrealizedPnl.toFixed(6),
        );
      } catch (error) {
        this.logger.error(
          { error, position },
          'Failed to update unrealized P&L for position',
        );
        // Continue with other positions
      }
    }

    this.logger.debug({ walletAddress, count: positions.length }, 'Updated unrealized P&L');
  }

  async updateAllPositions(): Promise<number> {
    this.logger.info('Updating all positions');

    // Get all positions
    const allPositions = await this.positionRepo.findAll();

    const wallets = new Set(allPositions.map((p) => p.walletAddress));

    let updated = 0;
    for (const wallet of wallets) {
      try {
        await this.updateUnrealizedPnl(wallet);
        updated++;
      } catch (error) {
        this.logger.error({ error, wallet }, 'Failed to update positions for wallet');
      }
    }

    this.logger.info({ updated }, 'Position update completed');
    return updated;
  }
}
