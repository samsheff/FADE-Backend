import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('🌱 Seeding database...');

  // Clear existing data
  await prisma.orderbookSnapshot.deleteMany();
  await prisma.position.deleteMany();
  await prisma.trade.deleteMany();
  await prisma.market.deleteMany();

  // Create sample markets
  const markets = [
    {
      id: '0x1234567890abcdef1234567890abcdef12345678',
      question: 'Will Bitcoin reach $100k by end of 2026?',
      outcomes: ['Yes', 'No'],
      expiryDate: new Date('2026-12-31'),
      liquidity: '1500000.50',
      volume24h: '500000.25',
      categoryTag: 'crypto',
      marketSlug: 'bitcoin-100k-2026',
      active: true,
      tokens: {
        Yes: '0xtoken1111111111111111111111111111111111111',
        No: '0xtoken2222222222222222222222222222222222222',
      },
    },
    {
      id: '0xabcdef1234567890abcdef1234567890abcdef12',
      question: 'Will Ethereum ETF be approved in 2026?',
      outcomes: ['Yes', 'No'],
      expiryDate: new Date('2026-12-31'),
      liquidity: '800000.00',
      volume24h: '250000.00',
      categoryTag: 'crypto',
      marketSlug: 'ethereum-etf-2026',
      active: true,
      tokens: {
        Yes: '0xtoken3333333333333333333333333333333333333',
        No: '0xtoken4444444444444444444444444444444444444',
      },
    },
    {
      id: '0xfedcba0987654321fedcba0987654321fedcba09',
      question: 'Will Trump win the 2028 US Presidential Election?',
      outcomes: ['Yes', 'No'],
      expiryDate: new Date('2028-11-30'),
      liquidity: '2500000.00',
      volume24h: '1000000.00',
      categoryTag: 'politics',
      marketSlug: 'trump-2028-election',
      active: true,
      tokens: {
        Yes: '0xtoken5555555555555555555555555555555555555',
        No: '0xtoken6666666666666666666666666666666666666',
      },
    },
  ];

  for (const market of markets) {
    await prisma.market.create({
      data: market,
    });
    console.log(`✅ Created market: ${market.question}`);
  }

  console.log('✨ Seeding complete!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
