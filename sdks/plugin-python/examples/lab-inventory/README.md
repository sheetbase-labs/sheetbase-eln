# Lab inventory

Sample plugin for instruments and inventory. It adds:

- an **instrument parser** for the (made-up) Acme PlateReader 3000 CSV, which
  Sheetbase recognises by the text `Acme PlateReader` in the file;
- a **label layout** (compact cryo label) and a **barcode format** (Code 39,
  with a scan reader) that a label template can choose;
- a **storage rule** that stops a −80 °C sample going into a warm unit.
