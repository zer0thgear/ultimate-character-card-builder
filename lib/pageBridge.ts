// What a page in a chat message (lib/chatHtml.ts) can do in the chat, as
// pages written for SillyTavern and Tavern Helper do it. They run in a
// sandboxed frame, so they can't reach the chat themselves; instead the
// frame gets stand-ins for what they reach for:
//
// - `parent.document` is a little document of its own with SillyTavern's
//   message box (#send_textarea) and send button (#send_but) in it.
//   Writing into the box fills UCCB's message box; clicking the button
//   sends it. (`top` can't be stood in for, so pages that use it don't work.)
// - `triggerSlash(command)` (also on `TavernHelper` and `parent`) runs the
//   few slash commands option bars use: /setinput, /send, /trigger, /echo,
//   chained with |.
// - `toastr.info(…)` and friends show UCCB's toasts.
//
// The chat only takes them from a page you've just clicked into, so a page
// can't type or send on its own (components/ChatHtml.tsx).

export type SlashStep = { op: 'setinput' | 'send' | 'echo'; text: string } | { op: 'trigger' };

/** A slash-command chain, or why it can't run here. */
export function parseSlash(command: string): { steps: SlashStep[] } | { error: string } {
  const parts = command
    .split(/(?<!\\)\|/)
    .map((p) => p.replace(/\\\|/g, '|').trim())
    .filter(Boolean);
  if (!parts.length) return { error: 'No command.' };
  const steps: SlashStep[] = [];
  for (const part of parts) {
    const m = part.match(/^\/(\S+)\s*([\s\S]*)$/);
    if (!m) return { error: `"${part.slice(0, 40)}" isn't a slash command.` };
    const name = m[1].toLowerCase();
    // Named arguments (name=value) come first; the ones these commands take
    // only matter in SillyTavern, so they're left out.
    const text = m[2].replace(/^(?:\w+=(?:"[^"]*"|'[^']*'|\S+)\s*)*/, '').trim();
    if (name === 'setinput') steps.push({ op: 'setinput', text });
    else if (name === 'send') {
      if (!text) return { error: '/send needs some text.' };
      steps.push({ op: 'send', text });
    } else if (name === 'trigger') steps.push({ op: 'trigger' });
    else if (name === 'echo') steps.push({ op: 'echo', text });
    else return { error: `/${name} isn't supported in UCCB (only /setinput, /send, /trigger and /echo).` };
  }
  return { steps };
}

/** The script a page's frame starts with: the stand-ins above, talking to
 *  the chat by postMessage. */
export const BRIDGE_SCRIPT = `<script>(()=>{
const real=window.parent;let n=0;const waiting=new Map();
const post=(m)=>real.postMessage(Object.assign({uccbHtml:1},m),"*");
const doc=document.implementation.createHTMLDocument("SillyTavern");
const box=doc.createElement("textarea");box.id="send_textarea";doc.body.appendChild(box);
const val=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value");
Object.defineProperty(box,"value",{configurable:true,get(){return val.get.call(box)},set(v){val.set.call(box,v);post({call:"input",text:String(v)})}});
box.addEventListener("input",()=>post({call:"input",text:box.value}));
const btn=doc.createElement("div");btn.id="send_but";doc.body.appendChild(btn);
btn.addEventListener("click",()=>post({call:"submit",text:box.value}));
const triggerSlash=(command)=>new Promise((resolve,reject)=>{const id=++n;waiting.set(id,{resolve,reject});post({call:"slash",id,command:String(command)})});
const say=(tone)=>(text)=>post({call:"toast",tone,text:String(text)});
const toastr={info:say("info"),success:say("success"),warning:say("info"),error:say("error"),clear(){},remove(){}};
const helper={triggerSlash};
const stand=new Proxy({},{get(_,k){
if(k==="document")return doc;if(k==="window"||k==="parent"||k==="self")return stand;
if(k==="triggerSlash")return triggerSlash;if(k==="TavernHelper")return helper;if(k==="toastr")return toastr;
if(k==="postMessage")return real.postMessage.bind(real);return undefined}});
Object.defineProperty(window,"parent",{configurable:true,value:stand});
window.triggerSlash=triggerSlash;window.TavernHelper=helper;if(!window.toastr)window.toastr=toastr;
window.addEventListener("message",(e)=>{if(e.source!==real)return;const m=e.data;if(!m||m.uccbHtml!==1)return;
if(typeof m.input==="string")val.set.call(box,m.input);
const w=waiting.get(m.reply);if(w){waiting.delete(m.reply);m.error?w.reject(new Error(m.error)):w.resolve(m.result??"")}});
})()</script>`;
