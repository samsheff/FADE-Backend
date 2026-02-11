/**
 * Decode HTML entities including numeric character references.
 * Properly handles both decimal (&#65;) and hex (&#x41;) formats,
 * along with named entities.
 */
export function decodeHtmlEntities(text: string): string {
  // Named HTML entities
  const namedEntities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
    '&ldquo;': '\u201C', // left double quote
    '&rdquo;': '\u201D', // right double quote
    '&lsquo;': '\u2018', // left single quote
    '&rsquo;': '\u2019', // right single quote
    '&mdash;': '\u2014', // em dash
    '&ndash;': '\u2013', // en dash
    '&hellip;': '\u2026', // horizontal ellipsis
  };

  return text.replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));/gi, (match, hex, dec, named) => {
    // Hex numeric entity: &#x41;
    if (hex) {
      const charCode = parseInt(hex, 16);
      return String.fromCharCode(charCode);
    }

    // Decimal numeric entity: &#65;
    if (dec) {
      const charCode = parseInt(dec, 10);
      return String.fromCharCode(charCode);
    }

    // Named entity: &amp;
    if (named) {
      const lowerMatch = match.toLowerCase();
      return namedEntities[lowerMatch] || match;
    }

    return match;
  });
}
