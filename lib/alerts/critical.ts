import { alerts } from '@/lib/alerts/telegram';

/** Logs + Telegram for real-money critical events. */
export async function sendCriticalAlert(message: string, payload?: unknown) {
  console.error(`[CRITICAL ALERT] ${message}`, payload || '');
  try {
    await alerts.error(message);
  } catch {
    console.warn(`[CRITICAL ALERT] ${message}`);
  }
}
