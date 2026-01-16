// Test script to verify data saving feature in deepResearch

import { deepResearch, writeFinalReport } from '../src/deep-research';
import { PipelineDataSaver } from '../src/pipeline-data-saver';
import { CostTracker } from './cost-tracker';

async function testDataSaving() {
  console.log('🧪 Testing Data Saving Feature\n');

  const query = 'What happened with BlackBerry this week?';
  const breadth = 3;
  const depth = 2;

  console.log(`📝 Query: ${query}`);
  console.log(`📊 Breadth: ${breadth}`);
  console.log(`🔍 Depth: ${depth}\n`);

  // Initialize data saver
  const dataSaver = new PipelineDataSaver();
  await dataSaver.initialize();
  console.log(`📁 Saving research data to: ${dataSaver.getRunDir()}\n`);

  const startTime = Date.now();

  // Run deep research with data saving
  const { learnings, visitedUrls } = await deepResearch({
    query,
    breadth,
    depth,
    dataSaver,
    initialQuery: query,
    totalDepth: depth,
  });

  const totalTime = Date.now() - startTime;

  console.log(`\n✅ Research complete!`);
  console.log(`  Total time: ${(totalTime / 1000).toFixed(1)}s`);
  console.log(`  Learnings: ${learnings.length}`);
  console.log(`  URLs: ${visitedUrls.length}\n`);

  // Generate and save final report
  console.log('📝 Generating final report...\n');
  const report = await writeFinalReport({
    prompt: query,
    learnings,
    visitedUrls,
  });

  const reportPath = await dataSaver.saveFinalReport(report, learnings, visitedUrls);
  console.log(`✅ Report saved to: ${reportPath}\n`);

  // Save comprehensive summary
  const summaryPath = await dataSaver.saveComprehensiveSummary(
    query,
    depth,
    breadth,
    learnings,
    visitedUrls,
  );

  console.log('📈 Test Results:');
  console.log(`  Run ID: ${dataSaver.getRunId()}`);
  console.log(`  Run Directory: ${dataSaver.getRunDir()}`);
  console.log(`  Report: ${reportPath}`);
  console.log(`  Summary: ${summaryPath}\n`);

  // List files created
  const fs = await import('fs/promises');
  const path = await import('path');
  const runDir = dataSaver.getRunDir();
  
  try {
    const files = await fs.readdir(runDir, { withFileTypes: true });
    console.log('📂 Files Created:');
    for (const file of files) {
      if (file.isDirectory()) {
        console.log(`  📁 ${file.name}/`);
        const iterFiles = await fs.readdir(path.join(runDir, file.name));
        iterFiles.forEach(f => console.log(`     - ${f}`));
      } else {
        console.log(`  📄 ${file.name}`);
      }
    }
  } catch (error) {
    console.error('Error listing files:', error);
  }

  console.log('\n✅ Data saving test complete!');
}

testDataSaving().catch(console.error);
