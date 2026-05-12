import type { Skill } from "./types.js";

/**
 * Registry for managing skills.
 * Skills are registered and looked up by their ID.
 */
export class SkillRegistry {
  private skills = new Map<string, Skill>();

  /**
   * Register a skill.
   * @throws Error if a skill with the same ID already exists
   */
  register(skill: Skill): void {
    if (this.skills.has(skill.id)) {
      throw new Error(`Skill already registered: ${skill.id}`);
    }
    this.skills.set(skill.id, skill);
  }

  /**
   * Get a skill by ID.
   */
  get(id: string): Skill | undefined {
    return this.skills.get(id);
  }

  /**
   * Check if a skill exists.
   */
  has(id: string): boolean {
    return this.skills.has(id);
  }

  /**
   * List all registered skills.
   */
  list(): Skill[] {
    return [...this.skills.values()];
  }

  /**
   * Find skills matching a query string.
   * Searches name and description.
   */
  search(query: string): Skill[] {
    const lowerQuery = query.toLowerCase();
    return this.list().filter(
      (skill) =>
        skill.name.toLowerCase().includes(lowerQuery) ||
        skill.description.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Unregister a skill by ID.
   * @returns true if the skill was removed, false if it didn't exist
   */
  unregister(id: string): boolean {
    return this.skills.delete(id);
  }

  /**
   * Clear all registered skills.
   */
  clear(): void {
    this.skills.clear();
  }

  /**
   * Get the number of registered skills.
   */
  get size(): number {
    return this.skills.size;
  }
}
