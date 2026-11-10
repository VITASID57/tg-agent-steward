export class TelegramClient {
  constructor(token, fetchImpl = fetch) {
    this.baseUrl = `https://api.telegram.org/bot${token}`;
    this.fileBaseUrl = `https://api.telegram.org/file/bot${token}`;
    this.fetch = fetchImpl;
  }

  async call(method, body = {}, signal) {
    const response = await this.fetch(`${this.baseUrl}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body), signal,
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(`Telegram ${method}: ${data.description ?? response.status}`);
    return data.result;
  }

  getMe(signal) { return this.call('getMe', {}, signal); }
  getUpdates(offset, signal) { return this.call('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] }, signal); }
  sendMessage(chatId, text, options = {}) { return this.call('sendMessage', { chat_id: chatId, text, ...options }); }
  sendTyping(chatId) { return this.call('sendChatAction', { chat_id: chatId, action: 'typing' }); }
  async downloadFile(fileId, signal) {
    const info = await this.call('getFile', { file_id: fileId }, signal);
    const response = await this.fetch(`${this.fileBaseUrl}/${info.file_path}`, { signal });
    if (!response.ok) throw new Error(`Telegram 文件下载失败：${response.status}`);
    return { data: Buffer.from(await response.arrayBuffer()), path: info.file_path };
  }
  sendVoice(chatId, audio, filename = 'voice.mp3') { return this.#upload('sendVoice', chatId, 'voice', audio, filename); }
  sendAudio(chatId, audio, filename = 'audio.wav') { return this.#upload('sendAudio', chatId, 'audio', audio, filename); }
  sendPhoto(chatId, image, filename = 'image.png', caption = '') { return this.#upload('sendPhoto', chatId, 'photo', image, filename, caption); }
  sendDocument(chatId, image, filename, caption = '') { return this.#upload('sendDocument', chatId, 'document', image, filename, caption); }

  async #upload(method, chatId, field, audio, filename, caption = '') {
    const form = new FormData(); form.set('chat_id', String(chatId));
    if (caption) form.set('caption', caption);
    form.set(field, new Blob([audio]), filename);
    const response = await this.fetch(`${this.baseUrl}/${method}`, { method: 'POST', body: form });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(`Telegram ${method}: ${data.description ?? response.status}`);
    return data.result;
  }
}
