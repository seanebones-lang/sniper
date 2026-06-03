import { setPaperBudgetSettings, getPaperBudgetSettings, clearPaperBudgetCache } from '../lib/settings/paper-budget';

async function main() {
  const saved = await setPaperBudgetSettings({
    paperBudgetUsd: 7,
    maxExposureUsd: 6,
    maxDailyLossUsd: 3,
  });
  console.log('saved:', saved);
  clearPaperBudgetCache();
  const loaded = await getPaperBudgetSettings();
  console.log('loaded:', loaded);
  if (loaded.paperBudgetUsd !== 7) {
    process.exit(1);
  }
  console.log('ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
