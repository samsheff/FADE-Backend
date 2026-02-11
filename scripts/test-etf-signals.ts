/**
 * Test script for ETF signal detection system
 *
 * Usage:
 *   npm run build
 *   node dist/scripts/test-etf-signals.js
 */

import { getPrismaClient } from '../src/adapters/database/client.js';
import { InstrumentRepository } from '../src/adapters/database/repositories/instrument.repository.js';
import { EtfMetricsRepository } from '../src/adapters/database/repositories/etf-metrics.repository.js';
import { EtfApDetailRepository } from '../src/adapters/database/repositories/etf-ap-detail.repository.js';
import { EtfNavDataService } from '../src/services/etf/etf-nav-data.service.js';
import { ArbitrageBreakdownGenerator } from '../src/services/signals/generators/etf-arbitrage-breakdown.generator.js';
import { APFragilityGenerator } from '../src/services/signals/generators/etf-ap-fragility.generator.js';
import { getLogger } from '../src/utils/logger.js';

const logger = getLogger().child({ script: 'test-etf-signals' });

async function main() {
  const prisma = getPrismaClient();

  try {
    logger.info('Starting ETF signals test');

    // Initialize repositories and services
    const instrumentRepo = new InstrumentRepository();
    const etfMetricsRepo = new EtfMetricsRepository(prisma);
    const etfApRepo = new EtfApDetailRepository(prisma);
    const navDataService = new EtfNavDataService(prisma);

    // Test 1: Check for ETF instruments
    logger.info('Test 1: Checking for ETF instruments');
    const etfs = await instrumentRepo.findByType('ETF');
    logger.info({ count: etfs.length }, 'Found ETF instruments');

    if (etfs.length === 0) {
      logger.warn('No ETF instruments found. Create some test ETFs first.');
      return;
    }

    const testEtf = etfs[0];
    logger.info({ id: testEtf.id, symbol: testEtf.symbol }, 'Using test ETF');

    // Test 2: Check ETF metrics
    logger.info('Test 2: Checking ETF metrics');
    const latestMetrics = await etfMetricsRepo.findLatestByInstrument(testEtf.id);
    if (latestMetrics) {
      logger.info({
        nav: latestMetrics.nav?.toString(),
        premium: latestMetrics.premium?.toString(),
        activeApCount: latestMetrics.activeApCount,
        asOfDate: latestMetrics.asOfDate,
      }, 'Found latest metrics');
    } else {
      logger.warn('No metrics found for test ETF. Run enrichment job first.');
    }

    // Test 3: Check AP details
    logger.info('Test 3: Checking AP details');
    const apDetails = await etfApRepo.findLatestByInstrument(testEtf.id);
    logger.info({ count: apDetails.length }, 'Found AP details');
    if (apDetails.length > 0) {
      logger.info({ apNames: apDetails.slice(0, 3).map(ap => ap.apName) }, 'Sample APs');
    }

    // Test 4: Premium/discount statistics
    logger.info('Test 4: Checking premium/discount statistics');
    const stats = await navDataService.getPremiumDiscountStats(testEtf.id, 60);
    if (stats) {
      logger.info({
        mean: stats.mean.toFixed(2),
        stdDev: stats.stdDev.toFixed(2),
        current: stats.current.toFixed(2),
        zScore: stats.zScore.toFixed(2),
      }, 'Premium/discount statistics');
    } else {
      logger.warn('Insufficient data for statistics');
    }

    // Test 5: Run arbitrage breakdown generator
    logger.info('Test 5: Testing arbitrage breakdown generator');
    const arbGenerator = new ArbitrageBreakdownGenerator(instrumentRepo, navDataService);
    const arbSignals = await arbGenerator.generate({
      currentTime: new Date(),
      lookbackWindowMs: 0,
    });
    logger.info({ count: arbSignals.length }, 'Generated arbitrage breakdown signals');
    if (arbSignals.length > 0) {
      const sample = arbSignals[0];
      logger.info({
        signalType: sample.signalType,
        severity: sample.severity,
        score: sample.score,
        reason: sample.reason,
      }, 'Sample signal');
    }

    // Test 6: Run AP fragility generator
    logger.info('Test 6: Testing AP fragility generator');
    const apGenerator = new APFragilityGenerator(instrumentRepo, etfMetricsRepo);
    const apSignals = await apGenerator.generate({
      currentTime: new Date(),
      lookbackWindowMs: 0,
    });
    logger.info({ count: apSignals.length }, 'Generated AP fragility signals');
    if (apSignals.length > 0) {
      const sample = apSignals[0];
      logger.info({
        signalType: sample.signalType,
        severity: sample.severity,
        score: sample.score,
        reason: sample.reason,
      }, 'Sample signal');
    }

    logger.info('All tests completed successfully');
  } catch (error) {
    logger.error({ error }, 'Test failed');
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
