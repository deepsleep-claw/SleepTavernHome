import type { DebugGeneration } from './debug_types';

type GenerationContext = Pick<DebugGeneration, 'chat_id' | 'character_name' | 'script_id'>;

export class GenerationTrace {
  private current?: DebugGeneration;
  private preview?: DebugGeneration;
  private current_is_preview = false;
  private seen_prompts = new WeakSet<object>();
  private seen_previews = new WeakSet<object>();
  private skipped_previews = 0;

  get dryRun(): boolean {
    return this.current_is_preview;
  }

  begin(type: string, dry_run: boolean, context: GenerationContext) {
    const generation: DebugGeneration = {
      ...context,
      id: crypto.randomUUID(),
      type,
      dry_run,
      started_at: new Date().toISOString(),
      skipped_previews: this.skipped_previews,
      pass: 0,
      event: '',
    };
    this.current_is_preview = dry_run;
    if (dry_run) {
      this.preview = generation;
      this.seen_previews = new WeakSet();
    } else {
      this.current = generation;
      this.skipped_previews = 0;
      this.seen_prompts = new WeakSet();
    }
  }

  accept(
    prompt: object,
    dry_run: boolean | undefined,
    event: string,
    context: GenerationContext,
  ): DebugGeneration | undefined {
    const preview = dry_run ?? this.dryRun;
    const seen = preview ? this.seen_previews : this.seen_prompts;
    if (seen.has(prompt)) return undefined;
    if (!(preview ? this.preview : this.current)) this.begin('unknown', preview, context);
    (preview ? this.seen_previews : this.seen_prompts).add(prompt);
    if (preview) this.skipped_previews++;
    const generation = (preview ? this.preview : this.current)!;
    generation.pass++;
    return { ...generation, dry_run: preview, event };
  }
}
