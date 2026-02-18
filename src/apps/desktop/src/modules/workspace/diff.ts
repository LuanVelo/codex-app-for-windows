export interface DiffLine {
  type: "same" | "added" | "removed";
  content: string;
}

export function buildLineDiff(original: string, updated: string): DiffLine[] {
  const a = original.split("\n");
  const b = updated.split("\n");
  const max = Math.max(a.length, b.length);
  const result: DiffLine[] = [];

  for (let i = 0; i < max; i += 1) {
    const left = a[i];
    const right = b[i];

    if (left === right) {
      if (left !== undefined) {
        result.push({ type: "same", content: left });
      }
      continue;
    }

    if (left !== undefined) {
      result.push({ type: "removed", content: left });
    }

    if (right !== undefined) {
      result.push({ type: "added", content: right });
    }
  }

  return result;
}
