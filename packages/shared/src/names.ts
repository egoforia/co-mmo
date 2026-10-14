import { MAX_NAME_LENGTH, MIN_NAME_LENGTH } from './constants.ts';

/** Returns an error message, or null when the character name is valid. */
export function validateName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length < MIN_NAME_LENGTH || trimmed.length > MAX_NAME_LENGTH) {
    return `Names must be ${MIN_NAME_LENGTH} to ${MAX_NAME_LENGTH} characters.`;
  }
  if (!/^[\p{L}\p{N}][\p{L}\p{N} _'-]*$/u.test(trimmed)) {
    return 'Names may use letters, numbers, spaces, apostrophes, hyphens and underscores.';
  }
  return null;
}
