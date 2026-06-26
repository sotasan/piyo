-- Repositories the user has added to the sidebar, in drag-to-reorder order.
CREATE TABLE repositories (
    id       TEXT    PRIMARY KEY NOT NULL,  -- uuid v4 (hyphenated text)
    path     TEXT    NOT NULL UNIQUE,       -- working-directory root
    position INTEGER NOT NULL               -- sort order in the sidebar
);

-- Terminal sessions (tabs). Each belongs to a repository (cascade-deleted with
-- it) and is pinned to one of that repo's worktrees. `id` doubles as the zmx
-- session name (`piyo-<id>`), so it must be stable across launches.
CREATE TABLE sessions (
    id            TEXT    PRIMARY KEY NOT NULL,  -- uuid v4; also the zmx session id
    repository_id TEXT    NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    worktree_path TEXT    NOT NULL,
    position      INTEGER NOT NULL               -- sort order within the worktree
);

CREATE INDEX sessions_by_worktree ON sessions (worktree_path);
CREATE INDEX sessions_by_repository ON sessions (repository_id);
