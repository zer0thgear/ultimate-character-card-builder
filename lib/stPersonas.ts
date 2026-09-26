// SillyTavern's personas, as it keeps them: in settings.json under
// power_user, or in the file Persona Management's "Backup" button writes
// (the same fields at the top level). Each persona is keyed by its avatar's
// file name in "User Avatars":
//   personas:             { "user-default.png": "Name", … }
//   persona_descriptions: { "user-default.png": { description, position, depth, … }, … }
//   default_persona:      "user-default.png"

export interface StPersona {
  /** The avatar's file name in SillyTavern's "User Avatars" folder. */
  file: string;
  name: string;
  description: string;
  isDefault: boolean;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export class PersonaImportError extends Error {}

export function parseStPersonas(json: unknown): StPersona[] {
  if (!isObject(json)) throw new PersonaImportError("That file isn't SillyTavern's settings or a persona backup.");
  const src = isObject(json.power_user) && isObject(json.power_user.personas) ? json.power_user : json;
  if (!isObject(src.personas)) throw new PersonaImportError('No personas in that file. Pick SillyTavern’s settings.json or a persona backup.');
  const descriptions = isObject(src.persona_descriptions) ? src.persona_descriptions : {};
  const def = typeof src.default_persona === 'string' ? src.default_persona : '';
  return Object.entries(src.personas).map(([file, name]) => {
    const d = descriptions[file];
    const description = isObject(d) && typeof d.description === 'string' ? d.description : typeof d === 'string' ? d : '';
    return { file, name: typeof name === 'string' ? name : file.replace(/\.[a-z]+$/i, ''), description, isDefault: file === def };
  });
}

/** Whether a persona like this is already here (same name and description). */
export const samePersona = (a: { name: string; description: string }, b: { name: string; description: string }) =>
  a.name.trim() === b.name.trim() && a.description.trim() === b.description.trim();
