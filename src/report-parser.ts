/**
 * Parse markdown report into opening, cards, and sources.
 * Shared by API, DB reports, and CLI scripts.
 */

export function parseReportToCards(reportMarkdown: string): {
  opening: string;
  cards: Array<{ title: string; content: string; emoji?: string }>;
  sources: string[];
} {
  const sourcesRegex = /^##\s+Sources\s*$/m;
  const sourcesMatch = reportMarkdown.match(sourcesRegex);
  const sourcesIndex = sourcesMatch ? sourcesMatch.index! : reportMarkdown.length;

  const mainContent = reportMarkdown.substring(0, sourcesIndex).trim();
  const sourcesSection = sourcesMatch
    ? reportMarkdown.substring(sourcesIndex).trim()
    : '';

  const sources: string[] = [];
  if (sourcesSection) {
    const sourceLines = sourcesSection.split('\n').slice(1);
    for (const line of sourceLines) {
      const match = line.match(/^-\s*(.+)$/);
      if (match) sources.push(match[1].trim());
    }
  }

  // Only treat ## as card header when followed by an emoji (our card format: ## 📰 Title)
  // So "## Summary" in the opening stays as a headline, not a card.
  const cardHeaders: Array<{ index: number; emoji?: string; title: string }> = [];
  let match;
  const headerRegexWithHash = /^##\s*([^\s]+)?\s*(.+)$/gm;
  while ((match = headerRegexWithHash.exec(mainContent)) !== null) {
    const firstToken = match[1];
    const hasEmoji = firstToken && /[\p{Emoji}]/u.test(firstToken);
    if (!hasEmoji) continue;
    const title = match[2].trim();
    if (title.toUpperCase() === 'TLDR' || title.toUpperCase().includes('TLDR'))
      continue;
    cardHeaders.push({ index: match.index!, emoji: firstToken, title });
  }

  if (cardHeaders.length === 0) {
    const headerRegexWithoutHash = /^([\p{Emoji}])\s+(.+)$/gmu;
    while ((match = headerRegexWithoutHash.exec(mainContent)) !== null) {
      cardHeaders.push({
        index: match.index!,
        emoji: match[1],
        title: match[2].trim(),
      });
    }
  }

  const opening =
    cardHeaders.length > 0
      ? mainContent.substring(0, cardHeaders[0].index).trim()
      : mainContent.trim();

  const cards: Array<{ title: string; content: string; emoji?: string }> = [];
  for (let i = 0; i < cardHeaders.length; i++) {
    const startIndex = cardHeaders[i].index;
    const endIndex =
      i < cardHeaders.length - 1
        ? cardHeaders[i + 1].index
        : mainContent.length;
    const cardContent = mainContent.substring(startIndex, endIndex).trim();
    const contentLines = cardContent.split('\n');
    const content = contentLines.slice(1).join('\n').trim();
    cards.push({
      title: cardHeaders[i].title,
      content,
      emoji: cardHeaders[i].emoji,
    });
  }

  return { opening, cards, sources };
}
