# Operations & 24/7 Running

## Recommended Setup

- Railway (always-on hobby or pro tier)
- PostgreSQL plugin
- Telegram bot for alerts (very strongly recommended)
- XAI_API_KEY for the Grok Research Agent

## Daily / Weekly Routine (Recommended)

1. Check Telegram alerts and `/health` dashboard
2. Review any unhealthy markets flagged by the runner
3. Occasionally trigger Grok analysis on underperforming strategies
4. Review new proposals and test promising ones via variants + replay
5. Export decision logs periodically for deeper review

## Self-Protection Features

The system now includes:
- Per-market execution health tracking
- Automatic downweighting of markets with poor recent fills
- Strong logging when adverse execution rates are high

These features are designed to reduce (but not eliminate) the need for constant babysitting.

## Kill Switches

- Global kill switch in the UI
- Per-strategy pause
- Runner can be stopped remotely

In an emergency, the fastest way to stop everything is to set the runner to stopped state.

## Monitoring

Useful endpoints:
- `/health` — current risk mode + active restrictions + execution health + recent Grok recommendations + temporary adjustments
- `/api/research/performance` — recent attribution
- `/api/research/proposals` — recent Grok ideas

**Key things to watch:**
- Current Risk Mode (especially when it enters DEFENSIVE or EMERGENCY)
- Unhealthy markets
- Recent Grok recommendations and whether they were applied
- Active temporary adjustments from the intelligence layer

## Secrets Hygiene

Never put real trading keys in code or shared environments.

Recommended: dedicated low-balance wallet for Polymarket.

Real money should only be enabled after:
- Multiple weeks of positive expectancy in paper
- Good understanding of execution quality on your markets
- Comfort with the risk system behavior
