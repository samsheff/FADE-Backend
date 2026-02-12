import { DocumentRepository } from '../../adapters/database/repositories/document.repository.js';
import { SignalRepository } from '../../adapters/database/repositories/signal.repository.js';
import { InstrumentRepository } from '../../adapters/database/repositories/instrument.repository.js';
import { TranscriptsStorage } from './storage.interface.js';
import { createTranscriptsStorage } from './storage.factory.js';
import { getEnvironment } from '../../config/environment.js';
import { getLogger } from '../../utils/logger.js';
import { DocumentRecord } from '../../types/document.types.js';
import { SignalType, SignalSeverity } from '../../types/edgar.types.js';
import {
  TranscriptEvidence,
  TranscriptSnippet,
  ParsedTranscript,
} from '../../types/transcripts.types.js';
import { Decimal } from '@prisma/client/runtime/library';
