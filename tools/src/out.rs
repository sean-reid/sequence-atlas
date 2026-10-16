//! Output files: a feature matrix, a column list, per-sequence metadata, and the xref edge list.

use std::fs::{self, File};
use std::io::{self, BufWriter, Write};
use std::path::Path;

use crate::features;
use crate::oeis::Entry;

/// Terms kept for the detail panel; the dumps hold at most a few hundred characters anyway.
const SHOWN_TERMS: usize = 60;

pub fn write(dir: &Path, entries: &[Entry], rows: &[Vec<f32>]) -> io::Result<()> {
    fs::create_dir_all(dir)?;
    let cols = features::columns();

    let mut f = BufWriter::new(File::create(dir.join("features.f32"))?);
    for row in rows {
        for v in row {
            let v = if v.is_finite() { *v } else { 0.0 };
            f.write_all(&v.to_le_bytes())?;
        }
    }
    f.flush()?;

    let mut c = BufWriter::new(File::create(dir.join("columns.tsv"))?);
    for col in &cols {
        writeln!(c, "{}\t{}", col.family, col.name)?;
    }
    c.flush()?;

    let mut m = BufWriter::new(File::create(dir.join("meta.tsv"))?);
    writeln!(m, "number\tnterms\toffset\tkeywords\tname\tterms")?;
    for e in entries {
        writeln!(
            m,
            "{}\t{}\t{}\t{}\t{}\t{}",
            e.number,
            e.terms.len(),
            e.offset,
            e.keywords.join(","),
            e.name.replace('\t', " "),
            e.text
                .iter()
                .take(SHOWN_TERMS)
                .cloned()
                .collect::<Vec<_>>()
                .join(",")
        )?;
    }
    m.flush()?;

    let mut x = BufWriter::new(File::create(dir.join("xrefs.tsv"))?);
    for e in entries {
        for r in &e.xrefs {
            writeln!(x, "{}\t{}", e.number, r)?;
        }
    }
    x.flush()?;

    eprintln!(
        "wrote {} rows x {} columns to {}",
        rows.len(),
        cols.len(),
        dir.display()
    );
    Ok(())
}
