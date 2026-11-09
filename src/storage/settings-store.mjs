import { normalizeSettings } from '../config/validate.mjs';

export class SettingsStore {
  constructor(file) {
    this.file = file;
  }

  async get() {
    return normalizeSettings(await this.file.read());
  }

  async put(value) {
    return this.file.write(normalizeSettings(value));
  }

  async patch(value) {
    const current = await this.get();
    return this.put(deepMerge(current, value));
  }
}

function deepMerge(base, patch) {
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value && typeof value === 'object' && !Array.isArray(value) && typeof result[key] === 'object') {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}
