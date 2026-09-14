import type {AiSliceState, SkillListing} from '@sqlrooms/ai';
import type {CommandSliceState, StoreApi} from '@sqlrooms/room-store';
import {
  KeplerSkillStorage,
  SEED_SKILLS,
  createRunSkillTool,
  createDiscoverSkillTool,
  buildSkillsPromptFromListings,
  getModel
} from './chat';
import {createKeplerAiInstructions} from './instructions';
import {createRegistryChatSurface} from './mcp/chat-surface';

/**
 * Singleton skill storage for the assistant. Lives for the page's lifetime.
 * Exported so future skill-authoring UI can reach it directly. Seeded with the
 * kepler-flavored default skills bundled into kepler-assistant (`SEED_SKILLS`).
 */
export const skillStorage = new KeplerSkillStorage(SEED_SKILLS);

/**
 * Cached skill listings used when building the orchestrator's system prompt.
 * Kept outside the store so the prompt read path stays synchronous; the cache
 * is refreshed whenever storage mutates.
 */
let cachedListings: SkillListing[] = [];

let refreshSeq = 0;
async function refreshSkillListings() {
  const seq = ++refreshSeq;
  try {
    const next = await skillStorage.listSkills();
    if (seq === refreshSeq) cachedListings = next;
  } catch (err) {
    console.error('[store] Failed to refresh skill listings:', err);
  }
}

// Initial seed — fire-and-forget is safe, the storage constructor already
// populated the built-in root synchronously.
void refreshSkillListings();
skillStorage.subscribe?.(() => {
  void refreshSkillListings();
});

/** Kepler dataset context and skills guidance; combine with SQLRooms' default instructions. */
export function createKeplerAssistantInstructions(): string {
  const base = createKeplerAiInstructions();
  const skillsBlock = buildSkillsPromptFromListings(cachedListings);
  return skillsBlock ? `${base}\n\n${skillsBlock}` : base;
}

/**
 * Bind Kepler skills to the host's AI state and command registry.
 * Safe to call during slice construction: state is read only when tools execute.
 * The host registers getAllCommands(getKeplerContext()) and owns the connector.
 */
export function createKeplerAssistantTools<State extends AiSliceState & CommandSliceState>(
  store: StoreApi<State>
) {
  const chatToolSurface = createRegistryChatSurface(store);
  return {
    discoverSkill: createDiscoverSkillTool({store, storage: skillStorage}),
    runSkill: createRunSkillTool({
      store,
      storage: skillStorage,
      getChatToolSurface: () => chatToolSurface,
      getModel: () => getModel(store)
    })
  };
}
