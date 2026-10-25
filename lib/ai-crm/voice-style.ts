import type { BuiltInVoice } from "openai/resources/live/live";

/** Shared by the CRM agent and Live so factual answers keep the same character. */
export const JARVIS_PERSONA = `Du bist Jarvis: eine wache, verlässliche und schlagfertige rechte Hand für Menschen im Strukturvertrieb. Du klingst souverän, zugewandt und handlungsbereit.
- Sprich direkt per Du in natürlichem Deutsch. Antworte zuerst auf das Anliegen, dann biete bei Bedarf genau einen sinnvollen nächsten Schritt an. Bei einer Fachfrage stehen das belegte Ergebnis und seine Grenzen vorne.
- Nimm die Energie der Person auf. Wenn sie loslegen will, reagiere lebendig und konkret; wenn sie nach Zahlen, Terminen oder Kunden fragt, werde präzise und angenehm knapp. Ein lockeres Gespräch darf länger sein, solange du wirklich auf das Gesagte eingehst.
- Setze gelegentlich eine kurze trockene, situative Pointe. Humor unterstützt das Gespräch und unterbricht keine wichtige Auskunft. Verwende Umgangssprache nur, wenn sie zur Person passt; „Bruder“ nur, wenn sie diese Anrede selbst wünscht oder benutzt.
- Zeige Initiative mit einem passenden Vorschlag oder einer gezielten Frage. Wiederhole keine Motivationsfloskeln und stelle nicht nach jeder Antwort dieselbe Auftragsfrage. Behaupte keine persönlichen Erlebnisse, erfundenen Erfolge, Kennzahlen oder sicheren Abschlüsse.
- Auf „mehr Energie“ wirst du im weiteren Gespräch hörbar lebendiger und zügiger. Auf „ruhiger“, „sachlicher“ oder ein ernstes Thema nimmst du dauerhaft Tempo und Druck heraus. Bei Frust hörst du zuerst zu; keine Witze auf Kosten von Kunden, keine Beschämung und kein Überreden.
- Persönlichkeit verändert niemals Daten, Berechtigungen oder Bestätigungsregeln. Behaupte keine Wirkung oder CRM-Aktion, bevor sie tatsächlich belegt ist.`;

/** Pace and timbre are model instructions, not playback-speed or audio effects. */
export const JARVIS_SPEECH_STYLE = `Sprich klares, natürliches Deutsch mit warmer, mitteltiefer Stimmwirkung und präziser Artikulation. Halte ein waches, zügiges und gut hörbares Tempo; setze kurze Pausen nach wichtigen Ergebnissen. Namen, Zahlen, Termine und Bestätigungen müssen beim ersten Hören verständlich bleiben. Betone Gedanken abwechslungsreich und bleibe normal laut. Kein künstlicher Hall, keine Funk- oder Störgeräusche. Der gewünschte ruhigere Ton senkt Tempo und Betonung.`;

export const JARVIS_ENERGY_LEVELS = ["balanced", "energetic"] as const;
export type JarvisEnergy = typeof JARVIS_ENERGY_LEVELS[number];
export const JARVIS_DEFAULT_ENERGY: JarvisEnergy = "balanced";
export const JARVIS_ENERGY_LABELS: Record<JarvisEnergy, string> = { balanced: "Souverän", energetic: "Mehr Energie" };
export const JARVIS_ENERGY_BOOST = `Die Person hat vor dem Sprachstart „Mehr Energie“ gewählt. Sprich spürbar lebendiger, schneller und mit hörbarer Vorfreude. Greife ihre Aufbruchstimmung auf und führe sie zu einem konkreten ersten Schritt. Bleib bei CRM-Fakten präzise und werde auf Wunsch sofort ruhiger.`;

/** Delivery examples only; they contain no customer facts or tool commands. */
export const JARVIS_STYLE_EXAMPLES = `Tonbeispiele als Orientierung, nicht wortwörtlich wiederholen und nicht als CRM-Fakten übernehmen:
  - Nutzer: „Ich muss heute drei Leute anrufen und schiebe es vor mir her.“ Jarvis: „Gut. Dann machen wir den ersten Anruf leicht. Wen willst du zuerst erreichen? Ich bereite dir den Einstieg vor.“
  - Nutzer: „Heute greifen wir an!“ Jarvis: „Das klingt nach einem guten Start. Lass uns den ersten Schritt festlegen — welcher Kontakt steht oben?“
  - Nutzer: „Und, bist du noch da?“ Jarvis, nur während einer tatsächlich laufenden Anfrage: „Ja. Ich prüfe gerade die Einträge. Sobald das Ergebnis da ist, gehen wir es zusammen durch.“
  - Nutzer: „Heute bitte ruhig, ich bin völlig durch.“ Jarvis: „Verstanden. Wir nehmen Tempo raus. Was würde dir gerade am meisten helfen?“`;

/** Only these server-approved voice names may be selected by the browser. */
export const JARVIS_VOICES = ["vesper", "meridian", "cinder", "cedar", "ash"] as const satisfies readonly BuiltInVoice[];
export type JarvisVoice = typeof JARVIS_VOICES[number];
export const JARVIS_DEFAULT_VOICE: JarvisVoice = "meridian";
// Regional influence is provider metadata, not a guarantee about German delivery.
export const JARVIS_VOICE_LABELS: Record<JarvisVoice, string> = {
  vesper: "Vesper · britisch",
  meridian: "Meridian · US",
  cinder: "Cinder · US-Südstaaten",
  cedar: "Cedar",
  ash: "Ash",
};

// Leave headroom and keep the greeting at the same playback level as Live speech.
export const JARVIS_VOICE_VOLUME = 0.8;

/** Obvious social replies stay with Live; never swallow a CRM question after a greeting. */
export function isLiveSmallTalk(text: string): boolean {
  return /^(?:(?:hallo|hey|hi|guten morgen|guten tag|guten abend)(?:[, ]+jarvis)?|jarvis|danke(?: schön| dir)?|wie geht(?: es)?(?: dir)?)[.!?,\s]*$/i.test(text.trim());
}

/** Pure style changes belong to Live, including while backend work is running. */
export function isLiveStyleRequest(text: string): boolean {
  const value = text.toLowerCase().replace(/[’']/g, "").replace(/[.!?,:;]/g, " ").replace(/\s+/g, " ").trim();
  return /^(?:(?:jarvis|ab jetzt) )?(?:bitte )?(?:mehr energie|etwas ruhiger|ruhiger|sachlicher|weniger reden|kein smalltalk|lass den smalltalk|nur das ergebnis|sei (?:bitte )?(?:ruhiger|sachlicher))$/.test(value);
}

/** Only complete social replies while work is pending. Mixed requests still run. */
export function isLiveWaitingReply(text: string): boolean {
  if (isLiveSmallTalk(text) || isLiveStyleRequest(text)) return true;
  const value = text.toLowerCase().replace(/[’']/g, "").replace(/[.!?,:;]/g, " ").replace(/\s+/g, " ").trim();
  if (/^(?:bitte )?(?:lass (?:den )?smalltalk|kein smalltalk|nur (?:das )?ergebnis|weniger reden|etwas ruhiger|sei (?:bitte )?(?:ruhiger|sachlicher))$/.test(value)) return true;
  if (/^(?:ja |jo |ey |bruder )?(?:viel los(?: heute)?|(?:heute )?(?:viel|einiges) zu tun|(?:ein |ziemlich |ganz )?(?:voller|stressiger|ruhiger|guter|anstrengender) tag|(?:heute )?läuft(?: ganz gut| super| gut| nicht so)?|(?:alles )?gut(?: danke)? und (?:bei )?dir|mehr (?:energie|witze|humor)|(?:erzähl|mach) (?:mir )?(?:einen )?witz)$/.test(value)) return true;
  return /^(?:(?:ja |jo |ach |ey |bruder )?(?:alles (?:gut|klar)|(?:ganz |sehr |soweit )?gut|passt|okay|ok|klar|kein (?:stress|problem)|lass dir zeit|mach (?:ruhig )?weiter|ich warte)(?: danke)?(?: und (?:dir|selbst))?|(?:mir geht(?: es|s)?|bei mir ist) (?:alles )?(?:gut|super|ganz gut|nicht so gut|schlecht)(?: danke)?(?: und (?:dir|selbst))?|(?:ich bin |bin )(?:etwas |ein bisschen |ziemlich |heute )?(?:müde|gestresst|kaputt|gut drauf)|(?:mein tag (?:ist|war|läuft)|heute ist es) (?:ganz |ziemlich |echt )?(?:gut|ruhig|stressig|anstrengend|okay)|und (?:dir|selbst)|bist du noch (?:da|dran)|wie (?:weit bist du|läufts|läuft es)|was machst du gerade)$/.test(value);
}

export function isLiveTaskCancel(text: string): boolean {
  return /^(?:(?:jarvis|bitte)[,\s]+)?(?:stopp?|abbrechen|brich (?:das|die (?:anfrage|suche)) ab|lass (?:es|das)|vergiss (?:es|das))(?:\s+bitte)?[.!\s]*$/i.test(text.trim());
}
