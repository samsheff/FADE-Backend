import { EntityClassificationService } from './src/services/entity/entity-classification.service.js';
import { InstrumentRepository } from './src/adapters/database/repositories/instrument.repository.js';
import { createPrismaClient } from './src/adapters/database/client.js';

async function test() {
  // Initialize DB
  createPrismaClient();
  
  const instrumentRepo = new InstrumentRepository();
  const classificationService = new EntityClassificationService();
  
  // Find first instrument
  const result = await instrumentRepo.findMany({ limit: 5 });
  
  console.log(`Found ${result.total} instruments in database`);
  
  if (result.instruments.length > 0) {
    const instrument = result.instruments[0];
    console.log(`\nTesting with: ${instrument.name} (${instrument.symbol})`);
    console.log(`CIK: ${instrument.identifiers?.find(i => i.type === 'CIK')?.value || 'N/A'}`);
    
    // Test classification
    const classification = await classificationService.classifyInstrument(instrument.id);
    
    if (classification) {
      console.log('\nClassification result:');
      console.log(`  Industry: ${classification.industry}`);
      console.log(`  Sector: ${classification.sector}`);
      console.log(`  Confidence: ${classification.confidence.toFixed(2)}`);
      console.log(`  Rationale: ${classification.rationale}`);
    }
  } else {
    console.log('No instruments found - database may be empty');
  }
  
  process.exit(0);
}

test().catch((error) => {
  console.error('Test failed:', error);
  process.exit(1);
});
