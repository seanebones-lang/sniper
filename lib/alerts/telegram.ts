/**
 * Telegram Alerts (optional)
 * Used by the runner for trade notifications, errors, and status.
 */

import type { PaperFill } from '@/lib/execution/paper-simulator';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const ENABLED = !!(BOT_TOKEN && CHAT_ID);

export async function sendTelegramAlert(message: string, parseMode: 'HTML' | 'Markdown' = 'HTML') {
  if (!ENABLED) return;

  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: message,
        parse_mode: parseMode,
      }),
    });
  } catch (err) {
    console.error('[Telegram] Failed to send alert:', err);
  }
}

interface RealOrderAlert {
  side: string;
  size: number;
  price: string | number;
  platform: string;
  reason?: string;
}

interface DailySummaryStats {
  signals: number;
  fills: number;
  realOrders?: number;
}

export const alerts = {
  runnerStarted: () => sendTelegramAlert('🚀 <b>Sniper Runner Started</b>\n24/7 paper execution is now active.'),
  runnerStopped: () => sendTelegramAlert('🛑 <b>Sniper Runner Stopped</b>'),
  paperFill: (fill: PaperFill) => sendTelegramAlert(
    `📈 <b>Paper Fill</b>\n${fill.side} ${fill.size} @ ${(fill.price * 100).toFixed(1)}¢\n${fill.reason}`
  ),
  realOrder: (trade: RealOrderAlert) => sendTelegramAlert(
    `🔴 <b>REAL ORDER</b>\n${trade.side} ${trade.size} @ ${(parseFloat(String(trade.price)) * 100).toFixed(1)}¢ on ${trade.platform}\nReason: ${trade.reason || 'strategy'}`
  ),
  error: (msg: string) => sendTelegramAlert(`⚠️ <b>Runner Error</b>\n${msg}`),
  dailySummary: (stats: DailySummaryStats) => sendTelegramAlert(
    `📊 <b>Daily Sniper Summary</b>\nSignals: ${stats.signals}\nPaper fills: ${stats.fills}\nReal orders: ${stats.realOrders || 0}`
  ),
};
