/**
 * Distinguishable colors for polygon edges. Picked from a hand-tuned palette that
 * works on the bone-coloured background of the app and lines up with the QUBE accents.
 */
export const EDGE_PALETTE = [
  "#647d57", // qube green
  "#a17e4c", // qube gold
  "#5b87b8", // muted blue
  "#b86b6b", // muted red
  "#8669a8", // muted purple
  "#c2a13b", // ochre
  "#3f8a78", // teal
  "#a06a3a", // brown
  "#7a8b5e", // olive
  "#6a4c93", // violet
  "#d68a3c", // amber
  "#4f7f9a", // dusty blue
];

export function edgeColor(index: number): string {
  return EDGE_PALETTE[index % EDGE_PALETTE.length];
}
