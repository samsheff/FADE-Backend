import { describe, it, expect, beforeEach } from '@jest/globals';
import { TranscriptsParserService } from '../transcripts-parser.service';

describe('TranscriptsParserService', () => {
  let service: TranscriptsParserService;

  beforeEach(() => {
    service = new TranscriptsParserService();
  });

  describe('section splitting', () => {
    it('should split prepared remarks from Q&A', () => {
      const content = `
        John Smith -- CEO
        Thank you for joining us today.

        QUESTION-AND-ANSWER SESSION

        Analyst -- Morgan Stanley
        Can you discuss the outlook?
      `;

      const result = service['splitSections'](content);

      expect(result.preparedRemarks).toContain('Thank you for joining');
      expect(result.qaSession).toContain('Can you discuss');
    });

    it('should handle transcript with no Q&A marker', () => {
      const content = 'Just prepared remarks here.';
      const result = service['splitSections'](content);

      expect(result.preparedRemarks).toBe(content.trim());
      expect(result.qaSession).toBe('');
    });
  });

  describe('speaker identification', () => {
    it('should identify CEO and CFO', () => {
      const content = `
        John Smith -- Chief Executive Officer
        Jane Doe -- Chief Financial Officer
      `;

      const speakers = service['identifySpeakers'](content);

      expect(speakers['John Smith']).toBe('CEO');
      expect(speakers['Jane Doe']).toBe('CFO');
    });

    it('should normalize titles', () => {
      const content = 'Bob Johnson - President and CEO';
      const speakers = service['identifySpeakers'](content);

      expect(speakers['Bob Johnson']).toBe('CEO');
    });
  });

  describe('word counting', () => {
    it('should count words correctly', () => {
      const text = 'This is a test transcript with ten words here.';
      const count = service['countWords'](text);

      expect(count).toBe(10);
    });

    it('should handle empty text', () => {
      expect(service['countWords']('')).toBe(0);
      expect(service['countWords']('   ')).toBe(0);
    });
  });
});
