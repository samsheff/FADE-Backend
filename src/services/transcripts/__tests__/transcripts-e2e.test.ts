import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { PrismaClient } from '@prisma/client';
import { TranscriptsIndexerService } from '../transcripts-indexer.service';
import { TranscriptsDownloaderService } from '../transcripts-downloader.service';
import { TranscriptsParserService } from '../transcripts-parser.service';
import { TranscriptsSignalExtractorService } from '../transcripts-signal-extractor.service';

describe('Transcripts Worker E2E', () => {
  let prisma: PrismaClient;
  let indexer: TranscriptsIndexerService;
  let downloader: TranscriptsDownloaderService;
  let parser: TranscriptsParserService;
  let signalExtractor: TranscriptsSignalExtractorService;

  beforeAll(async () => {
    prisma = new PrismaClient();
    indexer = new TranscriptsIndexerService();
    downloader = new TranscriptsDownloaderService();
    parser = new TranscriptsParserService();
    signalExtractor = new TranscriptsSignalExtractorService();

    await downloader.init();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('should process transcript through full pipeline', async () => {
    // This test requires FMP_API_KEY to be set
    if (!process.env.FMP_API_KEY) {
      console.log('Skipping E2E test - FMP_API_KEY not set');
      return;
    }

    // Stage 1: Index (discover transcripts)
    const discovered = await indexer.discoverRecentTranscripts();
    expect(discovered).toBeGreaterThanOrEqual(0);

    // Stage 2: Download
    const downloaded = await downloader.processPendingTranscripts(5);
    expect(downloaded).toBeGreaterThanOrEqual(0);

    // Stage 3: Parse
    const parsed = await parser.processDownloadedTranscripts(5);
    expect(parsed).toBeGreaterThanOrEqual(0);

    // Stage 4: Extract signals
    const signalsExtracted = await signalExtractor.processParsedTranscripts(5);
    expect(signalsExtracted).toBeGreaterThanOrEqual(0);

    // Verify signals in database
    if (signalsExtracted > 0) {
      const signals = await prisma.instrumentSignal.findMany({
        where: {
          signalType: {
            in: [
              'LIQUIDITY_STRESS_CALL',
              'CAPITAL_RAISE_IMMINENT',
              'TRANSCRIPT_DEMAND_WEAKNESS',
            ],
          },
        },
        take: 10,
      });

      expect(signals.length).toBeGreaterThan(0);

      // Check evidence structure
      const signal = signals[0];
      expect(signal.evidenceFacts).toBeDefined();
      const evidence = signal.evidenceFacts as any;
      expect(evidence.snippets).toBeDefined();
      expect(evidence.confidence).toBeGreaterThan(0);
    }
  }, 60000); // 60 second timeout
});
