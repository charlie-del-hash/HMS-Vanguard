/* The block editor.
 *
 * The one island on this site that hydrates, and the reason React is
 * registered at all — Phases 0-2 kept the integration off precisely because an
 * unused framework runtime is 187KB shipped to every reader. Public pages
 * still ship none of this.
 *
 * ── it does not render the report ─────────────────────────────────────
 * The preview is an iframe pointing at an SSR route that uses the SAME Astro
 * components the published page does. Reimplementing eleven block components
 * in React to get a live preview would give you two renderers that agree until
 * the first time one of them is fixed — and the one the author is looking at
 * would be the one that is wrong.
 *
 * So this edits structured data and nothing else. Save, then the frame
 * reloads; what the author sees is what will publish, because it is the same
 * code path.
 *
 * ── every kind has a form, and an escape hatch ────────────────────────
 * Eleven bespoke forms would be eleven things to keep in step with
 * blocks.ts. The fields each kind actually needs are here, and anything not
 * covered — a map outline, chart lanes, table column priorities — is reachable
 * through the JSON view, which is validated server-side by the same
 * `parsePayload` as everything else.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BlockKind } from "../../lib/blocks";
import { BLOCK_HINT, BLOCK_KINDS, BLOCK_LABEL, blankPayload, toStored } from "../../lib/admin";

export interface EditorBlock {
  /** Local only. Blocks are identified by position in the database. */
  uid: string;
  kind: BlockKind;
  payload: Record<string, unknown>;
}

interface Props {
  reportId: string;
  initial: { kind: BlockKind; payload: Record<string, unknown> }[];
  previewSrc: string;
}

const uid = () => Math.random().toString(36).slice(2, 10);

export default function Editor({ reportId, initial, previewSrc }: Props) {
  const [blocks, setBlocks] = useState<EditorBlock[]>(() =>
    initial.map((b) => ({ uid: uid(), kind: b.kind, payload: { ...b.payload } })),
  );
  const [saved, setSaved] = useState(() => JSON.stringify(initial));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [raw, setRaw] = useState<Record<string, boolean>>({});
  /* The last deleted block and where it was, so Delete is reversible. */
  const [undo, setUndo] = useState<{ block: EditorBlock; at: number } | null>(null);
  /* ── unparseable JSON drafts, kept out here on purpose ────────────────
   *
   * JsonField used to hold its text in its own state and commit only on a
   * successful parse — correct, because a half-typed object must not become
   * the block. But collapsing the block unmounts the field, and the text went
   * with it: a minute of editing vanished on a click, in silence. `dirty` was
   * false in that state too, so the unload warning did not fire either.
   *
   * Held here, the text outlives the field, the block bar can say the draft is
   * broken, and save() refuses rather than writing a document that is missing
   * the edit the person is looking at. */
  const [badDraft, setBadDraft] = useState<Record<string, string>>({});
  const frame = useRef<HTMLIFrameElement>(null);

  const wire = useMemo(
    () => blocks.map((b) => ({ kind: b.kind, payload: b.payload })),
    [blocks],
  );
  const broken = Object.keys(badDraft);
  /* An unparseable draft is unsaved work even though it has not reached
     `wire` — so it counts as dirty, and the unload warning covers it. */
  const dirty = JSON.stringify(wire) !== saved || broken.length > 0;

  /* Leaving with unsaved edits loses them, and an editor that does that once
     is an editor nobody trusts again. */
  /* The metadata form on this page is a plain full-page POST, and a POST is a
     navigation: submitting it reloads and takes unsaved block edits with it.
     The two live in different components — one Astro, one React — so the flag
     goes on the document and a four-line inline script on the page reads it.
     See src/pages/admin/reports/[id].astro. */
  useEffect(() => {
    document.documentElement.dataset.blocksDirty = dirty ? "1" : "";
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      /* preventDefault() alone is the modern spec and works from Chrome 119
         and Firefox 122. Before those, the dialog only appears if returnValue
         is set to a non-empty string — so on an older browser this listener
         was registered, ran, and did nothing at all. The string is never
         shown; every engine substitutes its own wording. */
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const patch = useCallback((id: string, payload: Record<string, unknown>) => {
    setBlocks((bs) => bs.map((b) => (b.uid === id ? { ...b, payload } : b)));
  }, []);

  const move = (id: string, by: number) =>
    setBlocks((bs) => {
      const i = bs.findIndex((b) => b.uid === id);
      const j = i + by;
      if (i < 0 || j < 0 || j >= bs.length) return bs;
      const next = bs.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const add = (kind: BlockKind) =>
    setBlocks((bs) => {
      const b: EditorBlock = { uid: uid(), kind, payload: toStored(blankPayload(kind)) };
      setOpen(b.uid);
      return [...bs, b];
    });

  const duplicate = (id: string) =>
    setBlocks((bs) => {
      const i = bs.findIndex((b) => b.uid === id);
      if (i < 0) return bs;
      const copy: EditorBlock = { ...bs[i], uid: uid(), payload: structuredClone(bs[i].payload) };
      return [...bs.slice(0, i + 1), copy, ...bs.slice(i + 1)];
    });

  /* ── delete, undone ──────────────────────────────────────────────────
   *
   * Delete sat one pixel from Duplicate with no confirmation and no way back,
   * on a block that might hold a morning's work. A confirm() would interrupt
   * every deliberate delete to prevent the rare accidental one; keeping the
   * block and offering it back costs nothing and is the same answer the
   * database gives (save_report_blocks snapshots to report_revisions before it
   * writes). The stash survives until the next delete or a save. */
  const remove = (id: string) => {
    const at = blocks.findIndex((b) => b.uid === id);
    if (at < 0) return;
    /* Read out of `blocks` rather than inside the updater: an updater that has
       side effects runs twice under StrictMode and would stash the wrong one. */
    setUndo({ block: blocks[at], at });
    if (open === id) setOpen(null);
    setBlocks((bs) => bs.filter((b) => b.uid !== id));
  };

  const restore = () => {
    if (!undo) return;
    setBlocks((bs) => [...bs.slice(0, undo.at), undo.block, ...bs.slice(undo.at)]);
    setOpen(undo.block.uid);
    setUndo(null);
  };

  async function save() {
    if (broken.length) {
      /* Saving here would write every OTHER block and silently drop the one
         being typed into, which reads as a successful save. */
      setProblem(
        `${broken.length} block(s) have JSON that does not parse yet. ` +
          `Fix or revert them — saving now would leave those edits out.`,
      );
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch(`/admin/reports/${reportId}/save`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ blocks: wire }),
      });
      const out = await res.json().catch(() => ({ ok: false, message: "no response body" }));
      if (!res.ok || !out.ok) {
        setProblem(out.message || `save failed (${res.status})`);
        return;
      }
      setSaved(JSON.stringify(wire));
      /* The save is the new floor. Offering to restore a block into a document
         that has since been written would put it back without saving it, which
         reads as "undone" and is not. */
      setUndo(null);
      /* Reload rather than re-render: the preview is the real renderer, and
         the only way to see what it will do is to ask it again. */
      if (frame.current) frame.current.src = `${previewSrc}?t=${Date.now()}`;
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ed">
      <div className="col">
        <div className="bar">
          <strong>{blocks.length} block{blocks.length === 1 ? "" : "s"}</strong>
          <span className={dirty ? "dot on" : "dot"}>{dirty ? "unsaved" : "saved"}</span>
          <button className="primary" onClick={save} disabled={busy || !dirty}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>

        {problem && <p className="bad">{problem}</p>}

        {undo && (
          <p className="undo" role="status">
            <span>Deleted the {BLOCK_LABEL[undo.block.kind]} block.</span>
            <button onClick={restore}>Undo</button>
            <button className="quiet" onClick={() => setUndo(null)}>
              Dismiss
            </button>
          </p>
        )}

        <ol className="blocks">
          {blocks.map((b, i) => (
            <li key={b.uid} className={open === b.uid ? "blk open" : "blk"}>
              <div className="blkbar">
                <button
                  className="name"
                  onClick={() => setOpen(open === b.uid ? null : b.uid)}
                  aria-expanded={open === b.uid}
                >
                  <span className="ord">{i + 1}</span>
                  {BLOCK_LABEL[b.kind]}
                  <span className="sum">
                    {badDraft[b.uid] ? "unfinished JSON — not saved" : summarise(b)}
                  </span>
                </button>
                {/* aria-label, not title.
                    Name-from-content wins over `title`, so a screen reader
                    announced these as "up arrow button", "times button" and —
                    for ⧉, which has no spoken name in most voices — nothing at
                    all. The label names the block as well as the action,
                    because four identical buttons repeat down the list and
                    "Delete" on its own does not say delete what. */}
                <span className="tools">
                  <button
                    onClick={() => move(b.uid, -1)}
                    disabled={i === 0}
                    title="Move up"
                    aria-label={`Move ${BLOCK_LABEL[b.kind]} block ${i + 1} up`}
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => move(b.uid, 1)}
                    disabled={i === blocks.length - 1}
                    title="Move down"
                    aria-label={`Move ${BLOCK_LABEL[b.kind]} block ${i + 1} down`}
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => duplicate(b.uid)}
                    title="Duplicate"
                    aria-label={`Duplicate ${BLOCK_LABEL[b.kind]} block ${i + 1}`}
                  >
                    ⧉
                  </button>
                  <button
                    onClick={() => remove(b.uid)}
                    title="Delete"
                    aria-label={`Delete ${BLOCK_LABEL[b.kind]} block ${i + 1}`}
                    className="del"
                  >
                    ×
                  </button>
                </span>
              </div>

              {open === b.uid && (
                <div className="body">
                  <p className="hint">{BLOCK_HINT[b.kind]}</p>
                  {raw[b.uid] ? (
                    <JsonField
                      value={b.payload}
                      draft={badDraft[b.uid]}
                      onChange={(v) => patch(b.uid, v)}
                      onBroken={(text) =>
                        setBadDraft((d) => {
                          if (text === null) {
                            if (!(b.uid in d)) return d;
                            const { [b.uid]: _gone, ...rest } = d;
                            return rest;
                          }
                          return { ...d, [b.uid]: text };
                        })
                      }
                    />
                  ) : (
                    <Fields block={b} onChange={(v) => patch(b.uid, v)} />
                  )}
                  <label className="rawtoggle">
                    <input
                      type="checkbox"
                      checked={!!raw[b.uid]}
                      onChange={(e) => setRaw({ ...raw, [b.uid]: e.target.checked })}
                    />
                    Edit as JSON
                  </label>
                </div>
              )}
            </li>
          ))}
        </ol>

        <div className="add">
          <span className="label">Add a block</span>
          <div className="kinds">
            {BLOCK_KINDS.map((k) => (
              <button key={k} onClick={() => add(k)}>
                {BLOCK_LABEL[k]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="col preview">
        <div className="bar">
          <strong>Preview</strong>
          <span className="note">the published renderer, on the saved draft</span>
          <a className="pop" href={previewSrc} target="_blank" rel="noopener">
            Open
          </a>
        </div>
        <iframe ref={frame} src={previewSrc} title="Draft preview" />
      </div>
    </div>
  );
}

/* ── a one-line description, so a collapsed list is still readable ──── */
function summarise(b: EditorBlock): string {
  const p = b.payload as Record<string, never>;
  const first = (v: unknown) => (Array.isArray(v) ? String(v[0] ?? "") : String(v ?? ""));
  switch (b.kind) {
    case "prose":
      return clip(first(p.paragraphs));
    case "callout":
      return clip(String(p.title || first(p.body)));
    case "quote":
      return clip(String(p.text ?? ""));
    case "cta":
      return clip(String(p.headline ?? ""));
    case "embed":
      return clip(String(p.title ?? ""));
    case "kpi_row":
      return `${(p.items as unknown[])?.length ?? 0} figures`;
    case "chart":
      return `${p.chartKind} · ${((p.seriesKeys as string[]) ?? []).join(", ") || "no series"}`;
    case "timeline":
    case "map":
      return `tags: ${((p.tags as string[]) ?? []).join(", ") || "none"}`;
    case "table":
      return `${((p.rows as unknown[]) ?? []).length} rows`;
    case "sourcebox":
      return ((p.sourceKeys as string[]) ?? []).join(", ") || "no sources";
  }
}
const clip = (s: string) => (s.length > 64 ? `${s.slice(0, 63)}…` : s);

/* ── the JSON escape hatch ──────────────────────────────────────────── */
function JsonField({
  value,
  draft,
  onChange,
  onBroken,
}: {
  value: Record<string, unknown>;
  /** An unparseable draft from a previous mount, or undefined. */
  draft?: string;
  onChange: (v: Record<string, unknown>) => void;
  /** The text when it does not parse, or null once it does. */
  onBroken: (text: string | null) => void;
}) {
  const [text, setText] = useState(() => draft ?? JSON.stringify(value, null, 2));
  const [err, setErr] = useState<string | null>(() => (draft ? "not valid JSON" : null));
  return (
    <div className="field">
      <textarea
        rows={14}
        className="mono"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          try {
            /* A half-typed object still must not become the block — that part
               was always right. What changed is where the half-typed text
               lives, so collapsing the block no longer throws it away. */
            onChange(JSON.parse(e.target.value));
            setErr(null);
            onBroken(null);
          } catch (x) {
            setErr(x instanceof Error ? x.message : "not valid JSON");
            onBroken(e.target.value);
          }
        }}
      />
      {err && <p className="bad small">{err}</p>}
    </div>
  );
}

/* ── per-kind fields ────────────────────────────────────────────────── */
function Fields({
  block,
  onChange,
}: {
  block: EditorBlock;
  onChange: (v: Record<string, unknown>) => void;
}) {
  const p = block.payload;
  const set = (k: string, v: unknown) => onChange({ ...p, [k]: v });

  switch (block.kind) {
    case "prose":
      return (
        <>
          <Lines label="Paragraphs" value={(p.paragraphs as string[]) ?? []} onChange={(v) => set("paragraphs", v)} />
          <Check label="Standfirst (larger type, one per report)" value={!!p.lead} onChange={(v) => set("lead", v)} />
        </>
      );

    case "callout":
      return (
        <>
          <Select
            label="Tone"
            value={String(p.tone ?? "note")}
            options={[
              ["note", "Note — skippable context"],
              ["risk", "Risk — changes how to read the rest"],
              ["method", "Method — how a figure was arrived at"],
            ]}
            onChange={(v) => set("tone", v)}
          />
          <Text label="Title" value={String(p.title ?? "")} onChange={(v) => set("title", v)} />
          <Lines label="Body" value={(p.body as string[]) ?? []} onChange={(v) => set("body", v)} />
        </>
      );

    case "quote":
      return (
        <>
          <Area label="Quotation" value={String(p.text ?? "")} onChange={(v) => set("text", v)} />
          <Text label="Who" value={String(p.who ?? "")} onChange={(v) => set("who", v)} />
          <Text
            label="Role — say here if it is illustrative"
            value={String(p.role ?? "")}
            onChange={(v) => set("role", v)}
          />
        </>
      );

    case "cta":
      return (
        <>
          <Text label="Headline" value={String(p.headline ?? "")} onChange={(v) => set("headline", v)} />
          <Area label="Body" value={String(p.body ?? "")} onChange={(v) => set("body", v)} />
          <Text label="Button label" value={String(p.label ?? "")} onChange={(v) => set("label", v)} />
          <Text
            label="Link (blank uses PUBLIC_PORTAL_URL)"
            value={String(p.href ?? "")}
            onChange={(v) => set("href", v || undefined)}
          />
        </>
      );

    case "embed":
      return (
        <>
          <Text label="URL (https, or a path on this site)" value={String(p.url ?? "")} onChange={(v) => set("url", v)} />
          <Text label="Title" value={String(p.title ?? "")} onChange={(v) => set("title", v)} />
          <Text
            label="Height in px"
            value={String(p.height ?? "")}
            onChange={(v) => set("height", v ? Number(v) : undefined)}
          />
        </>
      );

    case "chart":
      return (
        <>
          <Select
            label="Kind"
            value={String(p.chartKind ?? "area")}
            options={[
              ["area", "Area — one series over time, carries gaps"],
              ["index", "Index — two series rebased to 100"],
              ["bar", "Bar — one series by category"],
            ]}
            onChange={(v) => set("chartKind", v)}
          />
          <Csv label="Series keys" value={(p.seriesKeys as string[]) ?? []} onChange={(v) => set("seriesKeys", v)} />
          <Text label="Label" value={String(p.label ?? "")} onChange={(v) => set("label", v || undefined)} />
          <Area label="Caption" value={String(p.caption ?? "")} onChange={(v) => set("caption", v || undefined)} />
          <Select
            label="Lane"
            value={String(p.lane ?? "wide")}
            options={[
              ["content", "Content — the reading measure"],
              ["wide", "Wide"],
              ["full", "Full bleed"],
            ]}
            onChange={(v) => set("lane", v)}
          />
        </>
      );

    case "timeline":
    case "map":
      return (
        <>
          <Csv label="Event tags" value={(p.tags as string[]) ?? []} onChange={(v) => set("tags", v)} />
          <Area label="Caption" value={String(p.caption ?? "")} onChange={(v) => set("caption", v || undefined)} />
          {block.kind === "map" && (
            <p className="hint">
              The bounding box, coastline outline and place labels live in the JSON view.
            </p>
          )}
        </>
      );

    case "sourcebox":
      return (
        <>
          <Csv label="Source keys" value={(p.sourceKeys as string[]) ?? []} onChange={(v) => set("sourceKeys", v)} />
          <Area label="Note" value={String(p.note ?? "")} onChange={(v) => set("note", v || undefined)} />
        </>
      );

    case "kpi_row":
      return (
        <Items
          items={(p.items as Record<string, unknown>[]) ?? []}
          onChange={(v) => set("items", v)}
          blank={{ label: "Label", value: "0", indicative: true }}
          render={(it, upd) => (
            <>
              <Text label="Label" value={String(it.label ?? "")} onChange={(v) => upd({ ...it, label: v })} />
              <Text label="Value" value={String(it.value ?? "")} onChange={(v) => upd({ ...it, value: v })} />
              <Text label="Unit" value={String(it.unit ?? "")} onChange={(v) => upd({ ...it, unit: v || undefined })} />
              <Text label="Delta" value={String(it.delta ?? "")} onChange={(v) => upd({ ...it, delta: v || undefined })} />
              <Text
                label="Source key"
                value={String(it.sourceKey ?? "")}
                onChange={(v) => upd({ ...it, sourceKey: v || undefined })}
              />
              <Check
                label="Indicative (required if there is no source key)"
                value={!!it.indicative}
                onChange={(v) => upd({ ...it, indicative: v })}
              />
            </>
          )}
        />
      );

    case "table":
      return (
        <>
          <p className="hint">
            Columns and rows are structured; edit them in the JSON view. Provenance is not
            optional — a table prints figures.
          </p>
          <Text
            label="Source key"
            value={String(p.sourceKey ?? "")}
            onChange={(v) => set("sourceKey", v || undefined)}
          />
          <Check label="Indicative" value={!!p.indicative} onChange={(v) => set("indicative", v)} />
          <Area label="Caption" value={String(p.caption ?? "")} onChange={(v) => set("caption", v || undefined)} />
        </>
      );
  }
}

/* ── small field primitives ─────────────────────────────────────────── */

function Text({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Area({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="field row">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, t]) => (
          <option key={v} value={v}>
            {t}
          </option>
        ))}
      </select>
    </label>
  );
}

/** One paragraph per line, because that is how prose is actually typed. */
function Lines({ label, value, onChange }: { label: string; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <label className="field">
      <span>{label} — one per line, blank lines ignored</span>
      <textarea
        rows={8}
        value={value.join("\n\n")}
        onChange={(e) =>
          onChange(
            e.target.value
              .split(/\n{2,}/)
              .map((s) => s.trim())
              .filter(Boolean),
          )
        }
      />
    </label>
  );
}

function Csv({ label, value, onChange }: { label: string; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <label className="field">
      <span>{label} — comma separated</span>
      <input
        value={value.join(", ")}
        onChange={(e) =>
          onChange(
            e.target.value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          )
        }
      />
    </label>
  );
}

function Items({
  items,
  onChange,
  blank,
  render,
}: {
  items: Record<string, unknown>[];
  onChange: (v: Record<string, unknown>[]) => void;
  blank: Record<string, unknown>;
  render: (it: Record<string, unknown>, upd: (v: Record<string, unknown>) => void) => React.ReactNode;
}) {
  /* ── why these rows carry an id ───────────────────────────────────────
   *
   * This keyed on the array index. The VALUES stayed correct, because every
   * field is controlled — but React matches by key, so removing row 2 left the
   * caret, the focus ring and the browser's per-field undo history sitting in
   * what was row 3's DOM node, now showing row 2's data. Typing then edited
   * one row while the cursor appeared to be in another.
   *
   * The id is deliberately NOT written into the item: these objects are the
   * stored payload and go to the database as they are. It is bookkeeping for
   * the rendering, so it lives beside the array and is kept in step in the two
   * places that change its length. */
  const [ids, setIds] = useState<string[]>(() => items.map(() => uid()));
  if (ids.length !== items.length) {
    /* The array changed underneath us — the JSON editor rewrote it, or a
       payload arrived from elsewhere. Keep the ids we can still line up and
       mint the rest. Setting state during render is the supported way to
       derive from props; React re-runs this component before painting. */
    setIds(items.map((_, i) => ids[i] ?? uid()));
  }

  const removeAt = (i: number) => {
    setIds(ids.filter((_, j) => j !== i));
    onChange(items.filter((_, j) => j !== i));
  };
  const addRow = () => {
    setIds([...ids, uid()]);
    onChange([...items, { ...blank }]);
  };

  return (
    <div className="items">
      {items.map((it, i) => (
        <div className="item" key={ids[i]}>
          <div className="itembar">
            <span className="label">#{i + 1}</span>
            <button onClick={() => removeAt(i)}>Remove</button>
          </div>
          {render(it, (v) => onChange(items.map((x, j) => (j === i ? v : x))))}
        </div>
      ))}
      <button className="addrow" onClick={addRow}>
        Add
      </button>
    </div>
  );
}
