/** `settings.output-alert` namespace dictionaries (the completion-chime row's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  title: '会话完成提示音',
  description: '离开页面时，会话完成播放一声提示音',
} satisfies Record<string, string>

/** The settings.output-alert namespace key union. */
export type OutputAlertLocaleKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  title: 'Session completion chime',
  description: 'Plays a short chime when a session finishes while you are away',
} satisfies Record<OutputAlertLocaleKey, string>
