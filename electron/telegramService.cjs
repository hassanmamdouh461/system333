const https = require('https');
const db = require('./database.cjs');
const orderRepository = require('./OrderRepository.cjs');

/**
 * Escape the five characters Telegram's HTML parse mode treats as markup. A branch name
 * or menu item containing '<', '>' or '&' otherwise fails the whole report with a 400
 * "can't parse entities" — and these strings come from user-editable settings and menus.
 */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Strip the bot token out of anything that will be logged or thrown. */
function redactToken(text, botToken) {
  if (!botToken) return String(text ?? '');
  return String(text ?? '').split(botToken).join('<redacted-token>');
}

/**
 * Send a generic message to Telegram using Bot API
 */
function sendTelegramMessage(botToken, chatId, text) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML'
    });

    const options = {
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${botToken}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 8000
    };

    const req = https.request(options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => {
        responseBody += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          // A non-JSON 200 (captive portal, proxy interception) used to throw
          // synchronously inside this listener: the promise never settled and the throw
          // surfaced as an uncaughtException in the Electron main process.
          try {
            resolve(JSON.parse(responseBody));
          } catch (e) {
            reject(new Error('Telegram returned a non-JSON response'));
          }
        } else {
          // Telegram echoes the request description in error bodies, so redact the token
          // before this message reaches a log.
          reject(new Error(`HTTP ${res.statusCode}: ${redactToken(responseBody, botToken).slice(0, 300)}`));
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(redactToken(err.message, botToken)));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Compile and send the daily sales report for the current branch to Telegram
 */
async function sendDailyReport({ ignoreEnabledFlag = false } = {}) {
  const settings = db.getSettings();
  
  // 1. Check if Telegram configuration exists
  const telegramConfigRaw = settings['engaz_telegram_config'];
  if (!telegramConfigRaw) {
    throw new Error('Telegram is not configured in settings');
  }

  let config;
  try {
    config = JSON.parse(telegramConfigRaw);
  } catch (e) {
    throw new Error('Failed to parse Telegram configuration');
  }

  const { botToken, chatId, enabled } = config;
  if (!botToken || !chatId) {
    throw new Error('Telegram Bot Token or Chat ID is missing');
  }
  // The flag was destructured but never checked here, so the manual/IPC path sent reports
  // for a configuration the user had switched off.
  if (!enabled && !ignoreEnabledFlag) {
    throw new Error('Telegram reporting is disabled in settings');
  }

  // 2. Fetch branch configuration for report header
  let branchName = 'Main Branch';
  const branchConfigRaw = settings['engaz_branch_config'];
  if (branchConfigRaw) {
    try {
      const branchConfig = JSON.parse(branchConfigRaw);
      branchName = branchConfig.branchName || branchName;
    } catch (e) {
      console.warn('[telegram] Branch config is not valid JSON; falling back to the default report header.');
    }
  }

  // 3. Retrieve daily statistics from SQLite database
  const stats = orderRepository.getDailyReportStats();

  // 4. Format the Telegram report in Arabic
  let message = `📅 <b>تقرير المبيعات اليومي لفرع: ${escapeHtml(branchName)}</b>\n`;
  message += `⏱️ تاريخ التقرير: <code>${escapeHtml(stats.date)}</code>\n\n`;

  message += `📊 <b>الملخص المالي لليوم:</b>\n`;
  message += `• عدد الطلبات الكلي: <b>${stats.totalOrders}</b> طلب\n`;
  message += `• إجمالي المبيعات (المحصلة): <b>${stats.totalRevenue.toFixed(2)}</b> ج.م\n`;
  message += `• إجمالي الآجل (غير مدفوع): <b>${stats.totalUnpaid.toFixed(2)}</b> / ج.م\n\n`;

  message += `💳 <b>تفاصيل طرق الدفع (المدفوعة):</b>\n`;
  message += `• نقدي (Cash): <b>${stats.cashRevenue.toFixed(2)}</b> ج.م 💵\n`;
  message += `• شبكة/بطاقة (Card): <b>${stats.cardRevenue.toFixed(2)}</b> ج.م 💳\n\n`;

  if (stats.itemsSold && stats.itemsSold.length > 0) {
    message += `☕ <b>الأصناف المباعة اليوم:</b>\n`;
    // Sort items by quantity sold descending
    const sortedItems = [...stats.itemsSold].sort((a, b) => b.quantity - a.quantity);
    for (const item of sortedItems) {
      message += `• ${escapeHtml(item.name)}: عدد <b>${item.quantity}</b>\n`;
    }
    message += `\n`;
  } else {
    message += `☕ <b>الأصناف المباعة اليوم:</b> لا توجد مبيعات مسجلة اليوم.\n\n`;
  }

  message += `✅ تم إرسال التقرير بنجاح من نظام <b>Engaz POS</b>`;

  // 5. Send message to Telegram
  return await sendTelegramMessage(botToken, chatId, message);
}

module.exports = {
  sendTelegramMessage,
  sendDailyReport
};
