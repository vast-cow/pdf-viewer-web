export const themeOptions = ["light", "dark", "system"] as const;
export type Theme = typeof themeOptions[number];

export interface Preferences {
  theme: Theme;
  inverted: boolean;
}

export interface PreferenceStore {
  read(): Promise<Partial<Record<keyof Preferences, unknown>>>;
  write<K extends keyof Preferences>(key: K, value: Preferences[K]): Promise<void>;
}

export const preferenceKeys = ["theme", "inverted"] as const satisfies readonly (keyof Preferences)[];

export function readPreferences(raw: Partial<Record<keyof Preferences, unknown>>): Preferences {
  return {
    theme: themeOptions.find(theme => theme === raw.theme) ?? "system",
    inverted: raw.inverted === true,
  };
}
