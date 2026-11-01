import {
  DISCORD_LIMITS,
  EMBED_SLOT_KEYS,
  emptyEmbed,
  type EmbedSlot,
  type FieldNode,
  type Mapping,
  type MappingEmbed,
  type MappingField,
  type RenderWarning,
  type Source,
} from '@send-any-webhook/shared';
import { ArrowDown, ArrowUp, Plus, Trash2, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from 'cn';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { FieldPicker, SourceInput, type PickHandler, type SlotKind } from './source-input';

function Section({ title, description, children, actions }: { title: string; description?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="space-y-1 rounded-lg border p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {description && <p className="text-muted-foreground text-xs">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

const EMBED_GROUPS: { title: string; description?: string; slots: [EmbedSlot, string, SlotKind, string?][] }[] = [
  {
    title: 'Main',
    slots: [
      ['title', 'Title', 'text', `Up to ${DISCORD_LIMITS.embedTitle} characters`],
      ['url', 'Title link', 'url'],
      ['description', 'Description', 'long', `Supports Discord markdown; up to ${DISCORD_LIMITS.embedDescription} characters`],
      ['color', 'Color', 'color', 'Left border color'],
    ],
  },
  {
    title: 'Author',
    description: 'Small line above the title',
    slots: [
      ['authorName', 'Name', 'name'],
      ['authorUrl', 'Link', 'url'],
      ['authorIcon', 'Icon URL', 'url'],
    ],
  },
  {
    title: 'Images',
    slots: [
      ['thumbnail', 'Thumbnail URL', 'url', 'Small image on the right'],
      ['image', 'Image URL', 'url', 'Large image at the bottom'],
    ],
  },
  {
    title: 'Footer',
    slots: [
      ['footerText', 'Text', 'text'],
      ['footerIcon', 'Icon URL', 'url'],
      ['timestamp', 'Timestamp', 'date', 'Shown in each viewer\'s timezone'],
    ],
  },
];

interface EditorProps {
  mapping: Mapping;
  onChange: (m: Mapping) => void;
  /** Flattened sample fields. */
  fields: FieldNode[];
  warnings: RenderWarning[];
  onActivate: (pick: PickHandler) => void;
}

function warningsFor(warnings: RenderWarning[], slot: string) {
  return warnings.filter((w) => w.slot === slot).map((w) => w.message);
}

function FieldsEditor({
  embed,
  index,
  setEmbed,
  fields,
  warnings,
  onActivate,
}: {
  embed: MappingEmbed;
  index: number;
  setEmbed: (e: MappingEmbed) => void;
  fields: FieldNode[];
  warnings: RenderWarning[];
  onActivate: (pick: PickHandler) => void;
}) {
  const setField = (i: number, f: MappingField) => setEmbed({ ...embed, fields: embed.fields.map((x, j) => (i === j ? f : x)) });
  const move = (i: number, d: -1 | 1) => {
    const list = [...embed.fields];
    const [f] = list.splice(i, 1);
    list.splice(i + d, 0, f!);
    setEmbed({ ...embed, fields: list });
  };
  const arrays = fields.filter((f) => f.type === 'array');
  const each = embed.fieldsFromArray;
  const itemKeys = each ? (fields.find((f) => f.path === each.path)?.children?.[0]?.children ?? []).map((c) => c.key) : [];
  const keySelect = (value: string, set: (v: string) => void) => (
    <Select value={value || '__item'} onValueChange={(v) => set(v === '__item' ? '' : v)}>
      <SelectTrigger size="sm" className="w-full text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__item">Whole item</SelectItem>
        {itemKeys.map((k) => (
          <SelectItem key={k} value={k}>
            {k}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <Section
      title="Fields"
      description={`Name/value pairs under the description; inline fields sit up to 3 per row. Max ${DISCORD_LIMITS.embedFields}.`}
      actions={
        <Button
          variant="outline"
          size="sm"
          disabled={embed.fields.length >= DISCORD_LIMITS.embedFields}
          onClick={() =>
            setEmbed({ ...embed, fields: [...embed.fields, { name: { kind: 'static', value: '' }, value: { kind: 'empty' }, inline: true }] })
          }
        >
          <Plus /> Add field
        </Button>
      }
    >
      {warningsFor(warnings, `embeds[${index}].fields`).map((w) => (
        <p key={w} className="text-xs text-amber-700 dark:text-amber-400">
          {w}
        </p>
      ))}
      <div className="space-y-2">
        {embed.fields.map((f, i) => {
          const slot = `embeds[${index}].fields[${i}]`;
          return (
            <div key={i} className="bg-muted/30 rounded-md border p-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-muted-foreground text-xs font-medium">Field {i + 1}</span>
                <div className="flex items-center gap-1">
                  <Label className="text-xs" htmlFor={`${slot}-inline`}>
                    Inline
                  </Label>
                  <Switch id={`${slot}-inline`} checked={f.inline} onCheckedChange={(inline) => setField(i, { ...f, inline })} />
                  <Button variant="ghost" size="sm" className="h-7 px-1.5" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                    <ArrowUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-1.5"
                    disabled={i === embed.fields.length - 1}
                    onClick={() => move(i, 1)}
                    aria-label="Move down"
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-1.5"
                    onClick={() => setEmbed({ ...embed, fields: embed.fields.filter((_, j) => j !== i) })}
                    aria-label="Remove field"
                  >
                    <X />
                  </Button>
                </div>
              </div>
              <SourceInput
                label="Name"
                kind="text"
                value={f.name}
                onChange={(name) => setField(i, { ...f, name })}
                fields={fields}
                warnings={warningsFor(warnings, `${slot}.name`)}
                onActivate={onActivate}
              />
              <SourceInput
                label="Value"
                kind="long"
                value={f.value}
                onChange={(value) => setField(i, { ...f, value })}
                fields={fields}
                warnings={warningsFor(warnings, `${slot}.value`)}
                onActivate={onActivate}
              />
            </div>
          );
        })}
      </div>

      <div className="mt-3 rounded-md border border-dashed p-2">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-medium">One field per list item</div>
            <div className="text-muted-foreground text-xs">E.g. one field per commit or per changed value.</div>
          </div>
          <Switch
            checked={!!each}
            disabled={!each && arrays.length === 0}
            onCheckedChange={(on) =>
              setEmbed({ ...embed, fieldsFromArray: on ? { path: arrays[0]?.path ?? '', nameKey: '', valueKey: '', inline: false } : null })
            }
          />
        </div>
        {each && (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">List</Label>
              <FieldPicker
                value={each.path}
                onChange={(path) => setEmbed({ ...embed, fieldsFromArray: { ...each, path, nameKey: '', valueKey: '' } })}
                fields={fields}
                only={(f) => f.type === 'array'}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Field name from</Label>
              {keySelect(each.nameKey, (nameKey) => setEmbed({ ...embed, fieldsFromArray: { ...each, nameKey } }))}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Field value from</Label>
              {keySelect(each.valueKey, (valueKey) => setEmbed({ ...embed, fieldsFromArray: { ...each, valueKey } }))}
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={each.inline} onCheckedChange={(inline) => setEmbed({ ...embed, fieldsFromArray: { ...each, inline } })} />
              <Label className="text-xs">Inline</Label>
            </div>
          </div>
        )}
        {warningsFor(warnings, `embeds[${index}].fields_each`).map((w) => (
          <p key={w} className="mt-1 text-xs text-amber-700 dark:text-amber-400">
            {w}
          </p>
        ))}
      </div>
    </Section>
  );
}

export function MappingEditor({ mapping, onChange, fields, warnings, onActivate }: EditorProps) {
  const [active, setActive] = useState(0);
  const embedIndex = Math.min(active, Math.max(0, mapping.embeds.length - 1));
  const set = (patch: Partial<Mapping>) => onChange({ ...mapping, ...patch });
  const setEmbed = (i: number, e: MappingEmbed) => set({ embeds: mapping.embeds.map((x, j) => (i === j ? e : x)) });
  const slot = (label: string, kind: SlotKind, value: Source, onSet: (s: Source) => void, key: string, hint?: string) => (
    <SourceInput
      key={key}
      label={label}
      kind={kind}
      value={value}
      onChange={onSet}
      fields={fields}
      warnings={warningsFor(warnings, key)}
      onActivate={onActivate}
      hint={hint}
    />
  );
  const embed = mapping.embeds[embedIndex];

  return (
    <div className="space-y-3">
      <Section title="Message" description="Bot name and avatar override the webhook's defaults for this message.">
        {slot('Bot name', 'name', mapping.username, (username) => set({ username }), 'username')}
        {slot('Avatar URL', 'url', mapping.avatarUrl, (avatarUrl) => set({ avatarUrl }), 'avatar_url')}
        {slot('Content', 'long', mapping.content, (content) => set({ content }), 'content', 'Plain message text above the embeds')}
      </Section>

      <div className="flex flex-wrap items-center gap-1">
        {mapping.embeds.map((_, i) => (
          <Button key={i} variant={i === embedIndex ? 'secondary' : 'ghost'} size="sm" onClick={() => setActive(i)}>
            Embed {i + 1}
          </Button>
        ))}
        <Button
          variant="ghost"
          size="sm"
          disabled={mapping.embeds.length >= DISCORD_LIMITS.embeds}
          onClick={() => {
            set({ embeds: [...mapping.embeds, emptyEmbed()] });
            setActive(mapping.embeds.length);
          }}
        >
          <Plus /> Add embed
        </Button>
        {embed && (
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive ml-auto"
            onClick={() => {
              set({ embeds: mapping.embeds.filter((_, j) => j !== embedIndex) });
              setActive(Math.max(0, embedIndex - 1));
            }}
          >
            <Trash2 /> Remove embed
          </Button>
        )}
      </div>

      {!embed ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-center text-sm">
          No embed. The message is just its content. Add an embed for a title, fields and color.
        </p>
      ) : (
        <div className={cn('space-y-3')}>
          {warningsFor(warnings, `embeds[${embedIndex}]`).map((w) => (
            <p key={w} className="text-xs text-amber-700 dark:text-amber-400">
              {w}
            </p>
          ))}
          {EMBED_GROUPS.map((g) => (
            <Section key={g.title} title={g.title} description={g.description}>
              {g.slots.map(([s, label, kind, hint]) =>
                slot(label, kind, embed[s], (v) => setEmbed(embedIndex, { ...embed, [s]: v }), `embeds[${embedIndex}].${EMBED_SLOT_KEYS[s]}`, hint),
              )}
            </Section>
          ))}
          <FieldsEditor
            embed={embed}
            index={embedIndex}
            setEmbed={(e) => setEmbed(embedIndex, e)}
            fields={fields}
            warnings={warnings}
            onActivate={onActivate}
          />
        </div>
      )}
    </div>
  );
}
