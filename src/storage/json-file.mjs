import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export class JsonFile {
  constructor(path, fallback) {
    this.path = path;
    this.fallback = fallback;
    this.queue = Promise.resolve();
  }

  async read() {
    await this.queue;
    return this.#readNow();
  }

  async write(value) {
    await this.#enqueue(() => this.#writeNow(value));
    return value;
  }

  async update(mutator) {
    return this.#enqueue(async () => {
      const value = await this.#readNow();
      const next = await mutator(value);
      await this.#writeNow(next);
      return next;
    });
  }

  async #readNow() {
    try {
      return JSON.parse(await readFile(this.path, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return structuredClone(this.fallback);
      throw error;
    }
  }

  async #writeNow(value) {
    await mkdir(dirname(this.path), { recursive: true });
    const temp = `${this.path}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, this.path);
  }

  #enqueue(task) {
    const run = this.queue.then(task, task);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }
}
