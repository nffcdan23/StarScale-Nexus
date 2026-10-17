import { readFileSync } from 'node:fs'

// Made-up people and records used by every security check. Each check loads
// them inside a transaction that is rolled back, so nothing is left behind.

export const ids = {
  owner: '11111111-1111-4111-8111-111111111111',
  tv: '22222222-2222-4222-8222-222222222222',
  otherOwner: '33333333-3333-4333-8333-333333333333',
  stranger: '44444444-4444-4444-8444-444444444444',
  contextVisible: 'aaaaaaaa-0000-4000-8000-000000000001',
  contextPrivate: 'aaaaaaaa-0000-4000-8000-000000000002',
  contextOther: 'aaaaaaaa-0000-4000-8000-000000000003',
  /** Created only by the checks that need it, not by seedSql. */
  contextArchived: 'aaaaaaaa-0000-4000-8000-000000000004',
  taskVisible: 'bbbbbbbb-0000-4000-8000-000000000001',
  taskDone: 'bbbbbbbb-0000-4000-8000-000000000004',
  taskArchived: 'bbbbbbbb-0000-4000-8000-000000000005',
  taskOther: 'bbbbbbbb-0000-4000-8000-000000000006',
  noteFiled: 'cccccccc-0000-4000-8000-000000000001',
  noteUncategorised: 'cccccccc-0000-4000-8000-000000000002',
  noteArchived: 'cccccccc-0000-4000-8000-000000000003',
  noteOther: 'cccccccc-0000-4000-8000-000000000004',
  projectOwn: 'dddddddd-0000-4000-8000-000000000001',
  projectArchived: 'dddddddd-0000-4000-8000-000000000002',
  projectOther: 'dddddddd-0000-4000-8000-000000000003',
}

/** Text in a note's body that must never reach the TV. */
export const secretNoteBody = 'SECRET-NOTE-BODY'

/**
 * A note using every approved editor format, exactly as the editor saves it,
 * with the plain text the database must derive from it. Also used by the
 * editor tests in src/features/notes/editor.
 */
export const richNote = JSON.parse(readFileSync(new URL('./rich-note.json', import.meta.url), 'utf8'))

/** A one-paragraph note document, as the editor saves it. */
export const noteDoc = (text) => JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

/** Text that must never reach the TV. */
export const secretNote = 'SECRET-NOTE-DO-NOT-SHOW'

/**
 * Who is asking. "role" and "claims" are what the Supabase Data API hands
 * the database for that kind of visitor.
 */
export const identities = {
  anonymous: {
    label: 'Not signed in',
    role: 'anon',
    claims: { role: 'anon' },
  },
  tv: {
    label: 'TV sign-in',
    role: 'authenticated',
    claims: { sub: ids.tv, role: 'authenticated', aal: 'aal1' },
  },
  ownerNoCode: {
    label: 'Owner, no authenticator code',
    role: 'authenticated',
    claims: { sub: ids.owner, role: 'authenticated', aal: 'aal1' },
  },
  ownerWithCode: {
    label: 'Owner, with authenticator code',
    role: 'authenticated',
    claims: { sub: ids.owner, role: 'authenticated', aal: 'aal2' },
  },
  tvWithCode: {
    label: 'TV sign-in that enrolled its own authenticator',
    role: 'authenticated',
    claims: { sub: ids.tv, role: 'authenticated', aal: 'aal2' },
  },
  strangerWithCode: {
    label: 'Unregistered sign-in, with authenticator code',
    role: 'authenticated',
    claims: { sub: ids.stranger, role: 'authenticated', aal: 'aal2' },
  },
}

/** Run as the database administrator before each check. */
export const seedSql = `
insert into auth.users (id) values
  ('${ids.owner}'), ('${ids.tv}'), ('${ids.otherOwner}'), ('${ids.stranger}');

insert into private.identities (user_id, kind, owner_id, label) values
  ('${ids.owner}', 'owner', null, 'Owner'),
  ('${ids.tv}', 'tv', '${ids.owner}', 'Office TV'),
  ('${ids.otherOwner}', 'owner', null, 'A second owner');

insert into public.contexts (id, owner_id, name, slug, show_on_tv) values
  ('${ids.contextVisible}', '${ids.owner}', 'StarScale', 'starscale', true),
  ('${ids.contextPrivate}', '${ids.owner}', 'Personal', 'personal', false),
  ('${ids.contextOther}', '${ids.otherOwner}', 'Elsewhere', 'elsewhere', true);

insert into public.projects (id, owner_id, name, context_id, archived_at) values
  ('${ids.projectOwn}', '${ids.owner}', 'Nexus build', '${ids.contextVisible}', null),
  ('${ids.projectArchived}', '${ids.owner}', 'Old launch', null, now()),
  ('${ids.projectOther}', '${ids.otherOwner}', 'Elsewhere project', null, null);

insert into public.tasks (id, owner_id, context_id, title, notes, status, hide_from_tv, archived_at, project_id) values
  ('${ids.taskVisible}', '${ids.owner}', '${ids.contextVisible}', 'Visible task', '${secretNote}', 'open', false, null, '${ids.projectOwn}'),
  ('bbbbbbbb-0000-4000-8000-000000000002', '${ids.owner}', '${ids.contextVisible}', 'Hidden task', null, 'open', true, null, null),
  ('bbbbbbbb-0000-4000-8000-000000000003', '${ids.owner}', '${ids.contextPrivate}', 'Private context task', null, 'open', false, null, null),
  ('bbbbbbbb-0000-4000-8000-000000000004', '${ids.owner}', '${ids.contextVisible}', 'Finished task', null, 'done', false, null, null),
  ('bbbbbbbb-0000-4000-8000-000000000005', '${ids.owner}', '${ids.contextVisible}', 'Archived task', null, 'open', false, now(), null),
  ('${ids.taskOther}', '${ids.otherOwner}', '${ids.contextOther}', 'Other owner task', null, 'open', false, null, null);

insert into public.notes (id, owner_id, context_id, title, content, archived_at, project_id) values
  ('${ids.noteFiled}', '${ids.owner}', '${ids.contextVisible}', 'Board meeting',
    '${noteDoc(`Discuss the investor timeline ${secretNoteBody}`)}', null, '${ids.projectOwn}'),
  ('${ids.noteUncategorised}', '${ids.owner}', null, 'Shopping list', '${noteDoc('Buy milk and bread')}', null, null),
  ('${ids.noteArchived}', '${ids.owner}', '${ids.contextVisible}', 'Old idea', '${noteDoc('An investor pitch from last year')}', now(), null),
  ('${ids.noteOther}', '${ids.otherOwner}', '${ids.contextOther}', 'Other owner note', '${noteDoc('Investor notes elsewhere')}', null, null);
`
