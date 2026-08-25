#!/usr/bin/env node
/**
 * Bundle built-in skills from real files on disk into a TypeScript module.
 *
 * Sources:
 *  - the `kepler` skill comes from the map surface **vendored** at
 *    `src/mcp/skill/kepler/` (temporarily integrated from the kepler.gl
 *    `@kepler.gl/mcp` module, which permanently owns the map commands). This
 *    repo's harness-specific notes (`scripts/kepler-skill.harness.md`) are
 *    appended to its SKILL.md.
 *  - the `geoda-analysis` skill is **sourced** from the @geoda/* library repo
 *    (`geoda-lib/skills/geoda-analysis`) so the harness-agnostic analysis
 *    skill lives in one place. This host's command surface
 *    (`scripts/geoda-skill.harness.md`) is appended to its SKILL.md. Override
 *    the location with the `GEODA_SKILL_DIR` env var.
 *  - every other skill comes from `skills/built-in/<id>/` in this repo.
 *
 * Each source directory is expected to contain `skill.yaml` and `SKILL.md`
 * (plus any optional extra files). Emits `src/chat/bundledSkills.ts`
 * containing a `BUNDLED_SKILLS` array of seed skill objects; `seedSkills.ts`
 * re-exports this as the assistant's default `SEED_SKILLS`.
 *
 * Run automatically as a prebuild step (see package.json `build` script), or
 * manually: `node scripts/generate-skills.mjs`
 */

import {existsSync, readdirSync, readFileSync, writeFileSync, statSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SKILLS_DIR = join(ROOT, 'skills/built-in');
const OUTPUT = join(ROOT, 'src/chat/bundledSkills.ts');
const ROOT_ID = 'built-in';
const MCP_SKILL_ID = 'kepler';
const HARNESS_FILE = join(__dirname, 'kepler-skill.harness.md');
const GEODA_SKILL_ID = 'geoda-analysis';
const GEODA_HARNESS_FILE = join(__dirname, 'geoda-skill.harness.md');
const GEODA_SKILL_DIR =
  process.env.GEODA_SKILL_DIR || '/Users/xun/github/geoda-lib/skills/geoda-analysis';

/**
 * The vendored map-surface skill, temporarily integrated from the kepler.gl
 * `@kepler.gl/mcp` module. See NEXT_PLAN.md for the permanent separation.
 */
const MCP_SKILL_DIR = join(ROOT, 'src/mcp/skill/kepler');

/**
 * @param {string} dir
 * @returns {{relativePath: string, content: string}[]}
 */
function readSkillFiles(dir) {
  const entries = readdirSync(dir);
  const files = [];
  for (const name of entries) {
    const fullPath = join(dir, name);
    if (statSync(fullPath).isFile()) {
      files.push({relativePath: name, content: readFileSync(fullPath, 'utf8')});
    }
  }
  return files;
}

/**
 * Strip a leading `---` frontmatter block (Claude Code skill convention) so
 * the body can be appended to cleanly. This host's manifest comes from
 * `skill.yaml`, not from SKILL.md frontmatter.
 */
function stripSkillFrontmatter(content) {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(content);
  return m ? content.slice(m[0].length) : content;
}

function main() {
  // Local skills, minus the ones sourced elsewhere (kepler, geoda-analysis).
  const localDirs = readdirSync(SKILLS_DIR)
    .map(name => ({name, path: join(SKILLS_DIR, name)}))
    .filter(entry => statSync(entry.path).isDirectory())
    .filter(entry => entry.name !== MCP_SKILL_ID && entry.name !== GEODA_SKILL_ID)
    .sort((a, b) => a.name.localeCompare(b.name));

  const seeds = localDirs.map(({name: id, path}) => ({
    id,
    rootId: ROOT_ID,
    files: readSkillFiles(path)
  }));

  // Kepler skill from the vendored map surface (src/mcp/skill/kepler), with
  // harness notes appended.
  const keplerSkillDir = MCP_SKILL_DIR;
  const keplerFiles = readSkillFiles(keplerSkillDir);
  if (existsSync(HARNESS_FILE)) {
    const harness = readFileSync(HARNESS_FILE, 'utf8');
    const skillMd = keplerFiles.find(f => f.relativePath === 'SKILL.md');
    if (skillMd) {
      skillMd.content = `${skillMd.content.replace(/\s+$/, '')}\n\n${harness}`;
    }
  }
  seeds.push({id: MCP_SKILL_ID, rootId: ROOT_ID, files: keplerFiles});

  // GeoDa skill sourced from the geoda-lib repo (harness-agnostic), with this
  // host's command surface appended. Only skill.yaml + SKILL.md are bundled —
  // the plugin packaging (package.json, .claude-plugin/, scripts/) belongs to
  // the standalone skill and is not needed by this host.
  if (!existsSync(GEODA_SKILL_DIR)) {
    console.error(`GEODA_SKILL_DIR not found: ${GEODA_SKILL_DIR}`);
    process.exit(1);
  }
  const geodaFiles = readSkillFiles(GEODA_SKILL_DIR)
    .filter(f => f.relativePath === 'skill.yaml' || f.relativePath === 'SKILL.md');
  if (existsSync(GEODA_HARNESS_FILE)) {
    const harness = readFileSync(GEODA_HARNESS_FILE, 'utf8');
    const skillMd = geodaFiles.find(f => f.relativePath === 'SKILL.md');
    if (skillMd) {
      skillMd.content = `${stripSkillFrontmatter(skillMd.content).replace(/\s+$/, '')}\n\n${harness}`;
    }
  }
  seeds.push({id: GEODA_SKILL_ID, rootId: ROOT_ID, files: geodaFiles});
  seeds.sort((a, b) => a.id.localeCompare(b.id));

  const header = `// Auto-generated by scripts/generate-skills.mjs — DO NOT EDIT
import type {SkillFile} from '@sqlrooms/ai';

export interface BundledSeedSkill {
  id: string;
  rootId: string;
  files: SkillFile[];
}

export const BUNDLED_SKILLS: BundledSeedSkill[] = ${JSON.stringify(seeds, null, 2)};
`;

  writeFileSync(OUTPUT, header, 'utf8');
  console.log(
    `Generated ${OUTPUT} with ${seeds.length} skills: ${seeds.map(s => s.id).join(', ')}`
  );
}

main();
