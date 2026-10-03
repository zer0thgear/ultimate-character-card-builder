import 'server-only';
import { randomUUID } from 'node:crypto';
import type { BackendGenRequest, BackendOptions, ImageConnection } from '@/types/imageBackend';
import { a1111Payload, builtInWorkflow, fillComfyWorkflow, unfilledPlaceholders } from '@/lib/imageBackends';
import { isPng, readTextChunks, replaceTextChunks } from '@/lib/png';
import { BadRequestError } from '@/lib/server/storage';

// A1111 (and Forge, reForge, SD.Next: the same /sdapi/v1) and ComfyUI,
// reached from UCCB's server so neither needs CORS turned on, and a login
// never reaches the browser's network log. A gen comes back as PNG bytes.

export type BackendConnection = Pick<ImageConnection, 'kind' | 'baseUrl' | 'auth' | 'workflow'>;

const base = (c: BackendConnection) => {
  const url = c.baseUrl.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) throw new BadRequestError('Set the server address (http://…) in Settings → Image.');
  return url;
};

function headers(c: BackendConnection, json = true): Record<string, string> {
  const h: Record<string, string> = json ? { 'Content-Type': 'application/json' } : {};
  const auth = c.auth.trim();
  if (auth) h.Authorization = c.kind === 'a1111' && auth.includes(':') ? `Basic ${Buffer.from(auth).toString('base64')}` : `Bearer ${auth}`;
  return h;
}

/** A fetch to the backend, with its errors said plainly. */
async function call(c: BackendConnection, path: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<Response> {
  const url = `${base(c)}${path}`;
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { ...headers(c, init.body !== undefined && !(init.body instanceof FormData)), ...(init.headers as Record<string, string>) }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const e = err as Error & { cause?: { code?: string } };
    if (e.name === 'TimeoutError') throw new Error(`${url} took too long to answer.`);
    const code = e.cause?.code;
    throw new Error(code === 'ECONNREFUSED' ? `Nothing is answering at ${base(c)}. Is the server running${c.kind === 'a1111' ? ' with --api' : ''}?` : `Couldn't reach ${base(c)}: ${code ?? e.message}`);
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 500);
    let detail = text;
    try {
      const j = JSON.parse(text);
      detail = j.detail ?? j.error?.message ?? j.error ?? j.message ?? text;
      if (typeof detail !== 'string') detail = JSON.stringify(detail);
    } catch {
      /* not JSON */
    }
    if (res.status === 401) throw new Error(`${base(c)} wants a login${c.kind === 'a1111' ? ' (user:password, from its --api-auth)' : ''}.`);
    if (res.status === 404 && c.kind === 'a1111') throw new Error(`${base(c)} has no API. Start it with --api.`);
    throw new Error(`${c.kind === 'a1111' ? 'A1111' : 'ComfyUI'} said ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  return res;
}

const json = async <T>(res: Response) => (await res.json()) as T;

// ─── Options (Settings and the pickers) ──────────────────────────────────────

export async function backendOptions(c: BackendConnection): Promise<BackendOptions> {
  if (c.kind === 'a1111') {
    const [models, samplers, schedulers, options] = await Promise.all([
      call(c, '/sdapi/v1/sd-models').then((r) => json<{ title: string }[]>(r)),
      call(c, '/sdapi/v1/samplers').then((r) => json<{ name: string }[]>(r)),
      // Older A1111 has no schedulers list (the sampler name carries it).
      call(c, '/sdapi/v1/schedulers').then((r) => json<{ name: string; label?: string }[]>(r)).catch(() => []),
      call(c, '/sdapi/v1/options').then((r) => json<{ sd_model_checkpoint?: string }>(r)).catch(() => ({}) as { sd_model_checkpoint?: string }),
    ]);
    return { checkpoints: models.map((m) => m.title), samplers: samplers.map((s) => s.name), schedulers: schedulers.map((s) => s.name), current: options.sd_model_checkpoint };
  }
  if (c.kind === 'comfyui') {
    const info = await call(c, '/object_info/KSampler').then((r) => json<Record<string, { input: { required: Record<string, unknown[]> } }>>(r));
    const ks = info.KSampler?.input.required ?? {};
    const ckpt = await call(c, '/object_info/CheckpointLoaderSimple')
      .then((r) => json<Record<string, { input: { required: Record<string, unknown[]> } }>>(r))
      .then((i) => i.CheckpointLoaderSimple?.input.required.ckpt_name?.[0])
      .catch(() => []);
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
    return { checkpoints: list(ckpt), samplers: list(ks.sampler_name?.[0]), schedulers: list(ks.scheduler?.[0]) };
  }
  throw new BadRequestError('NovelAI has no server options.');
}

// ─── Generating ──────────────────────────────────────────────────────────────

/** A gen can take a while on a slow card or a big workflow. */
const GEN_TIMEOUT = 15 * 60_000;

export async function backendGenerate(c: BackendConnection, r: BackendGenRequest): Promise<Uint8Array[]> {
  if (c.kind === 'a1111') return a1111Generate(c, r);
  if (c.kind === 'comfyui') {
    return comfyGenerate(c, r);
  }
  throw new BadRequestError('NovelAI gens are sent from the browser.');
}

async function a1111Generate(c: BackendConnection, r: BackendGenRequest): Promise<Uint8Array[]> {
  const res = await call(c, r.init ? '/sdapi/v1/img2img' : '/sdapi/v1/txt2img', { method: 'POST', body: JSON.stringify(a1111Payload(r)) }, GEN_TIMEOUT);
  const body = await json<{ images?: string[]; info?: string }>(res);
  let infotext = '';
  try {
    infotext = (JSON.parse(body.info ?? '{}') as { infotexts?: string[] }).infotexts?.[0] ?? '';
  } catch {
    /* no info */
  }
  const images = (body.images ?? []).map((b64) => new Uint8Array(Buffer.from(b64.replace(/^data:[^,]*,/, ''), 'base64')));
  if (!images.length) throw new Error('A1111 sent back no image.');
  // Its PNGs carry their settings as `parameters` in most versions; when
  // one doesn't, add them from the reply, so the gen can be reused later.
  return images.slice(0, 1).map((png) => (isPng(png) && infotext && !readTextChunks(png).some((t) => t.keyword === 'parameters') ? replaceTextChunks(png, [{ keyword: 'parameters', text: infotext }], () => true) : png));
}

interface ComfyHistory {
  status?: { status_str?: string; completed?: boolean; messages?: [string, { exception_message?: string; node_type?: string }][] };
  outputs?: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }>;
}

/** Puts an Img2Img base in ComfyUI's input folder; its name there. */
async function comfyUpload(c: BackendConnection, png: string): Promise<string> {
  const form = new FormData();
  form.append('image', new Blob([Buffer.from(png.replace(/^data:[^,]*,/, ''), 'base64')], { type: 'image/png' }), `uccb-base-${randomUUID()}.png`);
  form.append('type', 'input');
  form.append('overwrite', 'true');
  const res = await call(c, '/upload/image', { method: 'POST', body: form }, 60_000);
  const { name, subfolder } = await json<{ name: string; subfolder?: string }>(res);
  return subfolder ? `${subfolder}/${name}` : name;
}

async function comfyGenerate(c: BackendConnection, r: BackendGenRequest): Promise<Uint8Array[]> {
  const image = r.init ? await comfyUpload(c, r.init.image) : undefined;
  let workflow;
  try {
    workflow = fillComfyWorkflow(c.workflow ?? builtInWorkflow(), r, image);
  } catch (err) {
    throw new BadRequestError((err as Error).message);
  }
  // The built-in workflow needs a checkpoint: the first the server has, if none was picked.
  if (!c.workflow && !r.checkpoint) {
    const { checkpoints } = await backendOptions(c);
    if (!checkpoints.length) throw new Error('ComfyUI has no checkpoints (models/checkpoints is empty).');
    workflow['4'].inputs.ckpt_name = checkpoints[0];
  }
  const left = unfilledPlaceholders(workflow);
  if (left.length) throw new BadRequestError(`The workflow wants ${left.map((n) => `%${n}%`).join(', ')}, but none is set: pick ${left.join(' and ')} in the Image tab.`);
  const queued = await call(c, '/prompt', { method: 'POST', body: JSON.stringify({ prompt: workflow, client_id: randomUUID() }) });
  const { prompt_id, node_errors } = await json<{ prompt_id: string; node_errors?: Record<string, { errors?: { message: string; details?: string }[]; class_type?: string }> }>(queued);
  const nodeError = Object.values(node_errors ?? {})[0];
  if (nodeError?.errors?.length) throw new Error(`ComfyUI refused the workflow (${nodeError.class_type ?? 'a node'}): ${nodeError.errors.map((e) => e.details || e.message).join('; ')}`);

  const until = Date.now() + GEN_TIMEOUT;
  while (Date.now() < until) {
    await new Promise((res) => setTimeout(res, 700));
    const history = await call(c, `/history/${prompt_id}`).then((res) => json<Record<string, ComfyHistory>>(res));
    const run = history[prompt_id];
    if (!run) continue;
    if (run.status?.status_str === 'error') {
      const err = run.status.messages?.find(([kind]) => kind === 'execution_error')?.[1];
      throw new Error(`ComfyUI failed${err?.node_type ? ` in ${err.node_type}` : ''}: ${err?.exception_message?.trim() || 'see its console'}`);
    }
    // History is written as the run ends, but go by its status when it has
    // one, so a preview partway through isn't taken for the result.
    if (run.status ? !run.status.completed : !run.outputs) continue;
    const files = Object.values(run.outputs ?? {}).flatMap((o) => o.images ?? []);
    if (!files.length) {
      if (run.status?.completed) throw new Error('The workflow finished without an image. Does it end in a Save Image or Preview Image node?');
      continue;
    }
    // The last image node's output: the final one, past any previews on the way.
    const f = files[files.length - 1];
    const q = new URLSearchParams({ filename: f.filename, subfolder: f.subfolder, type: f.type });
    const img = await call(c, `/view?${q}`, {}, 60_000);
    return [new Uint8Array(await img.arrayBuffer())];
  }
  throw new Error('ComfyUI took longer than 15 minutes; the gen may still finish there.');
}
