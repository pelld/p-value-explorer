# P-Value Explorer

A small, static GitHub Pages dashboard for exploring p-values reported in PubMed abstracts.

The site:

- searches PubMed for a topic using NCBI E-utilities;
- extracts common p-value forms such as `p = .03` and `p < 0.05`;
- plots exact reported values and highlights the region around 0.05;
- shows each extracted value in its abstract context;
- caches identical searches in the browser for seven days; and
- downloads extracted results as CSV.

## Important interpretation note

This is an exploratory **reported p-value distribution**, not a formal p-curve. Abstract mining cannot reliably distinguish primary hypothesis tests from secondary or descriptive analyses. A concentration near 0.05 is not, by itself, proof of publication bias, p-hacking or misconduct.

## Run locally

No installation or Python backend is required. From the project folder:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Publish with GitHub Pages

1. Create a public repository named `p-value-explorer` in the `pelld` GitHub account.
2. Add these files to the repository's `main` branch.
3. Open **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**, then select `main` and `/ (root)`.

The published address will be:

`https://pelld.github.io/p-value-explorer/`

## Data and privacy

The browser communicates directly with the public PubMed API. Search results are cached only in the user's own browser using `localStorage`. No search data is sent to a separate application server.
