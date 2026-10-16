//! Reader for the oeisdata repository, one .seq file per sequence.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use rayon::prelude::*;

use crate::terms::{self, Term};

#[derive(Clone, Debug, Default)]
pub struct Entry {
    pub number: u32,
    pub name: String,
    pub terms: Vec<Term>,
    /// The terms as printed in the file, for display.
    pub text: Vec<String>,
    pub offset: i32,
    pub keywords: Vec<String>,
    pub xrefs: Vec<u32>,
}

pub fn parse_anumber(text: &str) -> Option<u32> {
    let rest = text.strip_prefix('A')?;
    if rest.len() != 6 && rest.len() != 7 {
        return None;
    }
    rest.parse().ok()
}

/// One .seq file: %S, %T, %U hold the terms, %N the name, %O the offset,
/// %K the keywords, %Y the cross references.
pub fn parse_seq_file(text: &str, number: u32) -> Option<Entry> {
    let mut entry = Entry {
        number,
        offset: 1,
        ..Default::default()
    };
    let mut data = String::new();
    for line in text.lines() {
        let Some(rest) = line.get(3..) else { continue };
        let Some((_, body)) = rest.split_once(' ') else {
            continue;
        };
        match &line[..2] {
            "%S" | "%T" | "%U" => data.push_str(body.trim()),
            "%N" => entry.name = body.trim().to_string(),
            "%O" => {
                if let Some(first) = body.split(',').next() {
                    entry.offset = first.trim().parse().unwrap_or(1);
                }
            }
            "%K" => {
                entry.keywords = body
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
                            && n != number
                        {
                            entry.xrefs.push(n);
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
    entry.text = data
        .split(',')
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect();
    entry.terms = entry
        .text
        .iter()
        .map(|s| terms::parse(s))
        .collect::<Option<Vec<_>>>()?;
    entry.xrefs.sort_unstable();
    entry.xrefs.dedup();
    Some(entry)
}

fn seq_files(dir: &Path) -> io::Result<Vec<PathBuf>> {
    let mut files = Vec::with_capacity(420_000);
    for bucket in fs::read_dir(dir.join("seq"))? {
        let bucket = bucket?.path();
        if !bucket.is_dir() {
            continue;
        }
        for file in fs::read_dir(&bucket)? {
            let file = file?.path();
            if file.extension().is_some_and(|e| e == "seq") {
                files.push(file);
            }
        }
    }
    Ok(files)
}

pub fn load_oeisdata(dir: &Path) -> io::Result<Vec<Entry>> {
    let files = seq_files(dir)?;
    let mut entries: Vec<Entry> = files
        .par_iter()
        .filter_map(|path| {
            let number = parse_anumber(path.file_stem()?.to_str()?)?;
            let text = fs::read_to_string(path).ok()?;
            parse_seq_file(&text, number)
        })
        .collect();
    entries.sort_by_key(|e| e.number);
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_seq_file() {
        let text = "%I A000045 M0692 N0256\n%S A000045 0,1,1,2,3,5,8,\n%T A000045 13,21,34,\n%U A000045 55,89\n%N A000045 Fibonacci numbers.\n%O A000045 0,4\n%K A000045 core,nonn,nice,easy\n%Y A000045 Cf. A000032, A000204 and A000045.\n";
        let e = parse_seq_file(text, 45).unwrap();
        assert_eq!(e.name, "Fibonacci numbers.");
        assert_eq!(e.text.len(), 12);
        assert_eq!(e.terms[11].exact, Some(89));
        assert_eq!(e.offset, 0);
        assert_eq!(e.keywords, vec!["core", "nonn", "nice", "easy"]);
        assert_eq!(e.xrefs, vec![32, 204]);
    }

    #[test]
    fn rejects_files_with_unparsable_terms() {
        assert!(parse_seq_file("%S A000001 1,2,x\n%N A000001 Broken.\n", 1).is_none());
        assert_eq!(parse_anumber("A000045"), Some(45));
        assert_eq!(parse_anumber("B000045"), None);
    }
}
