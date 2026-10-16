//! Readers for the OEIS dumps and the oeisdata repository.

use std::collections::HashMap;
use std::fs::File;
use std::io::{self, BufRead, BufReader};
use std::path::Path;

use flate2::read::GzDecoder;
use rayon::prelude::*;

use crate::terms::{self, Term};

#[derive(Clone, Debug, Default)]
pub struct Entry {
    pub number: u32,
    pub name: String,
    pub terms: Vec<Term>,
    pub offset: i32,
    pub keywords: Vec<String>,
    pub xrefs: Vec<u32>,
}

fn gz_lines(path: &Path) -> io::Result<impl Iterator<Item = io::Result<String>>> {
    let file = File::open(path)?;
    Ok(BufReader::new(GzDecoder::new(file)).lines())
}

pub fn parse_anumber(text: &str) -> Option<u32> {
    let rest = text.strip_prefix('A')?;
    if rest.len() != 6 && rest.len() != 7 {
        return None;
    }
    rest.parse().ok()
}

pub fn parse_stripped_line(line: &str) -> Option<(u32, Vec<Term>)> {
    let (id, body) = line.split_once(' ')?;
    let number = parse_anumber(id)?;
    let terms = body
        .split(',')
        .filter(|s| !s.is_empty())
        .map(terms::parse)
        .collect::<Option<Vec<_>>>()?;
    Some((number, terms))
}

pub fn load_dumps(stripped: &Path, names: &Path) -> io::Result<Vec<Entry>> {
    let mut by_number: HashMap<u32, Entry> = HashMap::with_capacity(420_000);
    for line in gz_lines(stripped)? {
        let line = line?;
        if line.starts_with('#') {
            continue;
        }
        if let Some((number, terms)) = parse_stripped_line(&line) {
            by_number.insert(
                number,
                Entry {
                    number,
                    terms,
                    offset: 1,
                    ..Default::default()
                },
            );
        }
    }
    for line in gz_lines(names)? {
        let line = line?;
        if line.starts_with('#') {
            continue;
        }
        if let Some((id, name)) = line.split_once(' ')
            && let Some(number) = parse_anumber(id)
            && let Some(entry) = by_number.get_mut(&number)
        {
            entry.name = name.to_string();
        }
    }
    let mut entries: Vec<Entry> = by_number.into_values().collect();
    entries.sort_by_key(|e| e.number);
    Ok(entries)
}

/// Offset, keywords, and cross references from one oeisdata .seq file.
pub struct SeqMeta {
    pub offset: i32,
    pub keywords: Vec<String>,
    pub xrefs: Vec<u32>,
}

pub fn parse_seq_file(text: &str, own: u32) -> SeqMeta {
    let mut meta = SeqMeta {
        offset: 1,
        keywords: Vec::new(),
        xrefs: Vec::new(),
    };
    for line in text.lines() {
        let Some(rest) = line.get(3..) else { continue };
        let Some((_, body)) = rest.split_once(' ') else {
            continue;
        };
        match &line[..2] {
            "%O" => {
                if let Some(first) = body.split(',').next() {
                    meta.offset = first.trim().parse().unwrap_or(1);
                }
            }
            "%K" => {
                meta.keywords = body
                    .split(',')
                    .map(|k| k.trim().to_string())
                    .filter(|k| !k.is_empty())
                    .collect();
            }
            "%Y" => {
                let bytes = body.as_bytes();
                let mut i = 0;
                while i + 7 <= bytes.len() {
                    if bytes[i] == b'A' && bytes[i + 1..i + 7].iter().all(|b| b.is_ascii_digit()) {
                        let end = if i + 7 < bytes.len() && bytes[i + 7].is_ascii_digit() {
                            i + 8
                        } else {
                            i + 7
                        };
                        if let Ok(n) = body[i + 1..end].parse::<u32>()
                            && n != own
                        {
                            meta.xrefs.push(n);
                        }
                        i = end;
                    } else {
                        i += 1;
                    }
                }
            }
            _ => {}
        }
    }
    meta.xrefs.sort_unstable();
    meta.xrefs.dedup();
    meta
}

fn seq_path(dir: &Path, number: u32) -> std::path::PathBuf {
    let id = format!("A{number:06}");
    dir.join("seq").join(&id[..4]).join(format!("{id}.seq"))
}

pub fn merge_oeisdata(dir: &Path, entries: &mut [Entry]) -> usize {
    entries
        .par_iter_mut()
        .map(|entry| {
            let Ok(text) = std::fs::read_to_string(seq_path(dir, entry.number)) else {
                return 0;
            };
            let meta = parse_seq_file(&text, entry.number);
            entry.offset = meta.offset;
            entry.keywords = meta.keywords;
            entry.xrefs = meta.xrefs;
            1
        })
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_stripped_line() {
        let (n, terms) = parse_stripped_line("A000045 ,0,1,1,2,3,5,8,").unwrap();
        assert_eq!(n, 45);
        assert_eq!(terms.len(), 7);
        assert_eq!(terms[6].exact, Some(8));
    }

    #[test]
    fn reads_seq_metadata() {
        let text = "%I A000045 M0692 N0256\n%S A000045 0,1,1,2\n%N A000045 Fibonacci numbers.\n%O A000045 0,4\n%K A000045 core,nonn,nice,easy\n%Y A000045 Cf. A000032, A000204 and A000045.\n";
        let meta = parse_seq_file(text, 45);
        assert_eq!(meta.offset, 0);
        assert_eq!(meta.keywords, vec!["core", "nonn", "nice", "easy"]);
        assert_eq!(meta.xrefs, vec![32, 204]);
    }
}
