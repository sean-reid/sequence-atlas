CREATE TABLE seq (
  number INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  terms TEXT NOT NULL
);

CREATE VIRTUAL TABLE name_index USING fts5(name, content='seq', content_rowid='number');

CREATE VIRTUAL TABLE terms_index USING fts5(terms, content='seq', content_rowid='number');
