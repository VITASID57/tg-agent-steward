import assert from 'node:assert/strict';
import test from 'node:test';
import { inQuietHours, randomBounds, WakeService } from '../src/wake/wake-service.mjs';

function memoryFile(initial) { let value = structuredClone(initial); return { async read() { return structuredClone(value); }, async write(next) { value = structuredClone(next); }, value() { return value; } }; }
function bot() { return { id: 'bot', enabled: true, telegram: { allowedChatIds: ['42'] }, wake: { enabled: true, targetChatId: '42', intervalMinutes: 5,
  cooldownMinutes: 5, dailyLimit: 1, quietStart: '23:00', quietEnd: '08:00', prompt: 'wake' } }; }

test('wake scheduler lets the model stay silent and applies a daily sent-message limit', async () => {
  let now = new Date('2026-11-07T10:00:00'); let calls = 0; const file = memoryFile({ bots: {} });
  const service = new WakeService({ controlPlaneStore: { async get() { return { bots: [bot()] }; } }, stateFile: file, now: () => now,
    send: async () => ({ sent: ++calls !== 1 }), logger: { error() {} } });
  await service.tick(); assert.equal(file.value().bots.bot.count, 0); assert.equal(file.value().bots.bot.lastResult, 'silent');
  now = new Date('2026-11-07T10:05:00'); await service.tick(); assert.equal(file.value().bots.bot.count, 1);
  now = new Date('2026-11-07T12:00:00'); await service.tick(); assert.equal(calls, 2);
});

test('quiet hours work across midnight', () => {
  assert.equal(inQuietHours(new Date('2026-11-07T23:30:00'), '23:00', '08:00'), true);
  assert.equal(inQuietHours(new Date('2026-11-07T07:30:00'), '23:00', '08:00'), true);
  assert.equal(inQuietHours(new Date('2026-11-07T12:00:00'), '23:00', '08:00'), false);
});

test('random wake schedules a fresh time after every due run', async () => {
  let now = new Date('2026-11-07T10:00:00Z'); const calls = []; const file = memoryFile({ bots: {} });
  const randomBot = { ...bot(), channel: { type: 'telegram' }, wake: { ...bot().wake,
    scheduleMode: 'random', randomMinMinutes: 10, randomMaxMinutes: 20, dailyLimit: 3 } };
  const service = new WakeService({ controlPlaneStore: { async get() { return { bots: [randomBot] }; } }, stateFile: file,
    now: () => now, random: () => 0.5, send: async (...args) => { calls.push(args); return { sent: true }; }, logger: { error() {} } });
  await service.tick();
  assert.equal(file.value().bots.bot.nextAttemptAt, '2026-11-07T10:15:00.000Z'); assert.equal(calls.length, 0);
  now = new Date('2026-11-07T10:14:00Z'); await service.tick(); assert.equal(calls.length, 0);
  now = new Date('2026-11-07T10:15:00Z'); await service.tick();
  assert.equal(calls.length, 1); assert.equal(file.value().bots.bot.nextAttemptAt, '2026-11-07T10:30:00.000Z');
});

test('wechat wake uses its own allowlist and passes the channel to the sender', async () => {
  const file = memoryFile({ bots: {} }); let context;
  const wxBot = { id: 'wx', enabled: true, channel: { type: 'wechat-clawbot' }, telegram: { allowedChatIds: [] },
    wechat: { allowedUserIds: ['user-1'] }, wake: { enabled: true, targetChatId: 'user-1', scheduleMode: 'fixed',
      intervalMinutes: 5, cooldownMinutes: 5, dailyLimit: 1, quietStart: '23:00', quietEnd: '08:00', prompt: 'wake' } };
  const service = new WakeService({ controlPlaneStore: { async get() { return { bots: [wxBot] }; } }, stateFile: file,
    now: () => new Date('2026-11-07T10:00:00'), send: async (_id, _target, _prompt, value) => { context = value; return { sent: true }; } });
  await service.tick(); assert.equal(context.channel, 'wechat-clawbot'); assert.equal(file.value().bots.wx.count, 1);
});

test('random bounds are safe when the user enters maximum before minimum', () => {
  assert.deepEqual(randomBounds({ randomMinMinutes: 120, randomMaxMinutes: 45 }), [45, 120]);
});

test('a random wake due inside quiet hours is rescheduled instead of firing at the boundary', async () => {
  const now = new Date('2026-11-07T23:05:00'); const file = memoryFile({ bots: { bot: {
    date: '2026-11-07', count: 0, scheduleKey: 'random:10:20', nextAttemptAt: new Date('2026-11-07T23:00:00').toISOString(),
  } } }); let calls = 0;
  const randomBot = { ...bot(), channel: { type: 'telegram' }, wake: { ...bot().wake,
    scheduleMode: 'random', randomMinMinutes: 10, randomMaxMinutes: 20 } };
  const service = new WakeService({ controlPlaneStore: { async get() { return { bots: [randomBot] }; } }, stateFile: file,
    now: () => now, random: () => 0, send: async () => { calls += 1; return { sent: true }; } });
  await service.tick(); assert.equal(calls, 0);
  assert.equal(file.value().bots.bot.nextAttemptAt, new Date('2026-11-07T23:15:00').toISOString());
});

test('failed wake delivery does not consume the daily success quota', async () => {
  const file = memoryFile({ bots: {} }); const service = new WakeService({
    controlPlaneStore: { async get() { return { bots: [bot()] }; } }, stateFile: file,
    now: () => new Date('2026-11-07T10:00:00'), send: async () => { throw new Error('expired context'); }, logger: { error() {} },
  });
  await service.tick(); assert.equal(file.value().bots.bot.count, 0); assert.equal(file.value().bots.bot.lastResult, 'failed');
});

test('wake status exposes scheduling state without exposing the target id', async () => {
  const file = memoryFile({ bots: { bot: { date: '2026-11-07', count: 1, lastAttemptAt: '2026-11-07T09:55:00.000Z',
    lastSentAt: '2026-11-07T09:55:00.000Z', lastResult: 'sent', nextAttemptAt: '2026-11-07T10:10:00.000Z' } } });
  const service = new WakeService({ controlPlaneStore: { async get() { return { bots: [bot()] }; } }, stateFile: file,
    now: () => new Date('2026-11-07T10:00:00Z'), send: async () => ({ sent: true }) });
  const status = await service.status('bot');
  assert.equal(status.todayCount, 1); assert.equal(status.lastResult, 'sent'); assert.equal(status.targetChatId, undefined);
  assert.equal(status.nextAttemptAt, '2026-11-07T10:00:00.000Z');
});
