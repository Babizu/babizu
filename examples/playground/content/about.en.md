## What is this

Babizu is a digital dictionary framework for languages with several dialects and little data. This playground lets you try it **without installing anything or writing code**, right in your browser:

- import your own wordlist (Excel, CSV, or copy and paste from a spreadsheet);
- write down the sound correspondences between dialects (for example "Pazeh r is Kaxabu l") and the affixes;
- press "Build" to get a dictionary that searches across dialects and strips affixes automatically;
- step through how a search is computed in the Algorithm Lab.

The first time you open it you get a sample project: a few dozen Pazeh and Kaxabu words and sentences.

- They come from the Pazih Dictionary (Li & Tsuchida 2001), the Kaxabu classified dictionary, Pan Dexing’s wordlist and Lin Hongrui’s Kaxabu reference grammar; each word and sentence cites its source in its note.
- The dialect rules come from the first sound-correspondence rules of the Pazeh–Kaxabu dictionary. For example, Pazeh turu "three" is tu'u in Kaxabu (r becomes a glottal stop), and bintul "star" is bintun (final l becomes n).
- The morphology lists a few common, productive affixes, for example mu-baket "hit", m<in>u-baket "hit (perfective)" and saa-baket "used for hitting".

The full dictionary is the [Pazeh–Kaxabu dictionary](https://babizu.github.io/pazeh-kaxabu/).

## How to use it

1. Go to the Workbench:
   - import or edit words and example sentences on the Wordlist tab;
   - write sound correspondences on the Dialect rules tab;
   - list affixes on the Morphology tab.
2. Press "Build". The data is processed in your browser, usually within a few seconds.
3. Go back to Search and try it: type one dialect's spelling and see whether the other dialects' words are found too.
4. Click the tags next to a result to see why it was found; in the Algorithm Lab you can change rules and see every step of the computation.

## Your data

- The project is stored only in this browser on this computer. Nothing is uploaded anywhere.
- Clearing the browser's site data deletes the project. To keep it or share it, use "Export project file" on the Workbench; you can import it again later.
- You can also export the files a real Babizu website needs (the language profile and the dataset) and give them to a site maintainer.
