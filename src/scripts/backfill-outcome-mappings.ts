import { PrismaClient } from '@prisma/client';
import { normalizeOutcomes } from '../utils/outcome-normalization.utils';

async function backfillOutcomeMappings() {
  const prisma = new PrismaClient();

  try {
    // Get all markets - we'll filter in memory since Prisma client may not have the field yet
    const marketsWithoutMapping = await prisma.market.findMany();

    console.log(`Found ${marketsWithoutMapping.length} markets without outcome mappings`);

    let successCount = 0;
    let failureCount = 0;

    for (const market of marketsWithoutMapping) {
      const outcomes = market.outcomes as string[];
      const mapping = normalizeOutcomes(outcomes, market.question);

      if (mapping) {
        await prisma.market.update({
          where: { id: market.id },
          data: { outcomeMapping: mapping as any }
        });
        console.log(`✓ ${market.question}: ${mapping.YES} / ${mapping.NO}`);
        successCount++;
      } else {
        console.warn(`✗ Could not map: ${market.question}`, outcomes);
        failureCount++;
      }
    }

    console.log(`\nBackfill complete: ${successCount} succeeded, ${failureCount} failed`);
  } catch (error) {
    console.error('Backfill error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

backfillOutcomeMappings();
