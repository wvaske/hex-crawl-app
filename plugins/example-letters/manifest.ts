import { definePluginManifest } from '@hexcrawl/shared';

/**
 * EXAMPLE PLUGIN — in-game letters that become wiki pages.
 *
 * Shows: a form panel, one wiki page per submission plus an index page,
 * records that survive a wiki outage (saved first, published after, with a
 * retry), and a log line only the sender and the DM can see. Copy this folder
 * as the starting point for "players write something, the wiki keeps it"
 * (see ../AGENTS.md).
 */
export default definePluginManifest({
  id: 'example-letters',
  name: 'Letters (example)',
  version: '1.0.0',
  description: 'Players write in-game letters; each one becomes a wiki page and a line on an index page.',
  usesWiki: true,
  panels: [
    {
      id: 'main',
      icon: '✉️',
      label: 'Letters',
      title: 'Letters',
      hint: 'Write a letter in character and keep a record of what was sent',
    },
  ],
  config: [
    {
      key: 'pagePrefix',
      label: 'Wiki page prefix',
      type: 'text',
      default: 'Letters/',
      help: 'A letter is saved as “<prefix><sender> to <recipient> (<id>)”.',
    },
    {
      key: 'indexPage',
      label: 'Index page',
      type: 'text',
      default: 'Letters',
      help: 'Gets one bullet per letter, linking to its page. Blank for none.',
    },
  ],
});
