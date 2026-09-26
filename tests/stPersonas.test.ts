import { describe, expect, it } from 'vitest';
import { parseStPersonas, samePersona, PersonaImportError } from '@/lib/stPersonas';

const personas = { 'user-default.png': 'Kael', '1712345.png': 'Mira' };
const persona_descriptions = {
  'user-default.png': { description: 'A bard.', position: 0 },
  '1712345.png': { description: 'A knight.', position: 0, connections: [] },
};

describe('parseStPersonas', () => {
  it("reads SillyTavern's settings.json (under power_user)", () => {
    const out = parseStPersonas({ power_user: { personas, persona_descriptions, default_persona: '1712345.png' } });
    expect(out).toEqual([
      { file: 'user-default.png', name: 'Kael', description: 'A bard.', isDefault: false },
      { file: '1712345.png', name: 'Mira', description: 'A knight.', isDefault: true },
    ]);
  });

  it("reads Persona Management's backup file (the same fields at the top)", () => {
    expect(parseStPersonas({ personas, persona_descriptions }).map((p) => p.name)).toEqual(['Kael', 'Mira']);
  });

  it('copes with a persona that has no description', () => {
    expect(parseStPersonas({ personas: { 'a.png': 'Solo' } })[0]).toMatchObject({ name: 'Solo', description: '' });
  });

  it('says why other files are refused', () => {
    expect(() => parseStPersonas({ temperature: 1 })).toThrow(PersonaImportError);
    expect(() => parseStPersonas([1, 2])).toThrow(PersonaImportError);
  });

  it('recognises a persona already imported', () => {
    expect(samePersona({ name: 'Kael ', description: 'A bard.' }, { name: 'Kael', description: 'A bard.\n' })).toBe(true);
    expect(samePersona({ name: 'Kael', description: 'A bard.' }, { name: 'Kael', description: 'A poet.' })).toBe(false);
  });
});
