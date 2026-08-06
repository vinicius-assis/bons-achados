export const MIN_NOTE_LENGTH = 15;

export function isValidNote(note: string): boolean {
  return note.trim().length >= MIN_NOTE_LENGTH;
}
