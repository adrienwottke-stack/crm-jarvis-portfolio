// Shared by the existing game and its regression tests. No storage or CRM writes.
export const TUTORIAL_CARDS = Object.freeze(["navi", "doppelt", "kuend", "kaffee", "leads"]);

/** @param {Array<{id:string, L:{fx:Record<string,number>}, R:{fx:Record<string,number>}}>} cards
 * @param {string[]} choices */
export function replayTutorial(cards, choices) {
  if (!Array.isArray(choices) || choices.length > 5 || choices.some(side => side !== "L" && side !== "R")) throw new Error("Ungültiger Spielstand.");
  const deck = TUTORIAL_CARDS.map(id => {
    const card = cards.find(entry => entry.id === id);
    if (!card) throw new Error("Die Einstiegsrunde ist unvollständig.");
    return card;
  });
  const bars = { p: 50, z: 50, f: 50, s: 20 };
  choices.forEach((side, i) => {
    const effects = deck[i][side].fx;
    Object.keys(bars).forEach(key => { bars[key] = Math.min(100, Math.max(0, bars[key] + (effects[key] || 0))); });
  });
  return { deck, bars, index: choices.length, done: choices.length === 5 };
}
