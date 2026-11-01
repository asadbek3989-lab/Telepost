import { isAdminUser } from './auth.js';
import { deliverPost, resolveAppUrl } from './core.js';
import { deletePost, getPost, getChannel, listChannels, newChannel, saveChannel } from './store.js';
import { dm, fetchChannelInfo, tg } from './telegram.js';
import { escapeHtml } from '../../shared/telegramHtml.js';

async function onMessage(msg: any) {
  if (msg.chat?.type !== 'private' || !msg.from) return;
  const userId = String(msg.from.id);
  const text: string = msg.text || '';
  const cmd = text.split(/[\s@]/)[0].toLowerCase();
  const admin = await isAdminUser(userId);

  if (cmd === '/id') {
    await dm(userId, `Sizning Telegram ID: <code>${userId}</code>\n\nUni <b>ADMIN_IDS</b> ga qo'shing yoki egadan so'rang.`);
    return;
  }

  if (!admin) {
    await dm(userId, `⛔ Bu bot shaxsiy kanal boshqaruvi uchun.\nSizning ID: <code>${userId}</code> — administrator ro'yxatida yo'q.`);
    return;
  }

  if (cmd === '/kanallar') {
    const channels = await listChannels();
    if (!channels.length) {
      await dm(userId, "Hozircha kanal ulanmagan. Botni kanalingizga <b>administrator</b> qilib qo'shing — kanal avtomatik ulanadi.");
      return;
    }
    const lines = channels.map(
      (c) => `📣 <b>${escapeHtml(c.title)}</b>${c.username ? ` (@${c.username})` : ''}\n   👥 ${c.memberCount} • 🤖 Avtopilot: ${c.autopilot.enabled ? `yoqilgan (${c.autopilot.times.join(', ')})` : "o'chiq"}`
    );
    await dm(userId, lines.join('\n\n'));
    return;
  }

  if (cmd === '/help') {
    await dm(
      userId,
      "📝 <b>TelePost AI</b>\n\n/start — ilovani ochish\n/kanallar — ulangan kanallar\n/id — Telegram ID\n\nKanal qo'shish: botni kanalga administrator qilib qo'shing (Post Messages huquqi bilan)."
    );
    return;
  }

  // /start va boshqa har qanday matn
  const appUrl = await resolveAppUrl();
  if (!appUrl) {
    await dm(userId, "👋 Salom! Ilova manzili hali sozlanmagan. Brauzerda <code>/api/setup?key=CRON_SECRET</code> sahifasini bir marta oching.");
    return;
  }
  await dm(
    userId,
    `👋 Salom, <b>${escapeHtml(msg.from.first_name || 'admin')}</b>!\n\nTelePost AI — kanalingiz uchun AI post, rasm, reja va avtopilot.\nBoshlash uchun pastdagi tugmani bosing.`,
    { reply_markup: { inline_keyboard: [[{ text: '📝 TelePost ni ochish', web_app: { url: appUrl } }]] } }
  );
}

async function clearKeyboard(cb: any) {
  try {
    await tg('editMessageReplyMarkup', { chat_id: cb.message.chat.id, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } });
  } catch {
    /* eskirgan xabar */
  }
}

async function onCallback(cb: any) {
  const userId = String(cb.from?.id);
  const answer = (text: string, alert = false) => tg('answerCallbackQuery', { callback_query_id: cb.id, text, show_alert: alert }).catch(() => null);

  if (!(await isAdminUser(userId))) return void (await answer("Ruxsat yo'q", true));
  const [action, id] = String(cb.data || '').split(':');
  if (!id || !['ap', 'rj'].includes(action)) return void (await answer('Noma\'lum amal'));

  const post = await getPost(id);
  if (!post) {
    await clearKeyboard(cb);
    return void (await answer('Post topilmadi (allaqachon ko\'rib chiqilgan)', true));
  }

  if (action === 'rj') {
    if (post.status === 'sent') return void (await answer('Allaqachon kanalga yuborilgan', true));
    await deletePost(id);
    await clearKeyboard(cb);
    await answer("🗑 Rad etildi");
    return;
  }

  if (post.status === 'sent') {
    await clearKeyboard(cb);
    return void (await answer('Allaqachon yuborilgan'));
  }
  await answer('⏳ Yuborilmoqda...');
  try {
    const r = await deliverPost(id);
    await clearKeyboard(cb);
    if (r.status === 'sent') {
      await dm(userId, `✅ Kanalga yuborildi${r.link ? `: ${r.link}` : ''}`);
    } else {
      await dm(userId, `❌ Yuborilmadi: ${escapeHtml(r.error || 'xato')}`);
    }
  } catch (e: any) {
    await dm(userId, `⚠️ ${escapeHtml(e?.message || 'Xato')}`);
  }
}

async function onMyChatMember(u: any) {
  const chat = u.chat;
  if (!chat || !['channel', 'supergroup'].includes(chat.type)) return;
  const status = u.new_chat_member?.status;
  if (status !== 'administrator') return;
  const adderId = String(u.from?.id || '');
  if (!adderId || !(await isAdminUser(adderId))) return;

  try {
    const info = await fetchChannelInfo(String(chat.id));
    const existing = await getChannel(info.id);
    const channel = existing
      ? { ...existing, title: info.title, username: info.username, memberCount: info.memberCount, memberCountAt: info.memberCountAt }
      : newChannel({ ...info, addedBy: adderId, signature: info.username ? `👉 @${info.username}` : '' });
    await saveChannel(channel);
    await dm(adderId, `✅ <b>${escapeHtml(channel.title)}</b> kanali ulandi!\nEndi ilovani ochib, kanal yo'nalishini (niche) kiriting va birinchi postni yarating.`);
  } catch (e: any) {
    await dm(adderId, `⚠️ Kanalni ulab bo'lmadi: ${escapeHtml(e?.message || 'xato')}`);
  }
}

export async function handleUpdate(update: any) {
  try {
    if (update.message) await onMessage(update.message);
    else if (update.callback_query) await onCallback(update.callback_query);
    else if (update.my_chat_member) await onMyChatMember(update.my_chat_member);
  } catch (e) {
    console.error('webhook xatosi:', e);
  }
}
