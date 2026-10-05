export function getWaitlistCopy(count: number): string {
  return `${count} ${count === 1 ? "is" : "are"} waiting with you.`;
}
