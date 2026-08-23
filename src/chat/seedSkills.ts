/**
 * Default seed skills for the kepler.ai assistant.
 *
 * The skill content is authored as real `SKILL.md` + `skill.yaml` files on disk
 * under `skills/built-in/<id>/` and bundled into `bundledSkills.ts` by
 * `scripts/generate-skills.mjs` (run as a build step). This module re-exports
 * the generated array as `SEED_SKILLS`, the default bundle hosts pass to
 * `KeplerSkillStorage`. Hosts that want different skill content still pass
 * their own seeds — the storage accepts any array of `SkillSeed`.
 *
 * Every seed is round-tripped through `loadSkillFromFiles` at storage
 * construction time, so a malformed skill file crashes the app on startup
 * (the desired fail-loud behavior).
 */

import type {SkillSeed} from './kepler-skill-storage';
import {BUNDLED_SKILLS} from './bundledSkills';

export const SEED_SKILLS: SkillSeed[] = BUNDLED_SKILLS;
