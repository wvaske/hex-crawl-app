import { z } from 'zod';
import {
  PluginError,
  actionsFor,
  defineServerPlugin,
  wikiEscape,
  type PluginContext,
} from '@hexcrawl/server/plugin-api';
import manifest from '../manifest.js';

interface Config {
  poolSize: number;
  dieSides: string;
  logPage: string;
  announce: boolean;
}
type Ctx = PluginContext<Config>;
const action = actionsFor<Config>();

interface Roll {
  at: number;
  gameDate: string;
  value: number;
  sides: number;
  reason: string;
}

/** Stored under `char:<characterId>`. */
interface Pool {
  spent: number;
  rolls: Roll[];
}

const HISTORY_KEPT = 20;
const poolKey = (characterId: string) => `char:${characterId}`;
const readPool = (ctx: Ctx, characterId: string): Pool =>
  ctx.storage.get<Pool>(poolKey(characterId)) ?? { spent: 0, rolls: [] };

export default defineServerPlugin({
  manifest,
  actions: {
    /**
     * What the panel renders. The DM sees every character; a player sees only
     * their own — per-viewer filtering is the action's job, there is no
     * snapshot filter for plugin data.
     */
    state: action({
      handler: (ctx) => {
        const visible = ctx.isDm ? ctx.characters : ctx.character ? [ctx.character] : [];
        return {
          poolSize: ctx.config.poolSize,
          dieSides: Number(ctx.config.dieSides),
          wikiPage: ctx.config.logPage && ctx.wiki.status().canWrite ? ctx.wiki.url(ctx.config.logPage) : null,
          pools: visible.map((c) => {
            const pool = readPool(ctx, c.id);
            return {
              characterId: c.id,
              name: c.name,
              color: c.color,
              remaining: Math.max(0, ctx.config.poolSize - pool.spent),
              rolls: pool.rolls.slice(0, 5),
            };
          }),
        };
      },
    }),

    roll: action({
      input: z.object({ characterId: z.string(), reason: z.string().trim().max(200).default('') }),
      handler: async (ctx, input) => {
        const character = ctx.requireCharacterAccess(input.characterId);
        const pool = readPool(ctx, character.id);
        if (pool.spent >= ctx.config.poolSize) throw new PluginError(`${character.name} has no fate dice left`, 409);

        const sides = Number(ctx.config.dieSides);
        const [value = 1] = ctx.rollDice(1, sides);
        const roll: Roll = { at: Date.now(), gameDate: ctx.gameDate(), value, sides, reason: input.reason };
        ctx.storage.set(poolKey(character.id), {
          spent: pool.spent + 1,
          rolls: [roll, ...pool.rolls].slice(0, HISTORY_KEPT),
        } satisfies Pool);

        const why = input.reason ? ` — ${input.reason}` : '';
        ctx.log(`${character.name} spends a fate die (d${sides}): ${value}${why}`, {
          toast: ctx.config.announce,
          data: { characterId: character.id, value, sides },
        });
        ctx.notify('pools');

        // The wiki is the optional half: the roll already happened, so a wiki
        // failure is reported, not thrown.
        let wikiError: string | null = null;
        if (ctx.config.logPage && ctx.wiki.status().canWrite) {
          const line = `\n* '''${roll.gameDate}''' — ${wikiEscape(character.name)} rolled a d${sides}: '''${value}'''${
            input.reason ? ` (${wikiEscape(input.reason)})` : ''
          }`;
          try {
            await ctx.wiki.append(ctx.config.logPage, line, { summary: `Fate die: ${character.name} rolled ${value}` });
          } catch (err) {
            wikiError = err instanceof Error ? err.message : 'Wiki write failed';
          }
        }
        return { value, sides, remaining: ctx.config.poolSize - pool.spent - 1, wikiError };
      },
    }),

    /** DM: hand the dice back (one character, or everyone). */
    refresh: action({
      dmOnly: true,
      input: z.object({ characterId: z.string().optional() }),
      handler: (ctx, input) => {
        const targets = input.characterId ? [ctx.requireCharacterAccess(input.characterId)] : ctx.characters;
        for (const c of targets) ctx.storage.set(poolKey(c.id), { ...readPool(ctx, c.id), spent: 0 } satisfies Pool);
        ctx.log(
          input.characterId ? `${targets[0]?.name}'s fate dice are restored` : 'Everyone’s fate dice are restored',
        );
        ctx.notify('pools');
        return { restored: targets.length };
      },
    }),
  },
});
