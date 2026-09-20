import { definePluginManifest } from '@hexcrawl/shared';

/**
 * EXAMPLE PLUGIN — a per-character pool of special dice.
 *
 * Shows: a panel for both roles, DM settings, per-character storage, server
 * side dice, the game log, an optional wiki log page, and live refresh.
 * Copy this folder as the starting point for "a character resource with its
 * own rolls" (see ../AGENTS.md).
 */
export default definePluginManifest({
  id: 'example-fate-dice',
  name: 'Fate Dice (example)',
  version: '1.0.0',
  description:
    'Each character holds a small pool of fate dice to spend. Rolls go to the game log and, optionally, a wiki log page.',
  usesWiki: true,
  panels: [
    {
      id: 'main',
      icon: '🎲',
      label: 'Fate',
      title: 'Fate Dice',
      hint: 'Spend a fate die and see what the pool has left',
    },
  ],
  config: [
    { key: 'poolSize', label: 'Dice per character', type: 'number', default: 3, min: 1, max: 20 },
    {
      key: 'dieSides',
      label: 'Die',
      type: 'select',
      default: '6',
      options: ['4', '6', '8', '10', '12', '20'].map((n) => ({ value: n, label: `d${n}` })),
    },
    {
      key: 'logPage',
      label: 'Wiki log page',
      type: 'text',
      default: '',
      placeholder: 'Fate Dice Log',
      help: 'Every roll is appended here as a bullet. Leave blank to keep rolls in the app only.',
    },
    { key: 'announce', label: 'Pop a toast for the whole table on each roll', type: 'boolean', default: true },
  ],
});
