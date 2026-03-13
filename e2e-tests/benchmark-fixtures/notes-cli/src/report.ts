import type { Note } from "./notes.ts";

export const renderPlainReport = (notes: Note[]): string =>
  notes.map((note) => `- ${note.title}`).join("\n");
