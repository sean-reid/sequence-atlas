mod features;
mod oeis;
mod out;
mod terms;

use std::path::PathBuf;
use std::process::ExitCode;
use std::time::Instant;

use rayon::prelude::*;

fn usage() -> ExitCode {
    eprintln!("usage: atlas features <oeisdata-dir> <out-dir> [--min-terms N]");
    ExitCode::from(2)
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() < 3 || args[0] != "features" {
        return usage();
    }
    let oeisdata = PathBuf::from(&args[1]);
    let out_dir = PathBuf::from(&args[2]);
    let mut min_terms = 10usize;
    let mut i = 3;
    while i < args.len() {
        match args[i].as_str() {
            "--min-terms" if i + 1 < args.len() => {
                min_terms = args[i + 1].parse().unwrap_or(min_terms);
                i += 2;
            }
            _ => return usage(),
        }
    }

    let t0 = Instant::now();
    let mut entries = match oeis::load_oeisdata(&oeisdata) {
        Ok(e) => e,
        Err(e) => {
            eprintln!("reading oeisdata: {e}");
            return ExitCode::FAILURE;
        }
    };
    eprintln!(
        "oeisdata: {} sequences in {:.1?}",
        entries.len(),
        t0.elapsed()
    );

    entries.retain(|e| e.terms.len() >= min_terms);
    eprintln!("kept {} with at least {min_terms} terms", entries.len());

    let t = Instant::now();
    let rows: Vec<Vec<f32>> = entries
        .par_iter()
        .map(|e| features::compute(&e.terms, e.offset))
        .collect();
    eprintln!(
        "features: {} columns in {:.1?}",
        features::columns().len(),
        t.elapsed()
    );

    if let Err(e) = out::write(&out_dir, &entries, &rows) {
        eprintln!("writing output: {e}");
        return ExitCode::FAILURE;
    }
    eprintln!("done in {:.1?}", t0.elapsed());
    ExitCode::SUCCESS
}
