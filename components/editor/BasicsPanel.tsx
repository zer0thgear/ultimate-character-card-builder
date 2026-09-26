'use client';

import { CardTextField, useCardField } from '@/components/editor/fieldTools';
import { inputClass } from '@/components/ui';

export function BasicsPanel() {
  const [name, setName] = useCardField('name');
  const [nickname, setNickname] = useCardField('nickname');
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold tracking-wide text-slate-300 uppercase">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Character name" className={`${inputClass} text-base`} />
        </label>
        <label className="flex flex-col gap-1" title="V3: used for {{char}} instead of the name, where supported">
          <span className="text-xs font-semibold tracking-wide text-slate-300 uppercase">
            Nickname <span className="font-normal text-slate-500 normal-case">(V3, replaces name in {'{{char}}'})</span>
          </span>
          <input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="optional" className={inputClass} />
        </label>
      </div>
      <CardTextField path="description" label="Description" hint="Sent with every message" minRows={10} maxRows={40} placeholder="Who {{char}} is: appearance, background, personality, speech, relationships…" />
      <CardTextField path="personality" label="Personality" hint="Short summary" minRows={2} />
      <CardTextField path="scenario" label="Scenario" hint="Where the chat starts" minRows={3} />
      <CardTextField path="mes_example" label="Example messages" hint="Start each example with <START>" minRows={6} maxRows={30} placeholder={'<START>\n{{user}}: …\n{{char}}: …'} />
    </div>
  );
}
