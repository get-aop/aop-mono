export type NoteStatus = "todo" | "doing" | "done";

export interface Note {
  status: NoteStatus;
  title: string;
  tags: string[];
}

export const parseNotes = (input: string): Note[] =>
  input
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseNoteLine);

const parseNoteLine = (line: string): Note => {
  const [rawStatus, rawTitle, rawTags = ""] = line.split("|");
  if (!rawStatus || !rawTitle) {
    throw new Error(`Invalid note line: ${line}`);
  }

  return {
    status: normalizeStatus(rawStatus),
    title: rawTitle.trim(),
    tags: rawTags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
  };
};

const normalizeStatus = (value: string): NoteStatus => {
  switch (value.trim().toLowerCase()) {
    case "todo":
    case "doing":
    case "done":
      return value.trim().toLowerCase() as NoteStatus;
    default:
      throw new Error(`Unsupported note status: ${value}`);
  }
};
