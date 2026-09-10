import { useEffect, useState } from 'react';
const PREFIX = 'idle-pet.ui.v1.';
export function useUIState<T>(key: string, initial: T, validate: (value: unknown) => value is T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(PREFIX + key) ?? 'null');
      return validate(saved) ? saved : initial;
    } catch { return initial; }
  });
  useEffect(() => { localStorage.setItem(PREFIX + key, JSON.stringify(value)); }, [key, value]);
  return [value, setValue] as const;
}
export function clearUIState() {
  Object.keys(localStorage).filter(key => key.startsWith(PREFIX)).forEach(key => localStorage.removeItem(key));
}
