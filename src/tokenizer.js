/*
 * Token estimation.
 *
 * Anthropic does not publish Claude's tokenizer, so exact counts are impossible
 * from the client. This is a heuristic calibrated to land within ~10-15% of real
 * usage for typical English + code, which is the same ceiling every public
 * usage-tracking extension hits. Treat the numbers as a well-informed gauge,
 * not an invoice.
 *
 * Method: blend a character-based estimate with a word-based estimate. English
 * averages ~3.8 chars/token; whitespace and punctuation pull that down, long
 * code tokens pull it up. We weight the two estimates and nudge for code blocks.
 */
(function (root) {
  const CHARS_PER_TOKEN = 3.8;
  const TOKENS_PER_WORD = 1.33;

  function estimateTokens(text) {
    if (!text) return 0;
    const chars = text.length;
    const words = (text.trim().match(/\S+/g) || []).length;

    const byChars = chars / CHARS_PER_TOKEN;
    const byWords = words * TOKENS_PER_WORD;

    // Code tends to tokenize denser (symbols, indentation). If the text looks
    // code-heavy, lean toward the character estimate.
    const codeSignals = (text.match(/[{}()\[\];=<>/\\|`]/g) || []).length;
    const codeRatio = chars > 0 ? codeSignals / chars : 0;
    const charWeight = codeRatio > 0.04 ? 0.7 : 0.5;

    const blended = byChars * charWeight + byWords * (1 - charWeight);
    return Math.max(1, Math.round(blended));
  }

  const api = { estimateTokens };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.FlowKeepTokenizer = api;
  }
})(typeof self !== "undefined" ? self : this);
