import { PrismaClient } from '@prisma/client';

async function fixTokenKeys() {
  const prisma = new PrismaClient();

  try {
    const markets = await prisma.market.findMany({
      select: {
        id: true,
        question: true,
        tokens: true,
        outcomeMapping: true,
      },
    });

    console.log(`Found ${markets.length} markets to process`);

    let fixedCount = 0;
    let skippedCount = 0;

    for (const market of markets) {
      const tokens = market.tokens as Record<string, string>;
      const outcomeMapping = market.outcomeMapping as { YES: string; NO: string } | null;

      // Check if tokens already use uppercase keys
      if (tokens['YES'] !== undefined && tokens['NO'] !== undefined) {
        skippedCount++;
        continue;
      }

      // Create new tokens object with uppercase keys
      const newTokens: Record<string, string> = {};

      if (outcomeMapping) {
        // Use outcome mapping to find the correct tokens
        const yesOriginal = outcomeMapping.YES;
        const noOriginal = outcomeMapping.NO;

        if (tokens[yesOriginal]) {
          newTokens['YES'] = tokens[yesOriginal];
        }
        if (tokens[noOriginal]) {
          newTokens['NO'] = tokens[noOriginal];
        }
      } else {
        // Fallback: normalize all keys to uppercase
        Object.entries(tokens).forEach(([key, value]) => {
          newTokens[key.toUpperCase()] = value;
        });
      }

      // Update the market
      await prisma.market.update({
        where: { id: market.id },
        data: { tokens: newTokens as any },
      });

      console.log(`✓ Fixed: ${market.question.slice(0, 60)}`);
      fixedCount++;
    }

    console.log(`\nComplete: ${fixedCount} fixed, ${skippedCount} already correct`);
  } catch (error) {
    console.error('Error fixing token keys:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixTokenKeys();
