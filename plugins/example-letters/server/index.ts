import { z } from 'zod';
import {
  PluginError,
  actionsFor,
  defineServerPlugin,
  wikiEscape,
  wikiTitlePart,
  type PluginContext,
} from '@hexcrawl/server/plugin-api';
import manifest from '../manifest.js';

interface Config {
  pagePrefix: string;
  indexPage: string;
}
type Ctx = PluginContext<Config>;
const action = actionsFor<Config>();

/** Stored under `letter:<id>`; ids sort by time. */
interface Letter {
  id: string;
  characterId: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  gameDate: string;
  sentAt: number;
  wikiTitle: string;
  /** Null until the wiki accepted the page. */
  wikiUrl: string | null;
  wikiError: string | null;
}

const key = (id: string) => `letter:${id}`;

function letterWikitext(l: Letter): string {
  return [
    `''${wikiEscape(l.gameDate)}''`,
    '',
    `'''From:''' ${wikiEscape(l.from)}<br>`,
    `'''To:''' ${wikiEscape(l.to)}<br>`,
    `'''Subject:''' ${wikiEscape(l.subject)}`,
    '',
    '----',
    // <poem> keeps the writer's line breaks; the text itself stays inert.
    `<poem>${wikiEscape(l.body)}</poem>`,
    '',
    '[[Category:Letters]]',
  ].join('\n');
}

/**
 * Save first, publish second: the letter exists in the app whatever the wiki
 * does, and `publish` can be retried. Never make a player retype something
 * because a third-party service hiccuped.
 */
async function publish(ctx: Ctx, letter: Letter): Promise<Letter> {
  let next: Letter;
  try {
    const page = await ctx.wiki.write(letter.wikiTitle, letterWikitext(letter), {
      summary: `Letter from ${letter.from} to ${letter.to}`,
    });
    if (ctx.config.indexPage) {
      await ctx.wiki.append(
        ctx.config.indexPage,
        `\n* ${wikiEscape(letter.gameDate)} — [[${letter.wikiTitle}|${wikiEscape(`${letter.from} to ${letter.to}`)}]]`,
        { summary: `Index: letter from ${letter.from}` },
      );
    }
    next = { ...letter, wikiUrl: page.url, wikiError: null };
  } catch (err) {
    next = { ...letter, wikiError: err instanceof Error ? err.message : 'Wiki write failed' };
  }
  ctx.storage.set(key(next.id), next);
  ctx.notify('letters');
  return next;
}

export default defineServerPlugin({
  manifest,
  actions: {
    /** Newest first. The DM reads everything; a player reads their own character's letters. */
    list: action({
      handler: (ctx) => ({
        canPublish: ctx.wiki.status().canWrite,
        letters: ctx.storage
          .entries<Letter>('letter:')
          .map(([, letter]) => letter)
          .filter((l) => ctx.isDm || l.characterId === ctx.seat.characterId)
          .reverse(),
      }),
    }),

    send: action({
      input: z.object({
        characterId: z.string(),
        to: z.string().trim().min(1, 'Who is it for?').max(120),
        subject: z.string().trim().max(160).default(''),
        body: z.string().trim().min(1, 'The letter is empty').max(20_000),
      }),
      handler: async (ctx, input) => {
        const character = ctx.requireCharacterAccess(input.characterId);
        // Time-ordered id: storage lists keys sorted, so this is the timeline.
        const id = `${Date.now().toString(36)}${Math.floor(ctx.rng() * 36 ** 3).toString(36).padStart(3, '0')}`;
        const title = `${ctx.config.pagePrefix}${wikiTitlePart(character.name, 60)} to ${wikiTitlePart(input.to, 60)} (${id})`;
        const letter: Letter = {
          id,
          characterId: character.id,
          from: character.name,
          to: input.to,
          subject: input.subject,
          body: input.body,
          gameDate: ctx.gameDate(),
          sentAt: Date.now(),
          wikiTitle: title,
          wikiUrl: null,
          wikiError: null,
        };
        ctx.storage.set(key(id), letter);
        // Correspondence is private: the sender's seat and the DM, nobody else.
        ctx.log(`${character.name} sends a letter to ${input.to}`, {
          visibility: ctx.isDm ? 'dm' : ctx.seat.id,
          data: { letterId: id },
        });
        return publish(ctx, letter);
      },
    }),

    /** Retry the wiki half of a letter that was saved while the wiki was unavailable. */
    publish: action({
      input: z.object({ id: z.string() }),
      handler: async (ctx, input) => {
        const letter = ctx.storage.get<Letter>(key(input.id));
        if (!letter) throw new PluginError('Letter not found', 404);
        ctx.requireCharacterAccess(letter.characterId);
        if (letter.wikiUrl) return letter;
        return publish(ctx, letter);
      },
    }),

    /** DM: drop the app's record. The wiki page, if any, is left for the DM to deal with there. */
    remove: action({
      dmOnly: true,
      input: z.object({ id: z.string() }),
      handler: (ctx, input) => {
        ctx.storage.delete(key(input.id));
        ctx.notify('letters');
        return { ok: true };
      },
    }),
  },
});
