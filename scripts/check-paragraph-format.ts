import { pool } from '../src/db/client';
import { getReportCards } from '../src/db/reports';

async function checkParagraphFormat() {
  if (!pool) {
    console.log('❌ Database not connected');
    process.exit(1);
  }

  try {
    const latest = await getReportCards();
    if (!latest || latest.cards.length === 0) {
      console.log('⚠️  No cards found');
      process.exit(1);
    }

    console.log(`📊 Latest report: ${latest.runId}`);
    console.log(`   Cards: ${latest.cards.length}\n`);

    // Check first card
    const card = latest.cards[0];
    console.log(`=== CARD: "${card.title}" ===\n`);

    // Show raw content with visible newlines
    console.log('RAW CONTENT (first 1000 chars with visible newlines):');
    const visible = card.content
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .substring(0, 1000);
    console.log(visible);
    console.log('\n');

    // Analyze paragraph breaks
    const doubleNewlines = (card.content.match(/\n\n/g) || []).length;
    const singleNewlines = (card.content.match(/\n/g) || []).length;
    const tripleNewlines = (card.content.match(/\n\n\n/g) || []).length;

    console.log('PARAGRAPH BREAK ANALYSIS:');
    console.log(`   Double newlines (\\n\\n): ${doubleNewlines}`);
    console.log(`   Single newlines (\\n): ${singleNewlines}`);
    console.log(`   Triple newlines (\\n\\n\\n): ${tripleNewlines}`);

    // Split by double newlines to show paragraphs
    const paragraphs = card.content.split(/\n\n+/).filter(p => p.trim().length > 0);
    console.log(`\n   Detected ${paragraphs.length} paragraphs (split by \\n\\n+)`);

    // Show first few paragraphs
    console.log('\n=== FIRST 3 PARAGRAPHS (split by \\n\\n) ===');
    paragraphs.slice(0, 3).forEach((para, i) => {
      console.log(`\n[Paragraph ${i + 1}] (${para.length} chars)`);
      console.log('─'.repeat(60));
      console.log(para.trim());
      console.log('─'.repeat(60));
    });

    // Show actual content format (first 800 chars)
    console.log('\n=== ACTUAL CONTENT FORMAT (first 800 chars) ===');
    console.log(card.content.substring(0, 800));
    console.log('...\n');

    // Check for mini-headlines pattern
    const miniHeadlinePattern = /^([A-Z][^.]{3,30}\.)\s*\n\n/;
    const hasMiniHeadlines = miniHeadlinePattern.test(card.content);
    console.log(`MINI-HEADLINES DETECTED: ${hasMiniHeadlines ? '✅' : '❌'}`);

    if (hasMiniHeadlines) {
      const matches = card.content.match(/^([A-Z][^.]{3,30}\.)\s*\n\n/gm);
      if (matches) {
        console.log(`   Found ${matches.length} mini-headlines:`);
        matches.slice(0, 5).forEach((m, i) => {
          console.log(`   ${i + 1}. "${m.trim()}"`);
        });
      }
    }

    // Extract TLDR section to show structure
    const tldrMatch = card.content.match(/^###\s*TLDR\s*\n(.*?)(?=\n\n[A-Z]|\n\n###|$)/s);
    const tldrSection = tldrMatch ? tldrMatch[1].trim() : null;
    
    console.log('\n=== TLDR SECTION EXTRACTION ===');
    if (tldrSection) {
      console.log('TLDR found:');
      console.log(tldrSection);
      
      // Extract bullet points
      const bulletPoints = tldrSection
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.startsWith('-') || line.startsWith('•'))
        .map(line => line.replace(/^[-•]\s*/, '').trim());
      
      console.log(`\nExtracted ${bulletPoints.length} bullet points:`);
      bulletPoints.forEach((bp, i) => {
        console.log(`  ${i + 1}. ${bp}`);
      });
    } else {
      console.log('No TLDR section found');
    }
    
    // Show content without TLDR
    const contentWithoutTLDR = card.content
      .replace(/^###\s*TLDR\s*\n.*?(?=\n\n[A-Z]|\n\n###|$)/s, '')
      .trim();
    
    console.log('\n=== CONTENT WITHOUT TLDR (first 500 chars) ===');
    console.log(contentWithoutTLDR.substring(0, 500));
    console.log('...\n');

    // iOS parsing recommendation
    console.log('\n=== iOS APP PARSING RECOMMENDATION ===');
    console.log('Structure:');
    console.log('1. Title: Already separate in DB (card.title)');
    console.log('2. TLDR: Extract bullet points from "### TLDR" section (each bullet on separate line, separated by \\n)');
    console.log('3. Body: Content after TLDR, split by \\n\\n for paragraphs');
    console.log('4. Mini-headlines: Each paragraph starts with headline + \\n + content');
    console.log('\nFORMAT DETAILS:');
    console.log('- Bullet points: Each on its own line, separated by SINGLE newline (\\n)');
    console.log('- Mini-headlines: Headline on line 1, SINGLE newline (\\n), then paragraph content');
    console.log('- Paragraphs: Separated by DOUBLE newlines (\\n\\n)');
    console.log('\nExample Swift code:');
    console.log(`
struct CardContent {
    let title: String
    let tldrBullets: [String]
    let bodyParagraphs: [Paragraph]
}

enum Paragraph {
    case regular(String)
    case withHeadline(headline: String, body: String)
}

func parseCard(cardTitle: String, cardContent: String) -> CardContent {
    // 1. Extract TLDR bullet points (each bullet on separate line, separated by \\n)
    var tldrBullets: [String] = []
    if let tldrRange = cardContent.range(of: #"^###\\s*TLDR\\s*\\n(.*?)(?=\\n\\n[A-Z]|\\n\\n###|$)"#, 
                                         options: [.regularExpression, .anchored]) {
        let tldrSection = String(cardContent[tldrRange])
        tldrBullets = tldrSection
            .components(separatedBy: "\\n")  // Split by single newline
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { $0.hasPrefix("-") || $0.hasPrefix("•") }
            .map { $0.replacingOccurrences(of: #"^[-•]\\s*"#, with: "", options: .regularExpression) }
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }
    
    // 2. Remove TLDR section from content
    let bodyContent = cardContent
        .replacingOccurrences(of: #"^###\\s*TLDR\\s*\\n.*?(?=\\n\\n[A-Z]|\\n\\n###|$)"#, 
                             with: "", 
                             options: [.regularExpression, .anchored])
        .trimmingCharacters(in: .whitespaces)
    
    // 3. Split body into paragraphs (separated by \\n\\n)
    let bodyParagraphs = bodyContent
        .components(separatedBy: "\\n\\n")  // Split by double newline
        .map { $0.trimmingCharacters(in: .whitespaces) }
        .filter { !$0.isEmpty }
        .map { paragraph -> Paragraph in
            // Check for mini-headline pattern (sentence ending with period, 3-30 chars)
            // Format: headline\\ncontent (single newline between headline and content)
            if let firstNewline = paragraph.range(of: "\\n") {
                let headline = String(paragraph[..<firstNewline.lowerBound])
                    .trimmingCharacters(in: .whitespaces)
                
                // Check if it looks like a mini-headline (3-30 chars, ends with period)
                if headline.count >= 3 && headline.count <= 30 && headline.hasSuffix(".") {
                    let bodyStart = paragraph.index(after: firstNewline.upperBound)
                    let body = String(paragraph[bodyStart...])
                        .trimmingCharacters(in: .whitespaces)
                    return .withHeadline(headline: headline, body: body)
                }
            }
            
            // Regular paragraph (no mini-headline detected)
            return .regular(paragraph)
        }
    
    return CardContent(
        title: cardTitle,
        tldrBullets: tldrBullets,
        bodyParagraphs: bodyParagraphs
    )
}
    `);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkParagraphFormat();
